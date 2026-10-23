# EmTalk finite analytics031 deployment snapshot

Canonical source/history: https://forgejo.emtalk.org/Emtalk/emtalk_site .
Original394 baseline rows and published029 raw sources are retained, with
the explicit reviewed analytics031 authored archive selection applied.
No Bing030, raw private CMS, visitor rows, credentials or audit archives
are published. Sources are mapped from committed canonical archive blobs.

Hugo0.168.0, production main, public output. Build using:
python -m pip install -r requirements-build.txt && python scripts/build_cloudflare.py
EMTALK_SITE_ORIGIN=https://www.emtalk.org/ is required for production.

MANDATORY: clean-export actual rebuild must match the reviewed prepared
source and output hashes before publication. Selector/export binding is
not a build, provider receipt, consent compliance or native-media proof.
Do not restore unconditional029 tracking as an analytics rollback.

Canonical commit: 7a88543153700fa6ee526091f9999e3a33b02d1c
Reviewed receipt: docs/audits/analytics031/build015-r8-final.json
