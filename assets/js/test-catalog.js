// Optional, tab-only choice guidance. The static catalog remains the fallback.
export function initTestCatalog() {
  const catalog = document.querySelector('[data-test-catalog]');
  if (!catalog || catalog.dataset.guideReady === 'true') return;
  const picker = catalog.querySelector('.tests-focus-picker');
  const inputs = [...catalog.querySelectorAll('input[name="test-focus"]')];
  const cards = [...catalog.querySelectorAll('[data-test-choice]')];
  const groups = [...catalog.querySelectorAll('.tests-topic')];
  const reset = catalog.querySelector('.tests-show-all');
  const nextLink = catalog.querySelector('.tests-see-choice');
  const status = catalog.querySelector('.tests-focus-status');
  const steps = [...catalog.querySelectorAll('.tests-choice-path li')];
  const fallback = catalog.querySelector('.tests-focus-fallback');
  if (!picker || !reset || !nextLink || !status || !fallback || inputs.length !== 5 || cards.length !== 5 || steps.length !== 3 ||
      new Set(inputs.map(input => input.value)).size !== 5 ||
      inputs.some(input => cards.filter(card => card.dataset.testChoice === input.value).length !== 1)) return;

  function show(slug) {
    for (const card of cards) card.hidden = Boolean(slug && card.dataset.testChoice !== slug);
    for (const group of groups) group.hidden = ![...group.querySelectorAll('[data-test-choice]')].some(card => !card.hidden);
    const selected = inputs.find(input => input.value === slug);
    nextLink.hidden = !selected;
    if (selected) {
      nextLink.setAttribute('href', `#test-choice-${slug}`);
      nextLink.setAttribute('aria-label', `See this test: ${selected.dataset.focusLabel}`);
    } else {
      nextLink.removeAttribute('href');
      nextLink.removeAttribute('aria-label');
    }
    status.textContent = selected
      ? `Your focus: ${selected.dataset.focusLabel}. Read about this starting point before deciding to begin.`
      : 'All five tests are shown. Compare their focus, or choose what feels closest above.';
    steps.forEach((step, index) => {
      if (index === (selected ? 1 : 0)) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    catalog.dataset.selectedFocus = slug || 'all';
  }
  picker.addEventListener('submit', event => event.preventDefault());
  picker.addEventListener('change', event => {
    if (inputs.includes(event.target)) show(event.target.value);
  });
  reset.addEventListener('click', () => {
    for (const input of inputs) input.checked = false;
    show('');
  });
  // Initialization never hides tests. Only a deliberate native radio selection does.
  for (const input of inputs) input.checked = false;
  picker.hidden = false;
  fallback.hidden = true;
  reset.hidden = false;
  catalog.dataset.guideReady = 'true';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTestCatalog, {once:true});
else initTestCatalog();
