// Drawing primitives and sprite blitting shared across the town modules.
//
// These live here because more than one subsystem needs them, not as a dumping
// ground: `hash` is the deterministic jitter the whole map is scattered with
// (129 call sites in the original town.js), and `fillEllipse` is the
// pixel-accurate ellipse the canvas arc() path cannot give at this resolution.

// Deterministic pseudo-random in [0,1). The map's jitter has to survive a
// reload — anything scattered with Math.random moves every time the scene is
// rebuilt, which makes a layout impossible to iterate on.
export function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }

// Math.random-backed, for per-frame effects that should NOT be stable.
export function rand2(a, b) { return a + Math.random() * (b - a); }

// Filled ellipse drawn as scanline rects. The canvas arc() path antialiases,
// which at 480x270 puts grey fringe pixels on a shape that has to read as
// solid pixel art.
export function fillEllipse(g, cx, cy, rx, ry, color) {
  cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(1, rx); ry = Math.max(1, ry);
  g.fillStyle = color;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    if (w <= 0) continue;
    g.fillRect(cx - w, cy + y, w * 2, 1);
  }
}


// ---- world wind -------------------------------------------------------------
// ONE deterministic field that the whole world shares. Vegetation standing near
// each other must lean together — a gust passing through the map is what reads
// as wind; every plant wobbling on its own private timer reads as jelly.
//
// Two travelling waves are summed. Their frequencies are not whole multiples of
// each other, so they never re-align into a rhythmic pulse, and each carries a
// SPATIAL phase term, which is what makes the wave travel across the map rather
// than the whole map breathing in unison.
//
// A third very slow envelope raises and lowers the strength, so the world gets
// occasional stronger gusts and quiet moments instead of a constant sway.
//
// Deterministic by construction: a given (x, y, t) always returns the same
// value. No Math.random, no per-frame state. This is exported on its own so
// chimney smoke, leaves, flags and weather can later ride the SAME field and
// agree with the vegetation about which way the wind is blowing.
const WIND = {
  a1: 1.00, f1: 0.83, k1: 0.0130,   // broad slow swell
  a2: 0.42, f2: 2.17, k2: 0.0520,   // faster local ripple (irrational-ish ratio)
  gustBase: 0.52, gustAmp: 0.48, gustF: 0.11, gustK: 0.0055,
};

// The wind's own clock. drawPropArt takes an explicit `t` when a caller has a
// scene clock to hand, and otherwise falls back to this — which is what lets the
// effect work without editing a single call site. Under the screenshot harness
// performance.now() is stubbed to a constant, so captures stay byte-stable.
export function worldTime() {
  return (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
}

/** Signed wind at a world point, roughly -1.6..+1.6. Positive blows east. */
export function windAt(x, y, t) {
  const p1 = (x + y * 0.35) * WIND.k1;
  const p2 = (x * 0.80 - y * 0.50) * WIND.k2;
  const wave = WIND.a1 * Math.sin(t * WIND.f1 + p1)
             + WIND.a2 * Math.sin(t * WIND.f2 + p2);
  const gust = WIND.gustBase
             + WIND.gustAmp * (0.5 + 0.5 * Math.sin(t * WIND.gustF + x * WIND.gustK));
  return wave * gust;
}

// ---- who bends --------------------------------------------------------------
// Conservative allowlist, matched ONCE per art file at load. Anything not listed
// stays perfectly rigid and keeps the single-drawImage fast path. If a prop is
// questionable it is absent from this table on purpose — a swaying barrel looks
// far worse than a still one.
//
//   amp    PEAK sideways travel of the very top of the sprite, in PIXELS, at
//          full gust. Expressing it in pixels rather than an abstract factor is
//          what makes this tunable: at 480x270 anything under ~1px simply never
//          renders, and the first calibration sat at 0.2-0.7px so most props
//          never moved at all.
//   curve  how the lean is distributed up the sprite. 1 is nearly linear (a
//          grass blade leans along its whole length); 3 keeps the base rigid
//          and moves only the crown (a tree trunk does not bend, its canopy
//          does). This is what stops big trees looking rubbery.
//   bands  slices used. More is smoother but costs more draw calls.
// Only bushes and small plants move. Everything else in a town reads as
// structure — a tree's mass, a banner's fixings — and eye-level foliage is
// where wind is legible anyway. Amplitude is the PEAK PIXEL travel of the
// sprite's top; the base never moves.
const SWAY_RULES = [
  // fine grasses, reeds and ferns — the fastest, loosest things on the map
  [/^(grass_|wetgrass|rockgrass|nv_tallgrass|nv_weeds|weeds_|cattail|reed|waterleaf|fernbank|fern_)/, 2.2],
  // flowers and soft leafy fill
  [/^(flower|grass_bloom|leafplant|mushroom|myst_flower)/,                                            1.8],
  // shrubs — heavier, so they lean less for the same gust
  [/^(bush|nv_bush|myst_bush|topiary|hedge)/,                                                         1.5],
  // crops are small planted stems too, and a moving field sells the farm
  [/^(crop_|wheat)/,                                                                                  1.8],
];

// ---- camera culling ---------------------------------------------------------
// The town's decor loop hands every prop to the renderer each frame — about
// 2,100 of them — and lets the browser clip whatever lands outside the canvas.
// At a typical camera roughly 26 are actually on screen, so ~99% of the
// rasterisation work is spent on sprites nobody can see.
//
// The test has to use the prop's REAL visual box, not its anchor. Props are
// bottom-centre anchored, so the art extends a full sprite height ABOVE y —
// mystic_tree_grand reaches 200 units up — and contactShadow pushes the box
// right and down past the anchor as well. Culling on the anchor point alone
// would pop the tallest trees out while they were still half on screen.
//
//   left   x - w/2
//   right  x + max(w/2, shadowRx * 1.28)      shadow is offset +0.28rx and ±rx
//   top    y - h
//   bottom y + 1 + max(2, shadowRx * 0.4)     shadow ry
//
// SWAY_MARGIN covers the few pixels the wind moves a sprite's top, so foliage
// leaning at the edge of the screen cannot be clipped mid-lean. EDGE_MARGIN is
// deliberate slack on top of exact bounds — this is an optimisation, and being
// generous costs a handful of extra draws while being tight costs correctness.
const SWAY_MARGIN = 8;
const EDGE_MARGIN = 16;

// The transform is read fresh for every prop, deliberately. Caching it on a
// short timer was measurably wrong: the night pass installs its own transform
// with setTransform, and a cached entry could survive into the next frame and
// be used to cull against the WRONG camera — 384 stale pixels at the plaza at
// night, invisible by day. getTransform is cheap next to the thousands of
// rasterisations this test removes.
function camera(g) {
  return g.getTransform ? g.getTransform() : null;
}

/** True if any part of this prop's art or shadow can land on the canvas. */
export function propVisible(g, x, y, w, h, shadowRx = 0) {
  // Dev hook, same family as __townDebug / __townZoom / __townNight: turning
  // culling off must produce a pixel-identical frame, which is how the bounds
  // maths above is actually verified rather than assumed.
  if (typeof window !== 'undefined' && window.__noCull) return true;
  const m = camera(g);
  if (!m || !m.a) return true;                 // unknown transform: never cull
  const shR = shadowRx > 0 ? shadowRx : 0;
  const left   = x - w / 2 - SWAY_MARGIN - EDGE_MARGIN;
  const right  = x + Math.max(w / 2, shR * 1.28) + SWAY_MARGIN + EDGE_MARGIN;
  const top    = y - h - SWAY_MARGIN - EDGE_MARGIN;
  const bottom = y + 1 + Math.max(2, shR * 0.4) + EDGE_MARGIN;
  // world -> screen. The camera is scale + translate only, so this is exact.
  const sl = m.a * left + m.e, sr = m.a * right + m.e;
  const st = m.d * top + m.f,  sb = m.d * bottom + m.f;
  return sr > 0 && sl < g.canvas.width && sb > 0 && st < g.canvas.height;
}

/** The sway profile for a prop name, or null if it must stay rigid. */
export function swayFor(name) {
  if (!name) return null;
  for (const [re, amp] of SWAY_RULES) {
    if (re.test(name)) return { amp };
  }
  return null;
}

// ---- sprite art -----------------------------------------------------------
// Every PNG in the town loads through this and is held as a { img, ready }
// pair rather than a bare Image, so a draw can skip art that has not decoded
// yet instead of blitting a blank rectangle.
// Building artwork (real transparent PNGs), same load/draw pattern as the
// Potion Shop above. Each authored to the game's native footprint.
export function loadBuildingArt(src) {
  const img = new Image();
  // The prop's name is recovered from its own path so drawPropArt can tell a
  // grass tuft from a crate without every call site having to pass it — and
  // the regex test runs once per FILE here, never per prop per frame.
  const name = (src.split('/').pop() || '').replace(/\.[a-z]+$/i, '');
  const state = { img, ready: false, name, sway: swayFor(name) };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}

// Imaginary sunlight from the upper-left: contact shadows fall to the
// lower-right. One helper so every grounded object casts a consistent shadow.
export function contactShadow(g, cx, by, rx, ry, alpha = 0.32) {
  cx = Math.round(cx + rx * 0.28); by = Math.round(by + 1); // offset toward lower-right
  rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
  g.fillStyle = `rgba(20,26,16,${alpha})`;
  for (let y = -ry; y <= ry; y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    if (w <= 0) continue;
    g.fillRect(cx - w, by + y, w * 2, 1);
  }
}

// Generic bottom-anchored prop sprite (lamp posts etc): same load/draw
// pattern as the buildings, just smaller. `flip` mirrors the art
// horizontally so a prop on the right of a path reads as facing inward
// (toward the centerline) the same way its left-side twin naturally does.
export function drawPropArt(g, art, x, y, w, h, shadowRx, flip = false, t = null) {
  // Off-camera props cost nothing beyond this test. The shadow is inside the
  // same test as the sprite so the two can never be culled independently and
  // leave a shadow floating without its object.
  if (!propVisible(g, x, y, w, h, shadowRx)) return;

  // shadowRx 0 skips the shadow entirely — used by compound-style art
  // (Watch, Sanctuary, Cottage, Gate) whose PNGs include their own ground.
  if (shadowRx > 0) contactShadow(g, x, y, shadowRx, Math.max(2, shadowRx * 0.4), 0.22);
  if (!art.ready) return;

  // Flexible props bend; everything else takes the original single-blit path
  // unchanged. `t` is only supplied by the scene's per-frame draw, so any caller
  // that does not pass it also stays on the fast path.
  if (art.sway) { drawSwayed(g, art, x, y, w, h, flip, t === null ? worldTime() : t); return; }

  if (flip) {
    g.save();
    g.translate(Math.round(x), 0);
    g.scale(-1, 1);
    g.drawImage(art.img, Math.round(-w / 2), Math.round(y - h), w, h);
    g.restore();
  } else {
    g.drawImage(art.img, Math.round(x - w / 2), Math.round(y - h), w, h);
  }
}

/**
 * Draw a flexible prop as horizontal bands, each offset further than the one
 * below it, so the sprite BENDS instead of sliding.
 *
 * The bottom band is pinned: its offset is forced to zero regardless of wind, so
 * the prop stays planted exactly where placement put it. Nothing about the
 * prop's world position, footprint, collision or sort key is touched — this only
 * changes how its pixels are rasterised.
 */
// A plant bends by shearing the frame it is drawn in, not by slicing it up.
//
// This replaces a banded version that cut the sprite into 2-6 horizontal strips
// and offset each one as a block. On art this small that reads as the top half
// moving, then the bottom half — the steps are as tall as the thing that is
// supposed to be bending. A shear gives every PIXEL ROW its own offset, so the
// plant leans as one continuous body, and it costs a single drawImage instead
// of three to six.
//
// The local frame puts the origin at the base centre, so the sprite occupies
// y = -h..0. A shear maps x -> x + c*y, which leaves y = 0 untouched — the
// plant stays rooted exactly where it stands — and displaces the top by -c*h.
// Wanting the top to travel `wind` gives c = -wind / h.
//
// Mirrored props take the opposite shear: g.scale(-1, 1) reverses the local x
// axis, so reusing the sign would blow them upwind of their neighbours.
function drawSwayed(g, art, x, y, w, h, flip, t) {
  // windAt spans about -1.45..1.45, so normalising lets `amp` be read straight
  // off in pixels. Height is a gentle modifier, not a multiplier — a tall reed
  // leans a little further than a low shrub, not three times as far.
  const w01 = windAt(x, y, t) / 1.45;
  const wind = w01 * art.sway.amp * (0.78 + Math.min(0.45, h / 150));

  const bx = Math.round(x);
  const top = Math.round(y - h);
  const left = Math.round(-w / 2);

  // For much of the gust cycle the lean is under half a pixel, and with
  // smoothing off every row then samples exactly where it would have anyway.
  // Those props take the ordinary blit and skip the transform entirely, which
  // at any given moment is most of them.
  if (Math.abs(wind) < 0.35) {
    if (flip) {
      g.save(); g.translate(bx, 0); g.scale(-1, 1);
      g.drawImage(art.img, left, top, w, h);
      g.restore();
    } else {
      g.drawImage(art.img, Math.round(x - w / 2), top, w, h);
    }
    return;
  }

  g.save();
  g.translate(bx, Math.round(y));
  if (flip) g.scale(-1, 1);
  g.transform(1, 0, (flip ? wind : -wind) / h, 1, 0, 0);
  g.drawImage(art.img, left, -h, w, h);
  g.restore();
}
