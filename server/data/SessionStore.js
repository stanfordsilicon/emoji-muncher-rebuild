"use strict";

const crypto = require("crypto");
const { getMongoDb } = require("./mongoClient");

/**
 * Auth session tokens: token -> username, with a TTL. Kept separate from
 * ScoreRepository (accounts/passwords) since a session is short-lived and
 * disposable, not part of a player's permanent record.
 *
 *   issue(username, ttlMs) -> Promise<token>
 *   resolve(token)         -> Promise<username|null>
 *   revoke(token)          -> Promise<void>
 */
class InMemorySessionStore {
  constructor() {
    this._sessions = new Map(); // token -> { username, expiresAt }
  }

  async issue(username, ttlMs) {
    const token = crypto.randomBytes(24).toString("hex");
    this._sessions.set(token, { username, expiresAt: Date.now() + ttlMs });
    return token;
  }

  async resolve(token) {
    const entry = this._sessions.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this._sessions.delete(token);
      return null;
    }
    return entry.username;
  }

  async revoke(token) {
    this._sessions.delete(token);
  }
}

class MongoSessionStore {
  async _col() {
    const db = await getMongoDb();
    const col = db.collection("sessions");
    if (!MongoSessionStore._indexed) {
      MongoSessionStore._indexed = true;
      // expireAfterSeconds: 0 on a Date field means "expire exactly at the
      // timestamp stored in that field" -- the standard Mongo TTL idiom for
      // an absolute expiry rather than a relative one.
      col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((e) =>
        console.error("[sessions] Index creation failed:", e.message)
      );
    }
    return col;
  }

  async issue(username, ttlMs) {
    const token = crypto.randomBytes(24).toString("hex");
    try {
      const col = await this._col();
      await col.insertOne({ _id: token, username, expiresAt: new Date(Date.now() + ttlMs) });
    } catch (err) {
      console.error("[sessions] issue failed:", err.message);
    }
    return token;
  }

  async resolve(token) {
    try {
      const col = await this._col();
      const doc = await col.findOne({ _id: token });
      if (!doc) return null;
      if (doc.expiresAt.getTime() < Date.now()) return null;
      return doc.username;
    } catch (err) {
      console.error("[sessions] resolve failed:", err.message);
      return null;
    }
  }

  async revoke(token) {
    try {
      const col = await this._col();
      await col.deleteOne({ _id: token });
    } catch (err) {
      console.error("[sessions] revoke failed:", err.message);
    }
  }
}

function createSessionStore({ backend = "memory" } = {}) {
  switch (backend) {
    case "memory":
      return new InMemorySessionStore();
    case "mongo":
      return new MongoSessionStore();
    default:
      throw new Error(`Unknown session store backend: ${backend}`);
  }
}

module.exports = { createSessionStore, InMemorySessionStore, MongoSessionStore };
