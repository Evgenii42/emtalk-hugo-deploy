"""Build a bounded Hugo output and bind exact source/output snapshots."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

import prepare_hugo
from verify_build import verify

ROOT = Path(__file__).resolve().parents[1]
PIN = '0.168.0'


def pinned_stable_version(version):
    # Stable Hugo reports may append the release's 40-digit commit identifier.
    # Named prereleases such as -dev/-rc are not the pinned stable release.
    return bool(re.search(r'\bv' + re.escape(PIN) + r'(?:-[0-9a-f]{40})?(?:\+(?:extended|withdeploy))*(?:\s|$)', str(version)))


def is_link(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def reject_tree_links(directory):
    if is_link(directory) or any(is_link(path) for path in directory.rglob('*')):
        raise ValueError('Symlink/junction in build or artifact tree')


def build_directory(value, root=None):
    """One policy for build, static publication and release validation."""
    root = (root or ROOT).resolve()
    if not isinstance(value, (str, Path)) or not str(value):
        raise ValueError('Build directory must be a nonempty path')
    raw = root / value
    # Check lexical parents as well as the resolved target before Hugo cleaning.
    for parent in [raw, *raw.parents]:
        if parent == root:
            break
        if is_link(parent):
            raise ValueError('Linked build destination is forbidden')
    destination = raw.resolve()
    if destination != root / 'public' and not destination.is_relative_to(root / 'tmp'):
        raise ValueError('Build output must be public or a dedicated directory inside tmp')
    if destination == root / 'tmp' or destination.is_relative_to(root / 'tmp/deploy'):
        raise ValueError('Build output must not overlap tmp/deploy or the tmp root')
    relative = destination.relative_to(root)
    if any(part.lower() == '.git' for part in relative.parts):
        raise ValueError('Build output must not overlap Git metadata')
    for parent in [destination, *destination.parents]:
        if parent == root:
            break
        if (parent / '.git').exists():
            raise ValueError('Build output must not overlap a Git checkout')
    if destination.exists():
        if not destination.is_dir():
            raise ValueError('Build destination must be a directory')
        reject_tree_links(destination)
        if any(path.name.lower() == '.git' for path in destination.rglob('*')):
            raise ValueError('Build destination contains a Git checkout')
    return destination


def cli(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--destination', default='public')
    parser.add_argument('--base-url', default='https://www.emtalk.org/')
    parser.add_argument('--mount-prefix', default='')
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args(argv)
    try:
        return 0 if build(args.destination, args.base_url, args.mount_prefix, args.preview)['passed'] else 1
    except Exception as error:
        # No command stdout/stderr or environment values are included in reports.
        print(json.dumps({'passed': False, 'errors': [type(error).__name__ + ': ' +
            ('External command failed' if isinstance(error, subprocess.CalledProcessError) else str(error))]}))
        return 1


def digest(value):
    return hashlib.sha256(value).hexdigest()


def snapshot_sources(root=None):
    root = (root or ROOT).resolve()
    sources = []
    for directory in ['assets', 'layouts', 'content', 'data', 'static']:
        reject_tree_links(root / directory)
        sources.extend(path for path in (root / directory).rglob('*') if path.is_file())
    sources += [root / name for name in ['hugo.toml', '.hugo-version', 'requirements-build.txt',
                'inventory/media.json', 'scripts/prepare_hugo.py', 'scripts/prepare_public_content.py', 'scripts/build_site.py', 'scripts/verify_build.py']]
    if (root / 'data/seo.json').is_file():
        sources.append(root / 'scripts/verify_seo.py')
    if any(is_link(part) for path in sources for part in [path, *path.parents]
           if part != root and part.is_relative_to(root)):
        raise ValueError('Linked source input is forbidden')
    return [{'path': path.relative_to(root).as_posix(), 'bytes': path.stat().st_size,
             'sha256': digest(path.read_bytes())} for path in sorted(set(sources))]


def build(destination, base_url, prefix='', preview=False):
    destination = build_directory(destination)
    base = urlsplit(base_url)
    if base.scheme not in {'http', 'https'} or not base.hostname or base.username or base.password or base.query or base.fragment:
        raise ValueError('Base URL must be a plain explicit origin/mount URL')
    expected_prefix = '/' + prefix.strip('/') if prefix.strip('/') else ''
    if base.path.rstrip('/') != expected_prefix:
        raise ValueError('Base URL path and explicit mount prefix differ')
    if (ROOT / '.hugo-version').read_text(encoding='utf-8').strip() != PIN:
        raise ValueError('Hugo pin differs from .hugo-version')
    version = subprocess.check_output(['hugo', 'version'], cwd=ROOT, text=True).strip()
    if not pinned_stable_version(version):
        raise ValueError('Install pinned Hugo ' + PIN + ' before building')
    prepare_hugo.prepare(expected_prefix, preview)
    inputs = snapshot_sources()
    input_digest = digest(json.dumps(inputs, sort_keys=True, separators=(',', ':')).encode())
    subprocess.run(['hugo', '--baseURL', base_url.rstrip('/') + '/', '--destination', str(destination), '--cleanDestinationDir'], cwd=ROOT, check=True)
    if snapshot_sources() != inputs:
        raise ValueError('Source inputs changed during build; output has no valid snapshot')
    result = verify(destination, expected_prefix)
    result.update({'hugoVersion': version, 'sourceInputFiles': inputs, 'sourceInputSnapshotSha256': input_digest,
                   'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                   'preview': preview, 'baseURL': base_url.rstrip('/') + '/',
                   'scope': 'Exact Hugo inputs and static build gates. Functional/review/host acceptance is separate.'})
    record = ROOT / ('docs/audits/build-preview.json' if preview else 'docs/audits/build-root.json')
    record.parent.mkdir(parents=True, exist_ok=True)
    record.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': result['passed'], 'routes': result['routeCount'], 'sourceSnapshot': input_digest,
                      'outputSnapshot': result['outputSnapshotSha256'], 'errors': result['errors']}, indent=2))
    return result


if __name__ == '__main__':
    raise SystemExit(cli())
