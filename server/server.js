"use strict";

const crypto = require("crypto");
const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const config = require("./config");
const { emojiRepository, scoreRepository, analyticsRepository, DATA_BACKEND } = require("./data");
const { LobbyManager } = require("./game/LobbyManager");
const { arcadeProxy } = require("./arcade-proxy");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.all("/arcade-api/v1/*", arcadeProxy); // local dev only — see arcade-proxy.js
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/leaderboard", async (req, res) => {
  res.json({ leaderboard: await scoreRepository.getLeaderboard(20) });
});

const lobbyManager = new LobbyManager({ config, emojiRepository, scoreRepository, analyticsRepository, io });

function sendError(socket, message) {
  socket.emit("error_message", { message });
}

// ---- accounts ----
// Sessions are a simple in-memory token -> { username, expiresAt } map, not
// backed by Mongo even when DATA_BACKEND=mongo. Losing everyone's session on
// a server restart (forcing a re-login) is a fine tradeoff for a casual
// party game, and it avoids a second collection just to track logins.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const sessions = new Map(); // token -> { username, expiresAt }
const BCRYPT_ROUNDS = 10;

function issueSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function resolveSession(token) {
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return entry.username;
}

// A typed name that belongs to a claimed account, from a socket not signed
// in as that account, is impersonation -- reject it before it ever reaches
// LobbyManager, whether the name is being used to create or join a room.
async function isNameOwnedByAnother(socket, name) {
  if (socket.data.authedUsername === name) return false;
  return scoreRepository.hasAccount(name);
}

io.on("connection", (socket) => {
  socket.on("sign_up", async ({ username, password } = {}, cb) => {
    const name = String(username || "").trim().slice(0, 20);
    const pass = String(password || "");
    if (name.length < 3) return cb && cb({ ok: false, error: "Username must be at least 3 characters." });
    if (pass.length < 6) return cb && cb({ ok: false, error: "Password must be at least 6 characters." });
    try {
      const hash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
      await scoreRepository.createAccount(name, hash);
      socket.data.authedUsername = name;
      const token = issueSession(name);
      cb && cb({ ok: true, username: name, token });
    } catch (err) {
      const message = err.code === "USERNAME_TAKEN" ? err.message : "Could not create account — try again.";
      cb && cb({ ok: false, error: message });
    }
  });

  socket.on("sign_in", async ({ username, password } = {}, cb) => {
    const name = String(username || "").trim().slice(0, 20);
    const pass = String(password || "");
    try {
      const hash = await scoreRepository.getPasswordHash(name);
      const valid = hash ? await bcrypt.compare(pass, hash) : false;
      if (!valid) return cb && cb({ ok: false, error: "Invalid username or password." });
      socket.data.authedUsername = name;
      const token = issueSession(name);
      cb && cb({ ok: true, username: name, token });
    } catch (err) {
      cb && cb({ ok: false, error: "Could not sign in — try again." });
    }
  });

  // Silent restore on page load from a token saved in localStorage.
  socket.on("sign_in_with_token", ({ token } = {}, cb) => {
    const name = resolveSession(token);
    if (!name) return cb && cb({ ok: false });
    socket.data.authedUsername = name;
    cb && cb({ ok: true, username: name });
  });

  socket.on("sign_out", ({ token } = {}) => {
    if (token) sessions.delete(token);
    socket.data.authedUsername = null;
  });

  socket.on("get_my_stats", async (_payload, cb) => {
    if (!socket.data.authedUsername) return cb && cb({ ok: false, error: "Sign in to view your stats." });
    const stats = await scoreRepository.getPlayerStats(socket.data.authedUsername);
    cb && cb({ ok: true, stats: stats || { username: socket.data.authedUsername, bestScore: 0, totalScore: 0, gamesPlayed: 0, lastPlayedAt: null } });
  });

  // ---- rooms ----

  socket.on("create_room", async ({ username, code: requestedCode, solo } = {}) => {
    const name = String(username || "").trim().slice(0, 20);
    if (!name) return sendError(socket, "Enter a username first.");
    if (await isNameOwnedByAnother(socket, name)) {
      return sendError(socket, "That name is taken — sign in or pick another.");
    }
    // requestedCode arrives when QMoji 2.0 launched this game with a party
    // already formed — the arcade room's code becomes this game's room code
    // too (a substitution, not a second, parallel room-code system).
    const code = requestedCode ? lobbyManager.createRoomWithCode(requestedCode) : lobbyManager.createRoom();
    try {
      const room = lobbyManager.joinRoom(socket, code, name);
      io.to(room.code).emit("lobby_state", room.toLobbyPayload());
      // "Play Solo" skips the waiting-room/share-code step entirely --
      // the host is the only player, so start immediately.
      if (solo) room.startGame(socket.id);
    } catch (err) {
      sendError(socket, err.message);
    }
  });

  socket.on("join_room", async ({ username, code } = {}) => {
    const name = String(username || "").trim().slice(0, 20);
    if (!name) return sendError(socket, "Enter a username first.");
    if (!code) return sendError(socket, "Enter a room code.");
    if (await isNameOwnedByAnother(socket, name)) {
      return sendError(socket, "That name is taken — sign in or pick another.");
    }
    try {
      const room = lobbyManager.joinRoom(socket, code, name);
      io.to(room.code).emit("lobby_state", room.toLobbyPayload());
    } catch (err) {
      sendError(socket, err.message);
    }
  });

  socket.on("start_game", () => {
    const room = lobbyManager.getRoomForSocket(socket);
    if (!room) return sendError(socket, "You're not in a room.");
    try {
      room.startGame(socket.id);
    } catch (err) {
      sendError(socket, err.message);
    }
  });

  socket.on("restart_game", () => {
    const room = lobbyManager.getRoomForSocket(socket);
    if (!room) return sendError(socket, "You're not in a room.");
    try {
      room.restartGame(socket.id);
      io.to(room.code).emit("lobby_state", room.toLobbyPayload());
    } catch (err) {
      sendError(socket, err.message);
    }
  });

  socket.on("move", ({ dir } = {}) => {
    const room = lobbyManager.getRoomForSocket(socket);
    if (!room) return;
    room.move(socket.id, dir);
  });

  // Explicit "go home" from inside a game or off the game-over screen. Note
  // there is no equivalent path out of the waiting room by design -- the
  // client simply never offers this button while status is "lobby".
  socket.on("leave_room", () => {
    const room = lobbyManager.leaveSocket(socket);
    broadcastRoomChange(room);
    socket.emit("left_room");
  });

  socket.on("disconnect", () => {
    const room = lobbyManager.leaveSocket(socket);
    broadcastRoomChange(room);
  });
});

// A departing player (explicit "leave" or a dropped connection) needs a
// different broadcast depending on when it happens: pre-game, the waiting
// room's player list changed; mid-game or post-game, the scoreboard/grid
// need to drop that player's muncher and rows.
function broadcastRoomChange(room) {
  if (!room) return;
  if (room.status === "lobby") {
    io.to(room.code).emit("lobby_state", room.toLobbyPayload());
  } else {
    io.to(room.code).emit("state_update", { players: room.getPlayersSnapshot() });
  }
}

server.listen(config.PORT, () => {
  console.log(`Emoji Munchers listening on http://localhost:${config.PORT} (data backend: ${DATA_BACKEND})`);
});
