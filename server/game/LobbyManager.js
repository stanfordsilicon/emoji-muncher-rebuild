"use strict";

// Orchestrates the collection of rooms: generating/adopting room codes,
// loading a room (catching up its time-driven state first -- see
// GameRoom.applyLazyStateUpdates), and persisting it back after a mutation.
// GameRoom.js owns the actual game rules; this module owns nothing but
// routing a room code + player id to the right room and keeping it in
// server/game/store.js.
//
// There's no more socketId <-> room lookup here (the old socketToRoom map)
// -- every request just carries its own roomCode + playerId explicitly, the
// same way server/app.js's routes work.

const GameRoom = require("./GameRoom");
const { createRoomStore } = require("./store");
const config = require("../config");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

const store = createRoomStore();

function randomCode() {
  return Array.from({ length: config.ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
}

// Every function below reads a room through this instead of calling
// store.getRoom directly, so time-driven state (round timeouts, stale
// disconnects) is always caught up first. Returns null both when the room
// truly doesn't exist and when resolving staleness just emptied it out.
async function loadRoom(rawCode) {
  const code = String(rawCode || "").toUpperCase();
  const room = await store.getRoom(code);
  if (!room) return null;
  const changed = GameRoom.applyLazyStateUpdates(room);
  if (GameRoom.isEmpty(room)) {
    await store.deleteRoom(code);
    return null;
  }
  if (changed) await store.saveRoom(room);
  return room;
}

async function generateUniqueRoomCode() {
  let code;
  do {
    code = randomCode();
  } while (await loadRoom(code));
  return code;
}

// Creates the room and adds the host in one atomic step -- deliberately not
// split into "create the shell" then "join it" as two separate calls, since
// a room with zero players is otherwise indistinguishable from an abandoned
// one loadRoom() would clean up (see GameRoom.isEmpty()).
async function createRoom(playerId, username) {
  const code = await generateUniqueRoomCode();
  const room = GameRoom.createRoom(code);
  GameRoom.addPlayer(room, playerId, username);
  await store.saveRoom(room);
  return room;
}

// Adopts an externally-sourced code (the arcade party's room code) instead
// of generating a random one. Idempotent: if this game already has a room
// under that code -- e.g. two arcade players both landed here first and
// both tried to create it -- the existing room is joined instead of
// erroring, so there's still only ever one room per code.
async function createRoomWithCode(rawCode, playerId, username) {
  const code = String(rawCode || "").toUpperCase();
  if (!code) return createRoom(playerId, username);
  const existing = await loadRoom(code);
  if (existing) {
    GameRoom.addPlayer(existing, playerId, username);
    await store.saveRoom(existing);
    return existing;
  }
  const room = GameRoom.createRoom(code);
  GameRoom.addPlayer(room, playerId, username);
  await store.saveRoom(room);
  return room;
}

async function getRoom(code) {
  return loadRoom(code);
}

async function joinRoom(code, playerId, username) {
  const room = await loadRoom(code);
  if (!room) throw new Error("Room not found");
  GameRoom.addPlayer(room, playerId, username);
  await store.saveRoom(room);
  return room;
}

async function startGame(code, requesterId) {
  const room = await loadRoom(code);
  if (!room) throw new Error("Room not found");
  GameRoom.startGame(room, requesterId);
  await store.saveRoom(room);
  return room;
}

async function restartGame(code, requesterId) {
  const room = await loadRoom(code);
  if (!room) throw new Error("Room not found");
  GameRoom.restartGame(room, requesterId);
  await store.saveRoom(room);
  return room;
}

async function move(code, playerId, dir) {
  const room = await loadRoom(code);
  if (!room) return null;
  GameRoom.move(room, playerId, dir);
  await store.saveRoom(room);
  return room;
}

async function heartbeat(code, playerId) {
  const room = await loadRoom(code);
  if (!room) throw new Error("Room not found");
  GameRoom.heartbeat(room, playerId);
  await store.saveRoom(room);
  return room;
}

// Full removal -- used for an explicit "leave" (Go Home). A missed
// heartbeat instead just flips connected=false via applyLazyStateUpdates
// and keeps the seat warm until its grace period actually expires (also
// handled there).
async function leaveRoom(code, playerId) {
  const room = await loadRoom(code);
  if (!room) return null;
  GameRoom.removePlayer(room, playerId);
  if (GameRoom.isEmpty(room)) {
    await store.deleteRoom(room.code);
    return null;
  }
  await store.saveRoom(room);
  return room;
}

// Marks a finished room's analytics as already recorded, so a concurrent or
// repeated poll doesn't write duplicate score/analytics documents.
// Best-effort, like the rest of the analytics path -- server/app.js calls
// this right after actually writing them.
async function markAnalyticsSaved(code) {
  const room = await store.getRoom(String(code || "").toUpperCase());
  if (!room) return;
  room.analyticsSaved = true;
  await store.saveRoom(room);
}

module.exports = {
  createRoom,
  createRoomWithCode,
  getRoom,
  joinRoom,
  startGame,
  restartGame,
  move,
  heartbeat,
  leaveRoom,
  markAnalyticsSaved,
};
