import {DecisionError, parseDraft, serializeDraft, validateHistory} from './dm-v2-model.js';

// Storage keys remain independent of the live EmTalk workspace.
export const DRAFT_KEY = 'emtalk.dm.web-prototype.draft.v1';
export const HISTORY_KEY = 'emtalk.dm.web-prototype.history.v1';

// Resolve the native getter only inside guarded operations, never at module load.
// A blocked getter remains an actual failure; this adapter never fakes a write.
const browserStorage = Object.freeze({
  getItem: key => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: key => globalThis.localStorage.removeItem(key),
});

// Compare validated JSON values only: object key order is presentation, while
// arrays/values remain significant. This never canonicalizes stored raw tokens.
function sameHistory(left, right) {
  const ordered = (_, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
    : value;
  return JSON.stringify(left, ordered) === JSON.stringify(right, ordered);
}

// SINGLE OWNER: only this module writes recovery metadata or touches storage.
// The controller supplies draft envelopes and owns dialogs/focus, never flags.
//
// State / event                         Transition and preservation
// draft ready / changed or IO failure  Block writes; keep tab decision/baseline.
// draft unreadable / refresh changed   Keep captured bytes; suppress stale discard.
// draft blocked / explicit retry       Reread unchanged baseline before writing.
// draft unreadable / confirmed discard Exact reread/remove, then guarded persist.
// history ready / unreadable observation Block; keep memory + FIRST captured raw.
// history blocked / valid/absent repair  Keep originals; stage explicit adoption.
// Exception: with NO captured original and NO memory entries, a successful
// readable observation can populate history directly; nothing local is displaced.
// An unchanged valid observation can also recover a transient IO/write block.
// history blocked / new corruption     Keep FIRST raw; never discard its replacement.
// history pending / explicit adoption  Exact reread before releasing originals.
// history unreadable / discard         Exact reread/remove, guarded memory write.
// history write failure                Block; preserve tab copies and export path.
//
// pendingHistoryRaw: undefined means NO staged valid replacement; null means a
// confirmed observation of an ABSENT store. Empty string is unreadable data.
// loadHistory never clears the first raw backup merely because a peer repaired it.
// Draft adoption deliberately uses export-as-JSON then reload; history adoption
// is explicit here. localStorage has no atomic compare/delete or compare/set.
// Stable-state assertions run at outer public entry/exit and idle snapshots.
// Private nested transitions may temporarily hold recovery data while unblocked
// (notably memory adoption); they must finish or fail into a stable state.
// Semantic changes: inspect `node tests/dm-v2-markup-audit.mjs --inventory`, retain
// independent exact-source review, then refresh the manifest manually. No auto-accept.
function assertRecoveryState(value) {
  const raw = item => item === null || typeof item === 'string';
  const require = (condition, label) => {
    if (!condition) throw new TypeError('Invalid recovery state: ' + label);
  };
  require(raw(value.draftRaw) && raw(value.historyRaw) && raw(value.unreadableDraftRaw) && raw(value.unreadableHistoryRaw), 'raw values');
  require([value.storageBlocked, value.historyBlocked, value.draftRecoveryChanged].every(item => typeof item === 'boolean'), 'flags');
  require(value.pendingHistoryRaw === undefined || raw(value.pendingHistoryRaw), 'pending version');
  require(value.unreadableDraftRaw === null || value.storageBlocked, 'draft backup must stay blocked');
  require(!value.draftRecoveryChanged || (value.storageBlocked && value.unreadableDraftRaw !== null), 'changed draft backup');
  require(value.unreadableHistoryRaw === null || value.historyBlocked, 'history backup must stay blocked');
  require(value.pendingHistoryRaw === undefined || (value.historyBlocked && value.pendingHistoryRaw === value.historyRaw), 'staged history version');
  require(value.historyBlocked || (value.unreadableHistoryRaw === null && value.pendingHistoryRaw === undefined), 'ready history');
  require(value.history && Object.isFrozen(value.history) && Array.isArray(value.history.entries) && Object.isFrozen(value.history.entries), 'frozen history');
}
export function createLocalDecisionStore({storage = browserStorage, onWarning}) {
  // Recovery warnings are part of the caller contract; validate before any IO.
  if (typeof onWarning !== 'function') throw new TypeError('A storage warning callback is required');
  const storageWarning = (message, kind = 'draft') => onWarning(message, kind);
  function freezeHistory(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freezeHistory(child);
      Object.freeze(value);
    }
    return value;
  }
  let history = freezeHistory({schemaVersion: 1, entries: []});
  let draftRaw = null, historyRaw = null;
  let storageBlocked = false, unreadableDraftRaw = null, draftRecoveryChanged = false;
  let historyBlocked = false, unreadableHistoryRaw = null, pendingHistoryRaw;
  let transitionDepth = 0;
  function loadDraft() {
    try {
      draftRaw = storage.getItem(DRAFT_KEY);
      if (draftRaw !== null) {
        try { return parseDraft(draftRaw); }
        catch { unreadableDraftRaw = draftRaw; throw new DecisionError('Unreadable draft'); }
      }
    } catch {
      storageBlocked = true;
      storageWarning(unreadableDraftRaw !== null
        ? 'This draft could not be restored. Its stored data has been kept. Open Files & privacy to export a backup or discard the unreadable draft. You can keep working in this tab.'
        : 'Draft storage is unavailable. You can work in this tab and export your decision from Files & privacy.');
    }
    return null;
  }

  function refreshDraftRecoveryState() {
    if (unreadableDraftRaw === null) return;
    try {
      draftRecoveryChanged = storage.getItem(DRAFT_KEY) !== unreadableDraftRaw;
      if (draftRecoveryChanged) storageWarning('The stored draft changed after its backup was captured. Export the original backup and your current decision, then reload to use the other version.');
    } catch {
      draftRecoveryChanged = true;
      storageWarning('Draft storage could not be accessed. The captured backup and current decision are still in this tab. Export them before reloading.');
    }
  }

  function observeDraft() {
    try {
      if (storage.getItem(DRAFT_KEY) !== draftRaw) {
        storageBlocked = true;
        storageWarning('Your draft changed in another tab. Export your current decision as JSON, then reload to inspect the stored draft.');
      }
    } catch {
      storageBlocked = true;
      storageWarning('Draft storage could not be accessed. Export your current decision from Files & privacy.');
    }
  }

  function retryDraft(makeDraft) {
    if (!storageBlocked || unreadableDraftRaw !== null) return false;
    storageBlocked = false;
    const saved = persist(makeDraft);
    if (saved) storageWarning('', 'draft');
    return saved;
  }

  function adoptHistory(expectedRaw, saveMemory) {
    if (pendingHistoryRaw === undefined || pendingHistoryRaw !== expectedRaw || (saveMemory && (expectedRaw !== null || !history.entries.length)))
      throw new DecisionError('Saved decisions changed again. Nothing was replaced. Reopen Files & privacy after exporting copies in this tab.');
    if (storage.getItem(HISTORY_KEY) !== expectedRaw)
      throw new DecisionError('Saved decisions changed again. Nothing was replaced. Reopen Files & privacy after exporting copies in this tab.');
    if (saveMemory) {
      historyRaw = null; historyBlocked = false; writeHistory(history);
    } else {
      history = freezeHistory(expectedRaw === null ? {schemaVersion: 1, entries: []} : validateHistory(JSON.parse(expectedRaw)));
      historyRaw = expectedRaw; historyBlocked = false;
    }
    unreadableHistoryRaw = null; pendingHistoryRaw = undefined;
    storageWarning('', 'history');
  }

  function discardDraft(expectedRaw, makeDraft) {
    if (unreadableDraftRaw === null || expectedRaw !== unreadableDraftRaw)
      throw new DecisionError('The unreadable draft backup changed. Nothing was discarded. Reopen Files & privacy.');
    // Best effort synchronous compare/remove, never an atomic lock.
    if (storage.getItem(DRAFT_KEY) !== expectedRaw) {
      storageBlocked = true; draftRecoveryChanged = true;
      storageWarning('The stored draft changed. It has not been discarded. Export your current decision before reloading to use the other version.');
      throw new DecisionError('The stored draft changed. Nothing was discarded.');
    }
    storage.removeItem(DRAFT_KEY);
    draftRaw = null; unreadableDraftRaw = null; draftRecoveryChanged = false; storageBlocked = false;
    const saved = persist(makeDraft); // Own reread protects post-removal replacements.
    if (saved) storageWarning('', 'draft');
    return saved;
  }

  function discardHistory(expectedRaw) {
    if (unreadableHistoryRaw === null || expectedRaw !== unreadableHistoryRaw || pendingHistoryRaw !== undefined || historyRaw !== expectedRaw)
      throw new DecisionError('The stored saved decisions changed. Nothing was discarded. Reopen Files & privacy.');
    // No await between exact reread and removal. Competing writers remain possible.
    const stored = storage.getItem(HISTORY_KEY);
    if (stored !== expectedRaw) {
      historyBlocked = true; historyRaw = stored; loadHistory();
      storageWarning('The stored saved decisions changed. Nothing was discarded. Export copies in this tab before reloading to use the other version.', 'history');
      throw new DecisionError('The stored saved decisions changed. Nothing was discarded.');
    }
    storage.removeItem(HISTORY_KEY);
    historyRaw = null; unreadableHistoryRaw = null; historyBlocked = false;
    try { writeHistory(history); storageWarning('', 'history'); return true; }
    catch { return false; } // Copies remain in memory with the write-failure warning.
  }
  function loadHistory() {
    let raw;
    try {
      raw = storage.getItem(HISTORY_KEY);
    } catch {
      historyBlocked = true;
      storageWarning(
        'Storage could not be accessed. Existing data and any decisions already in this tab have been kept. Export your current decision from Files & privacy.',
        'history',
      );
      return false;
    }
    let next;
    try {
      next = raw === null
        ? { schemaVersion: 1, entries: [] }
        : validateHistory(JSON.parse(raw));
    } catch {
      historyRaw = raw;
      if (unreadableHistoryRaw === null) unreadableHistoryRaw = raw;
      pendingHistoryRaw = undefined;
      historyBlocked = true;
      storageWarning(
        'Stored saved decisions could not be read. Their original data has been kept. Open Files & privacy to export a backup or discard the unreadable saved data. Your current draft is separate.',
        'history',
      );
      return false;
    }
    if (
      historyBlocked && (unreadableHistoryRaw !== null ||
        (history.entries.length && !sameHistory(next, history)))
    ) {
      historyRaw = raw;
      pendingHistoryRaw = raw;
      storageWarning(
        'Stored saved decisions changed. Captured backups and any named copies in this tab are still kept. Open Files & privacy to export them before choosing the stored version.',
        'history',
      );
      return false;
    }
    historyRaw = raw;
    history = freezeHistory(next);
    unreadableHistoryRaw = null;
    pendingHistoryRaw = undefined;
    historyBlocked = false;
    storageWarning('', 'history');
    return true;
  }

  function persist(makeDraft) {
    if (storageBlocked) return false;
    let raw;
    try {
      raw = serializeDraft(makeDraft());
    } catch {
      storageWarning('This decision could not be prepared for saving. Export a copy before reloading.');
      return false;
    }
    try {
      if (storage.getItem(DRAFT_KEY) !== draftRaw) {
        storageBlocked = true;
        storageWarning(
          'This draft changed in another tab. Export your work before reloading to use the other version.',
        );
        return false;
      }
      storage.setItem(DRAFT_KEY, raw);
      draftRaw = raw;
      storageWarning('');
      return true;
    } catch {
      storageBlocked = true;
      storageWarning(
        'Your browser could not save this draft. You can continue here and export a copy from Files & privacy.',
      );
      return false;
    }
  }

  function writeHistory(next, expectedRaw = historyRaw) {
    if (historyBlocked)
      throw new DecisionError('Saving named decisions is paused. Export your current decision and any named copies from Files & privacy, then reload to retry.');
    const validated = validateHistory(next);
    const raw = JSON.stringify(validated);
    let stored;
    try {
      stored = storage.getItem(HISTORY_KEY);
    } catch {
      historyBlocked = true;
      storageWarning(
        'Storage could not be accessed. Export your current decision from Files & privacy before reloading. Named copies already in this tab have been kept.',
        'history',
      );
      throw new DecisionError('Saved-decision storage could not be accessed.');
    }
    // A dialog token can strengthen, never replace, the latest observed baseline.
    if (expectedRaw !== historyRaw || stored !== expectedRaw) {
      historyBlocked = true;
      const message = 'Saved decisions changed in another tab. Export your current work, then reload before saving.';
      storageWarning(message, 'history');
      throw new DecisionError(message);
    }
    try {
      storage.setItem(HISTORY_KEY, raw);
    } catch {
      historyBlocked = true;
      storageWarning(
        'The browser could not save named copies. Copies in this tab have been kept. Export them and your current decision from Files & privacy, then reload to retry.',
        'history',
      );
      throw new DecisionError('The browser could not save named decisions. Export your current decision and any named copies from Files & privacy, then reload to retry.');
    }
    historyRaw = raw;
    history = freezeHistory(validated);
  }


  function snapshot() {
    return {history, draftRaw, historyRaw, storageBlocked,
        unreadableDraftRaw, draftRecoveryChanged, historyBlocked,
        unreadableHistoryRaw, pendingHistoryRaw,
        draftStatus: !storageBlocked ? 'ready' : unreadableDraftRaw !== null ? 'unreadable' : 'blocked',
        historyStatus: !historyBlocked ? 'ready' : pendingHistoryRaw !== undefined ? 'replacement' : unreadableHistoryRaw !== null ? 'unreadable' : 'blocked'};
  }
  function transition(action) {
    return (...args) => {
      const outer = transitionDepth === 0;
      if (outer) assertRecoveryState(snapshot());
      transitionDepth++;
      try { return action(...args); }
      finally {
        transitionDepth--;
        if (outer) assertRecoveryState(snapshot());
      }
    };
  }
  return {
    get snapshot() {
      const value = snapshot();
      if (transitionDepth === 0) assertRecoveryState(value);
      return Object.freeze(value);
    },
    loadDraft: transition(loadDraft), loadHistory: transition(loadHistory),
    persist: transition(persist), writeHistory: transition(writeHistory),
    refreshDraftRecoveryState: transition(refreshDraftRecoveryState), observeDraft: transition(observeDraft),
    retryDraft: transition(retryDraft), adoptHistory: transition(adoptHistory),
    discardDraft: transition(discardDraft), discardHistory: transition(discardHistory),
  };
}
