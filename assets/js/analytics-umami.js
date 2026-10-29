// Eligibility-gated manual-only cookieless Umami transport. Bounded validated coarse FIFO, no identity or DOM text.
export function createUmamiTransport({ window, document, navigator, enabled, configuration, payload, canSend, epoch = () => 0, onFailure = () => {} }) {
  // Public provider identity has one reviewed data owner. Copy finite scalar
  // fields once; malformed/missing configuration cannot activate a transport.
  const keys = ['websiteId', 'scriptPath', 'hostUrl', 'hostname', 'integrity'];
  const settings = {};
  for (const key of keys) {
    const descriptor = configuration && Object.getOwnPropertyDescriptor(configuration, key);
    if (descriptor && typeof descriptor.value === 'string') settings[key] = descriptor.value;
  }
  const { websiteId: website, scriptPath: scriptUrl, hostUrl, hostname, integrity } = settings;
  let pageHostname = '';
  try { pageHostname = new URL(payload.fields?.page_location).hostname; } catch { /* Ineligible route, including404. */ }
  const configured = payload.umamiEligible && keys.every(key => typeof settings[key] === 'string') &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(website) &&
    /^\/vendor\/umami-[a-f0-9]{16}\.js$/.test(scriptUrl) &&
    /^https:\/\/[a-z0-9.-]+$/.test(hostUrl) &&
    hostname === pageHostname &&
    /^sha256-[A-Za-z0-9+/]{43}=$/.test(integrity);
  const hook = 'EmTalkUmamiBeforeSend';
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  let script = null, ready = false, failed = false, pageSent = false, generation = 0, loadTimer = null;
  let sdkApi = null, sdkTrack = null, compromised = false;
  const ownedScripts = new WeakSet();
  const pending = [], capacity = 32;
  const clearPending = () => { pending.length = 0; };
  const clearLoadTimer = () => { if (loadTimer !== null) window.clearTimeout(loadTimer); loadTimer = null; };
  const allowed = () => configured && enabled && payload.umamiEligible && canSend() &&
    navigator.globalPrivacyControl !== true && navigator.doNotTrack !== '1' && window.doNotTrack !== '1';
  const base = () => ({ website, hostname,
    url: new URL(payload.fields.page_location).pathname, title: payload.fields.page_title, referrer: '' });
  function serializationGuard(value) {
    const issuedEpoch = epoch(), issuedGeneration = generation;
    // Exact pinned SDK awaits beforeSend, then serializes its returned object
    // directly as fetch's argument. Recheck at that last synchronous boundary:
    // a same-task eligibility restriction or signal must stop the later microtask send.
    // This nonenumerable method never adds a wire field or reads private DOM.
    Object.defineProperty(value, 'toJSON', { value() {
      if (!allowed() || !ownsTrack() || issuedEpoch !== epoch() || issuedGeneration !== generation)
        throw new Error('Analytics eligibility changed before serialization');
      return { ...value }; // Plain approved snapshot, no recursive stringify.
    }, writable: false, enumerable: false, configurable: false });
    if (value.data) Object.freeze(value.data);
    return Object.freeze(value);
  }
  function clean(type, value) {
    if (!allowed() || type !== 'event' || !value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((ready || sdkApi !== null) && !ownsTrack()) return false;
    const fixed = base();
    // Never preserve SDK defaults: query, hash, raw title and referrer are absent.
    for (const [key, expected] of Object.entries(fixed)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn(descriptor, 'value') || descriptor.value !== expected) return false;
    }
    const name = Object.getOwnPropertyDescriptor(value, 'name');
    if (!name) return Object.keys(value).every(key => hasOwn(fixed, key)) ? serializationGuard(fixed) : false;
    const data = Object.getOwnPropertyDescriptor(value, 'data');
    if (!hasOwn(name, 'value') || !data || !hasOwn(data, 'value') ||
        !Object.keys(value).every(key => hasOwn(fixed, key) || key === 'name' || key === 'data')) return false;
    if (!data.value || typeof data.value !== 'object' || Array.isArray(data.value)) return false;
    const input = {}, reserved = {};
    for (const key of Object.keys(data.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(data.value, key);
      if (!descriptor || !hasOwn(descriptor, 'value')) return false;
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
  if (hook in window || 'umami' in window) {
    let collisionFailed = false;
    return Object.freeze({
      request() { if (!collisionFailed && allowed()) { collisionFailed = true; onFailure(); } }, emit: () => false,
      // A foreign global owner is terminal for this document, not a load retry.
      revoke() { clearPending(); }, hasFailed: () => collisionFailed, resetFailure() {},
    });
  }
  Object.defineProperty(window, hook, { value: clean, writable: false, configurable: false });
  function invalidateOwner() {
    if (compromised) return;
    compromised = true;
    const report = allowed();
    failed = true; ready = false; generation += 1;
    clearLoadTimer(); clearPending(); script?.remove(); script = null;
    if (report) onFailure();
  }
  // The pinned script assigns its API synchronously during its own evaluation.
  // A mere global found at onload is not proof of SDK provenance. This owned
  // accessor accepts only that exact script assignment and never invokes a
  // foreign setter, API, or replacement track function.
  Object.defineProperty(window, 'umami', {
    configurable: false, enumerable: true,
    get: () => sdkApi,
    set(value) {
      const executing = document.currentScript;
      // Removing a script does not cancel already fetched evaluation. Ignore
      // our stale owned script assignment without poisoning a later valid load.
      if (executing && ownedScripts.has(executing) && executing !== script) return;
      if (compromised || sdkApi !== null || !script || executing !== script) { invalidateOwner(); return; }
      const issuedScript = script, issuedGeneration = generation;
      if (!allowed() || issuedScript !== script || issuedGeneration !== generation) return;
      const track = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'track') : null;
      if (!track || !hasOwn(track, 'value') || typeof track.value !== 'function') { invalidateOwner(); return; }
      sdkApi = value; sdkTrack = track.value;
    },
  });
  function ownsTrack() {
    if (compromised || !sdkApi || !sdkTrack) return false;
    const track = Object.getOwnPropertyDescriptor(sdkApi, 'track');
    if (!track || !hasOwn(track, 'value') || track.value !== sdkTrack) { invalidateOwner(); return false; }
    return true;
  }
  function send(value) {
    if (!ready || !allowed() || !ownsTrack()) return false;
    const snapshot = clean('event', value);
    if (!snapshot) return false;
    try { Promise.resolve(sdkTrack.call(sdkApi, snapshot)).catch(() => {}); return true; } catch { return false; }
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
    if (!allowed() || failed || compromised) return;
    if (ready) { pageview(); flush(); return; }
    if (script) return;
    const current = ++generation;
    script = document.createElement('script');
    ownedScripts.add(script);
    const owned = () => current === generation;
    script.defer = true; script.async = true; script.src = scriptUrl;
    script.referrerPolicy = 'no-referrer';
    // Exact reviewed official snapshot, served from EmTalk with its MIT notice.
    // Upstream script rotations cannot replace these local bytes.
    script.integrity = integrity;
    script.crossOrigin = 'anonymous';
    Object.assign(script.dataset, { websiteId: website, hostUrl, domains: hostname, autoTrack: 'false',
      excludeSearch: 'true', excludeHash: 'true', doNotTrack: 'true', beforeSend: hook });
    const fail = () => {
      if (!owned()) return;
      const report = allowed();
      if (!owned()) return; // A fresh guard can synchronously revoke this owner.
      failed = true; ready = false; generation += 1; clearLoadTimer(); clearPending();
      script?.remove(); script = null;
      if (report) onFailure();
    };
    script.onload = () => { if (!owned()) return; clearLoadTimer(); ready = ownsTrack(); if (ready) { pageview(); flush(); } else fail(); };
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
  return Object.freeze({ request, emit, revoke, hasFailed: () => failed, resetFailure() { if (!compromised) failed = false; } });
}
