// Core pixel-drawing helpers. Sprites are authored as arrays of strings where
// each character indexes into a palette ('.' = transparent). Rows may be ragged;
// the drawer just walks whatever is there.

const cache = new Map();

/** Draw a palette grid directly to a context at 1px per char. */
export function drawGrid(g, grid, x, y, pal, flip = false) {
  x = Math.round(x);
  y = Math.round(y);
  let maxW = 0;
  for (const row of grid) if (row.length > maxW) maxW = row.length;

  for (let ry = 0; ry < grid.length; ry++) {
    const row = grid[ry];
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x + (flip ? maxW - 1 - rx : rx), y + ry, 1, 1);
    }
  }
}

/** Bake a grid into an offscreen canvas (cached by key) for repeated blitting. */
export function bake(key, grid, pal) {
  let c = cache.get(key);
  if (c) return c;
  let w = 0;
  for (const row of grid) if (row.length > w) w = row.length;
  c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, grid.length);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  drawGrid(g, grid, 0, 0, pal);
  cache.set(key, c);
  return c;
}

export function blit(g, canvas, x, y, flip = false) {
  x = Math.round(x);
  y = Math.round(y);
  if (!flip) {
    g.drawImage(canvas, x, y);
  } else {
    g.save();
    g.translate(x + canvas.width, y);
    g.scale(-1, 1);
    g.drawImage(canvas, 0, 0);
    g.restore();
  }
}

/** Solid rect helper that keeps everything on the pixel grid. */
export function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function rectOutline(g, x, y, w, h, color) {
  g.fillStyle = color;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
}

/** Soft elliptical drop shadow, drawn as stacked rows so it stays pixelated. */
export function shadow(g, cx, cy, rx, ry, alpha = 0.35) {
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  rx = Math.max(1, Math.round(rx));
  ry = Math.max(1, Math.round(ry));
  for (let y = -ry; y <= ry; y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.round(rx * Math.sqrt(t));
    if (w <= 0) continue;
    g.fillRect(Math.round(cx) - w, Math.round(cy) + y, w * 2, 1);
  }
}

/** Filled circle rendered on the pixel grid (for magic orbs, slimes, etc). */
export function disc(g, cx, cy, r, color) {
  g.fillStyle = color;
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    if (w <= 0 && r > 0) continue;
    g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

export function lerp(a, b, t) { return a + (b - a) * t; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function clamp01(v) { return clamp(v, 0, 1); }

/** Linear gradient drawn as horizontal bands — keeps the retro look. */
export function bandGradient(g, x, y, w, h, colors) {
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const y0 = Math.round(y + (h * i) / n);
    const y1 = Math.round(y + (h * (i + 1)) / n);
    g.fillStyle = colors[i];
    g.fillRect(Math.round(x), y0, Math.round(w), y1 - y0);
  }
}
