/* Whole-database progress ownership. Values remain opaque strings here.
 * Web Locks protect the complete page lifetime, including the initial read.
 * Without Web Locks, raw-value comparison prevents sequential stale writes.
 * That fallback is NOT an atomic interprocess compare-and-swap: two writers
 * can both read the old value before either writes. Do not promise otherwise.
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
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
      if (owner) mode = "memory";
      unavailable();
    }
  }
  function finishReady() {
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
          read(true, "optimistic");
          finishReady();
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
                finishReady();
                return;
              }
              const held = new Promise((resolve) => {
                release = resolve;
              });
              read(true, "web-lock");
              finishReady();
              // close() may be called by a notification during read().
              if (!active || token !== generation) {
                release?.();
                release = null;
              }
              await held;
            },
          );
        } catch {
          // Unsupported/denied lock APIs still permit the documented fallback.
          if (active && token === generation) {
            read(true, "optimistic");
            finishReady();
          }
        }
      });
    return ready;
  }
  function write(serializedString) {
    if (!active || !writable)
      return { ok: false, conflict: mode === "conflict" || mode === "locked" };
    if (mode === "memory") return { ok: false, unavailable: true };
    if (typeof serializedString !== "string")
      throw new TypeError("Progress must be a serialized string.");
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
