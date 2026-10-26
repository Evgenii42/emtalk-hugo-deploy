import { emitNewsFilter } from './analytics-events.js';

// Enhanced filtering keeps the catalog position while updating the category
// fragment/count. Without JS the same links use native fragment scrolling.

const filters = document.querySelector('[data-news-filters]');
const countNode = document.querySelector('[data-news-count]');
if (filters && countNode) {
  const values = new Set(['all', 'project', 'product', 'reading']);
  const groups = [...document.querySelectorAll('[data-news-group]')];
  let active = 'all';

  const apply = value => {
    if (!values.has(value)) return;
    active = value;
    for (const group of groups) group.hidden = value !== 'all' && group.dataset.newsGroup !== value;
    for (const link of filters.querySelectorAll('[data-news-filter]')) {
      if (link.dataset.newsFilter === value) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    const count = groups.filter(group => !group.hidden).length;
    const updates = `${count} update${count === 1 ? '' : 's'}`;
    const labels = {project: 'Project', product: 'Product', reading: 'Articles'};
    countNode.textContent = value === 'all' ? `${count} published update${count === 1 ? '' : 's'} shown.`
      : `${updates} in ${labels[value]}.`;
  };

  filters.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('[data-news-filter]');
    if (!link || !filters.contains(link) || !values.has(link.dataset.newsFilter)) return;
    event.preventDefault();
    const selected = link.dataset.newsFilter;
    const changed = selected !== active;
    apply(selected);
    if (changed) emitNewsFilter(selected);
    try { history.replaceState(null, '', link.getAttribute('href')); }
    catch { /* A blocked URL update must not undo the visible filter or accepted user event. */ }
  });

  const restore = (initial = false) => {
    const match = /^#news-(all|project|product|reading)$/.exec(location.hash);
    if (match) apply(match[1]);
    else if (initial) apply('all');
    // Skip links and other in-page anchors preserve the visitor's current choice.
  };
  restore(true);
  window.addEventListener('hashchange', () => restore());
}
