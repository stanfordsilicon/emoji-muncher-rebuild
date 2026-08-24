"use strict";

const fs = require("fs");
const path = require("path");
const { createConceptRepository, ConceptRepository } = require("./ConceptRepository");
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
 * The emoji/keyword dataset (ConceptRepository) is deliberately always
 * in-memory, loaded from conceptClusters.json -- it's the static "backend
 * database" used for correctness-checking, not a thing we collect data
 * into, so it has no mongo variant.
 */
const DATA_BACKEND = process.env.DATA_BACKEND || (process.env.MONGODB_URI ? "mongo" : "memory");

const emojiRepository = createConceptRepository();
const scoreRepository = createScoreRepository({ backend: DATA_BACKEND });
const analyticsRepository = createAnalyticsRepository({ backend: DATA_BACKEND });
const sessionStore = createSessionStore({ backend: DATA_BACKEND });

// Per-language concept data (see server/data/lang/*.json), generated from
// QMoji's shared CLDR emoji-keyword source -- same k20/k60/k150 shape as
// conceptClusters.json, just built from real per-language keyword text
// instead of unsupervised English clustering. Not every Game Language has
// enough CLDR keyword coverage to produce three playable tiers, so only
// languages that cleared that bar at generation time have a file here;
// getEmojiRepository() falls back to the English default for everything
// else, same as if no language had been requested at all. Loaded lazily
// and cached (never at process startup) so adding/removing a language file
// doesn't cost every room a read it'll never use.
const LANG_DATA_DIR = path.join(__dirname, "lang");
const langRepoCache = new Map();

function getEmojiRepository(lang) {
  if (!lang || lang === "en") return emojiRepository;
  if (langRepoCache.has(lang)) return langRepoCache.get(lang);

  let repo = emojiRepository;
  const file = path.join(LANG_DATA_DIR, `${lang}.json`);
  if (fs.existsSync(file)) {
    try {
      repo = new ConceptRepository(file);
    } catch (e) {
      console.error(`Failed to load concept data for language "${lang}":`, e.message);
      repo = emojiRepository;
    }
  }
  langRepoCache.set(lang, repo);
  return repo;
}

module.exports = { emojiRepository, getEmojiRepository, scoreRepository, analyticsRepository, sessionStore, DATA_BACKEND };
