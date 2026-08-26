// The Archive riverfront: the one stretch where the town actually USES the
// river. A plank landing below the Runewood Archive's east lawn, a rowboat
// tied off its end, cargo waiting on the bank, a lantern for the dusk — the
// composition that says people carry books and barrels up this water.
//
// The dock is walkable: river.js's collision pass is asked (via
// scene.waterways.passages) to leave the deck water open, and thin edge
// solids keep the player from strolling off the planks. The boat is an
// entity that bobs on the same deterministic clock as everything else.

import { hash, fillEllipse } from './primitives.js';
import { DECOR_SIZE } from './props.js';

// Dock geometry: root on the bank at the west end, planks running EAST out
// over the water. The waterline at this row is x≈3370.
const DOCK = { x: 3350, y: 2206, len: 46, w: 20 };
const BOAT = { x: 3404, y: 2240 };

export function buildRiverfront(scene) {
  const ww = scene.waterways;
  if (!ww) return;

  // The walkable-water passage under the deck lives in river.js's passage
  // list (it must exist before collision rasterises); here: the rails that
  // keep the player from strolling off the planks.
  scene.solids.push(
    { x: DOCK.x + 8, y: DOCK.y - 3, w: DOCK.len - 4, h: 3 },              // north edge
    { x: DOCK.x + 8, y: DOCK.y + DOCK.w, w: DOCK.len - 4, h: 3 },         // south edge
    { x: DOCK.x + DOCK.len, y: DOCK.y - 3, w: 4, h: DOCK.w + 6 },         // east end
  );

  // the boat is scenery, not a ferry — solid so the player can't share it
  scene.solids.push({ x: BOAT.x - 11, y: BOAT.y - 7, w: 22, h: 12 });

  // ---- entities ----------------------------------------------------------
  scene.locations.push({
    id: 'riverfrontBoat', name: null, dx: null, dy: null, action: null,
    district: null, sortY: BOAT.y + 5,
    draw: (g) => drawBoat(g, scene.t),
    solid: null,
  });

  // ---- the working bank: cargo, seat, light, sign ------------------------
  // All existing props. The lantern is the road fitting, so it takes its
  // place in the night pass automatically.
  const P = [
    ['crate_stack', 3322, 2196, 1.0, false, 8],
    ['barrel_01', 3336, 2190, 1.0, true, 5],
    ['sack_pile', 3326, 2210, 0.95, false, 7],
    ['crate_01', 3341, 2201, 0.9, false, 5],
    ['lamppost_wood', 3346, 2200, 1.0, false, 4],
    ['bench_01', 3320, 2246, 1.0, true, 9],
    ['direction_sign', 3338, 2258, 1.0, false, 5],
    ['barrel_02', 3312, 2192, 0.9, false, 5],
    ['flowers_blue', 3306, 2252, 0.9, false, 0],
    ['grass_tuft_01', 3352, 2252, 0.85, true, 0],
    ['reeds_01', 3364, 2196, 0.9, false, 0],
  ];
  for (const [name, x, y, k, flip, sh] of P) {
    const [w, h] = DECOR_SIZE[name];
    scene.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
                       flip, sortY: y, shadow: sh });
  }
}

// ---- painting -------------------------------------------------------------
export function drawRiverfrontGround(scene, g, visW, visH) {
  const { x, y, len, w } = DOCK;
  if (x + len + 8 < scene.camX || x - 8 > scene.camX + visW ||
      y + w + 8 < scene.camY || y - 8 > scene.camY + visH) return;

  // shadow on the water along the south and east sides
  g.fillStyle = 'rgba(14,26,38,0.35)';
  g.fillRect(x + 6, y + w, len - 2, 4);
  g.fillRect(x + len, y + 2, 4, w + 2);

  // plank deck: boards run along the dock, seams every 4, wear speckle
  for (let py = 0; py < w; py += 4) {
    const tone = py % 8 === 0 ? '#8a6a44' : '#7a5c3a';
    g.fillStyle = tone;
    g.fillRect(x, y + py, len, 4);
    g.fillStyle = 'rgba(46,30,18,0.7)';
    g.fillRect(x, y + py + 3, len, 1);
  }
  // board joints staggered across the length
  g.fillStyle = 'rgba(46,30,18,0.55)';
  for (let px = 8; px < len; px += 11) {
    const off = (Math.floor(px / 11) % 2) * 4;
    g.fillRect(x + px, y + off, 1, w - off);
  }
  // wear: lighter chips
  for (let i = 0; i < 14; i++) {
    const px = x + 2 + hash(i * 3.7) * (len - 4);
    const py = y + 1 + hash(i * 5.3) * (w - 2);
    g.fillStyle = 'rgba(178,148,106,0.5)';
    g.fillRect(Math.round(px), Math.round(py), 1 + (hash(i * 7.1) > 0.6 ? 1 : 0), 1);
  }
  // edge caps: lit north rim, dark south rim
  g.fillStyle = '#9a7a4e';
  g.fillRect(x, y, len, 1);
  g.fillStyle = '#3a2818';
  g.fillRect(x, y + w - 1, len, 1);
  g.fillRect(x + len - 1, y, 1, w);

  // posts: two pairs plus the end pair, with waterline rings
  for (const px of [x + 10, x + 28, x + len - 2]) {
    for (const py of [y - 1, y + w - 2]) {
      g.fillStyle = '#5a3a24';
      g.fillRect(px, py, 3, 5);
      g.fillStyle = '#7a5530';
      g.fillRect(px, py, 3, 1);
      g.fillStyle = 'rgba(220,240,248,0.4)';
      g.fillRect(px - 1, py + 5, 5, 1);
    }
  }
}

// The rowboat: a plank hull riding low, tied to the dock's end post. It
// bobs a pixel on a slow swell and noses a touch against the rope.
function drawBoat(g, t) {
  const bob = Math.round(Math.sin(t * 0.9) * 1);
  const sway = Math.sin(t * 0.55 + 1.3) * 0.7;
  const bx = Math.round(BOAT.x + sway), by = BOAT.y + bob;
  // rope to the dock end post
  g.strokeStyle = 'rgba(60,44,26,0.9)';
  g.lineWidth = 1;
  g.beginPath();
  const px0 = DOCK.x + DOCK.len + 1, py0 = DOCK.y + DOCK.w - 1;
  g.moveTo(px0, py0);
  // a mooring rope sags — control point below the chord, never above it
  g.quadraticCurveTo((px0 + bx - 9) / 2, Math.max(py0, by - 4) + 5, bx - 9, by - 4);
  g.stroke();
  // wake shadow under the hull
  fillEllipse(g, bx, by + 4, 12, 4, 'rgba(14,26,38,0.4)');
  // hull: dark outline, plank fill, lit gunwale
  fillEllipse(g, bx, by, 11, 5.5, '#2e1f12');
  fillEllipse(g, bx, by - 1, 10, 4.5, '#6b4a2e');
  fillEllipse(g, bx, by - 1, 8, 3.2, '#8a6a44');
  // interior: two thwarts
  g.fillStyle = '#5a3a24';
  g.fillRect(bx - 5, by - 3, 2, 5);
  g.fillRect(bx + 2, by - 3, 2, 5);
  // bow highlight (nose east)
  g.fillStyle = '#a08454';
  g.fillRect(bx + 8, by - 2, 2, 2);
  // the water remembers the boat: a lap ring now and then
  const ph = (t % 3.1) / 3.1;
  if (ph < 0.5) {
    const r = 12 + ph * 10;
    const a = 0.3 * (1 - ph * 2);
    g.strokeStyle = `rgba(214,240,248,${a.toFixed(2)})`;
    g.beginPath();
    g.ellipse(bx, by + 2, r, r * 0.45, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

export { DOCK, BOAT };
