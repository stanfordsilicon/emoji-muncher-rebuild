"use strict";

const { generateRound } = require("./gridGenerator");

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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * One multiplayer match. All players in a room see the identical keyword
 * and grid layout each round, but every player munches through their own
 * copy independently: separate muncher position, separate eaten-cell set,
 * separate score/lives. The server is authoritative for movement and for
 * correctness (checked against emojiRepository) so a client can never
 * fake a correct answer.
 *
 * It also accumulates the QMoji analytics data points for each player as
 * the match plays out (player.matchLog), then flushes one complete
 * "gamesessions" document per player at game-over via analyticsRepository
 * -- matching the one-document-per-player-per-match shape used by the other
 * QMoji mini-games, rather than writing many small documents as events
 * happen. That flush is fire-and-forget: the repository swallows its own
 * errors, so a slow or unreachable database can never affect gameplay.
 */
class GameRoom {
  constructor(code, { config, emojiRepository, scoreRepository, analyticsRepository, emitToRoom }) {
    this.code = code;
    this.config = config;
    this.emojiRepository = emojiRepository;
    this.scoreRepository = scoreRepository;
    this.analyticsRepository = analyticsRepository;
    this.emitToRoom = emitToRoom; // (event, payload) => void, scoped to this room

    this.players = new Map(); // socketId -> player state
    this.hostSocketId = null;
    this.status = "lobby"; // lobby | playing | gameOver
    this.round = 0;
    this.keyword = null;
    this.grid = [];
    this.correctCount = 0;
    this.destination = null;
    this.roundTimer = null;

    this.gameStartedAt = null;
    this.roundStartedAt = null;
    this._roundFinalizedFor = -1; // round number already finalized, guards double-finalization
  }

  // ---- lobby ----

  addPlayer(socketId, username) {
    if (this.status !== "lobby") {
      throw new Error("Game already in progress");
    }
    this.players.set(socketId, {
      username,
      score: 0,
      lives: this.config.STARTING_LIVES,
      muncherCol: 0,
      muncherRow: 0,
      eaten: new Set(),
      correctRemaining: 0,
      roundDone: false,
      destinationReached: false,
      eliminated: false,
      connected: true,
      lastMoveAt: 0,
      // analytics bookkeeping, reset every match/round below
      eatOrder: 0,
      lastActionAt: 0,
      firstInputAt: null,
      firstCorrectAt: null,
      currentRoundEntry: null,
      matchLog: { rounds: [] },
    });
    if (!this.hostSocketId) this.hostSocketId = socketId;
    this.scoreRepository.upsertPlayer(username);
  }

  removePlayer(socketId) {
    const wasPresent = this.players.delete(socketId);
    if (this.hostSocketId === socketId) {
      this.hostSocketId = this.players.keys().next().value || null;
    }
    // A departing player might have been the last one an in-progress round
    // was waiting on, so re-check whether the round/match can now advance.
    if (wasPresent && this.status === "playing") {
      this._maybeAdvanceRound();
    }
  }

  isEmpty() {
    return this.players.size === 0;
  }

  // ---- game lifecycle ----

  startGame(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId) throw new Error("Only the host can start the game");
    if (this.players.size === 0) throw new Error("Need at least one player");
    this.status = "playing";
    this.round = 0;
    this.gameStartedAt = new Date();
    this._roundFinalizedFor = -1;
    for (const player of this.players.values()) {
      player.score = 0;
      player.lives = this.config.STARTING_LIVES;
      player.eliminated = false;
      player.matchLog = { rounds: [] };
    }
    this._nextRound();
  }

  restartGame(requestingSocketId) {
    if (requestingSocketId !== this.hostSocketId) throw new Error("Only the host can restart the game");
    this._clearTimer();
    this.status = "lobby";
    this.round = 0;
    this.keyword = null;
    this.grid = [];
    this.destination = null;
    this.gameStartedAt = null;
    this.roundStartedAt = null;
    this._roundFinalizedFor = -1;
    for (const player of this.players.values()) {
      player.score = 0;
      player.lives = this.config.STARTING_LIVES;
      player.eliminated = false;
      player.roundDone = false;
      player.destinationReached = false;
      player.eaten = new Set();
      player.eatOrder = 0;
      player.lastActionAt = 0;
      player.firstInputAt = null;
      player.firstCorrectAt = null;
      player.currentRoundEntry = null;
      player.matchLog = { rounds: [] };
    }
  }

  move(socketId, dir) {
    if (this.status !== "playing") return;
    const player = this.players.get(socketId);
    if (!player || player.eliminated) return;
    const delta = DIRS[dir];
    if (!delta) return;

    // Paced movement: ignore moves faster than MOVE_COOLDOWN_MS so munching
    // never feels like a frantic keyboard-mash race.
    const now = Date.now();
    if (now - player.lastMoveAt < this.config.MOVE_COOLDOWN_MS) return;
    player.lastMoveAt = now;

    player.muncherCol = clamp(player.muncherCol + delta[0], 0, this.config.GRID_COLS - 1);
    player.muncherRow = clamp(player.muncherRow + delta[1], 0, this.config.GRID_ROWS - 1);
    this._resolveMunch(player);

    this.emitToRoom("state_update", { players: this._publicPlayers() });
    this._maybeAdvanceRound();
  }

  // ---- internals ----

  _resolveMunch(player) {
    const key = `${player.muncherCol},${player.muncherRow}`;
    if (player.eaten.has(key)) return; // already eaten by this player, nothing there anymore
    const cell = this.grid[player.muncherRow * this.config.GRID_COLS + player.muncherCol];
    if (!cell) return;

    const now = Date.now();
    const decisionTimeMs = now - (player.lastActionAt || now);
    const isFirstInput = player.firstInputAt === null;
    if (isFirstInput) player.firstInputAt = now;
    player.lastActionAt = now;

    player.eaten.add(key);
    const correct = this.emojiRepository.isMatch(cell.symbol, this.keyword);
    player.eatOrder += 1;

    if (correct) {
      player.score += this.config.POINTS_PER_CORRECT;
      player.correctRemaining -= 1;
      if (this.destination && cell.col === this.destination.col && cell.row === this.destination.row) {
        player.destinationReached = true;
        player.roundDone = true;
      }
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

  _activePlayers() {
    return [...this.players.values()].filter((p) => p.connected && !p.eliminated);
  }

  _maybeAdvanceRound() {
    const active = this._activePlayers();
    const allEliminated = this._activePlayers().length === 0 && this.players.size > 0;
    if (allEliminated) {
      this._endGame();
      return;
    }
    if (active.length > 0 && active.every((p) => p.roundDone)) {
      this._clearTimer();
      this._advanceAfterDelay();
    }
  }

  _advanceAfterDelay() {
    this._finalizeCurrentRoundLogs();
    // nextRoundInMs lets the client freeze its timer bar and render an
    // actual "next round in..." countdown instead of just guessing when
    // _nextRound() will fire.
    this.emitToRoom("round_end", {
      round: this.round,
      players: this._publicPlayers(),
      nextRoundInMs: this.config.NEXT_ROUND_PAUSE_MS,
    });
    setTimeout(() => this._nextRound(), this.config.NEXT_ROUND_PAUSE_MS);
  }

  _nextRound() {
    this._clearTimer();
    this.round += 1;
    if (this.round > this.config.ROUND_COUNT || this._activePlayers().length === 0) {
      this._endGame();
      return;
    }

    const { keyword, grid, correctCount, difficulty, destination } = generateRound(this.emojiRepository, {
      cols: this.config.GRID_COLS,
      rows: this.config.GRID_ROWS,
      minMatches: this.config.MIN_MATCHES_PER_KEYWORD,
      pathsPerCorner: this.config.PATHS_PER_CORNER,
    });
    this.keyword = keyword;
    this.grid = grid;
    this.correctCount = correctCount;
    this.destination = destination ? { col: destination.col, row: destination.row } : null;
    this.roundStartedAt = new Date();

    const emojiMeta = this._emojiMetaForGrid(grid, keyword);

    let i = 0;
    for (const player of this.players.values()) {
      if (player.eliminated) continue;
      const [sc, sr] = CORNERS[i % CORNERS.length](this.config.GRID_COLS, this.config.GRID_ROWS);
      player.muncherCol = sc;
      player.muncherRow = sr;
      player.eaten = new Set();
      player.correctRemaining = correctCount;
      player.roundDone = false;
      player.destinationReached = false;
      player.eatOrder = 0;
      player.lastActionAt = this.roundStartedAt.getTime();
      player.firstInputAt = null;
      player.firstCorrectAt = null;

      player.currentRoundEntry = {
        roundNumber: this.round,
        keyword,
        board: grid.map((c) => ({ col: c.col, row: c.row, symbol: c.symbol })),
        totalCells: this.config.GRID_COLS * this.config.GRID_ROWS,
        correctCount,
        destination: this.destination,
        safeRatio: difficulty.safeRatio,
        poisonRatio: difficulty.poisonRatio,
        avgSafeChoicesPerMove: difficulty.avgSafeChoicesPerMove,
        narrowPathIndicator: difficulty.narrowPathIndicator,
        safeClusterCount: difficulty.safeClusterCount,
        pathRepairs: difficulty.pathRepairs,
        datasetVersion: "qmoji-csv-v1", // no inference/poison-selection model yet; static curated dataset
        emojiMeta,
        startedAt: this.roundStartedAt,
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

    this.emitToRoom("round_start", this._publicRoundPayload());
    this.roundTimer = setTimeout(() => {
      this._advanceAfterDelay();
    }, this.config.ROUND_TIME_MS);
  }

  // "Negative Evidence": for each player, which correct emoji sat right next
  // to a cell they actually visited but never ate. Finalizes each player's
  // in-memory round entry (no DB write here -- that happens once, in bulk,
  // at game-over); guarded so it never runs twice for the same round
  // whether it ends naturally (_advanceAfterDelay) or abruptly (everyone
  // eliminated mid-round, straight into _endGame).
  _finalizeCurrentRoundLogs() {
    if (!this.roundStartedAt || this._roundFinalizedFor === this.round) return;
    this._roundFinalizedFor = this.round;

    const roundStart = this.roundStartedAt.getTime();
    const cols = this.config.GRID_COLS;
    const correctCells = this.grid.filter((c) => this.emojiRepository.isMatch(c.symbol, this.keyword));

    for (const player of this.players.values()) {
      const entry = player.currentRoundEntry;
      if (!entry || entry.roundNumber !== this.round) continue;

      let correctEaten = 0;
      let wrongEaten = 0;
      for (const key of player.eaten) {
        const [col, row] = key.split(",").map(Number);
        const cell = this.grid[row * cols + col];
        if (cell && this.emojiRepository.isMatch(cell.symbol, this.keyword)) correctEaten += 1;
        else wrongEaten += 1;
      }

      const nearbyInferredNotEaten = correctCells
        .filter((c) => !player.eaten.has(`${c.col},${c.row}`))
        .filter((c) => NEIGHBOR_OFFSETS.some(([dc, dr]) => player.eaten.has(`${c.col + dc},${c.row + dr}`)))
        .map((c) => ({ symbol: c.symbol, col: c.col, row: c.row }));

      const endedAt = new Date();
      entry.endedAt = endedAt;
      entry.durationMs = endedAt.getTime() - roundStart;
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

  _emojiMetaForGrid(grid, keyword) {
    const seen = new Map();
    for (const cell of grid) {
      if (!seen.has(cell.symbol)) {
        seen.set(cell.symbol, {
          symbol: cell.symbol,
          // Every keyword-emoji pair in the current dataset came directly
          // from the user-submitted CSV, so there is no "inferred" layer
          // yet -- this flag is a placeholder for when/if one is added.
          confirmedOrInferred: "confirmed",
          poisonStatus: this.emojiRepository.isMatch(cell.symbol, keyword) ? "safe" : "poison",
        });
      }
    }
    return [...seen.values()];
  }

  async _endGame() {
    this._clearTimer();
    this._finalizeCurrentRoundLogs();
    this.status = "gameOver";

    const gameEndedAt = new Date();
    const totalDurationMs = this.gameStartedAt ? gameEndedAt.getTime() - this.gameStartedAt.getTime() : null;
    const allUsernames = [...this.players.values()].map((p) => p.username);

    for (const player of this.players.values()) {
      await this.scoreRepository.recordMatchResult(player.username, player.score);

      this.analyticsRepository.recordGameSession({
        username: player.username,
        roomCode: this.code,
        game: "Emoji Munchers",
        language: "en", // only language currently playable; revisit once localized
        gameStartedAt: this.gameStartedAt,
        gameEndedAt,
        totalDurationMs,
        rounds: player.matchLog.rounds,
        finalScore: player.score,
        finalLives: player.lives,
        eliminated: player.eliminated,
        otherPlayers: allUsernames.filter((u) => u !== player.username),
      });
    }

    const leaderboard = await this.scoreRepository.getLeaderboard(10);
    this.emitToRoom("game_over", {
      players: this._publicPlayers(),
      leaderboard,
    });
  }

  _clearTimer() {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }

  // ---- payload shaping (never leak which cells are correct) ----

  _publicPlayers() {
    return [...this.players.entries()].map(([socketId, p]) => ({
      socketId,
      username: p.username,
      score: p.score,
      lives: p.lives,
      muncherCol: p.muncherCol,
      muncherRow: p.muncherRow,
      eatenCells: [...p.eaten],
      roundDone: p.roundDone,
      eliminated: p.eliminated,
      connected: p.connected,
      isHost: socketId === this.hostSocketId,
    }));
  }

  getPlayersSnapshot() {
    return this._publicPlayers();
  }

  toLobbyPayload() {
    return {
      code: this.code,
      status: this.status,
      hostSocketId: this.hostSocketId,
      players: [...this.players.entries()].map(([socketId, p]) => ({
        socketId,
        username: p.username,
        connected: p.connected,
        isHost: socketId === this.hostSocketId,
      })),
    };
  }

  _publicRoundPayload() {
    return {
      round: this.round,
      totalRounds: this.config.ROUND_COUNT,
      keyword: this.keyword,
      grid: this.grid.map((c) => ({ col: c.col, row: c.row, symbol: c.symbol })),
      destination: this.destination,
      cols: this.config.GRID_COLS,
      rows: this.config.GRID_ROWS,
      timeLimitMs: this.config.ROUND_TIME_MS,
      startingLives: this.config.STARTING_LIVES,
      players: this._publicPlayers(),
    };
  }
}

module.exports = { GameRoom };
