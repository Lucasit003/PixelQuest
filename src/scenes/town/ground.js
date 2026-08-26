// Everything the town draws UNDER its props: grass, the Crystal Plaza floor,
// the square/courtyard surfaces and the corruption biome at the dungeon gate.
//
// The plaza floor is the interesting part. It is not a stamped disc — it is
// built from the same modular stone pack as the roads, on the same 28-unit
// tile grid, so the paving runs continuously out of the square and into the
// streets with no seam. Three things make it read as a place rather than a
// circle of texture:
//
//   * plazaEdgeJitter wobbles the boundary radius outward only. An inward dip
//     left wedges of bare grass where the road flares assumed the paving
//     reached at least R — visible as holes punched at each of the four mouths.
//   * buildFlare gives each cardinal exit a trapezoid transition whose near
//     edge is sampled off that same jittered boundary, so the join is
//     pixel-exact.
//   * the tile pool shifts zonally from clean base stone at the centre to worn
//     and weathered toward the rim, which is what carries "old civic square".
//
// drawGround/drawCorruption take the scene explicitly; the rest are pure.

import { rect, clamp, clamp01, lerp } from '../../gfx/pixel.js';
import { hash, fillEllipse, contactShadow } from './primitives.js';
import { GRASS_TILES, GRASS_TILE, PLAZA_TILES, ROAD_TILE } from './tiles.js';
import { ROAD_FAM, washFor, roadTileFor, drawRoads } from './roads.js';
import { POND_ART, POND_W, POND_H, pondMask, setPondMask } from './lake.js';
// The plaza floor leaves a clear apron around the fountain's own footprint.
import { FOUNTAIN_W } from './fountain.js';
import { DECOR_ART } from './props.js';
import { buildWaterMask, drawFishJump, drawDucks, drawFrogs, drawPondPads } from '../../gfx/waterfx.js';
import { drawRiverBase, drawWaterOverlays, riverJumpRegions } from './river.js';
import { drawRiverFX, drawLakeInflow } from '../../gfx/riverfx.js';
import { drawCrossings } from './bridge.js';
import { drawRiverfrontGround } from './riverfront.js';

export function drawGround(scene, g, visW, visH) {
  const camX = scene.camX, camY = scene.camY;
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
  const FCg = scene.plazaFocus, KEPT = 360;
  for (let rr = gr0; rr <= gr1; rr++) {
    for (let cc = gc0; cc <= gc1; cc++) {
      const hv = hash(cc * 12.7 + rr * 7.3);
      let idx = hv < 0.42 ? 0 : hv < 0.84 ? 1 : hv < 0.94 ? 2 : 3;
      if (idx === 3 && FCg
          && Math.hypot((cc + 0.5) * GRASS_TILE - FCg.x, (rr + 0.5) * GRASS_TILE - FCg.y) < KEPT) idx = 0;
      const tile = GRASS_TILES[idx];
      if (!tile.ready) continue;
      // Two different things were drawing the tile grid as visible rectangles.
      //
      // The outermost pixel ring of each 197px slice carries the sheet-cut
      // artifact, and minifying it into 96 world units guarantees that ring is
      // sampled at every boundary — a repeating line at exactly the tile pitch.
      // Insetting the SOURCE rect by a pixel drops it: measured on a field of
      // one tile, the boundary-to-interior step went 1.75x -> 1.22x at zoom 1
      // and 1.42x -> 1.01x at the gameplay camera.
      //
      // The stronger effect was plain repetition. Four variants, two of them
      // near-identical, laid edge to edge means the same blades recur every 96
      // units and the eye locks onto the lattice. Autocorrelating a strip of
      // open grass from the wide shot put the peak at lag 53px against a
      // predicted pitch of 52.8 — r=0.58, four times the next candidate.
      // Mirroring per cell turns four tiles into sixteen orientations for the
      // cost of a transform, and costs no art.
      const src = tile.img.naturalWidth;
      const x0 = cc * GRASS_TILE, y0 = rr * GRASS_TILE;
      const fx = hash(cc * 3.1 + rr * 9.7) > 0.5, fy = hash(cc * 5.9 + rr * 2.3) > 0.5;
      if (fx || fy) {
        g.save();
        g.translate(x0 + (fx ? GRASS_TILE : 0), y0 + (fy ? GRASS_TILE : 0));
        g.scale(fx ? -1 : 1, fy ? -1 : 1);
        g.drawImage(tile.img, 1, 1, src - 2, src - 2, 0, 0, GRASS_TILE, GRASS_TILE);
        g.restore();
      } else {
        g.drawImage(tile.img, 1, 1, src - 2, src - 2, x0, y0, GRASS_TILE, GRASS_TILE);
      }
    }
  }

  // The river: base water + banks, from cached chunk renders. Before the
  // pond art so the stream's end dissolves under the lake's own painted
  // shore, after the grass it is cut into.
  drawRiverBase(scene, g, visW, visH);

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
    g.drawImage(POND_ART.img, Math.round(scene.lakeTopLeft.x), Math.round(scene.lakeTopLeft.y), POND_W, POND_H);
    if (!pondMask()) setPondMask(buildWaterMask(POND_ART.img));
    // The stream mouth: repaint its water over the pond art's baked east
    // shore, so the stream visibly joins the lake's own water. Masked to
    // the art's own land pixels — needs the pond mask just built.
    drawWaterOverlays(scene, g, visW, visH, 'pond', pondMask());
    // ...and the lake answers the inflow: ripple arcs spreading from the
    // delta out into the pond, foam riding the last of the current.
    drawLakeInflow(scene, g, visW, visH, scene.t);
    // Extra lily pads from assets/pond vegg.png, straight after the art and
    // before anything living so the fish, ducks and frogs are on top of them.
    // The frogs treat these as somewhere to jump, not just as scenery.
    drawPondPads(g, pondMask(), scene.lakeTopLeft.x, scene.lakeTopLeft.y, POND_W, POND_H);
    // Fish break the surface from spots around the lake (assets/fish1.png).
    // They draw above the water but still in the ground pass, which is fine —
    // the lake is solid, so the player can never stand between the two.
    drawFishJump(g, pondMask(), scene.lakeTopLeft.x, scene.lakeTopLeft.y, POND_W, POND_H, scene.t);
    // Ducks live on the lake full-time (assets/duck.png) — paddling, looking
    // about, dipping and dabbling.
    drawDucks(g, pondMask(), scene.lakeTopLeft.x, scene.lakeTopLeft.y, POND_W, POND_H, scene.t);
    // Frogs sit out on the lily pads (assets/frog.png), one to a cluster.
    // Last, so a frog is never hidden by the bird swimming past its pad.
    drawFrogs(g, pondMask(), scene.lakeTopLeft.x, scene.lakeTopLeft.y, POND_W, POND_H, scene.t);
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
  drawRoads(scene, g, visW, visH);

  // Where the trunk road fords the stream, the water wins: re-blit the
  // river base over the road paint so the road visibly dips into the
  // crossing (the stepping stones draw on top of this).
  drawWaterOverlays(scene, g, visW, visH, 'roads');

  // The current: streaks, glints, whitecaps, carried ripples, leaves, fish
  // shadows, rock wakes — everything on the river that moves.
  drawRiverFX(scene, g, visW, visH, scene.t);

  // The pond's fish break the surface of the river too, in its two calm
  // deeps — the plunge pool and the Archive reach.
  for (const r of riverJumpRegions(scene)) {
    if (r.left > scene.camX + visW || r.left + r.w < scene.camX ||
        r.top > scene.camY + visH || r.top + r.h < scene.camY) continue;
    drawFishJump(g, r.info, r.left, r.top, r.w, r.h, scene.t, r.period, r.count);
  }

  // The crossings paint OVER the moving water: bridge deck and parapets,
  // ford stepping stones, the wild boulder-hop.
  drawCrossings(scene, g, visW, visH);

  // The Archive landing's plank deck (its boat is an entity).
  drawRiverfrontGround(scene, g, visW, visH);

  // Crystal Plaza floor: the approved zoned stone disc with its four
  // flare transitions, which the roads above run into with no seam —
  // both are drawn from the same modular pack on the same tile grid.
  plaza(g, scene.plazaFocus.x, scene.plazaFocus.y, scene.plazaRadius, scene.plazaFlares);

  // Market Square dirt-oval ground removed (per direction) — stalls sit
  // directly on grass now, no packed-dirt ellipse drawn beneath them.
  // Courtyard aprons removed too (per direction) — the oval discs under the
  // shops/guild/archive read as odd floating circles now that real roads
  // reach each door. The `courtyards` list is kept because the legacy
  // roadCells rasteriser still subtracts it; nothing draws it.

  drawCorruption(scene, g);
}

/** Dark, wilted ground ringing the Runebound Gate, strongest at the entrance. */
export function drawCorruption(scene, g) {
  const gate = { x: scene.districts.gate.x, y: scene.districts.gate.y + 30 };
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
// Nine variants, not four. The floor drew from base1..base4 only while the road
// families already mixed five more from the same pack, so the square was both
// flatter than the roads leading into it and repeated twice as often. The mix_
// tiles are the same masonry at the same scale — they were loaded and used by
// roads.js all along, just never offered to the plaza.
const PLAZA_BASE_POOL = ['base1', 'base2', 'base3', 'base4',
                         'mix_base01', 'mix_base02', 'mix_base03', 'mix_base04', 'mix_base05'];
function plazaBase(cc, rr) {
  const h = hash(cc * 7.1 + rr * 3.7);
  return PLAZA_TILES[PLAZA_BASE_POOL[Math.floor(h * PLAZA_BASE_POOL.length) % PLAZA_BASE_POOL.length]];
}
// Lay one paving tile in running bond. Every variant in the pack puts its
// horizontal courses on the same rows — 4, 9, 14 and 19 in over 70% of them —
// so a plain lattice lines the joints up with their neighbours in both axes at
// once and the floor reads as a grid of squares rather than as masonry.
// Stepping alternate tile courses sideways breaks the VERTICAL joints the way
// paving is actually laid, and leaves the horizontal courses running on.
//
// The tile wraps horizontally (its last column is byte-identical to its first),
// so the step is done by drawing the two pieces of a horizontally-rotated tile
// rather than by moving the tile off its cell — the cell has to stay put, since
// the plaza's zone and edge tests are keyed to it.
// Whole tiles are blitted here, so unlike the road there is no ROAD_CELL
// constraint on the step and the phase can be any integer. Drawn from a hash of
// the tile row: a fixed 0/12 alternation is still a pattern, it just moves the
// repeat from a 28-unit cycle to a 56-unit one.
function layTile(g, tile, px, py, rr) {
  const off = 1 + Math.floor(hash(rr * 23.7 + 311) * (ROAD_TILE - 2));
  g.drawImage(tile.img, off, 0, ROAD_TILE - off, ROAD_TILE, px, py, ROAD_TILE - off, ROAD_TILE);
  g.drawImage(tile.img, 0, 0, off, ROAD_TILE, px + (ROAD_TILE - off), py, off, ROAD_TILE);
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
        if (tile && tile.ready) layTile(g, tile, px, py, rr);
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

      if (tile && tile.ready) layTile(g, tile, px, py, rr);
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

// drawGround and drawCorruption are the scene's two ground passes; plaza,
// marketSquareGround and courtyardGround are surfaces it stamps on top.
// buildFlare is exported because the SCENE needs the flare rects too — they
// feed the road plan and the plaza keep-clear tests, not just the paint.
export { buildFlare, plaza, marketSquareGround, courtyardGround, deadTree, corruptedRock };
