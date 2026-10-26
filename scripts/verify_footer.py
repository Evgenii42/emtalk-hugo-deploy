"""Independent inherited footer contracts and local social geometry checks."""
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

from bs4 import BeautifulSoup
from source_roles import load_source_roles

def footer_dom_signature(node):
    """Preserve full DOM meaning while ignoring attribute serialization order."""
    if isinstance(node, str):
        return (type(node).__name__, str(node))
    attributes = tuple((key, tuple(value) if isinstance(value, list) else value)
                       for key, value in sorted(node.attrs.items()))
    return (node.name, attributes, tuple(footer_dom_signature(child) for child in node.children))


def source_footer_projection(node, footer_classes, prefix, route):
    """Derive the approved fallback DOM from source, never rendered Home.

    This is an independent finite contract for node/attributes/route-state
    rendering. Renderer omissions must change the signature even when shared
    by Home and every fallback. Attributes and text are retained in full.

    Paired renderer contracts (keep independently implemented, update together):
    attributes.html owns string values, social48 defaults and surface injection;
    store-campaign-url.html owns the finite Play referrer suffix;
    footer-route-state.html owns stripped inherited/current destination flags;
    node.html owns tag/void/ordered-child rendering. Shared omissions must fail.
    """
    document = BeautifulSoup('', 'html.parser')
    social_sources = {prefix + '/media/' + name for name in (
        '114ba47600ed2c2e9628-6966c5e22ba6569feec112f9_Facebook.svg',
        '01c03a9b2a8db29cac67-6966c5e750a519b527bf07df_Instargam.svg',
        '71547b4f4510e7a3a764-6966c5ef7da1c4b4a8b2dc00_Telegram.svg',
    )}
    store_campaigns = {
        'https://play.google.com/store/apps/details?id=com.bret': 'bret',
        'https://play.google.com/store/apps/details?id=org.emtalk.dm': 'dm',
    }

    def project(source):
        if isinstance(source, str):
            return document.new_string(source)
        if not isinstance(source, dict):
            raise ValueError('Invalid footer source node')
        tag, attributes, children = source.get('tag'), source.get('attributes'), source.get('children')
        if (not isinstance(tag, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9:-]*', tag)
                or tag.lower().rsplit(':', 1)[-1] in {'script', 'style', 'iframe', 'object', 'embed', 'base', 'meta', 'title'}
                or not isinstance(attributes, dict) or not isinstance(children, list)
                or type(source.get('void')) is not bool
                or (source['void'] and children)):
            raise ValueError('Invalid footer source structure')
        if any(not isinstance(key, str) or not re.fullmatch(r'[A-Za-z_:][A-Za-z0-9_.:-]*', key)
               or not isinstance(value, str) for key, value in attributes.items()):
            raise ValueError('Invalid footer source attribute')
        attrs = dict(attributes)
        if tag == 'a':
            attrs.pop('aria-current', None)
            classes = [value for value in attrs.get('class', '').split() if value != 'w--current']
            if classes:
                attrs['class'] = ' '.join(classes)
            else:
                attrs.pop('class', None)
            if attrs.get('href') == prefix + route:
                attrs['aria-current'] = 'page'
        if attrs.get('src') in social_sources:
            attrs.setdefault('width', '48')
            attrs.setdefault('height', '48')
        if attrs.get('href') in store_campaigns:
            attrs['href'] += '&referrer=utm_source%3Demtalk_web%26utm_medium%3Dwebsite%26utm_campaign%3Dsite_v003_' + store_campaigns[attrs['href']]
        if not attrs.get('data-analytics-surface') and footer_classes.intersection(attrs.get('class', '').split()):
            attrs['data-analytics-surface'] = 'footer'
        result = document.new_tag(tag, attrs=attrs)
        for child in children:
            result.append(project(child))
        return result

    return project(node)


def verify_source_footer_surfaces(build, prefix='', *, root):
    """Compare delivered measurement roles with independent prepared source footers."""
    root = Path(root)
    try:
        roles = load_source_roles(root)
        footer_classes = set(roles['footer']['measuredFooterClasses'])
        render = json.loads((root / 'data/render.json').read_text(encoding='utf-8'))
        route_rows = json.loads((root / 'data/route-map.json').read_text(encoding='utf-8'))['routes']
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
        # These destination routes are part of the independent source contract.
        # Reconcile this check with the approved navigation and legal pairs if
        # those routes change; do not derive identity from the class under test.
        if not {'/about-us', '/tests'} <= paths:
            return False
        return any({'/documents/' + product + '-privacy-policy',
                    '/documents/' + product + '-terms-and-conditions-of-use'} <= paths
                   for product in ('emtalk', 'bret', 'dm'))

    def local_path(href, mount):
        path = urlsplit(str(href)).path
        return path[len(mount):] if mount and path.startswith(mount + '/') else path

    def independent_footers(page):
        footers = []
        # The renderer replaces top-level body sections. Inspect that same
        # depth, while identifying the footer independently by legal links.
        body = page.get('body')
        children = body.get('children', []) if isinstance(body, dict) else []
        for node in children:
            if not isinstance(node, dict) or node.get('tag') != 'section':
                continue
            paths = {local_path(child.get('attributes', {}).get('href', ''), source_prefix)
                     for child in source_nodes(node) if child.get('tag') == 'a'}
            # A legal-family block nested in an article does not make the
            # article's outer section a footer. Do not identify by the class
            # under test: renamed genuine top-level footers must still fail.
            nested_family = any(legal_family({
                local_path(child.get('attributes', {}).get('href', ''), source_prefix)
                for child in source_nodes(section) if child.get('tag') == 'a'})
                for section in source_nodes(node)
                if section is not node and section.get('tag') == 'section')
            if legal_family(paths) and not nested_family:
                footers.append(node)
        return footers

    errors, expected_footers = [], 0
    for row in route_rows:
        route, file = row['path'], Path(build) / row['file']
        page = pages.get(route)
        if not isinstance(page, dict):
            errors.append('Inherited footer contract: missing source route ' + route)
            continue
        footers = independent_footers(page)
        tapl_fallback = (route == '/tapl' or bool(page.get('newsEntry'))) and not footers
        if tapl_fallback:
            # The owned Tapl body has no footer. Its approved template fallback
            # renders the existing Home AST with destination-current semantics.
            home = pages.get('/')
            footers = independent_footers(home) if isinstance(home, dict) else []
            if len(footers) != 1:
                errors.append('Inherited footer contract: fallback requires one Home source footer for ' + route)
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
        if tapl_fallback:
            expected_footer = None
            if len(footers) == 1:
                try:
                    expected_footer = source_footer_projection(footers[0], footer_classes, prefix, route)
                except (ValueError, TypeError):
                    errors.append('Inherited footer contract: malformed independent Home footer source for ' + route)
            if (len(actual) != 1 or expected_footer is None
                    or footer_dom_signature(actual[0]) != footer_dom_signature(expected_footer)):
                errors.append('Inherited footer contract: fallback differs from route-aware Home footer for ' + route)
        for footer in actual:
            paths = {local_path(node.get('href', ''), prefix) for node in footer.select('a[href]')}
            if footer.name != 'section' or not footer_classes.intersection(footer.get('class', [])) or not legal_family(paths):
                errors.append('Inherited footer contract: measured surface is not the source footer ' + route)
            if route == '/tapl' or page.get('newsEntry'):
                if any(node.name != 'a' for node in footer.select('.w--current')):
                    errors.append('Inherited footer contract: current-page class on non-link for ' + route)
                if any(node.name != 'a' for node in footer.select('[aria-current]')):
                    errors.append('Inherited footer contract: current-page attribute on non-link for ' + route)
                for link in footer.select('a[href]'):
                    current = link.get('href') == prefix + route
                    if (link.get('aria-current') != ('page' if current else None)
                            or ('w--current' in link.get('class', []) and not current)):
                        errors.append('Inherited footer contract: wrong current-page state for ' + route)
    if not expected_footers:
        errors.append('Inherited footer contract: no independent source footers found')
    return errors


def verify_footer_social_geometry(build, prefix='', *, root):
    """Check logical social targets, independent of imported media filenames."""
    root = Path(root)
    targets = {'facebook': ('www.facebook.com', '/emtalkinc/'),
               'instagram': ('www.instagram.com', '/emtalk.inc/'),
               'telegram': ('t.me', '/EmTalk_inc')}
    errors, checked_assets = [], {}
    build = Path(build).resolve()
    try:
        rows = json.loads((root / 'data/route-map.json').read_text(encoding='utf-8'))['routes']
        for row in rows:
            soup = BeautifulSoup((build / row['file']).read_bytes(), 'html.parser')
            for footer in soup.select('[data-analytics-surface="footer"]'):
                for service, (host, path) in targets.items():
                    links = [link for link in footer.select('a[href]')
                             if (urlsplit(link.get('href', '')).scheme,
                                 urlsplit(link.get('href', '')).hostname,
                                 urlsplit(link.get('href', '')).path) == ('https', host, path)]
                    images = links[0].select('img') if len(links) == 1 else []
                    label = row['path'] + ' ' + service
                    if len(images) != 1 or (images[0].get('width'), images[0].get('height')) != ('48', '48'):
                        errors.append('Footer social geometry: expected one reserved48x48 image for ' + label)
                        continue
                    src = urlsplit(images[0].get('src', ''))
                    public_path = unquote(src.path)
                    if (src.scheme or src.netloc or src.query or src.fragment
                            or not public_path.startswith(prefix + '/media/')
                            or not public_path.endswith('.svg')):
                        errors.append('Footer social geometry: expected a local SVG for ' + label)
                        continue
                    asset = (build / public_path[len(prefix) + 1:]).resolve()
                    if not asset.is_relative_to(build) or not asset.is_file():
                        errors.append('Footer social geometry: missing local SVG for ' + label)
                        continue
                    if asset not in checked_assets:
                        try:
                            svg = ET.parse(asset).getroot()
                            checked_assets[asset] = (svg.tag.rsplit('}', 1)[-1] == 'svg'
                                and float(svg.get('width', 'nan')) == 48
                                and float(svg.get('height', 'nan')) == 48
                                and [float(x) for x in svg.get('viewBox', '').split()] == [0, 0, 48, 48])
                        except (OSError, ValueError, ET.ParseError):
                            checked_assets[asset] = False
                    if not checked_assets[asset]:
                        errors.append('Footer social geometry: intrinsic SVG metadata differs for ' + label)
    except (OSError, ValueError, KeyError, TypeError):
        errors.append('Footer social geometry: malformed route/output contract')
    return errors

