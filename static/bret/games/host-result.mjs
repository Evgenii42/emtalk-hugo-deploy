// A finish write can discover another writer synchronously. Only a conflict
// rejects this visit's checkpoint; memory fallback intentionally keeps it.
export function writeFinishedPlace({ db, run, completed, write }) {
  const previous = db.last;
  db.last = completed ? null : { ...run };
  const outcome = write();
  if (outcome?.conflict) db.last = previous;
  return outcome;
}

// Rendering receives a settled outcome. It has no host lifecycle, ownership,
// or accounting commands and does not mutate the supplied state.
export function renderSceneResult({ $, $$, db, run, result, completed, writable, storage, award, art, fmt }) {
  $("[data-session]").hidden = true;
  $("[data-result]").hidden = false;
  $("[data-result-art]").innerHTML = art(run.id);
  $("[data-result-title]").textContent =
    result.title ||
    (db.state === "sleep"
      ? "A little moment, then rest."
      : "A little space, made by you.");
  $("[data-result-detail]").textContent =
    !writable
      ? (result.detail ? result.detail + " " : "") + "Your result is kept for this visit only. Saved progress was not changed. Reload this tab before starting another scene."
      : result.detail || (completed
      ? "Your scene is complete."
      : storage
        ? "Your place is saved. Continue this scene to keep it, or replace this saved place with a new scene."
        : "Your place is kept for this visit. Continue this scene to keep it, or replace this place with a new scene. Browser saving is unavailable.");
  $("[data-result-time]").textContent = fmt(run.activeMs);
  $("[data-result-xp]").textContent = `+${award.earnedXP + award.bonus} XP`;
  $("[data-result-xp] + span").textContent = writable ? "earned in this scene" : "scene XP (not saved)";
  $("[data-result-level]").textContent = !writable ? "Kept this visit" : completed
    ? award.passed
      ? "Goal complete"
      : "Scene played"
    : storage
      ? "Place saved"
      : "Kept this visit";
  $("[data-next]").textContent =
    !completed
      ? storage
        ? "Replace saved place with a new scene"
        : "Replace this place with a new scene"
      : writable && run.mode === "levels" && award.passed
      ? `Next level · ${db.levels[run.id]}`
      : "A new scene, same pace";
  $("[data-retry]").textContent = completed
    ? "Replay this scene"
    : "Continue this scene";
  $("[data-next]").disabled = !writable;
  $("[data-retry]").disabled = !writable;
  $("[data-next]").classList.toggle("games-primary", db.state !== "sleep");
  $("[data-done]").classList.toggle("games-primary", db.state === "sleep");
  $$("[data-feedback]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  $("[data-feedback-status]").textContent = "";
  $("[data-result-title]").scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
  $("[data-result-title]").focus({ preventScroll: true });
}
