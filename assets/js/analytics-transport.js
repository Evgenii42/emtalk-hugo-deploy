// Sole Google queue, cookie-cleanup and SDK-scheduling owner. The coordinator
// supplies a live canBoot guard; no preference or product state is owned here.
export function createAnalyticsTransport({ id, home, canonical, lifetime, window, document, canBoot, onFailure }) {
  const disabledKey = "ga-disable-" + id;
  const denied = { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
  let layer = null, loader = null, ready = false, failed = false, cleanupFailed = false;
  let firstFrame = 0, secondFrame = 0, revealSignal = null;
  window[disabledKey] = true;
  function command() { layer.push(arguments); }
  function activate(fields) {
    if (!layer) { layer = []; window.dataLayer = layer; }
    window[disabledKey] = false;
    command("consent", "default", { ...denied });
    command("set", "ads_data_redaction", true); command("set", "url_passthrough", false);
    command("set", "allow_google_signals", false); command("set", "allow_ad_personalization_signals", false);
    command("consent", "update", { ...denied, analytics_storage: "granted" }); command("js", new Date());
    command("config", id, { ...fields, send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, allow_enhanced_conversions: false, first_party_collection: false,
      cookie_expires: lifetime / 1000, cookie_update: false, cookie_flags: "SameSite=Lax;Secure" });
  }
  function queue(name, payload, fields) { command("event", name, { ...payload, ...fields, send_to: id }); }
  function cancelBoot() {
    if (firstFrame) cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame);
    firstFrame = secondFrame = 0;
    if (revealSignal) revealSignal.removeEventListener("abort", revealReady); revealSignal = null;
  }
  function clearCookies() {
    if (!canonical) return;
    const names = ["_ga", "_ga_" + id.slice(2), "_gid", "_gat", "_gat_gtag_" + id.split("-").join("_")];
    for (const name of names) for (const domain of ["", "; Domain=www.emtalk.org", "; Domain=.emtalk.org"]) {
      try { document.cookie = name + "=; Path=/; Max-Age=0; SameSite=Lax; Secure" + domain; } catch { cleanupFailed = true; }
    }
  }
  function revoke() {
    cancelBoot(); window[disabledKey] = true;
    if (loader && !ready) { loader.onload = loader.onerror = null; loader.remove(); loader = null; }
    if (layer) layer.length = 0;
    // No denied-consent command: an already loaded SDK may otherwise ping.
    clearCookies();
  }
  function inject() {
    if (ready || loader || !canBoot()) return;
    const script = document.createElement("script"); loader = script;
    script.async = true; script.referrerPolicy = "no-referrer";
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    script.onload = () => { if (loader === script) ready = true; };
    script.onerror = () => { if (loader !== script) return; failed = true; onFailure(); };
    document.head.append(script);
  }
  function revealReady() { cancelBoot(); requestBoot(); }
  function requestBoot() {
    if (ready || loader || !canBoot()) return;
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
  return Object.freeze({ activate, queue, requestBoot, cancelBoot, revoke,
    hasFailed: () => failed, resetFailure: () => { failed = false; }, cleanupFailed: () => cleanupFailed });
}
