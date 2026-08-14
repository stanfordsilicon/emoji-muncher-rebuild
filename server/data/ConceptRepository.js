"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Repository interface (the "backend database" the game checks munches
 * against), backed by unsupervised concept clusters instead of hand-curated
 * keyword tags. Source data: server/data/conceptClusters.json, generated
 * from a Jupyter inference model's clustering run over emoji at three
 * resolutions -- k=20 (20 broad clusters), k=60 (60 medium), k=150 (150
 * fine-grained). Each concept carries its 10 most-representative emoji
 * (by loading/similarity) and a short label describing what they share.
 *
 *   isMatch(symbol, keyword)        -> boolean
 *   pickKeyword(minMatches, tier)   -> string    (opaque id, e.g. "k60:c16")
 *   getMatchingSymbols(keyword)     -> string[]  (the concept's ranked emoji)
 *   getWrongSymbolPool(keyword)     -> string[]  (emoji from sibling concepts at the same tier)
 *   getKeywordLabel(keyword)        -> string    (human-readable prompt text)
 *   getAllSymbols()                 -> string[]  (union of every concept's emoji)
 *
 * `keyword` is opaque outside this module (never assumed to be English
 * text) -- GameRoom sends getKeywordLabel(keyword) to the client for
 * display, and keeps `keyword` itself only for isMatch/getMatchingSymbols
 * lookups. That split exists because concept labels repeat across tiers by
 * design (a k=60 cluster and its k=150 sub-split can legitimately share a
 * label like "Colorful Hearts"), so the label alone isn't a safe lookup key.
 */
class ConceptRepository {
  constructor(jsonPath) {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    this._tiers = {}; // tier number -> concept[]
    this._byKeyword = new Map(); // "k{tier}:{id}" -> concept

    for (const tierKey of Object.keys(raw)) {
      const tier = Number(tierKey.replace("k", ""));
      const concepts = raw[tierKey];
      this._tiers[tier] = concepts;
      for (const concept of concepts) {
        this._byKeyword.set(this._makeKeyword(tier, concept.id), concept);
      }
    }
    this._tierNumbers = Object.keys(this._tiers).map(Number).sort((a, b) => a - b);
  }

  _makeKeyword(tier, id) {
    return `k${tier}:${id}`;
  }

  _parseTier(keyword) {
    const match = /^k(\d+):/.exec(String(keyword));
    return match ? Number(match[1]) : null;
  }

  // `tier` should be one of the k-values present in conceptClusters.json
  // (20/60/150 as shipped); an unrecognized tier falls back to the
  // smallest/broadest one rather than throwing, since a bad round-to-tier
  // mapping shouldn't be able to crash round generation.
  pickKeyword(minMatches = 1, tier) {
    const tierNumber = this._tiers[tier] ? tier : this._tierNumbers[0];
    const concepts = this._tiers[tierNumber];
    const candidates = concepts.filter((c) => c.emoji.length >= minMatches);
    const pool = candidates.length > 0 ? candidates : concepts;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return this._makeKeyword(tierNumber, picked.id);
  }

  getMatchingSymbols(keyword) {
    const concept = this._byKeyword.get(keyword);
    return concept ? concept.emoji : [];
  }

  isMatch(symbol, keyword) {
    return this.getMatchingSymbols(keyword).includes(symbol);
  }

  getKeywordLabel(keyword) {
    const concept = this._byKeyword.get(keyword);
    return concept ? concept.label : String(keyword);
  }

  // Decoys are drawn from every OTHER concept at the SAME tier as the
  // correct one, rather than from the whole ~1,000-emoji universe -- the
  // tier itself becomes the difficulty knob this way: k=20 siblings are
  // broad and easy to tell apart at a glance, k=150 siblings are
  // fine-grained near-duplicates of each other, so wrong cells get
  // genuinely harder to spot the deeper into a game you get, with no
  // separate tuning needed.
  getWrongSymbolPool(keyword) {
    const tier = this._parseTier(keyword);
    const concept = this._byKeyword.get(keyword);
    if (tier === null || !this._tiers[tier]) return this.getAllSymbols();

    const pool = new Set();
    for (const c of this._tiers[tier]) {
      if (concept && c.id === concept.id) continue;
      for (const e of c.emoji) pool.add(e);
    }
    return pool.size > 0 ? [...pool] : this.getAllSymbols();
  }

  getAllSymbols() {
    if (!this._allSymbolsCache) {
      const all = new Set();
      for (const tier of this._tierNumbers) {
        for (const c of this._tiers[tier]) {
          for (const e of c.emoji) all.add(e);
        }
      }
      this._allSymbolsCache = [...all];
    }
    return this._allSymbolsCache;
  }
}

function createConceptRepository() {
  return new ConceptRepository(path.join(__dirname, "conceptClusters.json"));
}

module.exports = { createConceptRepository, ConceptRepository };
