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
import { buildWaterMask, drawFishJump, drawDucks, drawFrogs, drawPondPads } from '../gfx/waterfx.js';
import { WeaponShop, PotionShop, InventoryMenu } from './menus.js';
import { hash, rand2, fillEllipse } from './town/primitives.js';
import { drawNight } from './town/lighting.js';
import { ROAD_TILE, GRASS_TILES, GRASS_TILE, PLAZA_TILES } from './town/tiles.js';
import { ROAD_CELL, buildRoadCoverage, drawRoads, roadPath, strokeRoundedPath } from './town/roads.js';

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

// A gazebo bridge over the lake was tried and removed: the art is a
// side-elevation sprite, and stretching one span from bank to bank meant
// squashing it well off its own proportions, which read as chopped up rather
// than as a crossing. assets/bridge.png (matted) and assets/bridgedock.png
// (the author's untouched original) are kept for a future attempt — that
// attempt wants art drawn for the span, not this one rescaled to fit it.

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

// The two original road lamps that stood at the north and south approaches
// were removed: the square's lighting is now the matched twin-lantern pair in
// the formal ring, and a second, different lamp on two of the four approaches
// broke the symmetry that pair exists to establish.

// ------------------------------------------------------------ decor props
// Sliced out of the project's asset-library sheets (village decorations,
// fences & property decor, natural vegetation, rocks & forest floor) and
// matted to real alpha. Every sprite is bottom-anchored like the lamps
// above, so an entry is just its on-screen size in world units — the sheets
// are drawn at roughly twice the game's scale, hence the consistent
// reduction. Only what the Crystal Plaza dressing actually uses is loaded.
const DECOR_SIZE = {
  // civic furniture — the benches match each other on purpose; a square reads
  // as municipal when its furniture is a set, not an assortment
  bench_01: [32, 20],
  planter_01: [28, 21], planter_02: [32, 16],
  lamppost_twin: [26, 38],
  // The single lantern is the ROAD fitting: the twin pair is plaza
  // architecture and stays unique to the fountain, so the navigation lamps
  // out on the approaches read as a lighter class of thing even by day.
  lamppost_single: [17, 36],
  // The plain wooden post from the village decor sheet — cut long ago but
  // never baked or wired. No stone base, so it reads as a lane lamp rather
  // than civic plaza furniture.
  lamppost_wood: [18, 36],
  // ---- farm crops (from 'farm assets.png', labelled on the sheet) ---------
  // Each crop sprite carries its OWN patch of tilled soil, so a grid of them
  // reads as worked rows without needing a separate ground layer under it.
  // Sized so one plant occupies about a quarter of a player width, which is
  // what makes a field read as many plants rather than a few big props.
  soil_plot: [26, 26],
  crop_carrot: [21, 26], crop_cabbage: [22, 20],
  crop_mature_01: [21, 25], crop_wheat_01: [20, 28],
  signpost: [20, 26],
  // a trader's pitch — the plaza in use, not just furnished. Sized against the
  // player rather than the sheet: a barrel reaches a hero's waist, a stack of
  // crates their shoulder, so these run smaller than the civic furniture.
  crate_stack: [23, 25], crate_01: [14, 16], barrel_01: [13, 16], barrel_stack: [21, 23],
  sack_pile: [22, 18], sack_01: [12, 14], cart: [28, 24],
  // planting
  bush_01: [20, 18], bush_02: [20, 17], bush_03: [18, 16], bush_04: [18, 10],
  bush_low: [26, 20], bush_big: [34, 32],
  flowers_white: [16, 14], flowers_yellow: [17, 16], flowers_blue: [16, 16],
  flowers_red: [17, 16], flowers_mixed: [23, 22],
  grass_tuft_01: [17, 18], grass_tuft_02: [18, 17], grass_tuft_03: [17, 16], grass_tuft_04: [17, 17],
  fern_clump: [25, 26], weeds_01: [18, 17], weeds_02: [16, 16],
  // Wetland planting for the lake shore, sliced from assets/pond vegg.png into
  // real props so they go through the depth-sorted prop pass like everything
  // else. Drawn flat in the ground pass they read as stickers laid on the
  // bank — the player walked in front of tall cattails instead of behind them.
  // Large vegetation masses from assets/download.png — the anchors the
  // shoreline is composed from. Grass is meant to be the region's primary
  // ground cover, so these go down first and the smaller tufts feather their
  // edges afterwards, rather than the shore being built from hundreds of tufts.
  grass_lg_01: [36, 30], grass_lg_02: [37, 30], grass_lg_03: [33, 30], grass_lg_04: [20, 30], grass_lg_05: [20, 30], grass_lg_06: [23, 30], grass_lg_07: [31, 30], grass_lg_08: [27, 30], grass_lg_09: [25, 30],
  grass_dark_01: [37, 26], grass_dark_02: [41, 26], grass_dark_03: [38, 26], grass_dark_04: [37, 26], grass_dark_05: [41, 26], grass_dark_06: [37, 26],
  grass_strip_01: [42, 22], grass_strip_02: [38, 22], grass_strip_03: [26, 22], grass_strip_04: [26, 22], grass_strip_05: [27, 22], grass_strip_06: [53, 22],
  reedbed_01: [31, 34], reedbed_02: [37, 34], reedbed_03: [30, 34], reedbed_04: [31, 34], reedbed_05: [40, 34], reedbed_06: [70, 34], reedbed_07: [40, 34], reedbed_08: [26, 34],
  rockgrass_01: [29, 24], rockgrass_02: [29, 24], rockgrass_03: [42, 24], rockgrass_04: [36, 24], rockgrass_05: [24, 24],
  fernbank_01: [29, 26], fernbank_02: [37, 26], fernbank_03: [40, 26],
  // Medium and small grass, for feathering the large masses down to open ground.
  grass_md_01: [37, 20], grass_md_02: [39, 20], grass_md_03: [28, 20], grass_md_04: [24, 20], grass_md_05: [29, 20],
  grass_teal_01: [35, 18], grass_teal_02: [27, 18], grass_teal_03: [25, 18], grass_teal_04: [30, 18], grass_teal_05: [26, 18],
  grass_tall_01: [29, 24], grass_tall_02: [23, 24], grass_tall_03: [15, 24], grass_tall_04: [19, 24],
  grass_bloom_01: [26, 18], grass_bloom_02: [26, 18], grass_bloom_03: [24, 18],
  leafplant_01: [19, 16], leafplant_02: [14, 16],
  rockgrass_md_01: [24, 18], rockgrass_md_02: [27, 18], rockgrass_md_03: [27, 18], rockgrass_md_04: [27, 18],
  cattail_md_01: [21, 22], cattail_md_02: [37, 22],
  grass_sm_01: [11, 12], grass_sm_02: [30, 12], grass_sm_03: [14, 12], grass_sm_04: [13, 12], grass_sm_05: [17, 12], grass_sm_06: [16, 12],
  grass_tiny_01: [8, 8], grass_tiny_02: [8, 8], grass_tiny_03: [7, 8], grass_tiny_04: [11, 8], grass_tiny_05: [11, 8], grass_tiny_06: [9, 8],
  grass_lean_01: [18, 16], grass_lean_02: [22, 16], grass_lean_03: [22, 16], grass_lean_04: [23, 16],
  cattail_01: [20, 27], cattail_02: [25, 29], cattail_03: [23, 28],
  cattail_flower_01: [19, 27], cattail_flower_02: [19, 27],
  reeds_01: [14, 27], reeds_02: [20, 25], reeds_03: [26, 28], reeds_04: [27, 26],
  wetgrass_01: [18, 17], wetgrass_02: [25, 19], wetgrass_03: [30, 20],
  waterleaf_01: [22, 24], waterleaf_02: [32, 24],
  tree_small_pine: [30, 38],
  // Broadleaf stock (sliced from the tree sheet). Sized as a planting
  // hierarchy rather than to the art's own proportions: a whip, an understory
  // tree, ornamentals, then canopy. Real planting never jumps straight from a
  // 32-unit shrub to a 62-unit canopy — the intermediate sizes are what let a
  // group read as one planted mass instead of as big sprites next to small
  // ones. Heights are the design; each width is the source aspect held exactly,
  // so nothing is squashed.
  tree_sapling: [22, 34], tree_young: [26, 44],
  tree_blossom_white: [43, 52], tree_blossom_blue: [42, 52], tree_blossom_violet: [42, 51],
  tree_oak_round: [52, 62], tree_oak_spread: [50, 64], tree_oak_broad: [75, 60],
  // DECIDUOUS_TREE_01, matted off the labelled sheet at
  // assets/Natural Vegatiation.jpeg (a JPEG on a flat panel, so the background
  // was flood-filled from the crop border and the panel's own rule trimmed at
  // the blank gap above it). Carries its own ground shadow, so it is placed
  // with shadow 0 rather than getting a second one from drawPropArt.
  // Cut from the labelled natural-vegetation sheet. Crop INSIDE each panel's
  // border and sample the background from the crop's own corners — cropping
  // wider starts the flood on the sheet ground, and the panel's border line
  // then blocks it, leaving the panel square baked into the sprite.
  // Understory off the same sheet. Panels there enclose their own caption, so
  // the cut drops components that look like text (short, small) or a rule
  // (wide, thin) before splitting the panel into sprites.
  nv_bush_01: [36, 32], nv_bush_02: [60, 32], nv_bush_03: [37, 32], nv_bush_04: [36, 32], nv_tallgrass_01: [21, 24], nv_tallgrass_02: [22, 24], nv_tallgrass_04: [25, 24], nv_tallgrass_05: [26, 24], nv_tallgrass_06: [27, 24], nv_tallgrass_07: [27, 24], nv_weeds_01: [17, 17], nv_weeds_02: [17, 17], nv_weeds_03: [16, 17], nv_weeds_04: [17, 17],
  pine_tree_01: [47, 70], pine_tree_02: [46, 70],
  pine_tree_03: [49, 70], pine_tree_04: [49, 70],
  deciduous_tree_01: [62, 70], deciduous_tree_02: [62, 70],
  deciduous_tree_03: [62, 70], deciduous_tree_04: [57, 70],
  deciduous_tree_05: [64, 70], deciduous_tree_06: [57, 70],
  // MUSHROOMS_01/_02 off the same sheet; each labelled cell held two clusters
  // side by side, so they are split into four variants.
  mushrooms_01: [14, 12], mushrooms_02: [13, 12],
  mushrooms_03: [17, 13], mushrooms_04: [14, 13],
  // Specimens that carry their own ground treatment — a root flare with rough
  // grass, and a skirt of flowers. They dress their own base, so they read as
  // planted rather than dropped, and need no understory placed around them.
  tree_rooted: [50, 66], tree_flowerbed: [42, 62],
  // Built containers: civic furniture that happens to be alive. Kept near
  // lamppost height (38) on purpose — they belong to the furniture set that
  // frames the square, not to the landscape beyond it.
  topiary_square: [28, 42], topiary_round: [24, 40],
  // ---- quadrant props (new cuts) -----------------------------------------
  // Sized against the player (~20 units tall), not against the sheet: a barrel
  // reaches the waist, a fence rail the chest, a well the shoulder. Each width
  // holds the source aspect so nothing is squashed.
  // SE — the market approach
  wheelbarrow: [30, 16], hay_bale: [22, 17], hay_pile: [28, 22],
  barrel_02: [13, 17], crate_02: [14, 16], wooden_sign: [18, 20],
  // NE — archive and forge
  wood_pile_01: [24, 19], wood_pile_03: [25, 18], chopping_block: [18, 20],
  log_long: [28, 17], tree_stump_01: [20, 16],
  // SW — the cottage gardens
  fence_run: [52, 13], fence_short: [28, 18], fence_vertical: [38, 14],
  // A single post. `fence_vertical` is a face-on picket SECTION, not a
  // fence running away from camera — stacked it reads as a wooden wall.
  // A line of these is how a side run is actually drawn in this view.
  fence_post: [5, 18],
  fence_corner_ne: [32, 19], fence_corner_sw: [28, 18], fence_corner_se: [26, 20],
  fence_end_e: [23, 14], fence_end_w: [23, 13], fence_gate: [62, 13],
  garden_patch_01: [34, 25], garden_patch_02: [33, 24],
  flower_box_01: [24, 18], flower_box_02: [28, 14], clothes_line: [34, 21],
  mailbox: [9, 20], wooden_post: [6, 26], water_well: [26, 29], water_bucket: [12, 15],
  // NW — lake, guild, the wild edge
  tree_stump_02: [21, 16], fallen_log_01: [30, 22], fallen_log_02: [24, 12],
  direction_sign: [18, 23], fallen_branch: [28, 19], twig_pile: [26, 17],
  leaf_pile: [26, 20], mushrooms_red: [12, 10], mushrooms_mixed: [12, 10],
  // ground detail
  rock_small_01: [18, 15], rock_small_02: [18, 15], rock_small_03: [17, 15], rock_med_01: [27, 23],
  pebbles_01: [11, 10], pebbles_02: [13, 9], pebbles_03: [18, 13],
  // ---- Eldertree ruin set (sliced from the Mystical Tree sheet) ----------
  // This sheet is authored much larger than the library pages, so sizes come
  // from design height, not a fixed ratio: statues read at ~1.5 player
  // heights, temple columns at ~2, and the grand tree is the biggest thing
  // in the world on purpose — a landmark seen over everything else.
  mystic_tree_grand: [176, 200],
  myst_col_a: [12, 40], myst_col_b: [12, 40], myst_col_cracked: [12, 40], myst_col_tall: [13, 42],
  myst_col_lean: [11, 29], myst_col_broken: [10, 25], myst_col_stub: [9, 19], myst_col_drum: [18, 11],
  myst_arch_a: [37, 46], myst_arch_b: [37, 46], myst_arch_narrow: [21, 45], myst_arch_vine: [33, 44],
  myst_ped_book: [14, 26], myst_ped_sword: [14, 26], myst_ped_leaf: [14, 26],
  myst_ped_crystal_dim: [14, 28], myst_ped_crystal_lit: [14, 30],
  myst_bench_a: [30, 20], myst_bench_b: [31, 20], myst_bench_c: [28, 20], myst_bench_d: [22, 20],
  myst_bench_bit: [18, 12],
  myst_pond: [96, 37],
  // the sheet's own ancient paving, laid flat as the shrine walkway (the _ew
  // pieces are pre-rotated by the cutter, since props only ever mirror)
  myst_path_straight: [18, 37], myst_path_straight_ew: [37, 18],
  myst_path_curve: [20, 37], myst_path_curve_ew: [37, 20],
  myst_path_cross: [34, 40], myst_path_edge: [19, 15], myst_path_steps: [22, 22],
  myst_statue_maiden: [13, 30], myst_statue_knight: [15, 30], myst_statue_crystal: [14, 28],
  myst_statue_kneel: [12, 23], myst_statue_glow: [14, 22], myst_statue_sit: [17, 20],
  myst_crystals_purple: [21, 24], myst_crystals_cyan: [22, 22], myst_crystals_mini: [14, 13],
  myst_rock_a: [16, 15], myst_rock_b: [16, 16], myst_rock_c: [16, 15], myst_rock_d: [16, 16], myst_rock_e: [17, 16],
  myst_wall_long: [40, 22], myst_wall_gap: [40, 22], myst_wall_vine: [41, 22], myst_wall_steps: [41, 22],
  myst_wall_long_ns: [22, 40], myst_wall_gap_ns: [22, 40], myst_wall_vine_ns: [22, 41], myst_wall_steps_ns: [22, 41],
  myst_door_flowers: [23, 36], myst_stone_pair: [10, 20], myst_stone_one: [12, 22],
  myst_pillar_moss_a: [9, 29], myst_pillar_moss_b: [10, 26],
  myst_bush_white: [34, 26], myst_bush_meadow: [46, 25], myst_stump_flowers: [38, 38],
  myst_flower_spray: [30, 31],
  myst_shrine_niche: [19, 34], myst_fountain_mini: [33, 34],
  myst_arch_ruin: [52, 48], myst_gazebo: [39, 52],
  myst_tree_round: [49, 56], myst_tree_roots: [49, 62],
  myst_rubble_a: [38, 12], myst_rubble_b: [12, 11], myst_rubble_c: [13, 12],
  myst_crystal_spike: [13, 14],
};
const DECOR_ART = {};
for (const n of Object.keys(DECOR_SIZE)) DECOR_ART[n] = loadBuildingArt(`assets/props/${n}.png`);

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
      // The meadow gap west of the Archive, framed by the Archive link road
      // to the north and the Forge->Archive road to the east: a ruined
      // shrine glade around the grand crystal tree.
      eldertree: OFF(570, -605),    // NE gap, west of the Archive (~8.6s)
    };
    const ET = D.eldertree;
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
    // Plaza disc diameter as a multiple of the fountain's width, so the paving
    // always scales with the landmark rather than being a fixed pixel figure.
    // Tightened from 2.2x to 1.9x: with the roads widened, the old disc read
    // as a large empty apron around the fountain. The four road exits, both
    // lamps and the flares are all derived from this radius, so they follow it
    // inward automatically.
    this.plazaRadius = Math.round(FOUNTAIN_W * 1.9 / 2); // ~1.9x fountain diameter

    this.locations = [
      { id: 'plaza', name: 'Crystal Plaza', dx: PZ.x, dy: PZ.y + 18, action: 'rest', district: 'Crystal Plaza',
        draw: (g) => drawFountainSprite(g, PZ.x, PZ.y, this.t, this.plazaRadius), solid: { x: PZ.x - 26, y: PZ.y - 27, w: 52, h: 16 } },

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

      // ---- The Eldertree: grand crystal tree on its ruined dais ----
      // The dais is part of the art, so the sprite carries its own ground
      // (shadowRx 0, same as the compound buildings). Solid is the dais
      // ellipse's AABB; the interact point sits on the south steps.
      // Collision is three boxes stepping in toward the ellipse's tips
      // (the rest are appended to this.solids below), so the player can walk
      // right up to the stone beside the dais and never bumps into air.
      { id: 'eldertree', name: 'The Eldertree', dx: ET.x, dy: ET.y + 26, action: 'rest', label: 'Rest beneath the Eldertree', district: 'Eldertree Glade',
        sortY: ET.y - 2,
        draw: (g) => drawEldertree(g, ET.x, ET.y, this.t),
        solid: { x: ET.x - 82, y: ET.y - 46, w: 164, h: 32 } },

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
    this.solids.push({ x: ET.x - 54, y: ET.y - 14, w: 108, h: 12 },   // dais front steps
                     { x: ET.x - 54, y: ET.y - 58, w: 108, h: 12 });  // dais back
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
      const x = this.lakeTopLeft.x + fx * POND_W, y = this.lakeTopLeft.y + fy * POND_H;
      this.solids.push({ x, y, w: fw * POND_W, h: fh * POND_H });
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
      { name: 'Eldertree Glade', x: ET.x - 400, y: ET.y - 300, w: 830, h: 720 },
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
    const mainWidth = 42, resWidth = 26, narrowWidth = 16, advWidth = 38; // main matches flareFarW below exactly

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
    // Near width is generously wider than the road it feeds so the funnel
    // overlaps the circle well past the outward wobble above, leaving no
    // sliver at the join; far width matches the main road exactly.
    const flareNearW = 62, flareFarW = 42, flareDepth = 34;
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
      { kind: 'main', fam: 'main', famTo: 'civic', w0: 42, w1: 38, width: mainWidth, pts: [
        exitN, [PZ.x, PZ.y - 700], [WX - 24, D.watch.y + 500], [WX - 24, D.watch.y + 130]] },
      // SECONDARY: main trunk -> Guild spur. Branches off the Plaza->Watch
      // spine well north of the Lake (y=PZ.y-700, ~285 units clear of its
      // top edge) and drops straight down into the Guild's courtyard —
      // Guild's second connection besides the Training link below, so it's
      // not a dead end reachable only by way of Training.
      { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 33, w1: 33, width: narrowWidth, pts: [
        [PZ.x, PZ.y - 700], [PZ.x - 250, PZ.y - 760], [D.guild.x + 180, D.guild.y + 190],
        [D.guild.x + 55, D.guild.y + 40]] },
      // ADVENTURE ROAD: through the Watch (fence gap -> courtyard -> arch),
      // then the long wilderness run north to the Runebound Gate. Ancient
      // family throughout, narrowing 30 -> 21 as civilization falls away.
      { kind: 'adventure', fam: 'ancient', w0: 38, w1: 27, width: advWidth, pts: [
        [WX - 24, D.watch.y + 130], [WX - 24, D.watch.y], [WX, D.watch.y - 30], [WX, D.watch.y - 90],
        [D.gate.x + 40, D.gate.y + 620], [D.gate.x, D.gate.y + 370], [D.gate.x, D.gate.y + 45]] },
      // MAIN E: Plaza -> Commercial street, running to the Forge's front.
      { kind: 'main', fam: 'main', w0: 42, w1: 42, width: mainWidth, pts: [
        exitE, [PZ.x + 330, PZ.y - 20], [PZ.x + 600, PZ.y - 90], [forgeSpot.x, forgeSpot.y + 55]] },
      // MAIN S: Plaza -> Market Square. Runs down the square's WEST rim
      // rather than through it, so the stalls front a real street while the
      // open middle stays clear for NPC traffic and events.
      { kind: 'main', fam: 'main', w0: 42, w1: 37, width: mainWidth, pts: [
        exitS, [PZ.x + 60, PZ.y + 430], [D.market.x - 240, D.market.y - 300],
        [D.market.x - 205, D.market.y - 60], [D.market.x - 195, D.market.y + 60]] },
      // Market -> South Road (future world exit) — continues from the same
      // rim point so the street reads as one continuous route through town,
      // then tapers toward the map edge.
      { kind: 'main', fam: 'main', w0: 37, w1: 30, width: mainWidth, pts: [
        [D.market.x - 195, D.market.y + 60], [D.market.x - 120, D.market.y + 250],
        [D.southRoad.x, D.southRoad.y]] },
      // MAIN W: Plaza -> Residential entry (a long, clearly horizontal run)
      { kind: 'main', fam: 'main', famTo: 'res', w0: 42, w1: 28, width: mainWidth, pts: [
        exitW, [PZ.x - 420, PZ.y + 60], [PZ.x - 700, PZ.y + 260], [D.residential.x + 215, D.residential.y - 70]] },
      // Residential neighborhood loop — a compact ring street with all four
      // properties fronting it: Hearthwood + lotA on the north arc, lotB
      // east, Player House on the south arc with the deepest yard.
      // The west arc swings out to x-300 rather than x-235: at the tighter
      // radius the arc ran diagonally straight THROUGH the Player House's
      // footprint (the house sat on the street, not beside it). Pushed west,
      // the house now sits inside the ring fronting the south arc, with its
      // yard between.
      { kind: 'res', fam: 'res', w0: 26, w1: 26, width: resWidth, pts: [
        [D.residential.x + 215, D.residential.y - 70], [cottageSpot.x, cottageSpot.y + 40],
        [D.residential.x - 95, D.residential.y - 65], [D.residential.x - 280, D.residential.y - 55],
        [D.residential.x - 300, D.residential.y + 80], [houseSpot.x - 30, houseSpot.y + 62],
        [D.residential.x + 60, D.residential.y + 175], [D.residential.x + 215, D.residential.y + 85],
        [D.residential.x + 215, D.residential.y - 70]] },
      // SECONDARY: Residential -> Valorhall (northwest lane), firming from
      // neighbourhood stone into the wilder outskirts.
      { kind: 'secondary', fam: 'res', famTo: 'nature', w0: 25, w1: 23, width: narrowWidth, pts: [
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
      { kind: 'secondary', fam: 'nature', famTo: 'civic', w0: 23, w1: 28, width: narrowWidth, pts: [
        [D.training.x + 30, D.training.y + 100], [D.training.x + 205, D.training.y + 20],
        [D.training.x + 250, 1985], [D.guild.x - 150, 1930], [D.guild.x - 75, D.guild.y + 60]] },
      // SECONDARY: Commercial -> Archive (quiet landscaped NE path)
      { kind: 'secondary', fam: 'main', w0: 26, w1: 26, width: narrowWidth, pts: [
        [forgeSpot.x + 30, forgeSpot.y + 30], [D.archive.x - 120, PZ.y - 420],
        [D.archive.x, D.archive.y + 200], [D.archive.x, D.archive.y + 70]] },
      // SECONDARY: Archive -> north road (adventure-route link, no backtrack)
      // — joins the main trunk at the same waypoint the trunk itself bends
      // through, now that this no longer doubles as "near the Guild".
      { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 24, w1: 24, width: narrowWidth, pts: [
        [D.archive.x - 40, D.archive.y - 20], [D.archive.x - 700, D.archive.y - 200], [WX - 24, D.watch.y + 500]] },
      // ---- Eldertree Glade approaches ---------------------------------
      // The glade is entered from the SOUTH (see _buildEldertreeGrove for
      // why the axis is fixed). Both spurs are town cobble easing into the
      // Nature family — grass reclaiming a footpath — because the town keeps
      // the shrine way walkable but stopped paving it long ago; the glade's
      // own ancient flagstones take over where the road ends. (Ancient was
      // tried for this: at 17 units wide its dark wash + 46% rubble rate
      // reads as a smear, not a road.)
      // MAIN APPROACH: leaves the commercial street north of the Potion
      // Shop lane and runs straight up the meadow to the gate — ~9s from the
      // plaza, in scale with the landmark. Wander nearly off (a processional
      // way stays deliberate) and the end pinned between the guardian
      // statues, dead on the walkway axis, so the hand-off is exact.
      { kind: 'secondary', fam: 'main', famTo: 'nature', w0: 24, w1: 19, width: narrowWidth,
        wob: [10, 300], pts: [
        [2600, 2673], [2596, 2565], [2614, 2445], [ET.x, ET.y + 300]] },
      { kind: 'secondary', fam: 'main', famTo: 'nature', w0: 22, w1: 17, width: narrowWidth,
        wob: [10, 300], pts: [
        [2740, 1915], [2812, 1988], [2846, 2110], [2810, 2250], [2720, 2350], [2616, 2400]] },
      // ---- Ancient City interior streets: the SAME ROAD_FAM stone as the
      // rest of the map (replacing the mystical flagstone paths). Straight
      // (wander off) — a city grid, not a meandering trail.
      { kind: 'main', fam: 'main', famTo: 'ancient', w0: 46, w1: 46, width: mainWidth, wob: [0, 0], pts: [
        [ET.x, ET.y - 258], [ET.x, ET.y + 356]] },              // main avenue N-S
      { kind: 'secondary', fam: 'main', famTo: 'ancient', w0: 34, w1: 34, width: narrowWidth, wob: [0, 0], pts: [
        [ET.x - 306, ET.y + 40], [ET.x + 306, ET.y + 40]] },    // cross street E-W
      // market plaza: a short, wide road node on the avenue (the paved square)
      { kind: 'main', fam: 'main', famTo: 'ancient', w0: 92, w1: 92, width: mainWidth, wob: [0, 0], pts: [
        [ET.x, ET.y + 168], [ET.x, ET.y + 214]] },
      // SECOND ROUTE: from the Archive link road, swinging down the glade's
      // east side and joining the main approach a little south of the gate,
      // so the north of town reaches the glade without going via the plaza.
      // SECONDARY: Commercial -> Market (east loop, skips the plaza). Runs
      // down the square's EAST rim, mirroring the main road on the west, so
      // the market sits framed between two streets instead of having a lane
      // dead-end in the grass north of the stalls.
      // It leaves the commercial street, passes the Potion Shop's front door
      // on the way down, then continues to the market.
      { kind: 'secondary', fam: 'main', w0: 28, w1: 26, width: narrowWidth, pts: [
        [PZ.x + 480, PZ.y - 60], [potionSpot.x + 40, potionSpot.y - 130],
        [potionSpot.x + 105, potionSpot.y + 30], [D.market.x + 235, D.market.y - 200],
        [D.market.x + 205, D.market.y + 40]] },
      // SECONDARY: Residential -> Market (south loop, skips the plaza).
      // Starts exactly on a loop vertex — branching a few dozen units off the
      // ring left a blobby smear of overlapping road at the junction.
      { kind: 'secondary', fam: 'res', famTo: 'main', w0: 25, w1: 26, width: narrowWidth, pts: [
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
      { kind: 'secondary', fam: 'nature', w0: 19, w1: 18, width: narrowWidth, pts: [
        [D.residential.x - 300, D.residential.y + 80], [D.sanctuary.x + 200, D.sanctuary.y - 40],
        [D.sanctuary.x + 130, D.sanctuary.y + 90], [D.sanctuary.x, D.sanctuary.y + 80]] },
      // NATURE: Lake shoreline spur — branches off the Residential->Valorhall
      // lane and runs east to the Lake's calm SOUTH cove, stopping at the
      // water's edge. Reserved future home of the fishing spot / bench /
      // dock. Deliberately approaches from the town side: the north and west
      // shores stay roadless wilderness, which is what keeps the far side of
      // the lake feeling untouched.
      { kind: 'secondary', fam: 'nature', w0: 17, w1: 18, width: narrowWidth, pts: [
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

    buildRoadCoverage(this, FC);

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
    this.crystalGlows = [];  // [x, y, hue, r] — Eldertree ground crystals
    this.butterflies = [];   // see drawButterfly
    this.npcs = [];
    this.sanctuaryPets = [];
    this.sanctuary = { x: D.sanctuary.x - 40, y: D.sanctuary.y - 20, w: 80, h: 40 };

    this._buildPlazaDecor(FC);
    // The lake region is left undecorated. Trees, shrubs, waterside planting,
    // flowers, rocks and the destination compositions were each tried and each
    // taken back out; the lake reads better as water in open meadow. The pass
    // itself is kept intact below — restore it by calling it again.
    // this._buildLakeDecor();
    this._buildLakeDetail();
    this._buildEldertreeGrove();

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
      ['ELDERTREE', D.eldertree.x, D.eldertree.y - 226],
      ['SANCTUARY', D.sanctuary.x, D.sanctuary.y + 130],
      ['WATCH', D.watch.x + 35, D.watch.y - 150],
      ['RUNEBOUND GATE', D.gate.x, D.gate.y - 130],
      ['LAKE', D.lake.x, D.lake.y - POND_H / 2 - 24],
    ];
  }

  // ---- The Ancient Crystal Village ---------------------------------------
  // The remains of a settlement built around a sacred Crystal Tree (the HEART
  // TREE) and slowly reclaimed by nature. This is composed like architecture,
  // not like a garden: every wall implies a building, every column belongs to
  // a structure, every statue guards something, every street leads somewhere.
  // The player should read FOOTPRINTS — "a house stood here", "this was the
  // square", "a street ran through" — not scattered decoration.
  //
  // It is built in layers (see the three _acg* stages): ARCHITECTURE first
  // (walls/columns/streets/shrine/pond — must read as a village with all
  // vegetation stripped), then TREES reclaiming it, then FLOWERS/ROCKS/
  // CRYSTALS as detail. Axis is NORTH-SOUTH, entered from the south: the tree
  // is a 200-tall bottom-anchored sprite only seen from the front, so the
  // square, street and gate all run south of it. Canopy rule: nothing meant
  // to be SEEN sits in x +/-88 north of the tree base (y<0).
  //
  // Layout (offsets from the tree base X,Y; +y is SOUTH):
  //        NW residence            NE scholar's house
  //                 \\   HEART TREE   /
  //                     village square
  //   pond house --- main street --- shrine courtyard
  //            SW ruin    market/gathering
  //                     ancient gate
  //                     (road to town)
  _buildEldertreeGrove() {
    const ET = this.districts.eldertree;
    const put = (name, x, y, opts = {}) => {
      const [w, h] = DECOR_SIZE[name];
      this.decor.push({ name, x, y, w, h, flip: !!opts.flip,
                        sortY: opts.sortY != null ? opts.sortY : y,
                        shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
      if (opts.solid) {
        const [sw, sh] = opts.solid;
        this.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
      }
    };
    const flat = (name, x, y, flip = false) => {
      const [w, h] = DECOR_SIZE[name];
      this.groundDecor.push({ name, x, y, w, h, flip });
    };
    const glow = (x, y, hue, r) => this.crystalGlows.push([x, y, hue, r]);
    const X = ET.x, Y = ET.y;
    // Full compact-city build re-enabled (2026-08-22) — all four stages.
    this._acgArchitecture(put, flat, X, Y);
    this._acgTrees(put, flat, X, Y);
    this._acgUnderstory(put, flat, X, Y);
    this._acgDetail(put, flat, glow, X, Y);
  }

  // ===== PASS 1: ARCHITECTURE — reference-matched compact city ===========
  // Rectangular WALLED building footprints (horizontal + rotated vertical wall
  // pieces) packed tight around the Heart Tree, arches straddling the streets,
  // north & south gates, pool and shrine in walled courtyards, outer wall
  // fragments. Layout stored on this._acgL for the vegetation stages.
  _acgArchitecture(put, flat, X, Y) {
    const colSolid = [8, 6];
    const WH = ['myst_wall_long', 'myst_wall_gap', 'myst_wall_vine', 'myst_wall_steps'];             // E-W walls
    const WV = ['myst_wall_long_ns', 'myst_wall_gap_ns', 'myst_wall_vine_ns', 'myst_wall_steps_ns']; // N-S walls
    const COLV = ['myst_col_a', 'myst_col_b', 'myst_col_tall', 'myst_col_cracked', 'myst_col_broken'];
    const RUB = ['myst_rubble_a', 'myst_rubble_b', 'myst_rubble_c', 'myst_stone_one', 'myst_stone_pair'];
    const floor = (cx, cy, cols, rows, skip = 0.25) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (hash(cx * 3.1 + cy * 1.7 + r * 7.3 + c * 13.1) < skip) continue;
        flat('myst_path_straight_ew', Math.round(cx + (c - (cols - 1) / 2) * 32), Math.round(cy + (r - (rows - 1) / 2) * 15));
      }
    };
    const rubbleAt = (cx, cy, n = 3, rad = 18, seed = 1) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.3) * 6.283, d = Math.sqrt(hash(seed + i * 2.6)) * rad;
        put(RUB[Math.floor(hash(seed + i * 3.9) * RUB.length) % RUB.length], Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6), { shadow: 0 });
      }
    };
    // E-W wall run (centres from x0..x1 at cy), with an optional doorway gap and ~16% collapse.
    const wallRunH = (x0, x1, cy, gapC, gapW, seed) => {
      for (let cx = x0, i = 0; cx <= x1 + 1; cx += 34, i++) {
        if (gapW && Math.abs(cx - gapC) < gapW / 2) continue;
        if (hash(seed + i * 3.1) < 0.16) continue;
        put(WH[(i + seed) % WH.length], Math.round(cx), Math.round(cy), { solid: [30, 6] });
      }
    };
    // N-S wall run (centres from y0..y1 at cx); vertical pieces are 40 tall, bottom-anchored (+20).
    const wallRunV = (cx, y0, y1, gapC, gapH, seed) => {
      for (let cy = y0, i = 0; cy <= y1 + 1; cy += 34, i++) {
        if (gapH && Math.abs(cy - gapC) < gapH / 2) continue;
        if (hash(seed + i * 3.7) < 0.16) continue;
        put(WV[(i + seed) % WV.length], Math.round(cx), Math.round(cy + 20), { solid: [12, 32] });
      }
    };
    // A rectangular ruined building: floor + four walled edges with a doorway
    // on the street side + corner columns + rubble. face = doorway direction.
    const building = (a) => {
      const { x, y, w, h } = a, face = a.face || 'S', seed = (x * 0.7 + y) | 0;
      const hw = Math.round(w / 2), hh = Math.round(h / 2);
      floor(x, y, Math.max(2, Math.round(w / 30)), Math.max(2, Math.round(h / 28)), a.floorSkip != null ? a.floorSkip : 0.28);
      if (!a.omitN) wallRunH(x - hw, x + hw, y - hh, face === 'N' ? x : 0, face === 'N' ? 26 : 0, seed + 1);
      if (!a.omitS) wallRunH(x - hw, x + hw, y + hh, face === 'S' ? x : 0, face === 'S' ? 26 : 0, seed + 2);
      if (!a.omitW) wallRunV(x - hw, y - hh, y + hh, face === 'W' ? y : 0, face === 'W' ? 32 : 0, seed + 3);
      if (!a.omitE) wallRunV(x + hw, y - hh, y + hh, face === 'E' ? y : 0, face === 'E' ? 32 : 0, seed + 4);
      for (const [cxx, cyy] of [[x - hw, y - hh], [x + hw, y - hh], [x - hw, y + hh], [x + hw, y + hh]])
        if (hash(cxx * 1.1 + cyy) < 0.72) put(COLV[Math.abs((cxx + cyy) | 0) % COLV.length], Math.round(cxx), Math.round(cyy + 4), { solid: colSolid });
      rubbleAt(x, y, 3, Math.min(w, h) * 0.32, seed + 9);
      if (a.stat) put(a.stat, x, y - 2, { solid: colSolid });
    };
    // An arch straddling a passage (feet solid, centre opening walkable).
    const archway = (name, ax, ay) => {
      put(name, ax, ay, { shadow: 0 });
      this.solids.push({ x: ax - 16, y: ay - 10, w: 8, h: 10 }, { x: ax + 8, y: ay - 10, w: 8, h: 10 });
    };
    const streetNS = (cx, y0, y1, lanes, skip = 0.2) => {
      for (let y = y0, i = 0; y <= y1; y += 30, i++) { if (hash(cx * 1.9 + y + i * 4.7) < skip) continue;
        for (let L = 0; L < lanes; L++) flat('myst_path_straight', Math.round(cx + (L - (lanes - 1) / 2) * 17), Math.round(y)); } };
    const streetEW = (x0, x1, cy, skip = 0.22) => {
      for (let x = x0, i = 0; x <= x1; x += 34, i++) { if (hash(x + cy * 2.3 + i * 5.1) < skip) continue;
        flat('myst_path_straight_ew', Math.round(x), Math.round(cy)); } };

    // ---------- STREETS ----------------------------------------------------

    // ---------- BUILDING BLOCKS (rectangular walled footprints) -----------
    const B = [
      { x: X - 175, y: Y - 155, w: 112, h: 86, face: 'S', d: 'north', stat: 'myst_statue_glow' },
      { x: X + 175, y: Y - 155, w: 112, h: 86, face: 'S', d: 'north' },
      { x: X, y: Y - 250, w: 104, h: 64, face: 'S', d: 'north' },
      { x: X - 252, y: Y - 52, w: 92, h: 74, face: 'E', d: 'west' },
      { x: X - 150, y: Y - 60, w: 78, h: 62, face: 'S', d: 'west' },
      { x: X - 256, y: Y + 122, w: 92, h: 74, face: 'E', d: 'west' },
      { x: X + 252, y: Y - 52, w: 92, h: 74, face: 'W', d: 'east' },
      { x: X + 150, y: Y - 60, w: 78, h: 62, face: 'S', d: 'east' },
      { x: X - 112, y: Y + 150, w: 80, h: 58, face: 'S', d: 'south' },
      { x: X + 112, y: Y + 150, w: 80, h: 58, face: 'S', d: 'south' },
      { x: X - 122, y: Y + 250, w: 78, h: 58, face: 'N', d: 'south' },
      { x: X + 122, y: Y + 250, w: 78, h: 58, face: 'N', d: 'south' },
      { x: X - 82, y: Y + 312, w: 70, h: 54, face: 'N', d: 'south', floorSkip: 0.4 },
      { x: X + 82, y: Y + 312, w: 70, h: 54, face: 'N', d: 'south', floorSkip: 0.4 },
    ];
    for (const a of B) building(a);

    // ---------- POOL COURTYARD (SW) — walled civic garden around the pool ---
    const pcx = X - 250, pcy = Y + 218;
    building({ x: pcx, y: pcy, w: 116, h: 84, face: 'N', floorSkip: 0.55, omitN: true });  // 3-sided court, open north
    put('myst_pond', pcx, pcy + 6, { shadow: 0, solid: [88, 26] });
    put('myst_bench_a', pcx, pcy + 34, { flip: true });
    put('myst_statue_crystal', pcx - 40, pcy - 18, { solid: colSolid });
    archway('myst_arch_narrow', pcx, pcy - 44);

    // ---------- SHRINE COURTYARD (E) — rectangular temple court ------------
    const scx = X + 252, scy = Y + 140;
    building({ x: scx, y: scy, w: 128, h: 100, face: 'W', floorSkip: 0.42, omitW: true });
    put('myst_gazebo', scx, scy, { solid: [30, 12] });
    put('myst_shrine_niche', scx + 34, scy - 26, { solid: [10, 6] });
    put('myst_ped_crystal_lit', scx, scy - 22, { solid: [10, 7] });
    put('myst_statue_maiden', scx - 40, scy + 30, { solid: colSolid });
    put('myst_statue_knight', scx + 44, scy + 30, { solid: colSolid, flip: true });
    put('myst_bench_b', scx, scy + 40);
    archway('myst_arch_b', scx - 70, scy);   // west entrance to the court

    // ---------- HEART-TREE PROCESSIONAL (south of the square) --------------
    put('myst_statue_maiden', X - 44, Y + 92, { solid: colSolid });
    put('myst_statue_crystal', X + 44, Y + 96, { solid: colSolid });
    put('myst_col_tall', X - 26, Y + 122, { solid: colSolid });
    put('myst_col_broken', X + 26, Y + 126, { solid: colSolid });

    // scholar relic in a north compound
    put('myst_ped_book', X - 175, Y - 150, { solid: [10, 7] });
    put('myst_ped_leaf', X - 150, Y - 146, { solid: [10, 7] });

    // ---------- ARCHES ON THE STREETS (gates + district entrances) ---------
    // NORTH GATE
    archway('myst_arch_vine', X, Y - 250);
    put('myst_col_tall', X - 40, Y - 250, { solid: colSolid }); put('myst_col_tall', X + 40, Y - 250, { solid: colSolid });
    put('myst_statue_knight', X - 60, Y - 244, { solid: colSolid }); put('myst_statue_maiden', X + 60, Y - 244, { solid: colSolid });
    // SOUTH GATE (more destroyed)
    archway('myst_arch_ruin', X, Y + 350);
    put('myst_col_broken', X - 34, Y + 350, { solid: colSolid }); put('myst_col_lean', X + 36, Y + 352, { solid: colSolid });
    put('myst_statue_knight', X - 58, Y + 356, { solid: colSolid }); put('myst_statue_maiden', X + 58, Y + 356, { solid: colSolid });
    rubbleAt(X - 64, Y + 338, 4, 24, 41); rubbleAt(X + 66, Y + 340, 4, 24, 47);
    // cross-street district gates + main-street mid arches
    archway('myst_arch_a', X - 118, Y + 40);     // west residential gate
    archway('myst_arch_narrow', X + 118, Y + 40); // east temple gate
    archway('myst_arch_a', X, Y + 116);          // square -> market
    archway('myst_arch_b', X, Y + 288);          // market -> south gate

    // ---------- OUTER CITY-WALL FRAGMENTS (partial, big gaps) -------------
    wallRunH(X - 360, X - 250, Y - 210, 0, 0, 3);   // NW
    wallRunH(X + 250, X + 360, Y - 210, 0, 0, 9);   // NE
    wallRunV(X - 366, Y + 20, Y + 150, 0, 0, 15);   // W
    wallRunV(X + 366, Y + 20, Y + 150, 0, 0, 19);   // E
    wallRunH(X - 320, X - 210, Y + 330, 0, 0, 23);  // SW
    wallRunH(X + 210, X + 320, Y + 320, 0, 0, 27);  // SE

    this._acgL = {
      houses: B.concat([{ x: pcx, y: pcy, d: 'west' }, { x: scx, y: scy, d: 'temple' }]),
      market: { x: X, y: Y + 190, w: 150, h: 80 }, temple: { x: scx, y: scy, w: 128, h: 100 },
      gate: { x: X, y: Y + 350 }, crossY: Y + 40, mainX: X, pool: { x: pcx, y: pcy },
    };
  }

  // ===== PASS 2: TREES — forest framing + reclaiming the blocks =========
  // The perimeter forest rings the city OUTSIDE its wall-line; inside, trees
  // grow through selected footprints and in the gaps between blocks, reclaiming
  // the architecture without hiding the streets. Ordinary oaks make the forest;
  // crystal-rooted mystic trees mark the magical zones.
  _acgTrees(put, flat, X, Y) {
    const treeSolid = [12, 8];
    const OAK = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted', 'tree_flowerbed'];
    const MED = ['tree_blossom_white', 'tree_blossom_blue', 'tree_young', 'tree_small_pine'];
    const SMALL = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const MYST = ['myst_tree_round', 'myst_tree_roots'];
    const mass = (cx, cy, n, rad, pool, seed, debris = true) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.7) * 6.283, d = Math.sqrt(hash(seed + i * 2.3 + 0.5)) * rad;
        const name = pool[Math.floor(hash(seed + i * 3.1 + 0.2) * pool.length) % pool.length];
        put(name, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.66), { shadow: 0, solid: treeSolid });
      }
      if (debris) {
        put(hash(seed + 9.1) < 0.5 ? 'tree_stump_01' : 'tree_stump_02', Math.round(cx + (hash(seed + 5.5) - 0.5) * rad), Math.round(cy + rad * 0.4));
        put(hash(seed + 7.3) < 0.5 ? 'fallen_log_01' : 'log_long', Math.round(cx - (hash(seed + 6.1) - 0.5) * rad), Math.round(cy + rad * 0.5), { shadow: 0 });
      }
    };
    // ---- perimeter forest ringing the city (outside the wall fragments),
    // with the southern gate funnel left open and gaps off the Heart Tree crown.
    for (const [cx, cy, n, r, sd] of [
      [X - 150, Y - 360, 6, 66, 11], [X + 180, Y - 356, 6, 66, 21],   // north, behind the crown
      [X - 500, Y - 150, 6, 64, 33], [X - 520, Y + 90, 6, 66, 45],    // west
      [X - 440, Y + 340, 6, 64, 52],                                  // SW
      [X + 520, Y + 60, 6, 64, 64], [X + 470, Y - 150, 5, 60, 71],    // east
      [X + 452, Y + 320, 6, 64, 83],                                  // SE
      [X - 250, Y + 440, 5, 58, 91], [X + 260, Y + 440, 5, 58, 97],   // gate funnel
    ]) mass(cx, cy, n, r, OAK, sd);

    // ---- reclaim the blocks: a tree through ~half the footprints, and one in
    // the gap beside each, keyed to the stored layout so it lands on real ruins.
    const H = (this._acgL && this._acgL.houses) || [];
    H.forEach((a, i) => {
      const pool = a.d === 'north' || a.d === 'temple' ? MYST : (a.big ? MED : SMALL);
      if (i % 2 === 0) {  // grows THROUGH the building
        put(pool[i % pool.length], Math.round(a.x - a.w * 0.18), Math.round(a.y - a.h * 0.1),
            { shadow: 0, solid: a.big ? treeSolid : [8, 6] });
      }
      if (i % 3 === 0) {  // in the gap beside the block
        put(SMALL[i % SMALL.length], Math.round(a.x + a.w * 0.62), Math.round(a.y + a.h * 0.3), { shadow: 0, solid: [8, 6] });
      }
    });

    // ---- NE-outer crystal grove (subordinate to the Heart Tree) ----
    mass(X + 300, Y - 66, 4, 42, MYST, 151, false);
    put('tree_blossom_blue', X + 262, Y - 46, { shadow: 0, solid: [8, 6] });
    put('tree_blossom_violet', X + 336, Y - 44, { shadow: 0, solid: [8, 6] });

    // ---- southern outskirts thinning into ordinary land toward the road ----
    put('tree_oak_round', X - 150, Y + 500, { shadow: 0, solid: treeSolid });
    put('tree_young', X + 130, Y + 510, { shadow: 0, solid: [8, 6] });
    put('tree_small_pine', X - 30, Y + 520, { shadow: 0, solid: [8, 6] });
  }

  // ===== PASS 2b: UNDERSTORY — bushes, grass, ferns; reveal the streets ==
  // Fills the forest floor and the gaps BETWEEN buildings, and washes the lawn
  // into meadow — but the street network and squares are protected so the city
  // stays readable. Everything here is walk-through (no collision).
  _acgUnderstory(put, flat, X, Y) {
    const BUSH = ['bush_big', 'bush_low', 'bush_01', 'bush_02', 'bush_03', 'myst_bush_meadow', 'myst_bush_white'];
    const GRASS = ['grass_lg_01','grass_lg_02','grass_lg_03','grass_lg_04','grass_lg_05','grass_lg_06','grass_lg_07','grass_lg_08','grass_lg_09'];
    const DARK = ['grass_dark_01','grass_dark_02','grass_dark_03','grass_dark_04','grass_dark_05','grass_dark_06'];
    const FERN = ['fern_clump','fernbank_01','fernbank_02','fernbank_03'];
    const scatter = (cx, cy, count, rad, pools, seed) => {
      for (let i = 0; i < count; i++) {
        const a = hash(seed + i * 1.9) * 6.283, d = Math.sqrt(hash(seed + i * 2.7 + 0.3)) * rad;
        const pool = pools[Math.floor(hash(seed + i * 3.3 + 0.1) * pools.length) % pools.length];
        put(pool[Math.floor(hash(seed + i * 4.1 + 0.6) * pool.length) % pool.length],
            Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6));
      }
    };
    // understory beneath the perimeter forest (same centres as the trees)
    for (const [cx, cy, sd] of [
      [X - 150, Y - 360, 201], [X + 180, Y - 356, 214], [X - 500, Y - 150, 233],
      [X - 520, Y + 90, 246], [X - 440, Y + 340, 252], [X + 520, Y + 60, 268],
      [X + 470, Y - 150, 271], [X + 452, Y + 320, 283], [X - 250, Y + 440, 291], [X + 260, Y + 440, 296],
    ]) scatter(cx, cy, 12, 70, [BUSH, GRASS, FERN], sd);

    // between-building overgrowth: a clump at each footprint's edge (alley side)
    const H = (this._acgL && this._acgL.houses) || [];
    H.forEach((a, i) => scatter(Math.round(a.x + a.w * 0.55), Math.round(a.y + a.h * 0.15), 6, 34, [BUSH, GRASS, GRASS], 320 + i * 9));

    // crystal-altered blue grass in the magical zones
    scatter(X - 96, Y + 24, 5, 46, [DARK], 401); scatter(X + 96, Y + 28, 5, 46, [DARK], 407);
    scatter(X + 256, Y + 94, 6, 52, [DARK, GRASS], 413);      // temple
    scatter(X + 300, Y - 66, 10, 70, [DARK, DARK, GRASS], 419); // crystal grove
    scatter(X - 240, Y + 156, 4, 40, [DARK, GRASS], 427);     // pond

    // ---- MEADOW WASH (§22/§26): overgrown-meadow the remaining lawn, but
    // PROTECT the streets/squares so the urban geometry stays legible.
    const L = this._acgL || {};
    const inRect = (x, y, r, pad) => r && x > r.x - r.w / 2 - pad && x < r.x + r.w / 2 + pad && y > r.y - r.h / 2 - pad && y < r.y + r.h / 2 + pad;
    const clearing = (x, y) => (
      (Math.abs(x - X) < 32 && y > Y - 320 && y < Y + 360) ||   // main avenue
      (Math.abs(y - (Y + 74)) < 22 && x > X - 210 && x < X + 200) || // cross street
      (Math.hypot(x - X, y - (Y + 30)) < 70) ||                 // civic square
      inRect(x, y, L.market, 8) || inRect(x, y, L.temple, 6)    // market + temple court
    );
    const SMALL = ['grass_tiny_01','grass_tiny_02','grass_tiny_03','grass_tiny_04','grass_tiny_05','grass_tiny_06',
                   'grass_sm_01','grass_sm_02','grass_sm_03','grass_sm_04','grass_sm_05','grass_sm_06',
                   'grass_lean_01','grass_lean_02','grass_lean_03','grass_lean_04'];
    const STRIP = ['grass_strip_01','grass_strip_02','grass_strip_03','grass_strip_04','grass_strip_05','grass_strip_06'];
    for (let gy = Y - 300; gy <= Y + 420; gy += 40) {
      for (let gx = X - 420; gx <= X + 420; gx += 42) {
        if (hash(gx * 1.7 + gy * 2.3) > 0.7) continue;
        const jx = Math.round(gx + (hash(gx * 3.1 + gy) - 0.5) * 34);
        const jy = Math.round(gy + (hash(gx + gy * 3.7) - 0.5) * 30);
        if (clearing(jx, jy)) continue;
        put(SMALL[Math.floor(hash(gx * 5.3 + gy * 7.1) * SMALL.length) % SMALL.length], jx, jy);
      }
    }
    // low grass creeping in along the street/paving edges (§22 deterioration)
    for (const [cx, cy, sd] of [
      [X - 34, Y + 150, 701], [X + 34, Y + 210, 707], [X - 34, Y + 264, 713],
      [X - 210, Y + 74, 719], [X + 190, Y + 82, 725], [X + 34, Y - 200, 731],
    ]) scatter(cx, cy, 3, 22, [STRIP], sd);
  }

  // ===== PASS 3: FLOWERS, CRYSTALS, ROCKS, RUBBLE (compact anchors) =====
  _acgDetail(put, flat, glow, X, Y) {
    const bloom = (cx, cy, n, rad, seed) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 2.1) * 6.283, d = Math.sqrt(hash(seed + i * 2.9 + 0.4)) * rad;
        flat('myst_flower_spray', Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6), hash(seed + i * 4.3) < 0.5);
      }
    };
    const ROCK = ['myst_rock_a','myst_rock_b','myst_rock_c','myst_rock_d','myst_rock_e','rock_small_01','rock_med_01'];
    const rocks = (cx, cy, n, rad, seed) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.6) * 6.283, d = Math.sqrt(hash(seed + i * 2.2)) * rad;
        put(ROCK[Math.floor(hash(seed + i * 3.4) * ROCK.length) % ROCK.length], Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6));
      }
    };
    // crystal night trail: tree -> temple -> grove -> pond -> gate
    glow(X - 88, Y + 20, 'v', 13); put('myst_crystals_purple', X - 88, Y + 32, { solid: [12, 8] });
    glow(X + 88, Y + 26, 'c', 13); put('myst_crystals_cyan', X + 88, Y + 38, { solid: [12, 8] });
    put('myst_crystals_mini', X - 110, Y + 8); put('myst_crystal_spike', X + 112, Y + 12);
    glow(X + 256, Y + 78, 'c', 9);
    glow(X + 216, Y + 116, 'v', 11); put('myst_crystals_purple', X + 216, Y + 128, { solid: [12, 8] });
    glow(X + 298, Y + 120, 'c', 11); put('myst_crystals_cyan', X + 298, Y + 132, { solid: [12, 8] });
    glow(X + 300, Y - 56, 'c', 10); put('myst_crystals_purple', X + 274, Y - 48, { solid: [12, 8] });
    put('myst_crystals_cyan', X + 328, Y - 44, { solid: [12, 8] }); put('myst_crystals_mini', X + 302, Y - 32);
    glow(X - 240, Y + 138, 'c', 9); put('myst_crystals_cyan', X - 240, Y + 150, { solid: [12, 8] });
    glow(X + 4, Y + 322, 'v', 8); put('myst_crystals_mini', X + 4, Y + 328);

    // large flower masses at the districts (off the streets)
    bloom(X - 84, Y + 34, 7, 30, 801); bloom(X + 84, Y + 40, 7, 30, 809);   // heart ring
    bloom(X + 256, Y + 92, 9, 44, 817); bloom(X + 216, Y + 126, 6, 26, 823); // temple
    bloom(X - 240, Y + 138, 8, 42, 831);                                     // pond court
    bloom(X + 300, Y - 50, 10, 48, 843);                                     // crystal grove
    bloom(X - 70, Y - 224, 5, 32, 851); bloom(X + 44, Y - 234, 5, 32, 857);  // north district
    bloom(X - 70, Y + 150, 3, 20, 863); bloom(X + 70, Y + 150, 3, 20, 869);  // market shopfronts
    bloom(X - 150, Y + 120, 4, 22, 875);                                     // west residences

    // rock clusters supporting reclaiming trees / ruins
    rocks(X - 240, Y + 160, 3, 20, 901); rocks(X + 44, Y - 246, 3, 18, 907);
    rocks(X - 120, Y + 24, 3, 16, 913); rocks(X + 256, Y + 94, 3, 18, 919);
    rocks(X - 70, Y - 236, 3, 18, 925); rocks(X + 300, Y - 50, 3, 20, 931);

    // overgrown bases on statues / columns / guardians (one side)
    for (const [bx, by, sd] of [
      [X - 44, Y + 96, 981], [X + 44, Y + 102, 985],     // processional
      [X - 38, Y + 308, 989], [X + 40, Y + 308, 993],    // gate guardians
      [X - 38, Y + 122, 997], [X + 42, Y + 124, 1001],   // temple statues
      [X + 40, Y - 202, 1005],                           // scholar monument
    ]) { bloom(bx - 10, by + 6, 3, 12, sd); put('bush_low', bx + 10, by + 6); }

    // daytime butterflies over the bloomiest sites
    for (const [bx, by, col, rx, ry, sp, ph] of [
      [X - 240, Y + 150, 'blue', 26, 13, 0.92, 0.0],
      [X - 76, Y + 34, 'blue', 24, 12, 0.88, 1.1],
      [X + 76, Y + 40, 'violet', 22, 11, 1.00, 3.3],
      [X + 256, Y + 92, 'white', 22, 11, 1.05, 2.2],
      [X + 300, Y - 50, 'white', 24, 12, 0.95, 4.6],
      [X + 44, Y - 234, 'blue', 22, 11, 0.83, 5.2],
    ]) this.butterflies.push({ x: bx, y: by, col, rx, ry, speed: sp, phase: ph });
  }

  // ---- Crystal Plaza landscaping ------------------------------------------
  // The square is read outward from the fountain in three zones, and the whole
  // design is that transition:
  //
  //   A  INNER STONE      swept paving, the fountain alone in it
  //   B  FORMAL RING      containers, benches, lamps, bedding — all placed
  //   C  NATURAL OUTER    clustered shrub, graded canopy, rock, rough grass
  //
  // Symmetry is spent only on the architecture: the four containers, the two
  // pairs of seating, the lamp pair. Everything alive breaks it on purpose —
  // matched planting on both diagonals would read as wallpaper, and the eye
  // stops believing a place the moment it notices the pattern.
  //
  // Every road exit stays a clear corridor. The square is the centre of a giant
  // plus sign and that plus has to stay readable from a standing start, so
  // nothing built or planted goes inside one.
  // ---- the lake region ----------------------------------------------------
  //
  // The lake was a pond sitting in an enormous empty field. This pass turns the
  // ground around it into a place: not by scattering props evenly over the
  // grass — that reads as confetti at any zoom — but by building a few LARGE
  // MASSES with deliberate open ground between them. At the wide camera the
  // silhouettes of those masses are what the eye reads; the individual rock is
  // invisible. So groves are dense and few, and the meadow between them is left
  // genuinely empty.
  //
  // Appended to the plaza pass's lists rather than replacing them, and every
  // placement is guarded against the roads and districts, so nothing here can
  // reach into the town's own composition.
  // The lake's small props: three deciduous trees on the shore and mushrooms
  // scattered over the surrounding ground. The wider decoration passes are
  // switched off above; this is deliberately everything the region has.
  //
  // All three are DECIDUOUS_TREE_01, cut from the labelled natural-vegetation
  // sheet; the sizes vary rather than the sprite.
  //
  // Positions come from the pond's own collision rather than from the eye. The
  // north bank pushes furthest into the water at x=1162 — the corner where the
  // lake's two lobes meet — and that one is drawn largest, as asked. The other
  // two sit just off the west and east water edges (x=939 and x=1660).
  _buildLakeDetail() {
    const NAME = 'deciduous_tree_01';
    const [bw, bh] = DECOR_SIZE[NAME];
    // [x, y, scale, flip]
    const SPOTS = [
      // On the tongue of grass that comes down into the water just right of the
      // lake's centre (centre is x=1300), and set back up it rather than at the
      // waterline — the bank there plateaus at +119 from x=1306 to 1378, so
      // standing at y=2213 leaves a clear margin of grass in front of it.
      [1338, 2213, 1.35, false],   // the big one, set back off the water
      [916, 2298, 1.00, false],    // west side
      [1686, 2350, 0.88, true],    // east side
    ];
    for (const [x, y, k, flip] of SPOTS) {
      const w = Math.round(bw * k), h = Math.round(bh * k);
      this.decor.push({ name: NAME, x, y, w, h, flip, sortY: y,
                        shadow: Math.round(w * 0.26) });
    }

    // ---- a mix of pine and deciduous over the wider ground -----------------
    //
    // Gathered near the lake and thinning outward, so the water sits in a wood
    // that opens into meadow rather than in a field with trees dotted over it.
    // The shoreline itself is still left clear — nothing is planted within
    // TREE_KEEP of the water, because planting against the bank is what built
    // the ring of decoration that had to be torn out before. The gradient is
    // carried by the SPACING, as with the mushrooms: biasing where candidates
    // are drawn does nothing on its own, since a single minimum gap flattens
    // the result back out.
    const L = this.lakeTopLeft;
    const water = POND_WATER_RECTS.map(([fx, fy, fw, fh]) => ({
      x: L.x + fx * POND_W, y: L.y + fy * POND_H, w: fw * POND_W, h: fh * POND_H,
    }));
    // `_nearAnyRoad` tests the coarse road RECTS, and those do not agree with
    // the surface that actually gets painted — nine trees were standing on
    // stone with six of them anchored right on it. `roadCov` is the paint
    // itself, cell by cell, so that is what a footprint has to be cleared
    // against. Tested across the prop's width, not just its anchor, because a
    // wide canopy reaches the road long before its trunk does.
    const onRoadPaint = (x, y, halfW, up) => {
      const C = ROAD_CELL;
      for (let dx = -halfW; dx <= halfW; dx += C) {
        for (let dy = -up; dy <= C; dy += C) {
          if (this.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
        }
      }
      return false;
    };
    const distToWater = (x, y) => {
      let best = Infinity;
      for (const r of water) {
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        const d = Math.hypot(dx, dy);
        if (d < best) best = d;
      }
      return best;
    };
    // Species and variant are both taken from COUNTERS, not from a random draw.
    // Drawing species at 38% pine gave 18% on the ground: the draw itself is
    // uniform (checked), but which candidates survive the spacing test is not
    // independent of it, so the ratio drifts. A repeating pattern fixes the
    // split exactly, and cycling the variant lists means all four pines and all
    // six broadleaves get used evenly rather than the same two recurring.
    const PINES = ['pine_tree_01', 'pine_tree_02', 'pine_tree_03', 'pine_tree_04'];
    const BROAD = ['deciduous_tree_01', 'deciduous_tree_02', 'deciduous_tree_03',
                   'deciduous_tree_04', 'deciduous_tree_05', 'deciduous_tree_06'];
    const MIX = [1, 0, 1, 0, 0];        // 2 pine : 3 broadleaf = 40 / 60
    let placedN = 0, pineN = 0, broadN = 0;
    const nextTree = () => {
      const pine = MIX[placedN % MIX.length] === 1;
      placedN++;
      return pine ? PINES[pineN++ % PINES.length] : BROAD[broadN++ % BROAD.length];
    };
    const TREE_KEEP = 58;        // clear ground between the water and the wood
    const trunks = [];           // where each tree landed, for the base planting
    const stand = [];
    for (let n = 0; n < 1800 && stand.length < 165; n++) {
      const a = hash(8000 + n * 3.9) * Math.PI * 2;
      const rr = hash(8100 + n * 6.7);
      const out = 90 + rr * rr * 390;                // squared: favours the lakeside
      const x = Math.round(L.x + POND_W / 2 + Math.cos(a) * (POND_W * 0.5 + out - 40));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(a) * (POND_H * 0.5 + out - 40));
      const d = distToWater(x, y);
      if (d < TREE_KEEP || d > 470) continue;         // never against the water
      if (this._nearAnyRoad(x, y, 34) || this._nearAnyDistrict(x, y, 60)) continue;
      if (onRoadPaint(x, y, 54, 16)) continue;
      const gap = 40 + Math.max(0, d - TREE_KEEP) * 0.30;  // opens up with distance
      if (stand.some((t) => Math.hypot(t.x - x, t.y - y) < gap)) continue;
      const name = nextTree();
      const [w, h] = DECOR_SIZE[name];
      const k = 0.85 + hash(8400 + n * 2.7) * 0.4;
      const tw = Math.round(w * k), th = Math.round(h * k);
      this.decor.push({ name, x, y, w: tw, h: th, flip: hash(8500 + n) > 0.5,
                        sortY: y, shadow: Math.round(tw * 0.26) });
      stand.push({ x, y });
      trunks.push({ x, y, w: tw });
      // a companion beside about a third of them, so they read as stands
      if (hash(8600 + n * 4.3) > 0.42) {
        const ca = hash(8700 + n * 3.3) * Math.PI * 2;
        const cr = 34 + hash(8800 + n * 5.7) * 26;
        const cx2 = Math.round(x + Math.cos(ca) * cr), cy2 = Math.round(y + Math.sin(ca) * cr * 0.7);
        if (distToWater(cx2, cy2) > TREE_KEEP && !this._nearAnyRoad(cx2, cy2, 30)
            && !this._nearAnyDistrict(cx2, cy2, 60) && !onRoadPaint(cx2, cy2, 46, 14)) {
          const n2 = nextTree();
          const [w2, h2] = DECOR_SIZE[n2];
          const k2 = 0.7 + hash(9000 + n * 6.1) * 0.3;
          this.decor.push({ name: n2, x: cx2, y: cy2, w: Math.round(w2 * k2), h: Math.round(h2 * k2),
                            flip: hash(9100 + n) > 0.5, sortY: cy2,
                            shadow: Math.round(w2 * k2 * 0.26) });
          stand.push({ x: cx2, y: cy2 });
          trunks.push({ x: cx2, y: cy2, w: Math.round(w2 * k2) });
        }
      }
    }

    // ---- understory: bushes, tall grass and weeds --------------------------
    //
    // Same gradient as the mushrooms and the trees: gathered near the water and
    // thinning outward, carried by the SPACING rather than by where candidates
    // are drawn. Unlike the trees these are allowed right up to the bank, since
    // low planting reads as ground cover rather than as an outline round the
    // lake — but they still stop short of the water itself.
    const BUSHES = ['nv_bush_01', 'nv_bush_02', 'nv_bush_03', 'nv_bush_04'];
    const TALLG = ['nv_tallgrass_01', 'nv_tallgrass_02', 'nv_tallgrass_04',
                   'nv_tallgrass_05', 'nv_tallgrass_06', 'nv_tallgrass_07'];
    const WEEDY = ['nv_weeds_01', 'nv_weeds_02', 'nv_weeds_03', 'nv_weeds_04'];
    // one bush to roughly two grass to one weed, by counter so the mix holds
    const UNDER_MIX = [0, 1, 1, 2];
    let uN = 0, bI = 0, gI = 0, wI = 0;
    const nextUnder = () => {
      const k = UNDER_MIX[uN % UNDER_MIX.length]; uN++;
      return k === 0 ? BUSHES[bI++ % BUSHES.length]
           : k === 1 ? TALLG[gI++ % TALLG.length]
                     : WEEDY[wI++ % WEEDY.length];
    };
    // Planting tucked against the trunks. The sheet paints a ground shadow under
    // every tree, and cutting it away leaves the foot of the trunk looking bare
    // and slightly cut-off; a tuft or two at the base reads as the tree growing
    // out of the ground rather than being stood on it.
    const BASEPLANT = ['nv_tallgrass_01', 'nv_tallgrass_02', 'nv_tallgrass_04',
                       'nv_tallgrass_05', 'nv_weeds_01', 'nv_weeds_03', 'nv_bush_01'];
    trunks.forEach((t, i) => {
      if (hash(11500 + i * 3.7) < 0.35) return;         // not every tree
      const n = 1 + Math.floor(hash(11600 + i * 5.1) * 2);
      for (let k = 0; k < n; k++) {
        const side = hash(11700 + i * 7.3 + k * 4.9) > 0.5 ? 1 : -1;
        const off = (t.w * 0.16 + hash(11800 + i * 2.9 + k * 6.1) * t.w * 0.3) * side;
        const bx = Math.round(t.x + off);
        const by = Math.round(t.y + (hash(11900 + i * 4.3 + k) - 0.35) * 6);
        if (onRoadPaint(bx, by, 20, 8) || distToWater(bx, by) < 10) continue;
        const nm = BASEPLANT[Math.floor(hash(12000 + i * 8.1 + k * 3.3) * BASEPLANT.length) % BASEPLANT.length];
        const [bw, bh] = DECOR_SIZE[nm];
        const bk = 0.65 + hash(12100 + i * 5.7 + k) * 0.35;
        this.decor.push({ name: nm, x: bx, y: by, w: Math.round(bw * bk), h: Math.round(bh * bk),
                          flip: side < 0, sortY: by + 1, shadow: 0 });
      }
    });

    const under = [];
    for (let n = 0; n < 3200 && under.length < 460; n++) {
      const ang = hash(9500 + n * 3.3) * Math.PI * 2;
      const rr = hash(9600 + n * 5.1);
      const out = 12 + rr * rr * 400;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(ang) * (POND_W * 0.5 + out - 30));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(ang) * (POND_H * 0.5 + out - 30));
      const d = distToWater(x, y);
      if (d < 10 || d > 440) continue;
      if (this._nearAnyRoad(x, y, 22) || this._nearAnyDistrict(x, y, 48)) continue;
      if (onRoadPaint(x, y, 38, 12)) continue;   // widest bush scales to ~75 across
      const gap = 15 + d * 0.17;                 // tight at the bank, open far out
      if (under.some((u) => Math.hypot(u.x - x, u.y - y) < gap)) continue;
      const name = nextUnder();
      const [w, h] = DECOR_SIZE[name];
      const k = 0.8 + hash(9700 + n * 2.9) * 0.45;
      this.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
                        flip: hash(9800 + n) > 0.5, sortY: y,
                        shadow: Math.round(w * k * 0.2) });
      under.push({ x, y });
    }

    // ---- rocks -------------------------------------------------------------
    //
    // In groups, never singly, and graded like everything else. `rockgrass_*`
    // are rock-and-grass masses cut from the grass sheet, which sit into a
    // forest floor better than a bare boulder does.
    const BOULDER = ['rock_med_01', 'rockgrass_01', 'rockgrass_02', 'rockgrass_03',
                     'rockgrass_04', 'rockgrass_05'];
    const COBBLE = ['rock_small_01', 'rock_small_02', 'rock_small_03',
                    'pebbles_01', 'pebbles_02', 'pebbles_03'];
    const rocks = [];
    for (let n = 0; n < 1600 && rocks.length < 78; n++) {
      const ang = hash(10200 + n * 3.1) * Math.PI * 2;
      const rr = hash(10300 + n * 5.7);
      const out = 14 + rr * rr * 410;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(ang) * (POND_W * 0.5 + out - 30));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(ang) * (POND_H * 0.5 + out - 30));
      const d = distToWater(x, y);
      if (d < 12 || d > 440) continue;
      if (this._nearAnyRoad(x, y, 24) || this._nearAnyDistrict(x, y, 48)) continue;
      if (onRoadPaint(x, y, 30, 10)) continue;   // widest rock mass scales to ~55
      const gap = 34 + d * 0.26;
      if (rocks.some((r) => Math.hypot(r.x - x, r.y - y) < gap)) continue;
      const big = BOULDER[Math.floor(hash(10400 + n * 7.3) * BOULDER.length) % BOULDER.length];
      const [bw, bh] = DECOR_SIZE[big];
      const k = 0.8 + hash(10500 + n * 2.3) * 0.5;
      this.decor.push({ name: big, x, y, w: Math.round(bw * k), h: Math.round(bh * k),
                        flip: hash(10600 + n) > 0.5, sortY: y,
                        shadow: Math.round(bw * k * 0.22) });
      rocks.push({ x, y });
      // one or two smaller stones tucked against it
      const extra = 1 + Math.floor(hash(10700 + n * 4.1) * 2);
      for (let e = 0; e < extra; e++) {
        const ea = hash(10800 + n * 6.1 + e * 9.7) * Math.PI * 2;
        const er = 12 + hash(10900 + n * 3.7 + e * 5.3) * 16;
        const ex = Math.round(x + Math.cos(ea) * er), ey = Math.round(y + Math.sin(ea) * er * 0.7);
        if (distToWater(ex, ey) < 8 || onRoadPaint(ex, ey, 12, 6)) continue;
        const sm = COBBLE[Math.floor(hash(11000 + n * 8.9 + e) * COBBLE.length) % COBBLE.length];
        const [sw, sh] = DECOR_SIZE[sm];
        this.decor.push({ name: sm, x: ex, y: ey, w: sw, h: sh,
                          flip: hash(11100 + n + e) > 0.5, sortY: ey,
                          shadow: Math.round(sw * 0.2) });
      }
    }

    // ---- mushrooms ---------------------------------------------------------
    //
    // In small clumps rather than sprinkled one at a time: they grow that way,
    // and single mushrooms at this size just read as specks. Placed on land
    // only — the lake's own collision rects are the water test — and kept off
    // the roads and out of the districts.
    //
    // Weighted toward the tree bases and the lakeside, thinning outward, so the
    // ground still reads as mostly open meadow.
    const wet = (x, y, pad = 8) => water.some((r) =>
      x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad);
    const CAPS = ['mushrooms_01', 'mushrooms_02', 'mushrooms_03', 'mushrooms_04'];
    const clumps = [];
    const ok = (x, y, gap) => !wet(x, y) && !this._nearAnyRoad(x, y, 20) && !onRoadPaint(x, y, 16, 6)
      && !this._nearAnyDistrict(x, y, 46)
      && !clumps.some((c) => Math.hypot(c.x - x, c.y - y) < gap);

    const clump = (x, y, seed, n) => {
      clumps.push({ x, y });
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 4.7) * Math.PI * 2;
        const r = 3 + hash(seed + i * 6.9 + 1) * 13;
        const mx = Math.round(x + Math.cos(a) * r), my = Math.round(y + Math.sin(a) * r * 0.7);
        if (wet(mx, my, 4) || onRoadPaint(mx, my, 8, 4)) continue;
        const name = CAPS[Math.floor(hash(seed + i * 8.3 + 2) * CAPS.length) % CAPS.length];
        const [w, h] = DECOR_SIZE[name];
        this.groundDecor.push({ name, x: mx, y: my, w, h,
                                flip: hash(seed + i * 2.9 + 3) > 0.5, sortY: my, shadow: 0 });
      }
    };

    // a couple of clumps at the foot of each tree
    SPOTS.forEach(([tx, ty], k) => {
      for (let i = 0; i < 2; i++) {
        const a = hash(7000 + k * 9.1 + i * 5.3) * Math.PI * 2;
        const r = 22 + hash(7010 + k * 7.7 + i * 3.1) * 26;
        const x = Math.round(tx + Math.cos(a) * r), y = Math.round(ty + Math.sin(a) * r * 0.7);
        if (ok(x, y, 26)) clump(x, y, 7100 + k * 31 + i * 13, 2 + Math.floor(hash(7120 + k + i) * 3));
      }
    });

    // and clumps over the surrounding ground, packed close to the water and
    // thinning outward.
    //
    // The gradient is carried by the SPACING, not by how often a candidate is
    // accepted. A single minimum gap everywhere — which is what this did at
    // first — spreads clumps evenly however the candidates are drawn, because
    // the spacing rule overrides the bias. Scaling the required gap with the
    // distance to the water is what actually makes the lakeside congested and
    // the far field open. Clump size is graded the same way.
    const gapAt = (d) => 30 + d * 0.42;      // 30 at the bank, ~200 out in the field
    const sizeAt = (d, h) => d < 70 ? 3 + Math.floor(h * 3)      // 3-5 by the water
                          : d < 190 ? 2 + Math.floor(h * 3)      // 2-4 mid
                          : 1 + Math.floor(h * 2);               // 1-2 far out

    for (let n = 0; n < 420 && clumps.length < 64; n++) {
      const a = hash(7200 + n * 3.7) * Math.PI * 2;
      const rr = hash(7300 + n * 5.9);
      // squared so candidates crowd the shore, then the spacing rule does the
      // rest of the work
      const out = rr * rr * 430;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(a) * (POND_W * 0.5 + out - 16));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(a) * (POND_H * 0.5 + out - 16));
      const d = distToWater(x, y);
      if (d > 430) continue;
      if (!ok(x, y, gapAt(d))) continue;
      clump(x, y, 7400 + n * 17, sizeAt(d, hash(7500 + n)));
    }
  }

  _buildLakeDecor() {
    const L = this.lakeTopLeft;
    // The lake's own water, in world units — vegetation may stand on the bank
    // but nothing may stand in the water.
    const water = POND_WATER_RECTS.map(([fx, fy, fw, fh]) => ({
      x: L.x + fx * POND_W, y: L.y + fy * POND_H, w: fw * POND_W, h: fh * POND_H,
    }));
    const inWater = (x, y) => water.some((r) =>
      x > r.x - 6 && x < r.x + r.w + 6 && y > r.y - 6 && y < r.y + r.h + 6);

    const decor0 = this.decor.length, ground0 = this.groundDecor.length;
    const placed = [];
    const vegAll = [];   // everything this pass puts down, for the feathering
    const fits = (name, x, y, slack) => {
      const [w, h] = DECOR_SIZE[name];
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h, area = w * h;
      for (const p of placed) {
        const ox = Math.min(x1, p.x1) - Math.max(x0, p.x0);
        const oy = Math.min(y, p.y1) - Math.max(y0, p.y0);
        if (ox <= 0 || oy <= 0) continue;
        if ((ox * oy) / Math.min(area, p.area) > slack) return false;
      }
      return true;
    };
    // slack is how much two plants may overlap on screen: a grove wants its
    // canopies knitted together, loose scatter does not.
    // No trees and no shrubs anywhere in this pass. Every arrangement tried
    // around the lake — groves in the north field, a woodland to the
    // south-west, framing at the overlook and the fishing cove — read badly at
    // the wide camera, and once the trees went the bushes that framed them were
    // just green blobs in a field. Blocked here rather than by deleting the
    // arrangements, so the compositions stay legible in the code and either
    // pool can be switched back on in one line. Planting from other passes —
    // the Crystal Plaza grove, the town's forest perimeter — is untouched.
    const WOODY_NAME = /^(tree_|mystic_tree|myst_tree|bush_|topiary)/;
    const put = (name, x, y, opts = {}) => {
      if (!DECOR_SIZE[name] || WOODY_NAME.test(name)) return false;
      x = Math.round(x); y = Math.round(y);
      if (inWater(x, y)) return false;
      if (this._nearAnyRoad(x, y, opts.roadPad != null ? opts.roadPad : 26)) return false;
      if (this._nearAnyDistrict(x, y, 46)) return false;
      if (!fits(name, x, y, opts.slack != null ? opts.slack : 0.3)) return false;
      const [w, h] = DECOR_SIZE[name];
      const list = opts.flat ? this.groundDecor : this.decor;
      list.push({ name, x, y, w, h, flip: !!opts.flip, sortY: y,
                  shadow: opts.flat ? 0 : Math.round(w * 0.28) });
      if (!opts.flat) placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y, area: w * h });
      vegAll.push({ x, y, flat: !!opts.flat });
      return { x, y };          // truthy, and tells later passes where it landed
    };
    const pick = (pool, h) => pool[Math.floor(h * pool.length) % pool.length];

    // ---------------------------------------------------------------- groves
    // Three of them across the northern field, deliberately NOT joined up and
    // deliberately at different distances from the water, so the gaps between
    // them read as meadow rather than as gaps in a hedge.
    const CANOPY = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted'];
    const UNDER = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const SHRUB = ['bush_big', 'bush_01', 'bush_02', 'bush_low', 'bush_03'];
    // Two things make a grove read as one mass rather than as separate trees,
    // and the first attempt had neither. Canopies must be allowed to OVERLAP
    // heavily — in this art a wood is drawn as crowns growing into each other,
    // and a 0.4 overlap cap spaced them out like an orchard. And each plant
    // needs several candidate spots: with one try apiece and a tight radius
    // most were rejected on the first collision, and asking for eighteen plants
    // put down two.
    const woody = [];         // trees and shrubs, so pass 2 can floor them
    const sow = (pool, seed, n, cx, cy, rx, ry, slack) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 14; k++) {
          const h1 = hash(seed + i * 3.7 + k * 11.3);
          const h2 = hash(seed + i * 5.3 + k * 7.9 + 1);
          const h3 = hash(seed + i * 7.1 + 2);
          const at = put(pick(pool, h3), cx + (h1 - 0.5) * 2 * rx, cy + (h2 - 0.5) * 2 * ry,
                         { slack, flip: h1 > 0.5 });
          if (at) { woody.push(at); break; }
        }
      }
    };
    // A handful of things thrown around a point, biased to one side so the
    // result never reads as a planted circle.
    const around = (pool, salt, at, n, r0, r1, slack, flat) => {
      const bias = hash(salt + 0.5) * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const h1 = hash(salt + i * 3.9), h2 = hash(salt + i * 6.1 + 1), h3 = hash(salt + i * 8.3 + 2);
        const a = bias + (h1 - 0.5) * 3.4;
        const r = r0 + h2 * (r1 - r0);
        put(pick(pool, h3), at.x + Math.cos(a) * r, at.y + Math.sin(a) * r * 0.66,
            { slack, flip: h3 > 0.5, flat, roadPad: 16 });
      }
    };
    const grove = (seed, cx, cy, rx, ry, big, small, shrubs) => {
      sow(CANOPY, seed, big, cx, cy, rx, ry, 0.72);
      sow(UNDER, seed + 40, small, cx, cy, rx * 1.25, ry * 1.25, 0.62);
      sow(SHRUB, seed + 90, shrubs, cx, cy, rx * 1.4, ry * 1.4, 0.55);
    };
    // Radii are deliberately TIGHT. The first attempt spread five trees over
    // 190x100 units and the grove read as a handful of separate trees standing
    // in a field — at this camera a mass only registers if the canopies touch.
    // Staggered in distance from the water, and all three kept inside the band
    // of field the player actually sees from the shore — the first placement
    // pushed two of them so far north they were half out of frame and framed
    // nothing.
    grove(1100, 660, 1990, 96, 50, 15, 8, 12);   // west, nearest the shore
    grove(1200, 1520, 1950, 104, 48, 17, 9, 13); // north-east, set furthest back
    grove(1300, 1180, 2058, 84, 40, 12, 7, 10);  // north-centre, hard by the bank

    // ----------------------------------------------------- the shoreline ring
    //
    // What was missing was the MIDDLE of the sequence. The groves sat back in
    // the field and the water had bare rock, so the eye jumped
    // forest -> empty grass -> water. The land now runs
    //
    //   canopy -> bushes -> meadow flowers -> wet grass -> reeds -> water
    //
    // and the ring is deliberately BROKEN: roughly half the perimeter is
    // planted and the rest left bare, in runs long enough to read as stretches
    // of open bank rather than as gaps in a hedge.
    //
    // Shore points come from the pond's own collision rects: for a column of x
    // the topmost and bottommost water give the north and south bank, and for a
    // row of y the leftmost and rightmost give west and east. That tracks the
    // real outline of both lobes without needing the drawn mask, which does not
    // exist yet at build time.
    // The shoreline is left bare on purpose. Successive attempts to plant it —
    // a graded ring, then five consolidated habitats — all read at wide zoom as
    // decoration around the water rather than as a lake, so the waterside
    // planting was removed. The density lives inland instead (below). The
    // wetland and grass props sliced for it are still on disk and still
    // registered, so this is one block to restore, not a re-cut.

    // ------------------------------------------- landscape masses, set inland
    //
    // The density that used to crowd the water lives out here instead, 100-300
    // units back, as a handful of destinations. The lake sits inside a
    // landscape rather than inside a ring of plants.
    const CANOPY2 = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted'];
    const UNDER2 = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const SHRUB2 = ['bush_big', 'bush_01', 'bush_02', 'bush_low', 'bush_03'];
    const BLOSSOM = ['tree_blossom_white', 'tree_blossom_blue'];
    const DEADWOOD = ['fallen_log_01', 'fallen_log_02', 'log_long', 'tree_stump_01', 'tree_stump_02'];

    // North-central grove: the anchor the big field above the water was missing.
    grove(4100, 1268, 2010, 62, 32, 6, 4, 7);
    put(pick(DEADWOOD, hash(4150)), 1310, 2036, { slack: 0.4, flip: true });
    around(['rock_med_01', 'rock_small_01', 'rock_small_02'], 4160, { x: 1224, y: 2028 }, 3, 8, 22, 0.4);

    // South-west woodland: the biggest new mass, and the emptiest field.
    grove(4200, 902, 2662, 104, 52, 8, 5, 10);
    put(pick(DEADWOOD, hash(4250)), 946, 2694, { slack: 0.4 });
    put(pick(DEADWOOD, hash(4260)), 858, 2620, { slack: 0.4, flip: true });
    around(['rock_med_01', 'rock_small_01', 'rock_small_03'], 4270, { x: 968, y: 2640 }, 3, 10, 26, 0.4);
    // ... and a smaller one, with open meadow deliberately left between them
    grove(4300, 1268, 2742, 58, 30, 4, 3, 5);
    around(['rock_med_01', 'rock_small_02'], 4320, { x: 1310, y: 2760 }, 2, 10, 22, 0.4);

    // North-east scenic overlook: the kept side, facing the water. One large
    // tree, a flowering one, a bench and low planting — and the lawn between it
    // and the lake is left clear so the view is not blocked.
    put('tree_oak_broad', 1584, 2148, { slack: 0.4 });
    put(pick(BLOSSOM, hash(4400)), 1640, 2176, { slack: 0.4, flip: true });
    put('tree_young', 1536, 2130, { slack: 0.4 });
    around(SHRUB2, 4410, { x: 1604, y: 2170 }, 4, 14, 30, 0.4);
    around(['flowers_white', 'flowers_blue'], 4420, { x: 1592, y: 2196 }, 5, 10, 26, 1, true);
    put('bench_01', 1596, 2214, { slack: 0.2 });

    // South fishing cove. The peninsula is real geometry — the south bank pushes
    // north to +229 around x=1162..1202 — so the clearing is cut behind its tip
    // and framed in a U, leaving the walk to the water open.
    put('tree_oak_spread', 1104, 2452, { slack: 0.4 });
    put('tree_young', 1256, 2444, { slack: 0.4, flip: true });
    around(SHRUB2, 4500, { x: 1116, y: 2470 }, 3, 12, 26, 0.45);
    around(SHRUB2, 4510, { x: 1246, y: 2466 }, 3, 12, 26, 0.45);
    put(pick(DEADWOOD, hash(4520)), 1128, 2492, { slack: 0.4 });
    around(['rock_med_01', 'rock_small_01'], 4530, { x: 1238, y: 2492 }, 2, 10, 20, 0.4);

    // ------------------------------------------- supporting detail, keyed only
    // to the compositions above. Nothing is placed to fill empty grass: every
    // entry here belongs to a grove, a cove or the overlook. Grass sprites are
    // deliberately not used — flowers and stone carry the detail instead.
    const ROCKSET = ['rock_med_01', 'rock_small_01', 'rock_small_02', 'rock_small_03'];
    // [x, y, radius, flowers, a rock group?]
    const SITES = [
      [660, 1990, 96, 3, true],    // west grove
      [1520, 1950, 100, 2, true],  // north-east grove
      [1180, 2058, 82, 2, false],  // north-centre grove
      [1268, 2010, 66, 2, true],   // new north grove
      [902, 2662, 108, 4, true],   // south-west woodland
      [1268, 2742, 62, 2, true],   // south-west small grove
      [1600, 2180, 74, 5, false],  // north-east overlook, flowers led
      [1180, 2470, 96, 3, true],   // fishing cove
    ];
    SITES.forEach(([sx, sy, r, blooms, rocks], i) => {
      if (blooms) around(['flowers_white', 'flowers_blue', 'flowers_white'],
                         5300 + i * 7, { x: sx, y: sy }, blooms, r * 0.5, r * 0.95, 1, true);
      if (rocks) {
        const a2 = hash(5400 + i) * Math.PI * 2, rr = r * 0.55;
        const cx = sx + Math.cos(a2) * rr, cy = sy + Math.sin(a2) * rr * 0.66;
        put('rock_med_01', cx, cy, { slack: 0.35 });
        around(ROCKSET, 5500 + i * 9, { x: cx, y: cy }, 2, 10, 20, 0.4);
      }
    });

    // ------------------------------------------------------- wildflower meadow
    // Not one carpet: a handful of irregular patches with grass corridors left
    // between them, so it reads as a meadow rather than as a painted rectangle.
    // White and blue lead, yellow is occasional, red stays out — Crystal Plaza
    // owns organised colour, and the lake has to look like nobody planted it.
    const BLOOM = ['flowers_white', 'flowers_blue', 'flowers_white', 'flowers_blue',
                   'flowers_white', 'flowers_blue', 'flowers_yellow'];
    // Sits in the gap between the west grove and the north-centre one, so the
    // eye reads grove -> meadow -> grove rather than one continuous band.
    const patches = [[872, 2020, 34, 18], [960, 1986, 30, 16], [840, 2074, 28, 15],
                     [1012, 2040, 30, 17], [910, 2058, 25, 14], [986, 2090, 24, 13],
                     [900, 1962, 26, 14], [1040, 1988, 22, 12]];
    patches.forEach((pt, k) => {
      const [px, py, rx, ry] = pt;
      for (let i = 0; i < 14; i++) {
        const h1 = hash(2000 + k * 31 + i * 3.7), h2 = hash(2000 + k * 31 + i * 5.1 + 1);
        const h3 = hash(2000 + k * 31 + i * 6.9 + 2);
        put(pick(BLOOM, h3), px + (h1 - 0.5) * 2 * rx, py + (h2 - 0.5) * 2 * ry,
            { flat: true, slack: 1, flip: h1 > 0.5 });
      }
    });

    // ---------------------------------------------------------- keep water clear
    // Nothing of this pass may sit against the bank: that is what kept reading
    // as an outline round the lake instead of as a landscape containing one.
    const nearWater = (d) => water.some((r) =>
      d.x > r.x - 22 && d.x < r.x + r.w + 22 && d.y > r.y - 22 && d.y < r.y + r.h + 22);
    const dropD = new Set(this.decor.slice(decor0).filter(nearWater));
    const dropG = new Set(this.groundDecor.slice(ground0).filter(nearWater));
    this.decor = this.decor.filter((d) => !dropD.has(d));
    this.groundDecor = this.groundDecor.filter((d) => !dropG.has(d));
  }

  _buildPlazaDecor(FC) {
    this.decor = [];        // depth-sorted against the player
    this.groundDecor = [];  // flat detail, drawn beneath every entity
    const R = this.plazaRadius;

    // ---------------------------------------------------------- primitives
    const placed = [];
    const FURNITURE = /^(bench|planter|lamppost|signpost|cart|crate|barrel|sack|topiary|fence|garden_patch|flower_box|clothes_line|mailbox|wooden_post|wooden_sign|water_well|water_bucket|wheelbarrow|hay_|wood_pile|chopping_block|log_long|direction_sign)/;
    const onPaint = (x, y, pad = 0) => {
      const C = ROAD_CELL;
      for (let dy = -pad; dy <= pad; dy += C) {
        for (let dx = -pad; dx <= pad; dx += C) {
          if (this.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
        }
      }
      return false;
    };
    // Nearest spot off the paint, searched straight out from the fountain, or
    // null if there is none within a prop's width. Inside the rim the grit is
    // meant to lie on the stone, so the rule starts at the plaza edge.
    const GRID = 8;
    const snap = (v) => Math.round(v / GRID) * GRID;
    const offPaint = (x, y) => {
      const rr = Math.hypot(x - FC.x, y - FC.y);
      if (rr <= R + 2 || !onPaint(x, y, 6)) return [x, y];
      const ux = (x - FC.x) / rr, uy = (y - FC.y) / rr;
      for (let push = GRID; push <= GRID * 4; push += GRID) {
        const nx = snap(x + ux * push), ny = snap(y + uy * push);
        if (!onPaint(nx, ny, 6)) return [nx, ny];
      }
      return null;
    };
    // Rough grass and loose stone must clear the paving by their whole drawn
    // width, not just by their anchor: a tuft whose base sits a few units off
    // the kerb still lies half across the road, and it is the sprite the player
    // sees, not the anchor. Everything else may overhang a little — a shrub
    // breaking the rim is what stops the stone edge reading as a cut line.
    const STONE_SHY = /^(grass_tuft|weeds|fern|bush|flowers|tree_|rock|pebbles)/;
    const footprintOnStone = (name, x, y) => {
      const [w, h] = DECOR_SIZE[name];
      for (let dx = -w / 2; dx <= w / 2; dx += 4) {
        for (let dy = -Math.min(h, 14); dy <= 0; dy += 4) {
          if (onPaint(x + dx, y + dy, 0)) return true;
        }
      }
      return Math.hypot(x - FC.x, y - FC.y) < R + 4;
    };
    // Everything lands on an 8-unit grid. This is where a tile-built town gets
    // its order from — not from symmetry, which we already had and which still
    // read loose. Props placed at arbitrary polar offsets never line up with
    // each other or with anything else on screen; snapped, they share edges and
    // spacings the eye picks up even when the arrangement itself is irregular.
    // Groups stay irregular because their ANCHORS differ, not because their
    // individual members sit at fractional offsets.
    // The funnel. From the plaza edge out to 205, within 40 units of any
    // carriageway, is the ground a player reads a road BY — so nothing loose
    // stands in it. Formal furniture is exempt on purpose: containers and
    // lanterns are what frame an entrance, and the north gateway pair is meant
    // to stand right at one.
    const MOUTH_OK = /^(topiary|lamppost|planter)/;
    // Ground held back for the four directional statues, which are not built
    // yet: roughly two player widths across, one just off each road mouth,
    // clear of the carriageway itself. Nothing may be planted or stacked here.
    const STATUE_PLOTS = [[-72, -158], [166, -68], [-72, 162], [-168, 66]];
    const onStatuePlot = (x, y) => STATUE_PLOTS.some(([ox, oy]) =>
      Math.hypot(x - (FC.x + ox), y - (FC.y + oy)) < 24);
    // ---- SOUTH-EAST HELD CLEAR --------------------------------------------
    // The SE is being rebuilt from scratch, so for now nothing but a lamp may
    // stand anywhere in its review frame. Placed here rather than by deleting
    // the yard code, so the composition survives in source and comes straight
    // back when this block goes. Rect matches the standard SE camera exactly:
    // dx -46..518, dy -7..311 from the plaza focus.
    const SE_HOLD = true;
    const seHeld = (name, x, y, opts) => SE_HOLD
      && !(opts && opts.holdOk)              // an explicit, per-placement exemption
      && !/^(lamppost|crop_|soil_)/.test(name)
      && x >= FC.x - 46 && x <= FC.x + 518
      && y >= FC.y - 7 && y <= FC.y + 311;

    const nearMouth = (x, y) => {
      const rr = Math.hypot(x - FC.x, y - FC.y);
      if (rr < R - 4 || rr > 205) return false;
      return this._nearAnyRoad(x, y, 40);
    };
    const put = (name, x, y, opts = {}) => {
      const [w, h] = DECOR_SIZE[name];
      // Everything lands on the 8-grid except where a prop has to be placed
      // EXACTLY — see the fountain's lantern pair, which cannot be symmetric
      // about a focus that is not itself a grid point.
      if (!opts.exact) { x = snap(x); y = snap(y); }
      const clear = offPaint(x, y);
      if (!clear) return false;
      if (STONE_SHY.test(name) && footprintOnStone(name, clear[0], clear[1])) return false;
      if (!MOUTH_OK.test(name) && nearMouth(clear[0], clear[1])) return false;
      if (onStatuePlot(clear[0], clear[1])) return false;
      if (seHeld(name, clear[0], clear[1], opts)) return false;
      // A nudge happens after the caller cleared the original spot, so re-check
      // the furniture rule or a moved prop slides into something already avoided.
      if ((clear[0] !== x || clear[1] !== y) && !fits(name, clear[0], clear[1], 1)) return false;
      x = clear[0]; y = clear[1];
      const list = opts.flat ? this.groundDecor : this.decor;
      list.push({ name, x, y, w, h, flip: !!opts.flip,
                  sortY: opts.sortY != null ? opts.sortY : y,
                  shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
      if (!opts.flat) {
        placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y,
                      area: w * h, furn: FURNITURE.test(name) });
      }
      if (opts.solid) {
        const [sw, sh] = opts.solid;
        this.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
      }
      return true;
    };
    // Sprites are bottom-anchored and drawn UPWARD, so two props whose bases sit
    // well apart can still cover each other on screen. Compare drawn rectangles.
    // Planting may knit together; nothing may grow through the furniture.
    const fits = (name, x, y, plantSlack = 0.28) => {
      const [w, h] = DECOR_SIZE[name];
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h, area = w * h;
      for (const p of placed) {
        const ox = Math.min(x1, p.x1) - Math.max(x0, p.x0);
        const oy = Math.min(y, p.y1) - Math.max(y0, p.y0);
        if (ox <= 0 || oy <= 0) continue;
        if ((ox * oy) / Math.min(area, p.area) > (p.furn ? 0.02 : plantSlack)) return false;
      }
      return true;
    };
    const pick = (pool, h) => pool[Math.floor(h * pool.length) % pool.length];
    const place = (name, x, y, opts = {}) => {
      // Clearance is tested at the SNAPPED position, which is where the prop
      // will actually stand — checking the raw one and letting put() snap
      // afterwards leaves half a grid step of untested drift. The search is a
      // spiral rather than a straight radial push: a spot blocked on the way
      // out is very often free a step to one side, and radial-only failed to
      // seat the wheelbarrow, the washing line and the forge's hay at all.
      const sx = snap(x), sy = snap(y);
      if (fits(name, sx, sy, 0.05) && put(name, sx, sy, opts)) return true;
      for (let ring = 1; ring <= 5; ring++) {
        for (let a = 0; a < 12; a++) {
          const th = (a / 12) * Math.PI * 2;
          const nx = snap(x + Math.cos(th) * ring * GRID);
          const ny = snap(y + Math.sin(th) * ring * GRID);
          if (fits(name, nx, ny, 0.05) && put(name, nx, ny, opts)) return true;
        }
      }
      // No fallback. Forcing it in when every offset was rejected is how a
      // fence ends up running through a tree; for anything laid in a run a
      // missing segment just shortens the run, which costs far less.
      return false;
    };
    // Everything past the formal ring is pulled in toward the square. A town
    // centre reads as a place when you can take it in at once; spread out, the
    // fountain looks small and lonely and the planting and the enclosing wall
    // become two unrelated things with lawn between them. The formal ring keeps
    // its own distances — that geometry is set against the paving — so only the
    // landscape beyond it compresses.
    const COSY_FROM = 190, COSY = 0.60;
    const at = (deg, dist) => {
      const d = dist <= COSY_FROM ? dist : COSY_FROM + (dist - COSY_FROM) * COSY;
      const a = deg * Math.PI / 180;
      return [FC.x + Math.cos(a) * d, FC.y + Math.sin(a) * d];
    };
    // Which quadrant a point falls in — the ground layers below weight
    // themselves by it, so rock and rough grass belong to the wild side of the
    // town and stay off the swept and the cultivated sides.
    const quadOf = (x, y) => {
      const g = Math.atan2(y - FC.y, x - FC.x) * 180 / Math.PI;
      return g > -90 && g < 0 ? 'NE' : g >= 0 && g < 90 ? 'SE' : g >= 90 ? 'SW' : 'NW';
    };
    // The four walking corridors. Everything built or planted keeps out; the
    // pad is generous for canopy because a crown overhangs its own trunk.
    const corridor = (x, y, pad = 20) => this._nearAnyRoad(x, y, pad);

    // An irregular organic patch — polar jitter with a sqrt radius so the
    // density falls off toward the edge rather than stopping at a boundary.
    // Deliberately not a grid: bedding laid out on a rectangle reads as tiles.
    const patch = (base, cx, cy, names, n, spread, opts = {}) => {
      let made = 0;
      for (let i = 0; i < n * 4 && made < n; i++) {
        const k = base + i * 3;
        const h1 = hash(k), h2 = hash(k + 1), h3 = hash(k + 2);
        const a = h1 * Math.PI * 2, rr = spread * Math.sqrt(h2);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.7;
        if (corridor(x, y, opts.road != null ? opts.road : 18)) continue;
        if (opts.avoid && opts.avoid(x, y)) continue;
        const name = pick(names, h3);
        if (!fits(name, x, y, opts.slack != null ? opts.slack : 0.45)) continue;
        if (put(name, x, y, { flip: h3 > 0.5, flat: opts.flat })) made++;
      }
      return made;
    };
    // A planted group: one anchor with its companions tucked around it. Groups
    // are what stop a landscape reading as a sprinkle of individual sprites.
    const clump = (base, cx, cy, names, opts = {}) => {
      let made = 0;
      for (let i = 0; i < names.length; i++) {
        const k = base + i * 3;
        const h1 = hash(k), h2 = hash(k + 1), h3 = hash(k + 2);
        for (let t = 0; t < 8; t++) {
          const a = (i / names.length) * Math.PI * 2 + (h1 - 0.5) * 1.6 + t * 0.7;
          const rr = (i === 0 ? 0 : 16 + h2 * 20 + t * 3);
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.65;
          if (corridor(x, y, opts.road != null ? opts.road : 26)) continue;
          if (opts.avoid && opts.avoid(x, y)) continue;
          if (!fits(names[i], x, y, 0.22)) continue;
          if (put(names[i], x, y, { flip: h3 > 0.5 })) { made++; break; }
        }
      }
      return made;
    };

    // ==================================================== CRYSTAL PLAZA LAYOUT
    // Rebuilt from zero as an AUTHORED level, not a decoration system. The
    // previous layout was ~1000 lines of generative passes that each scattered
    // props by rule; every refinement moved sprites around inside the same
    // structure, which is why it kept looking different without looking better.
    //
    // Three things changed in approach:
    //   1. Built OUTSIDE-IN. The outer tree belt is placed first and the
    //      fountain surround last, so the scene is contained before it is
    //      decorated.
    //   2. Deliberately ASYMMETRIC. Four equally dressed quadrants is what
    //      reads as artificial; these four destinations differ in size,
    //      density and character, and only the formal garden is geometric.
    //   3. Authored placements call put() DIRECTLY and skip fits(). A designed
    //      composition does not want automatic spacing — and fits() gates
    //      furniture at a hard 0.02, which makes a crate stack impossible.
    //      Automatic spacing is kept only for the scatter fillers.
    //
    // window.__plazaStage = 'bare' | 'macro' | 'mid' | 'final' renders the
    // layout at successive levels of detail, which is how the macro
    // composition gets judged before any grass is laid.
    const STAGE = (typeof window !== 'undefined' && window.__plazaStage) || 'final';
    const MACRO = STAGE !== 'bare';
    const MID = STAGE === 'mid' || STAGE === 'final';
    const MICRO = STAGE === 'final';

    // Piece-by-piece editing. `window.__plazaOnly = 'nw'` (or an array) builds
    // ONLY that composition, so one garden can be judged and reworked without
    // the rest of the site arguing with it. Every placement helper below checks
    // the current area, so switching one on or off is a single line, never a
    // re-indent. Ids: belt, nw, ne, sw, yard, plaza, lamps, mid, micro.
    const ONLY = (typeof window !== 'undefined' && window.__plazaOnly) || null;
    let AREA = 'core';
    const area = (id) => { AREA = id; };
    const wanted = () => !ONLY || AREA === ONLY
      || (Array.isArray(ONLY) && ONLY.indexOf(AREA) >= 0);

    const P = (dx, dy) => [FC.x + dx, FC.y + dy];
    const BLUE = ['flowers_blue', 'flowers_blue', 'flowers_white', 'flowers_mixed'];
    const BLUEWHITE = ['flowers_blue', 'flowers_white', 'flowers_white'];
    const WHITEBLUE = ['flowers_white', 'flowers_white', 'flowers_blue'];
    const YELLOW = ['flowers_yellow', 'flowers_yellow', 'flowers_white'];
    const MARKET = ['flowers_red', 'flowers_red', 'flowers_yellow'];

    // Nothing may be built into the lake or a building.
    const WORLD_BLOCK = this.locations.filter((l) => l.solid).map((l) => l.solid);
    const LK = this.lakeTopLeft;
    const blocked = (x, y) => {
      if (LK && x > LK.x - 24 && x < LK.x + POND_W + 24
              && y > LK.y - 24 && y < LK.y + POND_H + 24) return true;
      for (const o of WORLD_BLOCK) {
        if (x > o.x - 16 && x < o.x + o.w + 16 && y > o.y - 16 && y < o.y + o.h + 16) return true;
      }
      return false;
    };
    // Six designated lawns. These are DESIGN, not leftovers: the dense masses
    // only read as dense against ground that is genuinely empty, and three of
    // them sit on the fountain's north, west and east sightlines so each road
    // leaves through open ground before it reaches anything.
    const LAWNS = [
      [0, -168, 74],     // north of the fountain — the grand approach
      [-214, 16, 70],    // west sightline
      [216, 8, 68],      // east sightline
      [-242, -118, 54],  // the civic garden's own clearing
      [-214, 170, 48],   // the park's clearing
      [-70, 204, 56],    // south lawn, between park and market road
    ];
    const onLawn = (x, y) => LAWNS.some(([ox, oy, r]) =>
      Math.hypot(x - (FC.x + ox), y - (FC.y + oy)) < r);

    // AUTHORED placement: exact position, no spacing test, guards still apply.
    const set = (name, dx, dy, opts = {}) => {
      if (!wanted()) return false;
      const [x, y] = P(dx, dy);
      if (blocked(x, y)) return false;
      return put(name, x, y, opts);
    };
    // SCATTERED placement: for fillers only, spacing-tested and lawn-aware.
    const grow = (name, dx, dy, opts = {}, slack = 0.5) => {
      if (!wanted()) return false;
      const [x, y] = P(dx, dy);
      if (blocked(x, y) || onLawn(x, y)) return false;
      if (corridor(x, y, opts.road != null ? opts.road : 22)) return false;
      const sx = snap(x), sy = snap(y);
      if (fits(name, sx, sy, slack) && put(name, sx, sy, opts)) return true;
      for (let k = 1; k <= 3; k++) {
        for (let a = 0; a < 6; a++) {
          const th = (a / 6) * Math.PI * 2 + k;
          const nx = snap(x + Math.cos(th) * k * GRID), ny = snap(y + Math.sin(th) * k * GRID);
          if (blocked(nx, ny) || onLawn(nx, ny) || corridor(nx, ny, opts.road != null ? opts.road : 22)) continue;
          if (fits(name, nx, ny, slack) && put(name, nx, ny, opts)) return true;
        }
      }
      return false;
    };
    const bed = (seed, dx, dy, names, n, spread) => {
      if (!wanted()) return 0;
      const [x, y] = P(dx, dy);
      if (blocked(x, y)) return 0;
      return patch(seed, x, y, names, n, spread, { road: 24, slack: 0.72 });
    };
    const fenceRun = (dx, dy, segs, vertical) => {
      if (!wanted()) return;
      const [w, h] = DECOR_SIZE[vertical ? 'fence_vertical' : 'fence_run'];
      for (let i = 0; i < segs; i++) {
        const ddx = vertical ? dx : dx + i * (w - 2);
        const ddy = vertical ? dy + i * (h - 3) : dy;
        const [x, y] = P(ddx, ddy);
        if (corridor(x, y, 16) || blocked(x, y)) continue;
        put(vertical ? 'fence_vertical' : 'fence_run', x, y,
            { solid: [w - 4, 5], shadow: 0 });
      }
    };

    // ---- THE TWO PLAZA LANTERNS -------------------------------------------
    // Kept exactly. A precise pair: snapping each side independently against a
    // focus that is not on the 8-grid pulls them out of true, so these opt out.
    {
      const rad = 157 * Math.PI / 180;
      const off = Math.round(Math.abs(Math.cos(rad)) * (R + 26));
      const ly = Math.round(FC.y + Math.sin(rad) * (R + 26));
      for (const side of [-1, 1]) {
        put('lamppost_twin', FC.x + side * off, ly, { flip: side > 0, solid: [8, 6], exact: true });
      }
    }
    if (!MACRO) {
      this.propGroups.push({ fn: (g) => {
        for (const d of this.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
      } });
      return;
    }

    area('belt');
    // ---- MASS E: THE OUTER TREE BELT --------------------------------------
    // Placed FIRST. Five masses of different size and shape, with concave and
    // convex edges rather than a row — some push inward, some pull out, and
    // the openings between them are as designed as the masses. The north-west
    // is short a mass because the lake shore starts at dx -342 there.
    const BELT = [
      { at: [-248, -216], trees: [['tree_oak_broad', 0, 0], ['tree_oak_spread', 54, 16],
          ['tree_oak_round', -52, 10], ['tree_young', 22, 34], ['tree_small_pine', -18, -26],
          ['tree_oak_round', 96, -8], ['tree_young', -92, -14]] },
      { at: [-408, 46], trees: [['tree_oak_spread', 0, 0], ['tree_oak_broad', 40, 44],
          ['tree_young', -30, 30], ['tree_small_pine', 18, -34], ['tree_oak_round', -34, -34]] },
      { at: [-336, 236], trees: [['tree_oak_broad', 0, 0], ['tree_oak_round', 58, -18],
          ['tree_young', -46, -22], ['tree_oak_spread', 20, 30], ['tree_sapling', -70, 14],
          ['tree_small_pine', 88, 10]] },
      { at: [336, -228], trees: [['tree_oak_broad', 0, 0], ['tree_oak_spread', -56, 18],
          ['tree_oak_round', 52, 22], ['tree_young', 12, 38], ['tree_small_pine', -22, -20],
          ['tree_young', 96, 4], ['tree_sapling', -96, 34]] },
      { at: [412, 128], trees: [['tree_oak_spread', 0, 0], ['tree_oak_broad', -44, 40],
          ['tree_oak_round', 34, -34], ['tree_young', -12, 58], ['tree_small_pine', 46, 30]] },
    ];
    BELT.forEach((m, i) => {
      m.trees.forEach(([nm, ox, oy], j) => {
        set(nm, m.at[0] + ox, m.at[1] + oy, { flip: (i + j) % 3 === 0 });
      });
    });

    area('nw');
    // ---- MASS A: THE NORTH-WEST CIVIC GARDEN ------------------------------
    // The largest designed space on the site, roughly twice the formal
    // garden's area. Built as a room: canopy along the back and west, three
    // flower beds inside it, a clearing in the middle and the open side facing
    // the plaza so the player can walk in.
    set('tree_oak_broad', -338, -196);
    set('tree_oak_spread', -276, -222, { flip: true });
    set('tree_blossom_blue', -206, -206);
    set('tree_oak_round', -350, -132, { flip: true });
    set('tree_blossom_violet', -160, -178);
    set('tree_oak_round', -330, -66);
    set('tree_young', -180, -132, { flip: true });
    bed(9100, -296, -168, BLUE, 16, 36);          // the large blue bed
    bed(9200, -212, -166, BLUEWHITE, 9, 24);      // blue/white, toward the road
    bed(9300, -318, -104, WHITEBLUE, 7, 20);      // small white, at the west edge
    set('bench_01', -250, -78, { solid: [26, 9] });          // faces the plaza
    set('bench_01', -336, -158, { flip: true, solid: [26, 9] });
    fenceRun(-368, -228, 2);
    set('signpost', -196, -96, { solid: [8, 6] });

    area('ne');
    // ---- MASS B: THE NORTH-EAST FORMAL GARDEN -----------------------------
    // Compact and the one geometric composition on the site: a tree behind,
    // two beds either side, matched containers, a bench square to them.
    set('tree_oak_round', 258, -230);
    set('tree_young', 314, -196, { flip: true });
    set('topiary_square', 214, -162, { solid: [18, 8], shadow: 7 });
    set('topiary_square', 300, -162, { flip: true, solid: [18, 8], shadow: 7 });
    bed(9400, 224, -198, YELLOW, 10, 22);
    bed(9500, 292, -196, ['flowers_white', 'flowers_yellow'], 7, 18);
    set('bench_01', 257, -132, { solid: [26, 9] });

    area('sw');
    // ---- MASS C: THE SOUTH-WEST PARK --------------------------------------
    // Three flowering trees set 42-48 apart against a 43-wide canopy, so the
    // crowns close over a single clearing instead of standing as three trees.
    set('tree_blossom_white', -268, 166);
    set('tree_blossom_white', -224, 150, { flip: true });
    set('tree_blossom_white', -248, 206);
    set('tree_oak_round', -308, 196, { flip: true });
    set('tree_young', -186, 214);
    set('bench_01', -212, 196, { solid: [26, 9] });
    bed(9600, -286, 236, WHITEBLUE, 9, 24);
    bed(9700, -170, 168, WHITEBLUE, 7, 20);
    fenceRun(-318, 134, 3);

    area('yard');
    // ---- MASS D: THE SOUTH-EAST WORK YARD ---------------------------------
    // The counterpoint to four organic gardens: a hard rectangle about 6 by 5
    // player widths, fenced on two and a half sides, open toward the plaza.
    // The goods are STACKED — authored offsets straight into put(), because
    // fits() would refuse every one of these overlaps.
    const YX = 232, YY = 168;
    set('tree_oak_round', YX - 96, YY - 84);
    set('tree_oak_spread', YX + 104, YY - 70, { flip: true });
    fenceRun(YX - 74, YY - 62, 4);                       // back edge
    fenceRun(YX + 106, YY - 46, 3, true);                // east return
    set('crate_stack', YX - 44, YY - 26, { solid: [20, 10], shadow: 9 });
    set('crate_01', YX - 28, YY - 34, { solid: [12, 7], shadow: 6 });
    set('crate_01', YX - 56, YY - 8, { flip: true, solid: [12, 7], shadow: 6 });
    set('crate_02', YX - 20, YY - 6, { solid: [12, 7], shadow: 6 });
    set('barrel_stack', YX + 12, YY - 30, { flip: true, solid: [18, 8], shadow: 9 });
    set('barrel_01', YX + 34, YY - 18, { solid: [12, 7], shadow: 6 });
    set('barrel_01', YX + 20, YY - 4, { flip: true, solid: [12, 7], shadow: 6 });
    set('barrel_02', YX + 48, YY - 32, { solid: [11, 6], shadow: 6 });
    set('sack_pile', YX - 44, YY + 14, { solid: [18, 8], shadow: 8 });
    set('sack_01', YX - 22, YY + 18, { shadow: 5 });
    set('hay_bale', YX + 62, YY + 4, { solid: [18, 7], shadow: 8 });
    set('hay_pile', YX + 80, YY + 22, { shadow: 11 });
    set('cart', YX + 54, YY + 34, { flip: true, solid: [24, 10], shadow: 11 });
    set('wheelbarrow', YX - 70, YY + 34, { solid: [22, 8], shadow: 10 });
    set('wood_pile_01', YX + 88, YY - 24, { solid: [20, 8], shadow: 9 });
    set('log_long', YX + 6, YY + 40, { flip: true, shadow: 10 });
    // the rest spot, OUTSIDE the entrance
    set('bench_01', YX - 118, YY + 26, { solid: [26, 9] });
    set('wooden_sign', YX - 124, YY - 4, { solid: [8, 5], shadow: 6 });
    bed(9800, YX - 96, YY + 66, MARKET, 9, 24);

    area('plaza');
    // ---- THE PLAZA TRANSITION ---------------------------------------------
    // THREE containers, not four. The fountain already supplies the symmetry;
    // a matching ring around it is what made the square read as laid out by a
    // machine. The north gateway keeps its matched pair because that is
    // architecture marking the way out, and it is the only mirrored thing here.
    set('topiary_round', -106, -106, { solid: [17, 8], shadow: 7 });
    set('topiary_round', 122, -84, { flip: true, solid: [17, 8], shadow: 7 });
    set('topiary_round', -118, 96, { solid: [17, 8], shadow: 7 });
    for (const side of [-1, 1]) {
      set('topiary_square', side * 44, -150, { flip: side > 0, solid: [18, 8], shadow: 7 });
    }
    set('flower_box_01', -150, 62, { solid: [18, 6], shadow: 8 });
    set('flower_box_02', 138, 78, { flip: true, solid: [18, 6], shadow: 8 });

    area('lamps');
    // ---- ROAD NAVIGATION LAMPS --------------------------------------------
    // One per road, well out from the square and beside the carriageway, each
    // with a companion so it is never a post alone in grass.
    for (const [dx, dy, mate, pal] of [
      // East moved up and out to the fork: the two carriageways diverge here
      // and leave a wedge of grass between them (clear dx 430-470 at dy 20-40,
      // sampled off roadCov), which reads as a junction rather than as a plain
      // stretch of kerb.
      [-92, -238, 'topiary_round', BLUEWHITE], [454, 28, 'topiary_round', YELLOW],
      [-330, 76, 'bench_01', WHITEBLUE], [-16, 236, 'signpost', MARKET],
    ]) {
      if (!set('lamppost_single', dx, dy, { flip: dx > 0, solid: [6, 5] })) continue;
      const side = dx > 0 ? -1 : 1;
      set(mate, dx + side * 36, dy + 14,
          { solid: mate === 'bench_01' ? [26, 9] : [17, 8], shadow: 7 });
      bed(9900 + Math.abs(dx), dx - side * 30, dy + 24, pal, 5, 16);
    }

    // A lane lamp at the bend in the east road, on the outside of the turn.
    // The coarse road rects describe that bend as a square step, but the
    // PAINTED road sweeps it into a diagonal — sampled from roadCov, the kerb
    // runs from about (dx 452, dy -38) down to (dx 340, dy 18). The first
    // attempt at dy -14 sat squarely on that paint and was rejected outright.
    // This stands on the grass wedge just above the kerb, flipped so the arm
    // and lantern reach back left over the corner rather than away from it.
    // NOTE the offset is one put() SNAPS TO: it rounds the world coordinate to
    // the 8-grid before testing clearance, so a spot that measures clear at an
    // arbitrary offset can still be rejected after snapping. Solved against
    // snapped positions — this one sits 8 units off the paint.
    set('lamppost_wood', 382, -20, { flip: true, solid: [6, 5] });

    // The farm's eastern boundary: a stone wall rather than more rail, so the
    // holding reads as closed on the side away from town. `_ns` is the
    // pre-rotated north-south cut — props only mirror, they cannot rotate.
    area('farm');
    for (let k = 0; k < 7; k++) {
      set('myst_wall_long_ns', 446, 96 + k * 37, { solid: [20, 10], holdOk: true });
    }

    // ---- THE CROP FIELD ---------------------------------------------------
    // Four beds around a walking cross. Laid on a strict lattice on purpose:
    // everything else on this site is deliberately irregular, and a field is
    // the one thing a town WOULD set out in rows — the straightness is what
    // makes it read as cultivated rather than wild.
    //
    // Plant spacing (17 x 15) is TIGHTER than the sprites are wide, so the
    // crops touch and overlap slightly. That is the whole difference between a
    // field and a grid of potted plants; at the old 24 x 22 every plant sat in
    // its own square of bare soil.
    //
    // Soil runs on its own coarser lattice, sized to reach a little past the
    // planting, so each bed gets a tilled margin instead of ending flush with
    // the outermost stalks. It goes down FLAT (it is ground) while the plants
    // stand as sorted entities, so the player passes behind the back rows and
    // in front of the near ones. Nothing here takes a solid — a field you
    // cannot walk into is a wall with vegetables painted on it.
    area('farm');
    {
      // EVERY pitch here is a multiple of the 8-unit snap grid, and every
      // offset lands on it — odd counts give whole multiples, even counts give
      // halves, which is why the even ones only use a 16 pitch (half of 16 is
      // still 8). put() snaps each prop to that grid, so a lattice that is not
      // aligned to it gets quantised unevenly: a 26 pitch came out 32/24/24/24
      // and tore visible slivers of grass through the middle of the beds.
      //
      // FY was 176, which put the top soil row at dy 52 — inside the road's
      // paint — so seven tiles of that row were silently rejected or nudged and
      // the beds came out with a torn top edge. One row further down clears it.
      const FX = 290, FY = 200;                 // field centre (both land on-grid)
      // The soil lattice is decoupled per axis. Square 24-pitch rows made each
      // bed 122 tall against planting that only reached 106, which left a bare
      // band of dirt running the full width above and below every bed. A
      // 16-pitch vertically brings the tilled ground to exactly the planting's
      // reach; the tiles overlap by 10, which is free now they are opaque and
      // their edges wrap.
      // The soil is deliberately SMALLER than the planting now. Pulled in at
      // the sides and pushed down at the back, so the crops overhang the bed
      // on three edges and only a lip of earth shows at the front. A plant
      // sitting wholly inside its patch of dirt reads flat; one breaking the
      // edge of it reads as standing up off the ground.
      const SC = 6, SSX = 16;                   // soil across: 5*16 + 26 = 106
      // One row FEWER down than across: the bed is trimmed top and bottom only,
      // so the crops break the earth at front and back while the sides keep
      // their margin. 4*16 + 26 = 90 against 106 across.
      const SR = 5, SSY = 16;                   // soil down:   4*16 + 26 = 90
      // The lip of bare earth at the FRONT of each bed equals this offset
      // exactly, and the back tuck is (sprite height - 26 + this). They are
      // locked together, so 8 was the smallest lip the snap grid could give.
      // The soil is therefore placed with `exact`, which skips snapping — the
      // lattice is computed on whole numbers anyway, so it stays perfectly
      // even and a 4 now survives instead of being rounded back out to 8.
      const SOFF = 8;                           // sits the shortened bed on the plant bases
      const PC = 7, PR = 6, PP = 16;            // planting, tighter than the sprites
      const GAP = 30;                           // clear walking lane between beds
      // Spacing is measured off the planting, not the soil, because the plants
      // are now the wider thing and they are what the eye reads as the bed.
      const OFFX = 76, OFFY = 68;               // both keep bed centres on-grid
      const BEDS = [
        [-1, -1, 'crop_carrot'], [1, -1, 'crop_cabbage'],
        [-1, 1, 'crop_wheat_01'], [1, 1, 'crop_mature_01'],
      ];
      for (const [sx, sy, crop] of BEDS) {
        const bx = FX + sx * OFFX, by = FY + sy * OFFY;
        // tilled ground: a solid, edge-wrapping tile, so the bed is one worked
        // surface rather than a grid of separate pads
        for (let j = 0; j < SR; j++) for (let i = 0; i < SC; i++) {
          set('soil_plot', bx + (i - (SC - 1) / 2) * SSX, by + (j - (SR - 1) / 2) * SSY + SOFF,
              { flat: true, flip: (i + j) % 3 === 0, exact: true });
        }
        // then the crop, pitched tighter than the sprites are wide so the
        // plants touch, and mirrored per plant so the rows are not a stamp
        // ---- the bed's fence ----------------------------------------------
        // Every piece in this pack is drawn FRONT-ON — there is no sprite for a
        // fence running away from camera — so the back and front rails are
        // proper runs and the sides are the picket block stacked down. The run
        // facing the central crossing is left OPEN rather than gated: these
        // beds are worked from the path, and a closed rail there would mean the
        // player could not step in at all.
        // The rail is 52 wide, so a 44 pitch threw the run out to +/-70 against
        // a bed that is only +/-53 of soil and +/-58 of planting — the fence
        // stuck out a dozen units past its own field at each end. A 34 pitch
        // lands the outer edge on +/-60: just past the crop and no further.
        const FL = bx - 60, FR = bx + 60;        // fence rectangle, just past the field
        const RP = 34;                           // rail pitch
        const FT = by - 54, FB = by + 46;
        // Back rail runs unbroken; the front carries the gate. The gate sprite
        // is already rail-post-door-post-rail, so it drops straight into the
        // run in place of the middle segment and the flanking rails overlap it
        // enough to read continuous.
        for (let i = -1; i <= 1; i++) {
          set('fence_run', bx + i * RP, FT, { solid: [36, 5], shadow: 0, holdOk: true });
        }
        set('fence_run', bx - RP, FB, { solid: [36, 5], shadow: 0, holdOk: true });
        set('fence_run', bx + RP, FB, { solid: [36, 5], shadow: 0, holdOk: true });
        // The gate is SHUT. The beds are enclosed on every side — the lanes
        // between them stay walkable, but the crop itself is not public ground.
        set('fence_gate', bx, FB, { solid: [54, 5], shadow: 0, holdOk: true });
        // Sides are a line of POSTS, not stacked picket sections. The picket
        // block is a face-on fence 38 units wide; stacking it built a wooden
        // wall two player-widths thick that swallowed the walking gap. A run of
        // posts is how a fence going away from camera reads in this view, and
        // at 5 wide it costs the path nothing. Only the outer side is fenced —
        // the bed stays open to the crossing it is worked from.
        for (let k = 0; k < 9; k++) {
          const yy = FT + 10 + k * 12;
          if (yy > FB) break;
          set('fence_post', FL + 2, yy, { shadow: 0, holdOk: true });
          set('fence_post', FR - 2, yy, { shadow: 0, holdOk: true });
        }
        // ONE solid per edge, not one per prop. The individual rail and post
        // boxes left 8-unit holes at the rail ends and 7-unit holes between
        // posts, and the player walked straight through them — measured, only
        // 5 of 20 edge samples actually blocked. A closed rectangle is
        // unambiguous, and it is what makes this a holding you cannot enter.
        {
          const wx = FC.x + bx, wyT = FC.y + FT, wyB = FC.y + FB;
          this.solids.push(
            { x: wx - 62, y: wyT - 4, w: 124, h: 8 },          // back rail
            { x: wx - 62, y: wyB - 4, w: 124, h: 8 },          // front rail + gate
            { x: wx - 64, y: wyT, w: 8, h: wyB - wyT },        // west posts
            { x: wx + 56, y: wyT, w: 8, h: wyB - wyT },        // east posts
          );
        }

        // Alternate rows interlock instead of lining up in a lattice — that is
        // how a bed is actually drilled, and the broken columns are what stop
        // it reading as a flat tiling. The staggered rows carry one plant FEWER
        // and sit inset by half a pitch, which keeps both edges of the bed
        // straight; simply shifting a full-length row sideways left every other
        // row poking 8 units past the right-hand edge. Half of 16 is 8, so both
        // arrangements still land on the snap grid.
        for (let j = 0; j < PR; j++) {
          const odd = j % 2 === 1;
          const n = odd ? PC - 1 : PC;
          for (let i = 0; i < n; i++) {
            set(crop, bx + (i - (n - 1) / 2) * PP, by + (j - (PR - 1) / 2) * PP,
                // No contact shadow: tried one, and a dark ellipse on dark
                // tilled soil is invisible — 168 extra draws and nothing to see.
                { flip: (i * 3 + j) % 2 === 0, shadow: 0 });
          }
        }
      }
    }

    if (MID) {
      area('mid');
      // ---- MID DETAIL ----------------------------------------------------
      // Strengthens what already exists; creates nothing new. Bushes go to
      // trunks, rocks to tree bases and garden edges, deadfall to the belt.
      const trees = this.decor.filter((d) => /^tree_/.test(d.name));
      trees.forEach((t, i) => {
        const h1 = hash(12000 + i * 5), h2 = hash(12001 + i * 5), h3 = hash(12002 + i * 5);
        const n = h1 < 0.30 ? 0 : h1 < 0.72 ? 1 : 2;
        for (let j = 0; j < n; j++) {
          const a = (h2 + j * 0.5) * Math.PI * 2, rr = 14 + h3 * 20;
          grow(pick(['bush_01', 'bush_02', 'bush_03', 'bush_low', 'bush_big', 'fern_clump'], h3 + j * 0.3),
               t.x - FC.x + Math.cos(a) * rr, t.y - FC.y + Math.sin(a) * rr * 0.62,
               { flip: h2 > 0.5, road: 24 }, 0.62);
        }
      });
      // rocks: seven clusters, all anchored to a canopy or a garden edge
      for (const [dx, dy] of [[-300, -218], [-372, 74], [-300, 240], [352, -212],
                              [402, 152], [-186, 152], [286, -232]]) {
        const h1 = hash(13000 + dx), h2 = hash(13001 + dx);
        if (!grow('rock_med_01', dx, dy, { flip: h1 > 0.5, road: 24 }, 0.5)) continue;
        grow(pick(['rock_small_01', 'rock_small_02', 'rock_small_03'], h2), dx + 16, dy + 8,
             { flip: h2 > 0.5, road: 22 }, 0.55);
        if (h1 > 0.5) grow(pick(['rock_small_02', 'rock_small_03'], h1), dx - 14, dy + 11,
                           { road: 22 }, 0.55);
      }
      // deadfall belongs to the belt and nowhere near the gardens
      for (const [nm, dx, dy] of [['fallen_log_01', -206, -232], ['tree_stump_01', -390, 82],
                                  ['fallen_log_02', -298, 254], ['tree_stump_02', 372, -206],
                                  ['fallen_branch', 430, 160], ['twig_pile', -238, -190]]) {
        grow(nm, dx, dy, { road: 24, shadow: 9 }, 0.5);
      }
      // secondary flower colour, at the edges of the masses only
      bed(14100, -352, -232, BLUE, 6, 20);
      bed(14200, 380, -252, YELLOW, 5, 18);
      bed(14300, -368, 262, WHITEBLUE, 6, 20);
      bed(14400, 300, 236, MARKET, 6, 20);
    }

    if (MICRO) {
      area('micro');
      // ---- MICRO DETAIL --------------------------------------------------
      // Boundaries only: where a mass meets lawn, and where grass meets stone.
      // Never in the middle of a designated lawn, and never on the paving.
      let mk = 15000;
      for (let i = 0; i < 150; i++) {
        const h1 = hash(mk++), h2 = hash(mk++), h3 = hash(mk++);
        const a = h1 * Math.PI * 2, rr = 150 + h2 * 300;
        const dx = Math.cos(a) * rr, dy = Math.sin(a) * rr * 0.62;
        if (Math.abs(dx) > 440 || Math.abs(dy) > 250) continue;
        grow(pick(['grass_tuft_01', 'grass_tuft_02', 'grass_tuft_03', 'grass_tuft_04',
                   'weeds_01', 'weeds_02'], h3), dx, dy,
             { flat: true, flip: h3 > 0.5, road: 14 }, 0.75);
      }
    }

    this.propGroups.push({ fn: (g) => {
      for (const d of this.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
    } });
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
      case 'library': this.hero.save(); if (this.hooks.toLibrary) this.hooks.toLibrary(); break;
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

    // The transform the scene was handed, before its own camera scale/translate.
    // The night pass composites in this space (same one the HUD draws in), so a
    // screen-sized buffer lands 1:1 on the frame whatever the camera zoom is.
    this._baseTf = g.getTransform ? g.getTransform() : null;

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
    for (const d of this.decor) ents.push({ y: d.sortY, draw: (gg) => drawPropArt(gg, DECOR_ART[d.name], d.x, d.y, d.w, d.h, d.shadow, d.flip) });
    for (const n of this.npcs) ents.push({ y: n.y, draw: (gg) => { contactShadow(gg, n.x, n.y, 6, 2); drawActor(gg, { x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, weapon: n.sprite === 'warrior' ? 'sword' : (n.sprite === 'mage' ? 'staff' : 'none'), state: 'idle', animTime: this.t + n.x }); } });
    for (const p of this.sanctuaryPets) ents.push({ y: p.y, draw: (gg) => drawPet(gg, p, p.x, p.y, this.t) });
    ents.push({ y: this.py, draw: (gg) => this._drawPlayer(gg) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw(g);

    // Nightfall. Runs on the FINISHED frame and changes nothing but the light —
    // every prop, road and sprite is exactly where the daytime pass put it.
    drawNight(this, g, Z);

    this._drawNearPrompt(g);

    // development-only overview overlay (labels + road centerlines)
    if (typeof window !== 'undefined' && window.__townDebug) this._drawDebugOverview(g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);
    for (const [x, y, hue, r] of this.crystalGlows) crystalGlow(g, x, y, this.t, hue, r);
    for (const b of this.butterflies) drawButterfly(g, b, this.t);

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
  }

  // The interaction prompt is world-space UI, drawn AFTER the depth-sorted
  // pass: it used to be painted inside _drawLocation, where anything south of
  // the location (the Eldertree's colonnade, plaza planting by the fountain)
  // could draw over the text.
  _drawNearPrompt(g) {
    const loc = this.near;
    if (loc) {
      const label = loc.label || { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest', house: 'Enter Your House' }[loc.action] || 'Enter';
      const w = textWidth('[E] ' + label) + 12;
      // at the location's foot, but never over the player: when they stand
      // south of the point (inside the near radius) drop it below their feet
      const py = Math.max(loc.dy + 2, this.py + 3);
      panel(g, loc.dx - w / 2, py, w, 13, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, '[E] ' + label, loc.dx, py + 3, { color: blink ? UI.gold : UI.ink, align: 'center' });
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
    // grass_04 is the patchy tile — bare scrapes of dirt showing through. That
    // is right for open country and wrong for the town centre, where it reads
    // as lawn nobody tends and undercuts the clipped hedge and bedding it sits
    // beside. Inside the plaza district it rolls to plain grass instead. The
    // swap is by tile centre, so the boundary follows the tile grid and never
    // splits one tile between two treatments.
    const FCg = this.plazaFocus, KEPT = 360;
    for (let rr = gr0; rr <= gr1; rr++) {
      for (let cc = gc0; cc <= gc1; cc++) {
        const hv = hash(cc * 12.7 + rr * 7.3);
        let idx = hv < 0.42 ? 0 : hv < 0.84 ? 1 : hv < 0.94 ? 2 : 3;
        if (idx === 3 && FCg
            && Math.hypot((cc + 0.5) * GRASS_TILE - FCg.x, (rr + 0.5) * GRASS_TILE - FCg.y) < KEPT) idx = 0;
        const tile = GRASS_TILES[idx];
        if (!tile.ready) continue;
        g.drawImage(tile.img, cc * GRASS_TILE, rr * GRASS_TILE, GRASS_TILE, GRASS_TILE);
      }
    }

    // The Lake: pure ground/environment artwork, drawn flat under everything
    // depth-sorted (buildings, trees, the player) so it can never render over
    // them — see the class comment on POND_ART/POND_WATER_RECTS above for
    // provenance.
    //
    // The ambient water layer (procedural ripples, breaking waves, bubbles,
    // surface glint) is deliberately not drawn: disturbances are going to come
    // from what's actually in the scene — animals and environment — rather than
    // appearing on their own. proceduralRipples() is still in gfx/waterfx.js
    // for when that's built. The fish carries its own ripples, in its sheet.
    if (POND_ART.ready) {
      g.drawImage(POND_ART.img, Math.round(this.lakeTopLeft.x), Math.round(this.lakeTopLeft.y), POND_W, POND_H);
      if (!POND_MASK_INFO) POND_MASK_INFO = buildWaterMask(POND_ART.img);
      // Extra lily pads from assets/pond vegg.png, straight after the art and
      // before anything living so the fish, ducks and frogs are on top of them.
      // The frogs treat these as somewhere to jump, not just as scenery.
      drawPondPads(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H);
      // Fish break the surface from spots around the lake (assets/fish1.png).
      // They draw above the water but still in the ground pass, which is fine —
      // the lake is solid, so the player can never stand between the two.
      drawFishJump(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H, this.t);
      // Ducks live on the lake full-time (assets/duck.png) — paddling, looking
      // about, dipping and dabbling.
      drawDucks(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H, this.t);
      // Frogs sit out on the lily pads (assets/frog.png), one to a cluster.
      // Last, so a frog is never hidden by the bird swimming past its pad.
      drawFrogs(g, POND_MASK_INFO, this.lakeTopLeft.x, this.lakeTopLeft.y, POND_W, POND_H, this.t);
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
    drawRoads(this, g, visW, visH);

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

// ---- The Eldertree -------------------------------------------------------
// The grand crystal tree on its dais, from the Mystical Tree sheet, plus a
// pure-t animation overlay in the same idiom as the fountain's: additive
// glow only (no scale, no move, no blur) on the crystals that grow from the
// trunk, and a slow drift of motes rising through the canopy. Crystal
// positions are measured off the source art (532x603, drawn at 176x200) and
// expressed as offsets from the base anchor (cx, baseY).
const ELDER_CRYSTALS = [
  // [dx, dy, r, hue] — measured from the baked sprite (opaque cyan / violet
  // pixel clusters, centroid + area), so the glow sits on the gems themselves
  [-31, -114, 3, 'c'], [5, -100, 4, 'c'], [18, -110, 3, 'v'],
  [-16, -86, 3, 'c'], [12, -80, 3, 'v'], [-11, -71, 3, 'c'], [14, -67, 3, 'c'],
  [-23, -64, 3, 'c'], [-4, -61, 3, 'v'], [16, -39, 3, 'c'],
  // the two hanging in the canopy (art has them at the crown's left/right)
  [-46, -166, 2, 'c'], [66, -150, 2, 'c'],
];
const ELDER_HUE = { c: ['#aef4ff', '#e8fdff'], v: ['#c9a0ff', '#efe0ff'] };
function drawEldertree(g, cx, baseY, t) {
  const art = DECOR_ART.mystic_tree_grand;
  if (!art.ready) return;
  g.drawImage(art.img, Math.round(cx - 88), Math.round(baseY - 200), 176, 200);
  g.save();
  g.globalCompositeOperation = 'lighter';
  // 1. crystal pulse: each gem breathes on its own phase, ~2.5s loop
  for (let i = 0; i < ELDER_CRYSTALS.length; i++) {
    const [dx, dy, r, h] = ELDER_CRYSTALS[i];
    const p = Math.sin(t * (2 * Math.PI / 2.5) + i * 1.7) * 0.5 + 0.5;
    g.globalAlpha = 0.05 + p * 0.09;
    disc(g, cx + dx, baseY + dy, r * 2.2, ELDER_HUE[h][0]);
    g.globalAlpha = 0.10 + p * 0.16;
    disc(g, cx + dx, baseY + dy, r, ELDER_HUE[h][1]);
  }
  // 2. the heart glow: a soft standing light at the root cluster, so the
  // whole trunk base reads as lit from within
  const hp = Math.sin(t * 0.9) * 0.5 + 0.5;
  g.globalAlpha = 0.045 + hp * 0.03;
  disc(g, cx - 2, baseY - 74, 30, '#8fe8ff');
  g.globalAlpha = 1;
  g.restore();
  // 3. motes: rise out of the trunk crystals on a gentle sway, fade in and
  // out, glint at their brightest. Same recipe as the fountain's fxMotes,
  // spread across the whole crown since this is a much bigger subject.
  const N = 7;
  for (let i = 0; i < N; i++) {
    const period = 3.4 + i * 0.41;
    const loop = Math.floor((t + i * 2.9) / period);
    const phase = ((t + i * 2.9) % period) / period;
    const seedX = hash(i * 8.3 + loop * 5.7);
    const seedC = hash(i * 4.9 + loop * 7.3 + 2);
    const col = MOTE_COLORS[Math.floor(seedC * MOTE_COLORS.length)];
    const x0 = (seedX * 2 - 1) * 46;
    const rise = phase * 84;
    const sway = Math.sin(phase * Math.PI * 3 + i * 1.3) * 3;
    const px = Math.round(cx + x0 + sway);
    const py = Math.round(baseY - 58 - rise);
    const a = Math.sin(phase * Math.PI);
    g.globalAlpha = a * 0.9;
    rect(g, px, py, 2, 2, col.core);
    if (a > 0.85) {
      g.globalAlpha = (a - 0.85) * 5;
      rect(g, px - 2, py, 6, 2, col.glint);
      rect(g, px, py - 2, 2, 6, col.glint);
    }
  }
  g.globalAlpha = 1;
}

// ---- Butterflies ---------------------------------------------------------
// Six-frame flap strips (12x9 per frame) baked from assets/butterfly.png.
// Each butterfly owns a home point and wanders around it on two slow sine
// octaves — never a straight line, never the same loop twice in a row to the
// eye — with a bob that follows the wingbeat. They are drawn in the overlay
// pass: they fly, so nothing on the ground should ever draw over them.
const BUTTERFLY_ART = {};
for (const n of ['blue', 'violet', 'gold', 'white']) BUTTERFLY_ART[n] = loadBuildingArt(`assets/props/butterfly_${n}.png`);
const BF_W = 12, BF_H = 9;
function drawButterfly(g, b, t) {
  const art = BUTTERFLY_ART[b.col];
  if (!art.ready) return;
  const tt = t * b.speed + b.phase;
  // wander: two octaves, unrelated periods, so the path never closes visibly
  const x = b.x + Math.sin(tt * 0.31) * b.rx + Math.sin(tt * 0.83 + 1.7) * b.rx * 0.35;
  const y = b.y + Math.cos(tt * 0.23 + 0.6) * b.ry + Math.sin(tt * 0.71) * b.ry * 0.3;
  // wingbeat: ~7 flaps/s over the four TOP-DOWN frames only (open, half,
  // half, open) — the strip's edge-on frames 2/3 read as a vertical sliver
  // at this size and are skipped; the body dips a pixel on the closed beat
  const FLAP = [0, 1, 4, 5];
  const k = Math.floor((t * 7 + b.phase) % 4);
  const f = FLAP[k];
  const bob = k === 1 ? 1 : 0;
  // face the direction of travel (dx sign) by mirroring
  const dx = Math.cos(tt * 0.31) * b.rx * 0.31 + Math.cos(tt * 0.83 + 1.7) * b.rx * 0.35 * 0.83;
  const px = Math.round(x), py = Math.round(y + bob);
  contactShadow(g, px, py + 6, 3, 1, 0.14);
  g.save();
  if (dx < 0) { g.translate(px, 0); g.scale(-1, 1); g.translate(-px, 0); }
  g.drawImage(art.img, f * BF_W, 0, BF_W, BF_H, px - BF_W / 2, py - BF_H / 2, BF_W, BF_H);
  g.restore();
}

// Ground crystal clusters glow the same way, drawn in the overlay pass with
// the lamps so the light sits on top of whatever grows around them.
function crystalGlow(g, x, y, t, hue, r) {
  const p = Math.sin(t * 2.1 + x * 0.05) * 0.5 + 0.5;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.05 + p * 0.06;
  disc(g, x, y - r * 0.5, r * 1.6, ELDER_HUE[hue][0]);
  g.globalAlpha = 0.08 + p * 0.10;
  disc(g, x, y - r * 0.6, r * 0.7, ELDER_HUE[hue][1]);
  g.restore();
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
// Per-angle radius wobble that keeps the plaza from reading as a perfect
// circle. It only ever bumps the edge OUTWARD (1.00 to 1.05), never inward:
// the road flares are built assuming the paving reaches at least R at every
// angle, so an inward dip left a wedge of bare grass between a flare's side
// and the circle — visible as holes punched around the fountain at each of
// the four road mouths.
function plazaEdgeJitter(a) {
  return 1 + Math.abs(hash(Math.floor(a * 6.37) * 3.1 + 0.5) - 0.5) * 0.1;
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
