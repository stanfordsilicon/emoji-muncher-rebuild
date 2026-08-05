"use strict";

const { getMongoDb } = require("./mongoClient");

/**
 * Repository interface for the QMoji analytics data points (see the
 * "Emoji Munchers" + "Global" rows of the data-capture-targets sheet).
 * Append-only by design: raw per-action events go in `events`, with
 * `sessions` / `rounds` / `round_player_summaries` holding the
 * higher-level documents analysts actually query.
 *
 *   recordSessionStart(session)          -> sessionId
 *   recordSessionEnd(sessionId, patch)   -> void
 *   recordRound(round)                   -> void
 *   recordEvent(event)                   -> void
 *   recordRoundPlayerSummary(summary)    -> void
 *
 * All calls must be safe to fire-and-forget: analytics failures must never
 * break gameplay, so every method swallows its own errors (logged, not
 * thrown) instead of propagating them into GameRoom.
 */
class InMemoryAnalyticsRepository {
  // No MONGODB_URI configured yet -- analytics are simply not collected.
  // Every method is a deliberate no-op so the game runs identically with
  // or without a database attached.
  async recordSessionStart() {}
  async recordSessionEnd() {}
  async recordRound() {}
  async recordEvent() {}
  async recordRoundPlayerSummary() {}
}

class MongoAnalyticsRepository {
  async _col(name) {
    const db = await getMongoDb();
    return db.collection(name);
  }

  async _safeInsert(collectionName, doc) {
    try {
      const col = await this._col(collectionName);
      await col.insertOne(doc);
    } catch (err) {
      console.error(`[analytics] failed to write ${collectionName}:`, err.message);
    }
  }

  async recordSessionStart(session) {
    await this._safeInsert("sessions", session);
  }

  async recordSessionEnd(sessionId, patch) {
    try {
      const col = await this._col("sessions");
      await col.updateOne({ sessionId }, { $set: patch });
    } catch (err) {
      console.error("[analytics] failed to close session:", err.message);
    }
  }

  async recordRound(round) {
    await this._safeInsert("rounds", round);
  }

  async recordEvent(event) {
    await this._safeInsert("events", event);
  }

  async recordRoundPlayerSummary(summary) {
    await this._safeInsert("round_player_summaries", summary);
  }
}

function createAnalyticsRepository({ backend = "memory" } = {}) {
  switch (backend) {
    case "memory":
      return new InMemoryAnalyticsRepository();
    case "mongo":
      return new MongoAnalyticsRepository();
    default:
      throw new Error(`Unknown analytics repository backend: ${backend}`);
  }
}

module.exports = { createAnalyticsRepository, InMemoryAnalyticsRepository, MongoAnalyticsRepository };
