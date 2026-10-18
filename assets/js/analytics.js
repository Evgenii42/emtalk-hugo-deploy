// Preserve the existing service only on its production domains.
// Preview/local pages never initialize the queue, load Google or send events.
// Migration preserves legacy content-page analytics; this is not a new consent
// implementation or a certification of the existing consent/legal policy.
// The template excludes both guest-practice routes before this script is built.
(() => {
const configuration = document.querySelector('script[data-emtalk-analytics]');
const measurementId = configuration?.dataset.emtalkAnalytics;
const containerId = configuration?.dataset.emtalkTagManager;
const route = document.documentElement.dataset.routeId;
if (location.protocol === 'https:' && ['www.emtalk.org', 'emtalk.org'].includes(location.hostname)
  && /^G-[A-Z0-9]+$/.test(measurementId || '') && !['/dm/workspace', '/bret/practice'].includes(route)
  && configuration.dataset.emtalkAnalyticsInitialized !== 'true') {
  configuration.dataset.emtalkAnalyticsInitialized = 'true';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  const developerIds = (configuration.dataset.emtalkAnalyticsDevelopers || '').split(',');
  for (const developerId of developerIds) {
    if (/^developer_id\.[A-Za-z0-9_]+$/.test(developerId)) window.gtag('set', developerId, true);
  }
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  const hasTagManager = /^GTM-[A-Z0-9]+$/.test(containerId || '');
  if (hasTagManager) {
    window.dataLayer.push({'gtm.start': Date.now(), event: 'gtm.js'});
  }
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    const loader = document.createElement('script');
    loader.async = true;
    loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.append(loader);
    if (hasTagManager) {
      const tagManager = document.createElement('script');
      tagManager.async = true;
      tagManager.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
      const firstScript = document.getElementsByTagName('script')[0];
      firstScript.parentNode.insertBefore(tagManager, firstScript);
    }
  }
  if (route !== '/') {
    boot();
    return;
  }
  // Home queues commands immediately, but its heavy SDKs start only after the
  // critical reveal and a completed frame. No font wait or extra delay timer.
  const gate = window.EmTalkPageLoader;
  let revealed = !gate?.isPending();
  let suspended = false, firstFrame = 0, secondFrame = 0;
  function cancelFrames() {
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    firstFrame = secondFrame = 0;
  }
  function cleanup() {
    cancelFrames();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', hide);
    window.removeEventListener('pageshow', show);
    gate?.signal?.removeEventListener('abort', reveal);
  }
  function schedule() {
    if (booted || !revealed || suspended || document.hidden || firstFrame || secondFrame) return;
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        if (suspended || document.hidden) return;
        cleanup();
        boot();
      });
    });
  }
  function reveal() { revealed = true; schedule(); }
  function visibility() { if (document.hidden) cancelFrames(); else schedule(); }
  function hide() { suspended = true; cancelFrames(); }
  function show() { suspended = false; schedule(); }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', hide);
  window.addEventListener('pageshow', show);
  if (!revealed && gate?.signal) {
    gate.signal.addEventListener('abort', reveal, {once:true});
    if (gate.signal.aborted || !gate.isPending()) reveal();
  } else schedule();
}
})();
