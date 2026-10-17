# EmTalk Hugo deployment snapshot

Canonical source/history remain in Forgejo:
https://forgejo.emtalk.org/Emtalk/emtalk_site . This finite export is not a
source-history mirror. Original394sourceFiles remain immutable from
1645005a77ecc54bfd811b7b2636add0529447eb; published predecessor is 0c248db59d4f355ac9c6dfd8661af7109cabbd89.
The explicit23-path DM/loader/dm-copy/llms selection comes from 6b37cda9ec04aa151572ffa7589b7c549ca66e17.
No source archives, audits/reviews, credentials, visitor data, private native
source, full workbook or unpublished CMS items are added.

## Build

- Pages project emtalk-hugo-deploy, production branch main, output public.
- python -m pip install -r requirements-build.txt && python scripts/build_cloudflare.py
- HUGO_VERSION=0.168.0; PYTHON_VERSION=3.13.3.
- Pages supplies CF_PAGES_URL and CF_PAGES_BRANCH.
- Without EMTALK_SITE_ORIGIN every branch remains a noindex preview.
- Production needs exact EMTALK_SITE_ORIGIN=https://www.emtalk.org/, main,
  and the fixed project alias or its one-label deployment/branch subdomain.
- static/_headers is a consumed control that noindexes only Pages aliases.

## Provenance and limits

Schema2 preserves the original394sourceFiles, then records13overrides and
15additions:409effective raw source files. Four deployment files plus manifest
make414repository files. Earlier five overrides and one addition are retained
except where the explicit new selection replaces prepare_hugo.py. Retained
rows preserve their previous checkpoint provenance; new rows bind selected
canonical Git blobs. The inherited build helper is pinned separately.

This increment includes selected DM guest model/storage/interface, explicitly
public English topics, fonts/licenses, accepted loader with1000ms delayed
indicator, route-only /dm copy corrections and public llms.txt. Website AI,
authentication/cloud sync/native parity are not invented.

Reviewed receipt: docs/audits/dm-publication-local-build024.json,409prepared inputs/320outputs including319public
artifacts and one consumed _headers control. Raw export and prepared input
hashes differ because preparation regenerates render/frontmatter/CSS inputs.
Build dirtiness is not permission to publish generated source. Outputs/reports
are excluded by .gitignore. Actual Linux/hosted bytes require their own binding.

Content remains accepted staged-derived data: published metadata is present,
but liveApiVerified=false and current live field-value parity remains unknown.
No complete-site release, DNS, TLS, native-media or physical-audio certification
follows from this source export. Keep source development/history in Forgejo.
