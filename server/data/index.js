"use strict";

const { createEmojiRepository } = require("./EmojiRepository");
const { createScoreRepository } = require("./ScoreRepository");

/**
 * Single place that decides which storage backend the game talks to.
 * Right now both repositories are in-memory. To move to MongoDB later:
 *   1. Write MongoEmojiRepository / MongoScoreRepository implementing the
 *      same method signatures documented in EmojiRepository.js / ScoreRepository.js.
 *   2. Add a "mongo" case to createEmojiRepository / createScoreRepository.
 *   3. Set DATA_BACKEND=mongo (and MONGODB_URI) in the environment.
 * Nothing in server.js, LobbyManager, or GameRoom needs to change.
 */
const DATA_BACKEND = process.env.DATA_BACKEND || "memory";

const emojiRepository = createEmojiRepository({ backend: DATA_BACKEND });
const scoreRepository = createScoreRepository({ backend: DATA_BACKEND });

module.exports = { emojiRepository, scoreRepository, DATA_BACKEND };
