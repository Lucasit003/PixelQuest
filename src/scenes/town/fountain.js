// The Crystal Plaza fountain: the town's one hero set-piece.
//
// It is a composite, not a single sprite. An authored PNG supplies the stone,
// and everything that moves — falling streams, ripple rings, surface
// highlights, the rune arc, the crystal pulse and the motes — is drawn
// procedurally on top, masked to the water the artwork actually contains.
// FOUNTAIN_MASK is built once from the PNG's own pixels, so the effects cannot
// spill onto the stone rim no matter how the art is later recropped.
//
// fountainCrystal/stoneTier/crystalShape at the bottom are the older, fully
// procedural fountain, still used where no authored art is placed.

import { rect, disc, clamp, clamp01, lerp } from '../../gfx/pixel.js';
import { hash, fillEllipse, contactShadow } from './primitives.js';

// Crystal Plaza fountain artwork (real transparent PNG).
const FOUNTAIN_IMG = new Image();
let FOUNTAIN_READY = false;
FOUNTAIN_IMG.onload = () => { FOUNTAIN_READY = true; };
FOUNTAIN_IMG.src = 'assets/fountain.png';
const FOUNTAIN_W = 111, FOUNTAIN_H = 100; // world units (new rounder art, cropped to its content bbox; +8%)

// Stone ring/roundabout that surrounds the fountain, cropped square from the
// authored roundabout art (source arms trimmed off — the game's own roads
// meet the plaza edge instead). Drawn beneath the fountain, centered on the
// plaza focus point.
const RING_IMG = new Image();
let RING_READY = false;
RING_IMG.onload = () => { RING_READY = true; };
RING_IMG.src = 'assets/fountain_ring.png';
// Measured from the source crop (540x540): the opaque ring band runs from
// pixel-radius 175 (inner hole) to 261 (outer edge).
const RING_SRC_HALF = 270, RING_SRC_OUTER = 261;

// The Crystal Plaza fountain — rendered from the authored transparent PNG.
// Anchored bottom-centre on the plaza with only a very subtle contact shadow
// beneath the stone base (the crystal glow/sparkles are separate particles).
function drawFountainSprite(g, cx, baseY, t, ringRadius) {
  // Ring removed (per direction) — fountain sits directly on the plaza
  // paving now, no stone ring drawn beneath it.
  contactShadow(g, cx, baseY, FOUNTAIN_W * 0.30, 3, 0.22); // tiny, base-only
  if (!FOUNTAIN_READY) return;
  g.drawImage(FOUNTAIN_IMG, Math.round(cx - FOUNTAIN_W / 2), Math.round(baseY - FOUNTAIN_H), FOUNTAIN_W, FOUNTAIN_H);
  drawFountainFX(g, cx, baseY, t);
}

// ---- Crystal Fountain animation overlay ------------------------------
// Pure-t procedural FX layered on top of the static fountain PNG — never
// touches the artwork, collision, Y-sort, or interaction. Basin/crystal
// geometry below is measured from the source art (494x445 px, drawn at
// FOUNTAIN_W x FOUNTAIN_H) and expressed as offsets from (cx, baseY).
const FX_BASIN = { cx: 0, cy: -46, rx: 28, ry: 22 };   // water ellipse

// Pixel-exact water mask sampled from the fountain art itself, so ripple and
// shimmer dots can only ever land on real water pixels — never on the stone
// arms, pedestal, rim, or crystal that sit inside the basin's bounding ellipse.
let FOUNTAIN_MASK = null, FOUNTAIN_MASK_W = 0, FOUNTAIN_MASK_H = 0;
function buildFountainMask() {
  if (FOUNTAIN_MASK || !FOUNTAIN_READY) return;
  const c = document.createElement('canvas');
  FOUNTAIN_MASK_W = FOUNTAIN_IMG.naturalWidth;
  FOUNTAIN_MASK_H = FOUNTAIN_IMG.naturalHeight;
  c.width = FOUNTAIN_MASK_W; c.height = FOUNTAIN_MASK_H;
  const mg = c.getContext('2d');
  mg.drawImage(FOUNTAIN_IMG, 0, 0);
  const d = mg.getImageData(0, 0, FOUNTAIN_MASK_W, FOUNTAIN_MASK_H).data;
  FOUNTAIN_MASK = new Uint8Array(FOUNTAIN_MASK_W * FOUNTAIN_MASK_H);
  for (let i = 0; i < FOUNTAIN_MASK.length; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    if (a > 150 && b > r + 15 && b > 70 && gr < 200 && gr < b + 15) FOUNTAIN_MASK[i] = 1;
  }
}
// dx/dy are world-unit offsets from the fountain anchor (cx, baseY).
function fountainWaterAt(dx, dy) {
  if (!FOUNTAIN_MASK) return false;
  const sx = Math.round((dx + FOUNTAIN_W / 2) * (FOUNTAIN_MASK_W / FOUNTAIN_W));
  const sy = Math.round((dy + FOUNTAIN_H) * (FOUNTAIN_MASK_H / FOUNTAIN_H));
  if (sx < 0 || sy < 0 || sx >= FOUNTAIN_MASK_W || sy >= FOUNTAIN_MASK_H) return false;
  return FOUNTAIN_MASK[sy * FOUNTAIN_MASK_W + sx] === 1;
}
const FX_CRYSTAL = { cx: 0, cy: -66, rx: 12, ry: 14 };  // main crystal silhouette
// The new art is a still round pool with no visible cascades (unlike the old
// wide-oval fountain), so there's nothing for the stream-churn overlay to
// anchor to — left empty rather than drawing dots at stale coordinates.
const FX_FALLS = [];
const FX_RUNE_ARC = { cx: 0, cy: -30, rx: 20, y: -30, count: 6 }; // pedestal rune row

function drawFountainFX(g, cx, baseY, t) {
  buildFountainMask();
  g.save();
  fxRipples(g, cx, baseY, t);
  fxStreams(g, cx, baseY, t);
  fxHighlights(g, cx, baseY, t);
  fxRunes(g, cx, baseY, t);
  fxCrystalPulse(g, cx, baseY, t);
  fxMotes(g, cx, baseY, t);
  g.restore();
}

// 1. Water ripples: small -> expand -> fade, staggered, looping. Spawn points
// are rejection-sampled against the water mask (a few hash-salted tries per
// loop), and each ring dot is masked too, so nothing ever lands on stone.
function fxRipples(g, cx, baseY, t) {
  const N = 4;
  const mask = (x, y) => fountainWaterAt(x - cx, y - baseY);
  for (let i = 0; i < N; i++) {
    const period = 1.5 + i * 0.13; // ~1.5s loop per spec, slight desync
    const loop = Math.floor((t + i * 5.1) / period);
    const phase = ((t + i * 5.1) % period) / period; // 0..1
    // quantize to 6 discrete frames so the ripple steps like authored
    // pixel animation instead of sliding continuously
    const frame = Math.floor(phase * 6);
    const fq = frame / 6;
    let px = 0, py = 0, found = false;
    for (let tries = 0; tries < 4 && !found; tries++) {
      const seedA = hash(i * 11.7 + loop * 3.3 + tries * 17.9);
      const seedB = hash(i * 7.1 + loop * 9.9 + 1 + tries * 13.3);
      px = FX_BASIN.cx + (seedA * 2 - 1) * (FX_BASIN.rx - 4);
      py = FX_BASIN.cy + (seedB * 2 - 1) * (FX_BASIN.ry - 2);
      found = fountainWaterAt(px, py);
    }
    if (!found) continue;
    // frames 0-2: expand (r = 1,2,3), frames 3-5: hold and fade out
    const r = Math.min(frame + 1, 4);
    const fade = frame < 3 ? 0.55 : 0.55 * (1 - (fq - 0.5) / 0.5);
    if (fade <= 0.02) continue;
    pixelRingDots(g, cx + px, baseY + py, r, Math.max(1, Math.round(r * 0.55)), 'rgba(200,240,255,' + fade.toFixed(2) + ')', mask);
  }
}

// 2. Water flow: the art already paints the cascades and swirl texture, so
// instead of overlaying foreign pixel trails (which read as drips at this
// tiny scale), animate the painted water itself — soft brightness wavefronts
// that well up at the pedestal and travel outward to the rim, exactly how a
// fountain pool actually moves. Every dot is clipped to the water mask, so
// the waves wrap around the stone arms on their own.
function fxStreams(g, cx, baseY, t) {
  const WAVES = 3, period = 2.4;
  for (let w = 0; w < WAVES; w++) {
    const phase = ((t / period + w / WAVES) % 1); // 0 center -> 1 rim
    const s = lerp(0.3, 1.0, phase);              // wavefront scale
    const a = Math.sin(phase * Math.PI) * 0.3;    // swell in, fade at rim
    if (a <= 0.02) continue;
    const rx = FX_BASIN.rx * s, ry = FX_BASIN.ry * s;
    const DOTS = 22;
    for (let i = 0; i < DOTS; i++) {
      const ang = (i / DOTS) * Math.PI * 2 + w * 0.3; // slight per-wave twist
      const px = FX_BASIN.cx + Math.cos(ang) * rx;
      const py = FX_BASIN.cy + Math.sin(ang) * ry;
      if (!fountainWaterAt(px, py)) continue;
      // two-pixel crest: bright leading dot + soft cyan trailing dot
      g.globalAlpha = a;
      rect(g, Math.round(cx + px), Math.round(baseY + py), 1, 1, '#e8fbff');
      g.globalAlpha = a * 0.5;
      rect(g, Math.round(cx + px - Math.cos(ang)), Math.round(baseY + py - Math.sin(ang) * 0.6), 1, 1, '#9fdcf2');
      g.globalAlpha = 1;
    }
  }
  // stream churn where the painted cascades meet the pool: an explicit
  // 4-frame, ~0.7s loop (authored offsets per frame, not continuous drift),
  // desynced per side and clipped to water.
  const CHURN_FRAMES = [
    [[-2, 0, '#d4f6ff'], [0, 1, '#ffffff'], [2, 0, '#d4f6ff']],
    [[-1, 1, '#ffffff'], [1, 0, '#d4f6ff'], [2, 1, '#d4f6ff']],
    [[-2, 1, '#d4f6ff'], [0, 0, '#d4f6ff'], [1, 1, '#ffffff']],
    [[-1, 0, '#d4f6ff'], [0, 1, '#ffffff'], [2, 1, '#d4f6ff']],
  ];
  for (let f = 0; f < FX_FALLS.length; f++) {
    const fall = FX_FALLS[f];
    const lx = Math.round(cx + fall.xBot);
    const ly = Math.round(baseY + fall.yBot + 1);
    const frame = Math.floor((t / 0.175) + f * 2) % 4; // 4 frames x 0.175s = 0.7s loop
    for (const [ox, oy, col] of CHURN_FRAMES[frame]) {
      const fx2 = lx + ox, fy2 = ly + oy;
      if (!fountainWaterAt(fx2 - cx, fy2 - baseY)) continue;
      g.globalAlpha = col === '#ffffff' ? 0.6 : 0.4;
      rect(g, fx2, fy2, 1, 1, col);
      g.globalAlpha = 1;
    }
  }
}

// 3. Water highlights: tiny shimmer points that appear, drift 1-3px, fade.
function fxHighlights(g, cx, baseY, t) {
  const N = 5;
  for (let i = 0; i < N; i++) {
    const period = 1.8 + i * 0.23;
    const loop = Math.floor((t + i * 3.7) / period);
    const phase = ((t + i * 3.7) % period) / period;
    if (phase > 0.6) continue; // shimmer, don't sparkle constantly
    const seedA = hash(i * 5.3 + loop * 4.1 + 2);
    const seedB = hash(i * 9.7 + loop * 2.7 + 3);
    const px = FX_BASIN.cx + (seedA * 2 - 1) * (FX_BASIN.rx - 5);
    const py = FX_BASIN.cy + (seedB * 2 - 1) * (FX_BASIN.ry - 3);
    const k = phase / 0.6;
    const alpha = Math.sin(k * Math.PI) * 0.8;
    const drift = k * 2;
    if (!fountainWaterAt(px + drift, py)) continue; // water only, never stone
    rect(g, Math.round(cx + px + drift), Math.round(baseY + py), 1, 1, `rgba(255,255,255,${alpha.toFixed(2)})`);
  }
}

// 6. Runes: individual pedestal glyphs brighten/dim slightly out of phase.
function fxRunes(g, cx, baseY, t) {
  const { cx: rcx, y, rx, count } = FX_RUNE_ARC;
  for (let i = 0; i < count; i++) {
    const k = i / (count - 1);
    const px = rcx + (k - 0.5) * 2 * rx;
    const py = y - Math.sin(k * Math.PI) * 2; // follow the curved ledge
    const glow = 0.5 + Math.sin(t * 1.3 + i * 1.9) * 0.5; // 0..1, desynced
    g.globalAlpha = 0.12 + glow * 0.22;
    rect(g, Math.round(cx + px), Math.round(baseY + py), 1, 1, '#8fe8ff');
    g.globalAlpha = 1;
  }
}

// 4. Crystal pulse: additive glow only — no scale, no move, no blur.
function fxCrystalPulse(g, cx, baseY, t) {
  const pulse = (Math.sin(t * (2 * Math.PI / 2.5)) * 0.5 + 0.5); // 0..1, 2.5s loop
  const alpha = 0.06 + pulse * 0.09; // subtle: reads as ~100%->115% brightness
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  disc(g, cx + FX_CRYSTAL.cx, baseY + FX_CRYSTAL.cy, FX_CRYSTAL.rx, '#bfeaff');
  g.globalAlpha = alpha * 0.7;
  disc(g, cx + FX_CRYSTAL.cx, baseY + FX_CRYSTAL.cy - 4, FX_CRYSTAL.rx * 0.6, '#ffffff');
  g.restore();
}

// 5. Magic motes: replaces the old plain purple squares. Each mote rises out
// of the crystal on a gentle sine sway, fades in/out smoothly, and flashes a
// tiny 4-arm glint at its brightest moment. Colors alternate cyan/violet per
// loop (hash-picked), and phases are staggered so they never move as a group.
const MOTE_COLORS = [
  { core: '#aef4ff', glint: '#e8fdff' },  // cyan
  { core: '#c9a0ff', glint: '#efe0ff' },  // violet
  { core: '#8fb8ff', glint: '#dceaff' },  // blue
];
function fxMotes(g, cx, baseY, t) {
  const N = 4; // max 4 visible per spec
  for (let i = 0; i < N; i++) {
    const period = 2.6 + i * 0.37;
    const loop = Math.floor((t + i * 2.9) / period);
    const phase = ((t + i * 2.9) % period) / period; // 0..1 birth -> death
    const seedX = hash(i * 8.3 + loop * 5.7);
    const seedC = hash(i * 4.9 + loop * 7.3 + 2);
    const col = MOTE_COLORS[Math.floor(seedC * MOTE_COLORS.length)];
    const x0 = (seedX * 2 - 1) * 8;                    // spawn spread across crystal
    const rise = phase * 16;                            // total climb in px
    const sway = Math.sin(phase * Math.PI * 3 + i * 1.3) * 2.2;
    const px = cx + x0 + sway;
    const py = baseY - 60 - rise;
    const a = Math.sin(phase * Math.PI);                // smooth in -> peak -> out
    if (a <= 0.03) continue;
    g.globalAlpha = a * 0.9;
    rect(g, Math.round(px), Math.round(py), 1, 1, col.core);
    // glint: brief 4-arm sparkle near peak brightness
    if (a > 0.82) {
      g.globalAlpha = (a - 0.82) / 0.18 * 0.8;
      rect(g, Math.round(px) - 1, Math.round(py), 1, 1, col.glint);
      rect(g, Math.round(px) + 1, Math.round(py), 1, 1, col.glint);
      rect(g, Math.round(px), Math.round(py) - 1, 1, 1, col.glint);
      rect(g, Math.round(px), Math.round(py) + 1, 1, 1, col.glint);
    }
    g.globalAlpha = 1;
  }
}

// Crisp scattered-dot "ring" — reads as a ripple crest without a true stroke.
function pixelRingDots(g, cx, cy, rx, ry, color, maskFn = null) {
  const DOTS = 8;
  for (let i = 0; i < DOTS; i++) {
    const a = (i / DOTS) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (maskFn && !maskFn(x, y)) continue; // e.g. keep fountain dots off the stone
    rect(g, Math.round(x), Math.round(y), 1, 1, color);
  }
}

// A raised, tiered fountain with visible stone height (front faces), an animated
// water basin and a floating faceted crystal. Drawn from the base upward so it
// reads as a solid volume; as a depth-sorted entity the player passes behind it
// from the north and in front from the south.
function fountainCrystal(g, cx, cy, t) {
  const baseY = cy + 6; // bottom of the structure
  contactShadow(g, cx, baseY, 28, 6, 0.36);
  // tier 1 (widest) — top slab + front face + edge
  stoneTier(g, cx, baseY, 26, 9, 7);
  // tier 2
  stoneTier(g, cx, baseY - 8, 18, 6, 6);
  // water basin on top of tier 2
  fillEllipse(g, cx, baseY - 15, 13, 4, '#356f96');
  fillEllipse(g, cx, baseY - 16, 12, 3.4, '#4f92bd');
  fillEllipse(g, cx, baseY - 17, 10, 2.6, '#77b8dc');
  for (let i = 0; i < 4; i++) rect(g, Math.round(cx + Math.sin(t * 2 + i * 1.6) * 8), Math.round(baseY - 16 + Math.cos(t + i) * 2), 3, 1, '#bfe6ff'); // shimmer
  // stone pillar in the middle
  rect(g, cx - 3, baseY - 26, 6, 11, '#9a9080'); rect(g, cx - 3, baseY - 26, 2, 11, '#b4aa90'); rect(g, cx + 1, baseY - 26, 2, 11, '#7c7258');
  // floating crystal
  const bob = Math.sin(t * 2) * 2, ccy = baseY - 42 + bob;
  g.globalAlpha = 0.26 + Math.sin(t * 3) * 0.1; disc(g, cx, ccy, 13, '#9d6bff'); g.globalAlpha = 1;
  // reflection in the basin (faint, below)
  g.globalAlpha = 0.22; crystalShape(g, cx, baseY - 15, 0.7, true); g.globalAlpha = 1;
  crystalShape(g, cx, ccy, 1, false);
  // orbiting fragments
  for (let i = 0; i < 3; i++) { const a = t * 1.1 + i * 2.1; rect(g, Math.round(cx + Math.cos(a) * 17), Math.round(ccy + Math.sin(a) * 6), 2, 3, '#b58bff'); }
  // water droplets falling from the crystal
  for (let i = 0; i < 4; i++) { const a = t * 2 + i * 1.6; rect(g, Math.round(cx + Math.cos(a) * 11), Math.round(baseY - 20 - Math.abs(Math.sin(a)) * 8), 1, 2, '#bfe6ff'); }
}

function stoneTier(g, cx, topY, rx, ry, faceH) {
  // front face (a band under the top ellipse) — darker, with lit top edge
  rect(g, cx - rx, topY - ry, rx * 2, faceH, '#8a8068');
  rect(g, cx - rx, topY - ry, rx * 2, 1, '#a89c82');
  rect(g, cx - rx, topY - ry + faceH - 1, rx * 2, 1, '#6f6656');
  // vertical seams on the face
  for (let sx = cx - rx + 4; sx < cx + rx; sx += 8) rect(g, sx, topY - ry, 1, faceH, '#7c7258');
  // top slab ellipse (lit)
  fillEllipse(g, cx, topY - ry, rx, ry, '#b4aa90');
  fillEllipse(g, cx, topY - ry - 1, rx - 2, ry - 1, '#c2b89a');
  fillEllipse(g, cx, topY - ry + 1, rx - 1, ry - 1, '#a89c82'); // lower-right shade
}

function crystalShape(g, cx, ccy, s = 1, flat = false) {
  const H = Math.round(14 * s), W = Math.round(5 * s);
  // body
  rect(g, cx - W, ccy - H / 2, W * 2, H, '#a06fe0');
  // facets: left lit, right shaded
  rect(g, cx - W, ccy - H / 2, W, H, '#c9a0ff');
  rect(g, cx + 1, ccy - H / 2 + 2, W - 1, H - 2, '#7c4fc0');
  // top point
  rect(g, cx - 1, ccy - H / 2 - 3, 2, 4, '#c9a0ff');
  // bright core highlight (upper-left)
  if (!flat) { rect(g, cx - 2, ccy - H / 2 + 1, 1, H - 3, '#eadcff'); rect(g, cx - 2, ccy - H / 2 + 1, 2, 2, '#ffffff'); }
}

// MOTE_COLORS is shared with the Eldertree's crystal motes, which use the same
// palette; the FX functions themselves stay internal.
export {
  FOUNTAIN_H, FOUNTAIN_W, MOTE_COLORS, drawFountainSprite,
};
