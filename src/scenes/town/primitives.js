// Drawing primitives and sprite blitting shared across the town modules.
//
// These live here because more than one subsystem needs them, not as a dumping
// ground: `hash` is the deterministic jitter the whole map is scattered with
// (129 call sites in the original town.js), and `fillEllipse` is the
// pixel-accurate ellipse the canvas arc() path cannot give at this resolution.

// Deterministic pseudo-random in [0,1). The map's jitter has to survive a
// reload — anything scattered with Math.random moves every time the scene is
// rebuilt, which makes a layout impossible to iterate on.
export function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }

// Math.random-backed, for per-frame effects that should NOT be stable.
export function rand2(a, b) { return a + Math.random() * (b - a); }

// Filled ellipse drawn as scanline rects. The canvas arc() path antialiases,
// which at 480x270 puts grey fringe pixels on a shape that has to read as
// solid pixel art.
export function fillEllipse(g, cx, cy, rx, ry, color) {
  cx = Math.round(cx); cy = Math.round(cy); rx = Math.max(1, rx); ry = Math.max(1, ry);
  g.fillStyle = color;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    if (w <= 0) continue;
    g.fillRect(cx - w, cy + y, w * 2, 1);
  }
}

// ---- sprite art -----------------------------------------------------------
// Every PNG in the town loads through this and is held as a { img, ready }
// pair rather than a bare Image, so a draw can skip art that has not decoded
// yet instead of blitting a blank rectangle.
// Building artwork (real transparent PNGs), same load/draw pattern as the
// Potion Shop above. Each authored to the game's native footprint.
export function loadBuildingArt(src) {
  const img = new Image();
  const state = { img, ready: false };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}

// Imaginary sunlight from the upper-left: contact shadows fall to the
// lower-right. One helper so every grounded object casts a consistent shadow.
export function contactShadow(g, cx, by, rx, ry, alpha = 0.32) {
  cx = Math.round(cx + rx * 0.28); by = Math.round(by + 1); // offset toward lower-right
  rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
  g.fillStyle = `rgba(20,26,16,${alpha})`;
  for (let y = -ry; y <= ry; y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    if (w <= 0) continue;
    g.fillRect(cx - w, by + y, w * 2, 1);
  }
}

// Generic bottom-anchored prop sprite (lamp posts etc): same load/draw
// pattern as the buildings, just smaller. `flip` mirrors the art
// horizontally so a prop on the right of a path reads as facing inward
// (toward the centerline) the same way its left-side twin naturally does.
export function drawPropArt(g, art, x, y, w, h, shadowRx, flip = false) {
  // shadowRx 0 skips the shadow entirely — used by compound-style art
  // (Watch, Sanctuary, Cottage, Gate) whose PNGs include their own ground.
  if (shadowRx > 0) contactShadow(g, x, y, shadowRx, Math.max(2, shadowRx * 0.4), 0.22);
  if (!art.ready) return;
  if (flip) {
    g.save();
    g.translate(Math.round(x), 0);
    g.scale(-1, 1);
    g.drawImage(art.img, Math.round(-w / 2), Math.round(y - h), w, h);
    g.restore();
  } else {
    g.drawImage(art.img, Math.round(x - w / 2), Math.round(y - h), w, h);
  }
}
