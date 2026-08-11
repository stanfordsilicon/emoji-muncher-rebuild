"use strict";

const { getMongoDb } = require("./mongoClient");

// Never let a passwordHash leak into a leaderboard row or stats response --
// callers outside this file should never see it.
function stripPasswordHash(doc) {
  if (!doc) return doc;
  const { passwordHash, ...rest } = doc;
  return rest;
}

/**
 * Repository interface for player/score/account persistence. Every method
 * is async (even the in-memory one) so GameRoom/server.js can `await` it
 * regardless of which backend is live.
 *
 *   upsertPlayer(username)                  -> Promise<void>
 *   recordMatchResult(username, score)      -> Promise<void>
 *   getLeaderboard(limit)                   -> Promise<[{ username, bestScore, totalScore, gamesPlayed, lastPlayedAt }]>
 *   getPlayerStats(username)                -> Promise<same shape as one leaderboard row, or null>
 *
 *   hasAccount(username)                    -> Promise<boolean> (username is claimed with a password)
 *   createAccount(username, passwordHash)   -> Promise<void> (throws { code: "USERNAME_TAKEN" } if already claimed)
 *   getPasswordHash(username)               -> Promise<string|null>
 *
 * Password hashing itself (bcrypt) lives in server.js, not here -- this
 * layer only stores/retrieves whatever hash it's given, same as it has no
 * opinion on how scores are computed.
 */
class InMemoryScoreRepository {
  constructor() {
    this._players = new Map(); // username -> stats + passwordHash
  }

  async upsertPlayer(username) {
    if (!this._players.has(username)) {
      this._players.set(username, {
        username,
        bestScore: 0,
        totalScore: 0,
        gamesPlayed: 0,
        lastPlayedAt: null,
        passwordHash: null,
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
      .slice(0, limit)
      .map(stripPasswordHash);
  }

  async getPlayerStats(username) {
    return stripPasswordHash(this._players.get(username)) || null;
  }

  async hasAccount(username) {
    const p = this._players.get(username);
    return !!(p && p.passwordHash);
  }

  async createAccount(username, passwordHash) {
    await this.upsertPlayer(username);
    const p = this._players.get(username);
    if (p.passwordHash) {
      const err = new Error("That username is already taken.");
      err.code = "USERNAME_TAKEN";
      throw err;
    }
    p.passwordHash = passwordHash;
  }

  async getPasswordHash(username) {
    const p = this._players.get(username);
    return p ? p.passwordHash : null;
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
        { $setOnInsert: { username, bestScore: 0, totalScore: 0, gamesPlayed: 0, lastPlayedAt: null, passwordHash: null } },
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
      const rows = await col.find({}, { projection: { _id: 0 } }).sort({ bestScore: -1 }).limit(limit).toArray();
      return rows.map(stripPasswordHash);
    } catch (err) {
      console.error("[score] getLeaderboard failed:", err.message);
      return [];
    }
  }

  async getPlayerStats(username) {
    try {
      const col = await this._col();
      const doc = await col.findOne({ username }, { projection: { _id: 0 } });
      return stripPasswordHash(doc) || null;
    } catch (err) {
      console.error("[score] getPlayerStats failed:", err.message);
      return null;
    }
  }

  // Fails closed (returns false/null) on a DB error rather than throwing --
  // an auth check that can't reach the database should never be treated as
  // "no account exists" leading to an accidental bypass, and the caller
  // (server.js) already turns a false/null result into a generic "invalid
  // credentials" response either way.
  async hasAccount(username) {
    try {
      const col = await this._col();
      const doc = await col.findOne({ username }, { projection: { passwordHash: 1 } });
      return !!(doc && doc.passwordHash);
    } catch (err) {
      console.error("[score] hasAccount failed:", err.message);
      return false;
    }
  }

  async createAccount(username, passwordHash) {
    const col = await this._col();
    const existing = await col.findOne({ username }, { projection: { passwordHash: 1 } });
    if (existing && existing.passwordHash) {
      const err = new Error("That username is already taken.");
      err.code = "USERNAME_TAKEN";
      throw err;
    }
    await col.updateOne(
      { username },
      {
        $set: { passwordHash },
        $setOnInsert: { username, bestScore: 0, totalScore: 0, gamesPlayed: 0, lastPlayedAt: null },
      },
      { upsert: true }
    );
  }

  async getPasswordHash(username) {
    try {
      const col = await this._col();
      const doc = await col.findOne({ username }, { projection: { passwordHash: 1 } });
      return doc ? doc.passwordHash || null : null;
    } catch (err) {
      console.error("[score] getPasswordHash failed:", err.message);
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
