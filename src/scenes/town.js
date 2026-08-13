// The town hub — a dense, walkable top-down map modelled on the concept art:
// a stone Crystal Plaza landmark at the centre, an interconnected cobblestone
// street network, and detailed districts (Library, Weapon Shop & Blacksmith,
// Training Grounds, Potion Shop, Pet Sanctuary, Market Square, Adventurer's
// Guild & Tavern, Residential Quarter with the Player House, a Quest Board and
// checkpoint on the Adventure Road, and the great Dungeon Gate). Buildings are
// framed by tree clusters, gardens, fences and prop groups so there is very
// little empty grass.
//
// The player walks in 8 directions; the camera follows within the map bounds.
// District names appear briefly on entry (no permanent floating labels), and an
// [E] prompt shows only at a building's entrance. Shops/inventory reuse the
// existing overlay controllers.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, bar, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, disc, shadow, clamp, lerp, clamp01 } from '../gfx/pixel.js';
import { drawCharacter, drawActor, drawPet } from '../gfx/actors.js';
import { drawTree, drawPineTree, drawBush, drawRock, drawTorch, drawIcon, drawDummy } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { buildWaterMask, proceduralRipples, drawFishJump } from '../gfx/waterfx.js';
import { WeaponShop, PotionShop, InventoryMenu } from './menus.js';

// Master Town Layout v5 (final spacing polish — coordinates LOCKED once
// approved): a landscape settlement around Crystal Plaza with a compressed
// adventure branch north to the Runebound Gate. Sized from walk times
// (player speed 100 units/s -> 100 units = 1 second): fountain->gate is
// ~2370 units (~24s), and the adventure route's remaining length is meant
// to read through environment (forest/ruins/fortifications later), not
// empty grass. Perimeter margins stay wilderness/expansion space.
const MAP_W = 3600;
const MAP_H = 4400;

// Potion Shop artwork (real transparent PNG). Loaded once; drawn directly with
// nearest-neighbor rendering. Authored to the game's native footprint so no
// runtime scaling/blur is needed.
const POTION_IMG = new Image();
let POTION_READY = false;
POTION_IMG.onload = () => { POTION_READY = true; };
POTION_IMG.src = 'assets/potion_shop.png';
// On-screen size in world units (aspect preserved from the source art).
const POTION_W = 113, POTION_H = 80;

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

// Building artwork (real transparent PNGs), same load/draw pattern as the
// Potion Shop above. Each authored to the game's native footprint.
function loadBuildingArt(src) {
  const img = new Image();
  const state = { img, ready: false };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}
const GUILD_ART = loadBuildingArt('assets/guild.png');
const GUILD_W = 122, GUILD_H = 78;
const BLACKSMITH_ART = loadBuildingArt('assets/blacksmith.png');
const BLACKSMITH_W = 112, BLACKSMITH_H = 68;
const HOUSE_ART = loadBuildingArt('assets/house.png');
const HOUSE_W = 75, HOUSE_H = 66;

// Real building art swapped in for districts that were still using
// procedural placeholders (drawMarker or hand-drawn rects).
const LIBRARY_ART = loadBuildingArt('assets/buildings/libary.png');
const LIBRARY_W = 100, LIBRARY_H = 78;
const COTTAGE_ART = loadBuildingArt('assets/buildings/wayferers_cottage.png');
const COTTAGE_W = 140, COTTAGE_H = 88;
const WATCH_ART = loadBuildingArt('assets/buildings/wayferers_watch.png');
const WATCH_W = 220, WATCH_H = 111;
const SANCTUARY_ART = loadBuildingArt('assets/buildings/pet_sanctuary.png');
const SANCTUARY_W = 150, SANCTUARY_H = 94;
const TRAINING_ART = loadBuildingArt('assets/buildings/training_grounds.png');
const TRAINING_W = 260, TRAINING_H = 141;
const DUNGEON_ART = loadBuildingArt('assets/buildings/duengon_gate.png');
const DUNGEON_W = 200, DUNGEON_H = 105;
const STALL_PRODUCE_ART = loadBuildingArt('assets/buildings/stall_produce.png');
const STALL_PRODUCE_W = 50, STALL_PRODUCE_H = 33;
const STALL_BAKERY_ART = loadBuildingArt('assets/buildings/stall_bakery.png');
const STALL_BAKERY_W = 42, STALL_BAKERY_H = 36;
const STALL_CLOTH_ART = loadBuildingArt('assets/buildings/stall_cloth.png');
const STALL_CLOTH_W = 42, STALL_CLOTH_H = 37;
const STALL_GOODS_ART = loadBuildingArt('assets/buildings/stall_goods.png');
const STALL_GOODS_W = 52, STALL_GOODS_H = 32;
const STALL_MERCHANT_ART = loadBuildingArt('assets/buildings/stall_merchant.png');
const STALL_MERCHANT_W = 50, STALL_MERCHANT_H = 33;

// The Lake — real transparent PNG (author's source was a JPEG "transparency
// preview" with the checker pattern baked into the pixels as literal RGB, no
// alpha channel; it was matted to real alpha by flood-filling the checker's
// grayscale/bright pixels from the canvas border, then cropped tight to its
// content bbox — see assets/pond.jpeg for the untouched original. No water
// pixel was redrawn, recolored, or reshaped; only the surrounding checker
// canvas became transparent). Native content 962x472 (2.038:1, already
// broader E/W — no rotation needed).
const POND_ART = loadBuildingArt('assets/pond.png');
const POND_W = 816, POND_H = 400; // 170% of the original 480x236 pass, aspect preserved (2.040:1, <0.1% off)

// Pond water FX (see gfx/waterfx.js): pixel-dot ripples/shimmer masked to
// the pond art's own water pixels, same technique as the fountain's FX.
// Mask built once, lazily, the first time the pond art is ready.
let POND_MASK_INFO = null;

// Lake collision, as fractions (0..1) of POND_W/POND_H so it stays correct
// under any future rescale. Generated (not hand-drawn) from the matted PNG's
// own water pixels — classified by hue (blue channel clearly over red, per
// the art's actual water tones) rather than grass/dirt/rock/reed/lily-pad
// pixels, then eroded ~9 source px inward (~4-5 world units at this scale)
// so the collision edge sits slightly inside the drawn shoreline and the
// player can visually reach the water's edge, then decomposed into
// axis-aligned horizontal-run rects per 10px row-band (the collision system
// only supports axis-aligned rects — this is the closest fit to "polygon
// collision" it can express). Correctly leaves the island and lily pads as
// non-solid gaps (surrounded by water either way, so unreachable on foot).
const POND_WATER_RECTS = [
  [0.2131,0.1271,0.0042,0.0212], [0.2464,0.1271,0.0042,0.0212], [0.7121,0.1271,0.0042,0.0212],
  [0.1892,0.1483,0.0052,0.0212], [0.2027,0.1483,0.0728,0.0212], [0.6559,0.1483,0.0010,0.0212],
  [0.6632,0.1483,0.1133,0.0212], [0.1965,0.1695,0.0811,0.0212], [0.3046,0.1695,0.0052,0.0212],
  [0.4023,0.1695,0.0094,0.0212], [0.4501,0.1695,0.0052,0.0212], [0.6736,0.1695,0.1341,0.0212],
  [0.1975,0.1907,0.1279,0.0212], [0.3493,0.1907,0.1081,0.0212], [0.6757,0.1907,0.1383,0.0212],
  [0.1985,0.2119,0.2661,0.0212], [0.6237,0.2119,0.0010,0.0212], [0.6726,0.2119,0.1435,0.0212],
  [0.1518,0.2331,0.0031,0.0212], [0.1913,0.2331,0.2807,0.0212], [0.6195,0.2331,0.0146,0.0212],
  [0.6726,0.2331,0.1466,0.0212], [0.1393,0.2542,0.3389,0.0212], [0.6112,0.2542,0.0405,0.0212],
  [0.6632,0.2542,0.1538,0.0212], [0.1414,0.2754,0.3638,0.0212], [0.5967,0.2754,0.2183,0.0212],
  [0.1351,0.2966,0.4366,0.0212], [0.5769,0.2966,0.2380,0.0212], [0.0936,0.3178,0.0094,0.0212],
  [0.1154,0.3178,0.6778,0.0212], [0.7983,0.3178,0.0052,0.0212], [0.0925,0.3390,0.6902,0.0212],
  [0.0915,0.3602,0.6892,0.0212], [0.0842,0.3814,0.6944,0.0212], [0.8285,0.3814,0.0135,0.0212],
  [0.0572,0.4025,0.0094,0.0212], [0.0717,0.4025,0.7141,0.0212], [0.8285,0.4025,0.0655,0.0212],
  [0.0572,0.4237,0.5260,0.0212], [0.6216,0.4237,0.1840,0.0212], [0.8181,0.4237,0.0884,0.0212],
  [0.0593,0.4449,0.0208,0.0212], [0.0863,0.4449,0.4854,0.0212], [0.6320,0.4449,0.2817,0.0212],
  [0.0946,0.4661,0.4678,0.0212], [0.6362,0.4661,0.2900,0.0212], [0.1019,0.4873,0.4584,0.0212],
  [0.6362,0.4873,0.3004,0.0212], [0.1019,0.5085,0.4595,0.0212], [0.6331,0.5085,0.3077,0.0212],
  [0.0998,0.5297,0.4709,0.0212], [0.6247,0.5297,0.3160,0.0212], [0.0946,0.5508,0.4990,0.0212],
  [0.5988,0.5508,0.3222,0.0212], [0.1175,0.5720,0.2235,0.0212], [0.3815,0.5720,0.5291,0.0212],
  [0.1258,0.5932,0.2027,0.0212], [0.3929,0.5932,0.5156,0.0212], [0.1299,0.6144,0.1892,0.0212],
  [0.4002,0.6144,0.5052,0.0212], [0.1372,0.6356,0.1788,0.0212], [0.4044,0.6356,0.4802,0.0212],
  [0.1403,0.6568,0.1123,0.0212], [0.2599,0.6568,0.0031,0.0212], [0.2807,0.6568,0.0333,0.0212],
  [0.4044,0.6568,0.4699,0.0212], [0.1435,0.6780,0.0125,0.0212], [0.1622,0.6780,0.0811,0.0212],
  [0.2900,0.6780,0.0218,0.0212], [0.4023,0.6780,0.3950,0.0212], [0.8326,0.6780,0.0364,0.0212],
  [0.1736,0.6992,0.0696,0.0212], [0.2900,0.6992,0.0166,0.0212], [0.3960,0.6992,0.0312,0.0212],
  [0.4605,0.6992,0.3306,0.0212], [0.8399,0.6992,0.0083,0.0212], [0.1798,0.7203,0.0634,0.0212],
  [0.2890,0.7203,0.0052,0.0212], [0.3929,0.7203,0.0270,0.0212], [0.4667,0.7203,0.3243,0.0212],
  [0.1798,0.7415,0.0707,0.0212], [0.3950,0.7415,0.0249,0.0212], [0.4657,0.7415,0.3254,0.0212],
  [0.1809,0.7627,0.0260,0.0212], [0.2516,0.7627,0.0239,0.0212], [0.3992,0.7627,0.0208,0.0212],
  [0.4657,0.7627,0.3337,0.0212], [0.8160,0.7627,0.0010,0.0212], [0.4106,0.7839,0.0198,0.0212],
  [0.4605,0.7839,0.3638,0.0212], [0.4241,0.8051,0.3368,0.0212], [0.4470,0.8263,0.2900,0.0212],
  [0.4615,0.8475,0.1040,0.0212], [0.6559,0.8475,0.0229,0.0212],
];

// Crystal lamp posts flanking the north (Adventure Road) approach to the
// plaza — a landmark pair, sized well above the plaza's own scale.
const LAMP_CRYSTAL_ART = loadBuildingArt('assets/props/lamp_crystal.png');
const LAMP_W = 36, LAMP_H = 49;
const LAMP4_ART = loadBuildingArt('assets/props/lamp_04.png');
const LAMP4_W = 36, LAMP4_H = 47;

// ------------------------------------------------------------ road tileset
// Authored cobblestone tiles (96px squares, real alpha) with corners,
// T-junctions, intersections and end caps. The town's road network is rasterised
// onto a grid and each cell picks its tile from a 4-bit neighbour mask
// (N=1, E=2, S=4, W=8), so junctions form automatically.
const ROAD_TILE = 28;               // world units per road cell

// Town grass ground tiles (sliced from the user's Town Grass sheet). Variants:
// 01 base, 02 base variation, 03 light flowers, 04 patchy dirt.
const GRASS_TILES = [];
for (const n of ['grass_01', 'grass_02', 'grass_03', 'grass_04']) {
  const img = new Image();
  const st = { img, ready: false };
  img.onload = () => { st.ready = true; };
  img.src = `assets/ground/${n}.png`;
  GRASS_TILES.push(st);
}
const GRASS_TILE = 96; // world units per ground tile (keeps blade density near road-tile scale)
// Taller/wilder meadow tile for outskirts (Sanctuary, Training edges, Gate
// approach, map perimeter) per the layout's terrain rule: short town grass in
// the developed core, meadow only where the wild starts.
const MEADOW_TILE_IMG = new Image();
const MEADOW_TILE_STATE = { img: MEADOW_TILE_IMG, ready: false };
MEADOW_TILE_IMG.onload = () => { MEADOW_TILE_STATE.ready = true; };
MEADOW_TILE_IMG.src = 'assets/ground/meadow_01.png';
const MEADOW_TILE = 56;

// Crystal Plaza floor: real modular stone tiles from the user's Crystal
// Plaza Modular Stone Pack — base/worn/moss/cracked/weathered variants,
// crystal accents, and grass-edge tiles. (The pack's "transparent overlay"
// tiles are RGB with no alpha channel like the earlier sheets, so they're
// not usable as true overlays — their look is instead achieved by using the
// equivalent solid weathered/cracked/mossy TILES zonally, which is what the
// zone system below already does.)
const PLAZA_TILES = {};
for (const n of ['base1', 'base2', 'base3', 'base4', 'worn1', 'worn2', 'lightmoss',
  'grasscracks', 'cracked', 'weathered', 'crystal1', 'crystal2', 'crystal3', 'crystal4',
  'edge_grass1', 'edge_grass2', 'edge_broken', 'edge_moss',
  'mix_base01', 'mix_base02', 'mix_base03', 'mix_base04', 'mix_base05',
  'mix_weathered06', 'mix_weathered07', 'mix_weathered08', 'mix_weathered09']) {
  const img = new Image();
  const st = { img, ready: false };
  img.onload = () => { st.ready = true; };
  img.src = `assets/plaza/${n}.png`;
  PLAZA_TILES[n] = st;
}
const ROAD_IMGS = {};
for (const n of ['straight_v', 'straight_h', 'cross', 't_up', 't_down', 't_left', 't_right',
  'corner_tl', 'corner_tr', 'corner_bl', 'end_s', 'end_s2', 'end_w', 'plaza_wide', 'damaged']) {
  const img = new Image();
  img.src = `assets/roads/${n}.png`;
  ROAD_IMGS[n] = img;
}
// mask -> [tile, flipX]
const ROAD_MASK = {
  5: ['straight_v', 0], 10: ['straight_h', 0], 15: ['cross', 0],
  7: ['t_right', 0], 13: ['t_left', 0], 11: ['t_up', 0], 14: ['t_down', 0],
  6: ['corner_tl', 0], 12: ['corner_bl', 0], 3: ['corner_tr', 0], 9: ['corner_tr', 1],
  1: ['end_s2', 0], 4: ['end_s', 0], 2: ['end_w', 1], 8: ['end_w', 0],
  0: ['plaza_wide', 0],
};

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

// Town camera zoom: the world is drawn scaled up so the player sees roughly one
// district plus a little of its neighbours, and the character reads at a good
// size. Pure 2D — this only changes framing, not the pixel art.
const ZOOM = 1.6;

// Imaginary sunlight from the upper-left: contact shadows fall to the
// lower-right. One helper so every grounded object casts a consistent shadow.
function contactShadow(g, cx, by, rx, ry, alpha = 0.32) {
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
function drawPropArt(g, art, x, y, w, h, shadowRx, flip = false) {
  // shadowRx 0 skips the shadow entirely — used by compound-style art
  // (Watch, Sanctuary, Cottage, Gate) whose PNGs include their own ground.
  if (shadowRx > 0) contactShadow(g, x, y, shadowRx, Math.max(2, shadowRx * 0.4), 0.22);
  if (!art.ready) return;
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

export class TownScene {
  constructor(hero, hooks) {
    this.hero = hero;
    this.hooks = hooks; // { toTraining, toDungeon, toHouse, toPotionShop, toWeaponShop }
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.overlay = null;
    this.dialogue = null;
    this.dialogueReveal = 0;

    this.facing = 1; this.moving = false; this.walkT = 0;
    this.camX = 0; this.camY = 0;

    this.currentDistrict = null;
    this.districtBanner = null; this.districtBannerT = 0;
    this.introHintT = 4.5; // brief control hint, then it fades for good

    this._buildTown();
    // player starts just south of the plaza (the world origin)
    this.px = this.plazaCenter.x; this.py = this.plazaCenter.y + 60;
    this.near = null;
  }

  // ---- town definition ----------------------------------------------------

  _buildTown() {
    // ======================================================================
    // MASTER TOWN LAYOUT v4 — full spatial reorganization. One compact
    // settlement radiating from Crystal Plaza, with the dungeon route
    // running due NORTH: Plaza -> Guild -> Wayfarer's Watch -> Adventure
    // Road -> Runebound Gate. Distances are speed-derived (100 units = 1s
    // of walking) and chosen against the approved time targets: potion
    // 5-8s, forge 7-10s, market/guild 8-12s, homes 10-15s, archive 12-18s,
    // training/sanctuary 15-20s, watch 20-25s, gate 30-40s.
    //
    // Mental compass (core navigation): NORTH adventure, EAST shops,
    // SOUTH/SE market, WEST/SW homes. Outer ring: training NW, archive NE,
    // sanctuary SW. Nothing but the Gate lies beyond the Watch.
    // FINAL SPACING POLISH: same landscape relationships, three density
    // rings —
    //   CORE (compact, around the plaza): potion 6.1s, forge 8.4s,
    //     market 8.4s, guild 9.6s, residential ~11s (player house 13.7s)
    //   OUTER TOWN: archive 13.5s, sanctuary 16.2s, training 17.0s
    //   ADVENTURE OUTSKIRTS: watch 16.2s, gate 23.7s (longest route)
    // vs the previous pass: market pulled 16% closer, archive 23% closer,
    // guild->watch shortened 35%, watch->gate shortened 25%. The Gate is
    // still the northernmost destination; its remaining distance is meant
    // to read through environment, not empty grass. Developed-town bbox
    // (training<->archive x guild<->market): ~2750x1750 on centers,
    // ~2930x1930 on sprite edges -> ~1.5:1 landscape either way.
    const PZ = { x: 2050, y: 2750 };
    const OFF = (dx, dy) => ({ x: PZ.x + dx, y: PZ.y + dy });

    const D = {
      plaza: PZ,
      market: OFF(260, 800),        // S/SE core: destination square (~8.4s)
      residential: OFF(-1050, 400), // W/SW core: neighborhood center (~11s)
      southRoad: OFF(280, 1250),    // S: future world exit past the market
      // Moved off the main trunk: slightly further up, and a lot further
      // left — now shares the Lake's exact x (same side-to-side position),
      // sitting just north of it instead of east on the adventure spine.
      guild: OFF(-750, -1100),      // W, level with the Lake (~14.1s)
      archive: OFF(1150, -700),     // NE outer: quiet landscaped property (~13.5s)
      training: OFF(-1600, -560),   // W/NW outer: large dedicated compound (~17s)
      sanctuary: OFF(-1500, 620),   // W/SW outer: green outskirts (~16.2s)
      watch: OFF(0, -1620),         // N adventure: fortified checkpoint (~16.2s)
      gate: OFF(0, -2370),          // FAR NORTH (locked): northernmost destination (~23.7s)
      // Same side-to-side (x) position as the original NW placement; y
      // recentred to sit between the Guild and the Fountain (halfway
      // between their anchors) after the 170% size-up — see the in-browser
      // clearance check this pass for exact neighbor gaps at the new size.
      lake: OFF(-750, -415),        // between Guild and Crystal Fountain, nudged toward the plaza
    };
    // Commercial: the Forge keeps the east street. The Potion Shop was moved
    // off that street and down the market-bound lane — the two shops were
    // crowding each other at ~230 units apart, and each needs room for its
    // own prop set later (herbs/crates vs firewood/weapon racks). They now sit
    // ~490 apart on different roads, and the Potion Shop is on the OUTSIDE
    // (south) side of the commercial street, roughly halfway toward Market.
    const forgeSpot = OFF(820, -180);   // ~8.4s, on the east street
    const potionSpot = OFF(560, 250);   // ~6.1s, south of the street, market-bound lane
    // Residential quarter members: the player house gets the largest lot on
    // the loop's quiet southwest side; Hearthwood cottage fronts the east.
    const houseSpot = { x: D.residential.x - 200, y: D.residential.y + 160 };  // ~13.7s, largest lot
    const cottageSpot = { x: D.residential.x + 150, y: D.residential.y - 140 };// ~9.4s

    this.plazaCenter = PZ;
    // The fountain sprite is anchored at its base (PZ.y) and drawn upward, so
    // its true VISUAL center sits FOUNTAIN_H/2 above PZ.y — the plaza disc and
    // the four road exits are built around that point, not PZ.y itself, so
    // the fountain is actually centered on both axes rather than just close.
    const FC = { x: PZ.x, y: PZ.y - FOUNTAIN_H / 2 };
    this.plazaFocus = FC;
    // diameter ~2.35x the fountain's width -> fountain occupies ~43% of it
    this.plazaRadius = Math.round(FOUNTAIN_W * 2.2 / 2); // ~2.2x fountain diameter

    this.locations = [
      { id: 'plaza', name: 'Crystal Plaza', dx: PZ.x, dy: PZ.y + 18, action: 'rest', district: 'Crystal Plaza',
        draw: (g) => drawFountainSprite(g, PZ.x, PZ.y, this.t, this.plazaRadius), solid: { x: PZ.x - 26, y: PZ.y - 27, w: 52, h: 16 } },

      // ---- North approach: a single large crystal lamp on the west side of
      // the road, right where the plaza's circular edge ends and the
      // straight path starts, just outside the road surface.
      { id: 'lampNorthW', name: null, dx: null, dy: null, action: null, sortY: FC.y - this.plazaRadius - 10,
        draw: (g) => drawPropArt(g, LAMP_CRYSTAL_ART, FC.x - 30, FC.y - this.plazaRadius - 10, LAMP_W, LAMP_H, 6),
        solid: { x: FC.x - 30 - 4, y: FC.y - this.plazaRadius - 10 - 4, w: 8, h: 8 } },

      // ---- South approach: a single lamp (style #4) on the east side,
      // wider apart and further south than the north lamp so it reads as
      // an exit marker on the road itself, not a prop inside the ring.
      { id: 'lampSouthE', name: null, dx: null, dy: null, action: null, sortY: FC.y + this.plazaRadius + 28,
        draw: (g) => drawPropArt(g, LAMP4_ART, FC.x + 34, FC.y + this.plazaRadius + 28, LAMP4_W, LAMP4_H, 6, true),
        solid: { x: FC.x + 34 - 4, y: FC.y + this.plazaRadius + 28 - 4, w: 8, h: 8 } },

      // ---- Weapon Smith + Potion Shop: standalone column below Training ----
      { id: 'weapon', name: 'Ironhearth Forge', dx: forgeSpot.x, dy: forgeSpot.y, action: 'weapon', district: 'Ironhearth Forge',
        draw: (g) => drawBlacksmith(g, forgeSpot.x, forgeSpot.y, this.t),
        solid: { x: forgeSpot.x - 56, y: forgeSpot.y - 68, w: 112, h: 68 } },
      { id: 'potion', name: 'Potion Shop', dx: potionSpot.x, dy: potionSpot.y, action: 'potion', district: 'Potion Shop',
        draw: (g) => drawPotionShop(g, potionSpot.x, potionSpot.y, this.t),
        solid: { x: potionSpot.x - 56, y: potionSpot.y - 80, w: 113, h: 80 } },

      // ---- Market Square: one shared open square, stalls on its edges ----
      { id: 'market', name: 'Market Square', dx: D.market.x, dy: D.market.y, action: 'market', district: 'Market Square', zone: true,
        draw: (g) => drawMarket(g, D.market.x, D.market.y, this.t), solid: null },

      // ---- Residential Quarter: neighborhood loop with 4 lots ----
      { id: 'home', name: 'Player House', dx: houseSpot.x, dy: houseSpot.y, action: 'house', district: 'Player House',
        draw: (g) => drawPlayerHouse(g, houseSpot.x, houseSpot.y, this.t),
        solid: { x: houseSpot.x - HOUSE_W / 2, y: houseSpot.y - HOUSE_H, w: HOUSE_W, h: HOUSE_H } },
      { id: 'cottage', name: 'Hearthwood Cottage (reserved)', dx: cottageSpot.x, dy: cottageSpot.y, action: null, district: 'Residential Quarter',
        draw: (g) => drawPropArt(g, COTTAGE_ART, cottageSpot.x, cottageSpot.y, COTTAGE_W, COTTAGE_H, 0),
        solid: { x: cottageSpot.x - COTTAGE_W / 2, y: cottageSpot.y - COTTAGE_H, w: COTTAGE_W, h: COTTAGE_H } },
      // Reserved future-home lots fronting the neighborhood loop (NW + E),
      // so all four residential properties face the same street.
      { id: 'lotA', name: null, dx: null, dy: null, action: null, sortY: D.residential.y - 85,
        draw: (g) => drawMarker(g, D.residential.x - 175, D.residential.y - 130, 62, 46, 'Future Home') },
      { id: 'lotB', name: null, dx: null, dy: null, action: null, sortY: D.residential.y + 130,
        draw: (g) => drawMarker(g, D.residential.x + 175, D.residential.y + 85, 62, 46, 'Future Home') },

      // ---- South Road ----
      { id: 'southExpand', name: null, dx: null, dy: null, action: null, sortY: D.southRoad.y,
        draw: (g) => drawSignpost(g, D.southRoad.x + 40, D.southRoad.y, 'South Road - Future Expansion') },

      // ---- Shield & Stein: building + social courtyard ----
      { id: 'guild', name: 'Shield & Stein', dx: D.guild.x, dy: D.guild.y + 72, action: 'guild', district: 'Shield & Stein',
        draw: (g) => drawTavern(g, D.guild.x, D.guild.y + 72, this.t),
        solid: { x: D.guild.x - 61, y: D.guild.y - 6, w: 122, h: 78 } },

      // ---- Runewood Archive: landscaped property ----
      { id: 'library', name: 'Runewood Archive', dx: D.archive.x, dy: D.archive.y + 45, action: 'library', district: 'Runewood Archive',
        draw: (g) => drawLibrary(g, D.archive.x, D.archive.y + 45, this.t),
        solid: { x: D.archive.x - 45, y: D.archive.y - 25, w: 90, h: 70 } },

      // ---- Moonpaw Sanctuary: large green fenced property ----
      { id: 'pets', name: 'Moonpaw Sanctuary (reserved)', dx: D.sanctuary.x, dy: D.sanctuary.y + 55, action: 'pets', district: 'Moonpaw Sanctuary',
        draw: (g) => drawPropArt(g, SANCTUARY_ART, D.sanctuary.x, D.sanctuary.y + 55, SANCTUARY_W, SANCTUARY_H, 0),
        solid: { x: D.sanctuary.x - SANCTUARY_W / 2, y: D.sanctuary.y + 55 - SANCTUARY_H, w: SANCTUARY_W, h: SANCTUARY_H } },

      // ---- Valorhall: large dedicated compound ----
      { id: 'training', name: 'Valorhall Training Grounds', dx: D.training.x, dy: D.training.y, action: 'training', district: 'Valorhall Training Grounds', zone: true,
        draw: (g) => drawTrainingGround(g, D.training.x, D.training.y, this.t),
        solid: { x: D.training.x - 75, y: D.training.y - 60, w: 150, h: 24 } },

      // ---- Wayfarer's Watch: fortified checkpoint straddling the road ----
      // Compound art with baked courtyard ground: sortY sits at the base of
      // the gatehouse wall so the player renders on top of the art while
      // inside the courtyard, but behind the wall when north of it.
      // Collision is the two wall slabs + the keeper's cottage (appended to
      // this.solids below), leaving the central arch OPEN so the Adventure
      // Road passes straight through the compound.
      { id: 'watchGate', name: null, dx: null, dy: null, action: null, district: "Wayfarer's Watch", sortY: D.watch.y - 29,
        draw: (g) => drawPropArt(g, WATCH_ART, D.watch.x + 35, D.watch.y + 30, WATCH_W, WATCH_H, 0),
        solid: null },

      // ---- Runebound Gate: large northern landmark approach ----
      { id: 'dungeon', name: 'Runebound Gate', dx: D.gate.x, dy: D.gate.y + 48, action: 'dungeon', district: 'Runebound Gate',
        draw: (g) => drawPropArt(g, DUNGEON_ART, D.gate.x, D.gate.y + 28, DUNGEON_W, DUNGEON_H, 0),
        solid: { x: D.gate.x - DUNGEON_W / 2, y: D.gate.y + 28 - DUNGEON_H, w: DUNGEON_W, h: DUNGEON_H * 0.65 } },

      // ---- Quest Board: small functional prop beside the Watch approach ----
      { id: 'quest', name: 'Quest Board', dx: D.watch.x - 70, dy: D.watch.y + 115, action: 'quest', district: "Wayfarer's Watch",
        draw: (g) => drawQuestBoard(g, D.watch.x - 70, D.watch.y + 111, this.t, !!this.hero.activeQuest()),
        solid: { x: D.watch.x - 82, y: D.watch.y + 95, w: 24, h: 16 } },
    ];

    this.districts = D;
    this.solids = this.locations.filter((l) => l.solid).map((l) => l.solid);
    // Wayfarer's Watch collision (measured off the art's own proportions):
    // wall slabs flanking the open central arch, plus the keeper's cottage.
    {
      const wx = D.watch.x + 35, wTop = D.watch.y + 30 - WATCH_H;
      this.solids.push(
        { x: wx - 46, y: wTop + 1, w: 30, h: 51 },  // gatehouse wall, west of arch
        { x: wx + 17, y: wTop + 1, w: 28, h: 51 },  // gatehouse wall, east of arch
        { x: wx - 89, y: wTop + 16, w: 49, h: 59 }, // keeper's cottage
      );
    }
    // Lake collision: axis-aligned rects decomposed from the matted PNG's
    // own water pixels (POND_WATER_RECTS above) — the closest fit to
    // "polygon collision" this engine's AABB-only solids can express. Only
    // the water is solid, so the grass/dirt/rock shoreline stays walkable
    // and the player can approach the water's edge.
    this.lakeTopLeft = { x: D.lake.x - POND_W / 2, y: D.lake.y - POND_H / 2 };
    for (const [fx, fy, fw, fh] of POND_WATER_RECTS) {
      this.solids.push({
        x: this.lakeTopLeft.x + fx * POND_W, y: this.lakeTopLeft.y + fy * POND_H,
        w: fw * POND_W, h: fh * POND_H,
      });
    }

    // district entry-banner regions (Player House folded into Residential —
    // the house is a member of the neighborhood now, not its own district)
    this.regions = [
      { name: 'Crystal Plaza', x: PZ.x - 160, y: PZ.y - 180, w: 320, h: 320 },
      { name: 'Potion Shop', x: potionSpot.x - 130, y: potionSpot.y - 140, w: 250, h: 210 },
      { name: 'Ironhearth Forge', x: forgeSpot.x - 110, y: forgeSpot.y - 140, w: 230, h: 210 },
      { name: 'Market Square', x: D.market.x - 260, y: D.market.y - 210, w: 520, h: 420 },
      { name: 'Residential Quarter', x: D.residential.x - 340, y: D.residential.y - 270, w: 660, h: 600 },
      { name: 'Shield & Stein', x: D.guild.x - 130, y: D.guild.y - 90, w: 260, h: 250 },
      { name: 'Runewood Archive', x: D.archive.x - 140, y: D.archive.y - 110, w: 280, h: 270 },
      { name: 'Moonpaw Sanctuary', x: D.sanctuary.x - 200, y: D.sanctuary.y - 170, w: 400, h: 340 },
      { name: 'Valorhall Training Grounds', x: D.training.x - 190, y: D.training.y - 160, w: 380, h: 330 },
      { name: "Wayfarer's Watch", x: D.watch.x - 160, y: D.watch.y - 140, w: 390, h: 300 },
      { name: 'Runebound Gate', x: D.gate.x - 320, y: D.gate.y - 240, w: 640, h: 470 },
      { name: 'South Road', x: D.southRoad.x - 140, y: D.southRoad.y - 110, w: 280, h: 220 },
    ];

    // ------------------------------------------------------------ roads ---
    // SPATIAL PASS ONLY: these are logical centerlines for the coming
    // handcrafted modular road pieces — no procedural road drawing. The
    // waypoint polylines live in this.roadPlan (dev overview + future
    // passes); this.roads/roadCells are still rasterised so tree/prop
    // placement keeps avoiding the planned streets.
    const mainWidth = 34, resWidth = 20, narrowWidth = 12, advWidth = 34; // main matches flareFarW below exactly

    // Crystal Plaza is a true 4-way intersection: exactly one road meets it
    // per cardinal direction (N/E/S/W), all the same width, all starting at
    // the same distance (the plaza radius) from the fountain's visual center
    // FC — never from the center itself, so nothing ever overlaps the
    // fountain's collision box.
    const exitN = [FC.x, FC.y - this.plazaRadius];
    const exitS = [FC.x, FC.y + this.plazaRadius];
    const exitE = [FC.x + this.plazaRadius, FC.y];
    const exitW = [FC.x - this.plazaRadius, FC.y];
    const R = this.plazaRadius;
    // Flare trapezoids: short (~1-2 player lengths) transition at each exit,
    // tapering from a widened mouth down to the plaza's own jittered circle
    // boundary — see buildFlare(). Locked to explicit values (not derived
    // from mainWidth) so plaza-connection geometry never drifts if the
    // regular road width elsewhere changes.
    const flareNearW = 44, flareFarW = 34, flareDepth = 32;
    this.plazaFlares = [
      buildFlare(FC, R, -90, flareNearW, flareFarW, flareDepth), // N
      buildFlare(FC, R, 90, flareNearW, flareFarW, flareDepth),  // S
      buildFlare(FC, R, 0, flareNearW, flareFarW, flareDepth),   // E
      buildFlare(FC, R, 180, flareNearW, flareFarW, flareDepth), // W
    ];

    // WX = the Watch art's centerline (the arch); WX-24 = the south fence gap.
    const WX = D.watch.x + 35;
    // Each segment declares its material family and painted width. `famTo`
    // makes a segment blend from one family into another along its length
    // (the §7 transition rule — families never cut at a hard straight line);
    // `w1` tapers the width along the same axis, which is how the Ancient
    // road narrows as it approaches the Gate.
    const plan = [
      // MAIN N: Plaza -> Watch south approach, straight up the spine — no
      // longer detours to the Guild now that it's moved west to the Lake
      // (see the Guild spur below instead). The one road that matters for
      // progression: town -> adventure, so it eases main -> civic as it goes.
      { kind: 'main', fam: 'main', famTo: 'civic', w0: 34, w1: 31, width: mainWidth, pts: [
        exitN, [PZ.x, PZ.y - 700], [WX - 24, D.watch.y + 500], [WX - 24, D.watch.y + 130]] },
      // SECONDARY: main trunk -> Guild spur. Branches off the Plaza->Watch
      // spine well north of the Lake (y=PZ.y-700, ~285 units clear of its
      // top edge) and drops straight down into the Guild's courtyard —
      // Guild's second connection besides the Training link below, so it's
      // not a dead end reachable only by way of Training.
      { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 27, w1: 27, width: narrowWidth, pts: [
        [PZ.x, PZ.y - 700], [PZ.x - 250, PZ.y - 760], [D.guild.x + 180, D.guild.y + 190],
        [D.guild.x + 55, D.guild.y + 40]] },
      // ADVENTURE ROAD: through the Watch (fence gap -> courtyard -> arch),
      // then the long wilderness run north to the Runebound Gate. Ancient
      // family throughout, narrowing 30 -> 21 as civilization falls away.
      { kind: 'adventure', fam: 'ancient', w0: 30, w1: 21, width: advWidth, pts: [
        [WX - 24, D.watch.y + 130], [WX - 24, D.watch.y], [WX, D.watch.y - 30], [WX, D.watch.y - 90],
        [D.gate.x + 40, D.gate.y + 620], [D.gate.x, D.gate.y + 370], [D.gate.x, D.gate.y + 45]] },
      // MAIN E: Plaza -> Commercial street, running to the Forge's front.
      { kind: 'main', fam: 'main', w0: 34, w1: 34, width: mainWidth, pts: [
        exitE, [PZ.x + 330, PZ.y - 20], [PZ.x + 600, PZ.y - 90], [forgeSpot.x, forgeSpot.y + 55]] },
      // MAIN S: Plaza -> Market Square. Runs down the square's WEST rim
      // rather than through it, so the stalls front a real street while the
      // open middle stays clear for NPC traffic and events.
      { kind: 'main', fam: 'main', w0: 34, w1: 30, width: mainWidth, pts: [
        exitS, [PZ.x + 60, PZ.y + 430], [D.market.x - 240, D.market.y - 300],
        [D.market.x - 205, D.market.y - 60], [D.market.x - 195, D.market.y + 60]] },
      // Market -> South Road (future world exit) — continues from the same
      // rim point so the street reads as one continuous route through town,
      // then tapers toward the map edge.
      { kind: 'main', fam: 'main', w0: 30, w1: 24, width: mainWidth, pts: [
        [D.market.x - 195, D.market.y + 60], [D.market.x - 120, D.market.y + 250],
        [D.southRoad.x, D.southRoad.y]] },
      // MAIN W: Plaza -> Residential entry (a long, clearly horizontal run)
      { kind: 'main', fam: 'main', famTo: 'res', w0: 34, w1: 22, width: mainWidth, pts: [
        exitW, [PZ.x - 420, PZ.y + 60], [PZ.x - 700, PZ.y + 260], [D.residential.x + 215, D.residential.y - 70]] },
      // Residential neighborhood loop — a compact ring street with all four
      // properties fronting it: Hearthwood + lotA on the north arc, lotB
      // east, Player House on the south arc with the deepest yard.
      // The west arc swings out to x-300 rather than x-235: at the tighter
      // radius the arc ran diagonally straight THROUGH the Player House's
      // footprint (the house sat on the street, not beside it). Pushed west,
      // the house now sits inside the ring fronting the south arc, with its
      // yard between.
      { kind: 'res', fam: 'res', w0: 20, w1: 20, width: resWidth, pts: [
        [D.residential.x + 215, D.residential.y - 70], [cottageSpot.x, cottageSpot.y + 40],
        [D.residential.x - 95, D.residential.y - 65], [D.residential.x - 280, D.residential.y - 55],
        [D.residential.x - 300, D.residential.y + 80], [houseSpot.x - 30, houseSpot.y + 62],
        [D.residential.x + 60, D.residential.y + 175], [D.residential.x + 215, D.residential.y + 85],
        [D.residential.x + 215, D.residential.y - 70]] },
      // SECONDARY: Residential -> Valorhall (northwest lane), firming from
      // neighbourhood stone into the wilder outskirts.
      { kind: 'secondary', fam: 'res', famTo: 'nature', w0: 19, w1: 17, width: narrowWidth, pts: [
        [D.residential.x - 280, D.residential.y - 55], [D.training.x + 230, D.residential.y - 240],
        [D.training.x + 60, D.training.y + 230], [D.training.x, D.training.y + 100]] },
      // SECONDARY: Valorhall -> Guild — closes the house -> training -> guild
      // -> adventure loop and gives the north side a long east/west run.
      // Rerouted (lake up to 170%/recentred pass) around the lake's north
      // shore instead of straight through it: same two endpoints, a nub up
      // and a sweep at y=1975 clears the lake's top edge (2075) by ~100
      // units before dropping down into the Guild's courtyard. This is the
      // scenic lakeside route, so it runs Nature until it reaches the Guild.
      // Starts at Valorhall's own entrance (the same point the Residential
      // lane arrives at) and runs up the compound's east side, so the two
      // form one continuous Residential -> Training -> lakeside -> Guild
      // route instead of this one dead-ending in grass beside the compound.
      { kind: 'secondary', fam: 'nature', famTo: 'civic', w0: 17, w1: 22, width: narrowWidth, pts: [
        [D.training.x + 30, D.training.y + 100], [D.training.x + 205, D.training.y + 20],
        [D.training.x + 250, 1985], [D.guild.x - 150, 1930], [D.guild.x - 75, D.guild.y + 60]] },
      // SECONDARY: Commercial -> Archive (quiet landscaped NE path)
      { kind: 'secondary', fam: 'main', w0: 20, w1: 20, width: narrowWidth, pts: [
        [forgeSpot.x + 30, forgeSpot.y + 30], [D.archive.x - 120, PZ.y - 420],
        [D.archive.x, D.archive.y + 200], [D.archive.x, D.archive.y + 70]] },
      // SECONDARY: Archive -> north road (adventure-route link, no backtrack)
      // — joins the main trunk at the same waypoint the trunk itself bends
      // through, now that this no longer doubles as "near the Guild".
      { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 18, w1: 18, width: narrowWidth, pts: [
        [D.archive.x - 40, D.archive.y - 20], [D.archive.x - 700, D.archive.y - 200], [WX - 24, D.watch.y + 500]] },
      // SECONDARY: Commercial -> Market (east loop, skips the plaza). Runs
      // down the square's EAST rim, mirroring the main road on the west, so
      // the market sits framed between two streets instead of having a lane
      // dead-end in the grass north of the stalls.
      // It leaves the commercial street, passes the Potion Shop's front door
      // on the way down, then continues to the market.
      { kind: 'secondary', fam: 'main', w0: 22, w1: 20, width: narrowWidth, pts: [
        [PZ.x + 480, PZ.y - 60], [potionSpot.x + 40, potionSpot.y - 130],
        [potionSpot.x + 105, potionSpot.y + 30], [D.market.x + 235, D.market.y - 200],
        [D.market.x + 205, D.market.y + 40]] },
      // SECONDARY: Residential -> Market (south loop, skips the plaza).
      // Starts exactly on a loop vertex — branching a few dozen units off the
      // ring left a blobby smear of overlapping road at the junction.
      { kind: 'secondary', fam: 'res', famTo: 'main', w0: 19, w1: 20, width: narrowWidth, pts: [
        [D.residential.x + 60, D.residential.y + 175], [PZ.x - 700, D.market.y - 150],
        [PZ.x - 250, D.market.y + 40], [D.market.x - 250, D.market.y + 30]] },
      // SECONDARY: Residential -> Sanctuary (green outskirts lane, westward),
      // starting on the loop's west vertex. Its second waypoint used to sit
      // EAST of its own start, so the lane doubled back on itself and the
      // resulting hook cut straight through the Player House; it now runs
      // consistently south-west from the ring to the Sanctuary's front.
      // The approach also used to place a waypoint inside the Sanctuary's own
      // footprint, running the lane under the building; it now passes down its
      // east side and comes back west along the front to reach the door.
      { kind: 'secondary', fam: 'nature', w0: 15, w1: 14, width: narrowWidth, pts: [
        [D.residential.x - 300, D.residential.y + 80], [D.sanctuary.x + 200, D.sanctuary.y - 40],
        [D.sanctuary.x + 130, D.sanctuary.y + 90], [D.sanctuary.x, D.sanctuary.y + 80]] },
      // NATURE: Lake shoreline spur — branches off the Residential->Valorhall
      // lane and runs east to the Lake's calm SOUTH cove, stopping at the
      // water's edge. Reserved future home of the fishing spot / bench /
      // dock. Deliberately approaches from the town side: the north and west
      // shores stay roadless wilderness, which is what keeps the far side of
      // the lake feeling untouched.
      { kind: 'secondary', fam: 'nature', w0: 13, w1: 14, width: narrowWidth, pts: [
        [D.training.x + 165, D.training.y + 510], [D.lake.x - 400, D.lake.y + 305],
        [D.lake.x - 150, D.lake.y + 215], [D.lake.x - 135, D.lake.y + 188]] },
    ];
    this.roadPlan = plan;
    this.roads = plan.flatMap((p) => roadPath(p.pts, p.width));

    // Coarse tile-grid rasterisation, kept only for the vegetation/prop
    // avoidance checks that already depend on it (_nearAnyRoad uses the
    // rects; this Set is the cheap "is there road here" lookup). The visible
    // road surface is painted from the finer coverage map built below.
    this.roadCells = new Set();
    for (const r of this.roads) {
      const horizontal = r.w >= r.h;
      const across = Math.max(1, Math.round(Math.min(r.w, r.h) / ROAD_TILE));
      const cy = Math.floor((r.y + r.h / 2) / ROAD_TILE);
      const cx = Math.floor((r.x + r.w / 2) / ROAD_TILE);
      if (horizontal) {
        const c0 = Math.floor(r.x / ROAD_TILE), c1 = Math.floor((r.x + r.w) / ROAD_TILE);
        for (let c = c0; c <= c1; c++) for (let k = 0; k < across; k++) this.roadCells.add(`${c},${cy + k}`);
      } else {
        const r0 = Math.floor(r.y / ROAD_TILE), r1 = Math.floor((r.y + r.h) / ROAD_TILE);
        for (let rr = r0; rr <= r1; rr++) for (let k = 0; k < across; k++) this.roadCells.add(`${cx + k},${rr}`);
      }
    }

    this._buildRoadCoverage(FC);

    // ----------------------------------------------------------- terrain --
    // wild/meadow zones: outer districts + gate approach only
    this.wildZones = [
      { x: D.sanctuary.x, y: D.sanctuary.y, r: 230 },
      { x: D.training.x - 60, y: D.training.y, r: 210 },
      { x: D.gate.x, y: D.gate.y, r: 260 },
    ];

    // Market Square ground: one substantial open square southeast of the
    // plaza — bigger than a building lot, far smaller than a field. Stalls
    // sit on its rim (see drawMarket), the center stays open.
    this.marketGround = { cx: D.market.x, cy: D.market.y, rx: 230, ry: 175 };
    // Forge + Potion + Guild + Archive courtyards: small stone aprons in front of the shops
    this.courtyards = [
      { cx: forgeSpot.x, cy: forgeSpot.y, rx: 85, ry: 35 },
      { cx: potionSpot.x, cy: potionSpot.y, rx: 85, ry: 35 },
      { cx: D.guild.x, cy: D.guild.y + 72, rx: 90, ry: 38 },
      { cx: D.archive.x, cy: D.archive.y + 45, rx: 85, ry: 35 },
    ];
    // Keep road-tile texture out from under each courtyard oval — same reason
    // the plaza subtracts its own circle: without it, the approaching road's
    // full-width tiles show through/against the oval's edge as a hard seam.
    for (const key of [...this.roadCells]) {
      const [c, r] = key.split(',').map(Number);
      const cx2 = c * ROAD_TILE + ROAD_TILE / 2, cy2 = r * ROAD_TILE + ROAD_TILE / 2;
      for (const ct of this.courtyards) {
        const nx = (cx2 - ct.cx) / (ct.rx - 4), ny = (cy2 - ct.cy) / (ct.ry - 4);
        if (nx * nx + ny * ny < 1) { this.roadCells.delete(key); break; }
      }
    }

    // Vegetation defines the space: dense perimeter forest (town carved out
    // of the woods), thick clusters between districts, all auto-avoiding
    // roads and reserved footprints.
    this.trees = [];
    const cluster = (cx, cy, n, spread, kind) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(cx + i) * 2;
        const r = spread * (0.4 + hash(cx * i + cy) * 0.6);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7;
        if (this._nearAnyDistrict(x, y, 70) || this._nearAnyRoad(x, y, 26)) continue;
        if (Math.hypot(x - FC.x, y - FC.y) < this.plazaRadius + 40) continue;
        if (Math.hypot((x - this.marketGround.cx) / 1.15, y - this.marketGround.cy) < this.marketGround.rx + 30) continue;
        this.trees.push({ x, y, kind: (i % 3 === 0) ? 'pine' : kind });
      }
    };
    // between-district buffers (reference-style density)
    cluster(PZ.x - 190, PZ.y - 330, 7, 90, 'pine');      // plaza NW / guild N gap
    cluster(PZ.x + 330, PZ.y - 300, 8, 110, 'tree');     // plaza NE / archive S gap
    cluster(PZ.x - 360, PZ.y + 330, 7, 100, 'tree');     // residential N buffer
    cluster(PZ.x + 480, PZ.y + 260, 8, 110, 'tree');     // market E buffer
    cluster(PZ.x - 40, PZ.y + 520, 6, 90, 'pine');       // south road flanks
    cluster(D.guild.x - 220, D.guild.y + 130, 6, 90, 'pine');
    cluster(D.archive.x - 240, D.archive.y - 40, 6, 90, 'pine');
    cluster(D.archive.x + 160, D.archive.y + 120, 6, 80, 'tree');
    cluster(D.sanctuary.x + 220, D.sanctuary.y + 60, 7, 100, 'pine');
    cluster(D.sanctuary.x - 60, D.sanctuary.y + 220, 6, 90, 'tree');
    cluster(D.training.x + 220, D.training.y + 160, 6, 90, 'pine');
    cluster(D.training.x - 40, D.training.y + 260, 5, 80, 'tree');
    cluster(D.watch.x - 240, D.watch.y + 60, 7, 100, 'pine');
    cluster(D.watch.x + 260, D.watch.y - 60, 6, 90, 'pine');
    cluster(D.gate.x - 240, D.gate.y + 120, 7, 90, 'pine');
    cluster(D.gate.x + 240, D.gate.y + 120, 7, 90, 'pine');
    cluster(D.market.x + 60, D.market.y + 260, 6, 90, 'tree');
    cluster(D.residential.x - 80, D.residential.y + 320, 6, 90, 'pine');
    // dense multi-row perimeter forest
    for (let x = 20; x < MAP_W; x += 42) {
      for (let row = 0; row < 3; row++) {
        const yN = 30 + row * 34 + hash(x * (row + 1)) * 26;
        const yS = MAP_H - 26 - row * 34 - hash(x * (row + 2)) * 26;
        if (!this._nearAnyDistrict(x, yN, 40) && !this._nearAnyRoad(x, yN, 30)) this.trees.push({ x: x + row * 12, y: yN, kind: 'pine' });
        if (!this._nearAnyDistrict(x, yS, 40) && !this._nearAnyRoad(x, yS, 30)) this.trees.push({ x: x + row * 14, y: yS, kind: 'pine' });
      }
    }
    for (let y = 70; y < MAP_H - 50; y += 46) {
      for (let row = 0; row < 3; row++) {
        const xW = 24 + row * 34 + hash(y * (row + 1)) * 24;
        const xE = MAP_W - 24 - row * 34 - hash(y * (row + 2)) * 24;
        if (!this._nearAnyDistrict(xW, y, 40) && !this._nearAnyRoad(xW, y, 30)) this.trees.push({ x: xW, y: y + row * 10, kind: 'pine' });
        if (!this._nearAnyDistrict(xE, y, 40) && !this._nearAnyRoad(xE, y, 30)) this.trees.push({ x: xE, y: y + row * 12, kind: 'pine' });
      }
    }
    // Vegetation stripped for now (per direction) — plain grass only. The
    // generation above is left intact so trees/meadow can come back later;
    // this just empties what actually gets drawn.
    this.trees = [];
    this.wildZones = [];

    // still a geometry pass: no props/lamps/NPCs yet
    this.propGroups = [];
    this.lamps = [];
    this.braziers = [];
    this.npcs = [];
    this.sanctuaryPets = [];
    this.sanctuary = { x: D.sanctuary.x - 40, y: D.sanctuary.y - 20, w: 80, h: 40 };

    // Step-24 development overview data (drawn only while window.__townDebug
    // is set from the console — never gameplay UI): big district tags, plus
    // the road centerlines above.
    this.debugLabels = [
      ['CRYSTAL PLAZA', PZ.x, PZ.y - 190],
      ['FORGE', forgeSpot.x, forgeSpot.y - 150],
      ['POTION', potionSpot.x, potionSpot.y - 150],
      ['MARKET', D.market.x, D.market.y + 260],
      ['RESIDENTIAL', D.residential.x, D.residential.y + 330],
      ['GUILD', D.guild.x, D.guild.y - 120],
      ['TRAINING', D.training.x, D.training.y - 130],
      ['ARCHIVE', D.archive.x, D.archive.y - 100],
      ['SANCTUARY', D.sanctuary.x, D.sanctuary.y + 130],
      ['WATCH', D.watch.x + 35, D.watch.y - 150],
      ['RUNEBOUND GATE', D.gate.x, D.gate.y - 130],
      ['LAKE', D.lake.x, D.lake.y - POND_H / 2 - 24],
    ];
  }

  // ---- road surface -------------------------------------------------------
  // Walks every planned centerline and marks a fine coverage grid with the
  // family + progress at that point. Marking the real polyline (rather than
  // reusing the coarse rects) is what lets each family keep its actual
  // designed width — 34 units for a main road, 13 for a footpath — instead of
  // every road collapsing to a whole number of 28-unit tiles.
  _buildRoadCoverage(FC) {
    const C = ROAD_CELL;
    const cov = new Map();
    const R = this.plazaRadius;

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
      // The plaza floor owns its own disc and flares — roads stop at its edge.
      if (Math.hypot(px - FC.x, py - FC.y) < R - 2) return;
      for (const fl of this.plazaFlares) {
        if (flareContains(fl, FC, R, px, py, 0)) return;
      }
      const k = cx + ',' + cy;
      const prev = cov.get(k);
      const pri = (ROAD_FAM[fam] || ROAD_FAM.main).pri;
      if (prev && prev.pri >= pri) return; // a main road paints over a footpath
      cov.set(k, { fam, t, pri, wash });
    };

    for (let segIdx = 0; segIdx < this.roadPlan.length; segIdx++) {
      const seg = this.roadPlan[segIdx];
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
      const WOB = { main: [22, 420], res: [9, 190], secondary: [24, 320], adventure: [26, 520] };
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
    this.roadCov = cov;
  }

  /** Paint the road surface: stone sampled from the shared 28-unit tile grid
   * (so masonry stays continuous across the whole network and into the plaza),
   * then a per-family wash, then a darker lip on any cell facing open ground. */
  _drawRoads(g, visW, visH) {
    const C = ROAD_CELL;
    const cov = this.roadCov;
    if (!cov || !cov.size) return;
    const c0 = Math.floor(this.camX / C) - 1, c1 = Math.ceil((this.camX + visW) / C) + 1;
    const r0 = Math.floor(this.camY / C) - 1, r1 = Math.ceil((this.camY + visH) / C) + 1;

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
        const tc = Math.floor(x / ROAD_TILE), tr = Math.floor(y / ROAD_TILE);
        const tile = roadTileFor(cell.fam, tc, tr);
        if (tile && tile.ready) {
          g.drawImage(tile.img, x - tc * ROAD_TILE, y - tr * ROAD_TILE, C, C, x, y, C, C);
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

  // ---- Step 24: temporary development overview ----------------------------
  // Toggled from the console via `window.__townDebug = true` (paired with a
  // small `window.__townZoom` for whole-map screenshots). Draws the planned
  // road centerlines and district tags scaled to stay readable at any zoom.
  _drawDebugOverview(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const p of this.roadPlan) {
      g.strokeStyle = p.kind === 'adventure' ? 'rgba(226,124,60,0.85)'
        : p.kind === 'main' ? 'rgba(255,240,170,0.85)' : 'rgba(205,225,140,0.6)';
      g.lineWidth = Math.max(p.width * 0.3, 2 / Z);
      strokeRoundedPath(g, p.pts, 70);
    }
    const s = Math.max(2, Math.round(1.3 / Z));
    for (const [name, x, y] of this.debugLabels) {
      const w = textWidth(name, s) + 8 * s;
      rect(g, x - w / 2, y - 5 * s, w, 10 * s, 'rgba(10,8,20,0.75)');
      drawText(g, name, x, y - 3 * s, { color: '#ffd97a', align: 'center', scale: s });
    }
  }

  /** True if (x,y) sits inside (or near) any location's solid footprint. */
  _nearAnyDistrict(x, y, pad) {
    for (const l of this.locations) {
      if (!l.solid) continue;
      const s = l.solid;
      if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
    }
    return false;
  }

  /** True if (x,y) sits within `pad` of any road rect (keeps trees off roads). */
  _nearAnyRoad(x, y, pad) {
    for (const r of this.roads) {
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    }
    return false;
  }

  exit() {}

  setOutcome(kind) {
    if (kind === 'victory') this.toasts.push('Returned victorious!', this.px, this.py - 30, UI.gold, { life: 2.5, vy: -3 });
    else if (kind === 'defeat') this.toasts.push('You retreat to recover.', this.px, this.py - 30, UI.bad, { life: 2.5, vy: -3 });
  }

  // ---- update -------------------------------------------------------------

  update(dt, game) {
    this.t += dt;
    this.toasts.update(dt);
    this.particles.update(dt);
    if (this.introHintT > 0) this.introHintT -= dt;
    if (this.districtBannerT > 0) this.districtBannerT -= dt;

    // (crystal motes are drawn in drawFountainFX's fxMotes — no generic
    // particle spawns needed here anymore)

    // wandering sanctuary pets
    for (const p of this.sanctuaryPets) {
      if (Math.hypot(p.x - p.tx, p.y - p.ty) < 3 || Math.random() < dt * 0.4) {
        p.tx = this.sanctuary.x + hash(this.t + p.x) * this.sanctuary.w;
        p.ty = this.sanctuary.y + hash(this.t * 1.3 + p.y) * this.sanctuary.h;
      }
      p.x = lerp(p.x, p.tx, dt * 1.2); p.y = lerp(p.y, p.ty, dt * 1.2);
    }

    if (this.overlay) { this.overlay.update(dt); return; }
    if (this.dialogue) { this._updateDialogue(dt); return; }

    // movement with per-axis collision
    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      const spd = 100 * (1 + this.hero.petBonus('moveSpeed'));
      this._tryMove(ax.x * spd * dt, 0);
      this._tryMove(0, ax.y * spd * dt);
      if (ax.x !== 0) this.facing = ax.x > 0 ? 1 : -1;
      this.walkT += dt;
      if (Math.random() < dt * 4) this.particles.dust(this.px, this.py, 1);
    }

    // camera follow with clamp (in zoomed world units). The player sits a little
    // below centre so there's headroom to see the roofs of buildings ahead.
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    // district banner on entry
    let region = null;
    for (const r of this.regions) if (this.px >= r.x && this.px <= r.x + r.w && this.py >= r.y && this.py <= r.y + r.h) { region = r.name; break; }
    if (region && region !== this.currentDistrict) { this.currentDistrict = region; this.districtBanner = region; this.districtBannerT = 2.4; }
    if (!region) this.currentDistrict = null;

    // nearest interactable
    this.near = null; let best = 1e9;
    for (const loc of this.locations) {
      if (!loc.action) continue;
      const d = Math.hypot(this.px - loc.dx, this.py - loc.dy);
      if (d < 30 && d < best) { best = d; this.near = loc; }
    }

    if (this.near && Input.pressed('interact')) this._enter(this.near);
    if (Input.pressed('inventory')) { Audio.confirm(); this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }); }
  }

  _tryMove(dx, dy) {
    const nx = clamp(this.px + dx, 10, MAP_W - 10);
    const ny = clamp(this.py + dy, 40, MAP_H - 10);
    const box = { x: (dx ? nx : this.px) - 5, y: (dy ? ny : this.py) - 4, w: 10, h: 6 };
    for (const s of this.solids) {
      if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return;
    }
    if (dx) this.px = nx;
    if (dy) this.py = ny;
  }

  _enter(loc) {
    Audio.confirm();
    switch (loc.action) {
      case 'training': this.hero.save(); this.hooks.toTraining(); break;
      case 'weapon': this.hero.save(); if (this.hooks.toWeaponShop) this.hooks.toWeaponShop(); break;
      case 'potion': this.hero.save(); if (this.hooks.toPotionShop) this.hooks.toPotionShop(); break;
      case 'market': this.overlay = new PotionShop(this.hero, () => { this.overlay = null; }); break;
      case 'pets': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 2); break;
      case 'library': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 3); break;
      case 'quest': case 'guild': this._openQuest(loc.action === 'guild'); break;
      case 'dungeon': this._enterGate(); break;
      case 'rest': this._rest(); break;
      case 'house': this.hero.save(); if (this.hooks.toHouse) this.hooks.toHouse(); break;
    }
  }

  _rest() {
    const healed = this.hero.s.hp < this.hero.maxHp || this.hero.s.mana < this.hero.maxMana;
    this.hero.s.hp = this.hero.maxHp; this.hero.s.mana = this.hero.maxMana; this.hero.save();
    this.particles.pickup(this.px, this.py - 12, '#b58bff');
    this.toasts.push(healed ? 'The crystal restores you!' : 'Already at full health', this.px, this.py - 32, UI.good, { life: 1.6 });
    Audio.levelUp();
  }

  _openQuest(atGuild) {
    const q = this.hero.activeQuest();
    const who = atGuild ? 'Guildmaster' : 'Captain Mara';
    if (q) {
      this.dialogue = { speaker: q.giver, lines: [q.intro, 'Objective: ' + q.objective, 'Rewards: ' + this._rewardText(q) + '. Head to the Dungeon Gate when ready!'], idx: 0 };
    } else if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: who, lines: ['You cleared the goblin camp and felled their King. Embervale is in your debt!', 'Rest, train, and grow stronger — more adventures await.'], idx: 0 };
    } else {
      this.dialogue = { speaker: who, lines: ['No quests right now, hero. Come back soon.'], idx: 0 };
    }
    this.dialogueReveal = 0;
  }

  _rewardText(q) {
    const r = q.reward; const parts = [];
    if (r.gold) parts.push(r.gold + ' gold');
    if (r.xp) parts.push(r.xp + ' XP');
    if (r.item) parts.push('an item');
    if (r.petChance) parts.push('a pet egg');
    return parts.join(', ');
  }

  _enterGate() {
    if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: 'Gate Guard', lines: ['The goblin threat is over. The gate is quiet now — return when new dangers stir.'], idx: 0 };
      this.dialogueReveal = 0; return;
    }
    this.dialogue = {
      speaker: 'Dungeon Gate',
      lines: ['Beyond lies the Goblin Camp and the Goblin King. Ready yourself, hero.'],
      idx: 0,
      onDone: () => { this.hero.save(); this.hooks.toDungeon(); },
    };
    this.dialogueReveal = 0;
  }

  _updateDialogue(dt) {
    this.dialogueReveal = Math.min(1, this.dialogueReveal + dt * 3);
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      if (this.dialogueReveal < 1) { this.dialogueReveal = 1; return; }
      const d = this.dialogue;
      if (d.idx < d.lines.length - 1) { d.idx++; this.dialogueReveal = 0; Audio.select(); }
      else { const done = d.onDone; this.dialogue = null; if (done) done(); else Audio.confirm(); }
    }
    if (Input.pressed('menu')) { this.dialogue = null; Audio.deny(); }
  }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    g.save();
    g.imageSmoothingEnabled = false;
    g.scale(Z, Z);
    g.translate(-Math.round(this.camX), -Math.round(this.camY));
    this._drawGround(g, visW, visH);

    // flat props drawn under entities (still get their own contact shadows)
    for (const pg of this.propGroups) pg.fn(g);

    // depth-sorted entities: lower on screen (larger y) draws in front. Trees
    // and the fountain are entities too, so the player naturally passes behind
    // things north of them and in front of things south of them.
    const ents = [];
    for (const loc of this.locations) ents.push({ y: loc.sortY != null ? loc.sortY : (loc.solid ? loc.solid.y + loc.solid.h : loc.dy), draw: (gg) => this._drawLocation(gg, loc) });
    for (const tr of this.trees) ents.push({ y: tr.y, draw: (gg) => bigTree(gg, tr.x, tr.y, tr.kind === 'pine' ? 'pine' : 'oak', this.t) });
    for (const n of this.npcs) ents.push({ y: n.y, draw: (gg) => { contactShadow(gg, n.x, n.y, 6, 2); drawActor(gg, { x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, weapon: n.sprite === 'warrior' ? 'sword' : (n.sprite === 'mage' ? 'staff' : 'none'), state: 'idle', animTime: this.t + n.x }); } });
    for (const p of this.sanctuaryPets) ents.push({ y: p.y, draw: (gg) => drawPet(gg, p, p.x, p.y, this.t) });
    ents.push({ y: this.py, draw: (gg) => this._drawPlayer(gg) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw(g);

    // development-only overview overlay (labels + road centerlines)
    if (typeof window !== 'undefined' && window.__townDebug) this._drawDebugOverview(g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);

    this.particles.draw(g);
    this.toasts.draw(g);
    g.restore();

    this._drawHUD(g);

    if (this.overlay) this.overlay.draw(g, this.W, this.H);
    if (this.dialogue) {
      const d = this.dialogue;
      dialogue(g, this.W, this.H, d.speaker, d.lines[d.idx], this.dialogueReveal, {
        prompt: d.idx < d.lines.length - 1 ? 'J: more' : 'J: ok',
      });
    }
  }

  _drawLocation(g, loc) {
    loc.draw(g);
    if (this.near === loc) {
      const label = { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest', house: 'Enter Your House' }[loc.action] || 'Enter';
      const w = textWidth('[E] ' + label) + 12;
      panel(g, loc.dx - w / 2, loc.dy + 2, w, 13, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, '[E] ' + label, loc.dx, loc.dy + 5, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }
  }

  _drawPlayer(g) {
    const pet = this.hero.pet();
    if (pet) drawPet(g, pet, this.px - this.facing * 14, this.py - 16, this.t);
    drawCharacter(g, {
      x: this.px, y: this.py, z: 0, facing: this.facing,
      sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(),
      state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t,
    });
  }

  // ---- ground -------------------------------------------------------------

  _drawGround(g, visW, visH) {
    const camX = this.camX, camY = this.camY;
    // Ground: tiled Town Grass artwork (variant picked per cell by hash, so the
    // layout is deterministic). Mostly base tiles, occasional flowers/patchy.
    // Flat green underneath as a fallback while the images load.
    rect(g, camX, camY, visW, visH, '#3c7a40');
    const gc0 = Math.floor(camX / GRASS_TILE), gc1 = Math.ceil((camX + visW) / GRASS_TILE);
    const gr0 = Math.floor(camY / GRASS_TILE), gr1 = Math.ceil((camY + visH) / GRASS_TILE);
    for (let rr = gr0; rr <= gr1; rr++) {
      for (let cc = gc0; cc <= gc1; cc++) {
        const hv = hash(cc * 12.7 + rr * 7.3);
        const idx = hv < 0.42 ? 0 : hv < 0.84 ? 1 : hv < 0.94 ? 2 : 3;
        const tile = GRASS_TILES[idx];
        if (!tile.ready) continue;
        g.drawImage(tile.img, cc * GRASS_TILE, rr * GRASS_TILE, GRASS_TILE, GRASS_TILE);
      }
    }

    // The Lake: pure ground/environment artwork, drawn flat under everything
    // depth-sorted (buildings, trees, the player) so it can never render over
    // them — see the class comment on POND_ART/POND_WATER_RECTS above for
    // provenance. Ripple/shimmer overlays layer on top the same way the
    // fountain's water FX layers on its own PNG.
    if (POND_ART.ready) {
      g.drawImage(POND_ART.img, Math.round(this.lakeTopLeft.x), Math.round(this.lakeTopLeft.y), POND_W, POND_H);
      if (!POND_MASK_INFO) POND_MASK_INFO = buildWaterMask(POND_ART.img);
      proceduralRipples(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H, this.t);
      // A fish breaks the surface every so often (assets/fish1.png). It draws
      // above the water but still in the ground pass, which is fine — the lake
      // is solid, so the player can never stand between the two.
      drawFishJump(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H, this.t);
    }

    // wild zones: taller meadow tiles washed over the base grass around the
    // outer districts (Sanctuary, Training edge, Watch, Gate) and nowhere in
    // the developed core.
    // Meadow/tall-grass wash disabled along with the rest of the vegetation
    // (this had its own hardcoded perimeter-ring band, separate from
    // wildZones, so clearing wildZones alone didn't remove it).

    // Road network: five material families painted from the shared stone
    // pack (see ROAD_FAM). Drawn before the plaza so the plaza's own edge
    // tiles and flares finish on top of where the roads meet it.
    this._drawRoads(g, visW, visH);

    // Crystal Plaza floor: the approved zoned stone disc with its four
    // flare transitions, which the roads above run into with no seam —
    // both are drawn from the same modular pack on the same tile grid.
    plaza(g, this.plazaFocus.x, this.plazaFocus.y, this.plazaRadius, this.plazaFlares);

    // Market Square dirt-oval ground removed (per direction) — stalls sit
    // directly on grass now, no packed-dirt ellipse drawn beneath them.
    // Courtyard aprons removed too (per direction) — the oval discs under the
    // shops/guild/archive read as odd floating circles now that real roads
    // reach each door. The `courtyards` list is kept because the legacy
    // roadCells rasteriser still subtracts it; nothing draws it.

    this._drawCorruption(g);
  }

  /** Dark, wilted ground ringing the Runebound Gate, strongest at the entrance. */
  _drawCorruption(g) {
    const gate = { x: this.districts.gate.x, y: this.districts.gate.y + 30 };
    for (let i = 0; i < 46; i++) {
      const seed = i * 7.13;
      const spread = 130 + hash(seed) * 60;
      const px = gate.x + (hash(seed * 1.7) - 0.5) * spread * 1.6;
      const py = gate.y - 40 + (hash(seed * 2.3) - 0.5) * spread;
      const d = Math.hypot(px - gate.x, (py - gate.y) * 1.3);
      const k = clamp01(1 - d / 170);
      if (k <= 0.05) continue;
      corruptPatch(g, px, py, 8 + hash(seed * 3.1) * 14, k);
    }
  }

  // (The old tile-grid road painter lived here. It has been replaced by
  // _drawRoads() above, which paints from the finer coverage map so each
  // family keeps its real designed width, and which drives the adventure
  // decay from progress along the route rather than the old fixed world-Y
  // threshold — that constant went stale the moment districts moved.)

  // ---- HUD + banners ------------------------------------------------------

  _drawHUD(g) {
    // slim plate: class + level, HP, gold
    const pw = 118, ph = 22;
    panel(g, 4, 4, pw, ph, { bg: 'rgba(12,10,22,0.82)' });
    drawText(g, `${this.hero.cls().name}`, 8, 6, { color: UI.ink });
    drawText(g, `Lv ${this.hero.s.level}`, pw - 2, 6, { color: UI.gold, align: 'right' });
    bar(g, 8, 15, this.hero.s.hp, this.hero.maxHp, { w: 74, h: 4, color: '#e0483c' });
    drawIcon(g, 'coin', pw - 26, 13);
    drawText(g, `${this.hero.s.gold}`, pw - 16, 14, { color: UI.gold });

    // transient district banner (top-center, fades)
    if (this.districtBannerT > 0 && this.districtBanner) {
      const a = clamp01(Math.min(1, this.districtBannerT * 1.5) * Math.min(1, (this.districtBannerT) * 2));
      g.globalAlpha = a;
      const w = textWidth(this.districtBanner, 2) + 24;
      const bx = this.W / 2 - w / 2;
      rect(g, bx, 12, w, 18, 'rgba(12,10,22,0.7)');
      rect(g, bx, 12, w, 1, UI.gold); rect(g, bx, 29, w, 1, UI.gold);
      drawText(g, this.districtBanner.toUpperCase(), this.W / 2, 15, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' });
      g.globalAlpha = 1;
    }

    // one-time control hint on load, then gone
    if (this.introHintT > 0) {
      g.globalAlpha = clamp01(Math.min(1, this.introHintT));
      drawText(g, 'WASD move   E interact   I inventory', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });
      g.globalAlpha = 1;
    }
  }
}

// ============================================================ shared drawers

// Building wall with 3/4 volume: a lit front wall, a darker right-hand side wall
// (implying depth), a raised stone foundation and a contact shadow. Light from
// the upper-left. Returns the wall's top-left for roof placement.
function wallBox(g, cx, baseY, w, h, wall, wallDark, trim) {
  const x = Math.round(cx - w / 2), y = Math.round(baseY - h);
  contactShadow(g, cx, baseY, w * 0.56, 5, 0.34);
  // right-hand side wall (perspective) — a thin darker slab
  const side = 5;
  rect(g, x + w, y + 3, side, h - 3, wallDark);
  rect(g, x + w, y + 3, side, 1, wall);
  // front wall
  rect(g, x, y, w, h, wall);
  rect(g, x, y, w, 1, mix(wall, '#ffffff', 0.18));   // top lit edge
  rect(g, x, y, 1, h, mix(wall, '#ffffff', 0.10));   // left lit edge
  rect(g, x + w - 1, y, 1, h, wallDark);             // right shaded edge
  for (let i = 5; i < w; i += 8) rect(g, x + i, y + 1, 1, h - 1, mix(wall, wallDark, 0.5)); // plank seams
  // raised stone foundation (front face darker, top lit)
  rect(g, x - 2, baseY - 5, w + 4 + side, 5, '#7a7160');
  rect(g, x - 2, baseY - 5, w + 4 + side, 1, '#948a74');
  rect(g, x - 2, baseY - 1, w + 4 + side, 1, '#5c5446');
  rectOutline(g, x, y, w, h, trim);
  return { x, y };
}

// Pitched roof with a large overhang, an upper-left-lit plane and a lower-right
// shaded plane, a ridge line, and a dark eave shadow cast on the wall beneath.
function pitchedRoof(g, cx, topY, w, roofH, roof, roofDark, trim, overhang = 8) {
  const fullW = w + overhang * 2;
  // eave shadow band just under the roof (on the wall)
  rect(g, cx - fullW / 2, topY + roofH, fullW, 2, 'rgba(0,0,0,0.28)');
  const roofLite = mix(roof, '#ffffff', 0.22);
  const roofShade = mix(roof, '#000000', 0.22);
  for (let i = 0; i < roofH; i++) {
    const t = i / roofH;
    const rw = Math.round(fullW * (0.12 + t * 0.88));
    const rx = Math.round(cx - rw / 2);
    // left plane lit, right plane shaded, top rows darkest (thatch/shingle)
    rect(g, rx, topY + i, rw, 1, i < 2 ? roofDark : roof);
    rect(g, rx, topY + i, Math.ceil(rw / 2), 1, i < 2 ? roofDark : roofLite);
    rect(g, cx, topY + i, Math.floor(rw / 2), 1, i < 2 ? roofDark : roofShade);
    if (i % 3 === 0) rect(g, rx, topY + i, rw, 1, roofDark); // shingle courses
  }
  // overhanging eave lip
  rect(g, cx - fullW / 2, topY + roofH - 1, fullW, 2, trim);
  rect(g, cx - fullW / 2, topY + roofH - 2, fullW, 1, roofShade);
  // ridge cap
  rect(g, cx - 1, topY - 1, 2, roofH + 1, roofDark);
}

// Recessed door: a dark sunken interior inside a frame, with warm light spilling
// out at the threshold and a couple of stone steps.
function door(g, cx, baseY, dw = 12, dh = 16, col = '#4a2f1c') {
  const dx = Math.round(cx - dw / 2), dy = baseY - dh;
  // frame
  rect(g, dx - 1, dy - 1, dw + 2, dh + 1, '#2a1a10');
  // sunken interior (dark, gradient to warm at the bottom)
  rect(g, dx, dy, dw, dh, '#160f14');
  rect(g, dx + 1, dy + dh - 5, dw - 2, 5, '#3a2416');
  rect(g, dx + 2, dy + dh - 3, dw - 4, 3, 'rgba(242,180,74,0.35)');
  // door leaf ajar on the left
  rect(g, dx, dy, Math.ceil(dw / 2), dh, col);
  rect(g, dx, dy, 1, dh, mix(col, '#ffffff', 0.2));
  rect(g, dx + Math.ceil(dw / 2) - 2, dy + dh / 2, 1, 2, '#d8b24a'); // handle
  // stone steps (lit top, shaded front)
  rect(g, dx - 3, baseY, dw + 6, 2, '#948a74'); rect(g, dx - 3, baseY + 2, dw + 6, 1, '#6f6656');
}

// Recessed lit window: dark frame, warm glass, muntins, upper-left glint.
function windowLit(g, x, y, s = 8) {
  rect(g, x - 1, y - 1, s + 2, s + 2, '#2a1a10');  // recess frame
  rect(g, x, y, s, s, '#f2c94f');
  rect(g, x + s / 2 - 1, y, 1, s, '#2a1a10');
  rect(g, x, y + s / 2 - 1, s, 1, '#2a1a10');
  rect(g, x, y, s, 1, '#fff2c0');                  // top glint
  rect(g, x, y, 2, 2, '#fff6d8');                  // upper-left highlight
}

// small colour-mix helper for consistent lit/shaded surfaces
function mix(hex, other, amt) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  const r = Math.round(a[0] + (b[0] - a[0]) * amt);
  const gg = Math.round(a[1] + (b[1] - a[1]) * amt);
  const bl = Math.round(a[2] + (b[2] - a[2]) * amt);
  return `rgb(${r},${gg},${bl})`;
}
function hexToRgb(h) {
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function awning(g, cx, y, w, c1, c2 = '#e8e2d0') {
  const x = Math.round(cx - w / 2);
  rect(g, x, y, w, 5, c2);
  for (let i = 0; i < w; i += 8) rect(g, x + i, y, 4, 5, c1);
  rect(g, x, y + 5, w, 1, '#8a7a5a');
}

// ---------------------------------------------------------------- buildings

function drawCottage(g, cx, baseY, wall, wallDark, roof, roofDark, t) {
  const w = 54, h = 32;
  shadow(g, cx, baseY, w * 0.55, 4, 0.3);
  const b = wallBox(g, cx, baseY, w, h, wall, wallDark, '#2a1e14');
  pitchedRoof(g, cx, b.y - 13, w, 15, roof, roofDark, '#2a1e14');
  // chimney with smoke
  rect(g, cx + w / 2 - 10, b.y - 20, 6, 10, '#5a4a3a');
  if (Math.random() < 0.1) rect(g, cx + w / 2 - 8, b.y - 22 - ((t * 6) % 6), 2, 2, 'rgba(150,150,160,0.4)');
  door(g, cx, baseY);
  windowLit(g, cx - w / 2 + 7, baseY - 24);
  windowLit(g, cx + w / 2 - 15, baseY - 24);
  fenceRun(g, cx - w / 2 - 8, baseY + 3, w + 16);
  flowerbed(g, cx - w / 2 - 4, baseY + 5);
}

// The Player House — rendered from the authored transparent PNG (ivy-covered
// cottage, flower boxes, mailbox and bench already in the art). A small fenced
// strip is still added around it for the yard, since the art itself is just
// the building. Same load/draw contract as the Potion Shop.
function drawPlayerHouse(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, HOUSE_W * 0.42, 6, 0.3);
  fenceRun(g, cx - HOUSE_W / 2 - 10, baseY + 4, HOUSE_W + 20);
  if (!HOUSE_ART.ready) return;
  g.drawImage(HOUSE_ART.img, Math.round(cx - HOUSE_W / 2), Math.round(baseY - HOUSE_H), HOUSE_W, HOUSE_H);
}

function drawLibrary(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, LIBRARY_W * 0.42, 6, 0.32);
  if (!LIBRARY_ART.ready) return;
  g.drawImage(LIBRARY_ART.img, Math.round(cx - LIBRARY_W / 2), Math.round(baseY - LIBRARY_H), LIBRARY_W, LIBRARY_H);
}

// The Weapon Shop & Blacksmith — rendered from the authored transparent PNG
// (forge, anvil, weapon rack and sign already in the art).
function drawBlacksmith(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, BLACKSMITH_W * 0.42, 6, 0.32);
  if (!BLACKSMITH_ART.ready) return;
  g.drawImage(BLACKSMITH_ART.img, Math.round(cx - BLACKSMITH_W / 2), Math.round(baseY - BLACKSMITH_H), BLACKSMITH_W, BLACKSMITH_H);
  // wisps of smoke off the chimney — the forge is always lit
  const sx = cx + 5, sy0 = baseY - 59;
  for (let i = 0; i < 3; i++) {
    const k = ((t * 0.35 + i / 3) % 1);
    const sy = sy0 - k * 16;
    g.globalAlpha = (1 - k) * 0.35;
    disc(g, sx + Math.sin(t * 1.3 + i * 2) * 2, sy, 1.5 + k * 2, '#c9c2ba');
  }
  g.globalAlpha = 1;
}

// The Potion Shop — rendered directly from the authored transparent PNG (real
// alpha, no baked background). Anchored bottom-centre at the shop's ground
// position with a subtle contact shadow. Nearest-neighbor, no smoothing.
function drawPotionShop(g, cx, baseY, t) {
  // subtle ground/contact shadow (light from upper-left -> shadow lower-right)
  contactShadow(g, cx, baseY, POTION_W * 0.42, 6, 0.30);
  if (!POTION_READY) return; // image not loaded yet this frame
  // soft breathing glow behind the roof-peak potion sign, before the art so
  // it reads as light coming from inside the glass, not painted on top
  const sx = cx, sy = baseY - 43;
  const f = 0.5 + Math.sin(t * 2.2) * 0.25;
  g.globalAlpha = f * 0.35; disc(g, sx, sy, 9, '#c98bff'); g.globalAlpha = 1;
  g.drawImage(POTION_IMG, Math.round(cx - POTION_W / 2), Math.round(baseY - POTION_H), POTION_W, POTION_H);
  // a couple of drifting sparkles, like the sign's magic never fully settles
  for (let i = 0; i < 2; i++) {
    const a = t * 1.4 + i * 3.1;
    g.globalAlpha = 0.5 + Math.sin(t * 3 + i) * 0.3;
    rect(g, Math.round(sx + Math.cos(a) * 8), Math.round(sy + Math.sin(a) * 6 - 2), 1, 1, '#eadcff');
  }
  g.globalAlpha = 1;
}

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

function potionWindow(g, x, y) {
  windowLit(g, x, y, 9);
  rect(g, x + 1, y + 3, 2, 4, '#8a2fb0'); rect(g, x + 1, y + 2, 2, 1, '#5a1f80');
  rect(g, x + 5, y + 2, 2, 5, '#2f6aa0'); rect(g, x + 5, y + 1, 2, 1, '#1f4a80');
}

function awningStriped(g, cx, y, w) {
  const x = Math.round(cx - w / 2);
  rect(g, x, y + 5, w, 2, 'rgba(0,0,0,0.30)');
  const cols = ['#8a5ab8', '#efe4f7', '#a878d0'];
  for (let i = 0; i < w; i += 6) rect(g, x + i, y, 6, 5, cols[(i / 6) % 3 | 0]);
  rect(g, x, y, w, 1, '#cbb4e8');
  for (let i = 0; i < w; i += 6) rect(g, x + i + 1, y + 5, 4, 2, '#563680');
  rect(g, x - 1, y - 1, 2, 7, '#563680'); rect(g, x + w - 1, y - 1, 2, 7, '#563680');
}

function hangingHerbs(g, x, y) {
  rect(g, x, y - 5, 1, 5, '#4a3a24');
  rect(g, x - 2, y, 5, 4, '#2f5836'); rect(g, x - 1, y, 3, 5, '#3a7a3e');
  rect(g, x - 2, y - 1, 1, 1, '#e0679a');
}

function potionSign(g, cx, cy, t) {
  g.globalAlpha = 0.26 + Math.sin(t * 3) * 0.10; disc(g, cx, cy, 11, '#c96ad0'); g.globalAlpha = 1;
  rect(g, cx - 2, cy - 10, 4, 2, '#8a6a3a');
  rect(g, cx - 2, cy - 8, 4, 3, '#d8c8e8');
  rect(g, cx - 6, cy - 5, 12, 14, '#241a2a');
  rect(g, cx - 5, cy - 4, 10, 12, '#b84ad0');
  rect(g, cx - 5, cy + 2, 10, 6, '#8a2fb0');
  rect(g, cx - 4, cy - 3, 2, 9, '#eaa0f0');
  rect(g, cx - 6, cy - 5, 12, 1, '#e8d8f0');
  if (Math.random() < 0.4) rect(g, cx - 2 + (Math.random() * 4 | 0), cy - 1 - ((t * 8) % 8), 1, 1, '#e8c0f0');
}

function potionTable(g, x, y) {
  contactShadow(g, x, y, 10, 2, 0.28);
  rect(g, x - 9, y - 7, 18, 4, '#7a5530'); rect(g, x - 9, y - 7, 18, 1, '#8a6a44');
  rect(g, x - 8, y - 3, 2, 3, '#5a3a24'); rect(g, x + 6, y - 3, 2, 3, '#5a3a24');
  potionMini(g, x - 6, y - 8, '#b84ad0'); potionMini(g, x - 1, y - 8, '#3f7a9a'); potionMini(g, x + 4, y - 8, '#3f8a4a');
}
function potionMini(g, x, y, col) {
  rect(g, x - 1, y - 4, 3, 4, col);
  rect(g, x - 1, y - 2, 3, 2, mix(col, '#000000', 0.3));
  rect(g, x - 1, y - 5, 3, 1, '#8a6a3a');
  rect(g, x - 1, y - 4, 1, 2, mix(col, '#ffffff', 0.45));
}

// The Adventurer's Guild & Tavern — rendered from the authored transparent
// PNG (shield-and-mug sign, quest board, lanterns and banner already in the
// art).
function drawTavern(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, GUILD_W * 0.42, 7, 0.34);
  if (!GUILD_ART.ready) return;
  g.drawImage(GUILD_ART.img, Math.round(cx - GUILD_W / 2), Math.round(baseY - GUILD_H), GUILD_W, GUILD_H);
  // a slow gleam sweeping over the hanging shield sign above the door
  const f = 0.55 + Math.sin(t * 1.8 + cx) * 0.25;
  g.globalAlpha = f * 0.3; disc(g, cx + 2, baseY - 42, 8, '#ffe9a8'); g.globalAlpha = 1;
}

function drawTrainingGround(g, cx, cy, t) {
  if (!TRAINING_ART.ready) return;
  g.drawImage(TRAINING_ART.img, Math.round(cx - TRAINING_W / 2), Math.round(cy - TRAINING_H / 2), TRAINING_W, TRAINING_H);
}

function drawMarket(g, cx, cy, t) {
  // Market Square: the five stalls ring the square's rim — produce + bakery
  // along the north edge, cloth west, general goods east, the traveling
  // merchant on the south rim — and the CENTER STAYS OPEN for NPC traffic,
  // conversations and future events (per the approved market plan; never a
  // single row of stalls).
  const stalls = [
    { art: STALL_PRODUCE_ART, w: STALL_PRODUCE_W, h: STALL_PRODUCE_H, x: cx - 75, y: cy - 95 },
    { art: STALL_BAKERY_ART, w: STALL_BAKERY_W, h: STALL_BAKERY_H, x: cx + 70, y: cy - 90 },
    { art: STALL_CLOTH_ART, w: STALL_CLOTH_W, h: STALL_CLOTH_H, x: cx - 145, y: cy + 5 },
    { art: STALL_GOODS_ART, w: STALL_GOODS_W, h: STALL_GOODS_H, x: cx + 140, y: cy + 10 },
    { art: STALL_MERCHANT_ART, w: STALL_MERCHANT_W, h: STALL_MERCHANT_H, x: cx - 15, y: cy + 120 },
  ];
  for (const s of stalls) {
    contactShadow(g, s.x, s.y + s.h * 0.32, s.w * 0.4, 4, 0.25);
    if (s.art.ready) g.drawImage(s.art.img, Math.round(s.x - s.w / 2), Math.round(s.y - s.h / 2), s.w, s.h);
  }
  // well tucked toward the northeast rim so the middle stays clear
  const wx = cx + 95, wy = cy - 35;
  shadow(g, wx, wy, 9, 3, 0.3);
  rect(g, wx - 9, wy - 8, 18, 8, '#8a8ea0'); rectOutline(g, wx - 9, wy - 8, 18, 8, '#3a3e4a');
  rect(g, wx - 10, wy - 20, 2, 12, '#5a3a24'); rect(g, wx + 8, wy - 20, 2, 12, '#5a3a24');
  rect(g, wx - 12, wy - 22, 24, 3, '#7a3e2c');
  rect(g, wx - 2, wy - 14, 4, 4, '#3a3e4a');
}

function drawPetKeeper(g, cx, baseY, t) {
  const w = 66, h = 40;
  shadow(g, cx, baseY, w * 0.55, 5, 0.3);
  const b = wallBox(g, cx, baseY, w, h, '#8a7a54', '#6b5c3a', '#2a1e14');
  pitchedRoof(g, cx, b.y - 13, w, 15, '#c9924a', '#a06a2f', '#2a1e14', 6);
  door(g, cx, baseY);
  windowLit(g, cx + w / 2 - 15, baseY - 24);
  // paw sign
  rect(g, cx + 22, baseY - 30, 2, 8, '#2a1e14'); rect(g, cx + 16, baseY - 22, 14, 10, '#5c4230'); rectOutline(g, cx + 16, baseY - 22, 14, 10, '#2a1a10');
  disc(g, cx + 23, baseY - 16, 2, '#e8d36a');
  // fenced sanctuary to the right (the wandering pets live here)
  const sx = cx + 34, sy = baseY - 66, sw = 96, sh = 60; // sanctuary sits beside the cottage, north of the street
  for (let fx = sx - 6; fx <= sx + sw; fx += 8) { rect(g, fx, sy - 2, 1, 6, '#6b4a2e'); rect(g, fx, sy + sh - 2, 1, 6, '#6b4a2e'); }
  for (let fy = sy; fy <= sy + sh; fy += 8) { rect(g, sx - 6, fy, 6, 1, '#6b4a2e'); rect(g, sx + sw - 5, fy, 6, 1, '#6b4a2e'); }
  // pet houses, bowls, eggs, nests
  petHouse(g, sx + 12, sy + 20, '#8a4a3c'); petHouse(g, sx + 70, sy + 40, '#3f7a5c');
  bowl(g, sx + 40, sy + 16); bowl(g, sx + 58, sy + 46);
  egg(g, sx + 26, sy + 44, '#e0679a'); egg(g, sx + 30, sy + 46, '#9d8bff');
}

function drawQuestBoard(g, cx, baseY, t, hasQuest) {
  rect(g, cx - 3, baseY - 16, 2, 16, '#4a3824'); rect(g, cx + 1, baseY - 16, 2, 16, '#4a3824');
  rect(g, cx - 16, baseY - 36, 32, 22, '#8a6f4a'); rectOutline(g, cx - 16, baseY - 36, 32, 22, '#4a3824');
  drawIcon(g, 'scroll', cx - 12, baseY - 32); drawIcon(g, 'scroll', cx + 2, baseY - 32); drawIcon(g, 'scroll', cx - 5, baseY - 24);
  // little roof
  rect(g, cx - 18, baseY - 38, 36, 3, '#6a3329');
  if (hasQuest) { const bob = Math.sin(t * 4) * 2; drawText(g, '!', cx, baseY - 50 + bob, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' }); }
}

function drawDungeonGate(g, cx, baseY, t) {
  // MASSIVE stone gatehouse: towers, battlements, rune arch, deep portal, stairs
  const w = 88, h = 92;
  const x = cx - w / 2, y = baseY - h;
  shadow(g, cx, baseY, 52, 8, 0.42);
  // stone wall base
  rect(g, x - 10, y + 20, w + 20, h - 20, '#565667');
  for (let ry = 20; ry < h; ry += 8) rect(g, x - 10, y + ry, w + 20, 1, '#454556');
  for (let rx = 0; rx < w + 20; rx += 12) rect(g, x - 10 + ((rx / 12) % 2) * 6, y + 20, 1, h - 20, '#454556');
  // twin towers
  for (const tx of [x - 10, x + w - 8]) {
    rect(g, tx, y - 6, 18, h + 6, '#5e5e70'); for (let i = 0; i < h; i += 8) rect(g, tx, y - 6 + i, 18, 1, '#42424f');
    rect(g, tx - 2, y - 10, 22, 5, '#4a4a58');
    for (let bx = tx - 2; bx < tx + 20; bx += 6) rect(g, bx, y - 14, 3, 5, '#4a4a58'); // battlements
    brazier(g, tx + 9, y + 24, t + tx);
  }
  // rune arch + deep portal
  rect(g, x + 6, y + 8, w - 12, h - 8, '#4a4a58');
  const pw = 34, ph = 56;
  rect(g, cx - pw / 2, baseY - ph, pw, ph, '#0f0b1c');
  // glowing blue runes around the arch
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI + (i / 7) * Math.PI;
    const rx = cx + Math.cos(a) * (pw / 2 + 5), ry = (baseY - ph + 6) + Math.sin(a) * (pw / 2 + 5) + 8;
    g.globalAlpha = 0.6 + Math.sin(t * 3 + i) * 0.3; rect(g, Math.round(rx), Math.round(ry), 2, 2, '#5c8cff'); g.globalAlpha = 1;
  }
  // swirling portal energy
  for (let i = 0; i < 6; i++) { const a = t * 0.9 + i * 1.05; g.globalAlpha = 0.5 - i * 0.06; disc(g, cx + Math.cos(a) * (6 + i), baseY - ph / 2 + Math.sin(a * 1.3) * (7 + i), 2, '#7c5cff'); }
  g.globalAlpha = 1;
  rectOutline(g, cx - pw / 2, baseY - ph, pw, ph, '#2a2340');
  // banners
  rect(g, x + 2, y + 12, 5, 20, '#3a5cc0'); rect(g, x + w - 7, y + 12, 5, 20, '#c0463c');
  // grand stairs
  for (let i = 0; i < 5; i++) rect(g, cx - 28 + i * 3, baseY + i * 3, 56 - i * 6, 4, i % 2 ? '#6b6b7a' : '#565667');
  // rubble
  drawRock(g, x - 16, baseY + 6, 1.1); drawRock(g, x + w + 10, baseY + 8, 1);
}

// ---------------------------------------------------------------- props

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

// Fenced farm plot: tilled crop rows inside a wooden fence, with a scarecrow.
// Purely decorative ground dressing; collision comes from the caller's solid.
function drawFarmPlot(g, cx, cy, w, h) {
  const x = cx - w / 2, y = cy - h / 2;
  rect(g, x, y, w, h, '#5c4a30');
  for (let ry = 4; ry < h - 4; ry += 8) {
    rect(g, x + 4, y + ry, w - 8, 5, '#6b5738');
    for (let rx = x + 4; rx < x + w - 4; rx += 6) rect(g, rx, y + ry, 1, 5, '#4a3a24');
    for (let rx = x + 6; rx < x + w - 6; rx += 12) { rect(g, rx, y + ry - 1, 2, 2, '#3d7a3e'); rect(g, rx + 4, y + ry + 1, 2, 2, '#c9924a'); }
  }
  fenceRun(g, x - 2, y - 2, w + 4);
  fenceRun(g, x - 2, y + h + 4, w + 4);
  for (let fy = y; fy <= y + h; fy += 8) { rect(g, x - 3, fy, 1, 7, '#6b4a2e'); rect(g, x + w + 2, fy, 1, 7, '#6b4a2e'); }
  // scarecrow
  const sx = x + w - 12, sy = y + 6;
  rect(g, sx - 1, sy, 2, 12, '#6b4a2e'); rect(g, sx - 6, sy + 3, 12, 2, '#6b4a2e');
  rect(g, sx - 3, sy - 4, 6, 5, '#c9a878'); rect(g, sx - 2, sy - 5, 4, 2, '#8a5a3a');
  rect(g, sx - 4, sy + 1, 3, 6, '#8a5a3a'); rect(g, sx + 1, sy + 1, 3, 6, '#3f7a5c');
}

// ---------------------------------------------------------------- corruption
// A dark, wilted biome ringing the Dungeon Gate: cracked purple-black ground,
// bare dead trees and jagged stone, strongest right at the entrance and
// fading out as the intensity term drops toward 0.

function corruptPatch(g, x, y, r, k) {
  const a = Math.min(0.55, 0.18 + k * 0.4);
  fillEllipse(g, x, y, r, r * 0.5, `rgba(30,14,26,${a})`);
  fillEllipse(g, x, y, r * 0.55, r * 0.28, `rgba(58,20,52,${a * 0.7})`);
  if (k > 0.5) { rect(g, x - 1, y - 1, 2, 2, '#1a0a16'); rect(g, x + 3, y + 1, 1, 2, '#1a0a16'); } // cracks
}

function deadTree(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  contactShadow(g, x, y, 8, 3, 0.4);
  rect(g, x - 1, y - 16, 3, 16, '#241a20');
  rect(g, x - 1, y - 16, 1, 16, '#382830');
  const branch = (bx, by, dx, dy, len) => { for (let i = 0; i < len; i++) rect(g, Math.round(bx + dx * i), Math.round(by + dy * i), 1, 1, '#241a20'); };
  branch(x, y - 13, 1, -0.7, 6); branch(x, y - 10, -1, -0.8, 5); branch(x - 1, y - 15, -1, -0.5, 4);
  if (Math.sin(t * 0.8 + x) > 0.6) rect(g, x + 4, y - 18, 1, 1, '#9d6bff'); // rare corrupted glow spore
}

function corruptedRock(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  contactShadow(g, x, y, 7, 2, 0.4);
  rect(g, x - 6, y - 3, 12, 4, '#3a3038'); rect(g, x - 5, y - 7, 5, 5, '#3a3038'); rect(g, x - 1, y - 9, 5, 6, '#453a44');
  rect(g, x - 5, y - 7, 2, 2, '#5c4a5c'); rect(g, x + 1, y - 9, 2, 2, '#5c4a5c');
  rect(g, x - 2, y - 4, 1, 1, '#8a5cd0'); // faint purple vein
}

// ---- Road -> plaza flare geometry ---------------------------------------
// Each of the four cardinal exits gets a short trapezoid transition instead
// of a flat rectangle: its near edge is sampled straight off the plaza's own
// jittered circle boundary (same formula the plaza silhouette uses), so the
// join is pixel-exact with no seam, and it tapers down to the constant road
// width over a short run so the widen reads as a flare, not a step.
function plazaEdgeJitter(a) {
  return 1 + (hash(Math.floor(a * 6.37) * 3.1 + 0.5) - 0.5) * 0.1;
}
function buildFlare(FC, R, angleDeg, nearW, farW, depth) {
  const a0 = angleDeg * Math.PI / 180;
  const cosA = Math.cos(a0), sinA = Math.sin(a0);
  const perpA = a0 + Math.PI / 2;
  const cosP = Math.cos(perpA), sinP = Math.sin(perpA);
  const dtheta = Math.asin(Math.min(0.98, (nearW / 2) / R));
  const NSAMP = 4;
  const points = [];
  for (let i = 0; i <= NSAMP; i++) {
    const a = a0 - dtheta + (2 * dtheta) * (i / NSAMP);
    const j = plazaEdgeJitter(a);
    points.push({ x: FC.x + Math.cos(a) * R * j, y: FC.y + Math.sin(a) * R * j });
  }
  const farCx = FC.x + cosA * (R + depth), farCy = FC.y + sinA * (R + depth);
  points.push({ x: farCx + cosP * farW / 2, y: farCy + sinP * farW / 2 });
  points.push({ x: farCx - cosP * farW / 2, y: farCy - sinP * farW / 2 });
  return { cosA, sinA, cosP, sinP, nearW, farW, depth, points };
}
// `pad` softens the edge for proximity checks (blend radius) rather than a
// hard cutoff. Returns 0..1 progress too (0 = plaza edge, 1 = road edge).
function flareContains(fl, FC, R, px, py, pad = 0) {
  const dx = px - FC.x, dy = py - FC.y;
  const along = dx * fl.cosA + dy * fl.sinA;
  if (along < R - 2 - pad || along > R + fl.depth + pad) return false;
  const t = clamp01((along - R) / fl.depth);
  const halfW = lerp(fl.nearW, fl.farW, t) / 2 + pad;
  const perp = dx * fl.cosP + dy * fl.sinP;
  return Math.abs(perp) <= halfW;
}
function flareProgress(fl, FC, R, px, py) {
  const dx = px - FC.x, dy = py - FC.y;
  const along = dx * fl.cosA + dy * fl.sinA;
  return clamp01((along - R) / fl.depth);
}

// Crystal Plaza floor: real modular stone tiles (sliced from the same sheet
// as the roads — same masonry family), laid on the ROAD_TILE grid so the
// paving lines up with the streets. Deterministic per-cell weighted pick:
// ~65% base (split base1/base2), ~15% worn, ~8% moss, ~8% cracked (a tinted
// worn tile), ~4% crystal accent (a base tile + a tiny cyan sparkle drawn on
// top, only within the inner ring around the fountain). Falls back to a
// plain stone-colored square per cell while the images are still loading,
// never a flat wash circle. `flares` are the road-widen zones at each exit —
// included so the paving flows into the roads with no hard seam.
// Pick one of the 4 base stone variants, deterministic per cell.
function plazaBase(cc, rr) {
  const h = hash(cc * 7.1 + rr * 3.7);
  if (h < 0.25) return PLAZA_TILES.base1;
  if (h < 0.5) return PLAZA_TILES.base2;
  if (h < 0.75) return PLAZA_TILES.base3;
  return PLAZA_TILES.base4;
}
function plazaWorn(cc, rr) { return hash(cc * 2.9 + rr * 5.3 + 40) < 0.5 ? PLAZA_TILES.worn1 : PLAZA_TILES.worn2; }
function plazaWeathered(cc, rr) { return hash(cc * 4.1 + rr * 1.7 + 50) < 0.5 ? PLAZA_TILES.cracked : PLAZA_TILES.weathered; }

// Crystal Plaza floor: three concentric zones (inner fountain area, main
// walking area, outer weathered edge) built from the real modular stone
// pack, not a single random distribution — see the brief's zone breakdown.
// A wider mixture of stone variants (from the Crystal Plaza Modular Stone
// Pack) used only for the road->plaza connection itself, so that stretch
// reads as richer/more varied than the plaza's own interior paving.
const MIX_BASE = ['mix_base01', 'mix_base02', 'mix_base03', 'mix_base04', 'mix_base05'];
const MIX_WEATHERED = ['mix_weathered06', 'mix_weathered07', 'mix_weathered08', 'mix_weathered09'];
function mixBaseTile(cc, rr) {
  const h = hash(cc * 6.3 + rr * 2.9 + 150);
  return PLAZA_TILES[MIX_BASE[Math.floor(h * MIX_BASE.length) % MIX_BASE.length]];
}
function mixWeatheredTile(cc, rr) {
  const h = hash(cc * 3.7 + rr * 6.1 + 160);
  return PLAZA_TILES[MIX_WEATHERED[Math.floor(h * MIX_WEATHERED.length) % MIX_WEATHERED.length]];
}
function flareTile(cc, rr, t) {
  // t: 0 at the plaza edge (clean, matches the inner paving) -> 1 at the
  // road-facing edge (progressively more worn, so the material reads as
  // easing toward the road's rougher cobble without a hard tileset swap).
  const h = hash(cc * 5.17 + rr * 8.31 + 90);
  const hh = h - t * 0.55;
  if (hh < 0.55) return mixBaseTile(cc, rr);
  if (hh < 0.85) return mixWeatheredTile(cc, rr);
  return PLAZA_TILES.lightmoss;
}

function plaza(g, cx, cy, r, flares) {
  const innerR = Math.min(r * 0.5, FOUNTAIN_W * 0.5 + 12); // fountain radius + ~1 player width
  const outerStart = r * 0.82; // outer 18% becomes the weathered/edge band
  const FC = { x: cx, y: cy };

  // Round silhouette with a SUBTLE break (per-angle radius jitter, ~±5%) so
  // it doesn't read as a mathematically perfect circle, unioned with the 4
  // road flares — each flare's own near edge is sampled off this exact same
  // jittered boundary (see buildFlare), so the two paths meet with no seam.
  g.save();
  g.beginPath();
  const STEPS = 48;
  for (let i = 0; i <= STEPS; i++) {
    const a = (i / STEPS) * Math.PI * 2;
    const jitter = plazaEdgeJitter(a);
    const px = cx + Math.cos(a) * r * jitter, py = cy + Math.sin(a) * r * jitter;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  for (const f of flares) {
    f.points.forEach((p, i) => { if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
    g.closePath();
  }
  g.clip();

  const nearFlare = (px, py, pad) => flares.some((f) => flareContains(f, FC, r, px, py, pad));
  const flareAt = (px, py) => flares.find((f) => flareContains(f, FC, r, px, py, 0));

  const maxDepth = Math.max(...flares.map((f) => f.depth));
  const c0 = Math.floor((cx - r - maxDepth) / ROAD_TILE), c1 = Math.ceil((cx + r + maxDepth) / ROAD_TILE);
  const r0 = Math.floor((cy - r - maxDepth) / ROAD_TILE), r1 = Math.ceil((cy + r + maxDepth) / ROAD_TILE);

  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      const px = cc * ROAD_TILE, py = rr * ROAD_TILE;
      const tcx = px + ROAD_TILE / 2, tcy = py + ROAD_TILE / 2;
      const dx = tcx - cx, dy = tcy - cy;
      const dist = Math.hypot(dx, dy);
      const flareHit = flareAt(tcx, tcy);
      if (dist > r * 1.15 + ROAD_TILE && !flareHit) continue;

      let tile;

      if (flareHit && dist >= r - 3) {
        // ---- FLARE: the transition trapezoid beyond the plaza's own edge —
        // material eases from clean paving to a more worn, road-adjacent mix.
        tile = flareTile(cc, rr, flareProgress(flareHit, FC, r, tcx, tcy));
        if (tile && tile.ready) g.drawImage(tile.img, px, py, ROAD_TILE, ROAD_TILE);
        else rect(g, px, py, ROAD_TILE, ROAD_TILE, '#a89e84');
        continue;
      }

      const h = hash(cc * 5.17 + rr * 8.31);

      if (dist < innerR) {
        // ---- ZONE A: inner fountain area — 85% clean base, 15% worn.
        // Crystal accents are placed explicitly below (this zone is only
        // ~7 tiles across at this radius, too small for a sparse per-cell
        // roll to reliably land even once).
        tile = h < 0.85 ? plazaBase(cc, rr) : plazaWorn(cc, rr);
      } else if (dist < outerStart) {
        // ---- ZONE B: main walking area — old town masonry, worn along the
        // 4 traffic axes and near road junctions, otherwise mostly base.
        const onAxis = Math.abs(dx) < 22 || Math.abs(dy) < 22;
        const junction = nearFlare(tcx, tcy, 26);
        const hh = h - (onAxis ? 0.22 : 0) - (junction ? 0.3 : 0);
        if (hh < 0.65) tile = plazaBase(cc, rr);
        else if (hh < 0.80) tile = plazaWorn(cc, rr);
        else if (hh < 0.90) tile = plazaWeathered(cc, rr);
        else if (hh < 0.95) tile = PLAZA_TILES.lightmoss;
        else tile = PLAZA_TILES.grasscracks;
      } else {
        // ---- ZONE C: outer edge — progressively more weathered/reclaimed
        // by vegetation as distance from outerStart increases, then grass-
        // edge tiles right at the boundary.
        const edgeF = clamp01((dist - outerStart) / Math.max(1, r - outerStart));
        const hh = h - edgeF * 0.4;
        if (hh < 0.30) tile = plazaBase(cc, rr);
        else if (hh < 0.45) tile = plazaWorn(cc, rr);
        else if (hh < 0.62) tile = plazaWeathered(cc, rr);
        else if (hh < 0.78) tile = PLAZA_TILES.lightmoss;
        else if (hh < 0.90) tile = PLAZA_TILES.grasscracks;
        else {
          const eh = hash(cc * 2.3 + rr * 4.1 + 3);
          tile = eh < 0.35 ? PLAZA_TILES.edge_grass1 : eh < 0.6 ? PLAZA_TILES.edge_grass2
               : eh < 0.8 ? PLAZA_TILES.edge_broken : PLAZA_TILES.edge_moss;
        }
      }

      if (tile && tile.ready) g.drawImage(tile.img, px, py, ROAD_TILE, ROAD_TILE);
      else rect(g, px, py, ROAD_TILE, ROAD_TILE, '#a89e84'); // loading fallback, same stone family
    }
  }

  // Explicit crystal-accent placement, rough radial symmetry around the
  // fountain (diagonal slots, a few skipped so it isn't perfectly
  // symmetric) — drawn last so it's never buried by a base/worn pick.
  const accentR = innerR * 0.72;
  for (let i = 0; i < 4; i++) {
    if (hash(i * 3.3 + 11) > 0.7) continue; // skip some slots
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4; // NE/SE/SW/NW diagonals
    const acx = Math.round((cx + Math.cos(angle) * accentR) / ROAD_TILE) * ROAD_TILE;
    const acy = Math.round((cy + Math.sin(angle) * accentR) / ROAD_TILE) * ROAD_TILE;
    const strong = hash(i * 7.7 + 3) < 0.15; // crystal 1/2 extremely rare vs 3/4
    const tile = strong ? (hash(i) < 0.5 ? PLAZA_TILES.crystal1 : PLAZA_TILES.crystal2)
                        : (hash(i * 2) < 0.5 ? PLAZA_TILES.crystal3 : PLAZA_TILES.crystal4);
    if (tile.ready) g.drawImage(tile.img, acx, acy, ROAD_TILE, ROAD_TILE);
  }

  g.restore();
}

// ---- Master Town Layout v1: temporary development markers -----------------
// Phase 1 is geometry/roads only — real buildings aren't placed yet (per the
// brief, not even the ones with approved art). Each future structure gets a
// dashed reserved-footprint outline (sized from the real asset as a scale
// reference where one exists) plus a small signpost naming it, so districts
// read as placeholders rather than finished buildings.
function drawMarker(g, cx, topY, w, h, label, color = '#a08858') {
  const x = Math.round(cx - w / 2), y = Math.round(topY);
  g.globalAlpha = 0.14;
  rect(g, x, y, w, h, color);
  g.globalAlpha = 0.5;
  for (let i = 0; i < w; i += 8) { rect(g, x + i, y, 4, 1, color); rect(g, x + i, y + h - 1, 4, 1, color); }
  for (let i = 0; i < h; i += 8) { rect(g, x, y + i, 1, 4, color); rect(g, x + w - 1, y + i, 1, 4, color); }
  g.globalAlpha = 1;
  if (!label) return;
  const px = Math.round(cx), py = Math.round(y + h);
  rect(g, px - 1, py - 16, 2, 16, '#5c4a30');
  rect(g, px - 1, py - 17, 2, 2, '#7a6440');
  const words = label.toUpperCase();
  const bw = textWidth(words) + 8;
  rect(g, px - bw / 2, py - 27, bw, 12, 'rgba(28,22,15,0.85)');
  rectOutline(g, px - bw / 2, py - 27, bw, 12, '#c9a15a');
  drawText(g, words, px, py - 25, { color: '#f0d9a0', align: 'center' });
}

// Small unobtrusive signpost only — no reserved footprint/collision. Used for
// reserved-but-unplanned expansion space (south road, future homes/stalls).
function drawSignpost(g, x, y, label) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 5, 2, 0.2);
  rect(g, x - 1, y - 20, 2, 20, '#4a3a26');
  const words = label.toUpperCase();
  const bw = textWidth(words) + 8;
  rect(g, x - bw / 2, y - 32, bw, 12, 'rgba(20,26,18,0.75)');
  rectOutline(g, x - bw / 2, y - 32, bw, 12, '#6a8a5c');
  drawText(g, words, x, y - 30, { color: '#bcd9a8', align: 'center' });
}

// Market Square ground: packed-dirt ellipse with an irregular stone border
// and subtle wear texture — one shared pedestrian space, per the reference.
function marketSquareGround(g, m) {
  for (let yy = -m.ry; yy <= m.ry; yy++) {
    const k = 1 - (yy * yy) / (m.ry * m.ry);
    if (k <= 0) continue;
    const w = Math.round(m.rx * Math.sqrt(k) * (0.96 + hash(yy * 3.7) * 0.08));
    rect(g, m.cx - w, m.cy + yy, w * 2, 1, yy % 5 === 0 ? '#9a8465' : '#a8916f');
  }
  for (let a = 0; a < Math.PI * 2; a += 0.16) {
    const rr = 0.97 + hash(a * 9.1) * 0.05;
    rect(g, Math.round(m.cx + Math.cos(a) * m.rx * rr), Math.round(m.cy + Math.sin(a) * m.ry * rr), 2, 2, '#84745a');
  }
  for (let i = 0; i < 60; i++) {
    const a = hash(i * 4.3) * Math.PI * 2, rr = Math.sqrt(hash(i * 7.9));
    rect(g, Math.round(m.cx + Math.cos(a) * m.rx * rr * 0.9), Math.round(m.cy + Math.sin(a) * m.ry * rr * 0.9), 2, 1, i % 3 ? '#93805f' : '#b09877');
  }
}

// Small stone courtyard apron (lighter plaza stone, oval).
function courtyardGround(g, c) {
  for (let yy = -c.ry; yy <= c.ry; yy++) {
    const k = 1 - (yy * yy) / (c.ry * c.ry);
    if (k <= 0) continue;
    const w = Math.round(c.rx * Math.sqrt(k));
    rect(g, c.cx - w, c.cy + yy, w * 2, 1, yy % 4 === 0 ? '#a89e84' : '#b4aa90');
  }
  for (let a = 0; a < Math.PI * 2; a += 0.22) rect(g, Math.round(c.cx + Math.cos(a) * c.rx), Math.round(c.cy + Math.sin(a) * c.ry), 2, 2, '#8a7a64');
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

function bench(g, x, y) { shadow(g, x, y, 8, 2, 0.22); rect(g, x - 8, y - 4, 16, 3, '#7a5a3a'); rect(g, x - 8, y - 7, 16, 2, '#8a6a44'); rect(g, x - 7, y - 1, 2, 3, '#5a3a24'); rect(g, x + 5, y - 1, 2, 3, '#5a3a24'); }
function lamp(g, x, y, t) { rect(g, x - 1, y - 18, 2, 18, '#3a2e22'); rect(g, x - 3, y - 22, 6, 5, '#4a3a2a'); const f = 0.6 + Math.sin(t * 4 + x) * 0.2; g.globalAlpha = f; disc(g, x, y - 19, 3, '#ffd67a'); g.globalAlpha = 1; disc(g, x, y - 19, 1, '#fff2c0'); g.globalAlpha = 0.07 + f * 0.04; disc(g, x, y - 16, 20, '#ffcc66'); g.globalAlpha = 1; }
function brazier(g, x, y, t) { shadow(g, x, y, 6, 2, 0.3); rect(g, x - 4, y - 6, 8, 6, '#3a3a46'); rect(g, x - 5, y - 8, 10, 2, '#4a4a58'); rect(g, x - 1, y - 2, 2, 6, '#2a2a34'); const f = 0.6 + Math.sin(t * 8 + x) * 0.3; g.globalAlpha = f; disc(g, x, y - 10, 4, '#f2942b'); disc(g, x, y - 11, 2, '#ffd67a'); g.globalAlpha = 1; g.globalAlpha = 0.1 + f * 0.05; disc(g, x, y - 8, 18, '#ff9a3c'); g.globalAlpha = 1; }
function fenceRun(g, x, y, w) { for (let fx = x; fx <= x + w; fx += 8) rect(g, fx, y - 5, 1, 7, '#6b4a2e'); rect(g, x, y - 3, w, 1, '#7a5530'); rect(g, x, y, w, 1, '#5a3a24'); }
function barrel(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 9, 8, 9, '#7a5530'); rect(g, x - 4, y - 7, 8, 1, '#4a3220'); rect(g, x - 4, y - 3, 8, 1, '#4a3220'); rect(g, x - 4, y - 9, 8, 1, '#8a6a44'); }
function crate(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 8, 9, 8, '#8a6a44'); rectOutline(g, x - 4, y - 8, 9, 8, '#5a3a24'); rect(g, x - 4, y - 4, 9, 1, '#5a3a24'); rect(g, x, y - 8, 1, 8, '#5a3a24'); }
function logPile(g, x, y) { shadow(g, x, y, 6, 1, 0.22); for (let i = 0; i < 3; i++) rect(g, x - 6 + i * 4, y - 4, 3, 4, '#6b4a2e'); for (let i = 0; i < 2; i++) rect(g, x - 4 + i * 4, y - 7, 3, 3, '#7a5530'); }
function planter(g, x, y) { rect(g, x - 5, y - 5, 10, 5, '#6b4a2e'); rect(g, x - 5, y - 5, 10, 1, '#8a6a44'); rect(g, x - 4, y - 8, 2, 3, '#3a7a3e'); rect(g, x, y - 9, 2, 4, '#3a7a3e'); rect(g, x - 4, y - 9, 1, 1, '#e0679a'); rect(g, x + 1, y - 10, 1, 1, '#f2c94f'); }
function flowerbed(g, x, y) { for (let i = 0; i < 4; i++) { const fx = x + i * 4; rect(g, fx, y - 3, 1, 3, '#2f5836'); rect(g, fx, y - 4, 1, 1, ['#f2c94f', '#e0679a', '#9d8bff', '#e05a5a'][i % 4]); } }
function well(g, x, y) { shadow(g, x, y, 8, 3, 0.3); rect(g, x - 8, y - 8, 16, 8, '#8a8ea0'); rectOutline(g, x - 8, y - 8, 16, 8, '#3a3e4a'); rect(g, x - 9, y - 18, 2, 10, '#5a3a24'); rect(g, x + 7, y - 18, 2, 10, '#5a3a24'); rect(g, x - 10, y - 20, 20, 3, '#7a3e2c'); }
function cart(g, x, y) { shadow(g, x, y, 10, 2, 0.28); rect(g, x - 12, y - 8, 24, 6, '#7a5530'); rectOutline(g, x - 12, y - 8, 24, 6, '#4a3220'); disc(g, x - 8, y, 3, '#4a3220'); disc(g, x + 8, y, 3, '#4a3220'); disc(g, x - 8, y, 1, '#8a6a44'); disc(g, x + 8, y, 1, '#8a6a44'); drawIcon(g, 'potionRed', x - 4, y - 14); }
function mailbox(g, x, y) { rect(g, x - 1, y - 8, 2, 8, '#5a3a24'); rect(g, x - 4, y - 13, 9, 6, '#c0463c'); rectOutline(g, x - 4, y - 13, 9, 6, '#2a1a10'); rect(g, x + 4, y - 12, 2, 3, '#d8b24a'); }
function clothesline(g, x, y) { rect(g, x - 12, y - 14, 1, 14, '#5a3a24'); rect(g, x + 12, y - 14, 1, 14, '#5a3a24'); rect(g, x - 12, y - 13, 24, 1, '#8a8070'); rect(g, x - 6, y - 12, 4, 5, '#5c6a8a'); rect(g, x + 2, y - 12, 4, 6, '#c0463c'); }
function signpost(g, x, y) { rect(g, x - 1, y - 12, 2, 12, '#5a3a24'); rect(g, x - 8, y - 12, 16, 4, '#7a5530'); rect(g, x - 8, y - 12, 16, 1, '#8a6a44'); }
function banner(g, x, y, color) { rect(g, x, y, 3, 20, color); rect(g, x, y + 20, 3, 2, '#2a1e14'); rect(g, x - 1, y + 16, 5, 4, color); }
function weaponRack(g, x, y) { rect(g, x - 8, y - 2, 16, 3, '#6b4a2e'); rect(g, x - 8, y - 14, 2, 14, '#5a3a24'); rect(g, x + 6, y - 14, 2, 14, '#5a3a24'); drawIcon(g, 'sword', x - 6, y - 12); drawIcon(g, 'axe', x + 1, y - 12); }
function outdoorTable(g, x, y) { shadow(g, x, y, 8, 2, 0.24); rect(g, x - 8, y - 6, 16, 3, '#7a5530'); rect(g, x - 7, y - 3, 2, 3, '#5a3a24'); rect(g, x + 5, y - 3, 2, 3, '#5a3a24'); drawIcon(g, 'coin', x - 3, y - 11); }
function petHouse(g, x, y, color) { shadow(g, x, y, 5, 1, 0.22); rect(g, x - 5, y - 5, 10, 5, '#8a6a44'); for (let i = 0; i < 6; i++) rect(g, x - 5 + i, y - 5 - i * 0.5, 10 - i * 2, 1, color); disc(g, x, y - 2, 2, '#2a1a10'); }
function bowl(g, x, y) { rect(g, x - 3, y - 2, 6, 2, '#8a8ea0'); rect(g, x - 2, y - 1, 4, 1, '#5c6a8a'); }
function egg(g, x, y, color) { rect(g, x - 1, y - 3, 3, 4, color); rect(g, x - 1, y - 3, 1, 1, '#ffffff'); }
function bridge(g, x, y, w, h) { rect(g, x, y, w, h, '#7a5530'); for (let by = 0; by < h; by += 4) rect(g, x, y + by, w, 1, '#5a3a24'); rect(g, x, y, w, 1, '#8a6a44'); rect(g, x, y + h - 1, w, 1, '#8a6a44'); rect(g, x - 1, y, 1, h, '#4a3220'); rect(g, x + w, y, 1, h, '#4a3220'); }

// A small reed/cattail cluster for riverbanks — a few thin blades and one
// cattail head, with a barely-there sway so the bank doesn't feel static.
function drawReeds(g, x, y, seed, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 0.6 + seed) * 0.6;
  shadow(g, x, y, 5, 2, 0.2);
  for (let i = 0; i < 3; i++) {
    const bx = x + (i - 1) * 3;
    const h = 9 + (i % 2) * 2;
    const tip = bx + sway * (i - 1 === 0 ? 0.4 : 1);
    rect(g, bx, y - h, 1, h, '#3a7a3e');
    rect(g, Math.round(tip), y - h, 1, 3, '#5cad5e');
  }
  rect(g, x + 1, y - 12 + sway * 0.5, 1, 5, '#4a7a3a'); // cattail stem
  rect(g, x, y - 16 + sway * 0.5, 3, 4, '#7a5a34'); // cattail head
  rect(g, x, y - 16 + sway * 0.5, 3, 1, '#9a7a4a'); // head highlight
}

function fillEllipse(g, cx, cy, rx, ry, color) {
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

// Volumetric tree: trunk, layered canopy (dark underside -> bright upper-left
// highlight), a lower-right shade crescent and a ground contact shadow. Gentle
// sway. Reads with real volume rather than as a flat symbol.
function bigTree(g, x, y, kind, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 1.1 + x * 0.3) * 1;
  if (kind === 'pine') {
    contactShadow(g, x, y, 9, 3, 0.34);
    rect(g, x - 1, y - 6, 3, 6, '#4a3018'); rect(g, x - 1, y - 6, 1, 6, '#5c3e22');
    pineTier(g, x + sway * 0.3, y - 4, 12, 7);
    pineTier(g, x + sway * 0.5, y - 12, 9, 7);
    pineTier(g, x + sway * 0.7, y - 20, 6, 6);
    rect(g, x - 1 + sway, y - 28, 2, 3, '#1f4a26'); // tip
  } else {
    contactShadow(g, x, y, 13, 4, 0.34);
    rect(g, x - 2, y - 9, 4, 9, '#5a3a24'); rect(g, x - 2, y - 9, 2, 9, '#6b4a2e');
    const cy = y - 13 + sway;
    fillEllipse(g, x + 1, cy + 3, 13, 9, '#1e4824');   // dark underside
    fillEllipse(g, x - 1, cy, 13, 9, '#2c6a32');       // mid canopy
    fillEllipse(g, x - 2, cy - 2, 10, 7, '#3d8a40');   // lit
    fillEllipse(g, x - 4, cy - 4, 6, 4, '#57b356');    // highlight (upper-left)
    fillEllipse(g, x + 6, cy + 3, 5, 4, '#173d1c');    // lower-right shade
    // a couple of leaf clumps for texture
    rect(g, x - 6, cy - 1, 1, 1, '#57b356'); rect(g, x + 4, cy - 3, 1, 1, '#3d8a40');
  }
}

function pineTier(g, cx, baseY, halfW, hgt) {
  cx = Math.round(cx);
  for (let i = 0; i < hgt; i++) {
    const k = i / hgt;
    const w = Math.round(halfW * (0.15 + k * 0.85));
    const y = baseY - hgt + i;
    rect(g, cx - w, y, w * 2, 1, '#2c6a32');            // mid
    rect(g, cx - w, y, Math.max(1, w), 1, '#3d8a40');   // left/upper lit
    rect(g, cx + Math.floor(w * 0.4), y, Math.ceil(w * 0.6), 1, '#1f4a26'); // right shade
  }
  rect(g, cx - halfW, baseY - 1, halfW * 2, 1, '#173d1c'); // dark base line
}

// stable pseudo-random for ground tiles / placement
function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }
function rand2(a, b) { return a + Math.random() * (b - a); }

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
