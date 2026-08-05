"use strict";

const { getMongoDb } = require("./mongoClient");

/**
 * Repository interface for the QMoji analytics data points (see the
 * "Emoji Munchers" + "Global" rows of the data-capture-targets sheet).
 *
 * One call per player per completed match: `recordGameSession(doc)`.
 * GameRoom accumulates everything that happened for a player (every round,
 * every munch, every difficulty stat) in memory as the match plays out, then
 * flushes one complete document at game-over -- mirroring the shape used by
 * the other QMoji mini-games (e.g. oddoneout_data.gamesessions), so all of
 * them can be queried the same way: one row per player per session, with
 * that player's rounds nested inside.
 *
 *   recordGameSession(doc) -> Promise<void>
 *
 * Must be safe to fire-and-forget: analytics failures can never break
 * gameplay, so the Mongo implementation swallows its own errors (logged,
 * not thrown) instead of propagating them into GameRoom.
 */
class InMemoryAnalyticsRepository {
  // No MONGODB_URI configured yet -- analytics are simply not collected.
  async recordGameSession() {}
}

class MongoAnalyticsRepository {
  async recordGameSession(doc) {
    try {
      const db = await getMongoDb();
      await db.collection("gamesessions").insertOne(doc);
    } catch (err) {
      console.error("[analytics] failed to write gamesessions:", err.message);
    }
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
