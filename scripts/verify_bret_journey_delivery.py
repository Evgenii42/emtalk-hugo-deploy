"""Verify source-derived public Journey bytes and actual Hugo entry contracts."""
import base64
import hashlib
from pathlib import Path
import re
from urllib.parse import urlsplit
from bs4 import BeautifulSoup
from bret_journey_delivery import ROUTES, generated_files


def verify(build, root, prefix=''):
    build, root = Path(build).resolve(), Path(root).resolve()
    errors = []
    try:
        public, _, _ = generated_files(root, prefix)
        base = build / 'bret/journey'
        expected = set(public) | {'index.html', 'characters.html'}
        actual = {p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()}
        if actual != expected:
            errors.append('Journey delivery public file set differs from source-derived allowlist')
        for rel, body in public.items():
            target = base / rel
            if not target.is_file() or target.read_bytes() != body:
                errors.append('Journey source-derived asset differs: ' + rel)
        for route, row in ROUTES.items():
            target = build / row['file']
            soup = BeautifulSoup(target.read_bytes(), 'html.parser')
            if not soup.html or soup.html.get('data-route-id') != route:
                errors.append('Journey document route identity differs: ' + route)
                continue
            if soup.html.get('data-audio-root') != prefix + '/bret/audio/' or soup.html.get('data-mount-prefix') != prefix:
                errors.append('Journey audio or deployment mount differs: ' + route)
            bridge = soup.html.get('data-site-bridge', '')
            pattern = re.escape(prefix) + r'/js/bret-journey-support\.[0-9a-f]{64}\.js'
            if not re.fullmatch(pattern, bridge):
                errors.append('Journey site bridge is not an owned fingerprint: ' + route)
                continue
            bridge_path = build / bridge[len(prefix):].lstrip('/')
            preload = soup.select('link[rel="modulepreload"]')
            if (not bridge_path.is_file() or len(preload) != 1 or preload[0].get('href') != bridge
                    or preload[0].get('integrity') != 'sha256-' + base64.b64encode(hashlib.sha256(bridge_path.read_bytes()).digest()).decode()):
                errors.append('Journey bridge preload integrity differs: ' + route)
            if '__BRET_' in target.read_text(encoding='utf-8') or '<!-- BRET_SITE_HEAD -->' in str(soup):
                errors.append('Journey deployment placeholder survived Hugo')
        for name in ['geologica-variable.woff2', 'manrope-variable.woff2']:
            source = root / 'static/fonts/home' / name
            target = build / 'fonts/home' / name
            if not target.is_file() or target.read_bytes() != source.read_bytes():
                errors.append('Journey owned font differs: ' + name)
        for source in (root / 'static/bret/audio').rglob('*'):
            if source.is_file():
                target = build / source.relative_to(root / 'static')
                if not target.is_file() or target.read_bytes() != source.read_bytes():
                    errors.append('Journey shared audio differs: ' + source.name)
        for path in base.rglob('*'):
            if path.is_file() and path.suffix in {'.mjs', '.js', '.css', '.html', '.json'}:
                body = path.read_text(encoding='utf-8')
                if re.search(r'\b[A-Za-z]:[\\/]|/Users/|file://|\.\./\.\./static/|\.\./\.\./assets/js/', body):
                    errors.append('Journey workspace/source-only dependency survived: ' + path.name)
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors.append('Journey delivery verification failed: ' + type(error).__name__)
    return errors
