// The lake: its artwork, its size, and the water geometry everything else
// derives from.
//
// The collision rects are stored as FRACTIONS of POND_W/POND_H rather than
// world units, so resizing the lake does not silently leave its collision
// behind at the old scale. They were decomposed from the matted PNG's own
// water pixels — the closest an AABB-only engine gets to polygon collision.
// Only the water is solid, so the grass/dirt/rock shoreline stays walkable and
// the player can reach the water's edge.
//
// POND_MASK_INFO is the water mask the wildlife and ripple effects are clipped
// to; it is built lazily the first time the art is ready, and exported through
// an accessor pair because it is genuinely mutable module state.

import { hash, loadBuildingArt } from './primitives.js';
import { DECOR_SIZE } from './props.js';
import { ROAD_CELL } from './roads.js';

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
export function pondMask() { return POND_MASK_INFO; }
export function setPondMask(m) { POND_MASK_INFO = m; }

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

// ---- shoreline dressing ----------------------------------------------------
// Banded outward from the water: canopy -> bushes -> meadow flowers -> wet
// grass -> reeds -> water. Those bands are what make the lake read as ground
// the land slopes into, rather than a puddle dropped on a lawn.
//
// Keep-clear tests here sample roadCov, the PAINTED road map, not the coarse
// scene.roads rects — the rects describe bends as square steps while the paint
// sweeps them into diagonals, so a spot that looks clear against the rects can
// sit squarely on the road.

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
export function buildLakeDetail(scene) {
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
    scene.decor.push({ name: NAME, x, y, w, h, flip, sortY: y,
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
  const L = scene.lakeTopLeft;
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
        if (scene.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
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
    if (scene._nearAnyRoad(x, y, 34) || scene._nearAnyDistrict(x, y, 60)) continue;
    if (onRoadPaint(x, y, 54, 16)) continue;
    const gap = 40 + Math.max(0, d - TREE_KEEP) * 0.30;  // opens up with distance
    if (stand.some((t) => Math.hypot(t.x - x, t.y - y) < gap)) continue;
    const name = nextTree();
    const [w, h] = DECOR_SIZE[name];
    const k = 0.85 + hash(8400 + n * 2.7) * 0.4;
    const tw = Math.round(w * k), th = Math.round(h * k);
    scene.decor.push({ name, x, y, w: tw, h: th, flip: hash(8500 + n) > 0.5,
                      sortY: y, shadow: Math.round(tw * 0.26) });
    stand.push({ x, y });
    trunks.push({ x, y, w: tw });
    // a companion beside about a third of them, so they read as stands
    if (hash(8600 + n * 4.3) > 0.42) {
      const ca = hash(8700 + n * 3.3) * Math.PI * 2;
      const cr = 34 + hash(8800 + n * 5.7) * 26;
      const cx2 = Math.round(x + Math.cos(ca) * cr), cy2 = Math.round(y + Math.sin(ca) * cr * 0.7);
      if (distToWater(cx2, cy2) > TREE_KEEP && !scene._nearAnyRoad(cx2, cy2, 30)
          && !scene._nearAnyDistrict(cx2, cy2, 60) && !onRoadPaint(cx2, cy2, 46, 14)) {
        const n2 = nextTree();
        const [w2, h2] = DECOR_SIZE[n2];
        const k2 = 0.7 + hash(9000 + n * 6.1) * 0.3;
        scene.decor.push({ name: n2, x: cx2, y: cy2, w: Math.round(w2 * k2), h: Math.round(h2 * k2),
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
      scene.decor.push({ name: nm, x: bx, y: by, w: Math.round(bw * bk), h: Math.round(bh * bk),
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
    if (scene._nearAnyRoad(x, y, 22) || scene._nearAnyDistrict(x, y, 48)) continue;
    if (onRoadPaint(x, y, 38, 12)) continue;   // widest bush scales to ~75 across
    const gap = 15 + d * 0.17;                 // tight at the bank, open far out
    if (under.some((u) => Math.hypot(u.x - x, u.y - y) < gap)) continue;
    const name = nextUnder();
    const [w, h] = DECOR_SIZE[name];
    const k = 0.8 + hash(9700 + n * 2.9) * 0.45;
    scene.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
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
    if (scene._nearAnyRoad(x, y, 24) || scene._nearAnyDistrict(x, y, 48)) continue;
    if (onRoadPaint(x, y, 30, 10)) continue;   // widest rock mass scales to ~55
    const gap = 34 + d * 0.26;
    if (rocks.some((r) => Math.hypot(r.x - x, r.y - y) < gap)) continue;
    const big = BOULDER[Math.floor(hash(10400 + n * 7.3) * BOULDER.length) % BOULDER.length];
    const [bw, bh] = DECOR_SIZE[big];
    const k = 0.8 + hash(10500 + n * 2.3) * 0.5;
    scene.decor.push({ name: big, x, y, w: Math.round(bw * k), h: Math.round(bh * k),
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
      scene.decor.push({ name: sm, x: ex, y: ey, w: sw, h: sh,
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
  const ok = (x, y, gap) => !wet(x, y) && !scene._nearAnyRoad(x, y, 20) && !onRoadPaint(x, y, 16, 6)
    && !scene._nearAnyDistrict(x, y, 46)
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
      scene.groundDecor.push({ name, x: mx, y: my, w, h,
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

export function buildLakeDecor(scene) {
  const L = scene.lakeTopLeft;
  // The lake's own water, in world units — vegetation may stand on the bank
  // but nothing may stand in the water.
  const water = POND_WATER_RECTS.map(([fx, fy, fw, fh]) => ({
    x: L.x + fx * POND_W, y: L.y + fy * POND_H, w: fw * POND_W, h: fh * POND_H,
  }));
  const inWater = (x, y) => water.some((r) =>
    x > r.x - 6 && x < r.x + r.w + 6 && y > r.y - 6 && y < r.y + r.h + 6);

  const decor0 = scene.decor.length, ground0 = scene.groundDecor.length;
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
    if (scene._nearAnyRoad(x, y, opts.roadPad != null ? opts.roadPad : 26)) return false;
    if (scene._nearAnyDistrict(x, y, 46)) return false;
    if (!fits(name, x, y, opts.slack != null ? opts.slack : 0.3)) return false;
    const [w, h] = DECOR_SIZE[name];
    const list = opts.flat ? scene.groundDecor : scene.decor;
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
  const dropD = new Set(scene.decor.slice(decor0).filter(nearWater));
  const dropG = new Set(scene.groundDecor.slice(ground0).filter(nearWater));
  scene.decor = scene.decor.filter((d) => !dropD.has(d));
  scene.groundDecor = scene.groundDecor.filter((d) => !dropG.has(d));
}

export { POND_ART, POND_W, POND_H, POND_WATER_RECTS };
