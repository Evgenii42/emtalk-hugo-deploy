import { createUmamiTransport } from "./analytics-umami.js";
import { createAnalyticsPreferences } from "./analytics-preferences.js";
import { createAnalyticsPayload } from "./analytics-payload.js";
import { createAnalyticsTransport } from "./analytics-transport.js";
import { createAnalyticsPrivacyUI } from "./analytics-privacy-ui.js";

// Coordinator owns only eligibility epochs, once-per-document pageview latches and lifecycle.
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
  let active = false, epoch = 0, suspended = false, choice = null, timer = null;
  let ui = null, uiReady = false, notice = "";
  const gpc = () => navigator.globalPrivacyControl === true;
  const dnt = () => navigator.doNotTrack === "1" || window.doNotTrack === "1";
  const transport = createAnalyticsTransport({ id: payload.id, home: config.dataset.emtalkRoute === "/",
    canonical: payload.canonical, lifetime: preferences.lifetime, window, document, canBoot: guardGoogleBoot, googleScroll: payload.googleScroll,
    onFailure: render });
  const umami = createUmamiTransport({ window, document, navigator,
    enabled: config.dataset.emtalkUmamiAllowed === "true", payload, canSend: guardUmamiSend, epoch: () => epoch,
    onFailure: render });
  function changeActive(value) {
    if (active === value) return;
    active = value; epoch += 1;
    window.dispatchEvent(new CustomEvent("emtalk:analytics-consent", { detail: { active, epoch } }));
  }
  function revoke() { transport.revoke(); umami.revoke(); changeActive(false); }
  // Pure decision over the already-read choice and current owned flags. It
  // must never revoke, schedule, render, read storage or activate a transport.
  function eligibleChoice(value) {
    return uiReady && payload.eligible && preferences.valid(value) && value.analytics &&
      !gpc() && !dnt() && !preferences.isBlocked();
  }
  // Reading is explicit: every pre-send/boot guard must see another tab's
  // latest persisted choice, including when its storage event was missed.
  function consented() { choice = preferences.read(); return eligibleChoice(choice); }
  // Effectful boundary guards, not general predicates. Only public actions,
  // emit(), and transport pre-send/pre-boot ports call these. Invalid active
  // consent revokes synchronously (including epoch changes), then refreshes
  // expiry/UI. Render, schedule and pure eligibility must not call a guard.
  function guardTracking() {
    if (!active || suspended || !consented()) { if (active) { revoke(); schedule(); render(); } return false; }
    return true;
  }
  function guardGoogleBoot() {
    if (!active || suspended) return false;
    if (!consented()) { revoke(); schedule(); render(); return false; } return !transport.hasFailed();
  }
  function guardUmamiSend() { return guardTracking() && !umami.hasFailed(); }
  function emit(name, params = {}) {
    if (!guardTracking()) return false;
    let value; try { value = payload.validate(name, params); } catch { return false; }
    if (!value) return false;
    // Each owner acknowledges local acceptance only. Pageview handoff latches
    // remain provider-owned; retries cannot duplicate an already handed view.
    const umamiAccepted = umami.emit(name, value);
    const googleAccepted = !transport.hasFailed() &&
      (name !== "page_view" || transport.pageviewStatus() === "none") &&
      transport.queue(name, value, payload.fields);
    return umamiAccepted || googleAccepted; // Never provider delivery/ingestion.
  }
  Object.defineProperty(window, "EmTalkAnalytics", { value: Object.freeze({ emit, canTrack: guardTracking,
    epoch: () => epoch, context: payload.context, product: payload.product }), writable: false, configurable: false });
  function activate() {
    if (suspended || !consented()) return;
    if (!active) changeActive(true);
    // Provider failure is not consent withdrawal. Each healthy/retried owner
    // ensures its own configuration without changing the consent epoch.
    if (!transport.hasFailed()) { transport.activate(payload.fields); emit("page_view"); }
    umami.request();
    transport.requestBoot();
  }
  function schedule() {
    if (timer !== null) clearTimeout(timer); timer = null;
    if (preferences.valid(choice)) timer = setTimeout(refresh, Math.min(2147483647, Math.max(1, choice.at + preferences.lifetime - Date.now())));
  }
  function recoveryNotice() {
    const failed = [transport.hasFailed() && "Google Analytics", umami.hasFailed() && "Umami"].filter(Boolean);
    if (!failed.length) return "";
    const status = failed.length === 2 ? "Optional analytics is paused until you choose Allow to retry." :
      "The other available service may continue under your saved choice.";
    return failed.join(" and ") + " could not load. " + status + " Every feature still works. Open Privacy choices and choose Allow to retry the failed service.";
  }
  function render() { ui?.render(); }
  function refresh() {
    if (!consented()) revoke(); else if (suspended) changeActive(false); else activate();
    schedule(); render();
  }
  function choose(allow) {
    if (allow && (gpc() || dnt() || !payload.eligible || !uiReady)) {
      notice = gpc() ? "Global Privacy Control is enabled. Optional analytics stays off." :
        dnt() ? "Do Not Track is enabled. Optional analytics stays off." :
        "Optional analytics is unavailable on this page. Every feature still works.";
      render(); return false;
    }
    if (!allow) revoke();
    notice = ""; transport.resetFailure(); umami.resetFailure(); choice = preferences.save(allow);
    if (!choice) {
      revoke(); notice = "Your browser could not save this choice. Optional analytics stays off. You can keep using the website.";
      schedule(); render(); return false;
    }
    if (preferences.legacyRevocationFailed()) notice = "Your choice was saved on this page. Some older tabs could not be updated. Close or reload other EmTalk tabs to apply the current choice.";
    refresh(); return true;
  }
  function mount() {
    choice = preferences.read();
    ui = createAnalyticsPrivacyUI({ document, window, preferences, canonical: payload.canonical,
      snapshot: () => ({ choice, eligible: payload.eligible, gpc: gpc(), dnt: dnt(), notice: [notice, recoveryNotice()].filter(Boolean).join(" "), cleanupFailed: transport.cleanupFailed() }),
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
