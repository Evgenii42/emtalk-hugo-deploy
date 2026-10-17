"""Prepare editable CMS bindings and original layout trees for Hugo templates.

No network access or source archive mutations. Hugo, rather than a copied HTML
page or Webflow runtime, renders the resulting node/component data.
"""
import argparse
import copy
import hashlib
import json
import math
import re
from pathlib import Path
from urllib.parse import urlsplit, urljoin, unquote, quote

from bs4 import BeautifulSoup, Comment, Doctype, ProcessingInstruction, Declaration, CData, NavigableString, Tag

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'/meditations', '/meditations/relax-short'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
NON_CONTENT = {'script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'title'}
TOKEN_LIST_ATTRIBUTES = {'class', 'rel', 'headers', 'accept-charset', 'sandbox'}
JSONLD_RESOURCE_FIELDS = {'image', 'logo', 'screenshot', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'thumbnail'}
JSONLD_URL_FIELDS = {'@id', 'url', 'item', 'sameAs', 'mainEntityOfPage', '@context', 'availability'}
MEDIA_OBJECT_TYPES = {'ImageObject', 'AudioObject', 'VideoObject', 'MediaObject'}
METADATA_URL_FIELDS = {'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'og:url', 'twitter:url',
                       'og:audio', 'og:audio:url', 'og:audio:secure_url', 'og:video', 'og:video:url',
                       'og:video:secure_url', 'twitter:player', 'twitter:player:stream'}


def parse_json(value):
    def reject_constant(constant):
        raise ValueError('Nonfinite JSON constant: ' + constant)
    def finite_float(number):
        parsed = float(number)
        if not math.isfinite(parsed):
            raise ValueError('Nonfinite JSON number: ' + number)
        return parsed
    return json.loads(value, parse_constant=reject_constant, parse_float=finite_float)


def read(path):
    try:
        return parse_json((ROOT / path).read_text(encoding='utf-8'))
    except ValueError as error:
        raise ValueError(f'Invalid JSON input {path}: {error}') from error


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def validate_route(route, root=None):
    """Validate a URL path before deriving a bounded Windows content filename."""
    valid = isinstance(route, str) and route.startswith('/') and not route.startswith('//')
    valid = valid and (route == '/' or not route.endswith('/'))
    valid = valid and not re.search(r'%(?![0-9A-Fa-f]{2})', route)
    if valid:
        decoded = unquote(route)
        # Filenames retain literal percent encoding. Decoded reserved punctuation
        # is URL data, while decoded traversal, separators and controls are unsafe.
        valid = not re.search(r'[\x00-\x20\x7f\\<>:"|?*#]', route)
        valid = valid and not re.search(r'[\x00-\x20\x7f\\]', decoded)
        valid = valid and not re.search(r'%(?:2f|5c)', route, re.I)
        valid = valid and not any(part in {'.', '..'} for part in decoded.split('/'))
        project = Path(root or ROOT)
        path = project / 'content' / ('_index.md' if route == '/' else route.strip('/') + '.md')
        valid = valid and path.resolve().is_relative_to((project / 'content').resolve())
    if not valid:
        raise ValueError(f'Invalid corpus route: {route!r}')


def owned_entry_hash(entry):
    return hashlib.sha256(json.dumps(entry, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def source_indexable(page):
    return not any('noindex' in row.get('content', '').lower()
                   for row in page['metadata'] if row.get('name', '').lower() == 'robots')


def prepare_skip_target(page):
    """Decorate only a rendered content heading, never the immutable corpus."""
    if page['routeId'] == '/':
        return {'id': 'home-explore-title', 'href': '#home-explore-title'}
    if 'ownedEntry' in page:
        return {'id': 'emtalk-main', 'href': '#emtalk-main'}

    def nodes(node, omit_headers=False):
        if not isinstance(node, dict):
            return
        classes = node.get('attributes', {}).get('class', '')
        classes = classes.split() if isinstance(classes, str) else classes if isinstance(classes, list) else []
        if omit_headers and node.get('tag', '').lower() == 'header' and 'header-clean' in classes:
            return
        yield node
        for child in node.get('children', []):
            yield from nodes(child, omit_headers)

    content = list(nodes(page['body'], omit_headers=True))
    heading = next((node for node in content if node.get('tag', '').lower() == 'h1'), None)
    if heading is None:
        heading = next((node for node in content if node.get('tag', '').lower() in {'h2', 'h3', 'h4', 'h5', 'h6'}), None)
    if heading is None:
        return None
    attributes = heading.setdefault('attributes', {})
    identifier = attributes.get('id')
    if identifier is None or identifier == '':
        existing = {str(node.get('attributes', {}).get('id')) for node in nodes(page['body'])
                    if node.get('attributes', {}).get('id') is not None}
        identifier = 'emtalk-main'
        suffix = 2
        while identifier in existing:
            identifier = 'emtalk-main-' + str(suffix)
            suffix += 1
        attributes['id'] = identifier
    attributes['tabindex'] = '-1'
    return {'id': str(identifier), 'href': '#' + quote(str(identifier), safe='')}


def load_owned_pages(root, source_pages):
    """Read authored entries without treating them as observed CMS/source pages."""
    root = Path(root)
    path = root / 'data/owned-pages.json'
    if not path.exists():
        return {}
    if path.is_symlink() or not path.resolve().is_relative_to((root / 'data').resolve()):
        raise ValueError('Owned registry must be a contained data file')
    def unique(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Duplicate owned registry key')
            result[key] = value
        return result
    registry = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
    if (not isinstance(registry, dict) or set(registry) != {'schemaVersion', 'pages'}
            or type(registry['schemaVersion']) is not int or registry['schemaVersion'] != 1
            or not isinstance(registry['pages'], dict)):
        raise ValueError('Invalid owned registry schema')
    entries = registry['pages']
    filenames = {('index.html' if route == '/' else route.lstrip('/') + '.html').casefold(): route
                 for route in source_pages}
    required = {'mode', 'language', 'title', 'lead', 'sections', 'actions', 'indexable'}
    for route, entry in entries.items():
        validate_route(route, root)
        filename = ('index.html' if route == '/' else route.lstrip('/') + '.html').casefold()
        if (route in EXCLUDED or filename == '404.html' or not isinstance(entry, dict)
                or not required <= set(entry) or set(entry) - required - {'eyebrow'}):
            raise ValueError('Invalid owned page record on ' + route)
        if entry['mode'] == 'new':
            if filename in filenames:
                raise ValueError('Owned route collides with existing output on ' + route)
            filenames[filename] = route
        elif entry['mode'] == 'augment':
            if route not in source_pages:
                raise ValueError('Owned augmentation requires an existing source route')
            if entry['indexable'] is not source_indexable(source_pages[route]):
                raise ValueError('Owned augmentation cannot change inherited index policy')
        else:
            raise ValueError('Invalid owned page mode on ' + route)
        for field in ('language', 'title', 'lead'):
            if not isinstance(entry[field], str) or not entry[field].strip():
                raise ValueError('Invalid owned text field on ' + route)
        if not re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*', entry['language']):
            raise ValueError('Invalid owned page language on ' + route)
        if 'eyebrow' in entry and (not isinstance(entry['eyebrow'], str) or not entry['eyebrow'].strip()):
            raise ValueError('Invalid owned eyebrow on ' + route)
        if type(entry['indexable']) is not bool or not isinstance(entry['sections'], list) or not isinstance(entry['actions'], list):
            raise ValueError('Invalid owned content or index policy on ' + route)
        for section in entry['sections']:
            if (not isinstance(section, dict) or set(section) != {'title', 'text'}
                    or any(not isinstance(section[key], str) or not section[key].strip() for key in ('title', 'text'))):
                raise ValueError('Invalid owned section on ' + route)
        for action in entry['actions']:
            if (not isinstance(action, dict) or set(action) != {'label', 'path'}
                    or not isinstance(action['label'], str) or not action['label'].strip()):
                raise ValueError('Invalid owned action on ' + route)
            validate_route(action['path'], root)
    active = (set(source_pages) - EXCLUDED) | {route for route, entry in entries.items() if entry['mode'] == 'new'}
    if any(action['path'] not in active for entry in entries.values() for action in entry['actions']):
        raise ValueError('Owned action must reference an active registered route')
    return entries


def html_nodes(value, issues=None, route=''):
    soup = BeautifulSoup(value, 'html.parser')
    def convert(node):
        if isinstance(node, (Comment, Doctype, ProcessingInstruction, Declaration, CData)):
            return None
        if isinstance(node, NavigableString):
            return str(node)
        if not isinstance(node, Tag):
            return None
        if node.name.lower().rsplit(':', 1)[-1] in NON_CONTENT:
            if issues is not None:
                issues.append({'routeId': route, 'disposition': 'dropped-non-content-richtext-element', 'tag': node.name})
            return None
        return {'tag': node.name, 'attributes': dict(node.attrs),
                'children': [v for c in node.children if (v := convert(c)) is not None]}
    return [v for c in soup.contents if (v := convert(c)) is not None]


def prepare(prefix='', preview=False):
    prefix = '/' + prefix.strip('/') if prefix.strip('/') else ''
    if not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*', prefix):
        raise ValueError('Mount prefix must be an explicit simple absolute path')
    # Hugo reads every authored data file, including unused fields/collections.
    # Regenerated render data may be replaced; the old route map is checked below
    # because its contents govern generated-page cleanup.
    regenerated = {ROOT / 'data/render.json', ROOT / 'data/route-map.json'}
    for path in (ROOT / 'data').rglob('*.json'):
        if path not in regenerated:
            read(path.relative_to(ROOT).as_posix())
    corpus = read('data/source-content.json')
    for route in corpus['pages']:
        validate_route(route)
    owned = load_owned_pages(ROOT, corpus['pages'])
    media = read('inventory/media.json')
    models = read('data/source-content-tests.json')['models']
    schema = read('data/source-content-schema.json')['articleCatalog']
    source_sitemap = read('data/source-content-sitemap.json')
    pending_writes = {}
    pending_deletions = set()
    def plan_text(path, value):
        if not path.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError('Generated output escapes project directory')
        pending_writes[path] = value
    def plan_json(path, value):
        plan_text(path, json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    collections = {}
    for file in (ROOT / 'data/cms').glob('*.json'):
        data = read(file.relative_to(ROOT).as_posix())
        if 'items' in data:
            collections[file.stem] = {item['id']: item['fieldData'] for item in data['items']}
    def cms_fields(collection, item_id, route):
        if not isinstance(collection, str) or not collection.strip() or not isinstance(item_id, str) or not item_id.strip():
            raise ValueError('Invalid CMS lookup keys on ' + route + ': collection and itemId must be nonempty strings')
        try:
            value = collections[collection][item_id]
        except (KeyError, TypeError) as error:
            raise ValueError(f'Missing CMS item on {route}: {collection}/{item_id}') from error
        if not isinstance(value, dict):
            raise ValueError(f'Invalid CMS item fields on {route}: {collection}/{item_id}')
        return value
    def cms_value(collection, item_id, field, route):
        values = cms_fields(collection, item_id, route)
        if not isinstance(field, str) or not field.strip():
            raise ValueError('Invalid CMS field key on ' + route + ': field must be a nonempty string')
        if field not in values:
            raise ValueError(f'Missing CMS field on {route}: {collection}/{item_id}/{field}')
        return values[field]
    def local_media_url(value):
        if not isinstance(value, str) or not value.startswith('/') or value.startswith('//'):
            raise ValueError('Localized media URL must be an absolute local path')
        return prefix + value
    def audio_sources(winner, route):
        resource = next((r for r in media['resources'] if r.get('originalUrl') == winner), None)
        if resource is None:
            return None
        if resource.get('kind') != 'audio' or resource.get('status') != 'downloaded' or resource.get('targetRuntimeAllowed') is not True:
            raise ValueError('Unapproved audio resource on ' + route)
        alternates = resource.get('alternates')
        if not isinstance(alternates, list) or not alternates or not isinstance(alternates[0], dict):
            raise ValueError('Missing approved audio alternate on ' + route)
        urls = []
        for item in (resource, alternates[0]):
            value = item.get('localUrl')
            if not isinstance(value, str) or not value.startswith('/media/'):
                raise ValueError('Invalid localized audio URL on ' + route)
            decoded = unquote(value)
            if re.search(r'[\x00-\x20\x7f\\?#]', value) or re.search(r'[\x00-\x20\x7f\\]', decoded) or re.search(r'%(?:2f|5c)', value, re.I) or any(part in {'.', '..'} for part in decoded.split('/')):
                raise ValueError('Invalid localized audio URL on ' + route)
            urls.append(local_media_url(value))
        return {'opus': urls[0], 'mp3': urls[1]}
    # Source models define public projection/order. Editable CMS supplies labels;
    # never add unpublished extra Gerchikov options or invent scoring formulas.
    models = copy.deepcopy(models)
    for route, model in models.items():
        for question in model['questions']:
            fields = cms_fields('questions-v2', question['id'], route)
            question['question'] = cms_value('questions-v2', question['id'], 'question-text', route)
            answer_ids = cms_value('questions-v2', question['id'], 'answers', route)
            for answer in question['answers']:
                if not isinstance(answer_ids, list) or not 0 <= answer['index'] < len(answer_ids):
                    raise ValueError('CMS answer references no longer match the published projection on ' + route)
                answer['text'] = cms_value('answers-v2', answer_ids[answer['index']], 'answer-text', route)
    replacements = {r['originalUrl']: local_media_url(r['localUrl']) for r in media['resources']
                    if r['status'] == 'downloaded' and r.get('targetRuntimeAllowed') and r.get('localUrl')}
    ordered = sorted(replacements, key=len, reverse=True)
    def localize(value):
        if not isinstance(value, str):
            return value
        for original in ordered:
            value = value.replace(original, replacements[original])
        # CMS body may use source origin URLs instead of root relative links.
        if value.startswith(('https://www.emtalk.org', 'https://emtalk.org', '//www.emtalk.org', '//emtalk.org')):
            parsed = urlsplit(value)
            if parsed.hostname in {'www.emtalk.org', 'emtalk.org'}:
                value = (parsed.path or '/') + ('?' + parsed.query if parsed.query else '') + ('#' + parsed.fragment if parsed.fragment else '')
        if value.startswith('/') and not value.startswith('//') and prefix and value != prefix and not value.startswith(prefix + '/'):
            value = prefix + value
        return value

    def localize_css(value):
        pattern = r'''url\((\s*)(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^)"'\\])*))(\s*)\)'''
        def localized_url(match):
            if match[2] is not None:
                quote, url = '"', match[2]
            elif match[3] is not None:
                quote, url = "'", match[3]
            else:
                quote, url = '', match[4]
            if url.lstrip().lower().startswith('data:'):
                return match[0]
            return 'url(' + match[1] + quote + localize(url.strip()) + quote + match[5] + ')'
        return re.sub(pattern, localized_url, value)

    def localize_srcset(value, route):
        # URLs end at whitespace, not at interior commas (notably data URLs).
        # Preserve descriptors, delimiters and source whitespace verbatim.
        output = []
        index = 0
        while index < len(value):
            start = index
            while index < len(value) and value[index] in ' \t\n\r\f,':
                index += 1
            output.append(value[start:index])
            start = index
            while index < len(value) and value[index] not in ' \t\n\r\f':
                index += 1
            token = value[start:index]
            url = token.rstrip(',')
            scheme = urlsplit(url).scheme.lower()
            image_data = re.match(r'^data:image/(?:png|gif|jpeg|webp|avif|svg\+xml)[;,]', url, re.I)
            if scheme in {'javascript', 'vbscript'} or (scheme == 'data' and not image_data):
                raise ValueError('Disallowed srcset URL on ' + route)
            output.append(localize(url))
            output.append(token[len(url):])
            if len(url) != len(token):
                continue
            start = index
            parentheses = 0
            while index < len(value):
                char = value[index]
                if char == ',' and not parentheses:
                    break
                if char == '(':
                    parentheses += 1
                elif char == ')' and parentheses:
                    parentheses -= 1
                index += 1
            output.append(value[start:index])
        return ''.join(output)

    def structured(value, key='', resource_context=False):
        if isinstance(value, dict):
            object_type = value.get('@type')
            media_object = isinstance(object_type, str) and object_type in MEDIA_OBJECT_TYPES
            context = key in JSONLD_RESOURCE_FIELDS or media_object
            return {k: structured(v, k, context) for k, v in value.items()}
        if isinstance(value, list):
            return [structured(v, key, resource_context) for v in value]
        # Identity links/vocabulary are semantic references, not fetched assets.
        resource = key in JSONLD_RESOURCE_FIELDS or (resource_context and key in JSONLD_URL_FIELDS)
        relative_url = key in JSONLD_URL_FIELDS and isinstance(value, str) and value.startswith('/')
        return localize(value) if resource or relative_url else value

    def page_schema(source, route):
        try:
            values = [parse_json(value) if isinstance(value, str) else copy.deepcopy(value)
                      for value in source['structuredData']]
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError('Malformed structured data on ' + route) from error
        if any(not isinstance(value, dict) for value in values):
            raise ValueError('Structured data requires object values on ' + route)
        if route == schema['routeId']:
            # Repair only the source-proven broken catalogue references. Read the
            # observed public projection from IDs, with editable CMS field values.
            articles = []
            for ref in schema['itemRefs']:
                item_id = ref['itemId']
                image = cms_value('articles', item_id, 'cover-image', route)
                if not isinstance(image, dict) or not isinstance(image.get('url'), str):
                    raise ValueError('Invalid CMS cover-image URL on ' + route + ': articles/' + item_id)
                articles.append({'@type': 'Article', '@id': ref['routeId'],
                                 'url': ref['routeId'], 'headline': cms_value('articles', item_id, 'name', route),
                                 'description': cms_value('articles', item_id, 'meta-description', route),
                                 'image': image['url'], 'inLanguage': 'en'})
            for value in values:
                if value.get('@type') == 'CollectionPage':
                    value['hasPart'] = articles
        return [structured(value) for value in values]

    issues = []
    def attribute_value(value, key, route):
        if isinstance(value, list):
            if key.lower() not in TOKEN_LIST_ATTRIBUTES or any(not isinstance(item, str) for item in value):
                raise ValueError(f'Invalid corpus attribute value on {route}: {key}')
            return ' '.join(value)
        if value is not None and not isinstance(value, (str, int, float, bool)):
            raise ValueError(f'Invalid corpus attribute value on {route}: {key}')
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f'Nonfinite corpus attribute value on {route}: {key}')
        return '' if value is None else value
    def transform(node, route, page_fields):
        if isinstance(node, str):
            # Hidden CMS audio-url is text, not an HTML src attribute.
            return localize(node)
        if not isinstance(node, dict) or not isinstance(node.get('tag'), str):
            raise ValueError('Malformed layout node on ' + route)
        node = copy.deepcopy(node)
        if ':' in node['tag'] and node['tag'].lower().rsplit(':', 1)[-1] in NON_CONTENT:
            issues.append({'routeId': route, 'disposition': 'dropped-qualified-executable-layout-element', 'tag': node['tag']})
            return None
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9:-]*', node['tag']) or node['tag'].lower() in NON_CONTENT:
            raise ValueError(f'Unsupported executable or malformed layout tag on {route}')
        binding = node.pop('binding', None)
        if binding is not None and (not isinstance(binding, dict) or not binding):
            raise ValueError('Malformed content binding on ' + route)
        if binding:
            fields_for_binding = cms_fields(binding.get('collection'), binding.get('itemId'), route)
            if binding.get('type') is not None and not isinstance(binding['type'], str):
                raise ValueError('Unsupported content binding on ' + route)
        if binding and binding.get('type') not in {'plainText', 'richText', 'formattedText'}:
            # Identity-only question containers and public multi-reference
            # projections are intentional source schema, consumed by testModel.
            identity = (binding.get('type') is None and binding.get('collection') == 'questions-v2'
                        and isinstance(binding.get('questionOrdinal'), int))
            projection = (binding.get('type') == 'multiReference' and binding.get('field') == 'answers'
                          and isinstance(binding.get('publicRenderedLimit'), int))
            if fields_for_binding is None or not (identity or projection):
                raise ValueError('Unsupported content binding on ' + route)
        if binding and binding.get('type') in {'plainText', 'richText', 'formattedText'}:
            field = cms_value(binding.get('collection'), binding.get('itemId'), binding.get('field'), route)
            scalar = field is None or isinstance(field, (str, int, float, bool))
            scalar = scalar and not (isinstance(field, float) and not math.isfinite(field))
            if not scalar or (binding['type'] == 'richText' and field is not None and not isinstance(field, str)):
                raise ValueError(f'Invalid CMS {binding["type"]} content value on {route}: {binding["collection"]}/{binding["itemId"]}/{binding["field"]}')
            if binding['type'] == 'richText':
                node['children'] = html_nodes('' if field is None else field, issues, route)
            elif binding['type'] == 'formattedText':
                if not isinstance(binding.get('prefix', ''), str) or not isinstance(binding.get('suffix', ''), str):
                    raise ValueError('Invalid formattedText affixes on ' + route)
                node['children'] = [binding.get('prefix', '') + ('' if field is None else str(field)) + binding.get('suffix', '')]
            else:
                node['children'] = ['' if field is None else str(field)]
        attrs = node.get('attributes', {})
        if not isinstance(attrs, dict):
            raise ValueError('Malformed layout attributes on ' + route)
        if attrs.get('tmplayer-meta') == 'audio-url' and 'audio-url' in page_fields:
            node['children'] = [page_fields['audio-url'] or '']
        attribute_bindings = node.pop('bindings', [])
        if not isinstance(attribute_bindings, list) or any(not isinstance(b, dict) for b in attribute_bindings):
            raise ValueError('Malformed attribute bindings on ' + route)
        for attribute_binding in attribute_bindings:
            if attribute_binding.get('type') != 'attribute':
                raise ValueError('Unsupported attribute binding')
            value = cms_value(attribute_binding.get('collection'), attribute_binding.get('itemId'), attribute_binding.get('field'), route)
            if attribute_binding.get('valuePath'):
                if value is not None and not isinstance(value, dict):
                    raise ValueError('Attribute binding valuePath requires a mapping on ' + route)
                value = (value or {}).get(attribute_binding['valuePath'], '')
            if value is not None and not isinstance(value, (str, int, float, bool)):
                raise ValueError('Attribute binding requires a scalar value on ' + route)
            attribute = attribute_binding['attribute']
            if attribute == 'src' and value != attrs.get('src'):
                attrs.pop('srcset', None)
                attrs.pop('sizes', None)
            attrs[attribute] = '' if value is None else value
        cleaned = {}
        for key, value in attrs.items():
            if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z_:][A-Za-z0-9_.:-]*', key) or key.lower().startswith(('on', 'data-wf-')):
                issues.append({'routeId': route, 'disposition': 'dropped-unsafe-source-attribute',
                               'tag': node['tag'], 'attributeName': str(key)})
                continue
            value = attribute_value(value, key, route)
            cleaned[key] = localize_srcset(value, route) if key.lower() == 'srcset' and isinstance(value, str) else localize(value)
        node['attributes'] = cleaned
        attrs = node['attributes']
        for name in ('href', 'src', 'xlink:href', 'action', 'formaction'):
            value = str(attrs.get(name, ''))
            scheme = urlsplit(value).scheme.lower()
            executable_data = scheme == 'data' and (name != 'src' or not re.match(r'^data:image/(?:png|gif|jpeg|webp|avif|svg\+xml)[;,]', value, re.I))
            if scheme in {'javascript', 'vbscript'} or executable_data:
                raise ValueError(f'Executable URL on {route}')
        if 'style' in attrs:
            attrs['style'] = localize_css(attrs['style'])
        if node['tag'] == 'img' and 'design.webflow.com' in str(attrs.get('src', '')):
            # Verified decorative source403 image has zero height in both viewports.
            attrs.pop('src', None)
            attrs.pop('srcset', None)
            attrs['style'] = attrs.get('style', '') + ';height:0;min-height:0;max-height:0'
            attrs['aria-hidden'] = 'true'
            issues.append({'routeId': route, 'disposition': 'neutral-zero-height-image', 'evidence': 'docs/audits/functional/about-source-image/report.json'})
        if node['tag'] == 'a' and attrs.get('href') in {'null', 'https://null', 'https://null/'}:
            node['tag'] = 'span'
            attrs.pop('href', None)
            attrs.pop('target', None)
            issues.append({'routeId': route, 'disposition': 'nonclickable-invalid-source-link'})
        if node['tag'] == 'a':
            destination = str(attrs.get('href', '')).removeprefix(prefix)
            resolved = urlsplit(urljoin('https://www.emtalk.org' + route, destination))
            if resolved.hostname in {'www.emtalk.org', 'emtalk.org'} and resolved.path.rstrip('/') in EXCLUDED:
                node['tag'] = 'span'
                attrs.pop('href', None)
                attrs.pop('target', None)
                attrs['aria-disabled'] = 'true'
                issues.append({'routeId': route, 'disposition': 'owner-excluded-meditation-link'})
            if attrs.get('href') == '#' and any(isinstance(child, dict) and child['tag'] == 'img'
                    and child.get('attributes', {}).get('alt') == 'Download on Apple Store' for child in node.get('children', [])):
                node['tag'] = 'span'
                attrs.pop('href', None)
                attrs.update({'role': 'link', 'aria-disabled': 'true', 'tabindex': '0',
                              'aria-label': 'Apple Store download unavailable', 'title': 'Apple Store download unavailable'})
                issues.append({'routeId': route, 'disposition': 'disabled-source-apple-store-placeholder'})
        if node['tag'] == 'audio':
            winner = page_fields.get('audio-url') if 'audio-url' in page_fields else corpus['pages'][route]['audio'].get('url')
            selected_audio = audio_sources(winner, route)
            if selected_audio:
                attrs.pop('src', None)
                attrs['controls'] = ''
                attrs['preload'] = 'metadata'
                node['children'] = [
                    {'tag': 'source', 'attributes': {'src': selected_audio['mp3'], 'type': 'audio/mpeg'}, 'children': []},
                    {'tag': 'source', 'attributes': {'src': selected_audio['opus'], 'type': 'audio/ogg; codecs="opus"'}, 'children': []}]
        node['void'] = node['tag'] in VOID
        if node['void'] and node.get('children'):
            issues.append({'routeId': route, 'disposition': 'dropped-children-of-void-element', 'tag': node['tag']})
            node['children'] = []
        node['children'] = [value for child in node.get('children', [])
                            if (value := transform(child, route, page_fields)) is not None]
        return node

    pages = {}
    css = ''
    for resource in media['resources']:
        if resource['kind'] == 'stylesheet' and resource['status'] == 'downloaded':
            css += '\n' + (ROOT / resource['targetFile']).read_text(encoding='utf-8')
    # The localized source CSS is immutable; only this derived CSS gains preview prefix.
    css = localize_css(css)
    target_css = ROOT / 'assets/css/site.css'
    plan_text(target_css, css)
    for route, source in corpus['pages'].items():
        if route in EXCLUDED:
            continue
        parts = route.strip('/').split('/')
        if parts[0] in collections and len(parts) > 2:
            raise ValueError('Unsupported deeper CMS route on ' + route)
        fields = next((f for f in collections.get(parts[0], {}).values()
                       if len(parts) == 2 and f.get('slug') == parts[1]), {})
        for field in ('seo', 'seo-title'):
            if field in fields and fields[field] is not None and not isinstance(fields[field], str):
                raise ValueError('Invalid CMS SEO title on ' + route)
        seo_title = next((fields[field] for field in ('seo', 'seo-title')
                          if field in fields and fields[field] is not None), source['title'])
        if not isinstance(seo_title, str) or not seo_title.strip():
            raise ValueError('Invalid CMS SEO title on ' + route)
        seo_title = seo_title.strip()
        page = {'routeId': route, 'title': seo_title, 'language': source['language'] or 'en',
                'family': source['family'], 'sourceHash': source['sourceArchiveSha256'],
                'body': transform(source['dom'], route, fields), 'metadata': [], 'icons': [],
                'structuredData': page_schema(source, route), 'testModel': models.get(route)}
        audio_winner = fields.get('audio-url') if 'audio-url' in fields else source['audio'].get('url')
        selected_audio = audio_sources(audio_winner, route)
        page['audioMp3'] = selected_audio['mp3'] if selected_audio else ''
        for meta in source['metadata']:
            if not isinstance(meta, dict) or any(not isinstance(key, str) or not re.fullmatch(r'[A-Za-z_:][A-Za-z0-9_.:-]*', key)
                    or key.lower().startswith(('on', 'data-wf-')) for key in meta):
                raise ValueError('Invalid metadata attributes on ' + route)
            if meta.get('name') == 'generator' or 'href' in meta or (preview and meta.get('name') == 'robots'):
                continue
            meta = copy.deepcopy(meta)
            name = meta.get('property') or meta.get('name')
            if name in {'og:title', 'twitter:title'} and fields:
                meta['content'] = seo_title
            if name in {'description', 'og:description', 'twitter:description'} and fields.get('meta-description'):
                meta['content'] = fields['meta-description']
            if name in {'og:image', 'twitter:image'} and fields.get('og-image'):
                image = fields['og-image']
                if not isinstance(image, dict) or not isinstance(image.get('url'), str):
                    raise ValueError('Invalid CMS social image URL on ' + route)
                meta['content'] = image['url']
            page['metadata'].append({k: (localize(attribute_value(v, k, route)) if k == 'content' and name in METADATA_URL_FIELDS
                                         else attribute_value(v, k, route)) for k, v in meta.items()})
        for link in source['headLinks']:
            relation = attribute_value(link.get('rel', []), 'rel', route)
            if 'icon' in relation:
                href = link.get('href', '')
                if not isinstance(href, str) or urlsplit(href).scheme.lower() not in {'', 'http', 'https'}:
                    raise ValueError('Invalid icon URL on ' + route)
                page['icons'].append({k: localize(attribute_value(v, k, route))
                                      for k, v in link.items() if k in {'rel', 'href', 'type', 'sizes'}})
        route_hash = hashlib.sha256(route.encode()).hexdigest()[:16]
        page['css'] = f'css/pages/{route_hash}.css'
        styles = source['inlineStyles']
        style_text = '\n'.join(s.get('code', s.get('css', '')) if isinstance(s, dict) else s for s in styles)
        for original in ordered:
            style_text = style_text.replace(original, replacements[original])
        style_text = localize_css(style_text)
        style_path = ROOT / 'assets' / page['css']
        plan_text(style_path, style_text or '/* No page styles. */')
        pages[route] = page
        content_path = ROOT / 'content' / ('_index.md' if route == '/' else route.strip('/') + '.md')
        if not content_path.resolve().is_relative_to((ROOT / 'content').resolve()):
            raise ValueError('Corpus content path escapes content directory on ' + route)
        front = {'title': seo_title, 'routeId': route, 'layout': 'source',
                 'url': '/' if route == '/' else route + '.html'}
        plan_json(content_path, front)
    for route, entry in owned.items():
        digest = owned_entry_hash(entry)
        if entry['mode'] == 'augment':
            page = pages[route]
        else:
            content_path = ROOT / 'content' / (route.lstrip('/') + '.md')
            if content_path.exists():
                existing = parse_json(content_path.read_text(encoding='utf-8'))
                if (not isinstance(existing, dict) or existing.get('managedBy') != 'prepare_hugo-owned'
                        or existing.get('routeId') != route or existing.get('layout') != 'source'):
                    raise ValueError('Refusing to replace manually authored owned content: ' + route)
            page = {'routeId': route, 'title': entry['title'], 'language': entry['language'],
                    'family': 'owned', 'origin': 'owned', 'sourceHash': digest,
                    'body': {'tag': 'body', 'attributes': {'class': 'intent-page'}, 'children': [], 'void': False},
                    'metadata': [], 'icons': copy.deepcopy(pages['/']['icons']), 'structuredData': [], 'testModel': None,
                    'audioMp3': '', 'css': 'css/intent-pages.css'}
            pages[route] = page
            plan_json(content_path, {'title': entry['title'], 'routeId': route, 'layout': 'source',
                                     'url': route + '.html', 'managedBy': 'prepare_hugo-owned'})
        page['ownedEntry'] = copy.deepcopy(entry)
        page['ownedHash'] = digest
    for page in pages.values():
        target = prepare_skip_target(page)
        if target is not None:
            page['skipTarget'] = target
    def remove_generated_content(path, route, owned=False):
        if not path.resolve().is_relative_to((ROOT / 'content').resolve()):
            raise ValueError('Former generated route escapes content directory')
        if not path.is_file():
            return
        try:
            front = parse_json(path.read_text(encoding='utf-8'))
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError('Refusing to remove manually changed content: ' + route) from error
        if not isinstance(front, dict) or front.get('layout') != 'source' or front.get('routeId') != route:
            raise ValueError('Refusing to remove manually changed content: ' + route)
        if owned and front.get('managedBy') != 'prepare_hugo-owned':
            raise ValueError('Refusing to remove manually changed owned content: ' + route)
        pending_deletions.add(path)
    # Only delete known generated pages, preserving author-owned content.
    for route in EXCLUDED:
        excluded_file = ROOT / 'content' / (route.strip('/') + '.md')
        remove_generated_content(excluded_file, route)
    previous_map = ROOT / 'data/route-map.json'
    if previous_map.exists():
        for old in read('data/route-map.json')['routes']:
            validate_route(old['path'])
            if old['path'] in pages or old['path'] == '/':
                continue
            former = (ROOT / 'content' / (old['path'].lstrip('/') + '.md')).resolve()
            remove_generated_content(former, old['path'], owned=old.get('origin') == 'owned')
    plan_json(ROOT / 'data/render.json', {'pages': pages, 'mountPrefix': prefix, 'preview': preview})
    transitions = sorted({link['href'] for path, page in corpus['pages'].items() if path not in EXCLUDED
                          for link in page['links'] if urlsplit(link['href']).netloc
                          and urlsplit(link['href']).hostname not in {'www.emtalk.org', 'emtalk.org'}})
    def semantic_urls(value):
        if isinstance(value, dict):
            return {url for child in value.values() for url in semantic_urls(child)}
        if isinstance(value, list):
            return {url for child in value for url in semantic_urls(child)}
        return {value} if isinstance(value, str) and urlsplit(value).scheme in {'http', 'https'} else set()
    reference_urls = sorted({url for path, page in corpus['pages'].items() if path not in EXCLUDED
                             for value in page['structuredData']
                             for url in semantic_urls(parse_json(value) if isinstance(value, str) else value)})
    plan_json(ROOT / 'data/route-map.json', {'routes': [dict({'path': p, 'file': 'index.html' if p == '/' else p.lstrip('/') + '.html'},
                **({'origin': 'owned'} if pages[p].get('origin') == 'owned' else {})) for p in pages],
               'excluded': sorted(EXCLUDED), 'externalTransitions': transitions, 'semanticReferenceUrls': reference_urls,
               'sitemap': [row for row in source_sitemap['routes'] if row['path'] in pages]
                          + [{'path': route, 'exactSuffix': route, 'origin': 'owned',
                              'sourceNoindex': not entry['indexable']}
                             for route, entry in owned.items() if entry['mode'] == 'new']})
    plan_json(ROOT / 'docs/audits/hugo-preparation.json', {'schemaVersion': 1, 'sourceCorpusSha256': hashlib.sha256((ROOT / 'data/source-content.json').read_bytes()).hexdigest(),
                'routeCount': len(pages), 'cmsCollections': len(collections), 'mountPrefix': prefix,
                'ownedRoutes': [route for route, entry in owned.items() if entry['mode'] == 'new'],
                'ownedAugmentations': [route for route, entry in owned.items() if entry['mode'] == 'augment'],
                'excludedOwnerRoutes': sorted(EXCLUDED), 'sourceDefectDispositions': issues, 'status': 'build-input-prepared-not-parity-verified'})
    # Every route, serialization and cleanup precondition is valid before the
    # first mutation. This does not claim a transaction for filesystem I/O errors.
    for path, value in pending_writes.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding='utf-8')
    for path in pending_deletions:
        path.unlink()
    return len(pages)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mount-prefix', default='')
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    print(json.dumps({'preparedRoutes': prepare(args.mount_prefix, args.preview)}))
