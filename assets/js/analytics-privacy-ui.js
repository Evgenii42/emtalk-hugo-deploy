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
  let opener = null, minimized = false;
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
    panel.hidden = true; setMinimized(false); render();
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
  function keepFocusedActionVisible(event) {
    const target = event.target;
    if (!target || target.tabIndex < 0 || typeof target.getBoundingClientRect !== "function") return;
    if (minimized) { exposeMinimizedOpener(target); return; }
    if (panel.hidden || panel.contains(target)) return;
    const covered = () => intersects(target.getBoundingClientRect(), panel.getBoundingClientRect());
    if (!covered()) return;
    window.scrollBy({ top: Math.ceil(target.getBoundingClientRect().bottom - panel.getBoundingClientRect().top) + 12, left: 0, behavior: "auto" });
    if (!covered() || document.activeElement !== target) return;
    // Automatic focus recovery is not an explicit dismissal or a consent choice.
    panel.hidden = true; opener = null; setMinimized(true); render(); exposeMinimizedOpener(target);
    announcement.textContent = "Privacy choices were minimized to keep your focused control visible. Your analytics choice is unchanged. Use Privacy choices (minimized) to reopen them.";
  }
  function mount() {
    for (const button of openers) button.addEventListener("click", () => {
      onRefresh(); opener = button; setMinimized(false); panel.hidden = false; render(); nodes.heading.focus();
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
