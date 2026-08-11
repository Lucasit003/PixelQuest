// RPG UI kit: framed panels, stat bars, dialogue boxes, list menus, toasts.
// Everything draws on the pixel grid and shares one dark-parchment palette.

import { rect, rectOutline } from './pixel.js';
import { drawText, textWidth, wrapText } from './font.js';
import { drawIcon } from './props.js';

// Palette tuned to the reference sheet: near-black ornate panels, thin muted
// borders with a faint gold sheen, vivid accent colors reserved for headers.
export const UI = {
  bg: '#0e0b16',
  bgLite: '#181425',
  frame: '#3b3452',
  frameLite: '#6a5f8e',
  frameDark: '#080610',
  ink: '#e8e2f5',
  inkDim: '#8f88ab',
  gold: '#f2c94f',
  good: '#57d98a',
  bad: '#e05a5a',
  mana: '#5b8cf2',
  stamina: '#f2a03f',
  xp: '#f2a03f',
};

/** A framed panel with a double border and subtle top highlight. */
export function panel(g, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const bg = opts.bg || UI.bg;
  rect(g, x, y, w, h, bg);
  if (opts.gradient !== false) rect(g, x, y, w, 2, UI.bgLite);
  rectOutline(g, x, y, w, h, opts.frame || UI.frame);
  rectOutline(g, x + 1, y + 1, w - 2, h - 2, opts.frameInner || UI.frameDark);
  // corner studs
  const c = opts.frameLite || UI.frameLite;
  rect(g, x, y, 2, 2, c);
  rect(g, x + w - 2, y, 2, 2, c);
  rect(g, x, y + h - 2, 2, 2, c);
  rect(g, x + w - 2, y + h - 2, 2, 2, c);
}

/** Title bar drawn above/into a panel. */
export function panelTitle(g, x, y, w, title) {
  const tw = textWidth(title) + 10;
  const tx = Math.round(x + w / 2 - tw / 2);
  rect(g, tx, y - 4, tw, 9, UI.frameDark);
  rectOutline(g, tx, y - 4, tw, 9, UI.frame);
  drawText(g, title, x + w / 2, y - 2, { color: UI.gold, align: 'center' });
}

/**
 * A labelled stat bar (HP/MP/XP). value/max in absolute units.
 * opts: { color, back, w, h, label, showNums, flashTo }
 */
export function bar(g, x, y, value, max, opts = {}) {
  const w = opts.w || 60;
  const h = opts.h || 6;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  x = Math.round(x); y = Math.round(y);

  rect(g, x, y, w, h, opts.back || '#160f22');
  // ghost bar (for recent damage) if provided
  if (opts.ghost !== undefined && opts.ghost > frac) {
    rect(g, x, y, Math.round(w * opts.ghost), h, opts.ghostColor || '#6b3540');
  }
  const fw = Math.round((w - 2) * frac);
  if (fw > 0) {
    rect(g, x + 1, y + 1, fw, h - 2, opts.color || UI.good);
    rect(g, x + 1, y + 1, fw, 1, opts.lite || lighten(opts.color || UI.good));
  }
  rectOutline(g, x, y, w, h, opts.frame || UI.frameDark);

  if (opts.label) drawText(g, opts.label, x + 2, y - 8, { color: UI.inkDim });
  if (opts.showNums) {
    drawText(g, `${Math.ceil(value)}/${max}`, x + w - 1, y + (h - 7) / 2, {
      color: UI.ink, align: 'right', shadow: '#000',
    });
  }
}

function lighten(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  r = Math.min(255, r + 60); gg = Math.min(255, gg + 60); b = Math.min(255, b + 60);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Dialogue box anchored to the bottom of the screen.
 * Returns true when the visible text has fully "typed" out.
 */
export function dialogue(g, W, H, speaker, text, reveal = 1, opts = {}) {
  const bx = 14, bw = W - 28, bh = 52;
  const by = H - bh - 8;
  panel(g, bx, by, bw, bh);

  if (speaker) {
    const nw = textWidth(speaker) + 8;
    rect(g, bx + 6, by - 4, nw, 9, UI.frameDark);
    rectOutline(g, bx + 6, by - 4, nw, 9, UI.frame);
    drawText(g, speaker, bx + 10, by - 2, { color: UI.gold });
  }

  const lines = wrapText(text, bw - 16);
  const totalChars = Math.floor(text.length * reveal);
  let shown = 0;
  let ly = by + 8;
  for (const line of lines) {
    let out = line;
    if (shown + line.length > totalChars) {
      out = line.slice(0, Math.max(0, totalChars - shown));
    }
    drawText(g, out, bx + 8, ly, { color: UI.ink });
    shown += line.length + 1;
    ly += 10;
    if (shown > totalChars) break;
  }

  const done = reveal >= 1;
  if (done && !opts.noPrompt) {
    const blink = (Math.floor(performance.now() / 400) % 2) === 0;
    if (blink) drawText(g, '▼'.replace('▼', 'v'), bx + bw - 12, by + bh - 12, { color: UI.gold });
    if (opts.prompt) drawText(g, opts.prompt, bx + bw - 8, by + bh - 10, { color: UI.inkDim, align: 'right' });
  }
  return done;
}

/**
 * Vertical list menu. items: [{ label, sub, icon, disabled, right }]
 * Returns nothing; caller owns the selection index and input handling.
 */
export function listMenu(g, x, y, w, items, selected, opts = {}) {
  const rowH = opts.rowH || 14;
  const h = items.length * rowH + 8;
  if (opts.panel !== false) panel(g, x, y, w, h);
  if (opts.title) panelTitle(g, x, y, w, opts.title);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ry = y + 4 + i * rowH;
    const on = i === selected;
    if (on) {
      rect(g, x + 3, ry, w - 6, rowH - 1, UI.frameDark);
      rectOutline(g, x + 3, ry, w - 6, rowH - 1, UI.frame);
      // caret
      const wob = Math.sin(performance.now() / 150) > 0 ? 0 : 1;
      drawText(g, '>', x + 5 + wob, ry + 3, { color: UI.gold });
    }
    let tx = x + 13;
    if (it.icon) { drawIcon(g, it.icon, tx, ry + 2); tx += 10; }
    const col = it.disabled ? UI.inkDim : (on ? UI.ink : UI.inkDim);
    drawText(g, it.label, tx, ry + 3, { color: col });
    if (it.right) {
      drawText(g, it.right, x + w - 6, ry + 3, { color: it.rightColor || UI.gold, align: 'right' });
    }
    if (it.sub && on) {
      // caller may render sub elsewhere; kept minimal here
    }
  }
  return h;
}

/** Big centered heading with a shadow, used for scene banners. */
export function heading(g, W, y, text, opts = {}) {
  drawText(g, text, W / 2, y, {
    color: opts.color || UI.gold,
    scale: opts.scale || 2,
    align: 'center',
    shadow: opts.shadow || '#1b1526',
    tracking: 1,
  });
}

/** A floating combat number / feedback toast list manager. */
export class Toasts {
  constructor() { this.items = []; }
  push(text, x, y, color = '#ffffff', opts = {}) {
    this.items.push({
      text, x, y, color,
      vy: opts.vy ?? -22, vx: opts.vx ?? 0,
      life: opts.life ?? 0.9, t: 0,
      scale: opts.scale ?? 1, crit: opts.crit ?? false,
    });
  }
  update(dt) {
    for (const it of this.items) {
      it.t += dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.vy += 30 * dt; // gentle gravity so numbers arc
    }
    this.items = this.items.filter((it) => it.t < it.life);
  }
  draw(g) {
    for (const it of this.items) {
      const k = it.t / it.life;
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      g.save();
      g.globalAlpha = Math.max(0, alpha);
      drawText(g, it.text, it.x, it.y, {
        color: it.color, align: 'center',
        scale: it.crit ? 2 : it.scale,
        shadow: '#120a1a',
      });
      g.restore();
    }
  }
}
