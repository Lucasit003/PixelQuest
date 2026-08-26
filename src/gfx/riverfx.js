// Flowing-water animation for the waterways (town/river.js): the current the
// player actually SEES. The base pass paints still water; everything here
// moves, and everything here moves ALONG THE CHANNEL — each effect samples
// the spine for its local tangent and speed, so a bend flows around the bend
// and the marsh crawls while the gorge races.
//
// Same idiom as the pond FX in waterfx.js: stateless, deterministic functions
// of t. An effect's position is computed from (slot index, loop count, t) with
// hash() — nothing is allocated per frame, nothing drifts across reloads, and
// a paused frame is byte-identical however it was reached.
//
// The river is far too long to animate whole, so each waterway is cut into
// WINDOWS of ~22 spine samples (~130 units) with a precomputed bbox. A frame
// touches only the windows the camera can see; every effect lives inside one
// window and fades in/out at its ends, which is what makes the recycling
// invisible.

import { rect } from './pixel.js';
import { ringDots } from './waterfx.js';
import { sampleAt, ISLANDS } from '../scenes/town/river.js';
import { pondMask, POND_W, POND_H } from '../scenes/town/lake.js';

function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }

// The islands are the one bit of land the analytic |offset| < width tests
// can't see, so every point-effect asks this before painting. Bbox reject
// first — for almost every pixel this is four compares.
function onIsland(x, y) {
  for (const isl of ISLANDS) {
    if (x < isl.x - isl.rx - 4 || x > isl.x + isl.rx + 4 ||
        y < isl.y - isl.ry - 4 || y > isl.y + isl.ry + 4) continue;
    const nx = (x - isl.x) / (isl.rx + 3), ny = (y - isl.y) / (isl.ry + 3);
    if (nx * nx + ny * ny < 1) return true;
  }
  return false;
}

const WINDOW_SAMPLES = 22;

function buildWindows(ww) {
  const windows = [];
  for (const way of ww.ways) {
    const step = way.total / (way.n - 1);   // the spine's own sample pitch
    for (let i0 = 0; i0 < way.n - 1; i0 += WINDOW_SAMPLES) {
      const i1 = Math.min(way.n - 1, i0 + WINDOW_SAMPLES);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      let spd = 0, dep = 0, hw = 0;
      for (let i = i0; i <= i1; i++) {
        const pad = way.hw[i] + 6;
        x0 = Math.min(x0, way.x[i] - pad); x1 = Math.max(x1, way.x[i] + pad);
        y0 = Math.min(y0, way.y[i] - pad); y1 = Math.max(y1, way.y[i] + pad);
        spd += way.spd[i]; dep += way.dep[i]; hw += way.hw[i];
      }
      const cnt = i1 - i0 + 1;
      windows.push({
        way, s0: i0 * step, s1: i1 * step, len: (i1 - i0) * step,
        x0, y0, x1, y1, spd: spd / cnt, dep: dep / cnt, hw: hw / cnt,
        seed: windows.length * 17.71,
      });
    }
  }
  return windows;
}

// One highlight dash bent along the channel: a few short segments sampled
// down the spine from s, so even a single streak curves with the water.
function flowDash(g, way, s, o, len, rgb, alpha) {
  let prev = null;
  const steps = Math.max(2, Math.round(len / 3));
  for (let k = 0; k <= steps; k++) {
    const p = sampleAt(way, s + (k / steps) * len);
    // lateral offset rides the local normal; cap to the local width so the
    // dash can never touch the bank as the channel narrows under it
    const oc = Math.max(-p.hw * 0.72, Math.min(p.hw * 0.72, o));
    const x = Math.round(p.x - p.ty * oc), y = Math.round(p.y + p.tx * oc);
    if (onIsland(x, y)) { prev = { x, y }; continue; }
    if (prev && (prev.x !== x || prev.y !== y)) {
      rect(g, x, y, 1, 1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * (1 - k / steps * 0.45)).toFixed(2)})`);
    } else if (!prev) {
      rect(g, x, y, 1, 1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(2)})`);
    }
    prev = { x, y };
  }
}

/**
 * All moving water. Draw in the ground pass, after the base water and the
 * roads/ford, before the depth-sorted entities — the current belongs to the
 * ground the same way the pond's ripples do.
 */
export function drawRiverFX(scene, g, visW, visH, t) {
  const ww = scene.waterways;
  if (!ww) return;
  if (!ww.windows) ww.windows = buildWindows(ww);
  const cx0 = scene.camX - 24, cy0 = scene.camY - 24;
  const cx1 = scene.camX + visW + 24, cy1 = scene.camY + visH + 24;

  g.save();
  for (const w of ww.windows) {
    if (w.x1 < cx0 || w.x0 > cx1 || w.y1 < cy0 || w.y0 > cy1) continue;

    // ---- current lines ---------------------------------------------------
    // The backbone of the read: faint dashed lines that RUN THE CHANNEL and
    // scroll downstream without pause, like the painted current of a classic
    // top-down river. Each line rides its own lateral offset with a slow
    // meander, its dash phase is keyed to (s - t*spd), and its alpha pulses
    // out of step with its neighbours, so the pattern never tiles.
    const fast = w.spd > 26, slow = w.spd < 12;
    const L = Math.max(1, Math.round(w.hw / 16));
    for (let li = 0; li < L; li++) {
      const baseO = ((li + 0.5) / L - 0.5) * 2 * w.hw * 0.58;
      const lseed = w.seed + li * 23.7;
      const dashP = 22 + hash(lseed) * 12;              // dash + gap length
      const duty = 0.38 + hash(lseed + 1) * 0.14;       // fraction lit
      const pulse = 0.65 + 0.35 * Math.sin(t * 0.9 + lseed * 2.3);
      for (let ds = 0; ds < w.len; ds += 2) {
        const s = w.s0 + ds;
        const ph = ((s * 1.0 - t * w.spd + hash(lseed + 2) * dashP) % dashP + dashP) % dashP;
        if (ph > dashP * duty) continue;
        const p = sampleAt(w.way, s);
        const meander = Math.sin(s * 0.045 + lseed) * w.hw * 0.14
                      + Math.sin(t * 0.5 + lseed * 1.7) * 1.2;
        const oc = Math.max(-p.hw * 0.7, Math.min(p.hw * 0.7, baseO + meander));
        const x = Math.round(p.x - p.ty * oc), y = Math.round(p.y + p.tx * oc);
        if (onIsland(x, y)) continue;
        // brightest at the middle of each dash, so dashes read as tapered
        // slivers of light rather than as chopped line segments
        const along = Math.sin((ph / (dashP * duty)) * Math.PI);
        const a = (fast ? 0.30 : slow ? 0.15 : 0.22) * along * pulse;
        if (a < 0.035) continue;
        rect(g, x, y, 1, 1, `rgba(208,235,244,${a.toFixed(2)})`);
      }
    }

    // ---- current streaks -------------------------------------------------
    // Brighter individual dashes drifting downstream over the lines above:
    // the sparkle and variety layer. Faster water carries more, longer,
    // brighter streaks. Each slot loops on its own period with a fade
    // window, and a hashed skip breaks any residual rhythm.
    const N = Math.round(4 + w.hw / 11 + (fast ? 2 : 0));
    const period = w.len / Math.max(6, w.spd);
    for (let i = 0; i < N; i++) {
      const off = hash(w.seed + i * 3.3) * period;
      const loop = Math.floor((t + off) / period);
      if (hash(w.seed + i * 7.1 + loop * 11.7) < 0.25) continue;   // sit this loop out
      const phase = ((t + off) % period) / period;
      const s = w.s0 + phase * w.len;
      const o = (hash(w.seed + i * 5.9 + loop * 3.1) - 0.5) * 2 * w.hw * 0.62;
      const wob = Math.sin(t * 0.9 + i * 2.1 + w.seed) * 1.6;
      const len = (fast ? 9 : 6) + hash(w.seed + i * 9.3 + loop) * (fast ? 10 : 7);
      const envelope = Math.sin(phase * Math.PI);
      const a = (fast ? 0.42 : slow ? 0.22 : 0.33) * envelope
              * (0.75 + 0.25 * Math.sin(t * 1.3 + i * 1.7 + w.seed * 0.7));
      if (a < 0.03) continue;
      flowDash(g, w.way, s, o + wob, len, fast ? [228, 246, 251] : [205, 232, 242], a);
    }

    // ---- whitecaps in fast water ----------------------------------------
    // Rapids get brief, bright flecks that pop, race a short distance and
    // vanish — froth, not streaks. Kept off calm water entirely.
    if (fast) {
      const F = Math.round(2 + w.hw / 16);
      for (let i = 0; i < F; i++) {
        const per = 0.9 + hash(w.seed + i * 4.7) * 0.9;
        const loop = Math.floor((t + i * 2.3) / per);
        const ph = ((t + i * 2.3) % per) / per;
        if (hash(w.seed + i * 8.3 + loop * 5.1) < 0.35) continue;
        const s = w.s0 + hash(w.seed + i * 6.1 + loop * 9.7) * w.len;
        const o = (hash(w.seed + i * 2.9 + loop * 4.3) - 0.5) * 2 * w.hw * 0.5;
        const p = sampleAt(w.way, s + ph * 9);
        const x = Math.round(p.x - p.ty * o), y = Math.round(p.y + p.tx * o);
        if (onIsland(x, y)) continue;
        const a = Math.sin(ph * Math.PI) * 0.5;
        if (a < 0.04) continue;
        rect(g, x, y, 1, 1, `rgba(255,255,255,${a.toFixed(2)})`);
        if (hash(w.seed + i + loop) > 0.5) rect(g, x + 1, y, 1, 1, `rgba(235,248,252,${(a * 0.7).toFixed(2)})`);
      }
    }

    // ---- glints ----------------------------------------------------------
    // Single sparkling pixels that live a moment and drift a touch
    // downstream — sunlight, not foam. Everywhere, sparse.
    const GL = 3;
    for (let i = 0; i < GL; i++) {
      const per = 1.6 + hash(w.seed + i * 5.3) * 1.8;
      const loop = Math.floor((t + i * 3.7) / per);
      const ph = ((t + i * 3.7) % per) / per;
      if (ph > 0.6) continue;
      if (hash(w.seed + i * 3.9 + loop * 7.3) < 0.3) continue;
      const s = w.s0 + hash(w.seed + i * 8.9 + loop * 2.7) * w.len;
      const o = (hash(w.seed + i * 4.1 + loop * 6.3) - 0.5) * 2 * w.hw * 0.6;
      const p = sampleAt(w.way, s + ph * w.spd * 0.4);
      const x = Math.round(p.x - p.ty * o), y = Math.round(p.y + p.tx * o);
      if (onIsland(x, y)) continue;
      const a = Math.sin((ph / 0.6) * Math.PI) * 0.75;
      rect(g, x, y, 1, 1, `rgba(255,255,255,${a.toFixed(2)})`);
    }

    // ---- drifting ripple rings in calm water -----------------------------
    // Slow reaches breathe: a ring spreads, and the CURRENT CARRIES IT — the
    // centre itself drifts downstream as it grows, which is the one detail
    // that makes a ripple on a river read differently from one on a pond.
    if (slow || w.dep > 0.72) {
      const R = 2;
      for (let i = 0; i < R; i++) {
        const per = 4.2 + hash(w.seed + i * 6.7) * 2.5;
        const loop = Math.floor((t + i * 5.1) / per);
        const ph = ((t + i * 5.1) % per) / per;
        if (ph > 0.62) continue;
        if (hash(w.seed + i * 9.1 + loop * 3.3) < 0.4) continue;
        const s0 = w.s0 + hash(w.seed + i * 2.3 + loop * 8.1) * w.len;
        const o = (hash(w.seed + i * 7.7 + loop * 4.9) - 0.5) * 2 * w.hw * 0.4;
        const k = ph / 0.62;
        const p = sampleAt(w.way, s0 + k * w.spd * 1.6);   // carried downstream
        const cx = p.x - p.ty * o, cy = p.y + p.tx * o;
        const r = 1.5 + k * Math.min(9, w.hw * 0.3);
        const a = 0.4 * (1 - k);
        if (a < 0.04) continue;
        const inWater = (x, y) => { const q = ww.query(x, y); return q !== null && q.d < -1; };
        ringDots(g, cx, cy, r, Math.max(1, r * 0.55), [205, 233, 244], a, inWater, w.seed + i + loop);
      }
    }

    // ---- floating leaves -------------------------------------------------
    // The cheapest possible statement of current: a real OBJECT travelling
    // downstream. One or two per window, riding at ~80% of the surface
    // speed with a lazy cross-stream sway.
    const LV = w.hw > 20 ? 2 : 1;
    for (let i = 0; i < LV; i++) {
      const per = w.len / Math.max(5, w.spd * 0.8);
      const off = hash(w.seed + i * 12.3) * per;
      const loop = Math.floor((t + off) / per);
      if (hash(w.seed + i * 5.7 + loop * 6.9) < 0.55) continue;   // most loops carry no leaf
      const ph = ((t + off) % per) / per;
      const s = w.s0 + ph * w.len;
      const p = sampleAt(w.way, s);
      const o = (hash(w.seed + i * 3.1 + loop * 2.1) - 0.5) * 2 * p.hw * 0.55
              + Math.sin(t * 0.7 + i * 3 + w.seed) * 2.5;
      const x = Math.round(p.x - p.ty * o), y = Math.round(p.y + p.tx * o);
      if (onIsland(x, y)) continue;
      const a = Math.min(1, Math.sin(ph * Math.PI) * 3);          // quick fade at ends
      if (a < 0.1) continue;
      const green = hash(w.seed + i + loop * 3.7) > 0.4;
      g.globalAlpha = a;
      rect(g, x, y, 2, 1, green ? '#5d8a46' : '#8a6f3f');
      rect(g, x + (hash(w.seed + i) > 0.5 ? 1 : -1), y - 1, 1, 1, green ? '#71a355' : '#a08449');
      g.globalAlpha = 1;
      // its little wake: one trailing dot upstream
      rect(g, Math.round(x - p.tx * 2), Math.round(y - p.ty * 2), 1, 1, `rgba(220,240,248,${(a * 0.3).toFixed(2)})`);
    }

    // ---- dragonflies -----------------------------------------------------
    // Hover, dart, hover: the whole flight is a function of phase, so the
    // dart is the same dart on every loop of its period. Slow reaches and
    // the marsh only — they live where the reeds are.
    if (w.spd < 20 && w.way.id === 'river' && w.s0 > 3300) {
      for (let i = 0; i < 2; i++) {
        const per = 7 + hash(w.seed + i * 8.1) * 4;
        const loop = Math.floor((t + i * 3.9) / per);
        if (hash(w.seed + i * 6.3 + loop * 9.1) < 0.4) continue;
        const ph = ((t + i * 3.9) % per) / per;
        // two anchor points near opposite banks
        const sA = w.s0 + hash(w.seed + i * 2.7 + loop * 5.3) * w.len;
        const sB = w.s0 + hash(w.seed + i * 4.9 + loop * 7.7) * w.len;
        const pA = sampleAt(w.way, sA), pB = sampleAt(w.way, sB);
        const oA = (hash(w.seed + i * 3.7 + loop) - 0.5) * 2 * pA.hw * 1.15;
        const oB = (hash(w.seed + i * 5.1 + loop * 2.3) - 0.5) * 2 * pB.hw * 1.15;
        const ax = pA.x - pA.ty * oA, ay = pA.y + pA.tx * oA;
        const bx2 = pB.x - pB.ty * oB, by2 = pB.y + pB.tx * oB;
        // hover 0-0.45 at A, dart 0.45-0.6, hover 0.6-1 at B
        let px2, py2;
        const jx = Math.sin(t * 3.1 + i * 2 + w.seed) * 2, jy = Math.cos(t * 2.7 + i * 3) * 1.4;
        if (ph < 0.45) { px2 = ax + jx; py2 = ay + jy; }
        else if (ph < 0.6) {
          const k2 = (ph - 0.45) / 0.15, e = k2 * k2 * (3 - 2 * k2);
          px2 = ax + (bx2 - ax) * e; py2 = ay + (by2 - ay) * e;
        } else { px2 = bx2 + jx; py2 = by2 + jy; }
        if (onIsland(px2, py2)) continue;
        const x = Math.round(px2), y = Math.round(py2);
        // body: two pixels of teal, dark head toward travel
        rect(g, x, y, 2, 1, '#63b9c9');
        rect(g, x + 2, y, 1, 1, '#274b56');
        // wing shimmer: flanking pixels flickering at wing-beat rate
        const wing = Math.sin(t * 26 + i * 7) > 0;
        rect(g, x, y - 1, 1, 1, `rgba(220,240,246,${wing ? 0.55 : 0.2})`);
        rect(g, x + 1, y + 1, 1, 1, `rgba(220,240,246,${wing ? 0.2 : 0.55})`);
        // its dot of shadow on the water
        rect(g, x - 1, y + 3, 2, 1, 'rgba(20,40,54,0.25)');
      }
    }

    // ---- fish shadows in the deep reaches --------------------------------
    // A dark shape gliding UNDER the surface, upstream as often as down —
    // fish hold against the current. Rare, big pools only.
    if (w.dep > 0.7 && w.hw > 34) {
      const per = 11 + hash(w.seed * 3.1) * 6;
      const loop = Math.floor(t / per);
      const ph = (t % per) / per;
      if (hash(w.seed * 7.7 + loop * 13.1) > 0.55 && ph < 0.7) {
        const upstream = hash(w.seed * 4.3 + loop * 5.9) > 0.5;
        const k = ph / 0.7;
        const s = w.s0 + (upstream ? 1 - k : k) * w.len * 0.8 + w.len * 0.1;
        const o = (hash(w.seed * 9.1 + loop * 3.7) - 0.5) * 2 * w.hw * 0.4
                + Math.sin(t * 0.8 + w.seed) * 3;
        const p = sampleAt(w.way, s);
        const x = p.x - p.ty * o, y = p.y + p.tx * o;
        const a = onIsland(x, y) ? 0 : Math.sin(ph / 0.7 * Math.PI) * 0.30;
        if (a > 0.03) {
          const dirx = (upstream ? -1 : 1) * p.tx, diry = (upstream ? -1 : 1) * p.ty;
          g.fillStyle = `rgba(20,42,58,${a.toFixed(2)})`;
          // an elongated blob along its heading: three overlapping dots
          for (let b = -1; b <= 1; b++) {
            g.beginPath();
            g.ellipse(x + dirx * b * 2.6, y + diry * b * 2.6, 2.6 - Math.abs(b), 1.9 - Math.abs(b) * 0.6, 0, 0, Math.PI * 2);
            g.fill();
          }
          // the surface remembers it faintly
          if (hash(w.seed + loop + Math.floor(t * 2)) > 0.6) {
            rect(g, Math.round(x - dirx * 3), Math.round(y - diry * 3), 1, 1, 'rgba(210,235,245,0.25)');
          }
        }
      }
    }
  }

  // ---- rocks: the stones, then their split current, wake and foam --------
  // Placed by the decor pass (ww.rocks). The stone itself is drawn here too
  // (procedurally — the sprite rocks carry baked grass skirts that read
  // wrong surrounded by water): a grey dome with a lit crown and a dark
  // waterline seam, then the moving water reacts around it.
  if (ww.rocks) {
    for (const rk of ww.rocks) {
      if (rk.x < cx0 - 30 || rk.x > cx1 + 30 || rk.y < cy0 - 30 || rk.y > cy1 + 30) continue;
      const rx = Math.round(rk.x), ry = Math.round(rk.y), rr = rk.r;
      // Bridge piers register here for the FX only — their stone caps are
      // part of the bridge's own paint (town/bridge.js).
      if (!rk.pier) {
        // waterline shadow ring, then the body sitting a touch above it
        g.fillStyle = 'rgba(30,60,80,0.6)';
        g.beginPath(); g.ellipse(rx, ry + 1, rr + 1.2, rr * 0.62 + 1, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = rk.seed > 0.5 ? '#6e7278' : '#63686f';
        g.beginPath(); g.ellipse(rx, ry - rr * 0.28, rr, rr * 0.72, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = rk.seed > 0.5 ? '#8b9096' : '#7e858c';
        g.beginPath(); g.ellipse(rx - rr * 0.24, ry - rr * 0.52, rr * 0.55, rr * 0.36, 0, 0, Math.PI * 2); g.fill();
        rect(g, rx - Math.round(rr * 0.3), ry - Math.round(rr * 0.85), 1, 1, '#a9adb2');
      }
      const p = sampleAt(rk.way, rk.s);
      const tx = p.tx, ty = p.ty;
      // piers churn harder than their water speed alone says — the deck
      // funnels the flow into them
      const speedK = Math.min(1, p.spd / 26) * (rk.pier ? 1.25 : 1);
      // upstream cushion: bright dots piling against the stone, pulsing
      const UP = 4 + Math.round(rk.r);
      for (let i = 0; i < UP; i++) {
        const a0 = (i / UP - 0.5) * 2.4;                         // fan across the face
        const px = rk.x - tx * (rk.r + 1.5) - ty * a0 * rk.r * 0.9;
        const py = rk.y - ty * (rk.r + 1.5) + tx * a0 * rk.r * 0.9;
        const puls = 0.5 + 0.5 * Math.sin(t * 5.1 + i * 2.3 + rk.x);
        const a = (0.24 + puls * 0.30) * speedK;
        if (a < 0.04) continue;
        rect(g, Math.round(px), Math.round(py), 1, 1, `rgba(240,250,253,${a.toFixed(2)})`);
      }
      // the V-wake: two arms opening downstream, dithered and drifting
      for (let arm = -1; arm <= 1; arm += 2) {
        const LEN = 10 + rk.r * 3;
        for (let d = 2; d < LEN; d += 2) {
          const spread = rk.r * 0.7 + d * 0.34;
          const drift = (t * p.spd * 0.55 + rk.x * 3) % 4;      // dashes crawl downstream
          if ((d + Math.floor(drift)) % 4 > 1) continue;
          const px = rk.x + tx * d + ty * arm * spread * -1;
          const py = rk.y + ty * d + tx * arm * spread;
          const q = ww.query(px, py);
          if (!q || q.d > -1.5) continue;                       // wake stays in water
          const a = (0.30 - d / LEN * 0.26) * speedK * (0.6 + 0.4 * Math.sin(t * 3.7 + d + rk.y));
          if (a < 0.03) continue;
          rect(g, Math.round(px), Math.round(py), 1, 1, `rgba(225,242,248,${a.toFixed(2)})`);
        }
      }
      // a loose fleck of foam breaking off now and then
      const per = 1.6 + hash(rk.x * 1.7) * 1.4;
      const ph = ((t + rk.y) % per) / per;
      if (ph < 0.8 && speedK > 0.3) {
        const trail = ph * (8 + rk.r * 2);
        const px = rk.x + tx * (rk.r + trail) + ty * (hash(rk.x + Math.floor((t + rk.y) / per)) - 0.5) * 3;
        const py = rk.y + ty * (rk.r + trail) - tx * (hash(rk.y + Math.floor((t + rk.y) / per)) - 0.5) * 3;
        const a = (1 - ph) * 0.5 * speedK;
        if (a > 0.05) rect(g, Math.round(px), Math.round(py), 1, 1, `rgba(255,255,255,${a.toFixed(2)})`);
      }
    }
  }

  // ---- a distant flock, rarely --------------------------------------------
  // Five dark specks crossing high over the south marsh every minute or so.
  // Almost nothing, which is the point — the sky admits the world continues.
  {
    const per = 52;
    const loop = Math.floor(t / per);
    const ph = (t % per) / per;
    if (ph < 0.34 && hash(loop * 17.3) > 0.35) {
      const x0 = 2450 + hash(loop * 3.1) * 800, y0 = 3200 + hash(loop * 5.7) * 900;
      const ang = -0.6 - hash(loop * 7.9) * 0.5;            // north-east-ish
      const dx2 = Math.cos(ang), dy2 = Math.sin(ang);
      const dist = (ph / 0.34) * 620;
      for (let b = 0; b < 5; b++) {
        const back = b * 14 + (b % 2) * 5;
        const sideV = (b - 2) * 9 * (b % 2 === 0 ? 1 : 0.6);
        const bx = x0 + dx2 * (dist - back) - dy2 * sideV;
        const by = y0 + dy2 * (dist - back) + dx2 * sideV + Math.sin(t * 2.1 + b) * 1.5;
        if (bx < cx0 || bx > cx1 || by < cy0 || by > cy1) continue;
        const flap = Math.sin(t * 9 + b * 2.2) > 0;
        const x = Math.round(bx), y = Math.round(by);
        rect(g, x, y, 1, 1, 'rgba(30,32,44,0.75)');
        rect(g, x - 1, y + (flap ? -1 : 0), 1, 1, 'rgba(30,32,44,0.6)');
        rect(g, x + 1, y + (flap ? -1 : 0), 1, 1, 'rgba(30,32,44,0.6)');
      }
    }
  }
  g.restore();
}

// ------------------------------------------------------------- lake inflow
// Where the stream's delta meets the lake, the LAKE answers: ripple arcs
// spread from the mouth out into the pond's own water, and flecks of foam
// ride the last of the current before it dies. Drawn straight after the pond
// art (ground.js), so it sits on the lake's painted surface. The masks keep
// every dot on real water — the pond's own pixels or the stream's field.
const MOUTH = { x: 1652, y: 2342, dx: -0.894, dy: 0.447 };

export function drawLakeInflow(scene, g, visW, visH, t) {
  const ww = scene.waterways;
  if (!ww) return;
  // cheap cull: the mouth is one small place
  if (MOUTH.x < scene.camX - 80 || MOUTH.x > scene.camX + visW + 80 ||
      MOUTH.y < scene.camY - 80 || MOUTH.y > scene.camY + visH + 80) return;
  const info = pondMask();
  const L = scene.lakeTopLeft;
  const wet = (x, y) => {
    if (info) {
      const sx = Math.round((x - L.x) * info.w / POND_W);
      const sy = Math.round((y - L.y) * info.h / POND_H);
      if (sx >= 0 && sy >= 0 && sx < info.w && sy < info.h && info.mask[sy * info.w + sx]) return true;
    }
    const q = ww.query(x, y);
    return q !== null && q.d < -1;
  };

  g.save();
  // ripple arcs carried out into the lake as they grow
  for (let i = 0; i < 3; i++) {
    const per = 2.6 + i * 0.7;
    const ph = ((t + i * 1.9) % per) / per;
    if (ph > 0.8) continue;
    const k = ph / 0.8;
    const cx = MOUTH.x + MOUTH.dx * (8 + k * 26) + (hash(i * 7.7 + Math.floor((t + i * 1.9) / per)) - 0.5) * 8;
    const cy = MOUTH.y + MOUTH.dy * (8 + k * 26) * 0.7;
    const r = 2 + k * 15;
    const a = 0.38 * (1 - k);
    if (a < 0.04) continue;
    ringDots(g, cx, cy, r, Math.max(1, r * 0.55), [212, 238, 247], a, wet, i * 3.1 + Math.floor(t / per));
  }
  // foam flecks riding the dying current into the pond
  for (let i = 0; i < 6; i++) {
    const per = 1.5 + hash(i * 5.3) * 1.2;
    const loop = Math.floor((t + i * 0.9) / per);
    const ph = ((t + i * 0.9) % per) / per;
    if (hash(i * 3.9 + loop * 7.1) < 0.3) continue;
    const spread = (hash(i * 8.3 + loop * 2.9) - 0.5) * 2 * (3 + ph * 11);
    const px = MOUTH.x + MOUTH.dx * ph * 30 - MOUTH.dy * spread;
    const py = MOUTH.y + MOUTH.dy * ph * 30 + MOUTH.dx * spread * -0.7;
    if (!wet(px, py)) continue;
    const a = (1 - ph) * 0.5;
    if (a < 0.05) continue;
    rect(g, Math.round(px), Math.round(py), 1, 1, `rgba(240,250,253,${a.toFixed(2)})`);
    if (hash(i + loop) > 0.6) rect(g, Math.round(px) + 1, Math.round(py), 1, 1, `rgba(225,242,248,${(a * 0.7).toFixed(2)})`);
  }
  g.restore();
}
