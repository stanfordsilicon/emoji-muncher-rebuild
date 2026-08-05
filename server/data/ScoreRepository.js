"use strict";

const { getMongoDb } = require("./mongoClient");

/**
 * Repository interface for player/score persistence. Every method is async
 * (even the in-memory one) so GameRoom can `await` it regardless of which
 * backend is live.
 *
 *   upsertPlayer(username)                  -> Promise<void>
 *   recordMatchResult(username, score)      -> Promise<void>
 *   getLeaderboard(limit)                   -> Promise<[{ username, bestScore, totalScore, gamesPlayed, lastPlayedAt }]>
 *   getPlayerStats(username)                -> Promise<same shape as one leaderboard row, or null>
 */
class InMemoryScoreRepository {
  constructor() {
    this._players = new Map(); // username -> stats
  }

  async upsertPlayer(username) {
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

  async recordMatchResult(username, score) {
    await this.upsertPlayer(username);
    const stats = this._players.get(username);
    stats.totalScore += score;
    stats.bestScore = Math.max(stats.bestScore, score);
    stats.gamesPlayed += 1;
    stats.lastPlayedAt = new Date().toISOString();
  }

  async getLeaderboard(limit = 20) {
    return [...this._players.values()]
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, limit);
  }

  async getPlayerStats(username) {
    return this._players.get(username) || null;
  }
}

class MongoScoreRepository {
  async _col() {
    const db = await getMongoDb();
    return db.collection("players");
  }

  async upsertPlayer(username) {
    try {
      const col = await this._col();
      await col.updateOne(
        { username },
        { $setOnInsert: { username, bestScore: 0, totalScore: 0, gamesPlayed: 0, lastPlayedAt: null } },
        { upsert: true }
      );
    } catch (err) {
      console.error("[score] upsertPlayer failed:", err.message);
    }
  }

  async recordMatchResult(username, score) {
    try {
      const col = await this._col();
      await col.updateOne(
        { username },
        {
          $setOnInsert: { username },
          $inc: { totalScore: score, gamesPlayed: 1 },
          $max: { bestScore: score },
          $set: { lastPlayedAt: new Date().toISOString() },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error("[score] recordMatchResult failed:", err.message);
    }
  }

  async getLeaderboard(limit = 20) {
    try {
      const col = await this._col();
      return await col.find({}, { projection: { _id: 0 } }).sort({ bestScore: -1 }).limit(limit).toArray();
    } catch (err) {
      console.error("[score] getLeaderboard failed:", err.message);
      return [];
    }
  }

  async getPlayerStats(username) {
    try {
      const col = await this._col();
      return await col.findOne({ username }, { projection: { _id: 0 } });
    } catch (err) {
      console.error("[score] getPlayerStats failed:", err.message);
      return null;
    }
  }
}

function createScoreRepository({ backend = "memory" } = {}) {
  switch (backend) {
    case "memory":
      return new InMemoryScoreRepository();
    case "mongo":
      return new MongoScoreRepository();
    default:
      throw new Error(`Unknown score repository backend: ${backend}`);
  }
}

module.exports = { createScoreRepository, InMemoryScoreRepository, MongoScoreRepository };
