// Preserve the existing service only on its production domains.
// Preview/local pages never initialize the queue, load Google or send events.
// Migration preserves legacy content-page analytics; this is not a new consent
// implementation or a certification of the existing consent/legal policy.
// The template excludes both guest-practice routes before this script is built.
const configuration = document.querySelector('script[data-emtalk-analytics]');
const measurementId = configuration?.dataset.emtalkAnalytics;
const containerId = configuration?.dataset.emtalkTagManager;
if (location.protocol === 'https:' && ['www.emtalk.org', 'emtalk.org'].includes(location.hostname)
  && /^G-[A-Z0-9]+$/.test(measurementId || '')) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  const developerIds = (configuration.dataset.emtalkAnalyticsDevelopers || '').split(',');
  for (const developerId of developerIds) {
    if (/^developer_id\.[A-Za-z0-9_]+$/.test(developerId)) window.gtag('set', developerId, true);
  }
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  const loader = document.createElement('script');
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(loader);
  if (/^GTM-[A-Z0-9]+$/.test(containerId || '')) {
    window.dataLayer.push({'gtm.start': Date.now(), event: 'gtm.js'});
    const tagManager = document.createElement('script');
    tagManager.async = true;
    tagManager.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    const firstScript = document.getElementsByTagName('script')[0];
    firstScript.parentNode.insertBefore(tagManager, firstScript);
  }
}
