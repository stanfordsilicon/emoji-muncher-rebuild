#!/usr/bin/env node
// Generates public/locales/<lang>.json from public/locales/en.json via DeepL.
//
//   DEEPL_API_KEY=... node scripts/translate.mjs            # all languages
//   DEEPL_API_KEY=... node scripts/translate.mjs fr pt-br   # just these
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
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = join(HERE, "..", "public", "locales");
const SOURCE = join(LOCALES, "en.json");

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

async function deeplTranslate(key, texts, target) {
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

function validate(lang, source, out) {
  const problems = [];
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
    const srcEmoji = emojiCodepoints(en);
    const outEmoji = emojiCodepoints(got);
    if (!sameMultiset(srcEmoji, outEmoji)) {
      const fmt = (cps) => cps.map((c) => String.fromCodePoint(c)).join(" ") || "(none)";
      problems.push(
        `${key}: emoji mismatch -- source has ${fmt(srcEmoji)}, output has ${fmt(outEmoji)}\n      en: ${en}\n      ${lang}: ${got}`,
      );
    }
  }
  return problems;
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

  const source = readJson(SOURCE);
  if (!source) throw new Error(`missing source file: ${SOURCE}`);

  const requested = process.argv.slice(2).map((a) => a.toLowerCase());
  const langs = requested.length ? requested : Object.keys(TARGETS);
  for (const l of langs) {
    if (!TARGETS[l]) throw new Error(`unknown language "${l}" -- known: ${Object.keys(TARGETS).join(", ")}`);
  }

  mkdirSync(LOCALES, { recursive: true });
  console.log(`source: ${Object.keys(source).length} keys  ->  ${langs.join(", ")}`);

  let failed = 0;
  for (const lang of langs) {
    const outPath = join(LOCALES, `${lang}.json`);
    const overridesPath = join(LOCALES, `${lang}.overrides.json`);
    // READ ONLY. This script must never write this file.
    const overrides = readJson(overridesPath, {}) || {};
    const previous = readJson(outPath, {}) || {};
    const previousEn = readJson(join(LOCALES, `.${lang}.en-snapshot.json`), {}) || {};

    // Only send keys whose English changed since the snapshot, or that we
    // have no previous translation for. Overridden keys are never sent --
    // the human answer already exists, so spending an API call on it would
    // be pure waste.
    const stale = [];
    for (const [k, en] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) continue;
      if (typeof previous[k] === "string" && previousEn[k] === en) continue;
      stale.push(k);
    }

    // Count only overrides that actually apply. The overrides file carries
    // a "_readme" key explaining the rule, and keys that no longer exist in
    // en.json are inert too -- reporting either as an active override would
    // misrepresent how much of this locale is hand-corrected.
    const activeOverrides = Object.keys(overrides).filter((k) =>
      Object.prototype.hasOwnProperty.call(source, k),
    ).length;
    console.log(`\n[${lang}] ${stale.length} key(s) to translate, ${activeOverrides} override(s)`);

    let fresh = {};
    if (stale.length) {
      // ORDER MATTERS: escape the content FIRST, then wrap in <x> tags.
      // Doing it the other way round escapes the tags we just added, so
      // DeepL receives literal "&lt;x&gt;" text, ignore_tags never fires,
      // and every placeholder gets translated. Ask how I know.
      const payload = stale.map((k) => protect(escapeXml(source[k])));
      let translated;
      try {
        translated = await deeplTranslate(key, payload, TARGETS[lang]);
      } catch (e) {
        console.error(`[${lang}] FAILED: ${e.message}`);
        failed++;
        continue;
      }
      stale.forEach((k, i) => {
        // Mirror image: strip our real tags first, then unescape, so a
        // literal "<x>" that came from the source text is never mistaken
        // for one of our markers.
        fresh[k] = unescapeXml(unprotect(translated[i])).trim();
      });
    }

    // Assemble in the SOURCE's key order so diffs stay readable:
    // override > freshly translated > previously translated.
    const out = {};
    const snapshot = {};
    for (const k of Object.keys(source)) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) {
        out[k] = overrides[k];
      } else if (Object.prototype.hasOwnProperty.call(fresh, k)) {
        out[k] = fresh[k];
      } else if (typeof previous[k] === "string") {
        out[k] = previous[k];
      }
      snapshot[k] = source[k];
    }

    const problems = validate(lang, source, out);
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
    writeFileSync(join(LOCALES, `.${lang}.en-snapshot.json`), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`[${lang}] wrote ${outPath} (${Object.keys(out).length} keys, validated)`);
  }

  if (failed) {
    console.error(`\n${failed} language(s) failed. Nothing was written for those.`);
    process.exit(1);
  }
  console.log("\nAll languages written and validated.");
}

// Exported so the pure logic (token/emoji protection and validation) can
// be exercised by a test without performing a translation run.
export { protect, unprotect, escapeXml, unescapeXml, emojiCodepoints, validate, apiBase };

// Only run when invoked directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
