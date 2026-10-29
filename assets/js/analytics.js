import { createUmamiLifecycle } from "./analytics-umami-lifecycle.js";
import { createUmamiTransport } from "./analytics-umami.js";
import { createAnalyticsPreferences, createUmamiLegacyObjection } from "./analytics-preferences.js";
import { createAnalyticsPayload } from "./analytics-payload.js";
import { createAnalyticsTransport } from "./analytics-transport.js";
import { createAnalyticsPrivacyUI } from "./analytics-privacy-ui.js";

// Google consent and immediate cookieless Umami have separate eligibility and
// epochs. Shared public availability exists only for coarse caller deduplication.
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
  let googleActive = false, publicActive = false, publicEpoch = 0;
  let suspended = false, choice = null, timer = null;
  const legacyObjection = createUmamiLegacyObjection({ now: () => Date.now(), readLocal: key => localStorage.getItem(key) });
  let ui = null, uiReady = false, notice = "";
  const gpc = () => navigator.globalPrivacyControl === true;
  const dnt = () => navigator.doNotTrack === "1" || window.doNotTrack === "1";
  const transport = createAnalyticsTransport({ id: payload.id, home: config.dataset.emtalkRoute === "/",
    canonical: payload.canonical, lifetime: preferences.lifetime, window, document, canBoot: guardGoogleBoot,
    googleScroll: payload.googleScroll, onFailure: () => { updateAvailability(); render(); } });
  const umami = createUmamiLifecycle({ payload, legacyObjection,
    isSuspended: () => suspended, isHidden: () => document.hidden, gpc, dnt,
    now: () => Date.now(), setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: id => clearTimeout(id),
    createTransport: ports => createUmamiTransport({ window, document, navigator,
      enabled: config.dataset.emtalkUmamiAllowed === "true", configuration: policy.providerTransport?.umami, payload, ...ports }),
    onAvailability: updateAvailability, onRender: render });
  function updateAvailability() {
    const value = (googleActive && !transport.hasFailed()) || (umami.active() && !umami.hasFailed());
    if (publicActive === value) return;
    publicActive = value; publicEpoch += 1;
    window.dispatchEvent(new CustomEvent("emtalk:analytics-availability", { detail: { active: value, epoch: publicEpoch } }));
  }
  function changeGoogle(value) {
    if (googleActive === value) return;
    googleActive = value;
    // Legacy event remains Google-consent-only; public callers use availability.
    window.dispatchEvent(new CustomEvent("emtalk:analytics-consent", { detail: { active: value } }));
    updateAvailability();
  }
  function revokeGoogle() { transport.revoke(); changeGoogle(false); }
  function googleChoiceEligible(value) {
    return uiReady && payload.eligible && preferences.valid(value) && value.analytics &&
      !gpc() && !dnt() && !preferences.isBlocked();
  }
  function googleConsented() { choice = preferences.read(); return googleChoiceEligible(choice); }
  // Google guards intentionally read storage on every send/boot. Revocation
  // here cannot alter Umami's FIFO, lifetime, generation, or epoch.
  function guardGoogleTracking() {
    if (!googleActive || suspended || !googleConsented()) {
      if (googleActive) { revokeGoogle(); schedule(); render(); }
      return false;
    }
    return !transport.hasFailed();
  }
  function guardGoogleBoot() { return guardGoogleTracking(); }
  function guardPublicTracking() {
    const google = guardGoogleTracking(), immediate = umami.canSend();
    return google || immediate;
  }
  function emit(name, params = {}) {
    const google = guardGoogleTracking(), immediate = umami.canSend();
    if (!google && !immediate) return false;
    let value; try { value = payload.validate(name, params); } catch { return false; }
    if (!value) return false;
    const umamiAccepted = immediate && umami.emit(name, value);
    const googleAccepted = google && (name !== "page_view" || transport.pageviewStatus() === "none") &&
      transport.queue(name, value, payload.fields);
    return umamiAccepted || googleAccepted; // Local acceptance, never ingestion.
  }
  Object.defineProperty(window, "EmTalkAnalytics", { value: Object.freeze({ emit, canTrack: guardPublicTracking,
    epoch: () => publicEpoch, context: payload.context, product: payload.product }), writable: false, configurable: false });
  function activateGoogle() {
    if (suspended || !googleConsented()) return;
    if (!googleActive) changeGoogle(true);
    if (!transport.hasFailed()) { transport.activate(payload.fields); emit("page_view"); }
    transport.requestBoot();
  }
  function schedule() {
    if (timer !== null) clearTimeout(timer); timer = null;
    if (preferences.valid(choice)) timer = setTimeout(refresh, Math.min(2147483647, Math.max(1, choice.at + preferences.lifetime - Date.now())));
  }
  function recoveryNotice() {
    const messages = [];
    if (transport.hasFailed()) messages.push("Google Analytics could not load. Open Privacy choices and choose Allow Google Analytics to retry. Every feature still works.");
    return messages.join(" ");
  }
  function umamiRecoveryNotice() {
    const legacyState = umami.legacyState();
    if (legacyState.unreadable) return "Cookieless statistics are paused because this browser cannot read the earlier privacy-choice record. Google Analytics choices are separate.";
    if (legacyState.blocked) return "Your earlier joint privacy rejection is still respected for cookieless statistics until its original expiry. Google Analytics choices do not change that earlier objection.";
    if (!umami.hasFailed()) return "";
    return umami.retryUsed() ? "Cookieless Umami statistics could not load. A new visit can try again. Every feature still works." :
      "Cookieless Umami statistics could not load. One independent retry is pending when this page is visible. Every feature still works.";
  }
  function render() { ui?.render(); }
  function refresh() {
    if (!googleConsented()) revokeGoogle(); else if (suspended) changeGoogle(false); else activateGoogle();
    umami.refresh(); schedule(); render();
  }
  function choose(allow) {
    if (allow && (gpc() || dnt() || !payload.eligible || !uiReady)) {
      notice = gpc() ? "Global Privacy Control is enabled. Google Analytics stays off." :
        dnt() ? "Do Not Track is enabled. Google Analytics stays off." : "Google Analytics is unavailable on this page. Every feature still works.";
      render(); return false;
    }
    if (!allow) revokeGoogle();
    notice = ""; transport.resetFailure(); choice = preferences.save(allow);
    if (!choice) {
      revokeGoogle(); notice = "Your browser could not save the Google Analytics choice. Google Analytics stays off. You can keep using the website.";
      schedule(); render(); return false;
    }
    if (preferences.legacyRevocationFailed()) notice = "Your Google Analytics choice was saved on this page. Some older tabs could not be updated. Close or reload other EmTalk tabs to apply it.";
    refresh(); return true;
  }
  function mount() {
    choice = preferences.read();
    ui = createAnalyticsPrivacyUI({ document, window, preferences, canonical: payload.canonical,
      snapshot: () => ({ choice, eligible: payload.eligible, gpc: gpc(), dnt: dnt(), notice: [notice, recoveryNotice()].filter(Boolean).join(" "), umamiNotice: umamiRecoveryNotice(), cleanupFailed: transport.cleanupFailed() }),
      onRefresh: refresh, onChoose: choose });
    uiReady = ui.ready; ui.mount(); refresh();
  }
  window.addEventListener("storage", event => { if (event.key === null || event.key === preferences.key || event.key === legacyObjection.key) refresh(); });
  window.addEventListener("focus", refresh);
  window.addEventListener("pagehide", () => {
    suspended = true; transport.cancelBoot();
    if (googleConsented()) changeGoogle(false);
    else if (transport.hasConfiguration()) revokeGoogle();
    else changeGoogle(false); // Nothing remains to revoke or clean on pagehide.
    // Initial refresh and explicit Reject still clean stale Google cookies even
    // when this document never configured Google. Pagehide does not repeat it.
    umami.stop();
  });
  window.addEventListener("pageshow", () => { suspended = false; refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { transport.cancelBoot(); umami.stop(); }
    else if (document.visibilityState === "visible") refresh();
  });
  // Immediate Umami does not wait for current Google preference storage, the consent panel, or a Google
  // decision. The read-only historical joint-objection check remains mandatory.
  // Hidden documents wait until visible; staging/local remain off.
  umami.refresh();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})();
