// Animates a still body of water (pond, lake) on top of a static ground PNG:
// hand-coded pixel-dot ripples/shimmer/bubbles, same technique as the Crystal
// Fountain's existing water FX in town.js (fxRipples/fxHighlights) — crisp
// single-pixel dots, additive/alpha blended.
//
// Driven by a `mask` built once from the pond art's own pixels via
// buildWaterMask(), so ripple spawn points are rejection-sampled against the
// real water shape — never on the island, reeds, or shoreline rocks.

import { rect } from './pixel.js';

function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }

// ---------------------------------------------------------------- masking
// Classifies water pixels by hue (blue channel clearly over red — same rule
// already used to hand-derive the pond's collision rects in town.js) and
// precomputes a strided list of shoreline points (water pixels with a
// non-water neighbour a few px away) for effects that hug the bank.
export function buildWaterMask(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const mg = c.getContext('2d');
  mg.drawImage(img, 0, 0);
  const d = mg.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    const r = d[i * 4], gp = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    if (a > 150 && b > r + 15 && b > 70 && gp < b + 10) mask[i] = 1;
  }
  // Distance from every water pixel to the nearest non-water pixel (bank,
  // island, lily pad), in source pixels. Two-pass chamfer transform, computed
  // once. Ripples use it to guarantee a ring stays clear of everything as it
  // expands — sampling a handful of directions instead lets small obstacles
  // like a lily-pad cluster slip between the sample rays.
  const clearance = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < clearance.length; i++) clearance[i] = mask[i] ? INF : 0;
  const D1 = 1, D2 = 1.4142;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (clearance[i] === 0) continue;
      let v = clearance[i];
      if (x > 0) v = Math.min(v, clearance[i - 1] + D1);
      if (y > 0) v = Math.min(v, clearance[i - w] + D1);
      if (x > 0 && y > 0) v = Math.min(v, clearance[i - w - 1] + D2);
      if (x < w - 1 && y > 0) v = Math.min(v, clearance[i - w + 1] + D2);
      clearance[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (clearance[i] === 0) continue;
      let v = clearance[i];
      if (x < w - 1) v = Math.min(v, clearance[i + 1] + D1);
      if (y < h - 1) v = Math.min(v, clearance[i + w] + D1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, clearance[i + w + 1] + D2);
      if (x > 0 && y < h - 1) v = Math.min(v, clearance[i + w - 1] + D2);
      clearance[i] = v;
    }
  }

  const shore = [];
  const padEdge = [];
  // Fine stride: shore points are the pixels wave foam is drawn on, so a
  // coarse stride leaves visible gaps in a breaking wave.
  const STRIDE = 2;
  const solidAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? true : !mask[y * w + x];
  for (let y = 2; y < h - 2; y += STRIDE) {
    for (let x = 2; x < w - 2; x += STRIDE) {
      if (!mask[y * w + x]) continue;
      let edge = false;
      for (let k = 0; k < 8 && !edge; k++) {
        const ang = (k / 8) * Math.PI * 2;
        if (solidAt(x + Math.round(Math.cos(ang) * 4), y + Math.round(Math.sin(ang) * 4))) edge = true;
      }
      if (!edge) continue;
      // Only the real bank counts. Lily pads and the little island also
      // border water, but foam breaking around a lily pad looks wrong. The
      // bank is a large contiguous mass, so sample a wide disc: at this
      // radius the shoreline still fills roughly half of it, while even a
      // tight cluster of lily pads covers only a small fraction.
      let solidCount = 0, samples = 0;
      for (let dy = -26; dy <= 26; dy += 4) {
        for (let dx = -26; dx <= 26; dx += 4) {
          if (dx * dx + dy * dy > 26 * 26) continue;
          samples++;
          if (solidAt(x + dx, y + dy)) solidCount++;
        }
      }
      if (solidCount / samples < 0.34) {
        // Not the bank — a lily pad or the island. Worth keeping separately:
        // pads bob and nudge the water around them, which is a different,
        // much gentler motion than surf breaking on the shore.
        padEdge.push([x, y]);
        continue;
      }
      shore.push([x, y]);
    }
  }
  return { mask, w, h, shore, padEdge, clearance };
}

// dx/dy are world-unit offsets from the art's top-left draw position.
function waterAt(info, worldW, worldH, dx, dy) {
  if (!info) return false;
  const sx = Math.round(dx * (info.w / worldW));
  const sy = Math.round(dy * (info.h / worldH));
  if (sx < 0 || sy < 0 || sx >= info.w || sy >= info.h) return false;
  return info.mask[sy * info.w + sx] === 1;
}

// True only if a ripple centred here can grow to radius `rx` without any part
// of the ring reaching the bank, the island, or a lily pad.
//
// A ring is only drawn at its rim, but it sweeps every radius from nothing up
// to rx over its life, so the whole disc has to be clear — checking the rim
// alone would miss an obstacle the ring crosses on the way out. The clearance
// map holds the exact distance to the nearest non-water pixel, which makes this
// a single lookup and catches obstacles of any size (a sampled ring test lets
// small ones slip between the sample rays).
function hasClearWater(info, worldW, worldH, cx, cy, rx) {
  if (!info.clearance) return waterAt(info, worldW, worldH, cx, cy);
  const kx = info.w / worldW;
  const sx = Math.round(cx * kx), sy = Math.round(cy * (info.h / worldH));
  if (sx < 0 || sy < 0 || sx >= info.w || sy >= info.h) return false;
  // +2 world units of margin so the crest never sits right against the edge
  return info.clearance[sy * info.w + sx] >= (rx + 2) * kx;
}

// How much clear water there is around a point, in world units — i.e. the
// largest ring that can be drawn here without touching anything.
function clearRadius(info, worldW, worldH, cx, cy) {
  if (!info.clearance) return 0;
  const kx = info.w / worldW;
  const sx = Math.round(cx * kx), sy = Math.round(cy * (info.h / worldH));
  if (sx < 0 || sy < 0 || sx >= info.w || sy >= info.h) return 0;
  return info.clearance[sy * info.w + sx] / kx;
}

// Crisp scattered-dot "ring" — reads as a ripple crest without a true stroke
// (same helper as the fountain's pixelRingDots). Dot count scales with the
// ring's circumference so large ripples stay a smooth circle instead of
// thinning out into a faceted/star-shaped outline at 8 fixed points.
// `rgb` is the crest colour as [r,g,b]; `alpha` its peak opacity. `seed`
// decorrelates the per-ring wobble/brightness so no two rings look identical.
function ringDots(g, cx, cy, rx, ry, rgb, alpha, maskFn, seed = 0) {
  const circumference = Math.PI * (rx + ry);
  // ~1.4 samples per pixel of arc: dense enough that the crest reads as a
  // continuous line rather than separated dots, without overdrawing.
  const DOTS = Math.max(12, Math.round(circumference * 1.4));
  const seen = new Set();
  for (let i = 0; i < DOTS; i++) {
    const a = (i / DOTS) * Math.PI * 2;
    // Real ripples aren't uniform rings: brightness varies around the crest
    // and the radius wobbles slightly, so the outline stops reading as a
    // stamped ellipse.
    const wob = Math.sin(a * 3 + seed * 6.3) * 0.35 + Math.sin(a * 5 - seed * 2.7) * 0.2;
    const rr = rx + wob, rry = ry + wob * 0.5;
    const bright = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(a * 2 + seed * 4.1));
    const aa = alpha * bright;
    if (aa <= 0.03) continue;
    const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rry);
    const key = x * 65536 + y;
    if (seen.has(key)) continue; // oversampling lands twice on the same pixel
    seen.add(key);
    if (maskFn && !maskFn(x, y)) continue;
    rect(g, x, y, 1, 1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa.toFixed(2)})`);
  }
}

// ------------------------------------------------------------- fish jump
// Authored 11-frame jump sheet (assets/fish1.png): the fish rises out of the
// water, arcs over, and drops back in with a splash and spreading rings.
//
// The artist drew the arc into the sheet itself — each frame sits at its own
// height within its row — so rather than inventing a jump curve, we read the
// heights straight off the art. The ripple frames are by definition at water
// level, so their vertical centre gives the waterline of each row (y=201 for
// the top row, y=602 for the bottom); every frame's offset is then measured
// from that. The result is exactly the arc that was drawn.
const FISH_IMG = new Image();
let FISH_READY = false;
FISH_IMG.onload = () => { FISH_READY = true; };
FISH_IMG.src = 'assets/fish1.png';

// [sx, sy, sw, sh, dy, ms] — dy is the frame top relative to the waterline.
const FISH_FRAMES = [
  [20, 158, 171, 83, -43, 240],    // 0  shape moving under the surface
  [239, 163, 203, 76, -38, 200],   // 1  ring as it's about to break through
  [475, 145, 156, 99, -56, 110],   // 2  head breaches, first spray
  [697, 84, 190, 175, -117, 100],  // 3  driving up out of the splash
  [895, 81, 202, 146, -120, 100],  // 4  clear of the water, climbing
  [1111, 66, 221, 111, -135, 100], // 5  levelling off
  [33, 413, 218, 115, -189, 120],  // 6  apex
  [275, 435, 214, 198, -167, 100], // 7  nose over, coming down
  [518, 492, 250, 149, -110, 150], // 8  tail-first entry, big splash
  [794, 563, 256, 78, -39, 220],   // 9  ring spreading from the entry point
  [1092, 563, 231, 77, -39, 300],  // 10 last faint ring
];
const FISH_TOTAL_MS = FISH_FRAMES.reduce((s, f) => s + f[5], 0);
const FISH_SCALE = 0.105;  // source px -> world units
const FISH_TRAVEL = 17;    // world units of forward drift across the whole jump
// Frame 8 is the tail-first entry: it begins 1070ms into the jump, so that is
// the moment the water is struck and the wake starts spreading.
const FISH_ENTRY_S = 1.07;

// Room the fish and its splash need around the jump point, in world units.
// The widest frame is ~27 units across, so this keeps the whole sprite — and
// the spray either side of it — over open water.
const FISH_CLEARANCE = 17;

/**
 * Fish jumping on the pond. Draws `count` separate fish, each on its own
 * rhythm and each picking its own spot, so jumps come from different places
 * around the water rather than one repeating location.
 *
 * Same (left, top, worldW, worldH) framing as the rest of this module.
 * `period` is roughly the seconds between one fish's jumps; with several fish
 * the pond as a whole sees a jump every period/count seconds or so.
 */
export function drawFishJump(g, info, left, top, worldW, worldH, t, period = 8, count = 3) {
  if (!info || !FISH_READY) return;
  for (let n = 0; n < count; n++) {
    // Each fish gets a slightly different period so they drift out of step
    // instead of jumping on a metronome, and a starting offset so the first
    // few jumps are spread around the cycle rather than landing together.
    drawOneJump(g, info, left, top, worldW, worldH,
      t + (period / count) * n, period + n * 0.9, n);
  }
}

function drawOneJump(g, info, left, top, worldW, worldH, t, period, salt) {
  const jumpDur = FISH_TOTAL_MS / 1000;
  const cycle = Math.floor(t / period);
  const local = t % period;
  // The wake outlives the jump itself, so this window has to stay open past the
  // last sprite frame.
  if (local > Math.max(jumpDur, FISH_ENTRY_S + WAKE_LIFE)) return;

  // Pick a spot with clear water all round, so the fish never erupts through
  // the bank, a lily pad, or the island. The candidate sequence is salted with
  // both the cycle number and which fish this is, so successive jumps — and the
  // different fish — land in genuinely different places.
  let jx = 0, jy = 0, found = false;
  for (let tries = 0; tries < 20 && !found; tries++) {
    const sa = hash(cycle * 7.7 + tries * 3.1 + salt * 137.7 + 200);
    const sb = hash(cycle * 4.3 + tries * 5.9 + salt * 91.3 + 201);
    jx = 40 + sa * (worldW - 80);
    jy = 40 + sb * (worldH - 80);
    found = hasClearWater(info, worldW, worldH, jx, jy, FISH_CLEARANCE);
  }
  if (!found) return;

  // which frame are we on
  let acc = 0, idx = 0;
  const ms = local * 1000;
  for (let i = 0; i < FISH_FRAMES.length; i++) {
    acc += FISH_FRAMES[i][5];
    if (ms < acc) { idx = i; break; }
    idx = i;
  }
  // Where the fish actually re-enters the water: its own drifted position at
  // the moment of the entry frame, not the point it launched from.
  const entryX = jx + (FISH_ENTRY_S * 1000 / FISH_TOTAL_MS - 0.5) * FISH_TRAVEL;
  drawFishWake(g, info, left, top, worldW, worldH, entryX, jy, local - FISH_ENTRY_S, salt + cycle * 13.1);

  if (local <= jumpDur) {
    const f = FISH_FRAMES[idx];
    // Forward drift stops the instant the fish is back in the water. The last
    // frames of the sheet are the splash and its rings, and those belong to the
    // point of entry — letting them keep sliding forward would walk them away
    // from it, and the procedural rings that follow would then appear to jump
    // back sideways.
    const progress = Math.min(FISH_ENTRY_S * 1000 / FISH_TOTAL_MS, ms / FISH_TOTAL_MS);

    const dw = Math.round(f[2] * FISH_SCALE);
    const dh = Math.round(f[3] * FISH_SCALE);
    // centre each frame horizontally on the jump point, plus forward drift
    const dx = Math.round(left + jx - dw / 2 + (progress - 0.5) * FISH_TRAVEL);
    const dy = Math.round(top + jy + f[4] * FISH_SCALE);

    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(FISH_IMG, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
    g.restore();
  }
}

// Concentric rings spreading from the point the fish drops back in. The sheet's
// own last frames give the first splash ring; this carries the disturbance on
// outward the way real water does.
//
// Three details do most of the work in selling it:
//  - rings are emitted at a steady interval, so several are travelling at once
//    at even spacing, rather than one lonely expanding circle;
//  - each ring slows as it travels and fades as it grows, because the same
//    energy is spread around an ever longer crest;
//  - the whole set is capped by the clear water actually available at the entry
//    point, so rings stay complete circles instead of being cut by the bank.
const WAKE_RINGS = 5;
const WAKE_INTERVAL = 0.30;   // seconds between successive rings
const WAKE_SPEED = 14;        // world units/sec — constant, see below
const WAKE_LIFE = 2.7;        // seconds until the last ring has died away
const WAKE_MAX_R = 42;        // ceiling on ring size in open water

function drawFishWake(g, info, left, top, worldW, worldH, cx, cy, age, seed) {
  if (age < 0 || age > WAKE_LIFE) return;
  const room = clearRadius(info, worldW, worldH, cx, cy) - 2;
  if (room <= 2) return;
  const rMax = Math.min(WAKE_MAX_R, room);
  const inWater = (x, y) => waterAt(info, worldW, worldH, x - left, y - top);

  g.save();
  for (let k = 0; k < WAKE_RINGS; k++) {
    const a = age - k * WAKE_INTERVAL;
    if (a <= 0) continue;
    // Constant travel speed. Ripples move at a near-fixed phase speed, so the
    // gap between successive crests stays even — the giveaway of a real wake.
    // Decelerating them instead makes every ring converge on the same radius
    // and the whole set collapses into a bullseye.
    const r = WAKE_SPEED * a;
    if (r >= rMax) continue;
    // Later rings start weaker, the splash having already spent most of its
    // energy; each then fades with age, and again with radius because the same
    // energy is stretched around an ever longer crest.
    const born = 1 - k / WAKE_RINGS * 0.55;
    const alpha = 0.62 * born * Math.pow(1 - a / WAKE_LIFE, 1.2) / (1 + r * 0.02);
    if (alpha <= 0.025) continue;
    ringDots(g, left + cx, top + cy, r, Math.max(1, r * 0.5),
      [214, 238, 250], alpha, inWater, seed + k * 2.3);
  }
  g.restore();
}

// ----------------------------------------------------------------- ducks
// assets/duck.png is a behaviour sheet rather than a single action: six
// labelled rows (swim, idle float, look about, head dip, full dabble, wing
// flap). Unlike the fish — one shot, then gone — ducks are permanent residents,
// so they hold a position on the water, drift around it, and every so often
// break the float with one of the one-off behaviours.
//
// Frame boxes were read off the sheet by locating each frame's green head and
// taking a window measured from an isolated duck; at ~207px head spacing that
// window provably cannot touch a neighbouring frame. Every frame is anchored by
// its BOTTOM edge, which is where the sheet draws the waterline ripple, so the
// duck stays sitting in the water however much its body pitches.
//
// The first frame of every row is skipped: the row's label ("SWIM —" etc.) is
// set hard against that duck's tail and overlaps it by 3-25px, so slicing it
// would drag the text in. Every row has frames to spare, and frame 1 is close
// enough to frame 0 that no motion is lost.
const DUCK_IMG = new Image();
let DUCK_READY = false;
DUCK_IMG.onload = () => { DUCK_READY = true; };
DUCK_IMG.src = 'assets/duck.png';

const DUCK_ANIM = {
  swim: { ms: 110, frames: [
    [293, 46, 157, 99], [502, 46, 157, 99], [713, 46, 157, 99],
    [920, 45, 157, 100], [1127, 45, 157, 102], [1322, 45, 164, 103], [1512, 45, 158, 107],
  ] },
  idle: { ms: 460, frames: [
    [461, 183, 156, 95], [667, 182, 158, 102],
  ] },
  look: { ms: 200, frames: [
    [436, 327, 130, 102], [647, 327, 157, 101],
    [862, 327, 155, 101], [1075, 329, 156, 99],
  ] },
  dip: { ms: 150, frames: [
    [239, 459, 153, 92], [459, 476, 148, 71], [672, 481, 147, 67],
    [870, 470, 158, 86], [1063, 447, 163, 104], [1280, 458, 156, 94], [1484, 455, 155, 97],
  ] },
  dabble: { ms: 180, frames: [
    [255, 573, 152, 146], [443, 590, 152, 123], [662, 586, 154, 125],
    [872, 611, 153, 90], [1078, 621, 157, 82], [1281, 600, 162, 111], [1490, 599, 157, 112],
  ] },
  flap: { ms: 85, frames: [
    [246, 739, 157, 136], [455, 738, 156, 138], [656, 733, 157, 143],
    [874, 754, 156, 122], [1093, 776, 158, 112], [1293, 777, 157, 98], [1495, 772, 158, 102],
  ] },
};

const DUCK_SCALE = 0.11;    // source px -> world units (duck reads ~17 units long)
const DUCK_WANDER = 20;     // how far a duck drifts from its home spot
const DUCK_ROOM = DUCK_WANDER + 12;  // clear water needed around home
const DUCK_SPACING = 130;   // keep ducks' home spots this far apart
const DUCK_BEAT = 4.5;      // seconds between "should I do something?" moments
const DUCK_SWIM_SPEED = 3.5; // world units/sec above which the swim cycle plays

// Where duck `n` is at time t. A pair of out-of-phase sines gives a wandering
// path that never repeats exactly but always stays inside DUCK_WANDER of home —
// which is what keeps the duck on open water.
//
// Only the rates below set the pace; the amplitudes are untouched, so making
// the ducks livelier never widens how far they roam and cannot push them onto
// the bank. DUCK_SWIM_SPEED is scaled alongside them so the split between
// paddling and floating stays where it was.
function duckPos(home, n, t) {
  const p1 = n * 1.7, p2 = n * 2.9, p3 = n * 0.8;
  const x = home.x
    + Math.sin(t * 0.30 + p1) * DUCK_WANDER * 0.7
    + Math.sin(t * 0.18 + p3) * DUCK_WANDER * 0.3;
  const y = home.y
    + Math.cos(t * 0.24 + p2) * DUCK_WANDER * 0.34
    + Math.cos(t * 0.15 + p1) * DUCK_WANDER * 0.16;
  return { x, y };
}

/**
 * A few ducks living on the pond. Each keeps to its own patch of water,
 * paddling around it and now and then looking about, dipping its head,
 * upending to dabble, or beating its wings.
 */
export function drawDucks(g, info, left, top, worldW, worldH, t, count = 3) {
  if (!info || !DUCK_READY) return;

  // Choose all the home spots up front so they can be kept apart: picked
  // independently, two ducks can happen to settle almost on top of each other,
  // which reads as a pair rather than birds spread over the lake.
  const homes = [];
  for (let n = 0; n < count; n++) {
    let home = null;
    for (let tries = 0; tries < 40 && !home; tries++) {
      const sa = hash(n * 53.7 + tries * 3.7 + 300);
      const sb = hash(n * 29.3 + tries * 6.1 + 301);
      const hx = 40 + sa * (worldW - 80), hy = 40 + sb * (worldH - 80);
      if (!hasClearWater(info, worldW, worldH, hx, hy, DUCK_ROOM)) continue;
      // far enough from the ducks already placed (relaxes if the pond is tight)
      const minGap = tries < 28 ? DUCK_SPACING : DUCK_WANDER * 2;
      if (homes.some((o) => Math.hypot(o.x - hx, o.y - hy) < minGap)) continue;
      home = { x: hx, y: hy };
    }
    if (home) homes.push(home);
  }

  for (let n = 0; n < homes.length; n++) {
    const home = homes[n];
    const pos = duckPos(home, n, t);
    // finite difference for heading and speed
    const prev = duckPos(home, n, t - 0.12);
    const vx = (pos.x - prev.x) / 0.12, vy = (pos.y - prev.y) / 0.12;
    const speed = Math.hypot(vx, vy);

    // Pick this beat's behaviour. Most beats are "carry on"; the rest trigger
    // one of the one-off actions, which plays once and then returns to
    // floating/paddling for the remainder of the beat.
    const beat = Math.floor(t / DUCK_BEAT + n * 0.37);
    const roll = hash(n * 17.9 + beat * 7.3 + 310);
    let key, oneShot = null;
    if (roll > 0.86) oneShot = 'flap';
    else if (roll > 0.74) oneShot = 'dabble';
    else if (roll > 0.60) oneShot = 'dip';
    else if (roll > 0.46) oneShot = 'look';

    const intoBeat = (t + n * 0.37 * DUCK_BEAT) % DUCK_BEAT;
    let anim, frameIdx;
    if (oneShot) {
      const a = DUCK_ANIM[oneShot];
      const dur = (a.frames.length * a.ms) / 1000;
      if (intoBeat < dur) {
        anim = a;
        frameIdx = Math.min(a.frames.length - 1, Math.floor(intoBeat * 1000 / a.ms));
        key = oneShot;
      }
    }
    if (!anim) {
      // no action this beat (or it has finished): paddle if moving, else float
      key = speed > DUCK_SWIM_SPEED ? 'swim' : 'idle';
      anim = DUCK_ANIM[key];
      frameIdx = Math.floor((t * 1000 / anim.ms) + n * 3) % anim.frames.length;
    }

    const f = anim.frames[frameIdx];
    const dw = Math.max(1, Math.round(f[2] * DUCK_SCALE));
    const dh = Math.max(1, Math.round(f[3] * DUCK_SCALE));
    // bottom edge of the frame is the waterline in every row of the sheet
    const dx = Math.round(left + pos.x - dw / 2);
    const dy = Math.round(top + pos.y - dh);

    g.save();
    g.imageSmoothingEnabled = false;
    if (vx < 0) {
      // sheet ducks face right; mirror when paddling the other way
      g.translate(dx + dw, dy);
      g.scale(-1, 1);
      g.drawImage(DUCK_IMG, f[0], f[1], f[2], f[3], 0, 0, dw, dh);
    } else {
      g.drawImage(DUCK_IMG, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
    }
    g.restore();
  }
}

// ------------------------------------------------------- A) procedural FX
export function proceduralRipples(g, info, left, top, worldW, worldH, t) {
  if (!info) return;
  const inWater = (x, y) => waterAt(info, worldW, worldH, x - left, y - top);
  g.save();

  // 1. Ambient ripples scattered across the open water: small -> expand ->
  // fade, staggered, looping — same stepped 6-frame technique as the
  // fountain, just many more of them (much bigger surface) and slower (a
  // still pond, not a churning basin).
  const N = 22;
  for (let i = 0; i < N; i++) {
    const period = 2.6 + i * 0.19;
    const loop = Math.floor((t + i * 3.7) / period);
    const phase = ((t + i * 3.7) % period) / period;
    // 10 steps instead of 6: the ring grows in finer increments so it reads
    // as spreading outward rather than popping between a few sizes.
    const STEPS = 10;
    const frame = Math.floor(phase * STEPS);
    const fq = frame / STEPS;
    // per-ripple size variation so they don't all look stamped from one mould
    const scale = 0.6 + hash(i * 2.3 + loop * 3.1 + 7) * 1.5;
    const maxR = (1 + (STEPS - 1) * 0.9) * scale; // size this ring ends at
    let px = 0, py = 0, found = false;
    for (let tries = 0; tries < 6 && !found; tries++) {
      const seedA = hash(i * 13.1 + loop * 4.7 + tries * 9.3);
      const seedB = hash(i * 6.3 + loop * 11.1 + 1 + tries * 15.7);
      px = seedA * worldW; py = 14 + seedB * (worldH - 28);
      // reject unless the ring will still be clear of the bank when fully grown
      found = hasClearWater(info, worldW, worldH, px, py, maxR);
    }
    if (!found) continue;
    const r = (1 + frame * 0.9) * scale;
    const fade = (fq < 0.45 ? 0.6 : 0.6 * (1 - (fq - 0.45) / 0.55));
    if (fade <= 0.02) continue;
    ringDots(g, left + px, top + py, r, Math.max(1, r * 0.5), [210, 235, 245], fade, inWater, i * 0.7 + loop);
  }

  // 2. Shimmer: tiny bright points that appear, drift a couple px, fade.
  const S = 8;
  for (let i = 0; i < S; i++) {
    const period = 2.1 + i * 0.27;
    const loop = Math.floor((t + i * 4.1) / period);
    const phase = ((t + i * 4.1) % period) / period;
    if (phase > 0.55) continue;
    const seedA = hash(i * 5.9 + loop * 3.3 + 5);
    const seedB = hash(i * 8.1 + loop * 6.7 + 6);
    const px = seedA * worldW, py = 12 + seedB * (worldH - 24);
    const k = phase / 0.55;
    const alpha = Math.sin(k * Math.PI) * 0.6;
    const drift = k * 1.5;
    if (!waterAt(info, worldW, worldH, px + drift, py)) continue;
    rect(g, Math.round(left + px + drift), Math.round(top + py), 1, 1, `rgba(255,255,255,${alpha.toFixed(2)})`);
  }

  // 3. (removed) Shoreline ring-ripples used to sit right on the bank. The
  // breaking waves below are the only effect that should touch the water's
  // edge, so these were dropped rather than competing with them.

  // 4. Bubble clusters rising then popping into a tiny ripple — suggests life
  // under the surface without ever drawing a fish. Real bubbles come up in
  // little clusters from one spot on the bottom, not as lone dots, so each
  // event releases a few on slightly different paths and timings.
  const B = 5;
  for (let i = 0; i < B; i++) {
    const period = 4.5 + i * 1.3;
    const loop = Math.floor((t + i * 11) / period);
    const phase = ((t + i * 11) % period) / period;
    const seedA = hash(i * 21.3 + loop * 5.1);
    const seedB = hash(i * 14.7 + loop * 8.3 + 1);
    const px = seedA * worldW, py = 16 + seedB * (worldH - 32);
    // clearance for the ring the burst pops into (r ends at 5), and for the
    // rising column above the spawn point
    if (!hasClearWater(info, worldW, worldH, px, py, 6)) continue;
    if (phase < 0.62) {
      const k = phase / 0.62;
      const count = 5 + Math.floor(hash(i * 4.7 + loop * 2.3 + 30) * 4);
      for (let b = 0; b < count; b++) {
        const lag = hash(i * 3.1 + b * 5.9 + loop * 1.7 + 40) * 0.5;
        const bt = k - lag;
        if (bt < 0 || bt > 1) continue;
        // Bubbles leave the same spot on the bottom, so the column stays tight
        // and only fans out a little as it rises.
        const spreadX = (hash(i * 6.7 + b * 2.9 + loop + 41) - 0.5) * 4 * (0.4 + bt);
        const rise = 8 + hash(i * 8.3 + b * 4.1 + loop + 42) * 9;
        const by = py - bt * rise;
        const bx = px + spreadX + Math.sin(bt * 5 + b * 1.9) * 1.2;
        if (!waterAt(info, worldW, worldH, bx, by)) continue;
        const a = Math.sin(bt * Math.PI) * 0.8;
        if (a <= 0.04) continue;
        const bxr = Math.round(left + bx), byr = Math.round(top + by);
        // a couple of the bubbles in each burst are fat enough to read as 2px
        const big = hash(i * 9.1 + b * 7.3 + loop + 43) > 0.62;
        rect(g, bxr, byr, 1, 1, `rgba(223,245,255,${a.toFixed(2)})`);
        if (big) {
          rect(g, bxr + 1, byr, 1, 1, `rgba(223,245,255,${(a * 0.9).toFixed(2)})`);
          rect(g, bxr, byr + 1, 1, 1, `rgba(200,232,246,${(a * 0.7).toFixed(2)})`);
          rect(g, bxr + 1, byr + 1, 1, 1, `rgba(200,232,246,${(a * 0.6).toFixed(2)})`);
          // highlight on the upper edge, the way a real bubble catches light
          rect(g, bxr, byr - 1, 1, 1, `rgba(255,255,255,${(a * 0.55).toFixed(2)})`);
        }
      }
    } else {
      // surfaced: the cluster pops into a small spreading ring
      const k = (phase - 0.62) / 0.38;
      const r = 1 + k * 4, fade = 0.5 * (1 - k);
      if (fade > 0.02) {
        ringDots(g, left + px, top + py, r, Math.max(1, r * 0.5), [220, 240, 250], fade, inWater, i * 2.1 + loop);
      }
    }
  }

  // 5. Large ripples: occasional big, slow rings from something larger
  // disturbing the pond (a fish breaking the surface, a dropped stone) —
  // same expanding-ring technique as the ambient ripples, just bigger,
  // slower, and rarer so each one reads as a distinct event rather than
  // background texture. A second, slightly trailing ring gives the crest
  // some depth instead of one thin line.
  const LG = 3;
  for (let i = 0; i < LG; i++) {
    const period = 6.5 + i * 1.7;
    const loop = Math.floor((t + i * 12.3) / period);
    const phase = ((t + i * 12.3) % period) / period;
    if (phase > 0.7) continue; // rest between events
    const fq = phase / 0.7;
    let px = 0, py = 0, found = false;
    for (let tries = 0; tries < 8 && !found; tries++) {
      const seedA = hash(i * 17.3 + loop * 5.9 + tries * 7.1 + 80);
      const seedB = hash(i * 10.7 + loop * 13.1 + 1 + tries * 9.3 + 80);
      px = 20 + seedA * (worldW - 40); py = 20 + seedB * (worldH - 40);
      // these grow to r=22, so they need the most room of any ripple
      found = hasClearWater(info, worldW, worldH, px, py, 22);
    }
    if (!found) continue;
    const r = 2 + fq * 20;
    const fade = fq < 0.45 ? 0.5 : 0.5 * (1 - (fq - 0.45) / 0.55);
    if (fade <= 0.02) continue;
    ringDots(g, left + px, top + py, r, r * 0.5, [215, 238, 248], fade, inWater, i * 3.3 + loop);
    if (fq > 0.1) {
      const r2 = Math.max(0, r - 6);
      ringDots(g, left + px, top + py, r2, r2 * 0.5, [230, 245, 252], fade * 0.6, inWater, i * 3.3 + loop + 0.5);
    }
  }

  // 6. Wave crashing: a foam crest rolls in along a stretch of shoreline,
  // brightens as it breaks, then pulls back — built from every shore point
  // within a growing radius of a random anchor, so it reads as a short wave
  // hitting the bank rather than a single point ripple. A few loose foam
  // flecks kick free into the water at the peak of the break.
  if (info.shore && info.shore.length) {
    const WV = 5;
    for (let i = 0; i < WV; i++) {
      const period = 3.4 + i * 0.9;
      const loop = Math.floor((t + i * 9.7) / period);
      const phase = ((t + i * 9.7) % period) / period;
      const anchorIdx = Math.floor(hash(i * 4.3 + loop * 2.9 + 90) * info.shore.length);
      const [ax, ay] = info.shore[anchorIdx];
      const acx = ax * (worldW / info.w), acy = ay * (worldH / info.h);

      let alpha;
      if (phase < 0.35) alpha = phase / 0.35;              // surging in
      else if (phase < 0.55) alpha = 1;                    // breaking
      else alpha = 1 - (phase - 0.55) / 0.45;               // pulling back
      if (alpha <= 0.03) continue;

      const spread = 14 + (phase < 0.55 ? phase / 0.55 : 1) * 14;
      const kx = worldW / info.w, ky = worldH / info.h;
      const spread2 = spread * spread;
      for (let si = 0; si < info.shore.length; si++) {
        const pt = info.shore[si];
        const wx = pt[0] * kx, wy = pt[1] * ky;
        // bounding-box reject first: most shore points are nowhere near this
        // wave, and a subtraction beats a hypot on every one of them
        const ddx = wx - acx; if (ddx > spread || ddx < -spread) continue;
        const ddy = wy - acy; if (ddy > spread || ddy < -spread) continue;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > spread2) continue;
        const d = Math.sqrt(d2);
        // Dithered foam: only a hash-selected fraction of shore pixels light
        // up, and the fraction falls off with distance — a solid fill of every
        // shore pixel reads as a painted white blob, not moving foam.
        const localFade = alpha * (1 - d / spread);
        if (localFade <= 0.06) continue;
        const speckle = hash(si * 1.7 + loop * 5.3 + i * 2.9);
        if (speckle > localFade) continue;
        const bright = speckle < localFade * 0.35;
        const a2 = Math.min(0.85, localFade * 1.05);
        rect(g, Math.round(left + wx), Math.round(top + wy), 1, 1,
          bright ? `rgba(255,255,255,${a2.toFixed(2)})` : `rgba(215,238,248,${(a2 * 0.8).toFixed(2)})`);
      }

      if (phase >= 0.3 && phase < 0.6) {
        for (let f = 0; f < 5; f++) {
          const fseed = hash(i * 6.1 + loop * 3.3 + f * 2.7 + 95);
          const fseed2 = hash(i * 8.9 + loop * 4.1 + f * 3.3 + 96);
          const ang = fseed * Math.PI * 2;
          const dist = 4 + fseed2 * 9;
          const fx = acx + Math.cos(ang) * dist, fy = acy + Math.sin(ang) * dist * 0.6;
          if (!waterAt(info, worldW, worldH, fx, fy)) continue;
          rect(g, Math.round(left + fx), Math.round(top + fy), 1, 1, `rgba(255,255,255,${(alpha * 0.65).toFixed(2)})`);
        }
      }
    }
  }

  // 7. Surface texture: between ripple events the open water is a flat block
  // of colour, which reads as painted rather than wet. Two interfering wave
  // trains drift slowly across the pond and only their crests are drawn, as
  // very faint 1px highlights — enough to suggest a moving surface without
  // competing with the ripples. Deliberately low contrast: it should be felt
  // more than seen.
  {
    const drift = t * 5;
    const STEP = 7;
    for (let cy = 8; cy < worldH - 8; cy += STEP) {
      for (let cx = 0; cx < worldW; cx += STEP) {
        // Jitter each sample off the lattice, otherwise the highlights land on
        // a perfect grid and read as a halftone screen rather than water.
        const jx = (hash(cx * 0.37 + cy * 1.91) - 0.5) * STEP * 1.6;
        const jy = (hash(cx * 1.13 + cy * 0.61 + 5) - 0.5) * STEP * 1.6;
        const sx = cx + jx, sy = cy + jy;
        const v = Math.sin((sx + drift) * 0.085 + sy * 0.05)
                + Math.sin((sx - drift * 0.55) * 0.125 - sy * 0.075);
        if (v < 1.35) continue; // crests only — cheap reject before the mask test
        if (!waterAt(info, worldW, worldH, sx, sy)) continue;
        const a = ((v - 1.35) / 0.65) * 0.16;
        if (a <= 0.02) continue;
        // Short horizontal dashes read as glints lying flat on the surface;
        // isolated single pixels just look like noise.
        const len = 1 + Math.floor(hash(cx * 2.7 + cy * 0.83 + 9) * 3);
        for (let d = 0; d < len; d++) {
          const px2 = sx + d;
          if (!waterAt(info, worldW, worldH, px2, sy)) break;
          const aa = a * (1 - d * 0.22);
          rect(g, Math.round(left + px2), Math.round(top + sy), 1, 1, `rgba(205,232,246,${aa.toFixed(2)})`);
        }
      }
    }
  }

  // 8. Lily pads and the island sit in the water, so the surface nudges
  // against them too — but as a slow bob, never breaking surf. Points that
  // failed the bank test above are exactly these, so they drive it.
  if (info.padEdge && info.padEdge.length) {
    for (let pi = 0; pi < info.padEdge.length; pi++) {
      const [sx, sy] = info.padEdge[pi];
      const wx = sx * (worldW / info.w), wy = sy * (worldH / info.h);
      // a slow travelling swell so pads on opposite sides aren't in sync
      const swell = Math.sin(t * 1.15 + (wx + wy) * 0.045);
      if (swell < 0.45) continue;
      const a = (swell - 0.45) / 0.55 * 0.3;
      if (a <= 0.03) continue;
      if (hash(pi * 2.7) > 0.55) continue; // break up the outline
      rect(g, Math.round(left + wx), Math.round(top + wy), 1, 1, `rgba(225,243,252,${a.toFixed(2)})`);
    }
  }

  g.restore();
}
