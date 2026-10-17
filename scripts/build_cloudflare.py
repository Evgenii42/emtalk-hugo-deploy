"""Build a root-mounted, non-indexable Cloudflare Pages preview with Hugo."""
import os
import re
import sys
from urllib.parse import urlsplit

from build_site import build


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


def main():
    try:
        base = pages_base_url(os.environ.get('CF_PAGES_URL'))
    except ValueError as error:
        # These are our fixed origin-validation messages, never the raw URL.
        print(str(error), file=sys.stderr)
        return 1
    try:
        result = build('public', base, '', True)
        if result['passed'] is True:
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
