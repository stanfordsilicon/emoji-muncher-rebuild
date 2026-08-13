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
//
// saveRoom(room, expectedVersion) is optimistic-concurrency-aware: pass the
// version the room was at when you read it, and the save only succeeds if
// nothing else has saved a newer version since -- returning null instead of
// silently overwriting a concurrent change. This is what actually protects
// against two requests for the *same* room (e.g. two /api/move calls fired
// less than one round-trip apart) racing each other -- an in-process lock
// can't do that on Vercel, where the two requests can land on two entirely
// different serverless instances that know nothing about each other. Pass
// no expectedVersion for an unconditional save (new rooms only).

const { DATA_BACKEND } = require("../data");
const { getMongoDb } = require("../data/mongoClient");

class InMemoryRoomStore {
  constructor() {
    this._rooms = new Map();
  }

  async getRoom(code) {
    return this._rooms.get(code) || null;
  }

  async saveRoom(room, expectedVersion) {
    if (expectedVersion !== undefined) {
      const current = this._rooms.get(room.code);
      if (!current || current.version !== expectedVersion) return null;
    }
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

  async saveRoom(room, expectedVersion) {
    const col = await this._col();
    const newVersion = (room.version || 0) + 1;
    const filter = expectedVersion === undefined ? { _id: room.code } : { _id: room.code, version: expectedVersion };
    const result = await col.updateOne(
      filter,
      { $set: { ...room, version: newVersion, updatedAt: new Date() } },
      { upsert: expectedVersion === undefined }
    );
    if (expectedVersion !== undefined && result.matchedCount === 0) return null;
    room.version = newVersion;
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
