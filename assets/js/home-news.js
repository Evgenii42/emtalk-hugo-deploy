import { emitNewsPreview } from './analytics-events.js';

// Transition table (one document, no saved visitor state):
// open + eligible quiet budget exhausted -> closing -> closed.
// open + any blocker -> open with its remaining budget paused.
// closed/closing + explicit toggle -> open, pinned (used=true).
// open + explicit toggle/Escape -> closing, pinned; focus returns if needed.
// any + reduced-motion request -> pinned, finish any closing without motion.
// pagehide pauses/cancels; pageshow rechecks geometry, never emits an action.
// A visible window also pauses on blur and resumes on focus; browser chrome or
// another foreground window must not consume the visitor's quiet window.
// `state` owns presentation; `used` is the one-way automatic-retreat latch.
// hovered/pointers/inView/pageActive are observed blockers, not extra UI states.
const preview = document.querySelector('[data-home-news-preview]');
const panel = preview?.querySelector('[data-home-news-panel]');
const toggle = preview?.querySelector('[data-home-news-toggle]');
const announcement = preview?.querySelector('[data-home-news-status]');
if (preview && panel && toggle && announcement && !preview.dataset.enhanced) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 1100px)');
  const icon = toggle.querySelector('[data-home-news-icon]');
  let remaining = 8000, started = 0, timer = null, motion = null;
  // Once reduced motion is requested in this document, keep automatic retreat
  // off for this visit even if that preference changes again. Explicit controls
  // remain available; no surprise resumption of animation or storage is needed.
  let state = 'open', used = reduced.matches, hovered = false;
  const pointers = new Set();
  let inView = false, pageActive = true, windowActive = document.hasFocus();
  let intersection = null, observedHeaderBottom = null;
  const header = document.querySelector('.site-header');
  const headerDisclosures = [...(header?.querySelectorAll('details') || [])];
  const headerBottom = () => Math.max(0, header?.getBoundingClientRect().bottom || 0);
  const headerMenuOpen = () => headerDisclosures.some(disclosure => {
    if (!disclosure.open) return false;
    const summary = disclosure.querySelector('summary');
    if (!summary) return false;
    const rect = summary.getBoundingClientRect();
    // An expanded absolute panel can cover News without changing the bar box.
    // Pause conservatively for any visible open menu, including retained focus
    // across breakpoints, but ignore the inactive display:none navigation.
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
      && rect.right > 0 && rect.left < innerWidth && getComputedStyle(summary).visibility === 'visible';
  });
  const focusInside = () => preview.contains(document.activeElement);
  const visible = () => {
    // Observe the existing reveal contract; never start a second loader or wait
    // for fonts here. Time behind its transparent-content state is not reading.
    if (document.documentElement.classList.contains('emt-page-pending') || headerMenuOpen()) return false;
    const rect = preview.getBoundingClientRect();
    // Eligibility deliberately requires the entire preview below the header and
    // inside the viewport. Short viewports may keep it open indefinitely; the
    // native toggle remains available without requiring scrolling or dismissal.
    return rect.top >= headerBottom() && rect.bottom <= innerHeight
      && rect.left >= 0 && rect.right <= innerWidth;
  };
  const stopTimer = () => {
    if (timer === null) return;
    clearTimeout(timer); timer = null;
    remaining = Math.max(0, remaining - (performance.now() - started));
  };
  const cancelMotion = () => {
    if (motion) { motion.cancel(); motion = null; }
  };
  const mark = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide latest news preview' : 'Open latest news preview');
    if (icon) icon.textContent = open ? '−' : '+';
    panel.inert = !open;
    if (open) panel.removeAttribute('aria-hidden'); else panel.setAttribute('aria-hidden', 'true');
    preview.dataset.state = open ? 'open' : 'closed';
  };
  const finishClose = () => {
    state = 'closed';
    panel.style.visibility = 'hidden';
    preview.dataset.state = 'closed';
  };
  const retreat = () => {
    if (!desktop.matches) return {x: 0, y: 4, scale: .98};
    const href = panel.querySelector('.home-news__all')?.getAttribute('href');
    const target = [...document.querySelectorAll('.site-header a[href]')].find(link => {
      if (link.getAttribute('href') !== href) return false;
      const rect = link.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight
        && getComputedStyle(link).visibility === 'visible';
    });
    if (!target) return {x: 0, y: 4, scale: .98};
    const from = panel.getBoundingClientRect(), to = target.getBoundingClientRect();
    return {x: to.left + to.width / 2 - from.left - from.width / 2,
      y: to.top + to.height / 2 - from.top - from.height / 2, scale: .12};
  };
  const close = (explicit = false) => {
    if (state !== 'open') return;
    if (explicit) used = true;
    stopTimer(); cancelMotion();
    // Automatic closure is never allowed to hide focused or pressed content.
    if (!explicit) {
      inView = visible();
      if (!windowActive || focusInside() || hovered || pointers.size > 0 || document.hidden || !inView) { sync(); return; }
      used = true;
    }
    if (panel.contains(document.activeElement)) toggle.focus({preventScroll: true});
    const direction = retreat();
    mark(false); state = 'closing'; preview.dataset.state = 'closing';
    if (explicit) emitNewsPreview('close');
    // Keep all closure paths consistent in the existing persistent live region.
    // Reopening clears it; the state guard prevents duplicate close messages.
    announcement.textContent = 'Latest news preview collapsed. Use Latest news to reopen it.';
    if (reduced.matches || typeof panel.animate !== 'function' || document.hidden) { finishClose(); return; }
    motion = panel.animate([
      {opacity: 1, transform: 'translate(0, 0) scale(1)'},
      {opacity: 0, transform: `translate(${direction.x}px, ${direction.y}px) scale(${direction.scale})`},
    ], {duration: 420, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards'});
    const current = motion;
    current.finished.then(() => {
      if (motion !== current) return;
      finishClose(); cancelMotion();
    }).catch(() => {});
  };
  const open = () => {
    if (state === 'open') return;
    used = true; stopTimer(); cancelMotion();
    state = 'open'; panel.style.visibility = ''; mark(true);
    announcement.textContent = '';
    emitNewsPreview('open');
    // Manual reopening is pinned open for the remainder of this document.
    if (!reduced.matches && typeof panel.animate === 'function') {
      motion = panel.animate([{opacity: .8, transform: 'translateY(4px)'},
        {opacity: 1, transform: 'translateY(0)'}], {duration: 240, easing: 'ease-out'});
      const current = motion;
      current.finished.then(() => { if (motion === current) motion = null; }).catch(() => {});
    }
  };
  function sync() {
    if (used || state !== 'open' || reduced.matches || !pageActive || !windowActive || document.hidden || !inView
        || hovered || pointers.size > 0 || focusInside()) { stopTimer(); return; }
    if (timer !== null) return;
    started = performance.now();
    timer = setTimeout(() => {
      timer = null;
      // This deadline has spent its observed quiet-window budget even if a
      // simultaneous interaction blocks closure. Resume with zero remaining
      // after that interaction ends; never charge this same window twice.
      remaining = 0;
      // Recheck actual geometry at wake: native scroll/layout events can be
      // coalesced. A blocked wake cannot hide focused, pressed or hidden content.
      // The quiet window is based on observed eligibility, not a guarantee of
      // continuous reading time.
      inView = visible();
      if (reduced.matches) { used = true; return; }
      // Every blocker has a corresponding observation below: pageshow,
      // visibilitychange, intersection/resize/scroll, pointerleave/up/cancel,
      // focusout and the reduced-motion change listener. New blockers must add
      // their matching resumption observation; no periodic polling is required.
      if (!pageActive || !windowActive || document.hidden || !inView || hovered || pointers.size > 0 || focusInside()) return;
      close();
    }, remaining);
  }
  toggle.addEventListener('click', event => {
    if (event.defaultPrevented) return;
    if (state === 'open') close(true); else open();
  });
  preview.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || state !== 'open') return;
    event.preventDefault(); close(true); toggle.focus({preventScroll: true});
  });
  preview.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    hovered = true; sync();
  });
  preview.addEventListener('pointerleave', event => {
    if (event.pointerType === 'touch') return;
    hovered = false; sync();
  });
  preview.addEventListener('pointerdown', event => { pointers.add(event.pointerId); sync(); });
  const release = event => { pointers.delete(event.pointerId); sync(); };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  preview.addEventListener('focusin', sync);
  preview.addEventListener('focusout', () => queueMicrotask(sync));
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      used = true; stopTimer(); cancelMotion();
      if (state === 'closing') finishClose();
    }
    sync();
  });
  const observeVisibility = () => {
    if (typeof IntersectionObserver !== 'function') return;
    const bottom = Math.ceil(headerBottom());
    if (observedHeaderBottom === bottom) return;
    observedHeaderBottom = bottom;
    intersection?.disconnect();
    // A layout-only move can hide the preview without a scroll/resize event.
    // Exclude the sticky header from the observer's visible viewport as well.
    intersection = new IntersectionObserver(layout, {threshold: 1, rootMargin: `-${bottom}px 0px 0px 0px`});
    intersection.observe(preview);
  };
  const layout = () => {
    observeVisibility(); inView = visible();
    if (state === 'closing') { cancelMotion(); finishClose(); }
    sync();
  };
  // Native details toggle does not bubble. Capture also observes .open changes
  // made without clicks, even though the absolute panel leaves bar size intact.
  header?.addEventListener('toggle', layout, true);
  header?.addEventListener('focusin', () => queueMicrotask(layout));
  header?.addEventListener('focusout', () => queueMicrotask(layout));
  if (typeof ResizeObserver === 'function') {
    const resize = new ResizeObserver(layout);
    resize.observe(preview);
    if (header) resize.observe(header);
  }
  let awaitingReveal = document.documentElement.classList.contains('emt-page-pending');
  const reveal = new MutationObserver(() => {
    const pending = document.documentElement.classList.contains('emt-page-pending');
    if (pending === awaitingReveal) return;
    awaitingReveal = pending; layout();
  });
  reveal.observe(document.documentElement, {attributes: true, attributeFilter: ['class']});
  addEventListener('resize', layout, {passive: true});
  addEventListener('scroll', layout, {passive: true});
  // A blur is not a pointer release: overlays may interrupt a held touch/pen.
  // Keep its blocker until matching pointerup/cancel is observed. If release
  // happens outside this document, staying open is the conservative fallback;
  // explicit toggle/Escape still work, and manual reopening remains pinned.
  addEventListener('blur', () => { windowActive = false; sync(); });
  addEventListener('focus', () => { windowActive = true; layout(); });
  addEventListener('pagehide', () => { pageActive = false; pointers.clear(); stopTimer(); cancelMotion(); if (state === 'closing') finishClose(); });
  addEventListener('pageshow', () => { pageActive = true; layout(); });
  // Visibility/inert preserve the original panel's flow box and four-card position.
  preview.dataset.enhanced = 'true';
  toggle.hidden = false;
  const help = preview.querySelector('[data-home-news-help]');
  if (help) help.hidden = false;
  mark(true); layout();
}
