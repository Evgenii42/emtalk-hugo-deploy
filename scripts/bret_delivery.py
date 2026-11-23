"""Owned Bret shell HTML and fingerprinted entry delivery, not browser parity."""
import base64
import hashlib
import re
from pathlib import Path

from bs4 import BeautifulSoup


def bret_app_delivery_errors(build, route, prefix='', soup=None):
    """Check the two Bret shell routes and their exact compiled entry bytes.

    This validates HTML/resource delivery, not JavaScript grammar or browser
    support. The actual Hugo JSON-loader regression is tested independently.
    """
    build = Path(build).resolve()
    errors = []
    label = 'BRET app delivery (' + route + '): '
    if soup is None:
        page = build / (route.lstrip('/') + '.html')
        if not page.is_file():
            return [label + 'missing route artifact']
        soup = BeautifulSoup(page.read_bytes(), 'html.parser')
    # Current delivery declares no enforced CSP. Refuse a new meta policy
    # until its browser-parsed inline prepaint authorization is verified.
    # Source _headers is separately pinned byte-for-byte by verify_build;
    # provider-added response policies still require hosted verification.
    if any(str(node.get('http-equiv', '')).strip().lower() == 'content-security-policy'
           for node in soup.find_all('meta')):
        errors.append(label + 'enforced meta CSP needs explicit prepaint authorization verification')
    tabs = soup.select('.bret-tabs')
    if len(tabs) != 1 or tabs[0].name != 'nav':
        errors.append(label + 'requires exactly one Bret section navigation')
    if len(soup.select('[data-site-footer-boundary]')) != 1:
        errors.append(label + 'requires exactly one site footer boundary')
    modules = soup.select('[data-bret-games-module]')
    if len(modules) != 1:
        return errors + [label + 'requires exactly one marked game module']
    module = modules[0]
    if module.name != 'script' or module.get('type') != 'module':
        errors.append(label + 'marked game entry must be a module script')
    src = module.get('src', '')
    match = re.fullmatch(re.escape(prefix) + r'/js/bret-games\.([a-f0-9]{64})\.js', src) if isinstance(src, str) else None
    if not match:
        return errors + [label + 'game module must use its owned fingerprinted mount URL']
    target = build / src[len(prefix):].lstrip('/')
    if (not target.resolve().is_relative_to(build) or target.is_symlink()
            or not target.is_file() or target.stat().st_size == 0):
        return errors + [label + 'game bundle is missing, empty or linked outside its owned file']
    body = target.read_bytes()
    digest = hashlib.sha256(body).digest()
    if match[1] != digest.hex():
        errors.append(label + 'game bundle filename differs from its SHA-256 bytes')
    if module.get('integrity') != 'sha256-' + base64.b64encode(digest).decode('ascii'):
        errors.append(label + 'game bundle SRI differs from its SHA-256 bytes')
    return errors


