// Browser storage adapter. Parsing and size limits belong to the decision model.
export const STORAGE_KEY = "emtalk.dm.guest.v1";
export const HISTORY_KEY = "emtalk.dm.history.v1";
export const DRAFT_KEY = "emtalk.dm.draft.v1";

export class HistoryProblem extends Error {
  constructor(kind, slot = null, raw = null) {
    super("Saved decision storage could not be used.");
    this.kind = kind;
    this.slot = slot;
    this.raw = raw;
  }
}

export function isQuotaExceeded(error) {
  // Access denial can carry a legacy numeric code too; it is not a full store.
  if (error?.name === "SecurityError") return false;
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

export function createHistoryStorage({
  getStorage,
  parseHistory,
  parseDecision,
}) {
  let observed;
  function current(kind) {
    try {
      const storage = getStorage();
      const modern = storage.getItem(HISTORY_KEY);
      return modern === null
        ? { storage, slot: STORAGE_KEY, raw: storage.getItem(STORAGE_KEY) }
        : { storage, slot: HISTORY_KEY, raw: modern };
    } catch {
      throw new HistoryProblem(kind);
    }
  }
  function remember({ slot, raw }) {
    observed = { slot, raw };
  }
  function checkObserved(snapshot) {
    if (
      observed !== undefined &&
      (snapshot.slot !== observed.slot || snapshot.raw !== observed.raw)
    ) {
      // A fresh read during a save must not silently accept another tab's edit.
      // Remember it only for the next explicit retry/refresh, never this write.
      remember(snapshot);
      throw new HistoryProblem("conflict", snapshot.slot, snapshot.raw);
    }
  }
  function readHistory() {
    const snapshot = current("read");
    const { slot, raw } = snapshot;
    let history;
    try {
      history = raw === null
        ? { schemaVersion: 1, entries: [] }
        : slot === HISTORY_KEY
          ? parseHistory(raw)
          : {
              schemaVersion: 1,
              entries: [
                { id: "legacy", savedAt: 0, decision: parseDecision(raw) },
              ],
            };
    } catch {
      // Retain the exact owned-slot text for the existing export-only recovery.
      throw new HistoryProblem("corrupt", slot, raw);
    }
    checkObserved(snapshot);
    remember(snapshot);
    return history;
  }

  function writeHistory(history) {
    let next;
    try {
      next = JSON.stringify(history);
    } catch {
      throw new HistoryProblem("write");
    }
    const snapshot = current("write");
    checkObserved(snapshot);
    try {
      snapshot.storage.setItem(HISTORY_KEY, next);
    } catch (error) {
      throw new HistoryProblem(isQuotaExceeded(error) ? "quota" : "write");
    }
    remember({ slot: HISTORY_KEY, raw: next });
    // This is a best-effort observed-byte check, not atomic cross-tab locking.
    // A failed replacement must never remove the previous single-slot save.
    // Unreadable legacy data is retained even after a successful modern write.
    try {
      const storage = getStorage();
      const legacy = storage.getItem(STORAGE_KEY);
      if (legacy !== null) parseDecision(legacy);
      storage.removeItem(STORAGE_KEY);
      return false;
    } catch {
      return true;
    }
  }

  // The workspace calls this only after its explicit owner-confirmed clear.
  // It changes no stored bytes and must not be used to retry a stale save.
  function resetHistoryObservation() {
    observed = undefined;
  }
  return { readHistory, writeHistory, resetHistoryObservation };
}

export class DraftProblem extends Error {
  constructor(kind, slot = DRAFT_KEY, raw = null) {
    super("Current decision draft storage could not be used.");
    this.kind = kind;
    this.slot = slot;
    this.raw = raw;
  }
}

// Synchronous localStorage operations never touch named history or legacy saves.
// Remember observed bytes to avoid silently replacing another tab's newer draft.
export function createDraftStorage({ getStorage, parseDraft, serializeDraft }) {
  let observed;
  function current() {
    try {
      const storage = getStorage();
      return { storage, raw: storage.getItem(DRAFT_KEY) };
    } catch {
      throw new DraftProblem("read");
    }
  }
  function parsed(raw) {
    if (raw === null) return null;
    try {
      return parseDraft(raw);
    } catch {
      throw new DraftProblem("corrupt", DRAFT_KEY, raw);
    }
  }
  function readDraft() {
    const { raw } = current();
    observed = raw;
    return parsed(raw);
  }
  function writeDraft(draft, { replaceCorruptRaw } = {}) {
    // Validate/serialize before acquiring or changing any stored bytes.
    let next;
    try {
      next = serializeDraft(draft);
      parseDraft(next);
    } catch {
      throw new DraftProblem("invalid");
    }
    const { storage, raw } = current();
    try {
      parsed(raw);
    } catch (error) {
      if (replaceCorruptRaw !== raw || typeof raw !== "string") throw error;
    }
    if (observed !== undefined && raw !== observed)
      throw new DraftProblem("conflict", DRAFT_KEY, raw);
    try {
      storage.setItem(DRAFT_KEY, next);
    } catch (error) {
      throw new DraftProblem(isQuotaExceeded(error) ? "quota" : "write");
    }
    observed = next;
  }
  function deleteDraft({ expectedRaw } = {}) {
    const { storage, raw } = current();
    if (expectedRaw !== undefined) {
      if (expectedRaw !== raw)
        throw new DraftProblem("conflict", DRAFT_KEY, raw);
    } else {
      parsed(raw);
      if (observed !== undefined && raw !== observed)
        throw new DraftProblem("conflict", DRAFT_KEY, raw);
    }
    if (raw !== null) {
      try {
        storage.removeItem(DRAFT_KEY);
      } catch {
        throw new DraftProblem("write");
      }
    }
    observed = null;
  }
  return { readDraft, writeDraft, deleteDraft };
}
