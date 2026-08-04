"use strict";

// Every tunable knob for the game lives here (and can be overridden via env
// vars) so gameplay balance never has to be hunted for inside game logic.
module.exports = {
  PORT: Number(process.env.PORT) || 3131,
  GRID_COLS: Number(process.env.GRID_COLS) || 7,
  GRID_ROWS: Number(process.env.GRID_ROWS) || 6,
  ROUND_COUNT: Number(process.env.ROUND_COUNT) || 8,
  ROUND_TIME_MS: Number(process.env.ROUND_TIME_MS) || 40000,
  MOVE_COOLDOWN_MS: Number(process.env.MOVE_COOLDOWN_MS) || 170,
  STARTING_LIVES: Number(process.env.STARTING_LIVES) || 3,
  POINTS_PER_CORRECT: Number(process.env.POINTS_PER_CORRECT) || 10,
  MIN_MATCHES_PER_KEYWORD: Number(process.env.MIN_MATCHES_PER_KEYWORD) || 3,
  MAX_MATCHES_PER_KEYWORD: Number(process.env.MAX_MATCHES_PER_KEYWORD) || 8,
  ROOM_CODE_LENGTH: Number(process.env.ROOM_CODE_LENGTH) || 4,
};
