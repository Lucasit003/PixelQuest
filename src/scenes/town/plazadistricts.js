// The four districts around the Crystal Plaza: garden, market, farm, homes.
//
// WHY THIS IS ITS OWN FILE
//
// plaza.js is a thousand-line authored level with another session's
// uncommitted work in it, and plazalife.js is that session's too. Neither is
// safe to edit. This pass therefore owns no existing line: it is called once
// from town.js and pushes straight into scene.decor / groundDecor / solids,
// the same arrays every other dressing pass writes to.
//
// The call site matters. plazalife.js runs two demolition switches over this
// ground — stripKeep() rejects anything routed through plaza.js's put(), and
// stripPlazaFrame() filters scene.decor by position AFTER buildTown returns.
// So this pass is invoked from town.js *after* stripPlazaFrame, where neither
// switch can reach it. Nothing here depends on those switches being off, and
// nothing here is removed when they are turned off.
//
// GEOMETRY, MEASURED NOT GUESSED
//
// A coarse occupancy sweep of _nearAnyRoad around the fountain gives the real
// road layout: one N-S avenue at dx -20..0 running the full height, and one
// E-W road at dy -80..-40 running the full width. They cross at the fountain,
// which quarters the ground into exactly the four districts this file dresses:
//
//        NW  formal garden   |   NE  market            dy < -120
//        ------------------- + -------------------     the E-W road
//        SW  homes           |   SE  farm              dy > 120
//                          dx -20..0, the avenue
//
// Every placement still tests _nearAnyRoad before committing, so the districts
// stay off the carriageway even if a road is later re-routed.

import { hash, loadBuildingArt } from './primitives.js';
import { DECOR_SIZE } from './props.js';

// District boxes, as offsets from the fountain. Taken from the occupancy sweep
// above, inset far enough that nothing overhangs a carriageway.
// Two of the four quadrants were built and then taken back out on direction:
// the north-east market and the south-west homes. Their ground is deliberately
// left to the tree masses and the ground-texture scatter, which is why they are
// absent from this map rather than present with empty contents — `inAnyDistrict`
// reads it, so dropping them here is what lets the scatter plant that ground.
export const DISTRICTS = {
  garden: { x0: -516, x1: -80, y0: -408, y1: -120 },
  farm: { x0: 90, x1: 460, y0: 40, y1: 340 },
};


// The two quadrants that were built and then cleared on direction: the
// north-east and the south-west. Cleared means CLEARED — no tree framing and
// no ground texture either, so they return to raw grass.
//
// Quadrants are defined off the road cross that actually quarters this ground
// (the avenue at dx -20..0, the E-W road at dy -80..-40), not off the district
// boxes, so the test still means the right thing now that two of those boxes
// are gone. The radius guard keeps the fountain's own ring out of it: the ring
// spans r 120-178 and parts of it fall inside both quadrant wedges.
function inClearedQuadrant(dx, dy) {
  if (Math.hypot(dx, dy) < 185) return false;   // never touch the fountain ring
  const ne = dx > 0 && dy < -80;
  const sw = dx < -20 && dy > -40;
  return ne || sw;
}

const RING_IN = 120;   // keep the fountain's own stone clear to here
const RING_OUT = 178;  // and dress the band out to here

export function buildPlazaDistricts(scene) {
  // Anchor on plazaCenter, NOT plazaFocus. The occupancy sweep that produced
  // the district boxes above was measured from plazaCenter, and plazaFocus
  // sits 50 units north of it — anchoring on the wrong one silently shifts
  // every district off the clear ground it was fitted to.
  const FC = scene.plazaCenter;
  if (!FC) return null;
  const before = scene.decor.length + scene.groundDecor.length;

  // Road test in world space. Anything that would sit on a carriageway is
  // dropped rather than nudged: a nudged prop lands somewhere nobody composed.
  const onRoad = (dx, dy, pad = 22) =>
    typeof scene._nearAnyRoad === 'function' && scene._nearAnyRoad(FC.x + dx, FC.y + dy, pad);

  const put = (name, dx, dy, opts = {}) => {
    const size = DECOR_SIZE[name];
    if (!size) return false;                       // never place art that is not wired
    const [w, h] = size;
    if (opts.road !== false && onRoad(dx, dy, opts.pad != null ? opts.pad : 20)) return false;
    const x = FC.x + dx, y = FC.y + dy;
    scene.decor.push({
      name, x, y, w, h, flip: !!opts.flip,
      sortY: opts.sortY != null ? FC.y + opts.sortY : y,
      shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28),
    });
    if (opts.solid) {
      const [sw, sh] = opts.solid;
      scene.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
    }
    return true;
  };
  const flat = (name, dx, dy, flip = false) => {
    const size = DECOR_SIZE[name];
    if (!size) return false;
    const [w, h] = size;
    scene.groundDecor.push({ name, x: FC.x + dx, y: FC.y + dy, w, h, flip });
    return true;
  };
  const lamp = (dx, dy) => {
    // scene.lamps is the night-lighting list, and lighting.js destructures it
    // as [x, y] — an object here throws "not iterable" on the first night
    // frame, which is a long way from where the mistake was made.
    if (onRoad(dx, dy, 16)) return false;
    scene.lamps.push([FC.x + dx, FC.y + dy]);
    return true;
  };

  const api = { put, flat, lamp, onRoad };
  ringPlaza(api);
  gardenStructure(api);
  farmStructure(api);
  treeMasses(api);
  districtDetail(api);
  addCrows(scene, FC.x + 280, FC.y + 141, 4);

  return { added: (scene.decor.length + scene.groundDecor.length) - before };
}

// ===== RING — the fountain's social edge =================================
// Rings 1 and 2 (the fountain and its stone) are left exactly as the plaza
// pass built them. This dresses ring 3 only: the band from 120 to 178, which
// is outside the walkable circle but inside the road junction.
//
// Placement is polar, and deliberately NOT mirrored. The four lamps are the
// one symmetric element — coordinated lighting is what makes a square read as
// civic — while benches and planters sit on their own angles so the ring never
// looks stamped.
function ringPlaza({ put, lamp }) {
  const at = (deg, r) => {
    const a = (deg - 90) * Math.PI / 180;
    return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
  };
  // Lamps on the diagonals, clear of all four road mouths.
  for (const deg of [45, 135, 225, 315]) {
    const [dx, dy] = at(deg, 150);
    // Push the POST BASE, not the lamp head. lighting.js already lifts every
    // entry by 19 (`add(x, y - 19, ...)`), so subtracting 30 here stacked two
    // offsets and hung the glow ~49 units above the post — a light floating in
    // the air above the lamp.
    if (put('lamppost_twin', dx, dy, { solid: [5, 4] })) lamp(dx, dy);
  }
  // Benches: three, not four, and none opposite another.
  for (const [deg, name, flip] of [[112, 'bench_01', false], [200, 'bench_02', false], [340, 'bench_01', true]]) {
    const [dx, dy] = at(deg, 136);
    put(name, dx, dy, { flip, solid: [24, 6] });
  }
  // Planters and pots filling between, on their own angles.
  for (const [deg, name] of [[68, 'planter_01'], [158, 'planter_02'], [248, 'planter_01'],
                             [292, 'flower_box_01'], [22, 'flower_box_02'], [212, 'planter_02']]) {
    const [dx, dy] = at(deg, 163);
    put(name, dx, dy, { flip: deg > 180, solid: [10, 5] });
  }
  // The notice board, on the north approach where people arrive from the road.
  put('signpost', -46, -158, { solid: [8, 5] });
}

// ===== GARDEN — north-west ==============================================
// A walled formal garden with two ways in: the main gate faces the fountain
// (south-east corner) and a service gap opens north onto the E-W road.
// Structure only in this pass — the boundary, the paths, the hero tree and
// the seats. Beds and detail come later, and they hang off this frame.
function gardenStructure({ put, flat }) {
  // ---- THE EXPANDED BOTANICAL GARDEN -------------------------------------
  //
  // The footprint is not a rectangle and not an arbitrary blob: it is traced
  // from a measured sweep of the surrounding world. Free ground reaches
  // dx -520 at dy -280 but only dx -400 at dy -360, because the lake's
  // treeline cuts in diagonally; and the north-south avenue at dx -20..0 runs
  // the full height, so the east edge holds a ~60 unit buffer at dx -80
  // instead of pressing against a carriageway. The north is where the room
  // actually was, so that is where the garden grew.
  const B = [
    [-80, -122], [-80, -300], [-92, -360], [-140, -396], [-210, -408],
    [-300, -404], [-368, -386], [-408, -350], [-436, -318], [-486, -296],
    [-512, -274], [-516, -228], [-496, -186], [-444, -146], [-408, -124],
  ];
  const GATE = [-150, -122];        // the southern entrance, unmoved

  // ---- hedge along the boundary polyline.
  // A rectangular garden could tile one hedge piece along each edge. This
  // outline turns, so each segment picks the piece that matches its own
  // direction: gk_hedge for runs that read east-west, gk_hedge_ns for runs
  // that read north-south. Without that test the north-west diagonal came out
  // as a row of pieces all facing the wrong way.
  for (let i = 0; i < B.length; i++) {
    const [x0, y0] = B[i], [x1, y1] = B[(i + 1) % B.length];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    const ns = Math.abs(dy) > Math.abs(dx);        // which way does this run?
    const step = ns ? 46 : 44;
    for (let d = 0; d < len; d += step) {
      const t = d / len;
      const px = Math.round(x0 + dx * t), py = Math.round(y0 + dy * t);
      if (Math.hypot(px - GATE[0], py - GATE[1]) < 46) continue;   // the way in
      put(ns ? 'gk_hedge_ns' : 'gk_hedge', px, py,
          { flip: px > -300, solid: ns ? [18, 46] : [50, 10] });
    }
  }
  put('gk_arch', GATE[0], GATE[1] + 2, { solid: [8, 10] });

  // ---- paths. Three materials, and every curve bends around something.
  const run = (pts, name, pitch, jitter) => {
    let k = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < L; d += pitch, k++) {
        const t = d / L;
        const j = jitter ? Math.round((hash(k * 3.7 + x0 * 0.11) - 0.5) * jitter) : 0;
        flat(name, Math.round(x0 + (x1 - x0) * t) + j,
                   Math.round(y0 + (y1 - y0) * t), k % 2 === 0);
      }
    }
    return k;
  };
  // PRIMARY — entrance to pond, widest and most maintained
  run([[-150, -134], [-196, -174], [-236, -192]], 'gk_gravel', 30, 0);
  run([[-172, -146], [-212, -182], [-244, -200]], 'gk_gravel', 32, 0);
  // WESTERN ROUTE — bends out of the pond, threads the flower peak, opens at
  // the lake, then turns away north into the transition
  run([[-268, -206], [-306, -228], [-348, -252], [-392, -268], [-430, -264],
       [-458, -274], [-468, -278]], 'gk_stepstones', 30, 4);
  // Traced against a solids sweep, not drawn by eye: the first attempt ran
  // this leg straight along the boundary polyline and 17 of 38 samples were
  // blocked by the garden's own hedge. It now runs INSIDE the hedge, through
  // the corridor the sweep found clear at each y.
  run([[-468, -280], [-440, -296], [-436, -310], [-404, -324], [-414, -338],
       [-392, -352], [-360, -364], [-320, -372], [-290, -382]], 'gk_stepstones', 30, 5);
  // EASTERN ROUTE — curves inward under the canopy before nearing the boundary
  run([[-196, -208], [-170, -234], [-140, -262], [-122, -292], [-118, -322],
       [-140, -350], [-176, -372], [-224, -388]], 'gk_stepstones', 30, 4);
  // the one cross-connection, weathered, inside the transition
  run([[-330, -366], [-296, -374], [-262, -378]], 'pebbles_02', 26, 5);
  // the last stones into the ruin are older still
  run([[-244, -386], [-256, -394]], 'pebbles_02', 14, 3);

  // ---- POND, unchanged in size, south-east of the footprint's centre
  const px = -240, py = -202;
  flat('gk_pond', px, py);
  // lush north-west bank
  put('reeds_01', px - 32, py - 14, { shadow: 0 });
  put('reeds_01', px - 20, py - 25, { shadow: 0, flip: true });
  put('reeds_01', px + 4, py - 28, { shadow: 0 });
  put('waterleaf_01', px - 6, py - 27, { shadow: 0 });
  put('fern_clump', px - 44, py - 6, { shadow: 0 });
  put('flowers_blue', px - 38, py - 22, { shadow: 0 });
  // maintained south-east bank: apron, one bench off the axis, nothing else
  flat('gk_gravel', px + 22, py + 32);
  put('bench_01', px + 38, py + 46, { solid: [24, 6] });

  // ---- WESTERN FLOWER WALK: a ribbon with a density PROGRESSION along it,
  // not an even bed. Sparse at the pond, peak at the far west, opening again
  // before the lake so the water is revealed rather than screened all through.
  put('flowers_blue', -286, -218, { shadow: 0 });          // sparse start
  put('gk_bed_ribbon', -318, -236, { flip: true });
  put('gk_bed_crescent', -352, -248);                       // lavender begins
  put('gk_bed_crescent', -382, -258, { flip: true });
  put('gk_bed_crescent', -412, -250);                       // the peak
  put('gk_bed_crescent', -404, -276, { flip: true });
  put('gk_bed_broad', -376, -284);
  put('flowers_white', -366, -244, { shadow: 0 });
  put('flowers_blue', -398, -238, { shadow: 0 });
  put('flowers_yellow', -352, -288, { shadow: 0 });
  put('gk_trellis_vine', -458, -274);                       // the designed moment
  put('tree_blossom_violet', -444, -246);
  put('gk_wateringcan', -430, -232, { shadow: 0 });
  put('gk_basket', -412, -226, { shadow: 0 });

  // ---- LAKE OVERLOOK: a pause, not a structure. Planting kept LOW here so
  // the water reads; the bench faces it.
  // The first overlook at (-494,-288) sat inside the LAKE's own collision —
  // the sweep caught it. This spot is the westernmost walkable ground that
  // still faces open water.
  put('bench_02', -472, -270, { solid: [24, 6] });
  put('rock_med_01', -488, -282, { shadow: 0 });
  put('flowers_white', -470, -286, { shadow: 0 });
  put('grass_tuft_02', -484, -256, { shadow: 0 });

  // ---- EASTERN HERO GROVE, moved north-east and given a room
  put('gk_herotree', -126, -284, { solid: [12, 8] });
  put('tree_oak_round', -180, -308, { solid: [10, 6] });
  put('tree_young', -96, -318, { solid: [8, 5] });
  put('fern_clump', -152, -262, { shadow: 0 });
  put('fern_clump', -140, -254, { shadow: 0, flip: true });
  put('fern_clump', -166, -286, { shadow: 0 });
  put('leafplant_01', -158, -248, { shadow: 0 });
  put('flowers_white', -146, -240, { shadow: 0 });
  put('rock_med_01', -172, -246, { shadow: 0 });
  put('bench_02', -148, -272, { flip: true, solid: [24, 6] });

  // ---- NORTHERN TRANSITION: a real area. Enclosure from trees, but more
  // open ground than the flower walk, and the planting gets progressively
  // less maintained on the way north.
  put('tree_oak_round', -352, -336, { solid: [10, 6] });
  put('tree_young', -300, -350, { solid: [8, 5] });
  put('tree_young', -232, -358, { solid: [8, 5] });
  put('nv_bush_03', -324, -344);
  put('nv_bush_01', -268, -352);
  put('bush_low', -370, -352);
  put('weeds_01', -312, -364, { shadow: 0 });
  put('weeds_02', -258, -366, { shadow: 0 });
  put('leaf_pile', -288, -358, { shadow: 0 });
  put('gk_ruin_fragments', -336, -358, { shadow: 0 });     // the first hint
  put('mushrooms_mixed', -222, -366, { shadow: 0 });

  // ---- SECRET RUIN: small, and screened until you are on top of it
  put('gk_ruin_foundation', -262, -400, { shadow: 0 });
  put('gk_pedestal', -252, -392, { solid: [8, 6] });
  put('nv_bush_01', -286, -392);                            // the screen
  put('bush_big', -234, -386);
  put('gk_moonbell_clump', -240, -396, { shadow: 0 });
  put('gk_moonbell', -292, -216, { shadow: 0 });            // the only other one

  // ---- hedge softening, on the corners and the long runs
  put('bush_big', -408, -344);
  put('nv_bush_01', -96, -292, { flip: true });
  put('bush_low', -486, -204);
  put('flowers_mixed', -510, -244, { shadow: 0 });
}

// ===== FARM — south-east ================================================
// The four crop beds already exist and are not touched. This builds the yard
// around them: a fence on the two outward sides only, a gate on the plaza
// side, and the working corner between gate and beds.
function farmStructure({ put, flat, lamp }) {
  const F = DISTRICTS.farm;

  // NO FENCE FROM THIS PASS. The four crop beds already arrive fenced —
  // plazalife.js keeps `fence_run`/`fence_post` around them through its own
  // strip, and a census of the district finds 48 posts and 20 runs already
  // standing. Adding a second perimeter drew a fence on top of a fence, and
  // every gate position tried (dx 150, 110, 300) opened onto one of THEIR
  // solids, so the farm stayed sealed. The collision audit caught it three
  // times; the screenshot never would have.
  //
  // What the farm was actually missing is the WORKING YARD — the bit that
  // says someone farms here rather than that four beds exist. It goes just
  // west of their fence line, between the beds and the avenue, where a farmer
  // would unload.
  const wx = F.x0 + 4, wy = F.y0 + 96;

  // No ground patch under the yard. gk_gravel was tried here and read as a
  // grid of pale cream rectangles with hard edges — the piece is a garden path
  // material and at this size it tiles into blocks rather than into a surface.
  // Bare grass under the cluster is better than a wrong surface on it.

  // The cluster: cart at the centre of the yard, storage banked behind it,
  // tools dropped where they were last used. Deliberately un-aligned — the
  // crops are ordered and the tools are not, and that contrast is the point.
  put('cart', wx + 10, wy, { solid: [22, 8] });
  put('barrel_stack', wx - 30, wy + 12, { solid: [14, 8] });
  put('hay_pile', wx + 48, wy + 16, { solid: [18, 8] });
  put('sack_pile', wx - 12, wy + 32, { solid: [14, 6] });
  put('hay_bale', wx + 22, wy + 40, { flip: true, solid: [16, 7] });
  put('wheelbarrow', wx - 44, wy + 40, { solid: [16, 6] });
  put('crate_stack', wx + 60, wy - 16, { solid: [12, 7] });
  put('water_bucket', wx - 6, wy + 50);
  put('wood_pile_03', wx + 70, wy + 34, { solid: [14, 7] });

  // The well, on the yard's north side where it faces the road.
  put('water_well', wx + 30, wy - 54, { solid: [18, 10] });
  if (put('lamppost_wood', wx - 40, wy - 46, { solid: [4, 4] })) lamp(wx - 40, wy - 46);

  // The scarecrow, standing IN the south-west crop bed rather than beside it —
  // that is where one goes, and it puts a tall silhouette against the flat
  // rows. Crows wheel above it, which is the joke: it is not working.
  // Dead centre of the farm, standing on the grass where the two access lanes
  // cross between the four beds. It reads from every bed at once there, and the
  // open lane gives it a clean silhouette — buried inside the wheat it vanished,
  // being straw-coloured against straw-coloured crop.
  put('scarecrow', 280, 148, { solid: [6, 5] });

  // Weeds and flowers along the OUTSIDE of their fence, softening the edge
  // between the crop rows and the open grass.
  for (let dx = F.x0 + 60; dx < F.x1 - 30; dx += 58) {
    if (hash(dx * 0.11) < 0.3) continue;
    put(hash(dx * 0.19) < 0.5 ? 'weeds_01' : 'weeds_02', dx, F.y0 - 12, { shadow: 0 });
  }
}

// ===== TREE MASSES ======================================================
// Trees frame the districts rather than populate them: at the outer corners,
// behind the seats, and along the map-facing edges. Never on a road, never
// where they would hide the fountain from an approach.
//
// Each mass is a cluster of two to four scales — canopy, mid, low, ground —
// because a single tree repeated reads as procedural and a cluster reads as
// composed.
function treeMasses({ put }) {
  const CANOPY = ['tree_oak_broad', 'tree_oak_spread', 'tree_oak_round', 'deciduous_tree_03', 'deciduous_tree_05'];
  const MID = ['tree_young', 'tree_blossom_white', 'tree_blossom_blue', 'tree_small_pine'];
  const LOW = ['bush_big', 'bush_low', 'nv_bush_01', 'nv_bush_03'];

  // [dx, dy, seed] — outer corners of the four districts, plus two along the
  // south approach where the frame was thinnest.
  const MASSES = [
    [-440, -320, 1.3], [-96, -330, 2.7], [-440, -110, 3.9],
    [446, -318, 5.1], [70, -330, 6.3], [452, -118, 7.7],
    [-444, 118, 8.9], [-436, 330, 10.1], [-70, 336, 11.3],
    [470, 44, 12.5], [472, 348, 13.7],
  ];
  for (const [dx, dy, seed] of MASSES) {
    if (inClearedQuadrant(dx, dy)) continue;
    put(CANOPY[Math.floor(hash(seed) * CANOPY.length) % CANOPY.length], dx, dy, { solid: [10, 6], flip: hash(seed * 2) < 0.5 });
    put(MID[Math.floor(hash(seed * 3) * MID.length) % MID.length],
        dx + Math.round((hash(seed * 5) - 0.5) * 64), dy + 18 + Math.round(hash(seed * 7) * 20), { solid: [8, 5] });
    put(LOW[Math.floor(hash(seed * 11) * LOW.length) % LOW.length],
        dx + Math.round((hash(seed * 13) - 0.5) * 80), dy + 30 + Math.round(hash(seed * 17) * 24));
    if (hash(seed * 19) < 0.6) {
      put(LOW[Math.floor(hash(seed * 23) * LOW.length) % LOW.length],
          dx + Math.round((hash(seed * 29) - 0.5) * 96), dy + 44 + Math.round(hash(seed * 31) * 18), { flip: true });
    }
  }
}

// ===== PASS 2-4: MEDIUM PROPS, PLANTING, MICRO-DETAIL ====================
// Structure was pass 1. This is everything that hangs off it: the storage a
// trader would keep behind a stall, the planting that softens a hedge, and
// the ground texture that stops open grass reading as a blank rectangle.
//
// Density is deliberately uneven. Each district gets its dense corner, and
// the space between districts is left quiet on purpose — the brief asks for
// hierarchy, and uniform fill is the failure mode it warns about.
function districtDetail({ put, flat, onRoad }) {
  const F = DISTRICTS.farm;

  // The garden is composed entirely in gardenStructure() now. The border
  // scatter that used to live here strewed flowers along the edges of a
  // RECTANGULAR box, and the footprint is no longer a rectangle — it traced
  // the old geometry and fought the new planting masses.

  // ---- FARM: weeds and flowers along the outside of the fence, tools inside.
  put('barrel_01', F.x0 + 18, F.y1 - 96, { solid: [10, 7] });
  put('barrel_apples', F.x0 + 42, F.y1 - 78, { solid: [10, 7] });

  // ---- ROAD EDGES + OPEN GRASS: rhythm, not a continuous verge.
  // Clusters are seeded on a coarse ring around the fountain and then
  // rejected wherever they would land on a carriageway or inside a district,
  // so what survives is exactly the connective ground between the rooms.
  const GROUND = ['grass_tuft_01', 'grass_tuft_02', 'grass_tuft_03', 'grass_tuft_04',
                  'flowers_white', 'flowers_blue', 'pebbles_01', 'pebbles_02',
                  'rock_small_01', 'leaf_pile', 'mushrooms_red'];
  const inAnyDistrict = (dx, dy) => Object.values(DISTRICTS)
    .some((d) => dx > d.x0 - 20 && dx < d.x1 + 20 && dy > d.y0 - 20 && dy < d.y1 + 20);
  for (let i = 0; i < 150; i++) {
    const a = hash(i * 1.7) * Math.PI * 2;
    const r = 190 + hash(i * 2.9) * 300;
    const dx = Math.round(Math.cos(a) * r), dy = Math.round(Math.sin(a) * r);
    if (inAnyDistrict(dx, dy)) continue;
    if (inClearedQuadrant(dx, dy)) continue;
    if (onRoad(dx, dy, 26)) continue;
    if (hash(i * 5.3) < 0.42) continue;            // the quiet gaps in the rhythm
    // clusters of two or three, not lone props
    const n = 1 + Math.floor(hash(i * 7.1) * 3);
    for (let k = 0; k < n; k++) {
      const jx = dx + Math.round((hash(i * 11 + k * 3) - 0.5) * 46);
      const jy = dy + Math.round((hash(i * 13 + k * 5) - 0.5) * 34);
      if (onRoad(jx, jy, 20) || inAnyDistrict(jx, jy) || inClearedQuadrant(jx, jy)) continue;
      put(GROUND[Math.floor(hash(i * 17 + k * 7) * GROUND.length) % GROUND.length], jx, jy, { shadow: 0 });
    }
  }
}

// ===== CROWS =============================================================
// Crows wheeling over the scarecrow. Modelled on drawButterfly in props.js —
// pure-`t`, no per-frame state, so the same time always gives the same frame
// and the render harnesses can still hash-compare a frame.
//
// The FLIGHT is deliberately not the butterfly's. A butterfly darts: short
// committed legs with rests between them. A crow wheels: one long banked
// circuit, flapping to climb and gliding on the descent. Reusing the butterfly
// path here would have made them read as large brown butterflies.
const CROW_ART = {};
for (const n of ['up', 'half', 'down', 'glide', 'perch']) {
  CROW_ART[n] = loadBuildingArt(`assets/props/crow_${n}.png`);
}

/** Push a wheel of crows circling a point. */
export function addCrows(scene, x, y, n = 3) {
  scene.crows = scene.crows || [];
  for (let i = 0; i < n; i++) {
    scene.crows.push({
      x, y,
      // Wide enough to carry the birds out over all four beds and the farmyard,
      // not just a tight ring above the scarecrow's head.
      rx: 168 + hash(x * 0.11 + i * 3.7) * 54,
      ry: 96 + hash(y * 0.13 + i * 5.1) * 34,     // flattened: seen from above
      // Slow. A lap now takes roughly 9-14 seconds: crows riding a thermal,
      // not insects. The wider circuit alone would have made them faster in
      // ground-speed terms, so this drops well below the old value.
      speed: 0.072 + hash(i * 7.9 + x * 0.05) * 0.038,
      phase: hash(i * 11.3 + y * 0.07) * 6.283,
      // Height above the anchor. Must clear the scarecrow's HEAD, not just its
      // base: at lift 26 the birds flew through its chest and read as standing
      // in the wheat. The scarecrow is 36 tall, so 62 is the floor.
      lift: 62 + hash(i * 13.1) * 30,
    });
  }
}

export function drawCrow(g, c, t) {
  const tt = t * c.speed + c.phase;
  const a = tt * 6.283;
  const x = c.x + Math.sin(a) * c.rx;
  const y = c.y + Math.cos(a) * c.ry - c.lift;

  // Gliding on the near half of the wheel, flapping on the far half where the
  // bird is notionally climbing. That transition is what makes it read as a
  // circuit rather than a loop.
  const climbing = Math.cos(a) < 0.1;
  const frame = climbing
    ? ['up', 'half', 'down', 'half'][Math.floor(((t * 3.8 + c.phase * 2) % 1) * 4)]
    : 'glide';
  const art = CROW_ART[frame];
  if (!art || !art.ready) return;

  // Per-frame size: the wings change span between frames, so a single fixed
  // box would squash the glide and stretch the upstroke. Drawn centred on the
  // flight point in BOTH axes — a crow in the air has no ground contact, so
  // the usual bottom-anchor convention does not apply.
  const [w, h] = DECOR_SIZE[`crow_${frame}`];
  const flip = Math.sin(a) < 0;
  const px = Math.round(x - w / 2), py = Math.round(y - h / 2);
  if (flip) {
    g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1);
    g.drawImage(art.img, Math.round(-w / 2), py, w, h);
    g.restore();
  } else {
    g.drawImage(art.img, px, py, w, h);
  }
}
