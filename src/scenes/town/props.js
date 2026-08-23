// Small procedural props, drawn in code rather than blitted from art.
//
// These predate the sprite pipeline and are the town's original street
// furniture: benches, lamps, fences, barrels, market clutter, the reeds at the
// water's edge and the two procedural trees. Most are deliberately one-liners
// — at this resolution a bench really is six rects, and spreading that over
// twenty lines would hide the shape rather than clarify it.
//
// The authored PNG props that replaced most of these are placed through
// DECOR_SIZE/DECOR_ART and drawn with drawPropArt; what remains here is still
// used by the procedural buildings and by the lake and Eldertree dressing.
//
// Pure draw calls — no scene state, no `this`.

import { rect, rectOutline, disc, shadow } from '../../gfx/pixel.js';
import { drawIcon } from '../../gfx/props.js';
import { hash, contactShadow, fillEllipse } from './primitives.js';

function bench(g, x, y) { shadow(g, x, y, 8, 2, 0.22); rect(g, x - 8, y - 4, 16, 3, '#7a5a3a'); rect(g, x - 8, y - 7, 16, 2, '#8a6a44'); rect(g, x - 7, y - 1, 2, 3, '#5a3a24'); rect(g, x + 5, y - 1, 2, 3, '#5a3a24'); }
function lamp(g, x, y, t) { rect(g, x - 1, y - 18, 2, 18, '#3a2e22'); rect(g, x - 3, y - 22, 6, 5, '#4a3a2a'); const f = 0.6 + Math.sin(t * 4 + x) * 0.2; g.globalAlpha = f; disc(g, x, y - 19, 3, '#ffd67a'); g.globalAlpha = 1; disc(g, x, y - 19, 1, '#fff2c0'); g.globalAlpha = 0.07 + f * 0.04; disc(g, x, y - 16, 20, '#ffcc66'); g.globalAlpha = 1; }
function brazier(g, x, y, t) { shadow(g, x, y, 6, 2, 0.3); rect(g, x - 4, y - 6, 8, 6, '#3a3a46'); rect(g, x - 5, y - 8, 10, 2, '#4a4a58'); rect(g, x - 1, y - 2, 2, 6, '#2a2a34'); const f = 0.6 + Math.sin(t * 8 + x) * 0.3; g.globalAlpha = f; disc(g, x, y - 10, 4, '#f2942b'); disc(g, x, y - 11, 2, '#ffd67a'); g.globalAlpha = 1; g.globalAlpha = 0.1 + f * 0.05; disc(g, x, y - 8, 18, '#ff9a3c'); g.globalAlpha = 1; }
function fenceRun(g, x, y, w) { for (let fx = x; fx <= x + w; fx += 8) rect(g, fx, y - 5, 1, 7, '#6b4a2e'); rect(g, x, y - 3, w, 1, '#7a5530'); rect(g, x, y, w, 1, '#5a3a24'); }
function barrel(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 9, 8, 9, '#7a5530'); rect(g, x - 4, y - 7, 8, 1, '#4a3220'); rect(g, x - 4, y - 3, 8, 1, '#4a3220'); rect(g, x - 4, y - 9, 8, 1, '#8a6a44'); }
function crate(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 8, 9, 8, '#8a6a44'); rectOutline(g, x - 4, y - 8, 9, 8, '#5a3a24'); rect(g, x - 4, y - 4, 9, 1, '#5a3a24'); rect(g, x, y - 8, 1, 8, '#5a3a24'); }
function logPile(g, x, y) { shadow(g, x, y, 6, 1, 0.22); for (let i = 0; i < 3; i++) rect(g, x - 6 + i * 4, y - 4, 3, 4, '#6b4a2e'); for (let i = 0; i < 2; i++) rect(g, x - 4 + i * 4, y - 7, 3, 3, '#7a5530'); }
function planter(g, x, y) { rect(g, x - 5, y - 5, 10, 5, '#6b4a2e'); rect(g, x - 5, y - 5, 10, 1, '#8a6a44'); rect(g, x - 4, y - 8, 2, 3, '#3a7a3e'); rect(g, x, y - 9, 2, 4, '#3a7a3e'); rect(g, x - 4, y - 9, 1, 1, '#e0679a'); rect(g, x + 1, y - 10, 1, 1, '#f2c94f'); }
function flowerbed(g, x, y) { for (let i = 0; i < 4; i++) { const fx = x + i * 4; rect(g, fx, y - 3, 1, 3, '#2f5836'); rect(g, fx, y - 4, 1, 1, ['#f2c94f', '#e0679a', '#9d8bff', '#e05a5a'][i % 4]); } }
function well(g, x, y) { shadow(g, x, y, 8, 3, 0.3); rect(g, x - 8, y - 8, 16, 8, '#8a8ea0'); rectOutline(g, x - 8, y - 8, 16, 8, '#3a3e4a'); rect(g, x - 9, y - 18, 2, 10, '#5a3a24'); rect(g, x + 7, y - 18, 2, 10, '#5a3a24'); rect(g, x - 10, y - 20, 20, 3, '#7a3e2c'); }
function cart(g, x, y) { shadow(g, x, y, 10, 2, 0.28); rect(g, x - 12, y - 8, 24, 6, '#7a5530'); rectOutline(g, x - 12, y - 8, 24, 6, '#4a3220'); disc(g, x - 8, y, 3, '#4a3220'); disc(g, x + 8, y, 3, '#4a3220'); disc(g, x - 8, y, 1, '#8a6a44'); disc(g, x + 8, y, 1, '#8a6a44'); drawIcon(g, 'potionRed', x - 4, y - 14); }
function mailbox(g, x, y) { rect(g, x - 1, y - 8, 2, 8, '#5a3a24'); rect(g, x - 4, y - 13, 9, 6, '#c0463c'); rectOutline(g, x - 4, y - 13, 9, 6, '#2a1a10'); rect(g, x + 4, y - 12, 2, 3, '#d8b24a'); }
function clothesline(g, x, y) { rect(g, x - 12, y - 14, 1, 14, '#5a3a24'); rect(g, x + 12, y - 14, 1, 14, '#5a3a24'); rect(g, x - 12, y - 13, 24, 1, '#8a8070'); rect(g, x - 6, y - 12, 4, 5, '#5c6a8a'); rect(g, x + 2, y - 12, 4, 6, '#c0463c'); }
function signpost(g, x, y) { rect(g, x - 1, y - 12, 2, 12, '#5a3a24'); rect(g, x - 8, y - 12, 16, 4, '#7a5530'); rect(g, x - 8, y - 12, 16, 1, '#8a6a44'); }
function banner(g, x, y, color) { rect(g, x, y, 3, 20, color); rect(g, x, y + 20, 3, 2, '#2a1e14'); rect(g, x - 1, y + 16, 5, 4, color); }
function weaponRack(g, x, y) { rect(g, x - 8, y - 2, 16, 3, '#6b4a2e'); rect(g, x - 8, y - 14, 2, 14, '#5a3a24'); rect(g, x + 6, y - 14, 2, 14, '#5a3a24'); drawIcon(g, 'sword', x - 6, y - 12); drawIcon(g, 'axe', x + 1, y - 12); }
function outdoorTable(g, x, y) { shadow(g, x, y, 8, 2, 0.24); rect(g, x - 8, y - 6, 16, 3, '#7a5530'); rect(g, x - 7, y - 3, 2, 3, '#5a3a24'); rect(g, x + 5, y - 3, 2, 3, '#5a3a24'); drawIcon(g, 'coin', x - 3, y - 11); }
function petHouse(g, x, y, color) { shadow(g, x, y, 5, 1, 0.22); rect(g, x - 5, y - 5, 10, 5, '#8a6a44'); for (let i = 0; i < 6; i++) rect(g, x - 5 + i, y - 5 - i * 0.5, 10 - i * 2, 1, color); disc(g, x, y - 2, 2, '#2a1a10'); }
function bowl(g, x, y) { rect(g, x - 3, y - 2, 6, 2, '#8a8ea0'); rect(g, x - 2, y - 1, 4, 1, '#5c6a8a'); }
function egg(g, x, y, color) { rect(g, x - 1, y - 3, 3, 4, color); rect(g, x - 1, y - 3, 1, 1, '#ffffff'); }
function bridge(g, x, y, w, h) { rect(g, x, y, w, h, '#7a5530'); for (let by = 0; by < h; by += 4) rect(g, x, y + by, w, 1, '#5a3a24'); rect(g, x, y, w, 1, '#8a6a44'); rect(g, x, y + h - 1, w, 1, '#8a6a44'); rect(g, x - 1, y, 1, h, '#4a3220'); rect(g, x + w, y, 1, h, '#4a3220'); }

// A small reed/cattail cluster for riverbanks — a few thin blades and one
// cattail head, with a barely-there sway so the bank doesn't feel static.
function drawReeds(g, x, y, seed, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 0.6 + seed) * 0.6;
  shadow(g, x, y, 5, 2, 0.2);
  for (let i = 0; i < 3; i++) {
    const bx = x + (i - 1) * 3;
    const h = 9 + (i % 2) * 2;
    const tip = bx + sway * (i - 1 === 0 ? 0.4 : 1);
    rect(g, bx, y - h, 1, h, '#3a7a3e');
    rect(g, Math.round(tip), y - h, 1, 3, '#5cad5e');
  }
  rect(g, x + 1, y - 12 + sway * 0.5, 1, 5, '#4a7a3a'); // cattail stem
  rect(g, x, y - 16 + sway * 0.5, 3, 4, '#7a5a34'); // cattail head
  rect(g, x, y - 16 + sway * 0.5, 3, 1, '#9a7a4a'); // head highlight
}

// Volumetric tree: trunk, layered canopy (dark underside -> bright upper-left
// highlight), a lower-right shade crescent and a ground contact shadow. Gentle
// sway. Reads with real volume rather than as a flat symbol.
function bigTree(g, x, y, kind, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 1.1 + x * 0.3) * 1;
  if (kind === 'pine') {
    contactShadow(g, x, y, 9, 3, 0.34);
    rect(g, x - 1, y - 6, 3, 6, '#4a3018'); rect(g, x - 1, y - 6, 1, 6, '#5c3e22');
    pineTier(g, x + sway * 0.3, y - 4, 12, 7);
    pineTier(g, x + sway * 0.5, y - 12, 9, 7);
    pineTier(g, x + sway * 0.7, y - 20, 6, 6);
    rect(g, x - 1 + sway, y - 28, 2, 3, '#1f4a26'); // tip
  } else {
    contactShadow(g, x, y, 13, 4, 0.34);
    rect(g, x - 2, y - 9, 4, 9, '#5a3a24'); rect(g, x - 2, y - 9, 2, 9, '#6b4a2e');
    const cy = y - 13 + sway;
    fillEllipse(g, x + 1, cy + 3, 13, 9, '#1e4824');   // dark underside
    fillEllipse(g, x - 1, cy, 13, 9, '#2c6a32');       // mid canopy
    fillEllipse(g, x - 2, cy - 2, 10, 7, '#3d8a40');   // lit
    fillEllipse(g, x - 4, cy - 4, 6, 4, '#57b356');    // highlight (upper-left)
    fillEllipse(g, x + 6, cy + 3, 5, 4, '#173d1c');    // lower-right shade
    // a couple of leaf clumps for texture
    rect(g, x - 6, cy - 1, 1, 1, '#57b356'); rect(g, x + 4, cy - 3, 1, 1, '#3d8a40');
  }
}

function pineTier(g, cx, baseY, halfW, hgt) {
  cx = Math.round(cx);
  for (let i = 0; i < hgt; i++) {
    const k = i / hgt;
    const w = Math.round(halfW * (0.15 + k * 0.85));
    const y = baseY - hgt + i;
    rect(g, cx - w, y, w * 2, 1, '#2c6a32');            // mid
    rect(g, cx - w, y, Math.max(1, w), 1, '#3d8a40');   // left/upper lit
    rect(g, cx + Math.floor(w * 0.4), y, Math.ceil(w * 0.6), 1, '#1f4a26'); // right shade
  }
  rect(g, cx - halfW, baseY - 1, halfW * 2, 1, '#173d1c'); // dark base line
}

export {
  bench, lamp, brazier, fenceRun, barrel, crate,
  logPile, planter, flowerbed, well, cart, mailbox,
  clothesline, signpost, banner, weaponRack, outdoorTable, petHouse,
  bowl, egg, bridge, drawReeds, bigTree, pineTier,
};
