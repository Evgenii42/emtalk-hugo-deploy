"""Build a root-mounted Pages preview or explicitly selected EmTalk production."""
import hashlib
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

from build_site import build
from verify_build import PAGES_ALIAS_HEADERS, PROVIDER_CONTROLS

PAGES_PROJECT_HOST = 'emtalk-hugo-deploy.pages.dev'


def pages_base_url(raw):
    """Accept the explicit Pages deployment origin; never fall back to production."""
    if not isinstance(raw, str) or not raw or len(raw) > 280:
        raise ValueError('CF_PAGES_URL must contain the Pages deployment origin')
    if not re.fullmatch(r'https://[a-z0-9.-]+/?', raw, flags=re.ASCII):
        raise ValueError('CF_PAGES_URL must be a plain lowercase HTTPS Pages origin')
    parsed = urlsplit(raw)
    host = parsed.hostname or ''
    labels = host.split('.')
    if (len(host) > 253 or len(labels) < 3 or labels[-2:] != ['pages', 'dev']
            or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label,
                                   flags=re.ASCII) for label in labels[:-2])):
        raise ValueError('CF_PAGES_URL must use a valid pages.dev deployment hostname')
    return 'https://' + host + '/'


def build_options(environment):
    """Default to preview; a supplied production request must match both guards."""
    deployment_base = pages_base_url(environment.get('CF_PAGES_URL'))
    if 'EMTALK_SITE_ORIGIN' not in environment:
        return deployment_base, True
    if environment['EMTALK_SITE_ORIGIN'] != 'https://www.emtalk.org/':
        raise ValueError('EMTALK_SITE_ORIGIN must be the exact approved production origin')
    if environment.get('CF_PAGES_BRANCH') != 'main':
        raise ValueError('Production origin requires the approved main branch')
    deployment_host = urlsplit(deployment_base).hostname
    if not (deployment_host == PAGES_PROJECT_HOST or
            (deployment_host.endswith('.' + PAGES_PROJECT_HOST) and
             deployment_host.count('.') == PAGES_PROJECT_HOST.count('.') + 1)):
        raise ValueError('Production deployment must use the approved Pages project alias')
    return 'https://www.emtalk.org/', False


def validate_alias_headers():
    """The header policy is a static build input, never an output patch."""
    for name, expected in PROVIDER_CONTROLS.items():
        try:
            body = (Path(__file__).resolve().parents[1] / 'static' / name).read_bytes()
        except OSError:
            raise ValueError('Required Pages provider policy is unavailable') from None
        if body != expected:
            raise ValueError('Required Pages provider policy is invalid')


def verified_pages_output(result):
    """Require the consumed policy in the builder's verified artifact inventory."""
    if not isinstance(result, dict) or result.get('passed') is not True:
        return False
    if result.get('providerControlPaths') != sorted(PROVIDER_CONTROLS):
        return False
    files = result.get('files')
    if not isinstance(files, list) or not all(isinstance(row, dict) for row in files):
        return False
    for name, expected in PROVIDER_CONTROLS.items():
        matches = [row for row in files if row.get('path') == name]
        if len(matches) != 1 or type(matches[0].get('bytes')) is not int or matches[0]['bytes'] != len(expected) or matches[0].get('sha256') != hashlib.sha256(expected).hexdigest():
            return False
    return (type(result.get('publicArtifactCount')) is int and
            result['publicArtifactCount'] == len(files) - len(PROVIDER_CONTROLS))


def main():
    try:
        base, preview = build_options(os.environ)
        validate_alias_headers()
    except ValueError as error:
        # These are fixed configuration-validation messages, never raw values.
        print(str(error), file=sys.stderr)
        return 1
    try:
        result = build('public', base, '', preview)
        if verified_pages_output(result):
            return 0
    except Exception:
        # At this CLI boundary, command failures and unexpected builder errors
        # must fail closed without exposing exception text, paths or output.
        pass
    print('Cloudflare Pages build failed. No verified output is available.',
          file=sys.stderr)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
