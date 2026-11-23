/*
 * GridReader: reads a Sudoku grid from a picture, entirely in the browser.
 *
 *   1. Find the grid: adaptive threshold, then the largest square-ish connected
 *      shape (the grid lines are all connected), then its four extreme corners.
 *   2. Straighten it: perspective warp of the four corners onto a square.
 *   3. Read each cell: keep the ink blob near the cell centre (ignores grid
 *      lines and small pencil marks), normalise it to 28x28 and compare it with
 *      digits rendered in many fonts (template matching by correlation).
 *   4. If the result has repeated numbers, retry the least certain cells with
 *      their second-best guess.
 *
 * Works with printed grids, newspaper photos and app screenshots (light or
 * dark). Handwriting is not supported.
 */
(function (global) {
  'use strict';

  const WORK_MAX = 1600;   // max side of the working copy of the picture
  const DETECT_MAX = 800;  // max side used to find the grid
  const CELL = 56;         // pixels per cell after straightening
  const SIZE = CELL * 9;
  const N = 28, BOX = 20;  // normalised digit image

  // ---------- Image helpers ----------
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('This file could not be opened as an image.'));
      img.src = src;
    });
  }

  /** Draws the picture onto a canvas no larger than WORK_MAX. */
  function toWorkCanvas(img) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, WORK_MAX / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * s));
    c.height = Math.max(1, Math.round(h0 * s));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function grayOf(data, n) {
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    }
    return g;
  }

  function mean(g) {
    let s = 0;
    for (let i = 0; i < g.length; i++) s += g[i];
    return s / g.length;
  }

  function invert(g) {
    for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  }

  /** 1 = ink: darker than the local average by more than C. */
  function adaptiveThreshold(g, w, h, r, C) {
    const W = w + 1;
    const I = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
        out[y * w + x] = g[y * w + x] < s / ((x1 - x0) * (y1 - y0)) - C ? 1 : 0;
      }
    }
    return out;
  }

  /** 8-connected components. Returns labels (1-based) and per-component stats. */
  function components(bin, w, h) {
    const labels = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    for (let start = 0; start < bin.length; start++) {
      if (!bin[start] || labels[start]) continue;
      const id = comps.length + 1;
      const c = { id, area: 0, minX: w, minY: h, maxX: -1, maxY: -1 };
      let sp = 0;
      stack[sp++] = start;
      labels[start] = id;
      while (sp) {
        const p = stack[--sp];
        const x = p % w, y = (p / w) | 0;
        c.area++;
        if (x < c.minX) c.minX = x;
        if (x > c.maxX) c.maxX = x;
        if (y < c.minY) c.minY = y;
        if (y > c.maxY) c.maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx;
            if (bin[q] && !labels[q]) { labels[q] = id; stack[sp++] = q; }
          }
        }
      }
      c.w = c.maxX - c.minX + 1;
      c.h = c.maxY - c.minY + 1;
      comps.push(c);
    }
    return { labels, comps };
  }

  // ---------- 1. Find the grid ----------
  /**
   * Median number of times the component is crossed along a few horizontal
   * and vertical scan lines through its box (grid: 4 to 10, plain frame: 2).
   */
  function crossings(labels, w, comp) {
    const counts = [];
    for (const f of [1 / 6, 1 / 2, 5 / 6]) {
      const y = Math.round(comp.minY + f * comp.h);
      const x = Math.round(comp.minX + f * comp.w);
      let runs = 0, inside = false;
      for (let xx = comp.minX; xx <= comp.maxX; xx++) {
        const on = labels[y * w + xx] === comp.id;
        if (on && !inside) runs++;
        inside = on;
      }
      counts.push(runs);
      runs = 0; inside = false;
      for (let yy = comp.minY; yy <= comp.maxY; yy++) {
        const on = labels[yy * w + x] === comp.id;
        if (on && !inside) runs++;
        inside = on;
      }
      counts.push(runs);
    }
    counts.sort((a, b) => a - b);
    return (counts[2] + counts[3]) / 2;
  }

  /**
   * How many of the four thick inner lines (at 1/3 and 2/3, across and down)
   * are where a Sudoku grid would have them, on the middle scan lines.
   */
  function thickLineHits(labels, w, comp) {
    let hits = 0;
    const midY = Math.round(comp.minY + comp.h / 2);
    const midX = Math.round(comp.minX + comp.w / 2);
    for (const f of [1 / 3, 2 / 3]) {
      const tx = comp.minX + f * comp.w, ty = comp.minY + f * comp.h;
      const rx = comp.w * 0.05, ry = comp.h * 0.05;
      let found = false;
      for (let x = Math.round(tx - rx); x <= tx + rx && !found; x++) {
        for (let dy = -2; dy <= 2 && !found; dy++) found = labels[(midY + dy) * w + x] === comp.id;
      }
      if (found) hits++;
      found = false;
      for (let y = Math.round(ty - ry); y <= ty + ry && !found; y++) {
        for (let dx = -2; dx <= 2 && !found; dx++) found = labels[y * w + midX + dx] === comp.id;
      }
      if (found) hits++;
    }
    return hits;
  }

  /** Returns 4 corners [tl, tr, br, bl] in work-canvas pixels, or null. */
  function detectCorners(work) {
    const s = Math.min(1, DETECT_MAX / Math.max(work.width, work.height));
    const w = Math.max(1, Math.round(work.width * s));
    const h = Math.max(1, Math.round(work.height * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(work, 0, 0, w, h);
    const g = grayOf(ctx.getImageData(0, 0, w, h).data, w * h);
    const r = Math.max(7, Math.round(Math.min(w, h) / 40));
    const minSide = 0.2 * Math.min(w, h);

    // Look for dark lines (light lines on mostly dark pictures). If that finds
    // no real grid, try the other way round (a dark board on a light page).
    // A shape with inner lines (a real grid) beats a plain frame.
    if (mean(g) < 110) invert(g);
    let best = null;
    for (const pass of [0, 1]) {
      if (pass === 1) {
        if (best && best.isGrid) break;
        invert(g);
      }
      const { labels, comps } = components(adaptiveThreshold(g, w, h, r, 10), w, h);
      for (const comp of comps) {
        if (comp.w < minSide || comp.h < minSide) continue;
        const ratio = comp.w / comp.h;
        if (ratio < 0.6 || ratio > 1.65) continue;
        // A grid is mostly empty inside: reject solid blobs (photos, dark panels).
        if (comp.area > 0.6 * comp.w * comp.h) continue;
        const isGrid = crossings(labels, w, comp) >= 4 && thickLineHits(labels, w, comp) >= 3;
        const score = comp.w * comp.h + (isGrid ? w * h * 2 : 0);
        if (!best || score > best.score) best = { comp, score, labels, isGrid };
      }
    }
    if (!best) return null;

    const id = best.comp.id;
    const labels = best.labels;
    let tl, tr, br, bl;
    let tlv = Infinity, trv = -Infinity, brv = -Infinity, blv = -Infinity;
    for (let y = best.comp.minY; y <= best.comp.maxY; y++) {
      for (let x = best.comp.minX; x <= best.comp.maxX; x++) {
        if (labels[y * w + x] !== id) continue;
        if (x + y < tlv) { tlv = x + y; tl = { x, y }; }
        if (x + y > brv) { brv = x + y; br = { x, y }; }
        if (x - y > trv) { trv = x - y; tr = { x, y }; }
        if (y - x > blv) { blv = y - x; bl = { x, y }; }
      }
    }
    // Back to work-canvas coordinates, nudged to the outer edge of the line.
    return [tl, tr, br, bl].map((p) => ({ x: (p.x + 0.5) / s, y: (p.y + 0.5) / s }));
  }

  // ---------- 2. Straighten ----------
  /** Homography mapping each src[i] to dst[i] (4 point pairs). */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = src[i], { x: u, y: v } = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    // Gaussian elimination with partial pivoting.
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    h.push(1);
    return h;
  }

  function project(H, x, y) {
    const d = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
  }

  /** Warps the quad `corners` of the work canvas onto a SIZE x SIZE ImageData. */
  function warp(work, corners) {
    const sw = work.width, sh = work.height;
    const src = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    const square = [{ x: 0, y: 0 }, { x: SIZE, y: 0 }, { x: SIZE, y: SIZE }, { x: 0, y: SIZE }];
    const H = homography(square, corners);
    if (!H) return null;
    const out = new ImageData(SIZE, SIZE);
    const o = out.data;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = project(H, x + 0.5, y + 0.5);
        const fx = Math.min(sw - 1.001, Math.max(0, p.x - 0.5));
        const fy = Math.min(sh - 1.001, Math.max(0, p.y - 0.5));
        const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const k = (y * SIZE + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = src[i00 + ch] * (1 - ax) + src[i10 + ch] * ax;
          const bot = src[i01 + ch] * (1 - ax) + src[i11 + ch] * ax;
          o[k + ch] = top * (1 - ay) + bot * ay;
        }
        o[k + 3] = 255;
      }
    }
    return out;
  }

  // ---------- 3. Digit features ----------
  /** mask: Float32Array mw*mh in [0,1]. Returns zero-mean unit vector + aspect. */
  function normalize(mask, mw, mh) {
    const s = BOX / Math.max(mw, mh);
    const ox = (N - mw * s) / 2, oy = (N - mh * s) / 2;
    const sample = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= mw || yi >= mh) return 0;
      return mask[yi * mw + xi];
    };
    const raw = new Float32Array(N * N);
    const SS = 4; // supersampling per output pixel
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        let acc = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            acc += sample((tx + (sx + 0.5) / SS - ox) / s, (ty + (sy + 0.5) / SS - oy) / s);
          }
        }
        raw[ty * N + tx] = acc / (SS * SS);
      }
    }
    // Light blur: tolerates small differences in stroke and position.
    const v = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let acc = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
            const wgt = dx === 0 && dy === 0 ? 2 : 1;
            acc += raw[yy * N + xx] * wgt; n += wgt;
          }
        }
        v[y * N + x] = acc / n;
      }
    }
    let m = 0;
    for (let i = 0; i < v.length; i++) m += v[i];
    m /= v.length;
    let norm = 0;
    for (let i = 0; i < v.length; i++) { v[i] -= m; norm += v[i] * v[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return { vec: v, aspect: mw / mh };
  }

  // ---------- Templates ----------
  const FONTS = [
    'Inter', 'Fraunces', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Avenir Next', 'Futura', 'Gill Sans', 'Georgia', 'Times New Roman', 'Palatino',
    'Baskerville', 'Courier New', 'Menlo', 'sans-serif', 'serif', 'monospace',
  ];
  const GENERIC = new Set(['sans-serif', 'serif', 'monospace']);
  let templates = null;

  async function buildTemplates() {
    if (templates) return templates;
    try {
      await Promise.all([
        document.fonts.load('400 64px Inter'), document.fonts.load('700 64px Inter'),
        document.fonts.load('500 64px Fraunces'), document.fonts.load('700 64px Fraunces'),
      ]);
    } catch { /* fonts are optional */ }

    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const list = [];
    const seen = new Set();
    for (const font of FONTS) {
      for (const weight of [400, 700]) {
        const family = GENERIC.has(font) ? font : `"${font}", sans-serif`;
        for (let d = 1; d <= 9; d++) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, 120, 120);
          ctx.fillStyle = '#000';
          ctx.font = `${weight} 80px ${family}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(d), 60, 62);
          const data = ctx.getImageData(0, 0, 120, 120).data;
          let minX = 120, minY = 120, maxX = -1, maxY = -1;
          for (let i = 0; i < 120 * 120; i++) {
            if (data[i * 4] < 128) {
              const x = i % 120, y = (i / 120) | 0;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
          if (maxX < 0) continue;
          const mw = maxX - minX + 1, mh = maxY - minY + 1;
          const mask = new Float32Array(mw * mh);
          for (let y = 0; y < mh; y++) {
            for (let x = 0; x < mw; x++) {
              mask[y * mw + x] = 1 - data[((y + minY) * 120 + x + minX) * 4] / 255;
            }
          }
          const t = normalize(mask, mw, mh);
          // Skip exact duplicates (fonts missing on this device fall back).
          const key = d + ':' + Array.from(t.vec.subarray(300, 340), (x) => x.toFixed(3)).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ digit: d, vec: t.vec, aspect: t.aspect });
        }
      }
    }
    templates = list;
    return templates;
  }

  /** Ranks digits 1..9 for one normalised sample, best first. */
  function classify(sample) {
    const best = new Array(10).fill(-Infinity);
    for (const t of templates) {
      let dot = 0;
      const a = sample.vec, b = t.vec;
      for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
      const score = dot - 0.25 * Math.abs(Math.log(sample.aspect / t.aspect));
      if (score > best[t.digit]) best[t.digit] = score;
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((d) => ({ digit: d, score: best[d] }))
      .sort((a, b) => b.score - a.score);
  }

  // ---------- 3b. Read the cells ----------
  function extractDigit(bin, r, c) {
    const inset = Math.round(CELL * 0.1);
    const x0 = c * CELL + inset, y0 = r * CELL + inset;
    const iw = CELL - 2 * inset;
    const sub = new Uint8Array(iw * iw);
    for (let y = 0; y < iw; y++) {
      for (let x = 0; x < iw; x++) sub[y * iw + x] = bin[(y0 + y) * SIZE + x0 + x];
    }
    const { labels, comps } = components(sub, iw, iw);
    const mid = iw / 2;
    let main = null;
    for (const k of comps) {
      if (k.h < CELL * 0.3 || k.h > iw * 0.98 || k.w > iw * 0.9) continue;
      if (k.area < CELL * CELL * 0.012 || k.area < 0.08 * k.w * k.h) continue;
      const cx = (k.minX + k.maxX) / 2, cy = (k.minY + k.maxY) / 2;
      if (Math.abs(cx - mid) > CELL * 0.22 || Math.abs(cy - mid) > CELL * 0.22) continue;
      // Leftover grid line: spans the whole cell along one side.
      if ((k.minX === 0 && k.maxX === iw - 1) || (k.minY === 0 && k.maxY === iw - 1)) continue;
      if (!main || k.area > main.area) main = k;
    }
    if (!main) return null;

    // Merge nearby pieces of a broken stroke.
    const keep = new Set([main.id]);
    let { minX, minY, maxX, maxY } = main;
    for (const k of comps) {
      if (k === main || k.area < 4) continue;
      if (k.minX >= main.minX - 2 && k.maxX <= main.maxX + 2 && k.minY >= main.minY - 2 && k.maxY <= main.maxY + 2) {
        keep.add(k.id);
        minX = Math.min(minX, k.minX); maxX = Math.max(maxX, k.maxX);
        minY = Math.min(minY, k.minY); maxY = Math.max(maxY, k.maxY);
      }
    }
    const mw = maxX - minX + 1, mh = maxY - minY + 1;
    const mask = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        mask[y * mw + x] = keep.has(labels[(y + minY) * iw + x + minX]) ? 1 : 0;
      }
    }
    return normalize(mask, mw, mh);
  }

  function conflictCount(values) {
    let n = 0;
    const { PEERS } = global.Sudoku;
    for (let i = 0; i < 81; i++) {
      if (!values[i]) continue;
      for (const p of PEERS[i]) if (p > i && values[p] === values[i]) n++;
    }
    return n;
  }

  /** Swaps uncertain cells to their next guess while that removes repeats. */
  function repairConflicts(values, ranks) {
    const { PEERS } = global.Sudoku;
    let conflicts = conflictCount(values);
    for (let pass = 0; pass < 3 && conflicts > 0; pass++) {
      const involved = [];
      for (let i = 0; i < 81; i++) {
        if (values[i] && PEERS[i].some((p) => values[p] === values[i])) involved.push(i);
      }
      involved.sort((a, b) => margin(ranks[a]) - margin(ranks[b]));
      for (const i of involved) {
        const current = values[i];
        let bestDigit = current, bestConf = conflicts;
        for (const alt of ranks[i].slice(1, 3)) {
          if (alt.score < ranks[i][0].score - 0.2) break;
          values[i] = alt.digit;
          const n = conflictCount(values);
          if (n < bestConf) { bestConf = n; bestDigit = alt.digit; }
        }
        values[i] = bestDigit;
        if (bestDigit !== current) {
          ranks[i] = [ranks[i].find((x) => x.digit === bestDigit), ...ranks[i].filter((x) => x.digit !== bestDigit)];
          conflicts = bestConf;
        }
        if (!conflicts) break;
      }
    }
  }

  const margin = (rank) => (rank ? rank[0].score - rank[1].score : Infinity);

  /**
   * Reads the grid inside `corners` of the work canvas.
   * Returns { values, uncertain, warped, valid, solutions }.
   */
  async function read(work, corners) {
    await buildTemplates();
    const warped = warp(work, corners);
    if (!warped) throw new Error('These corners do not form a usable shape.');

    const g = grayOf(warped.data, SIZE * SIZE);
    if (mean(g) < 128) invert(g); // light digits on a dark board
    const bin = adaptiveThreshold(g, SIZE, SIZE, Math.round(CELL / 4), 18);

    const values = new Array(81).fill(0);
    const ranks = new Array(81).fill(null);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const sample = extractDigit(bin, r, c);
        if (!sample) continue;
        const i = r * 9 + c;
        ranks[i] = classify(sample);
        values[i] = ranks[i][0].digit;
      }
    }
    repairConflicts(values, ranks);

    // Tuned on test pictures: correct reads score above ~0.85 almost always.
    const uncertain = values.map((v, i) => !!v && (ranks[i][0].score < 0.8 || margin(ranks[i]) < 0.01));
    const valid = !global.Sudoku.hasConflicts(values);
    const solutions = valid ? global.Sudoku.countSolutions(values, 2) : 0;
    return { values, uncertain, warped, valid, solutions, ranks };
  }

  global.GridReader = {
    loadImage, toWorkCanvas, detectCorners, read, homography, project, SIZE, buildTemplates,
  };
})(window);
