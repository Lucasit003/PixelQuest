// Environment props and item icons. Buildings are drawn procedurally so they
// can be resized per location; small items are authored as pixel grids.

import { drawGrid, rect, rectOutline, shadow, disc, bake, blit } from './pixel.js';
import { drawText } from './font.js';

// ------------------------------------------------------------- item icons

const ICON_PAL = {
  k: '#1b1526', r: '#d94f4f', R: '#f28a8a', b: '#4f7fd9', B: '#8ab4f2',
  g: '#4fd97f', G: '#8af2b4', y: '#f2c94f', Y: '#ffe89a', p: '#a56bd9',
  P: '#c9a0f2', w: '#e8eef7', d: '#8c93a8', n: '#6d3b1f', o: '#c98a5c',
  c: '#f2d24f', s: '#7a808f',
};

export const ICONS = {
  potionRed: [
    '..kkk..',
    '..kwk..',
    '.kkkkk.',
    'kwRRRwk',
    'kRrrrRk',
    'kRrrrRk',
    '.kkkkk.',
  ],
  potionBlue: [
    '..kkk..',
    '..kwk..',
    '.kkkkk.',
    'kwBBBwk',
    'kBbbbBk',
    'kBbbbBk',
    '.kkkkk.',
  ],
  potionGreen: [
    '..kkk..',
    '..kwk..',
    '.kkkkk.',
    'kwGGGwk',
    'kGggggk'.slice(0, 7),
    'kGggggk'.slice(0, 7),
    '.kkkkk.',
  ],
  potionYellow: [
    '..kkk..',
    '..kwk..',
    '.kkkkk.',
    'kwYYYwk',
    'kYyyyYk',
    'kYyyyYk',
    '.kkkkk.',
  ],
  coin: [
    '.kkk.',
    'kcYck',
    'kYcYk',
    'kcYck',
    '.kkk.',
  ],
  sword: [
    '....kw',
    '...kwk',
    '..kwk.',
    '.kwk..',
    'ckc...',
    'kcк...'.replace('к', 'k'),
    'k.....',
  ],
  axe: [
    '..kkk.',
    '.kwwwk',
    'kwwwwk',
    '.kwwk.',
    '..kn..',
    '..kn..',
    '..kn..',
  ],
  staff: [
    '..kpk.',
    '.kpPpk',
    '..kpk.',
    '..kn..',
    '..kn..',
    '..kn..',
    '..kn..',
  ],
  dagger: [
    '...kw',
    '..kwk',
    '.kwk.',
    'ckc..',
    'kk...',
  ],
  bow: [
    '.kn..',
    'kn.w.',
    'kn..w',
    'kn.w.',
    '.kn..',
  ],
  shield: [
    'kkkkk',
    'kdwwdk'.slice(0, 5),
    'kdwwdk'.slice(0, 5),
    '.kddk',
    '..kk.',
  ],
  chest: [
    'kkkkkkkk',
    'knnnnnnk',
    'knoooонk'.replace('о', 'o').replace('н', 'n'),
    'kkkcckkk',
    'knnccnnk',
    'knnnnnnk',
    'kkkkkkkk',
  ],
  egg: [
    '..kkk..',
    '.kwwwk.',
    'kwpwpwk',
    'kwwpwwk',
    'kwpwpwk',
    '.kwwwk.',
    '..kkk..',
  ],
  scroll: [
    'kkkkkkk',
    'kwwwwwk',
    'kwkkkwk',
    'kwwwwwk',
    'kwkkkwk',
    'kwwwwwk',
    'kkkkkkk',
  ],
  star: [
    '..y..',
    '.yYy.',
    'yYYYy',
    '.yYy.',
    '..y..',
  ],
  heart: [
    '.r.r.',
    'rRrRr',
    'rRRRr',
    '.rRr.',
    '..r..',
  ],
  book: [
    'kkkkkkk',
    'kbbkggk',
    'kbBkgGk',
    'kbbkggk',
    'kbBkgGk',
    'kkkkkkk',
  ],
  lock: [
    '.sss.',
    'ss.ss',
    's...s',
    'ddddd',
    'dcccd',
    'dcccd',
    'ddddd',
  ],
  plus: [
    '..s..',
    '..s..',
    'sssss',
    '..s..',
    '..s..',
  ],
};

export function drawIcon(g, name, x, y, scale = 1) {
  const grid = ICONS[name];
  if (!grid) return;
  if (scale === 1) {
    drawGrid(g, grid, x, y, ICON_PAL);
  } else {
    const c = bake('icon:' + name, grid, ICON_PAL);
    g.drawImage(c, Math.round(x), Math.round(y), c.width * scale, c.height * scale);
  }
}

// --------------------------------------------------------------- buildings

/**
 * A pixel-art building with a pitched roof, door, windows and a hanging sign.
 * opts: { w, h, wall, wallDark, roof, roofDark, trim, sign, glow }
 */
export function drawBuilding(g, x, y, opts) {
  const {
    w = 60, h = 46,
    wall = '#8a6a4a', wallDark = '#6b4f36',
    roof = '#a34a3c', roofDark = '#7a3329',
    trim = '#3a2a1e',
    door = '#4a2f1c',
    lit = true,
  } = opts;

  x = Math.round(x - w / 2);
  y = Math.round(y - h);

  shadow(g, x + w / 2, y + h, w * 0.55, 4, 0.3);

  // wall with vertical plank shading
  rect(g, x, y + 12, w, h - 12, wall);
  for (let i = 0; i < w; i += 6) rect(g, x + i, y + 12, 1, h - 12, wallDark);
  rect(g, x, y + h - 4, w, 4, wallDark);
  rectOutline(g, x, y + 12, w, h - 12, trim);

  // pitched roof, drawn as stepped rows so it stays pixel-crisp
  const roofH = 14;
  const overhang = 5;
  for (let i = 0; i < roofH; i++) {
    const t = i / roofH;
    const rw = Math.round((w + overhang * 2) * t);
    const rx = Math.round(x + w / 2 - rw / 2);
    rect(g, rx, y + i, rw, 1, i < 2 ? roofDark : (i % 4 === 0 ? roofDark : roof));
  }
  rect(g, x - overhang, y + roofH - 1, w + overhang * 2, 2, trim);

  // door
  const dw = 12, dh = 18;
  const dx = Math.round(x + w / 2 - dw / 2);
  const dy = y + h - dh;
  rect(g, dx, dy, dw, dh, door);
  rectOutline(g, dx, dy, dw, dh, trim);
  rect(g, dx + dw - 4, dy + dh / 2, 2, 2, '#d8b24a');

  // windows
  const wy = y + h - 30;
  for (const wx of [x + 6, x + w - 14]) {
    rect(g, wx, wy, 8, 8, lit ? '#f2c94f' : '#2a3550');
    rectOutline(g, wx, wy, 8, 8, trim);
    rect(g, wx + 3, wy, 1, 8, trim);
    rect(g, wx, wy + 3, 8, 1, trim);
  }
}

/** Hanging shop sign with an icon. */
export function drawSign(g, x, y, icon, label) {
  x = Math.round(x); y = Math.round(y);
  rect(g, x - 1, y - 8, 2, 8, '#3a2a1e');
  rect(g, x - 14, y, 28, 14, '#5c4230');
  rectOutline(g, x - 14, y, 28, 14, '#2a1e14');
  drawIcon(g, icon, x - 4, y + 3);
  if (label) drawText(g, label, x, y + 16, { color: '#d9c9a8', align: 'center', shadow: '#1b1526' });
}

// ------------------------------------------------------------------ nature

export function drawTree(g, x, y, size = 1, sway = 0) {
  x = Math.round(x); y = Math.round(y);
  const th = Math.round(16 * size);
  const cr = Math.round(11 * size);
  shadow(g, x, y, cr * 0.9, 3, 0.28);
  rect(g, x - 2, y - th, 4, th, '#4a3220');
  rect(g, x - 2, y - th, 1, th, '#6b4a2e');
  const cx = x + sway;
  const cy = y - th - cr + 4;
  disc(g, cx, cy, cr, '#1f4a2b');
  disc(g, cx - 2, cy - 2, cr - 3, '#2f6b3a');
  disc(g, cx - 4, cy - 4, cr - 7, '#43914d');
  disc(g, cx + cr - 6, cy + 3, cr - 8, '#2f6b3a');
}

export function drawPineTree(g, x, y, size = 1) {
  x = Math.round(x); y = Math.round(y);
  const h = Math.round(30 * size);
  shadow(g, x, y, 9 * size, 3, 0.28);
  rect(g, x - 2, y - 6, 4, 6, '#3a2618');
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const ty = y - 6 - (h / tiers) * (t + 1) + 4;
    const tw = Math.round((14 - t * 3) * size);
    for (let i = 0; i < h / tiers; i++) {
      const k = i / (h / tiers);
      const rw = Math.round(tw * (0.3 + k * 0.7));
      rect(g, x - rw, ty + i, rw * 2, 1, i % 5 === 0 ? '#1c3d24' : (t === 0 ? '#2a5c34' : '#245030'));
    }
  }
}

export function drawBush(g, x, y, size = 1) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 8 * size, 2, 0.22);
  disc(g, x, y - 5 * size, 6 * size, '#245030');
  disc(g, x - 5 * size, y - 3 * size, 4 * size, '#2a5c34');
  disc(g, x + 5 * size, y - 3 * size, 4 * size, '#2a5c34');
  disc(g, x - 2, y - 7 * size, 3 * size, '#3a7a44');
}

export function drawRock(g, x, y, size = 1) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 7 * size, 2, 0.25);
  disc(g, x, y - 4 * size, 5 * size, '#5c5f6b');
  disc(g, x - 2, y - 5 * size, 3 * size, '#7a7f8c');
  rect(g, x - 5 * size, y - 1, 10 * size, 1, '#43464f');
}

/** Animated torch — the flame flickers on a sine so it reads as alive. */
export function drawTorch(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  rect(g, x - 1, y - 14, 3, 14, '#4a3220');
  const f = Math.sin(t * 11) * 0.5 + Math.sin(t * 7.3) * 0.5;
  const h = 7 + Math.round(f * 2);
  disc(g, x, y - 17, 4, '#d94f2b');
  disc(g, x, y - 18 - h * 0.25, 3, '#f2942b');
  disc(g, x, y - 19 - h * 0.35, 2, '#ffe066');
  // light pool
  g.save();
  g.globalAlpha = 0.09 + Math.abs(f) * 0.03;
  g.fillStyle = '#ffbb55';
  disc(g, x, y - 6, 22, '#ffbb55');
  g.restore();
}

/** Dungeon gate — a stone arch with a dark portal the player walks into. */
export function drawGate(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  const w = 46, h = 52;
  shadow(g, x, y, 26, 5, 0.4);

  // stone arch
  for (let i = 0; i < h; i++) {
    const k = i / h;
    const inset = i < 14 ? Math.round((1 - Math.sqrt(1 - Math.pow(1 - i / 14, 2))) * 12) : 0;
    rect(g, x - w / 2 + inset, y - h + i, w - inset * 2, 1, k < 0.3 ? '#6b6b7a' : '#565667');
  }
  // block seams
  for (let i = 6; i < h; i += 9) rect(g, x - w / 2, y - h + i, w, 1, '#3f3f4d');
  rect(g, x - w / 2 - 3, y - h + 12, 3, h - 12, '#4a4a58');
  rect(g, x + w / 2, y - h + 12, 3, h - 12, '#4a4a58');

  // portal void with a slow swirl
  const pw = 24, ph = 36;
  rect(g, x - pw / 2, y - ph, pw, ph, '#120d1e');
  for (let i = 0; i < 5; i++) {
    const a = t * 0.8 + i * 1.25;
    const rx = Math.cos(a) * (5 + i);
    const ry = Math.sin(a * 1.3) * (5 + i * 0.6);
    g.globalAlpha = 0.5 - i * 0.08;
    disc(g, x + rx, y - ph / 2 + ry, 2, '#7c5cff');
  }
  g.globalAlpha = 1;
  rectOutline(g, x - pw / 2, y - ph, pw, ph, '#2a2340');

  drawTorch(g, x - w / 2 - 6, y, t);
  drawTorch(g, x + w / 2 + 6, y, t + 1.7);
}

/** Training dummy / target used to dress the training grounds. */
export function drawDummy(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  const wobble = Math.sin(t * 1.7) * 0.5;
  shadow(g, x, y, 8, 3, 0.3);
  rect(g, x - 1, y - 10, 3, 10, '#4a3220');
  g.save();
  g.translate(x + wobble, y - 10);
  rect(g, -7, -18, 14, 18, '#b8935c');
  for (let i = -6; i < 7; i += 3) rect(g, i, -18, 1, 18, '#96754a');
  rectOutline(g, -7, -18, 14, 18, '#4a3a24');
  rect(g, -10, -14, 20, 3, '#6b4a2e');
  disc(g, 0, -22, 4, '#b8935c');
  rect(g, -2, -23, 1, 1, '#3a2a1e');
  rect(g, 1, -23, 1, 1, '#3a2a1e');
  g.restore();
}

/** Stone-block ground band used inside the dungeon. */
export function drawStoneFloor(g, x, y, w, h, seed = 0) {
  rect(g, x, y, w, h, '#3a3448');
  for (let ry = 0; ry < h; ry += 8) {
    rect(g, x, y + ry, w, 1, '#2c2738');
    const off = ((ry / 8 + seed) % 2) * 8;
    for (let rx = off; rx < w; rx += 16) rect(g, x + rx, y + ry, 1, 8, '#2c2738');
  }
}
