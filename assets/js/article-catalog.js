import { emitInterfaceEvent } from './analytics-events.js';
// Optional subject filters. The server-rendered article list is the complete no-JS fallback.
export function initArticleCatalog(root = document) {
  for (const catalog of root.querySelectorAll('[data-article-catalog]')) {
    if (catalog.dataset.articleCatalogReady === 'true') continue;
    const controls = catalog.querySelector('[data-article-filters]');
    const buttons = controls ? [...controls.querySelectorAll('button[data-article-filter]')] : [];
    const cards = [...catalog.querySelectorAll('[data-article-topic]')];
    const status = catalog.querySelector('[data-article-count]');
    const resets = buttons.filter(button => button.hasAttribute('data-article-reset'));
    const reset = resets[0];
    const subjects = buttons.filter(button => button !== reset);
    const ids = buttons.map(button => button.dataset.articleFilter);
    if (!controls || !status || !cards.length || resets.length !== 1 || !subjects.length ||
        new Set(ids).size !== ids.length ||
        buttons.some(button => !button.dataset.articleFilter || !button.dataset.articleLabel?.trim()) ||
        cards.some(card => !subjects.some(button => button.dataset.articleFilter === card.dataset.articleTopic))) continue;

    // The server owns the complete-list sentence; reset reuses that exact copy.
    const allArticlesMessage = status.textContent;
    function show(selected) {
      let count = 0;
      for (const card of cards) {
        card.hidden = selected !== reset && card.dataset.articleTopic !== selected.dataset.articleFilter;
        if (!card.hidden) count += 1;
      }
      for (const button of buttons) {
        const pressed = String(button === selected);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      }
      const noun = count === 1 ? 'article' : 'articles';
      const verb = count === 1 ? 'is' : 'are';
      const message = selected === reset
        ? allArticlesMessage
        : `${count} ${noun} about ${selected.dataset.articleLabel} ${verb} shown.`;
      if (status.textContent !== message) status.textContent = message;
    }

    let effective = reset;
    for (const button of buttons) button.addEventListener('click', () => {
      if (button === effective) return;
      show(button);
      effective = button;
      emitInterfaceEvent('emtalk_catalog_filter', {action:button === reset ? 'reset' : 'filter'});
    });
    // Initialization never filters anything. Only an explicit native button activation does.
    show(reset);
    controls.hidden = false;
    catalog.dataset.articleCatalogReady = 'true';
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initArticleCatalog(), {once:true});
  else initArticleCatalog();
}
