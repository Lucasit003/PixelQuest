// Riverbank dressing: the planting, stones and deadwood that make the
// waterways read as places the land grew around, not lines drawn on it.
//
// Everything is driven by arc position along the spine, because that is what
// a riverbank actually varies by: the gorge under the falls is stone and
// fern, the middle river runs through a wooded band, the town reach is
// meadow, the Archive reach grows reeds, and the south end drowns in
// cattails. Density BREATHES on a low-frequency noise — long planted runs
// against genuinely bare stretches — because even decoration density is the
// fastest way to make a bank read as wallpaper (the lake learned the same
// lesson with its mushrooms).
//
// Same registry and guards as every other dressing pass: DECOR_SIZE names
// into scene.decor (depth-sorted) or scene.groundDecor (flat), roadCov for
// the painted streets, district footprints, and the waterways' own field so
// nothing stands in the water it is supposed to be growing beside.

import { hash } from './primitives.js';
import { DECOR_SIZE } from './props.js';
import { ROAD_CELL } from './roads.js';
import { sampleAt } from './river.js';

// ---- zone character along the MAIN river, by arc position -----------------
// [sEnd, plants pool, trees pool, plant step, tree chance, rocks-in-water]
// Pools are weighted by repetition — a name listed twice is picked twice as
// often. Arc marks measured off the spine (bridge ~1936, confluence ~2321,
// Archive reach ~3400-4100, island ~4685, wetland from ~4900).
const RIVER_ZONES = [
  { sEnd: 260, name: 'falls' },       // the falls own this ground — stay out
  { sEnd: 950, name: 'gorge',
    plants: ['fernbank_01', 'fernbank_02', 'fernbank_03', 'fern_clump', 'grass_tuft_01',
             'rockgrass_md_01', 'rockgrass_md_02', 'grass_tall_02', 'weeds_01'],
    trees: ['pine_tree_01', 'pine_tree_02', 'pine_tree_03', 'pine_tree_04', 'tree_small_pine'],
    step: 17, treeAt: 0.78, rockAt: 0.6 },
  { sEnd: 1780, name: 'wildwood',
    plants: ['grass_tuft_01', 'grass_tuft_02', 'grass_tuft_03', 'fern_clump', 'fernbank_02',
             'nv_tallgrass_01', 'nv_tallgrass_05', 'bush_03', 'weeds_02', 'grass_tall_01'],
    trees: ['pine_tree_02', 'pine_tree_04', 'deciduous_tree_02', 'deciduous_tree_05', 'tree_small_pine'],
    step: 15, treeAt: 0.6, rockAt: 0.3 },
  { sEnd: 2480, name: 'bridge meadow',
    plants: ['grass_tuft_01', 'grass_tuft_04', 'flowers_white', 'flowers_blue', 'grass_bloom_01',
             'grass_md_02', 'wetgrass_01', 'grass_sm_02'],
    trees: ['deciduous_tree_01', 'deciduous_tree_04'],
    step: 18, treeAt: 0.16, rockAt: 0.12 },
  { sEnd: 3420, name: 'open reach',
    plants: ['grass_tuft_02', 'grass_md_01', 'grass_md_04', 'reeds_01', 'wetgrass_02',
             'grass_lean_02', 'weeds_01', 'grass_tall_03'],
    trees: ['deciduous_tree_03', 'deciduous_tree_06', 'pine_tree_01'],
    step: 16, treeAt: 0.3, rockAt: 0.25 },
  { sEnd: 4150, name: 'archive reach',
    plants: ['reeds_02', 'reeds_03', 'cattail_01', 'cattail_md_01', 'wetgrass_03',
             'grass_teal_02', 'flowers_blue', 'grass_bloom_03', 'waterleaf_01'],
    trees: ['deciduous_tree_02', 'tree_blossom_white'],
    step: 15, treeAt: 0.2, rockAt: 0.12 },
  { sEnd: 4950, name: 'island bend',
    plants: ['cattail_02', 'cattail_flower_01', 'reeds_04', 'waterleaf_02', 'flowers_white',
             'grass_teal_04', 'wetgrass_02', 'grass_bloom_02'],
    trees: ['deciduous_tree_05', 'tree_blossom_blue'],
    step: 14, treeAt: 0.18, rockAt: 0.1 },
  { sEnd: 99999, name: 'wetland',
    plants: ['reedbed_02', 'reedbed_04', 'reedbed_08', 'cattail_01', 'cattail_02', 'cattail_03',
             'cattail_flower_02', 'cattail_md_02', 'wetgrass_02', 'wetgrass_03', 'waterleaf_01',
             'waterleaf_02', 'grass_teal_01', 'grass_teal_03'],
    trees: [],
    step: 11, treeAt: 0, rockAt: 0.06 },
];

const STREAM_ZONE = {
  plants: ['fern_clump', 'grass_tuft_02', 'grass_tuft_03', 'nv_tallgrass_02', 'wetgrass_01',
           'grass_sm_05', 'weeds_02', 'reeds_01'],
  trees: [], step: 19, treeAt: 0, rockAt: 0.14,
};

function zoneAt(wayId, s) {
  if (wayId === 'stream') return STREAM_ZONE;
  for (const z of RIVER_ZONES) if (s < z.sEnd) return z;
  return RIVER_ZONES[RIVER_ZONES.length - 1];
}

export function buildRiverDecor(scene) {
  const ww = scene.waterways;
  if (!ww) return;

  const onRoadPaint = (x, y, halfW, up) => {
    const C = ROAD_CELL;
    for (let dx = -halfW; dx <= halfW; dx += C) {
      for (let dy = -up; dy <= C; dy += C) {
        if (scene.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
      }
    }
    return false;
  };
  // Crossings keep an open apron: planting against the bridge abutments or
  // the ford stones would fight the built things placed there later.
  const nearPassage = (x, y, pad) => ww.passages.some((p) =>
    x > p.x - pad && x < p.x + p.w + pad && y > p.y - pad && y < p.y + p.h + pad);

  const put = (name, x, y, k, flip, flat) => {
    const [w, h] = DECOR_SIZE[name];
    const pw = Math.round(w * k), ph = Math.round(h * k);
    const list = flat ? scene.groundDecor : scene.decor;
    list.push({ name, x: Math.round(x), y: Math.round(y), w: pw, h: ph, flip,
                sortY: Math.round(y), shadow: flat ? 0 : Math.round(pw * 0.18) });
    return true;
  };
  const pick = (pool, h) => pool[Math.floor(h * pool.length) % pool.length];

  ww.rocks = [];
  const treesPlaced = [];

  for (const way of ww.ways) {
    // Walk each bank independently — side is +1 (right of the flow) or -1 —
    // so the two banks never mirror each other's planting.
    for (const side of [1, -1]) {
      let sideSeed = way.id === 'stream' ? 400 : side > 0 ? 100 : 200;
      let lastPlant = -1e3, lastTree = -1e3;
      for (let s = 0; s < way.total; s += 7) {
        const z = zoneAt(way.id, s);
        if (!z.plants) continue;                    // the falls' keep-clear
        // density breathing: a slow wave per side decides planted vs bare
        const wave = Math.sin(s * 0.006 + sideSeed * 1.7) + Math.sin(s * 0.0023 + sideSeed);
        const density = wave * 0.5 + 0.5;           // roughly 0..1, long runs
        const stepHere = z.step / Math.max(0.22, density);
        // ---- bank plants -------------------------------------------------
        if (s - lastPlant >= stepHere) {
          const h1 = hash(sideSeed + s * 0.731);
          if (h1 < 0.82) {
            const p = sampleAt(way, s + (h1 - 0.5) * 6);
            const dOff = 3 + hash(sideSeed + s * 1.31) * 13;   // land-side of the waterline
            const x = p.x - p.ty * side * (p.hw + dOff);
            const y = p.y + p.tx * side * (p.hw + dOff);
            const q = ww.query(x, y);
            if (q && q.d > 2 && q.d < 22 && !nearPassage(x, y, 34)
                && !onRoadPaint(x, y, 14, 8) && !scene._nearAnyDistrict(x, y, 46)) {
              const name = pick(z.plants, hash(sideSeed + s * 2.17));
              const k = 0.75 + hash(sideSeed + s * 3.71) * 0.45;
              put(name, x, y, k, hash(sideSeed + s * 5.3) > 0.5, false);
              lastPlant = s;
              // occasionally a companion right beside it — clumps read as
              // growth, evenly spaced singles read as planting
              if (hash(sideSeed + s * 7.7) > 0.6) {
                const name2 = pick(z.plants, hash(sideSeed + s * 9.1));
                const jx = x + (hash(sideSeed + s * 11.3) - 0.5) * 16;
                const jy = y + (hash(sideSeed + s * 13.7) - 0.5) * 9;
                const q2 = ww.query(jx, jy);
                if (q2 && q2.d > 2 && !onRoadPaint(jx, jy, 12, 6) && !nearPassage(jx, jy, 34)) {
                  put(name2, jx, jy, 0.7 + hash(s * 17.1) * 0.35, hash(s * 19.3) > 0.5, false);
                }
              }
            }
          }
        }
        // ---- waterline pebbles (flat) ------------------------------------
        if (hash(sideSeed + s * 0.317) > 0.965) {
          const p = sampleAt(way, s);
          const x = p.x - p.ty * side * (p.hw + 1 + hash(s * 1.7) * 4);
          const y = p.y + p.tx * side * (p.hw + 1 + hash(s * 1.9) * 4);
          const q = ww.query(x, y);
          if (q && q.d > -1 && q.d < 8 && !nearPassage(x, y, 26) && !onRoadPaint(x, y, 10, 6)) {
            put(pick(['pebbles_01', 'pebbles_02', 'pebbles_03'], hash(s * 2.9)), x, y,
                0.8 + hash(s * 3.3) * 0.4, hash(s * 4.1) > 0.5, true);
          }
        }
        // ---- riverside tree STANDS --------------------------------------
        // Clumps of 2-5 trees around an anchor, at long irregular intervals,
        // with long treeless stretches between them. The first pass placed
        // single trees on an even step and the bank grew a planted avenue —
        // a clump with overlapping crowns against genuinely open bank is
        // what reads as woods that happen to reach the river.
        if (z.trees && z.trees.length && s - lastTree >= 90) {
          const h2 = hash(sideSeed + s * 0.911 + 40);
          const gate = density > 0.4 ? z.treeAt : 0;   // bare runs stay bare
          if (h2 < gate) {
            const p = sampleAt(way, s);
            const back = 24 + hash(sideSeed + s * 1.73 + 41) * 88;
            const ax = p.x - p.ty * side * (p.hw + back);
            const ay = p.y + p.tx * side * (p.hw + back);
            const n = 2 + Math.floor(hash(sideSeed + s * 2.91 + 45) * 4);   // 2-5 per stand
            let placedAny = false;
            for (let ti = 0; ti < n; ti++) {
              const ta = hash(sideSeed + s * 3.7 + ti * 5.3 + 46) * Math.PI * 2;
              const tr = ti === 0 ? 0 : 16 + hash(sideSeed + s * 4.3 + ti * 7.1 + 47) * 34;
              const x = ax + Math.cos(ta) * tr, y = ay + Math.sin(ta) * tr * 0.7;
              const q = ww.query(x, y);
              const clearTrees = !treesPlaced.some((tp) => Math.hypot(tp.x - x, tp.y - y) < 24);
              if (!q || q.d < 24 || !clearTrees || nearPassage(x, y, 60)
                  || onRoadPaint(x, y, 40, 14) || scene._nearAnyDistrict(x, y, 70)
                  || x < 40 || x > 3560 || y < 60 || y > 4340) continue;
              const name = pick(z.trees, hash(sideSeed + s * 2.53 + ti * 3.1 + 42));
              const k = 0.78 + hash(sideSeed + s * 3.19 + ti * 2.3 + 43) * 0.5;
              put(name, x, y, k, hash(s * 5.71 + ti) > 0.5, false);
              treesPlaced.push({ x, y });
              placedAny = true;
              if (hash(s * 7.13 + ti + 44) > 0.6) {
                put(pick(['nv_tallgrass_04', 'grass_tuft_01', 'nv_weeds_01'], hash(s * 8.3 + ti)),
                    x + (hash(s * 9.7 + ti) - 0.5) * 22, y + 3 + hash(s * 10.1 + ti) * 5,
                    0.7 + hash(s * 11.9 + ti) * 0.3, false, false);
              }
            }
            if (placedAny) lastTree = s + hash(sideSeed + s * 6.1 + 48) * 150;  // irregular gap
          }
        }
        // ---- stones IN the water ----------------------------------------
        // The current interaction anchors: gfx/riverfx.js draws the split
        // current, cushion foam and wake around every one of these.
        if (hash(sideSeed + s * 0.417 + 60) > 1 - (z.rockAt || 0) * 0.13) {
          const p = sampleAt(way, s);
          const o = (hash(sideSeed + s * 1.03 + 61) - 0.5) * 2 * p.hw * 0.55;
          const x = p.x - p.ty * o, y = p.y + p.tx * o;
          const q = ww.query(x, y);
          const r = 2.2 + hash(sideSeed + s * 2.11 + 62) * 3.2;
          const clearRocks = !ww.rocks.some((rk) => Math.hypot(rk.x - x, rk.y - y) < 26);
          if (q && q.d < -(r + 3) && q.dep < 0.8 && clearRocks && !nearPassage(x, y, 46)) {
            ww.rocks.push({ x, y, r, s: q.s, way, seed: hash(s * 3.7 + 63) });
          }
        }
      }
    }
  }

  // ---- the shrine island --------------------------------------------------
  // The one piece of land in the channel (river.js ISLANDS): an old rooted
  // tree leaning over a kneeling statue, flowers nobody planted, reeds at
  // the beach. Unreachable on foot — meant to be seen from the bank and
  // wondered about. Authored, not scattered.
  const ISL = { x: 3216, y: 3160 };
  const island = [
    ['tree_rooted', ISL.x + 6, ISL.y - 4, 1.02, false, 12],
    ['myst_statue_kneel', ISL.x - 17, ISL.y + 11, 1.0, true, 3],
    ['flowers_white', ISL.x - 6, ISL.y + 16, 0.85, false, 0],
    ['flowers_blue', ISL.x + 18, ISL.y + 12, 0.8, true, 0],
    ['flowers_white', ISL.x + 27, ISL.y + 2, 0.7, false, 0],
    ['grass_tuft_02', ISL.x + 24, ISL.y - 8, 0.8, false, 0],
    ['grass_tuft_04', ISL.x - 26, ISL.y - 2, 0.75, true, 0],
    ['rock_small_02', ISL.x - 27, ISL.y + 6, 0.85, false, 4],
    ['fallen_branch', ISL.x + 14, ISL.y + 20, 0.8, true, 0],
    ['reeds_02', ISL.x - 4, ISL.y + 24, 0.9, false, 0],
    ['wetgrass_01', ISL.x + 24, ISL.y + 20, 0.8, true, 0],
    ['cattail_md_01', ISL.x - 22, ISL.y + 20, 0.85, false, 0],
  ];
  for (const [name, x, y, k, flip, sh] of island) {
    const [w, h] = DECOR_SIZE[name];
    scene.decor.push({ name, x: Math.round(x), y: Math.round(y),
                       w: Math.round(w * k), h: Math.round(h * k), flip,
                       sortY: Math.round(y), shadow: sh });
  }

  // ---- butterflies where the flowers are ----------------------------------
  // Same fields drawButterfly reads for the plaza's. Never over deep water:
  // the island's pair wander over the islet itself, the rest over the banks.
  const BF = [
    [ISL.x + 4, ISL.y + 8, 16, 8, 'white'],
    [3322, 2252, 22, 10, 'blue'],       // the riverfront bench flowers
    [2100, 1560, 26, 12, 'gold'],       // bridge meadow, south bank
    [3120, 3560, 24, 10, 'violet'],     // wetland edge
    [1210, 1305, 22, 10, 'white'],      // boulder-hop meadow
  ];
  BF.forEach(([x, y, rx, ry, col], i) => {
    scene.butterflies.push({ x, y, rx, ry, col, speed: 0.8 + hash(i * 7.7) * 0.5,
                             phase: hash(i * 3.1) * 20 });
  });

  // ---- the delta mouth ----------------------------------------------------
  // Where the stream fans into the lake: reeds crowding both jaws of the
  // inlet, a tuft on the spit the current built, stones the water rounds.
  // Authored — this is a composition, not a scatter.
  const mouth = [
    ['cattail_03', 1694, 2314, 0.9, true, 0],
    ['reeds_03', 1678, 2306, 0.8, false, 0],
    ['reeds_04', 1702, 2374, 0.9, false, 0],
    ['wetgrass_03', 1716, 2354, 0.85, true, 0],
    ['cattail_md_01', 1712, 2386, 0.85, false, 0],
    ['reeds_01', 1675, 2343, 0.62, false, 0],     // on the spit itself
    ['rock_small_01', 1658, 2306, 0.75, false, 3],
    ['wetgrass_01', 1730, 2330, 0.8, false, 0],
  ];
  for (const [name, x, y, k, flip, sh] of mouth) {
    const [w, h] = DECOR_SIZE[name];
    scene.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
                       flip, sortY: y, shadow: sh });
  }
  scene.groundDecor.push({ name: 'pebbles_02', x: 1696, y: 2362, w: 13, h: 9, flip: false });
}
