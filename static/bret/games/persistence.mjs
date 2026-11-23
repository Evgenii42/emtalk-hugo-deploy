/* Whole-database progress ownership. Values remain opaque strings here.
 * Web Locks protect the complete page lifetime, including the initial read.
 * Without an acquired Web Lock, a writable visit uses memory only. A readable
 * saved snapshot can seed the visit, but no unlocked writer may replace it.
 * The raw comparison under a lock also detects sequential legacy-client edits;
 * it is not a cross-protocol atomic compare-and-swap with uncooperative clients.
 */
export function createProgressStore({
  key,
  storage,
  locks,
  onConflict = () => {},
  onUnavailable = () => {},
}) {
  let active = false,
    writable = false,
    mode = "closed",
    raw = null,
    generation = 0;
  let ready = null,
    resolveReady = null,
    release = null,
    requestDone = Promise.resolve();
  let conflictNotified = false,
    unavailableNotified = false;
  // Undefined means no visit-only snapshot yet; null is a valid empty snapshot.
  // Retain this across close/begin for the same page's BFCache lifetime only.
  let visitRaw;
  const notify = (callback) => {
    try {
      callback();
    } catch {
      /* Notification cannot break ownership or saving. */
    }
  };
  const result = () => ({ writable, raw, mode });
  const unavailable = () => {
    if (!unavailableNotified) {
      unavailableNotified = true;
      notify(onUnavailable);
    }
  };
  function read(owner, normalMode) {
    writable = owner;
    mode = normalMode;
    let failed = false;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
      if (owner) mode = "memory";
      failed = true;
    }
    if (owner && (mode === "memory" || visitRaw !== undefined)) {
      mode = "memory";
      if (visitRaw === undefined) visitRaw = raw;
      raw = visitRaw;
    }
    // Notify last: UI callbacks may close this generation or start another one.
    if (failed || (owner && mode === "memory")) unavailable();
  }
  function finishReady(token = generation) {
    if (token !== generation) return;
    const resolve = resolveReady;
    resolveReady = null;
    if (resolve) resolve(result());
  }
  function begin() {
    if (active) return ready;
    active = true;
    writable = false;
    mode = "starting";
    conflictNotified = false;
    unavailableNotified = false;
    const token = ++generation;
    ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const previous = requestDone;
    // Wait for our prior callback to release its lock before BFCache reacquisition.
    requestDone = previous
      .catch(() => {})
      .then(async () => {
        if (!active || token !== generation) return;
        if (typeof locks?.request !== "function") {
          read(true, "memory");
          finishReady(token);
          return;
        }
        try {
          await locks.request(
            `bret-progress:${key}`,
            { mode: "exclusive", ifAvailable: true },
            async (lock) => {
              if (!active || token !== generation) return;
              if (!lock) {
                read(false, "locked");
                finishReady(token);
                return;
              }
              const held = new Promise((resolve) => {
                release = resolve;
              });
              read(true, "web-lock");
              finishReady(token);
              // close() may be called by a notification during read().
              if (!active || token !== generation) {
                release?.();
                release = null;
              }
              await held;
            },
          );
        } catch {
          // An unavailable lock API permits play, never unlocked persistence.
          if (active && token === generation) {
            read(true, "memory");
            finishReady(token);
          }
        }
      });
    return ready;
  }
  function write(serializedString) {
    if (!active || !writable)
      return { ok: false, conflict: mode === "conflict" || mode === "locked" };
    if (typeof serializedString !== "string")
      throw new TypeError("Progress must be a serialized string.");
    if (mode === "memory") {
      raw = visitRaw = serializedString;
      return { ok: false, unavailable: true };
    }
    try {
      // Also catches writes made by older clients that do not acquire our lock.
      if (storage.getItem(key) !== raw) {
        writable = false;
        mode = "conflict";
        if (!conflictNotified) {
          conflictNotified = true;
          notify(onConflict);
        }
        return { ok: false, conflict: true };
      }
      storage.setItem(key, serializedString);
      raw = serializedString;
      return { ok: true };
    } catch {
      // Play can continue in memory, but the caller must not report a saved value.
      mode = "memory";
      raw = visitRaw = serializedString;
      unavailable();
      return { ok: false, unavailable: true };
    }
  }
  function close() {
    active = false;
    writable = false;
    mode = "closed";
    generation++;
    finishReady();
    const resolve = release;
    release = null;
    resolve?.();
    ready = null;
  }
  return {
    begin,
    write,
    close,
    get writable() {
      return writable;
    },
  };
}
