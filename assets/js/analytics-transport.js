// Google SDK lifetime is confined to a consent-created first-party document.
// This is lifetime isolation, not a security sandbox for the trusted vendor.
export function createAnalyticsTransport({ id, home, canonical, lifetime, window, document, canBoot, googleScroll, onFailure }) {
  const disabledKey = "ga-disable-" + id;
  const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  let layer = null, loader = null, frame = null, child = null, ready = false, failed = false, cleanupFailed = false;
  let generation = 0, loadTimer = null, loadStage = null, fields = null, scrollSent = false, teardownFailed = false, startChild = null;
  let firstFrame = 0, secondFrame = 0, revealSignal = null;
  let configured = false, pageviewQueued = false, pageviewHandedOff = false;
  function command() { layer.push(arguments); }
  function activate(value) {
    // A consent-valid BFcache restore retains the existing SDK configuration.
    if (configured) return;
    configured = true; fields = value; layer = [];
    command("consent", "default", { ...denied });
    command("set", "ads_data_redaction", true); command("set", "url_passthrough", false);
    command("set", "allow_google_signals", false); command("set", "allow_ad_personalization_signals", false);
    command("consent", "update", { ...denied, analytics_storage: "granted" }); command("js", new Date());
    command("config", id, { ...fields, send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, allow_enhanced_conversions: false, first_party_collection: false,
      cookie_expires: lifetime / 1000, cookie_update: false, cookie_flags: "SameSite=Lax;Secure" });
  }
  function queue(name, payload, fields) {
    if (!configured || !layer) return false;
    if (name === "page_view") {
      if (pageviewQueued || pageviewHandedOff) return false;
      pageviewQueued = true;
      // This acknowledges SDK handoff availability, never provider ingestion.
      if (ready) pageviewHandedOff = true;
    }
    command("event", name, { ...payload, ...fields, send_to: id });
    return true;
  }
  function pageviewStatus() { return pageviewHandedOff ? "handed_off" : pageviewQueued ? "queued" : "none"; }
  function cancelBoot() {
    if (firstFrame) cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame);
    firstFrame = secondFrame = 0;
    if (revealSignal) revealSignal.removeEventListener("abort", revealReady); revealSignal = null;
  }
  function clearCookies() {
    if (!canonical) return;
    cleanupFailed = false;
    const names = ["_ga", "_ga_" + id.slice(2), "_gid", "_gat", "_gat_gtag_" + id.split("-").join("_")];
    for (const name of names) for (const domain of ["", "; Domain=www.emtalk.org", "; Domain=.emtalk.org"]) {
      try { document.cookie = name + "=; Path=/; Max-Age=0; SameSite=Lax; Secure" + domain; } catch { cleanupFailed = true; }
    }
    // A cookie setter can silently refuse deletion. Check only readable target
    // names; JavaScript cannot inspect HttpOnly cookies or inaccessible paths.
    try {
      const remaining = document.cookie.split(';').map(cookie => cookie.split('=', 1)[0].trim());
      if (names.some(name => remaining.includes(name))) cleanupFailed = true;
    } catch { cleanupFailed = true; }
  }
  function closeFrame() {
    const old = frame;
    generation += 1;
    if (loadTimer !== null) clearTimeout(loadTimer); loadTimer = null; loadStage = null;
    // Disable first, then block child network before teardown can flush queues.
    // No parent globals, CSP, fetch, sendBeacon or image methods are patched.
    if (child) {
      teardownFailed = false;
      try {
        child[disabledKey] = true;
        const meta = child.document.createElement("meta");
        meta.httpEquiv = "Content-Security-Policy";
        meta.content = "default-src 'none'; connect-src 'none'; img-src 'none'; frame-src 'none'; script-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'";
        child.document.head.append(meta);
      } catch { teardownFailed = true; }
    }
    if (loader) loader.onload = loader.onerror = null;
    if (old) { old.onload = old.onerror = null; old.remove(); }
    frame = child = loader = startChild = null; ready = false;
  }
  function revoke() {
    cancelBoot();
    closeFrame(); configured = false;
    // A detached pre-SDK queue may be rebuilt after a fresh Allow. A view
    // already handed to any child SDK never repeats in this parent document.
    if (!pageviewHandedOff) pageviewQueued = false;
    if (layer) layer.length = 0;
    clearCookies();
  }
  function validRuntime(target) {
    const doc = target.document;
    const attrs = (node, values) => !!node && node.attributes.length === Object.keys(values).length &&
      Object.entries(values).every(([key, value]) => node.getAttribute(key) === value);
    const meta = [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ];
    if (target.location.origin !== window.location.origin || target.location.pathname !== "/analytics/google-frame" ||
        target.location.search || target.location.hash || doc.referrer || doc.doctype?.name !== "html") return false;
    if (!attrs(doc.documentElement, { lang: "en", "data-emtalk-analytics-runtime": "google-v1" }) ||
        !attrs(doc.head, {}) || !attrs(doc.body, {}) || doc.body.children.length || doc.body.textContent.trim()) return false;
    if (doc.documentElement.children.length !== 2 || doc.documentElement.children[0] !== doc.head ||
        doc.documentElement.children[1] !== doc.body || doc.querySelectorAll("*").length !== 8 || doc.head.children.length !== 5) return false;
    for (let index = 0; index < meta.length; index++) {
      const node = doc.head.children[index];
      if (node.tagName !== "META" || !attrs(node, meta[index])) return false;
    }
    const title = doc.head.children[4];
    return title.tagName === "TITLE" && attrs(title, {}) && title.textContent === "Optional analytics";
  }
  function inject() {
    if (frame || !configured || !canBoot()) return;
    const current = ++generation;
    const node = document.createElement("iframe"); frame = node;
    node.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:0;border:0";
    node.tabIndex = -1; node.setAttribute("aria-hidden", "true");
    node.title = "Optional analytics"; node.referrerPolicy = "no-referrer";
    node.src = "/analytics/google-frame";
    const owned = () => generation === current && frame === node && configured;
    const valid = () => owned() && canBoot();
    const failure = () => {
      if (!owned()) return;
      if (!canBoot()) { if (loadTimer !== null) clearTimeout(loadTimer); loadTimer = null; loadStage = null; return; }
      failed = true; closeFrame();
      // The old child may have replaced Array.push during partial SDK load.
      // Discard its queue/configuration; explicit retry builds a fresh layer.
      // Keep only the per-document handed-off view latch, never replay it.
      configured = false; layer = null; pageviewQueued = false;
      onFailure();
    };
    const armTimeout = stage => {
      // Repeated focus/boot callbacks cannot extend an active stage budget.
      if (loadTimer !== null && loadStage === stage) return;
      if (loadTimer !== null) clearTimeout(loadTimer);
      loadStage = stage;
      loadTimer = setTimeout(() => {
        if (loadStage !== stage) return;
        loadTimer = null; failure();
      }, 15000);
    };
    armTimeout("frame"); node.onerror = failure;
    startChild = () => {
      if (!valid()) return;
      if (!child) { armTimeout("frame"); return; }
      if (loader) { armTimeout("sdk"); return; }
      // The full SDK budget starts here, independent of frame download time.
      armTimeout("sdk");
      const target = child;
      target[disabledKey] = false;
      target.document.title = fields.page_title;
      target.dataLayer = layer;
      const script = target.document.createElement("script"); loader = script;
      script.async = true; script.referrerPolicy = "no-referrer";
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
      script.onload = () => {
        // A BFcache lifecycle suspension is not consent withdrawal. Record
        // handoff of an already executing SDK even while the parent rests.
        // Actual withdrawal increments generation before this callback.
        if (owned() && loader === script) {
          ready = true; if (pageviewQueued) pageviewHandedOff = true;
          if (loadTimer !== null) clearTimeout(loadTimer); loadTimer = null; loadStage = null;
        }
      };
      script.onerror = failure;
      target.document.head.append(script);
    };
    node.onload = () => {
      if (!owned()) return;
      try {
        const target = node.contentWindow;
        if (!validRuntime(target)) { failure(); return; }
        child = target; startChild();
      } catch { failure(); }
    };
    document.body.append(node);
  }
  function revealReady() { cancelBoot(); requestBoot(); }
  function requestBoot() {
    if (ready || !canBoot()) return;
    if (frame) { startChild?.(); return; }
    if (!home) { inject(); return; }
    if (document.hidden || firstFrame || secondFrame) return;
    const gate = window.EmTalkPageLoader;
    if (gate?.isPending() && !gate.signal?.aborted) {
      if (gate.signal && revealSignal !== gate.signal) {
        if (revealSignal) revealSignal.removeEventListener("abort", revealReady);
        revealSignal = gate.signal; revealSignal.addEventListener("abort", revealReady, { once: true });
      }
      if (gate.signal?.aborted || !gate.isPending()) revealReady(); return;
    }
    if (revealSignal) { revealSignal.removeEventListener("abort", revealReady); revealSignal = null; }
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0; if (document.hidden || !canBoot()) return;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0; if (document.hidden || !canBoot()) return;
        const current = window.EmTalkPageLoader;
        if (current?.isPending() && !current.signal?.aborted) { requestBoot(); return; } inject();
      });
    });
  }
  // Google cannot automatically observe parent scrolling. Preserve one fixed
  // standard 90% parent threshold signal while consent is valid. A browser
  // focus restore can scroll too; this is not proof of intentional reading.
  window.addEventListener("scroll", () => {
    if (scrollSent || !configured || !fields || !canBoot()) return;
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    if (height <= window.innerHeight || (window.scrollY + window.innerHeight) / height < 0.9) return;
    const value = typeof googleScroll === "function" ? googleScroll() : null;
    const descriptor = value && typeof value === "object" && !Array.isArray(value)
      ? Object.getOwnPropertyDescriptor(value, "percent_scrolled") : null;
    if (!descriptor || descriptor.value !== 90 || Object.keys(value).length !== 1) return;
    if (queue("scroll", value, fields)) scrollSent = true;
  }, { passive: true });
  return Object.freeze({ activate, queue, pageviewStatus, requestBoot, cancelBoot, revoke,
    hasFailed: () => failed, resetFailure: () => { failed = false; }, cleanupFailed: () => cleanupFailed || teardownFailed });
}

