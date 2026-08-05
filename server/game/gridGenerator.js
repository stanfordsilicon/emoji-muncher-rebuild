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

const NEIGHBOR_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function key(col, row) {
  return `${col},${row}`;
}

function manhattan(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
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
 * Grows one connected region of `size` cells via random walk from a roughly
 * central seed, so every correct-matching cell ends up reachable from every
 * other correct cell without crossing a single poison cell. This is what
 * makes the board solvable at all: once a player reaches this region, they
 * can clear every remaining correct cell for free.
 */
function growConnectedBlob(cols, rows, size) {
  const seed = {
    col: Math.min(cols - 1, Math.max(0, Math.floor(cols / 2) + randomBetween(-1, 1))),
    row: Math.min(rows - 1, Math.max(0, Math.floor(rows / 2) + randomBetween(-1, 1))),
  };
  const blob = new Map(); // key -> {col,row}
  blob.set(key(seed.col, seed.row), seed);
  const frontier = new Map(); // key -> {col,row}, candidates adjacent to the blob

  const addFrontierNeighbors = (cell) => {
    for (const [dc, dr] of NEIGHBOR_DELTAS) {
      const nc = cell.col + dc;
      const nr = cell.row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const k = key(nc, nr);
      if (!blob.has(k)) frontier.set(k, { col: nc, row: nr });
    }
  };
  addFrontierNeighbors(seed);

  while (blob.size < size && frontier.size > 0) {
    const candidates = [...frontier.values()];
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const k = key(pick.col, pick.row);
    frontier.delete(k);
    blob.set(k, pick);
    addFrontierNeighbors(pick);
  }

  return blob;
}

/**
 * Builds a monotonic (Manhattan-shortest) path of cells from `from` to `to`,
 * not including `from`, moving one axis at a time.
 */
function pathBetween(from, to) {
  const path = [];
  let col = from.col;
  let row = from.row;
  while (col !== to.col || row !== to.row) {
    if (col !== to.col) col += Math.sign(to.col - col);
    else row += Math.sign(to.row - row);
    path.push({ col, row });
  }
  return path;
}

/**
 * A round is only fair if a player can actually reach the safe region and
 * clear it without their lives running out first. For each spawn corner,
 * this finds the shortest path to the nearest cell of the safe blob; if that
 * distance would force more poison hits than the lives budget allows, it
 * extends the blob along that path (starting from the blob's end) until the
 * remaining unclaimed stretch is short enough to survive -- i.e. it "carves
 * a path" from spawn to the safe region rather than leaving it to chance.
 */
function ensureEveryCornerCanReachBlob(blob, { cols, rows, maxDistance }) {
  for (const corner of spawnCorners(cols, rows)) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const cell of blob.values()) {
      const d = manhattan(cell, corner);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = cell;
      }
    }
    if (!nearest || nearestDist <= maxDistance) continue;

    const path = pathBetween(corner, nearest); // length === nearestDist
    const cellsToClaim = nearestDist - maxDistance;
    // Claim the cells closest to the existing blob first, extending it
    // backward toward the corner just far enough to fit the lives budget.
    for (let i = path.length - 1; i >= path.length - cellsToClaim; i--) {
      const cell = path[i];
      blob.set(key(cell.col, cell.row), cell);
    }
  }
}

/**
 * Difficulty stats for the "Difficulty" CSV category. `numberOfSafePaths` has
 * no single agreed-upon definition for a free-roam (not turn-by-turn maze)
 * board, so it's approximated here as the count of 4-connected clusters of
 * correct cells -- i.e. how many separate "safe regions" a player has to
 * find, rather than true path enumeration. By construction this is normally
 * 1 (a single connected safe region plus whatever corner-reachability arms
 * were carved onto it). avgSafeChoicesPerMove and narrowPathIndicator are
 * exact given that approximation.
 */
function computeDifficultyStats(grid, keyword, emojiRepository, cols, rows) {
  const byKey = new Map(grid.map((c) => [key(c.col, c.row), c]));
  const isCorrect = (c) => emojiRepository.isMatch(c.symbol, keyword);
  const correctCells = grid.filter(isCorrect);

  const neighborCorrectCounts = correctCells.map((c) => {
    let n = 0;
    for (const [dc, dr] of NEIGHBOR_DELTAS) {
      const nb = byKey.get(key(c.col + dc, c.row + dr));
      if (nb && isCorrect(nb)) n += 1;
    }
    return n;
  });

  const avgSafeChoicesPerMove =
    neighborCorrectCounts.length > 0
      ? neighborCorrectCounts.reduce((a, b) => a + b, 0) / neighborCorrectCounts.length
      : 0;
  const narrowPathIndicator = correctCells.length > 0 && Math.min(...neighborCorrectCounts) <= 1;

  const visited = new Set();
  let safeClusterCount = 0;
  for (const start of correctCells) {
    const startKey = key(start.col, start.row);
    if (visited.has(startKey)) continue;
    safeClusterCount += 1;
    const stack = [start];
    visited.add(startKey);
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const [dc, dr] of NEIGHBOR_DELTAS) {
        const nbKey = key(cur.col + dc, cur.row + dr);
        const nb = byKey.get(nbKey);
        if (nb && isCorrect(nb) && !visited.has(nbKey)) {
          visited.add(nbKey);
          stack.push(nb);
        }
      }
    }
  }

  const totalCells = cols * rows;
  return {
    safeRatio: correctCells.length / totalCells,
    poisonRatio: (totalCells - correctCells.length) / totalCells,
    avgSafeChoicesPerMove,
    narrowPathIndicator,
    safeClusterCount,
  };
}

/**
 * Builds one round: a keyword plus a COLS x ROWS grid of emoji symbols, with
 * a controlled number of cells that correctly match the keyword (per
 * emojiRepository, the backend database). Correct cells are grown as one
 * connected region rather than scattered independently, and every spawn
 * corner is guaranteed a lives-budget-bounded path to that region -- so a
 * round can never be lost purely to unlucky placement; clearing the whole
 * board is always possible with optimal play.
 */
function generateRound(emojiRepository, { cols, rows, minMatches, maxMatches, spawnSafeRadius = 2, startingLives = 3 }) {
  const keyword = emojiRepository.pickKeyword(minMatches);
  const matchingSymbols = emojiRepository.getMatchingSymbols(keyword);
  const allSymbols = emojiRepository.getAllSymbols();
  const wrongSymbols = allSymbols.filter((s) => !matchingSymbols.includes(s));

  const totalCells = cols * rows;
  const targetCorrect =
    matchingSymbols.length === 0
      ? 0
      : Math.min(totalCells, Math.max(1, randomBetween(minMatches, Math.min(maxMatches, totalCells))));

  const blob = targetCorrect > 0 ? growConnectedBlob(cols, rows, targetCorrect) : new Map();

  // Never require more poison hits to reach the safe region than the player
  // can actually survive.
  const maxDistance = Math.max(1, Math.min(spawnSafeRadius, startingLives - 1));
  if (blob.size > 0) {
    ensureEveryCornerCanReachBlob(blob, { cols, rows, maxDistance });
  }

  const grid = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isSafe = blob.has(key(col, row));
      const pool = isSafe ? matchingSymbols : wrongSymbols.length > 0 ? wrongSymbols : allSymbols;
      grid.push({ col, row, symbol: pool[Math.floor(Math.random() * pool.length)] });
    }
  }

  // Recount from the final grid to stay honest about what's actually there.
  const correctCount = grid.filter((c) => emojiRepository.isMatch(c.symbol, keyword)).length;
  const difficulty = computeDifficultyStats(grid, keyword, emojiRepository, cols, rows);

  return { keyword, grid, correctCount, difficulty };
}

module.exports = { generateRound, shuffle, randomBetween };
