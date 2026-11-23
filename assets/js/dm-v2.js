import { createLocalIdFactory } from './dm-v2-id.js';
import {
  createDecision,
  validateDecision,
  makePairs,
  orderedResults,
  createDraft,
  parseDraft,
  serializeDraft,
  serializeDecision,
  parseDecision,
  resultsCsv,
  validateHistory,
  MAX_HISTORY,
} from './dm-v2-model.js';

// Prototype storage is intentionally independent of the live EmTalk workspace.
const DRAFT_KEY = 'emtalk.dm.web-prototype.draft.v1';
const HISTORY_KEY = 'emtalk.dm.web-prototype.history.v1';
const appRoot = document.querySelector('.dm-v2');
const assetRoot =
  (document.documentElement.dataset.mountPrefix || '') + '/dm-v2/assets/';
const $ = (selector, root = appRoot) => root.querySelector(selector);
const screen = $('#screen');
const dialog = $('#dialog');
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const image = (name, cls = '') =>
  `<img src="${assetRoot}${name}.svg" alt=""${cls ? ` class="${cls}"` : ''}>`;
const id = createLocalIdFactory();
const priorities = new Map([
  [1, 'Low'],
  [3, 'Medium'],
  [5, 'High'],
  [8, 'Essential'],
]);
const priorityLetters = new Map([
  [1, 'L'],
  [3, 'M'],
  [5, 'H'],
  [8, 'E'],
]);
const clone = (value) => JSON.parse(JSON.stringify(value));
let state = createDecision();
let pairIndex = 0;
let optionIndex = 0;
let savedEntryId = null;
let history = { schemaVersion: 1, entries: [] };
let draftRaw = null;
let historyRaw = null;
let storageBlocked = false;
let unreadableDraftRaw = null;
let historyBlocked = false;
let topicTab = 'popular';
let topicsVisible = true;
let topicsExpanded = false;
let topics = [];
let topicsStatus = 'loading';
let resultTab = 'reasons';
let choicePending = false;
let choiceTimer;
let toastTimer;
let dialogSubmit = null;
let dialogTrigger = null;
let dialogContext = null;

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4200);
}

function storageWarning(message) {
  $('#storage-warning').hidden = false;
  $('#storage-warning').textContent = message;
}

function loadLocalData() {
  try {
    draftRaw = localStorage.getItem(DRAFT_KEY);
    if (draftRaw !== null) {
      try {
        const draft = parseDraft(draftRaw);
        state = draft.decision;
        pairIndex = draft.pairIndex;
        optionIndex = draft.optionIndex;
        savedEntryId = draft.savedEntryId;
      } catch {
        unreadableDraftRaw = draftRaw;
        throw new Error('Unreadable draft');
      }
    }
  } catch {
    storageBlocked = true;
    storageWarning(
      unreadableDraftRaw !== null
        ? 'This draft could not be restored. Its stored data has been kept. Open Files & privacy to export a backup or discard the unreadable draft. You can keep working in this tab.'
        : 'Draft storage is unavailable. You can work in this tab and export your decision from Files & privacy.',
    );
  }
  try {
    historyRaw = localStorage.getItem(HISTORY_KEY);
    if (historyRaw) history = validateHistory(JSON.parse(historyRaw));
  } catch {
    historyBlocked = true;
    storageWarning(
      'Saved decisions could not be read. Their stored data has been kept. Your current decision can still be exported.',
    );
  }
}

function persist() {
  if (storageBlocked) return false;
  try {
    if (localStorage.getItem(DRAFT_KEY) !== draftRaw) {
      storageBlocked = true;
      storageWarning(
        'This draft changed in another tab. Export your work before reloading to use the other version.',
      );
      return false;
    }
    const raw = serializeDraft(
      createDraft(state, { pairIndex, optionIndex, savedEntryId }),
    );
    localStorage.setItem(DRAFT_KEY, raw);
    draftRaw = raw;
    return true;
  } catch {
    storageBlocked = true;
    storageWarning(
      'Your browser could not save this draft. You can continue here and export a copy from Files & privacy.',
    );
    return false;
  }
}

function writeHistory(next) {
  if (historyBlocked)
    throw new Error(
      'Saved decisions are unavailable. Export a file to keep this decision.',
    );
  if (localStorage.getItem(HISTORY_KEY) !== historyRaw) {
    historyBlocked = true;
    throw new Error(
      'Saved decisions changed in another tab. Export your current work, then reload before saving.',
    );
  }
  const raw = JSON.stringify(validateHistory(next));
  localStorage.setItem(HISTORY_KEY, raw);
  historyRaw = raw;
  history = next;
  renderRecent();
}

function checkpoint() {
  validateDecision(state);
  persist();
}

function openDialog({
  title,
  body,
  accept = null,
  submit = null,
  focus = null,
  context = null,
}) {
  if (dialog.open) dialog.close();
  dialogTrigger = document.activeElement;
  dialogSubmit = submit;
  dialogContext = context;
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  $('#dialog-error').textContent = '';
  $('#dialog-actions').innerHTML = accept
    ? `<button type="button" class="secondary-button" data-action="close-dialog">Cancel</button><button type="submit" class="primary-button accent">${escape(accept)}</button>`
    : `<button type="button" class="secondary-button full-width" data-action="close-dialog">Done</button>`;
  dialog.showModal();
  if (focus) $(focus, dialog)?.focus();
  else $('[data-action="close-dialog"]', dialog).focus();
}

function closeDialog() {
  dialog.close();
}

dialog.addEventListener('close', () => {
  if (dialog.open) return;
  dialogSubmit = null;
  dialogContext = null;
  (dialogTrigger?.isConnected ? dialogTrigger : screen).focus({
    preventScroll: true,
  });
});

$('#dialog-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!dialogSubmit) return;
  try {
    if (dialogSubmit() !== false) closeDialog();
  } catch (error) {
    $('#dialog-error').textContent = error.message || 'Please try again.';
  }
});

function confirmAction(title, description, accept, action) {
  openDialog({
    title,
    body: `<p>${escape(description)}</p>`,
    accept,
    submit: action,
  });
}

function balanceMarkup() {
  return `<div class="mini-balance" aria-hidden="true"><div class="balance-beam">${image('compare-ellipse2175')}<div class="balance-alternative">${image('compare-ellipse2174')}${image('compare-add-icon-medium', 'balance-plus')}</div></div>${image('compare-polygon3', 'balance-base')}</div>`;
}

function aiBanner(label = 'Find options with AI') {
  return `<button class="ai-banner" data-action="ai"><span>${label}</span><span class="ai-orb">${image('home-ic-ai')}</span></button>`;
}

function primary(label, action, disabled = false) {
  return `<button class="primary-button" data-action="${action}"${disabled ? ' disabled' : ''}>${label}</button>`;
}

function guideMarkup() {
  return `<div class="empty-guide">${image('home-dm-welcome-motif-choices', 'motif')}<h4>How to compare</h4>
    <button class="guide-row" data-action="add-option">${image('home-step-symbol')}<span><strong>Add your options</strong><small>Tap here or use + below.</small></span></button>
    <div class="guide-row">${image('home-step-symbol1')}<span><strong>Pros & Cons · 1–3 options</strong><small>List the pros and cons of each option.</small></span></div>
    <div class="guide-row">${image('home-step-symbol2')}<span><strong>Decision Matrix · 4–8 options</strong><small>Compare options two at a time to rank them.</small></span></div></div>`;
}

function topicRows() {
  const rows = topicTab === 'history' ? history.entries : topics;
  const displayed = topicsExpanded ? rows : rows.slice(0, 2);
  if (topicTab === 'popular') {
    if (topicsStatus === 'loading')
      return '<p class="history-empty" role="status">Loading Popular topics...</p>';
    if (topicsStatus === 'failed')
      return '<p class="history-empty">Popular topics could not load. You can add your own options.</p><button class="text-button" data-action="retry-topics">Try loading topics again</button>';
    if (!displayed.length)
      return '<p class="history-empty">No Popular topics are available yet. Add your own options to begin.</p>';
  }
  if (!displayed.length)
    return historyBlocked
      ? '<p class="history-empty">Saved decisions could not be read. Their stored data has been kept. You can still add your own options.</p>'
      : '<p class="history-empty">Your saved decisions will appear here. Try Popular for a starting point.</p>';
  return displayed
    .map(
      (item) =>
        `<button data-action="${topicTab === 'history' ? 'restore' : 'topic'}" data-id="${escape(item.id)}">${escape(topicTab === 'history' ? item.decision.title || 'Untitled decision' : item.title)}</button>`,
    )
    .join('');
}

function homeMarkup() {
  const count = state.options.length;
  const startText = count
    ? count <= 3
      ? 'Start Pros & Cons'
      : 'Start Decision Matrix'
    : 'Add options to start';
  return `<div class="home-view">${aiBanner()}
    ${topicsVisible ? `<section class="topics-section"><div class="section-label"><h3>Topics</h3><button class="text-button" data-action="expand-topics">${topicsExpanded ? 'Show less' : 'Show all'}</button></div><div class="topics-card"><div class="topic-tabs"><button aria-pressed="${topicTab === 'history'}" data-action="topic-tab" data-tab="history">${image('home-ic-clock')}History</button><button aria-pressed="${topicTab === 'popular'}" data-action="topic-tab" data-tab="popular">${image('home-uil-arrow-growth1')}Popular</button></div><div class="topic-list">${topicRows()}</div></div></section>` : ''}
    <section class="list-section${count ? ' has-options' : ''}"><div class="section-label"><h3>List to compare</h3><div class="list-tools"><button class="icon-button" aria-label="How to compare" data-action="help"><span class="question-icon">?</span></button><button class="icon-button${topicsVisible ? ' active-topics' : ''}" data-action="toggle-topics" aria-label="${topicsVisible ? 'Hide' : 'Show'} Topics" aria-pressed="${topicsVisible}">${image('home-topics-toggle')}</button>${count ? '<button class="icon-button" data-action="clear" aria-label="Clear all options"><span class="trash-icon"></span></button>' : ''}</div></div>
    ${count ? `<p class="count-caption">${count} of 8 options · ${count <= 3 ? 'Explore pros and cons' : `${(count * (count - 1)) / 2} pairwise comparisons`}</p><div class="option-list">${state.options.map((option) => `<div class="option-chip"><button data-action="edit-option" data-id="${option.id}" aria-label="Edit ${escape(option.title)}">${escape(option.title)}</button><button data-action="remove-option" data-id="${option.id}" aria-label="Remove ${escape(option.title)}">×</button></div>`).join('')}</div><div class="title-line"><span>${escape(state.title)}</span><button class="title-button" data-action="name">${state.title ? 'Rename' : 'Name this decision'}</button></div>` : guideMarkup()}
    <div class="bottom-actions">${primary(startText, 'start', !count)}<button class="add-button" data-action="add-option" aria-label="Add option"${count === 8 ? ' disabled' : ''}>${image('home-ic-plus')}</button></div></section></div>`;
}

function compareMarkup() {
  const pair = state.pairs[pairIndex];
  const options = pair.map((id) =>
    state.options.find((option) => option.id === id),
  );
  return `<div class="stage-view"><div class="step-meta"><span>Comparison ${pairIndex + 1} of ${state.pairs.length}</span>${pairIndex ? '<button class="text-button" data-action="undo">↶ Undo last choice</button>' : ''}</div><div class="progress-track" role="progressbar" aria-label="Comparisons completed" aria-valuemin="0" aria-valuemax="${state.pairs.length}" aria-valuenow="${pairIndex}"><span style="width:${(pairIndex / state.pairs.length) * 100}%"></span></div>
    <div class="question-block"><h3>What works<br>better for you?</h3><div class="hint-row"><p>Tap a card to choose and see the next pair.</p>${balanceMarkup()}</div></div>
    <div class="choice-pair">${options.map((option, i) => `<button class="choice-card" data-action="choose" data-id="${option.id}"><span>${escape(option.title)}</span><span class="keyboard-key" aria-hidden="true">${i + 1}</span></button>`).join('')}</div><div class="stage-footer"><span class="count-caption">One pair. One choice. Take your time.</span><button class="text-button" data-action="pause">Save & pause</button></div></div>`;
}

function reviewMarkup() {
  const ranked = orderedResults(state);
  return `<div class="stage-view"><div class="question-block"><h3>A clearer picture<br>of your options.</h3><div class="hint-row"><p>Choose up to three options to explore their pros and cons.</p>${balanceMarkup()}</div></div><div class="review-list">${ranked.map((option, i) => `<button class="review-card" data-action="select-review" data-id="${option.id}" aria-pressed="${state.selected.includes(option.id)}"><span class="select-circle">${state.selected.includes(option.id) ? '✓' : i + 1}</span><span class="review-label">${escape(option.title)}</span><span class="wins">${option.wins} ${option.wins === 1 ? 'choice' : 'choices'}</span></button>`).join('')}</div><p class="selected-count">${state.selected.length} of 3 selected</p><div class="bottom-actions">${primary('Explore Pros & Cons', 'begin-pros', !state.selected.length)}</div><div class="stage-footer"><button class="text-button" data-action="comparison-results">View comparison results</button></div></div>`;
}

function reasonRow(note) {
  return `<div class="reason-row"><button class="reason-text" data-action="edit-reason" data-id="${note.id}">${escape(note.text)}</button><button class="priority-badge" data-value="${note.priority}" data-action="priority" data-id="${note.id}" aria-label="${escape(note.text)}: ${priorities.get(note.priority)} importance, change">${priorityLetters.get(note.priority)}</button></div>`;
}

function prosMarkup() {
  const option = state.options.find(
    (o) => o.id === state.selected[optionIndex],
  );
  return `<div class="stage-view"><div class="option-nav" aria-label="Options to explore">${state.selected.map((id, i) => `<button data-action="option-tab" data-index="${i}" aria-current="${i === optionIndex}">${escape(state.options.find((o) => o.id === id).title)}</button>`).join('')}</div><h3 class="option-heading">${escape(option.title)}</h3>${aiBanner('Find pros and cons with AI')}<div class="pros-grid">${[
    'pros',
    'cons',
  ]
    .map((type) => {
      const notes = state.opinions.filter(
        (n) => n.optionId === option.id && n.type === type,
      );
      return `<section class="pros-column"><div class="section-label"><h3>${type === 'pros' ? 'Pros' : 'Cons'}</h3>${type === 'pros' ? image('pros-priority') : ''}</div><div class="reasons-card">${notes.length ? notes.map(reasonRow).join('') : `<p class="reasons-empty">What ${type === 'pros' ? 'supports' : 'makes you hesitate about'} this option?</p>`}<button class="inline-add" data-action="add-reason" data-type="${type}"><span aria-hidden="true">+</span>Add a ${type === 'pros' ? 'pro' : 'con'}</button></div></section>`;
    })
    .join(
      '',
    )}</div><p class="pros-instruction">Tap a reason to edit it. Tap its letter to set how much it matters to you.</p><div class="bottom-actions">${primary(optionIndex < state.selected.length - 1 ? 'Next option' : 'See my result', 'next-pros')}<button class="add-button" data-action="add-reason" aria-label="Add a reason">${image('pros-ic-plus')}</button></div></div>`;
}

function resultMarkup() {
  const reasonMode = resultTab === 'reasons' && state.selected.length;
  const ranked = orderedResults(state);
  const rows = reasonMode
    ? ranked
        .filter((row) => state.selected.includes(row.id))
        .sort((a, b) => b.prosCons - a.prosCons)
    : ranked;
  return `<div class="stage-view"><h3 class="result-title">Your choice,<br>a little clearer.</h3>${aiBanner('Reflect on your result with AI')}<p class="result-intro">Here’s how your options look based on what you’ve shared.</p>
    ${state.pairs.length && state.selected.length ? `<div class="result-tabs"><button data-action="result-tab" data-tab="reasons" aria-pressed="${!!reasonMode}">Pros & Cons</button><button data-action="result-tab" data-tab="comparison" aria-pressed="${!reasonMode}">Pairwise comparison</button></div>` : ''}
    <div class="result-list">${rows
      .map((row) => {
        const score = reasonMode ? row.prosCons : row.comparison;
        const notes = state.opinions.filter((n) => n.optionId === row.id);
        return `<article class="result-card"><div><strong>${escape(row.title)}</strong><span class="result-score">${score ?? 50}<small>/ 100</small></span></div><div class="result-meter" role="meter" aria-label="${escape(row.title)} ${reasonMode ? 'pros and cons' : 'pairwise'} score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score ?? 50}"><span style="width:${score ?? 50}%"></span></div><small>${reasonMode ? (notes.length ? `${notes.filter((n) => n.type === 'pros').length} pros · ${notes.filter((n) => n.type === 'cons').length} cons` : 'No reasons added. Neutral starting score.') : `${row.wins} of ${state.options.length - 1} pairwise choices`}</small>${reasonMode && notes.length ? `<details><summary>Review your reasons</summary><ul>${notes.map((n) => `<li>${n.type === 'pros' ? '+' : '−'} ${escape(n.text)} <small>${priorities.get(n.priority)} importance</small></li>`).join('')}</ul></details>` : ''}</article>`;
      })
      .join(
        '',
      )}</div><p class="result-note">${reasonMode ? 'The balance of your reasons, weighted by their importance.' : 'How often you chose each option in the pairwise comparisons.'} These scores reflect your inputs. They aren’t probabilities or instructions about what to choose.</p><div class="result-actions"><button class="secondary-button" data-action="${state.selected.length ? 'revise-pros' : 'revise-review'}">${state.selected.length ? 'Review reasons' : 'Explore reasons'}</button>${primary('Save decision', 'save')}</div></div>`;
}

function renderRecent() {
  $('#recent').innerHTML = history.entries.length
    ? history.entries
        .slice(0, 2)
        .map(
          (entry) =>
            `<button class="recent-row" data-action="restore" data-id="${entry.id}"><span><strong>${escape(entry.decision.title || 'Untitled decision')}</strong><small>${entry.decision.options.length} options · ${new Date(entry.savedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })}</small></span><span aria-hidden="true">↗</span></button>`,
        )
        .join('')
    : '<p class="history-empty-note">A fresh start. Your saved decisions will find a home here.</p>';
}

function render(focus = true) {
  const previousFocus =
    !focus && screen.contains(document.activeElement)
      ? document.activeElement
      : null;
  const focusIdentity = previousFocus?.dataset.action
    ? { ...previousFocus.dataset }
    : null;
  clearTimeout(choiceTimer);
  choicePending = false;
  const home = state.step === 'options';
  $('#app-title').textContent = home
    ? 'Decision Matrix'
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
  screen.innerHTML = {
    options: homeMarkup,
    compare: compareMarkup,
    review: reviewMarkup,
    pros: prosMarkup,
    results: resultMarkup,
  }[state.step]();
  screen.classList.remove('screen-enter');
  requestAnimationFrame(() => screen.classList.add('screen-enter'));
  for (const li of appRoot.querySelectorAll('.journey li'))
    li.classList.toggle(
      'current',
      li.dataset.stage ===
        (['pros', 'review'].includes(state.step) ? 'compare' : state.step),
    );
  renderRecent();
  if (focus) {
    screen.focus({ preventScroll: true });
    $('#app').scrollIntoView({ block: 'start', behavior: 'instant' });
  } else if (previousFocus) {
    const replacement =
      focusIdentity &&
      [...screen.querySelectorAll('[data-action]')].find((node) =>
        Object.entries(focusIdentity).every(
          ([key, value]) => node.dataset[key] === value,
        ),
      );
    (replacement || screen).focus({ preventScroll: true });
  }
}

function renderAndSave(focus = true) {
  checkpoint();
  render(focus);
}

function optionDialog(optionId = null) {
  const current = state.options.find((o) => o.id === optionId);
  if (state.options.length >= 8 && !current)
    return notify('Eight options is the maximum for one decision.');
  openDialog({
    title: current ? 'Edit your option' : 'Add an option',
    body: `<label class="form-label" for="option-input">What are you considering?</label><textarea class="form-input" id="option-input" maxlength="100" placeholder="For example, stay in my current role" rows="3" aria-describedby="dialog-error">${escape(current?.title || '')}</textarea><p class="form-help">Short or long, write it in your own words. Up to 100 characters.</p>`,
    accept: current ? 'Save changes' : 'Add option',
    focus: '#option-input',
    submit: () => {
      const value = $('#option-input').value.trim();
      if (!value) throw new Error('Give this option a name.');
      if (value.length > 100)
        throw new Error('Keep the name within 100 characters.');
      if (
        state.options.some(
          (o) =>
            o.id !== optionId && o.title.toLowerCase() === value.toLowerCase(),
        )
      )
        throw new Error('This option is already in your list.');
      if (current) current.title = value;
      else state.options.push({ id: id('o'), title: value });
      if (state.options.length >= 2) topicsExpanded = false;
      renderAndSave();
    },
  });
}

function start() {
  if (!state.options.length) return;
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
  renderAndSave();
}

function choose(optionId) {
  if (
    choicePending ||
    state.step !== 'compare' ||
    !state.pairs[pairIndex].includes(optionId)
  )
    return;
  choicePending = true;
  const chosen = screen.querySelector(
    `[data-action="choose"][data-id="${optionId}"]`,
  );
  chosen.classList.add('selected');
  screen.querySelectorAll('[data-action="choose"]').forEach((b) => {
    b.disabled = true;
  });
  state.answers[String(pairIndex)] = optionId;
  checkpoint();
  choiceTimer = setTimeout(
    () => {
      if (pairIndex < state.pairs.length - 1) pairIndex++;
      else {
        state.step = 'review';
        state.selected = orderedResults(state)
          .slice(0, 3)
          .map((o) => o.id);
      }
      renderAndSave();
    },
    matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240,
  );
}

function undo() {
  clearTimeout(choiceTimer);
  if (choicePending) delete state.answers[String(pairIndex)];
  else if (pairIndex > 0) {
    pairIndex--;
    delete state.answers[String(pairIndex)];
  }
  renderAndSave();
}

function reasonDialog(noteId = null, type = 'pros', priorityOnly = false) {
  const current = state.opinions.find((n) => n.id === noteId);
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
    focus: priorityOnly ? null : '#reason-input',
    body: `
    ${priorityOnly ? `<p>${escape(current.text)}</p>` : `<label class="form-label" for="reason-input">Your reason</label><textarea class="form-input" id="reason-input" maxlength="400" rows="3" placeholder="What matters to you?" aria-describedby="dialog-error">${escape(current?.text || '')}</textarea><label class="form-label" for="reason-type">This is a</label><select class="form-input" id="reason-type"><option value="pros"${type === 'pros' ? ' selected' : ''}>Pro</option><option value="cons"${type === 'cons' ? ' selected' : ''}>Con</option></select>`}
    <p class="form-label">Importance</p><div class="priority-legend">${[1, 3, 5, 8].map((value) => `<button type="button" data-action="set-priority" data-value="${value}" aria-pressed="${value === weight}">${priorities.get(value)}<br><strong>${priorityLetters.get(value)}</strong></button>`).join('')}</div>${current && !priorityOnly ? `<button type="button" class="text-button danger-button" data-action="remove-reason" data-id="${current.id}">Delete this reason</button>` : ''}`,
    accept: 'Save reason',
    submit: () => {
      const value = priorityOnly
        ? current.text
        : $('#reason-input').value.trim();
      if (!value) throw new Error('Write a reason before saving.');
      const data = {
        text: value,
        type: priorityOnly ? type : $('#reason-type').value,
        priority: dialogContext.priority,
      };
      if (current) Object.assign(current, data);
      else
        state.opinions.push({
          id: id('n'),
          optionId: state.selected[optionIndex],
          ...data,
        });
      renderAndSave();
    },
  });
}

function saveDialog() {
  if (!state.options.length) return notify('Add an option before saving.');
  openDialog({
    title: 'Keep this decision',
    body: '<p>Save a named copy in this browser, so you can return to it.</p><label class="form-label" for="decision-name">Decision name</label><input class="form-input" id="decision-name" maxlength="160" aria-describedby="dialog-error">',
    accept: 'Save decision',
    focus: '#decision-name',
    submit: () => {
      const title = $('#decision-name').value.trim();
      if (!title) throw new Error('Give this decision a name.');
      const current = history.entries.find((e) => e.id === savedEntryId);
      if (!current && history.entries.length >= MAX_HISTORY)
        throw new Error(
          `Your history has ${MAX_HISTORY} decisions. Export a file or remove an old decision first.`,
        );
      const entryId = current?.id || id('d');
      const decision = validateDecision({ ...clone(state), title });
      const entry = { id: entryId, savedAt: Date.now(), decision };
      const next = {
        schemaVersion: 1,
        entries: [entry, ...history.entries.filter((e) => e.id !== entryId)],
      };
      writeHistory(next);
      savedEntryId = entryId;
      state.title = title;
      checkpoint();
      render(false);
      notify('Decision saved on this device.');
    },
  });
  $('#decision-name').value = state.title || '';
}

function historyDialog() {
  openDialog({
    title: 'Your decisions',
    body: `<p class="form-help">Saved on this device only.</p>${history.entries.length ? history.entries.map((e) => `<button type="button" class="dialog-topic" data-action="restore" data-id="${e.id}"><strong>${escape(e.decision.title || 'Untitled decision')}</strong><small>${e.decision.options.length} options · ${new Date(e.savedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}</small></button><div class="history-actions"><button type="button" data-action="export-saved" data-id="${e.id}">Export JSON</button><button type="button" data-action="delete-saved" data-id="${e.id}">Delete</button></div>`).join('') : '<p class="dialog-note">Your saved decisions will appear here. Start with a decision, then use Save to keep a named copy.</p>'}`,
  });
}

function replaceDecision(decision, cursor = {}) {
  clearTimeout(choiceTimer);
  state = validateDecision(decision);
  pairIndex = cursor.pairIndex || 0;
  if (state.step === 'compare') {
    const next = state.pairs.findIndex(
      (_, i) => !Object.hasOwn(state.answers, String(i)),
    );
    if (next >= 0) pairIndex = next;
    else state.step = 'review';
  }
  optionIndex = 0;
  savedEntryId = cursor.savedEntryId || null;
  checkpoint();
  render();
}

function restore(entryId) {
  const entry = history.entries.find((e) => e.id === entryId);
  if (!entry) return;
  confirmAction(
    'Open this decision?',
    'Your current draft will be replaced. Save or export it first if you want to keep it.',
    'Open decision',
    () => replaceDecision(clone(entry.decision), { savedEntryId: entry.id }),
  );
}

function applyTopic(topicId) {
  const topic = topics.find((t) => t.id === topicId);
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
      'Choose one of the two cards. The next pair appears automatically. There is no correct answer. Use Undo to reconsider your last choice. On a keyboard, press 1 or 2.',
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
      'Pairwise scores and pros-and-cons scores answer different questions. Pairwise scores count preferences. Pros-and-cons scores use the same importance-weighted curve as the DM app. With no reasons, the score starts at 50.',
    ],
  };
  const [title, description] = messages[state.step];
  openDialog({
    title,
    body: `${balanceMarkup()}<p>${description}</p>${state.step === 'options' ? `<div class="help-steps">${guideMarkup()}</div>` : ''}<p class="dialog-note">Your choices stay in this browser. Scores describe your inputs and help you reflect. They are not predictions.</p>`,
  });
}

function filesDialog() {
  openDialog({
    title: 'Files & privacy',
    body: `<p>Your draft and saved decisions stay in this browser. Export a file to take a copy with you.</p><div class="file-actions"><button type="button" data-action="export">Export current decision · JSON</button><button type="button" data-action="csv">Export results · CSV</button><label>Import a decision · JSON<input class="file-input" type="file" id="import-file" accept="application/json,.json"></label></div>${unreadableDraftRaw !== null ? '<section><h3>Unreadable draft</h3><p>Its original stored data has been kept. Export that data and your current decision before discarding it if you want backups. The unreadable backup may need repair before it can be imported.</p><div class="file-actions"><button type="button" data-action="export-unreadable-draft">Export unreadable draft · Original data</button><button type="button" data-action="discard-unreadable-draft">Discard unreadable draft</button></div><p class="dialog-note">Discarding removes only this unreadable draft and enables saving your current decision. Named saved decisions are kept. Before discarding, we check that the stored draft still matches the unreadable data.</p></section>' : ''}<p class="dialog-note">This prototype uses local calculations. AI, sign-in and cloud sync are not connected. Draft and history storage are separate from the live EmTalk website.</p>`,
  });
}

function discardUnreadableDraft() {
  if (unreadableDraftRaw === null) return;
  const expectedRaw = unreadableDraftRaw;
  confirmAction(
    'Discard this unreadable draft?',
    'Export the original stored data and your current decision first if you need backups. Only the unreadable draft will be removed. Your current decision and named saved decisions will be kept.',
    'Discard unreadable draft',
    () => {
      // No await or other work between the final exact-value check and removal.
      // Reject a replacement observed when the user confirms the action.
      if (localStorage.getItem(DRAFT_KEY) !== expectedRaw) {
        storageBlocked = true;
        storageWarning(
          'The stored draft changed. It has not been discarded. Export your current decision before reloading to use the other version.',
        );
        throw new Error('The stored draft changed. Nothing was discarded.');
      }
      localStorage.removeItem(DRAFT_KEY);
      draftRaw = null;
      unreadableDraftRaw = null;
      storageBlocked = false;
      // persist performs its own exact-value check, protecting a new value
      // written by another tab after removal instead of overwriting it.
      const saved = persist();
      if (saved) {
        if (!historyBlocked) $('#storage-warning').hidden = true;
        notify('Unreadable draft discarded. Your current decision is saved.');
      } else notify('Unreadable draft discarded. Export your current decision to keep it.');
      dialogTrigger = screen;
    },
  );
}

function download(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function resetToOptions() {
  state.step = 'options';
  state.pairs = [];
  state.answers = {};
  state.selected = [];
  state.opinions = [];
  pairIndex = 0;
  optionIndex = 0;
  renderAndSave();
}

function back() {
  if (state.step === 'compare')
    return confirmAction(
      'Return to your options?',
      'Your comparison progress will be reset so you can edit the list.',
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
        'Your reasons and comparison progress will be reset. Save or export first to keep a copy.',
        'Return to options',
        resetToOptions,
      );
  } else if (state.step === 'results' && state.selected.length) {
    state.step = 'pros';
    optionIndex = 0;
    renderAndSave();
  } else
    confirmAction(
      'Return to your options?',
      'The comparison will be reset so you can edit the list.',
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
        body: '<div class="menu-list"><button type="button" data-action="new">New decision <span>+</span></button><button type="button" data-action="history">Saved decisions <span>↗</span></button><button type="button" data-action="files">Files & privacy <span>↗</span></button></div>',
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
    case 'name':
      return openDialog({
        title: 'Name this decision',
        body: `<label class="form-label" for="decision-name">What are you deciding?</label><input class="form-input" id="decision-name" maxlength="160" value="${escape(state.title)}">`,
        accept: 'Save name',
        focus: '#decision-name',
        submit: () => {
          state.title = $('#decision-name').value.trim();
          renderAndSave();
        },
      });
    case 'files':
      return filesDialog();
    case 'discard-unreadable-draft':
      return discardUnreadableDraft();
    case 'export-unreadable-draft':
      if (unreadableDraftRaw !== null)
        download(
          unreadableDraftRaw,
          `decision-matrix-unreadable-draft-${Date.now()}.json`,
          'application/json',
        );
      return;
    case 'export':
      download(
        serializeDecision(state),
        `decision-matrix-${Date.now()}.json`,
        'application/json',
      );
      return notify('Your decision file is ready.');
    case 'csv':
      download(
        resultsCsv(state),
        `decision-matrix-results-${Date.now()}.csv`,
        'text/csv;charset=utf-8',
      );
      return;
    case 'export-saved': {
      const e = history.entries.find((e) => e.id === el.dataset.id);
      if (e)
        download(
          serializeDecision(e.decision),
          `decision-matrix-${e.id}.json`,
          'application/json',
        );
      return;
    }
    case 'delete-saved':
      return confirmAction(
        'Delete this saved decision?',
        'This removes the named copy from this browser. Export it first if you need a backup.',
        'Delete saved copy',
        () => {
          writeHistory({
            schemaVersion: 1,
            entries: history.entries.filter((e) => e.id !== el.dataset.id),
          });
          if (savedEntryId === el.dataset.id) {
            savedEntryId = null;
            checkpoint();
          }
          render(false);
          dialogTrigger = screen;
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
      topicTab = el.dataset.tab;
      return render(false);
    case 'topic':
      return applyTopic(el.dataset.id);
    case 'retry-topics':
      return loadTopics();
    case 'ai':
      return openDialog({
        title: 'A little help getting started',
        body: `${balanceMarkup()}<p>AI assistance is available in the Decision Matrix app. This web prototype doesn’t send your decision to an AI service.</p><p>For now, you can start with a Popular topic or add your own options.</p><div class="file-actions"><a class="secondary-button" href="https://play.google.com/store/apps/details?id=org.emtalk.dm" target="_blank" rel="noopener noreferrer">Get the DM app ↗</a></div>`,
      });
    case 'add-option':
      return optionDialog();
    case 'edit-option':
      return optionDialog(el.dataset.id);
    case 'remove-option':
      state.options = state.options.filter((o) => o.id !== el.dataset.id);
      return renderAndSave();
    case 'clear':
      return confirmAction(
        'Clear all options?',
        'This clears the current list. Your named saved decisions will stay in history.',
        'Clear options',
        () => {
          state.options = [];
          state.title = '';
          renderAndSave();
        },
      );
    case 'start':
      return start();
    case 'choose':
      return choose(el.dataset.id);
    case 'undo':
      return undo();
    case 'back':
      return back();
    case 'pause':
      checkpoint();
      return notify(
        storageBlocked
          ? 'Your progress is in this tab. Export a copy to keep it.'
          : 'Draft saved. You can return to this page to continue.',
      );
    case 'select-review': {
      const id = el.dataset.id;
      if (state.selected.includes(id))
        state.selected = state.selected.filter((i) => i !== id);
      else if (state.selected.length < 3) state.selected.push(id);
      else return notify('Choose up to three options to explore further.');
      return renderAndSave(false);
    }
    case 'begin-pros':
      if (!state.selected.length) return;
      state.step = 'pros';
      optionIndex = 0;
      return renderAndSave();
    case 'option-tab':
      optionIndex = Number(el.dataset.index);
      return renderAndSave(false);
    case 'add-reason':
      return reasonDialog(null, el.dataset.type);
    case 'edit-reason':
      return reasonDialog(el.dataset.id);
    case 'priority':
      return reasonDialog(el.dataset.id, null, true);
    case 'set-priority':
      dialogContext.priority = Number(el.dataset.value);
      for (const b of dialog.querySelectorAll('[data-action="set-priority"]'))
        b.setAttribute('aria-pressed', String(b === el));
      return;
    case 'remove-reason':
      state.opinions = state.opinions.filter((n) => n.id !== el.dataset.id);
      closeDialog();
      return renderAndSave();
    case 'next-pros':
      if (optionIndex < state.selected.length - 1) optionIndex++;
      else {
        state.step = 'results';
        resultTab = 'reasons';
      }
      return renderAndSave();
    case 'comparison-results':
      state.step = 'results';
      resultTab = 'comparison';
      return renderAndSave();
    case 'result-tab':
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

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el || !appRoot.contains(el) || el.disabled) return;
  try {
    action(el.dataset.action, el);
  } catch (error) {
    notify(error.message || 'Something went wrong. Your draft is still here.');
  }
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
    choose(state.pairs[pairIndex][Number(event.key) - 1]);
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id !== 'import-file') return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 200000)
      throw new Error(
        'Choose a Decision Matrix JSON file smaller than 200 KB.',
      );
    const decision = parseDecision(await file.text());
    confirmAction(
      'Open this decision file?',
      'The file has been checked. Opening it replaces your current draft. Save or export your current decision first if you want to keep it.',
      'Open file',
      () => replaceDecision(decision),
    );
  } catch (error) {
    $('#dialog-error').textContent =
      error.message === 'Invalid decision data.'
        ? 'This file is not a valid Decision Matrix decision. Your draft has not changed.'
        : error.message;
  } finally {
    event.target.value = '';
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === DRAFT_KEY || event.key === null) {
    storageBlocked = true;
    storageWarning(
      'Your draft changed in another tab. Export your work before reloading to use the other version.',
    );
  }
  if (event.key === HISTORY_KEY || event.key === null) {
    try {
      historyRaw = localStorage.getItem(HISTORY_KEY);
      history = historyRaw
        ? validateHistory(JSON.parse(historyRaw))
        : { schemaVersion: 1, entries: [] };
      historyBlocked = false;
      renderRecent();
    } catch {
      historyBlocked = true;
    }
  }
});

loadLocalData();
if (
  state.step === 'compare' &&
  state.pairs.every((_, i) => Object.hasOwn(state.answers, String(i)))
) {
  state.step = 'review';
  state.selected = orderedResults(state)
    .slice(0, 3)
    .map((o) => o.id);
  persist();
}
render(false);
loadTopics();

async function loadTopics() {
  topicsStatus = 'loading';
  if (state.step === 'options') render(false);
  try {
    const response = await fetch(assetRoot + 'topics.json');
    if (!response.ok) throw new Error('Topics unavailable');
    const data = await response.json();
    topics = data.categories.flatMap((category) =>
      category.topics.map((topic) => ({ ...topic, category: category.label })),
    );
    topicsStatus = 'ready';
  } catch {
    topicsStatus = 'failed';
    /* The manual decision flow remains available without examples. */
  }
  if (state.step === 'options') render(false);
}
