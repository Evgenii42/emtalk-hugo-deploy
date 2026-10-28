// Consent-gated, manual-only Umami transport. No identity, DOM text or queue.
export function createUmamiTransport({ window, document, navigator, enabled, payload, canSend, onFailure = () => {} }) {
  const website = '0f21c95c-7dbc-4464-84b5-1442ae7eeec6';
  const scriptUrl = '/vendor/umami-8104cfafda3cc828.js';
  const hook = 'EmTalkUmamiBeforeSend';
  let script = null, ready = false, failed = false, pageSent = false;
  const allowed = () => enabled && payload.eligible && canSend() &&
    navigator.globalPrivacyControl !== true && navigator.doNotTrack !== '1' && window.doNotTrack !== '1';
  const base = () => ({ website, hostname: 'www.emtalk.org',
    url: new URL(payload.fields.page_location).pathname, title: payload.fields.page_title, referrer: '' });
  function clean(type, value) {
    if (!allowed() || type !== 'event' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fixed = base();
    // Never preserve SDK defaults: query, hash, raw title and referrer are absent.
    for (const [key, expected] of Object.entries(fixed)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== expected) return false;
    }
    const name = Object.getOwnPropertyDescriptor(value, 'name');
    if (!name) return Object.keys(value).every(key => Object.hasOwn(fixed, key)) ? fixed : false;
    const data = Object.getOwnPropertyDescriptor(value, 'data');
    if (!Object.hasOwn(name, 'value') || !data || !Object.hasOwn(data, 'value') ||
        !Object.keys(value).every(key => Object.hasOwn(fixed, key) || key === 'name' || key === 'data')) return false;
    if (!data.value || typeof data.value !== 'object' || Array.isArray(data.value)) return false;
    const input = {}, reserved = {};
    for (const key of Object.keys(data.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(data.value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      if (['contract_version', 'page_context'].includes(key)) reserved[key] = descriptor.value;
      else input[key] = descriptor.value;
    }
    const sanitized = payload.validate(name.value, input);
    if (sanitized && Object.entries(reserved).some(([key, value]) => sanitized[key] !== value)) return false;
    return sanitized ? { ...fixed, name: name.value, data: sanitized } : false;
  }
  // A single known owner is installed before loading the third-party script.
  // A colliding owner is not overwritten. Report it only when activation is
  // requested, after the coordinator has completed initialization.
  if (window[hook] !== undefined) {
    let collisionFailed = false;
    return Object.freeze({
      request() { if (allowed()) { collisionFailed = true; onFailure(); } }, emit: () => false,
      hasFailed: () => collisionFailed, resetFailure() { collisionFailed = false; },
    });
  }
  Object.defineProperty(window, hook, { value: clean, writable: false, configurable: false });
  function send(value) {
    if (!ready || !allowed() || typeof window.umami?.track !== 'function' || !clean('event', value)) return false;
    try { Promise.resolve(window.umami.track(value)).catch(() => {}); return true; } catch { return false; }
  }
  function pageview() {
    if (!pageSent && send(base())) pageSent = true;
  }
  function request() {
    if (!allowed() || failed) return;
    if (ready) { pageview(); return; }
    if (script) return;
    script = document.createElement('script');
    script.defer = true; script.async = true; script.src = scriptUrl;
    script.referrerPolicy = 'no-referrer';
    // Exact reviewed official snapshot, served from EmTalk with its MIT notice.
    // Upstream script rotations cannot replace these local bytes.
    script.integrity = 'sha256-gQTPr9o8yChr5PY9bG6EHRY+mb+48eyi+Qaf7YgUFo0=';
    script.crossOrigin = 'anonymous';
    Object.assign(script.dataset, { websiteId: website, hostUrl: 'https://gateway.umami.is', domains: 'www.emtalk.org', autoTrack: 'false',
      excludeSearch: 'true', excludeHash: 'true', doNotTrack: 'true', beforeSend: hook });
    const fail = () => {
      const report = allowed();
      failed = true; ready = false;
      script?.remove(); script = null;
      if (report) onFailure();
    };
    script.onload = () => { ready = typeof window.umami?.track === 'function'; if (ready) pageview(); else fail(); };
    script.onerror = fail;
    document.head.appendChild(script);
  }
  function emit(name, parameters) {
    // Pre-load actions are discarded instead of replayed after loading/consent.
    if (name === 'page_view') return false;
    return send({ ...base(), name, data: parameters });
  }
  return Object.freeze({ request, emit, hasFailed: () => failed, resetFailure() { failed = false; } });
}
