import {DecisionError, parseDecision, validateDecision} from './dm-v2-model.js';
import {reportUnexpectedError} from './dm-v2-dialog.js';

const invalidFile = 'This file is not a valid DOS decision. Choose an exported DOS JSON file. Your draft has not changed.';
const unreadableFile = 'This file could not be read. Try selecting it again. Your draft has not changed.';
const superseded = 'This import is no longer current. Reopen Files & privacy and choose the file again.';
function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

// One owner for asynchronous import effects. File.text itself cannot be aborted;
// generation, opaque dialog session and decision stamp suppress stale outcomes.
// The parsed decision stays private and frozen until one guarded consumption.
export function createDecisionImporter({captureOrigin, isOriginCurrent, getSession,
  isDecisionCurrent, onReading, onReady, onError, onFinished}) {
  if ([captureOrigin, isOriginCurrent, getSession, isDecisionCurrent, onReading, onReady, onError, onFinished]
    .some(callback => typeof callback !== 'function')) throw new TypeError('Import callbacks are required');
  let generation = 0, currentInput = null;

  async function read(input) {
    let origin;
    try { origin = captureOrigin(input); }
    catch (error) { reportUnexpectedError(error, 'import-scope'); return; }
    // Imports originate only from the active Files view. Leaving that view
    // cancels application effects, without writing into any replacement dialog.
    if (!origin) return;
    const operation = ++generation;
    currentInput = input;
    const current = () => {
      if (operation !== generation) return false;
      try { return isOriginCurrent(origin, input); }
      catch (error) { reportUnexpectedError(error, 'import-scope'); return false; }
    };
    try {
      let file;
      try { file = input.files?.[0]; }
      catch (error) {
        if (current()) { reportUnexpectedError(error, 'import-read'); onError(unreadableFile); }
        return;
      }
      if (!file) return;
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 200000)
        throw new DecisionError('Choose a DOS JSON file smaller than 200 KB.');
      onReading();
      let raw;
      try { raw = await file.text(); }
      catch (error) {
        if (current()) {
          reportUnexpectedError(error, 'import-read');
          onError(unreadableFile);
        }
        return;
      }
      if (!current()) return;
      let decision;
      try { decision = freezeTree(parseDecision(raw)); }
      catch (error) {
        if (!(error instanceof DecisionError) && error?.name !== 'SyntaxError')
          reportUnexpectedError(error, 'import-parse');
        onError(invalidFile);
        return;
      }
      let consumed = false, confirmationSession;
      const ticket = Object.freeze({take() {
        if (consumed || operation !== generation || getSession() !== confirmationSession || !isDecisionCurrent(origin))
          throw new DecisionError(superseded);
        consumed = true;
        return validateDecision(decision); // Fresh mutable copy; private original stays frozen.
      }});
      onReady(ticket);
      confirmationSession = getSession();
    } catch (error) {
      const unexpected = reportUnexpectedError(error, 'import-confirm');
      if (current()) onError(unexpected ? 'The file could not be opened. Your draft has not changed. Try selecting it again.' : error.message);
    } finally {
      // An older read cannot clear the newer selection in the same input.
      if (operation === generation && currentInput === input) {
        try { input.value = ''; }
        catch (error) { reportUnexpectedError(error, 'import-cleanup'); }
        try { onFinished(origin, input); }
        catch (error) { reportUnexpectedError(error, 'import-cleanup'); }
        currentInput = null;
      }
    }
  }
  return Object.freeze({read});
}
