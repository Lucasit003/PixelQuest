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
  // Kept alongside the mask: the mask says water or not-water, which is all
  // most effects need, but telling a lily pad from a shoreline rock needs the
  // actual colours (see lilyPads).
  return { mask, w, h, shore, padEdge, clearance, rgba: d };
}

// dx/dy are world-unit offsets from the art's top-left draw position.
//
// An info object may carry FUNCTIONS instead of pixel arrays — `isWaterFn`
// and `clearFn`, both in the same art-local units — which is how the
// procedural river lends its analytic water field to the pond's wildlife
// (fish jumps on the calm reaches) without rendering a mask bitmap the size
// of the map. Mask-backed ponds are untouched.
function waterAt(info, worldW, worldH, dx, dy) {
  if (!info) return false;
  if (info.isWaterFn) return info.isWaterFn(dx, dy);
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
  if (info.clearFn) return info.clearFn(cx, cy) >= rx + 2;
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
  if (info.clearFn) return info.clearFn(cx, cy);
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
export function ringDots(g, cx, cy, rx, ry, rgb, alpha, maskFn, seed = 0) {
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

// Ducklings (assets/fduckling.png), one brood trailing each adult. Seven
// labelled rows, and unlike the adult sheet every row leaves a clear gap
// between its label and the first frame, so no frame has to be skipped.
//
// Each row is sliced to ONE waterline: frames are tight-cropped horizontally
// but all extended down to the lowest bottom edge in their row. Frames vary in
// height by up to 14px (a head dips, a wing lifts), and bottom-anchoring tight
// crops would plant each of those on the water in turn and bob the bird up and
// down through the cycle. The padding is transparent, so it costs nothing.
const DUCKLING_IMG = new Image();
let DUCKLING_READY = false;
DUCKLING_IMG.onload = () => { DUCKLING_READY = true; };
DUCKLING_IMG.src = 'assets/fduckling.png';

const DUCKLING_ANIM = {
  swim: { ms: 100, frames: [
    [166, 27, 123, 74], [341, 26, 111, 75], [548, 23, 91, 78],
    [722, 27, 103, 74], [899, 27, 112, 74], [1073, 27, 118, 74],
  ] },
  catchup: { ms: 85, frames: [
    [191, 133, 98, 74], [343, 131, 136, 76], [549, 131, 105, 76],
    [729, 133, 106, 74], [901, 134, 111, 73], [1065, 134, 130, 73],
  ] },
  idle: { ms: 430, frames: [
    [363, 227, 88, 80], [541, 233, 86, 74], [717, 233, 86, 74],
    [883, 227, 88, 80],
  ] },
  look: { ms: 190, frames: [
    [213, 334, 86, 78], [381, 334, 84, 78], [550, 334, 87, 78],
    [725, 335, 86, 77], [889, 334, 87, 78], [1061, 334, 86, 78],
  ] },
  dip: { ms: 150, frames: [
    [211, 437, 88, 81], [375, 449, 95, 69], [541, 447, 116, 71],
    [715, 449, 94, 69], [887, 435, 94, 83], [1059, 435, 90, 83],
  ] },
  flap: { ms: 90, frames: [
    [211, 545, 88, 76], [380, 545, 89, 76], [546, 535, 91, 86],
    [719, 539, 89, 82], [888, 543, 92, 78], [1057, 543, 92, 78],
  ] },
  shake: { ms: 110, frames: [
    [214, 650, 88, 78], [382, 650, 85, 78], [549, 651, 85, 77],
    [719, 647, 88, 81], [885, 651, 87, 77], [1060, 649, 87, 79],
  ] },
};

const DUCK_SCALE = 0.143;   // source px -> world units (duck reads ~22 units long)
const DUCK_WANDER = 20;     // how far a duck drifts from its home spot
const DUCK_ROOM = DUCK_WANDER + 16;  // clear water needed around home
const DUCK_SPACING = 130;   // keep ducks' home spots this far apart
const DUCK_BEAT = 4.5;      // seconds between "should I do something?" moments
// One knob for how briskly everything on the water moves. The birds are 7-17
// units long drawn at roughly a unit per pixel, so at full pace they stepped a
// pixel about 13 times a second — fast enough that the rounding to whole pixels
// reads as a stutter rather than as gliding. Everything time-based scales with
// this together (wander rates, the brood's wobble, the bearing drift) so the
// motion stays in proportion; only the amplitudes are left alone, so slowing
// them down cannot change how far they roam or push them onto the bank.
const DUCK_PACE = 0.6;
const DUCK_SWIM_SPEED = 3.5 * DUCK_PACE; // units/sec above which the swim cycle plays
// Velocity is measured over a window, not between adjacent frames. The window
// is what stops the cycle and the facing hunting: at 0.12s the measured speed
// crossed the swim/idle line constantly and mates were flipping which way they
// faced every three seconds.
const VEL_WINDOW = 0.4;

const DUCKLING_SCALE = 0.098; // reads ~9 units long, a bit under half the adult
const TRAIL_STEP = 0.2;     // seconds per step when walking back down the path
const TRAIL_STEPS = 130;    // 26s of it — long enough never to run out (see familyTrail)
const PAIR_SIDE = 25;       // world units the mate rides off the lead's shoulder
const PAIR_BACK = 9;        // and how far back down the same path, so it staggers
const BROOD_NEAR = 17;      // radius of the inner ducklings from their mother
const BROOD_STAGGER = 9;    // extra radius for the alternating outer ones
const BROOD_FAN = 0.6;      // radians of bearing between one duckling and the next
// How far a family reaches from its home spot — the furthest bird of the pair
// or the brood. Home spots are kept more than twice this apart, because two
// families that can touch WILL: the spacing within a family is constructed,
// but nothing arbitrates between families, and once they interleave birds sit
// on top of each other with no per-frame push left to separate them.
const FAMILY_REACH = 34;
const BROOD_BEAT = 3.6;     // ducklings fidget on a faster clock than the adults

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
  const s = t * DUCK_PACE;
  const x = home.x
    + Math.sin(s * 0.30 + p1) * DUCK_WANDER * 0.7
    + Math.sin(s * 0.18 + p3) * DUCK_WANDER * 0.3;
  const y = home.y
    + Math.cos(s * 0.24 + p2) * DUCK_WANDER * 0.34
    + Math.cos(s * 0.15 + p1) * DUCK_WANDER * 0.16;
  return { x, y };
}

// How many ducklings follow duck `n`. Broods differ in size so the lake does
// not read as the same family repeated.
function broodSize(n) { return 2 + Math.floor(hash(n * 41.3 + 617) * 3); }

// The point `dist` world units back along duck `n`'s own wake at time t.
//
// Trailing by a fixed number of SECONDS is the obvious way to do this and it
// does not work: the adult's wander has a period around 21s, so a duckling a
// few seconds back is most of a half-cycle behind and surfaces on the far side
// of the loop. On screen the brood scattered into a loose ring around the
// mother instead of following her, every bird pointing a different way.
//
// Walking the path back by arc length instead puts each duckling a fixed
// DISTANCE down the line the adult actually swam, which is what a following
// brood looks like — single file, all facing the way she went. When she is
// barely moving the walk runs out of path and they simply bunch up behind her,
// which is also what real ones do.
// Every bird of a family in ONE backward walk — `dists` ascending, a point
// returned per entry. They all trail the same path, so walking it once and
// picking positions off as each distance goes by costs a fraction of walking
// it per bird.
//
// A point held at a fixed arc distance behind the adult provably moves at the
// adult's own speed, so this cannot make a bird outrun her — but ONLY while
// the walk actually reaches that distance. Run out of path and the tail has to
// be extrapolated in a straight line, and that extrapolation swings as the
// path evolves: measured frame to frame, the furthest duckling jumped 1.05
// world units against the adult's 0.088, and was extrapolating 100% of the
// time. The window is what fixes it, NOT the step size — at a 9s window every
// step from 0.12s down to 0.008s gave the same 1.05, while widening the window
// to 24s brought every distance to exactly 0.088 with the step left coarse.
// The adult covers ~3 units a second, so TRAIL_SPAN carries the furthest bird
// with a wide margin over the slow stretches.
function familyTrail(home, n, t, dists, bx, by) {
  const out = new Array(dists.length);
  let prev = duckPos(home, n, t);
  let dx = bx, dy = by;      // direction of the most recent segment
  let acc = 0, tt = t, idx = 0;
  for (let k = 0; k < TRAIL_STEPS && idx < dists.length; k++) {
    tt -= TRAIL_STEP;
    const p = duckPos(home, n, tt);
    const sx = p.x - prev.x, sy = p.y - prev.y;
    const seg = Math.hypot(sx, sy);
    if (seg > 1e-6) { dx = sx / seg; dy = sy / seg; }
    // one segment can carry past several birds' distances
    while (idx < dists.length && acc + seg >= dists[idx]) {
      const f = seg > 1e-6 ? (dists[idx] - acc) / seg : 0;
      out[idx] = { x: prev.x + sx * f, y: prev.y + sy * f };
      idx++;
    }
    acc += seg;
    prev = p;
  }
  for (; idx < dists.length; idx++) {
    out[idx] = { x: prev.x + dx * (dists[idx] - acc), y: prev.y + dy * (dists[idx] - acc) };
  }
  return out;
}

// Duck `n` and its whole brood at time t, solved together.
//
// The line is built from the adult's OWN past positions: duckPos is a pure
// function of time, so sampling it further and further back returns a string
// of points along the exact path the adult swam. The brood inherits every turn
// with no steering code, and — more usefully — it can never be anywhere the
// adult has not already been, which is what keeps it off the bank.
//
// Every bird is CONSTRUCTED already correctly spaced; nothing is solved after
// the fact. The first version pushed birds apart with a relaxation pass, swung
// them round the leader to find water, and finished with a global separation
// sweep — and every one of those steps snaps. Measured frame to frame,
// ducklings jumped up to 35 world units in a single frame against a normal of
// 0.08, because a solver is free to flip a bird to the far side of whatever it
// is avoiding. Spacing now comes from the construction itself:
//
//   - along the path, each bird sits at its own arc distance behind the adult,
//     so consecutive ducklings are a fixed distance apart by definition;
//   - across the path, they alternate shoulders by BROOD_LAT, which opens the
//     line into a proper brood rather than a single file.
//
// Both are smooth functions of t, so the whole family moves continuously. The
// caller finite-differences this call for heading and speed.
function familyPositions(info, worldW, worldH, home, n, t, count) {
  const parent = duckPos(home, n, t);
  // "behind" the adult, over a window long enough that a momentary stall
  // cannot leave the direction undefined
  const was = duckPos(home, n, t - 0.5);
  let bx = was.x - parent.x, by = was.y - parent.y;
  const bl = Math.hypot(bx, by) || 1;
  bx /= bl; by /= bl;
  // Sideways offsets are NOT taken from the normal to the heading. That reads
  // well right up until the adult doubles back on her wander, where the heading
  // sweeps through 180 degrees in a moment and every offset hung off it whips
  // round with it — the mate was measured moving 7.2 units in a single frame.
  // A slowly turning bearing of its own has no such reversal: at these rates it
  // cannot move a bird faster than about 0.03 units a frame, and alongside is
  // alongside whichever way the pair happens to be pointing.
  const bearing = (salt) => n * 2.1 + salt + Math.sin(t * 0.08 * DUCK_PACE + n * 1.7 + salt) * 0.9;

  // one walk for the whole family: the mate's stagger, then each duckling's
  const pts = familyTrail(home, n, t, [PAIR_BACK], bx, by);

  const side = hash(n * 7.7 + 91) > 0.5 ? 0 : Math.PI;
  const ma = bearing(side);
  const mb = pts[0];
  const mate = { x: mb.x + Math.cos(ma) * PAIR_SIDE, y: mb.y + Math.sin(ma) * PAIR_SIDE };

  // Ducklings sit in a formation around their mother rather than trailing down
  // her wake. Trailing is the intuitive model and it cannot work here: she
  // wanders inside a disc only DUCK_WANDER across, so a brood strung out over
  // 40 units of the path she swam folds back inside that same small disc and
  // piles up. Measured, some pair was fully stacked in 29% of frames and within
  // 6 units in 97% of them — the brood was permanently in a heap.
  //
  // Placing them by bearing and radius instead makes the spacing a property of
  // the arrangement, so it holds no matter what her path does. Alternating the
  // radius and fanning the bearings keeps every pair clear, and because both
  // are slow smooth functions the whole formation drifts round her rather than
  // snapping — which is what the earlier attempts all failed at.
  // Directly opposite the mate — taken off `ma` itself, not a second call to
  // bearing(). bearing(PI) is not bearing(0) + PI (the phase goes through the
  // sine too), so when the mate's own side came up PI the two expressions
  // collided and the mate sat in the middle of the brood, measured 0.5 units
  // off a duckling.
  const broodCentre = ma + Math.PI;
  const brood = [];
  for (let i = 0; i < count; i++) {
    const ph = n * 3.1 + i * 2.3;
    const ang = broodCentre + (i - (count - 1) / 2) * BROOD_FAN;
    const r = BROOD_NEAR + (i % 2) * BROOD_STAGGER;
    brood.push({
      x: parent.x + Math.cos(ang) * r + Math.sin(t * 1.05 * DUCK_PACE + ph) * 1.2,
      y: parent.y + Math.sin(ang) * r + Math.cos(t * 0.85 * DUCK_PACE + ph) * 0.9,
    });
  }
  return { parent, mate, brood };
}

// Which cycle an adult is playing at time t. `salt` separates the two birds of
// a pair, so a drake and his mate never dip or flap in lockstep — swimming the
// same water on the same clock is exactly when cloned animation is obvious.
function adultAnim(t, salt, speed) {
  const beat = Math.floor(t / DUCK_BEAT + salt * 0.37);
  const roll = hash(salt * 17.9 + beat * 7.3 + 310);
  let oneShot = null;
  if (roll > 0.86) oneShot = 'flap';
  else if (roll > 0.74) oneShot = 'dabble';
  else if (roll > 0.60) oneShot = 'dip';
  else if (roll > 0.46) oneShot = 'look';

  const intoBeat = (t + salt * 0.37 * DUCK_BEAT) % DUCK_BEAT;
  if (oneShot) {
    const a = DUCK_ANIM[oneShot];
    if (intoBeat < (a.frames.length * a.ms) / 1000) {
      return { anim: a, frameIdx: Math.min(a.frames.length - 1, Math.floor(intoBeat * 1000 / a.ms)) };
    }
  }
  // no action this beat (or it has finished): paddle if moving, else float
  const anim = DUCK_ANIM[speed > DUCK_SWIM_SPEED ? 'swim' : 'idle'];
  return { anim, frameIdx: Math.floor((t * 1000 / anim.ms) + salt * 3) % anim.frames.length };
}

/**
 * Duck families living on the pond. Each is a PAIR of adults — a lead and its
 * mate riding off one shoulder — with a brood of ducklings trailing them. The
 * adults keep to their own patch of water, paddling around it and now and then
 * looking about, dipping a head, upending to dabble, or beating a pair of
 * wings; the ducklings string out along the path behind and hurry when they
 * fall too far back.
 *
 * `pairs` counts families, so the lake carries twice that many adults.
 */
export function drawDucks(g, info, left, top, worldW, worldH, t, pairs = 7) {
  if (!info || !DUCK_READY) return;

  // Home spots, kept far enough apart that no two families can ever reach each
  // other. A family is not a point — it covers DUCK_WANDER from home plus the
  // furthest bird of the pair or brood — so the floor has to clear two of
  // those. Nothing arbitrates between families at draw time, by design, so
  // this placement is the only thing keeping them from interleaving.
  //
  // Cached on the mask: the spots depend on the pond and the count, never on
  // t, and this was being redone every frame. Caching also pays for a properly
  // thorough search — at 40 tries the sampler kept giving up with 3 families
  // placed on a lake that measured room for 8.
  const key = pairs + '@' + Math.round(worldW) + 'x' + Math.round(worldH);
  if (!info._duckHomes) info._duckHomes = {};
  let homes = info._duckHomes[key];
  if (!homes) {
    homes = [];
    const minGap = (DUCK_WANDER + FAMILY_REACH) * 2.4;
    for (let n = 0; n < pairs; n++) {
      let home = null;
      for (let tries = 0; tries < 400 && !home; tries++) {
        const sa = hash(n * 53.7 + tries * 3.7 + 300);
        const sb = hash(n * 29.3 + tries * 6.1 + 301);
        const hx = 40 + sa * (worldW - 80), hy = 40 + sb * (worldH - 80);
        // Room for the whole family, not just the lead's own wander. The
        // furthest any bird gets from home is the lead's wander plus the
        // family's reach, so that plus a margin is the disc that has to be open
        // water. DUCK_ROOM already carries a margin of its own, and adding the
        // two together asked for a 70-unit clearing, which this lake has only
        // three of — it was the clearance, not the spacing between families,
        // that priced two of them off the water once the birds were enlarged.
        if (!hasClearWater(info, worldW, worldH, hx, hy, DUCK_WANDER + FAMILY_REACH + 6)) continue;
        if (homes.some((o) => Math.hypot(o.x - hx, o.y - hy) < minGap)) continue;
        home = { x: hx, y: hy };
      }
      if (home) homes.push(home);
    }
    info._duckHomes[key] = homes;
  }

  // Adults and ducklings are collected first and drawn together at the end,
  // sorted by waterline. Drawing each family as it is built would let a
  // duckling that is lower down the screen — nearer the viewer — be painted
  // over by an adult further up the lake.
  const birds = [];
  const add = (img, anim, frameIdx, scale, pos, vx, kindTag) => {
    const f = anim.frames[frameIdx];
    const dw = Math.max(1, Math.round(f[2] * scale));
    const dh = Math.max(1, Math.round(f[3] * scale));
    birds.push({ img, f, dw, dh, faceLeft: vx < 0, wx: pos.x, wy: pos.y,
      seq: birds.length, kindTag, anim });
  };

  for (let n = 0; n < homes.length; n++) {
    const home = homes[n];
    const count = DUCKLING_READY ? broodSize(n) : 0;
    const now = familyPositions(info, worldW, worldH, home, n, t, count);
    const was = familyPositions(info, worldW, worldH, home, n, t - VEL_WINDOW, count);

    // ---- the pair: a lead and its mate off one shoulder
    const pos = now.parent;
    const vx = (pos.x - was.parent.x) / VEL_WINDOW, vy = (pos.y - was.parent.y) / VEL_WINDOW;
    const speed = Math.hypot(vx, vy);
    const lead = adultAnim(t, n, speed);
    add(DUCK_IMG, lead.anim, lead.frameIdx, DUCK_SCALE, pos, vx, 'lead' + n);

    const mvx = (now.mate.x - was.mate.x) / VEL_WINDOW, mvy = (now.mate.y - was.mate.y) / VEL_WINDOW;
    const mate = adultAnim(t, n + 37.5, Math.hypot(mvx, mvy));
    // The whole family faces the way the lead is going. A mate holding station
    // alongside barely moves relative to the water, so its own heading is
    // nearly all wobble — read a facing off it and the bird flips which way it
    // points every three seconds, which is far more obvious than any moment of
    // it facing "wrong".
    add(DUCK_IMG, mate.anim, mate.frameIdx, DUCK_SCALE, now.mate, vx, 'mate' + n);

    // ---- and the brood
    for (let i = 0; i < count; i++) {
      const dpos = now.brood[i], dprev = was.brood[i];
      const dvx = (dpos.x - dprev.x) / VEL_WINDOW, dvy = (dpos.y - dprev.y) / VEL_WINDOW;
      const dspeed = Math.hypot(dvx, dvy);

      let dAnim = null, dFrame = null;
      // The hurried paddle now means "mother is striking out and the babies are
      // working to keep up", which is the only thing it can mean once they hold
      // a constructed formation. It used to trigger on the gap to the bird
      // ahead, and that gap became a fixed radius of 13 against a threshold of
      // 12.15 — so it was on permanently, and this frantic 70ms cycle was the
      // most-played animation on the lake at 36% of all bird-frames.
      if (speed > DUCK_SWIM_SPEED * 1.4) {
        dAnim = DUCKLING_ANIM.catchup;
      } else if (dspeed > DUCK_SWIM_SPEED * 0.8) {
        dAnim = DUCKLING_ANIM.swim;
      } else {
        // drifting: fidget on their own faster clock, then settle to floating
        const dBeat = Math.floor(t / BROOD_BEAT + n * 0.3 + i * 0.61);
        const roll2 = hash(n * 13.1 + i * 23.7 + dBeat * 5.9 + 640);
        const into = (t + (n * 0.3 + i * 0.61) * BROOD_BEAT) % BROOD_BEAT;
        const one = roll2 > 0.80 ? 'shake' : roll2 > 0.66 ? 'flap'
          : roll2 > 0.52 ? 'dip' : roll2 > 0.36 ? 'look' : null;
        if (one) {
          const a = DUCKLING_ANIM[one];
          if (into < (a.frames.length * a.ms) / 1000) {
            dAnim = a;
            dFrame = Math.min(a.frames.length - 1, Math.floor(into * 1000 / a.ms));
          }
        }
        if (!dAnim) dAnim = DUCKLING_ANIM.idle;
      }
      if (dFrame == null) {
        dFrame = Math.floor((t * 1000 / dAnim.ms) + n * 2 + i * 3) % dAnim.frames.length;
      }
      // Facing comes from the lead, like the mate's — a duckling's own
      // velocity is mostly wobble and reading a facing off it had broods
      // pointing three different ways at once.
      add(DUCKLING_IMG, dAnim, dFrame, DUCKLING_SCALE, dpos, vx, 'kid' + n + '.' + i);
    }
  }

  // There is deliberately NO separation pass here. Pushing overlapping birds
  // apart per frame is the obvious safety net and it is what made them
  // teleport: the push flips a bird to the far side of whatever it is avoiding,
  // and the flip is instant. Families are kept from meeting at placement time
  // instead — see the home spacing floor above, which is chosen from a
  // family's full reach — and within a family nothing can overlap because the
  // formation is constructed spaced.

  for (const b of birds) {
    b.sortY = b.wy;
    // bottom edge of the frame is the waterline in every row of both sheets
    b.x = Math.round(left + b.wx - b.dw / 2);
    b.y = Math.round(top + b.wy - b.dh);
  }

  // Debug hook (window.__duckTrace = true): every bird in a STABLE order —
  // family by family, lead then mate then brood — so successive frames can be
  // compared bird for bird. Draw order is sorted by waterline and shuffles
  // between frames, which makes it useless for that. Reported after the draw
  // positions are rounded, so px/py are the actual pixels that get painted:
  // smooth world motion still reads as a stutter if the rounding steps unevenly.
  if (typeof window !== 'undefined' && window.__duckTrace) {
    const nameOf = (a) => {
      for (const k in DUCK_ANIM) if (DUCK_ANIM[k] === a) return 'duck:' + k;
      for (const k in DUCKLING_ANIM) if (DUCKLING_ANIM[k] === a) return 'kid:' + k;
      return '?';
    };
    window.__duckFrame = birds.map((b) => ({ seq: b.seq, x: b.wx, y: b.wy, kind: b.kindTag,
      anim: nameOf(b.anim), faceLeft: b.faceLeft, px: b.x, py: b.y }));
  }

  birds.sort((a, b) => a.sortY - b.sortY);
  for (const b of birds) {
    const f = b.f;
    g.save();
    g.imageSmoothingEnabled = false;
    if (b.faceLeft) {
      // both sheets face right; mirror when paddling the other way. Mirroring
      // is a save/restore per bird rather than a reset — the caller has the
      // camera on this context, and clearing the transform would take it too.
      g.translate(b.x + b.dw, b.y);
      g.scale(-1, 1);
      g.drawImage(b.img, f[0], f[1], f[2], f[3], 0, 0, b.dw, b.dh);
    } else {
      g.drawImage(b.img, f[0], f[1], f[2], f[3], b.x, b.y, b.dw, b.dh);
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

// ------------------------------------------------------------------- frogs
// Frogs on the lily pads (assets/frog.png). The sheet's alpha is genuine — no
// matting was needed, unlike the bridge art — and it carries ten labelled
// cycles; these are the ones that read at this size. The water cycles (big
// jump, surface, swim, climb onto a pad) are deliberately unused: they all
// move the frog between water and pad, and a frog that stays put on its pad
// is both calmer and impossible to strand somewhere it should not be.
//
// Rows are sliced to ONE waterline like the duckling sheet, so bottom
// anchoring cannot bob the frog as frame heights change.
const FROG_ART = new Image();
let FROG_READY = false;
FROG_ART.onload = () => { FROG_READY = true; };
FROG_ART.src = 'assets/frog.png';

const FROG_ANIM = {
  idle: { ms: 150, frames: [
    [11, 40, 89, 85, 40], [124, 40, 89, 85, 40], [237, 41, 89, 84, 41],
    [368, 41, 95, 84, 43], [505, 41, 93, 84, 42], [638, 41, 94, 84, 43],
  ] },
  blink: { ms: 120, frames: [
    [797, 42, 93, 83, 42], [920, 43, 91, 82, 43], [1040, 42, 94, 83, 43],
    [1165, 42, 94, 83, 43], [1296, 43, 94, 82, 42],
  ] },
  look: { ms: 170, frames: [
    [11, 180, 90, 84, 42], [124, 176, 92, 88, 43], [249, 182, 91, 82, 41],
    [373, 180, 94, 84, 43], [505, 178, 91, 86, 43], [636, 178, 92, 86, 43],
  ] },
  hop: { ms: 90, frames: [
    [801, 194, 91, 70, 42], [918, 183, 92, 81, 39], [1039, 178, 115, 86, 64],
    [1178, 197, 90, 67, 42], [1297, 195, 94, 69, 43], [1417, 188, 91, 76, 42],
  ] },
  // Airborne, so the horizontal anchor is the body centroid: a frog in mid-air
  // has its legs trailing behind and no feet to stand on. The nose-down dive
  // frame that ends the sheet's row is left out — it is for entering water,
  // and these jumps land on another pad.
  jump: { ms: 80, frames: [
    [11, 350, 97, 81, 49], [117, 315, 110, 116, 57], [254, 310, 118, 121, 65],
    [393, 318, 108, 113, 55], [512, 320, 124, 111, 66], [657, 310, 118, 121, 61],
    [801, 310, 109, 121, 55], [951, 321, 103, 110, 54],
  ] },
  croak: { ms: 110, frames: [
    [125, 902, 101, 88, 45], [256, 901, 101, 89, 45], [386, 900, 103, 90, 46],
    [521, 899, 104, 91, 47], [649, 900, 103, 90, 46], [778, 899, 104, 91, 46],
    [905, 896, 103, 94, 46], [1032, 882, 109, 108, 47], [1164, 882, 109, 108, 49],
    [1289, 890, 102, 100, 46], [1407, 899, 102, 91, 44],
  ] },
};

// One anchor per grounded cycle, not one per frame. A sitting frog's feet do
// not move, so the few source pixels the measured anchor wanders between frames
// are noise in the art — and rounding that noise to whole screen pixels makes
// the frog twitch. It survived the first pass only because at the old scale
// every value happened to round the same way; enlarging the sprites turned
// idle's 40,40,41,43,42,43 into 5,5,5,6,5,6 and the twitch appeared at 3.3 a
// second. Taking the median once per cycle makes it scale-proof. The jump keeps
// per-frame anchors — that frog really is moving.
for (const key of Object.keys(FROG_ANIM)) {
  if (key === 'jump') continue;
  const a = FROG_ANIM[key];
  const mid = (xs) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
  a.anchorL = mid(a.frames.map((f) => f[4]));
  a.anchorR = mid(a.frames.map((f) => f[2] - f[4]));
}

const FROG_SCALE = 0.13;    // source px -> world units (frog reads ~12 units)
const FROG_SIT = 4;         // units below the pad's centre, so it sits on it
const FROG_BEAT = 6.0;      // seconds between "should I do something?" moments
const PAD_APART = 60;       // keep frogs to one per cluster of pads
const FROG_HOP_PADS = 5;    // most pads one frog will do the rounds of
const FROG_HOP_MAX = 42;    // and the longest single hop it will make
const JUMP_EVERY = 11;      // seconds a frog spends on a pad before moving on
const JUMP_ARC = 9;         // world units the leap rises off the water

// Every lily pad in the lake, as pond-relative world points.
//
// A pad is a patch of non-water that the outside cannot reach: flood the
// non-water pixels and throw away anything touching the border, which is the
// bank and everything beyond it. What is left is the island, the pads, and —
// the part that area alone gets wrong — the shoreline rocks and reed clumps
// standing in the shallows. Area only sorts out the island (about 1600 mask
// pixels against a pad's 60 to 300); the first pass put a frog on a rock and
// another on a reed, both of which are pad-sized. Two more tests separate them:
//
//   - a pad is GREEN, a rock is grey — its mean red, green and blue sit within
//     a few points of each other, while a pad's green leads by twenty or more;
//   - a pad is WIDER THAN TALL, a reed clump is the opposite (0.52 measured,
//     against 1.0 to 1.35 for every real pad).
//
// Cached on the mask; it depends only on the art.
// `artOnly` returns just the pads painted into the pond art, which is what the
// vegetation pass needs to avoid dropping a new pad on top of an existing one.
// Everyone else gets those plus the ones the vegetation pass added, so a frog
// can hop onto anything that looks like a lily pad, however it got there.
function lilyPads(info, worldW, worldH, artOnly) {
  if (artOnly && info._artPads) return info._artPads;
  if (!artOnly && info._lilyPads) return info._lilyPads;
  const { mask, w, h, rgba } = info;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let pads = [];
  for (let start = 0; start < w * h; start++) {
    if (mask[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start; seen[start] = 1;
    let n = 0, sumX = 0, sumY = 0, border = false;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    let sr = 0, sg = 0, sb = 0, lit = 0, pale = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const y = (p / w) | 0, x = p - y * w;
      n++; sumX += x; sumY += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (rgba && rgba[p * 4 + 3] > 150) {
        const pr = rgba[p * 4], pg = rgba[p * 4 + 1], pb = rgba[p * 4 + 2];
        sr += pr; sg += pg; sb += pb; lit++;
        // pale and unsaturated — the white bloom some pads carry
        const lo = Math.min(pr, pg, pb), hi = Math.max(pr, pg, pb);
        if (lo > 140 && hi - lo < 70) pale++;
      }
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (border || n < 60 || n > 600 || !lit) continue;
    const mr = sr / lit, mg = sg / lit, mb = sb / lit;
    if (!(mg > mr + 8 && mg > mb + 8)) continue;          // grey: a rock
    if ((x1 - x0 + 1) / (y1 - y0 + 1) < 0.85) continue;   // tall: a reed clump
    // A pad carrying a white bloom is skipped entirely. A frog sitting on one
    // covers the flower, and jumping away uncovers it — which looks for all the
    // world like the frog left something behind on the pad. Flowered pads
    // measure 19-29% pale against 1.4% or less for every other pad, so the two
    // are not close.
    if (pale / lit > 0.06) continue;
    pads.push({ x: (sumX / n) * (worldW / w), y: (sumY / n) * (worldH / h), area: n });
  }
  // Biggest first, then thinned so no two sites are within PAD_APART: pads grow
  // in clusters of three or four, and a frog on each of them reads as an
  // infestation rather than as one frog sitting on a lily pad.
  //
  // Each site keeps its cluster-mates, because that is where its frog jumps to.
  // Landing is then guaranteed to be on a pad without testing anything at jump
  // time — the frog can only ever be sent somewhere already known to be one.
  pads.sort((a, b) => b.area - a.area);
  let sites = [];
  for (const p of pads) {
    if (sites.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < PAD_APART)) continue;
    sites.push(p);
  }
  info._artPads = pads.slice();
  if (artOnly) return info._artPads;

  // Fold in the extra pads scattered on open water, then redo the
  // thinning over the union — that is what widens the frogs' range, because the
  // clusters they hop around are built from this list.
  const extra = pondPads(info, worldW, worldH)
    .filter((p) => p.frogOk)
    .map((p) => ({ x: p.x, y: p.y, area: 140 }));
  pads = pads.concat(extra);
  sites.length = 0;
  for (const p of pads) {
    if (sites.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < PAD_APART)) continue;
    sites.push(p);
  }

  for (const site of sites) {
    site.cluster = pads.filter((p) => Math.hypot(p.x - site.x, p.y - site.y) < PAD_APART);
    // Ordered as a nearest-neighbour chain from the frog's own pad, not simply
    // sorted by distance from it. The frog visits them in order, so what has to
    // be short is each STEP — and sorting by distance from the site leaves two
    // consecutive pads on opposite sides of it, which measured a 66-unit leap
    // across open water. Chaining bounds every hop by the gap to the nearest
    // pad not yet used, which inside a clump is a short hop.
    const rest = site.cluster.filter((p) => p !== site);
    const chain = [site];
    let at = site;
    while (rest.length && chain.length < FROG_HOP_PADS) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < rest.length; k++) {
        const d = Math.hypot(rest[k].x - at.x, rest[k].y - at.y);
        if (d < bd) { bd = d; best = k; }
      }
      if (bd > FROG_HOP_MAX) break;
      at = rest.splice(best, 1)[0];
      chain.push(at);
    }
    site.cluster = chain;
  }
  // A site whose chain came out a single pad has nowhere to hop to — an
  // isolated pad too far from any other for a short jump. Those get no frog:
  // one that sits still forever is duller than one fewer frog, and there are
  // plenty of sites to choose from.
  info._lilyPads = sites.filter((s) => s.cluster.length >= 2);
  return info._lilyPads;
}

/**
 * Frogs sitting out on the lily pads: breathing, blinking, glancing about,
 * puffing a throat out to croak, and now and then a hop on the spot.
 *
 * Nothing here moves between pads, so — unlike the ducks — there is no path to
 * follow and no spacing to hold. Each frog is pinned to its pad and only its
 * animation changes, which is the smoothest thing on the water by construction.
 */
export function drawFrogs(g, info, left, top, worldW, worldH, t, count = 10) {
  if (!info || !FROG_READY) return;
  const sites = lilyPads(info, worldW, worldH);

  for (let i = 0; i < Math.min(count, sites.length); i++) {
    const pad = sites[i];
    // A frog on every chosen pad would still be too many; skip some, stably.
    if (hash(i * 31.7 + 811) < 0.25) continue;

    // Which pad it is on, and whether it is between two of them. The frog works
    // its way round its cluster, one pad per JUMP_EVERY, so where it sits is a
    // function of time alone — there is no state to drift and no landing test
    // to fail, because every destination came out of the pad list.
    const cl = pad.cluster && pad.cluster.length > 1 ? pad.cluster : [pad];
    const leg = Math.floor(t / JUMP_EVERY + i * 0.37);
    const from = cl[((leg % cl.length) + cl.length) % cl.length];
    const to = cl[(((leg + 1) % cl.length) + cl.length) % cl.length];
    const intoLeg = (t + i * 0.37 * JUMP_EVERY) % JUMP_EVERY;
    const JUMP_ANIM = FROG_ANIM.jump;
    const jumpDur = (JUMP_ANIM.frames.length * JUMP_ANIM.ms) / 1000;

    let anim = null, frameIdx = null;
    let fx = from.x, fy = from.y, airborne = false;
    if (cl.length > 1 && intoLeg < jumpDur) {
      // In flight: straight line across, with a parabola lifting it off the
      // water. Both ends land exactly on a pad centre, so the moment it takes
      // off and the moment it arrives are continuous with sitting still.
      const u = intoLeg / jumpDur;
      fx = from.x + (to.x - from.x) * u;
      fy = from.y + (to.y - from.y) * u - JUMP_ARC * 4 * u * (1 - u);
      anim = JUMP_ANIM;
      frameIdx = Math.min(JUMP_ANIM.frames.length - 1, Math.floor(intoLeg * 1000 / JUMP_ANIM.ms));
      airborne = true;
    } else {
      // Sitting on `to` for the rest of the leg — the pad it just arrived at.
      if (cl.length > 1) { fx = to.x; fy = to.y; }
      const beat = Math.floor(t / FROG_BEAT + i * 0.41);
      const roll = hash(i * 19.3 + beat * 4.7 + 820);
      const into = (t + i * 0.41 * FROG_BEAT) % FROG_BEAT;
      // No in-place hop here: there is a real jump between pads now, and the
      // small-hop cycle's airborne frame anchors on its trailing legs, which
      // slid a sitting frog sideways by 1.5 units in a single frame.
      const one = roll > 0.78 ? 'croak' : roll > 0.48 ? 'look'
        : roll > 0.22 ? 'blink' : null;
      if (one) {
        const a = FROG_ANIM[one];
        if (into < (a.frames.length * a.ms) / 1000) {
          anim = a;
          frameIdx = Math.min(a.frames.length - 1, Math.floor(into * 1000 / a.ms));
        }
      }
      if (!anim) {
        anim = FROG_ANIM.idle;
        frameIdx = Math.floor((t * 1000 / anim.ms) + i * 2) % anim.frames.length;
      }
    }

    const f = anim.frames[frameIdx];
    const dw = Math.max(1, Math.round(f[2] * FROG_SCALE));
    const dh = Math.max(1, Math.round(f[3] * FROG_SCALE));
    // Anchored on the frog's FEET (f[4]), not on the middle of the frame box
    // and not on the whole body either. The boxes are tight crops that breathe
    // from frame to frame, so centring on them slid the sprite a whole pixel
    // sideways 1.3 times a second — a visible twitch at this size. Anchoring
    // on the body centroid was worse (1.7/s): the centroid genuinely travels
    // when a throat inflates or a head lifts, so it fought the animation.
    // The feet stay put, which is the thing actually resting on the pad — at
    // this scale idle, blink and look now round to a constant offset, and only
    // the hop and the croak shift, which is the art doing what it should.
    // Mirrored frogs measure the same anchor from the OTHER side of the source
    // frame, rather than subtracting it from the rounded destination width —
    // that width changes with the tight crop, so deriving the flipped anchor
    // from it put the sideways twitch straight back on every mirrored frog.
    const ax = Math.round(left + fx), ay = Math.round(top + fy + FROG_SIT);
    // Facing is fixed for the whole leg — the way this jump goes — so the frog
    // turns as it launches and then holds that side while it sits. Reading it
    // per-phase instead popped the facing at every takeoff and landing, 66
    // times in two minutes.
    const flip = cl.length > 1 ? to.x > from.x : hash(i * 7.1 + 44) > 0.5;
    const srcOff = flip
      ? (anim.anchorR != null ? anim.anchorR : f[2] - f[4])
      : (anim.anchorL != null ? anim.anchorL : f[4]);
    const off = Math.round(srcOff * FROG_SCALE);
    const dx = ax - off;
    const dy = ay - dh;

    g.save();
    g.imageSmoothingEnabled = false;
    // sheet frogs face left; mirror the ones that should look the other way.
    // Fixed per frog, so none of them ever turns on the spot.
    if (flip) {
      g.translate(dx + dw, dy);
      g.scale(-1, 1);
      g.drawImage(FROG_ART, f[0], f[1], f[2], f[3], 0, 0, dw, dh);
    } else {
      g.drawImage(FROG_ART, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
    }
    g.restore();
  }
}

// ------------------------------------------------------------- lily pads
// Extra lily pads scattered on the open water from assets/pond vegg.png — the
// sheet's alpha is genuine, so nothing needed matting. These are what give the
// frogs somewhere further to jump: lilyPads() folds them in with the pads the
// pond art already paints, and the clusters the frogs do the rounds of are
// built from that combined list.
//
// The rest of that sheet — bank planting, ferns, blooms — was tried and taken
// back out: drawn flat in the ground pass it read as stickers laid on the
// shore rather than as plants growing there. Making it work wants the tall
// pieces depth-sorted with the player, which is a change to the scene's entity
// list rather than to this file.
const VEG_ART = new Image();
let VEG_READY = false;
VEG_ART.onload = () => { VEG_READY = true; };
VEG_ART.src = 'assets/pond vegg.png';

// Single pads and clumps of them. Only the singles are offered to frogs: a
// frog sits at the centre of what it lands on, and the centre of a three-pad
// sprite is the water between them.
const VEG_PAD_ONE = [[628, 108, 59, 38], [748, 95, 78, 56], [849, 56, 134, 103]];
const VEG_PAD_CLUSTER = [[998, 86, 120, 69], [1131, 84, 76, 79], [1221, 51, 149, 133]];

const VEG_SCALE = 0.105;    // source px -> world units (a big pad reads ~14 units)
const VEG_PAD_GROUPS = 5;   // clumps of pads to seed on open water
const PAD_GROUP_ROOM = 34;  // clear water a whole clump needs
const PAD_GROUP_APART = 78; // and how far one clump keeps from another
const PAD_CLEAR = 9;        // open water a single new pad needs around it
const PAD_MIN_GAP = 26;     // and how far it keeps from any other pad

// Where the extra pads go. Chosen once and cached: it depends only on the art.
function pondPads(info, worldW, worldH) {
  if (info._pondPads) return info._pondPads;
  const pads = [];
  const art = lilyPads(info, worldW, worldH, true);   // the pads already painted in
  const farFromPads = (x, y, gap) =>
    !art.some((p) => Math.hypot(p.x - x, p.y - y) < gap)
    && !pads.some((p) => Math.hypot(p.x - x, p.y - y) < gap);

  // Pads go down in CLUMPS, not scattered evenly. Spreading them out looks fine
  // but is useless to a frog: it leaves isolated pads with no neighbour inside
  // hopping distance, and three of the frogs ended up with nowhere to jump at
  // all. A seeded clump a short hop apart is what widens their range, and it is
  // also how lily pads grow.
  for (let grp = 0; grp < VEG_PAD_GROUPS; grp++) {
    let seed = null;
    for (let tries = 0; tries < 300 && !seed; tries++) {
      const x = 30 + hash(grp * 12.9 + tries * 3.1 + 900) * (worldW - 60);
      const y = 30 + hash(grp * 27.7 + tries * 5.3 + 901) * (worldH - 60);
      if (!hasClearWater(info, worldW, worldH, x, y, PAD_GROUP_ROOM)) continue;
      if (!farFromPads(x, y, PAD_GROUP_APART)) continue;
      seed = { x, y };
    }
    if (!seed) continue;
    const n = 3 + Math.floor(hash(grp * 4.7 + 904) * 3);   // 3-5 pads to a clump
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 90; tries++) {
        const a = hash(grp * 6.1 + k * 9.3 + tries * 2.7 + 905) * Math.PI * 2;
        const r = 15 + hash(grp * 8.9 + k * 5.1 + tries * 3.9 + 906) * 20;
        const x = seed.x + Math.cos(a) * r, y = seed.y + Math.sin(a) * r;
        if (!hasClearWater(info, worldW, worldH, x, y, PAD_CLEAR)) continue;
        if (!farFromPads(x, y, PAD_MIN_GAP)) continue;
        const single = hash(grp * 5.5 + k * 7.7 + 907) < 0.75;
        const set = single ? VEG_PAD_ONE : VEG_PAD_CLUSTER;
        pads.push({ x, y, frogOk: single,
          frame: set[Math.floor(hash(grp * 8.1 + k * 3.3 + 908) * set.length) % set.length] });
        break;
      }
    }
  }
  info._pondPads = pads;
  return pads;
}

/**
 * The extra lily pads, flat on the water. Draw straight after the pond art and
 * before anything living, so the fish, ducks and frogs are all on top of them.
 */
export function drawPondPads(g, info, left, top, worldW, worldH) {
  if (!info || !VEG_READY) return;
  g.save();
  g.imageSmoothingEnabled = false;
  for (const p of pondPads(info, worldW, worldH)) {
    const f = p.frame;
    const w = Math.max(1, Math.round(f[2] * VEG_SCALE));
    const h = Math.max(1, Math.round(f[3] * VEG_SCALE));
    g.drawImage(VEG_ART, f[0], f[1], f[2], f[3],
      Math.round(left + p.x - w / 2), Math.round(top + p.y - h / 2), w, h);
  }
  g.restore();
}
