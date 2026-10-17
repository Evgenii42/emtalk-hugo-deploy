// Browser storage adapter. Parsing and size limits belong to the decision model.
export const STORAGE_KEY = "emtalk.dm.guest.v1";
export const HISTORY_KEY = "emtalk.dm.history.v1";

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
  function readHistory() {
    let raw,
      slot = HISTORY_KEY;
    try {
      const storage = getStorage();
      raw = storage.getItem(slot);
      if (raw === null) {
        slot = STORAGE_KEY;
        raw = storage.getItem(slot);
      }
    } catch {
      throw new HistoryProblem("read");
    }
    if (raw === null) return { schemaVersion: 1, entries: [] };
    try {
      return slot === HISTORY_KEY
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
  }

  function writeHistory(history) {
    try {
      getStorage().setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      throw new HistoryProblem(isQuotaExceeded(error) ? "quota" : "write");
    }
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

  return { readHistory, writeHistory };
}
