// Persisted schema identifiers, independent of game titles or UI copy.
// Renaming a title must not rename these values; changes need a storage migration.
export const GAME_ID = Object.freeze({
  SEED_KEEPERS: "moles",
  LANTERN_DRIFT: "firefly",
  A_PLACE_FOR_EVERYTHING: "order",
  HIDDEN_SEASONS: "landscape",
});
export const GAME_IDS = Object.freeze(Object.values(GAME_ID));
