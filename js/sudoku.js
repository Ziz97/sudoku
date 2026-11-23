/*
 * Sudoku engine: solver, solution counter and puzzle generator.
 * Grids are flat arrays of 81 numbers, 0 = empty.
 */
(function (global) {
  'use strict';

  const ALL = 0x3fe; // bits 1..9

  const row = (i) => (i / 9) | 0;
  const col = (i) => i % 9;
  const box = (i) => ((row(i) / 3) | 0) * 3 + ((col(i) / 3) | 0);

  // Precompute the 20 peers of each cell.
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const set = new Set();
    for (let j = 0; j < 81; j++) {
      if (j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))) set.add(j);
    }
    return [...set];
  });

  function popcount(m) {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function candidates(g, i) {
    let used = 0;
    const peers = PEERS[i];
    for (let k = 0; k < peers.length; k++) used |= 1 << g[peers[k]];
    return ALL & ~used;
  }

  /** True if any two filled cells in the same unit share a value. */
  function hasConflicts(g) {
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      for (const p of PEERS[i]) if (g[p] === g[i]) return true;
    }
    return false;
  }

  /** Indices of cells whose value clashes with a peer. */
  function conflictCells(g) {
    const out = new Set();
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      for (const p of PEERS[i]) if (g[p] === g[i]) { out.add(i); out.add(p); }
    }
    return out;
  }

  /**
   * Backtracking search with "minimum remaining values" heuristic.
   * Stops after `limit` solutions. Returns { count, solution }.
   */
  function search(grid, limit, randomize) {
    const g = grid.slice();
    const res = { count: 0, solution: null };
    if (hasConflicts(g)) return res;

    (function rec() {
      let best = -1, bestMask = 0, bestCount = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = candidates(g, i);
        const c = popcount(m);
        if (c === 0) return; // dead end
        if (c < bestCount) {
          best = i; bestMask = m; bestCount = c;
          if (c === 1) break;
        }
      }
      if (best === -1) {
        res.count++;
        if (!res.solution) res.solution = g.slice();
        return;
      }
      const digits = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
      if (randomize) shuffle(digits);
      for (const d of digits) {
        g[best] = d;
        rec();
        if (res.count >= limit) break;
      }
      g[best] = 0;
    })();

    return res;
  }

  const solve = (grid) => search(grid, 1, false).solution;
  const countSolutions = (grid, limit = 2) => search(grid, limit, false).count;

  const DIFFICULTY = {
    easy:   { clues: 40, label: 'Easy' },
    medium: { clues: 32, label: 'Medium' },
    hard:   { clues: 27, label: 'Hard' },
    expert: { clues: 23, label: 'Expert' },
  };

  /**
   * Generate a puzzle with a unique solution.
   * Removes clues in symmetric pairs while the solution stays unique.
   */
  function generate(level = 'medium') {
    const target = (DIFFICULTY[level] || DIFFICULTY.medium).clues;
    let bestPuzzle = null, bestSolution = null, bestClues = 82;

    // A few attempts: random removal order sometimes stalls above the target.
    for (let attempt = 0; attempt < 6; attempt++) {
      const solution = search(new Array(81).fill(0), 1, true).solution;
      const puzzle = solution.slice();
      let clues = 81;
      const order = shuffle([...Array(41).keys()]); // cell i paired with 80 - i

      for (const i of order) {
        if (clues <= target) break;
        const j = 80 - i;
        const saved = [puzzle[i], puzzle[j]];
        puzzle[i] = 0; puzzle[j] = 0;
        if (countSolutions(puzzle, 2) !== 1) {
          puzzle[i] = saved[0]; puzzle[j] = saved[1];
        } else {
          clues -= i === j ? 1 : 2;
        }
      }

      if (clues < bestClues) { bestClues = clues; bestPuzzle = puzzle; bestSolution = solution; }
      if (clues <= target + 1) break;
    }
    return { puzzle: bestPuzzle, solution: bestSolution, clues: bestClues };
  }

  global.Sudoku = {
    PEERS, row, col, box, DIFFICULTY,
    generate, solve, countSolutions, hasConflicts, conflictCells,
  };
})(window);
