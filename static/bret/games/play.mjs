import {
  restoreState,
  saveState,
  activeMoles,
  hitMole,
  advanceMoles,
  advanceFlight,
  placeObject,
  checkOrder,
  choosePattern,
  resultFor,
  predicate,
  RULES,
  MOLE_PROFILES,
  FLIGHT_PROFILES,
  clamp,
} from "./core.mjs";
const names = ["Lamp", "Plant", "Book", "Cup", "Postcard", "Clock"];
const shapes = ["circle", "leaf", "diamond"];
const KEYBOARD_ENTRY = {
  moles: {
    target: "[data-hole]",
    instruction: "Use Q W E, A S D, Z X C for the nine holes, or Tab and Enter or Space. Escape pauses the game.",
  },
  firefly: {
    target: ".bg-flight",
    instruction: "Use Left and Right arrows or A and D to steer. Escape pauses the game.",
  },
  order: {
    target: "[data-object]",
    instruction: "Use Tab or Shift+Tab to move between objects and places. Enter or Space selects. Escape pauses the game.",
  },
  landscape: {
    target: "[data-answer]:not(:disabled)",
    instruction: "Use the number keys to choose an answer, or Tab and Enter or Space. Escape pauses the game.",
  },
};
const icon = (id) =>
  `<svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">${
    {
      lamp: '<path d="M40 40v24m-14 3h28M23 38l10-23h14l10 23z" fill="#e7c681" stroke="#62506f" stroke-width="4" stroke-linejoin="round"/>',
      plant:
        '<path d="M40 52V24m0 13C18 37 17 16 23 15c16 0 21 13 17 22m0 7c22 0 24-22 18-23-15 0-21 14-18 23" fill="#84a38f" stroke="#496b5b" stroke-width="3"/><path d="M24 49h32l-5 20H29z" fill="#cfa6a0"/>',
      book: '<path d="M18 20q12-5 22 2 10-7 22-2v43q-13-5-22 2-9-7-22-2z" fill="#b4b0cf" stroke="#62506f" stroke-width="3"/><path d="M40 23v39m-15-29h8m-8 9h8m14-9h8m-8 9h8" stroke="#62506f" stroke-width="2"/>',
      cup: '<path d="M19 29h35v24q-3 15-18 15-14 0-17-15zm36 3h6q13 0 8 17-4 9-15 8" fill="#e9c3af" stroke="#8b685f" stroke-width="3"/><path d="M31 20q-7-8 0-12m13 12q-7-8 0-12" fill="none" stroke="#8b685f" stroke-width="3"/>',
      postcard:
        '<rect x="14" y="19" width="52" height="42" rx="4" fill="#f4e6c9" stroke="#8d7c64" stroke-width="3"/><circle cx="49" cy="31" r="7" fill="#e6ba7d"/><path d="M17 55l17-17 12 11 6-6 12 12" fill="#8da596"/>',
      clock:
        '<circle cx="40" cy="40" r="26" fill="#ece3f1" stroke="#7b6590" stroke-width="4"/><path d="M40 22v20l13 7" fill="none" stroke="#7b6590" stroke-width="4" stroke-linecap="round"/>',
      mole: '<path d="M14 73V43a26 26 0 0 1 52 0v30" fill="#b59b85"/><ellipse cx="40" cy="57" rx="18" ry="16" fill="#ead9c8"/><circle cx="30" cy="41" r="3" fill="#44364c"/><circle cx="50" cy="41" r="3" fill="#44364c"/><ellipse cx="40" cy="49" rx="5" ry="3" fill="#9b6c75"/><path d="M32 61q8 6 16 0" fill="none" stroke="#8b685f" stroke-width="2"/><ellipse cx="16" cy="23" rx="9" ry="11" fill="#b59b85"/><ellipse cx="64" cy="23" rx="9" ry="11" fill="#b59b85"/>',
      seed: '<path d="M39 63C16 53 13 25 38 17c25 8 27 36 1 46" fill="#d9bc7f"/><path d="M39 21v36" stroke="#96774d" stroke-width="3"/>',
      firefly:
        '<ellipse cx="28" cy="30" rx="14" ry="21" transform="rotate(-33 28 30)" fill="#eae3ff" opacity=".8"/><ellipse cx="52" cy="30" rx="14" ry="21" transform="rotate(33 52 30)" fill="#eae3ff" opacity=".8"/><ellipse cx="40" cy="48" rx="13" ry="20" fill="#efd596"/><circle cx="40" cy="30" r="10" fill="#554464"/><path d="M35 23l-8-9m18 9 8-9" stroke="#554464" stroke-width="3" stroke-linecap="round"/>',
    }[id] || ""
  }</svg>`;
const landscape = (count = 6) =>
  `<svg viewBox="0 0 720 300" role="img" aria-label="A quiet lake and a light in a distant window"><rect width="720" height="300" fill="#ddd5eb"/><circle cx="560" cy="65" r="37" fill="#f5dfb6"/><path d="M0 164Q110 50 240 160T470 142T720 130V300H0" fill="#a29abb"/><path d="M0 214Q170 116 330 204T720 180V300H0" fill="#7c7296"/><path d="M0 248Q220 193 720 238V300H0" fill="#afc8c7"/><path d="M0 280Q145 214 260 256" fill="none" stroke="#edcda7" stroke-width="18"/><path d="M454 165v-45h54v45" fill="#665371"/><path d="M447 122l34-26 35 26" fill="#88768d"/><rect x="476" y="130" width="16" height="19" rx="2" fill="#f6df9b"/><path d="M87 204v-61m-20 22 20-46 21 46zm-13 26 13-37 15 37" fill="#677b72" stroke="#677b72" stroke-width="7"/><path d="M576 207v-65m-20 17 20-43 22 43zm-12 29 12-40 15 40" fill="#6b7d76" stroke="#6b7d76" stroke-width="7"/>${Array.from({ length: 6 }, (_, i) => (i < count ? "" : `<rect x="${i * 120}" width="121" height="300" fill="#eee8f3" opacity=".95"/>`)).join("")}</svg>`;
function symbol(s, decorative = false) {
  const [turn, count, shape] = s;
  return `<svg viewBox="0 0 100 100" ${decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${turn * 90} degrees, ${count + 1} marks, ${shapes[shape]}"`}><g transform="rotate(${turn * 90} 50 50)"><path d="M50 5l-8 12h16z" fill="#6e548b"/>${shape === 0 ? '<circle cx="50" cy="50" r="27" fill="#c2b5d6" stroke="#6e548b" stroke-width="3"/>' : shape === 1 ? '<path d="M24 70Q15 18 76 24Q84 76 24 70" fill="#aec8b9" stroke="#54796a" stroke-width="3"/>' : '<path d="M50 19l31 31-31 31-31-31z" fill="#eac6b2" stroke="#a77e68" stroke-width="3"/>'}</g>${Array.from({ length: count + 1 }, (_, i) => `<circle cx="${50 - count * 7 + i * 14}" cy="90" r="4" fill="#5c496f"/>`).join("")}</svg>`;
}
function clueText(c, cols = 3) {
  const [t, a, b] = c;
  return t === "row"
    ? `${names[a]} goes in the ${b === 0 ? "top" : "bottom"} row.`
    : t === "col"
      ? `${names[a]} goes in the ${b === 0 ? "left" : b === cols - 1 ? "right" : "middle"} column.`
      : t === "adj"
        ? `${names[a]} sits next to ${names[b].toLowerCase()} (shared edge).`
        : t === "left"
          ? `${names[a]} is in a column left of ${names[b].toLowerCase()}.`
          : `${names[a]} is in a row above ${names[b].toLowerCase()}.`;
}
export function mountGame(stage, options) {
  const { id, tier = 0, seed = 1, resume = null } = options;
  let s = restoreState(resume, id, tier, seed),
    destroyed = false,
    emitted = false,
    holdPointer = null,
    moleHoldSource = null,
    lastView = "",
    steering = new Map(),
    dragPointer = null,
    flightView = [],
    flightFly = null;
  if (s.done)
    throw Error("Completed scene cannot be resumed. Start a fresh scene.");
  const abort = new AbortController(),
    on = (node, type, fn) =>
      node.addEventListener(type, fn, { signal: abort.signal });
  stage.classList.add("bg-stage");
  stage.dataset.game = id;
  const progress = (text) => options.onProgress?.(text),
    save = () => options.onCheckpoint?.(saveState(s));
  const announce = (text) => {
    s.feedback = text;
    const p = stage.querySelector("[data-bg-feedback]");
    if (p) p.textContent = text;
  };
  const end = () => {
    if (s.done && !emitted) {
      emitted = true;
      save();
      options.onComplete?.(resultFor(s));
    }
  };
  function header(text, copy) {
    return `<div class="bg-instructions"><strong>${text}</strong><p>${copy}</p></div>`;
  }
  function feedback() {
    return `<p class="bg-feedback" data-bg-feedback role="status" aria-live="polite">${s.feedback}</p>`;
  }
  function flightGateMarkup(g) {
    const left = (g.center - g.width / 2) * 600,
      right = (g.center + g.width / 2) * 600,
      lightOffset = FLIGHT_PROFILES[tier].speed * 430 * 0.75;
    return `<g data-bg-gate="${g.id}" display="none"><path d="M0 0H${left}M${right} 0H600" stroke="#f6e8c7" stroke-width="13" stroke-linecap="round"/><circle cx="${left}" cy="0" r="9" fill="#6c597e"/><circle cx="${right}" cy="0" r="9" fill="#6c597e"/>${g.light !== null ? `<g data-bg-light="${g.id}" transform="translate(${g.light * 600} ${lightOffset})"><circle r="15" fill="#f8e2a1" opacity=".4"/><circle r="6" fill="#fff8d9"/></g>` : ""}</g>`;
  }
  function build() {
    if (id === "moles") {
      stage.innerHTML =
        header(
          "One seed at a time",
          tier === 0
            ? "Tap a helper before its ring runs out. Empty holes never cost you points."
            : "Tap the seed symbol. Hold the ring symbol for half a second. Pick the helper leaving soonest.",
        ) +
        `<div class="bg-garden" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span class="bg-sprout ${s.hits >= 5 * (i + 1) ? "bg-grown" : ""}"><i></i></span>`).join("")}</div><div class="bg-mole-grid" role="group" aria-label="Nine garden holes">${Array.from({ length: 9 }, (_, i) => `<button type="button" class="bg-hole" data-hole="${i}" aria-label="Empty hole ${i + 1}"><span class="bg-mole-body">${icon("mole")}<span class="bg-gesture"></span></span><span class="bg-hole-ring"></span><kbd>${"QWEASDZXC"[i]}</kbd></button>`).join("")}</div><p class="bg-game-meta" data-bg-score></p>` +
        feedback();
      stage.querySelectorAll("[data-hole]").forEach((b) => {
        on(b, "pointerdown", (e) => {
          if (s.done || holdPointer !== null) return;
          e.preventDefault();
          b.focus();
          const target = activeMoles(s).find((x) => x.hole === +b.dataset.hole);
          if (!target) return;
          holdPointer = e.pointerId;
          b.setPointerCapture?.(e.pointerId);
          if (target.hold) beginMoleHold(target, `pointer:${e.pointerId}`);
          else b.dataset.pressed = String(target.id);
        });
        on(b, "pointerup", (e) => {
          if (holdPointer !== e.pointerId) return;
          const bounds = b.getBoundingClientRect();
          if (
            e.clientX >= bounds.left &&
            e.clientX <= bounds.right &&
            e.clientY >= bounds.top &&
            e.clientY <= bounds.bottom &&
            b.dataset.pressed
          )
            hitMole(s, +b.dataset.pressed);
          releaseMoleHold(`pointer:${e.pointerId}`);
          holdPointer = null;
          delete b.dataset.pressed;
          render();
          save();
        });
        const cancelPointer = (e) => {
          if (holdPointer !== e.pointerId) return;
          releaseMoleHold(`pointer:${e.pointerId}`);
          holdPointer = null;
          delete b.dataset.pressed;
          render();
          save();
        };
        on(b, "pointercancel", cancelPointer);
        on(b, "lostpointercapture", cancelPointer);
        on(b, "keydown", (e) => {
          if (
            ![" ", "Enter"].includes(e.key) || e.repeat || s.done ||
            e.altKey || e.ctrlKey || e.metaKey
          ) return;
          e.preventDefault();
          b.focus();
          const target = activeMoles(s).find((x) => x.hole === +b.dataset.hole);
          if (target) {
            if (target.hold) beginMoleHold(target, keySource(e));
            else hitMole(s, target.id);
            render();
            save();
          }
        });
        on(b, "keyup", (e) => {
          if ([" ", "Enter"].includes(e.key)) releaseMoleHold(keySource(e));
        });
      });
    } else if (id === "firefly") {
      stage.innerHTML =
        header(
          "Follow the open space",
          "Steer through the gaps. A side light is optional: choose your line, then return to the open route.",
        ) +
        `<div class="bg-flight" tabindex="0" role="group" aria-label="Flight field. Move with arrow keys or drag in the field."><svg viewBox="0 0 600 430" aria-hidden="true"><rect width="600" height="430" fill="#e6def0"/><circle cx="490" cy="60" r="45" fill="#f6dfb8"/><path d="M0 220Q120 80 240 200T600 160V430H0" fill="#b5a5c9"/><path d="M0 340Q130 185 300 300T600 245V430H0" fill="#8f80a6"/><path d="M0 430Q180 330 600 395V430" fill="#c4d9cf"/><g data-bg-gates>${s.gates.map(flightGateMarkup).join("")}</g><g data-bg-fly>${icon("firefly").replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g></svg><div class="bg-flight-wind" data-bg-wind></div></div><div class="bg-steer"><button type="button" data-bg-steer="-1" aria-label="Steer left">← <span>Left</span></button><span>Drag, point, or use A / D</span><button type="button" data-bg-steer="1" aria-label="Steer right"><span>Right</span> →</button></div><p class="bg-game-meta" data-bg-score></p>` +
        feedback();
      flightView = s.gates.map((gate) => ({
        gate,
        node: stage.querySelector(`[data-bg-gate="${gate.id}"]`),
        light: gate.light === null
          ? null
          : stage.querySelector(`[data-bg-light="${gate.id}"]`),
        visible: null,
        collected: null,
      }));
      flightFly = stage.querySelector("[data-bg-fly]");
      const field = stage.querySelector(".bg-flight");
      const target = (e) => {
        if (destroyed || s.done) return;
        const rect = field.getBoundingClientRect();
        s.target = clamp((e.clientX - rect.left) / rect.width, 0.025, 0.975);
      };
      on(field, "pointerdown", (e) => {
        if (s.done || dragPointer !== null) return;
        dragPointer = e.pointerId;
        field.setPointerCapture?.(e.pointerId);
        target(e);
      });
      on(field, "pointermove", (e) => {
        if (
          dragPointer === e.pointerId ||
          (dragPointer === null && e.pointerType === "mouse")
        )
          target(e);
      });
      on(field, "pointerup", (e) => {
        if (dragPointer === e.pointerId) dragPointer = null;
      });
      const cancelDrag = (e) => {
        if (dragPointer !== e.pointerId) return;
        dragPointer = null;
        s.target = s.x;
      };
      on(field, "pointercancel", cancelDrag);
      on(field, "lostpointercapture", cancelDrag);
      stage.querySelectorAll("[data-bg-steer]").forEach((b) => {
        const direction = +b.dataset.bgSteer;
        const pointerSource = (e) => `pointer:${direction}:${e.pointerId}`;
        on(b, "pointerdown", (e) => {
          e.preventDefault();
          holdSteering(pointerSource(e), direction);
          b.setPointerCapture?.(e.pointerId);
        });
        on(b, "pointerup", (e) => releaseSteering(pointerSource(e)));
        on(b, "pointercancel", (e) => releaseSteering(pointerSource(e)));
        on(b, "lostpointercapture", (e) => releaseSteering(pointerSource(e)));
        on(b, "keydown", (e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          if ([" ", "Enter"].includes(e.key)) {
            e.preventDefault();
            holdSteering(keySource(e), direction);
          }
        });
        on(b, "keyup", (e) => {
          if ([" ", "Enter"].includes(e.key)) releaseSteering(keySource(e));
        });
      });
    } else if (id === "order") {
      stage.innerHTML =
        header(
          "A place for everything",
          "Choose an object, then a place. Occupied places swap. Next to means a shared edge; diagonal does not count.",
        ) +
        `<div class="bg-order-layout"><div><div class="bg-room bg-room-${s.decor}" style="--bg-cols:${s.puzzle.cols}" role="group" aria-label="Room arrangement">${Array.from({ length: s.puzzle.n }, (_, i) => `<button type="button" class="bg-room-cell" data-cell="${i}" aria-label="Place ${i + 1}"><span class="bg-position">${String.fromCharCode(65 + i)}</span><span data-bg-object></span></button>`).join("")}</div><div class="bg-object-tray" aria-label="Choose an object">${names
          .slice(0, s.puzzle.n)
          .map(
            (name, i) =>
              `<button type="button" data-object="${i}" aria-pressed="false">${icon(name.toLowerCase())}<span>${name}</span></button>`,
          )
          .join(
            "",
          )}</div><div class="bg-order-actions"><button type="button" data-bg-undo>Undo</button><button type="button" class="bg-action" data-bg-check>Check room</button></div><fieldset class="bg-decor"><legend>Your room palette</legend>${["sage", "rose", "lavender"].map((c) => `<label><input type="radio" name="bg-room-palette" value="${c}" ${s.decor === c ? "checked" : ""}><span>${c}</span></label>`).join("")}</fieldset></div><section class="bg-clues" aria-label="Visible clues"><h3>Every clue stays here</h3><ol>${s.puzzle.clues.map((c, i) => `<li data-clue="${i}">${clueText(c, s.puzzle.cols)}<span></span></li>`).join("")}</ol><p data-bg-hint></p></section></div>` +
        feedback();
      stage.querySelectorAll("[data-object]").forEach((b) =>
        on(b, "click", () => {
          if (s.done) return;
          s.selected = +b.dataset.object;
          render();
          announce(
            `Choose a place for the ${names[s.selected].toLowerCase()}.`,
          );
        }),
      );
      stage.querySelectorAll("[data-cell]").forEach((b) =>
        on(b, "click", () => {
          if (s.done) return;
          if (s.selected === null) {
            const index = s.positions.indexOf(+b.dataset.cell);
            if (index >= 0) {
              s.selected = index;
              announce(
                `Choose a new place for the ${names[index].toLowerCase()}.`,
              );
            } else announce("Choose an object first.");
          } else {
            placeObject(s, s.selected, +b.dataset.cell);
            announce("A new arrangement. Check when you are ready.");
            save();
          }
          render();
        }),
      );
      on(stage.querySelector("[data-bg-undo]"), "click", () => {
        if (s.done || !s.history.length) return;
        s.positions = s.history.pop();
        s.checked = false;
        s.selected = null;
        announce("Previous arrangement restored.");
        render();
        save();
      });
      on(stage.querySelector("[data-bg-check]"), "click", () => {
        checkOrder(s);
        render();
        save();
        end();
      });
      stage.querySelectorAll(".bg-decor input").forEach((input) =>
        on(input, "change", () => {
          s.decor = input.value;
          stage.querySelector(".bg-room").className =
            "bg-room bg-room-" + s.decor;
          save();
        }),
      );
    } else {
      stage.innerHTML =
        header(
          "Find the change. Uncover the scene.",
          "Use one of the possible changes below. Click an answer or press its number key to choose it. The same rule stays for all six predictions. No time limit.",
        ) +
        `<div class="bg-landscape" data-bg-landscape></div><div class="bg-pattern-history" data-bg-history aria-label="Pattern examples"></div><p class="bg-next-label">What comes next?</p><div class="bg-pattern-choices" data-bg-choices></div><details class="bg-rule-guide"><summary>Possible changes</summary><p>${tier === 0 ? "One feature changes: a clockwise or counterclockwise quarter-turn, or the mark count moves +1, -1, or +2." : "A clockwise or counterclockwise quarter-turn; mark count +1, -1, or +2; a forward or reverse shape cycle; or alternating a clockwise quarter-turn and adding one mark."}${tier === 2 ? " A clockwise or counterclockwise quarter-turn and adding one mark may also happen together." : ""} Counts cycle 1, 2, 3, 4, then 1. The forward shape cycle is circle, leaf, diamond, then circle. The reverse cycle runs the other way. The direction pointer shows orientation.</p></details><p class="bg-game-meta" data-bg-score></p>` +
        feedback();
    }
    render();
    end();
  }
  function render() {
    if (destroyed) return;
    if (id === "moles") {
      const active = activeMoles(s),
        life = MOLE_PROFILES[tier].life;
      stage.querySelectorAll("[data-hole]").forEach((b) => {
        const e = active.find((x) => x.hole === +b.dataset.hole);
        b.classList.toggle("bg-present", !!e);
        b.classList.toggle("bg-hold", !!e?.hold);
        b.setAttribute(
          "aria-label",
          e
            ? `${e.hold ? "Hold" : "Tap"} helper at hole ${+b.dataset.hole + 1}`
            : `Empty hole ${+b.dataset.hole + 1}`,
        );
        b.querySelector(".bg-gesture").textContent = e
          ? e.hold
            ? "HOLD"
            : "TAP"
          : "";
        b.querySelector(".bg-hole-ring").style.setProperty(
          "--bg-life",
          e ? String(clamp(1 - (s.elapsed - e.at) / life, 0, 1)) : "0",
        );
        b.style.setProperty(
          "--bg-hold-progress",
          s.holding && e && s.holding.id === e.id
            ? String(s.holding.time / 0.55)
            : "0",
        );
      });
      stage
        .querySelectorAll(".bg-sprout")
        .forEach((n, i) =>
          n.classList.toggle("bg-grown", s.hits >= (i + 1) * 5),
        );
      stage.querySelector("[data-bg-score]").textContent =
        `${s.hits} seeds · ${s.settled.length} / 50 helpers · Rhythm ${s.combo} · ${s.score} points`;
      progress(`${s.hits} seeds · ${s.settled.length}/50 helpers`);
    } else if (id === "firefly") {
      for (const view of flightView) {
        const offset = view.gate.at - s.elapsed,
          visible = offset > -0.4 && offset < 7;
        if (view.visible !== visible) {
          view.node.setAttribute("display", visible ? "inline" : "none");
          view.visible = visible;
        }
        if (!visible) continue;
        const y = 340 - offset * FLIGHT_PROFILES[tier].speed * 430;
        view.node.setAttribute("transform", `translate(0 ${y})`);
        if (view.light) {
          const collected = s.collectedLights.includes(view.gate.id);
          if (view.collected !== collected) {
            view.light.setAttribute("display", collected ? "none" : "inline");
            view.collected = collected;
          }
        }
      }
      flightFly.setAttribute("transform", `translate(${s.x * 600 - 22} 317) scale(.55)`);
      const upcoming = s.gates.find((g) => g.at > s.elapsed);
      const wind =
        tier === 2 && upcoming
          ? `Wind ${upcoming.wind > 0 ? "→" : "←"}`
          : "Steady pace";
      const windNode = stage.querySelector("[data-bg-wind]");
      if (windNode.textContent !== wind) windNode.textContent = wind;
      const score =
        `${s.passed} gates passed · ${s.processed.length} / 15 visited · ${s.lights} optional lights`;
      const scoreNode = stage.querySelector("[data-bg-score]");
      if (scoreNode.textContent !== score) scoreNode.textContent = score;
      progress(`${s.processed.length}/15 gates · ${s.lights} lights`);
    } else if (id === "order") {
      const key = JSON.stringify([
        s.positions,
        s.selected,
        s.checked,
        s.decor,
        s.history.length,
        s.done,
      ]);
      if (key !== lastView) {
        lastView = key;
        stage.querySelectorAll("[data-object]").forEach((b) => {
          b.setAttribute(
            "aria-pressed",
            String(s.selected === +b.dataset.object),
          );
          b.classList.toggle("bg-placed", s.positions[+b.dataset.object] >= 0);
        });
        stage.querySelectorAll("[data-cell]").forEach((b) => {
          const i = s.positions.indexOf(+b.dataset.cell),
            slot = b.querySelector("[data-bg-object]");
          slot.innerHTML =
            i >= 0
              ? icon(names[i].toLowerCase()) + `<small>${names[i]}</small>`
              : "";
          b.setAttribute(
            "aria-label",
            `Place ${String.fromCharCode(65 + +b.dataset.cell)}${i >= 0 ? ", " + names[i] : ", empty"}`,
          );
          b.classList.toggle("bg-selected", i >= 0 && i === s.selected);
        });
        stage.querySelectorAll("[data-clue]").forEach((n) => {
          const value = predicate(
            s.puzzle.clues[+n.dataset.clue],
            s.positions,
            s.puzzle.cols,
          );
          n.classList.toggle("bg-clue-ok", s.checked && value === true);
          n.classList.toggle("bg-clue-wrong", s.checked && value === false);
          n.querySelector("span").textContent = s.checked
            ? value === null
              ? "Pending"
              : value
                ? "Fits"
                : "Revisit"
            : "";
        });
        stage.querySelector("[data-bg-undo]").disabled =
          s.history.length === 0 || s.done;
        progress(
          `${s.positions.filter((p) => p >= 0).length}/${s.puzzle.n} objects placed`,
        );
      }
    } else {
      const key = s.correct + ":" + s.tried.join(",");
      if (key !== lastView) {
        lastView = key;
        stage.querySelector("[data-bg-landscape]").innerHTML = landscape(
          s.correct,
        );
        stage.querySelector("[data-bg-history]").innerHTML = s.history
          .map(
            (v, i) =>
              `<div class="bg-pattern-token"><small>${i < s.history.length - 1 ? "Step " + (i + 1) : "Latest"}</small>${symbol(v)}</div>`,
          )
          .join("");
        stage.querySelector("[data-bg-history]").scrollLeft = 9999;
        stage.querySelector("[data-bg-choices]").innerHTML = s.candidates
          .map(
            (v, i) =>
              `<button type="button" data-answer="${i}" ${s.tried.includes(i) || s.done ? "disabled" : ""} aria-label="Answer ${i + 1}: ${v[0] * 90} degrees, ${v[1] + 1} marks, ${shapes[v[2]]}">${symbol(v, true)}<span>${s.tried.includes(i) ? "Tested" : "Choose " + (i + 1)}</span></button>`,
          )
          .join("");
        stage.querySelectorAll("[data-answer]").forEach((b) =>
          on(b, "click", () => selectPattern(+b.dataset.answer)),
        );
      }
      stage.querySelector("[data-bg-score]").textContent =
        `${s.correct} / 6 regions revealed · ${s.firstCorrect} first-try predictions`;
      progress(`${s.correct}/6 regions revealed`);
    }
    const note = stage.querySelector("[data-bg-feedback]");
    if (note && note.textContent !== s.feedback) note.textContent = s.feedback;
  }
  function keySource(e) {
    return `key:${e.code || e.key.toLowerCase()}`;
  }
  function beginMoleHold(target, source) {
    if (s.holding && moleHoldSource !== source) return;
    moleHoldSource = source;
    s.holding = { id: target.id, time: 0 };
  }
  function releaseMoleHold(source) {
    if (moleHoldSource !== source) return;
    moleHoldSource = null;
    s.holding = null;
  }
  function selectPattern(index) {
    if (
      destroyed || s.done ||
      !Number.isInteger(index) ||
      index < 0 || index >= s.candidates.length || s.tried.includes(index)
    ) return;
    choosePattern(s, index);
    render();
    if (!s.done)
      stage.querySelector("[data-answer]:not(:disabled)")?.focus({ preventScroll: true });
    save();
    end();
  }
  function holdSteering(source, direction) {
    if (!destroyed && !s.done) steering.set(source, direction);
  }
  function releaseSteering(source) {
    if (steering.delete(source) && !steering.size && id === "firefly")
      s.target = s.x;
  }
  function clearInput() {
    if (id === "firefly") s.target = s.x;
    s.holding = null;
    holdPointer = null;
    moleHoldSource = null;
    steering.clear();
    dragPointer = null;
    stage
      .querySelectorAll("[data-pressed]")
      .forEach((n) => delete n.dataset.pressed);
  }
  on(window, "blur", clearInput);
  on(document, "visibilitychange", () => {
    if (document.hidden) clearInput();
  });
  on(stage, "keydown", (e) => {
    if (s.done || e.altKey || e.ctrlKey || e.metaKey) return;
    if (
      id === "firefly" &&
      ["ArrowLeft", "ArrowRight", "a", "A", "d", "D"].includes(e.key)
    ) {
      e.preventDefault();
      holdSteering(
        keySource(e),
        ["ArrowLeft", "a", "A"].includes(e.key) ? -1 : 1,
      );
    }
    if (id === "moles" && !e.repeat) {
      const index = "qweasdzxc".indexOf(e.key.toLowerCase());
      if (index >= 0) {
        const b = stage.querySelector(`[data-hole="${index}"]`);
        b.focus();
        const target = activeMoles(s).find((x) => x.hole === index);
        if (target) {
          if (target.hold) beginMoleHold(target, keySource(e));
          else hitMole(s, target.id);
          render();
          save();
        }
      }
    }
    if (
      id === "landscape" && !e.repeat && /^[1-4]$/.test(e.key)
    ) {
      e.preventDefault();
      selectPattern(+e.key - 1);
    }
  });
  on(stage, "keyup", (e) => {
    if (
      id === "firefly" &&
      ["ArrowLeft", "ArrowRight", "a", "A", "d", "D", " ", "Enter"].includes(
        e.key,
      )
    )
      releaseSteering(keySource(e));
    if (id === "moles") releaseMoleHold(keySource(e));
  });
  try {
    build();
  } catch (error) {
    clearInput();
    abort.abort();
    stage.innerHTML = "";
    stage.classList.remove("bg-stage");
    delete stage.dataset.game;
    throw error;
  }
  return {
    focus() {
      if (destroyed || s.done) return;
      const entry = KEYBOARD_ENTRY[id], target = stage.querySelector(entry.target);
      if (!target) throw Error("Missing playable game control");
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      announce(entry.instruction);
    },
    tick(dt) {
      if (destroyed || s.done || !Number.isFinite(dt) || dt <= 0) return;
      if (id === "moles") advanceMoles(s, dt);
      else if (id === "firefly") {
        if (steering.size) {
          const directions = new Set(steering.values());
          const direction =
            (directions.has(-1) ? -1 : 0) + (directions.has(1) ? 1 : 0);
          s.target = clamp(s.x + direction, 0.025, 0.975);
        }
        advanceFlight(s, dt);
      } else s.elapsed += clamp(dt, 0, 0.1);
      render();
      end();
    },
    snapshot() {
      return saveState(s);
    },
    pause() {
      clearInput();
      save();
    },
    hint() {
      if (destroyed || s.done) return;
      s.hints++;
      s.assisted = true;
      if (id === "moles") {
        announce(
          tier === 0
            ? "Watch the shrinking ring. Tap the helper before it closes."
            : "A TAP needs one click. A HOLD needs half a second. Start with the ring that is closing first.",
        );
      } else if (id === "firefly") {
        announce(
          "Look at the next gap before moving. The side light is always optional.",
        );
        stage.querySelector(".bg-flight").classList.add("bg-flight-guide");
      } else if (id === "order") {
        const missing = s.positions.findIndex(
          (p, i) => p !== s.puzzle.solution[i],
        );
        if (s.hints % 3 === 0 && missing >= 0) {
          placeObject(s, missing, s.puzzle.solution[missing]);
          announce(
            `One step shown: ${names[missing]} fits in place ${String.fromCharCode(65 + s.puzzle.solution[missing])}.`,
          );
        } else {
          const i = s.hints % s.puzzle.clues.length;
          announce(clueText(s.puzzle.clues[i], s.puzzle.cols));
          stage
            .querySelectorAll("[data-clue]")
            .forEach((n, j) => n.classList.toggle("bg-clue-hint", i === j));
        }
      } else {
        const r = RULES.find((r) => r.id === s.ruleId);
        announce(
          s.hints >= 3
            ? r.label
            : s.hints === 1
              ? "Compare the direction pointer, number of marks, and shape separately."
              : "Compare the first change with the second. Is the same feature changing both times?",
        );
      }
      render();
      save();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInput();
      abort.abort();
      stage.innerHTML = "";
      stage.classList.remove("bg-stage");
      delete stage.dataset.game;
    },
  };
}
