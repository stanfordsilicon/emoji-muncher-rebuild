"use strict";

/**
 * Repository interface for player/score persistence.
 *
 *   upsertPlayer(username)                  -> void
 *   recordMatchResult(username, score)      -> void
 *   getLeaderboard(limit)                   -> [{ username, bestScore, totalScore, gamesPlayed, lastPlayedAt }]
 *   getPlayerStats(username)                -> same shape as one leaderboard row, or null
 *
 * InMemoryScoreRepository below keeps everything in a Map and is lost on
 * restart. A future MongoScoreRepository would implement the same methods
 * against a `players` collection and could be swapped in from data/index.js
 * without touching GameRoom/LobbyManager.
 */
class InMemoryScoreRepository {
  constructor() {
    this._players = new Map(); // username -> stats
  }

  upsertPlayer(username) {
    if (!this._players.has(username)) {
      this._players.set(username, {
        username,
        bestScore: 0,
        totalScore: 0,
        gamesPlayed: 0,
        lastPlayedAt: null,
      });
    }
  }

  recordMatchResult(username, score) {
    this.upsertPlayer(username);
    const stats = this._players.get(username);
    stats.totalScore += score;
    stats.bestScore = Math.max(stats.bestScore, score);
    stats.gamesPlayed += 1;
    stats.lastPlayedAt = new Date().toISOString();
  }

  getLeaderboard(limit = 20) {
    return [...this._players.values()]
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, limit);
  }

  getPlayerStats(username) {
    return this._players.get(username) || null;
  }
}

function createScoreRepository({ backend = "memory" } = {}) {
  switch (backend) {
    case "memory":
      return new InMemoryScoreRepository();
    default:
      throw new Error(`Unknown score repository backend: ${backend}`);
  }
}

module.exports = { createScoreRepository, InMemoryScoreRepository };
