# EmTalk Hugo deployment snapshot

This is a finite Cloudflare Pages input export. Canonical source and history
remain in [Forgejo](https://forgejo.emtalk.org/Emtalk/emtalk_site).
The immutable public baseline is `1645005a77ecc54bfd811b7b2636add0529447eb`. Five selected source
overrides, one source addition and the updated build helper are bound to
canonical checkpoint `889dbd69ae65b28fddfb32c685166c97f3393c06`. Newer DM and loader changes are excluded.

## Build settings

- Pages project: `emtalk-hugo-deploy`; production branch: `main`.
- Repository root; output directory: `public`; framework preset: None.
- Command: `python -m pip install -r requirements-build.txt && python scripts/build_cloudflare.py`.
- Pinned environment: `HUGO_VERSION=0.168.0`, `PYTHON_VERSION=3.13.3`.
- Pages supplies `CF_PAGES_URL` and `CF_PAGES_BRANCH`.

Without `EMTALK_SITE_ORIGIN`, every branch builds a noindex preview. Production
requires the exact `EMTALK_SITE_ORIGIN=https://www.emtalk.org/`, branch `main`,
and the approved Pages project or its one-label deployment subdomain. Set this
opt-in only in the intended Production environment. Invalid requests stop the
build. The static `_headers` policy adds noindex to Pages aliases; it has no
global or www rule. The helper checks this policy before and after the build.

## Provenance and limits

Manifest schema2 preserves all394 original `sourceFiles` unchanged, then records
five `sourceOverrides`, one `sourceAdditions` entry and deployment-only files.
The effective raw source contains395 files; the finite repository export has400
files including this manifest. This is a selected export, not a Git-history mirror.
Only the original published-content snapshot, localized media, Hugo inputs and
explicit reviewed code changes are exported. No audit bundles, source archives,
credentials, visitor submissions or unpublished CMS items are included.

CMS data remains accepted staged-derived data: published metadata is present,
but `liveApiVerified=false` and current live field-value parity is unconfirmed.
Font licenses and notices remain under `static`.

Hugo preparation regenerates tracked render/CSS inputs; the raw export hash is
distinct from the prepared395-input build receipt. Local build dirtiness is not
an instruction to publish generated source changes. Build outputs and reports
are excluded by `.gitignore`. Platform line endings may change generated hashes.

The reviewed local production015 fixture has313 output files:312 public assets
and one provider-consumed `_headers` control. The helper is outside the Hugo
input list and is separately bound in the manifest. A future Cloudflare Linux
build, host-specific headers, redirects, TLS and domain readiness need actual
deployment evidence. Local VM/browser observations do not certify those states.
Native Windows WebKit no-JS playback has a tested MP3 download alternative;
physical audio output is not certified by the local tests.

Update this export from another explicit canonical checkpoint. Keep source
development in Forgejo and retain exact source/build/review/hosted receipts.
