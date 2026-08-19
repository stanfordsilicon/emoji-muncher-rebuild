# Emoji Munchers

Part of the QMoji arcade suite. Launched from the QMoji 2.0 homescreen,
which passes room/player state and both language choices on the URL.

```bash
npm install
npm run dev        # http://localhost:3131
```

## The two languages are not the same thing

This trips people up, so it is worth stating plainly:

| | URL param | localStorage | What it means |
|---|---|---|---|
| **Interface language** | `uiLang` | `qmoji.uiLang` | The language the UI chrome renders in |
| **Gameplay language** | `lang` | `qmoji.lang` | The language emoji keywords are in |

They are independent and must never be merged. A player can play with
Japanese keywords while reading a French interface. This README is about
`uiLang` only; `lang` is gameplay data and is untouched by any of it.

## Interface language codes

Canonical set: `en`, `fr`, `es`, `pt-br`, `pt-pt`, `ru`.

**Codes are lowercase-with-hyphens everywhere** — filenames, URL params,
localStorage values, comparisons. This is not a style preference. A code
becomes a filename (`locales/pt-br.json`), and while macOS is
case-insensitive, the Vercel build environment is not: a file named
`pt-BR.json` works on your laptop and 404s in production.

`normalizeLang()` in `public/i18n.js` enforces this on everything
arriving from a URL or from storage: lowercase, underscores to hyphens,
then the bare `pt` → `pt-br` alias. The alias exists because the
homescreen's picker only offers generic "pt"; there is deliberately no
`pt.json`. `public/arcade-client.js` applies the same normalization
before writing `qmoji.uiLang`, so a hand-typed `?uiLang=PT-BR` cannot
poison storage.

Try it: `http://localhost:3131/?uiLang=fr`

## How the strings load

`public/locales/en.json` is the **single source of truth** for UI text.
There is no second copy (the old `i18n-source/en.json` is gone).

`i18n.js` fetches English plus the resolved language before anything
renders. `index.html` carries `class="i18n-loading"` on `<html>`,
which hides the document until `applyStaticTranslations()` removes it —
otherwise the first paint would flash raw `snake_case` keys. `client.js`
is gated on the `initI18n()` promise for the same reason. `initI18n()`
never rejects: a missing locale degrades to English rather than leaving a
blank page.

Lookup falls back **per key**. A key missing from `fr.json` renders the
English string, never the raw key.

## Regenerating translations

```bash
node --env-file=$HOME/.config/qmoji/deepl.env scripts/translate.mjs        # all languages
node --env-file=$HOME/.config/qmoji/deepl.env scripts/translate.mjs fr ru  # just these
```

The key lives in `~/.config/qmoji/deepl.env` (mode 0600), **deliberately
outside every repo** so it cannot be committed by accident -- not in a
repo-local `.env`, not in a shell profile. `--env-file` loads it into the
process environment for that one command; the script reads
`process.env.DEEPL_API_KEY` and never writes it anywhere.

That file holds a single line:

```
DEEPL_API_KEY=<your key>
```

Free-tier DeepL keys end in `:fx` and are routed to `api-free.deepl.com`
automatically; everything else goes to `api.deepl.com`. **Never copy the key
into this repo, a shell profile, or any committed file.** (`.env` is
gitignored here as a second line of defence, not as the intended home.)

The script is idempotent: it only re-translates keys whose English actually
changed (tracked by a `.<lang>.en-snapshot.json` file), so re-running with
no source edits produces no diff.

Before writing any file it **validates** that every `{placeholder}` token
and every emoji in the output matches the English source exactly. On a
mismatch it names the offending key and writes nothing for that language.

## Fixing a bad translation

**Do not edit `public/locales/<lang>.json`.** It is machine-generated and
overwritten on the next run.

Add the key to **`public/locales/<lang>.overrides.json`** instead. The
generator reads that file and merges it on top of DeepL's output, overrides
winning, and never writes to it. For example, in `fr.overrides.json`:

```json
{
  "play_button": "Jouer"
}
```

Overrides are validated on the same terms as generated text: if the English
has `{score}` or an emoji, the override must have it too.

## Glossary

Recurring game vocabulary is pinned by a DeepL glossary so it stops being
re-decided per string — "room" is a multiplayer session (not a bedroom),
"host" is one word per language (French previously used three), "score"
doesn't drift to "result".

Terms live in **`scripts/glossary.json`**, which is committed. The script
creates the glossary from that file and caches the returned ids in
`.deepl-glossaries.json` (gitignored — ids are account-scoped). Editing
`glossary.json` changes its content hash, which automatically invalidates
the cache and re-translates that language on the next run.

Two constraints worth knowing:

- **DeepL's Free tier allows only one glossary on the account at a time.**
  The script therefore acquires them one at a time, deleting the glossary
  it previously created before making the next. It only ever deletes
  glossaries named `qmoji-*`; anything else on the account is left alone.
- **DeepL has no `EN→PT-BR` / `EN→PT-PT` glossary pair, only `EN→PT`.** So
  pt-br and pt-pt each get their own `EN→PT` glossary with different
  entries, selected by target. That is what keeps *rodada* and *ronda*
  apart. If a language has no supported pair at all, the script says so and
  translates without one — pin that language's vocabulary via overrides
  instead.

Glossary entries influence agreement, so a badly chosen term can cause new
errors: French `round → manche` produced *"du manche"* (manche is feminine)
until it was changed to the masculine `tour`. Prefer a term whose gender
matches how it will be used.

## Strings that must not be translated

`DO_NOT_TRANSLATE` in `scripts/translate.mjs` lists keys copied verbatim
into every language and never sent to DeepL. Product names belong here —
`app_title` is on the list because translating it produced a different game
name in each language.

To add a key: add its name to that Set and re-run. The next run overwrites
the generated value with the English one.

## Provenance

`TRANSLATION_NOTES.md` records every overridden string: the language, what
was wrong with the machine output, the replacement, and a review status.
Entries default to `claude-corrected, unverified` and should only be moved
to `human-verified` by someone who speaks the language.

## Adding a language

1. `node scripts/translate.mjs <code>` (after adding it to `TARGETS` in
   the script, mapped to DeepL's target code).
2. Create an empty `<code>.overrides.json`.

No change to `i18n.js` is needed. A language is considered available if
`locales/<code>.json` loads — availability is a fact about the filesystem,
not a list baked into the code.
