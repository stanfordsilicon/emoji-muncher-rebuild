"use strict";

// `Number(env) || fallback` silently discards a legitimate "0" override
// (0 is falsy), so every knob here goes through this instead.
function num(envVar, fallback) {
  const v = Number(process.env[envVar]);
  return Number.isFinite(v) && process.env[envVar] !== undefined && process.env[envVar] !== "" ? v : fallback;
}

// Every tunable knob for the game lives here (and can be overridden via env
// vars) so gameplay balance never has to be hunted for inside game logic.
module.exports = {
  PORT: num("PORT", 3131),
  GRID_COLS: num("GRID_COLS", 9),
  GRID_ROWS: num("GRID_ROWS", 7),
  ROUND_COUNT: num("ROUND_COUNT", 8),
  ROUND_TIME_MS: num("ROUND_TIME_MS", 40000),
  NEXT_ROUND_PAUSE_MS: num("NEXT_ROUND_PAUSE_MS", 3000),
  MOVE_COOLDOWN_MS: num("MOVE_COOLDOWN_MS", 0),
  STARTING_LIVES: num("STARTING_LIVES", 3),
  POINTS_PER_CORRECT: num("POINTS_PER_CORRECT", 10),
  // A keyword with only a handful of matching symbols forces the grid
  // generator to repeat those same few symbols dozens of times to fill out
  // safe paths (e.g. a 3-match keyword can end up "safe" on 40+ of 63
  // cells) -- trivially easy, since almost everything on the board is safe
  // to eat. Matches the Week 8 CSV's "roughly 10-15 emoji" viability target;
  // ConceptRepository (see server/data/ConceptRepository.js) already ships
  // every concept with exactly 10 ranked members, so this floor is really a
  // guard against future concept data ever shipping a thinner cluster,
  // rather than something that filters anything out today.
  MIN_MATCHES_PER_KEYWORD: num("MIN_MATCHES_PER_KEYWORD", 10),
};
