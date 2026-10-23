// Source: Android DM DecisionScoringService / ComparisonManager, revision3faddfbc.
export const PRIORITIES = Object.freeze([1, 3, 5, 8]);
export const MAX_OPTIONS = 8;
const steps = ["options", "compare", "review", "pros", "results"];
const allowed = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => keys.includes(k)) &&
  keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const text = (v, max, empty = false) =>
  typeof v === "string" && v.length <= max && (empty || v.trim().length > 0);
function requireValue(value) {
  if (!value) throw new Error("Invalid decision data.");
}
export function createDecision() {
  return {
    schemaVersion: 1,
    title: "",
    step: "options",
    options: [],
    pairs: [],
    answers: {},
    selected: [],
    opinions: [],
  };
}
export function makePairs(options, random = Math.random) {
  const pairs = [];
  for (let i = 0; i < options.length; i++)
    for (let j = i + 1; j < options.length; j++) {
      const pair = [options[i].id, options[j].id];
      // Native DM randomizes left/right as well as the order of all pairs.
      pairs.push(random() < 0.5 ? pair.reverse() : pair);
    }
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}
export function prosConsScore(opinions) {
  let pros = 0,
    cons = 0;
  for (const item of opinions) {
    if (item.type === "pros") pros += item.priority;
    else cons += item.priority;
  }
  const total = pros + cons;
  if (total === 0) return 50;
  // Match native integer truncation: a single weight 8 pro/con scores 74/25.
  // The one-point asymmetry is deliberate; symmetric rounding changes parity.
  return Math.min(
    100,
    Math.max(
      0,
      Math.trunc(
        50 + 50 * ((pros - cons) / total) * (1 - Math.exp(-total / 12)),
      ),
    ),
  );
}
export function matrixScore(wins, total) {
  return total <= 1
    ? 100
    : Math.min(100, Math.max(0, Math.trunc((wins / (total - 1)) * 100)));
}
export function results(state) {
  const wins = Object.fromEntries(state.options.map((o) => [o.id, 0]));
  state.pairs.forEach((pair, index) => {
    const winner = state.answers[String(index)];
    if (pair.includes(winner)) wins[winner]++;
  });
  return state.options.map((option) => {
    const reviewed = state.selected.includes(option.id);
    return {
      ...option,
      wins: wins[option.id],
      comparison: state.pairs.length
        ? matrixScore(wins[option.id], state.options.length)
        : null,
      prosCons: reviewed
        ? prosConsScore(state.opinions.filter((x) => x.optionId === option.id))
        : null,
    };
  });
}
export function orderedResults(state) {
  return results(state)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.wins - a.row.wins || a.index - b.index)
    .map(({ row }) => row);
}
export function validateDecision(value) {
  requireValue(
    allowed(value, [
      "schemaVersion",
      "title",
      "step",
      "options",
      "pairs",
      "answers",
      "selected",
      "opinions",
    ]),
  );
  requireValue(
    value.schemaVersion === 1 &&
      text(value.title, 160, true) &&
      steps.includes(value.step),
  );
  requireValue(
    Array.isArray(value.options) && value.options.length <= MAX_OPTIONS,
  );
  const ids = new Set(),
    titles = new Set();
  for (const o of value.options) {
    requireValue(
      allowed(o, ["id", "title"]) &&
        text(o.id, 80) &&
        /^[a-zA-Z0-9_-]+$/.test(o.id) &&
        text(o.title, 100),
    );
    requireValue(!ids.has(o.id) && !titles.has(o.title.trim().toLowerCase()));
    ids.add(o.id);
    titles.add(o.title.trim().toLowerCase());
  }
  requireValue(value.step === "options" || ids.size > 0);
  requireValue(Array.isArray(value.pairs) && value.pairs.length <= 28);
  const seen = new Set();
  for (const pair of value.pairs) {
    requireValue(
      Array.isArray(pair) &&
        pair.length === 2 &&
        pair.every((x) => ids.has(x)) &&
        pair[0] !== pair[1],
    );
    const key = [...pair].sort().join("|");
    requireValue(!seen.has(key));
    seen.add(key);
  }
  requireValue(
    value.pairs.length === 0 ||
      (ids.size >= 4 && seen.size === (ids.size * (ids.size - 1)) / 2),
  );
  requireValue(
    (value.step !== "compare" && value.step !== "review") ||
      value.pairs.length > 0,
  );
  requireValue(
    value.answers &&
      typeof value.answers === "object" &&
      !Array.isArray(value.answers),
  );
  for (const [key, winner] of Object.entries(value.answers))
    requireValue(
      /^(0|[1-9][0-9]*)$/.test(key) &&
        Number(key) < value.pairs.length &&
        (winner === null || value.pairs[Number(key)].includes(winner)),
    );
  requireValue(
    Array.isArray(value.selected) &&
      value.selected.length <= 3 &&
      new Set(value.selected).size === value.selected.length &&
      value.selected.every((id) => ids.has(id)),
  );
  requireValue(value.step !== "pros" || value.selected.length > 0);
  requireValue(Array.isArray(value.opinions) && value.opinions.length <= 120);
  const noteIds = new Set();
  for (const item of value.opinions) {
    requireValue(
      allowed(item, ["id", "optionId", "text", "type", "priority"]) &&
        text(item.id, 80) &&
        /^[a-zA-Z0-9_-]+$/.test(item.id) &&
        !noteIds.has(item.id),
    );
    requireValue(
      ids.has(item.optionId) &&
        text(item.text, 400) &&
        ["pros", "cons"].includes(item.type) &&
        PRIORITIES.includes(item.priority),
    );
    noteIds.add(item.id);
  }
  // A saved/imported phase must be reachable through the actual guest flow.
  const answered = Object.keys(value.answers).length;
  if (value.step === "options")
    requireValue(
      value.pairs.length === 0 &&
        answered === 0 &&
        value.selected.length === 0 &&
        value.opinions.length === 0,
    );
  else if (ids.size <= 3)
    requireValue(
      value.pairs.length === 0 &&
        answered === 0 &&
        ["pros", "results"].includes(value.step) &&
        value.selected.length === ids.size,
    );
  else {
    requireValue(value.pairs.length === (ids.size * (ids.size - 1)) / 2);
    if (value.step !== "compare") requireValue(answered === value.pairs.length);
  }
  return JSON.parse(JSON.stringify(value));
}
export function parseDecision(raw) {
  requireValue(
    typeof raw === "string" && new TextEncoder().encode(raw).length <= 200000,
  );
  return validateDecision(JSON.parse(raw));
}
export function serializeDecision(state) {
  return JSON.stringify(validateDecision(state), null, 2);
}
// Interrupted work is independent of named history and portable decision JSON.
// Keep cursors outside schemaVersion1 decisions so old exports remain readable.
export function createDraft(
  decision,
  { pairIndex = 0, optionIndex = 0, savedEntryId = null } = {},
  savedAt = Date.now(),
) {
  return validateDraft({
    schemaVersion: 1,
    savedAt,
    decision,
    pairIndex,
    optionIndex,
    savedEntryId,
  });
}
export function validateDraft(value) {
  requireValue(
    allowed(value, [
      "schemaVersion",
      "savedAt",
      "decision",
      "pairIndex",
      "optionIndex",
      "savedEntryId",
    ]) &&
      value.schemaVersion === 1 &&
      Number.isSafeInteger(value.savedAt) &&
      value.savedAt >= 0,
  );
  const decision = validateDecision(value.decision);
  requireValue(
    Number.isSafeInteger(value.pairIndex) &&
      value.pairIndex >= 0 &&
      value.pairIndex < Math.max(1, decision.pairs.length) &&
      Number.isSafeInteger(value.optionIndex) &&
      value.optionIndex >= 0 &&
      value.optionIndex < Math.max(1, decision.selected.length) &&
      (value.savedEntryId === null ||
        (text(value.savedEntryId, 80) &&
          /^[a-zA-Z0-9_-]+$/.test(value.savedEntryId))),
  );
  return { ...value, decision };
}
export function parseDraft(raw) {
  requireValue(
    typeof raw === "string" && new TextEncoder().encode(raw).length <= 220000,
  );
  return validateDraft(JSON.parse(raw));
}
export function serializeDraft(draft) {
  return JSON.stringify(validateDraft(draft));
}
function cell(value) {
  let s = String(value == null ? "" : value);
  // Quoting protects separators/newlines. Apostrophe protects spreadsheet formulas
  // and leading control prefixes, including tab/vertical-tab without a formula.
  if (/^[\s]*[=+@-]/.test(s) || /^[\s]*[\u0000-\u001f\u007f]/.test(s))
    s = "'" + s;
  return '"' + s.split('"').join('""') + '"';
}
export function resultsCsv(state) {
  const rows = [
    ["Decision", state.title, "", ""],
    ["Option", "Pairwise wins", "Pairwise score /100", "Pros and cons /100"],
  ];
  for (const r of orderedResults(state))
    rows.push([
      r.title,
      state.pairs.length ? r.wins : "",
      r.comparison,
      r.prosCons,
    ]);
  // UTF-8 BOM helps spreadsheet apps detect non-Latin names. Generic CSV readers
  // should strip this encoding marker rather than treating it as header text.
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}

// Bounded named local history. Decision files remain independent of browser IDs.
export const MAX_HISTORY = 20;
export function validateHistory(value) {
  requireValue(
    allowed(value, ["schemaVersion", "entries"]) &&
      value.schemaVersion === 1 &&
      Array.isArray(value.entries) &&
      value.entries.length <= MAX_HISTORY,
  );
  const ids = new Set();
  for (const entry of value.entries) {
    requireValue(
      allowed(entry, ["id", "savedAt", "decision"]) &&
        text(entry.id, 80) &&
        /^[a-zA-Z0-9_-]+$/.test(entry.id) &&
        !ids.has(entry.id),
    );
    requireValue(Number.isSafeInteger(entry.savedAt) && entry.savedAt >= 0);
    validateDecision(entry.decision);
    ids.add(entry.id);
  }
  return JSON.parse(JSON.stringify(value));
}
export function parseHistory(raw) {
  requireValue(
    typeof raw === "string" && new TextEncoder().encode(raw).length <= 2000000,
  );
  return validateHistory(JSON.parse(raw));
}
// Export-only inspection is deliberately separate from strict restore/import.
// It never constructs a repaired history or changes the supplied stored text.
export function recoverHistoryEntries(raw, legacy = false) {
  requireValue(
    typeof raw === "string" &&
      new TextEncoder().encode(raw).length <= (legacy ? 200000 : 2000000),
  );
  const recovery = { entries: [], unreadable: 0, problem: null };
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...recovery, problem: "invalid-json" };
  }
  if (legacy) {
    try {
      recovery.entries.push({ position: 1, decision: validateDecision(value) });
    } catch {
      recovery.unreadable = 1;
    }
    return recovery;
  }
  if (
    !allowed(value, ["schemaVersion", "entries"]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_HISTORY
  )
    return { ...recovery, problem: "invalid-envelope" };
  value.entries.forEach((entry, index) => {
    try {
      const valid = validateHistory({ schemaVersion: 1, entries: [entry] });
      recovery.entries.push({
        position: index + 1,
        decision: valid.entries[0].decision,
      });
    } catch {
      recovery.unreadable++;
    }
  });
  return recovery;
}
export function putHistory(history, entry, replace = false) {
  const next = validateHistory(history);
  const index = next.entries.findIndex((item) => item.id === entry.id);
  if (replace) requireValue(index >= 0);
  else requireValue(index < 0 && next.entries.length < MAX_HISTORY);
  if (replace) next.entries.splice(index, 1);
  next.entries.unshift(entry);
  return validateHistory(next);
}
