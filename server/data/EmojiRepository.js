"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Repository interface (the "backend database" the game checks munches
 * against). Any implementation must provide these methods with these
 * exact signatures so GameRoom never has to know which backend is live.
 *
 *   getAllSymbols()                -> string[]
 *   getAllKeywords()                -> string[]
 *   isMatch(symbol, keyword)        -> boolean
 *   pickKeyword(minMatches)         -> string   (a keyword with at least minMatches matching emoji)
 *   getMatchingSymbols(keyword)     -> string[]
 *
 * InMemoryEmojiRepository below implements it by loading emojiData.json.
 * A future MongoEmojiRepository would implement the same methods against
 * a `emojis` collection ({ symbol, keywords: [...] }) and could be swapped
 * in from data/index.js without touching game logic.
 */
class InMemoryEmojiRepository {
  constructor(jsonPath) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    this._entries = raw.emoji.map((e) => ({
      symbol: e.symbol,
      keywords: e.keywords.map((k) => k.toLowerCase()),
    }));

    this._keywordToSymbols = new Map();
    for (const entry of this._entries) {
      for (const keyword of entry.keywords) {
        if (!this._keywordToSymbols.has(keyword)) this._keywordToSymbols.set(keyword, []);
        this._keywordToSymbols.get(keyword).push(entry.symbol);
      }
    }
  }

  getAllSymbols() {
    return this._entries.map((e) => e.symbol);
  }

  getAllKeywords() {
    return [...this._keywordToSymbols.keys()];
  }

  isMatch(symbol, keyword) {
    const symbols = this._keywordToSymbols.get(String(keyword).toLowerCase());
    return !!symbols && symbols.includes(symbol);
  }

  getMatchingSymbols(keyword) {
    return this._keywordToSymbols.get(String(keyword).toLowerCase()) || [];
  }

  pickKeyword(minMatches = 1) {
    const candidates = this.getAllKeywords().filter(
      (k) => this._keywordToSymbols.get(k).length >= minMatches
    );
    const pool = candidates.length > 0 ? candidates : this.getAllKeywords();
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

function createEmojiRepository({ backend = "memory" } = {}) {
  switch (backend) {
    case "memory":
      return new InMemoryEmojiRepository(path.join(__dirname, "emojiData.json"));
    default:
      throw new Error(`Unknown emoji repository backend: ${backend}`);
  }
}

module.exports = { createEmojiRepository, InMemoryEmojiRepository };
