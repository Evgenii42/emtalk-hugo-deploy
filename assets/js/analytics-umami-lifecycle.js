// Independent immediate-Umami eligibility, lifecycle and bounded retry owner.
// Construction creates the transport and its before-send hook/collision state.
// Refresh gates timers, SDK loading and sending. Explicit notice inspection also
// reads the legacy record so hidden/signal-paused pages never report cached state.
export function createUmamiLifecycle({ payload, legacyObjection, isSuspended, isHidden, gpc, dnt,
  now, setTimer, clearTimer, createTransport, onAvailability, onRender }) {
  let active = false, currentEpoch = 0, retryTimer = null, retryUsed = false, legacyTimer = null;
  let legacyState = { blocked: false, unreadable: false, expiresAt: null };
  const transport = createTransport({ canSend, epoch: () => currentEpoch,
    onFailure: () => { onAvailability(); scheduleUmamiRetry(); onRender(); } });
  function umamiEligible() {
    if (!payload.umamiEligible || isSuspended() || isHidden() || gpc() || dnt()) return false;
    legacyState = legacyObjection.read(); // Fresh old-tab joint objections apply immediately.
    return !legacyState.blocked;
  }
  function scheduleLegacyExpiry() {
    if (legacyTimer !== null) clearTimer(legacyTimer); legacyTimer = null;
    // A paused eligibility check may retain an expired cached objection. Do not
    // rearm its past deadline at 1 ms while delivery eligibility is suspended.
    // Eligibility restoration performs the fresh read before starting Umami.
    if (!payload.umamiEligible || isSuspended() || isHidden() || gpc() || dnt()) return;
    if (legacyState.blocked && legacyState.expiresAt !== null) legacyTimer = setTimer(() => { refreshUmami(); onRender(); },
      Math.min(2147483647, Math.max(1, legacyState.expiresAt - now())));
  }
  function cancelUmamiRetry() { if (retryTimer !== null) clearTimer(retryTimer); retryTimer = null; }
  function stopUmami() {
    cancelUmamiRetry(); transport.revoke();
    if (active) { active = false; currentEpoch += 1; onAvailability(); }
  }
  function canSend() {
    if (!active || !umamiEligible()) { if (active) { stopUmami(); scheduleLegacyExpiry(); onRender(); } return false; }
    return !transport.hasFailed();
  }
  function scheduleUmamiRetry() {
    // At most one automatic failed-load retry per document, never tied to
    // Google Allow. A new visit has a new bounded budget. Lifecycle restoration
    // may resume a canceled load, but cannot reset a spent failure retry.
    if (retryUsed || retryTimer !== null || !transport.hasFailed() || !umamiEligible()) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      if (!umamiEligible()) { stopUmami(); return; }
      retryUsed = true; transport.resetFailure(); onAvailability(); transport.request(); onRender();
    }, 5000);
  }
  function refreshUmami() {
    const eligible = umamiEligible(); scheduleLegacyExpiry();
    if (!eligible) { stopUmami(); return; }
    if (!active) { active = true; currentEpoch += 1; onAvailability(); }
    if (transport.hasFailed()) scheduleUmamiRetry(); else transport.request();
  }

  return Object.freeze({ refresh: refreshUmami, stop: stopUmami, canSend,
    active: () => active, hasFailed: () => transport.hasFailed(), emit: (name, value) => transport.emit(name, value),
    legacyState: () => { legacyState = legacyObjection.read(); return legacyState; }, retryUsed: () => retryUsed });
}
