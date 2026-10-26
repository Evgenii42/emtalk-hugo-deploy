"""Validate finite author-owned News front matter before prepare mutates anything."""
from datetime import date, datetime, timezone, timedelta
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


def rss_date(publication):
    """Use the authored date at midnight Moscow, without a changing build clock."""
    # News dates describe a publication calendar day, not an author's location or
    # a build instant. Midnight +0300 is the fixed feed policy shared with
    # layouts/source.newsrss.xml; change both owners together if that policy changes.
    weekday = ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')[publication.weekday()]
    month = (
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    )[publication.month - 1]
    return f'{weekday}, {publication.day:02d} {month} {publication.year:04d} 00:00:00 +0300'

def load_news(root, existing_routes, *, include_drafts=False):
    """Validate every authored record; publish only nondrafts by default."""
    if type(include_drafts) is not bool:
        raise ValueError('News draft inclusion must be boolean')
    root = Path(root)
    directory = root / 'content/news'
    index = root / 'content/news.md'

    def linked(path):
        return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()
    if linked(root / 'content') or linked(directory) or (not directory.is_dir()):
        raise ValueError('News directory must be an ordinary owned directory')
    children = list(directory.iterdir())
    if any(
        linked(path) or not path.is_file() or path.suffix != '.md'
        for path in children
    ):
        raise ValueError('News directory permits only ordinary top-level .md files; no subdirectories or other entries')
    paths = [index] + sorted(children)
    if any((linked(p) or not p.is_file() for p in paths)):
        raise ValueError('News content must be finite ordinary owned files')

    def unique(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Duplicate News field')
            result[key] = value
        return result
    entries = []
    seen = set()
    for path in paths:
        # Only the bounded public basename may enter an authoring diagnostic.
        name = path.name
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*[.]md', name):
            name = '[invalid News filename]'
        elif len(name) > 128:
            name = name[:125] + '...'
        try:
            record = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)
            base = {'title', 'routeId', 'layout', 'url', 'managedBy', 'summary', 'kind', 'draft'}
            fields = base if path == index else base | {
                'availability', 'date', 'bodyParagraphs', 'relatedRoute', 'ctaLabel',
            }
            if not isinstance(record, dict) or set(record) != fields:
                raise ValueError('Invalid News fields')
            for field in ['title', 'summary', 'routeId', 'layout', 'url', 'managedBy', 'kind']:
                if not isinstance(record[field], str) or not record[field].strip():
                    raise ValueError('Invalid News text')
            route = record['routeId']
            if path == index:
                if (
                    route != '/news'
                    or record['kind'] != 'index'
                    or record['draft'] is not False
                ):
                    raise ValueError('Invalid News index')
            else:
                if (
                    not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', path.stem)
                    or route != '/news/' + path.stem
                ):
                    raise ValueError('Invalid News slug')
                if (
                    record['kind'] not in {'project', 'product', 'reading'}
                    or record['availability'] not in {'project', 'available', 'in-development'}
                ):
                    raise ValueError('Invalid News classification')
                if (
                    not isinstance(record['date'], str)
                    or not re.fullmatch('\\d{4}-\\d{2}-\\d{2}', record['date'])
                ):
                    raise ValueError('Invalid News publication date')
                try:
                    publication_date = date.fromisoformat(record['date'])
                except ValueError:
                    raise ValueError('Invalid News publication date') from None
                if not record['draft'] and publication_date > datetime.now(timezone(timedelta(hours=3))).date():
                    raise ValueError('Published News date is in the future')
                if (
                    not isinstance(record['bodyParagraphs'], list)
                    or not record['bodyParagraphs']
                    or any(
                        not isinstance(paragraph, str) or not paragraph.strip()
                        for paragraph in record['bodyParagraphs']
                    )
                ):
                    raise ValueError('Invalid News body')
                if (
                    record['relatedRoute'] not in existing_routes
                    or not isinstance(record['ctaLabel'], str)
                    or not record['ctaLabel'].strip()
                ):
                    raise ValueError('Invalid News next step')
                if (
                    record['availability'] == 'in-development'
                    and 'in development' not in record['bodyParagraphs'][0].lower()
                ):
                    raise ValueError('Planned News needs visible qualification')
            if (
                type(record['draft']) is not bool
                or route in seen
                or record['layout'] != 'source'
                # This is an artifact-ownership marker for preparation/cleanup,
                # not a human byline or an assertion that there is only one editor.
                or record['managedBy'] != 'news033-author'
                or record['url'] != route + '.html'
            ):
                raise ValueError('Invalid News identity')
            seen.add(route)
            if include_drafts or not record['draft']:
                entries.append(record)
        except json.JSONDecodeError:
            raise ValueError('Invalid News JSON: ' + name) from None
        except UnicodeError:
            raise ValueError('Invalid News encoding: ' + name) from None
        except OSError:
            raise ValueError('Unreadable News record: ' + name) from None
        except (TypeError, RecursionError):
            raise ValueError('Invalid News record: ' + name) from None
        except ValueError as error:
            raise ValueError(str(error) + ': ' + name) from None
    return [entries[0]] + sorted(
        entries[1:], key=lambda row: (row['date'], row['routeId']), reverse=True,
    )

def owned_news(root, existing_routes):
    return {
        row['routeId']: {
            'mode': 'new',
            'language': 'en',
            'title': row['title'],
            'lead': row['summary'],
            'sections': [],
            'actions': [],
            'indexable': True,
        }
        for row in load_news(root, existing_routes)
    }

def validated_base_url(value, prefix=''):
    """Validate an explicit origin/mount, returning its slash-free News base."""
    prefix = '/' + prefix.strip('/') if prefix.strip('/') else ''
    if (not isinstance(value, str) or not value or any(c.isspace() or ord(c) < 32 for c in value)
            or any(c in value for c in ('\\', '?', '#'))):
        raise ValueError('Invalid explicit base URL')
    parsed = urlsplit(value)
    # Reading port also rejects malformed/non-numeric/out-of-range ports.
    parsed.port
    if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or parsed.path not in {prefix, prefix + '/'}):
        raise ValueError('Invalid explicit base URL')
    return value[:-1] if value.endswith('/') else value


def verify_news(build, root, prefix='', *, base_url=None):
    """Bind public News views/feed to their finite authored records."""
    import xml.etree.ElementTree as ET
    from bs4 import BeautifulSoup
    build, root = (Path(build), Path(root))
    errors = []
    render = json.loads((root / 'data/render.json').read_text(encoding='utf-8'))
    rows = load_news(root, set(render['pages']))
    registry = json.loads((root / 'data/interest-registry.json').read_text(encoding='utf-8'))
    expected = {row['routeId'] for row in rows}
    actual = {route for route in render['pages'] if route == '/news' or route.startswith('/news/')}
    if actual != expected:
        errors.append('News render routes differ from published authored entries')
    index = BeautifulSoup((build / 'news.html').read_bytes(), 'html.parser')
    home = BeautifulSoup((build / 'index.html').read_bytes(), 'html.parser')
    filter_labels = [('all', 'All'), ('project', 'Project'), ('product', 'Product'), ('reading', 'Articles')]
    filter_navs = index.select('[data-news-filters]')
    filter_links = filter_navs[0].select('a[data-news-filter]') if len(filter_navs) == 1 else []
    expected_filters = [(value, '#news-' + value, label, 'true' if value == 'all' else None)
                        for value, label in filter_labels]
    actual_filters = [(node.get('data-news-filter'), node.get('href'), node.get_text(' ', strip=True), node.get('aria-current'))
                      for node in filter_links]
    if actual_filters != expected_filters or len(index.select('[data-news-filter]')) != len(expected_filters):
        errors.append('News category links must expose All, Project, Product and Articles with native fragments')
    # Every exposed native category link remains usable even when its category
    # is empty. The template supplies an explicit empty-category target then.
    for kind in ('all', 'project', 'product', 'reading'):
        if len(index.find_all(id='news-' + kind)) != 1:
            errors.append('News category requires exactly one native fragment target: ' + kind)
    # Keep the existing native-link-focus contract for owned regions and the
    # additive footer News link. Do not rewrite legacy source anchors.
    for html in sorted(build.rglob('*.html')):
        page = BeautifulSoup(html.read_bytes(), 'html.parser')
        for skip in page.select('.site-header__skip[href^="#"]'):
            if len(page.find_all(id=skip['href'][1:])) != 1:
                errors.append('Native header skip link requires exactly one static target ' + html.relative_to(build).as_posix())
        links = page.select('.home-news a[href], .news-main a[href], .ecosystem-next a[href]')
        links += [
            link
            for footer in page.select('[data-analytics-surface=footer]')
            for link in footer.select('a[href]')
            if link.get('href') == prefix + '/news'
        ]
        if any((link.get('tabindex') != '0' for link in links)):
            errors.append(
                'Owned News/Home/ecosystem/footer links require native Tab tabindex=0 '
                + html.relative_to(build).as_posix()
            )
    canonical_nodes = home.select('link[rel~="canonical"]')
    canonical = canonical_nodes[0].get('href', '') if len(canonical_nodes) == 1 else ''
    try:
        rendered_base = validated_base_url(canonical, prefix)
    except (TypeError, ValueError):
        rendered_base = None
        errors.append('News verification requires one valid Home canonical base')
    expected_base = None
    if base_url is not None:
        try:
            expected_base = validated_base_url(base_url, prefix)
        except (TypeError, ValueError):
            errors.append('News expected base URL is invalid')
        if expected_base is not None and rendered_base is not None and rendered_base != expected_base:
            errors.append('News Home canonical differs from the explicit expected base URL')
    # An invalid explicit input never falls back to the HTML under test. With a
    # valid independent input, feed identity checks survive a broken canonical.
    canonical = expected_base if base_url is not None else rendered_base
    feed = None
    try:
        feed = ET.parse(build / 'news/index.xml').getroot()
        items = feed.findall('channel/item')
    except (OSError, ET.ParseError):
        errors.append('News RSS cannot be read or parsed')
        items = []
    channel = feed.find('channel') if feed is not None else None
    if channel is None:
        errors.append('News RSS requires a channel')
    else:
        self_link = channel.find('{http://www.w3.org/2005/Atom}link')
        if (
            self_link is None
            or self_link.get('rel') != 'self'
            or self_link.get('type') != 'application/rss+xml'
            or not self_link.get('href')
            or (canonical and self_link.get('href') != canonical + '/news/index.xml')
        ):
            errors.append('News RSS atom:self must identify the absolute mounted feed URL')
        if not channel.findtext('link') or (canonical and channel.findtext('link') != canonical + '/news'):
            errors.append('News RSS channel link must identify the absolute mounted News URL')
        if channel.findtext('ttl') != '60':
            errors.append('News RSS ttl must be 60 minutes')
        latest = rss_date(date.fromisoformat(rows[1]['date'])) if rows[1:] else None
        if channel.findtext('lastBuildDate') != latest:
            errors.append('News RSS lastBuildDate must match the latest published authored date')
    expected_order = [prefix + row['routeId'] for row in rows[1:]]
    item_links = [node.findtext('link') for node in items]
    item_paths = []
    for link in item_links:
        try:
            item_paths.append(urlsplit(link).path if isinstance(link, str) else None)
        except ValueError:
            item_paths.append(None)
    if (item_paths != expected_order
            or (canonical and item_links != [canonical + row['routeId'] for row in rows[1:]])):
        errors.append('News RSS entries/order differ from date-and-route ordering')
    if len(items) != len(rows) - 1:
        errors.append('News RSS published entry count mismatch')
    # Item position/metadata remain checkable even when neither a valid explicit
    # base nor rendered canonical is available; never invent an origin.
    for row, item in zip(rows[1:], items):
        route = row['routeId']
        if item.findtext('title') != row['title'] or (canonical and item.findtext('guid') != canonical + route):
            errors.append('News RSS identity mismatch ' + route)
        expected_date = rss_date(date.fromisoformat(row['date']))
        if item.findtext('pubDate') != expected_date:
            errors.append('News RSS pubDate must match the authored calendar date at00:00:00 +0300 ' + route)
        if item.findtext('category') != row['kind']:
            errors.append('News RSS category differs from the authored kind ' + route)
    index_title = index.select_one('h1')
    if (
        not index_title
        or index_title.get_text(strip=True) != rows[0]['title']
        or len(index.select('[data-news-card]')) != len(rows) - 1
    ):
        errors.append('News index required h1/copy/count mismatch')
    expected_count = f"{len(rows)-1} published update{'s' if len(rows)-1 != 1 else ''} shown."
    if not index.select_one('[data-news-count][role=status]') or index.select_one('[data-news-count]').get_text(strip=True) != expected_count:
        errors.append('News authored count must match the initial enhanced all-updates count')
    if [node.get('href') for node in index.select('[data-news-card] h2 a')] != expected_order:
        errors.append('News index entries/order differ from date-and-route ordering')
    if home.select('.news-latest'):
        errors.append('Home must not duplicate the first-screen News stack with a large News grid')
    hero_news = home.select('.home-explore .home-news')
    if rows[1:]:
        if len(home.select('.home-news')) != 1 or len(home.select('[data-home-news-preview]')) != 1:
            errors.append('Home requires exactly one latest News preview across the entire page')
        announcement = home.select('[data-home-news-status]')
        if (
            len(announcement) != 1
            or announcement[0].get('role') != 'status'
            or announcement[0].get('aria-live') != 'polite'
            or announcement[0].get('aria-atomic') != 'true'
            or announcement[0].get_text(strip=True)
            or announcement[0].find_parent(attrs={'data-home-news-panel': True})
        ):
            errors.append('Home automatic News retreat requires one empty polite status outside the collapsible panel')
        primary = home.select_one('.home-news__primary')
        if (
            len(hero_news) != 1
            or not primary
            or primary.get('href') != expected_order[0]
            or rows[1]['title'] not in primary.get_text(' ', strip=True)
        ):
            errors.append('Home first-screen latest News source projection mismatch')
        if [node.get('href') for node in home.select('.home-news__secondary')] != expected_order[1:3]:
            errors.append('Home first-screen secondary News order mismatch')
        if rows[1]['availability'] == 'in-development' and (
            not primary or 'In development' not in primary.get_text(' ', strip=True)
        ):
            errors.append('Home latest planned News needs visible development label')
    elif home.select('.home-news') or home.select('[data-home-news-preview]'):
        errors.append('Home first-screen News must be omitted without published stories')
    for position, row in enumerate(rows):
        route = row['routeId']
        path = build / (route.lstrip('/') + '.html')
        soup = BeautifulSoup(path.read_bytes(), 'html.parser')
        title = soup.select_one('h1')
        if not title or title.get_text(strip=True) != row['title']:
            errors.append('News required h1/title mismatch ' + route)
        if registry['pages'].get(route) != ['page', 'news']:
            errors.append('News intake registry mismatch ' + route)
        if len(soup.select('main')) != 1 or len(soup.select('[data-analytics-surface=footer]')) != 1:
            errors.append('News main/footer mismatch ' + route)
        if not soup.select_one('link[rel=alternate][type="application/rss+xml"][href="' + prefix + '/news/index.xml"]'):
            errors.append('News feed discovery missing ' + route)
        if row['kind'] == 'index':
            continue
        main = soup.select_one('main')
        if main is None:
            errors.append('News required main missing ' + route)
            continue
        text = main.get_text(' ', strip=True)
        bodies = main.select('.news-body')
        body = bodies[0] if len(bodies) == 1 else None
        paragraphs = body.find_all('p', recursive=False) if body is not None else []
        actual_paragraphs = [paragraph.get_text().strip() for paragraph in paragraphs]
        expected_paragraphs = [paragraph.strip() for paragraph in row['bodyParagraphs']]
        paragraph_structure = body is not None and all(
            getattr(child, 'name', None) == 'p' or not str(child).strip()
            for child in body.children
        )
        if not paragraph_structure or actual_paragraphs != expected_paragraphs:
            errors.append('News body differs from source ' + route)
        if not soup.select_one('.news-action[href="' + prefix + row['relatedRoute'] + '"]'):
            errors.append('News next step mismatch ' + route)
        item = items[position - 1] if 0 < position <= len(items) else None
        if row['availability'] == 'in-development' and (
            'In development' not in text
            or (item is not None and 'not a working service' not in item.findtext('description', ''))
        ):
            errors.append('News planned status missing ' + route)
    return errors
