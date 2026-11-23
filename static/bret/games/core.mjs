/* Pure, seeded gameplay rules. No network, timers, storage, or personal data. */
import { GAME_IDS } from "./ids.mjs";
export const VERSION = 1;
// Only the new variant uses version2, so older clients reject it instead of
// interpreting waiting keepers as timed events. Legacy scenes remain version1.
export const UNHURRIED_VERSION = 2;
export const IDS = GAME_IDS;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(values, r) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// interval/life are seconds; hold is the chance a helper requires a HOLD.
export const MOLE_PROFILES = [
  { interval: 2.4, life: 3.2, hold: 0 },
  { interval: 1.6, life: 2.8, hold: 0.25 },
  { interval: 1, life: 2.2, hold: 0.4 },
];
export function generateMoles(seed, tier) {
  const r = random(seed),
    p = MOLE_PROFILES[tier],
    events = [];
  for (let i = 0; i < 50; i++) {
    const at = 1.2 + i * p.interval,
      occupied = events.filter((e) => e.at + p.life > at).map((e) => e.hole);
    const holes = Array.from({ length: 9 }, (_, n) => n).filter(
      (h) => !occupied.includes(h) && h !== events.at(-1)?.hole,
    );
    if (!holes.length) throw Error("No free mole hole for this profile");
    events.push({ id: i, at, hole: holes[Math.floor(r() * holes.length)], hold: r() < p.hold });
  }
  return events;
}
// speed is vertical field fractions per second; width is the gap fraction;
// wind is horizontal field fractions per second.
export const FLIGHT_PROFILES = [
  { speed: 0.08, width: 0.42, wind: 0 },
  { speed: 0.11, width: 0.34, wind: 0 },
  { speed: 0.14, width: 0.28, wind: 0.04 },
];
export function generateFlight(seed, tier) {
  const r = random(seed),
    p = FLIGHT_PROFILES[tier],
    gates = [];
  let center = 0.5;
  for (let i = 0; i < 15; i++) {
    center = clamp(
      center + (r() - 0.5) * [0.25, 0.32, 0.4][tier],
      p.width / 2 + 0.06,
      1 - p.width / 2 - 0.06,
    );
    gates.push({
      id: i,
      at: 4 + i * 2,
      center,
      width: p.width,
      wind: p.wind * (r() > 0.5 ? 1 : -1),
      light:
        i % 5 === 3
          ? clamp(center + (r() > 0.5 ? 1 : -1) * (p.width / 2 + 0.045), 0.06, 0.94)
          : null,
    });
  }
  return gates;
}
const PERMS = new Map();
function permutations(n) {
  if (PERMS.has(n)) return PERMS.get(n);
  const out = [];
  function walk(a, left) {
    if (!left.length) {
      out.push(a);
      return;
    }
    left.forEach((v, i) =>
      walk(
        [...a, v],
        left.filter((_, j) => j !== i),
      ),
    );
  }
  walk(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  PERMS.set(n, out);
  return out;
}
export function predicate(clue, positions, cols) {
  const [type, a, b] = clue,
    pa = positions[a],
    pb = positions[b];
  if (pa == null || pa < 0) return null;
  if (type === "row") return Math.floor(pa / cols) === b;
  if (type === "col") return pa % cols === b;
  if (pb == null || pb < 0) return null;
  if (type === "adj")
    return (
      Math.abs(Math.floor(pa / cols) - Math.floor(pb / cols)) +
        Math.abs((pa % cols) - (pb % cols)) ===
      1
    );
  if (type === "left") return pa % cols < pb % cols;
  if (type === "above") return Math.floor(pa / cols) < Math.floor(pb / cols);
  return false;
}
export function solveOrder(puzzle) {
  return permutations(puzzle.n).filter((s) =>
    puzzle.clues.every((c) => predicate(c, s, puzzle.cols)),
  );
}
export function generateOrder(seed, tier) {
  const r = random(seed),
    n = tier === 0 ? 4 : 6,
    cols = tier === 0 ? 2 : 3,
    solution = shuffle(
      Array.from({ length: n }, (_, i) => i),
      r,
    ),
    pool = [];
  for (let a = 0; a < n; a++) {
    pool.push(["row", a, Math.floor(solution[a] / cols)], ["col", a, solution[a] % cols]);
    for (let b = 0; b < n; b++)
      if (a !== b)
        for (const type of ["adj", "left", "above"]) {
          const c = [type, a, b];
          if (predicate(c, solution, cols)) pool.push(c);
        }
  }
  let candidates = permutations(n),
    clues = [];
  let ordered = shuffle(pool, r);
  if (tier === 2)
    ordered.sort(
      (a, b) => Number(["row", "col"].includes(a[0])) - Number(["row", "col"].includes(b[0])),
    );
  for (const c of ordered) {
    const next = candidates.filter((s) => predicate(c, s, cols));
    if (next.length < candidates.length) {
      clues.push(c);
      candidates = next;
    }
    if (candidates.length === 1) break;
  }
  for (let i = clues.length - 1; i >= 0; i--) {
    const rest = clues.filter((_, j) => j !== i);
    if (permutations(n).filter((s) => rest.every((c) => predicate(c, s, cols))).length === 1)
      clues = rest;
  }
  return { n, cols, clues, solution };
}
export const RULES = [
  {
    id: "turn-right",
    tier: 0,
    label: "Turn clockwise by one quarter each time.",
    step: (s, k) => [(s[0] + 1) % 4, s[1], s[2]],
  },
  {
    id: "turn-left",
    tier: 0,
    label: "Turn counterclockwise by one quarter each time.",
    step: (s, k) => [(s[0] + 3) % 4, s[1], s[2]],
  },
  {
    id: "add-one",
    tier: 0,
    label: "Add one mark each time. After four comes one.",
    step: (s, k) => [s[0], (s[1] + 1) % 4, s[2]],
  },
  {
    id: "subtract-one",
    tier: 0,
    label: "Remove one mark each time. Before one comes four.",
    step: (s, k) => [s[0], (s[1] + 3) % 4, s[2]],
  },
  {
    id: "add-two",
    tier: 0,
    label: "Advance the mark count by two in the four-step cycle.",
    step: (s, k) => [s[0], (s[1] + 2) % 4, s[2]],
  },
  {
    id: "shape-forward",
    tier: 1,
    label: "Cycle circle, leaf, diamond, then circle.",
    step: (s, k) => [s[0], s[1], (s[2] + 1) % 3],
  },
  {
    id: "shape-backward",
    tier: 1,
    label: "Cycle the shapes in reverse: diamond, leaf, circle.",
    step: (s, k) => [s[0], s[1], (s[2] + 2) % 3],
  },
  {
    id: "alternate-turn",
    tier: 1,
    label: "Alternate a clockwise quarter-turn and adding one mark.",
    step: (s, k) => (k % 2 ? [s[0], (s[1] + 1) % 4, s[2]] : [(s[0] + 1) % 4, s[1], s[2]]),
  },
  {
    id: "alternate-count",
    tier: 1,
    label: "Alternate adding one mark and a clockwise quarter-turn.",
    step: (s, k) => (k % 2 ? [(s[0] + 1) % 4, s[1], s[2]] : [s[0], (s[1] + 1) % 4, s[2]]),
  },
  {
    id: "combine-right",
    tier: 2,
    label: "Turn clockwise and add one mark together each time.",
    step: (s, k) => [(s[0] + 1) % 4, (s[1] + 1) % 4, s[2]],
  },
  {
    id: "combine-left",
    tier: 2,
    label: "Turn counterclockwise and add one mark together each time.",
    step: (s, k) => [(s[0] + 3) % 4, (s[1] + 1) % 4, s[2]],
  },
];
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function consistentRules(history, tier) {
  return RULES.filter(
    (g) => g.tier <= tier && history.slice(1).every((s, k) => same(s, g.step(history[k], k))),
  );
}
// Callers supply a nonempty history generated by the intended permitted
// rule. The current grammar resolves within two added examples from any
// initial triple; normal three-example starts need no extension. Finite
// grammar and seeded checkpoint tests pin this contract. Keep the bounded
// failure below for incompatible future rules instead of inventing an
// answer that the displayed history does not uniquely establish.
export function patternQuestion(history, tier, ruleId, seed) {
  const r = random(seed),
    rule = RULES.find((g) => g.id === ruleId),
    seq = history.map((s) => [...s]);
  let viable, predictions;
  for (let attempt = 0; attempt < 5; attempt++) {
    viable = consistentRules(seq, tier);
    predictions = [
      ...new Set(viable.map((g) => JSON.stringify(g.step(seq.at(-1), seq.length - 1)))),
    ];
    if (predictions.length === 1) break;
    seq.push(rule.step(seq.at(-1), seq.length - 1));
  }
  if (predictions.length !== 1) throw Error("Ambiguous question");
  const answer = JSON.parse(predictions[0]),
    plausible = RULES.map((g) => g.step(seq.at(-1), seq.length - 1));
  plausible.push(
    [answer[0], (answer[1] + 1) % 4, answer[2]],
    [(answer[0] + 1) % 4, answer[1], answer[2]],
    [answer[0], answer[1], (answer[2] + 1) % 3],
  );
  const unique = [
    ...new Map(
      shuffle(plausible, r)
        .filter((s) => !same(s, answer))
        .map((s) => [JSON.stringify(s), s]),
    ).values(),
  ];
  return {
    history: seq,
    candidates: shuffle([answer, ...unique.slice(0, tier === 0 ? 1 : 3)], r),
    answer,
  };
}
export function generatePattern(seed, tier) {
  const r = random(seed),
    available = RULES.filter((g) => g.tier === tier),
    rule = available[Math.floor(r() * available.length)],
    history = [[Math.floor(r() * 4), Math.floor(r() * 4), Math.floor(r() * 3)]];
  for (let k = 0; k < 2; k++) history.push(rule.step(history.at(-1), k));
  return { ruleId: rule.id, ...patternQuestion(history, tier, rule.id, seed + 17) };
}
function fresh(id, tier, seed, unhurried = false) {
  const base = {
    version: unhurried ? UNHURRIED_VERSION : VERSION,
    id,
    tier,
    seed,
    elapsed: 0,
    done: false,
    // Informational assistance attribution, retained across checkpoints.
    // Hints do not reduce score, goal completion, level progress or XP.
    assisted: false,
    hints: 0,
    feedback: "",
  };
  if (id === "moles")
    return {
      ...base,
      ...(unhurried ? { unhurried: true } : {}),
      events: generateMoles(seed, tier),
      settled: [],
      hits: 0,
      combo: 0,
      bestCombo: 0,
      score: 0,
      holding: null,
    };
  if (id === "firefly")
    return {
      ...base,
      gates: generateFlight(seed, tier),
      x: 0.5,
      target: 0.5,
      processed: [],
      passed: 0,
      lights: 0,
      collectedLights: [],
      recoveries: 0,
    };
  if (id === "order") {
    const puzzle = generateOrder(seed, tier);
    return {
      ...base,
      puzzle,
      positions: Array(puzzle.n).fill(-1),
      history: [],
      selected: null,
      checks: 0,
      checked: false,
      decor: "sage",
    };
  }
  return {
    ...base,
    ...generatePattern(seed, tier),
    correct: 0,
    attempts: 0,
    firstCorrect: 0,
    questionAttempts: 0,
    tried: [],
  };
}
// accepted distinguishes a real restored checkpoint from the legacy fresh-state
// fallback. Consumers resuming saved play must check it before replacing a save.
export function restoreCheckpoint(save, id, tier, seed, { unhurried = save?.unhurried === true } = {}) {
  if (
    !IDS.includes(id) ||
    !Number.isInteger(tier) ||
    tier < 0 ||
    tier > 2 ||
    !Number.isInteger(seed) ||
    typeof unhurried !== "boolean" || (unhurried && id !== "moles")
  )
    throw Error("Invalid game configuration");
  const base = fresh(id, tier, seed, unhurried),
    rejected = () => ({ state: base, accepted: false });
  try {
    if (
      !save ||
      save.version !== base.version ||
      save.id !== id ||
      save.seed !== seed ||
      save.tier !== tier ||
      (save.unhurried !== undefined && typeof save.unhurried !== "boolean") ||
      (save.unhurried === true) !== unhurried
    )
      return rejected();
    if (
      !Number.isFinite(save.elapsed) ||
      save.elapsed < 0 ||
      (!unhurried && save.elapsed > 86400) ||
      typeof save.done !== "boolean" ||
      typeof save.assisted !== "boolean" ||
      !Number.isInteger(save.hints) ||
      save.hints < 0 ||
      save.hints > 10000
    )
      return rejected();
    const s = {
      ...base,
      elapsed: save.elapsed,
      done: save.done,
      assisted: save.assisted,
      hints: save.hints,
    };
    const int = (n, a, b) => Number.isInteger(n) && n >= a && n <= b;
    if (id === "moles") {
      if (
        !Array.isArray(save.settled) ||
        save.settled.some((x) => !int(x, 0, 49) || (!unhurried && base.events[x].at > save.elapsed)) ||
        new Set(save.settled).size !== save.settled.length ||
        !int(save.hits, 0, save.settled.length) ||
        (unhurried && (save.hits !== save.settled.length || save.settled.some((x, index) => x !== index))) ||
        !int(save.combo, 0, save.hits) ||
        !int(save.bestCombo, 0, save.hits) ||
        !Number.isFinite(save.score) ||
        save.score < 0 ||
        save.score > 1000 ||
        save.done !== (save.settled.length === 50)
      )
        return rejected();
      Object.assign(s, {
        settled: [...save.settled],
        hits: save.hits,
        combo: save.combo,
        bestCombo: save.bestCombo,
        score: save.score,
      });
    } else if (id === "firefly") {
      if (
        !Array.isArray(save.processed) ||
        save.processed.some((x) => !int(x, 0, 14) || base.gates[x].at > save.elapsed) ||
        base.gates.some((g) => g.at <= save.elapsed && !save.processed.includes(g.id)) ||
        new Set(save.processed).size !== save.processed.length ||
        !int(save.passed, 0, save.processed.length) ||
        !int(save.lights, 0, 9) ||
        !Array.isArray(save.collectedLights) ||
        save.collectedLights.some(
          (x) => ![3, 8, 13].includes(x) || base.gates[x].at - 0.92 > save.elapsed,
        ) ||
        new Set(save.collectedLights).size !== save.collectedLights.length ||
        save.lights !== save.collectedLights.length * 3 ||
        !Number.isFinite(save.x) ||
        save.x < 0 ||
        save.x > 1 ||
        !int(save.recoveries, 0, 15) ||
        save.passed + save.recoveries !== save.processed.length ||
        save.done !== (save.processed.length === 15)
      )
        return rejected();
      Object.assign(s, {
        x: save.x,
        target: save.x,
        processed: [...save.processed],
        passed: save.passed,
        lights: save.lights,
        collectedLights: [...save.collectedLights],
        recoveries: save.recoveries,
      });
    } else if (id === "order") {
      const valid = (p) =>
        Array.isArray(p) &&
        p.length === base.puzzle.n &&
        p.every((x) => int(x, -1, base.puzzle.n - 1)) &&
        new Set(p.filter((x) => x >= 0)).size === p.filter((x) => x >= 0).length;
      if (
        !valid(save.positions) ||
        !Array.isArray(save.history) ||
        save.history.length > 1000 ||
        save.history.some((p) => !valid(p)) ||
        !int(save.checks, 0, 10000) ||
        !["sage", "rose", "lavender"].includes(save.decor)
      )
        return rejected();
      Object.assign(s, {
        positions: [...save.positions],
        history: save.history.map((x) => [...x]),
        checks: save.checks,
        decor: save.decor,
      });
      s.done =
        s.done &&
        s.positions.every((x) => x >= 0) &&
        s.puzzle.clues.every((c) => predicate(c, s.positions, s.puzzle.cols));
    } else {
      if (
        save.ruleId !== base.ruleId ||
        !int(save.correct, 0, 6) ||
        !int(save.attempts, 0, 10000) ||
        !int(save.firstCorrect, 0, save.correct) ||
        !int(save.questionAttempts, 0, 10000)
      )
        return rejected();
      // Replay every served question so later disambiguating examples remain
      // part of the history. A count alone does not pin their future grammar.
      let q = { history: base.history, candidates: base.candidates, answer: base.answer };
      for (let correct = 1; correct <= save.correct; correct++) {
        const history = [...q.history, [...q.answer]];
        // The sixth answer ends play without serving a seventh question.
        q = correct === 6 ? { ...q, history }
          : patternQuestion(history, tier, base.ruleId, seed + 17 + correct * 97);
      }
      // Existing checkpoints already serialize all three served-question fields.
      // Verify that exact question before interpreting eliminated-answer indices;
      // a changed grammar or candidate order must not silently change a resume.
      if (!same(save.history, q.history) || !same(save.candidates, q.candidates) || !same(save.answer, q.answer))
        return rejected();
      // Older checkpoints may omit tried, but still carry their served question.
      const tried = save.tried ?? [];
      if (
        !Array.isArray(tried) ||
        tried.length >= q.candidates.length ||
        tried.some((i) => !int(i, 0, q.candidates.length - 1) || same(q.candidates[i], q.answer)) ||
        new Set(tried).size !== tried.length ||
        tried.length > save.questionAttempts
      )
        return rejected();
      Object.assign(s, q, {
        correct: save.correct,
        attempts: save.attempts,
        firstCorrect: save.firstCorrect,
        questionAttempts: save.questionAttempts,
        tried: [...tried],
      });
      s.done = save.correct === 6;
    }
    return { state: s, accepted: save.done === s.done };
  } catch {
    return rejected();
  }
}
// Compatibility for callers explicitly requesting the old fresh fallback.
export function restoreState(save, id, tier, seed, options) {
  return restoreCheckpoint(save, id, tier, seed, options).state;
}
export function saveState(s) {
  const copy = JSON.parse(JSON.stringify(s));
  delete copy.holding;
  copy.holding = null;
  return copy;
}
export function activeMoles(s) {
  // Unhurried turns keep the seeded actions, with one helper and no deadline.
  if (s.unhurried) {
    const next = s.events.find(event => !s.settled.includes(event.id));
    return next ? [next] : [];
  }
  return s.events.filter(
    (e) =>
      e.at <= s.elapsed &&
      e.at + MOLE_PROFILES[s.tier].life > s.elapsed &&
      !s.settled.includes(e.id),
  );
}
export function hitMole(s, id) {
  const e = activeMoles(s).find((x) => x.id === id);
  if (!e || s.done) return false;
  s.settled.push(id);
  s.score += 10 + Math.min(s.combo, 10);
  s.hits++;
  s.combo++;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  s.feedback = s.combo % 5 === 0 ? "Five seeds. A new patch of garden." : "A seed for your garden.";
  return true;
}
export function advanceMoles(s, dt) {
  if (s.done) return;
  s.elapsed += clamp(dt, 0, 0.1);
  if (s.holding) {
    s.holding.time += clamp(dt, 0, 0.1);
    // A held input completes after 0.55 active seconds.
    if (s.holding.time >= 0.55) {
      hitMole(s, s.holding.id);
      s.holding = null;
    }
  }
  if (s.unhurried) {
    if (s.settled.length === s.events.length) s.done = true;
    return;
  }
  for (const e of s.events)
    if (e.at + MOLE_PROFILES[s.tier].life <= s.elapsed && !s.settled.includes(e.id)) {
      s.settled.push(e.id);
      // A late HOLD ends with its helper, before its completion timer can finish.
      if (s.holding?.id === e.id) s.holding = null;
      s.combo = 0;
      s.feedback = "The next seed is a fresh start.";
    }
  if (s.settled.length === s.events.length) s.done = true;
}
export function advanceFlight(s, dt) {
  if (s.done) return;
  dt = clamp(dt, 0, 0.1);
  const previous = s.elapsed;
  s.elapsed += dt;
  const wind = s.gates.find((g) => g.at >= s.elapsed)?.wind || 0;
  s.x = clamp(s.x + clamp(s.target - s.x, -0.3 * dt, 0.3 * dt) + wind * dt, 0.025, 0.975);
  for (const g of s.gates) {
    if (s.processed.includes(g.id)) continue;
    // Optional lights arrive 0.75 seconds before the gate: collection requires
    // a +/-0.17-second window and less than 0.085 horizontal field distance.
    if (
      g.light !== null &&
      Math.abs(s.elapsed - (g.at - 0.75)) < 0.17 &&
      Math.abs(s.x - g.light) < 0.085 &&
      !s.collectedLights.includes(g.id)
    ) {
      s.collectedLights.push(g.id);
      s.lights += 3;
      s.feedback = "A little extra light.";
    }
    if (previous < g.at && s.elapsed >= g.at) {
      s.processed.push(g.id);
      if (Math.abs(s.x - g.center) <= g.width / 2) {
        s.passed++;
        s.feedback = "Through the open space.";
      } else {
        s.recoveries++;
        s.x = g.center;
        s.target = g.center;
        s.feedback = "Back on the open route. Your light stays.";
      }
    }
  }
  if (s.processed.length === 15) s.done = true;
}
export function placeObject(s, index, cell) {
  if (
    s.done ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= s.puzzle.n ||
    !Number.isInteger(cell) ||
    cell < 0 ||
    cell >= s.puzzle.n
  )
    return false;
  s.history.push([...s.positions]);
  if (s.history.length > 1000) s.history.shift();
  const other = s.positions.indexOf(cell),
    previous = s.positions[index];
  s.positions[index] = cell;
  if (other !== -1 && other !== index) s.positions[other] = previous;
  s.checked = false;
  s.selected = null;
  return true;
}
export function checkOrder(s) {
  s.checks++;
  s.checked = true;
  const complete = s.positions.every((p) => p >= 0),
    checks = s.puzzle.clues.map((c) => predicate(c, s.positions, s.puzzle.cols));
  s.done = complete && checks.every(Boolean);
  s.feedback = s.done
    ? "Every clue fits. Make this place yours."
    : !complete
      ? "Place every object, then check the whole room."
      : "Some clues need another arrangement. All moves can be undone.";
  return s.done;
}
export function choosePattern(s, index) {
  if (
    s.done ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= s.candidates.length ||
    s.tried.includes(index)
  )
    return false;
  s.attempts++;
  s.questionAttempts++;
  if (!same(s.candidates[index], s.answer)) {
    s.tried.push(index);
    s.feedback = "That change does not fit every example. Try another idea.";
    return false;
  }
  if (s.questionAttempts === 1) s.firstCorrect++;
  s.correct++;
  s.feedback =
    s.correct === 6
      ? "The whole scene is yours."
      : "The same rule still holds. Another piece appears.";
  s.history.push([...s.answer]);
  s.questionAttempts = 0;
  s.tried = [];
  if (s.correct === 6) s.done = true;
  else Object.assign(s, patternQuestion(s.history, s.tier, s.ruleId, s.seed + 17 + s.correct * 97));
  return true;
}
// Results expose assistance attribution (and the Order hint count) as
// information only. session.mjs awards time XP and the completion bonus
// from the same goals whether or not hints were used.
export function resultFor(s) {
  if (s.id === "moles") {
    const accuracy = s.hits / 50;
    return {
      title: accuracy >= 0.7 ? "A garden of little victories" : "Your garden keeps every seed",
      detail: `${s.hits} of 50 seeds collected. Best rhythm: ${s.bestCombo}.`,
      score: s.score,
      accuracy,
      passed: accuracy >= 0.7,
      assisted: s.assisted,
    };
  }
  if (s.id === "firefly")
    return {
      title: "A lantern to leave here",
      detail: `${s.passed} of 15 gates, ${s.lights} extra lights.`,
      score: s.passed * 10 + s.lights * 2 + 20,
      accuracy: s.passed / 15,
      passed: s.passed >= 12,
      assisted: s.assisted,
    };
  if (s.id === "order")
    return {
      title: "A place that feels like yours",
      detail: `Every visible clue fits. ${s.checks} checks, ${s.hints} hints.`,
      passed: true,
      assisted: s.assisted,
    };
  return {
    title: "A scene you uncovered",
    detail: `Six predictions, ${s.firstCorrect} right on the first try.`,
    accuracy: s.firstCorrect / 6,
    passed: true,
    assisted: s.assisted,
  };
}
