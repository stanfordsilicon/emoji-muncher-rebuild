"use strict";

// Express app for Emoji Munchers.
//
// This used to be a Socket.IO server holding a persistent WebSocket per
// player, broadcasting every move/round/game-over event instantly, with
// room state in LobbyManager's in-memory Maps and round timers as live
// setTimeout handles inside each GameRoom instance. None of that survives
// on a serverless host (Vercel): no persistent process, no long-lived
// sockets, no shared memory between invocations. So this is now plain HTTP
// actions + polling: every route reads/writes a room by (code, playerId) in
// the body or query string, and server/game/GameRoom.js resolves
// time-driven state (round timeouts, stale disconnects) lazily on every
// room load instead of via a background timer -- see its
// applyLazyStateUpdates and LobbyManager.js's loadRoom().
//
// Exported (no .listen() here) so both the local dev entrypoint
// (server/server.js) and the Vercel serverless entrypoint (api/index.js)
// can reuse the identical app.

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");

const { scoreRepository, analyticsRepository, sessionStore } = require("./data");
const { getMongoDb } = require("./data/mongoClient");
const GameRoom = require("./game/GameRoom");
const lobbyManager = require("./game/LobbyManager");
const { arcadeProxy } = require("./arcade-proxy");
const phaseFilter = require("./data/phaseFilter");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 10;

const app = express();
app.use(express.json());
app.all("/arcade-api/v1/*", arcadeProxy); // local dev only — see arcade-proxy.js

app.get("/api/leaderboard", async (req, res) => {
  res.json({ leaderboard: await scoreRepository.getLeaderboard(20) });
});

// Admin-only, server-to-server: qmoji-2's own /api/admin/clear-leaderboard
// route is the only intended caller -- it authenticates the human admin
// itself (a real qmoji-2 admin session token) and then relays here with
// this shared secret, so the secret never reaches a browser. Resets stats
// only (see ScoreRepository.clearLeaderboard) -- accounts/passwords are
// untouched.
app.post("/api/admin/clear-leaderboard", async (req, res) => {
  const expected = process.env.QMOJI_ADMIN_SECRET;
  const given = req.get("x-qmoji-admin-secret") || "";
  if (!expected || !timingSafeStringEqual(given, expected)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
  try {
    await scoreRepository.clearLeaderboard();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Deliberately touches zero database code -- exists to isolate whether a
// slow response is Vercel's own cold start (function container boot, module
// require()s) versus the Mongo connection specifically, by comparing its
// timing against a DB-backed route on the same cold instance. Confirmed via
// this route that Vercel's own cold start is well under 1s even under
// concurrent load -- the multi-second-to-20+s delays are specifically the
// Mongo connection, not this.
app.get("/api/health", (req, res) => {
  res.json({ ok: true, t: Date.now() });
});

// The actual target for vercel.json's keep-warm cron -- /api/health above
// deliberately doesn't touch Mongo (that's what made it useful as an
// isolation test), which meant the cron was keeping this function's
// container warm but never touching the *Mongo connection* it exists to
// keep warm at all. This is the one that matters: a trivial `ping` command
// forces getMongoDb() to actually run and keeps that connection's socket
// alive under mongoClient.js's maxIdleTimeMS.
app.get("/api/warmup", async (req, res) => {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    res.json({ ok: true, t: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// crypto.timingSafeEqual throws on length mismatch, so pad both sides to
// the same length first -- a length-revealing early return would leak the
// secret's length one comparison at a time, same reasoning as
// authHandler.js's DUMMY_HASH trick in qmoji-2.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  const len = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(len);
  const paddedB = Buffer.alloc(len);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return crypto.timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

function normId(value) {
  return String(value || "").trim();
}

function normCode(value) {
  return String(value || "").trim().toUpperCase();
}

// A typed name that belongs to a claimed account, from a request not
// authenticated as that account, is impersonation -- reject it before it
// ever reaches LobbyManager, whether the name is being used to create or
// join a room.
async function isNameOwnedByAnother(authedUsername, name) {
  if (authedUsername === name) return false;
  return scoreRepository.hasAccount(name);
}

// ---- accounts ----
// Guest play (just typing a username) still works exactly as before -- an
// account is only needed to protect a name and look up personal stats
// later, never required to play.

app.post("/api/sign-up", async (req, res) => {
  const name = String(req.body.username || "").trim().slice(0, 20);
  const pass = String(req.body.password || "");
  if (name.length < 3) return res.json({ ok: false, error: "Username must be at least 3 characters." });
  if (pass.length < 6) return res.json({ ok: false, error: "Password must be at least 6 characters." });
  try {
    const hash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
    await scoreRepository.createAccount(name, hash);
    const token = await sessionStore.issue(name, SESSION_TTL_MS);
    res.json({ ok: true, username: name, token });
  } catch (err) {
    const message = err.code === "USERNAME_TAKEN" ? err.message : "Could not create account — try again.";
    res.json({ ok: false, error: message });
  }
});

app.post("/api/sign-in", async (req, res) => {
  const name = String(req.body.username || "").trim().slice(0, 20);
  const pass = String(req.body.password || "");
  try {
    const hash = await scoreRepository.getPasswordHash(name);
    const valid = hash ? await bcrypt.compare(pass, hash) : false;
    if (!valid) return res.json({ ok: false, error: "Invalid username or password." });
    const token = await sessionStore.issue(name, SESSION_TTL_MS);
    res.json({ ok: true, username: name, token });
  } catch (err) {
    res.json({ ok: false, error: "Could not sign in — try again." });
  }
});

// Silent restore on page load from a token saved in localStorage.
app.post("/api/sign-in-with-token", async (req, res) => {
  const name = await sessionStore.resolve(req.body.token);
  if (!name) return res.json({ ok: false });
  res.json({ ok: true, username: name });
});

app.post("/api/sign-out", async (req, res) => {
  if (req.body.token) await sessionStore.revoke(req.body.token);
  res.json({ ok: true });
});

app.post("/api/get-my-stats", async (req, res) => {
  const authedUsername = req.body.token ? await sessionStore.resolve(req.body.token) : null;
  if (!authedUsername) return res.json({ ok: false, error: "Sign in to view your stats." });
  const stats = await scoreRepository.getPlayerStats(authedUsername);
  res.json({
    ok: true,
    stats: stats || { username: authedUsername, bestScore: 0, totalScore: 0, gamesPlayed: 0, lastPlayedAt: null },
  });
});

// ---- game session analytics (fired once per finished game) ----
// A round finishing used to trigger this straight from a live timer's
// callback. Now that transition can happen lazily inside *any* route that
// loads the room, so every route that gets a room back checks for it here
// -- guarded by room.analyticsSaved so it only actually writes once even if
// several routes/polls race right at the end.
async function saveGameSessionAnalytics(room) {
  try {
    const gameEndedAt = room.gameEndedAt ? new Date(room.gameEndedAt) : new Date();
    const totalDurationMs = room.gameStartedAt ? gameEndedAt.getTime() - room.gameStartedAt : null;
    const players = Object.values(room.players);

    for (const player of players) {
      await scoreRepository.recordMatchResult(player.username, player.score);
      analyticsRepository.recordGameSession({
        username: player.username,
        roomCode: room.code,
        game: "Emoji Munchers",
        language: room.language || "en", // Game Language -- which concept data this session's rounds drew from
        screenLanguage: room.uiLang || "en", // Screen Language -- the arcade party's interface language
        gameStartedAt: room.gameStartedAt ? new Date(room.gameStartedAt) : null,
        gameEndedAt,
        totalDurationMs,
        rounds: player.matchLog.rounds,
        finalScore: player.score,
        finalLives: player.lives,
        eliminated: player.eliminated,
      });
    }
  } catch (err) {
    console.error("Failed to save game session analytics:", err.message);
  }
  await lobbyManager.markAnalyticsSaved(room.code);
}

function maybeSaveAnalytics(room) {
  if (room && room.status === "gameOver" && !room.analyticsSaved) {
    saveGameSessionAnalytics(room); // fire-and-forget
  }
}

// ---- game (single-player: a "room" is always exactly one player, keyed by
// their own id -- see LobbyManager.js) ----

app.post("/api/create-room", async (req, res) => {
  try {
    const { username, playerId, token, language, uiLang } = req.body || {};
    const id = normId(playerId);
    const name = String(username || "").trim().slice(0, 20);
    if (!id) return res.json({ ok: false, error: "Missing player id." });
    if (!name) return res.json({ ok: false, error: "Enter a username first." });
    const authedUsername = token ? await sessionStore.resolve(token) : null;
    if (await isNameOwnedByAnother(authedUsername, name)) {
      return res.json({ ok: false, error: "That name is taken — sign in or pick another." });
    }
    // Bounded wait (see phaseFilter.js's ensureFresh) so a cold serverless
    // instance's very first round for this language is actually checked
    // against qmoji-2's Phase restriction, instead of relying on
    // getEmojiRepository's fire-and-forget background fetch to have
    // already won a race it has no guarantee of winning.
    await phaseFilter.ensureFresh(typeof language === "string" && language ? language : "en");
    const room = await lobbyManager.createGame(
      id,
      name,
      typeof language === "string" ? language : undefined,
      typeof uiLang === "string" ? uiLang : undefined
    );
    scoreRepository.upsertPlayer(name);
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: GameRoom.toClientView(room) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/api/restart-game", async (req, res) => {
  try {
    const { playerId } = req.body || {};
    const room = await lobbyManager.restartGame(normId(playerId));
    res.json({ ok: true, room: GameRoom.toClientView(room) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/api/move", async (req, res) => {
  try {
    const { playerId, dir } = req.body || {};
    const room = await lobbyManager.move(normId(playerId), dir);
    if (!room) return res.json({ ok: false, error: "Room not found." });
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: GameRoom.toClientView(room) });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Sent every few seconds by a connected client -- there's no persistent
// socket left to notice a disconnect, so presence is tracked this way
// instead (see GameRoom's applyLazyStateUpdates for how staleness is
// actually detected).
app.post("/api/heartbeat", async (req, res) => {
  try {
    const { playerId } = req.body || {};
    await lobbyManager.heartbeat(normId(playerId));
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Explicit "go home" from inside a game or off the game-over screen.
app.post("/api/leave-room", async (req, res) => {
  try {
    const { playerId } = req.body || {};
    await lobbyManager.leaveRoom(normId(playerId));
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Polling endpoint — every response is the full authoritative game
// snapshot for this player.
app.get("/api/room", async (req, res) => {
  try {
    const code = normCode(req.query.code);
    if (!code) return res.status(400).json({ ok: false, error: "Missing player id." });
    const room = await lobbyManager.getRoom(code);
    if (!room) return res.json({ ok: true, room: null });
    maybeSaveAnalytics(room);
    res.json({ ok: true, room: GameRoom.toClientView(room) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Local dev only in practice — on Vercel, requests under /public are served
// directly by the platform before ever reaching this function.
app.use(express.static(path.join(__dirname, "..", "public")));

module.exports = app;
