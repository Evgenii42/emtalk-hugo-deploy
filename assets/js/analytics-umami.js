// Consent-gated manual-only Umami transport. Bounded validated coarse FIFO, no identity or DOM text.
export function createUmamiTransport({ window, document, navigator, enabled, payload, canSend, epoch = () => 0, onFailure = () => {} }) {
  const website = '0f21c95c-7dbc-4464-84b5-1442ae7eeec6';
  const scriptUrl = '/vendor/umami-8104cfafda3cc828.js';
  const hook = 'EmTalkUmamiBeforeSend';
  let script = null, ready = false, failed = false, pageSent = false, generation = 0, loadTimer = null;
  const pending = [], capacity = 32;
  const clearPending = () => { pending.length = 0; };
  const clearLoadTimer = () => { if (loadTimer !== null) window.clearTimeout(loadTimer); loadTimer = null; };
  const allowed = () => enabled && payload.eligible && canSend() &&
    navigator.globalPrivacyControl !== true && navigator.doNotTrack !== '1' && window.doNotTrack !== '1';
  const base = () => ({ website, hostname: 'www.emtalk.org',
    url: new URL(payload.fields.page_location).pathname, title: payload.fields.page_title, referrer: '' });
  function serializationGuard(value) {
    const issuedEpoch = epoch(), issuedGeneration = generation;
    // Exact pinned SDK awaits beforeSend, then serializes its returned object
    // directly as fetch's argument. Recheck at that last synchronous boundary:
    // a same-task withdrawal/expiry/signal must stop the later microtask send.
    // This nonenumerable method never adds a wire field or reads private DOM.
    Object.defineProperty(value, 'toJSON', { value() {
      if (!allowed() || issuedEpoch !== epoch() || issuedGeneration !== generation)
        throw new Error('Analytics eligibility changed before serialization');
      return { ...value }; // Plain approved snapshot, no recursive stringify.
    }, writable: false, enumerable: false, configurable: false });
    if (value.data) Object.freeze(value.data);
    return Object.freeze(value);
  }
  function clean(type, value) {
    if (!allowed() || type !== 'event' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    const fixed = base();
    // Never preserve SDK defaults: query, hash, raw title and referrer are absent.
    for (const [key, expected] of Object.entries(fixed)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.value !== expected) return false;
    }
    const name = Object.getOwnPropertyDescriptor(value, 'name');
    if (!name) return Object.keys(value).every(key => Object.hasOwn(fixed, key)) ? serializationGuard(fixed) : false;
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
    return sanitized ? serializationGuard({ ...fixed, name: name.value, data: sanitized }) : false;
  }
  // A single known owner is installed before loading the third-party script.
  // A colliding owner is not overwritten. Report it only when activation is
  // requested, after the coordinator has completed initialization.
  if (window[hook] !== undefined) {
    let collisionFailed = false;
    return Object.freeze({
      request() { if (allowed()) { collisionFailed = true; onFailure(); } }, emit: () => false,
      revoke() { clearPending(); }, hasFailed: () => collisionFailed, resetFailure() { collisionFailed = false; },
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
  function flush() {
    while (pending.length) {
      const current = epoch(), owner = generation;
      if (!allowed() || !ready || owner !== generation || current !== epoch()) return;
      const next = pending.shift();
      if (!next) return; // An effectful eligibility guard may clear the FIFO.
      if (next.epoch === current) send(next.value);
    }
  }
  function revoke() {
    clearPending(); generation += 1;
    // A loaded manual SDK remains inert behind the fresh eligibility hook.
    // Pending script callbacks are generation-bound and cannot replay old work.
    if (!ready) { clearLoadTimer(); script?.remove(); script = null; }
  }
  function request() {
    if (!allowed() || failed) return;
    if (ready) { pageview(); flush(); return; }
    if (script) return;
    const current = ++generation;
    script = document.createElement('script');
    const owned = () => current === generation;
    script.defer = true; script.async = true; script.src = scriptUrl;
    script.referrerPolicy = 'no-referrer';
    // Exact reviewed official snapshot, served from EmTalk with its MIT notice.
    // Upstream script rotations cannot replace these local bytes.
    script.integrity = 'sha256-gQTPr9o8yChr5PY9bG6EHRY+mb+48eyi+Qaf7YgUFo0=';
    script.crossOrigin = 'anonymous';
    Object.assign(script.dataset, { websiteId: website, hostUrl: 'https://gateway.umami.is', domains: 'www.emtalk.org', autoTrack: 'false',
      excludeSearch: 'true', excludeHash: 'true', doNotTrack: 'true', beforeSend: hook });
    const fail = () => {
      if (!owned()) return;
      const report = allowed();
      if (!owned()) return; // A fresh guard can synchronously revoke this owner.
      failed = true; ready = false; generation += 1; clearLoadTimer(); clearPending();
      script?.remove(); script = null;
      if (report) onFailure();
    };
    script.onload = () => { if (!owned()) return; clearLoadTimer(); ready = typeof window.umami?.track === 'function'; if (ready) { pageview(); flush(); } else fail(); };
    script.onerror = fail;
    loadTimer = window.setTimeout(fail, 15000);
    document.head.appendChild(script);
  }
  function emit(name, parameters) {
    if (name === 'page_view' || failed || !allowed()) return false;
    // Validate/copy before enqueueing. Only policy-owned coarse scalar fields
    // survive clean(); mutable caller objects, private text and arbitrary events
    // cannot enter this FIFO. Capacity rejects the newest action, never retries.
    const value = clean('event', { ...base(), name, data: parameters });
    if (!value) return false;
    if (ready) return send(value);
    if (pending.length >= capacity) return false;
    const current = epoch();
    pending.push({ epoch: current, value: Object.freeze({ ...value, data: Object.freeze({ ...value.data }) }) });
    return true; // Local bounded acceptance, never delivery acknowledgement.
  }
  return Object.freeze({ request, emit, revoke, hasFailed: () => failed, resetFailure() { failed = false; } });
}
