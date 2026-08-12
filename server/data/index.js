"use strict";

const { createEmojiRepository } = require("./EmojiRepository");
const { createScoreRepository } = require("./ScoreRepository");
const { createAnalyticsRepository } = require("./AnalyticsRepository");
const { createSessionStore } = require("./SessionStore");

/**
 * Single place that decides which storage backend the game talks to.
 *
 * DATA_BACKEND=memory (default): scores, analytics, and sessions live only
 *   in this process's memory and are lost on restart -- fine for local dev.
 * DATA_BACKEND=mongo: scores, analytics, and sessions are written to
 *   MongoDB via MONGODB_URI. Required on a serverless host like Vercel,
 *   where a fresh in-memory store per invocation would mean every one of
 *   these effectively resets on every request. Nothing in server/app.js,
 *   LobbyManager, or GameRoom changes either way -- they only ever call the
 *   repository interface. server/game/store.js (live room state) reads this
 *   same DATA_BACKEND value independently, for the same reason.
 *
 * The emoji/keyword dataset (EmojiRepository) is deliberately always
 * in-memory, loaded from emojiData.json -- it's the static "backend
 * database" used for correctness-checking, not a thing we collect data
 * into, so it has no mongo variant.
 */
const DATA_BACKEND = process.env.DATA_BACKEND || "memory";

const emojiRepository = createEmojiRepository({ backend: "memory" });
const scoreRepository = createScoreRepository({ backend: DATA_BACKEND });
const analyticsRepository = createAnalyticsRepository({ backend: DATA_BACKEND });
const sessionStore = createSessionStore({ backend: DATA_BACKEND });

module.exports = { emojiRepository, scoreRepository, analyticsRepository, sessionStore, DATA_BACKEND };
