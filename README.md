# EmTalk012 staging build-source publication

Canonical source, specs, reviews, private archives and history remain in Forgejo.
This finite repository is a build/deployment element; use only branch interest032.
Cloudflare Pages build at repository root:
python -m pip install -r requirements-build.txt && python scripts/build_cloudflare.py
Output: public. Hugo extended0.168.0; backend directories remain outside public.
Only /api/interest invokes Pages Functions. Production flags remain false.
Preview flags are true only for controlled staging through the exact alias:
https://interest032.emtalk-hugo-deploy.pages.dev
The public Turnstile site key and private webhook address are plain configuration;
Turnstile and webhook secrets must remain Preview-only provider secrets.
Do not promote this configuration to production or change main.
This candidate does not represent full release acceptance or verified hosted intake.
Production main and the production domain are not changed by this staging export.

Private limiter Worker code: workers/interest-limiter/index.mjs.
Its config disables workers.dev, preview URLs, public routes and observability.
Its ../../server import requires the complete repository checkout, not this folder alone.
Authorized deployment from workers/interest-limiter: npx wrangler@4.149.0 deploy
No separate Worker build command is needed; Wrangler bundles its modules.
Do not create a Hello World placeholder or silently accept a broad generated CI token.
No credentials, visitor rows, private business documents or audit artifacts belong here.
Workers uses manual redirect mode; strict status checks reject every300..399 response.
Actual clean rebuild, deployment settings, security and staging receipts are separate gates.
The historical external006 assessment does not certify this exact012 release.
