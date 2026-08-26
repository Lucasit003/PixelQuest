// The river crossings: the landmark stone bridge on the trunk road, the
// stepping-stone ford where that road crosses the stream, and the wild
// boulder-hop over the upper river.
//
// The BRIDGE is built from the same masonry pack as the roads and the plaza
// (civic family — it belongs to the town that built it), so the road runs
// onto the deck with no material break. Geometry hangs off the measured
// paint: the trunk road's painted centreline at the crossing rows is x=2055
// (see river.js), the deck is wider than the paint ever wanders, and the
// water-collision passage punched by river.js is this same rect — deck,
// road, parapets and collision cannot drift apart because they are all the
// same numbers.
//
// Depth is handled by construction rather than by sorting tricks: the deck
// and parapet TOPS are ground paint (the parapets are hip-height walls the
// player is always taller than), the parapet lines are solid strips so the
// player can never step off the deck into the water, and the four lamps are
// ordinary decor entities that y-sort with the player and light themselves
// at night through the existing LAMP_HEADS table.

import { rect } from '../../gfx/pixel.js';
import { hash, fillEllipse } from './primitives.js';
import { PLAZA_TILES, ROAD_TILE } from './tiles.js';
import { roadTileFor, ROAD_CELL } from './roads.js';
import { DECOR_SIZE } from './props.js';

// Baked sprites for the two stream bridges (generated to the house style;
// see ART_RULES). Left null until the art lands on disk — the procedural
// parallelogram in drawSlabBridge is the fallback either way.
let SPUR_ART = null;
let LINK_ART = null;

// Deck rect == the 'bridge' passage in river.js. One source of truth.
const DECK = { x: 2025, y: 1368, w: 60, h: 168 };
const PARAPET_W = 5;
const PARAPET = { y: DECK.y + 16, h: DECK.h - 34 };   // wall run, short of both ends
// Piers: where the bridge stands in the river. Registered as wake sources so
// the current visibly breaks around them (gfx/riverfx.js), drawn here as
// stone caps poking out of the deck's shadowed sides.
const PIERS = [
  { x: DECK.x - 3, y: 1424 }, { x: DECK.x + DECK.w + 3, y: 1424 },
  { x: DECK.x - 3, y: 1478 }, { x: DECK.x + DECK.w + 3, y: 1478 },
];

const FORD = { x: 2054, y0: 1938, y1: 1998 };
const HOP = { cx: 1150, cy: 1206 };   // boulder-hop centre (passage in river.js)

// ---- the two lesser bridges over the STREAM -------------------------------
// The Guild spur and the Archive link road both cross the side-channel, and
// the first pass missed both: the roads painted flat over the water (and the
// water's collision walled the roads shut). Each now gets a real structure.
// Both roads run downhill-to-the-right at ~+0.35 here (measured off the
// paint), so the decks are STEPPED — bands of deck offset down as they go —
// which is how pixel art carries a diagonal without rotation.
//
// SPUR: a compact stone arch, the big bridge's little sibling (same masonry,
// no grandstanding). LINK: a weathered plank footbridge for the quiet path.
// Geometry is exported; river.js punches its water-collision passages from
// these same rects so structure and collision cannot drift apart.
// Fitted to the measured paint: wet road runs x 1940-2000 on the spur (the
// stream crosses it diagonally, SW to NE) and x 2264-2300 on the link; the
// road's top edge climbs ~+0.36 / +0.44 across them. Each deck is one true
// PARALLELOGRAM riding that slope — the first build stepped it in five
// chunky offset bands and read as terraced slabs, not a structure. Now the
// masonry fill is clipped to the sheared shape (tiles stay axis-aligned, as
// pixel-art masonry must), the parapets are drawn per-column so their
// diagonal is pixel-fine, and the whole south edge carries a short dark FACE
// the way the buildings do — the missing cue that the deck is a thing with
// height, not paint.
export const SPUR_BRIDGE = {
  x0: 1934, w: 70, topAt: 2004, slope: 0.357, thick: 44,
  passage: { x: 1930, y: 1998, w: 78, h: 84, kind: 'spurbridge' },
};
export const LINK_BRIDGE = {
  x0: 2256, w: 56, topAt: 1710, slope: 0.44, thick: 30,
  passage: { x: 2252, y: 1706, w: 64, h: 70, kind: 'linkbridge' },
};

// Walkable strip: the deck minus a rail's width each side, in 8-unit column
// steps down the slope. The solids fill everything between the rails and the
// passage rect's edges, so a punched passage can never leak walkable water
// at its corners. Column steps of 8 are finer than the player's own box, so
// the collision follows the diagonal as closely as movement can feel.
function bridgeSolids(scene, B, railInset) {
  const p = B.passage;
  // Columns span the FULL passage rect, not just the deck: the passage is a
  // few units wider so the road can enter it, and rails that stopped at the
  // deck ends left unsealed walkable-water pockets in those margin columns
  // (found by a traversal probe wedging itself NE of the spur deck). The
  // deck line extrapolates linearly across the margins.
  for (let bx = p.x; bx < p.x + p.w; bx += 8) {
    const cw = Math.min(8, p.x + p.w - bx);
    const top = Math.round(B.topAt + (bx + cw / 2 - B.x0) * B.slope);
    scene.solids.push(
      { x: bx, y: p.y, w: cw, h: Math.max(0, top + railInset - p.y) },
      { x: bx, y: top + B.thick - railInset, w: cw, h: Math.max(0, p.y + p.h - (top + B.thick - railInset)) },
    );
  }
}

export function buildCrossings(scene) {
  const ww = scene.waterways;
  if (!ww) return;

  // ---- collision: the parapets are what keep the player on the deck ----
  scene.solids.push(
    { x: DECK.x, y: PARAPET.y, w: PARAPET_W, h: PARAPET.h },
    { x: DECK.x + DECK.w - PARAPET_W, y: PARAPET.y, w: PARAPET_W, h: PARAPET.h },
  );

  // ---- the four lamps, one per deck corner --------------------------------
  // lamppost_wood is the lane fitting; LAMP_HEADS already knows its glass,
  // so these light themselves at night with no lighting.js changes.
  for (const [lx, ly, flip] of [
    [DECK.x + 9, DECK.y + 18, true], [DECK.x + DECK.w - 9, DECK.y + 18, false],
    [DECK.x + 9, DECK.y + DECK.h - 4, true], [DECK.x + DECK.w - 9, DECK.y + DECK.h - 4, false],
  ]) {
    scene.decor.push({ name: 'lamppost_wood', x: lx, y: ly, w: 18, h: 36,
                       flip, sortY: ly, shadow: 4 });
  }

  // ---- piers become wake sources -----------------------------------------
  // The downstream pair get the full foam treatment; the upstream pair sit
  // mostly under the deck, so only their cushion shows past its edge.
  for (const p of PIERS) {
    const q = ww.query(p.x, p.y);
    if (q) ww.rocks.push({ x: p.x, y: p.y, r: 3.4, s: q.s, way: ww.ways[0], seed: hash(p.x), pier: true });
  }

  // ---- the stream bridges -------------------------------------------------
  bridgeSolids(scene, SPUR_BRIDGE, 5);
  bridgeSolids(scene, LINK_BRIDGE, 4);
  // one lantern at the spur bridge's west approach, off the road's north
  // shoulder — it is the tavern road, after all
  scene.decor.push({ name: 'lamppost_wood', x: 1932, y: 1998, w: 18, h: 36, flip: true,
                     sortY: 1998, shadow: 4 });
  // abutment wakes where the stream squeezes under each deck — one just
  // upstream, one just downstream of each span
  for (const [wx, wy] of [[1930, 2064], [2006, 2004], [2254, 1766], [2308, 1700]]) {
    const q = ww.query(wx, wy);
    if (q && q.d < -2) ww.rocks.push({ x: wx, y: wy, r: 2.2, s: q.s, way: ww.ways[1], seed: hash(wx), pier: true });
  }

  // ---- the crossings touch their surroundings -----------------------------
  // A few pieces of set dressing per bridge, deliberately asymmetric and
  // kept off the walking line: the WOODEN bridge gets the rural set (a sign
  // on one side only, stones, reeds by the water, a wildflower), the STONE
  // bridge the settled set (moss-grown rock, weeds at the lamp, tufts on
  // the south bank). Never four matching corners.
  const DRESS = [
    // wooden crossing (Archive path)
    ['wooden_sign', 2242, 1760, 0.95, false, 5],
    ['rock_small_02', 2322, 1710, 0.85, false, 4],
    ['pebbles_03', 2298, 1770, 0.9, true, 0],
    ['reeds_02', 2268, 1784, 0.85, false, 0],
    ['grass_tuft_03', 2314, 1764, 0.85, true, 0],
    ['grass_tuft_01', 2238, 1772, 0.8, false, 0],
    ['flowers_white', 2244, 1708, 0.7, false, 0],
    ['wetgrass_01', 2320, 1746, 0.8, false, 0],
    // stone crossing (Guild road). The big mossy boulder that used to park
    // at the bridge mouth is gone — it competed with the crossing; two
    // small stones sit further upstream against the bank instead.
    // Four corners, four different compositions (never mirrored):
    //   NW (lamp side, the travelled side): lamp + blue flowers + weeds
    //   NE: kept clear — the road junction needs breathing room
    //   SW: the WAYSTONE by the abutment, reeds and grass toward the water
    //   SE: one low grass cluster near the wing
    ['rock_small_01', 2040, 1990, 0.8, false, 4],
    ['pebbles_02', 2050, 1999, 0.9, true, 0],
    ['weeds_01', 1912, 1988, 0.85, true, 0],
    ['grass_tuft_02', 1922, 2064, 0.8, false, 0],
    ['grass_tuft_04', 2016, 2082, 0.8, false, 0],
    ['flowers_blue', 1914, 2012, 0.65, false, 0],
    ['reeds_04', 1946, 2088, 0.8, false, 0],
  ];
  for (const [name, x, y, k, flip, sh] of DRESS) {
    const [w, h] = DECOR_SIZE[name];
    scene.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
                       flip, sortY: y, shadow: sh });
  }
  // (a waystone with a rune-light stood here for one pass and was cut —
  // too large, too warm, and it competed with the crossing)
}

// ---- painting -------------------------------------------------------------
// Ground-stage: called after the river FX so nothing sparkles on the deck.
export function drawCrossings(scene, g, visW, visH) {
  const ww = scene.waterways;
  if (!ww) return;
  const camX = scene.camX, camY = scene.camY;
  const vis = (x, y, w, h) => x + w > camX - 8 && x < camX + visW + 8 && y + h > camY - 8 && y < camY + visH + 8;

  if (vis(DECK.x - 14, DECK.y - 40, DECK.w + 28, DECK.h + 80)) {
    // the trunk road eases into the deck's stone from both approaches
    stoneTintApproach(scene, g,
      { ax: DECK.x + DECK.w / 2, ay: DECK.y, axis: 'y', dir: -1, half: 24 });
    stoneTintApproach(scene, g,
      { ax: DECK.x + DECK.w / 2, ay: DECK.y + DECK.h, axis: 'y', dir: 1, half: 24 });
    drawBridge(g, scene.t);
  }
  if (vis(FORD.x - 20, FORD.y0 - 10, 40, FORD.y1 - FORD.y0 + 20)) drawFordStones(g);
  if (vis(HOP.cx - 30, HOP.cy - 55, 60, 110)) drawBoulderHop(g);
  const sp = SPUR_BRIDGE.passage, lp = LINK_BRIDGE.passage;
  if (vis(sp.x - 40, sp.y - 20, sp.w + 80, sp.h + 40)) drawSpurBridge(g, scene);
  if (vis(lp.x - 40, lp.y - 20, lp.w + 80, lp.h + 40)) drawLinkBridge(g, scene);
}

// ---- bridge approaches ----------------------------------------------------
// GROUND-SURFACE transitions only: no platforms, no pillars, no end caps —
// a heavier pass with dirt pads and foundation bars was tried and rejected
// (it read as connector blocks pasted around the entrances). What remains:
//
//   * a gentle material TINT over the road's own cells (the bridge's colour
//     family bleeding a couple of dozen units up the road, feathered),
//   * and, at the wooden bridge, a THRESHOLD treatment: the road compacts
//     (its frayed stipple fills in along the walkable line), a thin earth
//     seam runs under the first plank, the plank itself laps the road edge,
//     and a bearer nub or two peeks from under the deck — the bridge's own
//     anatomy, not added structure.
//
// The eye should notice the bridge, never the transition.

// distance from the deck edge, along the approach, for a cell centre
function endDist(end, x, y) {
  return end.axis === 'x' ? (x - end.ax) * end.dir : (y - end.ay) * end.dir;
}
// signed lateral offset from the road line at the deck end
function endOff(end, x, y) {
  return end.axis === 'x' ? y - end.ay : x - end.ax;
}

function eachApproachCell(scene, end, reach, fn) {
  const C = ROAD_CELL;
  const along = { x: end.axis === 'x' ? end.dir : 0, y: end.axis === 'y' ? end.dir : 0 };
  const x0 = end.ax + Math.min(0, along.x * (reach + 8)) - (end.axis === 'x' ? 0 : end.half + 12);
  const y0 = end.ay + Math.min(0, along.y * (reach + 8)) - (end.axis === 'y' ? 0 : end.half + 12);
  const w = end.axis === 'x' ? reach + 8 : (end.half + 12) * 2;
  const h = end.axis === 'y' ? reach + 8 : (end.half + 12) * 2;
  const c0 = Math.floor(x0 / C), c1 = Math.floor((x0 + w) / C);
  const r0 = Math.floor(y0 / C), r1 = Math.floor((y0 + h) / C);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = scene.roadCov.get(c + ',' + r);
      if (!cell) continue;
      if (cell.edge === 1 && hash(c * 13.1 + r * 29.7) > 0.5) continue; // painter's stipple
      const x = c * C, y = r * C;
      const d = endDist(end, x + C / 2, y + C / 2);
      if (d < -2 || d > reach + 8) continue;
      fn(x, y, d, endOff(end, x + C / 2, y + C / 2), c, r);
    }
  }
}

// The funnel that costs no geometry: near the threshold, the fray-stipple
// cells the road painter dropped are filled back in — but only inside the
// walkable line — so a firm core emerges from the ragged path and aims at
// the deck. Along the flanks, single green pokes push between the last
// stones: travellers wore the middle, the edges are losing to the grass.
function compactApproach(scene, g, end, walkHalf) {
  const C = ROAD_CELL;
  const alongX = end.axis === 'x';
  for (let dd = 0; dd < 20; dd += C) {
    for (let oo = -walkHalf - 6; oo <= walkHalf + 6; oo += C) {
      const px = end.ax + (alongX ? end.dir * dd : oo);
      const py = end.ay + (alongX ? oo : end.dir * dd);
      const c = Math.floor(px / C), r = Math.floor(py / C);
      const cell = scene.roadCov.get(c + ',' + r);
      if (!cell) continue;
      const inWalk = Math.abs(oo) <= walkHalf + 2;
      if (cell.edge === 1 && hash(c * 13.1 + r * 29.7) > 0.5) {
        // a dropped fringe cell: refill it only inside the walkable line
        if (!inWalk) continue;
        const strength = 1 - dd / 22;
        if (hash(c * 3.3 + r * 6.7 + 83) > strength + 0.35) continue;
        const x = c * C, y = r * C;
        const tc = Math.floor(x / ROAD_TILE), tr = Math.floor(y / ROAD_TILE);
        const tile = roadTileFor(cell.fam, tc, tr);
        if (tile && tile.ready) g.drawImage(tile.img, x - tc * ROAD_TILE, y - tr * ROAD_TILE, C, C, x, y, C, C);
        else rect(g, x, y, C, C, '#a89e84');
        if (cell.wash) { g.fillStyle = cell.wash; g.fillRect(x, y, C, C); }
      } else if (!inWalk && cell.edge <= 2 && dd > 6 &&
                 hash(c * 5.9 + r * 8.3 + 84) > 0.8) {
        // grass poking between the outermost surviving stones
        const x = c * C, y = r * C;
        g.fillStyle = hash(c + r * 2) > 0.5 ? '#4c7a42' : '#3f6a3a';
        g.fillRect(x + Math.floor(hash(c * 1.7 + r) * 3), y + Math.floor(hash(c + r * 3.1) * 3), 1, 2);
      }
    }
  }
}

// The gentle tint: the bridge's colour family bleeding up the road, cell by
// cell over the road's own paint, fading with distance. This IS the whole
// stone-bridge treatment for now (the wooden bridge adds its threshold work
// below): value and texture only, silhouette untouched.
function stoneTintApproach(scene, g, end, reach = 28) {
  const C = ROAD_CELL;
  eachApproachCell(scene, end, reach, (x, y, d) => {
    const fade = 1 - Math.max(0, d) / reach;
    if (fade <= 0.04) return;
    const tc = Math.floor(x / ROAD_TILE), tr = Math.floor(y / ROAD_TILE);
    const tile = roadTileFor('civic', tc, tr);
    g.globalAlpha = Math.min(1, fade) * 0.85;
    if (tile && tile.ready) g.drawImage(tile.img, x - tc * ROAD_TILE, y - tr * ROAD_TILE, C, C, x, y, C, C);
    else rect(g, x, y, C, C, '#8a8ea0');
    g.globalAlpha = 1;
    g.fillStyle = `rgba(52,66,98,${(0.28 * fade).toFixed(3)})`;
    g.fillRect(x, y, C, C);
    g.fillStyle = `rgba(150,158,178,${(0.10 * fade).toFixed(3)})`;
    g.fillRect(x, y, C, C);
  });
}

function woodTintApproach(scene, g, end, reach = 26) {
  const C = ROAD_CELL;
  eachApproachCell(scene, end, reach, (x, y, d) => {
    const fade = 1 - Math.max(0, d) / reach;
    if (fade <= 0.04) return;
    g.fillStyle = `rgba(113,93,69,${(0.4 * fade).toFixed(3)})`;
    g.fillRect(x, y, C, C);
    if (hash(x * 3.7 + y * 5.1) > 0.8) {
      g.fillStyle = `rgba(64,48,30,${(0.28 * fade).toFixed(3)})`;
      g.fillRect(x, y + C - 1, C, 1);
    }
  });
}

// ---- the wooden bridge's THRESHOLD ----------------------------------------
// Everything here is road surface or bridge anatomy — nothing added beside
// or on top of the composition.
//
// woodThresholdGround (under the deck draw):
//   * the road COMPACTS: within the walkable line the frayed stipple cells
//     the road painter dropped are filled back in, so the last stretch
//     firms up and reads intentionally built — that firming is also the
//     "funnel": a solid core emerging from the ragged path
//   * tiny dirt flecks between the stones, and a thin packed-earth seam
//     right where the planks will land, spanning the walkable width only
// woodThresholdDress (after the deck draw):
//   * the first plank laps a couple of pixels past the deck end over the
//     seam, so wood visibly rests ON road
//   * one or two bearer nubs peek from under the deck edge — the bridge's
//     own bones, placed asymmetrically
//   * traffic wear at the entrance centre: a few lightened plank pixels,
//     the odd darker seam, a breath of dirt at the threshold
function woodThresholdGround(scene, g, B) {
  const C = ROAD_CELL;
  const walkHalf = B.thick / 2 - 4;
  for (const end of slabEnds(B)) {
    eachApproachCell(scene, end, 18, (x, y, d, off, c, r) => {
      if (Math.abs(off) > walkHalf + 3) return;
      // refill the stipple: eachApproachCell already skips dropped cells,
      // so compacting means drawing the road material into the SKIPPED
      // ones — handled below via a second direct scan
      void c; void r;
      // dirt flecks between stones, sparser than any pad
      if (d < 12 && hash(x * 2.9 + y * 7.3 + 81) > 0.82) {
        g.fillStyle = 'rgba(107,88,64,0.4)';
        g.fillRect(x + 1, y + 1, 2, 1);
      }
    });
    // compact the frayed edge into a firm walkable core (shared with the
    // stone bridge), with grass pushing back in along the flanks
    compactApproach(scene, g, end, walkHalf);
    const alongX = end.axis === 'x';
    // the thin earth seam the planks land on: 2px, walkable width, a little
    // ragged at both ends
    const seamLen = walkHalf * 2 + 2;
    for (let k = 0; k < seamLen; k++) {
      const o = -walkHalf - 1 + k;
      if (k < 2 || k > seamLen - 3) { if (hash(end.ax + k * 3.1) > 0.5) continue; }
      const px = Math.round(end.ax + (alongX ? end.dir * 1 : o));
      const py = Math.round(end.ay + (alongX ? o : end.dir * 1));
      g.fillStyle = hash(k * 7.7 + end.ay) > 0.4 ? '#6b5844' : '#5f4e3a';
      g.fillRect(px, py, alongX ? 2 : 1, alongX ? 1 : 2);
    }
  }
}

function woodThresholdDress(g, B) {
  const walkHalf = B.thick / 2 - 4;
  for (const end of slabEnds(B)) {
    const alongX = end.axis === 'x';
    // the first plank laps the road edge: a 2px plank lip past the deck end
    const lipX = Math.round(end.ax + (alongX ? (end.dir > 0 ? 0 : -2) : -walkHalf));
    const lipY = Math.round(end.ay + (alongX ? -walkHalf : (end.dir > 0 ? 0 : -2)));
    g.fillStyle = '#5f4c36';
    g.fillRect(lipX, lipY, alongX ? 2 : walkHalf * 2, alongX ? walkHalf * 2 : 2);
    g.fillStyle = 'rgba(154,129,92,0.6)';
    g.fillRect(lipX, lipY, alongX ? 1 : walkHalf * 2, alongX ? walkHalf * 2 : 1);
    // bearer nubs under the deck edge — two on the west end, one east
    const nubs = end.dir < 0 ? [-walkHalf + 3, walkHalf - 5] : [walkHalf - 6];
    for (const o of nubs) {
      const nx = Math.round(end.ax + (alongX ? end.dir * 2 - 1 : o));
      const ny = Math.round(end.ay + (alongX ? o : end.dir * 2 - 1));
      g.fillStyle = '#3f3020';
      g.fillRect(nx, ny, alongX ? 2 : 3, alongX ? 3 : 2);
    }
    // traffic wear on the entrance planks: centre lightened, odd dark seam,
    // dirt breathing over the threshold
    const seed = end.ax * 1.3;
    for (let i = 0; i < 5; i++) {
      const o = (hash(seed + i * 3.7) - 0.5) * walkHalf;      // biased to centre
      const dd = 1 + Math.floor(hash(seed + i * 5.9) * 5);
      const px = Math.round(end.ax - (alongX ? end.dir * dd : -o));
      const py = Math.round(end.ay + (alongX ? o : -end.dir * dd));
      g.fillStyle = i < 3 ? 'rgba(170,146,108,0.35)' : 'rgba(40,30,20,0.4)';
      g.fillRect(px, py, i < 3 ? 2 : 1, 1);
    }
    for (let i = 0; i < 3; i++) {
      const o = (hash(seed + i * 9.1 + 4) - 0.5) * walkHalf * 1.4;
      const px = Math.round(end.ax + (alongX ? end.dir * (2 + hash(seed + i) * 2) : o));
      const py = Math.round(end.ay + (alongX ? o : end.dir * (2 + hash(seed + i) * 2)));
      g.fillStyle = 'rgba(96,80,56,0.35)';
      g.fillRect(px, py, 1, 1);
    }
  }
}

// One sheared deck, two materials. The parallelogram is clipped so the
// axis-aligned masonry/plank fill (which pixel art demands) takes the
// diagonal shape without any banding; the parapets and the south face are
// then drawn per 1px column so their diagonals are pixel-fine. If a baked
// sprite for this crossing exists (assets/props/, generated to match the
// house style), it is blitted INSTEAD of the procedural fill — the geometry,
// collision and shadow stay identical either way.
function drawSlabBridge(g, B, style, art) {
  const x0 = B.x0, x1 = B.x0 + B.w;
  const topOf = (x) => B.topAt + (x - x0) * B.slope;
  const FACE = style.face;      // px of visible south face below the deck

  // shadow the span throws on the water, past the south face
  g.fillStyle = 'rgba(10,20,32,0.38)';
  for (let x = x0; x < x1; x += 2) {
    g.fillRect(x, Math.round(topOf(x + 1)) + B.thick + FACE, 2, 3);
  }

  if (art && art.ready) {
    // the generated sprite carries deck, parapets and face in one image,
    // sized exactly to this geometry at bake time
    g.drawImage(art.img, x0 - style.artPadX, Math.round(B.topAt) - style.artPadY);
  } else {
    // ---- procedural fallback ------------------------------------------
    // fill: clip the sheared deck, lay the material axis-aligned inside
    g.save();
    g.beginPath();
    g.moveTo(x0, B.topAt);
    g.lineTo(x1, topOf(x1));
    g.lineTo(x1, topOf(x1) + B.thick);
    g.lineTo(x0, B.topAt + B.thick);
    g.closePath();
    g.clip();
    style.fill(g, x0, Math.floor(B.topAt), B.w, Math.ceil(B.thick + B.w * B.slope));
    g.restore();
    // edges per column: parapet tops and the south face
    for (let x = x0; x < x1; x++) {
      const top = Math.round(topOf(x));
      const bot = top + B.thick;
      // top parapet: lit outer row, mid, seam onto the deck
      rect(g, x, top, 1, 1, style.railLit);
      rect(g, x, top + 1, 1, 2, style.railMid);
      rect(g, x, top + 3, 1, 1, style.railDark);
      // bottom parapet + the south FACE hanging below it
      rect(g, x, bot - 4, 1, 1, style.railDark);
      rect(g, x, bot - 3, 1, 2, style.railMid);
      rect(g, x, bot - 1, 1, 1, style.railLit);
      rect(g, x, bot, 1, FACE - 1, style.faceCol);
      rect(g, x, bot + FACE - 1, 1, 1, style.faceDark);
    }
    // the arch mouth in the face where the water slips out downstream
    const ax = x0 + style.archAt;
    const ay = Math.round(topOf(ax)) + B.thick;
    fillEllipse(g, ax, ay + FACE - 1, 6, FACE - 1, '#0a0f16');
    // end posts: four structural blocks anchoring the open ends — cap lit,
    // body mid, a short south face so each reads planted, not pasted
    const PH = style.postH || 7, PF = style.postFace || 2;
    for (const ex of [x0 - 2, x1 - 3]) {
      const et = Math.round(topOf(ex + 2));
      for (const ey of [et - 2, et + B.thick - PH + 2]) {
        rect(g, ex, ey, 5, PH, style.postMid);
        rect(g, ex, ey, 5, 2, style.railLit);
        rect(g, ex + 4, ey + 2, 1, PH - 2, style.railDark);
        rect(g, ex, ey + PH, 5, PF, style.faceCol);
        rect(g, ex, ey + PH + PF - 1, 5, 1, style.faceDark);
      }
    }
  }
}

const SPUR_STYLE = {
  face: 5, archAt: 10, artPadX: 4, artPadY: 6, postH: 7, postFace: 3,
  railLit: '#9ba0ab', railMid: '#7d8189', railDark: '#4c4e56',
  faceCol: '#3f424b', faceDark: '#23252c', postMid: '#6d717b',
  // The deck: LARGE fitted cobbles, darker and heavier than any street —
  // this is the one surface that must not read as "the road continuing
  // over water". Offset rows, per-stone tone, dark bed showing as joints,
  // the odd cracked or moss-seamed stone.
  fill: (g, x, y, w, h) => {
    g.fillStyle = '#3f434b';                    // the bed = the joints
    g.fillRect(x, y, w, h);
    const tones = ['#666a73', '#5e626b', '#6d7179', '#585c64'];
    let ry = 0, row = 0;
    while (ry < h) {
      const rh = Math.min(6 + Math.floor(hash(y * 0.7 + row * 3.7) * 3), h - ry);
      let rx = -((row % 2) * 4) - Math.floor(hash(row * 9.1 + x) * 3);
      let i = 0;
      while (rx < w) {
        const rw = 5 + Math.floor(hash(x * 0.9 + row * 7.7 + i * 3.1) * 4);
        const sx = x + Math.max(0, rx), sw = Math.min(rw - Math.max(0, -rx), w - Math.max(0, rx));
        if (sw > 0 && rh > 1) {
          const hh = hash(row * 1.9 + i * 5.3 + x * 0.3);
          g.fillStyle = tones[Math.floor(hh * tones.length) % tones.length];
          g.fillRect(sx, y + ry, sw, rh - 1);
          g.fillStyle = 'rgba(160,168,186,0.22)';          // upper-left light
          g.fillRect(sx, y + ry, sw, 1);
          g.fillStyle = 'rgba(28,30,38,0.5)';              // lower-right shade
          g.fillRect(sx, y + ry + rh - 2, sw, 1);
          if (hh > 0.86) {                                 // a cracked stone
            g.fillStyle = 'rgba(24,26,32,0.7)';
            g.fillRect(sx + Math.floor(sw / 2), y + ry + 1, 1, rh - 3);
          }
          if (hash(row * 4.3 + i * 8.9) > 0.9) {           // moss in a joint
            g.fillStyle = '#55704a';
            g.fillRect(sx + 1, y + ry + rh - 2, 2, 1);
          }
        }
        rx += rw + 1;
        i++;
      }
      ry += rh;
      row++;
    }
  },
};

const LINK_STYLE = {
  face: 4, archAt: 8, artPadX: 4, artPadY: 6, postH: 8, postFace: 3,
  railLit: '#8a6c42', railMid: '#5b4730', railDark: '#2e2114',
  faceCol: '#4c3c28', faceDark: '#2c2014', postMid: '#5f4b32',
  // The deck: individual planks laid ACROSS the walking line, each with its
  // own weathered tone, dark gaps between, the odd knot and a worn streak —
  // plank rhythm is what makes a timber bridge read at gameplay scale.
  fill: (g, x, y, w, h) => {
    const tones = ['#79644a', '#6f5c44', '#67553e', '#7d6849', '#725e46'];
    let px = 0, i = 0;
    while (px < w) {
      const pw = Math.min(3 + (hash(x * 0.8 + i * 7.7) > 0.7 ? 1 : 0), w - px);
      const t = tones[Math.floor(hash(x * 1.3 + i * 3.1) * tones.length) % tones.length];
      g.fillStyle = t;
      g.fillRect(x + px, y, pw, h);
      if (hash(i * 5.3 + x * 0.6) > 0.68) {               // worn lighter streak
        g.fillStyle = 'rgba(170,146,108,0.28)';
        const wy = y + 3 + Math.floor(hash(i * 9.1 + x) * Math.max(1, h - 9));
        g.fillRect(x + px, wy, pw, 2 + Math.floor(hash(i * 2.1) * 3));
      }
      if (hash(i * 11.3 + x * 0.7) > 0.86) {              // a knot / nail head
        g.fillStyle = '#443320';
        g.fillRect(x + px + 1, y + 2 + Math.floor(hash(i * 2.9 + x) * Math.max(1, h - 4)), 1, 1);
      }
      g.fillStyle = 'rgba(30,22,14,0.75)';                // the gap
      g.fillRect(x + px + pw, y, 1, h);
      px += pw + 1;
      i++;
    }
  },
};

function slabEnds(B) {
  return [
    { ax: B.x0, ay: B.topAt + B.thick / 2, axis: 'x', dir: -1, half: B.thick / 2 },
    { ax: B.x0 + B.w, ay: B.topAt + B.slope * B.w + B.thick / 2, axis: 'x', dir: 1, half: B.thick / 2 },
  ];
}

// ---- the stone bridge: old handcrafted countryside crossing ---------------
// Art-direction makeover (2026-08-26): ancient civic infrastructure that has
// grown into the landscape. The giant-slab deck is gone — the masonry is
// medium-small dressed stone, hand-laid: broken courses, offset joints, the
// odd stone spanning two courses, chipped corners, a handful of visibly
// repaired stones borrowing the road's tan. Material hierarchy: charcoal
// blue-gray joints, cool mid stones, warmer weathered ones, restrained pale
// top light, muted moss. The two long sides are NOT mirror images: the
// upstream wall swells a touch more and carries one small damage notch. The
// wings anchor into the banks under overlapping soil, and a lone weathered
// waystone stands off-path by the south-west abutment — the old
// civilization's one quiet mark on the crossing.
function drawSpurBridgeProposed(g, scene) {
  const B = SPUR_BRIDGE;
  const x0 = B.x0, x1 = B.x0 + B.w;
  const t = scene.t || 0;
  const topOf = (x) => B.topAt + (x - x0) * B.slope;
  const centerOf = (x) => topOf(x) + B.thick / 2;
  // asymmetric taper: the upstream (north) side swells slightly more
  const swell = (x) => Math.sin(Math.PI * (x - x0) / B.w);
  const halfN = (x) => B.thick / 2 - 1 + 1.5 * swell(x);
  const halfS = (x) => B.thick / 2 - 1 + 0.9 * swell(x);
  const FACE = 5;

  for (const end of slabEnds(B)) {
    stoneTintApproach(scene, g, end);
    compactApproach(scene, g, end, B.thick / 2 - 5);
  }

  // ---- the water: deep under-shadow + darkened contacts -----------------
  g.fillStyle = 'rgba(6,14,26,0.5)';
  for (let x = x0; x < x1; x += 2) {
    g.fillRect(x, Math.round(centerOf(x + 1) + halfS(x + 1)) + FACE, 2, 5);
  }
  g.fillStyle = 'rgba(8,18,30,0.28)';
  for (let x = x0; x < x1; x += 2) {
    g.fillRect(x, Math.round(centerOf(x + 1) + halfS(x + 1)) + FACE + 5, 2, 2);
  }
  fillEllipse(g, x0 + 2, centerOf(x0) + halfS(x0) + 9, 9, 4, 'rgba(8,18,30,0.35)');
  fillEllipse(g, x1 - 2, topOf(x1) - 5, 8, 4, 'rgba(8,18,30,0.3)');
  // upstream abutment: the current worries at the masonry — two tiny foam
  // clusters pulsing out of step, and nothing downstream but clean flow
  for (const [fx, fy, ph] of [[x1 - 2, topOf(x1) - 8, 0], [x1 - 8, topOf(x1) - 4, 2.1]]) {
    const a = 0.3 + 0.25 * Math.sin(t * 3.1 + ph);
    g.fillStyle = `rgba(238,248,252,${a.toFixed(2)})`;
    g.fillRect(Math.round(fx), Math.round(fy), 1, 1);
    if (a > 0.42) g.fillRect(Math.round(fx) - 1, Math.round(fy) + 1, 1, 1);
  }

  // ---- deck: hand-laid dressed stone ------------------------------------
  g.save();
  g.beginPath();
  g.moveTo(x0, centerOf(x0) - halfN(x0));
  for (let x = x0 + 2; x <= x1; x += 2) g.lineTo(x, centerOf(x) - halfN(x));
  for (let x = x1; x >= x0; x -= 2) g.lineTo(x, centerOf(x) + halfS(x));
  g.closePath();
  g.clip();
  // charcoal blue-gray bed = the joints
  g.fillStyle = '#4b4f59';
  g.fillRect(x0 - 2, topOf(x0) - 6, B.w + 4, B.thick + B.slope * B.w + 12);
  // medium-small dressed stones: broken courses, offset joints, varied
  // shapes. Tones: cool mids, a warmer weathered pair, rare repairs in the
  // road's own tan family.
  const tones = ['#797d84', '#74787f', '#7d8087', '#807b71', '#767a80'];
  const seed = 91.7;
  let ry = Math.floor(topOf(x0)) - 4, row = 0;
  const bedBot = topOf(x1) + B.thick + 6;
  const talls = [];        // stones that span into the next course
  while (ry < bedBot) {
    const rh = 4 + Math.floor(hash(seed + row * 3.7) * 3);           // 4-6 tall
    let rx = x0 - 3 - Math.floor(hash(seed + row * 9.1) * 8);
    let i = 0;
    while (rx < x1 + 3) {
      const shape = hash(seed + row * 7.7 + i * 3.1);
      const rw = shape < 0.2 ? 3 + Math.floor(shape * 10)            // near-square
               : shape > 0.85 ? 8 + Math.floor((shape - 0.85) * 20)  // longer stone
               : 4 + Math.floor(shape * 5);                          // dressed rect
      const hh = hash(seed + row * 1.9 + i * 5.3);
      const covered = talls.some(([tx0, tx1, trow]) => trow === row && rx + rw > tx0 && rx < tx1);
      if (!covered) {
        const repaired = hh > 0.965;                                 // ~4 on the deck
        g.fillStyle = repaired ? '#8a8478' : tones[Math.floor(hh * tones.length) % tones.length];
        // one stone in a while stands two courses tall
        const tall = !repaired && hh > 0.9 && hh <= 0.965;
        const drawH = tall ? rh + 5 : rh - 1;
        g.fillRect(rx, ry, rw, drawH);
        if (tall) talls.push([rx, rx + rw, row + 1]);
        // restrained pale top light on most stones
        if (hh > 0.6) {
          g.fillStyle = 'rgba(182,184,174,0.28)';
          g.fillRect(rx, ry, rw, 1);
        }
        g.fillStyle = 'rgba(24,28,38,0.22)';
        g.fillRect(rx, ry + drawH - 1, rw, 1);
        // the odd chipped corner: a bite of joint colour
        if (hh < 0.04) {
          g.fillStyle = '#4b4f59';
          g.fillRect(hh < 0.04 ? rx : rx + rw - 2, ry, 2, 1);
        }
      }
      rx += rw + 1;
      i++;
    }
    ry += rh;
    row++;
  }
  // weathering tells the story: outer edges dirtier, the walking centre
  // polished lighter by generations of feet (dither-edged, never a stripe)
  for (let x = x0; x < x1; x++) {
    const c = centerOf(x);
    g.fillStyle = 'rgba(16,20,28,0.10)';
    g.fillRect(x, Math.round(c - halfN(x)) + 4, 1, 3);
    g.fillRect(x, Math.round(c + halfS(x)) - 7, 1, 3);
  }
  // foot-traffic wear: discrete worn PATCHES strung loosely along the
  // middle — light, medium, light — never a continuous painted band
  for (let k = 0; k < 9; k++) {
    const ps = x0 + 4 + hash(200 + k * 7.7) * (B.w - 14);
    const plen = 6 + Math.floor(hash(201 + k * 3.1) * 8);
    const off = (hash(202 + k * 5.3) - 0.5) * 7;
    const strength = 0.07 + hash(203 + k * 9.1) * 0.07;
    for (let dx = 0; dx < plen; dx++) {
      const x = Math.round(ps + dx);
      if (x >= x1) break;
      const c = centerOf(x) + off + Math.sin(dx * 0.9 + k) * 1.2;
      const hgt = 4 + Math.floor(hash(204 + k * 2.3 + dx) * 4);
      g.fillStyle = `rgba(178,180,168,${strength.toFixed(2)})`;
      g.fillRect(x, Math.round(c - hgt / 2), 1, hgt);
    }
  }
  // moss only where damp: outer joints, a little denser toward the banks
  for (let x = x0 + 2; x < x1 - 2; x += 3) {
    const nearBank = x < x0 + 12 || x > x1 - 12;
    for (const side of [-1, 1]) {
      if (hash(x * 4.3 + side * 9.7) > (nearBank ? 0.78 : 0.9)) {
        const half = side < 0 ? halfN(x) : halfS(x);
        const yy = Math.round(centerOf(x) + side * (half - 6 - hash(x) * 3));
        g.fillStyle = hash(x + side) > 0.5 ? '#55704a' : '#4a6342';
        g.fillRect(x, yy, 2, 1);
      }
    }
  }
  g.restore();

  // ---- parapets: dark face, stone body, hand-set capstones --------------
  for (let x = x0; x < x1; x++) {
    const c = centerOf(x);
    const top = Math.round(c - halfN(x));
    const bot = Math.round(c + halfS(x));
    const weathered = hash(Math.floor(x / 7) * 11.3) > 0.72;
    const body = weathered ? '#75736a' : '#82858c';
    rect(g, x, top + 1, 1, 2, body);
    rect(g, x, top + 3, 1, 1, '#454851');
    rect(g, x, bot - 4, 1, 1, '#454851');
    rect(g, x, bot - 3, 1, 2, body);
    rect(g, x, bot, 1, FACE - 1, '#3a3d46');
    rect(g, x, bot + FACE - 1, 1, 1, '#22242b');
    if (hash(Math.floor(x / 6) * 13.7) > 0.88) rect(g, x, top + 1, 1, 1, '#55704a');
    if (hash(Math.floor(x / 6) * 17.9 + 3) > 0.9) rect(g, x, bot - 2, 1, 1, '#4a6342');
  }
  // capstones laid one by one: varied lengths, joints, tone drift, one
  // cracked and one shifted a pixel proud — a mason's line, not a ruler's
  for (const side of [-1, 1]) {
    let x = x0;
    let ci = 0;
    while (x < x1) {
      const len = Math.min(5 + Math.floor(hash(x * 1.3 + side * 7.1) * 5), x1 - x);
      const half = side < 0 ? halfN : halfS;
      const capY = (xx) => Math.round(centerOf(xx) + side * half(xx)) - (side > 0 ? 1 : 0);
      const shifted = hash(x * 2.9 + side) > 0.93 ? side : 0;
      const tone = hash(x * 4.7 + side * 3) > 0.6 ? '#a6a69b' : '#9b9d95';
      for (let k = 0; k < len; k++) {
        rect(g, x + k, capY(x + k) + shifted, 1, 1, tone);
      }
      if (hash(x * 6.1 + side * 5) > 0.9) {                 // the cracked capstone
        rect(g, x + Math.floor(len / 2), capY(x + Math.floor(len / 2)) + shifted, 1, 1, '#6a6e76');
      }
      rect(g, x + len - 1, capY(x + len - 1) + shifted, 1, 1, '#7d8087');   // joint
      x += len;
      ci++;
    }
  }
  // the upstream wall's one small wound: a notch where a capstone fell,
  // rubble pixel resting against the wall — east half only
  {
    const nx = Math.round(x0 + B.w * 0.72);
    const nyTop = Math.round(centerOf(nx) - halfN(nx));
    g.fillStyle = '#4b4f59';
    g.fillRect(nx, nyTop, 3, 2);
    g.fillStyle = '#82858c';
    g.fillRect(nx + 4, nyTop - 2, 2, 2);                    // the fallen stone
  }
  // (an arch-mouth ellipse sat low in the face here — cut at the user's
  // request: at gameplay scale it read as a black circle stamped on the
  // masonry, and the under-span shadow already says "water passes below")


  // ---- abutments: anchored INTO the banks -------------------------------
  const wing = (ex, dir, side) => {
    const cy = centerOf(ex);
    const h0 = side < 0 ? halfN(ex) : halfS(ex);
    const steps = [
      { dx: 0, len: 11, out: 1, hh: 6 },
      { dx: 9, len: 9, out: 5, hh: 6 },
      { dx: 16, len: 7, out: 9, hh: 5 },
    ];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const bx = Math.round(ex + dir * st.dx);
      const wx = dir > 0 ? bx : bx - st.len;
      const wy = Math.round(cy + side * (h0 - 2 + st.out)) - (side > 0 ? 0 : st.hh);
      const buried = i === steps.length - 1;
      g.fillStyle = buried ? '#6a6d74' : '#7d8087';
      g.fillRect(wx, wy, st.len, st.hh);
      g.fillStyle = buried ? '#82858c' : '#a4a49a';
      g.fillRect(wx, wy, st.len, 1);
      g.fillStyle = '#3c3f48';
      g.fillRect(wx, wy + st.hh - 1, st.len, 1);
      if (side > 0 && !buried) {
        g.fillStyle = '#3a3d46';
        g.fillRect(wx, wy + st.hh, st.len, 2);
        g.fillStyle = 'rgba(14,18,26,0.55)';
        g.fillRect(wx, wy + st.hh + 2, st.len, 1);
      }
      if (buried) {
        // the earth takes the oldest stones back: soil and grass overlap
        g.fillStyle = '#55704a';
        g.fillRect(wx + (dir > 0 ? st.len - 2 : 0), wy - 1, 2, 1);
        g.fillStyle = 'rgba(90,110,70,0.6)';
        g.fillRect(wx + (dir > 0 ? st.len - 3 : 1), wy + st.hh - 1, 3, 1);
      }
    }
    // the cornerstone: one bigger foundation stone at the deck junction
    const cx2 = Math.round(ex + (dir > 0 ? -1 : -6));
    const cy2 = Math.round(cy + side * (h0 - 1)) - (side > 0 ? 5 : 1);
    g.fillStyle = '#7d8087';
    g.fillRect(cx2, cy2, 7, 6);
    g.fillStyle = '#a4a49a';
    g.fillRect(cx2, cy2, 7, 1);
    g.fillStyle = '#3c3f48';
    g.fillRect(cx2, cy2 + 6, 7, 2);
  };
  for (const [ex, dir] of [[x0, -1], [x1, 1]]) {
    wing(ex, dir, -1);
    wing(ex, dir, 1);
    // the transition floor: the deck's own small dressed stones trading
    // places with the road over ~16 units, dense at the throat, embedded
    // flush — every stone part of the walking surface
    const mix = ['#797d84', '#807b71', '#74787f', '#8a8478'];
    for (let i = 0; i < 17; i++) {
      const bias = hash(ex + i * 5.3);
      const dd = 1 + bias * bias * 21;
      const oo = (hash(ex + i * 7.9 + 1) - 0.5) * (B.thick - 12);
      const sx = Math.round(ex + dir * dd - 2);
      const sy = Math.round(centerOf(ex) + oo - 2);
      const cC = Math.floor((sx + 2) / ROAD_CELL), rC = Math.floor((sy + 2) / ROAD_CELL);
      if (!scene.roadCov.has(cC + ',' + rC)) continue;
      const sw = 4 + Math.floor(hash(ex + i * 3.1) * 4);
      const sh = 3 + Math.floor(hash(ex + i * 9.7) * 2);
      g.fillStyle = mix[Math.floor(hash(ex * 0.7 + i) * mix.length) % mix.length];
      g.fillRect(sx, sy, sw, sh);
      if (hash(ex + i * 13.1) > 0.4) {
        g.fillRect(sx + (hash(ex + i * 2.3) > 0.5 ? sw - 2 : -2), sy + 1, 3, sh - 1);
      }
      g.fillStyle = 'rgba(182,184,174,0.18)';
      g.fillRect(sx, sy, sw, 1);
      g.fillStyle = 'rgba(24,28,38,0.25)';
      g.fillRect(sx, sy + sh, sw, 1);
    }
    // age on the nearest road: a moss fleck and one cracked stone mark
    for (let i = 0; i < 3; i++) {
      const dd = 6 + hash(ex * 1.3 + i * 7.7) * 12;
      const oo = (hash(ex * 1.7 + i * 5.1) - 0.5) * (B.thick - 10);
      const mx = Math.round(ex + dir * dd);
      const my = Math.round(centerOf(ex) + oo);
      const cC = Math.floor(mx / ROAD_CELL), rC = Math.floor(my / ROAD_CELL);
      if (!scene.roadCov.has(cC + ',' + rC)) continue;
      if (i < 2) {
        g.fillStyle = hash(ex + i) > 0.5 ? '#55704a' : '#4a6342';
        g.fillRect(mx, my, 1, 1);
      } else {
        g.fillStyle = 'rgba(24,26,32,0.5)';
        g.fillRect(mx, my, 1, 2);
        g.fillRect(mx + 1, my + 2, 1, 1);
      }
    }
  }
}


function drawSpurBridge(g, scene) {
  // The integration architecture approved 2026-08-26 is the bridge now —
  // the old rectangular slab renderer is gone.
  drawSpurBridgeProposed(g, scene);
}
function drawLinkBridge(g, scene) {
  const B = LINK_BRIDGE;
  for (const end of slabEnds(B)) woodTintApproach(scene, g, end);
  woodThresholdGround(scene, g, B);
  // the posts sit in the ground: contact soil under each base, drawn
  // before the deck so the post pixels land on top of it
  const topEast = B.topAt + B.slope * B.w;
  for (const [px, py] of [
    [B.x0 - 2, B.topAt + 4], [B.x0 - 2, B.topAt + B.thick + 2],
    [B.x0 + B.w, topEast + 4], [B.x0 + B.w, topEast + B.thick + 2],
  ]) {
    fillEllipse(g, px, py, 4, 2, 'rgba(58,44,28,0.55)');
  }
  drawSlabBridge(g, B, LINK_STYLE, LINK_ART);
  // restrained railing posts mid-span: two on the lit top beam, one on the
  // south beam where it shows against the water
  const topOf = (x) => B.topAt + (x - B.x0) * B.slope;
  for (const [fx, south] of [[0.33, false], [0.68, false], [0.5, true]]) {
    const nx = Math.round(B.x0 + B.w * fx);
    const ny = Math.round(topOf(nx)) + (south ? B.thick - 3 : -2);
    g.fillStyle = '#3f3020';
    g.fillRect(nx, ny, 2, 4);
    g.fillStyle = '#6b543a';
    g.fillRect(nx, ny, 2, 1);
  }
  woodThresholdDress(g, B);
}

function drawBridge(g, t) {
  const { x, y, w, h } = DECK;

  // ---- what sits UNDER the span: shade and stone feet --------------------
  // The deck's shadow on the water. Light comes from the upper-left, so the
  // heavy side is the east (downstream) edge, with a black seam right along
  // the deck so the water visibly disappears UNDER it — the single
  // strongest cue that the deck is above the river, not painted on it.
  g.fillStyle = 'rgba(8,18,30,0.55)';
  g.fillRect(x + w, y + 30, 2, h - 58);
  g.fillStyle = 'rgba(12,24,38,0.34)';
  g.fillRect(x + w + 2, y + 34, 6, h - 66);
  g.fillStyle = 'rgba(12,24,38,0.16)';
  g.fillRect(x + w + 8, y + 44, 3, h - 86);
  // thin west seam too — subtler, that side faces the light
  g.fillStyle = 'rgba(8,18,30,0.38)';
  g.fillRect(x - 2, y + 32, 2, h - 62);

  // Pier feet: freestanding stone blocks in the water clear of the deck
  // edges, each the anchor of a wake (registered in buildCrossings).
  for (const p of PIERS) {
    const west = p.x < x + 10;
    const px = west ? p.x - 5 : p.x - 4;
    g.fillStyle = 'rgba(10,22,34,0.5)';
    g.fillRect(px - 1, p.y + 3, 11, 3);              // its own waterline shadow
    g.fillStyle = '#565962';
    g.fillRect(px, p.y - 2, 9, 6);                   // shaded body
    g.fillStyle = '#767a84';
    g.fillRect(px, p.y - 4, 9, 3);                   // lit cap
    g.fillStyle = '#8f939e';
    g.fillRect(px, p.y - 4, 9, 1);
    g.fillStyle = '#2e3038';
    g.fillRect(px, p.y + 4, 9, 1);                   // dark waterline seam
  }

  // ---- abutments: stepped masonry tying the deck into both banks ---------
  g.fillStyle = '#61646d';
  for (const [ay, dir] of [[y, 1], [y + h, -1]]) {
    g.fillRect(x - 9, dir > 0 ? ay : ay - 8, w + 18, 8);
    g.fillRect(x - 4, dir > 0 ? ay + 8 : ay - 13, w + 8, 5);
  }
  g.fillStyle = '#7d818c';
  g.fillRect(x - 9, y, w + 18, 2);                   // lit north course
  g.fillRect(x - 9, y + h - 8, w + 18, 1);
  g.fillStyle = '#34363e';
  g.fillRect(x - 9, y + 7, w + 18, 1);
  g.fillRect(x - 9, y + h - 1, w + 18, 1);           // dark south lip

  // ---- deck fill ---------------------------------------------------------
  // The civic stone pack sampled on the shared ROAD_TILE grid, so the
  // masonry pattern continues straight off the road onto the deck.
  for (let dy = 0; dy < h; dy += 4) {
    for (let dx = 0; dx < w; dx += 4) {
      const px = x + dx, py = y + dy;
      const tc = Math.floor(px / ROAD_TILE), tr = Math.floor(py / ROAD_TILE);
      const tile = roadTileFor('civic', tc, tr);
      if (tile && tile.ready) {
        g.drawImage(tile.img, px - tc * ROAD_TILE, py - tr * ROAD_TILE, 4, 4, px, py, 4, 4);
      } else {
        rect(g, px, py, 4, 4, '#8a8ea0');
      }
    }
  }
  // civic wash + a cool stone cast so the deck reads cut stone, not street
  g.fillStyle = 'rgba(52,66,98,0.30)';
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(150,158,178,0.10)';
  g.fillRect(x, y, w, h);

  // Two transverse joint lines where the arch segments meet — quiet, but
  // they break the run of road texture into SPANS.
  g.fillStyle = 'rgba(30,32,42,0.35)';
  g.fillRect(x + PARAPET_W, y + Math.round(h * 0.34), w - PARAPET_W * 2, 1);
  g.fillRect(x + PARAPET_W, y + Math.round(h * 0.66), w - PARAPET_W * 2, 1);
  g.fillStyle = 'rgba(178,184,200,0.16)';
  g.fillRect(x + PARAPET_W, y + Math.round(h * 0.34) + 1, w - PARAPET_W * 2, 1);
  g.fillRect(x + PARAPET_W, y + Math.round(h * 0.66) + 1, w - PARAPET_W * 2, 1);

  // ---- parapets: hip walls with real thickness ---------------------------
  for (const side of [0, 1]) {
    const px = side === 0 ? x : x + w - PARAPET_W;
    // lit top slab, then a shaded inner course
    g.fillStyle = '#838792';
    g.fillRect(px, PARAPET.y, PARAPET_W, PARAPET.h);
    g.fillStyle = '#9ba0ab';
    g.fillRect(px, PARAPET.y, PARAPET_W, 1);
    g.fillRect(side === 0 ? px : px + PARAPET_W - 2, PARAPET.y, 2, PARAPET.h); // outer lit rim
    // outer edge dark line, inner face shadow dropping onto the deck
    g.fillStyle = '#33353d';
    g.fillRect(side === 0 ? px : px + PARAPET_W - 1, PARAPET.y, 1, PARAPET.h);
    g.fillStyle = 'rgba(24,26,34,0.45)';
    g.fillRect(side === 0 ? px + PARAPET_W : px - 2, PARAPET.y + 2, 2, PARAPET.h - 2);
    // block joints every 13 — the wall reads as coursed stone
    for (let py = PARAPET.y + 6; py < PARAPET.y + PARAPET.h; py += 13) {
      g.fillStyle = '#5a5d66';
      g.fillRect(px, py, PARAPET_W, 1);
      g.fillStyle = '#a6abb6';
      g.fillRect(px, py + 1, PARAPET_W, 1);
    }
    // corner POSTS: chunky square towers at both wall ends, with a south
    // face — the four dark-capped blocks are what finally read as
    // "built structure" at the gameplay camera
    for (const py of [PARAPET.y - 4, PARAPET.y + PARAPET.h - 3]) {
      const ppx = px - 1 + (side === 0 ? 0 : -1);
      g.fillStyle = '#6d717b';
      g.fillRect(ppx, py, PARAPET_W + 2, 7);
      g.fillStyle = '#9ba0ab';
      g.fillRect(ppx, py, PARAPET_W + 2, 2);         // lit cap
      g.fillStyle = '#3a3c45';
      g.fillRect(ppx, py + 7, PARAPET_W + 2, 3);     // south face in shade
      g.fillStyle = '#23252c';
      g.fillRect(ppx, py + 10, PARAPET_W + 2, 1);
    }
  }
  void t;
}

// Flat wet stones marching across the stream on the road's own line. The
// water here is painted shallow (see STREAM_PTS depth at the ford), so the
// crossing reads as a ford, not as a miracle.
function drawFordStones(g) {
  for (let i = 0; i < 6; i++) {
    const fy = FORD.y0 + (i / 5) * (FORD.y1 - FORD.y0);
    const fx = FORD.x + (hash(i * 7.3) - 0.5) * 8;
    const r = 4 + hash(i * 3.1) * 2;
    // wet ring first, then the stone
    fillEllipse(g, fx, fy + 1, r + 1.5, (r + 1.5) * 0.6, 'rgba(26,52,70,0.55)');
    fillEllipse(g, fx, fy, r, r * 0.62, i % 2 ? '#7d8188' : '#8a8e95');
    fillEllipse(g, fx - r * 0.25, fy - r * 0.2, r * 0.5, r * 0.3, i % 2 ? '#989ca3' : '#a4a8af');
    rect(g, Math.round(fx + r * 0.3), Math.round(fy + r * 0.25), 1, 1, '#5d6169');
  }
}

// Big rough boulders over the upper river — same idea, wilder material.
function drawBoulderHop(g) {
  for (let i = 0; i < 5; i++) {
    const k = i / 4;
    const by = HOP.cy - 44 + k * 88;
    const bx = HOP.cx + Math.sin(k * 6.1) * 7 + (hash(i * 9.7) - 0.5) * 6;
    const r = 5.5 + hash(i * 4.3) * 2.5;
    fillEllipse(g, bx, by + 1, r + 1.5, (r + 1.5) * 0.62, 'rgba(24,48,66,0.5)');
    fillEllipse(g, bx, by - 1, r, r * 0.75, i % 2 ? '#6e7278' : '#63686f');
    fillEllipse(g, bx - r * 0.25, by - r * 0.5, r * 0.55, r * 0.35, '#8b9096');
    rect(g, Math.round(bx + r * 0.25), Math.round(by), 2, 1, '#4e525a');
    if (hash(i * 6.1) > 0.5) rect(g, Math.round(bx - r * 0.4), Math.round(by + r * 0.3), 1, 1, '#5a7a5e'); // moss fleck
  }
}

export { DECK as BRIDGE_DECK, FORD, HOP };
