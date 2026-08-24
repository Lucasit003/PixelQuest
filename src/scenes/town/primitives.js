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
const SWAY_RULES = [
  // fabric — the most visibly mobile thing in a town, and genuinely limp
  [/^(banner|flag|clothes_line|laundry_line|awning)/,               4.5, 1.35, 5],
  // fine grasses and reeds — small, fast, whole-blade motion
  [/^(grass_|wetgrass|rockgrass|nv_tallgrass|nv_weeds|weeds_|cattail|reed|waterleaf|fernbank|fern_)/,
                                                                    2.2, 1.15, 4],
  // flowers and soft leafy fill
  [/^(flower|grass_bloom|leafplant|mushroom|myst_flower)/,           1.8, 1.25, 4],
  // shrubs — moderate, mass near the ground
  [/^(bush|nv_bush|myst_bush|topiary|hedge)/,                        2.0, 1.80, 4],
  // crops sway, but they are planted and heavy-headed
  [/^(crop_|wheat)/,                                                 1.8, 1.40, 4],
  // trees — trunk essentially rigid, crown carries the motion
  [/^(tree_|deciduous_tree|pine_tree|myst_tree|mystic_tree|tree_sapling)/,
                                                                     3.2, 2.60, 6],
];

// The town's decor loop is not camera-culled — it draws all ~2,100 props every
// frame and lets the browser clip the ones outside the canvas. That is cheap for
// a single blit and NOT cheap for a banded one, and ~1,500 of those props are
// flexible while only a couple of dozen are ever on screen.
//
// So the sway path asks whether a prop is actually visible before paying for it.
// The canvas transform IS the camera, and it is identical for every prop in a
// frame, so it is read once per frame and cached rather than per prop.
let _tf = null, _tfAt = -1;
function visible(g, x, y, w, h, t) {
  if (_tf === null || t - _tfAt > 0.004 || t < _tfAt) { _tf = g.getTransform(); _tfAt = t; }
  const m = _tf;
  const sx = m.a * x + m.e, sy = m.d * y + m.f;
  const hw = (w / 2) * m.a + 8, hh = h * m.d + 8;
  return sx + hw > 0 && sx - hw < g.canvas.width && sy + hh > 0 && sy - h * m.d - hh < g.canvas.height;
}

/** The sway profile for a prop name, or null if it must stay rigid. */
export function swayFor(name) {
  if (!name) return null;
  for (const [re, amp, curve, bands] of SWAY_RULES) {
    if (re.test(name)) return { amp, curve, bands };
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
  // shadowRx 0 skips the shadow entirely — used by compound-style art
  // (Watch, Sanctuary, Cottage, Gate) whose PNGs include their own ground.
  if (shadowRx > 0) contactShadow(g, x, y, shadowRx, Math.max(2, shadowRx * 0.4), 0.22);
  if (!art.ready) return;

  // Flexible props bend; everything else takes the original single-blit path
  // unchanged. `t` is only supplied by the scene's per-frame draw, so any caller
  // that does not pass it also stays on the fast path.
  if (art.sway) {
    const now = t === null ? worldTime() : t;
    if (visible(g, x, y, w, h, now)) { drawSwayed(g, art, x, y, w, h, flip, now); return; }
    // off screen: fall through to the ordinary blit, which the browser clips
  }

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
function drawSwayed(g, art, x, y, w, h, flip, t) {
  const { amp, curve } = art.sway;
  // Taller things swing further in absolute pixels, but the response is damped
  // so a 60px tree does not travel three times as far as a 20px shrub.
  // windAt spans about -1.45..1.45; normalising it here means `amp` is read
  // directly in pixels. Height is a gentle modifier, not a multiplier — a tall
  // tree should lean a little further than a shrub, not three times as far.
  const w01 = windAt(x, y, t) / 1.45;
  const heightScale = 0.78 + Math.min(0.45, h / 150);
  const wind = w01 * amp * heightScale;

  // Two early-outs that carry almost all of this feature's performance.
  //
  // The lean is only ever a couple of pixels at this art scale, and for much of
  // the gust cycle it rounds to nothing at all. When the top band would not
  // move a whole pixel there is no bend to draw, so the prop takes the ordinary
  // single blit — which at any moment is most of them.
  const peak = Math.abs(wind);
  if (peak < 0.5) {
    if (flip) {
      g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1);
      g.drawImage(art.img, Math.round(-w / 2), Math.round(y - h), w, h);
      g.restore();
    } else {
      g.drawImage(art.img, Math.round(x - w / 2), Math.round(y - h), w, h);
    }
    return;
  }
  // Bands are spent in proportion to the travel available. Slicing a sprite six
  // ways to express two pixels of bend buys nothing but draw calls, so the count
  // scales with the lean and is capped by the category's own maximum.
  // Also capped by the sprite's own height: a 12px grass tuft has nowhere to
  // put five slices, and two reads identically for a fraction of the cost.
  const bands = Math.max(2, Math.min(art.sway.bands,
                                     Math.round(peak) + 2,
                                     Math.round(h / 12) + 1));

  const left = Math.round(x - w / 2);
  const top = Math.round(y - h);
  const srcH = art.img.naturalHeight || h;
  const srcW = art.img.naturalWidth || w;

  if (flip) { g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1); }

  for (let i = 0; i < bands; i++) {
    // destination rows for this band, contiguous so no gap can open between them
    const y0 = Math.round((i * h) / bands);
    const y1 = Math.round(((i + 1) * h) / bands);
    const bh = y1 - y0;
    if (bh <= 0) continue;

    // u = height of this band's MIDDLE above the base, 0 at the ground, 1 at the
    // top. pow(u, curve) is what keeps a trunk still while its crown moves.
    const u = 1 - (y0 + bh / 2) / h;
    const dx = i === bands - 1 ? 0 : Math.round(wind * Math.pow(u, curve));

    // matching source rows
    const sy0 = Math.round((y0 * srcH) / h);
    const sy1 = Math.round((y1 * srcH) / h);
    const sh = Math.max(1, sy1 - sy0);

    // In the mirrored frame the x axis is reversed, so the offset is negated to
    // keep the wind blowing the same way in WORLD space for flipped props.
    const ox = flip ? -dx : dx;
    const dxLeft = flip ? Math.round(-w / 2) + ox : left + ox;
    g.drawImage(art.img, 0, sy0, srcW, sh, dxLeft, top + y0, w, bh);
  }

  if (flip) g.restore();
}
