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

// A plain self-avoiding walk (never revisit a cell) can still run right
// alongside an earlier stretch of itself -- two turns of the same path
// ending up grid-adjacent, one cell apart in the *sequence* but touching in
// the *grid* -- which quietly opens a shortcut between two points on what's
// supposed to be a single 1-wide corridor with exactly one route through
// it. Rejecting any next step that would touch a visited cell OTHER than
// the one it's stepping from keeps the corridor from ever running next to
// itself, so the walk it produces is a true simple path: no braids, no
// alternate way through.
function touchesOnlyPredecessor(nx, ny, visited, predecessorKey, cols, rows) {
  for (const [dc, dr] of NEIGHBOR_DELTAS) {
    const ax = nx + dc;
    const ay = ny + dr;
    if (ax < 0 || ax >= cols || ay < 0 || ay >= rows) continue;
    const ak = key(ax, ay);
    if (ak === predecessorKey) continue;
    if (visited.has(ak)) return false;
  }
  return true;
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
  const maxLength = directDistance * 2 + 4;

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
        if (!touchesOnlyPredecessor(nx, ny, visited, key(x, y), cols, rows)) continue;
        const distAfter = Math.abs(nx - target.col) + Math.abs(ny - target.row);
        // A much gentler pull toward the goal than the old 6:1 (was
        // producing short, nearly-straight shots) -- 2:1 still reliably
        // finds the target within maxLength, but wanders and backtracks on
        // its way there far more often, which is what "convoluted, not a
        // straight line" actually needs.
        const weight = distAfter < distNow ? 2 : 1;
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

// A pattern's real (main-path) route stays a single non-branching corridor
// per corner -- but a corridor with zero forks anywhere on the board reads
// as an obvious, un-maze-like straight shot. This branches a short dead-end
// off a random interior point of that path into previously-unused cells:
// safe-looking territory that doesn't reconnect to anything and doesn't
// reach the destination, so wandering down one means backtracking rather
// than finding a real shortcut. Never touches the main path itself, so it
// can never turn a solvable board into an unsolvable one.
function addDeadEndSpur(blob, mainPath, cols, rows) {
  if (mainPath.length < 3) return;
  let cur = mainPath[1 + Math.floor(Math.random() * (mainPath.length - 2))];
  const spurLength = 2 + Math.floor(Math.random() * 3); // 2-4 cells
  const spurCells = [];
  const spurKeys = new Set();
  for (let step = 0; step < spurLength; step++) {
    const curKey = key(cur.col, cur.row);
    const candidates = neighborsOf(cur, cols, rows).filter((nb) => {
      const k = key(nb.col, nb.row);
      if (blob.has(k) || spurKeys.has(k)) return false;
      // Same non-adjacency rule as the main corridor (see
      // touchesOnlyPredecessor): a spur that grazes a second point on the
      // main path, or curls back against itself, quietly opens a second
      // way onto/off the real route instead of staying a dead end.
      return touchesOnlyPredecessor(nb.col, nb.row, blob, curKey, cols, rows)
        && touchesOnlyPredecessor(nb.col, nb.row, spurKeys, curKey, cols, rows);
    });
    if (candidates.length === 0) break;
    cur = candidates[Math.floor(Math.random() * candidates.length)];
    spurCells.push(cur);
    spurKeys.add(key(cur.col, cur.row));
  }
  for (const cell of spurCells) blob.set(key(cell.col, cell.row), cell);
}

const SPURS_MIN = 3;
const SPURS_MAX = 5;

/**
 * Builds one full board-layout pattern: a single self-avoiding main path
 * from the spawn corner to a destination, plus several dead-end spurs
 * branching off that path. Returns null if the main path can't be built or
 * the resulting board somehow isn't solvable -- the caller (getPatternPool)
 * just tries again, since this only runs at pool-build time, not per round.
 *
 * Only corner 0 gets a real path: GameRoom.js's own CORNERS[i % 4] lookup
 * never advances `i` past 0 (every real room holds exactly one player --
 * see GameRoom.js's own "single-player only" comment), so a spawn corner
 * other than the top-left one is never actually used. This used to build a
 * full path-plus-spurs from all 4 corners into one shared blob regardless,
 * which meant the *actual* board a player saw had three other corners'
 * worth of "safe" cells sitting on it that just happened to be reachable
 * from their own position too -- genuine alternate routes to the flag, not
 * decoys, since they were real solved paths. That was the biggest single
 * reason the maze read as "too easy, multiple correct ways through": the
 * blob is now built from exactly one walk, so every safe cell not on that
 * one corridor is either an intentional dead-end spur (see
 * addDeadEndSpur -- doesn't reconnect, doesn't reach the destination) or
 * doesn't exist at all.
 */
function buildPattern(cols, rows) {
  const destination = pickDestination(cols, rows);
  const blob = new Map([[key(destination.col, destination.row), destination]]);
  const corner = spawnCorners(cols, rows)[0];

  const walk = selfAvoidingWalk(cols, rows, corner, destination);
  if (!walk) return null;
  for (const cell of walk) blob.set(key(cell.col, cell.row), cell);
  const spurCount = SPURS_MIN + Math.floor(Math.random() * (SPURS_MAX - SPURS_MIN + 1));
  for (let i = 0; i < spurCount; i++) addDeadEndSpur(blob, walk, cols, rows);

  if (!isReachable(blob, corner, destination, cols, rows)) return null;
  return { destination, blob, corner };
}

// ~100-200 predefined board layouts per the Week 8 CSV ("Redesign Emoji
// Munchers board generation"), built once per (cols, rows) the first time
// that size is actually requested rather than regenerated fresh every
// round -- board SHAPE quality is fixed and validated at pool-build time,
// and a round just draws a random member instead of walking a brand new
// maze from scratch each time. Emoji content is still assigned fresh per
// round in generateRound(), so the same layout reappearing across rounds or
// games doesn't mean the same-looking board.
const PATTERN_POOL_SIZE = 150;
const patternPoolCache = new Map();
function getPatternPool(cols, rows) {
  const cacheKey = `${cols}x${rows}`;
  let pool = patternPoolCache.get(cacheKey);
  if (pool) return pool;

  pool = [];
  const maxBuildAttempts = PATTERN_POOL_SIZE * 4;
  for (let attempts = 0; pool.length < PATTERN_POOL_SIZE && attempts < maxBuildAttempts; attempts++) {
    const pattern = buildPattern(cols, rows);
    if (pattern) pool.push(pattern);
  }
  patternPoolCache.set(cacheKey, pool);
  return pool;
}

/**
 * Difficulty stats logged per round. `numberOfSafePaths` has no single
 * agreed-upon definition for a free-roam (not turn-by-turn maze) board, so
 * it's approximated as the count of 4-connected clusters of
 * correct cells -- by construction this is normally 1, since every corner's
 * single walk converges on the same destination.
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
 * `difficultyTier` selects which concept-cluster resolution the keyword is
 * drawn from (see ConceptRepository) -- a finer tier both narrows what
 * counts as "correct" to a more subtle concept and pulls decoy emoji from
 * that same tier's sibling clusters instead of the whole emoji universe, so
 * wrong cells get genuinely harder to distinguish, not just more numerous.
 *
 * The board SHAPE comes from a random member of the pre-generated pattern
 * pool (see getPatternPool) -- every pattern in that pool was already
 * validated solvable for every corner when the pool was built, so there's
 * no per-round retry loop here anymore. Only the pool itself (built once,
 * lazily, per grid size) needs that validation.
 */
function generateRound(emojiRepository, { cols, rows, minMatches, difficultyTier }) {
  const keyword = emojiRepository.pickKeyword(minMatches, difficultyTier);
  const matchingSymbols = emojiRepository.getMatchingSymbols(keyword);
  const wrongSymbols = emojiRepository.getWrongSymbolPool(keyword);

  let destination = pickDestination(cols, rows);
  let blob = new Map([[key(destination.col, destination.row), destination]]);

  if (matchingSymbols.length > 0) {
    const pool = getPatternPool(cols, rows);
    if (pool.length > 0) {
      const picked = pool[Math.floor(Math.random() * pool.length)];
      destination = picked.destination;
      blob = picked.blob;
    } else {
      // Pool somehow came up empty (a pathologically small/odd grid size) --
      // fall back to a deterministic construction that's connected by
      // definition, rather than ship a board that was never actually
      // validated. Only corner 0 (see buildPattern's comment: the only
      // spawn corner a real single-player room ever actually uses).
      const corner = spawnCorners(cols, rows)[0];
      const path = pathBetween(corner, destination, true);
      for (const cell of path) blob.set(key(cell.col, cell.row), cell);
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
  const wrongPool = wrongSymbols.length > 0 ? wrongSymbols : emojiRepository.getAllSymbols();
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
  const difficulty = computeDifficultyStats(grid, keyword, emojiRepository, cols, rows);

  return { keyword, grid, correctCount, difficulty, destination };
}

module.exports = { generateRound, shuffle, randomBetween };
