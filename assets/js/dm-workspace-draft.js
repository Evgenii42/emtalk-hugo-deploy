// Owns pending persistence and recovery flags. The storage adapter alone owns
// observed-byte conflict rules; the coordinator alone owns decision/generation state.
export function createWorkspaceDraft({store, snapshot, signature, onSaved, onProblem,
  delay = 200, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout}) {
  let timer = null, blocked = false, suppressed = false, resumed = false;
  let problem = null, lastSignature = null;
  const cancelPending = () => { cancel(timer); timer = null; };
  function block(error, notify = true) {
    problem = error; blocked = true;
    if (notify) onProblem(error);
  }
  function restore(apply) {
    try {
      const value = store.readDraft();
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
  function remove(options) {
    try {
      store.deleteDraft(options);
      cancelPending(); problem = null; blocked = false; suppressed = true;
      resumed = false; lastSignature = null;
      return true;
    } catch (error) { block(error); return false; }
  }
  return Object.freeze({restore,changed,persist,flush,remove,
    get problem() { return problem; }, get suppressed() { return suppressed; }, get resumed() { return resumed; }});
}
