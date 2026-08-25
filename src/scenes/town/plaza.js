// Crystal Plaza dressing — an AUTHORED level, not a decoration generator.
//
// This replaced roughly a thousand lines of scatter passes that could never be
// made to look designed. The rules that came out of that rebuild:
//
//   * Build outside-in. The tree belt goes down first so the space is
//     contained before it is decorated; otherwise you get a fountain standing
//     in an infinite field.
//   * Compress detail rather than spreading it. Dense clusters against
//     genuinely empty ground read denser than an even field at equal count.
//   * Negative space is design — the clearings are defended on purpose.
//   * Straight lattices are for cultivated things only (the crop field).
//     Everything else is hash-jittered.
//
// Two mechanical traps live in `put`, which every placement goes through. It
// SNAPS to an 8-unit grid before testing clearance, so a lattice pitch that is
// not a multiple of 8 quantises unevenly and tears slivers of grass through a
// bed. And fits() gates FURNITURE at a hard 0.02 regardless of the slack
// passed, which makes a continuous fence run or a crate stack impossible
// through the spacing test — those are authored with direct placement instead.

import { hash } from './primitives.js';
import { DECOR_SIZE } from './props.js';
import { ROAD_CELL } from './roads.js';
import { DECOR_ART } from './props.js';
import { drawPropArt } from './primitives.js';
import { POND_W, POND_H } from './lake.js';
import { dressFlowerGarden, stripKeep, stripAmbient } from './plazalife.js';

export function buildPlazaDecor(scene, FC) {
  scene.decor = [];        // depth-sorted against the player
  scene.groundDecor = [];  // flat detail, drawn beneath every entity
  const R = scene.plazaRadius;

  // ---------------------------------------------------------- primitives
  const placed = [];
  const FURNITURE = /^(bench|planter|lamppost|signpost|cart|crate|barrel|sack|topiary|fence|garden_patch|flower_box|clothes_line|mailbox|wooden_post|wooden_sign|water_well|water_bucket|wheelbarrow|hay_|wood_pile|chopping_block|log_long|direction_sign)/;
  const onPaint = (x, y, pad = 0) => {
    const C = ROAD_CELL;
    for (let dy = -pad; dy <= pad; dy += C) {
      for (let dx = -pad; dx <= pad; dx += C) {
        if (scene.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
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
    return scene._nearAnyRoad(x, y, 40);
  };
  const put = (name, x, y, opts = {}) => {
    const [w, h] = DECOR_SIZE[name];
    // Demolition switch — see plazalife.js. Rejects every prop except the crop
    // plots and their fences, so the plaza can be rebuilt from bare ground
    // without any dressing code being deleted.
    if (!stripKeep(name, x - FC.x, y - FC.y)) return false;
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
    const list = opts.flat ? scene.groundDecor : scene.decor;
    list.push({ name, x, y, w, h, flip: !!opts.flip,
                sortY: opts.sortY != null ? opts.sortY : y,
                shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
    if (!opts.flat) {
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y,
                    area: w * h, furn: FURNITURE.test(name) });
    }
    if (opts.solid) {
      const [sw, sh] = opts.solid;
      scene.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
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
  const corridor = (x, y, pad = 20) => scene._nearAnyRoad(x, y, pad);

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
  const WORLD_BLOCK = scene.locations.filter((l) => l.solid).map((l) => l.solid);
  const LK = scene.lakeTopLeft;
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
    scene.propGroups.push({ fn: (g) => {
      for (const d of scene.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
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
        scene.solids.push(
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
    const trees = scene.decor.filter((d) => /^tree_/.test(d.name));
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

  // The two living corners. Runs last, so the garden arranges itself around
  // every mass and vignette already on the ground. Being after MICRO costs
  // nothing: that pass places flat groundDecor, which never enters `placed`
  // and so blocks nothing. See plazalife.js.
  const gardenN = dressFlowerGarden(scene, FC, { area, set, bed, station });
  if (typeof window !== 'undefined' && window.__plazaCounts) console.log('flower garden:', gardenN);
  const strippedN = stripAmbient(scene, FC);
  if (typeof window !== 'undefined' && window.__plazaCounts) console.log('stripped:', strippedN);

  scene.propGroups.push({ fn: (g) => {
    for (const d of scene.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
  } });
}
