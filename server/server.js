"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const config = require("./config");
const { emojiRepository, scoreRepository, DATA_BACKEND } = require("./data");
const { LobbyManager } = require("./game/LobbyManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

app.get("/api/leaderboard", (req, res) => {
  res.json({ leaderboard: scoreRepository.getLeaderboard(20) });
});

const lobbyManager = new LobbyManager({ config, emojiRepository, scoreRepository, io });

function sendError(socket, message) {
  socket.emit("error_message", { message });
}

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

io.on("connection", (socket) => {
  socket.on("create_room", ({ username } = {}) => {
    const name = String(username || "").trim().slice(0, 20);
    if (!name) return sendError(socket, "Enter a username first.");
    const code = lobbyManager.createRoom();
    try {
      const room = lobbyManager.joinRoom(socket, code, name);
      io.to(room.code).emit("lobby_state", room.toLobbyPayload());
    } catch (err) {
      sendError(socket, err.message);
    }
  });

  socket.on("join_room", ({ username, code } = {}) => {
    const name = String(username || "").trim().slice(0, 20);
    if (!name) return sendError(socket, "Enter a username first.");
    if (!code) return sendError(socket, "Enter a room code.");
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

server.listen(config.PORT, () => {
  console.log(`Emoji Munchers listening on http://localhost:${config.PORT} (data backend: ${DATA_BACKEND})`);
});
