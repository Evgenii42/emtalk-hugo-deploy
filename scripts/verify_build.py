"""Check exact rendered routes and static output isolation, not functional parity."""
import argparse
import hashlib
import json
import re
import posixpath
from dataclasses import dataclass
from enum import Enum
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup
import tinycss2

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_HOSTS = ('website-files.com', 'webflow.com', 'webflow.io', 'fonts.googleapis.com', 'fonts.gstatic.com')
FORBIDDEN_DIRS = {'docs', 'inventory', 'scripts', '.git', '.review', '.agents', '.codex', 'node_modules', 'data', 'content'}
ALLOWED_EXT = {'.html', '.txt', '.xml', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.ttf', '.woff', '.woff2', '.opus', '.mp3', '.ogg', '.wav', '.mp4', '.avif', '.pdf'}


# Provider-consumed control file, not a public route or a general extensionless exception.
PAGES_ALIAS_HEADERS = (b'https://emtalk-hugo-deploy.pages.dev/*\n'
                       b'  X-Robots-Tag: noindex\n\n'
                       b'https://:version.emtalk-hugo-deploy.pages.dev/*\n'
                       b'  X-Robots-Tag: noindex\n')


class UrlContext(Enum):
    RESOURCE = 'resource'
    NAVIGATION = 'navigation'
    SEMANTIC_REFERENCE = 'semantic-reference'
    IMAGE = 'image'
    CSS_RESOURCE = 'css-resource'
    NAVIGATION_IMAGE = 'navigation-image'


@dataclass(frozen=True)
class UrlPolicy:
    external_allowlist: str | None = None
    resolves_routes: bool = False
    allows_contact: bool = False
    data_mimes: tuple = ()
    data_label: str = ''


IMAGE_DATA_MIME = re.compile(r'^data:image/(?:png|gif|jpeg|webp|avif|svg\+xml)[;,]', re.I)
FONT_DATA_MIME = re.compile(r'^data:(?:font/(?:woff2?|ttf|otf)|application/(?:x-font-(?:ttf|woff)|font-woff))[;,]', re.I)
URL_POLICIES = {
    UrlContext.RESOURCE: UrlPolicy(),
    UrlContext.NAVIGATION: UrlPolicy(external_allowlist='externalTransitions', resolves_routes=True, allows_contact=True),
    UrlContext.SEMANTIC_REFERENCE: UrlPolicy(external_allowlist='semanticReferenceUrls', resolves_routes=True),
    UrlContext.IMAGE: UrlPolicy(data_mimes=(IMAGE_DATA_MIME,), data_label='image'),
    UrlContext.CSS_RESOURCE: UrlPolicy(data_mimes=(IMAGE_DATA_MIME, FONT_DATA_MIME), data_label='CSS resource'),
    UrlContext.NAVIGATION_IMAGE: UrlPolicy(external_allowlist='externalTransitions', resolves_routes=True,
                                           allows_contact=True, data_mimes=(IMAGE_DATA_MIME,), data_label='image'),
}


def attribute_url_context(tag, attribute):
    """Keep existing consumer semantics explicit, including an anchor poster."""
    if attribute == 'poster':
        return UrlContext.NAVIGATION_IMAGE if tag == 'a' else UrlContext.IMAGE
    if tag in {'img', 'image'} and attribute in {'src', 'href', 'xlink:href'}:
        return UrlContext.IMAGE
    if tag == 'a' or attribute == 'data-articles-url':
        return UrlContext.NAVIGATION
    return UrlContext.RESOURCE


def css_urls(value):
    """Read CSS token grammar, including escaped at-keywords and function names."""
    pending = [tinycss2.parse_component_value_list(value, skip_comments=True)]
    while pending:
        tokens = pending.pop()
        for index, token in enumerate(tokens):
            if token.type == 'url':
                yield token.value
            elif token.type == 'at-keyword' and token.lower_value == 'import':
                first = next((item for item in tokens[index + 1:] if item.type != 'whitespace'), None)
                if first is not None and first.type == 'string':
                    yield first.value
            elif token.type == 'function':
                if token.lower_name == 'url':
                    arguments = [item for item in token.arguments if item.type != 'whitespace']
                    if len(arguments) == 1 and arguments[0].type == 'string':
                        yield arguments[0].value
                else:
                    if token.lower_name in ('image-set', '-webkit-image-set'):
                        # Direct option strings are URLs; type("image/png")
                        # and other nested strings are descriptors, not URLs.
                        for argument in token.arguments:
                            if argument.type == 'string':
                                yield argument.value
                    pending.append(token.arguments)
            elif hasattr(token, 'content'):
                pending.append(token.content)


def srcset_urls(value):
    """Read candidate URL tokens; commas within a data/ordinary URL are valid."""
    index = 0
    while index < len(value):
        while index < len(value) and (value[index].isspace() or value[index] == ','):
            index += 1
        start = index
        while index < len(value) and not value[index].isspace():
            index += 1
        url = value[start:index]
        if not url:
            break
        yield url.rstrip(',')
        if url.endswith(','):
            continue
        depth = 0
        while index < len(value):
            char = value[index]
            index += 1
            if char == '(':
                depth += 1
            elif char == ')':
                depth = max(0, depth - 1)
            elif char == ',' and not depth:
                break


def document_metadata_errors(body):
    """Owned HTML must declare UTF-8 early and one explicit mobile viewport."""
    soup = BeautifulSoup(body, 'html.parser')
    errors = []
    charsets = soup.find_all('meta', attrs={'charset': True})
    if len(charsets) != 1 or charsets[0].get('charset', '').lower() != 'utf-8' or not charsets[0].find_parent('head'):
        errors.append('Missing, duplicate or incorrect UTF-8 charset')
    try:
        text = body.decode('utf-8')
        line_starts = [0] + [match.end() for match in re.finditer('\n', text)]
        class CharsetParser(HTMLParser):
            endings = None
            def __init__(self):
                super().__init__()
                self.endings = []
            def handle_starttag(self, tag, attrs):
                if tag == 'meta' and any(key == 'charset' and (value or '').lower() == 'utf-8' for key, value in attrs):
                    line, column = self.getpos()
                    end = line_starts[line - 1] + column + len(self.get_starttag_text())
                    self.endings.append(len(text[:end].encode('utf-8')))
        parser = CharsetParser()
        parser.feed(text)
        charset_ends = parser.endings
    except UnicodeDecodeError:
        charset_ends = []
        errors.append('HTML bytes are not valid UTF-8')
    if len(charset_ends) != 1 or charset_ends[0] > 1024:
        errors.append('UTF-8 charset must be completely within the first 1024 bytes')
    viewports = soup.find_all('meta', attrs={'name': re.compile('^viewport$', re.I)})
    if len(viewports) != 1 or viewports[0].get('content') != 'width=device-width, initial-scale=1' or not viewports[0].find_parent('head'):
        errors.append('Missing, duplicate or incorrect mobile viewport')
    return errors


def bret_contract_errors(build, prefix=''):
    """Validate dynamic local audio URLs and PMR data absent from HTML src attrs.

    These named roles are the explicit web controller contract, not a native
    fidelity proof. Original audio hashes and instruction fidelity are separate.
    Keep expected roles and step count independent from the emitted JSON: using
    that same configuration as the expectation would accept its own omissions.
    A reconciled source/feature update must deliberately revise this contract.
    """
    build = Path(build)
    errors = []
    page = build / 'bret/practice.html'
    if not page.is_file():
        return ['Missing BRET practice artifact']
    soup = BeautifulSoup(page.read_bytes(), 'html.parser')
    roots = soup.select('[data-bret-practice]')
    if len(roots) != 1 or roots[0].get('data-audio-root') != prefix + '/bret/audio/':
        errors.append('BRET audio root must match the owned mount path')
    scripts = soup.select('script#bret-practice-data[type="application/json"]')
    try:
        if len(scripts) != 1:
            raise ValueError('Missing or duplicate configuration')
        steps = json.loads(scripts[0].string or '')['steps']
        if not isinstance(steps, dict) or set(steps) != {str(i) for i in range(1, 16)}:
            raise ValueError('Unexpected step IDs')
        if any(not isinstance(step, dict) or any(
            not isinstance(step.get(key), str) or not step[key].strip()
            for key in ('name', 'instruction')) for step in steps.values()):
            raise ValueError('Empty step content')
    except (ValueError, TypeError, KeyError):
        errors.append('BRET requires one valid configuration with 15 named PMR instructions')
    # 28 dual-format roles plus one single-format metronome role:57 files total.
    roles = (['inhale', 'delay_first', 'exhale', 'delay_second', 'start_exercise_explanation']
             + [f'muscle_relaxation_step_{i}' for i in range(1, 16)]
             + [f'sound_{pattern}' for pattern in ('4444', '478', '464', '343', '575')]
             + ['rain', 'sunrise', 'wind'])
    expected = {name + suffix for name in roles for suffix in ('.opus', '.mp3')}
    expected.add('metronom_click.wav')
    audio = build / 'bret/audio'
    actual = {path.name for path in audio.iterdir()} if audio.is_dir() else set()
    if actual != expected:
        errors.append('BRET requires exactly 29 audio roles and 57 owned audio files')
    for name in sorted(expected):
        path = audio / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
            errors.append('Missing, empty or linked BRET audio: ' + name)
    return errors


def verify_home_shared_styles(build, prefix=''):
    """Inspect delivered Home CSS, preserving inline production and bundled preview delivery."""
    build = Path(build).resolve()
    home = build / 'index.html'
    if not home.is_file():
        return ['Home shared styles: missing index.html']
    soup = BeautifulSoup(home.read_bytes(), 'html.parser')
    inline = soup.select('style[data-emt-home-styles]')
    links = []
    for node in soup.select('link[rel~="stylesheet"][href]'):
        url = urlsplit(node['href'])
        path = url.path
        if not url.scheme and not url.netloc and path.startswith(prefix + '/css/home-entry.') and path.endswith('.css'):
            links.append(path)
    if prefix:
        if inline or len(links) != 1:
            return ['Home shared styles: preview requires exactly one existing owned Home bundle']
        relative = links[0][len(prefix):].lstrip('/')
        asset = (build / relative).resolve()
        if not asset.is_relative_to(build) or not asset.is_file() or asset.is_symlink():
            return ['Home shared styles: missing or unsafe owned Home bundle']
        css = asset.read_text(encoding='utf-8')
    else:
        if len(inline) != 1 or links:
            return ['Home shared styles: production requires exactly one critical inline Home bundle']
        css = inline[0].get_text()
    # Check actual delivered rules, not a declaration that a source was requested.
    # These signatures belong to the two explicit shared sheets in home-styles.html.
    selectors, properties = [], set()
    pending = [tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True)]
    while pending:
        for rule in pending.pop():
            if rule.type == 'qualified-rule':
                prelude = tinycss2.serialize([token for token in rule.prelude if token.type != 'comment'])
                selectors.append(re.sub(r'\s+', '', prelude).replace('"', '').replace("'", '').lower())
                for declaration in tinycss2.parse_declaration_list(rule.content, skip_comments=True, skip_whitespace=True):
                    if declaration.type == 'declaration':
                        properties.add(declaration.lower_name)
            elif rule.type == 'at-rule' and rule.content is not None and rule.lower_at_keyword in {'media', 'supports', 'layer', 'container'}:
                pending.append(tinycss2.parse_rule_list(rule.content, skip_comments=True, skip_whitespace=True))
    compact = ','.join(selectors)
    signatures = {
        'interface': ('.emtalk-player-ui__play-icon', 'html[data-route-id=/].link-block-9'),
        'navigation': ('.site-header__brand', '.site-header__skip', '.site-header__panel'),
    }
    errors = ['Home shared styles: delivered ' + name + ' rules missing'
              for name, tokens in signatures.items() if not all(token in compact for token in tokens)]
    if '--emt-icon-play' not in properties:
        errors.append('Home shared styles: delivered interface icon declaration missing')
    return errors


def verify_dm_font_delivery(build, prefix=''):
    """Validate actual route-owned font delivery, including immutable native provenance."""
    expected = {
        'roboto_regular': (400, '4e147ab64b9fdf6d89d01f6b8c3ca0b3cddc59d608a8e2218f9a2504b5c98e14', 'eab3a43cb4c9bfe24c157a01fb91ae80fee90e64b5e08b01e8f0a4bace7f8558'),
        'roboto_medium': (500, '9d0d55a303bfd13b79a87721f65185e93f235e2d77fe398b2dca67ac519915f5', 'f150ce483e096530087b05528bcbe852a3f7d9253458f0165348182fdca8f2de'),
    }
    try:
        soup = BeautifulSoup((Path(build) / 'dm/workspace.html').read_bytes(), 'html.parser')
        links = [urlsplit(n['href']) for n in soup.select('link[rel~="stylesheet"][href]')]
        owned = [u.path for u in links if not u.scheme and not u.netloc and u.path.startswith(prefix + '/css/dm-workspace.') and u.path.endswith('.css')]
        if len(owned) != 1:
            raise ValueError('Missing or duplicate route-owned sheet')
        css_path = (Path(build) / owned[0][len(prefix):].lstrip('/')).resolve()
        if not css_path.is_relative_to(Path(build).resolve()) or css_path.is_symlink():
            raise ValueError('Unsafe stylesheet')
        faces = []
        for rule in tinycss2.parse_stylesheet(css_path.read_text(encoding='utf-8'), skip_comments=True, skip_whitespace=True):
            if rule.type == 'at-rule' and rule.lower_at_keyword == 'font-face':
                values = {d.lower_name: tinycss2.serialize(d.value).strip().replace('"', '').replace("'", '') for d in tinycss2.parse_declaration_list(rule.content) if d.type == 'declaration'}
                if values.get('font-family') == 'DMRoboto':
                    faces.append(values)
        if len(faces) != 2:
            raise ValueError('Expected exactly two DMRoboto faces')
        for name, (weight, original, compressed) in expected.items():
            matches = [f for f in faces if f.get('font-weight') == str(weight)]
            if len(matches) != 1 or matches[0].get('src') != 'url(../fonts/dm/' + name + '.woff2) format(woff2)' or matches[0].get('font-display') != 'swap' or matches[0].get('font-style') != 'normal':
                raise ValueError('Face format, weight or swap contract')
            for base, extension, digest in [(ROOT / 'static', '.ttf', original), (ROOT / 'static', '.woff2', compressed), (Path(build), '.woff2', compressed)]:
                file = base / 'fonts/dm' / (name + extension)
                if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                    raise ValueError('Font provenance or delivered bytes changed')
        return []
    except (OSError, ValueError, TypeError, KeyError):
        return ['DM font delivery: expected owned WOFF2 faces, native provenance and exact delivered bytes']


def verify_source_footer_surfaces(build, prefix=''):
    """Compare delivered measurement roles with independent prepared source footers."""
    try:
        registry = (ROOT / 'layouts/partials/analytics-source-classes.html').read_text(encoding='utf-8')
        registry = re.sub(r'\{\{-?\s*/\*[\s\S]*?\*/\s*-?\}\}', '', registry)
        match = re.fullmatch(r'\s*\{\{-?\s*\$primaryFooter\s*:=\s*"([A-Za-z_][A-Za-z0-9_-]*)"\s*-?\}\}\s*'
                             r'\{\{-?\s*return\s+\(dict\s+"primaryFooter"\s+\$primaryFooter\s+"measuredFooterClasses"\s+'
                             r'\(slice\s+\$primaryFooter\s+"([A-Za-z_][A-Za-z0-9_-]*)"\)\)\s*-?\}\}\s*', registry)
        if not match or match.group(1) == match.group(2):
            return ['Inherited footer contract: malformed central source-class registry']
        footer_classes = set(match.groups())
        render = json.loads((ROOT / 'data/render.json').read_text(encoding='utf-8'))
        route_rows = json.loads((ROOT / 'data/route-map.json').read_text(encoding='utf-8'))['routes']
        pages, source_prefix = render['pages'], render.get('mountPrefix', '').rstrip('/')
    except (OSError, ValueError, KeyError, TypeError):
        return ['Inherited footer contract: missing or malformed source/registry data']

    def source_nodes(node):
        if isinstance(node, dict):
            yield node
            for child in node.get('children', []):
                yield from source_nodes(child)

    def legal_family(paths):
        # Independent structural identity: published company/app legal pairs and
        # public navigation, rather than the class token being verified.
        if not {'/about-us', '/tests'} <= paths:
            return False
        return any({'/documents/' + product + '-privacy-policy',
                    '/documents/' + product + '-terms-and-conditions-of-use'} <= paths
                   for product in ('emtalk', 'bret', 'dm'))

    def local_path(href, mount):
        path = urlsplit(str(href)).path
        return path[len(mount):] if mount and path.startswith(mount + '/') else path

    errors, expected_footers = [], 0
    for row in route_rows:
        route, file = row['path'], Path(build) / row['file']
        page = pages.get(route)
        if not isinstance(page, dict):
            errors.append('Inherited footer contract: missing source route ' + route)
            continue
        footers = []
        for node in source_nodes(page.get('body')):
            if node.get('tag') != 'section':
                continue
            paths = {local_path(child.get('attributes', {}).get('href', ''), source_prefix)
                     for child in source_nodes(node) if child.get('tag') == 'a'}
            if legal_family(paths):
                footers.append(node)
        if len(footers) > 1:
            errors.append('Inherited footer contract: ambiguous source footer ' + route)
        expected_footers += len(footers)
        for footer in footers:
            if not footer_classes.intersection(str(footer.get('attributes', {}).get('class', '')).split()):
                errors.append('Inherited footer contract: source class differs from central registry ' + route)
        if not file.is_file():
            errors.append('Inherited footer contract: missing rendered route ' + route)
            continue
        soup = BeautifulSoup(file.read_bytes(), 'html.parser')
        actual = soup.select('[data-analytics-surface="footer"]')
        if len(actual) != len(footers):
            errors.append('Inherited footer contract: measured surface count differs from source ' + route)
        for footer in actual:
            paths = {local_path(node.get('href', ''), prefix) for node in footer.select('a[href]')}
            if footer.name != 'section' or not footer_classes.intersection(footer.get('class', [])) or not legal_family(paths):
                errors.append('Inherited footer contract: measured surface is not the source footer ' + route)
    if not expected_footers:
        errors.append('Inherited footer contract: no independent source footers found')
    return errors


def verify(build, prefix=''):
    build = Path(build).resolve()
    prefix = '/' + prefix.strip('/') if prefix.strip('/') else ''
    routes = json.loads((ROOT / 'data/route-map.json').read_text(encoding='utf-8'))
    expected = {r['path']: r['file'] for r in routes['routes']}
    errors, files = [], []
    seo_enabled = (ROOT / 'data/seo.json').is_file()
    if (ROOT / 'layouts/partials/analytics-source-classes.html').is_file():
        errors.extend(verify_source_footer_surfaces(build, prefix))
    if '/dm/workspace' in expected:
        errors.extend(verify_dm_font_delivery(build, prefix))
    if '/' in expected and (ROOT / 'layouts/partials/home-styles.html').is_file():
        errors.extend(verify_home_shared_styles(build, prefix))
    # This generic gate validates canonical scheme/path and local resources.
    # Configured production origin is enforced by the mandatory EmTalk SEO
    # layer below (and required by its Hugo partial). Non-SEO synthetic fixtures
    # intentionally exercise only the generic URI contract.
    canonical_origins = {}
    if seo_enabled:
        for relative in expected.values():
            target = build / relative
            if not target.is_file():
                continue
            page_soup = BeautifulSoup(target.read_bytes(), 'html.parser')
            candidates = page_soup.select('link[rel~="canonical"]')
            if len(candidates) == 1:
                origin = urlsplit(candidates[0].get('href', ''))
                if origin.scheme in {'http', 'https'} and origin.netloc and not origin.username and not origin.password:
                    canonical_origins[relative] = (origin.scheme, origin.netloc)
    if len(expected) != len(routes['routes']) or len(set(expected.values())) != len(expected):
        errors.append('Duplicate route path or output file in active route map')
    error_page = build / '404.html'
    if not error_page.is_file():
        errors.append('Missing required 404 error artifact')
    else:
        error_soup = BeautifulSoup(error_page.read_bytes(), 'html.parser')
        robots = error_soup.find('meta', attrs={'name': 'robots'})
        tokens = re.split(r'[\s,]+', robots.get('content', '').lower()) if robots else []
        if not error_soup.html or not error_soup.find('title') or 'noindex' not in tokens:
            errors.append('Invalid 404 error artifact: HTML, title and noindex are required')
        if error_soup.html and error_soup.html.get('data-route-id') in expected:
            errors.append('404 error artifact incorrectly identifies a published route')
    def check_css(css, source):
        for url in css_urls(css):
            check_url(url, source, UrlContext.CSS_RESOURCE)
    def check_url(url, source, context=UrlContext.RESOURCE):
        policy = URL_POLICIES[context]
        parsed = urlsplit(url)
        if parsed.scheme == 'data':
            if not policy.data_mimes:
                errors.append(f'Unapproved data URL context: {source}: {url}')
                return
            if not any(pattern.match(url) for pattern in policy.data_mimes):
                errors.append(f'Unapproved {policy.data_label} data URL: {source}: {url}')
                return
        if parsed.scheme and parsed.scheme not in {'http', 'https', 'data', 'mailto', 'tel'}:
            errors.append(f'Unsupported URL scheme: {source}: {url}')
            return
        if parsed.scheme in {'mailto', 'tel'} and not policy.allows_contact:
            # Contact schemes are navigation-only. The semanticReferenceUrls
            # allowlist permits HTTP(S) references, never mailto/tel resources.
            errors.append(f'Non-navigation contact URL: {source}: {url}')
            return
        if parsed.scheme in {'data', 'mailto', 'tel'} or not url or url.startswith('#'):
            return
        host = parsed.hostname or ''
        if any(host == h or host.endswith('.' + h) for h in FORBIDDEN_HOSTS):
            errors.append(f'Forbidden vendor dependency: {source}: {url}')
            return
        if parsed.netloc:
            # Same-origin semantic IDs resolve against existing local routes.
            # Only genuinely external references need the exact URL allowlist.
            if canonical_origins.get(source) == (parsed.scheme, parsed.netloc):
                parsed = parsed._replace(scheme='', netloc='')
            else:
                approved = routes.get(policy.external_allowlist, []) if policy.external_allowlist else ()
                if url not in approved:
                    errors.append(f'Unapproved external dependency: {source}: {url}')
                return
        try:
            if re.search(r'%(?![0-9A-Fa-f]{2})', parsed.path):
                raise ValueError('Malformed percent escape')
            # File existence uses the URI path. Query and fragment stay in the
            # emitted URL for browser/host semantics, never in a filesystem name.
            path = unquote(parsed.path, errors='strict')
        except (ValueError, UnicodeDecodeError):
            errors.append(f'Malformed URL encoding: {source}: {url}')
            return
        if not path:
            current = next((route for route, file in expected.items() if file == source), '/' + source) if policy.resolves_routes else '/' + source
            path = prefix + current
        elif not path.startswith('/'):
            relative_path = Path(source).parent / path
            if not (build / relative_path).resolve().is_relative_to(build):
                errors.append(f'Local dependency escapes build directory: {source}: {url}')
                return
            path = posixpath.normpath(prefix + '/' + relative_path.as_posix().lstrip('/'))
        if prefix:
            if not (path == prefix or path.startswith(prefix + '/')):
                errors.append(f'Missing explicit preview prefix: {source}: {url}')
                return
            path = path[len(prefix):] or '/'
        if policy.resolves_routes and path in expected:
            return
        candidate = build / path.lstrip('/')
        if path == '/':
            candidate = build / 'index.html'
        if not candidate.resolve().is_relative_to(build):
            errors.append(f'Local dependency escapes build directory: {source}: {url}')
            return
        if not candidate.is_file():
            errors.append(f'Missing local dependency: {source}: {url}')
    for path in sorted(build.rglob('*')):
        if not path.is_file():
            continue
        relative = path.relative_to(build).as_posix()
        if path.suffix.lower() == '.html' and relative not in {*expected.values(), '404.html'}:
            errors.append(f'Unmapped HTML output: {relative}')
        body = path.read_bytes()
        if relative == '_headers':
            if body != PAGES_ALIAS_HEADERS:
                errors.append('Invalid Pages alias header policy: _headers')
        elif any(part.casefold() in FORBIDDEN_DIRS for part in Path(relative).parts) or path.suffix.lower() not in ALLOWED_EXT:
            errors.append(f'Output allowlist violation: {relative}')
        if seo_enabled and path.suffix.lower() == '.html':
            errors.extend(relative + ': ' + error for error in document_metadata_errors(body))
        files.append({'path': relative, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
        if path.suffix.lower() in {'.html', '.svg'}:
            soup = BeautifulSoup(body, 'html.parser')
            for canonical in soup.select('link[rel~="canonical"]'):
                if relative == '404.html':
                    errors.append('404 error artifact must omit canonical')
                url = canonical.get('href', '')
                parsed = urlsplit(url)
                host = parsed.hostname or ''
                route = soup.html.get('data-route-id') if soup.html else None
                if (parsed.scheme not in {'http', 'https'} or not host or parsed.username or parsed.password
                        or parsed.query or parsed.fragment or any(host == h or host.endswith('.' + h) for h in FORBIDDEN_HOSTS)
                        or (route in expected and parsed.path != prefix + (route if route != '/' or seo_enabled else ''))):
                    errors.append(f'Invalid canonical origin/path contract: {relative}')
            for node in soup.find_all(True):
                if node.name in {'object', 'embed', 'applet', 'iframe'}:
                    errors.append(f'Unapproved embedded executable element: {relative}: {node.name}')
                if 'srcdoc' in node.attrs:
                    errors.append(f'Unapproved inline document attribute: {relative}: {node.name}.srcdoc')
                # Hyperlink auditing performs POSTs independently of navigation.
                # No local or external auditing endpoint belongs to this static site.
                if str(node.get('ping') or '').strip():
                    errors.append(f'Unapproved hyperlink auditing attribute: {relative}: {node.name}.ping')
                for attr in ('src', 'poster', 'href', 'xlink:href', 'action', 'formaction', 'data-audio-mp3', 'data-articles-url'):
                    # SEO canonical preserves the independent source origin contract.
                    if attr in node.attrs and not (node.name == 'link' and 'canonical' in node.get('rel', [])):
                        if not node[attr] and attr in {'src', 'poster'}:
                            errors.append(f'Empty resource URL: {relative}: {node.name}.{attr}')
                        check_url(node[attr], relative, attribute_url_context(node.name, attr))
                if node.get('srcset'):
                    for url in srcset_urls(node['srcset']):
                        check_url(url, relative, UrlContext.IMAGE)
                if node.get('style'):
                    check_css(node['style'], relative)
                if node.name == 'style':
                    check_css(node.get_text(), relative)
                if node.name == 'meta' and node.get('http-equiv', '').lower() == 'refresh':
                    errors.append(f'Unapproved meta refresh: {relative}')
            for model in soup.select('[tmplayer-meta="audio-url"]'):
                check_url(model.get_text(strip=True), relative)
            for meta in soup.find_all('meta'):
                if (meta.get('property') or meta.get('name')) in {'og:image', 'twitter:image', 'og:video', 'og:audio'}:
                    check_url(meta.get('content', ''), relative)
            for script in soup.find_all('script', src=True):
                if urlsplit(script['src']).netloc or urlsplit(script['src']).scheme:
                    errors.append(f'External executable script: {relative}: {script["src"]}')
            for script in soup.find_all('script', type='application/ld+json'):
                try:
                    value = json.loads(script.get_text())
                    if not isinstance(value, (dict, list)):
                        raise ValueError('JSON-LD must be an object or array')
                except (ValueError, json.JSONDecodeError, RecursionError):
                    errors.append(f'Invalid structured data: {relative}')
                    continue
                def check_structured(item, resource=False):
                    if isinstance(item, dict):
                        for key, child in item.items():
                            if key in {'description', 'headline', 'name', 'caption', 'text', 'articleBody', 'keywords',
                                       'alternativeHeadline', 'disambiguatingDescription', 'accessibilitySummary',
                                       'creditText', 'copyrightNotice'}:
                                continue
                            check_structured(child, resource or key in {'image', 'logo', 'screenshot', 'contentUrl', 'embedUrl', 'thumbnailUrl', 'thumbnail'})
                    elif isinstance(item, list):
                        for child in item:
                            check_structured(child, resource)
                    elif isinstance(item, str) and (item.startswith('/') or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:', item)):
                        check_url(item, relative, UrlContext.RESOURCE if resource else UrlContext.SEMANTIC_REFERENCE)
                try:
                    check_structured(value)
                except RecursionError:
                    errors.append(f'Invalid structured data: {relative}')
        if path.suffix.lower() == '.css':
            try:
                css = body.decode('utf-8')
            except UnicodeDecodeError:
                errors.append(f'Invalid stylesheet encoding: {relative}')
                continue
            check_css(css, relative)
    for route, file in expected.items():
        target = build / file
        if not target.is_file():
            errors.append(f'Missing route output: {route}')
            continue
        soup = BeautifulSoup(target.read_bytes(), 'html.parser')
        if not soup.html or soup.html.get('data-route-id') != route:
            errors.append(f'Route identity mismatch / false success: {route}')
    for excluded in routes['excluded']:
        if (build / (excluded.lstrip('/') + '.html')).exists():
            errors.append(f'Owner excluded route accidentally published: {excluded}')
    if '/bret/practice' in expected:
        errors.extend(bret_contract_errors(build, prefix))
    preview = None
    render_path = ROOT / 'data/render.json'
    if render_path.is_file():
        try:
            preview = json.loads(render_path.read_text(encoding='utf-8'))['preview']
            robots = (build / 'robots.txt').read_text(encoding='utf-8')
            disallow_all = bool(re.search(r'^Disallow:\s*/\s*$', robots, re.M))
            allow_all = bool(re.search(r'^Allow:\s*/\s*$', robots, re.M))
            robots_bad = (disallow_all or not allow_all) if seo_enabled else ((preview and (not disallow_all or allow_all)) or (not preview and (disallow_all or not allow_all)))
            if not isinstance(preview, bool) or robots_bad:
                errors.append('Robots preview/production contract mismatch')
        except (OSError, ValueError, KeyError):
            errors.append('Missing or invalid robots preview evidence')
    else:
        errors.append('Missing or invalid robots preview evidence')
    if 'sitemap' in routes:
        try:
            if preview is None:
                raise ValueError('Renderer mode unavailable for sitemap verification')
            sitemap = ET.parse(build / 'sitemap.xml')
            ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
            actual = [(urlsplit(row.findtext('s:loc', namespaces=ns)).path,
                       row.findtext('s:lastmod', default='', namespaces=ns))
                      for row in sitemap.findall('s:url', ns)]
            if seo_enabled:
                seo_config = json.loads((ROOT / 'data/seo.json').read_text(encoding='utf-8'))
                source = [] if preview else [(prefix + row['path'], '') for row in routes['routes'] if seo_config['pages'][row['path']]['indexable']]
            else:
                source = [(prefix + row['exactSuffix'], row.get('lastmod', '')) for row in routes['sitemap']]
            if actual != source:
                errors.append('Sitemap source path/order/lastmod contract mismatch')
        except (OSError, ET.ParseError, TypeError, ValueError, KeyError):
            errors.append('Missing or invalid sitemap')
    if seo_enabled:
        from verify_seo import verify as verify_seo
        try:
            seo_result = verify_seo(build, ROOT, prefix)
            errors.extend('SEO: ' + error for error in seo_result['errors'])
        except Exception:
            errors.append('SEO verification failed with malformed or missing configuration/output')
    snapshot = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'schemaVersion': 1, 'scope': 'Static route/dependency/output checks; no functional parity claim',
            'routeCount': len(expected), 'mountPrefix': prefix, 'outputSnapshotSha256': snapshot,
            'files': files, 'errors': errors, 'passed': not errors,
            'providerControlPaths': [row['path'] for row in files if row['path'] == '_headers'],
            'publicArtifactCount': sum(row['path'] != '_headers' for row in files),
            'limitations': ['Canonical origins are selected by the bounded builder and bound through exact output bytes; this verifier does not independently certify DNS ownership or the live host.']}


def cli(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--build', required=True)
    parser.add_argument('--mount-prefix', default='')
    parser.add_argument('--report')
    args = parser.parse_args(argv)
    try:
        result = verify(ROOT / args.build, args.mount_prefix)
    except Exception as error:
        result = {'scope': 'Static build CLI verification; no functional parity claim', 'passed': False,
                  'errors': ['Malformed or missing route configuration, sitemap or output (' + type(error).__name__ + ')']}
    destination = ROOT / (args.report or ('docs/audits/build-preview.json' if args.mount_prefix else 'docs/audits/build-root.json'))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'files'}, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(cli())
