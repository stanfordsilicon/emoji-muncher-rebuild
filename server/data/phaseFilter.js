"use strict";

// Background-refreshed cache of qmoji-2's Phase-system emoji restriction
// (GET /api/emoji-rules?lang=, same endpoint Blaster/Mindreader read), per
// Game Language. Deliberately synchronous to *read* (getAllowedSet) so
// nothing on the gameplay hot path (round generation, every move) ever
// blocks on qmoji-2 being slow or unreachable -- a language with no cached
// result yet plays completely unfiltered, exactly as it did before this
// file existed, until a background fetch (see refreshInBackground) fills
// it in for next time.

// Defaults to real production qmoji-2 rather than localhost -- this process
// is a production deployment far more often than it's a local dev instance
// with QMOJI_ADMIN_BASE_URL unset, so "can't reach it, fall back to
// unfiltered" (the safe behavior either way) should be the rare case, not
// the default one every production deploy hits until someone remembers to
// set the env var. Local dev that wants its own local qmoji-2 still just
// sets QMOJI_ADMIN_BASE_URL=http://localhost:5500 to override this.
const QMOJI_ADMIN_BASE_URL = process.env.QMOJI_ADMIN_BASE_URL || "https://qmoji.org";
const FRESH_TTL_MS = 5 * 60 * 1000; // phase assignments change rarely -- no need to refetch often
const FETCH_TIMEOUT_MS = 3000;

// lang -> { fetchedAt, allowedSet: Set<string>|null, version }
// allowedSet is null for "no restriction" (either genuinely unassigned in
// Admin, or not fetched yet) -- version bumps only when a real fetch lands,
// so callers can cache derived work (e.g. a filtered ConceptRepository) and
// know exactly when to rebuild it.
const cache = new Map();
let nextVersion = 1;

async function fetchAllowedEmojis(lang) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${QMOJI_ADMIN_BASE_URL}/api/emoji-rules?lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return undefined; // undefined = fetch failed, leave the cache exactly as it was
    const data = await res.json();
    if (!data || !data.ok) return undefined;
    // data.emojis is null for "this language has no Phase assignment" --
    // that's a real, valid answer (not a failure), so it's cached as null
    // same as the "not fetched yet" default.
    return Array.isArray(data.emojis) ? new Set(data.emojis) : null;
  } catch (e) {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Fire-and-forget: kicks off a background refresh if this language's entry
// is missing or stale. Never awaited by a caller on the gameplay path --
// callers just call this once and then read getAllowedSet() synchronously,
// which reflects whatever the *previous* fetch (if any) found.
function refreshInBackground(lang) {
  const entry = cache.get(lang);
  const now = Date.now();
  if (entry && now - entry.fetchedAt < FRESH_TTL_MS) return;
  // Mark as just-checked immediately (not after the fetch resolves) so a
  // burst of requests for the same language in the same instant doesn't
  // all fire their own fetch.
  if (entry) entry.fetchedAt = now;
  else cache.set(lang, { fetchedAt: now, allowedSet: null, version: 0 });

  fetchAllowedEmojis(lang)
    .then((result) => {
      if (result === undefined) return; // fetch failed -- leave whatever's cached alone
      cache.set(lang, { fetchedAt: Date.now(), allowedSet: result, version: nextVersion++ });
    })
    .catch(() => {});
}

function getAllowedSet(lang) {
  const entry = cache.get(lang);
  return entry ? entry.allowedSet : null;
}

function getVersion(lang) {
  const entry = cache.get(lang);
  return entry ? entry.version : 0;
}

module.exports = { refreshInBackground, getAllowedSet, getVersion };
