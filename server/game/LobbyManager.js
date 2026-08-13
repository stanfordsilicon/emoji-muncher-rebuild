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

// How many times mutateRoom() retries a save that lost an optimistic-
// concurrency race before giving up. A handful is plenty -- each retry
// means another request genuinely raced this one to save the same room,
// which even under fast repeated key-mashing is a handful of concurrent
// requests at most, not dozens.
const MAX_MUTATE_RETRIES = 6;

const store = createRoomStore();

function randomCode() {
  return Array.from({ length: config.ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
}

// Read-only path (polling, and the "does this code already exist" check):
// catches up time-driven state first, same as mutateRoom, but only saves
// when applyLazyStateUpdates actually changed something -- a plain read
// shouldn't cost a write. Uses the same optimistic-concurrency save as
// mutateRoom so two lazy transitions racing each other (e.g. two players
// both polling right as a round times out) can't clobber one another
// either; on a lost race it just re-reads, since whoever won already saved
// the same deterministic (wall-clock-driven) transition.
async function loadRoom(rawCode) {
  const code = String(rawCode || "").toUpperCase();
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    const room = await store.getRoom(code);
    if (!room) return null;
    const changed = GameRoom.applyLazyStateUpdates(room);
    if (GameRoom.isEmpty(room)) {
      await store.deleteRoom(code);
      return null;
    }
    if (!changed) return room;
    const saved = await store.saveRoom(room, room.version);
    if (saved) return saved;
  }
  return store.getRoom(code);
}

// Every *action* (join, start, move, heartbeat, leave, ...) goes through
// this instead of a plain read-mutate-save, so two requests racing to
// modify the *same* room -- e.g. a player tapping an arrow key faster than
// one round trip, so two /api/move calls are genuinely in flight at once --
// can't silently clobber each other (whichever saved last would otherwise
// just win, discarding the other's move even though the response for both
// still reports success). On Vercel two concurrent requests for the same
// room can land on two entirely different serverless instances, so an
// in-process lock can't help here; this instead uses the room's version
// field as an optimistic-concurrency token -- the store only accepts a
// save if the version hasn't moved since this read, and if it has, the
// whole read-mutate-save cycle retries against the now-current room
// instead of overwriting it.
//
// mutateFn may throw (e.g. "Only the host can start the game") -- that
// propagates immediately, uncaught here, since it's a validation failure
// the caller needs to see, not a concurrency conflict to retry past.
async function mutateRoom(rawCode, mutateFn) {
  const code = String(rawCode || "").toUpperCase();
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    const room = await store.getRoom(code);
    if (!room) return null;
    GameRoom.applyLazyStateUpdates(room);
    if (GameRoom.isEmpty(room)) {
      await store.deleteRoom(code);
      return null;
    }
    const expectedVersion = room.version;
    mutateFn(room);
    if (GameRoom.isEmpty(room)) {
      // The mutation itself emptied the room (an explicit leave) -- delete
      // rather than save. Best-effort: losing a race with someone else
      // re-populating the room in this same instant is an acceptable, very
      // rare edge case.
      await store.deleteRoom(code);
      return null;
    }
    const saved = await store.saveRoom(room, expectedVersion);
    if (saved) return saved;
    // Someone else (another move, a heartbeat, a poll-triggered lazy
    // transition) saved first -- loop and retry the mutation against
    // whatever the room actually looks like now.
  }
  throw new Error("Room is busy — try again.");
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
  await store.saveRoom(room); // brand-new room -- nothing to conflict with yet
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
  const existing = await mutateRoom(code, (r) => GameRoom.addPlayer(r, playerId, username));
  if (existing) return existing;
  const room = GameRoom.createRoom(code);
  GameRoom.addPlayer(room, playerId, username);
  await store.saveRoom(room);
  return room;
}

async function getRoom(code) {
  return loadRoom(code);
}

async function joinRoom(code, playerId, username) {
  const room = await mutateRoom(code, (r) => GameRoom.addPlayer(r, playerId, username));
  if (!room) throw new Error("Room not found");
  return room;
}

async function startGame(code, requesterId) {
  const room = await mutateRoom(code, (r) => GameRoom.startGame(r, requesterId));
  if (!room) throw new Error("Room not found");
  return room;
}

async function restartGame(code, requesterId) {
  const room = await mutateRoom(code, (r) => GameRoom.restartGame(r, requesterId));
  if (!room) throw new Error("Room not found");
  return room;
}

async function move(code, playerId, dir) {
  return mutateRoom(code, (r) => GameRoom.move(r, playerId, dir));
}

async function heartbeat(code, playerId) {
  const room = await mutateRoom(code, (r) => GameRoom.heartbeat(r, playerId));
  if (!room) throw new Error("Room not found");
  return room;
}

// Full removal -- used for an explicit "leave" (Go Home). A missed
// heartbeat instead just flips connected=false via applyLazyStateUpdates
// and keeps the seat warm until its grace period actually expires (also
// handled there).
async function leaveRoom(code, playerId) {
  return mutateRoom(code, (r) => GameRoom.removePlayer(r, playerId));
}

// Marks a finished room's analytics as already recorded, so a concurrent or
// repeated poll doesn't write duplicate score/analytics documents.
// Best-effort, like the rest of the analytics path -- server/app.js calls
// this right after actually writing them. Low-contention (once per game),
// so this stays a plain unconditional save rather than going through
// mutateRoom.
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
