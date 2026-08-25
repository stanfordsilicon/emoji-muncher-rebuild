"use strict";

const config = require("../config");
const { getEmojiRepository } = require("../data");
const { generateRound } = require("./gridGenerator");

/**
 * Core game rules for one Emoji Munchers match, as plain-JSON room state
 * plus pure functions operating on it -- no class instances, no live
 * setTimeout handles, no Map/Set fields, and no networking knowledge here
 * at all. That's what makes a room safe to persist to Mongo
 * (server/game/store.js) and reload in a completely different process or
 * serverless invocation.
 *
 * Single-player only: a room always holds exactly one player, keyed by
 * that player's own client-generated id (see public/client.js's
 * getDeviceId()) -- there's no room code to share, no join/host/kick, and
 * no cross-player state. `players`/`playerOrder` stay collection-shaped
 * (rather than a single `player` field) purely because the round/scoring
 * logic below was written generically over "every player in the room" and
 * that logic is correct and unchanged whether the collection holds one
 * entry or many -- not because more than one entry is ever expected.
 *
 * Round timeouts and the pause between rounds used to be driven by live
 * `setTimeout` handles kept as instance fields (`this.roundTimer`,
 * `this.nextRoundTimer`) -- those can't survive across invocations, so
 * instead every room load "catches up" any time-driven state via
 * applyLazyStateUpdates() before anything else happens to it. See
 * server/game/LobbyManager.js's loadRoom() for where that gets called.
 */

const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const CORNERS = [
  (cols, rows) => [0, 0],
  (cols, rows) => [cols - 1, 0],
  (cols, rows) => [0, rows - 1],
  (cols, rows) => [cols - 1, rows - 1],
];

const NEIGHBOR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// How long a disconnected player's seat stays warm before the room is
// actually cleaned up -- long enough to survive a page refresh or a
// closed tab, without leaving an abandoned room around forever.
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

// A player is considered disconnected once their heartbeat goes quiet for
// this long -- comfortably above the client's heartbeat interval so a
// couple of missed beats don't falsely flag someone as gone.
const HEARTBEAT_TIMEOUT_MS = 15 * 1000;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function createRoom(code, language, uiLang) {
  return {
    code,
    // Which per-language concept data (see server/data/index.js's
    // getEmojiRepository) this room's rounds draw keywords from -- the
    // arcade party's Game Language, or "en" standalone/unsupported.
    language: language || "en",
    // The arcade party's Screen Language (this game has no UI translation
    // of its own -- purely a data-capture pass-through, recorded alongside
    // Game Language in analytics so which languages people are actually
    // combining is visible downstream).
    uiLang: uiLang || "en",
    status: "lobby", // lobby | playing | roundEnd | gameOver
    players: {}, // playerId -> player state (always exactly one entry)
    playerOrder: [],
    round: 0,
    keyword: null,
    keywordLabel: null,
    grid: [],
    correctCount: 0,
    destination: null,
    eatenCells: {}, // "col,row" -> { by, symbol, correct }
    gameStartedAt: null,
    gameEndedAt: null,
    roundStartedAt: null,
    roundEndsAt: null, // replaces the old live roundTimer
    nextRoundAt: null, // replaces the old live nextRoundTimer
    roundFinalizedFor: -1, // round number already finalized, guards double-finalization
    analyticsSaved: false, // guards double-writing score/analytics on game over
    // Bumped on every store.saveRoom() call (see server/game/store.js) --
    // the client compares this, not request-send order, to decide whether
    // an incoming response is fresher than what it already has. Request
    // send order looks like a reasonable proxy for freshness but isn't one:
    // under real network jitter (negligible on localhost, routine on a
    // real deployment) a poll and a move fired moments apart can still
    // reach the server, and get processed, out of send order. version is
    // assigned by the server at the moment each mutation actually happens,
    // so it reflects true freshness regardless of network reordering.
    version: 0,
    createdAt: Date.now(),
  };
}

function makePlayer(playerId, username) {
  return {
    id: playerId,
    username,
    score: 0,
    lives: config.STARTING_LIVES,
    muncherCol: 0,
    muncherRow: 0,
    eaten: [],
    correctRemaining: 0,
    roundDone: false,
    destinationReached: false,
    eliminated: false,
    connected: true,
    lastSeenAt: Date.now(),
    disconnectedAt: null,
    lastMoveAt: 0,
    // analytics bookkeeping, reset every match/round below
    eatOrder: 0,
    lastActionAt: 0,
    firstInputAt: null,
    firstCorrectAt: null,
    currentRoundEntry: null,
    matchLog: { rounds: [] },
  };
}

function isEmpty(room) {
  return room.playerOrder.length === 0;
}

// ---- lobby ----

function addPlayer(room, playerId, username) {
  const existing = room.players[playerId];
  if (existing) {
    // Already a member -- a rejoin after a brief disconnect, or a duplicate
    // join from the same device -- treat as reconnect rather than erroring.
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.lastSeenAt = Date.now();
    if (username) existing.username = username;
    return;
  }
  room.players[playerId] = makePlayer(playerId, username);
  room.playerOrder.push(playerId);
}

// Used for an explicit "leave" (Go Home), or once a disconnect's grace
// period actually expires (see applyLazyStateUpdates) -- either way empties
// the room, so the caller (LobbyManager's mutateRoom) deletes it afterward.
function removePlayer(room, playerId) {
  const wasPresent = !!room.players[playerId];
  delete room.players[playerId];
  room.playerOrder = room.playerOrder.filter((id) => id !== playerId);
  return wasPresent;
}

// Sent every few seconds by a connected client -- there's no persistent
// socket left for the server to notice a disconnect with, so presence is
// tracked this way instead. Actual staleness detection happens lazily in
// applyLazyStateUpdates on the next room load, not here.
function heartbeat(room, playerId) {
  const player = room.players[playerId];
  if (!player) throw new Error("You are not in this room.");
  player.lastSeenAt = Date.now();
  if (!player.connected) {
    player.connected = true;
    player.disconnectedAt = null;
  }
}

// ---- game lifecycle ----

// Used both to start a brand-new game and to reset for "Play Again" -- the
// two are the same operation (full reset, straight into round 1), so there's
// no separate "lobby, waiting for the host to start" state to pass through.
function beginGame(room) {
  room.status = "playing";
  room.round = 0;
  room.keyword = null;
  room.keywordLabel = null;
  room.grid = [];
  room.destination = null;
  room.eatenCells = {};
  room.gameStartedAt = Date.now();
  room.gameEndedAt = null;
  room.roundStartedAt = null;
  room.roundEndsAt = null;
  room.nextRoundAt = null;
  room.roundFinalizedFor = -1;
  room.analyticsSaved = false;
  for (const id of room.playerOrder) {
    const player = room.players[id];
    player.score = 0;
    player.lives = config.STARTING_LIVES;
    player.eliminated = false;
    player.roundDone = false;
    player.destinationReached = false;
    player.eaten = [];
    player.eatOrder = 0;
    player.lastActionAt = 0;
    player.firstInputAt = null;
    player.firstCorrectAt = null;
    player.currentRoundEntry = null;
    player.matchLog = { rounds: [] };
  }
  nextRound(room);
}

function move(room, playerId, dir) {
  if (room.status !== "playing") return;
  const player = room.players[playerId];
  // roundDone is the important guard here: without it, a player who's
  // already reached the flag could keep moving/munching (and scoring)
  // during the next-round pause.
  if (!player || player.eliminated || player.roundDone) return;
  const delta = DIRS[dir];
  if (!delta) return;

  // Optional pacing knob (MOVE_COOLDOWN_MS, 0/off by default): ignores moves
  // faster than the configured gap. Left at 0 so every accepted keypress
  // moves immediately -- a nonzero value here was making legitimate rapid
  // taps get silently dropped with no feedback, which read as the game
  // needing multiple presses to register one step.
  const now = Date.now();
  if (now - player.lastMoveAt < config.MOVE_COOLDOWN_MS) return;
  player.lastMoveAt = now;

  player.muncherCol = clamp(player.muncherCol + delta[0], 0, config.GRID_COLS - 1);
  player.muncherRow = clamp(player.muncherRow + delta[1], 0, config.GRID_ROWS - 1);
  resolveMunch(room, player);
  maybeAdvanceRound(room);
}

// ---- internals ----

function resolveMunch(room, player) {
  const key = `${player.muncherCol},${player.muncherRow}`;
  const cell = room.grid[player.muncherRow * config.GRID_COLS + player.muncherCol];
  if (!cell) return;

  const now = Date.now();
  const decisionTimeMs = now - (player.lastActionAt || now);
  const isFirstInput = player.firstInputAt === null;
  if (isFirstInput) player.firstInputAt = now;
  player.lastActionAt = now;

  const isDestination = !!room.destination && cell.col === room.destination.col && cell.row === room.destination.row;
  const alreadyEaten = Object.prototype.hasOwnProperty.call(room.eatenCells, key);

  if (!alreadyEaten) {
    const correct = getEmojiRepository(room.language).isMatch(cell.symbol, room.keyword);
    room.eatenCells[key] = { by: player.id, symbol: cell.symbol, correct };
    player.eaten.push(key);
    player.eatOrder += 1;

    if (correct) {
      player.score += config.POINTS_PER_CORRECT;
      player.correctRemaining -= 1;
      if (player.firstCorrectAt === null) player.firstCorrectAt = now;
    } else {
      player.lives -= 1;
      if (player.lives <= 0) player.eliminated = true;
    }

    if (player.currentRoundEntry) {
      player.currentRoundEntry.eats.push({
        emoji: cell.symbol,
        col: cell.col,
        row: cell.row,
        correct,
        eatOrder: player.eatOrder,
        timestamp: new Date(now),
        decisionTimeMs,
        livesRemaining: player.lives,
        scoreAfter: player.score,
      });
    }
  }

  if (isDestination && !player.roundDone) {
    player.destinationReached = true;
    player.roundDone = true;
  }
}

function activePlayers(room) {
  return room.playerOrder.map((id) => room.players[id]).filter((p) => p && p.connected && !p.eliminated);
}

// Returns true if this call changed round/game state (used by the lazy
// heartbeat-staleness path to know whether the room needs saving).
function maybeAdvanceRound(room) {
  const active = activePlayers(room);
  const allEliminated = active.length === 0 && room.playerOrder.length > 0;
  if (allEliminated) {
    endGame(room);
    return true;
  }
  if (active.length > 0 && active.every((p) => p.roundDone)) {
    // Feedback: "When the last round ends, it always says that the next
    // round will start in 3 seconds, but it's supposed to be over."
    // advanceAfterDelay() unconditionally sets nextRoundAt and a "roundEnd"
    // status that the client renders as a "Next round in Xs" countdown --
    // correct mid-game, but round === ROUND_COUNT has no next round to
    // advance to (the following nextRound() call would immediately end the
    // game anyway, per its own room.round > ROUND_COUNT check below). Ending
    // the game directly here skips that pointless, misleading pause.
    if (room.round >= config.ROUND_COUNT) {
      endGame(room);
    } else {
      advanceAfterDelay(room);
    }
    return true;
  }
  return false;
}

function advanceAfterDelay(room) {
  finalizeCurrentRoundLogs(room);
  room.roundEndsAt = null;
  room.status = "roundEnd";
  room.nextRoundAt = Date.now() + config.NEXT_ROUND_PAUSE_MS;
}

// The clock running out used to advance straight to "roundEnd" with no
// other consequence -- identical, from the player's side, to actually
// reaching the flag: same "Next round in Xs" message, same no-penalty
// outcome. Costing a life here (same as eating a wrong emoji -- see
// resolveMunch) makes running out of time an actual failure instead of a
// silent freebie, and marks the player roundDone so maybeAdvanceRound's
// "is everyone done" check still holds for a solo player whose only
// outstanding player just timed out.
function penalizeTimedOutPlayers(room) {
  for (const id of room.playerOrder) {
    const player = room.players[id];
    if (!player || player.eliminated || player.roundDone) continue;
    player.lives -= 1;
    if (player.lives <= 0) player.eliminated = true;
    player.roundDone = true;
    if (player.currentRoundEntry) player.currentRoundEntry.timedOut = true;
  }
}

function emojiMetaForGrid(grid, keyword, repo) {
  const seen = new Map();
  for (const cell of grid) {
    if (!seen.has(cell.symbol)) {
      seen.set(cell.symbol, {
        symbol: cell.symbol,
        // Every keyword-emoji pair now comes from ConceptRepository's
        // unsupervised clustering, not a hand-curated list, so every match
        // is genuinely inferred rather than manually confirmed.
        confirmedOrInferred: "inferred",
        poisonStatus: repo.isMatch(cell.symbol, keyword) ? "safe" : "poison",
      });
    }
  }
  return [...seen.values()];
}

// Escalates the concept-cluster resolution (see ConceptRepository) across
// the game's rounds: broad/easy k=20 clusters early, down to fine-grained
// k=150 near-duplicates by the last round -- both the "correct" concept and
// its decoy pool get subtler together, since both are drawn from the same
// tier. Proportional to ROUND_COUNT rather than hardcoded round numbers so
// a different round count still spans easy-to-hard sensibly.
function tierForRound(round, totalRounds) {
  const progress = totalRounds > 1 ? (round - 1) / (totalRounds - 1) : 1;
  if (progress < 0.4) return 20;
  if (progress < 0.75) return 60;
  return 150;
}

function nextRound(room) {
  room.nextRoundAt = null;
  room.eatenCells = {};
  room.round += 1;

  const active = activePlayers(room);
  if (room.round > config.ROUND_COUNT || active.length === 0) {
    endGame(room);
    return;
  }

  const repo = getEmojiRepository(room.language);
  const { keyword, grid, correctCount, difficulty, destination } = generateRound(repo, {
    cols: config.GRID_COLS,
    rows: config.GRID_ROWS,
    minMatches: config.MIN_MATCHES_PER_KEYWORD,
    difficultyTier: tierForRound(room.round, config.ROUND_COUNT),
  });
  room.keyword = keyword;
  room.keywordLabel = repo.getKeywordLabel(keyword);
  room.grid = grid;
  room.correctCount = correctCount;
  room.destination = destination ? { col: destination.col, row: destination.row } : null;
  room.roundStartedAt = Date.now();
  room.roundEndsAt = room.roundStartedAt + config.ROUND_TIME_MS;
  room.status = "playing";

  const emojiMeta = emojiMetaForGrid(grid, keyword, repo);

  let i = 0;
  for (const id of room.playerOrder) {
    const player = room.players[id];
    if (!player || player.eliminated) continue;
    const [sc, sr] = CORNERS[i % CORNERS.length](config.GRID_COLS, config.GRID_ROWS);
    player.muncherCol = sc;
    player.muncherRow = sr;
    player.eaten = [];
    player.correctRemaining = correctCount;
    player.roundDone = false;
    player.destinationReached = false;
    player.eatOrder = 0;
    player.lastActionAt = room.roundStartedAt;
    player.firstInputAt = null;
    player.firstCorrectAt = null;

    player.currentRoundEntry = {
      roundNumber: room.round,
      keyword,
      keywordLabel: room.keywordLabel,
      board: grid.map((c) => ({ col: c.col, row: c.row, symbol: c.symbol })),
      totalCells: config.GRID_COLS * config.GRID_ROWS,
      correctCount,
      destination: room.destination,
      safeRatio: difficulty.safeRatio,
      poisonRatio: difficulty.poisonRatio,
      avgSafeChoicesPerMove: difficulty.avgSafeChoicesPerMove,
      narrowPathIndicator: difficulty.narrowPathIndicator,
      safeClusterCount: difficulty.safeClusterCount,
      datasetVersion: "qmoji-concept-clusters-v1", // ConceptRepository, unsupervised clustering over emoji
      emojiMeta,
      startedAt: new Date(room.roundStartedAt),
      endedAt: null,
      durationMs: null,
      eats: [],
      correctEaten: 0,
      wrongEaten: 0,
      timeToFirstInput: null,
      timeToCorrectAnswer: null,
      eliminated: false,
      destinationReached: false,
      failureSequence: null,
      poisonEmojiTriggered: null,
      poisonTimestamp: null,
      nearbyInferredNotEaten: [],
    };
    player.matchLog.rounds.push(player.currentRoundEntry);
    i += 1;
  }
}

// "Negative Evidence": for each player, which correct emoji sat right next
// to a cell they actually visited but never ate. Finalizes each player's
// in-memory round entry (no DB write here -- that's the app layer's job,
// once per completed game, guarded by room.analyticsSaved); guarded so it
// never runs twice for the same round whether it ends naturally
// (advanceAfterDelay) or abruptly (eliminated mid-round, straight into
// endGame).
function finalizeCurrentRoundLogs(room) {
  if (!room.roundStartedAt || room.roundFinalizedFor === room.round) return;
  room.roundFinalizedFor = room.round;

  const roundStart = room.roundStartedAt;
  const cols = config.GRID_COLS;
  const repo = getEmojiRepository(room.language);
  const correctCells = room.grid.filter((c) => repo.isMatch(c.symbol, room.keyword));

  for (const id of room.playerOrder) {
    const player = room.players[id];
    if (!player) continue;
    const entry = player.currentRoundEntry;
    if (!entry || entry.roundNumber !== room.round) continue;

    let correctEaten = 0;
    let wrongEaten = 0;
    for (const key of player.eaten) {
      const [col, row] = key.split(",").map(Number);
      const cell = room.grid[row * cols + col];
      if (cell && repo.isMatch(cell.symbol, room.keyword)) correctEaten += 1;
      else wrongEaten += 1;
    }

    const nearbyInferredNotEaten = correctCells
      .filter((c) => !player.eaten.includes(`${c.col},${c.row}`))
      .filter((c) => NEIGHBOR_OFFSETS.some(([dc, dr]) => player.eaten.includes(`${c.col + dc},${c.row + dr}`)))
      .map((c) => ({ symbol: c.symbol, col: c.col, row: c.row }));

    const endedAt = Date.now();
    entry.endedAt = new Date(endedAt);
    entry.durationMs = endedAt - roundStart;
    entry.correctEaten = correctEaten;
    entry.wrongEaten = wrongEaten;
    entry.timeToFirstInput = player.firstInputAt !== null ? player.firstInputAt - roundStart : null;
    entry.timeToCorrectAnswer = player.firstCorrectAt !== null ? player.firstCorrectAt - roundStart : null;
    entry.eliminated = player.eliminated;
    entry.destinationReached = player.destinationReached;
    entry.failureSequence = player.eliminated ? player.eatOrder : null;
    entry.nearbyInferredNotEaten = nearbyInferredNotEaten;

    // Elimination stops the player from moving again (see move()), so the
    // last logged munch is always exactly the poison emoji that ended them.
    if (player.eliminated) {
      const lastEat = entry.eats[entry.eats.length - 1];
      if (lastEat && !lastEat.correct) {
        entry.poisonEmojiTriggered = lastEat.emoji;
        entry.poisonTimestamp = lastEat.timestamp;
      }
    }
  }
}

function endGame(room) {
  finalizeCurrentRoundLogs(room);
  room.status = "gameOver";
  room.roundEndsAt = null;
  room.nextRoundAt = null;
  room.gameEndedAt = Date.now();
}

// ---- time-driven state resolution ----
//
// Round timeouts and stale disconnects used to be resolved by live
// setTimeout handles kept in the old GameRoom instance's memory -- those
// can't survive across serverless invocations, so every room load instead
// "catches up" any state that should have already changed by wall-clock
// time. Mutates `room` in place; returns true if anything changed, so the
// caller (LobbyManager's loadRoom()) knows whether to persist it.
function applyLazyStateUpdates(room) {
  let changed = false;
  const now = Date.now();

  if (room.status === "playing" && room.roundEndsAt && now >= room.roundEndsAt) {
    penalizeTimedOutPlayers(room);
    if (activePlayers(room).length === 0 && room.playerOrder.length > 0) {
      endGame(room);
    } else {
      advanceAfterDelay(room);
    }
    changed = true;
  } else if (room.status === "roundEnd" && room.nextRoundAt && now >= room.nextRoundAt) {
    nextRound(room);
    changed = true;
  }

  for (const id of room.playerOrder) {
    const player = room.players[id];
    if (player && player.connected && now - (player.lastSeenAt || 0) > HEARTBEAT_TIMEOUT_MS) {
      player.connected = false;
      player.disconnectedAt = now;
      changed = true;
    }
  }

  const stale = room.playerOrder.filter((id) => {
    const player = room.players[id];
    return player && !player.connected && player.disconnectedAt && now - player.disconnectedAt > DISCONNECT_GRACE_MS;
  });
  if (stale.length) {
    for (const id of stale) delete room.players[id];
    room.playerOrder = room.playerOrder.filter((id) => !stale.includes(id));
    changed = true;
  }

  return changed;
}

// ---- payload shaping (never leak which cells are correct) ----

function publicPlayers(room) {
  return room.playerOrder
    .map((id) => {
      const p = room.players[id];
      if (!p) return null;
      return {
        playerId: id,
        username: p.username,
        score: p.score,
        lives: p.lives,
        muncherCol: p.muncherCol,
        muncherRow: p.muncherRow,
        eatenCells: p.eaten,
        roundDone: p.roundDone,
        eliminated: p.eliminated,
        connected: p.connected,
      };
    })
    .filter(Boolean);
}

function publicSharedEaten(room) {
  return Object.entries(room.eatenCells).map(([k, v]) => {
    const [col, row] = k.split(",").map(Number);
    return { col, row, by: v.by, correct: v.correct };
  });
}

// Single envelope covering every screen (playing, roundEnd, gameOver) --
// polling always returns "the current full state" rather than several
// differently-shaped event payloads.
function toClientView(room) {
  return {
    code: room.code,
    version: room.version,
    status: room.status,
    round: room.round,
    totalRounds: config.ROUND_COUNT,
    keyword: room.keyword,
    keywordLabel: room.keywordLabel,
    grid: room.grid.map((c) => ({ col: c.col, row: c.row, symbol: c.symbol })),
    destination: room.destination,
    cols: config.GRID_COLS,
    rows: config.GRID_ROWS,
    timeLimitMs: config.ROUND_TIME_MS,
    startingLives: config.STARTING_LIVES,
    roundEndsAt: room.roundEndsAt,
    nextRoundAt: room.nextRoundAt,
    players: publicPlayers(room),
    sharedEaten: publicSharedEaten(room),
  };
}

module.exports = {
  createRoom,
  isEmpty,
  addPlayer,
  removePlayer,
  heartbeat,
  beginGame,
  move,
  applyLazyStateUpdates,
  toClientView,
};
