"use strict";

const { GameRoom } = require("./GameRoom");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

class LobbyManager {
  constructor({ config, emojiRepository, scoreRepository, analyticsRepository, io }) {
    this.config = config;
    this.emojiRepository = emojiRepository;
    this.scoreRepository = scoreRepository;
    this.analyticsRepository = analyticsRepository;
    this.io = io;
    this.rooms = new Map(); // code -> GameRoom
    this.socketToRoom = new Map(); // socketId -> code
  }

  _generateCode() {
    let code;
    do {
      code = Array.from({ length: this.config.ROOM_CODE_LENGTH }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
      ).join("");
    } while (this.rooms.has(code));
    return code;
  }

  _makeRoom(code) {
    const emitToRoom = (event, payload) => this.io.to(code).emit(event, payload);
    return new GameRoom(code, {
      config: this.config,
      emojiRepository: this.emojiRepository,
      scoreRepository: this.scoreRepository,
      analyticsRepository: this.analyticsRepository,
      emitToRoom,
    });
  }

  createRoom() {
    const code = this._generateCode();
    this.rooms.set(code, this._makeRoom(code));
    return code;
  }

  getRoom(code) {
    return this.rooms.get((code || "").toUpperCase());
  }

  joinRoom(socket, code, username) {
    const room = this.getRoom(code);
    if (!room) throw new Error("Room not found");
    room.addPlayer(socket.id, username);
    socket.join(room.code);
    this.socketToRoom.set(socket.id, room.code);
    return room;
  }

  leaveSocket(socket) {
    const code = this.socketToRoom.get(socket.id);
    if (!code) return null;
    const room = this.rooms.get(code);
    this.socketToRoom.delete(socket.id);
    if (!room) return null;
    room.removePlayer(socket.id);
    socket.leave(code);
    if (room.isEmpty()) {
      this.rooms.delete(code);
      return null;
    }
    return room;
  }

  getRoomForSocket(socket) {
    const code = this.socketToRoom.get(socket.id);
    return code ? this.rooms.get(code) : null;
  }
}

module.exports = { LobbyManager };
