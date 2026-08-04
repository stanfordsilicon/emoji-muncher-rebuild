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

/**
 * Builds one round: a keyword plus a COLS x ROWS grid of emoji symbols,
 * with a controlled number of cells that correctly match the keyword
 * (per emojiRepository, the backend database) so rounds are never
 * unwinnable (0 matches) or trivial (nearly every cell matches).
 */
function generateRound(emojiRepository, { cols, rows, minMatches, maxMatches }) {
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

  return { keyword, grid, correctCount: targetCorrect };
}

module.exports = { generateRound, shuffle, randomBetween };
