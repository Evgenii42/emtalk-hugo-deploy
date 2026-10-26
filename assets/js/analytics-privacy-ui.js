// Sole consent-controls DOM/focus owner. It never grants consent or boots Google.
export function createAnalyticsPrivacyUI({ document, window, preferences, canonical, snapshot, onRefresh, onChoose }) {
  const panel = document.querySelector("[data-privacy-controls]");
  const openers = Array.from(document.querySelectorAll("[data-privacy-open]"));
  const announcement = document.querySelector("[data-privacy-announcement]");
  const fallback = document.querySelector("[data-privacy-unavailable]");
  const nodes = panel && Object.fromEntries(["status", "allow", "reject", "close", "heading"].map(name => [name, panel.querySelector("[data-privacy-" + name + "]")]));
  // Resolve and validate this contract once, before activation is possible.
  const ready = !!(panel && announcement && openers.length && nodes && Object.values(nodes).every(Boolean));
  if (!ready) {
    if (panel) panel.hidden = true;
    for (const button of openers) { button.disabled = true; button.setAttribute("aria-expanded", "false"); }
    if (fallback) fallback.hidden = false;
    if (announcement) announcement.textContent = "Privacy controls are unavailable. Optional analytics remains off.";
    return Object.freeze({ ready: false, mount() {}, render() {} });
  }
  const labels = openers.map(button => button.textContent || "Privacy choices");
  let opener = null, minimized = false, explicitlyOpened = false;
  // Native pointer activation focuses before its click. Moving either page or
  // panel in that focusin would retarget the pending click/tap. Keep the origin
  // through the entire click task; keyboard focus still gets occlusion recovery.
  const pointers = new Set();
  let pointerFocusPending = false, pointerRelease = null;
  let pointerSequence = 0, focusFrame = null, pendingFocus = null;
  let pageActive = true, windowActive = document.hasFocus();
  function cancelFocusCorrection() {
    if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
    focusFrame = null; pendingFocus = null;
  }
  function resetPointerOrigin() {
    pointers.clear(); pointerFocusPending = false;
    if (pointerRelease !== null) clearTimeout(pointerRelease);
    pointerRelease = null;
    pointerSequence += 1; cancelFocusCorrection();
  }
  function beginPointer(event) {
    pointerSequence += 1; cancelFocusCorrection();
    if (pointerRelease !== null) clearTimeout(pointerRelease);
    pointerRelease = null; pointers.add(event.pointerId); pointerFocusPending = true;
  }
  function endPointer(event) { pointers.delete(event.pointerId); }
  function cancelPointer(event) {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) resetPointerOrigin();
  }
  function finishPointerClick() {
    if (!pointerFocusPending || pointers.size) return;
    if (pointerRelease !== null) clearTimeout(pointerRelease);
    pointerRelease = setTimeout(resetPointerOrigin, 0);
  }
  function setMinimized(value) {
    minimized = value;
    openers.forEach((button, index) => {
      button.textContent = value ? "Privacy choices (minimized)" : labels[index];
      button.classList.toggle("privacy-controls__opener--minimized", value && index === 0);
      if (!value) button.classList.remove("privacy-controls__opener--minimized-top");
    });
  }
  function render() {
    const state = snapshot(), choice = state.choice;
    let text = state.gpc ? "Global Privacy Control is enabled. Optional analytics is off." :
      !preferences.valid(choice) ? "Optional analytics is off. Choose whether to allow Google Analytics cookies." :
      choice.analytics ? "You allowed optional analytics." : "You rejected optional analytics. Analytics is off.";
    if (!state.eligible) text = "Optional analytics is currently off on this page. You can use every feature without allowing it.";
    if (state.notice) text += " " + state.notice;
    if (state.cleanupFailed) text += " Your browser did not allow cookie cleanup. Use browser settings to remove Analytics cookies.";
    if (nodes.status.textContent !== text) nodes.status.textContent = text;
    nodes.allow.hidden = !state.eligible; nodes.allow.disabled = state.gpc;
    nodes.reject.textContent = state.eligible ? "Reject analytics" : "Keep analytics off";
    for (const button of openers) button.setAttribute("aria-expanded", String(!panel.hidden));
  }
  function focusMain() {
    const main = document.getElementById("emtalk-main") || document.querySelector("main");
    if (main) { if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1"); main.focus({ preventScroll: true }); }
  }
  function close() {
    if (!preferences.valid(snapshot().choice)) preferences.dismissExplicitly();
    panel.hidden = true; explicitlyOpened = false; panel.classList.remove("privacy-controls--top"); setMinimized(false); render();
    if (opener?.isConnected) opener.focus({ preventScroll: true }); else focusMain();
    opener = null;
  }
  function intersects(left, right) {
    return left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom;
  }
  function exposeMinimizedOpener(target) {
    const button = openers[0];
    if (!minimized || !target?.getBoundingClientRect || target === button) return;
    const action = target.getBoundingClientRect();
    if (intersects(action, button.getBoundingClientRect())) button.classList.toggle("privacy-controls__opener--minimized-top", action.top > window.innerHeight / 2);
  }
  function correctFocusedAction(target, sequence) {
    // Only the latest keyboard-focused action may move. A pointer sequence,
    // blur/pagehide, detached target or later focus invalidates queued work.
    if (sequence !== pointerSequence || pointerFocusPending || pointers.size
        || !pageActive || !windowActive || document.hidden
        || document.activeElement !== target || !target.isConnected) return;
    if (minimized) { exposeMinimizedOpener(target); return; }
    if (panel.hidden || panel.contains(target)) return;
    const covered = () => intersects(target.getBoundingClientRect(), panel.getBoundingClientRect());
    if (!covered()) return;
    window.scrollBy({ top: Math.ceil(target.getBoundingClientRect().bottom - panel.getBoundingClientRect().top) + 12, left: 0, behavior: "auto" });
    if (!covered() || document.activeElement !== target) return;
    if (explicitlyOpened) {
      panel.classList.toggle("privacy-controls--top", target.getBoundingClientRect().top > window.innerHeight / 2);
      return;
    }
    // Automatic focus recovery is not an explicit dismissal or a consent choice.
    panel.hidden = true; opener = null; setMinimized(true); render(); exposeMinimizedOpener(target);
    announcement.textContent = "Privacy choices were minimized to keep your focused control visible. Your analytics choice is unchanged. Use Privacy choices (minimized) to reopen them.";
  }
  function keepFocusedActionVisible(event) {
    const target = event.target;
    if (pointerFocusPending || pointers.size || !target || target.tabIndex < 0
        || typeof target.getBoundingClientRect !== "function") { cancelFocusCorrection(); return; }
    pendingFocus = {target, sequence: pointerSequence};
    // Rapid focusin events share one paint-time correction for the current
    // action. Never scroll synchronously between pointerdown and native click.
    if (focusFrame !== null) return;
    focusFrame = window.requestAnimationFrame(() => {
      focusFrame = null;
      const current = pendingFocus; pendingFocus = null;
      if (current) correctFocusedAction(current.target, current.sequence);
    });
  }
  function mount() {
    document.addEventListener("pointerdown", beginPointer, true);
    document.addEventListener("pointerup", endPointer, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    document.addEventListener("click", finishPointerClick, true);
    document.addEventListener("keydown", () => { if (!pointers.size) resetPointerOrigin(); }, true);
    window.addEventListener("blur", () => { windowActive = false; resetPointerOrigin(); });
    window.addEventListener("focus", () => { windowActive = true; });
    window.addEventListener("pagehide", () => { pageActive = false; resetPointerOrigin(); });
    window.addEventListener("pageshow", () => { pageActive = true; });
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelFocusCorrection(); });
    for (const button of openers) button.addEventListener("click", () => {
      onRefresh(); opener = button; explicitlyOpened = true; panel.classList.remove("privacy-controls--top"); setMinimized(false); panel.hidden = false; render(); nodes.heading.focus();
    });
    nodes.allow.addEventListener("click", () => { if (onChoose(true)) close(); });
    nodes.reject.addEventListener("click", () => { if (onChoose(false)) close(); });
    nodes.close.addEventListener("click", close);
    panel.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented || panel.hidden || !panel.contains(document.activeElement)) return;
      event.preventDefault(); event.stopPropagation(); close();
    });
    document.addEventListener("focusin", keepFocusedActionVisible);
    const state = snapshot();
    panel.hidden = !canonical || preferences.valid(state.choice) || state.gpc || preferences.dismissed(); render();
    if (!panel.hidden) announcement.textContent = state.eligible
      ? "Privacy choices are available. Optional analytics is off until you allow it. You can allow or reject analytics in Privacy choices."
      : "Privacy choices are available. Optional analytics is currently off on this page.";
  }
  return Object.freeze({ ready: true, mount, render });
}
