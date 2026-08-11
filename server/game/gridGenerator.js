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

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const NEIGHBOR_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const OPPOSITE_DIR = [1, 0, 3, 2]; // index i's opposite is NEIGHBOR_DELTAS[OPPOSITE_DIR[i]]

function key(col, row) {
  return `${col},${row}`;
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

// The flag always lives in the rightmost column -- never mid-board -- with
// only its row randomized, kept away from the top/bottom edges so it can
// never coincide with a spawn corner (which would hand that corner's player
// an instant, degenerate win).
function pickDestination(cols, rows) {
  const centerRow = Math.floor(rows / 2) + randomBetween(-1, 1);
  return {
    col: cols - 1,
    row: clamp(centerRow, 1, rows - 2),
  };
}

/**
 * Self-avoiding random walk from `start` to `target`: at each step, picks a
 * random unvisited neighbor (never immediately reversing) until it reaches
 * the target or runs out of options. Same core algorithm as the reference
 * Python script (self-avoiding, no immediate reversal, retry the whole walk
 * from scratch on a dead end), with two additions the script didn't need
 * for a single path but multiple overlapping ones do: a mild bias toward
 * steps that get closer to the target (candidates moving closer are picked
 * 3x as often), and a length cap relative to the direct distance. An
 * unbiased walk has no pull toward the goal at all, so it can wander the
 * entire board before landing on the target by chance -- harmless for one
 * path, but with several per corner they collectively cover nearly the
 * whole grid and leave almost nothing to actually avoid. Retrying on a
 * walk that's run too long (instead of letting it keep wandering) keeps
 * paths close to organically-windy-but-still-short.
 */
function selfAvoidingWalk(cols, rows, start, target, maxAttempts = 400) {
  const directDistance = Math.abs(start.col - target.col) + Math.abs(start.row - target.row);
  const maxLength = directDistance + 6;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let x = start.col;
    let y = start.row;
    const path = [{ col: x, row: y }];
    const visited = new Set([key(x, y)]);
    let lastDir = -1;
    let stuck = false;

    while (x !== target.col || y !== target.row) {
      if (path.length > maxLength) {
        stuck = true;
        break;
      }
      const available = [];
      const distNow = Math.abs(x - target.col) + Math.abs(y - target.row);
      for (let dir = 0; dir < NEIGHBOR_DELTAS.length; dir++) {
        if (lastDir !== -1 && dir === OPPOSITE_DIR[lastDir]) continue;
        const [dc, dr] = NEIGHBOR_DELTAS[dir];
        const nx = x + dc;
        const ny = y + dr;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        if (visited.has(key(nx, ny))) continue;
        const distAfter = Math.abs(nx - target.col) + Math.abs(ny - target.row);
        const weight = distAfter < distNow ? 6 : 1;
        available.push({ dir, nx, ny, weight });
      }

      if (available.length === 0) {
        stuck = true;
        break;
      }
      const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
      let r = Math.random() * totalWeight;
      let pick = available[available.length - 1];
      for (const c of available) {
        r -= c.weight;
        if (r <= 0) { pick = c; break; }
      }
      x = pick.nx;
      y = pick.ny;
      path.push({ col: x, row: y });
      visited.add(key(x, y));
      lastDir = pick.dir;
    }

    if (!stuck) return path;
  }
  return null;
}

/**
 * Deterministic fallback for when the random walk can't find a route
 * (essentially only possible on a near-full board): a plain Manhattan path,
 * one axis at a time.
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

// Plain reachability within the safe region -- no cell excluded. Used as the
// round-level "is this corner actually solvable" check, distinct from the
// cut-vertex search below which looks for a *single* fragile chokepoint.
function isReachable(blob, from, to, cols, rows) {
  return isConnectedWithinBlobExcluding(blob, from, to, null, cols, rows);
}

// A cut vertex here is any safe cell (other than the two endpoints) whose
// removal disconnects `from` from `to` within the safe region -- i.e. every
// route between them funnels through that one cell. Small board, so a
// straightforward O(n) x O(n) scan is plenty fast. With 2-3 independently
// walked routes per corner this should be rare -- kept as a backstop for the
// unlucky case where every walk for a corner happened to overlap too much.
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
// poison) except `avoidKey` -- carves a genuine detour around a bottleneck.
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

// Finds which of a cut vertex's neighbors sit on `from`'s side versus the
// other side, then carves a fresh detour directly between those two
// neighbors that doesn't pass through the cut vertex -- a real bypass.
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
  if (!nearSide || !farSide) return false;

  const detour = bfsPathAvoiding(cols, rows, nearSide, farSide, vKey);
  if (!detour) return false;
  for (const cell of detour) blob.set(key(cell.col, cell.row), cell);
  return true;
}

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
 * Builds the safe region for one round: for each spawn corner, walks
 * `pathsPerCorner` independent self-avoiding routes to the destination and
 * unions their cells into the region, then runs the cut-vertex backstop.
 *
 * The first walk per corner is always kept fully safe (the guaranteed
 * route). When a second walk exists, one of its interior cells is
 * deliberately withheld from the safe region instead -- a single
 * non-matching "toll" cell on an alternate route, so a player can choose a
 * calculated one-life sacrifice over the longer guaranteed-safe path,
 * rather than a route that's safe by construction always winning by
 * default. It's never a forced hit: the fully-safe first walk is always
 * there too.
 */
function buildSafeRegion(cols, rows, destination, pathsPerCorner) {
  const blob = new Map([[key(destination.col, destination.row), destination]]);
  let pathRepairs = 0;
  const corners = spawnCorners(cols, rows);

  for (const corner of corners) {
    let sacrificePlaced = false;
    for (let i = 0; i < pathsPerCorner; i++) {
      const walk = selfAvoidingWalk(cols, rows, corner, destination) || pathBetween(corner, destination, i % 2 === 0);

      if (i === 1 && !sacrificePlaced && walk.length >= 3) {
        const interiorIdx = 1 + Math.floor(Math.random() * (walk.length - 2));
        for (let idx = 0; idx < walk.length; idx++) {
          if (idx === interiorIdx) continue; // left out of the safe region on purpose
          blob.set(key(walk[idx].col, walk[idx].row), walk[idx]);
        }
        sacrificePlaced = true;
        continue;
      }

      for (const cell of walk) blob.set(key(cell.col, cell.row), cell);
    }
    pathRepairs += ensureMultiplePaths(blob, corner, destination, cols, rows);
  }

  return { blob, pathRepairs, corners };
}

/**
 * Difficulty stats for the "Difficulty" CSV category. `numberOfSafePaths`
 * has no single agreed-upon definition for a free-roam (not turn-by-turn
 * maze) board, so it's approximated as the count of 4-connected clusters of
 * correct cells -- by construction this is normally 1, since every corner's
 * walks converge on the same destination. `pathRepairs` counts any backstop
 * bottleneck fixes that were still needed after the walk construction.
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
 * single destination cell (always in the rightmost column) to reach.
 *
 * Solvability is a round-level property, not a per-corner one: every spawn
 * corner must have a confirmed safe route to the destination before the
 * round ships. buildSafeRegion() is retried (each attempt re-walking from
 * scratch) until every corner passes isReachable(), or a bounded number of
 * attempts is exhausted -- in which case a guaranteed-connected fallback
 * (plain Manhattan paths from every corner) is used instead. Either way, a
 * round is never solvable for some players' spawn corners and not others.
 */
function generateRound(emojiRepository, { cols, rows, minMatches, pathsPerCorner = 2 }) {
  const keyword = emojiRepository.pickKeyword(minMatches);
  const matchingSymbols = emojiRepository.getMatchingSymbols(keyword);
  const allSymbols = emojiRepository.getAllSymbols();
  const wrongSymbols = allSymbols.filter((s) => !matchingSymbols.includes(s));

  const MAX_ROUND_ATTEMPTS = 8;
  let destination = pickDestination(cols, rows);
  let blob = new Map([[key(destination.col, destination.row), destination]]);
  let pathRepairs = 0;

  if (matchingSymbols.length > 0) {
    let solved = false;
    for (let attempt = 0; attempt < MAX_ROUND_ATTEMPTS; attempt++) {
      destination = pickDestination(cols, rows);
      const built = buildSafeRegion(cols, rows, destination, pathsPerCorner);
      if (built.corners.every((corner) => isReachable(built.blob, corner, destination, cols, rows))) {
        blob = built.blob;
        pathRepairs = built.pathRepairs;
        solved = true;
        break;
      }
    }

    if (!solved) {
      // Retries exhausted -- fall back to a deterministic construction that's
      // connected for every corner by definition, rather than ship a board
      // that was never actually validated.
      blob = new Map([[key(destination.col, destination.row), destination]]);
      for (const corner of spawnCorners(cols, rows)) {
        const path = pathBetween(corner, destination, true);
        for (const cell of path) blob.set(key(cell.col, cell.row), cell);
      }
      pathRepairs = 0;
    }
  }

  // Wrong cells are assigned by cycling through a freshly-shuffled copy of
  // the wrong-symbol pool (reshuffling once it runs out) instead of an
  // independent random pick per cell. Independent per-cell sampling can,
  // by pure chance on a board this size, cluster heavily around just 2-3
  // symbols -- which makes "correct vs wrong" obvious by repetition count
  // alone rather than by actually reading the symbol. Cycling guarantees
  // every wrong symbol shows up roughly equally often instead.
  const grid = [];
  const wrongPool = wrongSymbols.length > 0 ? wrongSymbols : allSymbols;
  let shuffledWrong = shuffle(wrongPool);
  let wrongIdx = 0;
  const nextWrongSymbol = () => {
    if (wrongIdx >= shuffledWrong.length) {
      shuffledWrong = shuffle(wrongPool);
      wrongIdx = 0;
    }
    return shuffledWrong[wrongIdx++];
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isSafe = blob.has(key(col, row));
      const symbol = isSafe
        ? matchingSymbols[Math.floor(Math.random() * matchingSymbols.length)]
        : nextWrongSymbol();
      grid.push({ col, row, symbol });
    }
  }

  // Recount from the final grid to stay honest about what's actually there.
  const correctCount = grid.filter((c) => emojiRepository.isMatch(c.symbol, keyword)).length;
  const difficulty = { ...computeDifficultyStats(grid, keyword, emojiRepository, cols, rows), pathRepairs };

  return { keyword, grid, correctCount, difficulty, destination };
}

module.exports = { generateRound, shuffle, randomBetween };
