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
  GRID_COLS: num("GRID_COLS", 7),
  GRID_ROWS: num("GRID_ROWS", 6),
  ROUND_COUNT: num("ROUND_COUNT", 8),
  ROUND_TIME_MS: num("ROUND_TIME_MS", 40000),
  MOVE_COOLDOWN_MS: num("MOVE_COOLDOWN_MS", 170),
  STARTING_LIVES: num("STARTING_LIVES", 3),
  POINTS_PER_CORRECT: num("POINTS_PER_CORRECT", 10),
  MIN_MATCHES_PER_KEYWORD: num("MIN_MATCHES_PER_KEYWORD", 3),
  MAX_MATCHES_PER_KEYWORD: num("MAX_MATCHES_PER_KEYWORD", 8),
  SPAWN_SAFE_RADIUS: num("SPAWN_SAFE_RADIUS", 2),
  ROOM_CODE_LENGTH: num("ROOM_CODE_LENGTH", 4),
};
