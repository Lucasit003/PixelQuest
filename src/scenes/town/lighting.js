// Town night lighting.
//
// The dusk pass is a post-effect, not a set of light-aware draw calls: the
// finished day frame is multiplied down to night, then every light *erases* a
// hole back out of that darkness before its warm cast is added on top. That is
// why no artwork needs a night variant, and why a very dark sprite disappears
// after dusk.
//
// Entry point is drawNight(scene, g, Z) — everything else here is internal.
// The scene is passed explicitly rather than bound as `this`, so the module has
// no hidden contract with TownScene beyond the handful of fields read below:
//   camX camY W H t decor lamps braziers crystalGlows plazaCenter _baseTf
//   _nightCanvas (owned here, cached on the scene so it survives frames)

import { hash } from './primitives.js';

// Dusk over the town, laid over the finished frame. This is a LIGHTING pass
// and nothing else: not one prop is moved, no sprite is swapped and no road
// is recut — what you are looking at is the daytime composition after sunset.
//
// The darkness is built on its own screen-sized buffer and composited with
// `multiply`, and every light ERASES a soft hole in that buffer instead of
// painting brightness onto the scene. That distinction is the whole trick: an
// additive wash bleaches grass toward white and the pool reads as fog on the
// lawn, whereas a hole lets the ground come back at its own colour, which is
// what a lamp actually does to it. The warm cast is then a separate and much
// smaller additive bloom on top of that.

// ---- night lighting -------------------------------------------------------
// One table drives the dusk pass. `tint` is a MULTIPLIER, not a paint: the
// frame's own colours are scaled by it, so grass stays green and stone stays
// stone — they only lose light and gain the sky's blue. Everything else here is
// how the town's own lights push back against it.
const NIGHT = {
  tint: [90, 124, 186],           // × the day frame: 0.35 red, 0.49 green, 0.73 blue
  vignette: 0.40,                 // extra darkness at the edges of vision
  // Additive, so the shadows read as moonlight rather than as black. Kept LOW
  // on purpose: a flat lift is what greys a lawn out, and the green belongs in
  // the multiplier above, where grass reads as green seen at night instead of
  // as grey with a memory of green.
  moonLift: 'rgba(18,32,88,0.18)',
  // r = reach (world units), cut = how much darkness it erases, a = warm cast,
  // bloom = size of that cast against the reach, core = the lit glass itself.
  lamp:        { r: 48, cut: 0.60, a: 0.82, bloom: 0.84, core: 1.7, col: [255, 166, 74], hot: [255, 240, 198] },
  // The road lanterns out on the approaches: same fitting, ~20% less reach and
  // a softer cast, so they guide the player without becoming landmarks. The
  // crystal has to stay the only thing in the frame worth walking toward.
  lampOuter:   { r: 38, cut: 0.50, a: 0.62, bloom: 0.84, core: 1.4, col: [255, 166, 74], hot: [255, 240, 198] },
  crystal:     { r: 130, cut: 0.62, a: 0.62, bloom: 0.92, core: 0, col: [118, 214, 255], hot: [214, 246, 255] },
  crystalSmall: { r: 34, cut: 0.55, a: 0.34, bloom: 0.9, core: 0, col: [126, 216, 255] },
  violet:      { r: 34, cut: 0.55, a: 0.34, bloom: 0.9, core: 0, col: [176, 140, 255] },
  fire:        { r: 46, cut: 0.78, a: 0.46, bloom: 0.86, core: 2.2, col: [255, 154, 60], hot: [255, 226, 160] },
  // fireflies / crystal dust
  moteGrid: 30, moteChance: 0.34, moteRate: 1.5, moteA: 0.85,
  moteWarm: [255, 244, 198], moteCool: [168, 214, 255],
};
// Lantern glass positions, in world units from the prop's bottom-centre anchor.
// Measured off the baked sprite's own warm-bright pixel clusters rather than
// assumed from the box, so a light sits on the flame the artist drew.
const LAMP_HEADS = {
  lamppost_twin: [[-9.5, -21.4], [9.5, -21.4]],
  // Measured off the baked 17x36 sprite. The twin's two heads are symmetric so
  // mirroring it changes nothing; this one hangs its glass on an arm at +5.1,
  // so a flipped post must have its light mirrored with it or the glow floats
  // off the lantern.
  lamppost_single: [[5.1, -19.8]],
  // measured off the baked 18x36 sprite; arm to the right, so a flipped post
  // carries its light to the left with it
  lamppost_wood: [[4.5, -21.5]],
};
function nightOn() { return typeof window === 'undefined' || window.__townNight !== false; }
// Dev hook: `window.__NIGHT` is the live table, so the dusk can be retuned from
// the console against a still frame instead of one page reload per trial.
if (typeof window !== 'undefined') window.__NIGHT = NIGHT;
function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : a).toFixed(3) + ')'; }
export { NIGHT, LAMP_HEADS, nightOn };

export function drawNight(scene, g, Z) {
  if (!nightOn()) return;
  const W = scene.W, H = scene.H;
  if (!(W > 0 && H > 0)) return;
  const lights = nightLights(scene, Z);

  // 1. the darkness
  const buf = nightBuffer(scene, W, H);
  const bg = buf.getContext('2d');
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.globalCompositeOperation = 'source-over';
  bg.fillStyle = rgb(NIGHT.tint);
  bg.fillRect(0, 0, W, H);
  // A vignette, because a perfectly even tint reads as a filter laid over the
  // picture rather than as dusk inside it.
  const vg = bg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.26, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,' + NIGHT.vignette + ')');
  bg.fillStyle = vg;
  bg.fillRect(0, 0, W, H);

  // 2. each light cuts its own hole in it
  bg.globalCompositeOperation = 'destination-out';
  for (const L of lights) {
    const gr = bg.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    gr.addColorStop(0, 'rgba(0,0,0,' + L.cut.toFixed(3) + ')');
    gr.addColorStop(0.40, 'rgba(0,0,0,' + (L.cut * 0.54).toFixed(3) + ')');
    gr.addColorStop(0.74, 'rgba(0,0,0,' + (L.cut * 0.17).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = gr;
    bg.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }
  bg.globalCompositeOperation = 'source-over';

  // 3. composite it in the frame's own space, then the light on top
  g.save();
  if (scene._baseTf) g.setTransform(scene._baseTf);
  else g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.globalCompositeOperation = 'multiply';
  g.drawImage(buf, 0, 0);
  // Shadows should read as moonlight rather than as black.
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = NIGHT.moonLift;
  g.fillRect(0, 0, W, H);
  for (const L of lights) {
    const r = L.r * L.bloom;
    const gr = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, r);
    gr.addColorStop(0, rgba(L.col, L.a));
    gr.addColorStop(0.30, rgba(L.col, L.a * 0.36));
    gr.addColorStop(1, rgba(L.col, 0));
    g.fillStyle = gr;
    g.fillRect(L.x - r, L.y - r, r * 2, r * 2);
    if (L.core > 0.3) {  // the lit glass itself
      g.fillStyle = rgba(L.hot, Math.min(1, L.a * 2.0));
      g.beginPath(); g.arc(L.x, L.y, L.core, 0, Math.PI * 2); g.fill();
    }
  }
  drawNightMotes(scene, g, Z);
  g.restore();
}

function nightBuffer(scene, W, H) {
  let c = scene._nightCanvas;
  if (!c) c = scene._nightCanvas = document.createElement('canvas');
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  return c;
}

// Every light in view, already converted to screen pixels and culled.
function nightLights(scene, Z) {
  const camX = Math.round(scene.camX), camY = Math.round(scene.camY);
  const W = scene.W, H = scene.H, t = scene.t;
  const out = [];
  const add = (wx, wy, s, f) => {
    const x = (wx - camX) * Z, y = (wy - camY) * Z, r = s.r * Z;
    if (x + r < -4 || x - r > W + 4 || y + r < -4 || y - r > H + 4) return;
    out.push({ x, y, r, cut: s.cut * f, a: s.a * f, col: s.col, hot: s.hot || s.col,
               bloom: s.bloom, core: (s.core || 0) * Z });
  };
  // Lanterns. The glass offsets are MEASURED off the baked sprite's own warm
  // pixels, not guessed from its box, so the light leaves the lamp exactly
  // where the artwork puts the flame.
  for (const d of scene.decor) {
    const heads = LAMP_HEADS[d.name];
    if (!heads) continue;
    // Which lantern this is comes from the fitting, not from a distance
    // guess: the twin pair is the plaza's own architecture, the single is the
    // road fitting, and each carries its own strength.
    const spec = /^lamppost_(single|wood)$/.test(d.name) ? NIGHT.lampOuter : NIGHT.lamp;
    const mir = d.flip ? -1 : 1;
    for (const [ox, oy] of heads) {
      add(d.x + ox * mir, d.y + oy, spec, 0.87 + Math.sin(t * 3.1 + d.x * 0.7 + ox) * 0.13);
    }
  }
  // The crystal fountain is the square's own light source, and the brightest
  // thing in the frame — the water ellipse sits 46 above the anchor.
  const PZ = scene.plazaCenter;
  if (PZ) add(PZ.x, PZ.y - 52, NIGHT.crystal, 0.90 + Math.sin(t * 1.25) * 0.10);
  for (const [x, y] of scene.lamps) add(x, y - 19, NIGHT.lamp, 0.87 + Math.sin(t * 4 + x) * 0.13);
  for (const [x, y] of scene.braziers) add(x, y - 10, NIGHT.fire, 0.78 + Math.sin(t * 8 + x) * 0.22);
  for (const [x, y, hue] of scene.crystalGlows) {
    add(x, y - 6, hue === 'v' ? NIGHT.violet : NIGHT.crystalSmall, 0.85 + Math.sin(t * 1.7 + x) * 0.15);
  }
  return out;
}

// Fireflies and crystal dust. Placed on a fixed WORLD grid with a hashed
// jitter so they hold still in the world while the camera moves — motes
// scattered in screen space swim across the ground as the player walks. Each
// one is dark most of the time and briefly bright: a steady dot at this size
// reads as a stuck pixel, a blinking one reads as alive.
function drawNightMotes(scene, g, Z) {
  if (NIGHT.moteA <= 0) return;
  const camX = Math.round(scene.camX), camY = Math.round(scene.camY);
  const W = scene.W, H = scene.H, t = scene.t, S = NIGHT.moteGrid;
  const c0 = Math.floor(camX / S), c1 = Math.ceil((camX + W / Z) / S);
  const r0 = Math.floor(camY / S), r1 = Math.ceil((camY + H / Z) / S);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const k = cx * 131.7 + cy * 379.1;
      const h1 = hash(k), h2 = hash(k + 1.3), h3 = hash(k + 2.7), h4 = hash(k + 4.1);
      if (h4 > NIGHT.moteChance) continue;
      const s = Math.sin(t * (0.5 + h3) * NIGHT.moteRate + h2 * 6.283);
      if (s <= 0) continue;
      const x = ((cx + h1) * S - camX) * Z, y = ((cy + h2) * S - camY) * Z;
      if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
      g.fillStyle = rgba(h3 < 0.26 ? NIGHT.moteCool : NIGHT.moteWarm, s * s * NIGHT.moteA);
      g.beginPath(); g.arc(x, y, 0.7 + h1 * 0.6, 0, Math.PI * 2); g.fill();
    }
  }
}

