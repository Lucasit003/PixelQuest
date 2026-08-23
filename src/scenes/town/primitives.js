// Numeric and drawing primitives shared across the town modules.
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
