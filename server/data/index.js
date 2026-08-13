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
 * If DATA_BACKEND itself isn't set but MONGODB_URI is, mongo is inferred
 * rather than silently falling back to memory. This is a Vercel-specific
 * safety net: MONGODB_URI and DATA_BACKEND are two separate env vars to
 * configure in the Vercel project settings, and on live Vercel this exact
 * split-config actually happened -- MONGODB_URI was set but DATA_BACKEND
 * was not, so *some* serverless instances resolved to memory (each with its
 * own empty room map) while others correctly reached Mongo, producing
 * intermittent, instance-dependent "Room not found" errors on real moves
 * even though the room demonstrably still existed. Since MONGODB_URI being
 * set with DATA_BACKEND unset has no other sane interpretation, inferring
 * mongo here closes that gap without requiring both to be kept in sync by
 * hand.
 *
 * The emoji/keyword dataset (EmojiRepository) is deliberately always
 * in-memory, loaded from emojiData.json -- it's the static "backend
 * database" used for correctness-checking, not a thing we collect data
 * into, so it has no mongo variant.
 */
const DATA_BACKEND = process.env.DATA_BACKEND || (process.env.MONGODB_URI ? "mongo" : "memory");

const emojiRepository = createEmojiRepository({ backend: "memory" });
const scoreRepository = createScoreRepository({ backend: DATA_BACKEND });
const analyticsRepository = createAnalyticsRepository({ backend: DATA_BACKEND });
const sessionStore = createSessionStore({ backend: DATA_BACKEND });

module.exports = { emojiRepository, scoreRepository, analyticsRepository, sessionStore, DATA_BACKEND };
