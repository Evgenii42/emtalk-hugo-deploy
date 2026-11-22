import { mountGame } from "./play.mjs";
import { accrueTime, settleGoal } from "./session.mjs";
import { setupDirections } from "./directions.mjs";
import { createProgressStore } from "./persistence.mjs";
import { createViewHistory } from "./navigation.mjs";
import { setTextIfChanged, playedTimeLabel, formatClock } from "./ui.mjs";
import { normalizeProgress } from "./progress.mjs";
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
const KEY = "bret-games-site-v1";
const GAMES = [
  {
    id: "moles",
    name: "Seed Keepers",
    type: "FIND YOUR RHYTHM",
    tag: "Rhythm & reaction",
    description:
      "Meet the little seed keepers. Read the rhythm, choose your next move and bring a garden to life.",
    how: "Tap a keeper to collect a seed. This is a visually timed game: keepers leave when their rings close. Gentle gives you more time and uses taps only; it still has timed misses. Balanced and Curious also ask you to hold. A wave ends after 50 helpers. Collect at least 70% to meet its goal. For an untimed choice, try A Place for Everything or Hidden Seasons.",
    why: "A clear rhythm and immediate feedback give your attention a concrete task. Choose a pace that feels comfortable.",
    skill: "React & prioritise",
    time: "About 2 minutes",
  },
  {
    id: "firefly",
    name: "Lantern Drift",
    type: "FOLLOW A LITTLE LIGHT",
    tag: "Movement & exploration",
    description:
      "Guide a little light through an evening garden. Follow the open route, or reach for a little extra glow.",
    how: "Move left and right to pass through the open gates. Use the on-screen controls, your pointer or arrow keys. The forward pace stays steady. Pass 12 of 15 gates to meet the level goal. Side lights are optional; missing one never blocks your journey.",
    why: "A steady journey offers one continuous task. Follow the open route, or choose a little more challenge.",
    skill: "Steer & explore",
    time: "About 1 minute",
  },
  {
    id: "order",
    name: "A Place for Everything",
    type: "MAKE A LITTLE SPACE",
    tag: "Logic & arranging",
    description:
      "Find how the clues fit together. Give every object a place, then enjoy a small corner you have made your own.",
    how: "Select an object, then a square. Follow every visible clue. Next to means sharing a side; diagonals do not count. Check your arrangement, undo a move or ask for a hint.",
    why: "A small set of visible rules turns a busy space into a solvable task. Find an arrangement, then make it yours.",
    skill: "Arrange & reason",
    time: "2-5 minutes",
  },
  {
    id: "landscape",
    name: "Hidden Seasons",
    type: "FOLLOW YOUR CURIOSITY",
    tag: "Patterns & discovery",
    description:
      "Notice a changing pattern. Test your idea and uncover a landscape, one small discovery at a time.",
    how: "Study the examples and choose what comes next. Click an answer or press its number key to choose it. A pattern can rotate a shape, change the number of marks or alternate changes. The possible changes are shown in the game. One rule stays in place for all six discoveries.",
    why: "Look for a changing pattern, test your idea, and uncover a scene. Take as much time as you need.",
    skill: "Notice & discover",
    time: "2-5 minutes",
  },
];
const STATES = [
  {
    id: "settle",
    label: "Settle down",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "A small, still task with visible clues. Or choose a rhythm if you would rather tap than think.",
  },
  {
    id: "restless",
    label: "Feel restless",
    pick: "moles",
    tier: 1,
    duration: 300,
    note: "Try a clear rhythm with something to do. Keep a comfortable pace; faster is optional.",
  },
  {
    id: "thoughts",
    label: "Busy thoughts",
    pick: "landscape",
    tier: 1,
    duration: 300,
    note: "Give your attention a concrete mystery. There is no time limit on your next thought.",
  },
  {
    id: "tired",
    label: "Low energy",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "Keep it familiar and small. A little corner is enough for one session.",
  },
  {
    id: "focus",
    label: "Find focus",
    pick: "landscape",
    tier: 1,
    duration: 600,
    note: "Choose your kind of challenge. Levels introduce new decisions; a steady pace keeps the same difficulty.",
  },
  {
    id: "sleep",
    label: "Wind down",
    pick: "order",
    tier: 0,
    duration: 120,
    note: "A familiar, gentle task with a clear ending. If playing makes you feel more awake, finish whenever you like.",
  },
];
const empty = () => normalizeProgress(null, {
  gameIds: GAMES.map((game) => game.id),
  stateIds: STATES.map((state) => state.id),
  isValidCheckpoint: validLast,
});
let db = empty(),
  storage = true,
  storeReady = false;
let selected = null,
  controller = null,
  run = null,
  playing = false,
  lastFrame = 0,
  saveElapsed = 0,
  runResult = null,
  directions = null,
  progressText = "";
let frameId = 0;
let checkpointRequest = null;
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
const progressStore = createProgressStore({
  key: KEY,
  storage: browserStorage,
  locks: globalThis.navigator?.locks,
  onConflict: () => {
    storage = false;
    syncAvailability();
    pause("background");
    storageNotice(
      "Progress changed in another tab. Reload this tab before continuing.",
    );
  },
  onUnavailable: () => {
    storage = false;
    storageNotice(
      "Saving is unavailable in this browser. You can keep playing; this visit will not be kept after closing.",
    );
  },
});
cleanupInitialization = () => {
  try {
    destroy();
  } finally {
    try {
      directions?.dispose?.();
    } finally {
      progressStore.close();
    }
  }
};
function canPlay() {
  if (storeReady && progressStore.writable) return true;
  notice(
    storeReady
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
  $$("[data-theme],[data-game-home-play],[data-resume-run],[data-discard-run],[data-state-choice],[data-cards] button,[data-setup-start]").forEach(
    (button) => { button.disabled = !writable; },
  );
}
async function beginProgress(restored = false) {
  storeReady = false;
  syncAvailability();
  const state = await progressStore.begin();
  if (state.mode === "closed") return;
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
  if (state.mode === "memory")
    storageNotice(
      "Saving is unavailable in this browser. You can keep playing; this visit will not be kept after closing.",
    );
  if (restored) viewHistory.restore({ force: true });
  else if (selected && !$("[data-setup]").hidden) {
    applySetupPreferences(selected.id);
    showReplacementChoice();
  }
  if (!state.writable)
    storageNotice(
      "Games are open in another tab. Close that tab and reload here to continue safely.",
    );
}
function validLast(x) {
  return (
    x &&
    x.version === 1 &&
    GAMES.some((g) => g.id === x.id) &&
    validTier(x.tier) &&
    Number.isInteger(x.seed) &&
    Number.isFinite(x.activeMs) &&
    x.activeMs >= 0 &&
    x.activeMs < 1e10 &&
    validMode(x.mode) &&
    validDuration(x.duration) &&
    x.snapshot &&
    typeof x.snapshot === "object" &&
    x.snapshot.done !== true
  );
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
let artworkCount = 0;
function art(id) {
  const gradientId = `bret-sky-${++artworkCount}`;
  const base = `<svg viewBox="0 0 480 240" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${gradientId}" x2="0" y2="1"><stop stop-color="${id === "firefly" ? "#b9acd1" : id === "moles" ? "#e5ebdb" : id === "order" ? "#f1e7dd" : "#ded8ed"}"/><stop offset="1" stop-color="${id === "firefly" ? "#e7d9e7" : "#f5eef7"}"/></linearGradient></defs><path fill="url(#${gradientId})" d="M0 0h480v240H0z"/><circle cx="372" cy="57" r="31" fill="#fff1cf"/>`;
  let body = "";
  if (id === "moles") {
    body =
      '<path d="M0 145Q120 98 250 150T480 133V240H0Z" fill="#a4b49b"/><path d="M0 192Q180 139 480 194V240H0Z" fill="#829a82"/>';
    for (const [x, y, s] of [
      [120, 154, 0.7],
      [240, 188, 1],
      [356, 151, 0.75],
    ])
      body += `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cy="26" rx="48" ry="12" fill="#637b68"/><path d="M-29 26v-29q0-33 29-33T29-3v29" fill="#b39079"/><ellipse cx="-27" cy="-10" rx="10" ry="13" fill="#b39079"/><ellipse cx="27" cy="-10" rx="10" ry="13" fill="#b39079"/><circle cx="-10" cy="-7" r="3" fill="#433346"/><circle cx="10" cy="-7" r="3" fill="#433346"/><ellipse cy="4" rx="7" ry="5" fill="#ebc6ae"/><path d="M-6 15q6 6 12 0" stroke="#674b52" fill="none" stroke-width="2"/><path d="M0 36v-20m0 7q-17-1-15-15 15 1 15 15m0-2q1-16 14-15 1 14-14 15" fill="#d7e3ba" stroke="#617b5d" stroke-width="2"/></g>`;
  }
  if (id === "firefly") {
    body =
      '<path d="M0 140Q140 77 275 160T480 126V240H0Z" fill="#a293ba"/><path d="M0 199Q140 134 480 202V240H0Z" fill="#7c6a99"/><path d="M35 240Q125 178 252 192T418 108" stroke="#efdcbd" fill="none" stroke-width="17"/>';
    for (const [x, y] of [
      [90, 120],
      [168, 90],
      [275, 132],
      [342, 93],
      [395, 158],
    ])
      body += `<circle cx="${x}" cy="${y}" r="10" fill="#fff1be" opacity=".25"/><circle cx="${x}" cy="${y}" r="3" fill="#fff5d2"/>`;
    body +=
      '<ellipse cx="240" cy="133" rx="18" ry="10" fill="#ebe4f8" transform="rotate(-30 240 133)"/><ellipse cx="267" cy="133" rx="18" ry="10" fill="#ebe4f8" transform="rotate(30 267 133)"/><ellipse cx="253" cy="146" rx="8" ry="15" fill="#fff1a9"/><circle cx="253" cy="132" r="7" fill="#604c77"/>';
  }
  if (id === "order") {
    body =
      '<path d="M105 28h270v181H105z" fill="#f8f2e7"/><path d="M123 42h87v104h-87z" fill="#bcd6d4"/><path d="M166 42v104m-43-52h87" stroke="#faf6ec" stroke-width="7"/><path d="M75 190h330v15H75z" fill="#b99983"/><path d="M105 205v35m270-35v35" stroke="#ab8c79" stroke-width="10"/><path d="M252 190v-66m-25 5h50l-9-47h-32z" fill="#aa92bd" stroke="#aa92bd" stroke-width="5"/><path d="M135 166h35l-5 24h-25z" fill="#c59a80"/><path d="M151 167v-42m0 20q-22-2-19-24 22 1 19 24m0-9q1-27 24-26 1 24-24 26" fill="#8daa88" stroke="#739771" stroke-width="2"/><path d="M290 180h52v10h-52z" fill="#829b9a"/><path d="M295 167h42v13h-42z" fill="#d5b99f"/><path d="M200 171h22v19h-22z" fill="#e2c9bf"/><path d="M222 175q15-2 10 9h-10" fill="none" stroke="#e2c9bf" stroke-width="5"/>';
  }
  if (id === "landscape") {
    body =
      '<path d="M0 148 130 48l114 106 88-71 148 90V240H0Z" fill="#b5accb"/><path d="m85 85 45-37 51 47-47-14-18 14Z" fill="#eee8f5"/><path d="M0 174q110-39 213 0t267-10v76H0Z" fill="#8da7a1"/><path d="M0 204q151-32 480 3v33H0Z" fill="#bad4d0"/><path d="M0 239q130-44 240-14t240-2" fill="none" stroke="#dbe7e2" stroke-width="8"/><path d="M282 45h100v105H282z" fill="#eee8f5" opacity=".75"/><path d="m307 70 15 26h-30Z" fill="#997dad"/><path d="m351 71 15 26h-30Z" fill="#997dad"/><circle cx="304" cy="119" r="8" fill="#b4c9a4"/><circle cx="327" cy="119" r="8" fill="#b4c9a4"/><circle cx="350" cy="119" r="8" fill="#b4c9a4"/>';
  }
  return base + body + "</svg>";
}
function theme() {
  root.classList.toggle("is-evening", Boolean(db.evening));
  $("[data-theme]").setAttribute("aria-pressed", String(Boolean(db.evening)));
}
function toggleTheme() {
  if (!canPlay()) return;
  db.evening = !db.evening;
  theme();
  write();
}
$("[data-theme]").addEventListener("click", toggleTheme);
theme();
function state() {
  return STATES.find((s) => s.id === db.state) || STATES[0];
}
function renderCatalog(focusState = null) {
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
      db.state = id;
      if (id === "sleep") db.evening = true;
      theme();
      write();
      renderCatalog(id);
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
  for (const g of ordered) {
    const card = document.createElement("article");
    card.className = "games-card";
    card.innerHTML = `<div class="games-card-art">${art(g.id)}<span class="games-card-badge">${g.id === s.pick ? "PICKED FOR YOU" : g.tag.toUpperCase()}</span></div><div class="games-card-copy"><h3>${g.name}</h3><p>${g.description}</p><div class="games-card-tags"><span>${g.skill}</span><span>${g.time.replace("-", " to ")}</span></div><div class="games-card-bottom"><span>Level ${db.levels[g.id]} · Your pace</span><button type="button" aria-label="Choose ${g.name}">Choose game <span aria-hidden="true">↗</span></button></div></div>`;
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
      `${GAMES.find((g) => g.id === resume.id).name} · ${fmt(resume.activeMs)} of active play · ${tierLabel(resume.tier)}`;
  totals();
  syncAvailability();
  if (focusState)
    $$("[data-state-choice]")
      .find((button) => button.dataset.stateChoice === focusState)
      ?.focus({ preventScroll: true });
}
function queueCheckpoint() {
  if (!run || !controller || runResult?.completed) return;
  const owner = run;
  if (checkpointRequest?.owner === owner) return;
  const request = { owner };
  checkpointRequest = request;
  setTimeout(() => {
    if (checkpointRequest === request) checkpointRequest = null;
    if (run === owner && playing) checkpoint();
  }, 1000);
}
function checkpoint() {
  if (!run || !controller || runResult?.completed) return;
  try {
    const snapshot = controller.snapshot();
    // The host settles terminal scenes; they are never resumable checkpoints.
    if (snapshot.done === true) return;
    run.snapshot = snapshot;
    db.last = { ...run };
    write();
  } catch {
    runtimeFailure();
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
function runtimeFailure() {
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
const HOME_COPY = {
  moles: "Find a steady rhythm and collect little seeds.",
  firefly: "Follow the open path and gather a little glow.",
  order: "Follow a few clues. Give everything a place.",
  landscape: "Find the changing rule and uncover a new scene.",
};
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
    tierLabel(prefs.tier);
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
  $$("[data-game-home],[data-catalog],[data-player],[data-garden]").forEach(
    (n) => (n.hidden = true),
  );
}
function library({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (run && controller) checkpoint();
  destroy();
  run = null;
  selected = null;
  hideViews();
  $("[data-game-home]").hidden = false;
  renderGameHome();
  recordView("games");
  window.scrollTo({ top: 0, behavior: "instant" });
  if (focus) $("[data-game-home] h1").focus({ preventScroll: true });
}
function gameSettings({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (run && controller) checkpoint();
  destroy();
  run = null;
  selected = null;
  hideViews();
  $("[data-catalog]").hidden = false;
  renderCatalog();
  recordView("game-settings");
  window.scrollTo({ top: 0, behavior: "instant" });
  if (focus) $("[data-catalog] h1").focus({ preventScroll: true });
}
function playHomeGame() {
  if (!canPlay()) return;
  const g = homeGame(),
    saved = validLast(db.last) && db.last.id === g.id ? { ...db.last } : null;
  openSetup(g.id);
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
}
function openSetup(id, { focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (controller) {
    checkpoint();
    destroy();
  }
  run = null;
  selected = GAMES.find((g) => g.id === id);
  if (!selected) return;
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
  window.scrollTo({ top: 0, behavior: "instant" });
  $("[data-player-title]").setAttribute("tabindex", "-1");
  if (focus) $("[data-player-title]").focus({ preventScroll: true });
}
function showReplacementChoice() {
  const saved = validLast(db.last) ? db.last : null;
  const note = $("[data-replace-note]");
  note.hidden = !saved;
  note.textContent = saved
    ? `Starting a fresh scene replaces your paused ${GAMES.find((g) => g.id === saved.id).name} at ${fmt(saved.activeMs)}. Your total play time and XP stay.`
    : "";
  $("[data-setup-start]").textContent = saved ? "Replace paused scene and play" : "Let's play";
}
function start(options, { replaceSaved = false } = {}) {
  if (!canPlay()) return;
  if (!validTier(options.tier) || !validMode(options.mode) || !validDuration(options.duration)) {
    notice("Choose a challenge, pace and time from the game settings before starting.");
    return;
  }
  const game = selected;
  if (!game) return;
  if (!options.snapshot && db.last && validLast(db.last) && !replaceSaved) {
    openSetup(game.id);
    notice("Your paused scene is still kept. Review the replacement note before starting a fresh scene.");
    return;
  }
  notice("");
  destroy();
  if (selected !== game) return;
  run = {
    version: 1,
    id: selected.id,
    tier: options.tier,
    seed: options.seed ?? seeded(),
    mode: options.mode,
    duration: options.duration,
    activeMs: 0,
    earnedXP: 0,
    level:
      options.mode === "levels"
        ? Math.max(db.levels[selected.id], options.tier * 3 + 1)
        : db.levels[selected.id],
    bonusAwarded: false,
    intentionSeen: false,
    ...options,
  };
  runResult = null;
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
      onProgress: (t) => {
        progressText = t;
        const node = $("[data-play-progress]");
        if (node.textContent !== t) node.textContent = t;
      },
      onComplete: completeScene,
      onError: runtimeFailure,
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
    `${run.mode === "stable" ? modeLabel(run.mode) : `Level ${run.level}`} · ${tierLabel(run.tier)} · ${durationRunLabel(run.duration)}`;
  setTextIfChanged($("[data-active-time]"), fmt(run.activeMs));
  playing = true;
  lastFrame = 0;
  saveElapsed = 0;
  checkpoint();
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
  }, { replaceSaved: !$("[data-replace-note]").hidden });
});
function pause(reason = "manual") {
  if (!run || !controller || !playing) return;
  stop();
  if (!run || !controller) return;
  checkpoint();
  if (!run || !controller) return;
  $("[data-play-progress]").setAttribute("aria-live", "polite");
  $("[data-stage]").inert = true;
  $("[data-session-bar]").inert = true;
  $("[data-overlay]").hidden = false;
  $("[data-overlay-title]").textContent =
    reason === "intention"
      ? "Your little time intention is complete."
      : reason === "background"
        ? "Paused while you were away."
        : reason === "focus"
          ? "Paused for a change of focus."
        : reason === "resume"
          ? "Your scene is ready."
          : "Paused. Your place is kept.";
  $("[data-overlay-copy]").textContent =
    reason === "intention"
      ? "Finish for now, or stay with this scene a little longer. No need to hurry."
      : reason === "resume"
        ? "Take a moment to find your place, then continue when you like. Active play time will start when you continue."
        : reason === "focus"
          ? "The window lost focus. Your active play time is paused too. Continue when ready."
          : "Take your time. Your active play time is paused too.";
  const title = $("[data-overlay-title]").textContent;
  const explanation = $("[data-overlay-copy]").textContent;
  const stopped = title.startsWith("Paused") ? "" : "Play is paused. ";
  $("[data-play-progress]").textContent = `${title} ${stopped}${explanation} ${progressText}`.trim();
  const continueButton = $("[data-continue]");
  // The pause group spans the whole game. Reveal its focused control even when
  // the Pause button or the current move sits far above the group centre.
  continueButton.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "instant" });
  continueButton.focus({ preventScroll: true });
}
function resume() {
  if (!run || !controller || document.hidden || !canPlay()) return;
  $("[data-stage]").inert = false;
  $("[data-session-bar]").inert = false;
  $("[data-overlay]").hidden = true;
  $("[data-play-progress]").setAttribute("aria-live", "off");
  $("[data-play-progress]").textContent = progressText;
  lastFrame = 0;
  playing = true;
  scheduleFrame();
  try {
    controller.focus();
  } catch {
    runtimeFailure();
  }
}
function finish(result = {}, completed = false) {
  if (!run || !controller) return;
  if (!canPlay()) {
    library();
    return;
  }
  stop();
  if (!run || !controller) return;
  let snap;
  try {
    snap = controller.snapshot();
  } catch {
    runtimeFailure();
    return;
  }
  const award = settleGoal(db, run, result, completed);
  runResult = { ...result, completed, passed: award.passed };
  const earnedTime = award.earnedXP,
    bonus = award.bonus;
  run.snapshot = snap;
  db.last = completed ? null : { ...run };
  write();
  $("[data-session]").hidden = true;
  $("[data-result]").hidden = false;
  $("[data-result-art]").innerHTML = art(run.id);
  $("[data-result-title]").textContent =
    result.title ||
    (db.state === "sleep"
      ? "A little moment, then rest."
      : "A little space, made by you.");
  $("[data-result-detail]").textContent =
    result.detail ||
    (completed
      ? "Your scene is complete."
      : storage
        ? "Your place is saved. Continue this scene to keep it, or replace this saved place with a new scene."
        : "Your place is kept for this visit. Continue this scene to keep it, or replace this place with a new scene. Browser saving is unavailable.");
  $("[data-result-time]").textContent = fmt(run.activeMs);
  $("[data-result-xp]").textContent = `+${earnedTime + bonus} XP`;
  $("[data-result-level]").textContent = completed
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
      : run.mode === "levels" && award.passed
      ? `Next level · ${db.levels[run.id]}`
      : "A new scene, same pace";
  $("[data-retry]").textContent = completed
    ? "Replay this scene"
    : "Continue this scene";
  $("[data-next]").classList.toggle("games-primary", db.state !== "sleep");
  $("[data-done]").classList.toggle("games-primary", db.state === "sleep");
  $$("[data-feedback]").forEach((b) => b.removeAttribute("aria-pressed"));
  $("[data-feedback-status]").textContent = "";
  $("[data-result-title]").focus({ preventScroll: true });
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
function garden({ focus = true } = {}) {
  notice("");
  directions?.show("games", { notify: false });
  if (controller) {
    checkpoint();
    destroy();
  }
  run = null;
  hideViews();
  $("[data-garden]").hidden = false;
  $("[data-garden-art]").innerHTML = art("moles");
  $("[data-garden-summary]").textContent =
    `${playedTimeLabel(db.totalMs)}, ${xp()} XP and ${db.completed} scenes played. Every comfortable pace counts.`;
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
  recordView("garden");
  window.scrollTo({ top: 0, behavior: "instant" });
  if (focus) $("[data-garden] h1").focus({ preventScroll: true });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause("background");
});
window.addEventListener("blur", () => pause("focus"));
window.addEventListener("pagehide", () => {
  if (playing) pause("background");
  else if (run && controller) checkpoint();
});
function handlePauseKey(e) {
  if (e.key !== "Escape" || e.repeat || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (playing) {
    e.preventDefault();
    pause();
  } else if (run && controller && !$("[data-overlay]").hidden && $("[data-overlay]").contains(e.target)) {
    e.preventDefault();
    resume();
  }
}
document.addEventListener("keydown", handlePauseKey);
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
          let remaining = dt;
          ticking = true;
          while (remaining > 0 && playing) {
            const step = Math.min(remaining, 0.04);
            controller.tick(step);
            remaining -= step;
          }
          ticking = false;
          if (pendingCompletion) {
            const result = pendingCompletion;
            pendingCompletion = null;
            if (playing && run && controller) accrueTime(db, run, dt);
            finish(result, true);
            return;
          }
          // A checkpoint can lose ownership and close the session during tick.
          if (!playing || !run || !controller) return;
          accrueTime(db, run, dt);
          saveElapsed += dt;
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
function restoreNavigation() {
  try {
    viewHistory.restore();
  } catch {
    runtimeFailure();
  }
}
window.addEventListener("popstate", restoreNavigation);
window.addEventListener("hashchange", restoreNavigation);
directions = setupDirections(root, {
  onGames: library,
  onView: recordView,
  onLeave: () => {
    if (run && controller) checkpoint();
    destroy();
    run = null;
    selected = null;
  },
  onGarden: garden,
});
renderCatalog();
renderGameHome();
const initializingProgress = beginProgress();
window.addEventListener("pagehide", () => {
  storeReady = false;
  syncAvailability();
  progressStore.close();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    destroy();
    run = null;
    runResult = null;
    selected = null;
    beginProgress(true).catch(initializationFailure);
  }
});
viewHistory.start(
  document.documentElement.dataset.routeId === "/bret/games" ? "games" : "breath",
);
await initializingProgress;
root.dataset.gamesReady = "true";
$("[data-games-load-error]").hidden = true;
root.dispatchEvent(new Event("bret:ready"));
}
if (root) initializeGames(root).catch(initializationFailure);
