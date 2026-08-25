// The Crystal Plaza's two living corners: the north-west flower garden and the
// south-east farmyard.
//
// This lives outside plaza.js on purpose. buildPlazaDecor is an authored level
// that another workstream is actively extending, and the two corners dressed
// here sit right beside sections it owns (the market nook in the north-west,
// the working farm in the south-east). Keeping the additions in their own file
// means plaza.js takes two lines instead of two hundred, and the two passes can
// be read, reverted or re-tuned independently of each other.
//
// The dressing helpers are closures over buildPlazaDecor's state — the snapped
// grid, the road coverage, the `placed` list every clearance test reads — so
// they are passed in rather than rebuilt. Rebuilding them would mean a second
// set of placement rules that could silently disagree with the first.
//
// Everything is placed through station(): a list of candidate offsets, first
// one that fits wins. A single hard-coded point fails SILENTLY when the spot is
// taken, and a load-bearing prop that quietly never places is the most common
// way a dressing pass ends up looking like nothing happened.

import { hash } from './primitives.js';

// Warm palettes, chosen against what MASS A already has. The civic garden is
// entirely blue and white today; reading as a FLOWER garden rather than a lawn
// with beds on it needs colour that argues with that, not more of it.
const WARM = ['flowers_red', 'flowers_yellow', 'flowers_red', 'flowers_mixed'];
const SUNNY = ['flowers_yellow', 'flowers_yellow', 'flowers_white', 'flowers_mixed'];
const MIXED = ['flowers_mixed', 'flowers_red', 'flowers_blue', 'flowers_yellow'];
const SOFT = ['grass_bloom_01', 'grass_bloom_02', 'grass_bloom_03', 'flowers_white'];

// ---------------------------------------------------------------------------
// NORTH-WEST: the flower garden
//
// MASS A is already built as a room — canopy along the back and west, three
// blue beds inside it, a clearing in the middle, open side facing the plaza.
// It reads as a park. Turning it into a garden means giving it the three things
// a garden has and a park does not: a way IN that announces itself, a route
// through it, and colour dense enough to be the point rather than the trim.
//
// The clearing is deliberately left empty. Massing detail against genuinely
// open ground is what makes the detail read; filling it would flatten the whole
// composition back to an even field of props.
// ---------------------------------------------------------------------------
export function dressFlowerGarden(scene, FC, H) {
  const { area, set, bed, station } = H;
  area('nw');
  const n = { arch: 0, beds: 0, path: 0, trim: 0, wings: 0 };

  // ---- the way in ---------------------------------------------------------
  // On the garden's plaza-facing edge, on the line a player walks up from the
  // fountain. The first attempt put this at dx -210 and it vanished: that spot
  // is boxed in by the market nook's crates and two solids, so the arch placed
  // successfully and was never visible. Candidates now run along the whole open
  // south edge, widest gaps first.
  const arch = station('myst_arch_vine', [
    [-228, -40], [-244, -36], [-212, -44], [-260, -40], [-196, -52],
    [-276, -44], [-180, -36], [-292, -36], [-164, -48], [-308, -44],
  ], { shadow: 9 });
  if (arch) {
    n.arch = 1;
    const [ax, ay] = arch;
    // Topiary flanking the opening. Formal, clipped, and the strongest signal
    // available that the ground beyond is tended rather than merely grassy.
    if (station('topiary_round', [[ax - 40, ay + 4], [ax - 48, ay - 6], [ax - 34, ay + 16]], { shadow: 7 })) n.wings++;
    if (station('topiary_round', [[ax + 40, ay + 4], [ax + 48, ay - 6], [ax + 34, ay + 16]], { flip: true, shadow: 7 })) n.wings++;

    // ---- the route through ------------------------------------------------
    // Two earlier attempts failed here, both for material reasons rather than
    // placement ones. pebbles_01 is a single 11x10 ROCK, so fourteen of them
    // strung over two hundred units read as litter, not a walk. Replacing them
    // with the unused myst_path flagstones fixed the material but kept a
    // DIAGONAL route — and these tiles are axis-aligned rectangles, so a
    // diagonal run staggers them into disconnected steps no matter how the
    // spacing is tuned.
    //
    // So the walk turns instead of leaning: north out of the arch, one corner,
    // then west into the beds. Both tiles are 37 long in their own direction,
    // stepped at 30 to butt with a little overlap. Laid flat, so they sort
    // under everything and pass beneath the market nook's crates rather than
    // fighting them, and exact:true keeps them off the 8-grid — snapping a
    // 37-long tile quantises unevenly and tears grass slivers through the run.
    const CY = -128;                       // the corner's latitude
    for (let y = ay - 22; y > CY + 12; y -= 30) {
      if (set('myst_path_straight', ax, y, { flat: true, exact: true })) n.path++;
    }
    // The elbow is made by letting the two runs overlap, not by myst_path_cross:
    // a cross sprouts stub arms east and south that promise paths which do not
    // exist, and one of them points straight into the market stall.
    if (set('myst_path_straight', ax, CY + 14, { flat: true, exact: true })) n.path++;
    for (let x = ax - 32; x > -336; x -= 30) {
      if (set('myst_path_straight_ew', x, CY, { flat: true, exact: true })) n.path++;
    }
  }

  // ---- the colour ---------------------------------------------------------
  // Drifts, not dots: each bed is one palette so it reads as a mass of one
  // flower at a distance, and the palettes are placed to alternate warm against
  // the existing blue rather than blending into it.
  for (const [seed, dx, dy, pal, count, spread] of [
    [7100, -238, -212, WARM,  11, 30],   // north edge, between the oaks
    [7200, -356, -178, SUNNY,  9, 26],   // west edge, behind the bench
    [7300, -302, -48,  MIXED, 10, 28],   // south edge, facing the plaza
    [7400, -166, -158, SUNNY,  7, 22],   // east edge, by the young tree
    [7500, -264, -196, SOFT,   6, 20],   // soft filler against the big blue bed
    [7600, -344, -84,  WARM,   6, 20],   // west corner
  ]) n.beds += bed(seed, dx, dy, pal, count, spread);

  // ---- the trim -----------------------------------------------------------
  // Boxes and planters read as CULTIVATION — someone chose to put a plant
  // there — which is the difference between a garden and a meadow. They line
  // the walk rather than scattering, because that is what edging is for.
  for (const [name, cands] of [
    ['flower_box_01', [[-208, -96], [-222, -86], [-196, -108]]],
    ['flower_box_02', [[-286, -84], [-274, -72], [-298, -96]]],
    ['planter_01',    [[-240, -108], [-252, -98], [-228, -120]]],
    ['planter_02',    [[-316, -140], [-328, -128], [-306, -152]]],
    ['flower_box_01', [[-180, -128], [-168, -116], [-192, -140]]],
  ]) if (station(name, cands, { shadow: 6 })) n.trim++;

  // A single specimen tree in a bed, off the clearing's centre so it decorates
  // the room without standing in the middle of it.
  if (station('tree_flowerbed', [[-306, -158], [-320, -170], [-292, -146]], { shadow: 11 })) n.trim++;

  // ---- the movement -------------------------------------------------------
  // Butterflies already exist, are free, and are the one ambient effect that
  // belongs over flowers specifically. Massing them here rather than spreading
  // them evenly is what makes the garden feel like the place they came for.
  for (let i = 0; i < 9; i++) {
    const h1 = hash(6100 + i * 5.7), h2 = hash(6300 + i * 3.3), h3 = hash(6500 + i * 7.1);
    scene.butterflies.push({
      x: FC.x - 190 - h1 * 170,
      y: FC.y - 60 - h2 * 160,
      col: ['blue', 'violet', 'gold', 'white'][Math.floor(h3 * 4) % 4],
      rx: 14 + h1 * 16, ry: 9 + h2 * 11,
      speed: 0.7 + h3 * 0.6, phase: h1 * 6.28,
    });
  }
  n.butterflies = 9;
  return n;
}
