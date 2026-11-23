"""Single-source local Journey delivery for two explicit Hugo app routes."""
from pathlib import Path
import hashlib
import json
import re
from urllib.parse import unquote
import xml.etree.ElementTree as ET

ROUTES = {
    '/bret/journey': {'publicPath': '/bret/journey/', 'file': 'bret/journey/index.html', 'source': 'index.html'},
    '/bret/journey/characters': {'publicPath': '/bret/journey/characters', 'file': 'bret/journey/characters.html', 'source': 'characters.html'},
}
SOURCE = 'experiments/breathing-journey'
PUBLIC_STAGE = 'tmp/bret-journey-public'
HTML_STAGE = 'tmp/bret-journey-html'
RUNTIME_FILES = ('app.mjs', 'characters.mjs', 'index.html', 'characters.html',
    'load-local.mjs', 'model.mjs', 'runner-character.mjs', 'runner-pose.mjs',
    'site-preferences.mjs', 'scene.mjs', 'style.css')
POSTER_FILES = tuple(f'poster-{i}{suffix}.svg' for i in range(5)
    for suffix in ('', '-sport', '-soft', '-silhouette')) + tuple(
    f'model-preview-{style}.svg' for style in ('sport', 'soft', 'silhouette'))


def route_file(route):
    return ROUTES[route]['file'] if route in ROUTES else 'index.html' if route == '/' else route.lstrip('/') + '.html'


def public_path(route):
    return ROUTES.get(route, {}).get('publicPath', route)


def route_layout(route):
    return 'bret-journey' if route in ROUTES else 'source'


def owned_metadata(route):
    return [{'name': 'color-scheme', 'content': 'light'}] if route == '/bret/journey' else []


def checked(root, rel, *, exists=True):
    root = Path(root).resolve()
    if not isinstance(rel, str) or not rel or '\\' in rel or ':' in rel or any(p in {'', '.', '..'} for p in rel.split('/')):
        raise ValueError('Noncanonical Journey delivery path')
    current = root
    for part in rel.split('/'):
        current /= part
        if current.is_symlink() or getattr(current, 'is_junction', lambda: False)():
            raise ValueError('Linked Journey delivery input/output')
        if not current.resolve().is_relative_to(root):
            raise ValueError('Journey delivery path escapes project')
    if exists and not current.is_file():
        raise ValueError('Missing Journey delivery input: ' + rel)
    return current


def source_paths(root):
    root = Path(root)
    base = checked(root, SOURCE + '/index.html').parent
    result = [SOURCE + '/' + name for name in RUNTIME_FILES]
    animations = [SOURCE + '/animations/' + name for name in ['lungs.json',
        *[f'scene-{i}-{kind}.json' for i in range(5) for kind in ('background', 'road')],
        *[f'runner-model-{style}.json' for style in ('sport', 'soft', 'silhouette')]]]
    result += animations
    art = set(POSTER_FILES)
    def add_art(name):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+\.svg', name):
            raise ValueError('Journey image dependency must be a contained SVG filename')
        art.add(name)
    def assets(value):
        if isinstance(value, dict):
            if isinstance(value.get('p'), str) and value['p'].endswith('.svg'):
                add_art(value['p'])
            for child in value.values():
                assets(child)
        elif isinstance(value, list):
            for child in value:
                assets(child)
    for rel in animations:
        assets(json.loads(checked(root, rel).read_bytes()))
    pending, parsed = list(art), set()
    while pending:
        name = pending.pop()
        if name in parsed:
            continue
        parsed.add(name)
        svg = ET.fromstring(checked(root, SOURCE + '/art/' + name).read_bytes())
        for node in svg.iter():
            if node.tag.rsplit('}', 1)[-1] not in {'image', 'use'}:
                continue
            ref = node.get('href') or node.get('{http://www.w3.org/1999/xlink}href') or ''
            if not ref or ref.startswith(('#', 'data:')):
                continue
            add_art(ref)
            if ref not in parsed:
                pending.append(ref)
    result += [SOURCE + '/art/' + name for name in sorted(art)]
    result += [SOURCE + '/vendor/lottie-5.13.0.min.js', SOURCE + '/vendor/LOTTIE-LICENSE.md',
        'assets/js/bret-engine.js']
    for rel in result:
        checked(root, rel)
    return sorted(set(result))


def generated_files(root, prefix=''):
    root = Path(root)
    if not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*', prefix):
        raise ValueError('Explicit simple Journey mount prefix required')
    public, html, provenance = {}, {}, {}
    for rel in source_paths(root):
        body = checked(root, rel).read_bytes()
        target = rel.removeprefix(SOURCE + '/')
        if rel == 'assets/js/bret-engine.js':
            target = 'engine/bret-engine.js'
        if target == 'vendor/LOTTIE-LICENSE.md':
            target = 'vendor/LOTTIE-LICENSE.txt'
        if Path(target).suffix in {'.mjs', '.js', '.css', '.html'} and not target.startswith('vendor/'):
            text = body.decode('utf-8')
            text = text.replace('href="./characters.html"', 'href="./characters"')
            text = text.replace('../../assets/js/bret-engine.js', './engine/bret-engine.js')
            text = text.replace('../../static/fonts/', '../../fonts/')
            text = text.replace('../../static/bret/audio/', '../../bret/audio/')
            body = text.encode('utf-8')
        if target in {'index.html', 'characters.html'}:
            route = next(route for route, row in ROUTES.items() if row['source'] == target)
            text = body.decode('utf-8')
            text, count = re.subn(r'<title>[^<]*</title>', '', text, count=1)
            if count != 1:
                raise ValueError('Journey HTML requires one title')
            text, count = re.subn(r'<meta\b[^>]*\bname=["\']robots["\'][^>]*>', '', text, count=1)
            if count != 1:
                raise ValueError('Journey HTML requires one robots declaration')
            text, count = re.subn(r'<html\b([^>]*)>', lambda m: '<html' + m[1] +
                f' data-route-id="{route}" data-mount-prefix="{prefix}" data-audio-root="{prefix}/bret/audio/" data-site-bridge="__BRET_SITE_BRIDGE__">', text, count=1)
            if count != 1 or text.count('<head>') != 1:
                raise ValueError('Unexpected Journey document structure')
            text, count = re.subn(r'<meta\b[^>]*\bcharset=["\']utf-8["\'][^>]*>', '', text, count=1, flags=re.I)
            if count != 1:
                raise ValueError('Journey requires an explicit UTF-8 charset')
            viewport = re.search(r'<meta\b(?=[^>]*\bname=["\']viewport["\'])[^>]*\bcontent=["\']([^"\']+)["\'][^>]*>', text)
            if not viewport:
                raise ValueError('Journey requires an explicit viewport')
            value = ', '.join(part.strip() for part in viewport[1].split(','))
            if value not in {'width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover'}:
                raise ValueError('Journey viewport contract changed')
            text = text[:viewport.start()] + text[viewport.end():]
            text = text.replace('<head>', '<head>\n<meta charset="utf-8">\n<meta name="viewport" content="' + value + '">\n<!-- BRET_SITE_HEAD -->', 1)
            if owned_metadata(route):
                text, count = re.subn(r'<meta\b(?=[^>]*\bname=["\']color-scheme["\'])(?=[^>]*\bcontent=["\']light["\'])[^>]*>', '', text, count=1)
                if count != 1:
                    raise ValueError('Journey light color-scheme metadata changed')
            # The generic site resource policy expects an owned icon file.
            def icon(match):
                value = unquote(match[1])
                if not value.startswith('<svg ') or not value.endswith('</svg>') or len(value) > 10000:
                    raise ValueError('Unexpected Journey inline SVG icon')
                public['favicon.svg'] = value.encode('utf-8')
                return 'href="./favicon.svg"'
            text = re.sub(r'href="data:image/svg\+xml,([^"\n]+)"', icon, text)
            html[target] = text.encode('utf-8')
        else:
            public[target] = body
        provenance[rel] = hashlib.sha256(checked(root, rel).read_bytes()).hexdigest()
    return public, html, provenance


def prepare_delivery(root, prefix=''):
    root = Path(root).resolve()
    public, html, inputs = generated_files(root, prefix)
    for folder, files in ((PUBLIC_STAGE, public), (HTML_STAGE, html)):
        target = checked(root, folder, exists=False)
        if not target.resolve().is_relative_to(root / 'tmp'):
            raise ValueError('Journey stage must be under project tmp')
        target.mkdir(parents=True, exist_ok=True)
        # Only remove files in this dedicated generated directory after every
        # lexical/resolved path and link has been checked. No source is moved.
        stale = []
        for item in target.rglob('*'):
            rel = item.relative_to(root).as_posix()
            if item.is_symlink() or getattr(item, 'is_junction', lambda: False)():
                raise ValueError('Linked Journey stage')
            if item.is_file():
                checked(root, rel)
                if item.relative_to(target).as_posix() not in files:
                    stale.append(item)
        for rel, body in files.items():
            out = checked(root, folder + '/' + rel, exists=False)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(body)
        for item in stale:
            item.unlink()
    record = {'source': SOURCE, 'mountPrefix': prefix, 'inputSha256': inputs,
        'publicFiles': {p: hashlib.sha256(b).hexdigest() for p, b in sorted(public.items())},
        'htmlFiles': {p: hashlib.sha256(b).hexdigest() for p, b in sorted(html.items())},
        'scope': 'Generated deployment copy; canonical experiment and shared engine stay authoritative.'}
    checked(root, 'tmp/bret-journey-delivery.json', exists=False).write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record
