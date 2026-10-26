"""Validate the finite inherited roles shared by preparation and Hugo.

Class names come from owned data. Header suppression additionally requires an
exact route/path inventory; it cannot silently hide a new or moved source node.
Footer identity is checked independently by verify_build's legal/DOM contract.
"""
import json
from pathlib import Path
import re


CLASS = re.compile(r'[A-Za-z_][A-Za-z0-9_-]{0,79}')
ROUTE = re.compile(r'/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?')


def _require(condition, message):
    if not condition:
        raise ValueError('Source roles: ' + message)


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result, 'duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError('Source roles: nonfinite JSON value')


def _class(value):
    return isinstance(value, str) and CLASS.fullmatch(value) is not None


def _route(value):
    return isinstance(value, str) and len(value) <= 512 and ROUTE.fullmatch(value) is not None


def _validate_roles(roles):
    _require(isinstance(roles, dict) and set(roles) == {
        'schemaVersion', 'footer', 'legacyHeaderClass', 'legacyHeaders',
    }, 'unexpected configuration fields')
    _require(type(roles['schemaVersion']) is int and roles['schemaVersion'] == 1,
             'unsupported schema version')
    footer = roles['footer']
    _require(isinstance(footer, dict) and set(footer) == {
        'primaryFooter', 'measuredFooterClasses',
    }, 'unexpected footer fields')
    classes = footer['measuredFooterClasses']
    _require(_class(footer['primaryFooter']) and isinstance(classes, list)
             and 1 <= len(classes) <= 8 and all(_class(value) for value in classes),
             'invalid footer classes')
    _require(len(classes) == len(set(classes)) and classes[0] == footer['primaryFooter'],
             'duplicate classes or missing primary footer')
    legacy_class = roles['legacyHeaderClass']
    _require(_class(legacy_class) and legacy_class not in classes,
             'invalid legacy header class')
    headers = roles['legacyHeaders']
    _require(isinstance(headers, dict) and 1 <= len(headers) <= 128,
             'invalid legacy header routes')
    total = 0
    for route, paths in headers.items():
        _require(_route(route), 'invalid legacy header route')
        _require(isinstance(paths, list) and 1 <= len(paths) <= 8,
                 'invalid legacy header paths')
        normalized = []
        for path in paths:
            _require(isinstance(path, list) and 1 <= len(path) <= 16
                     and all(type(index) is int and 0 <= index <= 4095 for index in path),
                     'invalid legacy header index path')
            normalized.append(tuple(path))
        _require(len(normalized) == len(set(normalized)) and normalized == sorted(normalized),
                 'duplicate or unordered legacy header path')
        total += len(paths)
    _require(total <= 256, 'legacy header inventory exceeds bounds')
    return roles


def load_source_roles(root):
    """Read one ordinary bounded JSON owner; return validated roles or ValueError."""
    root = Path(root)
    path = root / 'data/source-roles.json'
    _require(path.resolve().is_relative_to(root.resolve()), 'configuration outside root')
    for part in (root, root / 'data', path):
        linked = (part.is_symlink() or getattr(part, 'is_junction', lambda: False)()
                  or (part.exists() and getattr(part.lstat(), 'st_file_attributes', 0) & 0x400))
        _require(not linked, 'linked configuration path')
    _require(path.is_file() and path.stat().st_nlink == 1, 'configuration must be an ordinary file')
    _require(path.stat().st_size <= 65536, 'configuration exceeds bounds')
    try:
        body = path.read_bytes()
        _require(len(body) <= 65536 and path.is_file() and path.stat().st_nlink == 1,
                 'configuration changed while reading')
        roles = json.loads(body.decode('utf-8'), object_pairs_hook=_unique_pairs,
                           parse_constant=_reject_constant)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('Source roles: unreadable configuration') from error
    return _validate_roles(roles)


def validate_source_header_replacements(pages, roles):
    """Fail before writes if any suppressed header differs in route/path/count.

    A path starts at body.children and records every subsequent children index.
    The inventory covers nested headers, including the actual depth2..5 sources.
    Unlisted routes may exist, but none may contain a suppressed legacy header.
    """
    _validate_roles(roles)
    _require(isinstance(pages, dict) and pages, 'invalid prepared pages')
    expected = roles['legacyHeaders']
    _require(set(expected) <= set(pages), 'legacy header route is missing')
    actual = {}

    def visit(node, path, found):
        if isinstance(node, str):
            return
        _require(isinstance(node, dict), 'invalid prepared source node')
        attributes = node.get('attributes', {})
        children = node.get('children', [])
        _require(isinstance(attributes, dict) and isinstance(children, list),
                 'invalid prepared source structure')
        classes = attributes.get('class', '')
        _require(isinstance(classes, str), 'invalid prepared source classes')
        if node.get('tag') == 'header' and roles['legacyHeaderClass'] in classes.split(' '):
            found.append(path)
        for index, child in enumerate(children):
            visit(child, path + [index], found)

    for route, page in pages.items():
        _require(_route(route) and isinstance(page, dict), 'invalid prepared route')
        body = page.get('body')
        _require(isinstance(body, dict) and isinstance(body.get('children'), list),
                 'missing prepared source body')
        found = []
        # body itself is not rendered by node.html; its children are.
        for index, child in enumerate(body['children']):
            visit(child, [index], found)
        if found:
            actual[route] = found
    _require(actual == expected, 'legacy header route/path/count differs')
