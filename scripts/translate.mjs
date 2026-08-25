#!/usr/bin/env node
// Generates public/locales/<lang>.json from public/locales/en.json via DeepL.
//
//   DEEPL_API_KEY=... node scripts/translate.mjs            # all languages
//   DEEPL_API_KEY=... node scripts/translate.mjs fr pt-br   # just these
//   DEEPL_API_KEY=... node scripts/translate.mjs --force      # ignore cache
//   DEEPL_API_KEY=... node scripts/translate.mjs --bundle=factoids
//
// This file is identical in survey-scramble-rebuild and emoji-muncher-rebuild.
// Keep it that way -- if one needs a change, both get it.
//
// ---------------------------------------------------------------------
// The three rules that matter
// ---------------------------------------------------------------------
// 1. HUMAN OVERRIDES WIN, ALWAYS. public/locales/<lang>.overrides.json is
//    hand-maintained. This script reads it and merges it ON TOP of DeepL's
//    output; it never writes to, modifies, or deletes an overrides file.
//    To fix a bad translation, edit the overrides file -- never the
//    generated <lang>.json, which is overwritten on every run.
//
// 2. NOTHING SHIPS THAT FAILS VALIDATION. Every generated value must carry
//    exactly the same {placeholder} tokens and exactly the same emoji as
//    its English source. A mismatch names the offending key and aborts
//    that language without writing the file. A machine translator quietly
//    dropping "{score}" or an emoji from a button label is the single most
//    likely way this pipeline breaks a UI, so it is a hard failure rather
//    than a warning.
//
// 3. THE KEY IS NEVER PRINTED OR COMMITTED. It comes from the environment
//    only. .env is gitignored.
//
// Idempotent: a re-run with unchanged English and unchanged overrides
// produces byte-identical files, so `git status` stays clean and diffs
// only ever show keys whose English actually changed. That's why unchanged
// keys are reused from the existing <lang>.json instead of being re-sent
// to DeepL -- it also keeps the API bill proportional to real edits.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "public", "locales");

// A "bundle" is one independently-translated set of strings. The default
// bundle is the UI chrome (en.json -> fr.json, ...). --bundle=factoids
// translates the Did You Know content instead (factoids.en.json ->
// factoids.fr.json, ...), with its own overrides and its own snapshot.
//
// They are separate on purpose: 100 prose entries in the same file as 57
// chrome keys makes both the diffs and the overrides file unreadable, the
// two have different review cadences, and a missing factoid is cosmetic
// where a missing button label is broken UI. Same pipeline either way --
// same glossary, same overrides mechanism, same validation.
function bundlePaths(bundle) {
  const p = bundle ? bundle + "." : "";
  return {
    source: join(LOCALES, `${p}en.json`),
    out: (lang) => join(LOCALES, `${p}${lang}.json`),
    overrides: (lang) => join(LOCALES, `${p}${lang}.overrides.json`),
    numericExempt: join(LOCALES, `${p}numeric-exempt.json`),
    snapshot: (lang) => join(LOCALES, `.${p}${lang}.en-snapshot.json`),
  };
}

// Canonical lowercase codes (our filenames) -> DeepL's target codes.
// DeepL requires the regional variant for Portuguese: PT-BR / PT-PT.
// There is deliberately no bare "pt" -- i18n.js aliases it to pt-br.
const TARGETS = {
  fr: "FR",
  es: "ES",
  "pt-br": "PT-BR",
  "pt-pt": "PT-PT",
  ru: "RU",
};

// Keys whose value is passed through to every language VERBATIM, never
// sent to DeepL. Product names live here: "Moji Mojo" is a name, not a
// phrase, and translating it produced a different game name in each
// language ("La course aux sondages !", "Опрос-гонка!").
//
// To add a key: put its name in this list and re-run. The next run will
// overwrite the generated value with the English one. Removing a key from
// the list sends it back to DeepL on the following run.
// The list is the UNION across every game in the suite, not per-repo: a key
// that doesn't exist in this repo's en.json is simply never consulted, so
// one shared list keeps this file byte-identical everywhere.
//
// Odd One Out renders its name as three stacked words, so all three are
// part of the product name. Left to DeepL, "Out" became "Sortie" (exit) in
// French and "Выход" in Russian.
const DO_NOT_TRANSLATE = new Set([
  "app_title",
  "page_title",
  "game_title_odd",
  "game_title_one",
  "game_title_out",
]);

// ---------------------------------------------------------------------
// Placeholder + emoji handling
// ---------------------------------------------------------------------

// {round}, {score}, {name} ... -- must survive translation untouched.
const TOKEN_RE = /\{[a-zA-Z0-9_]+\}/g;

// Emoji / pictographic codepoints. Deliberately broad: symbols, dingbats,
// arrows and the variation selector, since UI copy here uses things like
// "✅", "🏆", "📋" and "—" adjacent to them. We compare multisets of these
// codepoints before and after, so over-inclusion is safe (it just means we
// check more characters) while under-inclusion would let a dropped emoji
// through.
function emojiCodepoints(str) {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const isEmoji =
      (cp >= 0x1f000 && cp <= 0x1ffff) || // pictographs, emoticons, symbols
      (cp >= 0x2600 && cp <= 0x27bf) ||   // misc symbols + dingbats
      (cp >= 0x2b00 && cp <= 0x2bff) ||   // arrows/shapes
      (cp >= 0xfe00 && cp <= 0xfe0f) ||  // variation selectors
      cp === 0x200d;                       // zero-width joiner
    if (isEmoji) out.push(cp);
  }
  return out.sort((a, b) => a - b);
}

// DeepL leaves anything inside an ignored tag alone when tag_handling=xml.
// So every {token} and every emoji run gets wrapped in <x>...</x> on the
// way out and unwrapped on the way back. This is what actually protects
// them -- the validation step afterwards is the safety net, not the
// mechanism.
const IGNORE_TAG = "x";

function protect(text) {
  // Wrap tokens first, then emoji, so a token containing no emoji is not
  // double-wrapped.
  let out = text.replace(TOKEN_RE, (m) => `<${IGNORE_TAG}>${m}</${IGNORE_TAG}>`);
  out = out.replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu, (m) =>
    `<${IGNORE_TAG}>${m}</${IGNORE_TAG}>`,
  );
  return out;
}

function unprotect(text) {
  return text.split(`<${IGNORE_TAG}>`).join("").split(`</${IGNORE_TAG}>`).join("");
}

// ---------------------------------------------------------------------
// Quote artifacts around protected spans
// ---------------------------------------------------------------------
//
// DeepL treats an ignored tag as an opaque foreign term and often wraps it
// in quotation marks that the English never had: "Next round in {seconds}"
// comes back as «{seconds}», and "Race to the 🚩" as «🚩». Validation can't
// catch this -- the token and the emoji are both present and correct -- so
// it has to be undone here.
//
// It is NOT a blanket strip. guess_correct legitimately quotes {keyword} in
// English, and removing those quotes would be a regression. So we record
// which protected spans the SOURCE quoted, and only strip quotes around
// spans it didn't.
const QUOTE_OPEN = "«\"“„‘'";
const QUOTE_CLOSE = "»\"”‟’'";
const OPEN_CLASS = "[«\"“„‘']";
const CLOSE_CLASS = "[»\"”‟’']";

// French sets its guillemets off with a narrow no-break space on the inside
// (« mot »). DeepL's output is inconsistent about this -- «{name} » had a
// space on the closing side only. Where quotes are legitimate we normalize
// to the language's own convention rather than leaving them lopsided.
const NNBSP = "\u202F";

function quotedSpansInSource(protectedSource) {
  const set = new Set();
  const re = new RegExp(`${OPEN_CLASS}\\s*<${IGNORE_TAG}>(.*?)</${IGNORE_TAG}>\\s*${CLOSE_CLASS}`, "gs");
  let m;
  while ((m = re.exec(protectedSource)) !== null) set.add(m[1]);
  return set;
}

// Operates on the still-tagged translation, so span boundaries are exact.
function fixQuoteArtifacts(translated, quotedInSource, lang) {
  const re = new RegExp(
    `(${OPEN_CLASS})(\\s*)<${IGNORE_TAG}>(.*?)</${IGNORE_TAG}>(\\s*)(${CLOSE_CLASS})`,
    "gs",
  );
  return translated.replace(re, (_full, open, _s1, content, _s2, close) => {
    const span = `<${IGNORE_TAG}>${content}</${IGNORE_TAG}>`;
    if (!quotedInSource.has(content)) return span; // spurious -- drop the quotes
    // Legitimate quotes: keep them, but make the spacing symmetric.
    if (lang === "fr") return `«${NNBSP}${span}${NNBSP}»`;
    return `${open}${span}${close}`; // es/pt/ru: no inner spacing
  });
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------
// DeepL
// ---------------------------------------------------------------------

function apiBase(key) {
  // Free-tier keys are suffixed ":fx" and live on a different host.
  return key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

// ---------------------------------------------------------------------
// Glossaries
// ---------------------------------------------------------------------
//
// A glossary pins the recurring game-domain vocabulary so DeepL stops
// re-deciding it per string: "room" is a multiplayer session, not a
// bedroom; "host" is one word per language, not three. Source terms live
// in scripts/glossary.json (committed); the returned IDs live in
// .deepl-glossaries.json (gitignored -- they're account-scoped).
//
// DeepL glossaries are immutable, so we hash the entries and create a
// replacement whenever glossary.json changes. Note DeepL supports EN->PT
// but not EN->PT-BR / EN->PT-PT: pt-br and pt-pt therefore get two
// separate EN->PT glossaries and we select by target, which is what keeps
// "rodada" and "ronda" apart.

const GLOSSARY_SOURCE = join(HERE, "glossary.json");
const GLOSSARY_CACHE = join(HERE, "..", ".deepl-glossaries.json");

function entriesToTsv(entries) {
  return Object.entries(entries)
    .map(([en, tgt]) => `${en}\t${tgt}`)
    .join("\n");
}

function hashEntries(tsv) {
  return createHash("sha256").update(tsv, "utf8").digest("hex").slice(0, 16);
}

async function supportedGlossaryTargets(key) {
  const res = await fetch(`${apiBase(key)}/v2/glossary-language-pairs`, {
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
  });
  if (!res.ok) return null; // treat as "unknown" -- caller degrades gracefully
  const json = await res.json();
  return new Set(
    json.supported_languages
      .filter((p) => p.source_lang.toLowerCase() === "en")
      .map((p) => p.target_lang.toLowerCase()),
  );
}

async function createGlossary(key, name, targetLang, tsv) {
  const res = await fetch(`${apiBase(key)}/v2/glossaries`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      source_lang: "en",
      target_lang: targetLang,
      entries: tsv,
      entries_format: "tsv",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`glossary create ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()).glossary_id;
}

// DeepL's Free tier permits only ONE glossary on the account at a time
// (creating a second returns 456 "Too many glossaries"). Five languages
// therefore cannot each hold one simultaneously. Instead we acquire them
// one at a time, in sequence: before translating a language we make room
// by deleting any glossary this script previously created, then create
// that language's.
//
// Only glossaries named "qmoji-*" are ever deleted -- anything else on the
// account belongs to somebody else and is left strictly alone. Deleting
// ours is safe because scripts/glossary.json can recreate them exactly.
//
// A glossary is identified by the hash of its ENTRIES, never by its id.
// Ids change every time we recreate one; hashing the content instead is
// what keeps re-runs idempotent rather than re-translating everything.
async function listOurGlossaries(key) {
  const res = await fetch(`${apiBase(key)}/v2/glossaries`, {
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.glossaries || []).filter((g) => g.name.startsWith("qmoji-"));
}

async function deleteGlossary(key, id) {
  await fetch(`${apiBase(key)}/v2/glossaries/${id}`, {
    method: "DELETE",
    headers: { Authorization: `DeepL-Auth-Key ${key}` },
  }).catch(() => {});
}

// Returns { id, hash } or null. Never throws -- a language without a
// glossary still translates, it just doesn't get its vocabulary pinned.
async function acquireGlossary(key, lang, supported) {
  const source = readJson(GLOSSARY_SOURCE, {}) || {};
  const entries = source[lang];
  if (!entries || Object.keys(entries).length === 0) return null;

  // EN->PT-BR / EN->PT-PT are not glossary pairs; EN->PT is. pt-br and
  // pt-pt therefore get separate EN->PT glossaries, distinguished by their
  // entries -- which is what keeps "rodada" and "ronda" apart.
  const base = lang.split("-")[0];
  let glossaryLang = null;
  if (!supported) glossaryLang = base;
  else if (supported.has(lang)) glossaryLang = lang;
  else if (supported.has(base)) glossaryLang = base;
  if (!glossaryLang) {
    console.warn(
      `[${lang}] DeepL has no glossary pair for EN->${lang.toUpperCase()} or ` +
        `EN->${base.toUpperCase()} -- translating without one. Pin this ` +
        `language's vocabulary in ${lang}.overrides.json instead.`,
    );
    return null;
  }

  const tsv = entriesToTsv(entries);
  const hash = hashEntries(tsv + "|" + glossaryLang);
  const wantName = `qmoji-${lang}-${hash}`;

  const existing = await listOurGlossaries(key);
  const reusable = existing.find((g) => g.name === wantName && g.ready !== false);
  if (reusable) return { id: reusable.glossary_id, hash };

  for (const g of existing) await deleteGlossary(key, g.glossary_id); // make room

  try {
    const id = await createGlossary(key, wantName, glossaryLang, tsv);
    console.log(`[${lang}] glossary EN->${glossaryLang.toUpperCase()} (${Object.keys(entries).length} terms)`);
    return { id, hash };
  } catch (e) {
    console.warn(`[${lang}] glossary unavailable (${e.message}) -- translating without one`);
    return null;
  }
}

async function deeplTranslate(key, texts, target, glossaryId) {
  if (texts.length === 0) return [];
  const res = await fetch(`${apiBase(key)}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: texts,
      source_lang: "EN",
      target_lang: target,
      tag_handling: "xml",
      ignore_tags: [IGNORE_TAG],
      ...(glossaryId ? { glossary_id: glossaryId } : {}),
      // UI chrome: buttons and labels, not prose. Keep line structure.
      split_sentences: "nonewlines",
      preserve_formatting: true,
    }),
  });
  if (!res.ok) {
    // Never echo the request headers here -- they carry the key.
    const body = await res.text().catch(() => "");
    throw new Error(`DeepL ${res.status} ${res.statusText} for ${target}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.translations.map((t) => t.text);
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Numbers in a factual sentence are load-bearing: "176 icons", "12x12
// pixels -- 144 dots", "3 kilobytes". A machine translator that drops or
// alters one turns a true statement false, and neither the token check nor
// the emoji check can see it. So every figure in the source must appear in
// the output, in the same order.
//
// Locales legitimately REFORMAT numbers -- French and Russian use a comma
// for the decimal mark and a space for digit grouping, so "1,500.5" may
// correctly come back as "1 500,5". That is a formatting difference, not a
// dropped figure, so comparison happens on normalized values and a raw
// difference is reported separately rather than failing the run.
const NUMBER_RE = /\d[\d.,\u00A0\u202F\u2009\u2007]*\d|\d/g;

function normalizeNumber(tok) {
  // Strip every kind of space used for digit grouping.
  let s = tok.replace(/[\u00A0\u202F\u2009\u2007 ]/g, "");
  // 1.234.567 or 1,234,567 -> grouping separators, remove them.
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return s.replace(/[.,]/g, "");
  // Otherwise a single separator is a decimal mark; normalize it to a dot.
  s = s.replace(/,/g, ".");
  // Trim a trailing separator ("5." from "5.")
  return s.replace(/\.$/, "");
}

// "1998-99" and "1998-1999" are the same range; Russian and French routinely
// expand the abbreviated form. Expanding BOTH sides before comparing means
// that reads as identical rather than as 99 having become 1999.
function expandYearRanges(str) {
  return str.replace(/\b(\d{2})(\d{2})\s*[\u2013\u2014-]\s*(\d{2})\b(?!\d)/g, "$1$2-$1$3");
}

function numberSequence(str) {
  return (expandYearRanges(str).match(NUMBER_RE) || []).map((t) =>
    t.replace(/[\u00A0\u202F\u2009\u2007 ]/g, ""),
  );
}

// French and Russian often group digits with an ORDINARY space ("1 500").
// That can't go in NUMBER_RE, or "12 144 dots" would silently merge into one
// number. So it's a second, permissive reading tried only when the strict one
// doesn't match: a plain space counts as grouping only when what follows is
// exactly three digits not followed by another digit.
function numberSequenceLoose(str) {
  const merged = str.replace(/(\d) (\d{3})(?!\d)/g, "$1$2");
  return numberSequence(merged);
}

function sortedNums(list) {
  return list.slice().sort();
}

// Some figures legitimately disappear in translation: "#1 most-used" becomes
// "the most used", "10th anniversary" becomes "décimo aniversario". The
// figure is gone but the claim is unchanged. Rather than loosen the check
// for everything, those keys are named one at a time in
// <bundle>.numeric-exempt.json, each with a written reason, so every
// exemption stays a deliberate and reviewable decision. Exempt keys still
// report their mismatch -- they just don't fail the run.
function validate(lang, source, out, numericExempt) {
  const problems = [];
  const formatNotes = [];
  for (const [key, en] of Object.entries(source)) {
    const got = out[key];
    if (typeof got !== "string" || got.length === 0) {
      problems.push(`${key}: missing or empty in output`);
      continue;
    }
    const srcTokens = (en.match(TOKEN_RE) || []).slice().sort();
    const outTokens = (got.match(TOKEN_RE) || []).slice().sort();
    if (!sameMultiset(srcTokens, outTokens)) {
      problems.push(
        `${key}: placeholder mismatch -- source has [${srcTokens.join(", ")}], output has [${outTokens.join(", ")}]\n      en: ${en}\n      ${lang}: ${got}`,
      );
    }
    const srcNums = numberSequence(en);
    const outNums = numberSequence(got);
    const srcNorm = srcNums.map(normalizeNumber);
    const outNorm = outNums.map(normalizeNumber);
    // Pass/fail is on the SET of figures, not their order. Dropping or
    // altering a number is an error; reordering is not -- translating
    // "iOS 5 in 2011" into Russian naturally yields "in 2011, with iOS 5",
    // and failing that would be a false alarm on correct output. Order
    // differences are reported instead, alongside formatting ones.
    let matched = sameMultiset(sortedNums(srcNorm), sortedNums(outNorm));
    let outShown = outNums;
    if (!matched) {
      const loose = numberSequenceLoose(got);
      if (sameMultiset(sortedNums(srcNorm), sortedNums(loose.map(normalizeNumber)))) {
        matched = true;
        outShown = loose; // grouped with plain spaces -- a format difference
      }
    }
    if (!matched) {
      const line = `${key}: number mismatch -- source has [${srcNums.join(", ") || "none"}], output has [${outNums.join(", ") || "none"}]\n      en: ${en}\n      ${lang}: ${got}`;
      if (numericExempt && Object.prototype.hasOwnProperty.call(numericExempt, key)) {
        formatNotes.push(`${key}: EXEMPT (${numericExempt[key]})  [${srcNums.join(", ") || "none"}] -> [${outNums.join(", ") || "none"}]`);
      } else {
        problems.push(line);
      }
    } else if (srcNums.join("|") !== outShown.join("|")) {
      // Same figures, different presentation or clause order -- correct
      // localization, but surfaced so a reviewer can confirm it at a glance.
      const reordered = sortedNums(srcNums).join("|") === sortedNums(outShown).join("|");
      formatNotes.push(
        `${key}: ${srcNums.join(", ")} -> ${outShown.join(", ")}${reordered ? "  (reordered)" : ""}`,
      );
    }

    const srcEmoji = emojiCodepoints(en);
    const outEmoji = emojiCodepoints(got);
    if (!sameMultiset(srcEmoji, outEmoji)) {
      const fmt = (cps) => cps.map((c) => String.fromCodePoint(c)).join(" ") || "(none)";
      problems.push(
        `${key}: emoji mismatch -- source has ${fmt(srcEmoji)}, output has ${fmt(outEmoji)}\n      en: ${en}\n      ${lang}: ${got}`,
      );
    }
  }
  return { problems, formatNotes };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

async function main() {
  const key = process.env.DEEPL_API_KEY;
  if (!key) {
    console.error(
      "DEEPL_API_KEY is not set.\n" +
        "  node --env-file=$HOME/.config/qmoji/deepl.env scripts/translate.mjs\n" +
        "  The key lives outside every repo on purpose -- don't copy it in here.\n" +
        "  Free-tier keys end in ':fx' and are routed to api-free.deepl.com automatically.",
    );
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  // --force re-translates everything even when the English is unchanged.
  // Needed when something OTHER than the source text changes the output:
  // a new glossary, a change to how placeholders are protected, a fix to
  // the quote-artifact repair.
  const force = argv.includes("--force");
  const bundleArg = argv.find((a) => a.startsWith("--bundle="));
  const bundle = bundleArg ? bundleArg.slice("--bundle=".length) : "";
  const P = bundlePaths(bundle);
  const requested = argv.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

  const source = readJson(P.source);
  if (!source) throw new Error(`missing source file: ${P.source}`);
  // Optional, per bundle. Absent means no exemptions.
  const numericExempt = readJson(P.numericExempt, {}) || {};


  const langs = requested.length ? requested : Object.keys(TARGETS);
  for (const l of langs) {
    if (!TARGETS[l]) throw new Error(`unknown language "${l}" -- known: ${Object.keys(TARGETS).join(", ")}`);
  }

  mkdirSync(LOCALES, { recursive: true });
  console.log(
    `source: ${Object.keys(source).length} keys${bundle ? ` [${bundle}]` : ""}  ->  ${langs.join(", ")}`,
  );

  const glossarySupport = await supportedGlossaryTargets(key);
  const glossaryCache = readJson(GLOSSARY_CACHE, {}) || {};

  let failed = 0;
  for (const lang of langs) {
    const outPath = P.out(lang);
    const overridesPath = P.overrides(lang);
    // READ ONLY. This script must never write this file.
    const overrides = readJson(overridesPath, {}) || {};
    const previous = readJson(outPath, {}) || {};
    const glossary = await acquireGlossary(key, lang, glossarySupport);
    if (glossary) glossaryCache[lang] = { id: glossary.id, hash: glossary.hash };
    const snapshotPath = P.snapshot(lang);
    const previousSnapshot = readJson(snapshotPath, {}) || {};
    const previousEn = previousSnapshot.strings || {};
    // A glossary change alters the output without altering the English, so
    // it has to invalidate the cache the same way an English edit does --
    // otherwise the new vocabulary silently never gets applied.
    const glossaryStamp = glossary ? glossary.hash : "none";
    const glossaryChanged = previousSnapshot.glossary !== glossaryStamp;
    if (glossaryChanged && Object.keys(previousEn).length) {
      console.log(`[${lang}] glossary changed -- re-translating all keys`);
    }

    // Only send keys whose English changed since the snapshot, or that we
    // have no previous translation for. Overridden keys are never sent --
    // the human answer already exists, so spending an API call on it would
    // be pure waste.
    const stale = [];
    for (const [k, en] of Object.entries(source)) {
      if (DO_NOT_TRANSLATE.has(k)) continue; // passed through verbatim below
      if (Object.prototype.hasOwnProperty.call(overrides, k)) continue;
      if (!force && !glossaryChanged && typeof previous[k] === "string" && previousEn[k] === en) continue;
      stale.push(k);
    }

    // Count only overrides that actually apply. The overrides file carries
    // a "_readme" key explaining the rule, and keys that no longer exist in
    // en.json are inert too -- reporting either as an active override would
    // misrepresent how much of this locale is hand-corrected.
    const activeOverrides = Object.keys(overrides).filter((k) =>
      Object.prototype.hasOwnProperty.call(source, k),
    ).length;
    console.log(
      `\n[${lang}] ${stale.length} key(s) to translate, ${activeOverrides} override(s), ` +
        `glossary ${glossary ? "yes" : "no"}`,
    );

    let fresh = {};
    if (stale.length) {
      // ORDER MATTERS: escape the content FIRST, then wrap in <x> tags.
      // Doing it the other way round escapes the tags we just added, so
      // DeepL receives literal "&lt;x&gt;" text, ignore_tags never fires,
      // and every placeholder gets translated. Ask how I know.
      const protectedSources = stale.map((k) => protect(escapeXml(source[k])));
      const payload = protectedSources;
      let translated;
      try {
        translated = await deeplTranslate(key, payload, TARGETS[lang], glossary && glossary.id);
      } catch (e) {
        console.error(`[${lang}] FAILED: ${e.message}`);
        failed++;
        continue;
      }
      stale.forEach((k, i) => {
        // Repair quote artifacts while the tags are still in place (span
        // boundaries are exact there), comparing against what the source
        // actually quoted. Then strip our real tags, then unescape -- in
        // that order, so a literal "<x>" from the source text is never
        // mistaken for one of our markers.
        const repaired = fixQuoteArtifacts(
          translated[i],
          quotedSpansInSource(protectedSources[i]),
          lang,
        );
        fresh[k] = unescapeXml(unprotect(repaired))
          .replace(/ {2,}/g, " ") // collapse gaps left by removed quotes
          .trim();
      });
    }

    // Assemble in the SOURCE's key order so diffs stay readable:
    // override > freshly translated > previously translated.
    const out = {};
    const snapshot = {};
    for (const k of Object.keys(source)) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) {
        out[k] = overrides[k];
      } else if (DO_NOT_TRANSLATE.has(k)) {
        out[k] = source[k];
      } else if (Object.prototype.hasOwnProperty.call(fresh, k)) {
        out[k] = fresh[k];
      } else if (typeof previous[k] === "string") {
        out[k] = previous[k];
      }
      snapshot[k] = source[k];
    }

    const { problems, formatNotes } = validate(lang, source, out, numericExempt);
    if (formatNotes.length) {
      // Not a failure: the figures match, the locale just writes them
      // differently. Surfaced so a reviewer can tell this apart from a
      // dropped number at a glance.
      console.log(`[${lang}] ${formatNotes.length} number(s) reformatted by locale convention:`);
      for (const n of formatNotes) console.log(`    ${n}`);
    }
    if (problems.length) {
      console.error(`\n[${lang}] VALIDATION FAILED -- ${outPath} NOT written:`);
      for (const p of problems) console.error(`  - ${p}`);
      failed++;
      continue;
    }

    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
    // Snapshot of the English each translation was made from -- this is
    // what makes re-runs idempotent and change-scoped. Dotfile, committed
    // alongside the locale so a fresh clone re-runs cleanly.
    writeFileSync(
      snapshotPath,
      JSON.stringify({ glossary: glossaryStamp, strings: snapshot }, null, 2) + "\n",
      "utf8",
    );
    console.log(`[${lang}] wrote ${outPath} (${Object.keys(out).length} keys, validated)`);
  }

  writeFileSync(GLOSSARY_CACHE, JSON.stringify(glossaryCache, null, 2) + "\n", "utf8");

  if (failed) {
    console.error(`\n${failed} language(s) failed. Nothing was written for those.`);
    process.exit(1);
  }
  console.log("\nAll languages written and validated.");
}

// Exported so the pure logic (token/emoji protection and validation) can
// be exercised by a test without performing a translation run.
export { protect, unprotect, escapeXml, unescapeXml, emojiCodepoints, validate, apiBase, quotedSpansInSource, fixQuoteArtifacts, DO_NOT_TRANSLATE };

// Only run when invoked directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
