import {createDecisionImporter} from './dm-v2-import.js';
import {createDosAnalytics} from './dos-analytics.js';
import {createDialogController, reportUnexpectedError} from './dm-v2-dialog.js';
import {findToastPlacement} from './dm-v2-toast.js';
import {createLocalDecisionStore, DRAFT_KEY, HISTORY_KEY} from './dm-v2-storage.js';
import { createTopicsLoader } from './dm-v2-topics.js';
import { createDecisionViews, escapeHtml as escape, localImage, priorities, priorityLetters, formatSavedDate, decisionLabel } from './dm-v2-views.js';
import { createLocalIdFactory } from './dm-v2-id.js';
import {
  DecisionError,
  createDecision,
  validateDecision,
  makePairs,
  orderedResults,
  createDraft,
  serializeDecision,
  resultsCsv,
  MAX_HISTORY,
} from './dm-v2-model.js';
import {createEarlierWorkspaceReader} from './dm-v2-earlier.js';

// DOS storage stays separate from the earlier workspace namespaces.
const appRoot = document.querySelector('.dm-v2');
const assetRoot =
  (document.documentElement.dataset.mountPrefix || '') + '/dm-v2/assets/';
const $ = (selector, root = appRoot) => root.querySelector(selector);
const stage = $('#screen');
const dialog = $('#dialog');
const id = createLocalIdFactory();
const clone = (value) => JSON.parse(JSON.stringify(value));
let state = createDecision();
const measurement = createDosAnalytics(window);
let pairIndex = 0;
let optionIndex = 0;
let savedEntryId = null;
const localStore = createLocalDecisionStore({onWarning: storageWarning});
const storageWarnings = { draft: '', history: '' };
let topicTab = 'popular';
let topicsVisible = true;
let topicsExpanded = false;
let topicCatalog = {rows: [], status: 'loading', dataInvalid: false};
let resultTab = 'reasons';
let choicePending = false;
let choiceUndoStack = [];
let choiceTimer;
let toastTimer;
let renderedView = null;
let renderRevision = 0;
let workspaceReady = false;
let detailsDecision = null;
const expandedResultOptions = new Set();
const recoveryFreshnessNote = '<p class="dialog-note">This view is a snapshot. Close and reopen it to refresh. Before discarding or choosing a stored version, we check that the stored data still matches. Backups export the copy kept in this tab.</p>';

const dialogUi = createDialogController({appRoot, screen: stage, onNotice: notify});
const {open: openDialog, close: closeDialog, submit: submitDialog} = dialogUi;
// The reader is lazy. Only the explicit Earlier workspace data action reads old keys.
const earlierReader = createEarlierWorkspaceReader();
const earlierSnapshots = new WeakMap();
dialog.addEventListener('close', () => {
  if (!dialog.open) earlierSnapshots.delete(dialogUi.session);
});

// Snapshot values are read by the pure views only; controller owns all mutations.
function views() {
  return createDecisionViews({state, history: localStore.snapshot.history, historyBlocked: localStore.snapshot.historyStatus !== 'ready', pairIndex, optionIndex,
    topics: topicCatalog.rows, topicTab, topicsVisible, topicsExpanded,
    topicsStatus: topicCatalog.status, topicsDataInvalid: topicCatalog.dataInvalid,
    resultTab, undoCount: choiceUndoStack.length}, assetRoot);
}
const image = (name, cls = '') => localImage(assetRoot, name, cls);
const topicRows = () => views().topicRows();
const guideMarkup = () => views().guideMarkup();
const balanceMarkup = () => views().balanceMarkup();
const blockedHistoryMessage = () => views().blockedHistoryMessage();
function renderRecent() { $('#recent').innerHTML = views().recentMarkup(); }

// Re-evaluate action/header geometry rather than assuming a fixed bottom gap.
// If the viewport has no free rectangle, normal document flow is the fallback.
function placeToast(reveal = true) {
  const toast = $('#toast');
  if (!toast.classList.contains('visible')) return;
  const header = document.querySelector('.site-header');
  if (toast.classList.contains('in-flow')) {
    // Keep this notice in flow until replacement/expiry. Measuring a flow box
    // to promote it could change its wrapping under the fixed-width CSS cap.
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    toast.style.setProperty('--dm-toast-scroll-top', `${Math.max(0, headerBottom) + 12}px`);
    return;
  }
  toast.style.removeProperty('--dm-toast-bottom');
  toast.style.removeProperty('--dm-toast-left');
  toast.style.removeProperty('--dm-toast-width');
  const notice = toast.getBoundingClientRect();
  const obstacles = [...appRoot.querySelectorAll('.bottom-actions, .result-actions, .stage-footer, .step-meta, .question-block, .choice-pair, .review-list, .option-list, .title-line, .option-nav, .option-heading, .pros-grid, .pros-instruction, .result-title, .result-intro, .result-list, button, input, textarea, select, summary, .appbar, .result-note, [role="progressbar"], .result-tabs')]
    .map(bar => bar.getBoundingClientRect());
  if (header) obstacles.push(header.getBoundingClientRect());
  const viewport = {width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight};
  const placement = findToastPlacement(notice, obstacles, viewport);
  if (placement) {
    // Moving an auto-width fixed box changes its available shrink-to-fit width.
    // Keep the measured border-box width so the chosen geometry stays valid.
    toast.style.setProperty('--dm-toast-width', `${notice.width}px`);
    toast.style.setProperty('--dm-toast-bottom', `${viewport.height - placement.bottom}px`);
    toast.style.setProperty('--dm-toast-left', `${placement.left + placement.width / 2}px`);
  } else {
    toast.classList.add('in-flow');
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    toast.style.setProperty('--dm-toast-scroll-top', `${Math.max(0, headerBottom) + 12}px`);
    // Only a new notice requests reveal. Passive layout changes must not
    // pull the reader away from their manually chosen scroll position.
    // End alignment avoids adding the shared page's top scroll padding twice.
    if (reveal) toast.scrollIntoView({block: 'end', behavior: 'auto'});
  }
}
let toastPlacementQueued = false;
function queueToastPlacement() {
  if (toastPlacementQueued) return;
  toastPlacementQueued = true;
  requestAnimationFrame(() => {
    toastPlacementQueued = false;
    placeToast(false);
  });
}
window.addEventListener('resize', queueToastPlacement, {passive: true});
window.addEventListener('scroll', queueToastPlacement, {passive: true, capture: true});

function notify(message) {
  if (dialogUi.routeNotice(message)) return;
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('in-flow');
  toast.classList.add('visible');
  placeToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('visible'); toast.classList.remove('in-flow'); }, 4200);
}

function storageWarning(message, kind = 'draft') {
  storageWarnings[kind] = message;
  const labels = { draft: 'Current draft', history: 'Saved decisions' };
  const messages = Object.entries(storageWarnings)
    .filter(([, text]) => text)
    .map(([key, text]) => `${Object.hasOwn(labels, key) ? labels[key] : 'Saved data'}: ${text}`);
  $('#storage-warning').hidden = messages.length === 0;
  $('#storage-warning').textContent = messages.join('\n\n');
}

function currentDraft() { return createDraft(state, {pairIndex, optionIndex, savedEntryId}); }
function loadLocalData() {
  const draft = localStore.loadDraft();
  if (draft) {
    state = draft.decision; pairIndex = draft.pairIndex;
    optionIndex = draft.optionIndex; savedEntryId = draft.savedEntryId;
  }
  loadHistory();
  resetMeasurementOwner();
}
function resetMeasurementOwner(){measurement.replace(state,{unfinished:!['options','results'].includes(state.step),completed:state.step==='results'});}
function validMeasurementState(){try{validateDecision(state);return true;}catch{return false;}}
function loadHistory() { return localStore.loadHistory(); }
function persist() { return localStore.persist(currentDraft); }
function writeHistory(next, expectedRaw) { localStore.writeHistory(next, expectedRaw); renderRecent(); }

function checkpoint() {
  validateDecision(state);
  return persist();
}

function confirmAction(title, description, accept, action) {
  openDialog({
    title,
    body: `<p id="dialog-description">${escape(description)}</p>`,
    descriptionId: 'dialog-description',
    accept,
    submit: action,
  });
}

function otherReasonsDialog() {
  const notes = state.opinions.filter((note) => !state.selected.includes(note.optionId));
  if (!notes.length) return notify('There are no reasons outside the current selection.');
  openDialog({
    title: 'Other saved reasons',
    body: `<p>These reasons belong to options outside your current selection. They stay in your decision and JSON exports, and are not included in the current Pros & Cons results. This view is read-only.</p><ul>${notes.map((note) => `<li><strong>${escape(state.options.find((option) => option.id === note.optionId).title)}</strong>: ${note.type === 'pros' ? 'Pro' : 'Con'} · ${escape(note.text)} <small>${priorities.get(note.priority)} importance</small></li>`).join('')}</ul>`,
  });
}

// Disclosure state belongs only to this decision while viewing results.
// Capture from the old DOM before replacement; comparison mode has no panels.
function captureResultDetails() {
  if (detailsDecision !== state || state.step !== 'results') {
    detailsDecision = state;
    expandedResultOptions.clear();
    return;
  }
  for (const panel of stage.querySelectorAll('details[data-result-option-id]')) {
    if (panel.open) expandedResultOptions.add(panel.dataset.resultOptionId);
    else expandedResultOptions.delete(panel.dataset.resultOptionId);
  }
}

function render(focus = true) {
  captureResultDetails();
  // Any rerender settles an accepted choice instead of leaving an answered
  // pair on screen after cancelling its animation timer.
  if (choicePending && state.step === 'compare' && Object.hasOwn(state.answers, String(pairIndex))) {
    advanceComparison();
    checkpoint();
  }
  const previousFocus =
    !focus && stage.contains(document.activeElement)
      ? document.activeElement
      : null;
  const focusIdentity = previousFocus?.dataset.action
    ? { ...previousFocus.dataset }
    : null;
  clearTimeout(choiceTimer);
  choicePending = false;
  const home = state.step === 'options';
  $('#app-title').textContent = home
    ? 'DOS'
    : state.step === 'compare'
      ? 'Compare options'
      : state.step === 'review'
        ? 'Your comparison'
        : state.step === 'pros'
          ? 'Pros & Cons'
          : 'Your result';
  $('#back').dataset.action = home ? 'menu' : 'back';
  $('#back').setAttribute('aria-label', home ? 'Open navigation' : 'Back');
  $('#back').innerHTML = home
    ? '<span class="menu-lines" aria-hidden="true"></span>'
    : image('home-ic-arrows', 'back-arrow');
  stage.innerHTML = views().render();
  if (state.step === 'results') {
    for (const panel of stage.querySelectorAll('details[data-result-option-id]'))
      panel.open = expandedResultOptions.has(panel.dataset.resultOptionId);
  }
  if (state.step === 'compare') {
    const titles = state.pairs[pairIndex].map(optionId => state.options.find(option => option.id === optionId).title);
    stage.removeAttribute('aria-labelledby');
    stage.setAttribute('aria-label', `Comparison ${pairIndex + 1} of ${state.pairs.length}. Choose between ${titles[0]} and ${titles[1]}.`);
  } else {
    stage.removeAttribute('aria-label');
    stage.setAttribute('aria-labelledby', 'app-title');
  }
  const viewIdentity = state.step === 'compare' ? `compare:${pairIndex}`
    : state.step === 'pros' ? `pros:${optionIndex}` : state.step;
  const enter = renderedView !== viewIdentity;
  renderedView = viewIdentity;
  const revision = ++renderRevision;
  stage.classList.remove('screen-enter');
  if (enter) requestAnimationFrame(() => {
    if (revision === renderRevision) stage.classList.add('screen-enter');
  });
  for (const li of appRoot.querySelectorAll('.journey li')) {
    const current = li.dataset.stage ===
      (['pros', 'review'].includes(state.step) ? 'compare' : state.step);
    li.classList.toggle('current', current);
    if (current) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  renderRecent();
  queueToastPlacement();
  if (focus) {
    stage.focus({ preventScroll: true });
    $('#app').scrollIntoView({ block: 'start', behavior: 'auto' });
  } else if (previousFocus) {
    const replacement =
      focusIdentity &&
      [...stage.querySelectorAll('[data-action]')].find((node) =>
        Object.entries(focusIdentity).every(
          ([key, value]) => node.dataset[key] === value,
        ),
      );
    (replacement || stage).focus({ preventScroll: true });
  }
}

function renderAndSave(focus = true) {
  checkpoint();
  render(focus);
}

function mayEditOptions() {
  if (state.step === 'options') return true;
  notify('Return to your options before editing the list.');
  return false;
}

function optionDialog(optionId = null) {
  if (!mayEditOptions()) return;
  const decision = state;
  const current = state.options.find((o) => o.id === optionId);
  if (optionId && !current) return notify('This option is no longer available.');
  if (state.options.length >= 8 && !current)
    return notify('Eight options is the maximum for one decision.');
  openDialog({
    title: current ? 'Edit your option' : 'Add an option',
    body: `<label class="form-label" for="option-input">What are you considering?</label><textarea class="form-input" id="option-input" maxlength="100" placeholder="For example, stay in my current role" rows="3" aria-describedby="option-help dialog-error">${escape(current?.title || '')}</textarea><p class="form-help" id="option-help">Short or long, write it in your own words. Up to 100 characters.</p>`,
    accept: current ? 'Save changes' : 'Add option',
    focus: '#option-input',
    submit: () => {
      if (!mayEditOptions()) return false;
      if (state !== decision || (current && !state.options.includes(current)))
        throw new DecisionError('This decision changed. Close this editor and try again.');
      if (!current && state.options.length >= 8)
        throw new DecisionError('Eight options is the maximum for one decision.');
      const value = $('#option-input').value.trim();
      if (!value) throw new DecisionError('Give this option a name.');
      if (value.length > 100)
        throw new DecisionError('Keep the name within 100 characters.');
      if (
        state.options.some(
          (o) =>
            o.id !== optionId && o.title.trim().toLowerCase() === value.toLowerCase(),
        )
      )
        throw new DecisionError('This option is already in your list.');
      if (current) current.title = value;
      else state.options.push({ id: id('o'), title: value });
      if (!current && state.options.length >= 2) topicsExpanded = false;
      renderAndSave();
    },
  });
}

function start() {
  choiceUndoStack = [];
  if (!state.options.length) return;
  const metric=state.step==='options'&&validMeasurementState()?measurement.request(state):null;
  if (state.options.length <= 3) {
    state.step = 'pros';
    state.selected = state.options.map((o) => o.id);
    optionIndex = 0;
  } else {
    state.pairs = makePairs(state.options);
    state.answers = {};
    pairIndex = 0;
    state.step = 'compare';
  }
  try{renderAndSave();if(validMeasurementState())measurement.started(metric);}
  catch(error){measurement.failed(metric);throw error;}
}

function updateComparisonProgress() {
  const count = Object.keys(state.answers).length;
  const progress = stage.querySelector('[role="progressbar"]');
  if (!progress) return;
  progress.setAttribute('aria-valuenow', String(count));
  const fill = progress.querySelector('span');
  if (fill) fill.style.width = `${count / state.pairs.length * 100}%`;
}

function choose(optionId) {
  if (
    choicePending ||
    state.step !== 'compare' ||
    !state.pairs[pairIndex].includes(optionId)
  )
    return;
  const chosen = stage.querySelector(
    `[data-action="choose"][data-id="${optionId}"]`,
  );
  if (!chosen) return notify('This comparison changed. Export your current decision from Files & privacy before reloading.');
  const metric=measurement.capture(state),previous=state.answers[String(pairIndex)];
  choicePending = true;
  choiceUndoStack.push(pairIndex);
  chosen.classList.add('selected');
  const choices = [...stage.querySelectorAll('[data-action="choose"]')];
  if (choices.some(card => card.contains(document.activeElement)))
    stage.focus({preventScroll: true});
  choices.forEach((b) => {
    b.disabled = true;
  });
  state.answers[String(pairIndex)] = optionId;
  checkpoint();
  if(previous!==optionId)measurement.advance(metric);
  updateComparisonProgress();
  choiceTimer = setTimeout(
    () => handleAction(() => {
      advanceComparison();
      renderAndSave();
    }),
    matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
  );
}

function advanceComparison() {
  clearTimeout(choiceTimer);
  choicePending = false;
  resumeComparison();
}

function undo() {
  if (!choicePending && !choiceUndoStack.length && pairIndex === 0) return;
  clearTimeout(choiceTimer);
  if (choicePending) {
    delete state.answers[String(pairIndex)];
    choiceUndoStack.pop();
  } else if (choiceUndoStack.length) {
    pairIndex = choiceUndoStack.pop();
    delete state.answers[String(pairIndex)];
  }
  else if (pairIndex > 0) {
    pairIndex--;
    delete state.answers[String(pairIndex)];
  }
  renderAndSave();
}

function reasonDialog(noteId = null, type = 'pros', priorityOnly = false) {
  const metric=measurement.capture(state);
  const current = state.opinions.find((n) => n.id === noteId);
  if ((noteId || priorityOnly) && !current) return notify('This reason is no longer available. Reopen the reason list to continue.');
  if (!current && state.opinions.length >= 120)
    return notify(
      'You have reached the limit of 120 reasons. Edit an existing reason to continue.',
    );
  type = current?.type || type || 'pros';
  const weight = current?.priority || 3;
  openDialog({
    title: priorityOnly
      ? 'How much does it matter?'
      : current
        ? 'Edit your reason'
        : 'Add a reason',
    context: { priority: weight },
    focus: priorityOnly ? `[data-action="set-priority"][data-value="${weight}"]` : '#reason-input',
    body: `
    ${priorityOnly ? `<p>${escape(current.text)}</p>` : `<label class="form-label" for="reason-input">Your reason</label><textarea class="form-input" id="reason-input" maxlength="400" rows="3" placeholder="What matters to you?" aria-describedby="reason-help dialog-error">${escape(current?.text || '')}</textarea><p id="reason-help" class="form-help">Up to 400 characters.</p><label class="form-label" for="reason-type">This is a</label><select class="form-input" id="reason-type"><option value="pros"${type === 'pros' ? ' selected' : ''}>Pro</option><option value="cons"${type === 'cons' ? ' selected' : ''}>Con</option></select>`}
    <p class="form-label" id="reason-importance-label">Importance</p><div class="priority-legend" role="group" aria-labelledby="reason-importance-label">${[1, 3, 5, 8].map((value) => `<button type="button" data-action="set-priority" data-value="${value}" aria-pressed="${value === weight}">${priorities.get(value)}<br><strong>${priorityLetters.get(value)}</strong></button>`).join('')}</div>${current && !priorityOnly ? `<button type="button" class="text-button danger-button" data-action="remove-reason" data-id="${escape(current.id)}">Delete this reason</button>` : ''}`,
    accept: 'Save reason',
    submit: () => {
      const value = priorityOnly
        ? current.text
        : $('#reason-input').value.trim();
      if (!value) throw new DecisionError('Write a reason before saving.');
      if (value.length > 400) throw new DecisionError('Keep the reason within 400 characters.');
      const data = {
        text: value,
        type: priorityOnly ? type : $('#reason-type').value,
        priority: dialogUi.context.priority,
      };
      const note = current || {id: id('n'), optionId: state.selected[optionIndex]};
      const productive=!current||current.text!==data.text||current.type!==data.type||current.priority!==data.priority;
      Object.assign(note, data);
      if (!current) state.opinions.push(note);
      renderAndSave(false);
      if(productive)measurement.advance(metric);
      const action = priorityOnly ? 'priority' : 'edit-reason';
      dialogUi.returnFocusTo(stage.querySelector(`[data-action="${action}"][data-id="${note.id}"]`), true);
    },
  });
}

function saveDialog() {
  if (!state.options.length) return notify('Add an option before saving.');
  const target = localStore.snapshot.history.entries.find(entry => entry.id === savedEntryId);
  const expectedRaw = localStore.snapshot.historyRaw;
  openDialog({
    title: target ? 'Update saved decision' : 'Save a new copy',
    body: `${target ? `<p>Updating replaces your saved copy <strong>${escape(decisionLabel(target.decision.title))}</strong> with this decision. Choose Save as new copy to keep both versions.</p><button type="button" class="secondary-button" data-action="save-as-new">Save as new copy</button>` : '<p>Create a named copy of this decision in this browser.</p>'}<label class="form-label" for="decision-name">Decision name</label><input class="form-input" id="decision-name" maxlength="160" aria-describedby="decision-name-help dialog-error"><p id="decision-name-help" class="form-help">Up to 160 characters.</p>`,
    accept: target ? 'Update saved copy' : 'Save new copy',
    context: {kind: 'save-decision'},
    focus: '#decision-name',
    submit: (asNew = false) => {
      const title = $('#decision-name').value.trim();
      if (!title) throw new DecisionError('Give this decision a name.');
      if (title.length > 160) throw new DecisionError('Keep the decision name within 160 characters.');
      const update = target && !asNew;
      if (update && !localStore.snapshot.history.entries.some(entry => entry.id === target.id))
        throw new DecisionError('This saved copy changed. Reopen Saved decisions to view the current version.');
      if (!update && localStore.snapshot.history.entries.length >= MAX_HISTORY)
        throw new DecisionError(`Your history has ${MAX_HISTORY} decisions. Export a file or remove an old decision first.`);
      const entryId = update ? target.id : id('d');
      if (!update && localStore.snapshot.history.entries.some(entry => entry.id === entryId))
        throw new DecisionError('A unique saved-copy id could not be created. Try saving again.');
      const decision = validateDecision({...clone(state), title});
      writeHistory({schemaVersion: 1, entries: [{id: entryId, savedAt: Date.now(), decision},
        ...localStore.snapshot.history.entries.filter(entry => entry.id !== entryId)]}, expectedRaw);
      savedEntryId = entryId; state.title = title;
      checkpoint(); render(false);
      notify(update ? 'Saved copy updated.' : target ? 'Saved as a new copy. The earlier saved copy is unchanged.' : 'Decision saved on this device.');
    },
  });
  $('#decision-name').value = state.title || '';
}

function historyDialog() {
  if (localStore.snapshot.historyBlocked)
    return openDialog({
      title: localStore.snapshot.history.entries.length ? 'Recover named copies in this tab' : 'Saved decisions are unavailable',
      body: `<p>${escape(blockedHistoryMessage())}</p>${recoveryFreshnessNote}${historyRecoveryMarkup()}<button type="button" class="secondary-button" data-action="files">Files & privacy</button>`,
    });
  openDialog({
    title: 'Your decisions',
    body: `<p class="form-help">Saved on this device only.</p>${recoveryFreshnessNote}${localStore.snapshot.history.entries.length ? localStore.snapshot.history.entries.map((e) => `<button type="button" class="dialog-topic" data-action="restore" data-id="${escape(e.id)}"><strong>${escape(decisionLabel(e.decision.title))}</strong><small>${e.decision.options.length} options · ${formatSavedDate(e.savedAt, {day: 'numeric', month: 'short', year: 'numeric'})}</small></button><div class="history-actions"><button type="button" data-action="export-saved" data-id="${escape(e.id)}">Export JSON</button><button type="button" data-action="delete-saved" data-id="${escape(e.id)}">Delete</button></div>`).join('') : '<p class="dialog-note">Your saved decisions will appear here. Start with a decision, then use Save to keep a named copy.</p>'}`,
  });
}

function replaceDecision(decision, cursor = {}) {
  clearTimeout(choiceTimer);
  choicePending = false;
  state = validateDecision(decision);
  resetMeasurementOwner();
  resultTab = 'reasons';
  choiceUndoStack = [];
  pairIndex = cursor.pairIndex || 0;
  resumeComparison();
  optionIndex = 0;
  savedEntryId = cursor.savedEntryId || null;
  checkpoint();
  render();
}

function restore(entryId) {
  const entry = localStore.snapshot.history.entries.find((e) => e.id === entryId);
  if (!entry) return unavailableSavedDecision();
  confirmAction(
    'Open this decision?',
    'Your current draft will be replaced. Save or export it first if you want to keep it.',
    'Open decision',
    () => replaceDecision(clone(entry.decision), { savedEntryId: entry.id }),
  );
}

function unavailableSavedDecision() {
  notify('This saved decision is no longer in this tab. Reopen Saved decisions from the menu to view the current list.');
}

function applyTopic(topicId) {
  const topic = topicCatalog.rows.find((t) => t.id === topicId);
  if (!topic) return;
  const count = Math.min(8, topic.options.length);
  confirmAction(
    'Explore this topic?',
    `${topic.title} We’ll add ${count} example options for you to edit.${state.options.length ? ' This replaces your current draft.' : ''}`,
    'Use this topic',
    () => {
      const decision = createDecision();
      decision.title = topic.title;
      decision.options = topic.options
        .slice(0, 8)
        .map((title) => ({ id: id('o'), title }));
      topicsExpanded = false;
      replaceDecision(decision);
    },
  );
}

function helpDialog() {
  const messages = {
    options: [
      'A little structure for your choice',
      'Add one to eight options you’re considering. With up to three, you’ll explore pros and cons. With four or more, you’ll compare every pair first.',
    ],
    compare: [
      'Choose what works better for you',
      'Choose one of the two cards. The next pair appears automatically. There is no correct answer. Undo last choice reverses your latest choice in this tab. After reopening, Previous saved answer steps back through earlier saved answers. On a keyboard, press 1 or 2.',
    ],
    review: [
      'Take a closer look',
      'Pairwise results show how often you preferred each option. Select up to three to explore in more depth. Tied options have equal scores.',
    ],
    pros: [
      'Weigh your reasons',
      'Add the things that support this option and the things that make you hesitate. Set each reason’s importance. Low, Medium, High and Essential use weights of 1, 3, 5 and 8.',
    ],
    results: [
      'Your perspective, brought together',
      'Pairwise scores and pros-and-cons scores answer different questions. Pairwise scores count preferences. Pros-and-cons scores reflect your reasons, weighted by their importance. With no reasons, the score starts at 50.',
    ],
  };
  const [title, description] = messages[state.step];
  openDialog({
    title,
    body: `${balanceMarkup()}<p>${description}</p>${state.step === 'options' ? `<div class="help-steps">${guideMarkup()}</div>` : ''}<div class="file-actions"><button type="button" data-action="files">Files & privacy · Export or import a decision</button></div><p class="dialog-note">Your choices stay in this browser. Scores describe your inputs and help you reflect. They are not predictions.</p>`,
  });
}

function historyRecoveryMarkup() {
  const originalChanged = localStore.snapshot.unreadableHistoryRaw !== null && localStore.snapshot.historyRaw !== localStore.snapshot.unreadableHistoryRaw;
  const original = localStore.snapshot.unreadableHistoryRaw !== null
    ? `<section><h3>Unreadable saved decisions</h3><p>A copy of the original data has been kept in this tab. Export it and your current decision before discarding it if you need backups. This backup may need repair and cannot be opened as a single decision file.</p><div class="file-actions"><button type="button" data-action="export-unreadable-history">Export unreadable saved decisions · Original data</button>${localStore.snapshot.pendingHistoryRaw === undefined && !originalChanged ? '<button type="button" data-action="discard-unreadable-history">Discard unreadable saved data</button>' : ''}</div>${originalChanged && localStore.snapshot.pendingHistoryRaw === undefined ? '<p class="dialog-note">The stored data changed after this backup was captured. Export the original backup, current decision and any named copies in this tab, then reload to inspect the other stored data. The replacement will not be discarded here.</p>' : localStore.snapshot.pendingHistoryRaw === undefined ? '<p class="dialog-note">Discarding removes the unreadable saved data and tries to save any named copies already in this tab. Your current draft is separate. Close other DOS tabs first to avoid competing changes.</p>' : ''}</section>`
    : '';
  const replacement = localStore.snapshot.pendingHistoryRaw !== undefined
    ? `<section><h3>Choose your saved decisions</h3><p>The stored version changed. Any captured original backup and named copies in this tab remain available below or above. Export them before switching if you want to keep them. Your current draft stays separate.</p><div class="file-actions"><button type="button" data-action="use-stored-history">${localStore.snapshot.pendingHistoryRaw === null ? 'Use the now-empty saved history' : 'Use the stored saved decisions'}</button>${localStore.snapshot.pendingHistoryRaw === null && localStore.snapshot.history.entries.length ? '<button type="button" data-action="save-memory-history">Save named copies from this tab</button>' : ''}</div><p class="dialog-note">Each action asks for confirmation and checks the stored value again. Close other DOS tabs first to avoid competing changes.</p></section>`
    : '';
  const copies = localStore.snapshot.historyBlocked && localStore.snapshot.history.entries.length
    ? `<section><h3>Named copies in this tab</h3><p>These copies are still in memory. Export each as a decision file before reloading.</p><div class="file-actions">${localStore.snapshot.history.entries.map((e) => `<button type="button" data-action="export-saved" data-id="${escape(e.id)}">Export ${escape(decisionLabel(e.decision.title))} · JSON</button>`).join('')}</div></section>`
    : '';
  const paused = localStore.snapshot.historyBlocked
    ? '<p class="dialog-note">If saving named copies is still paused, export your current decision and copies kept in this tab, then reload to retry. We don’t automatically merge different versions or repeat a failed write.</p>'
    : '';
  return original + replacement + copies + paused;
}

function refreshDraftRecoveryState() { localStore.refreshDraftRecoveryState(); }

function draftRecoveryMarkup() {
  if (localStore.snapshot.unreadableDraftRaw === null) return '';
  return `<section><h3>Unreadable draft</h3><p>Its original stored data has been kept. Export that data and your current decision before discarding it if you want backups. The unreadable backup may need repair before it can be imported.</p><div class="file-actions"><button type="button" data-action="export-unreadable-draft">Export unreadable draft · Original data</button>${localStore.snapshot.draftRecoveryChanged ? '' : '<button type="button" data-action="discard-unreadable-draft">Discard unreadable draft</button>'}</div><p class="dialog-note">${localStore.snapshot.draftRecoveryChanged ? 'The stored draft no longer matches this backup or cannot be checked. Export the original backup and your current decision, then reload to inspect the other stored version. It will not be discarded here.' : 'Discarding removes only this unreadable draft and enables saving your current decision. Named saved decisions are kept. Before discarding, we check that the stored draft still matches the unreadable data.'}</p></section>`;
}

function earlierWorkspaceDialog() {
  const snapshot = earlierReader.capture();
  const names = {draft: 'Earlier draft', history: 'Earlier saved decisions', single: 'Earlier single decision'};
  const states = {
    'malformed-json': 'The original text could not be read as JSON.',
    'too-large': 'This copy is too large for a readable preview here.',
    'unsupported-shape': 'This copy uses a format this reader cannot preview.',
    'decoder-unavailable': 'A readable preview is unavailable in this browser.',
    'decoded-with-issues': 'Some saved-copy metadata needs review. The original backup contains every entry.',
  };
  const sections = snapshot.slots.map(slot => {
    const heading = `<h3>${names[slot.kind]}</h3>`;
    if (slot.readState === 'absent') return `<section>${heading}<p>No copy found for this website in this browser profile.</p></section>`;
    if (slot.readState === 'unavailable') return `<section>${heading}<p>Browser storage could not be read. Other copies are checked separately. Close and reopen this view after restoring access.</p></section>`;
    return `<section>${heading}<button type="button" class="secondary-button" data-action="export-earlier-original" data-kind="${slot.kind}">Export original backup</button>${states[slot.parseState] ? `<p>${states[slot.parseState]}</p>` : ''}${slot.entries.length === 0 && slot.parseState === 'decoded' ? '<p>No saved copies in this snapshot.</p>' : ''}${slot.entries.map(entry => `<details><summary>Copy ${entry.position}: ${escape(decisionLabel(entry.preview?.title))}</summary>${entry.preview ? `<p>Options</p><ul>${entry.preview.options.map(option => `<li>${escape(decisionLabel(option.title, 'Untitled option'))}</li>`).join('')}</ul><p>Reasons</p>${entry.preview.reasons.length ? `<ul>${entry.preview.reasons.map(reason => `<li>${escape(reason.text)}</li>`).join('')}</ul>` : '<p>No reasons in this preview.</p>'}` : '<p>A readable preview is unavailable for this copy.</p>'}${entry.compatibility === 'compatible' ? `<p>This copy passes the current DOS decision-file checks. Export it, then use Import a decision in Files to review and confirm opening it.</p><button type="button" class="secondary-button" data-action="export-earlier-decision" data-kind="${slot.kind}" data-position="${entry.position}">Export this decision for DOS</button>` : `<p>${entry.compatibility === 'too-large' ? 'The prepared decision-file export exceeds the current import size limit.' : 'This copy needs review before DOS can open it. Earlier unanswered comparisons may use a different format.'} Export the original backup to keep it. This reader does not repair or score it.</p>`}</details>`).join('')}</section>`;
  }).join('');
  openDialog({title: 'Earlier workspace data', context: {kind: 'earlier-workspace'},
    body: `<div class="earlier-data"><p>This read-only view checks earlier EmTalk decision data for this website in your current browser profile. It cannot look up data on another website, app, browser profile or device. It does not replace your DOS draft, change scores or write to either workspace.</p><p>This is a snapshot, not a synchronized view. Close and reopen it to check again. Separate storage reads can observe different moments.</p><p>Original backups keep the captured stored text. Draft and saved-history backups include older wrapper data; a single-decision backup may already be a decision file. Only copies that pass current checks offer a separate decision-file export. Earlier progress and saved-copy links remain in the original backup.</p>${sections}<button type="button" class="secondary-button" data-action="files">Back to Files & privacy</button></div>`,
  });
  earlierSnapshots.set(dialogUi.session, snapshot);
}

function exportEarlierCopy(el, original) {
  if (!dialog.open || dialogUi.context?.kind !== 'earlier-workspace' || !el?.isConnected || !dialog.contains(el)) return;
  const snapshot = earlierSnapshots.get(dialogUi.session);
  const slot = snapshot?.slots.find(item => item.kind === el.dataset.kind);
  if (!slot || slot.readState !== 'present') return;
  if (original) return download(slot.originalRaw, `dos-earlier-${slot.kind}-original.json`, 'application/json', 'Original backup prepared. Keep it unchanged; it may need review before import.');
  const entry = slot.entries.find(item => String(item.position) === el.dataset.position);
  if (entry?.compatibility === 'compatible' && typeof entry.portableJson === 'string')
    return download(entry.portableJson, `dos-earlier-${slot.kind}-copy-${entry.position}.json`, 'application/json', 'Decision file prepared. Use Import a decision in Files to review and confirm opening it.');
}

function filesDialog() {
  refreshDraftRecoveryState();
  if (localStore.snapshot.historyBlocked) loadHistory();
  openDialog({
    title: 'Files & privacy',
    context: {kind: 'files'},
    body: `${recoveryFreshnessNote}<p>Keep Files open while importing. Closing or changing this view cancels the import.</p><p>The DOS interface and saved-date labels are in English. Your decision text is not translated.</p><p>Your draft and saved decisions stay in this browser. Export a file to take a copy with you.</p><p>Topic display settings and the selected results tab reset when you reload. Your saved decision data is separate.</p><div class="file-actions"><button type="button" data-action="export">Export current decision · JSON</button><button type="button" data-action="csv">Export results · CSV</button><label>Import a decision · JSON<input class="file-input" type="file" id="import-file" accept="application/json,.json"></label></div><p class="dialog-note">CSV adds an apostrophe to formula-like or control-leading fields to reduce spreadsheet formula interpretation. This changes those CSV fields. Use JSON to keep your decision text unchanged.</p><section><h3>Used the earlier workspace?</h3><p>Its data stays separate. Open a read-only snapshot to preview available copies and export original backups or compatible decision files.</p><button type="button" class="secondary-button" data-action="earlier-workspace">Earlier workspace data</button></section>${draftRecoveryMarkup()}${localStore.snapshot.draftStatus === 'blocked' ? '<section><h3>Draft saving paused</h3><p>After freeing browser storage or restoring access, try saving again. We check that the stored draft is unchanged before writing. If it changed, export your current decision and reload to inspect the other version.</p><button type="button" data-action="retry-draft">Try saving draft again</button></section>' : ''}${historyRecoveryMarkup()}<p class="dialog-note">This workspace uses local calculations. AI, sign-in and cloud sync are not connected. Earlier workspace data stays separate unless you explicitly preview and export a copy. Other people using the same browser profile can access local copies; exported files are separate.</p>`,
  });
}

const historyRecoveryChangedNotice = 'Saved decisions changed. Reopen Files & privacy to see the current recovery choices.';

// Only explicit confirmed recovery actions translate these native storage errors.
// Preserve owner state/throws and keep all visitor text independent of raw errors.
function runStorageRecovery(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof DecisionError) throw error;
    let name;
    try { name = error?.name; } catch { /* Unknown failures keep the existing safe boundary. */ }
    if (!['SecurityError', 'QuotaExceededError'].includes(name)) throw error;
    reportUnexpectedError(error, 'dialog-submit');
    throw new DecisionError('Browser storage is unavailable for this recovery action. Close this confirmation and use Files & privacy to export your current decision and retained copies. Restore storage access or free space before retrying.');
  }
}

function resolveHistoryReplacement(saveMemory = false) {
  if (localStore.snapshot.pendingHistoryRaw === undefined || (saveMemory && (localStore.snapshot.pendingHistoryRaw !== null || !localStore.snapshot.history.entries.length)))
    return notify(historyRecoveryChangedNotice);
  const expectedRaw = localStore.snapshot.pendingHistoryRaw;
  confirmAction(
    saveMemory ? 'Save named copies from this tab?' : 'Use the stored saved decisions?',
    saveMemory
      ? 'This saves the named copies kept in this tab only if the saved-history store is still empty. Your current draft stays separate.'
      : 'This adopts the current stored version, which may be empty, and releases captured backups and named copies in this tab. Export them first if you want to keep them. Your current draft stays separate.',
    saveMemory ? 'Save these copies' : 'Use stored version',
    () => {
      runStorageRecovery(() => localStore.adoptHistory(expectedRaw, saveMemory));
      if (state.step === 'options') render(false);
      else renderRecent();
      dialogUi.returnFocusToScreen();
      notify(saveMemory ? 'Named copies in this tab are saved.' : 'Stored saved decisions are now in use.');
    },
  );
}

function discardUnreadableDraft() {
  if (localStore.snapshot.unreadableDraftRaw === null) return;
  refreshDraftRecoveryState();
  if (localStore.snapshot.draftRecoveryChanged)
    return notify('The stored draft changed or could not be checked. Export your backup and current decision, then reload to inspect it.');
  const expectedRaw = localStore.snapshot.unreadableDraftRaw;
  confirmAction(
    'Discard this unreadable draft?',
    'Export the original stored data and your current decision first if you need backups. Only the unreadable draft will be removed. Your current decision and named saved decisions will be kept.',
    'Discard unreadable draft',
    () => {
      const saved = runStorageRecovery(() => localStore.discardDraft(expectedRaw, currentDraft));
      notify(saved ? 'Unreadable draft discarded. Your current decision is saved.' : 'Unreadable draft discarded. Export your current decision to keep it.');
      dialogUi.returnFocusToScreen();
    },
  );
}

function discardUnreadableHistory() {
  if (localStore.snapshot.unreadableHistoryRaw === null || localStore.snapshot.pendingHistoryRaw !== undefined)
    return notify(historyRecoveryChangedNotice);
  if (localStore.snapshot.historyRaw !== localStore.snapshot.unreadableHistoryRaw)
    return notify('Stored saved data changed after the backup was captured. Export your backup and current work, then reload to inspect it.');
  const expectedRaw = localStore.snapshot.unreadableHistoryRaw;
  confirmAction(
    'Discard unreadable saved data?',
    'Export the original stored data, named copies in this tab and your current decision first if you need backups. The unreadable saved data will be removed. We will try to save any named copies already in this tab. Your current draft stays separate. Close other DOS tabs first to avoid competing changes.',
    'Discard unreadable saved data',
    () => {
      const saved = runStorageRecovery(() => localStore.discardHistory(expectedRaw));
      notify(saved ? 'Unreadable saved data discarded. Named copies in this tab are saved.' : 'Unreadable saved data discarded. Export named copies in this tab from Files & privacy to keep them.');
      if (state.step === 'options') render(false);
      else renderRecent();
      dialogUi.returnFocusToScreen();
    },
  );
}

function download(contents, filename, type, notice = 'File prepared. Check your browser downloads.') {
  let url = null, anchor = null;
  try {
    url = URL.createObjectURL(new Blob([contents], {type}));
    anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click();
    notify(notice);
    return true;
  } catch (error) {
    reportUnexpectedError(error, 'download');
    notify('A file could not be prepared. Try again, or use another browser. Your decision has not changed.');
    return false;
  } finally {
    try { anchor?.remove(); }
    catch (error) { reportUnexpectedError(error, 'download-cleanup'); }
    if (url) setTimeout(() => {
      try { URL.revokeObjectURL(url); }
      catch (error) { reportUnexpectedError(error, 'download-cleanup'); }
    }, 30000);
  }
}

function resetToOptions() {
  choiceUndoStack = [];
  state.step = 'options';
  state.pairs = [];
  state.answers = {};
  state.selected = [];
  state.opinions = [];
  pairIndex = 0;
  optionIndex = 0;
  measurement.replace(state);
  renderAndSave();
}

function changeLastComparison() {
  const index = state.pairs.length - 1;
  if (state.step !== 'review' || index < 0 || !Object.hasOwn(state.answers, String(index))) return;
  const pair = state.pairs[index];
  const winner = state.answers[String(index)];
  const options = pair.map(optionId => state.options.find(option => option.id === optionId));
  openDialog({
    title: 'Change the last comparison',
    body: `<p>Choose the option you prefer for this pair. All other comparisons, selected options and saved reasons stay as they are.</p><label class="form-label" for="comparison-choice">Preferred option</label><select class="form-input" id="comparison-choice">${options.map(option => `<option value="${escape(option.id)}"${option.id === winner ? ' selected' : ''}>${escape(option.title)}</option>`).join('')}</select>`,
    accept: 'Save comparison',
    focus: '#comparison-choice',
    submit: () => {
      const selected = $('#comparison-choice').value;
      if (!pair.includes(selected)) throw new DecisionError('Choose one of the two options.');
      state.answers[String(index)] = selected;
      choiceUndoStack = [];
      renderAndSave();
    },
  });
}

const resetOptionsWarning = 'This resets comparison progress, selected options and any reasons in the current draft. Cancel and export first to keep a copy.';
function back() {
  if (choicePending && state.step === 'compare') {
    advanceComparison();
    return renderAndSave(false);
  }
  if (state.step === 'compare')
    return confirmAction(
      'Return to your options?',
      resetOptionsWarning,
      'Return to options',
      resetToOptions,
    );
  if (state.step === 'pros') {
    if (optionIndex > 0) {
      optionIndex--;
      renderAndSave();
    } else
      confirmAction(
        'Return to your options?',
        resetOptionsWarning,
        'Return to options',
        resetToOptions,
      );
  } else if (state.step === 'results' && !state.selected.length && state.pairs.length) {
    state.step = 'review';
    renderAndSave();
  } else if (state.step === 'results' && state.selected.length) {
    state.step = 'pros';
    optionIndex = 0;
    renderAndSave();
  } else
    confirmAction(
      'Return to your options?',
      resetOptionsWarning,
      'Return to options',
      resetToOptions,
    );
}

function action(name, el) {
  switch (name) {
    case 'help':
      return helpDialog();
    case 'close-dialog':
      return closeDialog();
    case 'menu':
      return openDialog({
        title: 'Your thinking space',
        body: '<div class="menu-list"><button type="button" data-action="new">New decision <span aria-hidden="true">+</span></button><button type="button" data-action="history">Saved decisions <span aria-hidden="true">↗</span></button><button type="button" data-action="files">Files & privacy <span aria-hidden="true">↗</span></button></div>',
      });
    case 'new':
      return confirmAction(
        'Start a new decision?',
        'Your current draft will be replaced. Save or export it first if you want to keep it.',
        'Start fresh',
        () => {
          topicsVisible = true;
          topicsExpanded = false;
          replaceDecision(createDecision());
        },
      );
    case 'history':
      return historyDialog();
    case 'restore':
      return restore(el.dataset.id);
    case 'save':
      return saveDialog();
    case 'save-as-new':
      if (dialogUi.context?.kind !== 'save-decision') return;
      return submitDialog(true);
    case 'name':
      return openDialog({
        title: 'Name this decision',
        body: `<label class="form-label" for="decision-name">What are you deciding?</label><input class="form-input" id="decision-name" maxlength="160" value="${escape(state.title)}" aria-describedby="decision-name-help dialog-error"><p id="decision-name-help" class="form-help">Up to 160 characters.</p>`,
        accept: 'Save name',
        focus: '#decision-name',
        submit: () => {
          const title = $('#decision-name').value.trim();
          if (title.length > 160) throw new DecisionError('Keep the decision name within 160 characters.');
          if (title === state.title) return;
          if (!title && decisionLabel(state.title, '')) {
            const decision = state, previousTitle = state.title;
            confirmAction('Remove this draft title?',
              'Your current draft will become untitled. Named saved copies stay unchanged until you update them.',
              'Remove title', () => {
                if (state !== decision || state.title !== previousTitle)
                  throw new DecisionError('This decision changed. Close this dialog and try again.');
                state.title = '';
                renderAndSave(false);
                dialogUi.returnFocusTo(stage.querySelector('[data-action="name"]'), true);
              });
            return false;
          }
          state.title = title;
          renderAndSave(false);
          dialogUi.returnFocusTo(stage.querySelector('[data-action="name"]'), true);
        },
      });
    case 'files':
      return filesDialog();
    case 'earlier-workspace':
      return earlierWorkspaceDialog();
    case 'export-earlier-original':
      return exportEarlierCopy(el, true);
    case 'export-earlier-decision':
      return exportEarlierCopy(el, false);
    case 'other-reasons':
      return otherReasonsDialog();
    case 'discard-unreadable-draft':
      return discardUnreadableDraft();
    case 'discard-unreadable-history':
      return discardUnreadableHistory();
    case 'use-stored-history':
      return resolveHistoryReplacement();
    case 'save-memory-history':
      return resolveHistoryReplacement(true);
    case 'export-unreadable-history':
      if (localStore.snapshot.unreadableHistoryRaw !== null)
        download(
          localStore.snapshot.unreadableHistoryRaw,
          `dos-unreadable-history-${Date.now()}.json`,
          'application/json',
          'Original-data backup prepared. Check your browser downloads.',
        );
      return;
    case 'export-unreadable-draft':
      if (localStore.snapshot.unreadableDraftRaw !== null)
        download(
          localStore.snapshot.unreadableDraftRaw,
          `dos-unreadable-draft-${Date.now()}.json`,
          'application/json',
          'Original-data backup prepared. Check your browser downloads.',
        );
      return;
    case 'export':
      download(
        serializeDecision(state),
        `dos-${Date.now()}.json`,
        'application/json',
        'Your decision file is ready.',
      );
      return;
    case 'csv':
      download(
        resultsCsv(state),
        `dos-results-${Date.now()}.csv`,
        'text/csv;charset=utf-8',
      );
      return;
    case 'export-saved': {
      const e = localStore.snapshot.history.entries.find((e) => e.id === el.dataset.id);
      if (!e) return unavailableSavedDecision();
      download(
        serializeDecision(e.decision),
        `dos-${e.id}.json`,
        'application/json',
      );
      return;
    }
    case 'delete-saved':
      if (!localStore.snapshot.history.entries.some((entry) => entry.id === el.dataset.id))
        return unavailableSavedDecision();
      return confirmAction(
        'Delete this saved decision?',
        'This removes the named copy from this browser. Export it first if you need a backup.',
        'Delete saved copy',
        () => {
          if (!localStore.snapshot.history.entries.some((entry) => entry.id === el.dataset.id))
            throw new DecisionError('This saved decision is no longer available. Reopen Saved decisions from the menu to view the current list.');
          writeHistory({
            schemaVersion: 1,
            entries: localStore.snapshot.history.entries.filter((e) => e.id !== el.dataset.id),
          });
          if (savedEntryId === el.dataset.id) {
            savedEntryId = null;
            checkpoint();
          }
          render(false);
          dialogUi.returnFocusToScreen();
          notify('Saved copy deleted.');
        },
      );
    case 'toggle-topics':
      topicsVisible = !topicsVisible;
      return render(false);
    case 'expand-topics':
      topicsExpanded = !topicsExpanded;
      return render(false);
    case 'topic-tab':
      if (!['history', 'popular'].includes(el.dataset.tab)) return notify('This topic tab is not available.');
      topicTab = el.dataset.tab;
      return render(false);
    case 'topic':
      return applyTopic(el.dataset.id);
    case 'retry-topics':
      return loadTopics();
    case 'ai':
      return helpDialog();
    case 'add-option':
      return optionDialog();
    case 'edit-option':
      return optionDialog(el.dataset.id);
    case 'remove-option': {
      if (!mayEditOptions()) return;
      const decision = state;
      const optionId = el.dataset.id;
      const option = state.options.find(item => item.id === optionId);
      if (!option) return notify('This option is no longer available.');
      return confirmAction(
        'Remove this option?',
        `Remove ${option.title} from the current list?`,
        'Remove option',
        () => {
          if (!mayEditOptions()) return false;
          if (state !== decision || !state.options.includes(option))
            throw new DecisionError('This option is no longer available. Reopen the option list.');
          state.options = state.options.filter(item => item.id !== optionId);
          renderAndSave();
          dialogUi.returnFocusToScreen();
          notify('Option removed.');
        },
      );
    }
    case 'clear': {
      if (!mayEditOptions()) return;
      const decision = state;
      return confirmAction(
        'Clear all options?',
        'This clears the current option list and removes the current draft title. Your named saved decisions will stay in history.',
        'Clear options',
        () => {
          if (!mayEditOptions()) return false;
          if (state !== decision)
            throw new DecisionError('This decision changed. Close this dialog and try again.');
          state.options = [];
          state.title = '';
          renderAndSave();
        },
      );
    }
    case 'start':
      return start();
    case 'choose':
      return choose(el.dataset.id);
    case 'undo':
      return undo();
    case 'change-last-comparison':
      return changeLastComparison();
    case 'back':
      return back();
    case 'retry-draft': {
      if (!localStore.snapshot.storageBlocked || localStore.snapshot.unreadableDraftRaw !== null) return;
      const saved = localStore.retryDraft(currentDraft);
      filesDialog();
      return notify(saved ? 'Your current draft is saved.' : 'Draft saving is still paused. Export your current decision to keep it.');
    }
    case 'pause': {
      const saved = checkpoint();
      return notify(
        saved
          ? 'Draft saved. You can return to this page to continue.'
          : 'Your progress is in this tab. Export a copy to keep it.',
      );
    }
    case 'select-review': {
      const id = el.dataset.id;
      if (state.selected.includes(id))
        state.selected = state.selected.filter((i) => i !== id);
      else if (state.selected.length < 3) state.selected.push(id);
      else return notify('Choose up to three options to explore further.');
      return renderAndSave(false);
    }
    case 'begin-pros': {
      if (!state.selected.length) return;
      const metric=measurement.capture(state),before=state.step;
      state.step = 'pros';
      optionIndex = 0;
      const result=renderAndSave();
      if(before==='review'&&validMeasurementState())measurement.advance(metric);
      return result;
    }
    case 'option-tab': {
      const index = Number(el.dataset.index);
      if (!/^\d+$/.test(el.dataset.index) || !Number.isInteger(index) || index < 0 || index >= state.selected.length || state.step !== 'pros') return notify('This option is no longer available.');
      optionIndex = index;
      return renderAndSave(false);
    }
    case 'add-reason':
      return reasonDialog(null, el.dataset.type);
    case 'edit-reason':
      if (!el.dataset.id) return notify('This reason is no longer available. Reopen the reason list to continue.');
      return reasonDialog(el.dataset.id);
    case 'priority':
      return reasonDialog(el.dataset.id, null, true);
    case 'set-priority':
      if (!dialogUi.context || !priorities.has(Number(el.dataset.value))) return notify('This importance is not available.');
      dialogUi.patchContext({priority: Number(el.dataset.value)});
      for (const b of dialog.querySelectorAll('[data-action="set-priority"]'))
        b.setAttribute('aria-pressed', String(b === el));
      return;
    case 'remove-reason': {
      if (!dialog.open || !dialogUi.context) return;
      const noteId = el.dataset.id;
      if (!state.opinions.some(note => note.id === noteId)) return notify('This reason is no longer available.');
      if (dialogUi.context?.deleteReasonId !== noteId) {
        dialogUi.patchContext({deleteReasonId: noteId});
        el.textContent = 'Confirm delete reason';
        $('#dialog-status').textContent = 'Nothing has been deleted. Choose Confirm delete reason to remove it, or close this dialog to keep it.';
        return;
      }
      state.opinions = state.opinions.filter(note => note.id !== noteId);
      $('#dialog-status').textContent = '';
      closeDialog();
      renderAndSave();
      return notify('Reason deleted.');
    }
    case 'next-pros': {
      const metric=measurement.capture(state),before=state.step,previous=optionIndex;
      if (optionIndex < state.selected.length - 1) optionIndex++;
      else {
        state.step = 'results';
        resultTab = 'reasons';
      }
      const result=renderAndSave();
      if(before==='pros'&&validMeasurementState()){
        if(state.step==='results')measurement.completed(metric);
        else if(optionIndex!==previous)measurement.advance(metric);
      }
      return result;
    }
    case 'comparison-results': {
      const metric=measurement.capture(state),before=state.step;
      state.step = 'results';
      resultTab = 'comparison';
      const result=renderAndSave();
      if(before==='review'&&validMeasurementState())measurement.completed(metric);
      return result;
    }
    case 'result-tab':
      if (state.step !== 'results' || !['reasons', 'comparison'].includes(el.dataset.tab)) return notify('This result tab is not available.');
      resultTab = el.dataset.tab;
      return render(false);
    case 'revise-pros':
      state.step = 'pros';
      optionIndex = 0;
      return renderAndSave();
    case 'revise-review':
      state.step = 'review';
      return renderAndSave();
  }
}

function handleAction(callback) {
  try {
    return callback();
  } catch (error) {
    notify(reportUnexpectedError(error, 'action')
      ? 'Something went wrong. Your draft is still here.'
      : error?.message || 'Something went wrong. Your draft is still here.');
  }
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || !appRoot.contains(el) || el.disabled) return;
  handleAction(() => action(el.dataset.action, el));
});

document.addEventListener('keydown', (event) => {
  if (
    !appRoot.contains(event.target) ||
    dialog.open ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
  )
    return;
  if (state.step === 'compare' && ['1', '2'].includes(event.key)) {
    event.preventDefault();
    handleAction(() => choose(state.pairs[pairIndex][Number(event.key) - 1]));
  }
});

function importStamp() {
  return JSON.stringify([state, pairIndex, optionIndex, savedEntryId, resultTab]);
}
const decisionImport = createDecisionImporter({
  captureOrigin(input) {
    if (!dialog.open || dialogUi.context?.kind !== 'files' || $('#import-file') !== input) return null;
    return Object.freeze({session: dialogUi.session, stamp: importStamp()});
  },
  isOriginCurrent(origin, input) {
    return dialog.open && dialogUi.session === origin.session && dialogUi.context?.kind === 'files'
      && $('#import-file') === input && importStamp() === origin.stamp;
  },
  getSession: () => dialog.open ? dialogUi.session : null,
  isDecisionCurrent: origin => importStamp() === origin.stamp,
  onReading() { $('#dialog-error').textContent = ''; notify('Reading your decision file.'); },
  onReady(ticket) {
    confirmAction('Open this decision file?',
      'The file has been checked. Opening it replaces your current draft. Save or export your current decision first if you want to keep it.',
      'Open file', () => replaceDecision(ticket.take()));
  },
  onError: message => { $('#dialog-status').textContent = ''; $('#dialog-error').textContent = message; },
  onFinished(origin, input) {
    if (dialog.open && dialogUi.session === origin.session && dialogUi.context?.kind === 'files' && $('#import-file') === input)
      $('#dialog-status').textContent = '';
  },
});
document.addEventListener('change', event => {
  if (event.target.id === 'import-file') return decisionImport.read(event.target);
});

window.addEventListener('storage', (event) => {
  if (!workspaceReady) return;
  try {
    const area = event.storageArea;
    if (area && area !== localStorage) return;
  } catch { /* Let the owner's guarded read expose denied access without writing. */ }
  if (event.key === DRAFT_KEY || event.key === null) {
    localStore.observeDraft();
  }
  if (event.key === HISTORY_KEY || event.key === null) {
    loadHistory();
    // A history refresh must not cancel a pending comparison transition.
    if (state.step === 'options') render(false);
    else renderRecent();
  }
});

function focusRestoredComparison() {
  if (state.step === 'compare' &&
      [document.body, document.documentElement].includes(document.activeElement))
    stage.focus({ preventScroll: true });
}

function scheduleRestoredComparisonFocus() {
  if (state.step !== 'compare') return;
  const gate = window.EmTalkPageLoader;
  // The common page loader temporarily makes the DM subtree inert. Its signal
  // aborts only after original inert states have been restored.
  if (gate?.isPending() && !gate.signal.aborted)
    gate.signal.addEventListener('abort', focusRestoredComparison, { once: true });
  else focusRestoredComparison();
}

function resumeComparison() {
  if (state.step !== 'compare') return false;
  const next = state.pairs.findIndex((_, i) => !Object.hasOwn(state.answers, String(i)));
  if (next < 0) {
    state.step = 'review';
    state.selected = orderedResults(state).slice(0, 3).map((o) => o.id);
    return true;
  }
  const changed = pairIndex !== next;
  pairIndex = next;
  return changed;
}

function initialize() {
  workspaceReady = false;
  const app = $('#app'), startup = $('#dm-startup-status');
  // Static HTML remains explanatory even if the module itself cannot load/parse.
  // These are required core APIs; optional topic loading does not gate readiness.
  if (typeof Object.hasOwn !== 'function' || typeof dialog.showModal !== 'function') {
    app.hidden = true;
    if (startup) startup.hidden = false;
    const copy = $('#dm-startup-copy');
    if (copy) copy.textContent = 'This browser cannot open DOS. Update your browser, then reload this page.';
    return;
  }
  loadLocalData();
  if (resumeComparison()) persist();
  render(false);
  app.hidden = false;
  if (startup) startup.hidden = true;
  workspaceReady = true;
  scheduleRestoredComparisonFocus();
  return loadTopics();
}

const topicLoader = createTopicsLoader({
  url: assetRoot + 'topics.json',
  onChange(snapshot) {
    topicCatalog = snapshot;
    if (state.step === 'options') handleAction(() => render(false));
  },
});

const initialization = initialize();

function loadTopics() { return topicLoader.load(); }
