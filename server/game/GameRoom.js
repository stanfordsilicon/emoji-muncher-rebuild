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
 */
class GameRoom {
  constructor(code, { config, emojiRepository, scoreRepository, emitToRoom }) {
    this.code = code;
    this.config = config;
    this.emojiRepository = emojiRepository;
    this.scoreRepository = scoreRepository;
    this.emitToRoom = emitToRoom; // (event, payload) => void, scoped to this room

    this.players = new Map(); // socketId -> player state
    this.hostSocketId = null;
    this.status = "lobby"; // lobby | playing | gameOver
    this.round = 0;
    this.keyword = null;
    this.grid = [];
    this.correctCount = 0;
    this.roundTimer = null;
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
      eliminated: false,
      connected: true,
      lastMoveAt: 0,
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
    for (const player of this.players.values()) {
      player.score = 0;
      player.lives = this.config.STARTING_LIVES;
      player.eliminated = false;
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
    for (const player of this.players.values()) {
      player.score = 0;
      player.lives = this.config.STARTING_LIVES;
      player.eliminated = false;
      player.roundDone = false;
      player.eaten = new Set();
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

    player.eaten.add(key);
    const correct = this.emojiRepository.isMatch(cell.symbol, this.keyword);
    if (correct) {
      player.score += this.config.POINTS_PER_CORRECT;
      player.correctRemaining -= 1;
      if (player.correctRemaining <= 0) player.roundDone = true;
    } else {
      player.lives -= 1;
      if (player.lives <= 0) player.eliminated = true;
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
    this.emitToRoom("round_end", { round: this.round, players: this._publicPlayers() });
    setTimeout(() => this._nextRound(), 1200);
  }

  _nextRound() {
    this._clearTimer();
    this.round += 1;
    if (this.round > this.config.ROUND_COUNT || this._activePlayers().length === 0) {
      this._endGame();
      return;
    }

    const { keyword, grid, correctCount } = generateRound(this.emojiRepository, {
      cols: this.config.GRID_COLS,
      rows: this.config.GRID_ROWS,
      minMatches: this.config.MIN_MATCHES_PER_KEYWORD,
      maxMatches: this.config.MAX_MATCHES_PER_KEYWORD,
    });
    this.keyword = keyword;
    this.grid = grid;
    this.correctCount = correctCount;

    let i = 0;
    for (const player of this.players.values()) {
      if (player.eliminated) continue;
      const [sc, sr] = CORNERS[i % CORNERS.length](this.config.GRID_COLS, this.config.GRID_ROWS);
      player.muncherCol = sc;
      player.muncherRow = sr;
      player.eaten = new Set();
      player.correctRemaining = correctCount;
      player.roundDone = false;
      i += 1;
    }

    this.emitToRoom("round_start", this._publicRoundPayload());
    this.roundTimer = setTimeout(() => {
      this._advanceAfterDelay();
    }, this.config.ROUND_TIME_MS);
  }

  _endGame() {
    this._clearTimer();
    this.status = "gameOver";
    for (const player of this.players.values()) {
      this.scoreRepository.recordMatchResult(player.username, player.score);
    }
    this.emitToRoom("game_over", {
      players: this._publicPlayers(),
      leaderboard: this.scoreRepository.getLeaderboard(10),
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
      cols: this.config.GRID_COLS,
      rows: this.config.GRID_ROWS,
      timeLimitMs: this.config.ROUND_TIME_MS,
      startingLives: this.config.STARTING_LIVES,
      players: this._publicPlayers(),
    };
  }
}

module.exports = { GameRoom };
