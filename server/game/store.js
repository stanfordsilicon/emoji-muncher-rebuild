"use strict";

// Storage abstraction for room state — the game/room equivalent of
// ScoreRepository.js and AnalyticsRepository.js, kept in server/game rather
// than server/data since it's live match state, not persisted analytics.
//
// Everything the game touches goes through this instead of a raw Map, and
// every room/player is a plain JSON-serializable object (no class
// instances, no Map/Set fields, no live timer handles) — that's what makes
// both backends below interchangeable, and what makes a room safe to
// persist to Mongo and reload in a completely different process/invocation.
//
// Locally (DATA_BACKEND=memory, the default) rooms live in an in-memory Map,
// same as always -- zero setup needed to run the game. On a serverless host
// like Vercel, every request can land on a different, isolated instance
// with its own empty Map, so DATA_BACKEND=mongo is required there: room
// state has to live somewhere shared, reusing the same connection already
// used for score/analytics data.

const { DATA_BACKEND } = require("../data");
const { getMongoDb } = require("../data/mongoClient");

class InMemoryRoomStore {
  constructor() {
    this._rooms = new Map();
  }

  async getRoom(code) {
    return this._rooms.get(code) || null;
  }

  async saveRoom(room) {
    room.version = (room.version || 0) + 1;
    this._rooms.set(room.code, room);
    return room;
  }

  async deleteRoom(code) {
    this._rooms.delete(code);
  }
}

class MongoRoomStore {
  async _col() {
    const db = await getMongoDb();
    const col = db.collection("rooms");
    if (!MongoRoomStore._indexed) {
      MongoRoomStore._indexed = true;
      // Best-effort, fire-and-forget: abandoned rooms self-clean after a
      // day of no activity rather than accumulating forever. A no-op if
      // this index already exists.
      col.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 86400 }).catch((e) =>
        console.error("[rooms] Index creation failed:", e.message)
      );
    }
    return col;
  }

  async getRoom(code) {
    const col = await this._col();
    const doc = await col.findOne({ _id: code });
    if (!doc) return null;
    const { _id, updatedAt, ...room } = doc;
    return room;
  }

  async saveRoom(room) {
    room.version = (room.version || 0) + 1;
    const col = await this._col();
    await col.updateOne({ _id: room.code }, { $set: { ...room, updatedAt: new Date() } }, { upsert: true });
    return room;
  }

  async deleteRoom(code) {
    const col = await this._col();
    await col.deleteOne({ _id: code });
  }
}

function createRoomStore({ backend = DATA_BACKEND } = {}) {
  switch (backend) {
    case "memory":
      return new InMemoryRoomStore();
    case "mongo":
      return new MongoRoomStore();
    default:
      throw new Error(`Unknown room store backend: ${backend}`);
  }
}

module.exports = { createRoomStore, InMemoryRoomStore, MongoRoomStore };
