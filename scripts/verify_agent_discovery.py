"""Verify the generated public-only discovery profile offline, never API availability.

ARD v0.91 required-entry terms and the AI Catalog draft Minimal profile are
different contracts. Primary full-schema validation is a separately pinned audit;
this build guard additionally requires exact projection from current public data.
"""
from pathlib import Path
import json
import re
from bs4 import BeautifulSoup


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
        index = json.loads((build / 'ai/resources.json').read_bytes())
        if index.get('version') != 1 or index.get('resources') != rows or len(index.get('limitations', [])) != 3:
            errors.append('Public discovery metadata is not the exact approved source projection')
        raw = (build / '.well-known/ai-catalog.json').read_bytes()
        catalog = json.loads(raw)
        if raw != (build / 'ai-catalog.json').read_bytes() or catalog.get('specVersion') != '1.0' or catalog.get('host') != {'displayName': 'EmTalk'}:
            errors.append('Current draft catalog and legacy discovery copy differ')
        entries = [dict(identifier='urn:air:emtalk.org:public:' + row['id'], displayName=row['title'],
                        type='text/html', url=row['url'], description=row['summary'], tags=[row['kind'], row['topic']]) for row in rows]
        if catalog.get('entries') != entries or len({row['identifier'] for row in entries}) != 17:
            errors.append('AI Catalog entries differ from public-page references')
        if catalog.get('extensions', {}).get('org.emtalk.discovery', {}).get('resourceIndex') != base_url.rstrip('/') + '/ai/resources.json':
            errors.append('AI Catalog index address differs from build origin')
        ard = json.loads((build / '.well-known/ard.json').read_bytes())
        ard_entries = [{**entry, '@context': 'https://agenticresourcediscovery.org/context/v1',
                        'representativeQueries': ['Find the public EmTalk page: ' + row['title'], 'Read EmTalk information about ' + row['topic']]}
                       for entry, row in zip(entries, rows)]
        if set(ard) != {'entries'} or ard.get('entries') != ard_entries or ard == catalog:
            errors.append('ARD v0.91 entries and distinct catalog contract differ')
        for page in build.rglob('*.html'):
            if page.name == '404.html':
                continue
            soup = BeautifulSoup(page.read_bytes(), 'html.parser')
            for rel, path in [('ard', '/.well-known/ard.json'), ('ai-catalog', '/.well-known/ai-catalog.json')]:
                links = soup.select('head link[rel="' + rel + '"]')
                if len(links) != 1 or links[0].get('href') != prefix + path:
                    errors.append('Missing origin-correct discovery link: ' + page.relative_to(build).as_posix())
            route = soup.html.get('data-route-id', '')
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
            'scope': 'Offline exact public-source projection and discovery metadata only; not agent/browser or search-engine adoption.'}
