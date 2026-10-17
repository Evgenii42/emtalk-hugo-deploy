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
        ? `${reset.dataset.articleLabel} ${count} ${noun} ${verb} shown.`
        : `${count} ${noun} about ${selected.dataset.articleLabel} ${verb} shown.`;
      if (status.textContent !== message) status.textContent = message;
    }

    for (const button of buttons) button.addEventListener('click', () => show(button));
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
