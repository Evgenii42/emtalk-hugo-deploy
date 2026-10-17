// Inline before external CSS/modules. Never depend on those resources to release.
(() => {
  if (window.EmTalkPageLoader) return;
  const root = document.documentElement;
  const startedAt = performance.now();
  const abort = new AbortController();
  const originalInert = new Map();
  const intents = ["keydown", "pointerdown", "wheel", "touchstart"];
  let pending = false, settled = false, indicatorDue = false;
  let deadlineTimer, indicatorTimer, fadeTimer, observer;

  function release(reason) {
    const first = !settled;
    settled = true;
    pending = false;
    clearTimeout(deadlineTimer);
    clearTimeout(indicatorTimer);
    clearTimeout(fadeTimer);
    observer?.disconnect();
    for (const name of intents) window.removeEventListener(name, onIntent, true);
    document.removeEventListener("visibilitychange", onVisibility);
    root.classList.remove("emt-page-pending");
    for (const [element, wasInert] of originalInert) element.inert = wasInert;
    originalInert.clear();
    abort.abort();
    if (first) root.dataset.emtPageReveal = reason;
    const indicator = document.querySelector("[data-emt-page-loader]");
    if (!indicator) return;
    // Input and lifecycle release immediately; a normal reveal fades only the
    // noninteractive overlay, never holds back the now usable page.
    if (first && reason === "settled" && !indicator.hidden) {
      root.classList.add("emt-page-revealed");
      fadeTimer = setTimeout(() => { indicator.hidden = true; }, 160);
    } else indicator.hidden = true;
  }
  function onIntent(event) {
    if (event.type === "keydown" && ["Alt", "Control", "Shift", "Meta"].includes(event.key)) return;
    release("interaction");
  }
  function onVisibility() {
    if (document.hidden || performance.now() >= startedAt + 2500) release("background");
  }
  function observeContent() {
    if (!pending || !document.body) return;
    for (const element of document.body.children) {
      if (element.matches("script,style,link,[data-emt-page-loader]")) continue;
      if (!originalInert.has(element)) {
        originalInert.set(element, element.inert);
        element.inert = true;
      }
    }
    const indicator = document.querySelector("[data-emt-page-loader]");
    if (indicator && indicatorDue) indicator.hidden = false;
  }

  // Arm the independent bound before opting in or observing any page content.
  deadlineTimer = setTimeout(() => release("timeout"), 2500);
  window.EmTalkPageLoader = Object.freeze({
    release, signal: abort.signal, isPending: () => pending,
  });
  try {
    const cssReady = getComputedStyle(root).getPropertyValue("--emt-page-loader-css").trim() === "ready";
    // Native initial fragment focus happens before reveal; do not suppress it.
    if (!cssReady || !("inert" in HTMLElement.prototype) || document.hidden || location.hash) {
      release("bypass");
      return;
    }
    pending = true;
    root.dataset.emtPageReveal = "pending";
    root.classList.add("emt-page-pending");
    observer = new MutationObserver(() => {
      try { observeContent(); } catch { release("bootstrap-error"); }
    });
    observer.observe(root, { childList:true, subtree:true });
    for (const name of intents) window.addEventListener(name, onIntent, { capture:true, passive:true });
    document.addEventListener("visibilitychange", onVisibility);
    indicatorTimer = setTimeout(() => {
      indicatorDue = true;
      try { observeContent(); } catch { release("bootstrap-error"); }
    }, 1000);
    observeContent();
  } catch { release("bootstrap-error"); }
  // Keep only these lightweight lifecycle guards after the pending work ends.
  window.addEventListener("pagehide", () => release("pagehide"));
  window.addEventListener("pageshow", event => { if (event.persisted) release("pageshow"); });
})();
