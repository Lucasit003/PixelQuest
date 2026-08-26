// The Ancient City — the ruined stone quarter around the Eldertree.
//
// Replaces the old `ancientcity.js`, which dressed this district entirely out
// of the Mystical Tree sheet. That sheet has no BUILDINGS in it, only columns,
// low walls and benches, so the quarter could only ever read as a walled
// garden: wall runs repeated on open grass, no roofs, no storeys, no
// silhouette above knee height except the tree itself.
//
// The replacement is built from purpose-generated city art (tools/
// gen_city_sheet.py wrote the prompts, tools/citycut.py sliced the sheets)
// colour-locked to the original Mystical Tree palette, so the district can be
// composed as a city: storeyed buildings enclosing streets, a wall around the
// whole thing, water running through it, and the green reclaiming all of it.
//
// The Eldertree itself stays. It is a gameplay location (`action: 'tree'`,
// where mastery is spent) and the reason the city is here at all — the city
// grew around it, and is now falling away from it.
//
// Build order is outside-in and coarse-to-fine, and the composition depends on
// it. ARCHITECTURE first: the quarter has to read as a city with every plant
// stripped out. Only then water, then the green, then the small detail.
// Getting that order wrong is what produced the failure this district was
// rebuilt to fix — decoration scattered over open grass because nothing had
// been placed to enclose the view before it was dressed.

import { hash } from './primitives.js';
import { DECOR_SIZE } from './props.js';

// Geometry the district was laid out to (see layout.js): the glade footprint
// is 830x720 centred on the tree, with a 46-wide main avenue already carved
// N-S through it and a 34-wide cross street E-W. Axis is NORTH-SOUTH, entered
// from the SOUTH — the Eldertree is a 200-tall bottom-anchored sprite only
// ever seen from the front, so anything meant to be SEEN stays out of the
// x +/-88 band north of the tree base.
const AVENUE_HALF = 23;      // main avenue, N-S through the tree
const CROSS_DY = 40;         // cross street, E-W, this far south of the tree
const CROSS_HALF = 17;
const WALL_X = 330;          // outer wall, half-width
const WALL_N = -250;         // outer wall, north side
const WALL_S = 340;          // outer wall, south side (the gate is here)

// Nothing may be placed on a street, or the player walks through it.
function onStreet(dx, dy, pad = 0) {
  if (Math.abs(dx) < AVENUE_HALF + pad && dy > WALL_N - 40 && dy < WALL_S + 40) return true;
  if (Math.abs(dy - CROSS_DY) < CROSS_HALF + pad && Math.abs(dx) < WALL_X) return true;
  return false;
}

// ---------------------------------------------------------------------------
// DEMOLITION SWITCH — same pattern as PLAZA_STRIP in plazalife.js.
//
// The whole district is withheld: walls, buildings, streets, canals, statues,
// paving, greens, rubble — every piece this file places, and every solid that
// came with them. Done as a switch rather than by deleting the file because
// this is another session's uncommitted work with no git baseline to recover
// from, and because reverting is one word against rebuilding four hundred
// lines.
//
// The Eldertree itself is NOT this file's to remove: the location, its action
// ('tree', where mastery is spent) and its dais are placed by layout.js and
// survive — the glade goes back to open grass around the tree.
export const CITY_STRIP = true;

export function buildAncientCity(scene) {
  if (CITY_STRIP) return;
  const ET = scene.districts.eldertree;
  // Every placement funnels through these, so clearance and depth-sort rules
  // live in one place rather than at 200 call sites. Offsets are relative to
  // the tree base, which is what every layout number below is written in.
  const put = (name, dx, dy, opts = {}) => {
    const [w, h] = DECOR_SIZE[name];
    const x = ET.x + dx, y = ET.y + dy;
    scene.decor.push({
      name, x, y, w, h, flip: !!opts.flip,
      sortY: opts.sortY != null ? ET.y + opts.sortY : y,
      shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28),
    });
    // `solid` is the usual single base box; `solids` is for anything the
    // player must walk THROUGH, like a gatehouse, where collision is two
    // piers with a gap between them.
    if (opts.solid) {
      const [sw, sh] = opts.solid;
      scene.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
    }
    for (const [ox, oy, sw, sh] of opts.solids || []) {
      scene.solids.push({ x: x + ox, y: y + oy - sh, w: sw, h: sh });
    }
  };
  const flat = (name, dx, dy, flip = false) => {
    const [w, h] = DECOR_SIZE[name];
    scene.groundDecor.push({ name, x: ET.x + dx, y: ET.y + dy, w, h, flip });
  };
  const glow = (dx, dy, hue, r) => scene.crystalGlows.push([ET.x + dx, ET.y + dy, hue, r]);

  cityStreets(flat, put);
  cityWalls(put, flat);
  cityBlocks(put, flat);
  cityWater(put, flat);
  cityGreen(put, flat);
  cityDetail(put, flat, glow);
}

// ===== PASS 1: STREETS ====================================================
// The city's own ancient paving, laid flat under the roads the map already
// carved. Laid first because everything else is positioned off it, and drawn
// beneath everything because groundDecor always is.
function cityStreets(flat, put) {
  // Main avenue, N-S. Three columns rather than one: the road the map carved
  // is 46 wide and a single 41-wide strip leaves grass showing down both
  // gutters, which is what makes a city read as a lawn with a path across it.
  for (let dy = WALL_N + 10; dy < WALL_S + 30; dy += 34) {
    for (const c of [-17, 0, 17]) flat('city_paving_ns', c, dy, c > 0);
    if (hash(dy * 0.31) < 0.5) flat('city_paving_ns', 0, dy + 17, true); // break the tiling
  }
  // Cross street, E-W — two rows, same reason.
  for (let dx = -WALL_X + 16; dx < WALL_X - 16; dx += 48) {
    flat('city_paving', dx, CROSS_DY - 7);
    flat('city_paving', dx + 24, CROSS_DY + 8, true);
  }
  flat('city_paving_cross', 0, CROSS_DY);   // the crossing itself
  // A back lane through the northern blocks, between their two rows of
  // buildings. Without it the whole north side is one row of frontage with
  // open ground behind it, which is the read that made this quarter look
  // like a park. It stops either side of the avenue: the Eldertree's canopy
  // owns x +/-88 north of the tree, and nothing should invite the player in
  // under it looking for a street that isn't there.
  for (const [x0, x1] of [[-296, -86], [86, 296]]) {
    for (let dx = x0; dx <= x1; dx += 46) {
      flat('city_paving', dx, -128, dx > 0);
      if (hash(dx * 0.23) < 0.45) flat('city_paving', dx + 23, -117, true);
    }
  }
  // The civic square: a broad paved apron between the cross street and the
  // Eldertree's dais, so the approach reads as a place rather than a road.
  // Missing flags are the only randomness — a swept square with holes in it,
  // not a scatter of slabs.
  for (let r = 0; r < 6; r++) {
    for (let c = -3; c <= 3; c++) {
      if (Math.abs(c) < 1) continue;                          // the avenue already covers it
      if (hash(r * 7.1 + c * 3.3) < 0.16) continue;
      flat('city_paving', c * 46, 58 + r * 16, c > 0);
    }
  }

  // ---- wear along the carriageways -----------------------------------------
  // The streets were laid as clean rectangles: edges dead straight for six
  // hundred units, which is what made them read as strips rather than as
  // seven-hundred-year-old roads. Three kinds of wear, all deterministic and
  // all at the EDGES so the walking line stays clean:
  //   * a slab slipped half out of line where the frontage meets the street
  //   * moss creeping in over the carriageway from its gutters
  //   * the odd fragment of rubble at the kerb
  for (let i = 0; i < 12; i++) {
    const dy = WALL_N + 40 + hash(i * 8.3) * (WALL_S - WALL_N - 90);
    if (Math.abs(dy - CROSS_DY) < 34) continue;
    const side = i % 2 ? 1 : -1;
    flat('city_paving_ns', side * (28 + Math.round(hash(i * 2.9) * 8)), Math.round(dy), side > 0);
  }
  for (let i = 0; i < 8; i++) {
    const along = hash(i * 5.7);
    if (i % 2) {   // on the avenue
      flat('city_moss_patch', Math.round((hash(i * 3.9) - 0.5) * 40),
           Math.round(WALL_N + 50 + along * (WALL_S - WALL_N - 110)), i % 4 === 1);
    } else {       // on the cross street
      flat('city_moss_patch', Math.round((along - 0.5) * (WALL_X * 2 - 90)),
           CROSS_DY + Math.round((hash(i * 7.7) - 0.5) * 16), i % 4 === 0);
    }
  }
  const FRAG = ['city_rubble_a', 'city_rubble_b', 'city_rubble_c'];
  for (let i = 0; i < 6; i++) {
    const dy = WALL_N + 60 + hash(i * 6.7) * (WALL_S - WALL_N - 130);
    if (Math.abs(dy - CROSS_DY) < 30) continue;
    const side = i % 2 ? 1 : -1;
    put(FRAG[i % FRAG.length], side * (30 + Math.round(hash(i * 4.1) * 6)), Math.round(dy), { shadow: 0 });
  }
}

// ===== PASS 2: THE WALL ===================================================
// A city is a thing with an edge. The wall is what tells the player they have
// arrived somewhere and, from outside, what they can see over: the two
// watchtowers are the tallest things in the world after the Eldertree.
function cityWalls(put, flat) {
  const EW = ['city_wall', 'city_wall_broken', 'city_wall_ivy', 'city_wall_steps', 'city_wall_door', 'city_wall_gap'];
  // What a collapsed length of wall is drawn AS, rather than drawn as nothing.
  const RUINED = ['city_wall_broken', 'city_wall_gap'];
  // north and south runs. The south run is broken by the gatehouse on the
  // avenue; the north run is unbroken, and is what closes the view behind
  // the tree.
  // The pieces are 30, 32 and 34 tall and every one is bottom-anchored, so on a
  // shared baseline their CRENELLATIONS land at three different heights —
  // measured, a 12px sawtooth along the top of the wall. That top line is what
  // the eye reads as "city wall", so the battlement is what gets levelled and
  // the foot is allowed to vary instead: nudging y by the piece's own height
  // puts every top at dy - TOP_H and moves the base by at most 2px.
  const TOP_H = 32;
  // Step 50, not 52. At 52 the run ended at dx 269, right edge 296, while the
  // corner piece starts at 302 — a 6px slot of daylight at all four corners.
  // 50 laps the corner instead, and the pieces are 52-56 wide so they still
  // overlap each other.
  for (const [side, dy] of [['n', WALL_N], ['s', WALL_S]]) {
    for (let dx = -WALL_X + 27, i = 0; dx <= WALL_X - 27; dx += 50, i++) {
      if (side === 's' && Math.abs(dx) < 70) continue;              // gatehouse gap
      // Ruin by using the RUINED ART, not by leaving a void. Dropping the piece
      // punched a 52-wide hole clean through the silhouette, which reads as an
      // unfinished wall rather than a damaged one — and the pack ships a
      // collapsed section and a breach for exactly this.
      const wrecked = hash(i * 3.1 + dy * 0.07) < 0.12;
      const name = wrecked ? RUINED[i % RUINED.length]
                           : EW[(i + (side === 'n' ? 0 : 3)) % EW.length];
      const [, ph] = DECOR_SIZE[name];
      put(name, Math.round(dx), dy + (ph - TOP_H), { solid: [50, 8] });
    }
  }
  // east and west runs, from the pre-rotated N-S piece.
  //
  // city_wall_ns is 42x40 on paper but its top NINE ROWS are transparent — the
  // opaque wall is 31 tall. At the old 36 pitch that left a 5px slit of grass
  // between every piece, and the whole run read as a ladder rather than a wall.
  // 28 overlaps the opaque content by 3. The run also starts higher: the first
  // piece used to begin 9px below the corner's art, detaching every corner
  // from its own wall.
  for (const dx of [-WALL_X, WALL_X]) {
    for (let dy = WALL_N + 26, i = 0; dy <= WALL_S - 10; dy += 28, i++) {
      if (Math.abs(dy - CROSS_DY) < 46) continue;                   // the cross street leaves the city
      // A wrecked length here has only the one piece, so it has to be a real
      // hole — but a bare hole reads as a missing sprite. Filling the slot
      // with the rubble heap makes it a breach: the wall fell, and this is
      // where it landed.
      if (hash(i * 4.7 + dx * 0.05) < 0.05) {
        put('city_rubble_heap', dx, Math.round(dy), { flip: dx > 0, shadow: 0 });
        continue;
      }
      put('city_wall_ns', dx, Math.round(dy), { flip: dx > 0, solid: [16, 30] });
    }
  }
  // corners, and the two towers that carry the skyline
  for (const [dx, dy] of [[-WALL_X, WALL_N], [WALL_X, WALL_N], [-WALL_X, WALL_S], [WALL_X, WALL_S]]) {
    put('city_wall_corner', dx, dy, { flip: dx > 0, solid: [46, 20] });
  }
  put('city_watchtower', WALL_X - 4, WALL_N - 6, { solid: [44, 26] });
  put('city_watchtower', -WALL_X + 4, WALL_S - 4, { flip: true, solid: [44, 26] });
  // the south gate, straddling the avenue. Collision is the two piers only —
  // the gateway between them has to stay walkable.
  put('city_gatehouse', 0, WALL_S + 6, { solids: [[-56, 0, 30, 26], [26, 0, 30, 26]] });
  flat('city_paving_ns', 0, WALL_S + 20);
  // where the cross street leaves the city, east and west: a plain opening
  // with a low wall stub either side rather than a second gatehouse.
  for (const dx of [-WALL_X, WALL_X]) {
    put('city_wall_low', dx, CROSS_DY - 30, { flip: dx > 0, solid: [46, 8] });
    put('city_wall_low', dx, CROSS_DY + 34, { flip: dx > 0, solid: [46, 8] });
  }
}

// ===== PASS 3: THE BLOCKS =================================================
// Four quadrants of buildings, each fronting the street it stands on, with a
// low boundary wall closing the back of the block. This is the pass that
// decides whether the quarter reads as a city: buildings in ROWS, facing the
// same way, with a street between them — not scattered across a lawn.
function cityBlocks(put, flat) {
  // [name, dx, dy, flip]. Every entry is checked against the streets below.
  const BUILDINGS = [
    // NW — the civic/temple block. Kept well clear of x +/-88 so nothing
    // fights the Eldertree's canopy. Two rows deep with a back lane between
    // them: one row of buildings and a wall is a frontage, not a block.
    ['city_temple', -186, -74, false],
    ['city_hall_colonnade', -216, -196, false],
    ['city_merchant_house', -108, -186, true],
    // NE — the scholarly block, same two-row arrangement
    ['city_archive', 182, -74, false],
    ['city_greathall', 216, -196, true],
    ['city_townhouse', 108, -186, false],
    // SW — the residential ruin
    ['city_rotunda', -206, 148, false],
    ['city_merchant_house', -244, 268, false],
    ['city_townhouse', -112, 274, true],
    // SE — trades and worship
    ['city_granary', 124, 150, false],
    ['city_chapel', 236, 152, false],
    ['city_shrine', 158, 282, false],
  ];
  for (const [name, dx, dy, flip] of BUILDINGS) {
    const [w, h] = DECOR_SIZE[name];
    if (onStreet(dx, dy, w / 2)) continue;   // never build on a street
    // Collision is the building's own footprint, not its full sprite: the
    // player should be able to stand close enough that the facade fills the
    // screen, which a full-height box prevents.
    put(name, dx, dy, { solid: [Math.round(w * 0.86), Math.round(h * 0.34)] });
  }
  // Block boundary walls: the backs of the blocks, so each quadrant is an
  // enclosure with a street frontage rather than four loose buildings.
  const runH = (x0, x1, dy, seed) => {
    for (let dx = x0, i = 0; dx <= x1; dx += 50, i++) {
      if (onStreet(dx, dy, 26)) continue;
      if (hash(seed + i * 2.7) < 0.22) continue;
      put('city_wall_low', Math.round(dx), dy, { solid: [46, 8] });
    }
  };
  runH(-286, -70, -232, 1.3);   // behind the NW block
  runH(70, 286, -232, 2.7);     // behind the NE block
  runH(-286, -70, 316, 4.1);    // behind the SW block
  runH(70, 286, 316, 5.9);      // behind the SE block
  // Yard divisions in the northern blocks — the walls between one property
  // and the next. These are what turn a row of buildings into a street of
  // separate houses, and they close the gaps the back lane opened up.
  const runV = (dx, y0, y1, seed) => {
    for (let dy = y0, i = 0; dy <= y1; dy += 34, i++) {
      if (onStreet(dx, dy, 24)) continue;
      if (hash(seed + i * 3.3) < 0.26) continue;
      put('city_wall_ns', dx, Math.round(dy), { flip: dx > 0, solid: [14, 26] });
    }
  };
  runV(-152, -224, -150, 7.1);   // NW: between the colonnade and the merchant house
  runV(152, -224, -150, 8.3);    // NE: between the great hall and the townhouse
  // No west/east block-edge run: the outer wall is only ~40 units outboard of
  // where one would sit, and the two read as a single doubled wall with a
  // seam down it. The canal does the same job on the west side, and on the
  // east the aqueduct does.
  // A short flight of civic steps up into the temple, and a ramp into the
  // granary yard — the two places the ground is doing something.
  put('city_steps', -186, -20, { shadow: 0 });
  put('city_ramp', 124, 196, { shadow: 0 });
  // Paved forecourts in front of every building, so a block front reads as
  // swept ground rather than as a facade parked on a lawn. Three flags wide
  // and two deep is enough to carry the eye from the street to the door.
  const COURTS = [[-186, -18], [-216, -140], [-108, -130], [-268, -60],
                  [182, -18], [216, -140], [108, -130], [264, -60],
                  [-206, 194], [-244, 314], [-112, 320],
                  [124, 196], [236, 198], [158, 328]];
  for (const [dx, dy] of COURTS) {
    for (let r = 0; r < 2; r++) for (let c = -1; c <= 1; c++) {
      const px = dx + c * 48, py = dy + r * 15;
      if (onStreet(px, py, 22)) continue;
      if (hash(px * 0.13 + py * 0.29) < 0.18) continue;
      flat('city_paving', px, py, c > 0);
    }
  }
}

// ===== PASS 4: WATER ======================================================
// The city's water still works, which is most of what makes a ruin feel
// inhabited rather than dead. Aqueduct on the east wall feeds a canal down
// the west side; the square gets the fountain and the reflecting pool.
function cityWater(put, flat) {
  // the reflecting pool, on the square's west side
  flat('city_pool', -128, 126);
  // the tiered fountain, east side, facing the avenue
  put('city_fountain', 104, 118, { solid: [46, 22] });
  // The aqueduct marching in along the east wall, running NORTH-SOUTH as a
  // line of front-on spans. Each span is 94 wide against a 58 height, so they
  // are stepped down the wall rather than stacked: the run reads as one
  // structure carrying water into the city, ending at the spout block that
  // fills the well yard. The middle span is the collapsed one, and the lone
  // pier stands past the break where the rest of that span is gone.
  put('city_aqueduct', WALL_X - 62, -168, { solid: [80, 16] });
  put('city_aqueduct_broken', WALL_X - 62, -104, { solid: [74, 16] });
  put('city_aqueduct_pier', WALL_X - 106, -46, { solid: [24, 16] });
  put('city_aqueduct_end', WALL_X - 62, -40, { flip: true, solid: [80, 16] });
  // The canal it feeds, running south down the inside of the west wall. The
  // step matches the piece's own height so the kerbs line up end to end — a
  // gap here shows as a break in the stonework, not as water.
  for (let dy = -140; dy < 320; dy += 79) {
    if (Math.abs(dy - CROSS_DY) < 56) continue;   // the street crosses it
    flat('city_canal_ns', -WALL_X + 48, dy);
  }
  // Where the back lane meets the canal, a junction takes water east into the
  // city. It runs two spans and ends at the bath house it was built to fill —
  // a channel that just stops in open ground reads as a mistake, not a ruin.
  flat('city_canal_cross', -WALL_X + 48, -117);
  flat('city_canal', -WALL_X + 106, -130);
  flat('city_canal', -WALL_X + 166, -130, true);
  flat('city_bath', -WALL_X + 226, -124);
  // Where the cross street meets the canal, a bridge over it.
  put('city_waterbridge', -WALL_X + 48, CROSS_DY + 8, { shadow: 0 });
  // The cascade at the canal's head, and a wall fountain on the temple front.
  put('city_cascade', -WALL_X + 48, -168, { shadow: 0 });
  put('city_wallfountain', -138, -30);
  // The well in the SE block, a bath in the NE yard, a dry basin in the SW
  // ruin — the small waterpoints each block would have had.
  put('city_well', 214, 236, { solid: [18, 12] });
  put('city_well', 268, -158, { flip: true, solid: [18, 12] });
  flat('city_basin_dry', -158, 240);
}

// ===== PASS 5: THE GREEN ==================================================
// Vegetation goes on LAST of the big passes and always attached to stone —
// through a wall, in a doorway, over a block. Free-standing planting on open
// grass is exactly the read this district was rebuilt to get away from.
function cityGreen(put, flat) {
  // trees splitting the outer wall, at the collapsed stretches
  put('city_tree_wall', -232, WALL_N + 4);
  put('city_tree_wall', 246, WALL_S - 4, { flip: true });
  put('city_tree_door', 292, -132);
  put('city_tree_door', -300, 216, { flip: true });
  // ivy taking the corners and the block walls
  put('city_ivy_mound', -WALL_X + 30, WALL_N + 40);
  put('city_ivy_mound', WALL_X - 30, WALL_S - 40, { flip: true });
  put('city_ivy_curtain', 96, -222, { shadow: 0 });
  put('city_ivy_curtain', -104, 320, { flip: true, shadow: 0 });
  put('city_vine_trellis', -268, 44);
  put('city_vine_trellis', 274, 92, { flip: true });
  // shrubs banked against building fronts, never free-standing on grass
  const SHRUB = ['city_shrub_white', 'city_shrub_blue'];
  const BANKS = [[-236, -66], [-136, -66], [232, -66], [132, -66],
                 [-252, 158], [-160, 156], [88, 160], [268, 158],
                 [-186, 300], [190, 306], [-64, 300], [64, 300]];
  BANKS.forEach(([dx, dy], i) => {
    if (onStreet(dx, dy, 20)) return;
    put(SHRUB[i % 2], dx, dy, { flip: i % 3 === 0 });
  });
  // ferns and grass in the wall's shade, where nothing walks
  for (let i = 0; i < 14; i++) {
    const dx = -WALL_X + 26 + hash(i * 5.3) * (WALL_X * 2 - 52);
    const dy = WALL_N + 24 + hash(i * 7.9) * (WALL_S - WALL_N - 48);
    if (onStreet(dx, dy, 26)) continue;
    put(hash(i * 2.1) < 0.5 ? 'city_ferns' : 'city_grass_clump', Math.round(dx), Math.round(dy), { flip: i % 2 === 0 });
  }
  // saplings and stumps — the slow part of the reclamation
  put('city_sapling', -74, -166);
  put('city_sapling', 78, 236, { flip: true });
  put('city_stump_shoots', -288, -96);
  put('city_stump_small', 296, 264);
  // moss creeping out over the paving, laid flat so it reads as surface
  for (let i = 0; i < 10; i++) {
    const dx = -260 + hash(i * 3.7) * 520;
    const dy = WALL_N + 60 + hash(i * 6.1) * (WALL_S - WALL_N - 100);
    flat('city_moss_patch', Math.round(dx), Math.round(dy), i % 2 === 0);
  }
  for (let i = 0; i < 8; i++) {
    const dx = -240 + hash(i * 9.3) * 480;
    const dy = WALL_N + 70 + hash(i * 4.4) * (WALL_S - WALL_N - 120);
    if (onStreet(dx, dy, 18)) continue;
    put('city_wildflowers', Math.round(dx), Math.round(dy), { shadow: 0 });
  }
}

// ===== PASS 6: DETAIL =====================================================
// Statuary, rubble and the crystal glow. The statues are the pass that gives
// the quarter its civic reading: a processional way up the avenue, guardians
// at the gate, and the two grandest pieces facing each other across the
// square in front of the tree.
function cityDetail(put, flat, glow) {
  // ---- the processional way: the triumphal arch on the avenue, lions at
  // its foot, and pairs of figures marching north toward the tree.
  put('city_arch_triumph', 0, 252, { solids: [[-47, 0, 16, 22], [31, 0, 16, 22]] });
  put('city_lion_l', -44, 258, { shadow: 4 });
  put('city_lion_r', 44, 258, { flip: true, shadow: 4 });
  const WAY = ['city_statue_scholar', 'city_statue_warrior', 'city_statue_winged', 'city_statue_headless'];
  WAY.forEach((n, i) => {
    const dy = 210 - i * 44;
    if (Math.abs(dy - CROSS_DY) < 40) return;
    put(n, -AVENUE_HALF - 16, dy);
    put(WAY[(i + 2) % WAY.length], AVENUE_HALF + 16, dy, { flip: true });
  });
  // ---- the square: the colossal king and the rider facing each other
  put('city_statue_king', -74, 96);
  put('city_statue_rider', 78, 96, { flip: true });
  // ---- the obelisk and the star-dial, the quarter's two vertical accents
  put('city_obelisk', -128, -140);
  put('city_stardial', 244, -22);
  put('city_votive_column', -60, -196);
  put('city_votive_column', 62, -196, { flip: true });
  put('city_stele', 268, 216);
  // ---- the SW ruin: a toppled statue among rubble, the quarter's one piece
  // of explicit ruin-storytelling
  put('city_statue_toppled', -224, 208, { shadow: 0 });
  // ---- the standing stones and their crystal, north-west of the tree and
  // outside the canopy band, so the glow reads against the dark trunk
  put('city_standing_stones', -158, -168);
  glow(-158, -172, 'c', 26);
  glow(104, 96, 'c', 14);      // the fountain's own light on the water
  // ---- rubble: heavy at the collapsed wall stretches, thinning inward
  const RUB = ['city_rubble_a', 'city_rubble_b', 'city_rubble_c'];
  put('city_rubble_heap', -232, WALL_N + 26, { shadow: 0 });
  put('city_rubble_heap', 250, WALL_S - 26, { shadow: 0 });
  put('city_rubble_heap', WALL_X - 40, 130, { shadow: 0 });
  for (let i = 0; i < 26; i++) {
    const dx = -WALL_X + 20 + hash(i * 1.9) * (WALL_X * 2 - 40);
    const dy = WALL_N + 20 + hash(i * 8.3) * (WALL_S - WALL_N - 40);
    if (onStreet(dx, dy, 6)) continue;              // small stones may edge the street
    put(RUB[i % RUB.length], Math.round(dx), Math.round(dy), { shadow: 0, flip: i % 2 === 0 });
  }
}
