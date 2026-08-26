// The river: geometry, base-water rendering, collision, and the queries every
// other system asks about the water.
//
// The waterways are SPINES — waypoint polylines with a width/speed/depth
// profile — sampled by arc length exactly the way the road painter walks its
// centerlines. Everything else derives from that one representation:
//
//   * the painted water (a signed-distance field around the spine, rendered
//     into cached 256-unit chunks, so the per-frame cost is a few drawImage
//     calls however long the river is),
//   * the collision rects (rasterised from the same field, eroded a few units
//     inside the drawn waterline so the shore stays walkable — the lake's own
//     rule),
//   * the flow field the animated layers ride (gfx/riverfx.js asks for
//     tangent/speed/depth at an arc position; nothing animates in a straight
//     world direction, which is what keeps a bend flowing round the bend),
//   * and the land-clearance query other placement passes use to keep trees
//     and props out of the channel.
//
// Deterministic by construction — hash(), never Math.random — so the banks,
// stones and planting survive a reload byte-for-byte, same as the rest of the
// map. Coordinates are expressed relative to the district anchors where they
// interact with one (the bridge sits on the trunk road's own measured paint;
// the stream ends inside the lake's water), and absolute where the river runs
// through pure wilderness that nothing else owns.

import { hash } from './primitives.js';
import { clamp, clamp01, lerp } from '../../gfx/pixel.js';
import { ROAD_CELL } from './roads.js';
import { POND_W, POND_H } from './lake.js';
import { SPUR_BRIDGE, LINK_BRIDGE } from './bridge.js';

// ---------------------------------------------------------------- the spines
// [x, y, halfWidth, flowSpeed u/s, depthCharacter 0..1]
//
// Width breathes on purpose: the upper river is a mountain stream, the reach
// past the Archive is broad and calm, the island bend is the widest water on
// the map, and the wetland run braids out into the marsh. Depth is a
// CHARACTER value, not units — rapids render shallow and busy even where the
// channel is wide; pools render dark and calm.
//
// The route claims the map's empty margins (NW wilderness, the north band,
// the east margin, the SE corner) and touches the town only where it should:
// north of the Guild, under the trunk-road bridge the Watch guards, past the
// Archive's east lawn, and out through the southern marsh.
const RIVER_PTS = [
  [620, 455, 46, 6, 0.95],    // plunge pool under the falls
  [634, 640, 30, 30, 0.62],   // young river leaves the pool
  [700, 860, 27, 34, 0.5],    // fast rocky run
  [820, 1010, 33, 26, 0.6],
  [1050, 1150, 38, 22, 0.72], // first broad bend
  [1250, 1250, 30, 30, 0.55],
  [1420, 1310, 34, 26, 0.62], // passing north of the Guild
  [1650, 1370, 30, 32, 0.55],
  [1880, 1420, 36, 26, 0.66],
  [2061, 1452, 42, 24, 0.78], // THE BRIDGE — trunk road crossing
  [2250, 1500, 40, 24, 0.7],
  [2430, 1558, 44, 22, 0.74], // the stream branches away here
  [2650, 1608, 40, 26, 0.62],
  [2900, 1650, 44, 24, 0.68],
  [3130, 1700, 42, 26, 0.62],
  [3310, 1790, 48, 22, 0.7],  // NE bend, easing south
  [3410, 1960, 52, 18, 0.82],
  [3425, 2140, 55, 16, 0.85], // the Archive reach — broad, deep, calm
  [3405, 2330, 52, 17, 0.85],
  [3390, 2520, 50, 18, 0.8],
  [3370, 2700, 46, 20, 0.72],
  [3330, 2880, 50, 18, 0.75],
  [3255, 3050, 70, 14, 0.8],  // widening toward the island bend
  [3210, 3180, 84, 12, 0.85], // the island sits in this water
  [3165, 3330, 68, 14, 0.75],
  [3120, 3500, 52, 15, 0.68],
  [3085, 3690, 56, 12, 0.55], // wetland transition begins
  [3060, 3900, 62, 10, 0.5],
  [3040, 4120, 68, 8, 0.45],  // marsh — wide, slow, shallow
  [3025, 4310, 72, 7, 0.42],
  [3015, 4400, 74, 7, 0.4],   // off the south edge of the world
];

// The side-stream: leaves the river east of the bridge and drops south-west
// into the lake, so the two water bodies read as one hydrology. It fords the
// trunk road at STREAM_FORD (stepping stones, no bridge) and dissolves into
// the pond art's own water at its last waypoint. Narrow, quick, shallow.
const STREAM_PTS = [
  [2430, 1558, 30, 22, 0.7],  // confluence — matches the river's own width here
  [2350, 1650, 15, 26, 0.4],
  [2260, 1760, 13, 28, 0.35],
  [2180, 1855, 14, 24, 0.4],
  [2110, 1922, 13, 26, 0.35],
  // The ford: x is the trunk road's own painted centreline at this row,
  // MEASURED off roadCov (the plan says 2050 but the deterministic wander
  // carries the paint east here) — stones and road must agree to the cell.
  [2054, 1968, 12, 24, 0.35],
  [1975, 2028, 14, 22, 0.4],
  [1885, 2108, 12, 26, 0.35],
  [1795, 2195, 14, 22, 0.42],
  [1728, 2272, 15, 18, 0.45],
  // The mouth fans out into a small DELTA as it reaches the lake: widening
  // channel, slowing water, and a reed spit (see ISLANDS) splitting the
  // final stretch in two.
  [1676, 2330, 19, 12, 0.5],
  [1628, 2354, 26, 9, 0.55],  // ends INSIDE the pond's own water (x<1656 here)
];

// Sampling pitch along a spine. 6 units keeps a bend smooth at this art
// scale while the whole network stays around a thousand samples.
const STEP = 6;
// How far the smoothing window reaches when rounding waypoint corners —
// the same averaging trick the road painter uses, so the two read alike.
const SMOOTH = 40;
// Band of shore painted outside the waterline: wet mud, then dry sand,
// then a stipple that frays into the grass.
const BANK_W = 11;
// Collision sits this far inside the drawn waterline, so the player can
// stand at the water's very edge — the lake's own erosion rule.
const SHORE_ERODE = 6;

// ------------------------------------------------------------- edge texture
// Low-frequency waterline wobble, sampled in world space (same recipe as the
// road rasteriser's ragged edge, its own seed). This is what stops the banks
// reading as two parallel curves: each side samples the noise at its own bank
// position, so the two edges undulate out of step.
const EN = 17;
function bankNoise(x, y) {
  const gx = x / EN, gy = y / EN;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const n = (a, b) => hash(a * 57.31 + b * 131.7 + 811) - 0.5;
  const top = n(ix, iy) + (n(ix + 1, iy) - n(ix, iy)) * sx;
  const bot = n(ix, iy + 1) + (n(ix + 1, iy + 1) - n(ix, iy + 1)) * sx;
  return (top + (bot - top) * sy) * 2;   // roughly -1 .. 1
}

// Slow width breathing along the arc, on top of the waypoint widths — a river
// held to its interpolated width still reads drafted; this adds the narrows
// and swells nobody planned.
function widthSwell(s) {
  return 1 + 0.10 * Math.sin(s * 0.011 + 1.7) + 0.06 * Math.sin(s * 0.0037 + 0.4);
}

// ---- islands ---------------------------------------------------------------
// Land the water flows AROUND: folded straight into the signed-distance
// query, so the painted beach ring, the collision, the wildlife clearance
// and the FX masks all get the island for free. The wide south bend carries
// one — an old shrine island the player can see and never reach.
const ISLANDS = [
  { x: 3216, y: 3160, rx: 40, ry: 28 },
  // the delta spit at the stream's mouth — a bar the inflow built, splitting
  // the last few units of channel before the lake
  { x: 1673, y: 2340, rx: 9, ry: 5.5 },
];
function islandLift(x, y) {
  let lift = -1e9;
  for (const isl of ISLANDS) {
    if (x < isl.x - isl.rx - 8 || x > isl.x + isl.rx + 8 ||
        y < isl.y - isl.ry - 8 || y > isl.y + isl.ry + 8) continue;
    const nx = (x - isl.x) / isl.rx, ny = (y - isl.y) / isl.ry;
    // the shore wobbles on the same noise the banks use, so the islet's
    // outline is as irregular as everything else
    const e = Math.sqrt(nx * nx + ny * ny) * (1 + bankNoise(x * 0.8, y * 0.8) * 0.17);
    const d = (1 - e) * Math.min(isl.rx, isl.ry);
    if (d > lift) lift = d;
  }
  return lift;
}

// ------------------------------------------------------------ spine building
function buildWay(pts, id) {
  // arc-length walk with the road painter's corner smoothing
  const lens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(L); total += L;
  }
  const posAt = (d) => {
    d = clamp(d, 0, total);
    let run = 0;
    for (let i = 0; i < lens.length; i++) {
      if (d <= run + lens[i] || i === lens.length - 1) {
        const f = lens[i] > 0 ? (d - run) / lens[i] : 0;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
                lerp(pts[i][2], pts[i + 1][2], f),
                lerp(pts[i][3], pts[i + 1][3], f),
                lerp(pts[i][4], pts[i + 1][4], f)];
      }
      run += lens[i];
    }
    return [pts[0][0], pts[0][1], pts[0][2], pts[0][3], pts[0][4]];
  };
  const smoothPos = (d) => {
    const raw = posAt(d);
    const w = clamp01(Math.min(d, total - d) / (SMOOTH * 2));
    if (w <= 0) return raw;
    let sx = 0, sy = 0;
    for (let k = -2; k <= 2; k++) {
      const p = posAt(d + k * SMOOTH * 0.5);
      sx += p[0]; sy += p[1];
    }
    sx /= 5; sy /= 5;
    return [raw[0] + (sx - raw[0]) * w, raw[1] + (sy - raw[1]) * w, raw[2], raw[3], raw[4]];
  };

  const n = Math.max(2, Math.ceil(total / STEP) + 1);
  const sm = {
    id, total,
    x: new Float32Array(n), y: new Float32Array(n),
    tx: new Float32Array(n), ty: new Float32Array(n),
    hw: new Float32Array(n), spd: new Float32Array(n), dep: new Float32Array(n),
    n,
  };
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * total;
    const p = smoothPos(d);
    const a = smoothPos(Math.max(0, d - STEP)), b = smoothPos(Math.min(total, d + STEP));
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    sm.x[i] = p[0]; sm.y[i] = p[1];
    sm.tx[i] = tx / m; sm.ty[i] = ty / m;
    sm.hw[i] = p[2] * widthSwell(d);
    sm.spd[i] = p[3]; sm.dep[i] = p[4];
  }
  return sm;
}

// Interpolated sample at arc position s (clamped). Used by the FX layers.
function sampleAt(way, s) {
  const f = clamp(s, 0, way.total) / way.total * (way.n - 1);
  const i = Math.min(way.n - 2, Math.floor(f));
  const k = f - i;
  return {
    x: way.x[i] + (way.x[i + 1] - way.x[i]) * k,
    y: way.y[i] + (way.y[i + 1] - way.y[i]) * k,
    tx: way.tx[i] + (way.tx[i + 1] - way.tx[i]) * k,
    ty: way.ty[i] + (way.ty[i + 1] - way.ty[i]) * k,
    hw: way.hw[i] + (way.hw[i + 1] - way.hw[i]) * k,
    spd: way.spd[i] + (way.spd[i + 1] - way.spd[i]) * k,
    dep: way.dep[i] + (way.dep[i + 1] - way.dep[i]) * k,
  };
}

// --------------------------------------------------------- the water query
// Signed distance to the waterline (negative inside water), plus everything
// the caller could want about the nearest channel point. One spatial hash of
// sample indices serves every consumer: painting, collision, placement,
// wildlife clearance.
const GRID = 96;
const GRID_REACH = 2;   // cells searched each way; covers ~200 units of radius

class Waterways {
  constructor(ways) {
    this.ways = ways;
    this.grid = new Map();
    for (let w = 0; w < ways.length; w++) {
      const way = ways[w];
      for (let i = 0; i < way.n; i++) {
        const k = Math.floor(way.x[i] / GRID) + ',' + Math.floor(way.y[i] / GRID);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, cell = []);
        cell.push(w, i);
      }
    }
    // world bbox of all water, padded by the widest bank — the cheap reject
    // for chunk existence tests
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, hwMax = 0;
    for (const way of ways) {
      for (let i = 0; i < way.n; i++) {
        x0 = Math.min(x0, way.x[i]); x1 = Math.max(x1, way.x[i]);
        y0 = Math.min(y0, way.y[i]); y1 = Math.max(y1, way.y[i]);
        hwMax = Math.max(hwMax, way.hw[i]);
      }
    }
    const pad = hwMax + BANK_W + 14;
    this.bbox = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    this.hwMax = hwMax;
  }

  /**
   * Nearest-channel info at a world point, or null when the point is beyond
   * every waterway's influence. `d` is the signed distance to the waterline
   * (noise included): d < 0 is water, 0..BANK_W is the painted shore.
   */
  query(x, y) {
    const cx = Math.floor(x / GRID), cy = Math.floor(y / GRID);
    let best = null, bestPerp = 1e9;
    for (let gy = cy - GRID_REACH; gy <= cy + GRID_REACH; gy++) {
      for (let gx = cx - GRID_REACH; gx <= cx + GRID_REACH; gx++) {
        const cell = this.grid.get(gx + ',' + gy);
        if (!cell) continue;
        for (let c = 0; c < cell.length; c += 2) {
          const way = this.ways[cell[c]], i = cell[c + 1];
          // project onto the segment [i, i+1]
          const j = Math.min(i + 1, way.n - 1);
          const ax = way.x[i], ay = way.y[i];
          const bx = way.x[j], by = way.y[j];
          const abx = bx - ax, aby = by - ay;
          const len2 = abx * abx + aby * aby;
          const t = len2 > 0 ? clamp01(((x - ax) * abx + (y - ay) * aby) / len2) : 0;
          const px = ax + abx * t, py = ay + aby * t;
          const dx = x - px, dy = y - py;
          const perp = Math.hypot(dx, dy);
          // compare against the channel's local width so a narrow stream can
          // never shadow the wide river running beside it
          const hwHere = way.hw[i] + (way.hw[j] - way.hw[i]) * t;
          const rel = perp - hwHere;
          if (best === null || rel < bestPerp) {
            bestPerp = rel;
            best = { way, i, t, perp, px, py };
          }
        }
      }
    }
    if (!best) return null;
    const { way, i, t } = best;
    const j = Math.min(i + 1, way.n - 1);
    const s = (i + t) * STEP;
    const hw = way.hw[i] + (way.hw[j] - way.hw[i]) * t;
    // the waterline itself wobbles: noise sampled at the nominal bank point,
    // so both painting and collision agree about where the water stops
    const nx = -(way.ty[i] + (way.ty[j] - way.ty[i]) * t);
    const ny = way.tx[i] + (way.tx[j] - way.tx[i]) * t;
    const side = ((x - best.px) * nx + (y - best.py) * ny) >= 0 ? 1 : -1;
    const wob = bankNoise(best.px + nx * side * hw, best.py + ny * side * hw);
    const hwEff = Math.max(4, hw + wob * Math.min(6, hw * 0.24));
    // an island lifts the field back above the waterline from inside out
    const d = Math.max(best.perp - hwEff, islandLift(x, y));
    return {
      d,
      s, hw: hwEff, side,
      spd: way.spd[i] + (way.spd[j] - way.spd[i]) * t,
      dep: way.dep[i] + (way.dep[j] - way.dep[i]) * t,
      tx: way.tx[i] + (way.tx[j] - way.tx[i]) * t,
      ty: way.ty[i] + (way.ty[j] - way.ty[i]) * t,
      wayId: way.id,
    };
  }

  /** Distance from a point to the nearest waterline; large when far away.
   *  Positive on land — the guard other placement passes test against. */
  landClearance(x, y) {
    if (x < this.bbox.x0 || x > this.bbox.x1 || y < this.bbox.y0 || y > this.bbox.y1) return 1e9;
    const q = this.query(x, y);
    return q ? q.d : 1e9;
  }
}

// ------------------------------------------------------------- water colours
// Anchored on the pond art's own measured water (69,126,145) so the lake and
// the river read as the same water, then spread into a ramp the pond's flat
// fill never needed: shallows warm toward the sand, the deep channel cools
// and darkens. Bank earth reuses the game's existing dirt tones.
const COL = {
  deep2: [38, 78, 102],
  deep: [48, 95, 118],
  mid: [62, 118, 138],
  shallow: [78, 136, 150],
  shore: [98, 150, 156],     // thin bright line where water meets land
  wetMud: [116, 106, 78],
  mud: [138, 124, 88],
  sand: [158, 142, 100],
  sandLight: [172, 156, 112],
};

// ------------------------------------------------------------ chunk renderer
// The base water + banks are STATIC, so they render once into 256-unit chunk
// canvases and the per-frame cost is a handful of drawImage calls. The field
// is evaluated on a 4-unit lattice and bilinearly interpolated per pixel —
// the signed distance is 1-Lipschitz, so the interpolation error is under a
// pixel, and the per-pixel work is just the dither/texture hashes.
const CHUNK = 256;
const LAT = 4;                       // lattice pitch for the field evaluation
const CHUNK_KEEP = 24;               // LRU cap ≈ 6 MB of canvases

function renderChunk(waterways, ckx, cky, passages) {
  const x0 = ckx * CHUNK, y0 = cky * CHUNK;
  // cheap reject: does any spine pass near this chunk at all?
  const b = waterways.bbox;
  if (x0 > b.x1 || x0 + CHUNK < b.x0 || y0 > b.y1 || y0 + CHUNK < b.y0) return null;

  // One pixel of overlap with the next chunk (SIZE = CHUNK+1): at fractional
  // camera zooms the per-chunk drawImage rects round independently, and
  // without the shared column a 1px seam of grass opened between chunks.
  const SIZE = CHUNK + 1;
  const N = CHUNK / LAT + 2;
  const fd = new Float32Array(N * N);       // signed distance to waterline
  const fdep = new Float32Array(N * N);     // depth character
  const fs = new Float32Array(N * N);       // arc position (texture phase)
  let any = false;
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      const q = waterways.query(x0 + gx * LAT, y0 + gy * LAT);
      const i = gy * N + gx;
      if (!q) { fd[i] = 1e3; continue; }
      fd[i] = q.d; fdep[i] = q.dep; fs[i] = q.s;
      if (q.d < BANK_W + 4) any = true;
    }
  }
  if (!any) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const cg = canvas.getContext('2d');
  const img = cg.createImageData(SIZE, SIZE);
  const px = img.data;

  const put = (o, c, a = 255) => { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = a; };

  for (let y = 0; y < SIZE; y++) {
    const wy = y0 + y;
    const gy = y / LAT, iy = Math.min(N - 2, Math.floor(gy)), fy = gy - iy;
    for (let x = 0; x < SIZE; x++) {
      const wx = x0 + x;
      const gx = x / LAT, ix = Math.min(N - 2, Math.floor(gx)), fx = gx - ix;
      const i00 = iy * N + ix;
      const d = (fd[i00] * (1 - fx) + fd[i00 + 1] * fx) * (1 - fy)
              + (fd[i00 + N] * (1 - fx) + fd[i00 + N + 1] * fx) * fy;
      if (d > BANK_W + 3) continue;                    // open grass — transparent
      const o = (y * SIZE + x) * 4;
      const h = hash(wx * 3.1 + wy * 7.7);             // per-pixel dither salt

      // How far into the marsh this pixel is: the river's last reach turns
      // its banks to mud and its water murky-green. (Only the river's arc
      // ever exceeds the stream's total length, so no way test is needed.)
      const sHere = (fs[i00] * (1 - fx) + fs[i00 + 1] * fx) * (1 - fy)
                  + (fs[i00 + N] * (1 - fx) + fs[i00 + N + 1] * fx) * fy;
      const marsh = clamp01((sHere - 4880) / 320);

      if (d >= 0) {
        // ---- the shore: wet mud at the waterline, drying to sand, then a
        // stipple that lets the grass through — whole pixels dropped, never
        // alpha-blended, which is how pixel art feathers an edge.
        const k = d / BANK_W;
        if (k > 0.72 + h * 0.3) continue;              // frayed outer edge
        const band = k + (h - 0.5) * 0.22;             // dithered band edges
        let c = band < 0.18 ? COL.wetMud
              : band < 0.5 ? COL.mud
              : band < 0.8 ? COL.sand : COL.sandLight;
        if (marsh > 0) {
          // wet peat instead of dry sand, with standing-water pockets
          const mc = band < 0.3 ? [86, 82, 60] : band < 0.65 ? [104, 98, 70] : [121, 114, 82];
          c = [Math.round(lerp(c[0], mc[0], marsh)), Math.round(lerp(c[1], mc[1], marsh)),
               Math.round(lerp(c[2], mc[2], marsh))];
          if (marsh > 0.5 && hash(wx * 2.9 + wy * 6.1 + 21) > 0.93) c = [70, 104, 108]; // puddle glint
        }
        put(o, c);
        // occasional pebble speck on the dry sand
        if (band > 0.4 && marsh < 0.4 && hash(wx * 1.7 + wy * 9.3 + 5) > 0.965) put(o, [120, 112, 92]);
        continue;
      }

      // ---- the water: depth toward the channel centre, scaled by the
      // reach's own character (a marsh never goes black, a pool does)
      const dep = (fdep[i00] * (1 - fx) + fdep[i00 + 1] * fx) * (1 - fy)
                + (fdep[i00 + N] * (1 - fx) + fdep[i00 + N + 1] * fx) * fy;
      const sPh = (fs[i00] * (1 - fx) + fs[i00 + 1] * fx) * (1 - fy)
                + (fs[i00 + N] * (1 - fx) + fs[i00 + N + 1] * fx) * fy;
      const hwLoc = Math.max(8, -d + 1);               // only used near centre
      // normalised "how far into the water", using the local field slope —
      // -d grows toward the centre, so scale by an estimate of the half width
      const into = clamp01(-d / 26);
      const depth = clamp01(into * (0.55 + dep * 0.75));
      // low-frequency mottling stretched ALONG the flow (s changes slowly
      // sideways, quickly downstream), so even the still base hints at grain
      const mot = Math.sin(sPh * 0.11 + wx * 0.017 + wy * 0.013)
                + Math.sin(sPh * 0.043 - wy * 0.011);
      const depthJ = clamp01(depth + mot * 0.05 + (h - 0.5) * 0.10);
      let c = depthJ < 0.10 ? COL.shore
            : depthJ < 0.30 ? COL.shallow
            : depthJ < 0.58 ? COL.mid
            : depthJ < 0.85 ? COL.deep : COL.deep2;
      if (marsh > 0) {
        // the marsh greens and lightens the water — silt, not depth
        const k2 = marsh * 0.55;
        c = [Math.round(lerp(c[0], 74, k2)), Math.round(lerp(c[1], 122, k2)),
             Math.round(lerp(c[2], 118, k2))];
      }
      put(o, c);
      // sparse fixed sparkle so untouched water is never a flat field
      if (hash(wx * 12.3 + wy * 4.7 + 9) > 0.994 && depthJ < 0.5) put(o, [150, 190, 195]);
      void hwLoc;
    }
  }
  cg.putImageData(img, 0, 0);

  // submerged stones: darker rounded blobs sitting under the surface, placed
  // from the same deterministic scatter every reload. Drawn after the field
  // so they read as IN the water, not on it.
  for (let n = 0; n < 26; n++) {
    const sx = x0 + hash(ckx * 51.3 + cky * 17.9 + n * 3.7) * CHUNK;
    const sy = y0 + hash(ckx * 29.1 + cky * 43.7 + n * 5.1 + 1) * CHUNK;
    const q = waterways.query(sx, sy);
    if (!q || q.d > -7 || q.dep > 0.8) continue;       // shallow-ish water only
    if (hash(n * 7.7 + ckx + cky) > 0.4) continue;
    const r = 2 + hash(n * 9.1 + ckx * 3) * 3;
    cg.fillStyle = 'rgba(40,80,98,0.55)';
    cg.beginPath(); cg.ellipse(sx - x0, sy - y0, r, r * 0.7, 0, 0, Math.PI * 2); cg.fill();
    cg.fillStyle = 'rgba(90,140,152,0.5)';
    cg.fillRect(Math.round(sx - x0 - r * 0.3), Math.round(sy - y0 - r * 0.4), Math.max(1, Math.round(r * 0.8)), 1);
  }

  // lily pads in the marsh reach: flat leaves clustered in the slack water
  // near the banks, the way they grow. Baked — they never move, and the
  // frogs stay the pond's.
  for (let n = 0; n < 26; n++) {
    const sx = x0 + hash(ckx * 23.9 + cky * 71.3 + n * 4.1 + 7) * CHUNK;
    const sy = y0 + hash(ckx * 67.1 + cky * 13.7 + n * 6.3 + 8) * CHUNK;
    const q = waterways.query(sx, sy);
    if (!q || q.s < 4950 || q.d > -4 || q.d < -24 || q.spd > 14) continue;
    const count = 3 + Math.floor(hash(n * 5.9 + ckx) * 3);
    for (let k = 0; k < count; k++) {
      const px = sx + (hash(n * 7.1 + k * 3.3) - 0.5) * 22;
      const py = sy + (hash(n * 9.7 + k * 5.1 + 1) - 0.5) * 14;
      const q2 = waterways.query(px, py);
      if (!q2 || q2.d > -4) continue;
      const pr = 2.4 + hash(n * 3.1 + k * 7.7) * 2.6;
      cg.fillStyle = '#20351d';
      cg.beginPath(); cg.ellipse(px - x0, py - y0 + 0.7, pr + 0.8, pr * 0.72 + 0.7, 0, 0, Math.PI * 2); cg.fill();
      cg.fillStyle = '#4f8347';
      cg.beginPath(); cg.ellipse(px - x0, py - y0, pr, pr * 0.72, 0, 0, Math.PI * 2); cg.fill();
      cg.fillStyle = '#74ab64';
      cg.beginPath(); cg.ellipse(px - x0 - pr * 0.25, py - y0 - pr * 0.2, pr * 0.55, pr * 0.4, 0, 0, Math.PI * 2); cg.fill();
      // the notch: a slit of water cut back to the centre
      cg.strokeStyle = `rgb(${COL.shallow[0]},${COL.shallow[1]},${COL.shallow[2]})`;
      cg.beginPath();
      const na = hash(n * 11.3 + k) * Math.PI * 2;
      cg.moveTo(px - x0, py - y0);
      cg.lineTo(px - x0 + Math.cos(na) * (pr + 1), py - y0 + Math.sin(na) * (pr * 0.72 + 1));
      cg.stroke();
      // rare bloom
      if (hash(n * 13.7 + k * 2.9) > 0.85) {
        cg.fillStyle = '#e8dced';
        cg.fillRect(Math.round(px - x0), Math.round(py - y0 - 1), 2, 2);
        cg.fillStyle = '#c9a8d4';
        cg.fillRect(Math.round(px - x0), Math.round(py - y0), 1, 1);
      }
    }
  }
  void passages;
  return canvas;
}

// ------------------------------------------------------------------- build
/**
 * Builds the waterway system onto the scene: geometry, collision, and the
 * queries. Called from buildTown AFTER the road coverage exists (bank decor
 * and the ford need the painted roads) and BEFORE the lake detail pass
 * (whose planting must stay out of the stream).
 */
export function buildRiver(scene) {
  const ways = [buildWay(RIVER_PTS, 'river'), buildWay(STREAM_PTS, 'stream')];
  const ww = new Waterways(ways);
  scene.waterways = ww;
  ww.chunks = new Map();      // rendered chunk cache, LRU by last-use frame
  ww.chunkTick = 0;

  // Walkable gaps punched through the water collision: the bridge deck on
  // the trunk road, and the stepping-stone ford on the stream. Both rects
  // are centred on the trunk road's own painted centreline at their rows —
  // measured off the deterministic roadCov (2055 at the bridge, 2054 at the
  // ford; the plan's 2050/2061 drift under the road wander) — so deck,
  // stones, road and collision gap all agree.
  ww.passages = [
    { x: 2055 - 30, y: 1452 - 84, w: 60, h: 168, kind: 'bridge' },
    { x: 2054 - 27, y: 1968 - 30, w: 54, h: 60, kind: 'ford' },
    // Wild boulder-hop over the upper river — the one way across into the
    // NW wilderness without coming round by the bridge. Deliberately rough:
    // no road reaches it, you find it.
    { x: 1150 - 22, y: 1206 - 48, w: 44, h: 96, kind: 'boulders' },
    // The Archive landing: walkable water under the dock planks
    // (town/riverfront.js owns the structure; the rect must live here so
    // the collision pass below can honour it).
    { x: 3350, y: 2204, w: 50, h: 24, kind: 'dock' },
    // The two stream bridges (town/bridge.js owns their structure and the
    // edge solids that seal these rects): the Guild spur's stone slab and
    // the Archive link's footbridge. Before these existed the stream's
    // collision walled both roads shut.
    SPUR_BRIDGE.passage,
    LINK_BRIDGE.passage,
  ];
  // Re-blit windows where the water must win over something painted later:
  // the ford strip repaints over the ROADS, the stream mouth repaints over
  // the POND art's baked east shore so the stream visibly enters the lake's
  // water instead of vanishing under its painted bank. The mouth window is
  // additionally MASKED to the pond art's own opaque-land pixels (see
  // drawWaterOverlays) — an unmasked blit painted procedural water over the
  // pond's water and the window showed as a rectangle.
  ww.overlays = [
    { x: 2054 - 34, y: 1968 - 42, w: 68, h: 84, stage: 'roads' },
    { x: 1632, y: 2296, w: 104, h: 104, stage: 'pond', maskToPondLand: true },
  ];

  // ---- collision -------------------------------------------------------
  // Rasterised from the same field the paint uses, eroded SHORE_ERODE inside
  // the waterline, in 8-unit row bands merged into x-runs — the pond's own
  // decomposition, computed from geometry instead of pixels.
  const rects = [];
  const ROW = 8, COLSTEP = 4;
  const bx0 = Math.floor(ww.bbox.x0 / COLSTEP) * COLSTEP;
  const bx1 = Math.ceil(ww.bbox.x1 / COLSTEP) * COLSTEP;
  const by0 = Math.floor(ww.bbox.y0 / ROW) * ROW;
  const by1 = Math.ceil(ww.bbox.y1 / ROW) * ROW;
  const inPassage = (x, y) => ww.passages.some((p) =>
    x > p.x - 2 && x < p.x + p.w + 2 && y > p.y - 2 && y < p.y + p.h + 2);
  for (let y = by0; y <= by1; y += ROW) {
    let run0 = null;
    const cy = y + ROW / 2;
    for (let x = bx0; x <= bx1 + COLSTEP; x += COLSTEP) {
      const q = x <= bx1 ? ww.query(x, cy) : null;
      const solid = q && q.d < -SHORE_ERODE && !inPassage(x, cy);
      if (solid && run0 === null) run0 = x;
      else if (!solid && run0 !== null) {
        rects.push({ x: run0 - COLSTEP / 2, y, w: x - run0, h: ROW });
        run0 = null;
      }
    }
  }
  ww.waterRects = rects;
  for (const r of rects) scene.solids.push(r);
}

// -------------------------------------------------------------------- draw
/**
 * The base water + banks for everything in view. Chunks render on first
 * approach and are then blitted; the cache is trimmed by least-recent use.
 * Draw AFTER the grass and BEFORE the pond art (the stream dissolves under
 * the pond's own shoreline); the roads paint after this and the ford strip
 * is re-blitted on top of them — see drawFordOverlay.
 */
export function drawRiverBase(scene, g, visW, visH) {
  const ww = scene.waterways;
  if (!ww) return;
  ww.chunkTick++;
  const c0 = Math.floor(scene.camX / CHUNK), c1 = Math.floor((scene.camX + visW) / CHUNK);
  const r0 = Math.floor(scene.camY / CHUNK), r1 = Math.floor((scene.camY + visH) / CHUNK);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const key = cx + ',' + cy;
      let entry = ww.chunks.get(key);
      if (entry === undefined) {
        entry = { canvas: renderChunk(ww, cx, cy, ww.passages), tick: 0 };
        ww.chunks.set(key, entry);
        if (ww.chunks.size > CHUNK_KEEP) {
          let oldK = null, oldT = 1e18;
          for (const [k, e] of ww.chunks) {
            if (e.canvas === null) continue;          // null markers are free
            if (e.tick < oldT) { oldT = e.tick; oldK = k; }
          }
          if (oldK && oldK !== key) ww.chunks.delete(oldK);
        }
      }
      entry.tick = ww.chunkTick;
      if (entry.canvas) g.drawImage(entry.canvas, cx * CHUNK, cy * CHUNK);
    }
  }
}

/**
 * Re-blit of the water base inside the overlay windows for one stage: after
 * drawRoads ('roads' — the ford, so the trunk road dips INTO the stream) and
 * after the pond art ('pond' — the stream mouth, so it enters the lake's
 * real water instead of vanishing under the art's baked shore). The chunk
 * pixels outside the water/banks are transparent, so a window never shows
 * its own rectangle.
 */
export function drawWaterOverlays(scene, g, visW, visH, stage, pondInfo) {
  const ww = scene.waterways;
  if (!ww) return;
  for (const p of ww.overlays) {
    if (p.stage !== stage) continue;
    const x0 = p.x, y0 = p.y, w = p.w, h = p.h;
    if (x0 + w < scene.camX || x0 > scene.camX + visW || y0 + h < scene.camY || y0 > scene.camY + visH) continue;

    if (p.maskToPondLand) {
      // The stream-mouth window: repaint only over the pond art's own
      // opaque LAND pixels, so the stream cuts an inlet notch through the
      // painted shore but never repaints the pond's water (which showed as
      // a rectangle of off-tone water). Built once, cached on the overlay.
      if (!p._masked && pondInfo) p._masked = buildMaskedOverlay(scene, ww, p, pondInfo);
      if (p._masked) g.drawImage(p._masked, x0, y0);
      continue;
    }

    const ck0x = Math.floor(x0 / CHUNK), ck1x = Math.floor((x0 + w) / CHUNK);
    const ck0y = Math.floor(y0 / CHUNK), ck1y = Math.floor((y0 + h) / CHUNK);
    for (let cy = ck0y; cy <= ck1y; cy++) {
      for (let cx = ck0x; cx <= ck1x; cx++) {
        const entry = ww.chunks.get(cx + ',' + cy);
        if (!entry || !entry.canvas) continue;
        const sx = Math.max(x0, cx * CHUNK), sy = Math.max(y0, cy * CHUNK);
        const ex = Math.min(x0 + w, (cx + 1) * CHUNK), ey = Math.min(y0 + h, (cy + 1) * CHUNK);
        if (ex <= sx || ey <= sy) continue;
        g.drawImage(entry.canvas, sx - cx * CHUNK, sy - cy * CHUNK, ex - sx, ey - sy,
                    sx, sy, ex - sx, ey - sy);
      }
    }
  }
}

// The mouth window's masked canvas: the waterways field re-rendered locally
// (chunks may not be resident when this first runs), kept only where the
// pond art is opaque land. See the maskToPondLand overlay above.
function buildMaskedOverlay(scene, ww, p, pondInfo) {
  const c = document.createElement('canvas');
  c.width = p.w; c.height = p.h;
  const cg = c.getContext('2d');
  const img = cg.createImageData(p.w, p.h);
  const px = img.data;
  const L = scene.lakeTopLeft;
  const kx = pondInfo.w / POND_W, ky = pondInfo.h / POND_H;   // art px per world unit
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const wx = p.x + x, wy = p.y + y;
      // pond land only: opaque art pixel that is not pond water
      const sx = Math.round((wx - L.x) * kx), sy = Math.round((wy - L.y) * ky);
      if (sx < 0 || sy < 0 || sx >= pondInfo.w || sy >= pondInfo.h) continue;
      const si = sy * pondInfo.w + sx;
      if (pondInfo.mask[si]) continue;                        // pond water
      if (!pondInfo.rgba || pondInfo.rgba[si * 4 + 3] < 150) continue; // transparent
      const q = ww.query(wx, wy);
      if (!q || q.d > BANK_W) continue;
      const o = (y * p.w + x) * 4;
      const h2 = hash(wx * 3.1 + wy * 7.7);
      if (q.d >= 0) {
        const k = q.d / BANK_W;
        if (k > 0.72 + h2 * 0.3) continue;
        const band = k + (h2 - 0.5) * 0.22;
        const cc = band < 0.18 ? COL.wetMud : band < 0.5 ? COL.mud
                 : band < 0.8 ? COL.sand : COL.sandLight;
        px[o] = cc[0]; px[o + 1] = cc[1]; px[o + 2] = cc[2]; px[o + 3] = 255;
        continue;
      }
      const into = clamp01(-q.d / 26);
      const depth = clamp01(into * (0.55 + q.dep * 0.75));
      const depthJ = clamp01(depth + (h2 - 0.5) * 0.10);
      const cc = depthJ < 0.10 ? COL.shore : depthJ < 0.30 ? COL.shallow
               : depthJ < 0.58 ? COL.mid : depthJ < 0.85 ? COL.deep : COL.deep2;
      px[o] = cc[0]; px[o + 1] = cc[1]; px[o + 2] = cc[2]; px[o + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  return c;
}

/**
 * Windows of calm, deep water where the pond's fish-jump sheet may play:
 * the plunge pool under the falls and the broad Archive reach. Each carries
 * a function-backed info object (see gfx/waterfx.js waterAt) lending the
 * analytic field to the wildlife code — no mask bitmap involved.
 */
export function riverJumpRegions(scene) {
  const ww = scene.waterways;
  if (!ww) return [];
  if (!ww._jumpRegions) {
    const mk = (left, top, w, h, period, count) => ({
      left, top, w, h, period, count,
      info: {
        isWaterFn: (dx, dy) => { const q = ww.query(left + dx, top + dy); return q !== null && q.d < -3; },
        clearFn: (cx, cy) => { const q = ww.query(left + cx, top + cy); return q ? -q.d : 0; },
      },
    });
    ww._jumpRegions = [
      mk(552, 402, 136, 112, 16, 1),     // the plunge pool
      mk(3330, 2080, 170, 330, 13, 1),   // the Archive reach
    ];
  }
  return ww._jumpRegions;
}

export { sampleAt, RIVER_PTS, STREAM_PTS, ISLANDS, BANK_W, SHORE_ERODE, COL as RIVER_COL, CHUNK as RIVER_CHUNK };
