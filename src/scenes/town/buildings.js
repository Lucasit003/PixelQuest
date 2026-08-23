// Town building artwork and the procedural structures still drawn in code.
//
// Two kinds of building live here and they are drawn very differently:
//
//   * Authored PNGs — guild, blacksmith, house, library, cottage, watch,
//     sanctuary, training ground, dungeon gate, market stalls, potion shop.
//     These are blitted 1:1 at the world-unit size recorded beside each one.
//     Those size constants are load-bearing: the art is authored to the game's
//     native footprint precisely so nothing is rescaled at runtime, and a
//     canvas downscale would drop pixels out of a 1px highlight.
//
//   * Procedural structures — tavern, pet keeper, quest board, farm plot and
//     the development markers, built from the wall/roof/door/window primitives
//     at the top of this file. They predate the authored art and are what the
//     remaining unwired districts still use.
//
// Nothing here knows about TownScene; these are pure draw calls against a
// context and world coordinates.

import { rect, rectOutline, disc, shadow, clamp } from '../../gfx/pixel.js';
import { drawText, textWidth } from '../../gfx/font.js';
import { UI } from '../../gfx/ui.js';
import { drawIcon, drawRock } from '../../gfx/props.js';
import { hash, fillEllipse, loadBuildingArt, contactShadow } from './primitives.js';
import { fenceRun, flowerbed, petHouse, bowl, egg, brazier } from './props.js';

// Potion Shop artwork (real transparent PNG). Loaded once; drawn directly with
// nearest-neighbor rendering. Authored to the game's native footprint so no
// runtime scaling/blur is needed.
const POTION_IMG = new Image();
let POTION_READY = false;
POTION_IMG.onload = () => { POTION_READY = true; };
POTION_IMG.src = 'assets/potion_shop.png';
// On-screen size in world units (aspect preserved from the source art).
const POTION_W = 113, POTION_H = 80;

const GUILD_ART = loadBuildingArt('assets/guild.png');
const GUILD_W = 122, GUILD_H = 78;
const BLACKSMITH_ART = loadBuildingArt('assets/blacksmith.png');
const BLACKSMITH_W = 112, BLACKSMITH_H = 68;
const HOUSE_ART = loadBuildingArt('assets/house.png');
const HOUSE_W = 75, HOUSE_H = 66;

// Real building art swapped in for districts that were still using
// procedural placeholders (drawMarker or hand-drawn rects).
const LIBRARY_ART = loadBuildingArt('assets/buildings/libary.png');
const LIBRARY_W = 100, LIBRARY_H = 78;
const COTTAGE_ART = loadBuildingArt('assets/buildings/wayferers_cottage.png');
const COTTAGE_W = 140, COTTAGE_H = 88;
const WATCH_ART = loadBuildingArt('assets/buildings/wayferers_watch.png');
const WATCH_W = 220, WATCH_H = 111;
const SANCTUARY_ART = loadBuildingArt('assets/buildings/pet_sanctuary.png');
const SANCTUARY_W = 150, SANCTUARY_H = 94;
const TRAINING_ART = loadBuildingArt('assets/buildings/training_grounds.png');
const TRAINING_W = 260, TRAINING_H = 141;
const DUNGEON_ART = loadBuildingArt('assets/buildings/duengon_gate.png');
const DUNGEON_W = 200, DUNGEON_H = 105;
const STALL_PRODUCE_ART = loadBuildingArt('assets/buildings/stall_produce.png');
const STALL_PRODUCE_W = 50, STALL_PRODUCE_H = 33;
const STALL_BAKERY_ART = loadBuildingArt('assets/buildings/stall_bakery.png');
const STALL_BAKERY_W = 42, STALL_BAKERY_H = 36;
const STALL_CLOTH_ART = loadBuildingArt('assets/buildings/stall_cloth.png');
const STALL_CLOTH_W = 42, STALL_CLOTH_H = 37;
const STALL_GOODS_ART = loadBuildingArt('assets/buildings/stall_goods.png');
const STALL_GOODS_W = 52, STALL_GOODS_H = 32;
const STALL_MERCHANT_ART = loadBuildingArt('assets/buildings/stall_merchant.png');
const STALL_MERCHANT_W = 50, STALL_MERCHANT_H = 33;

// Building wall with 3/4 volume: a lit front wall, a darker right-hand side wall
// (implying depth), a raised stone foundation and a contact shadow. Light from
// the upper-left. Returns the wall's top-left for roof placement.
function wallBox(g, cx, baseY, w, h, wall, wallDark, trim) {
  const x = Math.round(cx - w / 2), y = Math.round(baseY - h);
  contactShadow(g, cx, baseY, w * 0.56, 5, 0.34);
  // right-hand side wall (perspective) — a thin darker slab
  const side = 5;
  rect(g, x + w, y + 3, side, h - 3, wallDark);
  rect(g, x + w, y + 3, side, 1, wall);
  // front wall
  rect(g, x, y, w, h, wall);
  rect(g, x, y, w, 1, mix(wall, '#ffffff', 0.18));   // top lit edge
  rect(g, x, y, 1, h, mix(wall, '#ffffff', 0.10));   // left lit edge
  rect(g, x + w - 1, y, 1, h, wallDark);             // right shaded edge
  for (let i = 5; i < w; i += 8) rect(g, x + i, y + 1, 1, h - 1, mix(wall, wallDark, 0.5)); // plank seams
  // raised stone foundation (front face darker, top lit)
  rect(g, x - 2, baseY - 5, w + 4 + side, 5, '#7a7160');
  rect(g, x - 2, baseY - 5, w + 4 + side, 1, '#948a74');
  rect(g, x - 2, baseY - 1, w + 4 + side, 1, '#5c5446');
  rectOutline(g, x, y, w, h, trim);
  return { x, y };
}

// Pitched roof with a large overhang, an upper-left-lit plane and a lower-right
// shaded plane, a ridge line, and a dark eave shadow cast on the wall beneath.
function pitchedRoof(g, cx, topY, w, roofH, roof, roofDark, trim, overhang = 8) {
  const fullW = w + overhang * 2;
  // eave shadow band just under the roof (on the wall)
  rect(g, cx - fullW / 2, topY + roofH, fullW, 2, 'rgba(0,0,0,0.28)');
  const roofLite = mix(roof, '#ffffff', 0.22);
  const roofShade = mix(roof, '#000000', 0.22);
  for (let i = 0; i < roofH; i++) {
    const t = i / roofH;
    const rw = Math.round(fullW * (0.12 + t * 0.88));
    const rx = Math.round(cx - rw / 2);
    // left plane lit, right plane shaded, top rows darkest (thatch/shingle)
    rect(g, rx, topY + i, rw, 1, i < 2 ? roofDark : roof);
    rect(g, rx, topY + i, Math.ceil(rw / 2), 1, i < 2 ? roofDark : roofLite);
    rect(g, cx, topY + i, Math.floor(rw / 2), 1, i < 2 ? roofDark : roofShade);
    if (i % 3 === 0) rect(g, rx, topY + i, rw, 1, roofDark); // shingle courses
  }
  // overhanging eave lip
  rect(g, cx - fullW / 2, topY + roofH - 1, fullW, 2, trim);
  rect(g, cx - fullW / 2, topY + roofH - 2, fullW, 1, roofShade);
  // ridge cap
  rect(g, cx - 1, topY - 1, 2, roofH + 1, roofDark);
}

// Recessed door: a dark sunken interior inside a frame, with warm light spilling
// out at the threshold and a couple of stone steps.
function door(g, cx, baseY, dw = 12, dh = 16, col = '#4a2f1c') {
  const dx = Math.round(cx - dw / 2), dy = baseY - dh;
  // frame
  rect(g, dx - 1, dy - 1, dw + 2, dh + 1, '#2a1a10');
  // sunken interior (dark, gradient to warm at the bottom)
  rect(g, dx, dy, dw, dh, '#160f14');
  rect(g, dx + 1, dy + dh - 5, dw - 2, 5, '#3a2416');
  rect(g, dx + 2, dy + dh - 3, dw - 4, 3, 'rgba(242,180,74,0.35)');
  // door leaf ajar on the left
  rect(g, dx, dy, Math.ceil(dw / 2), dh, col);
  rect(g, dx, dy, 1, dh, mix(col, '#ffffff', 0.2));
  rect(g, dx + Math.ceil(dw / 2) - 2, dy + dh / 2, 1, 2, '#d8b24a'); // handle
  // stone steps (lit top, shaded front)
  rect(g, dx - 3, baseY, dw + 6, 2, '#948a74'); rect(g, dx - 3, baseY + 2, dw + 6, 1, '#6f6656');
}

// Recessed lit window: dark frame, warm glass, muntins, upper-left glint.
function windowLit(g, x, y, s = 8) {
  rect(g, x - 1, y - 1, s + 2, s + 2, '#2a1a10');  // recess frame
  rect(g, x, y, s, s, '#f2c94f');
  rect(g, x + s / 2 - 1, y, 1, s, '#2a1a10');
  rect(g, x, y + s / 2 - 1, s, 1, '#2a1a10');
  rect(g, x, y, s, 1, '#fff2c0');                  // top glint
  rect(g, x, y, 2, 2, '#fff6d8');                  // upper-left highlight
}

// small colour-mix helper for consistent lit/shaded surfaces
function mix(hex, other, amt) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  const r = Math.round(a[0] + (b[0] - a[0]) * amt);
  const gg = Math.round(a[1] + (b[1] - a[1]) * amt);
  const bl = Math.round(a[2] + (b[2] - a[2]) * amt);
  return `rgb(${r},${gg},${bl})`;
}
function hexToRgb(h) {
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function awning(g, cx, y, w, c1, c2 = '#e8e2d0') {
  const x = Math.round(cx - w / 2);
  rect(g, x, y, w, 5, c2);
  for (let i = 0; i < w; i += 8) rect(g, x + i, y, 4, 5, c1);
  rect(g, x, y + 5, w, 1, '#8a7a5a');
}

// ---------------------------------------------------------------- buildings

function drawCottage(g, cx, baseY, wall, wallDark, roof, roofDark, t) {
  const w = 54, h = 32;
  shadow(g, cx, baseY, w * 0.55, 4, 0.3);
  const b = wallBox(g, cx, baseY, w, h, wall, wallDark, '#2a1e14');
  pitchedRoof(g, cx, b.y - 13, w, 15, roof, roofDark, '#2a1e14');
  // chimney with smoke
  rect(g, cx + w / 2 - 10, b.y - 20, 6, 10, '#5a4a3a');
  if (Math.random() < 0.1) rect(g, cx + w / 2 - 8, b.y - 22 - ((t * 6) % 6), 2, 2, 'rgba(150,150,160,0.4)');
  door(g, cx, baseY);
  windowLit(g, cx - w / 2 + 7, baseY - 24);
  windowLit(g, cx + w / 2 - 15, baseY - 24);
  fenceRun(g, cx - w / 2 - 8, baseY + 3, w + 16);
  flowerbed(g, cx - w / 2 - 4, baseY + 5);
}

// The Player House — rendered from the authored transparent PNG (ivy-covered
// cottage, flower boxes, mailbox and bench already in the art). A small fenced
// strip is still added around it for the yard, since the art itself is just
// the building. Same load/draw contract as the Potion Shop.
function drawPlayerHouse(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, HOUSE_W * 0.42, 6, 0.3);
  fenceRun(g, cx - HOUSE_W / 2 - 10, baseY + 4, HOUSE_W + 20);
  if (!HOUSE_ART.ready) return;
  g.drawImage(HOUSE_ART.img, Math.round(cx - HOUSE_W / 2), Math.round(baseY - HOUSE_H), HOUSE_W, HOUSE_H);
}

function drawLibrary(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, LIBRARY_W * 0.42, 6, 0.32);
  if (!LIBRARY_ART.ready) return;
  g.drawImage(LIBRARY_ART.img, Math.round(cx - LIBRARY_W / 2), Math.round(baseY - LIBRARY_H), LIBRARY_W, LIBRARY_H);
}

// The Weapon Shop & Blacksmith — rendered from the authored transparent PNG
// (forge, anvil, weapon rack and sign already in the art).
function drawBlacksmith(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, BLACKSMITH_W * 0.42, 6, 0.32);
  if (!BLACKSMITH_ART.ready) return;
  g.drawImage(BLACKSMITH_ART.img, Math.round(cx - BLACKSMITH_W / 2), Math.round(baseY - BLACKSMITH_H), BLACKSMITH_W, BLACKSMITH_H);
  // wisps of smoke off the chimney — the forge is always lit
  const sx = cx + 5, sy0 = baseY - 59;
  for (let i = 0; i < 3; i++) {
    const k = ((t * 0.35 + i / 3) % 1);
    const sy = sy0 - k * 16;
    g.globalAlpha = (1 - k) * 0.35;
    disc(g, sx + Math.sin(t * 1.3 + i * 2) * 2, sy, 1.5 + k * 2, '#c9c2ba');
  }
  g.globalAlpha = 1;
}

// The Potion Shop — rendered directly from the authored transparent PNG (real
// alpha, no baked background). Anchored bottom-centre at the shop's ground
// position with a subtle contact shadow. Nearest-neighbor, no smoothing.
function drawPotionShop(g, cx, baseY, t) {
  // subtle ground/contact shadow (light from upper-left -> shadow lower-right)
  contactShadow(g, cx, baseY, POTION_W * 0.42, 6, 0.30);
  if (!POTION_READY) return; // image not loaded yet this frame
  // soft breathing glow behind the roof-peak potion sign, before the art so
  // it reads as light coming from inside the glass, not painted on top
  const sx = cx, sy = baseY - 43;
  const f = 0.5 + Math.sin(t * 2.2) * 0.25;
  g.globalAlpha = f * 0.35; disc(g, sx, sy, 9, '#c98bff'); g.globalAlpha = 1;
  g.drawImage(POTION_IMG, Math.round(cx - POTION_W / 2), Math.round(baseY - POTION_H), POTION_W, POTION_H);
  // a couple of drifting sparkles, like the sign's magic never fully settles
  for (let i = 0; i < 2; i++) {
    const a = t * 1.4 + i * 3.1;
    g.globalAlpha = 0.5 + Math.sin(t * 3 + i) * 0.3;
    rect(g, Math.round(sx + Math.cos(a) * 8), Math.round(sy + Math.sin(a) * 6 - 2), 1, 1, '#eadcff');
  }
  g.globalAlpha = 1;
}

function potionWindow(g, x, y) {
  windowLit(g, x, y, 9);
  rect(g, x + 1, y + 3, 2, 4, '#8a2fb0'); rect(g, x + 1, y + 2, 2, 1, '#5a1f80');
  rect(g, x + 5, y + 2, 2, 5, '#2f6aa0'); rect(g, x + 5, y + 1, 2, 1, '#1f4a80');
}

function awningStriped(g, cx, y, w) {
  const x = Math.round(cx - w / 2);
  rect(g, x, y + 5, w, 2, 'rgba(0,0,0,0.30)');
  const cols = ['#8a5ab8', '#efe4f7', '#a878d0'];
  for (let i = 0; i < w; i += 6) rect(g, x + i, y, 6, 5, cols[(i / 6) % 3 | 0]);
  rect(g, x, y, w, 1, '#cbb4e8');
  for (let i = 0; i < w; i += 6) rect(g, x + i + 1, y + 5, 4, 2, '#563680');
  rect(g, x - 1, y - 1, 2, 7, '#563680'); rect(g, x + w - 1, y - 1, 2, 7, '#563680');
}

function hangingHerbs(g, x, y) {
  rect(g, x, y - 5, 1, 5, '#4a3a24');
  rect(g, x - 2, y, 5, 4, '#2f5836'); rect(g, x - 1, y, 3, 5, '#3a7a3e');
  rect(g, x - 2, y - 1, 1, 1, '#e0679a');
}

function potionSign(g, cx, cy, t) {
  g.globalAlpha = 0.26 + Math.sin(t * 3) * 0.10; disc(g, cx, cy, 11, '#c96ad0'); g.globalAlpha = 1;
  rect(g, cx - 2, cy - 10, 4, 2, '#8a6a3a');
  rect(g, cx - 2, cy - 8, 4, 3, '#d8c8e8');
  rect(g, cx - 6, cy - 5, 12, 14, '#241a2a');
  rect(g, cx - 5, cy - 4, 10, 12, '#b84ad0');
  rect(g, cx - 5, cy + 2, 10, 6, '#8a2fb0');
  rect(g, cx - 4, cy - 3, 2, 9, '#eaa0f0');
  rect(g, cx - 6, cy - 5, 12, 1, '#e8d8f0');
  if (Math.random() < 0.4) rect(g, cx - 2 + (Math.random() * 4 | 0), cy - 1 - ((t * 8) % 8), 1, 1, '#e8c0f0');
}

function potionTable(g, x, y) {
  contactShadow(g, x, y, 10, 2, 0.28);
  rect(g, x - 9, y - 7, 18, 4, '#7a5530'); rect(g, x - 9, y - 7, 18, 1, '#8a6a44');
  rect(g, x - 8, y - 3, 2, 3, '#5a3a24'); rect(g, x + 6, y - 3, 2, 3, '#5a3a24');
  potionMini(g, x - 6, y - 8, '#b84ad0'); potionMini(g, x - 1, y - 8, '#3f7a9a'); potionMini(g, x + 4, y - 8, '#3f8a4a');
}
function potionMini(g, x, y, col) {
  rect(g, x - 1, y - 4, 3, 4, col);
  rect(g, x - 1, y - 2, 3, 2, mix(col, '#000000', 0.3));
  rect(g, x - 1, y - 5, 3, 1, '#8a6a3a');
  rect(g, x - 1, y - 4, 1, 2, mix(col, '#ffffff', 0.45));
}

// The Adventurer's Guild & Tavern — rendered from the authored transparent
// PNG (shield-and-mug sign, quest board, lanterns and banner already in the
// art).
function drawTavern(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, GUILD_W * 0.42, 7, 0.34);
  if (!GUILD_ART.ready) return;
  g.drawImage(GUILD_ART.img, Math.round(cx - GUILD_W / 2), Math.round(baseY - GUILD_H), GUILD_W, GUILD_H);
  // a slow gleam sweeping over the hanging shield sign above the door
  const f = 0.55 + Math.sin(t * 1.8 + cx) * 0.25;
  g.globalAlpha = f * 0.3; disc(g, cx + 2, baseY - 42, 8, '#ffe9a8'); g.globalAlpha = 1;
}

function drawTrainingGround(g, cx, cy, t) {
  if (!TRAINING_ART.ready) return;
  g.drawImage(TRAINING_ART.img, Math.round(cx - TRAINING_W / 2), Math.round(cy - TRAINING_H / 2), TRAINING_W, TRAINING_H);
}

function drawMarket(g, cx, cy, t) {
  // Market Square: the five stalls ring the square's rim — produce + bakery
  // along the north edge, cloth west, general goods east, the traveling
  // merchant on the south rim — and the CENTER STAYS OPEN for NPC traffic,
  // conversations and future events (per the approved market plan; never a
  // single row of stalls).
  const stalls = [
    { art: STALL_PRODUCE_ART, w: STALL_PRODUCE_W, h: STALL_PRODUCE_H, x: cx - 75, y: cy - 95 },
    { art: STALL_BAKERY_ART, w: STALL_BAKERY_W, h: STALL_BAKERY_H, x: cx + 70, y: cy - 90 },
    { art: STALL_CLOTH_ART, w: STALL_CLOTH_W, h: STALL_CLOTH_H, x: cx - 145, y: cy + 5 },
    { art: STALL_GOODS_ART, w: STALL_GOODS_W, h: STALL_GOODS_H, x: cx + 140, y: cy + 10 },
    { art: STALL_MERCHANT_ART, w: STALL_MERCHANT_W, h: STALL_MERCHANT_H, x: cx - 15, y: cy + 120 },
  ];
  for (const s of stalls) {
    contactShadow(g, s.x, s.y + s.h * 0.32, s.w * 0.4, 4, 0.25);
    if (s.art.ready) g.drawImage(s.art.img, Math.round(s.x - s.w / 2), Math.round(s.y - s.h / 2), s.w, s.h);
  }
  // well tucked toward the northeast rim so the middle stays clear
  const wx = cx + 95, wy = cy - 35;
  shadow(g, wx, wy, 9, 3, 0.3);
  rect(g, wx - 9, wy - 8, 18, 8, '#8a8ea0'); rectOutline(g, wx - 9, wy - 8, 18, 8, '#3a3e4a');
  rect(g, wx - 10, wy - 20, 2, 12, '#5a3a24'); rect(g, wx + 8, wy - 20, 2, 12, '#5a3a24');
  rect(g, wx - 12, wy - 22, 24, 3, '#7a3e2c');
  rect(g, wx - 2, wy - 14, 4, 4, '#3a3e4a');
}

function drawPetKeeper(g, cx, baseY, t) {
  const w = 66, h = 40;
  shadow(g, cx, baseY, w * 0.55, 5, 0.3);
  const b = wallBox(g, cx, baseY, w, h, '#8a7a54', '#6b5c3a', '#2a1e14');
  pitchedRoof(g, cx, b.y - 13, w, 15, '#c9924a', '#a06a2f', '#2a1e14', 6);
  door(g, cx, baseY);
  windowLit(g, cx + w / 2 - 15, baseY - 24);
  // paw sign
  rect(g, cx + 22, baseY - 30, 2, 8, '#2a1e14'); rect(g, cx + 16, baseY - 22, 14, 10, '#5c4230'); rectOutline(g, cx + 16, baseY - 22, 14, 10, '#2a1a10');
  disc(g, cx + 23, baseY - 16, 2, '#e8d36a');
  // fenced sanctuary to the right (the wandering pets live here)
  const sx = cx + 34, sy = baseY - 66, sw = 96, sh = 60; // sanctuary sits beside the cottage, north of the street
  for (let fx = sx - 6; fx <= sx + sw; fx += 8) { rect(g, fx, sy - 2, 1, 6, '#6b4a2e'); rect(g, fx, sy + sh - 2, 1, 6, '#6b4a2e'); }
  for (let fy = sy; fy <= sy + sh; fy += 8) { rect(g, sx - 6, fy, 6, 1, '#6b4a2e'); rect(g, sx + sw - 5, fy, 6, 1, '#6b4a2e'); }
  // pet houses, bowls, eggs, nests
  petHouse(g, sx + 12, sy + 20, '#8a4a3c'); petHouse(g, sx + 70, sy + 40, '#3f7a5c');
  bowl(g, sx + 40, sy + 16); bowl(g, sx + 58, sy + 46);
  egg(g, sx + 26, sy + 44, '#e0679a'); egg(g, sx + 30, sy + 46, '#9d8bff');
}

function drawQuestBoard(g, cx, baseY, t, hasQuest) {
  rect(g, cx - 3, baseY - 16, 2, 16, '#4a3824'); rect(g, cx + 1, baseY - 16, 2, 16, '#4a3824');
  rect(g, cx - 16, baseY - 36, 32, 22, '#8a6f4a'); rectOutline(g, cx - 16, baseY - 36, 32, 22, '#4a3824');
  drawIcon(g, 'scroll', cx - 12, baseY - 32); drawIcon(g, 'scroll', cx + 2, baseY - 32); drawIcon(g, 'scroll', cx - 5, baseY - 24);
  // little roof
  rect(g, cx - 18, baseY - 38, 36, 3, '#6a3329');
  if (hasQuest) { const bob = Math.sin(t * 4) * 2; drawText(g, '!', cx, baseY - 50 + bob, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' }); }
}

function drawDungeonGate(g, cx, baseY, t) {
  // MASSIVE stone gatehouse: towers, battlements, rune arch, deep portal, stairs
  const w = 88, h = 92;
  const x = cx - w / 2, y = baseY - h;
  shadow(g, cx, baseY, 52, 8, 0.42);
  // stone wall base
  rect(g, x - 10, y + 20, w + 20, h - 20, '#565667');
  for (let ry = 20; ry < h; ry += 8) rect(g, x - 10, y + ry, w + 20, 1, '#454556');
  for (let rx = 0; rx < w + 20; rx += 12) rect(g, x - 10 + ((rx / 12) % 2) * 6, y + 20, 1, h - 20, '#454556');
  // twin towers
  for (const tx of [x - 10, x + w - 8]) {
    rect(g, tx, y - 6, 18, h + 6, '#5e5e70'); for (let i = 0; i < h; i += 8) rect(g, tx, y - 6 + i, 18, 1, '#42424f');
    rect(g, tx - 2, y - 10, 22, 5, '#4a4a58');
    for (let bx = tx - 2; bx < tx + 20; bx += 6) rect(g, bx, y - 14, 3, 5, '#4a4a58'); // battlements
    brazier(g, tx + 9, y + 24, t + tx);
  }
  // rune arch + deep portal
  rect(g, x + 6, y + 8, w - 12, h - 8, '#4a4a58');
  const pw = 34, ph = 56;
  rect(g, cx - pw / 2, baseY - ph, pw, ph, '#0f0b1c');
  // glowing blue runes around the arch
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI + (i / 7) * Math.PI;
    const rx = cx + Math.cos(a) * (pw / 2 + 5), ry = (baseY - ph + 6) + Math.sin(a) * (pw / 2 + 5) + 8;
    g.globalAlpha = 0.6 + Math.sin(t * 3 + i) * 0.3; rect(g, Math.round(rx), Math.round(ry), 2, 2, '#5c8cff'); g.globalAlpha = 1;
  }
  // swirling portal energy
  for (let i = 0; i < 6; i++) { const a = t * 0.9 + i * 1.05; g.globalAlpha = 0.5 - i * 0.06; disc(g, cx + Math.cos(a) * (6 + i), baseY - ph / 2 + Math.sin(a * 1.3) * (7 + i), 2, '#7c5cff'); }
  g.globalAlpha = 1;
  rectOutline(g, cx - pw / 2, baseY - ph, pw, ph, '#2a2340');
  // banners
  rect(g, x + 2, y + 12, 5, 20, '#3a5cc0'); rect(g, x + w - 7, y + 12, 5, 20, '#c0463c');
  // grand stairs
  for (let i = 0; i < 5; i++) rect(g, cx - 28 + i * 3, baseY + i * 3, 56 - i * 6, 4, i % 2 ? '#6b6b7a' : '#565667');
  // rubble
  drawRock(g, x - 16, baseY + 6, 1.1); drawRock(g, x + w + 10, baseY + 8, 1);
}

// ---------------------------------------------------------------- props

// Fenced farm plot: tilled crop rows inside a wooden fence, with a scarecrow.
// Purely decorative ground dressing; collision comes from the caller's solid.
function drawFarmPlot(g, cx, cy, w, h) {
  const x = cx - w / 2, y = cy - h / 2;
  rect(g, x, y, w, h, '#5c4a30');
  for (let ry = 4; ry < h - 4; ry += 8) {
    rect(g, x + 4, y + ry, w - 8, 5, '#6b5738');
    for (let rx = x + 4; rx < x + w - 4; rx += 6) rect(g, rx, y + ry, 1, 5, '#4a3a24');
    for (let rx = x + 6; rx < x + w - 6; rx += 12) { rect(g, rx, y + ry - 1, 2, 2, '#3d7a3e'); rect(g, rx + 4, y + ry + 1, 2, 2, '#c9924a'); }
  }
  fenceRun(g, x - 2, y - 2, w + 4);
  fenceRun(g, x - 2, y + h + 4, w + 4);
  for (let fy = y; fy <= y + h; fy += 8) { rect(g, x - 3, fy, 1, 7, '#6b4a2e'); rect(g, x + w + 2, fy, 1, 7, '#6b4a2e'); }
  // scarecrow
  const sx = x + w - 12, sy = y + 6;
  rect(g, sx - 1, sy, 2, 12, '#6b4a2e'); rect(g, sx - 6, sy + 3, 12, 2, '#6b4a2e');
  rect(g, sx - 3, sy - 4, 6, 5, '#c9a878'); rect(g, sx - 2, sy - 5, 4, 2, '#8a5a3a');
  rect(g, sx - 4, sy + 1, 3, 6, '#8a5a3a'); rect(g, sx + 1, sy + 1, 3, 6, '#3f7a5c');
}

// ---- Master Town Layout v1: temporary development markers -----------------
// Phase 1 is geometry/roads only — real buildings aren't placed yet (per the
// brief, not even the ones with approved art). Each future structure gets a
// dashed reserved-footprint outline (sized from the real asset as a scale
// reference where one exists) plus a small signpost naming it, so districts
// read as placeholders rather than finished buildings.
function drawMarker(g, cx, topY, w, h, label, color = '#a08858') {
  const x = Math.round(cx - w / 2), y = Math.round(topY);
  g.globalAlpha = 0.14;
  rect(g, x, y, w, h, color);
  g.globalAlpha = 0.5;
  for (let i = 0; i < w; i += 8) { rect(g, x + i, y, 4, 1, color); rect(g, x + i, y + h - 1, 4, 1, color); }
  for (let i = 0; i < h; i += 8) { rect(g, x, y + i, 1, 4, color); rect(g, x + w - 1, y + i, 1, 4, color); }
  g.globalAlpha = 1;
  if (!label) return;
  const px = Math.round(cx), py = Math.round(y + h);
  rect(g, px - 1, py - 16, 2, 16, '#5c4a30');
  rect(g, px - 1, py - 17, 2, 2, '#7a6440');
  const words = label.toUpperCase();
  const bw = textWidth(words) + 8;
  rect(g, px - bw / 2, py - 27, bw, 12, 'rgba(28,22,15,0.85)');
  rectOutline(g, px - bw / 2, py - 27, bw, 12, '#c9a15a');
  drawText(g, words, px, py - 25, { color: '#f0d9a0', align: 'center' });
}

// Small unobtrusive signpost only — no reserved footprint/collision. Used for
// reserved-but-unplanned expansion space (south road, future homes/stalls).
function drawSignpost(g, x, y, label) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 5, 2, 0.2);
  rect(g, x - 1, y - 20, 2, 20, '#4a3a26');
  const words = label.toUpperCase();
  const bw = textWidth(words) + 8;
  rect(g, x - bw / 2, y - 32, bw, 12, 'rgba(20,26,18,0.75)');
  rectOutline(g, x - bw / 2, y - 32, bw, 12, '#6a8a5c');
  drawText(g, words, x, y - 30, { color: '#bcd9a8', align: 'center' });
}

// What TownScene draws directly. The rest — wall/roof/door primitives, the
// potion-shop detailing, the stall art — is internal to this module.
export {
  COTTAGE_ART, COTTAGE_H, COTTAGE_W, DUNGEON_ART, DUNGEON_H, DUNGEON_W, HOUSE_H, HOUSE_W,
  SANCTUARY_ART, SANCTUARY_H, SANCTUARY_W, WATCH_ART, WATCH_H, WATCH_W,
  drawBlacksmith, drawLibrary, drawMarker, drawMarket, drawPlayerHouse, drawPotionShop,
  drawQuestBoard, drawSignpost, drawTavern, drawTrainingGround,
};
