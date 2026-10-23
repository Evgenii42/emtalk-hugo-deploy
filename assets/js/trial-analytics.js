// Ephemeral telemetry only. Never reads or persists the person's work.
export function createTrialAnalytics(product, host = globalThis) {
  let generation = 0, run = null, resumeEligible = false, completedModel = false;
  const api = () => host.EmTalkAnalytics;
  const epoch = () => { try { return api()?.epoch(); } catch { return undefined; } };
  const active = () => { try { return api()?.canTrack() === true; } catch { return false; } };
  const capture = () => ({ generation, epoch: epoch() });
  const current = token => !!token && token.generation === generation &&
    token.epoch === epoch() && active();
  // This acknowledgement is local queue acceptance, never provider delivery.
  // Run latches avoid duplicate commands without recording delivery success.
  const send = (state, error_kind = "not_applicable") => {
    try { return api()?.emit("emtalk_trial_state", { product, state, error_kind }) === true; }
    catch { return false; }
  };
  function disarm() { generation++; run = null; resumeEligible = false; }
  function replacement({ unfinished = false, completed = false } = {}) {
    disarm(); completedModel = completed; resumeEligible = unfinished && !completed;
  }
  function live(token) {
    return current(token) && run && run.generation === generation &&
      run.epoch === token.epoch && !run.terminal;
  }
  const consentChanged = () => disarm();
  host.addEventListener?.("emtalk:analytics-consent", consentChanged);
  host.addEventListener?.("pagehide", consentChanged);
  return Object.freeze({
    capture, current, replacement,
    wasCompleted: () => completedModel,
    request() {
      replacement();
      const token = capture();
      if (current(token)) {
        run = { ...token, started: false, progress: false, terminal: false };
        if (!send("requested")) run = null;
      }
      return token;
    },
    started(token) {
      if (!live(token) || run.started) return;
      run.started = true;
      if (!send("started")) disarm();
    },
    advance(token) {
      if (!current(token) || completedModel) return;
      if (!run && product === "dm" && resumeEligible) {
        run = { ...token, started: true, progress: false, terminal: false };
        resumeEligible = false;
        if (!send("resumed")) { disarm(); return; }
      }
      if (!live(token) || !run.started || run.progress) return;
      run.progress = true;
      if (!send("progress")) disarm();
    },
    completed(token) {
      // Product provenance survives an unmeasured completion. It must not later
      // become a false resumed run after editing/saving a completed result.
      if (!token || token.generation !== generation) return;
      const eligible = live(token) && run.started;
      completedModel = true; resumeEligible = false;
      if (!eligible) return;
      run.terminal = true;
      send("completed");
    },
    stopped(token) {
      if (!live(token)) return;
      run.terminal = true; resumeEligible = false; send("stopped");
    },
    failed(kind, token) {
      if (!["initialization_failed", "runtime_failed", "required_capability_failed"].includes(kind)) return;
      if (token ? !live(token) : !active()) return;
      if (run) run.terminal = true;
      resumeEligible = false; send("error", kind);
    },
    dispose() {
      disarm();
      host.removeEventListener?.("emtalk:analytics-consent", consentChanged);
      host.removeEventListener?.("pagehide", consentChanged);
    },
  });
}
