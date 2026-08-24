// The town's on-screen UI: status plate, district banner, interaction prompt,
// and the development overview.
//
// This COMPOSES gfx/ui.js — panel(), bar(), UI's palette — rather than drawing
// its own chrome. There is one UI system in this game and this is not a second
// one; what lives here is only the town's particular arrangement of it.
//
// One layering rule worth keeping: the interaction prompt is world-space UI and
// must be drawn AFTER the depth-sorted pass. It used to be painted inside the
// location's own draw call, where anything standing south of that location —
// the Eldertree's colonnade, the planting by the fountain — drew over the text.

import { rect, clamp01 } from '../../gfx/pixel.js';
import { drawText, textWidth } from '../../gfx/font.js';
import { panel, bar, UI } from '../../gfx/ui.js';
import { drawIcon } from '../../gfx/props.js';
import { ZOOM } from './dimensions.js';
import { strokeRoundedPath } from './roads.js';

// ---- HUD + banners ------------------------------------------------------

export function drawHUD(scene, g) {
  // slim plate: class + level, HP, gold
  const pw = 118, ph = 22;
  panel(g, 4, 4, pw, ph, { bg: 'rgba(12,10,22,0.82)' });
  drawText(g, `${scene.hero.cls().name}`, 8, 6, { color: UI.ink });
  drawText(g, `Lv ${scene.hero.s.level}`, pw - 2, 6, { color: UI.gold, align: 'right' });
  bar(g, 8, 15, scene.hero.s.hp, scene.hero.maxHp, { w: 74, h: 4, color: '#e0483c' });
  drawIcon(g, 'coin', pw - 26, 13);
  drawText(g, `${scene.hero.s.gold}`, pw - 16, 14, { color: UI.gold });

  // transient district banner (top-center, fades)
  if (scene.districtBannerT > 0 && scene.districtBanner) {
    const a = clamp01(Math.min(1, scene.districtBannerT * 1.5) * Math.min(1, (scene.districtBannerT) * 2));
    g.globalAlpha = a;
    const w = textWidth(scene.districtBanner, 2) + 24;
    const bx = scene.W / 2 - w / 2;
    rect(g, bx, 12, w, 18, 'rgba(12,10,22,0.7)');
    rect(g, bx, 12, w, 1, UI.gold); rect(g, bx, 29, w, 1, UI.gold);
    drawText(g, scene.districtBanner.toUpperCase(), scene.W / 2, 15, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' });
    g.globalAlpha = 1;
  }

  // one-time control hint on load, then gone
  if (scene.introHintT > 0) {
    g.globalAlpha = clamp01(Math.min(1, scene.introHintT));
    drawText(g, 'WASD move   E interact   I inventory', scene.W / 2, scene.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });
    g.globalAlpha = 1;
  }
}

// The interaction prompt is world-space UI, drawn AFTER the depth-sorted
// pass: it used to be painted inside _drawLocation, where anything south of
// the location (the Eldertree's colonnade, plaza planting by the fountain)
// could draw over the text.
export function drawNearPrompt(scene, g) {
  const loc = scene.near;
  if (loc) {
    const label = loc.label || { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest', house: 'Enter Your House' }[loc.action] || 'Enter';
    const w = textWidth('[E] ' + label) + 12;
    // at the location's foot, but never over the player: when they stand
    // south of the point (inside the near radius) drop it below their feet
    const py = Math.max(loc.dy + 2, scene.py + 3);
    panel(g, loc.dx - w / 2, py, w, 13, { bg: 'rgba(12,10,22,0.9)' });
    const blink = Math.floor(scene.t * 3) % 2 === 0;
    drawText(g, '[E] ' + label, loc.dx, py + 3, { color: blink ? UI.gold : UI.ink, align: 'center' });
  }
}

// Development overview: `window.__townDebug` at a small `window.__townZoom`
// renders the planned road centrelines and district tags, scaled to stay
// readable at whatever zoom the whole-map screenshot is taken at.
export function drawDebugOverview(scene, g) {
  const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const p of scene.roadPlan) {
    g.strokeStyle = p.kind === 'adventure' ? 'rgba(226,124,60,0.85)'
      : p.kind === 'main' ? 'rgba(255,240,170,0.85)' : 'rgba(205,225,140,0.6)';
    g.lineWidth = Math.max(p.width * 0.3, 2 / Z);
    strokeRoundedPath(g, p.pts, 70);
  }
  const s = Math.max(2, Math.round(1.3 / Z));
  for (const [name, x, y] of scene.debugLabels) {
    const w = textWidth(name, s) + 8 * s;
    rect(g, x - w / 2, y - 5 * s, w, 10 * s, 'rgba(10,8,20,0.75)');
    drawText(g, name, x, y - 3 * s, { color: '#ffd97a', align: 'center', scale: s });
  }
}
