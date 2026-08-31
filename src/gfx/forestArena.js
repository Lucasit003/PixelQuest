// THE FORGOTTEN GROVE — the combat arena environment.
//
// Lives outside combat.js on purpose. That file is another session's active
// workspace, so the whole environment is built here and combat.js delegates in
// one call. Nothing here reads or writes game state — it only draws from a
// context object — so the fight and the art stay independent.
//
// THE STORY THE ART HAS TO TELL, IN ORDER OF AGE
//
//   ANCIENT   a woodland shrine was built around a great tree, and a ritual
//             floor was laid in the clearing. Broken columns, runestones,
//             rubble, and about a third of that floor still survive.
//   NATURE    centuries won. Roots have lifted the paving, moss has taken the
//             stone, and the canopy closed overhead. Nature dominates.
//   GOBLINS   arrived last week. Crude, warm-lit, and visibly the newest and
//             least elegant thing in the grove.
//
// Read order matters: you should notice the forest, then realise there is
// stonework under it, then notice someone has moved in.
//
// WHAT THIS REPLACED, AND WHY
//
// Two earlier versions were rejected. The first was a ruined classical city —
// temples, colonnades, a castle gatehouse — and the eye went straight to the
// architecture. The second was an honest forest but read as "a decorated
// rectangular field": props scattered evenly along a straight line, no
// landmark, and procedural-looking brown circles for ground.
//
// The three rules that came out of that:
//   1. If a building is the first thing you notice, it has failed.
//   2. The clearing must not be a rectangle. The forest itself makes the shape.
//   3. Nature clusters. Evenly spaced props are the tell for machine-made.
//
// SCALE AND THE FRAME
//
// mystic_tree_grand is a beautiful giant tree standing on a circular MASONRY
// DAIS with cut steps. The dais is baked into the sprite and is exactly the
// architecture this arena may not have, so the tree is only ever used cropped
// above it (GRAND_CROP). Trunks that leave the top of the screen are never
// faked by tiling a band — an early version stacked the root-flare band three
// times and it read as a stone tier. The frame does the cropping instead.

import { rect, disc, clamp01 } from './pixel.js';
import { DECOR_ART, DECOR_SIZE } from '../scenes/town/props.js';
import { GRASS_TILES, GRASS_TILE } from '../scenes/town/tiles.js';
// The town's wind field, reused rather than reinvented so the arena breathes on
// the same clock as the rest of the world. primitives.js has no imports of its
// own, so this costs nothing.
import { windAt } from '../scenes/town/primitives.js';

// --------------------------------------------------------------- geometry
// These mirror combat.js and must not drift from it. The walk band is where
// actors live; nothing with height is ever drawn inside it.
const DEPTH_MIN = 150;
const DEPTH_MAX = 250;
const CANOPY_Y = 92;             // where the lit clearing meets the dark forest

// combat.js scrolls the camera to `gate.x - W/2`, so the SCREEN CENTRE during
// each fight is the gate's x. Anchoring a clearing at each of those means every
// wave is fought in the middle of its own bay, and the forest closes in between
// them. That is what stops the arena reading as one long rectangular corridor.
const BAYS = [240, 480, 740, 980, 1300];
const BAY_R = 120;               // bay radius; bays are ~240-260 apart

// Each bay gets a ROLE, so walking the grove is a journey instead of five
// copies of one set. Drawn side by side in a full-width render, an identical
// shrine and camp at every gate is the loudest possible copy-paste tell — and
// five goblin camps also destroys the story, because a forward camp is only
// menacing if there are one or two of them.
//
//   240  the approach: the shrine you find first, no goblins yet
//   480  the first camp, and the first sign anyone else is here
//   740  the Guardian's own clearing: the ritual floor at its most complete
//   980  a bigger camp, dug in
//  1300  the confrontation: camp and shrine together, both at full strength
// ONE camp. Three of them made the arena look patterned — the same red banner,
// barrels and crates arrangement recurring every 250px is the asset library
// showing through. There is now a single recognisable occupation, at the boss
// bay where it means the most, and one deliberately sparse "sign" earlier so
// the goblins are foreshadowed without a second camp.
//
// The old layout also collided: a camp sits at bay+128 and a shrine at
// bay-132, so a camp bay followed by a shrine bay put the two compositions
// 20px apart and jammed that side of the screen. With one camp that cannot
// happen, and the shrine bays are now spaced two gates apart.
const BAY_ROLE = {
  240:  { shrine: 1, camp: 0,    floor: 0.35, seed: 3 },
  480:  { shrine: 0, camp: 0.35, floor: 0.55, seed: 11 },   // a sign, not a camp
  740:  { shrine: 1, camp: 0,    floor: 1.00, seed: 23 },
  980:  { shrine: 0, camp: 0,    floor: 0.45, seed: 37 },   // the quiet bay
  1300: { shrine: 0, camp: 1,    floor: 0.90, seed: 53 },   // THE goblin camp
};
function roleOf(bay) { return BAY_ROLE[bay] || { shrine: 0, camp: 0, floor: 0.6, seed: 7 }; }

// How far back the forest edge sits at a given world x: deepest at a bay
// centre, closest at the pinch between two bays. Clamped so the edge never
// reaches into the walk band, or vegetation would swallow the fight.
function edgeY(wx) {
  let best = 1e9;
  for (const b of BAYS) { const d = Math.abs(wx - b); if (d < best) best = d; }
  const u = clamp01(best / BAY_R);
  const s = u * u * (3 - 2 * u);                 // smoothstep: round, not conical
  // Kept shallow, or the grass bulges upward in the middle and reads as a hill.
  //
  // The smooth curve alone was the problem Gemini named: a clean convex arc
  // across the top reads as an artificial dome, not a forest edge. Two octaves
  // of hashed notch break it into an asymmetric, jagged boundary. Every layer
  // that follows the edge — the ground cut, the forest floor, the transition
  // band — inherits the same irregularity, so they stay locked together.
  // Two octaves of value noise, INTERPOLATED between cells. Sampling the hash
  // per cell without interpolation gave hard plateaus and the edge stepped into
  // visible rectangular notches — jagged, but jagged in the wrong way.
  const oct = (cell, amp, seed) => {
    const c = wx / cell, i0 = Math.floor(c), f = c - i0;
    const a = h1(i0 * 2.7 + seed), b = h1((i0 + 1) * 2.7 + seed);
    return ((a + (b - a) * (f * f * (3 - 2 * f))) - 0.5) * amp;
  };
  return CANOPY_Y + 20 + s * 18 + oct(41, 17, 0) + oct(15, 7, 31);
}
// 0 at a bay centre, 1 at a pinch — drives density and how far forward the
// lateral masses come.
function pinch(wx) {
  let best = 1e9;
  for (const b of BAYS) { const d = Math.abs(wx - b); if (d < best) best = d; }
  const u = clamp01(best / BAY_R);
  return u * u * (3 - 2 * u);
}

// ---------------------------------------------------------------- palette
const SOIL  = { lit: '#6d5738', body: '#5b482e', deep: '#463620' };
const GREEN = { lit: '#3d7a3a', body: '#2f6430', deep: '#224a26', dark: '#17331c' };
const BARK  = { lit: '#6b4f33', body: '#523c27', deep: '#3a2a1b' };
const CYAN  = { core: '#aef4ff', body: '#1890d8' };
const FIRE  = { core: '#ffe9a8', body: '#ff9a3c', deep: '#c2451f' };

// ====================== THE CLEARING FIELD ==============================
// One function describes the shape of the clearing, and every ground layer
// reads from it. No border is ever drawn: the clearing is communicated purely
// by where the grass changes value, which is what makes it read as something
// that formed over centuries rather than something that was placed.
//
// Returns 0 at the trodden centre, 1 out at the forest edge. The radius is
// perturbed in lobes so the shape is a bean, never an ellipse.
function clearingT(wx, wy, bayArg) {
  if (bayArg == null) {
    let best = 1;
    for (const b of BAYS) { const v = clearingT(wx, wy, b); if (v < best) best = v; }
    return best;
  }
  const bay = bayArg;
  // The clearing's centre is offset from the bay's, and its axes differ, so the
  // shape is a lopsided bean rather than something centred on the fight. A
  // clearing that is symmetric about the camera reads as constructed.
  const cxo = bay + 26 + (h1(bay * 0.0071) - 0.5) * 40;
  const cyo = 198 + (h1(bay * 0.011 + 3) - 0.5) * 14;
  const dx = (wx - cxo) / 286, dy = (wy - cyo) / 92;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-4) return 0;
  const a = Math.atan2(dy, dx);
  // nine lobes, hashed off the bay so no two clearings share an outline
  const sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 9);
  const nx = ((a + Math.PI) / (Math.PI * 2)) * 9 - sec;
  const w0 = 0.70 + 0.52 * h1(sec * 3.7 + bay * 0.013);
  const w1 = 0.70 + 0.52 * h1(((sec + 1) % 9) * 3.7 + bay * 0.013);
  const wob = w0 + (w1 - w0) * (nx * nx * (3 - 2 * nx));   // smooth between lobes
  return clamp01(d / wob);
}

// An irregular blob of pixel clusters. This is the workhorse for every soft
// ground shape — value bands, travel wear, bare earth — and it exists because
// the previous ground used translucent ellipses, which read as procedural mud
// circles stamped on the grass. A shape built from clusters with a lobed,
// stochastically feathered rim never reads as a circle.
// Shading made of pixels rather than of gradients.
//
// A canvas gradient across the floor reads as an airbrushed pillow at this
// resolution, because it puts values between the palette entries. The first fix
// was an ordered (Bayer) dither, which was worse: at mid coverage an ordered
// matrix is a perfect checkerboard, and the whole arena turned into a screen
// door. Stochastic placement at LOW maximum coverage is what actually works —
// it reads as grain in the grass, and it never organises itself into a visible
// grid the way an ordered matrix does.
function ditherFill(g, x0, y0, x1, y1, colour, amountAt) {
  g.fillStyle = colour;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const a = amountAt(x, y);
      if (a <= 0.004) continue;
      if (h1(x * 0.731 + y * 1.317) > a) continue;
      g.fillRect(x, y, 2, 2);
    }
  }
}

function pxBlob(g, cx, cy, rx, ry, seed, cell) {
  const c = cell || 2;
  for (let y = -ry; y <= ry; y += c) {
    for (let x = -rx; x <= rx; x += c) {
      const ux = x / rx, uy = y / ry;
      const d = Math.sqrt(ux * ux + uy * uy);
      if (d > 1.25) continue;
      const a = Math.atan2(uy, ux);
      const sec = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 11);
      const wob = 0.66 + 0.42 * h1(seed * 7.3 + sec * 2.9);
      if (d > wob) continue;
      // feathered rim: the outer band is eroded at random so no edge is smooth
      if (d > wob - 0.30 && h1(seed + x * 0.37 + y * 0.71) > 0.42) continue;
      g.fillRect(Math.round(cx + x), Math.round(cy + y), c, c);
    }
  }
}

// ------------------------------------------------------------------ mode
// The arena is composed, not generated. Three modes exist so the composition
// can be inspected in isolation:
//   'stripped'  background forest + Guardian Tree + an empty battlefield.
//               This is the underlying composition with nothing decorating it.
//   'rebuilt'   stripped, plus exactly SIX authored perimeter clusters.
//               This is what ships.
// A dev page sets window.__arenaMode; the game always gets 'rebuilt'.
// Which half of the environment to draw.
//   'ground'  the battlefield with the background forest disabled
//   'forest'  the layered backdrop over neutral ground
//   'both'    battlefield plus the layered forest
//
// 'both' is the default again: the foundation pass rebuilt the three background
// layers around openings and a central recess, which is what the ground alone
// could not give — a sense that the world continues past the arena.
function mode() {
  return (typeof window !== 'undefined' && window.__arenaMode) || 'both';
}

// ---------------------------------------------------------------- helpers
function h1(n) { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); }
function art(name) { const a = DECOR_ART[name]; return a && a.ready ? a : null; }

// Dev instrumentation. A composition pass has to be measured or it is just
// opinion, so every prop draw is classifiable by zone when a dev page asks.
// Off in the game: one falsy check per draw.
function tally(x, y) {
  const st = typeof window !== 'undefined' && window.__arenaCount;
  if (!st) return;
  st.total++;
  const sx = x - st.camX;
  if (sx < -20 || sx > st.W + 20) return;
  st.onScreen++;
  const central = sx > st.W * 0.2 && sx < st.W * 0.8;
  if (y >= DEPTH_MIN - 12) { st.floor++; if (central) st.floorCentral++; }
  else if (y >= edgeY(x)) st.mid++;
  else st.back++;
}

function blit(g, name, x, y, flip, alpha) {
  const a = art(name); if (!a) return false;
  tally(x, y);
  const [w, h] = DECOR_SIZE[name];
  const oldA = g.globalAlpha;
  if (alpha != null) g.globalAlpha = alpha;
  if (flip) {
    g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1);
    g.drawImage(a.img, Math.round(-w / 2), Math.round(y - h), w, h); g.restore();
  } else {
    g.drawImage(a.img, Math.round(x - w / 2), Math.round(y - h), w, h);
  }
  g.globalAlpha = oldA;
  return true;
}

// Draw a source rect of a prop at native size, anchored bottom-centre. Used to
// crop the masonry dais off mystic_tree_grand, and to lift individual paving
// fragments out of the flagstone tile.
function cropBlit(g, name, sx, sy, sw, sh, x, baseY, flip, alpha) {
  const a = art(name); if (!a) return false;
  tally(x, baseY);
  const oldA = g.globalAlpha;
  if (alpha != null) g.globalAlpha = alpha;
  g.save();
  if (flip) { g.translate(Math.round(x), 0); g.scale(-1, 1); g.translate(-Math.round(x), 0); }
  g.drawImage(a.img, sx, sy, sw, sh, Math.round(x - sw / 2), Math.round(baseY - sh), sw, sh);
  g.restore();
  g.globalAlpha = oldA;
  return true;
}
const GRAND_CROP = [0, 0, 176, 100];    // canopy + trunk, above the dais

// Silhouettes of real trees, cached. The far forest used to be a rect plus
// three discs, which at this resolution is a black bar with bobbles on it. The
// silhouette of a drawn tree is already a tree shape, so paint the real sprite
// flat and get a true canopy edge for free.
// Tinted, not flattened.
//
// These used to be filled solid, which threw away every pixel of the sprite's
// own foliage clustering and left a smooth vector-like blob sitting against a
// finely textured terrain — a texel-density mismatch inside one viewport, and
// the single most damaging thing about the background.
//
// Filling at partial alpha keeps the tree's internal light and dark clusters
// while still pulling it onto the layer's palette. Strength doubles as a depth
// cue: the furthest layer is nearly flat, the nearest keeps the most detail,
// which is also how distance actually behaves.
const SIL_CACHE = new Map();
function silhouette(name, colour, strength) {
  const st = strength == null ? 1 : strength;
  const key = name + colour + st;
  const hit = SIL_CACHE.get(key);
  if (hit) return hit;
  const a = art(name); if (!a) return null;
  const [w, h] = DECOR_SIZE[name];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cg = c.getContext('2d');
  cg.imageSmoothingEnabled = false;
  cg.drawImage(a.img, 0, 0, w, h);
  cg.globalCompositeOperation = 'source-atop';
  cg.globalAlpha = st;
  cg.fillStyle = colour;
  cg.fillRect(0, 0, w, h);
  cg.globalAlpha = 1;
  const out = { c, w, h };
  SIL_CACHE.set(key, out);
  return out;
}
function blitSil(g, name, colour, x, baseY, flip, alpha, strength) {
  const s = silhouette(name, colour, strength); if (!s) return false;
  tally(x, baseY);
  const oldA = g.globalAlpha;
  if (alpha != null) g.globalAlpha = alpha;
  g.save();
  if (flip) { g.translate(Math.round(x), 0); g.scale(-1, 1); g.translate(-Math.round(x), 0); }
  g.drawImage(s.c, Math.round(x - s.w / 2), Math.round(baseY - s.h));
  g.restore();
  g.globalAlpha = oldA;
  return true;
}

// A soft pool of shade under a prop, so nothing sits ON the ground plane.
function ground(g, x, y, rx, ry, a) {
  g.fillStyle = `rgba(10,20,14,${a})`;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
}

// =========================================================================
// LAYER 1 — sky through the canopy, and the far silhouette forest
// =========================================================================
function backdrop(g, camX, W, dark) {
  const sky = ['#0d1618', '#131f20', '#182823', '#1f3129', '#273a2f'];
  for (let i = 0; i < sky.length; i++) {
    const y0 = Math.round((CANOPY_Y - 10) * i / sky.length);
    rect(g, camX, y0, W, Math.ceil((CANOPY_Y - 10) / sky.length) + 1, sky[i]);
  }
  // Distant forested ridges: summed sines so the skyline never repeats on a
  // tile boundary the way a scrolling bitmap would.
  for (const [par, amp, base, col] of [[0.10, 26, CANOPY_Y - 12, '#101d17'],
                                       [0.18, 20, CANOPY_Y - 4, '#14241a']]) {
    for (let sx = 0; sx <= W + 12; sx += 12) {
      const wx = camX + sx;
      const u = (wx - camX * par) * 0.011;
      const hgt = amp * (0.5 + 0.5 * Math.sin(u) * Math.sin(u * 0.41 + 0.9));
      rect(g, wx, base - hgt, 13, hgt + 12, col);
    }
  }
  // Far forest: real trees painted flat, two ranks at different values so the
  // treeline has depth instead of being one cut-out.
  rect(g, camX, CANOPY_Y - 14, W, 8, `rgba(120,170,150,${0.05 + dark * 0.03})`);
}

// =========================================================================
// LAYER 3 — the forest floor
// =========================================================================
// Painted grass tiles, then earth. An early version drew a 34-unit grid of
// coloured rects and on screen that is exactly what it looked like: a
// checkerboard with smaller squares inside it. The town already solved this —
// blit the real grass art, inset the source by 1px so a tile's own edge ring is
// never sampled at a seam, and mirror per-tile from a hash so the 96-unit
// repeat stops being legible.
// ====================== A — THE BATTLEFIELD =============================
// An old forest clearing, baked once per bay into an offscreen canvas and
// blitted from then on. Baking is what makes the detail affordable: the ground
// is static, so thousands of individual pixel clusters cost one drawImage per
// frame instead of thousands of fillRects.
//
// Four grass values, dithered into each other by cluster density rather than
// blended by a gradient — at 480x270 a smooth gradient reads as a lighting bug,
// while stochastic clusters read as ground.
const GRASS_EDGE = '#1e3d2c';   // old grass under the trees, shifted cool
const GRASS_DEEP = '#28513a';   // the shaded band inside the edge, cooler
const GRASS_LUSH = '#3a7043';   // richer green where moisture collects
const GRASS_WORN = '#59674f';   // trodden; desaturated so green enemies read
const EARTH_A = '#54401f';
const EARTH_B = '#66502c';
const EARTH_RIM = '#2f2412';   // the dark lip that makes a patch read as carved
const STONE_A = '#6b6a5a';
const STONE_B = '#7d7c6b';

// ONE baked canvas for the entire arena. Baking per bay looked right until the
// canvases were laid down together: they overlapped by hundreds of units, so
// every overlay in an overlap zone was applied twice and printed a soft
// rectangle on the grass. A single canvas cannot have that class of bug.
let GROUND_BAKE = null;
const GROUND_X0 = BAYS[0] - 420;
const GROUND_X1 = BAYS[BAYS.length - 1] + 420;
const GROUND_TOP = CANOPY_Y - 10;

function groundFor(H) {
  if (GROUND_BAKE) return GROUND_BAKE;
  // do not bake until every tile has decoded, or the bake caches a blank floor
  for (const tl of GRASS_TILES) if (!tl || !tl.ready) return null;

  const x0 = GROUND_X0, w = GROUND_X1 - GROUND_X0, h = H - GROUND_TOP;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.translate(-x0, -GROUND_TOP);

  // --- base: the painted grass tiles, mirrored per cell so the 96-unit repeat
  //     stops being legible
  const c0 = Math.floor(x0 / GRASS_TILE), c1 = Math.ceil((x0 + w) / GRASS_TILE);
  const r0 = Math.floor(GROUND_TOP / GRASS_TILE), r1 = Math.ceil(H / GRASS_TILE);
  for (let cc = c0; cc <= c1; cc++) {
    for (let rr = r0; rr <= r1; rr++) {
      const k = h1(cc * 7.3 + rr * 3.9);
      const tile = GRASS_TILES[Math.floor(k * 4) % GRASS_TILES.length];
      const src = tile.img.naturalWidth || tile.img.width;
      if (!src) continue;
      const tx = cc * GRASS_TILE, ty = rr * GRASS_TILE;
      const fx = h1(cc * 1.7 + rr * 9.1) > 0.5, fy = h1(cc * 4.3 + rr * 2.1) > 0.5;
      g.save();
      g.translate(tx + (fx ? GRASS_TILE : 0), ty + (fy ? GRASS_TILE : 0));
      g.scale(fx ? -1 : 1, fy ? -1 : 1);
      g.drawImage(tile.img, 1, 1, src - 2, src - 2, 0, 0, GRASS_TILE, GRASS_TILE);
      g.restore();
    }
  }

  // --- value bands.
  //
  // Stamped as a few dozen LARGE overlapping blotches, not per-pixel noise. The
  // first attempt tested every 3px cell independently and stamped it with a
  // probability; at gameplay scale that is not grass, it is static, and it
  // broke the brief's first rule — the ground must read as one coherent
  // surface before any variation becomes visible. Big soft shapes at low alpha
  // read as ground that varies; small dense ones read as noise.
  for (const bay of BAYS) {
  // Four families, from the trodden middle out to the shaded forest edge. They
  // are blended by OVERLAP: each family stamps many low-alpha clusters whose
  // radial spread deliberately runs into its neighbours', so no two families
  // ever meet on an edge. Nothing here is a gradient and nothing is a circle.
  const BANDS = [
    // colour        band centre  spread  count  alpha  size
    [GRASS_WORN, 0.14, 0.34, 32, 0.24, 46],   // A  central worn forest grass
    [GRASS_LUSH, 0.52, 0.24, 14, 0.13, 34],   // B  richer pockets mid-clearing
    [GRASS_DEEP, 0.76, 0.24, 26, 0.22, 38],   // C  lush perimeter
    [GRASS_LUSH, 0.86, 0.15, 12, 0.19, 24],   //    moisture at the edge
    [GRASS_EDGE, 0.99, 0.20, 34, 0.30, 32],   // D  shaded forest-edge grass
  ];
  for (let bi = 0; bi < BANDS.length; bi++) {
    const [col, tc, spread, count, alpha, size] = BANDS[bi];
    g.fillStyle = col;
    for (let i = 0; i < count; i++) {
      const sd = bi * 31.7 + i * 4.3 + bay * 0.017;
      const t = tc + (h1(sd) - 0.5) * 2 * spread;
      const a = h1(sd * 2.1) * Math.PI * 2;
      const wx = bay + Math.cos(a) * 268 * t;
      const wy = 202 + Math.sin(a) * 96 * t;
      if (wy < GROUND_TOP - 20 || wy > H + 20) continue;
      g.globalAlpha = alpha * (0.6 + h1(sd * 5.9) * 0.7);
      pxBlob(g, wx, wy, size * (0.6 + h1(sd * 3.3) * 0.8),
             size * 0.42 * (0.6 + h1(sd * 7.7) * 0.8), sd, 3);
    }
  }
  g.globalAlpha = 1;
  }

  // --- travel wear. Not roads: two routes that fade in and out, one crossing
  //     the clearing and one wandering in from the rear. They are drawn as
  //     broken runs of clusters, so nothing ever resolves into a path.
  // Two routes that give the floor a direction and a history. Neither is a
  // road: both are stretches where movement has flattened the grass, and both
  // are absent more often than present. The primary runs low-left to the middle
  // and away to the upper right; the second drifts in from the rear and dies in
  // the centre.
  const routes = [
    { from: [-330, 250], to: [300, 176], amp: 13, f: 0.017, w: 9,  strength: 1.00 },
    { from: [-40, 132],  to: [40, 214],  amp: 8,  f: 0.031, w: 6,  strength: 0.62 },
  ];
  for (const bay of BAYS) {
    for (let ri = 0; ri < routes.length; ri++) {
      const r = routes[ri];
      const ax = bay + r.from[0], ay = r.from[1];
      const bx = bay + r.to[0], by = r.to[1];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += 3) {
        const u = d / len;
        const wx = ax + (bx - ax) * u;
        const wy = ay + (by - ay) * u + Math.sin(u * 9 + ri * 2.1) * r.amp
                                      + Math.sin(wx * r.f + ri) * 5;
        if (wy < GROUND_TOP + 6 || wy > H - 2) continue;
        // long stretches simply are not there, and the ends fade out entirely
        const ends = Math.min(1, u * 3.2) * Math.min(1, (1 - u) * 3.2);
        if (h1(Math.floor(wx / 19) * 1.7 + ri * 9 + bay * 0.01) < 0.44 + (1 - ends) * 0.5) continue;
        const wide = r.w * (0.6 + h1(wx * 0.05 + ri) * 0.8);
        for (let o = -wide; o <= wide; o += 3) {
          const edge = 1 - Math.abs(o) / wide;
          if (h1(wx * 0.3 + o * 0.7 + ri) > edge * 0.62) continue;
          g.globalAlpha = (0.10 + h1(wx + o) * 0.10) * r.strength * ends;
          g.fillStyle = GRASS_WORN;
          g.fillRect(Math.round(wx), Math.round(wy + o), 3, 3);
        }
      }
    }
  }
  g.globalAlpha = 1;

  // --- bare earth. Irregular, feathered, never a circle.
  // Bare earth.
  //
  // The previous version stamped a dozen similar blobs and they read as brown
  // decals placed on grass. Three changes fix that: sizes now span a 10:1
  // range so a patch can be a few pixels or a broad worn region; each is drawn
  // as two or three overlapping lobes rather than one shape, so the outline is
  // never one closed curve; and grass is stamped back OVER the interior, which
  // is what makes it read as earth showing through vegetation rather than as
  // paint on top of it.
  const earthSpots = [];
  for (const bay of BAYS) {
    for (let i = 0; i < 22; i++) {
      const k = h1(i * 5.7 + bay * 0.011), j2 = h1(i * 2.3 + 4);
      // most sit on the routes; the rest scatter through the middle distance
      let wx, wy;
      if (k > 0.30) {
        const u = h1(i * 3.9 + bay * 0.007);
        wx = bay - 330 + u * 630;
        wy = 250 + (176 - 250) * u + Math.sin(u * 9) * 13 + (j2 - 0.5) * 20;
      } else {
        const a = (i / 22) * Math.PI * 2 + h1(i) * 0.9;
        const t = 0.34 + j2 * 0.5;
        wx = bay + Math.cos(a) * 286 * t;
        wy = 198 + Math.sin(a) * 92 * t;
      }
      if (wy < GROUND_TOP + 8 || wy > H - 4) continue;
      // 10:1 size range: most are small, a few are broad
      const big = h1(i * 8.1 + bay * 0.003);
      const rx = big > 0.84 ? 16 + k * 14 : (big > 0.5 ? 6 + k * 6 : 2 + k * 3);
      earthSpots.push({ wx, wy, rx, k });
      g.globalAlpha = 0.18 + k * 0.12;
      g.fillStyle = k > 0.5 ? EARTH_A : EARTH_B;
      // two or three overlapping lobes, so no single closed outline survives
      const lobes = rx > 12 ? 3 : (rx > 5 ? 2 : 1);
      // A dark lip first, one pixel proud of the fill, so the patch reads as
      // cut INTO the turf. Without it these were soft stains floating on top.
      const oldA = g.globalAlpha;
      g.globalAlpha = Math.min(0.5, oldA + 0.14);
      g.fillStyle = EARTH_RIM;
      for (let L = 0; L < lobes; L++) {
        const off = (L - (lobes - 1) / 2) * rx * 0.7;
        pxBlob(g, wx + off, wy + (h1(i + L) - 0.5) * 5 + 1,
               rx * (0.7 + h1(i * 2.1 + L) * 0.5) + 1.5, rx * 0.42 + 2.5,
               i * 3.1 + L * 7.7 + bay * 0.01, 2);
      }
      g.globalAlpha = oldA;
      g.fillStyle = k > 0.5 ? EARTH_A : EARTH_B;
      for (let L = 0; L < lobes; L++) {
        const off = (L - (lobes - 1) / 2) * rx * 0.7;
        pxBlob(g, wx + off, wy + (h1(i + L) - 0.5) * 5,
               rx * (0.7 + h1(i * 2.1 + L) * 0.5), rx * 0.42 + 1, i * 3.1 + L * 7.7 + bay * 0.01, 2);
      }
    }
  }
  g.globalAlpha = 1;

  // grass stamped back over the earth, breaking every boundary
  for (const sp of earthSpots) {
    if (sp.rx < 4) continue;
    g.fillStyle = sp.k > 0.5 ? GRASS_DEEP : GRASS_LUSH;
    for (let n = 0; n < Math.round(sp.rx * 1.6); n++) {
      const a = h1(sp.wx * 0.3 + n * 1.7) * Math.PI * 2;
      const rr = 0.55 + h1(sp.wx * 0.7 + n) * 0.6;
      g.globalAlpha = 0.30 + h1(n * 3.3) * 0.30;
      g.fillRect(Math.round(sp.wx + Math.cos(a) * sp.rx * rr),
                 Math.round(sp.wy + Math.sin(a) * (sp.rx * 0.42 + 1) * rr), 2, 2);
    }
    // a few pebbles embedded in the larger patches
    if (sp.rx > 12) {
      g.fillStyle = STONE_A;
      for (let n = 0; n < 3; n++) {
        g.globalAlpha = 0.28;
        g.fillRect(Math.round(sp.wx + (h1(n * 5.1 + sp.wx) - 0.5) * sp.rx * 1.2),
                   Math.round(sp.wy + (h1(n * 2.7 + sp.wx) - 0.5) * sp.rx * 0.5), 2, 2);
      }
    }
  }
  g.globalAlpha = 1;

  // --- Buried history.
  //
  // One partial curved alignment, a few disconnected paving fragments and a
  // cracked rune stone. Around a seventh of the original survives; grass and
  // soil have the rest. Nothing is bright, nothing joins up, and the curve is
  // an arc segment rather than a ring — you should be able to infer that
  // something was laid out here without ever being shown the shape of it.
  for (const bay of BAYS) {
    const ccx = bay + 18, ccy = 214, rad = 96;
    // the curved alignment: a short arc, and most of its stones are missing
    for (let a = 2.42; a < 4.05; a += 0.055) {
      if (h1(a * 31.7 + bay * 0.01) < 0.60) continue;          // ~40% survives
      const sx = ccx + Math.cos(a) * rad;
      const sy = ccy + Math.sin(a) * rad * 0.36;
      if (sy < GROUND_TOP + 8 || sy > H - 4) continue;
      g.globalAlpha = 0.26 + h1(a * 7.7) * 0.12;
      g.fillStyle = h1(a * 3.1) > 0.5 ? STONE_A : STONE_B;
      const w = 3 + Math.round(h1(a * 5.3) * 3);
      g.fillRect(Math.round(sx), Math.round(sy), w, 3);
      // moss on the upslope edge of about half of them
      if (h1(a * 11.3) > 0.5) {
        g.globalAlpha = 0.30; g.fillStyle = GRASS_DEEP;
        g.fillRect(Math.round(sx), Math.round(sy - 2), w, 2);
      }
    }
    // three disconnected paving fragments, well away from the arc
    for (const [fx, fy, fw, sd] of [[bay + 148, 190, 11, 2.1],
                                    [bay - 178, 240, 9, 5.3],
                                    [bay + 76, 254, 13, 8.7]]) {
      if (fy > H - 4 || fy < GROUND_TOP + 6) continue;
      g.globalAlpha = 0.24;
      g.fillStyle = STONE_A;
      pxBlob(g, fx, fy, fw, fw * 0.45, sd, 3);
      g.globalAlpha = 0.26; g.fillStyle = GRASS_DEEP;
      for (let n = 0; n < 8; n++) {
        const a2 = h1(sd + n * 1.9) * Math.PI * 2;
        g.fillRect(Math.round(fx + Math.cos(a2) * fw * 0.9),
                   Math.round(fy + Math.sin(a2) * fw * 0.42), 2, 2);
      }
    }
    // one cracked rune stone, mostly buried: a few marks, nothing legible
    const rx0 = bay - 96, ry0 = 228;
    if (ry0 < H - 4) {
      g.globalAlpha = 0.28; g.fillStyle = STONE_B;
      pxBlob(g, rx0, ry0, 8, 4, 13.7, 2);
      g.globalAlpha = 0.16; g.fillStyle = '#8fb9c4';
      for (const [ox, oy] of [[-2, -1], [0, -2], [2, -1], [0, 0]]) {
        g.fillRect(rx0 + ox * 2, ry0 + oy * 2, 2, 2);
      }
    }
  }
  g.globalAlpha = 1;

  // --- implied open-sky light on the middle of the clearing. Not a glow: a
  //     very slight lift, stamped as clusters like everything else, so the eye
  //     is drawn to the combat floor without the centre appearing lit from
  //     within.
  for (const bay of BAYS) {
    g.fillStyle = '#7d9366';
    for (let i = 0; i < 26; i++) {
      const sd = i * 6.7 + bay * 0.019;
      const a = h1(sd * 2.1) * Math.PI * 2;
      const t = h1(sd) * 0.42;
      const wx = bay + Math.cos(a) * 286 * t, wy = 198 + Math.sin(a) * 92 * t;
      if (wy < GROUND_TOP + 4 || wy > H - 4) continue;
      g.globalAlpha = 0.11 + h1(sd * 3.9) * 0.09;
      pxBlob(g, wx, wy, 34 + h1(sd * 5.1) * 30, 15 + h1(sd * 7.3) * 11, sd, 3);
    }
  }
  g.globalAlpha = 1;

  // --- micro detail, budgeted by zone: the centre gets almost nothing.
  for (let i = 0; i < 420; i++) {
    const wx = x0 + h1(i * 1.7) * w;
    const wy = GROUND_TOP + h1(i * 3.1 + 5) * (H - GROUND_TOP);
    const t = clearingT(wx, wy);
    // Thinned ~18% in the two inner zones only; the perimeter keeps its full
    // budget, so the floor still gets richer as it leaves the fight.
    const keep = t < 0.40 ? 0.041 : (t < 0.70 ? 0.181 : 0.62);
    if (h1(i * 7.9) > keep) continue;
    const k = h1(i * 11.3);
    // Low contrast by construction: flowers are single pixels in muted tints,
    // everything else is a two-pixel tuft only a shade off the grass under it.
    // Contrast compressed toward the grass it sits on: at 480x270 a bright
    // speck competes with a damage number.
    g.globalAlpha = 0.14 + k * 0.13;
    if (k > 0.94) { g.fillStyle = ['#8f9c5c', '#9b8fa6', '#a9a37b'][Math.floor(k * 97) % 3];
                    g.fillRect(Math.round(wx), Math.round(wy), 1, 1); }
    else if (k > 0.80) {   // fallen leaves, warm but very close to the grass
      g.fillStyle = ['#6e6a3a', '#7a6440', '#5f6b3c'][Math.floor(k * 61) % 3];
      g.fillRect(Math.round(wx), Math.round(wy), 2, 1);
    } else if (k > 0.55) { g.fillStyle = GRASS_LUSH;
      g.fillRect(Math.round(wx), Math.round(wy), 2, 2);
    } else { g.fillStyle = GRASS_EDGE;
      g.fillRect(Math.round(wx), Math.round(wy), 2, 2); }
  }
  g.globalAlpha = 1;

  // NOTE ON SHADING METHOD.
  //
  // Gemini's critique of the previous build called the ground's depth shading
  // "airbrushed light gradients that violate pixel-art cluster rules", which is
  // a fair thing to say about a canvas gradient in principle. Acting on it made
  // the arena materially worse, twice: an ordered Bayer dither turned the whole
  // floor into a screen door, and stochastic stipple covered the grass in dark
  // speckle. The note was right about the principle and wrong about this case,
  // because the visible variation here is already carried by baked pixel
  // clusters — the value bands, the erosion and the travel wear above. The
  // depth falloff on top of them is a wide, very low-alpha wash where a
  // gradient genuinely is the better tool, and it lives in lighting().
  //
  // Judged on the render, not on the argument.

  // --- dissolve the top edge.
  //
  // The bake is a rectangle, so its top printed a ruler-straight horizon across
  // the whole frame — measured at +27 luminance in one row against a typical
  // row-to-row delta of 2. The grass now stops along the clearing's own edge
  // curve, with a stochastically eroded rim, so the ground grows up into the
  // forest instead of starting on a line.
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (let wx = x0; wx < x0 + w; wx += 2) {
    const top = edgeY(wx) - 10;
    g.fillRect(wx, GROUND_TOP - 2, 2, top - GROUND_TOP + 2);
    // eroded rim: a dithered band below the cut so the boundary is ragged
    for (let d = 0; d < 16; d += 2) {
      if (h1(wx * 0.37 + d * 1.7) > 0.52 - d * 0.028) continue;
      g.fillRect(wx, top + d, 2, 2);
    }
  }
  g.globalCompositeOperation = 'source-over';

  GROUND_BAKE = { c, x0, y0: GROUND_TOP, w, h };
  return GROUND_BAKE;
}

// Blit the baked ground for every bay the camera can see.
function battlefield(g, camX, W, H) {
  // backing fill follows the clearing edge too, or it reinstates the very
  // straight horizon the bake just dissolved
  g.fillStyle = GRASS_DEEP;
  for (let sx = 0; sx < W; sx += 2) {
    const wx = camX + sx;
    const top = edgeY(wx) - 8;
    g.fillRect(wx, top, 2, H - top);
  }
  const gr = groundFor(H);
  if (gr) g.drawImage(gr.c, gr.x0, gr.y0);
}

// =========================================================================
// LAYER 5 — the treeline: the shape of the clearing
// =========================================================================
// The ground plane starts at CANOPY_Y, and with nothing on that line it is a
// ruler-straight edge across the full width — the most artificial thing in the
// shot, and the reason the arena read as rectangular.
//
// Two jobs here. Break the line, and BEND it: the edge follows edgeY(), sitting
// far back at a bay centre and coming forward at the pinch between bays, so
// each fight happens inside a rough oval instead of a corridor. The lateral
// masses at the pinches are what actually sell it — trees crowding forward on
// both sides of the frame while the middle stays open.
const SKIRT_TREE = ['tree_oak_broad', 'tree_oak_spread', 'tree_oak_round',
                    'myst_tree_round', 'tree_young', 'tree_small_pine'];
// The wall of forest the clearing is cut out of.
//
// This used to be three ranks: dark silhouettes, then lit trees, then a belt of
// undergrowth spilling forward. The last two are what made the forest continue
// straight through the battlefield instead of stopping at its edge — you could
// not tell where the woods ended and the arena began.
//
// Now it is ONE mass. Dense, dark, flat in value, deliberately not resolvable
// into individual trees, and it stops. What follows it is open ground.
// ====================== B — THE BACKGROUND FOREST =======================
// Three layers, separated by VALUE and SATURATION only. No blur, no haze wash:
// at this resolution both turn pixel art to mush, and depth reads perfectly
// well from a palette that gets darker and cooler with distance.
//
// The organising idea is CLUMPS. Trees stepped along at a fixed interval read
// as wallpaper no matter how good the sprite is, so each layer places a few
// irregular masses of overlapping trees and leaves real gaps between them —
// gaps you can see the darker, further layer through.

// Size classes, because scaling pixel art to vary tree size is not an option —
// a non-integer scale destroys the grid. The pack already ships trees from 50
// to 100 tall, so height variation comes from choosing a different sprite.
// ====================== THE BACKGROUND FOREST ===========================
//
// Four planes, and the governing idea is MASS rather than trees.
//
// The previous version stepped tree sprites along at roughly a sprite's width,
// which is why it read as "a row of trees behind an arena" — you could count
// them. The fix is not fewer trees or more trees, it is OVERLAP: crowns drawn
// at one flat colour with a stride far shorter than their width merge into a
// single silhouette with a leafy top edge, and the eye reads a canopy instead
// of a queue. Individual trees become readable only where I choose, on plane 3.
//
// Depth comes from value and colour temperature, never from blur.

const BG_SMALL = ['tree_oak_round', 'myst_tree_round', 'tree_young', 'tree_small_pine',
                  'tree_sapling', 'tree_oak_spread'];
const BG_MED   = ['tree_oak_broad', 'tree_oak_spread', 'deciduous_tree_03', 'pine_tree_02',
                  'deciduous_tree_02', 'deciduous_tree_04', 'tree_blossom_white'];
const BG_BIG   = ['deciduous_tree_01', 'deciduous_tree_05', 'pine_tree_01', 'pine_tree_03',
                  'deciduous_tree_06', 'pine_tree_04'];

// --- the skyline.
// Three octaves, the largest with real amplitude, so the canopy rises and dips
// dramatically instead of running along at one height. Interpolated between
// cells: sampling per cell without it gives plateaus and hard steps.
function noiseAt(wx, cell, amp, seed) {
  const c = wx / cell, i0 = Math.floor(c), f = c - i0;
  const a = h1(i0 * 2.7 + seed), b = h1((i0 + 1) * 2.7 + seed);
  return ((a + (b - a) * (f * f * (3 - 2 * f))) - 0.5) * amp;
}
function skyline(wx, bay) {
  // The middle of the frame is pushed DOWN, so the canopy dips there and the
  // eye is given somewhere to travel into rather than a wall at one height.
  const u = bay ? (wx - bay) / 300 : 0;
  const dip = Math.exp(-((u - 0.04) * (u - 0.04)) / 0.05) * 13;
  return noiseAt(wx, 170, 74, 3) + noiseAt(wx, 61, 30, 11) + noiseAt(wx, 22, 10, 29) + dip;
}

// --- the two depth windows, plus the central recess.
// Returns 0..1: 1 where the near canopy is fully present, 0 where it opens and
// lets the deepest plane show through. These openings are the whole proof that
// there is space behind the first trees.
function windowAt(wx, bay) {
  const u = (wx - bay) / 300;
  // the important one, behind the middle of the battlefield
  const recess = Math.exp(-((u - 0.04) * (u - 0.04)) / 0.014);
  // a second, offset well to the left so the two never read as a pair
  const second = Math.exp(-((u + 0.62) * (u + 0.62)) / 0.008);
  return clamp01(1 - recess * 0.92 - second * 0.78);
}

// --- corner weighting, built from density rather than a vignette filter
function heaviness(wx, bay) {
  const u = (wx - bay) / 300;
  return clamp01(0.34 + clamp01((Math.abs(u) - 0.22) * 1.6) * 0.72);
}

// A band of heavily overlapped crowns at ONE flat colour: a canopy mass.
// `stride` well under the sprite width is what makes them merge.
// Darken a hex by a factor — used to throw whole runs of canopy into shadow.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), gg = Math.round(((n >> 8) & 255) * f),
        b = Math.round((n & 255) * f);
  return `rgb(${r},${gg},${b})`;
}

function canopyMass(g, camX, W, bay, colour, opts) {
  const { par, stride, baseY, kit, sway, t, strength, gate, jitter } = opts;
  // A low-frequency mask throws whole RUNS of clusters into deep shadow, so the
  // skyline breaks into asymmetric light and dark blocks instead of running
  // along at one value. Repeating rounded shapes at a single value are what
  // make a treeline read as a wall, no matter how many trees are in it.
  const dark = shade(colour, 0.52);
  const start = Math.floor((camX * (1 - par)) / stride) * stride - stride * 3;
  for (let wx = start; wx < camX + W + stride * 3; wx += stride) {
    const px = wx - camX * par;
    if (px > camX + W + 150 || px < camX - 150) continue;
    const k = h1(wx * 0.031 + par * 17);
    if (gate && gate(px, k) === false) continue;
    const w = sway ? windAt(px, baseY, t) * sway : 0;
    const name = kit[Math.floor(k * 101) % kit.length];
    const block = h1(Math.floor(px / 86) * 3.3 + par * 7) > 0.46;
    blitSil(g, name, block ? colour : dark, px + w + (k - 0.5) * jitter,
            baseY + skyline(px, bay) * (opts.relief == null ? 0.5 : opts.relief) + (k - 0.5) * 10,
            k > 0.5, 1, strength);
  }
}

// --- PLANE 1: the deepest forest. Near-black cool green, trunks only
// suggested, and it is drawn everywhere so that any gap in the planes above
// opens onto forest rather than onto sky.
function planeVista(g, camX, W, bay, t) {
  // furthest: the pale cool wall of trees the eye reads as "miles more forest"
  canopyMass(g, camX, W, bay, '#22384a', {
    par: 0.52, stride: 13, baseY: CANOPY_Y - 20, kit: BG_SMALL,
    sway: 0.02, t, strength: 0.99, jitter: 6, relief: 0.16,
  });
  // and one rank in front of it, a step darker and greener
  canopyMass(g, camX, W, bay, '#182b3a', {
    par: 0.46, stride: 15, baseY: CANOPY_Y - 12, kit: BG_MED,
    sway: 0.03, t, strength: 0.98, jitter: 7, relief: 0.22,
  });
  // Trunks inside the recess itself. The opening behind the middle of the
  // battlefield is the one place the eye is invited to travel into, and it only
  // pays off if there is something faintly resolvable in there — otherwise it
  // is a hole. These are barely above the value of the darkness around them.
  for (let i = 0; i < 9; i++) {
    const k = h1(i * 6.7 + 41);
    const wx = bay + 4 + (k - 0.5) * 150;
    const px = wx - camX * 0.50;
    if (px < camX - 20 || px > camX + W + 20) continue;
    g.fillStyle = '#1a2c38';
    g.fillRect(Math.round(px), Math.round(CANOPY_Y - 30 + k * 10), 1, 26 + k * 12);
  }

  // suggested distant trunks, low contrast against the vista behind them
  for (let wx = Math.floor((camX - 90) / 27) * 27; wx < camX + W + 90; wx += 27) {
    const k = h1(wx * 0.061 + 19);
    if (k < 0.38) continue;
    const px = wx - camX * 0.46;
    g.fillStyle = '#122430';
    g.fillRect(Math.round(px), Math.round(CANOPY_Y - 8 + skyline(px, bay) * 0.22),
               1 + Math.round(k), 34 + k * 14);
  }
}

// ====================== THE WOODLAND =====================================
//
// The tree layer is not made of tree sprites any more.
//
// Every previous version blitted whole trees, and a whole tree sprite is a
// trunk with one round crown on top — so no matter how they were spaced or
// tinted, the result was countable: crown, crown, crown. The fix is to stop
// drawing trees and start drawing the two things a forest is actually made of.
//
//   TRUNKS   authored individually, with real architecture: broad ancient,
//            forked, leaning, thin secondary, broken. Most run off the top of
//            the frame, so you never see a complete tree.
//   CANOPY   one continuous mass of overlapping irregular lobes that ignores
//            which trunk it belongs to, with deliberate gaps cut through it.
//
// Baked per bay: trunks never move, and the canopy gets a sub-pixel sway, so
// the whole layer costs two blits a frame instead of thousands of operations.

// The approved bush layer's kit. Lives here because bgEdge and transitionBand
// both read it; nothing in this pass changes it.
const EDGE_KIT = ['bush_big', 'bush_01', 'bush_03', 'bush_low', 'nv_bush_02',
                  'nv_bush_04', 'fernbank_01', 'fernbank_02'];

const WOOD_TOP = -80;                       // world y the bake starts at
const WOOD_PAD = 420;                       // world units either side of a bay
const WOOD_CACHE = new Map();

// --- one irregular leafy lobe. Not a circle: the radius is modulated by three
// angular octaves and the rim is stochastically eroded, so the silhouette has
// the ragged protrusions of foliage rather than the outline of a balloon.
function canopyLobe(g, cx, cy, rx, ry, seed, cell) {
  const c = cell || 2;
  for (let y = -ry - 4; y <= ry + 4; y += c) {
    for (let x = -rx - 4; x <= rx + 4; x += c) {
      const ux = x / rx, uy = y / ry;
      const d = Math.sqrt(ux * ux + uy * uy);
      if (d > 1.5) continue;
      const a = Math.atan2(uy, ux);
      const w1 = h1(seed * 3.1 + Math.floor(((a + Math.PI) / (Math.PI * 2)) * 7) * 2.3);
      const w2 = h1(seed * 5.7 + Math.floor(((a + Math.PI) / (Math.PI * 2)) * 17) * 1.7);
      const w3 = h1(seed * 9.3 + Math.floor(((a + Math.PI) / (Math.PI * 2)) * 37) * 1.1);
      const wob = 0.58 + w1 * 0.44 + (w2 - 0.5) * 0.20 + (w3 - 0.5) * 0.11;
      if (d > wob) continue;
      if (d > wob - 0.22 && h1(seed + x * 0.41 + y * 0.83) > 0.40) continue;
      g.fillRect(Math.round(cx + x), Math.round(cy + y), c, c);
    }
  }
}

// ===================== THE CANOPY'S LOWER EDGE ==========================
//
// The single most important function in this file for V4.
//
// V3 read as horizontal bands because the canopy's BOTTOM was effectively a
// straight line: every rank sat at a fixed offset, so however ragged the lobes
// were, their collective lower edge ran level across the frame. Here the bottom
// edge is a large-amplitude curve — roughly ninety units of swing — so the
// canopy plunges down behind the bushes in some places and lifts far above them
// in others, exposing trunks and glimpses of the deep forest as it goes.
//
// Every canopy rank hangs FROM this curve rather than sitting at a fixed y.
function canopyBottom(px) {
  return CANOPY_Y - 30
       + noiseAt(px, 132, 44, 71)
       + noiseAt(px, 49, 20, 13)
       + noiseAt(px, 21, 9, 91);
}

// A tapering limb along a gentle arc. Branches are what prove a canopy belongs
// to enormous trees rather than floating above them, and V3's trunks rose into
// darkness with almost none, which is why they read as columns.
function limb(g, x0, y0, ang, len, w0, pal, curve, detail) {
  for (let d = 0; d < len; d++) {
    const u = d / len;
    const a = ang + curve * u;
    const x = x0 + Math.cos(a) * d;
    const y = y0 + Math.sin(a) * d;
    if (y < WOOD_TOP) break;
    const th = Math.max(1, Math.round(w0 * (1 - u * 0.82)));
    g.fillStyle = u < 0.55 ? pal.body : pal.deep;
    g.fillRect(Math.round(x), Math.round(y), th, th);
    if (detail > 0.5 && th > 2 && u < 0.5) {
      g.fillStyle = pal.lit;
      g.fillRect(Math.round(x), Math.round(y), 1, Math.max(1, th - 1));
    }
  }
}

// A branch that behaves like a branch: a primary run that forks into two
// secondaries, with whole stretches simply absent where foliage covers it.
//
// V8's problem was one 150px limb at a shallow angle, which read as a
// structural beam spanning the frame. Nothing in a tree is that long, that
// straight or that continuously visible — a real limb divides, and most of it
// is behind leaves.
function branchTree(g, x0, y0, ang, len, w0, pal, curve, detail, depth) {
  const hidden = (u) => (u > 0.34 && u < 0.50) || (u > 0.70 && u < 0.80);
  for (let d = 0; d < len; d++) {
    const u = d / len;
    if (hidden(u)) continue;                       // ~26% behind foliage
    const a = ang + curve * u;
    const x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d;
    if (y < WOOD_TOP) break;
    const th = Math.max(1, Math.round(w0 * (1 - u * 0.72)));
    g.fillStyle = u < 0.5 ? pal.body : pal.deep;
    g.fillRect(Math.round(x), Math.round(y), th, th);
    if (detail > 0.5 && th > 2 && u < 0.4) {
      g.fillStyle = pal.lit;
      g.fillRect(Math.round(x), Math.round(y), 1, Math.max(1, th - 1));
    }
  }
  if (depth > 0) {
    // fork about two thirds along, into two shorter, steeper secondaries
    const fu = 0.62, fa = ang + curve * fu;
    const fx = x0 + Math.cos(fa) * len * fu, fy = y0 + Math.sin(fa) * len * fu;
    branchTree(g, fx, fy, fa - 0.52, len * 0.46, w0 * 0.58, pal, curve * 1.4, detail, depth - 1);
    branchTree(g, fx, fy, fa + 0.40, len * 0.38, w0 * 0.50, pal, curve * 0.6, detail, depth - 1);
  }
}

// Bark that reads as bark: ridges, cracks and knots in LARGE clusters, on the
// nearest trees only. V8's near trunks were dark columns with a groove or two.
function barkDetail(g, colAt, wAt, baseY, H2, seed, pal) {
  for (let n = 0; n < 26; n++) {                   // vertical ridges
    const u = h1(seed * 3.3 + n) * 0.92;
    const y = baseY - u * H2;
    if (y < WOOD_TOP) continue;
    const w = wAt(u), cc = colAt(u);
    const rx = cc - w / 2 + w * (0.14 + h1(n * 2.1) * 0.72);
    const len = 5 + Math.round(h1(n * 5.7) * 13);
    g.fillStyle = h1(n) > 0.5 ? pal.deep : pal.body;
    g.fillRect(Math.round(rx), Math.round(y), 2, len);
  }
  for (let n = 0; n < 9; n++) {                    // cracks across the grain
    const u = 0.06 + h1(seed * 7.1 + n) * 0.8;
    const y = baseY - u * H2;
    if (y < WOOD_TOP) continue;
    const w = wAt(u), cc = colAt(u);
    g.fillStyle = pal.deep;
    g.fillRect(Math.round(cc - w * 0.3), Math.round(y), Math.round(w * 0.55), 2);
  }
  for (const ku of [0.22, 0.47, 0.68]) {           // knots
    const y = baseY - ku * H2;
    if (y < WOOD_TOP) continue;
    const cc = colAt(ku), w = wAt(ku);
    g.fillStyle = pal.deep;
    canopyLobe(g, cc + w * 0.14, y, 4, 3, ku * 91, 2);
    g.fillStyle = pal.lit;
    g.fillRect(Math.round(cc + w * 0.14 - 3), Math.round(y - 3), 2, 2);
  }
}

// A trunk: irregular tapering column with bark grooves. `detail` governs how
// much anatomy is readable — only the dominant tree gets much.
function barkTrunk(g, x, baseY, topY, wBase, seed, pal, detail, lean) {
  const det = detail == null ? 0.2 : detail;
  const H2 = baseY - topY;
  const colAt = (u) => x + (lean || 0) * H2 * u + noiseAt(u * 260 + seed * 90, 34, 5, seed);
  const wAt = (u) => Math.max(2, wBase * (1 - u * 0.30)
                     * (1 + noiseAt(u * 300 + seed * 40, 26, 0.30, seed + 5)));
  for (let u = 0; u <= 1.0001; u += 1 / H2) {
    const y = baseY - u * H2;
    if (y < WOOD_TOP - 4) break;
    const cc = colAt(u), ww = wAt(u);
    g.fillStyle = pal.body;
    g.fillRect(Math.round(cc - ww / 2), Math.round(y), Math.round(ww), 1);
    if (det > 0.5) {   // selective light: the dominant trunk only
      g.fillStyle = pal.lit;
      g.fillRect(Math.round(cc - ww / 2), Math.round(y), Math.max(1, Math.round(ww * 0.18)), 1);
    }
    g.fillStyle = pal.deep;
    const grooves = det > 0.6 ? (ww > 20 ? 4 : 2) : (ww > 14 ? 2 : 1);
    for (let gv = 0; gv < grooves; gv++) {
      const gx = cc - ww / 2 + ww * (0.30 + gv * 0.22)
               + noiseAt(u * 420 + gv * 70 + seed * 12, 18, 1.8, seed + gv);
      g.fillRect(Math.round(gx), Math.round(y), 1, 1);
    }
  }
  if (det > 0.3) {
    g.fillStyle = pal.moss;
    for (let n = 0; n < Math.round(16 + det * 54); n++) {
      const u = h1(seed * 7.7 + n) * 0.6;
      const y = baseY - u * H2;
      if (y < WOOD_TOP) continue;
      g.fillRect(Math.round(colAt(u) - wAt(u) / 2 + h1(n * 2.3) * 3), Math.round(y), 2, 2);
    }
  }
  return colAt;
}

// ===================== THE THREE ANCIENT TREES ==========================
//
// Architectural anchors inside the forest mass, not three tree sprites. Each is
// a trunk plus a few named limbs, and each is interrupted: bases behind bushes,
// branches vanishing into canopy, crowns off the top of the frame. You should
// be able to barely make out a giant forked trunk, and then realise the canopy
// behind it belongs to trees you cannot separate at all.
// The central opening is the largest but is broken up by a trunk and a
// diagonal branch drawn across it, so it reads as forest continuing backward
// rather than as one blue hole. The right-third glimpse is about a third its
// size, proving the cool layer sits behind the whole canopy.
const CANOPY_GAPS = [[-176, 24], [18, 42], [252, 15]];

function woodlandFor(bay) {
  const hit = WOOD_CACHE.get(bay);
  if (hit) return hit;
  const x0 = bay - WOOD_PAD, w = WOOD_PAD * 2, h = (CANOPY_Y + 70) - WOOD_TOP;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cg = c.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.translate(-x0, -WOOD_TOP);
    return { c, g: cg };
  };
  const back = mk(), front = mk();

  // Three glimpses of the deep forest, none aligned with another, each showing
  // a different mix of trunk, foliage and darkness. Edges are noise-modulated
  // so none of them has a clean border.
  const gapAt = (px) => {
    for (const [gx, gw] of CANOPY_GAPS) {
      const wob = gw * (0.55 + 0.6 * h1(Math.floor(px / 8) * 2.7 + gx));
      const d = Math.abs(px - (bay + gx));
      if (d < wob) return 1 - d / wob;
    }
    return 0;
  };

  // ===================== PLANE F — DEEPEST FOREST =======================
  // Enormous overlapping foliage masses, almost black navy-green, essentially
  // no internal detail. This is what sits ABOVE and BEHIND everything else so
  // the distant trunks have something to stand against.
  back.g.fillStyle = '#0c141c';
  for (let i = 0; i < 11; i++) {
    const k = h1(i * 7.3 + bay * 0.005);
    canopyLobe(back.g, x0 + 30 + k * (w - 60), CANOPY_Y - 70 + (k - 0.5) * 44,
               46 + k * 40, 22 + k * 18, i * 3.7 + 2, 3);
  }

  // ===================== PLANE E — DISTANT FOREST =======================
  //
  // Fourteen implied forms, and the layer V6 was missing. Almost all of them
  // are just trunks: narrow, slightly varied in width, wildly varied in height
  // and spacing, several leaning. They are drawn into the BACK canvas so that
  // every middle and near form in front occludes them — which is what stops
  // them being countable and what makes the eye read "many more back there".
  //
  // Spacing is clustered on purpose: pairs and triples with real gaps, never
  // an even comb.
  const DISTANT = [-402, -388, -370, -300, -286, -212, -150, -136, -128,
                   -40, 30, 44, 118, 202, 216, 232, 310, 388, 404];
  for (let i = 0; i < DISTANT.length; i++) {
    const k = h1(i * 4.7 + 11);
    const tx = x0 + WOOD_PAD + DISTANT[i];
    const hgt = 46 + k * 46;
    const lean = (k - 0.5) * 0.20;
    const top = CANOPY_Y - 20 - hgt;
    back.g.fillStyle = k > 0.6 ? '#172634' : '#131f2b';
    for (let d = 0; d < hgt; d++) {
      const u = d / hgt;
      back.g.fillRect(Math.round(tx + lean * d), Math.round(CANOPY_Y - 20 - d),
                      1 + (k > 0.75 && u < 0.5 ? 1 : 0), 1);
    }
    // a fork on a few of them, nothing more
    if (k > 0.68) {
      for (let d = 0; d < 12; d++) {
        back.g.fillRect(Math.round(tx + lean * hgt - d * 0.6), Math.round(top + d * 0.8), 1, 1);
        back.g.fillRect(Math.round(tx + lean * hgt + d * 0.6), Math.round(top + d * 0.8), 1, 1);
      }
    }
  }

  // three or four saplings — barely registering, there for scale and variety
  for (const [sx, sh] of [[-266, 22], [-96, 18], [86, 26], [268, 20]]) {
    back.g.fillStyle = '#152331';
    for (let d = 0; d < sh; d++) {
      back.g.fillRect(Math.round(x0 + WOOD_PAD + sx + d * 0.10),
                      Math.round(CANOPY_Y - 16 - d), 1, 1);
    }
  }

  // ONE dead tree. Thin, bare, two crooked branches — silhouette variety, and
  // the only thing in the distant layer with a recognisable character.
  {
    const dx = x0 + WOOD_PAD + 168;
    back.g.fillStyle = '#1d2e3e';
    for (let d = 0; d < 74; d++) {
      back.g.fillRect(Math.round(dx + Math.sin(d * 0.05) * 3), Math.round(CANOPY_Y - 18 - d), 1, 1);
    }
    for (const [at, dir, len] of [[46, -1, 20], [58, 1, 15]]) {
      for (let d = 0; d < len; d++) {
        back.g.fillRect(Math.round(dx + dir * d + Math.sin(d * 0.3) * 2),
                        Math.round(CANOPY_Y - 18 - at - d * 0.55), 1, 1);
      }
    }
  }

  // --- deepest forest: cool, near-flat, no readable leaves
  for (let i = 0; i < 30; i++) {
    const k = h1(i * 4.3 + bay * 0.007);
    back.g.fillStyle = k > 0.5 ? '#14212c' : '#172533';
    back.g.fillRect(Math.round(x0 + 40 + k * (w - 80)), Math.round(CANOPY_Y - 58 - k * 22),
                    1 + Math.round(k * 2), 62 + k * 30);
  }
  for (const [gi, [gx, gw]] of CANOPY_GAPS.entries()) {
    const expose = [0.72, 1.0, 0.5][gi];
    const cxg = bay + gx;
    for (let px = cxg - gw * 2; px < cxg + gw * 2; px += 2) {
      const fall = clamp01(1 - Math.abs(px - cxg) / (gw * 1.7));
      for (let py = CANOPY_Y - 76; py < CANOPY_Y + 20; py += 2) {
        const v = fall * clamp01(1 - Math.abs(py - (CANOPY_Y - 28)) / 58);
        if (h1(px * 0.61 + py * 1.13) > v * 0.26 * expose) continue;
        back.g.fillStyle = v > 0.55 ? '#1e3441' : '#172a36';
        back.g.fillRect(px, py, 2, 2);
      }
    }
    // Distant woodland INSIDE the opening: more trunks, tiny branch silhouettes
    // and dark blue-green foliage. The blue keeps its atmospheric value but now
    // says "more forest, further away" instead of "empty sky".
    for (let i = 0; i < 14; i++) {
      const k = h1(i * 5.3 + gx * 0.07);
      const tx = cxg + (k - 0.5) * gw * 2.4;
      back.g.fillStyle = k > 0.55 ? '#223644' : '#1a2c3a';
      back.g.fillRect(Math.round(tx), Math.round(CANOPY_Y - 66 + k * 16), 1, 40 + k * 22);
      if (k > 0.6) {   // a tiny branch off a few of them
        for (let d = 0; d < 7 + k * 6; d++) {
          back.g.fillRect(Math.round(tx + (i % 2 ? d : -d)),
                          Math.round(CANOPY_Y - 50 + k * 12 - d * 0.5), 1, 1);
        }
      }
    }
    back.g.fillStyle = '#162734';
    for (let i = 0; i < 7; i++) {
      const k = h1(i * 3.7 + gx);
      canopyLobe(back.g, cxg + (k - 0.5) * gw * 2.0, CANOPY_Y - 52 + (k - 0.5) * 34,
                 13 + k * 11, 7 + k * 6, i * 2.9 + gx * 0.01, 2);
    }
  }

  const PAL_DEEP = { body: '#16211c', lit: '#1c2a23', deep: '#0f1814', moss: '#182c1c' };
  const PAL_MID  = { body: '#1b2419', lit: '#2c3a2b', deep: '#111710', moss: '#1e3421' };
  const PAL_NEAR = { body: '#2b2a1d', lit: '#584f36', deep: '#15130c', moss: '#33502f' };

  // --- close roughly a third of every opening from the front, with foliage and
  // a branch, so several irregular glimpses survive rather than one clear hole.
  for (const [gi, [gx, gw]] of CANOPY_GAPS.entries()) {
    const cxg = bay + gx;
    front.g.fillStyle = '#182a1d';
    for (let i = 0; i < 3; i++) {
      const k = h1(i * 4.3 + gi * 9.1);
      canopyLobe(front.g, cxg + (k - 0.9) * gw, CANOPY_Y - 34 + (k - 0.5) * 30,
                 12 + k * 10, 7 + k * 6, i * 5.7 + gi, 2);
    }
    limb(front.g, cxg - gw, CANOPY_Y - 44 + gi * 8, gi % 2 ? -0.32 : -2.78,
         gw * 1.5, 4, PAL_DEEP, gi % 2 ? 0.2 : -0.2, 0.05);
  }

  // --- CENTRE: THE DEPTH GROUP.
  //
  // Explicitly NOT another hero tree. Five overlapping medium trunks at
  // different depths — forked, leaning, thin, heavily obscured, broken — with
  // further distant trunks visible between them. This is the primary depth
  // corridor, and it works by layering rather than by being empty.
  {
    const CG = [
      { dx: -46, w: 15, base: 30, top: -30, lean: 0.05, kind: 'fork',  pal: PAL_MID },
      { dx: -8,  w: 11, base: 38, top: 2,   lean: 0.16, kind: 'lean',  pal: PAL_MID },
      { dx: 30,  w: 18, base: 26, top: -44, lean: -0.03, kind: 'fork', pal: PAL_MID },
      { dx: 62,  w: 8,  base: 40, top: 10,  lean: -0.10, kind: 'thin', pal: PAL_DEEP },
      { dx: 96,  w: 13, base: 34, top: -12, lean: 0.07, kind: 'broken', pal: PAL_DEEP },
    ];
    for (let i2 = 0; i2 < CG.length; i2++) {
      const t2 = CG[i2];
      const bx = bay + 18 + t2.dx, bs = CANOPY_Y + t2.base;
      const H5 = bs - t2.top;
      const col = barkTrunk(front.g, bx, bs, t2.top, t2.w, 23.7 + i2 * 4.1, t2.pal, 0.12, t2.lean);
      if (t2.kind === 'fork') {
        branchTree(front.g, col(0.66), bs - 0.66 * H5, -1.10, 30, 5, t2.pal, -0.3, 0.1, 1);
        branchTree(front.g, col(0.72), bs - 0.72 * H5, -2.10, 24, 4, t2.pal, 0.3, 0.1, 0);
      } else if (t2.kind === 'broken') {
        branchTree(front.g, col(0.58), bs - 0.58 * H5, -0.60, 16, 5, t2.pal, 0.2, 0.1, 0);
      }
    }
    // distant trunks glimpsed between them
    for (let i2 = 0; i2 < 8; i2++) {
      const k = h1(i2 * 5.9 + 71);
      front.g.fillStyle = '#1a2c38';
      front.g.fillRect(Math.round(bay - 30 + k * 150), Math.round(CANOPY_Y - 34 + k * 12), 1, 40 + k * 16);
    }
  }

  // --- MIDDLE FOREST.
  //
  // The zone that was missing. V5 had major trees and then deep silhouettes
  // with nothing between, which is why the upper background read as canopy
  // masses over blue rather than as woodland. These are PARTIAL structures —
  // a trunk, sometimes a fork, and a dark crown cluster — deliberately never
  // resolvable as whole trees, and spaced so you cannot tell where one ends
  // and the next begins.
  //
  // The rhythm is trunk | darkness | fork | overlapping foliage | two partial
  // trunks | darkness, never an even row.
  const MID_FOREST = [
    { x: -352, w: 9,  h: 0.62, fork: false, crown: 1 },
    { x: -318, w: 7,  h: 0.44, fork: false, crown: 0 },   // pair, close together
    { x: -246, w: 11, h: 0.78, fork: true,  crown: 1 },
    { x: -168, w: 8,  h: 0.52, fork: false, crown: 1 },
    { x: -20,  w: 12, h: 0.84, fork: true,  crown: 1 },
    { x: 66,   w: 7,  h: 0.40, fork: false, crown: 0 },
    { x: 152,  w: 10, h: 0.70, fork: false, crown: 1 },
    { x: 316,  w: 9,  h: 0.58, fork: true,  crown: 1 },
    { x: 396,  w: 7,  h: 0.46, fork: false, crown: 1 },
  ];
  for (let i = 0; i < MID_FOREST.length; i++) {
    const m = MID_FOREST[i];
    const k = h1(i * 6.7 + 3);
    const base = CANOPY_Y + 34 + k * 10;
    const top = base - (base + 70) * m.h;
    const col = barkTrunk(front.g, bay + m.x, base, top, m.w, i * 3.3 + 1,
                          PAL_DEEP, 0.05, (k - 0.5) * 0.18);
    if (m.fork) {
      limb(front.g, col(0.72), base - 0.72 * (base - top), -1.15, 26, 4, PAL_DEEP, -0.3, 0.05);
      limb(front.g, col(0.78), base - 0.78 * (base - top), -2.05, 22, 3, PAL_DEEP, 0.3, 0.05);
    }
    if (m.crown) {
      front.g.fillStyle = i % 2 ? '#16281c' : '#142519';
      canopyLobe(front.g, bay + m.x + (k - 0.5) * 14, top + 6, 22 + k * 16, 12 + k * 9,
                 i * 4.1 + 7, 2);
    }
  }

  const drawTrees = () => {
  // --- TREE A: left of centre. Base hidden behind bushes, trunk forks, one
  // major branch disappears into canopy.
  {
    const x = bay - 196, base = CANOPY_Y + 40;
    const col = barkTrunk(front.g, x, base, -46, 24, 3.1, PAL_MID, 0.35, -0.03);
    limb(front.g, col(0.58), base - 0.58 * (base + 46), -0.75, 46, 7, PAL_MID, 0.5, 0.2);
    limb(front.g, col(0.70), base - 0.70 * (base + 46), -2.42, 38, 6, PAL_MID, -0.4, 0.2);
  }

  // --- LEFT: THE ANCIENT OAK. The strongest readable tree in the frame.
  // Substantially wider than V8's, flaring into visible roots at the base,
  // rising and dividing into two major limbs — each of which forks again rather
  // than running on as a bar. Canopy merges into the top-left mass; the whole
  // tree is never visible.
  {
    const x = bay - 176, base = CANOPY_Y + 52, top = -80;
    const H3 = base - top;
    const col = barkTrunk(front.g, x, base, top, 48, 7.7, PAL_NEAR, 1.0, 0.02);
    const wAt = (u) => 48 * (1 - u * 0.30);
    barkDetail(front.g, col, wAt, base, H3, 7.7, PAL_NEAR);
    // root flare: the trunk widens sharply into the ground
    for (let d = 0; d < 20; d++) {
      const u = d / 20;
      const fw = 48 + u * 40;
      front.g.fillStyle = u < 0.5 ? PAL_NEAR.body : PAL_NEAR.deep;
      front.g.fillRect(Math.round(x - fw / 2), Math.round(base - 20 + d), Math.round(fw), 1);
    }
    // two major limbs, each a proper hierarchy
    branchTree(front.g, col(0.46), base - 0.46 * H3, -0.86, 74, 16, PAL_NEAR, 0.20, 1, 2);
    branchTree(front.g, col(0.53), base - 0.53 * H3, -2.28, 62, 13, PAL_NEAR, -0.26, 1, 2);
    branchTree(front.g, col(0.68), base - 0.68 * H3, -1.24, 50, 9, PAL_NEAR, 0.16, 1, 1);
    // a broken scar where a third limb used to be
    branchTree(front.g, col(0.34), base - 0.34 * H3, -2.90, 18, 9, PAL_NEAR, 0.1, 0.4, 0);
    // a small hollow
    front.g.fillStyle = '#0c0e08';
    canopyLobe(front.g, col(0.15) + 6, base - 0.15 * H3, 7, 10, 77.1, 2);
    // moss up the shaded side
    front.g.fillStyle = '#3b5233';
    for (let n = 0; n < 46; n++) {
      const u = h1(n * 2.7 + 4) * 0.62;
      front.g.fillRect(Math.round(col(u) - wAt(u) / 2 + h1(n) * 4),
                       Math.round(base - u * H3), 2, 2);
    }
    // 3-4 asymmetric roots into the understory
    for (const [dir, reach, drop] of [[-1, 44, 6], [-1, 26, 12], [1, 52, 4], [1, 30, 10]]) {
      for (let d = 0; d < reach; d++) {
        const u = d / reach;
        if (u > 0.38 && u < 0.54) continue;
        const th = Math.max(2, Math.round(9 * (1 - u * 0.66)));
        front.g.fillStyle = 'rgba(8,10,7,0.34)';
        front.g.fillRect(Math.round(x + dir * (18 + d)), Math.round(base + drop + u * 8 + th), th, 2);
        front.g.fillStyle = u < 0.5 ? PAL_NEAR.body : PAL_NEAR.deep;
        front.g.fillRect(Math.round(x + dir * (18 + d)), Math.round(base + drop + u * 8), th, th);
      }
    }
  }

  // --- RIGHT: THE TWISTED GROUP. V8's right third was noticeably less composed
  // than its left. The twisted tree is now genuinely readable — medium-large,
  // leaning toward the clearing, with a crooked fork and a dead limb — and it
  // is backed by two darker secondaries so the side reads as a group rather
  // than one lonely trunk. Still clearly subordinate to the Oak.
  const PAL_RIGHT = { body: '#1e2318', lit: '#5d6442', deep: '#10130b', moss: '#2a4530' };
  {
    const x = bay + 232, base = CANOPY_Y + 44, top = -60;
    const H4 = base - top;
    const col = barkTrunk(front.g, x, base, top, 28, 11.3, PAL_RIGHT, 0.86, -0.13);
    const wAt = (u) => 28 * (1 - u * 0.30);
    barkDetail(front.g, col, wAt, base, H4, 11.3, PAL_RIGHT);
    branchTree(front.g, col(0.44), base - 0.44 * H4, -1.46, 46, 11, PAL_RIGHT, -0.66, 0.7, 1);
    branchTree(front.g, col(0.60), base - 0.60 * H4, -2.52, 54, 9, PAL_RIGHT, 0.44, 0.7, 1);
    // one dead limb, bare and crooked
    branchTree(front.g, col(0.74), base - 0.74 * H4, -0.50, 34, 5, PAL_MID, 0.55, 0.2, 0);
    // two darker secondaries standing behind it
    // Second focal trunk. Offsets render twice — at screen (o - 20) for the near bay
    // and (o + 240) for the next one — so only offsets in 80..240 reach the right
    // third of the frame. 196 does; 330 landed mid-frame and off-screen, which is
    // why the first attempt at this fix never touched the side it was aimed at.
    {
      const x2 = bay + 196, b2 = CANOPY_Y + 46, t2 = -40;
      const c2 = barkTrunk(front.g, x2, b2, t2, 22, 41.9, PAL_RIGHT, 0.55, 0.07);
      const w2 = (u) => 22 * (1 - u * 0.30);
      barkDetail(front.g, c2, w2, b2, b2 - t2, 41.9, PAL_RIGHT);
      branchTree(front.g, c2(0.52), b2 - 0.52 * (b2 - t2), -1.28, 38, 8, PAL_RIGHT, -0.44, 0.5, 1);
      branchTree(front.g, c2(0.70), b2 - 0.70 * (b2 - t2), -2.10, 34, 6, PAL_RIGHT, 0.50, 0.4, 1);
    }
    // A third, slimmer trunk at 150 -> screen 130 / 390, breaking up the flat void
    // that sat between the two focal trunks on the right.
    {
      const x3 = bay + 150, b3 = CANOPY_Y + 38, t3 = -10;
      const c3 = barkTrunk(front.g, x3, b3, t3, 14, 53.1, PAL_RIGHT, 0.34, -0.10);
      const w3 = (u) => 14 * (1 - u * 0.28);
      barkDetail(front.g, c3, w3, b3, b3 - t3, 53.1, PAL_RIGHT);
      branchTree(front.g, c3(0.62), b3 - 0.62 * (b3 - t3), -1.90, 26, 5, PAL_MID, 0.38, 0.3, 0);
    }
    // 288 sits mid-frame only; keep it quiet so it stops competing.
    barkTrunk(front.g, bay + 288, CANOPY_Y + 40, -18, 13, 31.7, PAL_MID, 0.12, 0.09);
  }

  };

  // --- THE CANOPY. Every rank hangs from canopyBottom(), so the mass has an
  // organic lower silhouette instead of a level band. Three closely related
  // values give it volume without any gradient.
  const rank = (col, lift, ryS, row) => {
    front.g.fillStyle = col;
    for (let px = x0 + 8; px < x0 + w - 8; px += 12) {
      if (gapAt(px) > 0.25) continue;
      const k = h1(px * 0.037 + row * 5.1);
      const rx = 32 + k * 34;
      const ry = (17 + k * 15) * ryS;
      // hangs from the curve, rising by rank. The canopy also lifts locally
      // over the hero tree, opening a window through which its trunk, fork and
      // branch are actually legible — and breaking the ceiling while it does.
      const heroLift = 34 * Math.exp(-Math.pow((px - (bay - 108)) / 62, 2));
      // Edge weight without a vignette: the canopy hangs lower and heavier
      // toward the frame's outer thirds, letting the centre breathe.
      const edge = clamp01((Math.abs(px - bay) - 150) / 200) * 22;
      const yy = canopyBottom(px) - ry * 0.55 - lift - heroLift + edge + (k - 0.5) * 14;
      canopyLobe(front.g, px + (k - 0.5) * 20, yy, rx, ry, px * 0.11 + row, 2);
    }
  };
  rank('#16281c', 44, 1.05, 0);      // deepest foliage, furthest up
  rank('#1a2f20', 22, 0.98, 1);      // normal shadow foliage
  drawTrees();                        // <- anatomy sits inside the canopy
  rank('#1e3524', 2, 0.86, 2);       // restrained exposed foliage
  rank('#274630', -4, 0.52, 4);   // nearest foliage, the only lit value      // forward canopy, the lightest of the three,
                                     // used sparingly for volume
  rank('#182a1d', -14, 0.70, 3);     // shadowed underside, dipping lowest

  // --- hanging foliage descending BETWEEN trunks, several of it nearly to the
  // bush line. This is what removes the last of the canopy / dark gap / bushes
  // banding: the layers are now stitched together vertically.
  for (const [hx, depth, val] of [[-300, 62, '#16281b'], [-214, 34, '#1a2f1f'],
                                  [-64, 74, '#152619'], [42, 40, '#1a2f1f'],
                                  [136, 66, '#16281b'], [284, 44, '#182b1d'],
                                  [364, 30, '#1a2f1f']]) {
    const px = bay + hx;
    front.g.fillStyle = val;
    const top = canopyBottom(px);
    for (let d = 0; d < depth; d += 11) {
      const k = h1(px * 0.07 + d);
      canopyLobe(front.g, px + (k - 0.5) * 16, top + d,
                 15 - d * 0.10 + k * 8, 9 - d * 0.05 + k * 5, px * 0.13 + d, 2);
    }
  }

  // hanging masses that dip well below the general edge in a few places only
  front.g.fillStyle = '#16281b';
  for (let px = x0 + 24; px < x0 + w - 24; px += 53) {
    const k = h1(px * 0.061 + 29);
    if (gapAt(px) > 0.15 || k < 0.52) continue;
    canopyLobe(front.g, px, canopyBottom(px) + 14 + k * 18, 17 + k * 15, 11 + k * 10, px * 0.19, 2);
  }
  // and recesses bitten out, so the edge dips as well as bulges
  front.g.save();
  front.g.globalCompositeOperation = 'destination-out';
  for (let px = x0 + 40; px < x0 + w - 40; px += 67) {
    const k = h1(px * 0.041 + 17);
    if (k < 0.55) continue;
    canopyLobe(front.g, px, canopyBottom(px) - 6 - k * 12, 22 + k * 16, 13 + k * 10, px * 0.29, 2);
  }
  front.g.restore();

  // --- four named silhouette events, so the ceiling has incident rather than
  // just texture: a hanging branch, a downward foliage mass, a small gap and a
  // broken branch stub against the sky.
  {
    limb(front.g, bay - 236, CANOPY_Y - 30, 0.42, 40, 5, PAL_MID, 0.3, 0.2);   // hanging
    front.g.fillStyle = '#182b1c';
    canopyLobe(front.g, bay + 74, canopyBottom(bay + 74) + 26, 20, 15, 44.1, 2);  // downward mass
    front.g.save();
    front.g.globalCompositeOperation = 'destination-out';
    canopyLobe(front.g, bay - 46, canopyBottom(bay - 46) - 20, 15, 10, 51.7, 2); // small gap
    front.g.restore();
    limb(front.g, bay + 172, CANOPY_Y - 48, -0.55, 26, 5, PAL_MID, -0.5, 0.2);  // broken stub
  }

  // --- two isolated downward middle-canopy masses, one behind the left ancient
  // trunk and one centre-right. Deliberately not a band: two shapes only.
  for (const [hx, dep] of [[-146, 54], [188, 44]]) {
    const px = bay + hx;
    front.g.fillStyle = '#152618';
    for (let d = 0; d < dep; d += 12) {
      const k = h1(px * 0.09 + d);
      canopyLobe(front.g, px + (k - 0.5) * 14, canopyBottom(px) + 10 + d,
                 17 - d * 0.12 + k * 7, 10 - d * 0.06 + k * 4, px * 0.17 + d, 2);
    }
  }

  // --- five branch events across the whole width. Structural clues only: each
  // emerges from foliage and disappears back into it.
  for (const [bx, by, ang, len, wid, cur] of [
    [-268, -34, -0.72, 40, 5, 0.40], [-124, -52, -2.36, 34, 4, -0.36],
    [12, -20, -0.58, 44, 5, -0.34], [188, -44, -2.20, 38, 4, 0.42],
    [330, -28, -0.86, 32, 4, 0.30]]) {
    branchTree(front.g, bay + bx, CANOPY_Y + by, ang, len, wid, PAL_MID, cur, 0.1, 1);
  }

  // --- near branches drawn LAST, crossing in front of the distant trunks and
  // the depth windows. Overlap across planes is what produces parallax depth in
  // a still frame; without it every branch sits at the same distance.
  for (const [bx, by, ang, len, wid, cur] of [
    [-96, -58, -0.62, 68, 6, -0.34],
    [88, -30, -2.52, 58, 5, 0.36],
    [206, -62, -0.80, 46, 5, 0.30]]) {
    branchTree(front.g, bay + bx, CANOPY_Y + by, ang, len, wid, PAL_NEAR, cur, 0.45, 1);
  }

  // selective light: a few lower canopy edges only, never a rim on everything
  front.g.fillStyle = '#2c4a33';
  for (let px = x0 + 30; px < x0 + w - 30; px += 79) {
    const k = h1(px * 0.033 + 41);
    if (gapAt(px) > 0.1 || k < 0.6) continue;
    canopyLobe(front.g, px, canopyBottom(px) - 2, 13 + k * 10, 5 + k * 4, px * 0.37, 2);
  }

  // --- ONE fallen trunk, lying diagonally back into the woodland on the right.
  // Horizontal structure, which the background had none of, and it reinforces
  // that there is a floor back there for something to have fallen onto.
  {
    const fx = bay + 196, fy = CANOPY_Y + 34;
    for (let d = 0; d < 74; d++) {
      const u = d / 74;
      const th = Math.max(2, Math.round(9 * (1 - u * 0.55)));
      const xx = fx + d * 0.92, yy = fy - d * 0.42;
      front.g.fillStyle = 'rgba(8,12,8,0.34)';
      front.g.fillRect(Math.round(xx), Math.round(yy + th), th, 2);
      front.g.fillStyle = u < 0.45 ? '#2b2a1e' : '#1e1e15';
      front.g.fillRect(Math.round(xx), Math.round(yy), th, th);
      if (u < 0.5 && h1(d * 2.3) > 0.62) {          // moss along the upper side
        front.g.fillStyle = '#2d4a2c';
        front.g.fillRect(Math.round(xx), Math.round(yy), th - 1, 2);
      }
    }
  }

  // --- ONE ruin remnant. Off-centre, near the rear edge, and drawn procedurally
  // so it can be broken exactly as much as it needs to be. Roughly two thirds of
  // it sits below the approved bush line, which paints over it afterwards — the
  // player should find this after looking, not notice it during a fight.
  // Deliberately not a shrine, wall or gate: two broken column stubs and a
  // fallen fragment, with a root crossing them. Civilisation, then forest.
  {
    const rx = bay + 132, ry = CANOPY_Y + 26;
    const STONE = '#3a3d34', STONE_D = '#23261f', STONE_L = '#4a4d41';
    // taller stub, jagged break at the top
    for (let d = 0; d < 26; d++) {
      const ww = 9 - Math.floor(d / 14);
      front.g.fillStyle = d < 3 ? STONE_D : STONE;
      front.g.fillRect(Math.round(rx - ww / 2), Math.round(ry - d), ww, 1);
      front.g.fillStyle = STONE_L;
      front.g.fillRect(Math.round(rx - ww / 2), Math.round(ry - d), 1, 1);
      if (d > 20 && h1(d * 3.1) > 0.5) {          // ragged break
        front.g.clearRect(Math.round(rx - ww / 2), Math.round(ry - d), ww, 1);
      }
    }
    // shorter second stub, and a fallen fragment lying between them
    for (let d = 0; d < 13; d++) {
      front.g.fillStyle = d < 2 ? STONE_D : STONE;
      front.g.fillRect(Math.round(rx + 19), Math.round(ry - d), 7, 1);
    }
    front.g.fillStyle = STONE_D;
    front.g.fillRect(Math.round(rx + 6), Math.round(ry - 3), 13, 4);
    front.g.fillStyle = STONE;
    front.g.fillRect(Math.round(rx + 7), Math.round(ry - 4), 11, 2);
    // moss taking the stone
    front.g.fillStyle = '#25401f';
    for (let n = 0; n < 22; n++) {
      const k = h1(n * 2.9 + 5);
      front.g.fillRect(Math.round(rx - 6 + k * 34), Math.round(ry - 2 - h1(n * 1.7) * 20), 2, 2);
    }
    // ONE root crossing the ruin — the forest reclaiming it, made literal
    for (let d = 0; d < 62; d++) {
      const u = d / 62;
      if (u > 0.40 && u < 0.52) continue;         // dips under
      const th = Math.max(1, Math.round(5 * (1 - u * 0.6)));
      const yy = ry - 16 + u * 22 + Math.sin(u * 4.2) * 5;
      front.g.fillStyle = 'rgba(9,16,12,0.34)';
      front.g.fillRect(Math.round(rx - 14 + d), Math.round(yy + th), th, 2);
      front.g.fillStyle = u < 0.5 ? '#2a3324' : '#1e261b';
      front.g.fillRect(Math.round(rx - 14 + d), Math.round(yy), th, th);
    }
  }

  // --- SPARSE UNDERSTORY. The composition jumped straight from bushes to giant
  // trees; these are the connectors. Saplings, thin shrubs and fern silhouettes,
  // all dark — depth information, not decoration.
  for (let i2 = 0; i2 < 22; i2++) {
    const k = h1(i2 * 3.7 + 53);
    const ux = bay - 400 + k * 800;
    const uy = CANOPY_Y + 26 + h1(i2 * 2.3) * 14;
    if (k > 0.66) {                                   // a sapling
      front.g.fillStyle = '#1b2a1c';
      for (let d = 0; d < 12 + k * 10; d++) {
        front.g.fillRect(Math.round(ux + d * 0.09), Math.round(uy - d), 1, 1);
      }
    } else {                                          // a low shrub / fern mass
      front.g.fillStyle = k > 0.4 ? '#18291b' : '#142317';
      canopyLobe(front.g, ux, uy, 9 + k * 9, 5 + k * 5, i2 * 4.3 + 3, 2);
    }
  }

  // ===================== FOREST FLOOR ==================================
  //
  // The single change V8 turns on. Every version so far treated the area behind
  // the bushes as a wall of foliage; there was no ground back there, so there
  // was nowhere to walk. Three irregular glimpses of shadowed forest floor now
  // recede between the trunks, each darkening with depth, so the brain reads
  // physical space rather than a painted backdrop.
  //
  // Drawn into the front canvas at the bush line's own height, so the approved
  // bushes crop them into glimpses rather than a continuous strip.
  for (const [fx, fw, deep, stone] of [[-286, 38, 0.9, false],
                                       [-152, 52, 1.05, false],
                                       [40, 66, 1.2, true],
                                       [244, 44, 0.85, false]]) {
    const cx = bay + fx;
    // the floor recedes: a wedge narrowing and darkening as it goes back
    for (let d = 0; d < 44; d++) {
      const u = d / 44;                       // 0 near, 1 deep
      const half = fw * (1 - u * 0.55) * 0.5;
      const yy = CANOPY_Y + 30 - d * 1.05 * deep;
      // warm mossy earth at the front, cooling and darkening backward
      const r = Math.round(52 - u * 34), gg = Math.round(50 - u * 30), b = Math.round(32 - u * 10);
      front.g.fillStyle = `rgb(${r},${gg},${b})`;
      for (let px = cx - half; px < cx + half; px += 2) {
        // ragged edges, and holes where undergrowth stands in the way
        if (h1(px * 0.37 + d * 1.7) > 0.86 - u * 0.25) continue;
        front.g.fillRect(Math.round(px), Math.round(yy), 2, 2);
      }
      // moss and grass catching the light at the near end only
      if (u < 0.35 && d % 3 === 0) {
        front.g.fillStyle = '#2c4a2b';
        for (let n = 0; n < 4; n++) {
          const k = h1(d * 3.1 + n * 2.7 + fx);
          front.g.fillRect(Math.round(cx + (k - 0.5) * half * 1.7), Math.round(yy), 2, 2);
        }
      }
    }
    // roots running back into the glimpse, disappearing into shadow
    for (let r = 0; r < 3; r++) {
      const k = h1(fx * 0.11 + r * 3.3);
      const dir = r % 2 ? 1 : -1;
      for (let d = 0; d < 22; d++) {
        const u = d / 22;
        if (u > 0.45 && u < 0.62) continue;
        const yy = CANOPY_Y + 28 - d * 0.9 * deep;
        front.g.fillStyle = u < 0.5 ? '#2a2a1c' : '#1b1b12';
        front.g.fillRect(Math.round(cx + dir * (6 + d)), Math.round(yy), 2, 2);
      }
    }
    // one low stone, in the central glimpse only
    if (stone) {
      front.g.fillStyle = '#2f3128';
      canopyLobe(front.g, cx + 14, CANOPY_Y + 6, 7, 4, 61.3, 2);
      front.g.fillStyle = '#3b3d33';
      front.g.fillRect(Math.round(cx + 10), Math.round(CANOPY_Y + 4), 5, 2);
    }
  }

  // --- roots into the approved bush layer, which paints over them afterwards
  for (const [rx0, ry0, wR, sd] of [[bay - 196, CANOPY_Y + 40, 24, 3.1],
                                    [bay - 54, CANOPY_Y + 44, 34, 7.7],
                                    [bay + 214, CANOPY_Y + 36, 21, 11.3]]) {
    for (let r = 0; r < 4; r++) {
      const k = h1(sd * 3.7 + r * 2.9);
      const dir = r % 2 ? 1 : -1;
      const reach = 26 + k * 32;
      for (let d = 0; d < reach; d++) {
        const u = d / reach;
        if ((u > 0.30 && u < 0.46) || (u > 0.68 && u < 0.82)) continue;
        const th = Math.max(1, Math.round((wR * 0.18) * (1 - u * 0.7)));
        const yy = ry0 + 2 + u * 10 + Math.sin(u * 5 + k * 6) * 3;
        front.g.fillStyle = 'rgba(9,16,12,0.30)';
        front.g.fillRect(Math.round(rx0 + dir * d), Math.round(yy + th), th, 2);
        front.g.fillStyle = u < 0.5 ? '#232a1f' : '#1b2118';
        front.g.fillRect(Math.round(rx0 + dir * d), Math.round(yy), th, th);
      }
    }
    front.g.fillStyle = '#22381f';
    for (let n = 0; n < 24; n++) {
      const k = h1(sd + n * 1.9);
      front.g.fillRect(Math.round(rx0 + (k - 0.5) * wR * 1.5),
                       Math.round(ry0 - 2 + h1(n * 3.1) * 5), 2, 2);
    }
  }

  const out = { back: back.c, front: front.c, x0, y0: WOOD_TOP };
  WOOD_CACHE.set(bay, out);
  return out;
}

function woodland(g, camX, W, bay, t) {
  const wd = woodlandFor(bay);
  if (!wd) return;
  g.drawImage(wd.back, wd.x0, wd.y0);
  const sway = Math.round(Math.sin(t * 0.42) * 1.4);
  g.drawImage(wd.front, wd.x0 + sway, wd.y0);
}

// ================== THE CONTINUOUS WORLD ================================
//
// One world, walked end to end: Forest -> Thornkeep -> the keep wall, with the
// palace to follow. The art arrives as three plates (assets/zone_*.png, cut
// from "goblin map pre king.jpeg"), scaled by a SINGLE factor and drawn on a
// SINGLE baseline, because plates aligned differently cannot be blended — the
// horizon would step at every crossing.
//
// There is deliberately no transition event, and no coordinate at which one
// place becomes the next. Each plate carries a tent weight peaking at its own
// centre and falling to zero at its neighbour's, so at every world x the frame
// is a weighted mix of two plates and the mixture changes on every column.
// Nothing keys off gates, waves or scene state: walk the same stretch twice and
// you get the same picture, because the only input is position.
//
// Compositing: plates are drawn left to right, each masked by a horizontal
// ramp rising 0 -> 1 across the gap behind it and holding at 1 thereafter.
// Painted in that order the result is exactly A*(1-t) + B*t at every column,
// with one gradient per plate rather than a per-column loop.
// Wave 1 is the arena as approved — its own backdrop, its own grass, its own
// bush line. Waves 2 and 3 are the authored plates, which are whole
// battlefields. The plates were re-cut to WAVE 1's baseline rather than the
// reverse: the approved picture does not move to accommodate new art.
//
// Centres sit on the wave camera centres (gate.x - W/2 + W/2), so each fight
// lands in its own place while the ground between them keeps changing.
const ZONES = [
  { cx: 240, src: 'assets/forest_bg.png', plate: false },
  { cx: 480, src: 'assets/zone_thornkeep.png', plate: true },
  { cx: 740, src: 'assets/zone_keepwall.png', plate: true },
];
const ART_TOP = 0;
const ART_K = 1.06;              // the mirrored flanks are not copies
const ART_SHEAR = 0.05;
const ART_GROUND = 121;          // every plate's grass line, = the arena's edgeY

for (const z of ZONES) { z.img = new Image(); z.img.src = z.src; z.bake = null; }

// [mirrored][plate][mirrored], anchored so the plate itself is centred on the
// zone. A zone reaches +/-370, the bake reaches +/-771, so nothing repeats
// inside a zone and the mirror axes fall at +/-257 — outside the 480 frame
// when the camera parks on the centre for a fight.
function zoneBake(z) {
  if (z.bake) return z.bake;
  if (!z.img.complete || !z.img.naturalWidth) return null;
  const h = z.img.naturalHeight;
  const pw = z.img.naturalWidth;
  z.w = pw;
  const c = document.createElement('canvas');
  c.width = pw * 3; c.height = Math.ceil(h * ART_K) + 8;
  const q = c.getContext('2d');
  q.imageSmoothingEnabled = false;
  const flank = (originX, dir) => {
    q.save();
    q.translate(originX, 0);
    q.scale(dir, 1);
    q.translate(0, ART_GROUND);
    q.transform(1, 0, ART_SHEAR * dir, 1, 0, 0);
    q.scale(1, ART_K);
    q.translate(0, -ART_GROUND);
    q.drawImage(z.img, 0, 0);
    q.restore();
  };
  flank(pw, -1);                            // left flank, mirrored
  q.drawImage(z.img, pw, 0);                // the plate, unaltered
  flank(pw * 2, 1);                         // right flank, mirrored back
  z.bake = c;
  return c;
}

// Blending two finished paintings with an alpha ramp averages them, and an
// average has neither picture's contrast: the keep wall went translucent with
// forest trunks showing through it, and the grass and the courtyard met in a
// milky band. Both read as bad lighting, because losing contrast is what bad
// lighting looks like.
//
// So the crossover is a DISSOLVE, not a fade. Every pixel belongs wholly to one
// plate or the other, so each keeps its own values, and the changeover is
// carried by how much area each one owns. The noise is clustered rather than
// per-pixel, so it breaks into patches — grass giving way to bare earth the way
// ground actually wears through — instead of television static.
//
// The mask is baked in WORLD space and cached: the band never moves, so the
// same dissolve is reused every frame and the pattern does not crawl as the
// camera pans.
const MASK_CACHE = new Map();

// 2D value noise, INTERPOLATED between cells. Sampling the hash per cell gives
// hard rectangular plateaus, and against two different paintings those read as
// broken tiles rather than as one place becoming another — the same mistake the
// clearing edge had to have corrected out of it.
function vnoise(x, y, cell, seed) {
  const gx = x / cell, gy = y / cell;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = gx - ix, fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h1(ix * 2.7 + iy * 7.1 + seed);
  const b = h1((ix + 1) * 2.7 + iy * 7.1 + seed);
  const c = h1(ix * 2.7 + (iy + 1) * 7.1 + seed);
  const d = h1((ix + 1) * 2.7 + (iy + 1) * 7.1 + seed);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function dissolveMask(w, h, seed) {
  const key = `${w}x${h}:${seed}`;
  if (MASK_CACHE.has(key)) return MASK_CACHE.get(key);
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = h;
  const q = c.getContext('2d');
  const img = q.createImageData(c.width, h);
  const d = img.data;
  const FEATHER = 0.055;          // a few px of blend at a patch edge, no more
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < c.width; x++) {
      const u = c.width > 1 ? x / (c.width - 1) : 0;
      const n = vnoise(x, y, 34, seed) * 0.52
              + vnoise(x, y, 15, seed + 3) * 0.30
              + vnoise(x, y, 6, seed + 9) * 0.18;
      const a = clamp01((n - u) / FEATHER + 0.5);
      d[(y * c.width + x) * 4 + 3] = Math.round(a * 255);
    }
  }
  q.putImageData(img, 0, 0);
  MASK_CACHE.set(key, c);
  return c;
}

// The frame-sized mask for one crossover: solid on the side that has fully
// taken over, the dissolve through the band, nothing beyond.
let MASK_SCRATCH = null;
function frameMask(camX, W, H, bandA, bandB, seed, solidAfter) {
  if (!MASK_SCRATCH) MASK_SCRATCH = document.createElement('canvas');
  if (MASK_SCRATCH.width !== W || MASK_SCRATCH.height !== H) {
    MASK_SCRATCH.width = W; MASK_SCRATCH.height = H;
  }
  const q = MASK_SCRATCH.getContext('2d');
  q.setTransform(1, 0, 0, 1, 0, 0);
  q.clearRect(0, 0, W, H);
  q.fillStyle = '#000';
  if (solidAfter) q.fillRect(bandB - camX, 0, W - (bandB - camX), H);
  else            q.fillRect(0, 0, bandA - camX, H);
  // The mask is built opaque at u=0 and clear at u=1. A layer that is TAKING
  // OVER to the right therefore needs it mirrored; one that is GIVING WAY to
  // the right takes it as built. Getting this backwards put a hard edge at each
  // band boundary, where the reversed ramp met the solid fill.
  const m = dissolveMask(Math.round(bandB - bandA), H, seed);
  q.save();
  if (solidAfter) {
    q.translate(bandB - camX, 0); q.scale(-1, 1);
    q.drawImage(m, 0, 0);
  } else {
    q.drawImage(m, bandA - camX, 0);
  }
  q.restore();
  return MASK_SCRATCH;
}

let ZONE_SCRATCH = null;
function scratchFor(W, H) {
  if (!ZONE_SCRATCH) { ZONE_SCRATCH = document.createElement('canvas'); }
  if (ZONE_SCRATCH.width !== W || ZONE_SCRATCH.height !== H) {
    ZONE_SCRATCH.width = W; ZONE_SCRATCH.height = H;
  }
  return ZONE_SCRATCH;
}

// How much of zone i is showing at world x — the value the ground and the
// lighting read too, so every layer crosses over together.
function zoneMix(wx) {
  if (wx <= ZONES[0].cx) return { i: 0, j: 0, t: 0 };
  for (let i = 0; i < ZONES.length - 1; i++) {
    if (wx < ZONES[i + 1].cx) {
      const a = ZONES[i].cx, b = ZONES[i + 1].cx;
      return { i, j: i + 1, t: clamp01((wx - a) / (b - a)) };
    }
  }
  const last = ZONES.length - 1;
  return { i: last, j: last, t: 0 };
}

// The woodland edge thins out as the forest gives way to the keep. Wave 1 is
// framed by it as approved; by waves 2 and 3 it is gone, and the wall meets
// open ground instead of hiding behind a hedge.
//
// Ramped on world x rather than switched per wave, for the same reason as
// everything else here: waves 1 and 2 share the stretch from 240 to 480, so a
// per-wave rule would have to draw that ground two different ways. A ramp has
// one answer per coordinate and no edge to find.
const BUSH_FULL = 300, BUSH_GONE = 500;
function bushDensity(wx) {
  return 1 - clamp01((wx - BUSH_FULL) / (BUSH_GONE - BUSH_FULL));
}

// ---------------------------------------------------------------- the hall
//
// The boss arena is not another stretch of the walk: it is a bounded room, so
// it does not blend with anything and nothing outdoors leaks into it. No
// forest floor, no clearing edge, no bush line, no zone mix — the plate is the
// whole picture, and the fight happens on its flagstones.
//
// Anchored so the room is centred on the parked camera rather than tiled: a
// room that repeats is not a room.
const ARENA_IMG = new Image();
ARENA_IMG.src = 'assets/zone_arena.png';
const ARENA_W = 575;
const ARENA_ANCHOR = 920;                  // camX the boss gate parks at

function drawArena(g, camX, W, H, t, awake) {
  if (!ARENA_IMG.complete || !ARENA_IMG.naturalWidth) {
    rect(g, camX, 0, W, H, '#171a1e');
    return;
  }
  // Right-aligned rather than centred: the throne dais is at the room's right
  // end, and centring pushed it off the frame. The left wall's shelves are the
  // cheaper thing to lose.
  const x0 = ARENA_ANCHOR + W - ARENA_W;
  // The stone is carried well past the room in both directions BEFORE the plate
  // is drawn. Filling only to the frame edge worked while the camera was fixed;
  // the cinematic zooms and pans, so a fill sized to the gameplay frame leaves a
  // black band exactly when the camera goes looking for the walls.
  rect(g, x0 - 700, 0, 700, H, '#14171b');
  rect(g, x0 + ARENA_W - 1, 0, 700, H, '#14171b');
  g.drawImage(ARENA_IMG, x0, 0);
  // torchlight breathing, the only motion in the room
  const puls = 0.09 + Math.sin(t * 1.7) * 0.02 + Math.sin(t * 3.1 + 1.3) * 0.012;
  g.fillStyle = `rgba(120,64,22,${puls})`;
  g.fillRect(camX, 0, W, H);
  const vig = g.createRadialGradient(camX + W / 2, 150, 110, camX + W / 2, 150, 360);
  vig.addColorStop(0, 'rgba(4,6,10,0)');
  vig.addColorStop(1, `rgba(4,6,10,${0.42 + clamp01(awake || 0) * 0.10})`);
  g.fillStyle = vig;
  g.fillRect(camX, 0, W, H);
}

function forestArt(g, camX, W, H) {
  for (const z of ZONES) if (!zoneBake(z)) return false;
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    const bakeX = z.cx - z.w * 1.5;
    if (bakeX > camX + W || bakeX + z.w * 3 < camX) continue;
    if (i === 0) { g.drawImage(z.bake, bakeX, ART_TOP); continue; }
    const prev = ZONES[i - 1].cx, span = z.cx - prev;
    const aL = clamp01((camX - prev) / span);
    const aR = clamp01((camX + W - prev) / span);
    if (aR <= 0) continue;
    if (aL >= 1) { g.drawImage(z.bake, bakeX, ART_TOP); continue; }
    const sc = scratchFor(W, H), q = sc.getContext('2d');
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.clearRect(0, 0, W, H);
    q.imageSmoothingEnabled = false;
    q.drawImage(z.bake, bakeX - camX, ART_TOP);
    q.globalCompositeOperation = 'destination-in';
    q.drawImage(frameMask(camX, W, H, prev, z.cx, 17 + i * 41, true), 0, 0);
    q.globalCompositeOperation = 'source-over';
    g.drawImage(sc, camX, 0);
  }
  return true;
}

// Per-zone lighting and ground. Both read the SAME zoneMix the backdrop does,
// sampled at the frame centre, so the light and the earth turn over together
// with the picture instead of one lagging the other. Sampling at the centre
// makes them a function of camera position alone — continuous as you walk, and
// with no coordinate at which anything switches.
//
// The wash is far lighter than it was for the old procedural forest: these
// plates are authored art carrying their own depth, and the heavy pass that
// rescued a flat generated backdrop simply buried them.
const ZONE_LOOK = [
  { drop: 0.12, cool: 0.13, warm: 0.00, vig: 0.34, tint: '#000000', earth: 0.00 },
  { drop: 0.11, cool: 0.09, warm: 0.04, vig: 0.33, tint: '#5a5f34', earth: 0.10 },
  { drop: 0.09, cool: 0.03, warm: 0.11, vig: 0.31, tint: '#6b6238', earth: 0.26 },
];
function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}
function lookAt(wx) {
  const m = zoneMix(wx);
  const A = ZONE_LOOK[m.i], B = ZONE_LOOK[m.j], t = m.t;
  const L = (k) => A[k] + (B[k] - A[k]) * t;
  return { drop: L('drop'), cool: L('cool'), warm: L('warm'), vig: L('vig'),
           earth: L('earth'), tint: mixHex(A.tint, B.tint, t) };
}

// The procedural ground is wave 1's floor, and only wave 1's. The zone plates
// are whole battlefields — their own dirt, paving and courtyard are painted in
// — so past the forest the grass is faded out and the plate's floor is simply
// what you stand on. Same ramp as the bushes, because the woodland floor and
// the woodland edge have to leave together or the join shows.
function groundFade(g, camX, W, H) {
  const aL = bushDensity(camX), aR = bushDensity(camX + W);
  if (aL <= 0.01 && aR <= 0.01) return;          // deep in the keep: plate only
  if (aL >= 0.99 && aR >= 0.99) { battlefield(g, camX, W, H); return; }
  const sc = scratchFor(W, H), q = sc.getContext('2d');
  q.setTransform(1, 0, 0, 1, 0, 0);
  q.clearRect(0, 0, W, H);
  q.imageSmoothingEnabled = false;
  q.save();
  q.translate(-camX, 0);
  battlefield(q, camX, W, H);
  q.restore();
  q.globalCompositeOperation = 'destination-in';
  q.drawImage(frameMask(camX, W, H, BUSH_FULL, BUSH_GONE, 5, false), 0, 0);
  q.globalCompositeOperation = 'source-over';
  g.drawImage(sc, camX, 0);
}

function backdropMood(g, camX, W, boss, H) {
  const L = lookAt(camX + W / 2);
  const k = boss ? 0.45 : 1;
  // These used to be flat rects stopping at y=180. That was invisible while the
  // grass was painted over the join; now the plates carry their own ground, it
  // printed a hard dark line straight across the battlefield — measured a 16
  // luminance step against a median of 1. Each wash now holds full strength to
  // the tree line and eases out through the field, so the light falls off
  // instead of ending, and the playable floor keeps its brightness.
  const BOT = H;
  const wash = (rgb, a) => {
    if (a <= 0.002) return;
    const grad = g.createLinearGradient(0, 0, 0, BOT);
    grad.addColorStop(0, `rgba(${rgb},${a})`);
    grad.addColorStop(150 / BOT, `rgba(${rgb},${a})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(camX, 0, W, BOT);
  };
  wash('4,10,10', L.drop * k);
  wash('24,44,58', L.cool * k);                       // forest reads cold
  wash('96,60,26', L.warm * k);                       // the keep reads torchlit
  // The vignette is the half doing compositional rather than tonal work: it
  // holds the eye centre-frame and stops a tiled backdrop reading as a strip.
  const vig = g.createRadialGradient(camX + W / 2, DEPTH_MAX - 30, 90,
                                     camX + W / 2, DEPTH_MAX - 30, 330);
  vig.addColorStop(0, 'rgba(3,9,8,0)');
  vig.addColorStop(1, `rgba(3,9,8,${L.vig * k})`);
  g.fillStyle = vig;
  g.fillRect(camX, 0, W, BOT);
}

// The floor turning from woodland to beaten earth. Applied as a wash rather
// than by swapping tiles: the clearing, its edge curve and its wear are all
// approved work, and a wash shifts the material without disturbing any of it.
// Zero at the forest by construction, so wave 1 is untouched.
function zoneGround(g, camX, W, H) {
  const steps = 8;
  const grad = g.createLinearGradient(camX, 0, camX + W, 0);
  let any = false;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const L = lookAt(camX + u * W);
    if (L.earth > 0.002) any = true;
    const c = L.tint;
    grad.addColorStop(u, `rgba(${c.slice(4, -1)},${L.earth})`);
  }
  if (!any) return;
  g.fillStyle = grad;
  g.fillRect(camX, GROUND_TOP, W, H - GROUND_TOP);
}

function forestFloor(g, camX, W) {
  g.fillStyle = '#16262e';
  for (let sx = -2; sx < W + 2; sx += 2) {
    const wx = camX + sx;
    const top = CANOPY_Y - 60;
    const bot = edgeY(wx) + 4;
    g.fillRect(wx, top, 2, bot - top);
    // dithered rim so the forest floor meets the grass on a ragged edge
    for (let d = 0; d < 14; d += 2) {
      if (h1(wx * 0.29 + d * 2.3) > 0.5 - d * 0.03) continue;
      g.fillRect(wx, bot + d, 2, 2);
    }
  }
}

// Three interruptions in the approved bush boundary, and what shows through
// them. Sized to take roughly 18% of the run, so the boundary itself is intact
// — the point is that a continuous hedge reads as a wall, and a couple of
// breaks with roots and floor behind them read as the edge of a wood.
const EDGE_GAPS = [-190, 20, 150];
function edgeGap(wx, bay) {
  for (let i = 0; i < EDGE_GAPS.length; i++) {
    if (Math.abs(wx - (bay + EDGE_GAPS[i])) < 17 + i * 3) return true;
  }
  return false;
}

// Drawn before the bushes, so the ones that survive still overlap the opening's
// edges and it reads as a thinning rather than a hole cut in a hedge.
function edgeGapFill(g, camX, W, bay) {
  for (let i = 0; i < EDGE_GAPS.length; i++) {
    const cx = bay + EDGE_GAPS[i];
    if (cx < camX - 70 || cx > camX + W + 70) continue;
    if (bushDensity(cx) <= 0.05) continue;
    const e = edgeY(cx), hw = 17 + i * 3;
    // the floor behind the boundary, a shade off the forest interior
    g.fillStyle = '#1b2a1e';
    pxBlob(g, cx, e - 1, hw - 3, 7, 13.1 + i * 4.7, 2);
    g.fillStyle = '#243524';
    pxBlob(g, cx + 3, e - 3, hw - 8, 4, 27.7 + i * 3.1, 2);
    // roots coming down out of the gap
    limb(g, cx - hw * 0.4, e - 9, 1.18, 15 + i * 3, 3, BARK, 0.26, 0.6);
    if (i !== 1) limb(g, cx + hw * 0.5, e - 7, 1.42, 11, 2, BARK, -0.22, 0.5);
    // one fern, so the opening has something growing in it
    blit(g, i === 1 ? 'fernbank_02' : 'fernbank_01', cx + 4, e + 5, i % 2 === 1, 0.86);
  }
}

// The one landmark: a long-dead trunk lying in the forest behind the boundary,
// its root plate tipped up where it tore out. Placed on an outer side and kept
// entirely above edgeY, so the grass crops its underside and the bush line
// breaks its length — it is meant to be noticed on the second look, not to
// compete with the fight.
function fallenLandmark(g, camX, W, bay) {
  const bx = bay + 200;
  if (bx < camX - 150 || bx > camX + W + 150) return;
  const by = edgeY(bx) - 16, L = 84, TH = 10;   // clears the bush tops
  const x0 = bx - L * 0.55;
  // Drawn per column so the underside can be neither level nor ruled. A trunk
  // with a straight lower edge reads as a beam, which is the exact failure an
  // earlier pass of this arena had to have cut out of it.
  for (let i = 0; i < L; i++) {
    const u = i / L;
    const x = x0 + i;
    const th = Math.max(3, Math.round(TH * (1 - u * 0.58)));      // real taper
    const sag = Math.sin(u * Math.PI) * -3.5 + u * 7;             // bows, then settles
    const rough = (h1(i * 0.7 + 11.3) - 0.5) * 1.9;
    const base = by + sag + rough;
    const top = base - th;
    g.fillStyle = BARK.deep;
    g.fillRect(Math.round(x), Math.round(top), 1, th);
    g.fillStyle = BARK.body;
    g.fillRect(Math.round(x), Math.round(top + 2), 1, Math.max(1, th - 5));
    if (h1(i * 3.7 + 2.1) > 0.86) {          // rot holes broken into the back
      g.fillStyle = '#1a1409';
      g.fillRect(Math.round(x), Math.round(top + 1), 1, 2);
    } else if (h1(i * 1.7 + 3.3) > 0.30) {   // moss, broken so it is not a stripe
      g.fillStyle = h1(i * 2.9) > 0.5 ? '#33502f' : '#3d6136';
      g.fillRect(Math.round(x), Math.round(top), 1, 2);
    }
  }
  for (let r = 0; r < 10; r++) {             // the torn-out root plate
    limb(g, x0 + 2, by - 5, -2.72 + r * 0.26, 13 + h1(r * 5.1) * 14,
         r % 3 === 0 ? 4 : 3, BARK, 0.34, 0.45);
  }
}

function bgEdge(g, camX, W, bay, t, dark) {
  edgeGapFill(g, camX, W, bay);
  for (let wx = Math.floor((camX - 90) / 15) * 15; wx < camX + W + 90; wx += 15) {
    const k = h1(wx * 0.041 + 31);
    if (windowAt(wx, bay) * heaviness(wx, bay) * (0.62 + k * 0.7) < 0.34) continue;
    if (edgeGap(wx, bay)) continue;
    const dens = bushDensity(wx);
    if (dens <= 0.02 || h1(wx * 0.077 + 5.1) > dens) continue;
    const w = windAt(wx, edgeY(wx), t) * 0.55;
    blitSil(g, EDGE_KIT[Math.floor(k * 89) % EDGE_KIT.length],
            k > 0.62 ? '#31603f' : '#285036',
            wx + (h1(wx * 0.11) - 0.5) * 14 + w,
            edgeY(wx) + 8 + Math.round(k * 14), k > 0.5, 1, 0.74);
  }
  // The shadow at the base of the tree line used to be one gradient spanning
  // the frame, which printed a hard horizontal stripe straight across the
  // middle. Dithered, and following the clearing's own edge curve, it anchors
  // the vegetation to the ground without cutting the frame in half.
  // A tight, high-contrast contact shadow directly under the edge, then the
  // softer falloff below it. Without the tight band the forest reads as a 2D
  // overlay pasted onto the grass rather than something standing on it.
  for (let sx = 0; sx < W; sx += 2) {
    const wx = camX + sx;
    const e = edgeY(wx);
    const sd = 0.34 + 0.66 * bushDensity(wx);
    g.fillStyle = `rgba(6,18,12,${0.46 * sd})`;
    g.fillRect(wx, e + 8, 2, 5);
    g.fillStyle = `rgba(6,18,12,${0.24 * sd})`;
    g.fillRect(wx, e + 13, 2, 4);
  }

  // Shadow at the base of the tree line, drawn per column so it rides the
  // clearing's edge curve. One frame-wide gradient here printed a hard
  // horizontal stripe across the middle of the picture.
  for (let sx = 0; sx < W; sx += 2) {
    const wx = camX + sx;
    const e = edgeY(wx);
    const col = g.createLinearGradient(0, e - 20, 0, e + 34);
    col.addColorStop(0, 'rgba(8,23,15,0)');
    col.addColorStop(0.38, `rgba(8,23,15,${0.72 + dark * 0.10})`);
    col.addColorStop(1, 'rgba(8,23,15,0)');
    g.fillStyle = col;
    g.fillRect(wx, e - 20, 2, 54);
  }
}

// ====================== BATTLEFIELD OBJECTS =============================
//
// NINE compositions across the whole visible field, hand-placed by zone. Not a
// generator — a generator is what produced every version of this arena that had
// to be torn out, because a rule that can place one more object always does.
// The list below is the entire budget and there is no code path that can add a
// tenth.
//
// Two constraints shape every position:
//   * the central band (|dx| < 120) stays clean, so the fight owns the middle
//   * the upper middle stays clear, so the depth window is never blocked
//
// Spacing is deliberately uneven — a pair on the upper left, a long empty
// stretch, a lone boulder, then two more on the right. Negative space between
// them is part of the composition, not a gap waiting to be filled.
function arenaObjects(g, camX, W, H, bay, t) {
  const on = (x, m) => x > camX - (m || 90) && x < camX + W + (m || 90);

  // --- LOWER LEFT: one old fallen log running off the frame, mossy, with a
  // couple of mushrooms and a fern. Not a cluster, three companions at most.
  {
    const x = bay - 236, y = 252;
    if (on(x, 130)) {
      ground(g, x, y + 3, 40, 8, 0.34);
      blit(g, 'fallen_log_01', x, y, false, 1);
      blit(g, 'log_long', x - 30, y + 3, true, 1);
      blit(g, 'city_moss_patch', x + 4, y + 1, false, 0.34);
      blit(g, 'mushrooms_red', x + 19, y + 2, false, 1);
      blit(g, 'mushrooms_02', x + 25, y + 4, true, 0.9);
      blit(g, 'fernbank_01', x - 12, y + 5, false, 1);
    }
  }

  // --- LEFT MIDDLE: one low mossy boulder, kept short so a character standing
  // behind it still reads. Grass and flowers on ONE side only.
  {
    const x = bay - 158, y = 208;
    if (on(x)) {
      ground(g, x, y + 2, 17, 5, 0.34);
      blit(g, 'rock_med_01', x, y, false, 1);
      blit(g, 'city_moss_patch', x - 2, y, false, 0.42);
      blit(g, 'grass_md_04', x + 13, y + 2, false, 0.95);
      blit(g, 'flowers_white', x + 18, y + 3, true, 0.55);
    }
  }

  // --- UPPER LEFT: two half-buried ancient fragments near the boundary,
  // heavily reclaimed. Not a shrine, not a ruin — two stones.
  {
    for (const [dx, dy, name, sd] of [[-206, 170, 'myst_rubble_a', 2.3],
                                      [-176, 178, 'myst_col_stub', 6.1]]) {
      const x = bay + dx, y = dy;
      if (!on(x)) continue;
      ground(g, x, y + 2, 13, 4, 0.30);
      blit(g, name, x, y, sd > 4, 0.92);
      blit(g, 'city_moss_patch', x, y + 1, false, 0.40);
      blit(g, 'fernbank_02', x + 9, y + 3, sd > 4, 0.9);
    }
  }

  // --- UPPER MIDDLE: nothing. The depth window is worth more than any object
  // that could be put in front of it.

  // --- UPPER RIGHT: one broken stump at the perimeter, roots running out and
  // disappearing into the grass.
  {
    const x = bay + 192, y = edgeY(bay + 192) + 22;
    if (on(x)) {
      ground(g, x, y + 2, 15, 5, 0.34);
      for (const rdx of [-13, 11]) {
        g.fillStyle = BARK.deep;
        g.beginPath(); g.ellipse(x + rdx, y + 1, 9, 2.4, rdx < 0 ? -0.2 : 0.2, 0, Math.PI * 2); g.fill();
      }
      // sat flush against the boundary and pulled toward the tree line's own
      // shadow value, so it belongs to the forest edge rather than floating
      blitSil(g, 'tree_stump_02', '#243a26', x, y, false, 1, 0.55);
      blitSil(g, 'city_stump_shoots', '#20331f', x + 12, y + 3, true, 1, 0.6);
      blitSil(g, 'grass_lg_03', '#22381f', x - 12, y + 3, false, 1, 0.55);
    }
  }

  // --- RIGHT MIDDLE: a very small composition. One low stone, one fern, and
  // two pale slivers of bone. Two, not a pile.
  {
    const x = bay + 176, y = 224;
    if (on(x)) {
      ground(g, x, y + 2, 18, 6, 0.40);
      blit(g, 'city_moss_patch', x + 2, y + 1, false, 0.34);
      blit(g, 'myst_rock_c', x, y, false, 0.95);
      blitSil(g, 'fernbank_01', '#27492c', x + 11, y + 2, true, 1, 0.5);
      g.globalAlpha = 0.5; g.fillStyle = '#c9c3ae';
      g.fillRect(Math.round(x - 11), Math.round(y - 1), 5, 1);
      g.fillRect(Math.round(x - 8), Math.round(y - 3), 1, 3);
      g.globalAlpha = 1;
    }
  }

  // --- LOWER RIGHT: ferns entering from offscreen. There was a root mass here
  // too, cropped by the corner. Smoothed into an ellipse it read as anonymous
  // brown debris; drawn properly as a log it read as a log nobody wanted in
  // the corner. The corner frames perfectly well on vegetation alone.
  {
    const x = bay + 236, y = H + 6;
    if (on(x, 130)) {
      blitSil(g, 'fernbank_02', '#1a3b26', x - 26, y - 18, true, 1, 0.72);
      blitSil(g, 'fernbank_01', '#1d4029', x + 14, y - 14, false, 1, 0.72);
    }
  }

  // --- CENTRE: one flat, mostly buried paving fragment. No outline, no height,
  // nothing a character can be lost behind — you walk over it.
  {
    const x = bay + 26, y = 232;
    if (on(x)) {
      g.globalAlpha = 0.24;
      g.fillStyle = STONE_A;
      pxBlob(g, x, y, 15, 6, 4.7, 3);
      g.globalAlpha = 0.26; g.fillStyle = GRASS_DEEP;
      for (let n = 0; n < 12; n++) {
        const a = h1(n * 2.3 + 5) * Math.PI * 2;
        g.fillRect(Math.round(x + Math.cos(a) * 15), Math.round(y + Math.sin(a) * 6.5), 2, 2);
      }
      g.globalAlpha = 1;
    }
  }
  void t;
}

// ---- 2-4 root formations, and only at the rim.
//
// These exist to explain the clearing's irregular boundary — the forest holds
// this edge, so the grass stops where the roots do. They enter the outer eighth
// of the battlefield and submerge; nothing crosses the fighting floor, because
// a big dark shape lying where enemies are read is the one thing this arena
// cannot afford.
function boundaryRoots(g, camX, W, bay) {
  const SPOTS = [
    { x: -286, y: 196, dir: 1,  len: 54, s: 3.1 },
    { x: -252, y: 236, dir: 1,  len: 40, s: 7.7 },
    { x: 300,  y: 208, dir: -1, len: 58, s: 5.3 },
  ];
  for (const sp of SPOTS) {
    const x0 = bay + sp.x;
    if (x0 < camX - 90 || x0 > camX + W + 90) continue;
    const N = 12;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      pts.push({ x: x0 + sp.dir * sp.len * u,
                 y: sp.y + Math.sin(u * 2.6 + sp.s) * 5 + u * 6,
                 th: (4.4 - u * 3.2), u });
    }
    const dive0 = 0.46, dive1 = 0.66;
    const vis = (u) => u < dive0 || u > dive1;
    const band = (off, colour, scale) => {
      g.fillStyle = colour;
      let open = false;
      for (let i = 0; i <= N; i++) {
        const pt = pts[i];
        if (!vis(pt.u)) { if (open) { g.closePath(); g.fill(); open = false; } continue; }
        if (!open) { g.beginPath(); open = true; g.moveTo(pt.x, pt.y + off - pt.th * scale); }
        else g.lineTo(pt.x, pt.y + off - pt.th * scale);
      }
      if (open) {
        for (let i = N; i >= 0; i--) {
          const pt = pts[i]; if (!vis(pt.u)) continue;
          g.lineTo(pt.x, pt.y + off + pt.th * scale);
        }
        g.closePath(); g.fill();
      }
    };
    g.save();
    g.globalAlpha = 0.26; band(3, '#0a140d', 1.05);
    g.globalAlpha = 1;   band(0, BARK.deep, 1); band(-0.7, BARK.body, 0.66);
    g.restore();
    // grass closing over the point where it goes under
    const dm = pts[Math.round(((dive0 + dive1) / 2) * N)];
    blit(g, sp.s > 5 ? 'grass_md_02' : 'city_grass_clump', dm.x, dm.y + 4, sp.dir < 0, 0.9);
  }
}

// ---- the forest-to-clearing transition band.
//
// Low and narrow on purpose: the background trees already supply the vertical
// mass, so all this has to do is stop them meeting the grass on a line. Dark
// grass, then a few ferns, then ordinary clearing grass.
function transitionBand(g, camX, W, bay, t) {
  // Irregular overlapping masses, not an alternating rhythm.
  //
  // The failure mode this fixes is trunk, bush, trunk, bush — a regular beat
  // along the lower tree line that reads as a fence. Bushes are now placed in
  // RUNS of two to five driven by a low-frequency hash, with real gaps between
  // runs, so some trunks are buried completely and others stand clear.
  for (let wx = Math.floor((camX - 90) / 11) * 11; wx < camX + W + 90; wx += 11) {
    const dens = bushDensity(wx);
    const run = h1(Math.floor(wx / 63) * 4.1);
    const inRun = dens > 0.02 && run > 0.48 + (1 - dens) * 0.52;
    if (inRun) {
      const e2 = edgeY(wx);
      const kk = h1(wx * 0.13 + 7);
      // stacked in two or three depths so the mass has thickness
      for (let L = 0; L < 2 + Math.floor(kk * 2); L++) {
        blitSil(g, EDGE_KIT[Math.floor(h1(wx * 0.21 + L) * 89) % EDGE_KIT.length],
                L === 0 ? '#14301e' : (L === 1 ? '#1b3d26' : '#22482e'),
                wx + (h1(wx * 0.3 + L) - 0.5) * 22,
                Math.min(e2 + 8 + L * 4 + Math.round(kk * 5), DEPTH_MIN - 14),
                h1(wx + L) > 0.5, 1, 0.62 + L * 0.06);
      }
    }
  }
  for (let wx = Math.floor((camX - 60) / 13) * 13; wx < camX + W + 60; wx += 13) {
    const k = h1(wx * 0.067 + 41);
    const dens = windowAt(wx, bay) * heaviness(wx, bay);
    const e = edgeY(wx);
    // dark grass fringe right at the boundary
    if (k > 0.30) {
      g.fillStyle = GRASS_EDGE;
      g.globalAlpha = 0.34 + k * 0.24;
      for (let n = 0; n < 4; n++) {
        g.fillRect(Math.round(wx + (h1(wx + n) - 0.5) * 11),
                   Math.round(e + 2 + h1(wx * 0.3 + n) * 12), 2, 2);
      }
      g.globalAlpha = 1;
    }
    // sparse ferns, only where the forest behind is actually dense
    if (k > 0.86 && dens > 0.55) {
      const w = windAt(wx, e, t) * 0.5;
      blitSil(g, h1(wx) > 0.5 ? 'fernbank_01' : 'fernbank_02', '#1c3a26',
              wx + w, e + 14 + Math.round(k * 8), k > 0.5, 1, 0.7);
    }
  }
}

// ---- the very limited magic: a handful of motes, nothing more.
function bgMotes(g, camX, W, bay, t, awake) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const k = h1(i * 9.7 + bay * 0.01);
    const x = bay - 220 + k * 440 + Math.sin(t * 0.4 + i * 2.1) * 9;
    const y = CANOPY_Y - 34 + h1(i * 4.3) * 54 + Math.sin(t * 0.55 + i) * 7;
    if (x < camX - 10 || x > camX + W + 10) continue;
    g.globalAlpha = (0.22 + 0.18 * Math.sin(t * 1.1 + i * 1.9)) * (0.45 + awake * 0.55);
    g.fillStyle = CYAN.core;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.restore();
  g.globalAlpha = 1;
}

// =========================================================================
// PARKED — not drawn in this phase
// =========================================================================
// The Guardian Tree and the four perimeter clusters below are deliberately
// unwired. This phase is ground plus background only; a very small number of
// these come back in the next one. They are kept rather than deleted because
// they are finished work, and re-deriving them would be waste.
//
// Nothing calls them, so they cost nothing.

// =========================================================================
// LAYER 6 — THE GUARDIAN TREE
// =========================================================================
// The one landmark. Everything else in the grove is scenery; this is the thing
// a screenshot is recognised by.
//
// It is parked far back with heavy parallax (moves at ~20% of camera speed) so
// it looms behind the whole arena rather than sliding past as one more tree —
// the grove is built around it, so it must be visible from every bay. Over the
// full run it drifts from screen x~340 to ~130, which is the correct behaviour
// for a distant landmark and keeps it off-centre and out of the fight.
//
// Composited, not a single sprite: three overlapping crown crops make a canopy
// far wider than any one tree in the pack, and a trunk built from stacked
// TRUNK_CROP copies with per-band x-jitter gives the twist. Deliberately about
// 90% ordinary ancient tree — the magic is a few small marks that only wake as
// the fight escalates, not a neon glow.
const GUARD_X = 300;             // world anchor; see parallax note above
const GUARD_PAR = 0.12;          // screen x drifts 300 -> ~173 over the whole run
function guardianTree(g, camX, W, awake, t) {
  // Drawn at world x = GUARD_X + camX*(1-GUARD_PAR): the canvas is translated
  // by -camX, so on screen this advances at only GUARD_PAR of the camera's
  // rate — the parallax of something far behind the treeline.
  const x = GUARD_X + camX * (1 - GUARD_PAR);
  const baseY = CANOPY_Y + 46;
  if (x < camX - 220 || x > camX + W + 220) return;

  // Push the forest behind the landmark down in value. Gemini's note was that
  // the Guardian merged straight into the canopy clusters behind it; the tree
  // itself is fine, it simply had nothing to be read against.
  const halo = g.createRadialGradient(x, baseY - 90, 20, x, baseY - 90, 200);
  halo.addColorStop(0, 'rgba(5,14,11,0.52)');
  halo.addColorStop(0.6, 'rgba(5,14,11,0.34)');
  halo.addColorStop(1, 'rgba(5,14,11,0)');
  g.fillStyle = halo;
  // The rect must cover the gradient's full 200px falloff on every side. It
  // used to extend only 170 above and below the centre, so the rect edge cut
  // the fade mid-way and printed a hard box across the canopy — invisible in a
  // single 480-wide frame, obvious the moment you look at the whole arena.
  g.fillRect(x - 205, baseY - 90 - 205, 410, 410);

  // Canopy and trunk are the same crop, overlapped. Every piece is a painted
  // tree silhouette, so the composite has no straight edges anywhere — which
  // stacking a rectangular trunk band emphatically did.
  const C = GRAND_CROP;
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x - 76, baseY - 34, false, 0.82);
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x + 80, baseY - 30, true, 0.82);
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x - 30, baseY - 74, true, 0.9);
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x + 34, baseY - 82, false, 0.9);
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x, baseY, false, 1);
  cropBlit(g, 'mystic_tree_grand', C[0], C[1], C[2], C[3], x + 6, baseY - 62, false, 1);

  guardianBaseDeferred = { x, baseY, awake, t };
}

// Roots, hollow and swallowed stonework, drawn AFTER the treeline so the skirt
// does not bury the most characterful part of the landmark.
let guardianBaseDeferred = null;
function guardianBase(g, camX, W) {
  if (!guardianBaseDeferred) return;
  const { x, baseY, awake, t } = guardianBaseDeferred;
  guardianBaseDeferred = null;
  if (x < camX - 220 || x > camX + W + 220) return;

  // --- the hollow at the base
  g.fillStyle = '#0a140d';
  g.beginPath(); g.ellipse(x + 4, baseY - 12, 17, 14, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#060d08';
  g.beginPath(); g.ellipse(x + 4, baseY - 9, 11, 9, 0, 0, Math.PI * 2); g.fill();

  // --- broken stonework half-swallowed by the roots: the forest sits on top of
  // the ruin, which is the whole story of this place
  blit(g, 'myst_col_lean', x - 92, baseY + 8, false, 0.95);
  blit(g, 'myst_rubble_a', x - 70, baseY + 12, true, 0.95);
  blit(g, 'myst_col_drum', x + 82, baseY + 10, false, 0.95);
  blit(g, 'myst_rubble_c', x + 100, baseY + 13, false, 0.9);

  // --- exposed roots spreading out of it, and moss where they meet the soil
  for (let i = 0; i < 5; i++) {
    const k = h1(i * 6.1 + 4);
    const rx = x + (i - 2) * 34 + (k - 0.5) * 12;
    blit(g, i % 2 ? 'myst_tree_roots' : 'tree_rooted', rx, baseY + 6 + i * 3, i % 2 === 0, 0.95);
  }
  for (let i = 0; i < 6; i++) {
    const k = h1(i * 3.3 + 9);
    blit(g, ['fernbank_01', 'bush_big', 'grass_lg_03', 'city_grass_clump',
             'myst_stump_flowers', 'fernbank_02'][i], x + (k - 0.5) * 190,
         baseY + 4 + Math.round(k * 12), k > 0.5, 1);
  }

  // --- the 10% magic: carved marks in the bark that catch the light. Small,
  // cool, and only really present once the grove starts reacting.
  if (awake > 0.02) {
    const marks = [[-9, -58], [6, -96], [-3, -132], [11, -168], [-14, -104]];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < marks.length; i++) {
      const pulse = 0.45 + 0.55 * Math.sin(t * 1.3 + i * 1.7);
      g.globalAlpha = awake * pulse * 0.34;
      g.fillStyle = CYAN.core;
      g.beginPath();
      g.ellipse(x + marks[i][0], baseY + marks[i][1], 2.6, 4.2, 0, 0, Math.PI * 2);
      g.fill();
    }
    // the faintest bloom around the hollow
    g.globalAlpha = awake * 0.08;
    disc(g, x + 4, baseY - 12, 26, CYAN.body);
    g.restore();
    g.globalAlpha = 1;
  }
}

// =========================================================================
// LAYER 8 — the perimeter, built from clusters
// =========================================================================
// The single biggest fix from the last pass. Props used to be stepped along the
// edge at a fixed interval — stone, grass, stone, grass — which is the reliable
// tell for machine-made scenery no matter how good the individual art is.
//
// Nature clusters and then leaves gaps. Each entry below is a small designed
// composition of 3-5 pieces that belong together, dropped at irregular
// intervals with real negative space between. Recipes are picked by hash, so a
// given spot always draws the same cluster, but neighbours rarely match.
const CLUSTERS = [
  // ancient, being eaten
  ['myst_col_broken', 'fernbank_01', 'flowers_blue', 'myst_rock_c'],
  ['myst_pillar_moss_a', 'bush_low', 'mushrooms_red', 'grass_lg_02'],
  ['myst_rubble_b', 'grass_tall_03', 'flowers_white', 'city_moss_patch'],
  ['myst_stone_one', 'fernbank_02', 'grass_md_04', 'mushrooms_mixed'],
  // pure nature
  ['fallen_log_01', 'mushrooms_02', 'grass_lg_05', 'flowers_yellow'],
  ['bush_big', 'fernbank_01', 'grass_tuft_03', 'nv_bush_03'],
  ['tree_stump_02', 'mushrooms_red', 'city_grass_clump', 'grass_lean_02'],
  ['rock_med_01', 'bush_03', 'grass_tall_02', 'fernbank_02'],
  ['log_long', 'grass_lg_03', 'flowers_mixed', 'mushrooms_03'],
];
// offsets within a cluster, so pieces overlap and sit at different depths
// =========================================================================
// LAYER 11 — lighting hierarchy
// =========================================================================
// Background darkest, perimeter medium, the playable middle brightest. This is
// done by DARKENING everything else rather than brightening the centre, because
// lifting the whole scene washes the art out and costs the contrast the fight
// needs. Two vignettes: one vertical for depth, one along the bay so the throats
// between clearings fall away into shadow.
function lighting(g, camX, W, H, dark, boss) {
  // Wide, low-alpha depth washes. Kept as gradients deliberately — see the note
  // in the ground bake about why the dithered versions were worse.
  const near = g.createLinearGradient(0, DEPTH_MAX - 14, 0, H);
  near.addColorStop(0, 'rgba(6,16,12,0)');
  near.addColorStop(1, `rgba(6,16,12,${0.46 + dark * 0.14})`);
  g.fillStyle = near;
  g.fillRect(camX, DEPTH_MAX - 14, W, H - DEPTH_MAX + 14);

  const far = g.createLinearGradient(0, CANOPY_Y - 20, 0, DEPTH_MIN - 6);
  far.addColorStop(0, 'rgba(6,16,12,0)');
  far.addColorStop(0.45, `rgba(6,16,12,${0.26 + dark * 0.10})`);
  far.addColorStop(1, 'rgba(6,16,12,0)');
  g.fillStyle = far;
  g.fillRect(camX, CANOPY_Y - 20, W, DEPTH_MIN - CANOPY_Y + 14);

  // the throats between bays fall away, sampled off the same curve the
  // vegetation follows so it never reads as a band across the frame
  const bayGrad = g.createLinearGradient(camX, 0, camX + W, 0);
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    bayGrad.addColorStop(u, `rgba(5,14,11,${pinch(camX + u * W) * 0.26})`);
  }
  g.fillStyle = bayGrad;
  g.fillRect(camX, CANOPY_Y - 6, W, H - CANOPY_Y + 6);

  if (boss) {
    g.fillStyle = 'rgba(4,10,10,0.30)';
    g.fillRect(camX, 0, W, CANOPY_Y + 26);
    g.fillStyle = 'rgba(24,44,58,0.14)';
    g.fillRect(camX, 0, W, H);
    const vig = g.createRadialGradient(camX + W / 2, DEPTH_MAX - 30, 90,
                                       camX + W / 2, DEPTH_MAX - 30, 330);
    vig.addColorStop(0, 'rgba(3,9,8,0)');
    vig.addColorStop(1, 'rgba(3,9,8,0.46)');
    g.fillStyle = vig;
    g.fillRect(camX, 0, W, H);
  }
  void dark;
}

// =========================================================================
// LAYER 12 — ambient motion
// =========================================================================
// It cannot look frozen, and it must not all move together — synchronised
// motion is as artificial as an evenly spaced prop row. Every element below
// runs on its own frequency and phase offset.
function ambience(g, camX, W, H, awake, t, boss) {
  // drifting leaves, biased above the fight so they never sit on top of it
  const n = 14 + Math.round(awake * 12);
  for (let i = 0; i < n; i++) {
    const sp = 7 + h1(i * 3.1) * 11;
    const x = camX + ((h1(i * 5.7) * (W + 120) + t * sp) % (W + 120)) - 60;
    const drift = Math.sin(t * (0.7 + h1(i) * 0.5) + i) * 9;
    const y = 30 + h1(i * 2.3) * (DEPTH_MIN - 40) + drift;
    const k = h1(i * 7.9);
    g.globalAlpha = 0.16 + k * 0.22;
    g.fillStyle = k > 0.6 ? '#5d8a4a' : (k > 0.3 ? '#7a6b3a' : '#3f6b3c');
    g.fillRect(Math.round(x), Math.round(y), 2, k > 0.5 ? 2 : 1);
  }
  g.globalAlpha = 1;

  // magical motes near the ground, only once the grove is reacting
  if (awake > 0.30) {
    const m = Math.round((awake - 0.30) * 26);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < m; i++) {
      const x = camX + h1(i * 4.1) * W;
      const bob = Math.sin(t * (0.5 + h1(i * 2.7) * 0.6) + i * 2.1);
      const y = DEPTH_MIN - 6 + h1(i * 6.3) * 70 + bob * 12;
      g.globalAlpha = (0.20 + 0.24 * (0.5 + 0.5 * bob)) * clamp01((awake - 0.30) / 0.7);
      g.fillStyle = CYAN.core;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  // boss: embers lifting off the goblin fires, warm against the cool motes
  if (boss) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const life = (t * (0.35 + h1(i) * 0.3) + h1(i * 3.3)) % 1;
      const x = camX + h1(i * 5.1) * W + Math.sin(t * 1.4 + i) * 7;
      const y = DEPTH_MIN + 40 - life * 120;
      g.globalAlpha = (1 - life) * 0.5;
      g.fillStyle = life > 0.55 ? FIRE.deep : FIRE.body;
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    g.restore();
    g.globalAlpha = 1;
  }
}



// =========================================================================
// LAYER 14 — the arrival tell
// =========================================================================
// Enemies walk in from off the right edge, so their arrival had no read at all
// until they were already on top of you. This is the grove noticing them
// first: the undergrowth at the edge parts, leaves spiral up out of it, and a
// few of the buried runes crack alight.
//
// Deliberately at the EDGE and never under the player's feet. A telegraph
// drawn in the fighting space is noise exactly where readability matters, and
// the point of this one is to pull the eye to where the threat comes from.
function arrivalTell(g, camX, W, amt, t) {
  if (amt <= 0.02) return;
  const x = camX + W - 26;
  const a = clamp01(amt);
  // the ground darkens under the parting
  g.save();
  g.globalAlpha = a * 0.34;
  g.fillStyle = '#0a170f';
  g.beginPath(); g.ellipse(x, DEPTH_MIN + 40, 46, 30, 0, 0, Math.PI * 2); g.fill();
  g.restore();

  // runic cracks lighting in the turf
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const k = h1(i * 4.7 + 1);
    const cy = DEPTH_MIN + 16 + k * 52;
    const pulse = 0.4 + 0.6 * Math.sin(t * 5 + i * 1.7);
    g.globalAlpha = a * pulse * 0.42;
    g.fillStyle = i % 2 ? CYAN.core : '#8ef0a8';
    g.fillRect(Math.round(x - 30 + k * 52), Math.round(cy), 5 + Math.round(k * 7), 1);
  }
  g.restore();
  g.globalAlpha = 1;

  // leaves spiralling up out of the undergrowth
  for (let i = 0; i < 12; i++) {
    const k = h1(i * 6.1 + 3);
    const life = (t * (0.6 + k * 0.5) + k) % 1;
    const ang = life * Math.PI * 3 + i;
    const r = 8 + life * 22;
    const lx = x + Math.cos(ang) * r;
    const ly = DEPTH_MIN + 44 - life * 52;
    g.globalAlpha = a * (1 - life) * 0.8;
    g.fillStyle = k > 0.5 ? '#5d8a4a' : '#7a6b3a';
    g.fillRect(Math.round(lx), Math.round(ly), 2, k > 0.6 ? 2 : 1);
  }
  g.globalAlpha = 1;
}


// =========================================================================
// COMPOSITE
// =========================================================================
export function drawForestArena(g, ctx) {
  const camX = ctx.camX, W = ctx.W, H = ctx.H, t = ctx.t || 0;
  const awake = clamp01(ctx.awake || 0);
  const boss = !!ctx.bossZone;
  const dark = awake * 0.5 + (boss ? 0.4 : 0);
  const m = mode();
  const wantGround = m !== 'forest';
  const wantForest = m !== 'ground';

  const bays = BAYS.filter((b) => b > camX - 400 && b < camX + W + 400);
  let bay = bays[0] != null ? bays[0] : BAYS[0];
  let bd = 1e9;
  for (const b of bays) { const d = Math.abs(b - (camX + W / 2)); if (d < bd) { bd = d; bay = b; } }

  if (ctx.arena) {
    drawArena(g, camX, W, H, t, awake);
    arrivalTell(g, camX, W, ctx.arriving || 0, t);
    return;
  }

  // sky and the far ridgeline, which both views keep for context
  backdrop(g, camX, W, dark);

  // --- B, back to front. Value and colour temperature carry the depth; the
  // planes are drawn deepest first so each one crops into the one behind it.
  if (wantForest) {
    forestFloor(g, camX, W);       // the shaded interior every plane sits in
    // The authored backdrop stands in for the procedural forest planes. They
    // remain as the fallback for the frames before the image decodes, so a
    // slow load shows a forest rather than bare sky.
    if (!forestArt(g, camX, W, H)) {
      planeVista(g, camX, W, bay, t);
      woodland(g, camX, W, bay, t);
    }
    fallenLandmark(g, camX, W, bay);
    backdropMood(g, camX, W, boss, H);
  }

  // --- A. Ground goes over the far planes and under the clearing edge, so
  // the clearing-edge vegetation sits ON the grass rather than behind it.
  if (wantGround) groundFade(g, camX, W, H);
  else rect(g, camX, GROUND_TOP, W, H - GROUND_TOP, '#3f6b43');   // neutral ground

  if (wantForest) {
    bgEdge(g, camX, W, bay, t, dark);
    transitionBand(g, camX, W, bay, t);
    bgMotes(g, camX, W, bay, t, awake);
  }
  if (wantGround) {
    boundaryRoots(g, camX, W, bay);
    arenaObjects(g, camX, W, H, bay, t);
  }

  lighting(g, camX, W, H, dark, boss);
  arrivalTell(g, camX, W, ctx.arriving || 0, t);
  ambience(g, camX, W, H, awake, t, boss);
}


