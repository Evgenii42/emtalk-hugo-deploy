"""Verify generated organic-search settings, not Google indexing or ranking."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, unquote
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
from PIL import Image
from prepare_hugo import EXCLUDED, load_owned_pages, owned_entry_hash, source_indexable

ROOT = Path(__file__).resolve().parents[1]
CONTROLLED = ['description', 'robots', 'og:site_name', 'og:title', 'og:description', 'og:type',
              'og:url', 'og:locale', 'og:image', 'og:image:alt', 'og:image:width', 'og:image:height', 'twitter:card', 'twitter:title',
              'twitter:description', 'twitter:image', 'twitter:image:alt']


def preserved_metadata(metadata):
    """Original named metadata retained by the head partial, excluding owned fields."""
    result = []
    for entry in metadata:
        name = (entry.get('property') or entry.get('name') or '').lower()
        if (name and 'charset' not in entry and name not in {'description', 'robots', 'generator', 'viewport'}
                and not name.startswith(('og:', 'twitter:', 'article:'))):
            result.append(entry)
    return result


def verify(build, root=ROOT, prefix='', preview=None, base_url=None):
    root, build = Path(root).resolve(), Path(build).resolve()
    errors, rows = [], []
    def unique_fields(fields):
        values = {}
        for key, value in fields:
            if key in values:
                raise ValueError('Duplicate SEO configuration field')
            values[key] = value
        return values
    config = json.loads((root / 'data/seo.json').read_text(encoding='utf-8'), object_pairs_hook=unique_fields)
    mapping = json.loads((root / 'data/route-map.json').read_text(encoding='utf-8'))
    render = json.loads((root / 'data/render.json').read_text(encoding='utf-8'))
    source = json.loads((root / 'data/source-content.json').read_text(encoding='utf-8'))
    owned = load_owned_pages(root, source['pages'])
    from news_content import load_news
    authored_news = load_news(root, set(source['pages']) | set(owned), include_drafts=True)
    draft_news_routes = {row['routeId'] for row in authored_news if row['draft']}
    routes, pages = mapping['routes'], config['pages']
    current_render = preview is None
    if current_render:
        preview = render['preview']
    prefix = '/' + prefix.strip('/') if prefix.strip('/') else ''
    expected_routes = {row['path'] for row in routes}
    # Retained metadata for validated authored drafts supports republishing.
    # Other extras, missing active routes and duplicate route rows still fail.
    if (expected_routes - set(pages) or set(pages) - expected_routes - draft_news_routes
            or len(routes) != len(expected_routes)):
        errors.append('SEO route configuration is incomplete or duplicated')
    registered_routes = (set(source['pages']) - EXCLUDED) | {route for route, entry in owned.items() if entry['mode'] == 'new'}
    if expected_routes != registered_routes:
        errors.append('Active routes differ from registered source and owned pages')
    if not isinstance(preview, bool) or (current_render and render['mountPrefix'] != prefix):
        errors.append('SEO mode or mount prefix differs from renderer')
    home = BeautifulSoup((build / 'index.html').read_bytes(), 'html.parser')
    canonical = home.select('link[rel~="canonical"]')
    base = canonical[0].get('href', '') if len(canonical) == 1 else ''
    parsed_base = urlsplit(base)
    if (parsed_base.scheme not in {'http', 'https'} or not parsed_base.hostname or parsed_base.username
            or parsed_base.password or parsed_base.query or parsed_base.fragment
            or parsed_base.path != prefix + '/'):
        errors.append('Invalid homepage canonical base')
    if not preview and base != config['site']['productionOrigin'] + '/':
        errors.append('Production canonical base differs from configured production origin')
    if base_url is not None and base != base_url:
        errors.append('Homepage canonical base differs from frozen build evidence')
    base = base.rstrip('/')
    titles, descriptions = [], []

    def fail(route, message):
        errors.append(route + ': ' + message)

    def owned_media_file(url):
        parsed = urlsplit(url)
        if (parsed.scheme != parsed_base.scheme or parsed.netloc != parsed_base.netloc
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            return None
        path = parsed.path
        if prefix:
            if not path.startswith(prefix + '/'):
                return None
            path = path[len(prefix):]
        if not path.startswith('/media/') or re.search(r'%(?![0-9a-fA-F]{2})', path):
            return None
        try:
            local = build / unquote(path.lstrip('/'), errors='strict')
            return local if local.resolve().is_relative_to(build) and local.is_file() and not local.is_symlink() else None
        except (ValueError, UnicodeDecodeError):
            return None

    def owned_media(url):
        return owned_media_file(url) is not None

    logo_path = config['site'].get('organizationLogo')
    valid_logo_path = isinstance(logo_path, str) and re.fullmatch(r'/media/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpg|jpeg|gif|webp|svg|avif)', logo_path) is not None
    expected_logo = base + logo_path if valid_logo_path else ''
    if not valid_logo_path or not owned_media(expected_logo):
        errors.append('Organization logo must reference an existing bounded owned image path')

    measured_images = {}

    def actual_image_dimensions(url):
        local = owned_media_file(url)
        if local is None:
            return None
        if local not in measured_images:
            try:
                with Image.open(local) as image:
                    image.load()
                    measured_images[local] = image.size
            except (OSError, ValueError, Image.DecompressionBombError):
                measured_images[local] = None
        return measured_images[local]

    def forbidden_schema(value):
        if isinstance(value, dict):
            return any(k in {'aggregateRating', 'review', 'ratingValue', 'ratingCount', 'reviewCount',
                            'reviewRating', 'datePublished', 'dateModified', 'author'}
                       or forbidden_schema(v) for k, v in value.items())
        return isinstance(value, list) and any(forbidden_schema(v) for v in value)

    for row in routes:
        route, filename = row['path'], row['file']
        entry = pages.get(route, {})
        soup = BeautifulSoup((build / filename).read_bytes(), 'html.parser')
        meta = {}
        for node in soup.find_all('meta'):
            name = (node.get('property') or node.get('name') or '').lower()
            meta.setdefault(name, []).append(node.get('content', ''))
        text = soup.find_all('title')
        title = text[0].get_text() if len(text) == 1 else ''
        description = meta.get('description', [''])[0]
        titles.append(title); descriptions.append(description)
        if not title.strip() or title != entry.get('title'):
            fail(route, 'Missing, duplicate or incorrect title')
        if not description.strip() or description != entry.get('description'):
            fail(route, 'Missing or incorrect description')
        for name in CONTROLLED:
            if len(meta.get(name, [])) != 1 or not meta.get(name, [''])[0].strip():
                fail(route, 'Missing, duplicate or empty metadata ' + name)
        expected_canonical = base + route
        links = soup.select('link[rel~="canonical"]')
        if len(links) != 1 or links[0].get('href') != expected_canonical:
            fail(route, 'Canonical does not preserve exact route')
        if route in source['pages']:
            original = source['pages'][route]
            indexable = source_indexable(original)
        elif route in owned and owned[route]['mode'] == 'new':
            original = {'metadata': []}
            indexable = owned[route]['indexable']
            if render['pages'][route].get('origin') != 'owned' or render['pages'][route].get('sourceHash') != owned_entry_hash(owned[route]):
                fail(route, 'Owned source identity differs from authored registry')
        else:
            original = {'metadata': []}
            indexable = False
            fail(route, 'Route has no registered source or owned provenance')
        if route in owned:
            if (render['pages'][route].get('ownedEntry') != owned[route]
                    or render['pages'][route].get('ownedHash') != owned_entry_hash(owned[route])):
                fail(route, 'Rendered owned entry differs from authored registry')
        actual_preserved = [dict(node.attrs) for node in soup.head.find_all('meta')
                            if not node.has_attr('charset')
                            and (node.get('property') or node.get('name') or '').lower()
                            not in set(CONTROLLED) | {'generator', 'viewport'}]
        if actual_preserved != preserved_metadata(original['metadata']):
            fail(route, 'Original named metadata changed or unexpected metadata added')
        if not isinstance(entry.get('indexable'), bool) or entry['indexable'] != indexable:
            fail(route, 'Index policy differs from registered source or owned policy')
        tokens = re.split(r'[\s,]+', meta.get('robots', [''])[0].lower())
        expected_tokens = ({'noindex', 'follow'} if preview or not entry.get('indexable')
                           else {'index', 'follow', 'max-image-preview:large'})
        if set(tokens) != expected_tokens or len(tokens) != len(expected_tokens):
            fail(route, 'Preview or production noindex contract mismatch')
        if not soup.html or soup.html.get('lang') != render['pages'][route]['language']:
            fail(route, 'HTML language differs from renderer')
        original_verification = [m.get('content') for m in original['metadata']
                                 if m.get('name', '').lower() == 'google-site-verification']
        if meta.get('google-site-verification', []) != original_verification:
            fail(route, 'Existing Google verification tag changed or unexpected tag added')
        article = route.startswith('/articles/')
        expected_image = base + entry.get('image', config['site']['defaultImage'])
        dimensions = [entry.get('imageWidth', config['site']['defaultImageWidth']),
                      entry.get('imageHeight', config['site']['defaultImageHeight'])]
        if entry.get('image') and not all(key in entry for key in ('imageWidth', 'imageHeight')):
            fail(route, 'Custom social image requires explicit dimensions')
        if any(type(value) is not int or value < 1 for value in dimensions):
            fail(route, 'Invalid social image dimensions')
        image_alt = (entry.get('imageAlt') or entry.get('headline') or title) if entry.get('image') else config['site']['defaultImageAlt']
        checks = {'og:title': title, 'twitter:title': title, 'og:description': description,
                  'twitter:description': description, 'og:url': expected_canonical,
                  'og:type': 'article' if article else 'website', 'og:locale': config['site']['locale'],
                  'og:site_name': config['site']['name'], 'og:image': expected_image,
                  'twitter:image': expected_image, 'twitter:card': 'summary_large_image',
                  'og:image:width': str(dimensions[0]), 'og:image:height': str(dimensions[1])}
        checks.update({'og:image:alt': image_alt, 'twitter:image:alt': image_alt})
        for key, expected in checks.items():
            if meta.get(key) != [expected]:
                fail(route, 'Incorrect social metadata ' + key)
        if not owned_media(expected_image):
            fail(route, 'Social image is not an existing owned output asset')
        elif actual_image_dimensions(expected_image) != tuple(dimensions):
            fail(route, 'Social image dimensions differ from decoded owned output bytes')
        scripts = soup.find_all('script', attrs={'type': 'application/ld+json'})
        try:
            if len(scripts) != 1:
                raise ValueError('Expected one graph')
            schema = json.loads(scripts[0].get_text())
            graph = schema['@graph']
            if schema.get('@context') != 'https://schema.org' or not isinstance(graph, list):
                raise ValueError('Invalid schema context or graph')
            if forbidden_schema(schema):
                fail(route, 'Schema contains unsupported author/date/rating claims')
            kinds = [node.get('@type') for node in graph]
            page_type = 'AboutPage' if route == '/about-us' else 'CollectionPage' if route in {'/articles', '/tests'} else 'WebPage'
            expected_kinds = ['Organization', 'WebSite', page_type] + (['AudioObject', 'BlogPosting'] if article else [])
            if sorted(kinds) != sorted(expected_kinds):
                fail(route, 'Unexpected or duplicated structured entity types')
            if kinds.count('Organization') != 1 or kinds.count('WebSite') != 1:
                fail(route, 'Missing or duplicated site identity graph')
            identity = [node.get('@id') for node in graph]
            if len(identity) != len(set(identity)):
                fail(route, 'Duplicated structured entity IDs')
            expected_ids = {'Organization': base + '/#organization', 'WebSite': base + '/#website',
                            page_type: expected_canonical + '#webpage'}
            if article:
                expected_ids.update({'AudioObject': expected_canonical + '#audio',
                                     'BlogPosting': expected_canonical + '#article'})
            expected_references = {
                'WebSite': {'publisher': expected_ids['Organization']},
                page_type: {'isPartOf': expected_ids['WebSite']},
                'BlogPosting': {'publisher': expected_ids['Organization'],
                                'mainEntityOfPage': expected_ids[page_type],
                                'audio': expected_canonical + '#audio'}}
            for node in graph:
                kind = node.get('@type')
                if node.get('@id') != expected_ids.get(kind):
                    fail(route, 'Incorrect structured entity ID')
                for field, target in expected_references.get(kind, {}).items():
                    if node.get(field) != {'@id': target}:
                        fail(route, 'Incorrect structured reference ' + field)
                if kind == 'WebSite' and (node.get('url') != base + '/'
                        or node.get('name') != config['site']['name']
                        or node.get('description') != config['site']['description']
                        or node.get('inLanguage') != render['pages'][route]['language']):
                    fail(route, 'Incorrect WebSite identity')
                if node.get('@type') in {'WebPage', 'AboutPage', 'CollectionPage'} and (
                        node.get('url') != expected_canonical or node.get('name') != title
                        or node.get('description') != description
                        or node.get('inLanguage') != render['pages'][route]['language']):
                    fail(route, 'Structured page identity differs from canonical metadata')
                if node.get('@type') == 'Organization' and (node.get('name') != config['site']['name'] or node.get('url') != base + '/' or node.get('logo') != expected_logo or not owned_media(node.get('logo', '')) or 'sameAs' in node):
                    fail(route, 'Incorrect publisher identity or logo resource')
                if node.get('@type') == 'BlogPosting':
                    h1 = soup.find('h1')
                    if not article or not h1 or node.get('headline') != h1.get_text(' ', strip=True) or node.get('url') != expected_canonical or node.get('image') != expected_image:
                        fail(route, 'Article schema differs from visible article')
                    if node.get('description') != description or node.get('inLanguage') != render['pages'][route]['language']:
                        fail(route, 'Article schema description or language differs from metadata')
                if node.get('@type') == 'AudioObject':
                    raw_audio = render['pages'][route].get('audioMp3', '')
                    if render['mountPrefix'] and raw_audio.startswith(render['mountPrefix'] + '/'):
                        raw_audio = raw_audio[len(render['mountPrefix']):]
                    if not article or node.get('encodingFormat') != 'audio/mpeg' or node.get('contentUrl') != base + raw_audio or not owned_media(node.get('contentUrl', '')):
                        fail(route, 'Audio schema does not reference owned MP3')
                    if (node.get('name') != entry.get('headline') or node.get('description') != description
                            or node.get('inLanguage') != render['pages'][route]['language']):
                        fail(route, 'Audio schema identity differs from article metadata')
            if article and (kinds.count('BlogPosting') != 1 or kinds.count('AudioObject') != 1):
                fail(route, 'Article or audio structured data missing')
            if not article and any(k in {'BlogPosting', 'AudioObject'} for k in kinds):
                fail(route, 'Non-article has article/audio claims')
        except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
            fail(route, 'Malformed or incomplete structured data')
        rows.append({'route': route, 'titleCharacters': len(title), 'descriptionCharacters': len(description),
                     'indexable': entry.get('indexable'), 'noindex': 'noindex' in tokens,
                     'canonical': expected_canonical, 'articleWithAudio': article})
    if len(titles) != len(set(titles)) or len(descriptions) != len(set(descriptions)):
        errors.append('Duplicate route titles or descriptions')
    namespace = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    sitemap = ET.parse(build / 'sitemap.xml')
    actual_sitemap = [node.findtext('s:loc', namespaces=namespace) for node in sitemap.findall('s:url', namespace)]
    expected_sitemap = [] if preview else [base + r['path'] for r in routes if pages[r['path']]['indexable']]
    if actual_sitemap != expected_sitemap:
        errors.append('Sitemap includes noindex/preview routes or has missing, duplicate or incorrect canonical URLs')
    if sitemap.findall('.//s:lastmod', namespace):
        errors.append('No authoritative lastmod dates configured for this SEO increment')
    robots_text = (build / 'robots.txt').read_text(encoding='utf-8')
    if re.search(r'^Disallow:\s*/\s*$', robots_text, re.M) or not re.search(r'^Allow:\s*/\s*$', robots_text, re.M):
        errors.append('Crawler cannot read noindex and page resources')
    sitemap_lines = re.findall(r'^Sitemap:\s*(\S+)', robots_text, re.M)
    if sitemap_lines != ([] if preview else [base + '/sitemap.xml']):
        errors.append('Robots sitemap announcement differs from mode/canonical base')
    error_page = BeautifulSoup((build / '404.html').read_bytes(), 'html.parser')
    robots = error_page.find('meta', attrs={'name': 'robots'})
    if not robots or 'noindex' not in robots.get('content', '').lower():
        errors.append('404 must be noindex')
    result = {'scope': 'All-route static SEO settings; not Google validation, indexing, ranking or full migration release',
              'preview': preview, 'routeCount': len(routes), 'indexableCount': sum(bool(pages.get(row['path'], {}).get('indexable')) for row in routes),
              'sitemapCount': len(actual_sitemap), 'rows': rows, 'errors': errors, 'passed': not errors,
              'decodedSocialImageCount': sum(size is not None for size in measured_images.values()),
              'limitations': ['Author/date/rating claims intentionally omitted until independently verified.',
                              'Social image output bytes are decoded and dimensions checked; audio locality is checked as files. Google/social crawler fetch and live domain ownership are separate.',
                              'Search Console and actual Google-selected canonicals/indexing require authenticated or deployed evidence.']}
    result['seoConfigSha256'] = hashlib.sha256((root / 'data/seo.json').read_bytes()).hexdigest()
    return result


def cli(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', required=True)
    parser.add_argument('--mount-prefix', default='')
    parser.add_argument('--report', required=True)
    parser.add_argument('--build-evidence')
    args = parser.parse_args(argv)
    try:
        evidence = json.loads((ROOT / args.build_evidence).read_text(encoding='utf-8')) if args.build_evidence else None
        if evidence:
            if evidence['passed'] is not True or evidence['mountPrefix'] != args.mount_prefix:
                raise ValueError('Frozen build evidence is not passed or has a different mount prefix')
            if not all(hashlib.sha256((ROOT / args.build / row['path']).read_bytes()).hexdigest() == row['sha256'] for row in evidence['files']):
                raise ValueError('Actual output bytes differ from frozen evidence')
            if len([p for p in (ROOT / args.build).rglob('*') if p.is_file()]) != len(evidence['files']):
                raise ValueError('Output file set differs from frozen evidence')
        result = verify(ROOT / args.build, ROOT, args.mount_prefix, evidence['preview'] if evidence else None, evidence['baseURL'] if evidence else None)
    except Exception as error:
        result = {'scope': 'Static SEO CLI verification; not Google validation', 'passed': False,
                  'errors': ['Malformed or missing SEO configuration, evidence, sitemap or output (' + type(error).__name__ + ')']}
    destination = ROOT / args.report
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'rows'}, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(cli())
