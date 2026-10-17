# EmTalk Hugo deployment snapshot

This repository is a selected deployment input snapshot for Cloudflare Pages.
The canonical source and development history remain in [Forgejo](https://forgejo.emtalk.org/Emtalk/emtalk_site).
The initial snapshot uses the accepted public source `1645005a77ecc54bfd811b7b2636add0529447eb`.
The newer DM workspace and loader are separate pending increments.

## Cloudflare Pages settings

- Import this repository as a **Pages** project, not a Worker.
- Production branch: `main`; root directory: repository root.
- Framework preset: None (the command below runs the project's Hugo pipeline).
- Build command: `python -m pip install -r requirements-build.txt && python scripts/build_cloudflare.py`
- Build output directory: `public`.
- Production and Preview environment: `HUGO_VERSION=0.168.0`, `PYTHON_VERSION=3.13.3`.
- `CF_PAGES_URL` is supplied by Pages. Do not set it to the old GitHub project URL.

The build prepares the public content, invokes pinned Hugo and verifies routes,
local assets and SEO. It fails if the deployment origin is absent or invalid.
The output uses the domain root with no `/emtalk-site-preview/` mount.
All deployments currently remain noindex previews. A production-domain switch
requires a separate verified release and explicit decision.

## Contents and provenance

`source-publication-manifest.json` binds the finite original input files to the
canonical source and identifies deployment-only additions. This is an export,
not a mirror of Forgejo history. It contains published content, localized media,
Hugo templates, CSS/JS and the build pipeline; no source archives, audit/review
bundles, credentials, visitor submissions or unpublished CMS items are exported.
Existing font license files and notices remain under `static`.

To update this repository, export another explicitly reviewed source snapshot
from Forgejo and update the manifest. Do not edit the site in two repositories.
Generated files are rebuilt; platform line endings may change their hashes.
The new deployment Git commit is distinct from the canonical source commit.

## Local check

Install Hugo extended 0.168.0 and the pinned Python dependencies. Then set
`CF_PAGES_URL=https://local-check.pages.dev` and run
`python scripts/build_cloudflare.py`. The built website is in `public`;
`docs/audits/build-preview.json` records that particular build's actual hashes.
Neither the report nor source inputs are copied into the published output.

After the first Pages deployment, verify CSS, JS, images, article playback,
keyboard/mobile navigation, deep links, unknown-route HTTP 404, canonical URLs
and query/fragment behavior on the actual assigned address. Pages currently
serves HTTP Range requests as 200 full responses; do not assume 206 or certify
media seeking until browser checks are complete. The existing GitHub Pages
repository and the production Webflow domain are independent and unchanged.
