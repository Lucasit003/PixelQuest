// Town road network: families, rasterisation and painting.
//
// Roads exist at two resolutions and confusing them is the classic bug here.
// `scene.roads` is a coarse list of rects used for planning and for
// keep-clear tests; `scene.roadCov` is the fine 4-unit coverage map that is
// actually painted, and it sweeps square corners into diagonals. Anything
// hugging a kerb must sample roadCov — a spot that looks clear against the
// rects can sit squarely on the paint.
//
// Entry points:
//   buildRoadCoverage(scene, FC)   fills scene.roadCov from scene.roadPlan
//   drawRoads(scene, g, visW, visH)  paints it
//   roadPath(points, width)        polyline -> the rects scene.roads holds
//
// The scene is passed explicitly rather than bound as `this`; the only fields
// touched are plazaRadius, roadPlan, roadCov, camX and camY.

import { rect, clamp, clamp01, lerp } from '../../gfx/pixel.js';
import { hash } from './primitives.js';
import { PLAZA_TILES, ROAD_TILE } from './tiles.js';

// ------------------------------------------------------- road families ---
// Five material families from the approved Road System Design doc. All five
// are built from the SAME Crystal Plaza Modular Stone Pack already on disk,
// so the entire network reads as one masonry world rather than five unrelated
// tilesets — families differ by which variants they favour and by a subtle
// per-family colour wash. No new art is required for this pass; when authored
// road pieces arrive, a family's `pool`/`rough` lists are the only thing that
// has to change.
//
// `roughAt` is the probability a cell uses the rougher list instead of the
// clean one — the single knob that carries "well-maintained" vs "reclaimed".
// `pri` decides the winner where two roads overlap (a main road paints over
// a footpath, never the reverse).
const ROAD_FAM = {
  main: {   // Main Town Cobblestone — clean, light, faintly warm: the civic road
    pool: ['mix_base01', 'mix_base02', 'mix_base03', 'mix_base04', 'mix_base05'],
    rough: ['mix_weathered06', 'mix_weathered07'],
    roughAt: 0.16, wash: [214, 178, 120, 0.13], edge: 'rgba(52,44,30,0.34)', pri: 5,
  },
  civic: {  // Civic-Adventure — heavier, cooler, more serious flagstone
    pool: ['base1', 'base2', 'base3', 'base4'],
    rough: ['weathered', 'worn1', 'worn2'],
    roughAt: 0.34, wash: [52, 66, 98, 0.30], edge: 'rgba(30,32,44,0.40)', pri: 4,
  },
  ancient: { // Ancient/Ruined — cold, cracked, mossy, losing the fight
    pool: ['weathered', 'cracked', 'mix_weathered08', 'mix_weathered09'],
    rough: ['grasscracks', 'lightmoss', 'edge_broken'],
    roughAt: 0.46, wash: [44, 46, 64, 0.42], edge: 'rgba(22,22,30,0.46)', pri: 4,
  },
  res: {    // Residential Stone Path — warm, worn smooth by daily use
    pool: ['worn1', 'worn2', 'base2', 'base3'],
    rough: ['lightmoss', 'grasscracks'],
    roughAt: 0.30, wash: [158, 104, 46, 0.28], edge: 'rgba(56,42,24,0.36)', pri: 3,
  },
  nature: { // Nature/Scenic — grass reclaiming a dirt footpath
    pool: ['grasscracks', 'edge_grass1', 'edge_grass2'],
    rough: ['lightmoss', 'edge_moss'],
    roughAt: 0.50, wash: [86, 124, 58, 0.42], edge: 'rgba(40,62,32,0.38)', pri: 2,
  },
};

// Family transitions are carried by the colour wash, interpolated along the
// route, rather than by dithering between two tile pools. A town road is only
// ~1.2 stone tiles wide, so ANY tile-granularity mix on it lands as chunky
// bands across the width instead of a blend; a wash gradient is independent of
// road width and reads smooth at every size. The tile pool still swaps at the
// midpoint, but underneath a wash that already matches, so the swap is
// invisible. Blends are quantised to 9 steps and cached, so drawing a cell is
// a plain lookup rather than per-frame string building.

const WASH_STEPS = 8;
const WASH_CACHE = new Map();
function washFor(fam0, fam1, q) {
  const key = fam0 + '|' + (fam1 || '') + '|' + q;
  const hit = WASH_CACHE.get(key);
  if (hit !== undefined) return hit;
  const a = ROAD_FAM[fam0] && ROAD_FAM[fam0].wash;
  const b = fam1 && ROAD_FAM[fam1] ? ROAD_FAM[fam1].wash : a;
  let out = null;
  if (a && b) {
    const m = q / WASH_STEPS;
    const r = Math.round(a[0] + (b[0] - a[0]) * m);
    const g = Math.round(a[1] + (b[1] - a[1]) * m);
    const bl = Math.round(a[2] + (b[2] - a[2]) * m);
    const al = a[3] + (b[3] - a[3]) * m;
    out = `rgba(${r},${g},${bl},${al.toFixed(3)})`;
  }
  WASH_CACHE.set(key, out);
  return out;
}
// Deterministic per-tile variant pick, so the stone pattern is stable across
// frames and identical on every reload.
function roadTileFor(fam, tc, tr) {
  const F = ROAD_FAM[fam] || ROAD_FAM.main;
  const list = hash(tc * 7.7 + tr * 3.1 + 220) < F.roughAt ? F.rough : F.pool;
  const i = Math.floor(hash(tc * 4.3 + tr * 9.1 + 77) * list.length) % list.length;
  return PLAZA_TILES[list[i]];
}

// Coverage resolution for the road surface. Deliberately much finer than
// ROAD_TILE (28): roads are 13-34 units wide, so a tile-sized grid could only
// ever express "one tile" or "two tiles" and every family would collapse to
// the same width. At 4 units the painted width matches the design spec
// exactly while the stone texture still samples from the 28-unit tile grid,
// which keeps the masonry continuous across the whole network.
const ROAD_CELL = 4;

// ROAD_FAM and washFor are exported for the plaza floor, which blends into the
// same masonry; ROAD_CELL for the keep-clear tests that sample the paint.
export { ROAD_FAM, ROAD_CELL, washFor, roadTileFor, roadPath, strokeRoundedPath, roadSeg };

export function buildRoadCoverage(scene, FC) {
  const C = ROAD_CELL;
  const cov = new Map();
  const R = scene.plazaRadius;

  // Low-frequency ragged-edge offset. Sampled on a coarse (12-unit) lattice
  // and blended between lattice points so the edge undulates in soft lobes
  // rather than flickering cell to cell — per-cell randomness would read as
  // static fuzz, not wear.
  const EN = 12;
  const edgeNoise = (x, y) => {
    const gx = x / EN, gy = y / EN;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const n = (a, b) => hash(a * 41.3 + b * 97.7) - 0.5;
    const top = n(ix, iy) + (n(ix + 1, iy) - n(ix, iy)) * sx;
    const bot = n(ix, iy + 1) + (n(ix + 1, iy + 1) - n(ix, iy + 1)) * sx;
    return (top + (bot - top) * sy) * 7;
  };

  const mark = (x, y, fam, t, wash) => {
    const cx = Math.floor(x / C), cy = Math.floor(y / C);
    const px = cx * C + C / 2, py = cy * C + C / 2;
    // Roads deliberately run UNDER the plaza rather than stopping at its
    // edge. The plaza floor is painted after the roads and is fully opaque,
    // so the overlap is invisible — and stopping short caused two visible
    // faults at the junction: the plaza's edge is jittered (±5%), so at
    // angles where it fell inside the cut-off a ring of bare grass showed
    // between paving and road; and a road ending there counted as an edge,
    // so the frayed-edge stipple punched holes into the surface exactly
    // where it should read as solid. Only the innermost area is skipped,
    // purely to avoid marking cells no one can ever see.
    if (Math.hypot(px - FC.x, py - FC.y) < R * 0.55) return;
    const k = cx + ',' + cy;
    const prev = cov.get(k);
    const pri = (ROAD_FAM[fam] || ROAD_FAM.main).pri;
    if (prev && prev.pri >= pri) return; // a main road paints over a footpath
    cov.set(k, { fam, t, pri, wash });
  };

  for (let segIdx = 0; segIdx < scene.roadPlan.length; segIdx++) {
    const seg = scene.roadPlan[segIdx];
    // Follow the waypoints DIRECTLY, including diagonals. roadPath() has to
    // emit axis-aligned L-bends because it feeds an axis-aligned rect list,
    // but the painted surface has no such constraint — walking the true
    // line is what stops the network from reading as stair-stepped plumbing.
    const pts = seg.pts;

    const lens = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      lens.push(L); total += L;
    }
    const w0 = seg.w0 != null ? seg.w0 : seg.width;
    const w1 = seg.w1 != null ? seg.w1 : w0;

    // Eased blend factor along the route: each end stays pure, only the
    // middle transitions (a linear ramp would leave the whole road looking
    // half-and-half end to end). Drives the wash gradient; the tile pool
    // swaps once at the midpoint underneath it.
    const blendAt = (t) => {
      if (!seg.famTo) return 0;
      const k = clamp01((t - 0.3) / 0.4);
      return k * k * (3 - 2 * k);
    };
    // Which family's STONE is laid here. The wash above already carries the
    // colour smoothly, but swapping the tile pool at a single midpoint still
    // shows up as a hard line where the masonry pattern changes. Interleaving
    // whole tiles across the middle of the blend hides that seam — and it is
    // safe to dither here, unlike the wash, because both pools now sit under
    // the same colour, so a mixed tile reads as texture rather than a stripe.
    const poolFam = (x, y, bl) => {
      const a = seg.fam || 'main';
      if (!seg.famTo) return a;
      if (bl <= 0.12) return a;
      if (bl >= 0.88) return seg.famTo;
      const tx = Math.floor(x / ROAD_TILE), ty = Math.floor(y / ROAD_TILE);
      return hash(tx * 12.9898 + ty * 78.233) < bl ? seg.famTo : a;
    };

    // ---- natural wander -------------------------------------------------
    // Roads drift sideways as they run, instead of being drawn taut between
    // waypoints. Two sine octaves at unrelated wavelengths give a meander
    // that never visibly repeats, and the amplitude is windowed to ZERO at
    // both ends of the route — that part is essential, not cosmetic: every
    // junction, building approach, plaza flare and the Watch's arch is
    // positioned on the un-wandered endpoint, so a road that drifted at its
    // ends would pull away from whatever it is supposed to meet. Engineered
    // town roads wander least; wilderness footpaths wander most.
    // [amplitude, wavelength] in world units. Wavelength is the real
    // distance between crests — roughly one gentle curve per screen at the
    // 300-unit gameplay viewport, so the bend is legible while walking
    // rather than only visible on the overview.
    const WOB = { main: [26, 430], res: [11, 200], secondary: [27, 330], adventure: [30, 530] };
    const wobDef = seg.wob !== undefined ? seg.wob : WOB[seg.kind] || WOB.secondary;
    const wobSeed = segIdx * 3.77;
    const TAU = Math.PI * 2;
    const lateral = (dist) => {
      if (!wobDef || !wobDef[0] || total <= 0) return 0;
      const [amp, wave] = wobDef;
      const win = Math.sin(Math.PI * clamp01(dist / total)); // 0 at both ends
      return win * amp * (
        Math.sin(dist / wave * TAU + wobSeed) * 0.75 +
        Math.sin(dist / (wave * 0.41) * TAU + wobSeed * 2.3) * 0.25
      );
    };

    // Position at a given arc length along the raw polyline.
    const posAt = (d) => {
      d = clamp(d, 0, total);
      let run = 0;
      for (let i = 0; i < lens.length; i++) {
        if (d <= run + lens[i] || i === lens.length - 1) {
          const f = lens[i] > 0 ? (d - run) / lens[i] : 0;
          return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                  pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
        }
        run += lens[i];
      }
      return [pts[0][0], pts[0][1]];
    };
    // Corner-rounded position: a small averaging window over the polyline,
    // which turns each hard waypoint corner into an arc the way a real road
    // sweeps through a bend. The window's influence fades to nothing at both
    // ends so the route still starts and finishes exactly on its endpoints.
    const SM = 34;
    const smoothPos = (d) => {
      const raw = posAt(d);
      const w = clamp01(Math.min(d, total - d) / (SM * 2));
      if (w <= 0) return raw;
      let sx = 0, sy = 0;
      for (let k = -2; k <= 2; k++) {
        const p = posAt(d + k * SM * 0.5);
        sx += p[0]; sy += p[1];
      }
      sx /= 5; sy /= 5;
      return [raw[0] + (sx - raw[0]) * w, raw[1] + (sy - raw[1]) * w];
    };
    // Tangent from the rounded centreline, sampled either side, so the
    // normal turns continuously instead of snapping at each waypoint — a
    // snapping normal makes the wander jog sideways as the road crosses a
    // vertex, which reads as a break in the road rather than a curve.
    const frameAt = (d) => {
      const a = smoothPos(Math.max(0, d - SM * 0.5));
      const b = smoothPos(Math.min(total, d + SM * 0.5));
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const m = Math.hypot(tx, ty) || 1;
      tx /= m; ty /= m;
      return { nx: -ty, ny: tx };
    };

    const stepLen = C * 0.5;
    const nSteps = Math.max(1, Math.ceil(total / stepLen));
    for (let s = 0; s <= nSteps; s++) {
      const dist = (s / nSteps) * total;
      const t = total > 0 ? dist / total : 0;
      const { nx, ny } = frameAt(dist);
      const base = smoothPos(dist);
      const lat = lateral(dist);
      const x = base[0] + nx * lat, y = base[1] + ny * lat;
      const half = lerp(w0, w1, t) / 2;
      const bl = blendAt(t);
      const wash = washFor(seg.fam || 'main', seg.famTo, Math.round(bl * WASH_STEPS));
      // Each side's width is nudged independently by low-frequency noise
      // sampled at that edge's own position, so the two sides ripple out of
      // step. A road held to an exact constant half-width reads as a ribbon
      // stamped onto the grass; real wear is uneven.
      const halfL = half + edgeNoise(x - nx * half, y - ny * half);
      const halfR = half + edgeNoise(x + nx * half, y + ny * half);
      for (let o = -halfL; o <= halfR; o += C * 0.5) {
        const mx = x + nx * o, my = y + ny * o;
        mark(mx, my, poolFam(mx, my, bl), t, wash);
      }
    }
  }
  // Distance (in cells, capped) from each cell to the nearest open ground,
  // used by the renderer to fray the outermost ring into the grass. Kept
  // deliberately shallow: a town road is only ~8 cells across, so a deep
  // feather would reach the centreline and dissolve the road into rubble —
  // and the narrowest footpaths are barely 3 cells wide, where anything
  // beyond a single ring erases the path entirely.
  const FEATHER = 2;
  for (const [k, cell] of cov) {
    const ci = k.indexOf(',');
    const cx = +k.slice(0, ci), cy = +k.slice(ci + 1);
    let d = FEATHER + 1;
    search:
    for (let ring = 1; ring <= FEATHER; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          if (!cov.has((cx + dx) + ',' + (cy + dy))) { d = ring; break search; }
        }
      }
    }
    cell.edge = d;
  }
  scene.roadCov = cov;
}

/** Paint the road surface: stone sampled from the shared 28-unit tile grid
 * (so masonry stays continuous across the whole network and into the plaza),
 * then a per-family wash, then a darker lip on any cell facing open ground. */
export function drawRoads(scene, g, visW, visH) {
  const C = ROAD_CELL;
  const cov = scene.roadCov;
  if (!cov || !cov.size) return;
  const c0 = Math.floor(scene.camX / C) - 1, c1 = Math.ceil((scene.camX + visW) / C) + 1;
  const r0 = Math.floor(scene.camY / C) - 1, r1 = Math.ceil((scene.camY + visH) / C) + 1;

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = cov.get(c + ',' + r);
      if (!cell) continue;
      const x = c * C, y = r * C;
      // Outer rings thin out into the turf by STIPPLING — cells are dropped
      // at random so the grass beneath shows through in gaps, rather than
      // drawing the stone semi-transparent. Alpha blending would average
      // stone and grass into muddy in-between colours that belong to neither
      // palette and read as blur at this resolution; dropping whole cells
      // keeps every pixel a real palette colour, which is how pixel art
      // handles a gradient. The result is a path that frays into the grass.
      if (cell.edge === 1 && hash(c * 13.1 + r * 29.7) > 0.5) continue;
      // Sample the stone from the coarse tile grid, not per coverage cell,
      // so a single tile's pattern spans several cells uninterrupted.
      // The courses are the other half of the lattice, and the more visible half:
      // every variant carries its joints on the same rows, so the horizontal
      // mortar lines run unbroken from one side of the map to the other. Giving
      // each tile COLUMN its own vertical phase makes those lines step every 28
      // units instead of ruling straight through, which is what stone laid by
      // hand actually does. Same ROAD_CELL constraint as the horizontal phase.
      const tc0 = Math.floor(x / ROAD_TILE);
      const ys = y + Math.floor(hash(tc0 * 11.9 + 47) * 7) * ROAD_CELL;
      const tr = Math.floor(ys / ROAD_TILE);
      // Running bond. Every variant in the pack puts its horizontal courses on
      // the same rows — 4, 9, 14 and 19 in over 70% of them — so laying the
      // tiles on a plain lattice lines the joints up with their neighbours in
      // both axes at once, and the paving reads as a grid of squares rather
      // than as masonry. Stepping alternate tile courses sideways breaks the
      // VERTICAL joints the way paving is actually laid, while leaving the
      // horizontal courses to run on, which is what courses should do.
      //
      // The step is 12 and not a true half-tile of 14 because the source rect
      // has to stay inside the tile: cells are ROAD_CELL wide, so a sampled x
      // of 26 would read 26..30 out of a 28-wide tile and come back clipped.
      // Any offset used here has to be a multiple of ROAD_CELL.
      // Seven phases off a hash rather than two off row parity. A 0/12 alternation
      // is still a pattern — every other course lands in the same place, so the
      // vertical joints repeat on a 56-unit cycle instead of a 28-unit one. Any
      // multiple of ROAD_CELL is legal, so the phase is drawn from all seven.
      const xs = x + Math.floor(hash(tr * 17.3 + 91) * 7) * ROAD_CELL;
      const tc = Math.floor(xs / ROAD_TILE);
      const tile = roadTileFor(cell.fam, tc, tr);
      if (tile && tile.ready) {
        g.drawImage(tile.img, xs - tc * ROAD_TILE, ys - tr * ROAD_TILE, C, C, x, y, C, C);
      } else {
        rect(g, x, y, C, C, '#a89e84');
      }
      if (cell.wash) rect(g, x, y, C, C, cell.wash);
      // Adventure decay: the Ancient road darkens and mosses over as it
      // nears the Gate, driven by progress along the segment rather than a
      // fixed world-Y threshold (which went stale when districts moved).
      if (cell.fam === 'ancient' && cell.t > 0.35) {
        g.globalAlpha = clamp01((cell.t - 0.35) / 0.65) * 0.35;
        rect(g, x, y, C, C, '#20222e');
        g.globalAlpha = 1;
      }
    }
  }
  // Contact shading, on ring 2 rather than the outermost ring: ring 1 is now
  // mostly stippled away, so shading it would just outline scattered specks.
  // Shading the first solid ring instead seats the stone into the ground
  // without drawing a hard rim around the whole network.
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = cov.get(c + ',' + r);
      if (!cell || cell.edge !== 1) continue;
      if (hash(c * 13.1 + r * 29.7) > 0.5) continue; // skip cells stippled out above
      const F = ROAD_FAM[cell.fam] || ROAD_FAM.main;
      g.globalAlpha = 0.4;
      rect(g, c * C, r * C, C, C, F.edge);
      g.globalAlpha = 1;
    }
  }
}

// Cobblestone road styled after the Asset Kit: rounded, beveled stones set in
// warm mortar, an offset (brick-like) layout, with lit top-left and shaded
// bottom-right faces per stone, occasional mossy stones, and grass creeping in
// along the edges.
function roadSeg(g, x, y, w, h) {
  rect(g, x, y, w, h, '#5c5346');                 // dark mortar base
  rect(g, x, y, w, 1, '#6b6153');                 // mortar top light
  const SW = 7, SH = 5;                           // stone cell
  for (let ry = 1; ry < h - 1; ry += SH) {
    const off = ((ry / SH | 0) % 2) * Math.floor(SW / 2);
    for (let rx = 1; rx < w - 1; rx += SW) {
      const sx = x + rx + (off % SW), sy = y + ry;
      if (sx + SW - 1 > x + w) continue;
      const hh = hash((sx) * 1.3 + (sy) * 0.7);
      if (hh > 0.94) continue;                     // rare missing stone -> mortar
      const moss = hh > 0.86;
      const base = moss ? '#6f7a54' : (hh < 0.33 ? '#b4a888' : hh < 0.66 ? '#a99d80' : '#9a8f74');
      const lite = moss ? '#8a9668' : '#c8bc9e';
      const dark = moss ? '#566040' : '#7c7058';
      const sw = SW - 2, sh = SH - 1;
      // rounded stone body (clip the 4 corners)
      rect(g, sx + 1, sy, sw - 2, sh, base);
      rect(g, sx, sy + 1, sw, sh - 2, base);
      rect(g, sx + 1, sy, sw - 2, 1, lite);        // top-left highlight
      rect(g, sx, sy + 1, 1, sh - 2, lite);
      rect(g, sx + 1, sy + sh - 1, sw - 2, 1, dark); // bottom-right shade
      rect(g, sx + sw - 1, sy + 1, 1, sh - 2, dark);
    }
  }
  // grass creeping over the edges
  for (let i = 0; i < w; i += 3) {
    if (hash((x + i) * 2.1) > 0.6) { rect(g, x + i, y - 1, 2, 1, '#357338'); rect(g, x + i, y, 1, 1, '#2c6630'); }
    if (hash((x + i) * 1.4 + 9) > 0.6) rect(g, x + i, y + h - 1, 2, 1, '#2c6630');
  }
}


// Turns a waypoint polyline into the axis-aligned rects the road rasteriser
// expects. Each consecutive pair becomes a straight segment if already
// aligned, or an L-shaped horizontal+vertical pair (bending at the corner)
// otherwise — that's how "gentle curves" happen without diagonal tiles: a
// handful of short offset waypoints reads as a bend once autotiled.
function roadPath(points, width = 16) {
  const rects = [];
  const seg = (x0, y0, x1, y1) => {
    if (y0 === y1) rects.push({ x: Math.min(x0, x1) - width / 2, y: y0 - width / 2, w: Math.abs(x1 - x0) + width, h: width });
    else rects.push({ x: x0 - width / 2, y: Math.min(y0, y1) - width / 2, w: width, h: Math.abs(y1 - y0) + width });
  };
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    if (x0 === x1 || y0 === y1) { seg(x0, y0, x1, y1); continue; }
    // bend at the corner — go horizontal first, then vertical
    seg(x0, y0, x1, y0);
    seg(x1, y0, x1, y1);
  }
  return rects;
}

// Debug-overview only: strokes a waypoint polyline with rounded corners
// instead of sharp joints, so the planning guides read as curving streets
// rather than the right-angle L-bends `roadPath()` rasterises for collision.
// Standard corner-rounding technique — pull back `radius` from each
// waypoint toward its neighbours (clamped to half the shorter adjacent
// segment so short hops never overshoot) and arc through the corner with a
// quadratic curve. Purely cosmetic: doesn't touch this.roads/roadCells or
// any collision, and the actual handcrafted road pieces will replace this
// whole preview later regardless.
function strokeRoundedPath(g, pts, radius) {
  if (pts.length < 2) return;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const d1 = Math.hypot(x1 - x0, y1 - y0), d2 = Math.hypot(x2 - x1, y2 - y1);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    const t1 = d1 > 0 ? r / d1 : 0, t2 = d2 > 0 ? r / d2 : 0;
    g.lineTo(x1 - (x1 - x0) * t1, y1 - (y1 - y0) * t1);
    g.quadraticCurveTo(x1, y1, x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last[0], last[1]);
  g.stroke();
}
