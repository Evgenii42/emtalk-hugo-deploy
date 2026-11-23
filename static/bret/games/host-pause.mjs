// Pause owns scene input and status only. The host owns session state; read
// it again after commands that may synchronously recover or lose ownership.
export function pauseGameSession({ readSession, stop, checkpoint, progressStore, $ }, reason = "manual") {
  const { run, controller, playing } = readSession();
  if (!run || !controller || (!playing && reason !== "conflict")) return;
  if (playing) {
    stop();
    if (!readSession().run || !readSession().controller) return;
    if (progressStore.writable && checkpoint() === false) return;
    if (!readSession().run || !readSession().controller) return;
  }
  // A conflict can arrive during checkpoint or while already paused. Keep its
  // recovery action beside the paused scene instead of only above the viewport.
  const blocked = !progressStore.writable;
  if (blocked) reason = "conflict";
  $("[data-play-progress]").setAttribute("aria-live", "polite");
  // Pause blocks scene input, not app navigation: players can freely leave
  // for another Bret direction. This is a non-modal group, not a focus trap.
  $("[data-stage]").inert = true;
  $("[data-session-bar]").inert = true;
  $("[data-overlay]").hidden = false;
  const messages = {
    manual: ["Paused. Your place is kept.", "Take your time. Your active play time is paused too."],
    background: ["Paused while you were away.", "Take your time. Your active play time is paused too."],
    focus: ["Paused for a change of focus.", "The window lost focus. Your active play time is paused too. Continue when ready."],
    resume: ["Your scene is ready.", "Take a moment to find your place, then continue when you like. Active play time will start when you continue."],
    intention: ["Your little time intention is complete.", "Finish for now, or stay with this scene a little longer. No need to hurry."],
    conflict: ["Paused to keep your progress safe.", "Progress changed in another tab. Reload this tab to read the latest saved place before continuing. Your active time is paused."],
  };
  const [title, explanation] = messages[reason] || messages.manual;
  $("[data-overlay-title]").textContent = title;
  $("[data-overlay-copy]").textContent = explanation;
  const stopped = title.startsWith("Paused") ? "" : "Play is paused. ";
  $("[data-play-progress]").textContent = `${title} ${stopped}${explanation} ${readSession().progressText}`.trim();
  const continueButton = $("[data-continue]");
  continueButton.textContent = blocked ? "Reload to continue" : "Continue playing";
  // The pause group spans the whole game. Reveal its focused control even when
  // the Pause button or the current move sits far above the group centre.
  continueButton.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
  continueButton.focus({ preventScroll: true });
}

export function resumeGameSession({ readSession, isHidden, reload, progressStore, canPlay, $, beginPlaying, runtimeFailure }) {
  const { run, controller, progressText } = readSession();
  if (!run || !controller || isHidden()) return;
  if (!progressStore.writable) {
    reload();
    return;
  }
  if (!canPlay()) return;
  $("[data-stage]").inert = false;
  $("[data-session-bar]").inert = false;
  $("[data-overlay]").hidden = true;
  $("[data-play-progress]").setAttribute("aria-live", "off");
  $("[data-play-progress]").textContent = progressText;
  beginPlaying();
  try {
    controller.focus();
  } catch {
    runtimeFailure();
  }
}

export function handleGamePauseKey({ root, $, playing, run, controller, pause, resume }, e) {
  if (e.key !== "Escape" || e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (root.dataset.bretSection !== "games" || !$("[data-bret-menu]").hidden) return;
  if (playing) {
    e.preventDefault();
    pause();
  // Escape belongs to this non-modal group only when focus is inside it.
  // Navigation and an open menu retain ownership of their keyboard controls.
  } else if (run && controller && !$("[data-overlay]").hidden && $("[data-overlay]").contains(e.target)) {
    e.preventDefault();
    resume();
  }
}
