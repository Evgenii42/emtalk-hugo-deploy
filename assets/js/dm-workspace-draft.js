// Owns pending persistence and recovery flags. The storage adapter alone owns
// observed-byte conflict rules; the coordinator alone owns decision/generation state.
import {DraftProblem} from './dm-storage.js';
export function createWorkspaceDraft({store, snapshot, signature, onSaved, onProblem,
  delay = 200, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout}) {
  let timer = null, blocked = false, suppressed = false, resumed = false;
  let problem = null, lastSignature = null, observationKnown = false;
  const canRetry = () => blocked && ['read','write','quota'].includes(problem?.kind);
  const cancelPending = () => { cancel(timer); timer = null; };
  function block(error, notify = true) {
    problem = error; blocked = true;
    if (notify) onProblem(error);
  }
  function restore(apply) {
    try {
      const value = store.readDraft();
      observationKnown = true;
      if (!value) return;
      apply(value);
      resumed = true;
      // A passive restore observes, rather than rewrites, the original bytes.
      lastSignature = signature(snapshot());
    } catch (error) { block(error, false); }
  }
  function persist() {
    cancelPending();
    if (blocked || suppressed) return;
    try {
      const value = snapshot(), nextSignature = signature(value);
      if (nextSignature === lastSignature) { resumed = false; return; }
      store.writeDraft(value);
      observationKnown = true;
      lastSignature = nextSignature; resumed = false;
      onSaved();
    } catch (error) { block(error); }
  }
  function changed(defer = false) {
    suppressed = false;
    if (defer) { cancelPending(); timer = schedule(persist, delay); }
    else persist();
  }
  function flush() { if (timer !== null) persist(); }
  function retry() {
    // A failure never starts an automatic retry loop or resets the adapter's
    // observed bytes. Each explicit action makes at most one guarded write.
    cancelPending();
    if (!canRetry()) return false;
    try {
      if (!observationKnown) {
        // Startup access may have failed before this tab observed any bytes.
        // Establish an empty slot, never adopt an existing draft as permission
        // to replace it with the current working decision.
        const existing = store.readDraft();
        observationKnown = true;
        if (existing !== null) throw new DraftProblem('conflict');
      }
      const value = snapshot(), nextSignature = signature(value);
      store.writeDraft(value);
      problem = null; blocked = false; suppressed = false; resumed = false;
      lastSignature = nextSignature;
      onSaved();
      return true;
    } catch (error) { block(error); return false; }
  }
  function remove(options) {
    try {
      store.deleteDraft(options);
      observationKnown = true;
      cancelPending(); problem = null; blocked = false; suppressed = true;
      resumed = false; lastSignature = null;
      return true;
    } catch (error) { block(error); return false; }
  }
  return Object.freeze({restore,changed,persist,flush,retry,remove,
    get canRetry() { return canRetry(); },
    get problem() { return problem; }, get suppressed() { return suppressed; }, get resumed() { return resumed; }});
}
