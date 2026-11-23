import {escapeHtml} from './dm-v2-views.js';
import {DecisionError} from './dm-v2-model.js';

// Fixed local diagnostics only. Never log the error object, message, stack,
// decision, storage contents or other user text; there is no telemetry request.
export function reportUnexpectedError(error, phase) {
  if (error instanceof DecisionError) return false;
  let name;
  try { name = error?.name; } catch { /* Never evaluate arbitrary diagnostics data. */ }
  const kind = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'SecurityError', 'NotAllowedError', 'AbortError', 'InvalidStateError', 'NotFoundError', 'QuotaExceededError'].includes(name) ? name : 'Error';
  const boundary = ['action', 'dialog-submit', 'download', 'download-cleanup', 'import-read', 'import-parse', 'import-confirm', 'import-cleanup', 'import-scope'].includes(phase) ? phase : 'unknown';
  try { globalThis.console?.error?.('EMTALK_DM_UNEXPECTED', {kind, boundary}); }
  catch { /* A diagnostics sink cannot prevent retained-draft feedback. */ }
  return true;
}

// Owns transient dialog state only. Decision validation, mutations, storage and
// toast placement remain with their existing owners. Context is a frozen copy;
// the coordinator changes reason metadata through the explicit patch operation.
export function createDialogController({appRoot, screen, onNotice}) {
  const $ = selector => appRoot.querySelector(selector);
  const dialog = $('#dialog');
  let submitCallback = null, returnFocus = null, context = null, submission = null;
  let revision = 0;
  let session = Object.freeze({}), revealReturnFocus = false;
  const pendingCloses = [];

  function contextCopy(value) {
    if (value === null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['kind', 'priority', 'deleteReasonId'].includes(key)) ||
      ('kind' in value && (typeof value.kind !== 'string' || !value.kind)) ||
      ('priority' in value && ![1, 3, 5, 8].includes(value.priority)) ||
      ('deleteReasonId' in value && (typeof value.deleteReasonId !== 'string' || !value.deleteReasonId)))
      throw new TypeError('Invalid dialog context');
    return Object.freeze({...value});
  }

  function open({title, body, accept = null, submit = null, focus = null,
    context: nextContext = null, descriptionId = null}) {
    if (descriptionId !== null && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(descriptionId))
      throw new TypeError('Invalid dialog description identifier');
    const preparedContext = contextCopy(nextContext);
    // Capture before native close: chaining must not depend on the browser's
    // synchronous focus-restoration side effect. Preserve the outer invoker.
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      returnFocus = appRoot.contains(active) ? active : screen;
      revealReturnFocus = false;
    } else if (!returnFocus?.isConnected || !appRoot.contains(returnFocus)) {
      returnFocus = screen;
      revealReturnFocus = false;
    }
    const wasOpen = dialog.open;
    revision++;
    session = Object.freeze({});
    submitCallback = submit;
    context = preparedContext;
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    $('#dialog-error').textContent = '';
    $('#dialog-status').textContent = '';
    // Complex interactive bodies stay navigable rather than being flattened
    // into one long description. Simple confirmations provide a short paragraph.
    dialog.setAttribute('aria-describedby', descriptionId ? descriptionId + ' dialog-error' : 'dialog-error');
    $('#dialog-actions').innerHTML = accept
      ? `<button type="button" class="secondary-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button accent">${escapeHtml(accept)}</button>`
      : '<button type="button" class="secondary-button full-width" data-action="close-dialog">Done</button>';
    if (!wasOpen) dialog.showModal();
    const target = focus ? dialog.querySelector(focus) : dialog.querySelector('[data-action="close-dialog"]');
    target?.focus();
  }

  function close() {
    if (!dialog.open) return;
    pendingCloses.push(revision);
    dialog.close();
  }
  function returnFocusTo(target, reveal = false) {
    returnFocus = target?.isConnected && appRoot.contains(target) ? target : screen;
    revealReturnFocus = reveal && returnFocus !== screen;
  }
  function returnFocusToScreen() { returnFocusTo(screen); }
  function patchContext(patch) {
    if (!context) return false;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some(key => !['priority', 'deleteReasonId'].includes(key)))
      throw new TypeError('Invalid dialog context update');
    context = contextCopy({...context, ...patch});
    return true;
  }

  function routeNotice(message) {
    if (submission) { submission.message = message; return true; }
    if (!dialog.open) return false;
    $('#dialog-status').textContent = message;
    $('#dialog-status').scrollIntoView({block: 'nearest', behavior: 'auto'});
    return true;
  }

  function submit(asNew = false) {
    if (!dialog.open || !submitCallback || submission) return;
    const submittedRevision = revision;
    const feedback = {message: ''};
    submission = feedback;
    try {
      const closes = submitCallback(asNew) !== false;
      submission = null;
      if (closes && revision === submittedRevision) close();
      if (feedback.message) onNotice(feedback.message);
    } catch (error) {
      $('#dialog-error').textContent = reportUnexpectedError(error, 'dialog-submit')
        ? 'Something went wrong. Your draft is still here.'
        : error?.message || 'Please try again.';
    } finally { submission = null; }
  }

  dialog.addEventListener('close', () => {
    const closedRevision = pendingCloses.length ? pendingCloses.shift() : revision;
    if (dialog.open || closedRevision !== revision) return;
    submitCallback = null;
    context = null;
    $('#dialog-status').textContent = '';
    const target = returnFocus?.isConnected && appRoot.contains(returnFocus) ? returnFocus : screen;
    target.focus({preventScroll: true});
    if (revealReturnFocus && target !== screen) target.scrollIntoView({block: 'nearest', behavior: 'auto'});
  });
  $('#dialog-form').addEventListener('submit', event => { event.preventDefault(); submit(); });

  return Object.freeze({open, close, submit, routeNotice, patchContext,
    returnFocusTo, returnFocusToScreen, get context() { return context; }, get session() { return session; }});
}
