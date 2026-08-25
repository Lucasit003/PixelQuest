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

// ---------------------------------------------------------------------------
// DEMOLITION SWITCH
//
// Holds the whole plaza clear of dressing so it can be rebuilt from bare
// ground, keeping only the four crop plots and the fences that enclose them.
//
// Done as a switch rather than by deleting the dressing code, for three
// reasons. buildPlazaDecor is an authored level another session is actively
// extending — cutting it would throw away their market nook, traveller camp,
// memorial garden and forest edge along with everything else. Reverting is one
// word here versus reconstructing a thousand lines. And every composition
// decision stays on disk to be read while the corner is rebuilt.
//
// Roads, the fountain and every gameplay LOCATION survive untouched: none of
// them are placed through put(), and stripping the buildings would take the
// Archive and the Eldertree with them — that is where mastery is learnt and
// spent, so the game would no longer be completable. Deliberately out of scope
// for a dressing pass; say the word if they should go too.
export const PLAZA_STRIP = true;

// The four beds sit on a lattice centred at (290, 200) with +/-76 by +/-68 bed
// offsets and a fence rectangle of +/-60 by -54..+46 around each, so this box
// with a little margin is exactly the field and nothing else. fence_run is used
// elsewhere on the site too, which is why the fence rule is positional rather
// than by name.
const FARM = { x0: 140, x1: 442, y0: 58, y1: 332 };
const inFarm = (dx, dy) => dx > FARM.x0 && dx < FARM.x1 && dy > FARM.y0 && dy < FARM.y1;

export function stripKeep(name, dx, dy) {
  if (!PLAZA_STRIP) return true;
  if (/^(crop_|soil_plot)/.test(name)) return true;
  return /^fence/.test(name) && inFarm(dx, dy);
}

// Ambient life is not placed through put(), so it has to be cleared separately.
// Filtered by position rather than emptied: these arrays are map-wide, and the
// lake, river and ancient city fill them too — emptying them would silently
// strip three districts nobody asked about.
export function stripAmbient(scene, FC) {
  if (!PLAZA_STRIP) return null;
  const onPlaza = (x, y) => {
    const dx = x - FC.x, dy = y - FC.y;
    return Math.abs(dx) < 470 && dy > -300 && dy < 350 && !inFarm(dx, dy);
  };
  const before = {
    npcs: scene.npcs.length, trees: scene.trees.length,
    lamps: scene.lamps.length, braziers: scene.braziers.length,
    butterflies: scene.butterflies.length, crystals: scene.crystalGlows.length,
  };
  scene.npcs = scene.npcs.filter((n) => !onPlaza(n.x, n.y));
  scene.trees = scene.trees.filter((t) => !onPlaza(t.x, t.y));
  scene.lamps = scene.lamps.filter(([x, y]) => !onPlaza(x, y));
  scene.braziers = scene.braziers.filter(([x, y]) => !onPlaza(x, y));
  scene.butterflies = scene.butterflies.filter((b) => !onPlaza(b.x, b.y));
  scene.crystalGlows = scene.crystalGlows.filter(([x, y]) => !onPlaza(x, y));

  return {
    npcs: before.npcs - scene.npcs.length, trees: before.trees - scene.trees.length,
    lamps: before.lamps - scene.lamps.length, braziers: before.braziers - scene.braziers.length,
    butterflies: before.butterflies - scene.butterflies.length,
    crystals: before.crystals - scene.crystalGlows.length,
  };
}

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
  if (PLAZA_STRIP) return { stripped: true };
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

// ---------------------------------------------------------------------------
// Props from NEIGHBOURING districts stand inside the plaza's frame too: the
// riverbank planting reaches in from the west with trees, nv_ scrub, mushrooms
// and rocks. They are placed by riverdecor.js and its siblings, never by
// plaza.js's put(), so the demolition switch cannot see them.
//
// This MUST run after buildTown rather than inside buildPlazaDecor. layout.js
// plants the river, bridge, waterfall and riverfront AFTER the plaza pass —
// the plaza deliberately resets scene.decor, so everything riverside has to
// come later. A filter inside the plaza pass therefore removes nothing,
// because the props do not exist yet. That cost a full verification round:
// the cut ran, reported success, and the trees were still standing.
//
// Cut on the WEST side only. The Ancient City's wall and paving reach into the
// frame's top-RIGHT (dx +240..+466) and that district is being actively
// rebuilt, so its edge is left intact. The bounds also stop well short of the
// lake and the river proper — the lake's centre is dx -750 — so this clears
// what leans into the plaza without reaching the districts it belongs to.
// ---------------------------------------------------------------------------
export function stripPlazaFrame(scene, FC) {
  if (!PLAZA_STRIP || !FC) return null;
  const inFrame = (d) => {
    const dx = d.x - FC.x, dy = d.y - FC.y;
    return dx < -60 && dx > -520 && dy > -320 && dy < 360;
  };
  const before = scene.decor.length + scene.groundDecor.length;
  scene.decor = scene.decor.filter((d) => !inFrame(d));
  scene.groundDecor = scene.groundDecor.filter((d) => !inFrame(d));
  const tBefore = scene.trees.length;
  scene.trees = scene.trees.filter((t) => !inFrame(t));
  return { props: before - (scene.decor.length + scene.groundDecor.length),
           trees: tBefore - scene.trees.length };
}
