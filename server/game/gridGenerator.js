"use strict";

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function manhattan(cell, corner) {
  return Math.abs(cell.col - corner.col) + Math.abs(cell.row - corner.row);
}

// Players always spawn at one of these four corners (see GameRoom's CORNERS).
function spawnCorners(cols, rows) {
  return [
    { col: 0, row: 0 },
    { col: cols - 1, row: 0 },
    { col: 0, row: rows - 1 },
    { col: cols - 1, row: rows - 1 },
  ];
}

/**
 * Random placement alone can (unluckily) put every correct-matching cell far
 * from a player's spawn corner, forcing several guaranteed-wrong munches
 * before they can even reach a real match -- a "spawn killed" round that was
 * never fair to begin with. This repairs that: for each spawn corner, if no
 * correct cell exists within `radius` moves, it converts the nearest cell in
 * that zone into a correct match. The corner cell itself is never touched
 * since a player's starting cell is never auto-munched.
 */
function ensureReachableFromEverySpawn(grid, { cols, rows, keyword, matchingSymbols, emojiRepository, radius }) {
  if (matchingSymbols.length === 0) return;

  for (const corner of spawnCorners(cols, rows)) {
    const zone = grid.filter((c) => {
      const d = manhattan(c, corner);
      return d >= 1 && d <= radius;
    });
    if (zone.length === 0) continue;

    const alreadyReachable = zone.some((c) => emojiRepository.isMatch(c.symbol, keyword));
    if (alreadyReachable) continue;

    zone.sort((a, b) => manhattan(a, corner) - manhattan(b, corner));
    const target = zone[0];
    target.symbol = matchingSymbols[Math.floor(Math.random() * matchingSymbols.length)];
  }
}

/**
 * Builds one round: a keyword plus a COLS x ROWS grid of emoji symbols,
 * with a controlled number of cells that correctly match the keyword
 * (per emojiRepository, the backend database) so rounds are never
 * unwinnable (0 matches) or trivial (nearly every cell matches), and never
 * unfairly stack every wrong cell right around a player's spawn point.
 */
function generateRound(emojiRepository, { cols, rows, minMatches, maxMatches, spawnSafeRadius = 2 }) {
  const keyword = emojiRepository.pickKeyword(minMatches);
  const matchingSymbols = emojiRepository.getMatchingSymbols(keyword);
  const allSymbols = emojiRepository.getAllSymbols();
  const wrongSymbols = allSymbols.filter((s) => !matchingSymbols.includes(s));

  const totalCells = cols * rows;
  const targetCorrect = Math.min(
    totalCells,
    Math.max(1, randomBetween(minMatches, Math.min(maxMatches, matchingSymbols.length > 0 ? totalCells : minMatches)))
  );

  const cellSymbols = [];
  for (let i = 0; i < targetCorrect; i++) {
    cellSymbols.push(matchingSymbols[Math.floor(Math.random() * matchingSymbols.length)]);
  }
  for (let i = targetCorrect; i < totalCells; i++) {
    const pool = wrongSymbols.length > 0 ? wrongSymbols : allSymbols;
    cellSymbols.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  const shuffled = shuffle(cellSymbols);
  const grid = [];
  let idx = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      grid.push({ col, row, symbol: shuffled[idx++] });
    }
  }

  ensureReachableFromEverySpawn(grid, { cols, rows, keyword, matchingSymbols, emojiRepository, radius: spawnSafeRadius });

  // Recount from the final grid -- the safe-spawn repair above can add
  // correct cells beyond targetCorrect, so this is the only accurate figure.
  const correctCount = grid.filter((c) => emojiRepository.isMatch(c.symbol, keyword)).length;

  return { keyword, grid, correctCount };
}

module.exports = { generateRound, shuffle, randomBetween };
