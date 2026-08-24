"use strict";

// Orchestrates the collection of rooms: loading a room (catching up its
// time-driven state first -- see GameRoom.applyLazyStateUpdates) and
// persisting it back after a mutation. GameRoom.js owns the actual game
// rules; this module owns nothing but routing a player id to their room
// and keeping it in server/game/store.js.
//
// Single-player only, so a room's code IS the owning player's id -- there's
// no separate code to generate, share, or look up by, which also means no
// player can ever land in another player's room by guessing or reusing a
// code.

const GameRoom = require("./GameRoom");
const { createRoomStore } = require("./store");

// How many times mutateRoom() retries a save that lost an optimistic-
// concurrency race before giving up. Also doubles as the retry budget for a
// `store.getRoom` miss (see below) -- both share the same loop.
//
// This used to be pushed much higher (32 attempts, ~18-20s budget) chasing
// single-request cold-start measurements. Then a concurrency test -- 8
// players hitting /api/create-room + /api/move at the same moment --
// showed that was making things *worse*, not better: 6 of the 8 concurrent
// requests each independently retried against Mongo for the *entire* ~20s
// budget and still failed. A long budget doesn't help a request that's
// never going to succeed anyway (whatever's actually contending under
// concurrent cold connections was still contending 20s later); it just
// means every one of those doomed requests spends 20s hammering Mongo with
// retries before giving up, piling more concurrent connection attempts on
// top of whatever's already causing the slowdown. Pulled back down to fail
// faster instead -- a request that was going to fail anyway now does so in
// ~5s instead of ~20s, which means less self-inflicted load stacking up
// during exactly the burst that's already struggling.
const MAX_MUTATE_RETRIES = 15;

// Delay before each retry (attempt 0 fires immediately, no wait). A short,
// increasing backoff (capped, with a little jitter so several requests
// retrying in lockstep don't keep landing on each other) spreads the 15
// attempts across roughly up to five seconds -- enough for the common
// single-request cold start to resolve -- without piling on for many more
// seconds once a request is in real trouble (see the concurrency note
// above).
const RETRY_BASE_DELAY_MS = 40;
const RETRY_MAX_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryDelay(attempt) {
  if (attempt === 0) return;
  const base = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * attempt);
  const jitter = Math.random() * base * 0.5;
  await sleep(base + jitter);
}

const store = createRoomStore();

function codeFor(playerId) {
  return String(playerId || "").trim().toUpperCase();
}

// Read-only path (polling): catches up time-driven state first, same as
// mutateRoom, but only saves when applyLazyStateUpdates actually changed
// something -- a plain read shouldn't cost a write. Uses the same
// optimistic-concurrency save as mutateRoom so two lazy transitions racing
// each other can't clobber one another either; on a lost race it just
// re-reads, since whoever won already saved the same deterministic
// (wall-clock-driven) transition.
//
// A `store.getRoom` miss retries here too, same as mutateRoom and for the
// same reason (see its comment) -- a cold serverless instance's fresh Mongo
// connection can transiently miss a document that genuinely exists. This
// path used to give up on the very first miss with no retry at all, which
// is a worse version of exactly the bug mutateRoom's retry was written to
// fix: /api/room is polled every ~280ms during play, so a single cold miss
// here was enough to hand the client `room: null` and make an active game
// look like it had vanished -- indistinguishable, from the player's side,
// from the room actually being gone. Retrying (and only reporting "not
// found" once every attempt misses) closes that gap.
async function loadRoom(rawCode) {
  const code = codeFor(rawCode);
  let everFoundRoom = false;
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    await retryDelay(attempt);
    const room = await store.getRoom(code);
    if (!room) continue;
    everFoundRoom = true;
    const changed = GameRoom.applyLazyStateUpdates(room);
    if (GameRoom.isEmpty(room)) {
      await store.deleteRoom(code);
      return null;
    }
    if (!changed) return room;
    const saved = await store.saveRoom(room, room.version);
    if (saved) return saved;
    // Someone else saved first (a race on the same lazy transition) -- loop
    // and re-read, same as mutateRoom.
  }
  if (!everFoundRoom) return null;
  // Found it at least once but kept losing the save race -- return whatever
  // is currently there rather than reporting a room that demonstrably
  // exists as missing.
  return store.getRoom(code);
}

// Every *action* (move, heartbeat, leave, restart, ...) goes through this
// instead of a plain read-mutate-save, so two requests racing to modify the
// *same* room -- e.g. a player tapping an arrow key faster than one round
// trip, so two /api/move calls are genuinely in flight at once -- can't
// silently clobber each other (whichever saved last would otherwise just
// win, discarding the other's move even though the response for both still
// reports success). On Vercel two concurrent requests for the same room can
// land on two entirely different serverless instances, so an in-process
// lock can't help here; this instead uses the room's version field as an
// optimistic-concurrency token -- the store only accepts a save if the
// version hasn't moved since this read, and if it has, the whole
// read-mutate-save cycle retries against the now-current room instead of
// overwriting it.
//
// mutateFn may throw -- that propagates immediately, uncaught here, since
// it's a validation failure the caller needs to see, not a concurrency
// conflict to retry past.
//
// A `store.getRoom` miss on the *first* attempt is retried here too, not
// treated as an instant "Room not found" -- on Vercel a cold serverless
// instance opens a brand-new Mongo connection per store.js's comment, and a
// findOne on that fresh connection can transiently miss a document that
// genuinely exists. Treating that identically to "the caller raced someone
// else's save" and looping is what actually fixes it, since the
// alternative -- reporting failure to the client -- silently drops a
// keypress with no feedback (see public/client.js's sendMove: it no-ops on
// `!res.ok`), which is exactly what "have to hit the arrow multiple times"
// looks like from the player's side.
async function mutateRoom(rawCode, mutateFn) {
  const code = codeFor(rawCode);
  let everFoundRoom = false;
  for (let attempt = 0; attempt < MAX_MUTATE_RETRIES; attempt++) {
    await retryDelay(attempt);
    const room = await store.getRoom(code);
    if (!room) continue;
    everFoundRoom = true;
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
  // Never found the room on any attempt -> genuinely doesn't exist (or was
  // deleted). Found it but kept losing the save race -> actually busy.
  if (!everFoundRoom) return null;
  throw new Error("Room is busy — try again.");
}

// Creates a brand-new game for this player and starts it immediately --
// there's no waiting room to sit in first, since there's no one else to
// wait for. A fresh call always overwrites any previous game under this
// same player id (e.g. after a page refresh mid-round): that old game was
// already abandoned the moment the tab reloaded, so there's nothing to
// preserve by keeping it around instead of just starting clean.
async function createGame(playerId, username, language) {
  const code = codeFor(playerId);
  const room = GameRoom.createRoom(code, language);
  GameRoom.addPlayer(room, playerId, username);
  GameRoom.beginGame(room);
  await store.saveRoom(room); // brand-new room -- nothing to conflict with yet
  return room;
}

async function getRoom(playerId) {
  return loadRoom(playerId);
}

async function restartGame(playerId) {
  const room = await mutateRoom(playerId, (r) => GameRoom.beginGame(r));
  if (!room) throw new Error("Room not found");
  return room;
}

async function move(playerId, dir) {
  return mutateRoom(playerId, (r) => GameRoom.move(r, playerId, dir));
}

async function heartbeat(playerId) {
  const room = await mutateRoom(playerId, (r) => GameRoom.heartbeat(r, playerId));
  if (!room) throw new Error("Room not found");
  return room;
}

// Explicit "leave" (Go Home). A missed heartbeat instead just flips
// connected=false via applyLazyStateUpdates and keeps the seat warm until
// its grace period actually expires (also handled there).
async function leaveRoom(playerId) {
  return mutateRoom(playerId, (r) => GameRoom.removePlayer(r, playerId));
}

// Marks a finished room's analytics as already recorded, so a concurrent or
// repeated poll doesn't write duplicate score/analytics documents.
// Best-effort, like the rest of the analytics path -- server/app.js calls
// this right after actually writing them. Low-contention (once per game),
// so this stays a plain unconditional save rather than going through
// mutateRoom.
async function markAnalyticsSaved(playerId) {
  const room = await store.getRoom(codeFor(playerId));
  if (!room) return;
  room.analyticsSaved = true;
  await store.saveRoom(room);
}

module.exports = {
  createGame,
  getRoom,
  restartGame,
  move,
  heartbeat,
  leaveRoom,
  markAnalyticsSaved,
};
