import { createAnalyticsPreferences } from "./analytics-preferences.js";
import { createAnalyticsPayload } from "./analytics-payload.js";
import { createAnalyticsTransport } from "./analytics-transport.js";
import { createAnalyticsPrivacyUI } from "./analytics-privacy-ui.js";

// Coordinator owns only eligibility epochs, one-pageview latches and lifecycle.
// Concern owners receive explicit ports; none can infer product/private contents.
(() => {
  "use strict";
  const config = document.querySelector("script[data-emtalk-analytics]");
  const policyNode = document.getElementById("emtalk-analytics-policy");
  if (!config || !policyNode || window.EmTalkAnalytics) return;
  let policy;
  try { policy = JSON.parse(policyNode.textContent); } catch { return; }
  const payload = createAnalyticsPayload({ policy, configuration: config.dataset, origin: location.origin,
    pathname: location.pathname, referrer: document.referrer });
  const preferences = createAnalyticsPreferences({ id: payload.id, now: () => Date.now(),
    readLocal: key => localStorage.getItem(key), writeLocal: (key, value) => localStorage.setItem(key, value),
    readSession: key => sessionStorage.getItem(key), writeSession: (key, value) => sessionStorage.setItem(key, value) });
  let active = false, epoch = 0, pageEpoch = -1, suspended = false, choice = null, timer = null;
  let ui = null, uiReady = false, notice = "";
  const gpc = () => navigator.globalPrivacyControl === true;
  const transport = createAnalyticsTransport({ id: payload.id, home: config.dataset.emtalkRoute === "/",
    canonical: payload.canonical, lifetime: preferences.lifetime, window, document, canBoot,
    onFailure: () => { revoke(); notice = "Analytics could not load. Navigation and local tools still work. You can retry using Allow analytics."; render(); } });
  function changeActive(value) {
    if (active === value) return;
    active = value; epoch += 1;
    window.dispatchEvent(new CustomEvent("emtalk:analytics-consent", { detail: { active, epoch } }));
  }
  function revoke() { transport.revoke(); changeActive(false); }
  function consented() {
    choice = preferences.read();
    return uiReady && payload.eligible && preferences.valid(choice) && choice.analytics &&
      !gpc() && !transport.hasFailed() && !preferences.isBlocked();
  }
  function canTrack() {
    if (!active || suspended || !consented()) { if (active) { revoke(); schedule(); render(); } return false; }
    return true;
  }
  function canBoot() {
    if (!active || suspended) return false;
    if (!consented()) { revoke(); schedule(); render(); return false; } return true;
  }
  function emit(name, params = {}) {
    if (!canTrack() || (name === "page_view" && pageEpoch === epoch)) return false;
    let value; try { value = payload.validate(name, params); } catch { return false; }
    if (!value) return false;
    if (name === "page_view") pageEpoch = epoch;
    transport.queue(name, value, payload.fields);
    return true; // Validated and queued after consent, never provider acceptance.
  }
  Object.defineProperty(window, "EmTalkAnalytics", { value: Object.freeze({ emit, canTrack,
    epoch: () => epoch, context: payload.context }), writable: false, configurable: false });
  function activate() {
    if (suspended || !consented()) return;
    if (!active) { transport.activate(payload.fields); changeActive(true); emit("page_view"); }
    transport.requestBoot();
  }
  function schedule() {
    if (timer !== null) clearTimeout(timer); timer = null;
    if (preferences.valid(choice)) timer = setTimeout(refresh, Math.min(2147483647, Math.max(1, choice.at + preferences.lifetime - Date.now())));
  }
  function render() { ui?.render(); }
  function refresh() {
    if (!consented()) revoke(); else if (suspended) changeActive(false); else activate();
    schedule(); render();
  }
  function choose(allow) {
    if (allow && (gpc() || !payload.eligible || !uiReady)) { render(); return false; }
    if (!allow) revoke();
    notice = ""; transport.resetFailure(); choice = preferences.save(allow);
    if (!choice) {
      revoke(); notice = "Your browser could not save this choice. Optional analytics stays off. You can keep using the website.";
      schedule(); render(); return false;
    }
    refresh(); return true;
  }
  function mount() {
    choice = preferences.read();
    ui = createAnalyticsPrivacyUI({ document, window, preferences, canonical: payload.canonical,
      snapshot: () => ({ choice, eligible: payload.eligible, gpc: gpc(), notice, cleanupFailed: transport.cleanupFailed() }),
      onRefresh: refresh, onChoose: choose });
    uiReady = ui.ready; ui.mount(); refresh();
  }
  window.addEventListener("storage", event => { if (event.key === null || event.key === preferences.key) refresh(); });
  window.addEventListener("focus", refresh);
  window.addEventListener("pagehide", () => {
    suspended = true; transport.cancelBoot();
    if (consented()) changeActive(false); else revoke(); // Navigation is not withdrawal.
  });
  window.addEventListener("pageshow", () => { suspended = false; refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) transport.cancelBoot(); else if (document.visibilityState === "visible") refresh();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})();
