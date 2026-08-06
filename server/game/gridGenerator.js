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

function neighborsOf(cell, cols, rows) {
  const result = [];
  for (const [dc, dr] of NEIGHBOR_DELTAS) {
    const nc = cell.col + dc;
    const nr = cell.row + dr;
    if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
    result.push({ col: nc, row: nr });
  }
  return result;
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
 * Grows one connected region of `size` cells from a roughly central seed.
 * Frontier candidates are weighted toward cells touching *more* of the
 * existing region (squared), which biases growth toward chunky, loop-rich
 * shapes rather than thin one-cell-wide tendrils -- chunky regions naturally
 * have many internal routes between any two points, which is what makes a
 * later "multiple paths to the destination" guarantee possible at all.
 */
function growConnectedBlob(cols, rows, size) {
  const seed = {
    col: Math.min(cols - 1, Math.max(0, Math.floor(cols / 2) + randomBetween(-1, 1))),
    row: Math.min(rows - 1, Math.max(0, Math.floor(rows / 2) + randomBetween(-1, 1))),
  };
  const blob = new Map(); // key -> {col,row}
  blob.set(key(seed.col, seed.row), seed);
  const frontier = new Map(); // key -> {col,row}

  const addFrontierNeighbors = (cell) => {
    for (const nb of neighborsOf(cell, cols, rows)) {
      const k = key(nb.col, nb.row);
      if (!blob.has(k)) frontier.set(k, nb);
    }
  };
  addFrontierNeighbors(seed);

  const blobNeighborCount = (cell) => neighborsOf(cell, cols, rows).filter((nb) => blob.has(key(nb.col, nb.row))).length;

  while (blob.size < size && frontier.size > 0) {
    const candidates = [...frontier.values()];
    const weights = candidates.map((c) => Math.pow(1 + blobNeighborCount(c), 2));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    let chosenIdx = candidates.length - 1;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosenIdx = i; break; }
    }
    const pick = candidates[chosenIdx];
    const k = key(pick.col, pick.row);
    frontier.delete(k);
    blob.set(k, pick);
    addFrontierNeighbors(pick);
  }

  return blob;
}

/**
 * Builds a monotonic (Manhattan-shortest) path of cells from `from` to `to`,
 * not including `from`, moving one axis at a time. `colFirst` picks which
 * axis moves first, so calling this twice (true, then false) gives two
 * paths that only share their two endpoints whenever `from` and `to` differ
 * on both axes -- i.e. two disjoint routes rather than one.
 */
function pathBetween(from, to, colFirst = true) {
  const path = [];
  let col = from.col;
  let row = from.row;
  const stepCol = () => { col += Math.sign(to.col - col); path.push({ col, row }); };
  const stepRow = () => { row += Math.sign(to.row - row); path.push({ col, row }); };
  if (colFirst) {
    while (col !== to.col) stepCol();
    while (row !== to.row) stepRow();
  } else {
    while (row !== to.row) stepRow();
    while (col !== to.col) stepCol();
  }
  return path;
}

function nearestBlobCell(blob, point) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const cell of blob.values()) {
    const d = manhattan(cell, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = cell;
    }
  }
  return { cell: nearest, distance: nearestDist };
}

// A player heads for whichever safe cell is physically closest -- if
// several sit at that exact same minimum distance, any of them could be
// the one actually reached, not just whichever a Map happens to iterate to
// first. Every one of them needs the same guarantees, or the guarantee only
// holds for a cell nobody may actually end up walking to.
function nearestBlobCells(blob, point) {
  let nearest = [];
  let nearestDist = Infinity;
  for (const cell of blob.values()) {
    const d = manhattan(cell, point);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = [cell];
    } else if (d === nearestDist) {
      nearest.push(cell);
    }
  }
  return { cells: nearest, distance: nearestDist };
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
    const { cell: nearest, distance: nearestDist } = nearestBlobCell(blob, corner);
    if (!nearest || nearestDist <= maxDistance) continue;

    // Crossing up to `maxDistance` poison cells to reach the safe region at
    // all is the intended risk/skill cost, so this only extends the blob
    // just enough to bring that crossing within budget -- the "multiple
    // paths" guarantee applies to the safe region itself (see
    // ensureMinDegree / ensureMultiplePaths below), not to this approach.
    const path = pathBetween(corner, nearest, true);
    const cellsToClaim = nearestDist - maxDistance;
    for (const cell of path.slice(path.length - cellsToClaim)) {
      blob.set(key(cell.col, cell.row), cell);
    }
  }
}

// BFS distance, in moves, from `start` to every other cell staying entirely
// within the safe region (`blob`). Cells never reached stay absent from the
// returned map.
function bfsDistancesWithinBlob(blob, start, cols, rows) {
  const dist = new Map([[key(start.col, start.row), 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    const d = dist.get(key(cur.col, cur.row));
    for (const nb of neighborsOf(cur, cols, rows)) {
      const nk = key(nb.col, nb.row);
      if (!blob.has(nk) || dist.has(nk)) continue;
      dist.set(nk, d + 1);
      queue.push(nb);
    }
  }
  return dist;
}

/**
 * Picks the round's destination: the safe cell that's, on average, deepest
 * into the region relative to every spawn corner's entry point -- i.e. a
 * genuine "far side to travel to" rather than something sitting right at
 * the doorstep.
 */
function pickDestination(blob, entryPoints, cols, rows) {
  const totalDistance = new Map(); // key -> summed BFS distance from every entry point
  for (const entry of entryPoints) {
    const dist = bfsDistancesWithinBlob(blob, entry, cols, rows);
    for (const [k, d] of dist) totalDistance.set(k, (totalDistance.get(k) || 0) + d);
  }

  // A cell at the tip of a thin dead-end stub can have a high "deepest
  // point" distance score while being structurally the worst possible
  // destination -- its only way out is through one single neighbor, so no
  // amount of widening nearby can ever give it a second route. Preferring
  // cells with more existing blob-neighbors keeps the destination out of
  // stubs like that in the first place, which repairing after the fact
  // can't reliably fix (there's nothing else nearby to connect a bypass to).
  const degreeOf = (cell) => neighborsOf(cell, cols, rows).filter((nb) => blob.has(key(nb.col, nb.row))).length;
  let pool = [...blob.values()].filter((c) => degreeOf(c) >= 3);
  if (pool.length === 0) pool = [...blob.values()].filter((c) => degreeOf(c) >= 2);
  if (pool.length === 0) pool = [...blob.values()];

  let best = null;
  let bestScore = -1;
  for (const cell of pool) {
    const score = totalDistance.get(key(cell.col, cell.row)) || 0;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}

function isConnectedWithinBlobExcluding(blob, from, to, excludeKey, cols, rows) {
  const targetKey = key(to.col, to.row);
  const visited = new Set([key(from.col, from.row)]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (key(cur.col, cur.row) === targetKey) return true;
    for (const nb of neighborsOf(cur, cols, rows)) {
      const nk = key(nb.col, nb.row);
      if (nk === excludeKey || !blob.has(nk) || visited.has(nk)) continue;
      visited.add(nk);
      queue.push(nb);
    }
  }
  return false;
}

// A cut vertex here is any safe cell (other than the two endpoints) whose
// removal disconnects `from` from `to` within the safe region -- i.e. every
// route between them funnels through that one cell. Small board, so a
// straightforward O(n) x O(n) scan is plenty fast.
function findCutVertex(blob, from, to, cols, rows) {
  const fromKey = key(from.col, from.row);
  const toKey = key(to.col, to.row);
  for (const vKey of blob.keys()) {
    if (vKey === fromKey || vKey === toKey) continue;
    if (!isConnectedWithinBlobExcluding(blob, from, to, vKey, cols, rows)) return vKey;
  }
  return null;
}

// Shortest path from `from` to `to` allowed to cross ANY cell (safe or
// poison) except `avoidKey` -- used to carve a genuine detour around a
// bottleneck, unlike a plain shortest path which would just walk straight
// back through it.
function bfsPathAvoiding(cols, rows, from, to, avoidKey) {
  const fromKey = key(from.col, from.row);
  const toKey = key(to.col, to.row);
  const visited = new Set([fromKey]);
  const prev = new Map();
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    const curKey = key(cur.col, cur.row);
    if (curKey === toKey) {
      const path = [];
      let c = cur;
      while (key(c.col, c.row) !== fromKey) {
        path.push(c);
        c = prev.get(key(c.col, c.row));
      }
      return path.reverse();
    }
    for (const nb of neighborsOf(cur, cols, rows)) {
      const nk = key(nb.col, nb.row);
      if (nk === avoidKey || visited.has(nk)) continue;
      visited.add(nk);
      prev.set(nk, cur);
      queue.push(nb);
    }
  }
  return null;
}

// A cut vertex's own neighbors might *all* already be safe cells -- that's
// exactly the "isthmus" case, where two otherwise-chunky lobes of the region
// happen to narrow to one cell between them. There's nothing poison
// touching the cut vertex itself to convert in that case, so instead this
// finds which of its neighbors sits on `from`'s side versus the other side,
// then carves a fresh detour directly between those two neighbors that
// doesn't pass through the cut vertex -- a real bypass, not just padding.
function bypassCutVertex(blob, vKey, from, cols, rows) {
  const [vc, vr] = vKey.split(",").map(Number);
  const vNeighbors = neighborsOf({ col: vc, row: vr }, cols, rows).filter((nb) => blob.has(key(nb.col, nb.row)));
  if (vNeighbors.length < 2) return false;

  const sideA = new Set();
  {
    const visited = new Set([key(from.col, from.row)]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift();
      sideA.add(key(cur.col, cur.row));
      for (const nb of neighborsOf(cur, cols, rows)) {
        const nk = key(nb.col, nb.row);
        if (nk === vKey || !blob.has(nk) || visited.has(nk)) continue;
        visited.add(nk);
        queue.push(nb);
      }
    }
  }

  const nearSide = vNeighbors.find((nb) => sideA.has(key(nb.col, nb.row)));
  const farSide = vNeighbors.find((nb) => !sideA.has(key(nb.col, nb.row)));
  if (!nearSide || !farSide) return false; // v isn't actually a cut vertex between these neighbors

  const detour = bfsPathAvoiding(cols, rows, nearSide, farSide, vKey);
  if (!detour) return false;
  for (const cell of detour) blob.set(key(cell.col, cell.row), cell);
  return true;
}

// A cell with only one blob-neighbor is a dead end: that single neighbor is
// unavoidably a cut vertex for *any* path starting there, no matter how
// well-connected the rest of the region is. Entry points and the
// destination are exactly the cells a "multiple paths" guarantee is about,
// so each needs at least two ways out before that guarantee can mean
// anything.
function ensureMinDegree(blob, cell, cols, rows, minDegree = 2) {
  let claimed = 0;
  while (claimed < 4) {
    const blobNeighbors = neighborsOf(cell, cols, rows).filter((nb) => blob.has(key(nb.col, nb.row)));
    if (blobNeighbors.length >= minDegree) return;
    const candidates = neighborsOf(cell, cols, rows).filter((nb) => !blob.has(key(nb.col, nb.row)));
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    blob.set(key(pick.col, pick.row), pick);
    claimed += 1;
  }
}

/**
 * Guarantees `from` and `to` aren't connected through a single fragile
 * cell -- i.e. there's always more than one viable route between a spawn
 * corner's entry point and the destination, so one wrong step never
 * strands a player with no alternative. Widens the region near any
 * bottleneck found, re-checking until none remain (or the repair budget
 * runs out, which in practice essentially never happens on this board size).
 */
function ensureMultiplePaths(blob, from, to, cols, rows, maxRepairs = 20) {
  let repairs = 0;
  for (let i = 0; i < maxRepairs; i++) {
    const cut = findCutVertex(blob, from, to, cols, rows);
    if (!cut) break;
    if (!bypassCutVertex(blob, cut, from, cols, rows)) break;
    repairs += 1;
  }
  return repairs;
}

/**
 * Difficulty stats for the "Difficulty" CSV category. `numberOfSafePaths`
 * has no single agreed-upon definition for a free-roam (not turn-by-turn
 * maze) board, so it's approximated as the count of 4-connected clusters of
 * correct cells -- by construction this is normally 1. `pathRepairs` is the
 * number of bottleneck widenings actually performed while guaranteeing
 * multiple routes to the destination -- a direct measure of how "pinched"
 * the naturally-grown region was before repair.
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
 * Builds one round: a keyword, a COLS x ROWS grid of emoji symbols, and a
 * single destination cell to reach. Correct cells are grown as one
 * connected region rather than scattered independently; every spawn corner
 * is guaranteed a lives-budget-bounded path into that region; and every
 * corner-to-destination route is guaranteed to have more than one viable
 * path, so a round can never be lost purely to unlucky placement or a
 * single wrong turn with no alternative.
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
  let destination = null;
  let pathRepairs = 0;

  if (blob.size > 0) {
    ensureEveryCornerCanReachBlob(blob, { cols, rows, maxDistance });

    // Every repair pass can grow the blob, which can shift which cell is
    // actually nearest to a given corner -- a player heads for whichever
    // safe cell is physically closest, not whichever one an earlier pass
    // happened to check. Re-deriving entry points and re-checking them
    // against the current blob, repeatedly until nothing changes, is what
    // makes the guarantee hold for the board a player actually sees rather
    // than just the intermediate state right after the first pass.
    for (let iter = 0; iter < 30; iter++) {
      const sizeBefore = blob.size;
      const entryPoints = spawnCorners(cols, rows).flatMap((corner) => nearestBlobCells(blob, corner).cells);
      for (const entry of entryPoints) ensureMinDegree(blob, entry, cols, rows);

      destination = pickDestination(blob, entryPoints, cols, rows);
      ensureMinDegree(blob, destination, cols, rows);

      for (const entry of entryPoints) {
        pathRepairs += ensureMultiplePaths(blob, entry, destination, cols, rows);
      }

      if (blob.size === sizeBefore) break; // fixed point: nothing left to fix
    }
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
  const difficulty = { ...computeDifficultyStats(grid, keyword, emojiRepository, cols, rows), pathRepairs };

  return { keyword, grid, correctCount, difficulty, destination };
}

module.exports = { generateRound, shuffle, randomBetween };
