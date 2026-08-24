// The Eldertree glade — the ruined-stone quarter, and the closest thing on the
// map to the "Ancient Crystal City" the design notes keep asking for.
//
// Built in four passes, outside-in and coarse-to-fine, which is the ordering
// the whole composition depends on:
//
//   architecture  walls, arches, columns, statues, the street grid
//   trees         the canopy that contains the space
//   understory    bushes and shrubs filling between trunk and wall
//   detail        rubble, crystals, vines — the small reads
//
// Getting that order wrong produces exactly the failure this quarter was
// rebuilt to fix: decoration scattered over open grass, because nothing was
// placed to enclose the view before it was dressed.
//
// Every placement funnels through the `put`/`flat` closures the entry point
// hands each pass, so clearance rules live in one place.

import { hash } from './primitives.js';
import { DECOR_SIZE } from './props.js';

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
export function buildEldertreeGrove(scene) {
  const ET = scene.districts.eldertree;
  const put = (name, x, y, opts = {}) => {
    const [w, h] = DECOR_SIZE[name];
    scene.decor.push({ name, x, y, w, h, flip: !!opts.flip,
                      sortY: opts.sortY != null ? opts.sortY : y,
                      shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
    if (opts.solid) {
      const [sw, sh] = opts.solid;
      scene.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
    }
  };
  const flat = (name, x, y, flip = false) => {
    const [w, h] = DECOR_SIZE[name];
    scene.groundDecor.push({ name, x, y, w, h, flip });
  };
  const glow = (x, y, hue, r) => scene.crystalGlows.push([x, y, hue, r]);
  const X = ET.x, Y = ET.y;
  // Full compact-city build re-enabled (2026-08-22) — all four stages.
  acgArchitecture(scene, put, flat, X, Y);
  acgTrees(scene, put, flat, X, Y);
  acgUnderstory(scene, put, flat, X, Y);
  acgDetail(scene, put, flat, glow, X, Y);
}

// ===== PASS 1: ARCHITECTURE — reference-matched compact city ===========
// Rectangular WALLED building footprints (horizontal + rotated vertical wall
// pieces) packed tight around the Heart Tree, arches straddling the streets,
// north & south gates, pool and shrine in walled courtyards, outer wall
// fragments. Layout stored on scene._acgL for the vegetation stages.
function acgArchitecture(scene, put, flat, X, Y) {
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
    scene.solids.push({ x: ax - 16, y: ay - 10, w: 8, h: 10 }, { x: ax + 8, y: ay - 10, w: 8, h: 10 });
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

  scene._acgL = {
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
function acgTrees(scene, put, flat, X, Y) {
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
  const H = (scene._acgL && scene._acgL.houses) || [];
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
function acgUnderstory(scene, put, flat, X, Y) {
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
  const H = (scene._acgL && scene._acgL.houses) || [];
  H.forEach((a, i) => scatter(Math.round(a.x + a.w * 0.55), Math.round(a.y + a.h * 0.15), 6, 34, [BUSH, GRASS, GRASS], 320 + i * 9));

  // crystal-altered blue grass in the magical zones
  scatter(X - 96, Y + 24, 5, 46, [DARK], 401); scatter(X + 96, Y + 28, 5, 46, [DARK], 407);
  scatter(X + 256, Y + 94, 6, 52, [DARK, GRASS], 413);      // temple
  scatter(X + 300, Y - 66, 10, 70, [DARK, DARK, GRASS], 419); // crystal grove
  scatter(X - 240, Y + 156, 4, 40, [DARK, GRASS], 427);     // pond

  // ---- MEADOW WASH (§22/§26): overgrown-meadow the remaining lawn, but
  // PROTECT the streets/squares so the urban geometry stays legible.
  const L = scene._acgL || {};
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
function acgDetail(scene, put, flat, glow, X, Y) {
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
  ]) scene.butterflies.push({ x: bx, y: by, col, rx, ry, speed: sp, phase: ph });
}
