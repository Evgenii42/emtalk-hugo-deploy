import { emitNewsPreview } from './analytics-events.js';

// Transition table (one document, no saved visitor state):
// closed intro +3500ms observed eligible hero time -> open reading phase.
// open +8000ms observed eligible quiet time -> closing -> closed.
// open + any blocker -> open with its remaining budget paused.
// closed/closing + explicit toggle -> open, pinned (used=true).
// open + explicit toggle/Escape -> closing, pinned; focus returns if needed.
// Initial scroll/manual use/pagehide cancels the one-shot intro permanently.
// Reduced motion keeps the initial disclosure manual-only; no automatic reveal.
// pagehide pauses reading/cancels intro; pageshow never replays an intro.
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
  let remaining = 3500, started = 0, timer = null, motion = null;
  // Once reduced motion is requested in this document, keep automatic retreat
  // off for this visit even if that preference changes again. Explicit controls
  // remain available; no surprise resumption of animation or storage is needed.
  let state = 'closed', phase = 'intro', used = reduced.matches || scrollX !== 0 || scrollY !== 0;
  let hovered = false, toggleHovered = false;
  const initialScrollX = scrollX, initialScrollY = scrollY;
  const pointers = new Set();
  let inView = false, pageActive = true, windowActive = document.hasFocus();
  let intersection = null, observedHeaderBottom = null, geometry = [];
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
  const hoverBlocks = () => phase === 'intro' ? toggleHovered : hovered;
  const visible = (rect = preview.getBoundingClientRect(), edge = headerBottom()) => {
    // Observe the existing reveal contract; never start a second loader or wait
    // for fonts here. Time behind its transparent-content state is not reading.
    if (document.documentElement.classList.contains('emt-page-pending') || headerMenuOpen()) return false;
    // Eligibility deliberately requires the entire preview below the header and
    // inside the viewport. Short viewports may keep it open indefinitely; the
    // native toggle remains available without requiring scrolling or dismissal.
    return rect.top >= edge && rect.bottom <= innerHeight
      && rect.left >= 0 && rect.right <= innerWidth;
  };
  const stopTimer = () => {
    if (timer === null) return;
    clearTimeout(timer); timer = null;
    remaining = Math.max(0, remaining - (performance.now() - started));
  };
  const cancelIntro = () => {
    if (phase !== 'intro') return;
    used = true; stopTimer();
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
      if (!eligible()) { sync(); return; }
      used = true;
    }
    if (panel.contains(document.activeElement)) toggle.focus({preventScroll: true});
    const direction = retreat();
    mark(false); state = 'closing'; preview.dataset.state = 'closing';
    if (explicit) emitNewsPreview('close');
    // Automatic presentation changes stay silent: do not interrupt an AT user
    // elsewhere on the page. Native expanded/inert state always remains current.
    // Announce only a requested close; the permanent header News link is stable.
    if (explicit) announcement.textContent = 'Latest news preview collapsed. Use Latest news to reopen it.';
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
  const open = (explicit = true) => {
    if (state === 'open') return;
    if (explicit) used = true;
    stopTimer(); cancelMotion();
    phase = 'reading'; remaining = 8000;
    state = 'open'; panel.style.visibility = ''; mark(true);
    announcement.textContent = '';
    if (explicit) emitNewsPreview('open');
    // Manual reopening is pinned open for the remainder of this document.
    if (!reduced.matches && typeof panel.animate === 'function') {
      motion = panel.animate([{opacity: .8, transform: 'translateY(4px)'},
        {opacity: 1, transform: 'translateY(0)'}], {duration: 240, easing: 'ease-out'});
      const current = motion;
      current.finished.then(() => { if (motion === current) motion = null; }).catch(() => {});
    }
    sync();
  };
  // One predicate governs starting, deadline wake-up and automatic closure.
  // Observations update geometry/visibility; one timer spends the phase budget.
  const eligible = () => !used && state === (phase === 'intro' ? 'closed' : 'open')
    && !reduced.matches && pageActive && windowActive && !document.hidden && inView
    && !hoverBlocks() && pointers.size === 0 && !focusInside();
  function sync() {
    if (!eligible()) { stopTimer(); return; }
    if (timer !== null) return;
    started = performance.now();
    timer = setTimeout(() => {
      timer = null;
      // A blocked deadline resumes with zero remaining; never double-charge it.
      remaining = 0;
      // Native layout events can coalesce; recheck actual visibility at wake.
      inView = visible();
      if (reduced.matches) { used = true; return; }
      // Every blocker has a resumption observation below; no polling.
      if (!eligible()) return;
      if (phase === 'intro') open(false); else close();
    }, remaining);
  }
  toggle.addEventListener('click', event => {
    if (event.defaultPrevented) return;
    if (state === 'open') close(true); else open();
  });
  preview.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (state === 'closed' && phase === 'intro') { cancelIntro(); return; }
    if (state !== 'open') return;
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
  // Invisible reserved panel space must not block the intro merely because the
  // pointer rests on the landscape. The visible toggle remains protected.
  toggle.addEventListener('pointerenter', event => {
    if (event.pointerType === 'touch') return;
    toggleHovered = true; sync();
  });
  toggle.addEventListener('pointerleave', event => {
    if (event.pointerType === 'touch') return;
    toggleHovered = false; sync();
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
  const observeVisibility = edge => {
    if (typeof IntersectionObserver !== 'function') return;
    const bottom = Math.ceil(edge);
    if (observedHeaderBottom === bottom) return;
    observedHeaderBottom = bottom;
    intersection?.disconnect();
    // A layout-only move can hide the preview without a scroll/resize event.
    // Exclude the sticky header from the observer's visible viewport as well.
    intersection = new IntersectionObserver(layout, {threshold: 1, rootMargin: `-${bottom}px 0px 0px 0px`});
    intersection.observe(preview);
  };
  const layout = () => {
    // Measure the reserved preview box, never the animated panel's transform.
    // Observer/menu/focus notifications with identical geometry must not cut
    // the420ms retreat short. A real scroll/resize safely ends stale motion.
    const rect = preview.getBoundingClientRect(), edge = headerBottom();
    const next = [rect.top, rect.right, rect.bottom, rect.left, edge, innerWidth, innerHeight, desktop.matches];
    const moved = next.some((value, index) => value !== geometry[index]);
    geometry = next;
    observeVisibility(edge); inView = visible(rect, edge);
    if (state === 'closing' && moved) { cancelMotion(); finishClose(); }
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
  addEventListener('scroll', () => {
    if (scrollX !== initialScrollX || scrollY !== initialScrollY) cancelIntro();
    layout();
  }, {passive: true});
  // A blur is not a pointer release: overlays may interrupt a held touch/pen.
  // Keep its blocker until matching pointerup/cancel is observed. If release
  // happens outside this document, staying open is the conservative fallback;
  // explicit toggle/Escape still work, and manual reopening remains pinned.
  addEventListener('blur', () => { windowActive = false; sync(); });
  addEventListener('focus', () => { windowActive = true; layout(); });
  addEventListener('pagehide', () => { pageActive = false; pointers.clear(); cancelIntro(); stopTimer(); cancelMotion(); if (state === 'closing') finishClose(); });
  addEventListener('pageshow', () => { pageActive = true; layout(); });
  // Visibility/inert preserve the original panel's flow box and four-card position.
  // Bind every observation before enhancing. If the controller is unavailable
  // or initialization fails, the server-rendered native News links stay open.
  preview.dataset.enhanced = 'true';
  panel.style.visibility = 'hidden';
  mark(false);
  toggle.hidden = false;
  const help = preview.querySelector('[data-home-news-help]');
  if (help) help.hidden = false;
  layout();
}
