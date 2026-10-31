"""Verify the generated public-only discovery profile offline, never API availability.

ARD v0.91 required-entry terms and the AI Catalog draft Minimal profile are
different contracts. Primary full-schema validation is a separately pinned audit;
this build guard additionally requires exact projection from current public data.
"""
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import urlsplit
from bs4 import BeautifulSoup
from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_PINS = {
    'ai-catalog.schema.json': 'c55238483a4738e08b250bdd6af1f4dc05a91afe882c649d224d09c19cd8fe09',
    'ard-entry.schema.json': '3032dad432607ddae0ec088db5759fa456f36308e0e9f340165aaed504d535f4',
}
PUBLIC_LIMITATIONS = [
    'Public descriptions only, not personalized advice or questionnaire results.',
    'DM AI is available in its Android app, not on this website. BRET has no AI features. Tapl is in development.',
    'Optional browser tools require a supporting WebMCP implementation; these files do not provide an MCP backend or an AI model.',
]
APPROVED_TOPICS = ['sleep', 'burnout', 'energy', 'anxiety', 'relationships', 'motivation', 'bret', 'dm', 'tapl']
APPROVED_COUNTS = {'article': 9, 'test': 5, 'product': 3}


def llms_link_errors(text, public_paths):
    """Static llms.txt intentionally names production URLs even in previews.

    Accept plain absolute Markdown destinations and raw HTTP(S) URLs only;
    compare every target with the actual generated public route/artifact map.
    This is offline link validation, not crawler or hosting verification.
    """
    if not isinstance(text, str):
        return ['llms.txt must be text']
    paths = set(public_paths)
    markdown = re.findall(r'\[[^\]\r\n]*\]\(([^)\r\n]*)\)', text)
    targets = {value.strip().removeprefix('<').removesuffix('>') for value in markdown}
    targets.update(re.findall(r'https?://[^\s<>()\[\]]+', text, re.I))
    errors = []
    for target in sorted(targets):
        try:
            url = urlsplit(target)
            valid = (url.scheme == 'https' and url.netloc == 'www.emtalk.org'
                     and not url.query and not url.fragment and url.path in paths)
        except ValueError:
            valid = False
        if not valid:
            errors.append('llms.txt target is not an allowed production route/artifact: ' + target)
    required = {'https://www.emtalk.org' + path for path in
                ['/ai/index.md', '/ai/resources.json', '/.well-known/ai-catalog.json', '/.well-known/ard.json']}
    if not required <= targets:
        errors.append('llms.txt is missing a required machine-readable discovery link')
    return errors


def runtime_contract_errors(root, rows):
    """Narrow literal contract, not a JS interpreter or a permissive fallback.

    Accepted syntax: exact const names topics/resourceCounts/resourceTotal,
    each with its literal declaration on one line in agent-discovery.js.
    Runtime literals, Hugo public-resource projection, and this verifier must be
    reviewed together on catalog growth. Missing/changed syntax fails closed.
    Sensitive-route exclusion is owned by the bootstrap partial and checked on
    every rendered HTML page below, rather than duplicated in runtime code.
    """
    script = (Path(root) / 'assets/js/agent-discovery.js').read_text(encoding='utf-8')
    topics = re.findall(r'\bconst topics = (\[[^\r\n;]+\]);', script)
    counts = re.findall(r'\bconst resourceCounts = (\{[^\r\n;]+\});', script)
    total = re.findall(r'\bconst resourceTotal = ([0-9]+);', script)
    if len(topics) != 1 or len(counts) != 1 or len(total) != 1:
        return ['Runtime catalog vocabulary/count literals are missing or ambiguous']
    if (json.loads(topics[0]) != APPROVED_TOPICS or json.loads(counts[0]) != APPROVED_COUNTS
            or int(total[0]) != sum(APPROVED_COUNTS.values())):
        return ['Runtime catalog vocabulary/count literals differ from the approved projection contract']
    if any(row['topic'] not in json.loads(topics[0]) for row in rows):
        return ['Projected public resource topic is unsupported by the runtime vocabulary']
    return []


def primary_schema(root, name, value, manifest=False):
    """Full pinned upstream schema, including format checks, with no network refs."""
    body = (root / 'scripts/schemas' / name).read_bytes()
    if hashlib.sha256(body).hexdigest() != SCHEMA_PINS[name]:
        raise ValueError('Primary schema bytes differ from the reviewed upstream pin')
    schema = json.loads(body)
    def local_refs(node):
        if isinstance(node, dict):
            if '$ref' in node and not node['$ref'].startswith('#/'):
                raise ValueError('Remote schema references are forbidden in the offline guard')
            for child in node.values():
                local_refs(child)
        elif isinstance(node, list):
            for child in node:
                local_refs(child)
    local_refs(schema)
    if manifest:
        schema = {**schema, '$ref': '#/$defs/ArdManifest'}
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [str(error.json_path) + ': ' + error.validator for error in validator.iter_errors(value)]


def expected_resources(root, base_url):
    root = Path(root)
    load = lambda name: json.loads((root / ('data/' + name + '.json')).read_bytes())
    articles, guide = load('article-library')['articles'], load('test-experience')
    cms, models, owned = load('cms/tests')['items'], load('source-content-tests')['models'], load('owned-pages')['pages']
    base = base_url.rstrip('/')
    rows = [dict(id='article:' + row['route'].rsplit('/', 1)[-1], kind='article',
                 title=row['title'], summary=row['summary'], topic=row['topic'],
                 url=base + row['route'], status='published',
                 readingMinutes=row['readingMinutes'], listeningMinutes=row['listeningMinutes']) for row in articles]
    for group in guide['groups']:
        for slug in group['tests']:
            items = [x['fieldData'] for x in cms if x['fieldData']['slug'] == slug]
            if len(items) != 1:
                raise ValueError('Exactly one public test description required')
            row = items[0]
            rows.append(dict(id='test:' + slug, kind='test', title=row['test-title'],
                             summary=guide['tests'][slug]['summary'], topic=group['id'],
                             url=base + '/tests/' + slug, status='self_reflection_not_diagnosis',
                             questions=len(models['/tests/' + slug]['questions']), minutes=int(row['time'])))
    for slug in ['bret', 'dm', 'tapl']:
        row = owned['/' + slug]
        rows.append(dict(id='product:' + slug, kind='product', title=row['title'], summary=row['lead'],
                         topic=slug, url=base + '/' + slug,
                         status='in_development' if slug == 'tapl' else 'guest_tools_available'))
    if len(rows) != 17 or {kind: sum(x['kind'] == kind for x in rows) for kind in ['article', 'test', 'product']} != {'article': 9, 'test': 5, 'product': 3}:
        raise ValueError('Approved public resource counts differ')
    return rows


def verify(build, root, prefix='', base_url='https://www.emtalk.org/'):
    build, root = Path(build), Path(root)
    errors = []
    try:
        rows = expected_resources(root, base_url)
        errors.extend(runtime_contract_errors(root, rows))
        index = json.loads((build / 'ai/resources.json').read_bytes())
        if (set(index) != {'version', 'resources', 'limitations'}
                or type(index.get('version')) is not int or index['version'] != 1
                or index.get('resources') != rows or index.get('limitations') != PUBLIC_LIMITATIONS):
            errors.append('Public discovery metadata is not the exact approved source projection')
        raw = (build / '.well-known/ai-catalog.json').read_bytes()
        catalog = json.loads(raw)
        if raw != (build / 'ai-catalog.json').read_bytes() or catalog.get('specVersion') != '1.0' or catalog.get('host') != {'displayName': 'EmTalk'}:
            errors.append('Current draft catalog and legacy discovery copy differ')
        entries = [dict(identifier='urn:air:emtalk.org:public:' + row['id'], displayName=row['title'],
                        type='text/html', url=row['url'], description=row['summary'], tags=[row['kind'], row['topic']]) for row in rows]
        if catalog.get('entries') != entries or len({row['identifier'] for row in entries}) != 17:
            errors.append('AI Catalog entries differ from public-page references')
        if set(catalog) != {'specVersion', 'host', 'entries'}:
            errors.append('AI Catalog must use the primary schema without invented top-level extensions')
        errors.extend('AI Catalog primary schema: ' + error for error in primary_schema(root, 'ai-catalog.schema.json', catalog))
        ard = json.loads((build / '.well-known/ard.json').read_bytes())
        ard_entries = [{**entry, '@context': 'https://agenticresourcediscovery.org/context/v1',
                        'representativeQueries': ['Find the public EmTalk page: ' + row['title'], 'Read EmTalk information about ' + row['topic']]}
                       for entry, row in zip(entries, rows)]
        if set(ard) != {'entries'} or ard.get('entries') != ard_entries or ard == catalog:
            errors.append('ARD v0.91 entries and distinct catalog contract differ')
        errors.extend('ARD primary manifest schema: ' + error for error in primary_schema(root, 'ard-entry.schema.json', ard, manifest=True))
        for row in ard.get('entries', []):
            errors.extend('ARD primary entry schema: ' + error for error in primary_schema(root, 'ard-entry.schema.json', row))
        # Exact projection from SEO-owned public metadata, not a manually drifting
        # duplicate page registry. This is documentation, not an AI ranking claim.
        seo = json.loads((root / 'data/seo.json').read_bytes())['pages']
        expected_index = ('# EmTalk public page index\n\n'
                          + 'Canonical build origin: ' + base_url.rstrip('/') + '/\n\n'
                          + 'Descriptions below come from the same metadata as the public HTML pages. Follow each page for its full content and context. This index contains no visitor answers, results, decisions, contact submissions or account data.\n\n'
                          + 'Self-assessments support reflection, not diagnosis. Decision Matrix AI is available in the Android app, not on this website. BRET has no AI features. TAPL is in development.\n\n')
        expected_index += ''.join('## ' + row['title'] + '\n\nURL: ' + base_url.rstrip('/') + route + '\n\n' + row['description'] + '\n\n'
                                 for route, row in sorted(seo.items()) if row['indexable'])
        markdown = (build / 'ai/index.md').read_bytes()
        if markdown != expected_index.encode('utf-8') or len(markdown) > 32768:
            errors.append('LLM page index differs from exact indexable SEO title/description/URL projection')
        # llms.txt stays production-only even when this build has a preview
        # prefix. Validate its production paths against actual generated files.
        public_paths = set()
        for artifact in build.rglob('*'):
            if artifact.is_file():
                name = artifact.relative_to(build).as_posix()
                if name not in {'_headers', '_routes.json'}:
                    public_paths.add('/' if name == 'index.html' else
                                     '/' + name[:-5] if name.endswith('.html') else '/' + name)
        errors.extend(llms_link_errors((build / 'llms.txt').read_text(encoding='utf-8'), public_paths))
        for page in build.rglob('*.html'):
            if page.name == '404.html' or page.relative_to(build).as_posix() == 'analytics/google-frame.html':
                continue
            soup = BeautifulSoup(page.read_bytes(), 'html.parser')
            for rel, path in [('ard', '/.well-known/ard.json'), ('ai-catalog', '/.well-known/ai-catalog.json')]:
                links = soup.select('head link[rel="' + rel + '"]')
                if len(links) != 1 or links[0].get('href') != prefix + path or links[0].get('type') != 'application/json':
                    errors.append('Missing origin-correct discovery link: ' + page.relative_to(build).as_posix())
            route = soup.html.get('data-route-id', '')
            # Keep exclusions synchronized with layouts/partials/agent-discovery.html.
            # Public metadata links are site-wide; only browser tool bootstrap is excluded.
            excluded = route.startswith(('/tests/', '/documents/')) or route in {'/dm/workspace', '/bret/practice'}
            boot = soup.select('script[data-emtalk-agent-bootstrap]')
            if len(boot) != (0 if excluded else 1):
                errors.append('Agent bootstrap route exclusion differs: ' + route)
            for script in boot:
                if script.get('src') or 'document.modelContext?.registerTool' not in script.get_text() or not script.get('data-integrity', '').startswith('sha256-'):
                    errors.append('Agent feature-detection bootstrap differs: ' + route)
                module = script.get('data-module', '')
                if not module.startswith(prefix + '/js/') or not re.fullmatch(r'agent-discovery\.[0-9a-f]{64}\.js', module.rsplit('/', 1)[-1]):
                    errors.append('Agent module is not the own generated fingerprint: ' + route)
        if len((build / 'ai/resources.json').read_bytes()) > 32768:
            errors.append('Agent metadata exceeds its runtime stream bound')
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append('Agent discovery contract failed: ' + type(error).__name__)
    return {'passed': not errors, 'errors': errors, 'resourceCount': 17,
            'primarySchemas': SCHEMA_PINS,
            'scope': 'Offline full pinned primary schemas and exact public-source projection; not native browser support, ingestion, search-engine adoption or ranking.'}
