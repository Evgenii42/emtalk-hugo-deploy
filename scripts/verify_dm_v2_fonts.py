"""Local Sites DM v2 font delivery, separate from the inherited DMRoboto gate."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
import tinycss2

ROOT = Path(__file__).resolve().parents[1]
# Immutable source Sites v2 provenance, not values learned from candidate files.
FONT_FILES = {
    'geologica-variable.woff2': 'be83b404bc028dc3fdc7e5efba12bc4685b84de660aa040ecbd0ca5725a1e4fe',
    'manrope-variable.woff2': '2d65cb231c2dd56cb8de01c856f56a72c5fefeeb86bdf71f81b6d09bda531b3f',
    'Geologica-OFL.txt': 'ba761950dfd6ab9e9c4ef81cf338daae56963f8493845717eb69aff11e913972',
    'Manrope-OFL.txt': 'e178bfe7c691e41a2a106ce56f285f079355593dc78e918d30b39cf0714c70d3',
}
FACES = {
    'Geologica': ('100 900', 'geologica-variable.woff2'),
    'Manrope': ('200 800', 'manrope-variable.woff2'),
}


def _read(base, relative):
    base = Path(base).absolute()
    path = base / relative
    if not path.resolve().is_relative_to(base.resolve()):
        raise ValueError('Outside font input')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Linked font input')
        if part == base:
            break
    return path.read_bytes()


def _unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('Duplicate provenance key')
        value[key] = item
    return value


def verify_dm_v2_font_delivery(build, prefix='', root=None):
    """Return errors for route CSS, face contracts, or source/delivery hash drift.

    No network requests are made. root permits isolated copied-byte fixtures;
    expected provenance remains pinned above even if a candidate edits its JSON.
    """
    root = Path(root) if root is not None else ROOT
    try:
        if not isinstance(prefix, str) or not re.fullmatch(r'(?:/[A-Za-z0-9_-]+)*', prefix):
            raise ValueError('Noncanonical mount prefix')
        provenance = json.loads(_read(root, 'data/dm-v2-font-provenance.json'), object_pairs_hook=_unique)
        if provenance.get('fontFiles') != FONT_FILES:
            raise ValueError('Immutable font provenance changed')
        soup = BeautifulSoup(_read(build, 'dm/workspace.html'), 'html.parser')
        if len(soup.select('.dm-v2')) != 1:
            raise ValueError('Expected DM v2 route')
        sheets = [urlsplit(node['href']) for node in soup.select('link[rel~="stylesheet"][href]')]
        candidates = [url for url in sheets if url.path.rsplit('/', 1)[-1].startswith('dm-v2.')]
        if len(candidates) != 1:
            raise ValueError('Missing or duplicate DM v2 sheet')
        sheet = candidates[0]
        if (sheet.scheme or sheet.netloc or sheet.query or sheet.fragment
                or not re.fullmatch(re.escape(prefix) + r'/css/dm-v2\.[A-Za-z0-9_-]+\.css', sheet.path)):
            raise ValueError('Expected local prefix-owned DM v2 sheet')
        css = _read(build, sheet.path[len(prefix):].lstrip('/')).decode('utf-8')
        faces = {}
        for rule in tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True):
            if rule.type != 'at-rule' or rule.lower_at_keyword != 'font-face':
                continue
            if rule.content is None:
                raise ValueError('Empty face')
            declarations = tinycss2.parse_declaration_list(rule.content, skip_comments=True, skip_whitespace=True)
            values = {}
            for declaration in declarations:
                if declaration.type != 'declaration' or declaration.lower_name in values or declaration.important:
                    raise ValueError('Invalid or duplicate face declaration')
                values[declaration.lower_name] = tinycss2.serialize(declaration.value).strip().replace('"', '').replace("'", '')
            family = values.get('font-family')
            if family not in FACES or family in faces:
                raise ValueError('Unexpected or duplicate face')
            faces[family] = values
        if set(faces) != set(FACES):
            raise ValueError('Missing font face')
        for family, (weight, filename) in FACES.items():
            face = faces[family]
            if (face.get('font-weight') != weight or face.get('font-display') != 'swap'
                    or face.get('font-style', 'normal') != 'normal'
                    or face.get('src') != 'url(../dm-v2/assets/' + filename + ') format(woff2)'):
                raise ValueError('Font source, weight or swap contract')
            for base, relative in ((root, 'static/dm-v2/assets/' + filename), (build, 'dm-v2/assets/' + filename)):
                if hashlib.sha256(_read(base, relative)).hexdigest() != FONT_FILES[filename]:
                    raise ValueError('Source or delivered font bytes changed')
        return []
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return ['DM v2 font delivery: expected owned local Geologica/Manrope WOFF2 faces, immutable provenance and exact source/delivered bytes']
