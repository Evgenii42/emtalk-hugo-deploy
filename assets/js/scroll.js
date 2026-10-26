// Independent equivalent of the published anchor-scroll controller.
// Source curve provenance: docs/audits/site-entry-scroll-compat-source-run001.json.
// Compatibility values preserve the published curve, not separate tuning knobs.
const publishedScrollCurve = Object.freeze({
  logarithmScale: 472.143,
  distanceOffset: 125,
  durationOffset: 2000,
});
export function initScroll() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let frame;
  let scrolling = false;
  let pendingNavigation = null;
  const cancel = () => {
    cancelAnimationFrame(frame);
    scrolling = false;
    pendingNavigation = null;
    // No history entry is created before completion. Cancellation leaves native
    // Back/Forward and any intervening user hash/history navigation untouched.
  };
  document.addEventListener('wheel', cancel, { passive: true });
  document.addEventListener('touchstart', cancel, { passive: true });
  window.addEventListener('hashchange', cancel);
  window.addEventListener('popstate', cancel);
  window.addEventListener('pagehide', cancel);
  // Focus changes and Tab take precedence over a pending anchor animation.
  document.addEventListener('focusin', () => { if (scrolling) cancel(); });
  document.addEventListener('keydown', event => {
    if (scrolling && event.key === 'Tab') cancel();
    const editing = event.target instanceof Element && (event.target.isContentEditable || event.target.closest('input, textarea, select'));
    if (scrolling && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) && !editing) cancel();
  });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.hasAttribute('download')) return;
    const targetName = anchor.getAttribute('target');
    if (targetName && targetName.toLowerCase() !== '_self') return;
    const href = anchor.getAttribute('href');
    if (href === '#') { event.preventDefault(); return; }
    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (!url.hash || url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    let id;
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    cancel();
    if (location.hash !== url.hash) {
      pendingNavigation = { before: location.href, url: url.href, x: scrollX, y: scrollY };
    }

    const offset = [...document.querySelectorAll('header:not([data-no-scroll]), body > .header:not([data-no-scroll]), body > .w-nav:not([data-no-scroll])')].reduce((height, header) => {
      const style = getComputedStyle(header);
      const rect = header.getBoundingClientRect();
      const sharedHeader = header.classList.contains('site-header');
      const visibleHeader = style.display !== 'none' && ['fixed', 'sticky'].includes(style.position)
        && (rect.top <= 0 || sharedHeader) && rect.bottom > 0 && rect.top < innerHeight;
      const scrollPadding = sharedHeader ? Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0 : 0;
      return visibleHeader ? Math.max(height, rect.bottom, scrollPadding) : height;
    }, 0);
    const from = scrollY;
    let to = target.getBoundingClientRect().top + scrollY - offset;
    if (target.dataset.scroll === 'mid' && target.getBoundingClientRect().height < innerHeight - offset) {
      to -= Math.round((innerHeight - offset - target.getBoundingClientRect().height) / 2);
    }
    let multiplier = 1;
    [document.body, target].forEach(node => {
      const value = Number.parseFloat(node.getAttribute('data-scroll-time'));
      if (Number.isFinite(value) && value >= 0) multiplier = value;
    });
    // Preserve the published Webflow distance curve, including data-scroll-time.
    const duration = reduced.matches || anchor.classList.contains('site-header__skip') ? 0 : (publishedScrollCurve.logarithmScale * Math.log(Math.abs(from - to) + publishedScrollCurve.distanceOffset) - publishedScrollCurve.durationOffset) * multiplier;
    const begin = performance.now();
    const finish = () => {
      const pending = pendingNavigation;
      pendingNavigation = null;
      if (pending && location.href === pending.before) {
        // Snapshot the originating scroll position into its native history
        // entry. These synchronous scrolls have no intervening rendered frame.
        const x = scrollX, y = scrollY;
        scrollTo(pending.x, pending.y);
        history.pushState({ hash: url.hash }, '', url.hash);
        scrollTo(x, y);
      }
      const previous = target.getAttribute('tabindex');
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      // Chromium drops focus when a newly focusable heading loses tabindex.
      // Keep this temporary programmatic target until the user moves away.
      if (previous == null) target.addEventListener('blur', () => target.removeAttribute('tabindex'), {once:true});
      else target.setAttribute('tabindex', previous);
    };
    const step = now => {
      if (!scrolling) return;
      const ratio = duration <= 0 || reduced.matches ? 1 : Math.min(1, (now - begin) / duration);
      const eased = ratio < 0.5 ? 4 * ratio ** 3 : (ratio - 1) * (2 * ratio - 2) ** 2 + 1;
      scrollTo(scrollX, from + (to - from) * eased);
      if (ratio < 1) frame = requestAnimationFrame(step); else { scrolling = false; finish(); }
    };
    scrolling = true;
    frame = requestAnimationFrame(step);
  });
}
