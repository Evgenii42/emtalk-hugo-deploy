import { savingUnavailableNotice } from "./storage-notice.mjs";
import { pauseGameSession, resumeGameSession, handleGamePauseKey } from "./host-pause.mjs";
import { renderSceneResult, writeFinishedPlace } from "./host-result.mjs";
import { mountGame } from "./play.mjs";
import { accrueTime, settleGoal } from "./session.mjs";
import { setupDirections } from "./directions.mjs";
import { setupMeditation } from "./meditation.mjs";
import { createProgressStore } from "./persistence.mjs";
import { createViewHistory } from "./navigation.mjs";
import { setTextIfChanged, playedTimeLabel, formatClock } from "./ui.mjs";
import { normalizeProgress } from "./progress.mjs";
import { GAMES, STATES, HOME_COPY } from "./catalog.mjs";
import { createGameArtwork } from "./illustrations.mjs";
import { isValidSavedRun as validLast, advanceSceneFrame } from "./host-contracts.mjs";
import {
  validTier, validMode, validDuration, tierLabel, modeLabel, durationRunLabel,
} from "./options.mjs";
import {
  getLastStartedGame,
  getGamePreferences,
  rememberGameStarted,
} from "./selection.mjs";
const root = document.querySelector("[data-games-root]");
let cleanupInitialization = () => {};
function initializationFailure(error) {
  try {
    cleanupInitialization();
  } catch {
    // Recovery stays available even when a partial initialization cannot clean up.
  }
  console.error("Bret could not initialize", error);
  if (!root) return;
  const notice = root.querySelector("[data-games-load-error]");
  if (!notice) return;
  notice.hidden = false;
  // Keep the recovery link reachable while failed game controls are inert.
  for (const child of root.children)
    if (child !== notice && !child.contains(notice)) child.inert = true;
  notice.focus({ preventScroll: true });
  root.dispatchEvent?.(new Event("bret:failed"));
}
// Host lifecycle callbacks use named declarations as an intentional internal
// AST test boundary. Reusable rules/state/formatting live in directly imported
// modules; update the lifecycle contract tests if moving or renaming callbacks.
// The tests do not execute this browser bootstrap or certify native DOM/AT.
async function initializeGames(root) {
const $ = (s) => root.querySelector(s),
  $$ = (s) => [...root.querySelectorAll(s)];
// Failure cleanup aborts global host subscriptions. Ordinary pagehide keeps
// them alive so the same page can restore through BFCache pageshow.
const lifecycleAbort = new AbortController();
const KEY = "bret-games-site-v1";
const empty = () => normalizeProgress(null, {
  gameIds: GAMES.map((game) => game.id),
  stateIds: STATES.map((state) => state.id),
  isValidCheckpoint: validLast,
});
let db = empty(),
  storage = true,
  storeReady = false;
let progressGeneration = 0, progressClosed = false;
let selected = null,
  controller = null,
  run = null,
  playing = false,
  lastFrame = 0,
  saveElapsed = 0,
  runResult = null,
  directions = null,
  meditation = null,
  progressText = "";
let frameId = 0;
let checkpointRequest = null;
// A scene owns its recovery callback. Repeated or stale failures cannot close
// a newer scene or announce recovery twice.
let failureContext = { handled: false };
let ticking = false,
  pendingCompletion = null;
function hydrate(raw) {
  db = normalizeProgress(raw, {
    gameIds: GAMES.map((game) => game.id),
    stateIds: STATES.map((state) => state.id),
    isValidCheckpoint: validLast,
  });
}

let browserStorage;
try {
  browserStorage = globalThis.localStorage;
} catch {}
// Use the same captured capability for ownership and its visit-only notice.
const browserLocks = globalThis.navigator?.locks;
const unavailableSavingNotice = savingUnavailableNotice(browserLocks);
const progressStore = createProgressStore({
  key: KEY,
  storage: browserStorage,
  locks: browserLocks,
  onConflict: () => {
    storage = false;
    syncAvailability();
    pause("conflict");
    storageNotice(
      "Progress changed in another tab. Reload this tab before continuing.",
    );
  },
  onUnavailable: () => {
    storage = false;
    storageNotice(
      unavailableSavingNotice,
    );
  },
});
function cleanupGamesInitialization() {
  lifecycleAbort.abort();
  progressGeneration++;
  failureContext.handled = true;
  try {
    destroy();
  } finally {
    try {
      if (typeof meditation?.dispose === "function") meditation.dispose();
      else meditation?.hide();
    } finally {
      try { directions?.dispose?.(); }
      finally { progressStore.close(); }
    }
  }
}
cleanupInitialization = cleanupGamesInitialization;
function canPlay() {
  if (storeReady && progressStore.writable) return true;
  notice(
    progressClosed
      ? "Saved progress could not be opened. Reload this tab to try again."
      : storeReady
        ? "Games are open in another tab. Close that tab and reload here to continue safely."
        : "Preparing your saved progress. Please try again in a moment.",
  );
  return false;
}
function write() {
  return storeReady ? progressStore.write(JSON.stringify(db)) : { ok: false };
}
function syncAvailability() {
  const writable = storeReady && progressStore.writable;
  $$("[data-theme],[data-game-home-play],[data-resume-run],[data-discard-run],[data-feedback],[data-state-choice],[data-cards] button,[data-setup-start],[data-setup-form] select,[data-setup-form] [name=unhurried]").forEach(
    (button) => { button.disabled = !writable; },
  );
}
function markProgressReady() {
  root.dataset.gamesReady = "true";
  $("[data-games-load-error]").hidden = true;
  root.dispatchEvent(new Event("bret:ready"));
}
async function beginProgress(restored = false) {
  const generation = ++progressGeneration;
  if (progressClosed) notice("");
  progressClosed = false;
  storeReady = false;
  root.dataset.gamesReady = "false";
  syncAvailability();
  let state;
  try {
    state = await progressStore.begin();
  } catch (error) {
    if (generation !== progressGeneration) return false;
    throw error;
  }
  if (generation !== progressGeneration) return false;
  if (state.mode === "closed") {
    progressClosed = true;
    storage = false;
    storageNotice("Saved progress could not be opened. Reload this tab to try again.");
    $("[data-games-load-error]").hidden = false;
    if (!$("[data-garden]").hidden) renderGarden();
    return false;
  }
  hydrate(state.raw);
  storeReady = true;
  storage = state.writable && state.mode !== "memory";
  syncAvailability();
  if (storage) {
    $("[data-storage]").hidden = true;
    $("[data-storage]").textContent = "";
  }
  theme();
  renderCatalog();
  renderGameHome();
  if (!$("[data-garden]").hidden) renderGarden();
  if (state.mode === "memory")
    storageNotice(
      unavailableSavingNotice,
    );
  if (restored) restoreNavigation({ force: true, initial: true });
  else if (selected && !$("[data-setup]").hidden) {
    applySetupPreferences(selected.id);
    showReplacementChoice();
  }
  if (!state.writable)
    storageNotice(
      "Games are open in another tab. Close that tab and reload here to continue safely.",
    );
  markProgressReady();
  return true;
}
if (!validLast(db.last)) db.last = null;
const fmt = formatClock;
const xp = () => Math.floor(db.totalMs / 15000) + db.bonusXP;
function totals() {
  $$("[data-total-xp]").forEach((node) => setTextIfChanged(node, `${xp()} XP`));
  $$("[data-total-time]").forEach((node) => setTextIfChanged(node, playedTimeLabel(db.totalMs)));
}
function seeded() {
  const a = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(a);
  else a[0] = Math.floor(Math.random() * 4294967295);
  return a[0];
}
const art = createGameArtwork();
function theme() {
  root.classList.toggle("is-evening", Boolean(db.evening));
  $("[data-theme]").setAttribute("aria-pressed", String(Boolean(db.evening)));
}
function toggleTheme() {
  if (!canPlay()) return;
  const previous = db.evening;
  db.evening = !previous;
  theme();
  const result = write();
  // Visit-only writes stay in memory; a rejected owner keeps the prior theme.
  if (result?.conflict) {
    db.evening = previous;
    theme();
  }
}
$("[data-theme]").addEventListener("click", toggleTheme);
function state() {
  return STATES.find((s) => s.id === db.state) || STATES[0];
}
function updateCatalogSelection(focusState) {
  const s = state();
  $("[data-state-note]").textContent = s.note;
  for (const button of $$("[data-state-choice]")) {
    const selected = button.dataset.stateChoice === s.id;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (button.dataset.stateChoice === focusState) button.focus({ preventScroll: true });
  }
  // State changes affect recommendations, not game artwork or progress copy.
  // Move the existing cards so focusable controls and SVG nodes stay intact.
  const cards = [...$("[data-cards]").children];
  const ordered = [...GAMES].sort((a, b) => Number(b.id === s.pick) - Number(a.id === s.pick));
  for (const game of ordered) {
    const card = cards.find(node => node.dataset.gameCard === game.id);
    if (!card) continue;
    card.querySelector(".games-card-badge").textContent = game.id === s.pick ? "PICKED FOR YOU" : game.tag.toUpperCase();
    $("[data-cards]").append(card);
  }
}
function renderCatalog(focusState = null) {
  if (!storeReady) return;
  const s = state();
  $("[data-state-note]").textContent = s.note;
  $("[data-states]").replaceChildren();
  for (const choice of STATES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = choice.label;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(choice.id === s.id));
    b.tabIndex = choice.id === s.id ? 0 : -1;
    b.dataset.stateChoice = choice.id;
    const choose = (id) => {
      if (!canPlay()) return;
      const previousState = db.state;
      // Recommendation answers never change the separate theme preference.
      db.state = id;
      const result = write();
      // Memory-only writes retain this choice; an ownership conflict does not.
      if (result?.conflict) {
        db.state = previousState;
      }
      updateCatalogSelection(result?.conflict ? previousState : id);
    };
    b.addEventListener("click", () => choose(choice.id));
    b.addEventListener("keydown", (event) => {
      const index = STATES.indexOf(choice);
      const keys = {
        ArrowRight: (index + 1) % STATES.length,
        ArrowDown: (index + 1) % STATES.length,
        ArrowLeft: (index + STATES.length - 1) % STATES.length,
        ArrowUp: (index + STATES.length - 1) % STATES.length,
        Home: 0,
        End: STATES.length - 1,
      };
      if (Object.prototype.hasOwnProperty.call(keys, event.key)) {
        event.preventDefault();
        choose(STATES[keys[event.key]].id);
      }
    });
    $("[data-states]").append(b);
  }
  $("[data-cards]").replaceChildren();
  const ordered = [...GAMES].sort(
    (a, b) => Number(b.id === s.pick) - Number(a.id === s.pick),
  );
  // Only generated decorative SVG is markup. Copy uses DOM text/attribute
  // APIs so a future catalog string cannot become executable card HTML.
  for (const g of ordered) {
    const card = document.createElement("article");
    card.className = "games-card";
    card.dataset.gameCard = g.id;
    card.innerHTML = `<div class="games-card-art">${art(g.id)}<span class="games-card-badge"></span></div><div class="games-card-copy"><h3></h3><p></p><div class="games-card-tags"><span data-card-skill></span><span data-card-time></span></div><div class="games-card-bottom"><span data-card-level></span><button type="button">Choose game <span aria-hidden="true">↗</span></button></div></div>`;
    card.querySelector(".games-card-badge").textContent = g.id === s.pick ? "PICKED FOR YOU" : g.tag.toUpperCase();
    card.querySelector("h3").textContent = g.name;
    card.querySelector(".games-card-copy>p").textContent = g.description;
    card.querySelector("[data-card-skill]").textContent = g.skill;
    card.querySelector("[data-card-time]").textContent = g.time.replace("-", " to ");
    card.querySelector("[data-card-level]").textContent = `Level ${db.levels[g.id]} · Your pace`;
    card.querySelector("button").setAttribute("aria-label", `Choose game: ${g.name}`);
    card
      .querySelector("button")
      .addEventListener("click", () => {
        if (canPlay()) openSetup(g.id);
      });
    $("[data-cards]").append(card);
  }
  const resume = db.last;
  $("[data-resume]").hidden = !resume;
  if (resume)
    $("[data-resume-description]").textContent =
      `${GAMES.find((g) => g.id === resume.id).name} · ${fmt(resume.activeMs)} of active play · ${tierLabel(resume.tier)}${resume.unhurried ? " · Unhurried turns" : ""}`;
  totals();
  syncAvailability();
  if (focusState)
    $$("[data-state-choice]")
      .find((button) => button.dataset.stateChoice === focusState)
      ?.focus({ preventScroll: true });
}
function queueCheckpoint() {
  if (!run || !controller || runResult?.completed || runResult?.readOnly) return;
  const owner = run;
  if (checkpointRequest?.owner === owner) return;
  // This one-second debounce intentionally may outlive a pause/teardown. The
  // identity and playing checks below make a late callback a no-op for stopped
  // or replaced scenes; a same-scene resume may save its current snapshot.
  const request = { owner };
  checkpointRequest = request;
  setTimeout(() => {
    if (checkpointRequest === request) checkpointRequest = null;
    if (run === owner && playing) checkpoint();
  }, 1000);
}
function checkpoint() {
  if (!run || !controller || runResult?.completed || runResult?.readOnly) return true;
  try {
    const snapshot = controller.snapshot();
    // The host settles terminal scenes; they are never resumable checkpoints.
    if (snapshot.done === true) return true;
    run.snapshot = snapshot;
    db.last = { ...run };
    write();
    return true;
  } catch {
    runtimeFailure();
    return false;
  }
}
// Storage safety is persistent and independent of transient validation/recovery
// notices. Changing game views or showing a benign notice cannot erase it.
function storageNotice(message) {
  const node = $("[data-storage]");
  node.hidden = !message;
  setTextIfChanged(node, message);
}
function notice(message) {
  const node = $("[data-notice]");
  node.hidden = !message;
  setTextIfChanged(node, message);
}

function stop() {
  playing = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  lastFrame = 0;
  try {
    controller?.pause?.();
  } catch {
    runtimeFailure();
  }
}
function destroy() {
  stop();
  try {
    controller?.destroy();
  } catch {
    /* The host still releases its reference. */
  }
  controller = null;
  pendingCompletion = null;
}
function runtimeFailure(context = failureContext) {
  if (context !== failureContext || context.handled) return;
  context.handled = true;
  playing = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
  lastFrame = 0;
  const failedController = controller;
  controller = null;
  run = null;
  runResult = null;
  pendingCompletion = null;
  try {
    failedController?.destroy?.();
  } catch {
    /* Keep the last good checkpoint. */
  }
  library();
  const checkpointAvailable = validLast(db.last);
  const recovery = !progressStore.writable
    ? "Reload this tab before continuing."
    : checkpointAvailable
      ? db.last.id === homeGame().id
        ? "Continue from your last checkpoint with Play."
        : "Your earlier scene is available in Game settings."
      : "Choose a game to begin a fresh scene.";
  const saving =
    !storage && progressStore.writable
      ? " Saving is unavailable; progress is kept for this visit only."
      : "";
  notice("This scene stopped unexpectedly. " + recovery + saving);
  const heading = $("[data-game-home] h1");
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}
function homeGame() {
  return GAMES.find((g) => g.id === getLastStartedGame(db)) || GAMES[0];
}
function preferencesFor(id) {
  return getGamePreferences(db, id, {
    tier: state().tier,
    mode: db.state === "focus" ? "levels" : "stable",
    duration: state().duration,
  });
}
function renderGameHome() {
  if (!storeReady) return;
  const g = homeGame(),
    saved = validLast(db.last) && db.last.id === g.id ? db.last : null,
    prefs = saved || preferencesFor(g.id);
  $("[data-game-home-art]").innerHTML = art(g.id);
  $("[data-game-home-name]").textContent = g.name;
  $("[data-game-home-category]").textContent = g.type;
  $("[data-game-home-copy]").textContent = HOME_COPY[g.id];
  $("[data-game-home-chip]").textContent =
    (saved
      ? "Continue · " + fmt(saved.activeMs)
      : prefs.mode === "levels"
        ? "Level " + db.levels[g.id]
        : modeLabel(prefs.mode)) +
    " · " +
    tierLabel(prefs.tier) + (prefs.unhurried ? " · Unhurried turns" : "");
  $("[data-game-home-play]").setAttribute(
    "aria-label",
    (saved ? "Continue " : "Play ") + g.name,
  );
  syncAvailability();
  $("[data-game-home-note]").textContent = saved
    ? "Your place is ready. Continue whenever you like."
    : db.lastStartedGameId
      ? "Your last launched game. Choose another in settings."
      : "Choose another game or adjust the pace in settings.";
  totals();
}
function hideViews() {
  meditation?.hide();
  $$("[data-game-home],[data-catalog],[data-player],[data-garden]").forEach(
    (n) => (n.hidden = true),
  );
}
function library({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (run && controller && checkpoint() === false) return false;
  destroy();
  run = null;
  selected = null;
  hideViews();
  $("[data-game-home]").hidden = false;
  renderGameHome();
  recordView("games");
  if (focus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    $("[data-game-home] h1").focus({ preventScroll: true });
  }
}
function gameSettings({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (run && controller && checkpoint() === false) return false;
  destroy();
  run = null;
  selected = null;
  hideViews();
  $("[data-catalog]").hidden = false;
  renderCatalog();
  recordView("game-settings");
  if (focus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    $("[data-catalog] h1").focus({ preventScroll: true });
  }
}
function playHomeGame() {
  if (!canPlay()) return;
  const g = homeGame(),
    saved = validLast(db.last) && db.last.id === g.id ? { ...db.last } : null;
  if (openSetup(g.id) === false) return;
  if (!saved && validLast(db.last)) {
    notice("Your paused scene is still kept. Review the replacement note before starting a fresh scene.");
    return;
  }
  start(saved || preferencesFor(g.id));
}
$("[data-game-home-play]").addEventListener("click", playHomeGame);
$("[data-game-settings]").addEventListener("click", gameSettings);

function applySetupPreferences(id) {
  const prefs = preferencesFor(id),
    f = $("[data-setup-form]");
  f.elements.mode.value = prefs.mode;
  f.elements.tier.value = String(prefs.tier);
  f.elements.duration.value = String(prefs.duration);
  if (f.elements.unhurried) f.elements.unhurried.checked = id === "moles" && prefs.unhurried === true;
  $("[data-unhurried-setting]").hidden = id !== "moles";
}
// True opens the requested setup. False rejects an unknown game or blocked save.
// Validate ids before changing the current scene or navigation.
function openSetup(id, { focus = true } = {}) {
  const game = GAMES.find((g) => g.id === id);
  if (!game) return false;
  notice("");
  directions?.show("games", { notify: false });
  if (controller) {
    if (checkpoint() === false) return false;
    destroy();
  }
  run = null;
  selected = game;
  hideViews();
  $("[data-player]").hidden = false;
  $("[data-setup]").hidden = false;
  $("[data-session]").hidden = true;
  $("[data-result]").hidden = true;
  $("[data-player-title]").textContent = selected.name;
  $("[data-player-category]").textContent = selected.type;
  $("[data-player-subtitle]").textContent = selected.description;
  $("[data-how]").textContent = selected.how;
  $("[data-why]").textContent = selected.why;
  $("[data-setup-art]").innerHTML = art(id);
  $("[data-active-time]").textContent = "0:00";
  applySetupPreferences(id);
  showReplacementChoice();
  $("[data-back]").textContent = "← Game settings";
  recordView(id);
  $("[data-player-title]").setAttribute("tabindex", "-1");
  if (focus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    $("[data-player-title]").focus({ preventScroll: true });
  }
  return true;
}
function showReplacementChoice() {
  const saved = validLast(db.last) ? db.last : null;
  const note = $("[data-replace-note]");
  note.hidden = !saved;
  note.textContent = saved
    ? `Starting a fresh scene replaces your paused ${GAMES.find((g) => g.id === saved.id).name} at ${fmt(saved.activeMs)}. Your total play time and XP stay.`
    : "";
  $("[data-setup-start-label]").textContent = saved ? "Replace paused scene and play" : "Let's play";
}
function start(options, { replaceSaved = false } = {}) {
  if (!canPlay()) return;
  if (!validTier(options.tier) || !validMode(options.mode) || !validDuration(options.duration)) {
    notice("Choose a challenge, pace and time from the game settings before starting.");
    return;
  }
  const game = options.id === undefined ? selected : GAMES.find(g => g.id === options.id);
  if (!game) { notice("Choose an available game before starting."); return; }
  if ((options.unhurried !== undefined && typeof options.unhurried !== "boolean") || (options.unhurried === true && game.id !== "moles")) {
    notice("Unhurried turns are available for Seed Keepers. Choose this setting before starting.");
    return;
  }
  if (selected !== game) openSetup(game.id, { focus: false });
  if (selected !== game) return;
  if (!options.snapshot && db.last && validLast(db.last) && !replaceSaved) {
    openSetup(game.id);
    notice("Your paused scene is still kept. Review the replacement note before starting a fresh scene.");
    return;
  }
  notice("");
  destroy();
  if (selected !== game) return;
  // Copy the documented resume envelope explicitly. Lifecycle-only fields such
  // as settled belong to this newly mounted session, not its incoming options.
  run = {
    version: 1,
    id: selected.id,
    tier: options.tier,
    seed: options.seed ?? seeded(),
    mode: options.mode,
    duration: options.duration,
    activeMs: options.activeMs ?? 0,
    earnedXP: options.earnedXP ?? 0,
    level:
      options.level ?? (options.mode === "levels"
        ? Math.max(db.levels[selected.id], options.tier * 3 + 1)
        : db.levels[selected.id]),
    bonusAwarded: options.bonusAwarded ?? false,
    intentionSeen: options.intentionSeen ?? false,
    snapshot: options.snapshot ?? null,
    ...(selected.id === "moles" && options.unhurried === true ? { unhurried: true } : {}),
  };
  runResult = null;
  const sceneFailureContext = failureContext = { handled: false };
  $$("[data-setup],[data-result]").forEach((n) => (n.hidden = true));
  $("[data-session]").hidden = false;
  $("[data-overlay]").hidden = true;
  $("[data-stage]").inert = false;
  $("[data-session-bar]").inert = false;
  progressText = "";
  $("[data-play-progress]").textContent = "";
  $("[data-play-progress]").setAttribute("aria-live", "off");
  $("[data-hint]").disabled = false;
  try {
    controller = mountGame($("[data-stage]"), {
      id: run.id,
      tier: run.tier,
      seed: run.seed,
      mode: run.mode,
      resume: run.snapshot || null,
      ...(run.unhurried ? { unhurried: true } : {}),
      onProgress: (t) => {
        progressText = t;
        const node = $("[data-play-progress]");
        if (node.textContent !== t) node.textContent = t;
      },
      onComplete: completeScene,
      onError: () => runtimeFailure(sceneFailureContext),
      onCheckpoint: () => queueCheckpoint(),
    });
  } catch (e) {
    console.error("Bret game initialization failed", e);
    destroy();
    // A failed restore/mount never consumes the saved slot. Only an explicit
    // replacement action may replace it after the player sees the warning.
    run = null;
    openSetup(game.id);
    notice(e?.code === "BRET_INVALID_CHECKPOINT"
      ? "Your saved scene could not be restored. It is still kept. Start a fresh scene below to replace it; your total play time and XP stay."
      : "This scene could not be opened. Any paused scene is still kept. Choose your pace to try a fresh scene.");
    return;
  }
  rememberGameStarted(db, run);
  $("[data-back]").textContent = "← Back to Games";
  $("[data-run-label]").textContent =
    `${run.mode === "stable" ? modeLabel(run.mode) : `Level ${run.level}`} · ${tierLabel(run.tier)} · ${durationRunLabel(run.duration)}${run.unhurried ? " · Unhurried turns" : ""}`;
  setTextIfChanged($("[data-active-time]"), fmt(run.activeMs));
  playing = true;
  lastFrame = 0;
  saveElapsed = 0;
  if (checkpoint() === false) return;
  scheduleFrame();
  try {
    controller.focus();
  } catch {
    runtimeFailure();
  }
}
$("[data-setup-form]").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  start({
    tier: Number(f.elements.tier.value),
    mode: f.elements.mode.value,
    duration: Number(f.elements.duration.value),
    ...(selected?.id === "moles" && f.elements.unhurried?.checked ? { unhurried: true } : {}),
  }, { replaceSaved: !$("[data-replace-note]").hidden });
});
function pause(reason = "manual") {
  return pauseGameSession({
    readSession: () => ({ run, controller, playing, progressText }),
    stop, checkpoint, progressStore, $,
  }, reason);
}
function resume() {
  return resumeGameSession({
    readSession: () => ({ run, controller, progressText }),
    isHidden: () => document.hidden, reload: () => window.location.reload(),
    progressStore, canPlay, $, runtimeFailure: () => runtimeFailure(),
    beginPlaying: () => { lastFrame = 0; playing = true; scheduleFrame(); },
  });
}
function finish(result = {}, completed = false) {
  if (!run || !controller) return;
  if (!canPlay()) {
    // Lost ownership cannot replace the last good place while leaving play.
    destroy();
    run = null;
    runResult = null;
    selected = null;
    library();
    // Home clears transient guidance; keep the blocked action reason visible.
    canPlay();
    return;
  }
  if (runResult) return;
  stop();
  if (!run || !controller) return;
  let snap;
  try {
    snap = controller.snapshot();
  } catch {
    runtimeFailure();
    return;
  }
  let writable = canPlay();
  // A conflict must not discard the result or alter the store owner's progress.
  // Preview the same accounting on copies; only the current visit displays it.
  const beforeSettlement = writable ? {
    bonusXP: db.bonusXP, completed: db.completed, levels: { ...db.levels },
    run, bonusAwarded: run.bonusAwarded,
    hadSettled: Object.hasOwn(run, "settled"), settled: run.settled,
  } : null;
  const resultDb = writable ? db : { ...db, levels: { ...db.levels } };
  const award = settleGoal(resultDb, writable ? run : { ...run }, result, completed);
  runResult = { ...result, completed, passed: award.passed, readOnly: !writable };
  run.snapshot = snap;
  if (writable) {
    const outcome = writeFinishedPlace({ db, run, completed, write });
    if (outcome?.conflict) {
      // Keep the displayed scene award, but reject its unsaved goal accounting.
      db.bonusXP = beforeSettlement.bonusXP;
      db.completed = beforeSettlement.completed;
      db.levels = beforeSettlement.levels;
      beforeSettlement.run.bonusAwarded = beforeSettlement.bonusAwarded;
      if (beforeSettlement.hadSettled) beforeSettlement.run.settled = beforeSettlement.settled;
      else delete beforeSettlement.run.settled;
    }
    // The guarded write can discover an ownership conflict synchronously.
    writable = canPlay();
    if (!run || !controller) return;
    runResult.readOnly = !writable;
  }
  renderSceneResult({ $, $$, db, run, result, completed, writable, storage, award, art, fmt });
  totals();
}
$("[data-pause]").addEventListener("click", () => pause());
$("[data-continue]").addEventListener("click", resume);
$("[data-save-exit]").addEventListener("click", () => finish({}, false));
$("[data-finish]").addEventListener("click", () => finish({}, false));
$("[data-back]").addEventListener("click", () => {
  if (!$("[data-setup]").hidden) gameSettings();
  else library();
});
$("[data-done]").addEventListener("click", library);
$$("[data-library]").forEach((b) => b.addEventListener("click", library));
$("[data-hint]").addEventListener("click", () => {
  if (playing) {
    try {
      controller?.hint();
      checkpoint();
    } catch {
      runtimeFailure();
    }
  }
});
$("[data-next]").addEventListener("click", () => {
  if (!run) return;
  const previous = { ...run },
    done = runResult?.passed;
  const nextLevel = done ? db.levels[previous.id] : previous.level;
  const tier =
    previous.mode === "levels" && done
      ? Math.min(2, Math.floor((nextLevel - 1) / 3))
      : previous.tier;
  start({
    id: previous.id,
    tier,
    mode: previous.mode,
    duration: previous.duration,
    level: nextLevel,
    ...(previous.unhurried ? { unhurried: true } : {}),
  }, { replaceSaved: true });
});
$("[data-retry]").addEventListener("click", () => {
  if (!run) return;
  const previous = { ...run };
  start(
    runResult?.completed
      ? {
          tier: previous.tier,
          seed: previous.seed,
          mode: previous.mode,
          duration: previous.duration,
          level: previous.level,
          ...(previous.unhurried ? { unhurried: true } : {}),
        }
      : { ...previous },
  );
});
function resumeSavedRun() {
  if (!db.last || !canPlay()) return;
  const saved = { ...db.last };
  openSetup(saved.id);
  start(saved);
  pause("resume");
}
$("[data-resume-run]").addEventListener("click", resumeSavedRun);
function discardSavedRun() {
  if (!canPlay()) return;
  db.last = null;
  write();
  renderCatalog();
  $("[data-catalog] h1").focus({ preventScroll: true });
}
$("[data-discard-run]").addEventListener("click", discardSavedRun);
$$("[data-feedback]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!canPlay()) return;
    $$("[data-feedback]").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)),
    );
    $("[data-feedback-status]").textContent =
      "Thank you. This reflection stays on this device.";
    db.lastReflection = {
      state: db.state,
      game: run?.id,
      value: b.dataset.feedback,
    };
    write();
  }),
);
function renderGarden() {
  if (!storeReady) {
    $("[data-garden-stats]").replaceChildren();
    $("[data-garden-summary]").textContent = progressClosed
      ? "Saved progress could not be opened. Reload this tab to see your garden."
      : "Loading your saved garden...";
    return;
  }
  $("[data-garden-art]").innerHTML = art("moles");
  $("[data-garden-summary]").textContent =
    `${playedTimeLabel(db.totalMs)}, ${xp()} XP and ${db.completed} ${db.completed === 1 ? "scene" : "scenes"} played. Every comfortable pace counts.`;
  $("[data-garden-stats]").replaceChildren();
  for (const g of GAMES) {
    const box = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = g.name;
    const level = document.createElement("span");
    level.textContent = `Level ${db.levels[g.id]}`;
    box.append(title, level);
    $("[data-garden-stats]").append(box);
  }
}
function garden({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (controller) {
    if (checkpoint() === false) return false;
    destroy();
  }
  run = null;
  hideViews();
  $("[data-garden]").hidden = false;
  renderGarden();
  recordView("garden");
  if (focus) {
    window.scrollTo({ top: 0, behavior: "instant" });
    $("[data-garden] h1").focus({ preventScroll: true });
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause("background");
}, { signal: lifecycleAbort.signal });
window.addEventListener("blur", () => pause("focus"), { signal: lifecycleAbort.signal });
window.addEventListener("pagehide", () => {
  if (playing) pause("background");
  else if (run && controller) checkpoint();
}, { signal: lifecycleAbort.signal });
function handlePauseKey(e) {
  return handleGamePauseKey({ root, $, playing, run, controller, pause, resume }, e);
}
document.addEventListener("keydown", handlePauseKey, { signal: lifecycleAbort.signal });
function scheduleFrame() {
  if (playing && !frameId) frameId = requestAnimationFrame(frame);
}
function completeScene(result) {
  if (ticking) pendingCompletion = result;
  else finish(result, true);
}
function frame(now) {
  frameId = 0;
  try {
    if (playing && run && controller) {
      if (lastFrame) {
        const dt = (now - lastFrame) / 1000;
        if (dt > 2) {
          pause("background");
        } else if (dt > 0) {
          ticking = true;
          const advancedSeconds = advanceSceneFrame(controller, dt, {
            shouldContinue: () => playing,
            hasCompleted: () => Boolean(pendingCompletion),
          });
          ticking = false;
          if (pendingCompletion) {
            const result = pendingCompletion;
            pendingCompletion = null;
            // A terminal frame may finish in its first simulation step. Credit
            // only that processed portion, never the unplayed remainder.
            if (playing && run && controller) accrueTime(db, run, advancedSeconds);
            finish(result, true);
            return;
          }
          // A checkpoint can lose ownership and close the session during tick.
          if (!playing || !run || !controller) return;
          accrueTime(db, run, advancedSeconds);
          saveElapsed += advancedSeconds;
          setTextIfChanged($("[data-active-time]"), fmt(run.activeMs));
          if (
            playing &&
            run.duration &&
            !run.intentionSeen &&
            run.activeMs >= run.duration * 1000
          ) {
            run.intentionSeen = true;
            pause("intention");
          }
          if (playing && saveElapsed >= 5) {
            saveElapsed = 0;
            checkpoint();
            totals();
          }
        }
      }
      lastFrame = now;
    } else lastFrame = 0;
    scheduleFrame();
  } catch {
    runtimeFailure();
  } finally {
    ticking = false;
  }
}
$("[data-bret-menu-toggle]").addEventListener("click", () => {
  if (playing) pause();
  totals();
});
function renderView(view, { initial = false } = {}) {
  if (GAMES.some((game) => game.id === view)) openSetup(view, { focus: !initial });
  else if (view === "game-settings") gameSettings({ focus: !initial });
  else if (view === "garden") garden({ focus: !initial });
  else if (view === "games") library({ focus: !initial });
  else directions.show(view, { notify: !initial });
}
const viewHistory = createViewHistory({
  history,
  location,
  views: ["breath", "physical", "meditation", "games", "game-settings", "garden", ...GAMES.map((game) => game.id)],
  onNavigate: renderView,
});
function recordView(view) {
  viewHistory.record(view);
}
function restoreNavigation({ force = false, initial = false } = {}) {
  const context = failureContext, wasHandled = context.handled;
  try {
    viewHistory.restore({ force, initial });
  } catch {
    runtimeFailure();
  }
  if (!wasHandled && context === failureContext && context.handled) {
    // Recovery rendered home while history was suppressing renderer records.
    // Reconcile the same entry after restoration ends, retaining native anchors.
    const message = $("[data-notice]").textContent;
    const fragment = location.hash === "#" + history.state?.bretView
      ? "#games" : location.hash;
    history.replaceState({ bretView: "games" }, "", fragment);
    viewHistory.restore({ force: true, initial: true });
    notice(message);
  }
}
window.addEventListener("popstate", restoreNavigation, { signal: lifecycleAbort.signal });
window.addEventListener("hashchange", restoreNavigation, { signal: lifecycleAbort.signal });
function leaveGames() {
  if (run && controller && checkpoint() === false) return false;
  destroy();
  run = null;
  selected = null;
  return true;
}
meditation = setupMeditation(root);
directions = setupDirections(root, {
  onMeditation: options => meditation.show(options),
  onDirectionChange: () => meditation.hide(),
  onGames: library,
  onView: recordView,
  onLeave: leaveGames,
  onGarden: garden,
});
const initializingProgress = beginProgress();
function closeProgress() {
  progressGeneration++;
  storeReady = false;
  root.dataset.gamesReady = "false";
  syncAvailability();
  progressStore.close();
}
window.addEventListener("pagehide", closeProgress, { signal: lifecycleAbort.signal });
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    destroy();
    run = null;
    runResult = null;
    selected = null;
    beginProgress(true).catch(initializationFailure);
  }
}, { signal: lifecycleAbort.signal });
viewHistory.start(
  document.documentElement.dataset.routeId === "/bret/games" ? "games" : "breath",
);
await initializingProgress;
}
if (root) initializeGames(root).catch(initializationFailure);
