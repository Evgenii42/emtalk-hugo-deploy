// The same JSON is read by the Hugo setup form. Keep labels and accepted values
// together so rendered choices, persisted preferences and host copy agree.
import options from "./options.json" with { type: "json" };

const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze({ ...row })));
export const TIERS = freezeRows(options.tiers);
export const MODES = freezeRows(options.modes);
export const DURATIONS = freezeRows(options.durations);
export const DEFAULTS = Object.freeze({ ...options.defaults });

export const validTier = (value) => TIERS.some((row) => row.value === value);
export const validMode = (value) => MODES.some((row) => row.value === value);
export const validDuration = (value) => DURATIONS.some((row) => row.value === value);
export const tierLabel = (value) => TIERS.find((row) => row.value === value)?.label || "";
export const modeLabel = (value) => MODES.find((row) => row.value === value)?.label || "";
export const durationRunLabel = (value) => DURATIONS.find((row) => row.value === value)?.runLabel || "";
