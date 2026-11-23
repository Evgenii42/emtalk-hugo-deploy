import { orderedResults } from './dm-v2-model.js';
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
// Blank optional names keep their stored bytes; only their display has a fallback.
export const decisionLabel = (title, fallback = 'Untitled decision') =>
  typeof title === 'string' && title.trim().length ? title : fallback;
export const localImage = (assetRoot, name, cls = '') =>
  `<img src="${assetRoot}${name}.svg" alt=""${cls ? ` class="${cls}"` : ''}>`;
export const priorities = new Map([
  [1, 'Low'],
  [3, 'Medium'],
  [5, 'High'],
  [8, 'Essential'],
]);
export const priorityLetters = new Map([
  [1, 'L'],
  [3, 'M'],
  [5, 'H'],
  [8, 'E'],
]);

export function formatSavedDate(value, options = {day: 'numeric', month: 'short'}) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en', options)
    : 'Date unavailable';
}

// Pure presentation of an explicit snapshot. Rendering never mutates decisions,
// reads storage, starts requests or controls focus/dialog lifecycle.
export function createDecisionViews(view, assetRoot) {
  const {state, history, historyBlocked, pairIndex, optionIndex, topics,
    topicTab, topicsVisible, topicsExpanded, topicsStatus, topicsDataInvalid,
    resultTab, undoCount} = view;
  const escape = escapeHtml;
  const image = (name, cls = '') => localImage(assetRoot, name, cls);
  function balanceMarkup() {
    return `<div class="mini-balance" aria-hidden="true"><div class="balance-beam">${image('compare-ellipse2175')}<div class="balance-alternative">${image('compare-ellipse2174')}${image('compare-add-icon-medium', 'balance-plus')}</div></div>${image('compare-polygon3', 'balance-base')}</div>`;
  }

  function aiBanner(label = 'Need a starting point?') {
    return `<button type="button" class="ai-banner" data-action="ai"><span>${label}</span><span class="ai-orb">${image('home-ic-ai')}</span></button>`;
  }

  function primary(label, action, disabled = false) {
    return `<button type="button" class="primary-button" data-action="${action}"${disabled ? ' disabled' : ''}>${label}</button>`;
  }

  function guideMarkup() {
    return `<div class="empty-guide">${image('home-dm-welcome-motif-choices', 'motif')}<h4>How to compare</h4>
    <button type="button" class="guide-row" data-action="add-option">${image('home-step-symbol')}<span><strong>Add your options</strong><small>Tap here or use + below.</small></span></button>
    <div class="guide-row">${image('home-step-symbol1')}<span><strong>Pros & Cons · 1–3 options</strong><small>List the pros and cons of each option.</small></span></div>
    <div class="guide-row">${image('home-step-symbol2')}<span><strong>Pairwise comparison · 4-8 options</strong><small>Compare options two at a time to rank them.</small></span></div></div>`;
  }

  function topicRows() {
    const rows = topicTab === 'history' ? history.entries : topics;
    const displayed = topicsExpanded ? rows : rows.slice(0, 2);
    if (topicTab === 'popular') {
      if (topicsStatus === 'loading')
        return '<p class="history-empty" role="status">Loading Popular topics...</p>';
      if (topicsStatus === 'failed')
        return `<p class="history-empty">${topicsDataInvalid ? 'Popular topics data could not be read.' : 'Popular topics could not load.'} You can add your own options.</p><button type="button" class="text-button" data-action="retry-topics">Try loading topics again</button>`;
      if (!displayed.length)
        return '<p class="history-empty">No Popular topics are available yet. Add your own options to begin.</p>';
    }
    if (historyBlocked && topicTab === 'history')
      return `<p class="history-empty">${escape(blockedHistoryMessage())}</p>`;
    if (!displayed.length)
      return '<p class="history-empty">Your saved decisions will appear here. Try Popular for a starting point.</p>';
    return displayed
      .map(
        (item) =>
          `<button type="button" data-action="${topicTab === 'history' ? 'restore' : 'topic'}" data-id="${escape(item.id)}">${escape(topicTab === 'history' ? decisionLabel(item.decision.title) : item.title)}</button>`,
      )
      .join('');
  }

  function homeMarkup() {
    const count = state.options.length;
    const canExpandTopics = topicTab === 'history' ? !historyBlocked && history.entries.length > 2 : topicsStatus === 'ready' && topics.length > 2;
    const startText = count
      ? count <= 3
        ? 'Start Pros & Cons'
        : 'Compare pairs'
      : 'Add options to start';
    return `<div class="home-view">${aiBanner()}
    ${topicsVisible ? `<section class="topics-section"><div class="section-label"><h3>Topics</h3>${canExpandTopics ? `<button type="button" class="text-button" data-action="expand-topics">${topicsExpanded ? 'Show less' : 'Show all'}</button>` : ''}</div><div class="topics-card"><div class="topic-tabs" role="group" aria-label="Topic filters"><button type="button" aria-pressed="${topicTab === 'history'}" data-action="topic-tab" data-tab="history">${image('home-ic-clock')}History</button><button type="button" aria-pressed="${topicTab === 'popular'}" data-action="topic-tab" data-tab="popular">${image('home-uil-arrow-growth1')}Popular</button></div><div class="topic-list">${topicRows()}</div></div></section>` : ''}
    <section class="list-section${count ? ' has-options' : ''}"><div class="section-label"><h3>List to compare</h3><div class="list-tools"><button type="button" class="icon-button" aria-label="How to compare" data-action="help"><span class="question-icon">?</span></button><button type="button" class="icon-button${topicsVisible ? ' active-topics' : ''}" data-action="toggle-topics" aria-label="${topicsVisible ? 'Hide' : 'Show'} Topics" aria-pressed="${topicsVisible}">${image('home-topics-toggle')}</button>${count ? '<button type="button" class="icon-button" data-action="clear" aria-label="Clear all options"><span class="trash-icon"></span></button>' : ''}</div></div>
    ${count ? `<p class="count-caption">${count} of 8 options · ${count <= 3 ? 'Explore pros and cons' : `${(count * (count - 1)) / 2} pairwise comparisons`}</p><div class="option-list">${state.options.map((option) => `<div class="option-chip"><button type="button" data-action="edit-option" data-id="${escape(option.id)}" aria-label="Edit ${escape(option.title)}">${escape(option.title)}</button><button type="button" data-action="remove-option" data-id="${escape(option.id)}" aria-label="Remove ${escape(option.title)}">×</button></div>`).join('')}</div><div class="title-line"><span>${escape(decisionLabel(state.title, ''))}</span><button type="button" class="title-button" data-action="name">${decisionLabel(state.title, '') ? 'Rename' : 'Name this decision'}</button></div>` : guideMarkup()}
    <div class="bottom-actions">${primary(startText, 'start', !count)}<button type="button" class="add-button" data-action="add-option" aria-label="Add option"${count === 8 ? ' disabled' : ''}>${image('home-ic-plus')}</button></div></section></div>`;
  }

  function compareMarkup() {
    const completed = Object.keys(state.answers).length;
    const pair = state.pairs[pairIndex];
    const options = pair.map((id) =>
      state.options.find((option) => option.id === id),
    );
    return `<div class="stage-view"><div class="step-meta"><span>Comparison ${pairIndex + 1} of ${state.pairs.length}</span>${pairIndex ? `<button type="button" class="text-button" data-action="undo">↶ ${undoCount ? 'Undo last choice' : 'Previous saved answer'}</button>` : ''}</div><div class="progress-track" role="progressbar" aria-label="Comparisons completed" aria-valuemin="0" aria-valuemax="${state.pairs.length}" aria-valuenow="${completed}"><span style="width:${(completed / state.pairs.length) * 100}%"></span></div>
    <div class="question-block"><h3>What works<br>better for you?</h3><div class="hint-row"><p>Tap a card to choose and see the next pair.</p>${balanceMarkup()}</div></div>
    <div class="choice-pair">${options.map((option, i) => `<button type="button" class="choice-card" data-action="choose" data-id="${escape(option.id)}"><span>${escape(option.title)}</span><span class="keyboard-key" aria-hidden="true">${i + 1}</span></button>`).join('')}</div><div class="stage-footer"><span class="count-caption">One pair. One choice. Take your time.</span><button type="button" class="text-button" data-action="pause">Save & pause</button></div></div>`;
  }

  function reviewMarkup() {
    const ranked = orderedResults(state);
    return `<div class="stage-view"><div class="question-block"><h3>A clearer picture<br>of your options.</h3><div class="hint-row"><p>Choose up to three options to explore their pros and cons.</p>${balanceMarkup()}</div></div><div class="review-list">${ranked.map((option, i) => `<button type="button" class="review-card" data-action="select-review" data-id="${escape(option.id)}" aria-pressed="${state.selected.includes(option.id)}"><span class="select-circle">${state.selected.includes(option.id) ? '✓' : i + 1}</span><span class="review-label">${escape(option.title)}</span><span class="wins">${option.wins} ${option.wins === 1 ? 'choice' : 'choices'}</span></button>`).join('')}</div><p class="selected-count">${state.selected.length} of 3 selected</p><div class="bottom-actions">${primary('Explore Pros & Cons', 'begin-pros', !state.selected.length)}</div><div class="stage-footer"><button type="button" class="text-button" data-action="change-last-comparison">Change last comparison</button><button type="button" class="text-button" data-action="comparison-results">View comparison results</button></div></div>`;
  }

  function reasonRow(note) {
    return `<div class="reason-row"><button type="button" class="reason-text" data-action="edit-reason" data-id="${escape(note.id)}">${escape(note.text)}</button><button type="button" class="priority-badge" data-value="${escape(note.priority)}" data-action="priority" data-id="${escape(note.id)}" aria-label="${escape(note.text)}: ${priorities.get(note.priority)} importance, change">${priorityLetters.get(note.priority)}</button></div>`;
  }

  function prosMarkup() {
    const option = state.options.find(
      (o) => o.id === state.selected[optionIndex],
    );
    return `<div class="stage-view"><div class="option-nav" role="group" aria-label="Options to explore">${state.selected.map((id, i) => `<button type="button" data-action="option-tab" data-index="${i}" ${i === optionIndex ? 'aria-current="true"' : ''}>${escape(state.options.find((o) => o.id === id).title)}</button>`).join('')}</div><h3 class="option-heading">${escape(option.title)}</h3>${aiBanner('A little help with your reasons')}<div class="pros-grid">${[
      'pros',
      'cons',
    ]
      .map((type) => {
        const notes = state.opinions.filter(
          (n) => n.optionId === option.id && n.type === type,
        );
        return `<section class="pros-column"><div class="section-label"><h3>${type === 'pros' ? 'Pros' : 'Cons'}</h3>${type === 'pros' ? image('pros-priority') : ''}</div><div class="reasons-card">${notes.length ? notes.map(reasonRow).join('') : `<p class="reasons-empty">What ${type === 'pros' ? 'supports' : 'makes you hesitate about'} this option?</p>`}<button type="button" class="inline-add" data-action="add-reason" data-type="${type}"><span aria-hidden="true">+</span>Add a ${type === 'pros' ? 'pro' : 'con'}</button></div></section>`;
      })
      .join(
        '',
      )}</div><p class="pros-instruction">Tap a reason to edit it. Tap its letter to set how much it matters to you.</p>${otherReasonsLink()}<div class="bottom-actions">${primary(optionIndex < state.selected.length - 1 ? 'Next option' : 'See my result', 'next-pros')}<button type="button" class="add-button" data-action="add-reason" data-type="pros" aria-label="Add a pro" title="Add a pro">${image('pros-ic-plus')}</button></div></div>`;
  }

  function resultMarkup() {
    const reasonMode = state.selected.length > 0 && (!state.pairs.length || resultTab === 'reasons');
    const ranked = orderedResults(state);
    const rows = reasonMode
      ? ranked
          .filter((row) => state.selected.includes(row.id))
          .sort((a, b) => b.prosCons - a.prosCons)
      : ranked;
    return `<div class="stage-view"><h3 class="result-title">Your choice,<br>a little clearer.</h3>${aiBanner('How to read your result')}<p class="result-intro">Here’s how your options look based on what you’ve shared.</p>
    ${state.pairs.length && state.selected.length ? `<div class="result-tabs" role="group" aria-label="Score views"><button type="button" data-action="result-tab" data-tab="reasons" aria-pressed="${!!reasonMode}">Pros & Cons</button><button type="button" data-action="result-tab" data-tab="comparison" aria-pressed="${!reasonMode}">Pairwise comparison</button></div>` : ''}
    <div class="result-list">${rows
        .map((row) => {
          const score = reasonMode ? row.prosCons : row.comparison;
          const notes = state.opinions.filter((n) => n.optionId === row.id);
          return `<article class="result-card"><div><strong>${escape(row.title)}</strong><span class="result-score">${score ?? 50}<small>/ 100</small></span></div><div class="result-meter" role="meter" aria-label="${escape(row.title)} ${reasonMode ? 'pros and cons' : 'pairwise'} score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score ?? 50}"><span style="width:${score ?? 50}%"></span></div><small>${reasonMode ? (notes.length ? `${notes.filter((n) => n.type === 'pros').length} pros · ${notes.filter((n) => n.type === 'cons').length} cons` : 'No reasons added. Neutral starting score.') : `${row.wins} of ${state.options.length - 1} pairwise choices`}</small>${reasonMode && notes.length ? `<details data-result-option-id="${escape(row.id)}"><summary>Review your reasons</summary><ul>${notes.map((n) => `<li>${n.type === 'pros' ? '+' : '−'} ${escape(n.text)} <small>${priorities.get(n.priority)} importance</small></li>`).join('')}</ul></details>` : ''}</article>`;
        })
        .join(
          '',
        )}</div>${otherReasonsLink()}<p class="result-note">${reasonMode ? 'The balance of your reasons, weighted by their importance.' : 'How often you chose each option in the pairwise comparisons.'} These scores reflect your inputs. They aren’t probabilities or instructions about what to choose.</p><div class="result-actions"><button type="button" class="secondary-button" data-action="${state.selected.length ? 'revise-pros' : 'revise-review'}">${state.selected.length ? 'Review reasons' : 'Explore reasons'}</button>${primary('Save decision', 'save')}</div></div>`;
  }

  function otherReasonsLink() {
    const count = state.opinions.filter((note) => !state.selected.includes(note.optionId)).length;
    return count ? `<p class="dialog-note"><button type="button" class="text-button" data-action="other-reasons">View other saved reasons (${count})</button></p>` : '';
  }

  function blockedHistoryMessage() {
    return history.entries.length
      ? 'Named copies are kept in this tab. Open Files & privacy to export or recover them. Before reloading to retry browser storage, export these copies and your current decision.'
      : 'Saved decisions are unavailable in browser storage. Any captured original data is kept in this tab. Open Files & privacy for backups and recovery; export your current decision before reloading to retry.';
  }

  function recentMarkup() {
    if (historyBlocked) {
      return `<p class="history-empty-note">${escape(blockedHistoryMessage())}</p>`;
    }
    return history.entries.length
      ? history.entries
          .slice(0, 2)
          .map(
            (entry) =>
              `<button type="button" class="recent-row" data-action="restore" data-id="${escape(entry.id)}"><span><strong>${escape(decisionLabel(entry.decision.title))}</strong><small>${entry.decision.options.length} options · ${formatSavedDate(entry.savedAt)}</small></span><span aria-hidden="true">↗</span></button>`,
          )
          .join('')
      : '<p class="history-empty-note">A fresh start. Your saved decisions will find a home here.</p>';
  }


  return {
    render: () => ({options: homeMarkup, compare: compareMarkup, review: reviewMarkup,
      pros: prosMarkup, results: resultMarkup})[state.step](),
    topicRows, guideMarkup, balanceMarkup, blockedHistoryMessage, recentMarkup,
  };
}
