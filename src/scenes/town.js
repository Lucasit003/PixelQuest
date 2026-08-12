// The town hub — a dense, walkable top-down map modelled on the concept art:
// a stone Crystal Plaza landmark at the centre, an interconnected cobblestone
// street network, and detailed districts (Library, Weapon Shop & Blacksmith,
// Training Grounds, Potion Shop, Pet Sanctuary, Market Square, Adventurer's
// Guild & Tavern, Residential Quarter with the Player House, a Quest Board and
// checkpoint on the Adventure Road, and the great Dungeon Gate). Buildings are
// framed by tree clusters, gardens, fences and prop groups so there is very
// little empty grass.
//
// The player walks in 8 directions; the camera follows within the map bounds.
// District names appear briefly on entry (no permanent floating labels), and an
// [E] prompt shows only at a building's entrance. Shops/inventory reuse the
// existing overlay controllers.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, bar, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, disc, shadow, clamp, lerp, clamp01 } from '../gfx/pixel.js';
import { drawCharacter, drawActor, drawPet } from '../gfx/actors.js';
import { drawTree, drawPineTree, drawBush, drawRock, drawTorch, drawIcon, drawDummy } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { WeaponShop, PotionShop, InventoryMenu } from './menus.js';

const MAP_W = 1280;
const MAP_H = 800;

// Potion Shop artwork (real transparent PNG). Loaded once; drawn directly with
// nearest-neighbor rendering. Authored to the game's native footprint so no
// runtime scaling/blur is needed.
const POTION_IMG = new Image();
let POTION_READY = false;
POTION_IMG.onload = () => { POTION_READY = true; };
POTION_IMG.src = 'assets/potion_shop.png';
// On-screen size in world units (aspect preserved from the source art).
const POTION_W = 113, POTION_H = 80;

// Crystal Plaza fountain artwork (real transparent PNG).
const FOUNTAIN_IMG = new Image();
let FOUNTAIN_READY = false;
FOUNTAIN_IMG.onload = () => { FOUNTAIN_READY = true; };
FOUNTAIN_IMG.src = 'assets/fountain.png';
const FOUNTAIN_W = 79, FOUNTAIN_H = 54; // world units (127x86 authored @ zoom 1.6)

// Building artwork (real transparent PNGs), same load/draw pattern as the
// Potion Shop above. Each authored to the game's native footprint.
function loadBuildingArt(src) {
  const img = new Image();
  const state = { img, ready: false };
  img.onload = () => { state.ready = true; };
  img.src = src;
  return state;
}
const GUILD_ART = loadBuildingArt('assets/guild.png');
const GUILD_W = 122, GUILD_H = 78;
const BLACKSMITH_ART = loadBuildingArt('assets/blacksmith.png');
const BLACKSMITH_W = 112, BLACKSMITH_H = 68;
const HOUSE_ART = loadBuildingArt('assets/house.png');
const HOUSE_W = 75, HOUSE_H = 66;

// ------------------------------------------------------------ road tileset
// Authored cobblestone tiles (96px squares, real alpha) with corners,
// T-junctions, intersections and end caps. The town's road network is rasterised
// onto a grid and each cell picks its tile from a 4-bit neighbour mask
// (N=1, E=2, S=4, W=8), so junctions form automatically.
const ROAD_TILE = 28;               // world units per road cell
const ROAD_IMGS = {};
for (const n of ['straight_v', 'straight_h', 'cross', 't_up', 't_down', 't_left', 't_right',
  'corner_tl', 'corner_tr', 'corner_bl', 'end_s', 'end_s2', 'end_w', 'plaza_wide', 'damaged']) {
  const img = new Image();
  img.src = `assets/roads/${n}.png`;
  ROAD_IMGS[n] = img;
}
// mask -> [tile, flipX]
const ROAD_MASK = {
  5: ['straight_v', 0], 10: ['straight_h', 0], 15: ['cross', 0],
  7: ['t_right', 0], 13: ['t_left', 0], 11: ['t_up', 0], 14: ['t_down', 0],
  6: ['corner_tl', 0], 12: ['corner_bl', 0], 3: ['corner_tr', 0], 9: ['corner_tr', 1],
  1: ['end_s2', 0], 4: ['end_s', 0], 2: ['end_w', 1], 8: ['end_w', 0],
  0: ['plaza_wide', 0],
};

// Town camera zoom: the world is drawn scaled up so the player sees roughly one
// district plus a little of its neighbours, and the character reads at a good
// size. Pure 2D — this only changes framing, not the pixel art.
const ZOOM = 1.6;

// Imaginary sunlight from the upper-left: contact shadows fall to the
// lower-right. One helper so every grounded object casts a consistent shadow.
function contactShadow(g, cx, by, rx, ry, alpha = 0.32) {
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

export class TownScene {
  constructor(hero, hooks) {
    this.hero = hero;
    this.hooks = hooks; // { toTraining, toDungeon, toHouse }
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.overlay = null;
    this.dialogue = null;
    this.dialogueReveal = 0;

    // player starts just south of the plaza
    this.px = 630; this.py = 460;
    this.facing = 1; this.moving = false; this.walkT = 0;
    this.camX = 0; this.camY = 0;

    this.currentDistrict = null;
    this.districtBanner = null; this.districtBannerT = 0;
    this.introHintT = 4.5; // brief control hint, then it fades for good

    this._buildTown();
    this.near = null;
  }

  // ---- town definition ----------------------------------------------------

  _buildTown() {
    // Compact grid layout: all streets sit on the ROAD_TILE grid, every building
    // fronts a street with its door on the road, and leftover pockets are filled
    // with forest so the town reads dense like the concept art.
    // Concept-map layout: Crystal Plaza at the centre with four roads meeting it;
    // Guild north, Library (temple spot) NE, Market east, river + Riverside east
    // edge, Commercial Street SW (Potion + Blacksmith), Residential west with the
    // Player House, Training Grounds NW, and the Dungeon Gate as the south exit.
    this.locations = [
      { id: 'guild', name: "Adventurer's Guild & Tavern", dx: 630, dy: 194, action: 'guild', district: "Adventurer's Guild",
        draw: (g) => drawTavern(g, 630, 186, this.t), solid: { x: 569, y: 108, w: 122, h: 78 } },
      { id: 'library', name: 'Library & Archive', dx: 854, dy: 222, action: 'library', district: 'Library District',
        draw: (g) => drawLibrary(g, 854, 216, this.t), solid: { x: 812, y: 164, w: 84, h: 52 } },
      { id: 'training', name: 'Training Grounds', dx: 350, dy: 230, action: 'training', district: 'Training Grounds', zone: true,
        draw: (g) => drawTrainingGround(g, 350, 150, this.t), solid: { x: 344, y: 132, w: 12, h: 12 } },
      { id: 'potion', name: 'Potion Shop', dx: 440, dy: 510, action: 'potion', district: 'Commercial Street',
        sortY: 506, draw: (g) => drawPotionShop(g, 440, 506, this.t), solid: null },
      { id: 'blacksmith', name: 'Weapon Shop & Blacksmith', dx: 560, dy: 510, action: 'weapon', district: 'Commercial Street',
        draw: (g) => drawBlacksmith(g, 560, 506, this.t), solid: { x: 504, y: 438, w: 112, h: 68 } },
      { id: 'market', name: 'Market Square', dx: 854, dy: 462, action: 'market', district: 'Market Square', zone: true,
        draw: (g) => drawMarket(g, 854, 486, this.t), solid: { x: 848, y: 490, w: 12, h: 10 } },
      { id: 'pets', name: 'Pet Keeper', dx: 952, dy: 392, action: 'pets', district: 'Pet Sanctuary',
        draw: (g) => drawPetKeeper(g, 952, 388, this.t), solid: { x: 919, y: 348, w: 66, h: 40 } },
      { id: 'quest', name: 'Quest Board', dx: 676, dy: 604, action: 'quest', district: 'Dungeon Approach',
        draw: (g) => drawQuestBoard(g, 676, 600, this.t, !!this.hero.activeQuest()), solid: { x: 664, y: 584, w: 24, h: 16 } },
      { id: 'dungeon', name: 'Dungeon Gate', dx: 630, dy: 734, action: 'dungeon', district: 'Dungeon Approach',
        draw: (g) => drawDungeonGate(g, 630, 720, this.t), solid: { x: 586, y: 628, w: 88, h: 92 } },
      { id: 'plaza', name: 'Crystal Plaza', dx: 630, dy: 408, action: 'rest', district: 'Crystal Plaza',
        draw: (g) => drawFountainSprite(g, 630, 390, this.t), solid: { x: 604, y: 374, w: 52, h: 16 } },
      { id: 'home', name: 'Your House', dx: 296, dy: 578, action: 'house', district: 'Residential Quarter',
        draw: (g) => drawPlayerHouse(g, 296, 574, this.t), solid: { x: 259, y: 508, w: 75, h: 66 } },
      // decorative NPC homes (Residential Quarter, west)
      { id: 'home1', name: null, dx: 260, dy: 390, action: null,
        draw: (g) => drawCottage(g, 260, 386, '#7a6a58', '#5c4e40', '#8a4a3c', '#6a3329', this.t), solid: { x: 232, y: 350, w: 56, h: 36 } },
      { id: 'home2', name: null, dx: 170, dy: 394, action: null,
        draw: (g) => drawCottage(g, 170, 390, '#6a7a58', '#4e5c40', '#8a6a3c', '#6a5029', this.t), solid: { x: 142, y: 354, w: 56, h: 36 } },
      { id: 'home3', name: null, dx: 250, dy: 524, action: null,
        draw: (g) => drawCottage(g, 250, 520, '#82725c', '#5e5040', '#5a6a8a', '#3f4d66', this.t), solid: { x: 222, y: 488, w: 56, h: 32 } },
      // farm/garden plot, NE of the Library — decorative, fenced off
      { id: 'farm', name: null, dx: 1002, dy: 172, action: null,
        draw: (g) => drawFarmPlot(g, 1002, 172, 118, 76), solid: null },
    ];

    // collision solids: footprints + pond + stream banks
    this.solids = this.locations.filter((l) => l.solid).map((l) => l.solid);
    // Potion Shop: side wall blocks with the centre doorway left open
    this.solids.push({ x: 383, y: 452, w: 47, h: 50 }); // left wall
    this.solids.push({ x: 450, y: 452, w: 47, h: 50 }); // right wall
    this.pond = { cx: 1106, cy: 660, rx: 36, ry: 20 };
    this.solids.push({ x: this.pond.cx - this.pond.rx, y: this.pond.cy - this.pond.ry, w: this.pond.rx * 2, h: this.pond.ry * 2 });
    // river runs down the east edge; blocked except at the bridge on East Street
    this.stream = { x: 1092, w: 28, y0: 60, y1: 700, bridgeY: 392, bridgeH: 36 };
    this.solids.push({ x: this.stream.x, y: this.stream.y0, w: this.stream.w, h: this.stream.bridgeY - this.stream.y0 });
    this.solids.push({ x: this.stream.x, y: this.stream.bridgeY + this.stream.bridgeH, w: this.stream.w, h: this.stream.y1 - (this.stream.bridgeY + this.stream.bridgeH) });

    // district regions for the transient entry banner
    this.regions = [
      { name: 'Crystal Plaza', x: 540, y: 320, w: 180, h: 170 },
      { name: "Adventurer's Guild", x: 540, y: 60, w: 190, h: 180 },
      { name: 'Library District', x: 770, y: 120, w: 180, h: 160 },
      { name: 'Training Grounds', x: 260, y: 90, w: 180, h: 170 },
      { name: 'Residential Quarter', x: 140, y: 330, w: 300, h: 290 },
      { name: 'Commercial Street', x: 380, y: 430, w: 260, h: 110 },
      { name: 'Market Square', x: 740, y: 420, w: 220, h: 140 },
      { name: 'Pet Sanctuary', x: 900, y: 300, w: 200, h: 110 },
      { name: 'Riverside Park', x: 1050, y: 430, w: 230, h: 240 },
      { name: 'Dungeon Approach', x: 540, y: 540, w: 200, h: 250 },
      { name: 'The Farmstead', x: 960, y: 120, w: 150, h: 110 },
    ];

    // cobblestone road network {x,y,w,h}; centrelines sit on the tile grid so
    // the rasteriser produces clean rows/columns with automatic junctions.
    this.roads = [
      { x: 224, y: 398, w: 406, h: 16 },     // West Street (row 14): residential -> plaza
      { x: 630, y: 398, w: 566, h: 16 },     // East Street (row 14): plaza -> market spur -> bridge -> mines exit
      { x: 622, y: 200, w: 16, h: 206 },     // North Avenue (col 22): guild -> plaza
      { x: 622, y: 406, w: 16, h: 210 },     // South Avenue (col 22): plaza -> dungeon gate
      { x: 342, y: 224, w: 16, h: 350 },     // Residential lane (col 12): training -> W street -> player house
      { x: 350, y: 512, w: 282, h: 16 },     // Commercial Street (row 18): lane -> shops -> S avenue
      { x: 846, y: 224, w: 16, h: 190 },     // Library spur (col 30 north)
      { x: 846, y: 406, w: 16, h: 84 },      // Market spur (col 30 south)
    ];

    // Rasterise the road rects onto the tile grid: walk each rect's long axis and
    // mark cells along its centreline, so the network becomes 1-tile-wide streets
    // that autotile into corners and junctions.
    this.roadCells = new Set();
    for (const r of this.roads) {
      const horizontal = r.w >= r.h;
      const cy = Math.floor((r.y + r.h / 2) / ROAD_TILE);
      const cx = Math.floor((r.x + r.w / 2) / ROAD_TILE);
      if (horizontal) {
        const c0 = Math.floor(r.x / ROAD_TILE), c1 = Math.floor((r.x + r.w) / ROAD_TILE);
        for (let c = c0; c <= c1; c++) this.roadCells.add(`${c},${cy}`);
      } else {
        const r0 = Math.floor(r.y / ROAD_TILE), r1 = Math.floor((r.y + r.h) / ROAD_TILE);
        for (let rr = r0; rr <= r1; rr++) this.roadCells.add(`${cx},${rr}`);
      }
    }

    // decorative tree clusters framing districts (dense, grouped)
    this.trees = [];
    const cluster = (cx, cy, n, spread, kind) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(cx + i) * 2;
        const r = spread * (0.4 + hash(cx * i + cy) * 0.6);
        this.trees.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.7, kind: (i % 3 === 0) ? 'pine' : kind });
      }
    };
    // fill every empty pocket so the town reads dense, not spread out
    cluster(150, 150, 7, 70, 'pine'); cluster(120, 260, 5, 55, 'tree');   // NW forest by training
    cluster(480, 140, 5, 55, 'tree'); cluster(500, 250, 4, 40, 'pine');   // between training & guild
    cluster(760, 90, 5, 50, 'pine'); cluster(960, 130, 6, 60, 'pine');    // N/NE forest
    cluster(1000, 230, 4, 40, 'tree'); cluster(1180, 160, 5, 55, 'pine'); // by library / river top
    cluster(90, 340, 5, 55, 'tree'); cluster(90, 470, 4, 45, 'pine');     // west edge
    cluster(150, 620, 6, 60, 'pine'); cluster(300, 680, 5, 55, 'tree');   // SW below residential
    cluster(430, 640, 6, 60, 'pine'); cluster(500, 590, 3, 30, 'tree');   // S of commercial
    cluster(500, 330, 3, 30, 'tree'); cluster(760, 330, 3, 30, 'tree');   // plaza flanks
    cluster(760, 250, 3, 28, 'tree'); cluster(720, 480, 3, 26, 'tree');
    cluster(740, 660, 5, 55, 'tree'); cluster(880, 620, 6, 60, 'pine');   // SE forest by gate
    cluster(980, 680, 5, 50, 'tree'); cluster(1010, 540, 4, 45, 'tree');
    cluster(1180, 260, 4, 40, 'pine'); cluster(1220, 600, 5, 50, 'pine'); // east bank
    // edge forest ringing the map
    for (let x = 30; x < MAP_W; x += 46) { this.trees.push({ x, y: 40 + hash(x) * 30, kind: 'pine' }); this.trees.push({ x: x + 20, y: MAP_H - 30 - hash(x) * 24, kind: 'pine' }); }
    for (let y = 90; y < MAP_H - 40; y += 48) { this.trees.push({ x: 24 + hash(y) * 20, y, kind: 'pine' }); this.trees.push({ x: MAP_W - 26 - hash(y) * 18, y, kind: 'pine' }); }

    // grouped ground props (barrels/crates/benches/flowers…) rendered flat under entities
    this.propGroups = [
      // blacksmith and guild art already include their own barrels/crates/
      // tables/forge dressing, so no extra propGroup clutter is added here.
      // residential gardens + fences + mailbox (west)
      { fn: (g) => { fenceRun(g, 222, 390, 70); flowerbed(g, 230, 386); flowerbed(g, 272, 386); mailbox(g, 296, 384); clothesline(g, 210, 520); } },
      // home2 + home3 yards
      { fn: (g) => { fenceRun(g, 132, 394, 66); flowerbed(g, 140, 390); flowerbed(g, 178, 390); } },
      { fn: (g) => { fenceRun(g, 212, 524, 66); flowerbed(g, 220, 520); planter(g, 262, 518); } },
      // library steps + planters (NE)
      { fn: (g) => { planter(g, 812, 222); planter(g, 896, 222); bench(g, 880, 228); } },
      // market extras (east)
      { fn: (g) => { cart(g, 900, 480); crate(g, 780, 470); crate(g, 788, 478); } },
      // plaza benches + flowers + rocks around the fountain rim
      { fn: (g) => {
        bench(g, 582, 452); bench(g, 678, 452);
        flowerbed(g, 560, 358); flowerbed(g, 696, 358); flowerbed(g, 560, 462); flowerbed(g, 696, 462);
        drawRock(g, 548, 400, 0.8); drawRock(g, 710, 420, 0.8);
      } },
      // riverside park (east bank)
      { fn: (g) => { bench(g, 1160, 480); flowerbed(g, 1150, 500); drawBush(g, 1180, 510, 0.9); } },
      // corrupted grounds around the Dungeon Gate: dead trees + jagged rocks,
      // kept clear of the south-avenue road (x 622-638) so the path stays open
      { fn: (g) => {
        deadTree(g, 560, 660, this.t); deadTree(g, 700, 656, this.t); deadTree(g, 540, 720, this.t);
        deadTree(g, 720, 716, this.t); deadTree(g, 580, 770, this.t); deadTree(g, 680, 772, this.t);
        corruptedRock(g, 570, 700); corruptedRock(g, 690, 696); corruptedRock(g, 560, 750); corruptedRock(g, 700, 748);
        flowerbed(g, 592, 640); flowerbed(g, 668, 636);
      } },
    ];

    // lamps: plaza corners + one along each road
    this.lamps = [
      [585, 368], [675, 368], [585, 444], [675, 444],
      [500, 394], [760, 394], [630, 300], [630, 500],
      [420, 536], [570, 536], [800, 494], [300, 428], [838, 330], [200, 428],
    ];
    // braziers flanking the South Avenue toward the Dungeon Gate
    this.braziers = [[600, 650], [660, 650], [600, 580], [660, 580]];

    // NPCs
    this.npcs = [
      { name: 'Captain Mara', sprite: 'sage', x: 700, y: 600, facing: -1 },
      { name: 'Blacksmith', sprite: 'villager', x: 606, y: 516, facing: -1 },
      { name: 'Pet Keeper', sprite: 'villager', x: 1000, y: 394, facing: -1 },
      { name: 'Gate Guard', sprite: 'warrior', x: 596, y: 700, facing: 1 },
      { name: 'Gate Guard', sprite: 'warrior', x: 664, y: 700, facing: -1 },
      { name: 'Merchant', sprite: 'villager', x: 812, y: 470, facing: 1 },
      { name: 'Villager', sprite: 'villager', x: 240, y: 430, facing: 1 },
      { name: 'Adventurer', sprite: 'warrior', x: 592, y: 226, facing: 1 },
      { name: 'Adventurer', sprite: 'mage', x: 676, y: 230, facing: -1 },
    ];

    // wandering pets inside the fenced sanctuary
    this.sanctuaryPets = [
      { sprite: 'fox', x: 1000, y: 350, tx: 1000, ty: 350 },
      { sprite: 'rabbit', x: 1040, y: 360, tx: 1040, ty: 360 },
      { sprite: 'turtle', x: 1020, y: 336, tx: 1020, ty: 336 },
    ];
    this.sanctuary = { x: 986, y: 322, w: 96, h: 60 };
  }

  exit() {}

  setOutcome(kind) {
    if (kind === 'victory') this.toasts.push('Returned victorious!', this.px, this.py - 30, UI.gold, { life: 2.5, vy: -3 });
    else if (kind === 'defeat') this.toasts.push('You retreat to recover.', this.px, this.py - 30, UI.bad, { life: 2.5, vy: -3 });
  }

  // ---- update -------------------------------------------------------------

  update(dt, game) {
    this.t += dt;
    this.toasts.update(dt);
    this.particles.update(dt);
    if (this.introHintT > 0) this.introHintT -= dt;
    if (this.districtBannerT > 0) this.districtBannerT -= dt;

    // (crystal motes are drawn in drawFountainFX's fxMotes — no generic
    // particle spawns needed here anymore)

    // wandering sanctuary pets
    for (const p of this.sanctuaryPets) {
      if (Math.hypot(p.x - p.tx, p.y - p.ty) < 3 || Math.random() < dt * 0.4) {
        p.tx = this.sanctuary.x + hash(this.t + p.x) * this.sanctuary.w;
        p.ty = this.sanctuary.y + hash(this.t * 1.3 + p.y) * this.sanctuary.h;
      }
      p.x = lerp(p.x, p.tx, dt * 1.2); p.y = lerp(p.y, p.ty, dt * 1.2);
    }

    if (this.overlay) { this.overlay.update(dt); return; }
    if (this.dialogue) { this._updateDialogue(dt); return; }

    // movement with per-axis collision
    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      const spd = 100 * (1 + this.hero.petBonus('moveSpeed'));
      this._tryMove(ax.x * spd * dt, 0);
      this._tryMove(0, ax.y * spd * dt);
      if (ax.x !== 0) this.facing = ax.x > 0 ? 1 : -1;
      this.walkT += dt;
      if (Math.random() < dt * 4) this.particles.dust(this.px, this.py, 1);
    }

    // camera follow with clamp (in zoomed world units). The player sits a little
    // below centre so there's headroom to see the roofs of buildings ahead.
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    // district banner on entry
    let region = null;
    for (const r of this.regions) if (this.px >= r.x && this.px <= r.x + r.w && this.py >= r.y && this.py <= r.y + r.h) { region = r.name; break; }
    if (region && region !== this.currentDistrict) { this.currentDistrict = region; this.districtBanner = region; this.districtBannerT = 2.4; }
    if (!region) this.currentDistrict = null;

    // nearest interactable
    this.near = null; let best = 1e9;
    for (const loc of this.locations) {
      if (!loc.action) continue;
      const d = Math.hypot(this.px - loc.dx, this.py - loc.dy);
      if (d < 30 && d < best) { best = d; this.near = loc; }
    }

    if (this.near && Input.pressed('interact')) this._enter(this.near);
    if (Input.pressed('inventory')) { Audio.confirm(); this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }); }
  }

  _tryMove(dx, dy) {
    const nx = clamp(this.px + dx, 10, MAP_W - 10);
    const ny = clamp(this.py + dy, 40, MAP_H - 10);
    const box = { x: (dx ? nx : this.px) - 5, y: (dy ? ny : this.py) - 4, w: 10, h: 6 };
    for (const s of this.solids) {
      if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return;
    }
    if (dx) this.px = nx;
    if (dy) this.py = ny;
  }

  _enter(loc) {
    Audio.confirm();
    switch (loc.action) {
      case 'training': this.hero.save(); this.hooks.toTraining(); break;
      case 'weapon': this.overlay = new WeaponShop(this.hero, () => { this.overlay = null; }); break;
      case 'potion': case 'market': this.overlay = new PotionShop(this.hero, () => { this.overlay = null; }); break;
      case 'pets': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 2); break;
      case 'library': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 3); break;
      case 'quest': case 'guild': this._openQuest(loc.action === 'guild'); break;
      case 'dungeon': this._enterGate(); break;
      case 'rest': this._rest(); break;
      case 'house': this.hero.save(); if (this.hooks.toHouse) this.hooks.toHouse(); break;
    }
  }

  _rest() {
    const healed = this.hero.s.hp < this.hero.maxHp || this.hero.s.mana < this.hero.maxMana;
    this.hero.s.hp = this.hero.maxHp; this.hero.s.mana = this.hero.maxMana; this.hero.save();
    this.particles.pickup(560, 400, '#b58bff');
    this.toasts.push(healed ? 'The crystal restores you!' : 'Already at full health', 560, 380, UI.good, { life: 1.6 });
    Audio.levelUp();
  }

  _openQuest(atGuild) {
    const q = this.hero.activeQuest();
    const who = atGuild ? 'Guildmaster' : 'Captain Mara';
    if (q) {
      this.dialogue = { speaker: q.giver, lines: [q.intro, 'Objective: ' + q.objective, 'Rewards: ' + this._rewardText(q) + '. Head to the Dungeon Gate when ready!'], idx: 0 };
    } else if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: who, lines: ['You cleared the goblin camp and felled their King. Embervale is in your debt!', 'Rest, train, and grow stronger — more adventures await.'], idx: 0 };
    } else {
      this.dialogue = { speaker: who, lines: ['No quests right now, hero. Come back soon.'], idx: 0 };
    }
    this.dialogueReveal = 0;
  }

  _rewardText(q) {
    const r = q.reward; const parts = [];
    if (r.gold) parts.push(r.gold + ' gold');
    if (r.xp) parts.push(r.xp + ' XP');
    if (r.item) parts.push('an item');
    if (r.petChance) parts.push('a pet egg');
    return parts.join(', ');
  }

  _enterGate() {
    if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: 'Gate Guard', lines: ['The goblin threat is over. The gate is quiet now — return when new dangers stir.'], idx: 0 };
      this.dialogueReveal = 0; return;
    }
    this.dialogue = {
      speaker: 'Dungeon Gate',
      lines: ['Beyond lies the Goblin Camp and the Goblin King. Ready yourself, hero.'],
      idx: 0,
      onDone: () => { this.hero.save(); this.hooks.toDungeon(); },
    };
    this.dialogueReveal = 0;
  }

  _updateDialogue(dt) {
    this.dialogueReveal = Math.min(1, this.dialogueReveal + dt * 3);
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      if (this.dialogueReveal < 1) { this.dialogueReveal = 1; return; }
      const d = this.dialogue;
      if (d.idx < d.lines.length - 1) { d.idx++; this.dialogueReveal = 0; Audio.select(); }
      else { const done = d.onDone; this.dialogue = null; if (done) done(); else Audio.confirm(); }
    }
    if (Input.pressed('menu')) { this.dialogue = null; Audio.deny(); }
  }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    g.save();
    g.imageSmoothingEnabled = false;
    g.scale(Z, Z);
    g.translate(-Math.round(this.camX), -Math.round(this.camY));
    this._drawGround(g, visW, visH);

    // flat props drawn under entities (still get their own contact shadows)
    for (const pg of this.propGroups) pg.fn(g);

    // depth-sorted entities: lower on screen (larger y) draws in front. Trees
    // and the fountain are entities too, so the player naturally passes behind
    // things north of them and in front of things south of them.
    const ents = [];
    for (const loc of this.locations) ents.push({ y: loc.sortY != null ? loc.sortY : (loc.solid ? loc.solid.y + loc.solid.h : loc.dy), draw: (gg) => this._drawLocation(gg, loc) });
    for (const tr of this.trees) ents.push({ y: tr.y, draw: (gg) => bigTree(gg, tr.x, tr.y, tr.kind === 'pine' ? 'pine' : 'oak', this.t) });
    for (const n of this.npcs) ents.push({ y: n.y, draw: (gg) => { contactShadow(gg, n.x, n.y, 6, 2); drawActor(gg, { x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, weapon: n.sprite === 'warrior' ? 'sword' : (n.sprite === 'mage' ? 'staff' : 'none'), state: 'idle', animTime: this.t + n.x }); } });
    for (const p of this.sanctuaryPets) ents.push({ y: p.y, draw: (gg) => drawPet(gg, p, p.x, p.y, this.t) });
    ents.push({ y: this.py, draw: (gg) => this._drawPlayer(gg) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw(g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);

    this.particles.draw(g);
    this.toasts.draw(g);
    g.restore();

    this._drawHUD(g);

    if (this.overlay) this.overlay.draw(g, this.W, this.H);
    if (this.dialogue) {
      const d = this.dialogue;
      dialogue(g, this.W, this.H, d.speaker, d.lines[d.idx], this.dialogueReveal, {
        prompt: d.idx < d.lines.length - 1 ? 'J: more' : 'J: ok',
      });
    }
  }

  _drawLocation(g, loc) {
    loc.draw(g);
    if (this.near === loc) {
      const label = { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest at Crystal', house: 'Enter Your House' }[loc.action] || 'Enter';
      const w = textWidth('[E] ' + label) + 12;
      panel(g, loc.dx - w / 2, loc.dy + 2, w, 13, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, '[E] ' + label, loc.dx, loc.dy + 5, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }
  }

  _drawPlayer(g) {
    const pet = this.hero.pet();
    if (pet) drawPet(g, pet, this.px - this.facing * 14, this.py - 16, this.t);
    drawCharacter(g, {
      x: this.px, y: this.py, z: 0, facing: this.facing,
      sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(),
      state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t,
    });
  }

  // ---- ground -------------------------------------------------------------

  _drawGround(g, visW, visH) {
    const camX = this.camX, camY = this.camY;
    const x0 = Math.floor(camX / 8) * 8 - 8, x1 = camX + visW + 8;
    const y0 = Math.floor(camY / 8) * 8 - 8, y1 = camY + visH + 8;

    // Organic grass: a soft value-noise base (8px cells, no hard 16px grid) with
    // scattered tufts, tiny flowers, dirt flecks and pebbles. Two base greens are
    // interleaved so no rectangular tile boundaries show.
    rect(g, camX, camY, visW, visH, '#3c7a40');
    for (let y = y0; y < y1; y += 8) {
      for (let x = x0; x < x1; x += 8) {
        const h = hash(x * 1.7 + y * 0.9);
        const h2 = hash(x * 0.3 + y * 2.1);
        // blend value noise as small irregular dabs rather than full cells
        if (h < 0.22) { rect(g, x + (h2 * 4 | 0), y + (h * 5 | 0), 5, 4, '#357338'); }
        if (h2 < 0.20) { rect(g, x + (h * 5 | 0), y + (h2 * 4 | 0), 4, 3, '#45884a'); }
        const r = hash(x * 2.3 + y * 3.1);
        if (r > 0.965) { rect(g, x + 3, y + 4, 1, 3, '#2c6630'); rect(g, x + 5, y + 3, 1, 4, '#2c6630'); }        // tuft
        else if (r > 0.955) { rect(g, x + 4, y + 4, 1, 1, '#e6d24a'); rect(g, x + 3, y + 5, 3, 1, '#e6d24a'); }   // flower
        else if (r > 0.945) { rect(g, x + 4, y + 4, 2, 1, '#5c5040'); }                                            // dirt fleck
        else if (r > 0.938) { rect(g, x + 4, y + 4, 2, 2, '#8a8ea0'); rect(g, x + 4, y + 4, 1, 1, '#a0a4b4'); }    // pebble (lit upper-left)
      }
    }

    // roads: autotiled cobblestone from the authored tileset
    this._drawRoadTiles(g, visW, visH);

    // plaza cobblestone ring (the fountain itself is a depth-sorted entity) —
    // widened so there's real open space around the fountain, not a narrow
    // intersection
    plaza(g, 630, 412, 82);

    this._drawCorruption(g);
    this._stream(g);
    this._pond(g);
  }

  /** Dark, wilted ground ringing the Dungeon Gate, strongest at the entrance. */
  _drawCorruption(g) {
    const gate = { x: 630, y: 720 };
    for (let i = 0; i < 46; i++) {
      const seed = i * 7.13;
      const spread = 130 + hash(seed) * 60;
      const px = gate.x + (hash(seed * 1.7) - 0.5) * spread * 1.6;
      const py = gate.y - 40 + (hash(seed * 2.3) - 0.5) * spread;
      const d = Math.hypot(px - gate.x, (py - gate.y) * 1.3);
      const k = clamp01(1 - d / 170);
      if (k <= 0.05) continue;
      corruptPatch(g, px, py, 8 + hash(seed * 3.1) * 14, k);
    }
  }

  /** Draw the visible road cells, picking each tile from its neighbour mask. */
  _drawRoadTiles(g, visW, visH) {
    const has = (c, r) => this.roadCells.has(`${c},${r}`);
    const c0 = Math.floor(this.camX / ROAD_TILE) - 1, c1 = Math.ceil((this.camX + visW) / ROAD_TILE) + 1;
    const r0 = Math.floor(this.camY / ROAD_TILE) - 1, r1 = Math.ceil((this.camY + visH) / ROAD_TILE) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!has(c, r)) continue;
        const mask = (has(c, r - 1) ? 1 : 0) | (has(c + 1, r) ? 2 : 0) | (has(c, r + 1) ? 4 : 0) | (has(c - 1, r) ? 8 : 0);
        const [name, flip] = ROAD_MASK[mask] || ROAD_MASK[15];
        const img = ROAD_IMGS[name];
        if (!img || !img.complete || !img.naturalWidth) continue;
        const x = c * ROAD_TILE, y = r * ROAD_TILE;
        if (flip) {
          g.save(); g.translate(x + ROAD_TILE, y); g.scale(-1, 1);
          g.drawImage(img, 0, 0, ROAD_TILE, ROAD_TILE); g.restore();
        } else {
          g.drawImage(img, x, y, ROAD_TILE, ROAD_TILE);
        }
      }
    }
  }

  _stream(g) {
    const s = this.stream;
    const inBridge = (y) => y > s.bridgeY && y < s.bridgeY + s.bridgeH;

    // base water: a soft cross-width gradient (darker deep-water edges, a
    // lighter turquoise vein down the middle) plus the existing gentle wobble,
    // so the river reads as more than a flat two-tone band.
    for (let y = s.y0; y < s.y1; y += 1) {
      if (inBridge(y)) continue;
      const wob = Math.sin(y * 0.3 + this.t * 2) * 2;
      const rowShade = y % 6 < 3 ? 0 : 1;
      for (let cx = 0; cx < s.w; cx++) {
        const k = Math.abs(cx - s.w / 2) / (s.w / 2); // 0 center -> 1 edges
        const base = rowShade === 0 ? '#2f5c7a' : '#356588';
        const mid = '#3f7fa0';
        rect(g, s.x + wob + cx, y, 1, 1, k < 0.45 ? mid : base);
      }
    }

    // banks: grass edge, then a thin sand/silt lip right at the waterline
    for (let y = s.y0; y < s.y1; y += 1) {
      if (inBridge(y)) continue;
      const wob = Math.sin(y * 0.3 + this.t * 2) * 2;
      if (y % 3 === 0) {
        rect(g, s.x + wob - 3, y, 3, 1, '#4a6b3a');
        rect(g, s.x + wob + s.w, y, 3, 1, '#4a6b3a');
      }
      rect(g, s.x + wob - 1, y, 1, 1, '#8a7a52');
      rect(g, s.x + wob + s.w, y, 1, 1, '#8a7a52');
    }

    // riverbank decor: rocks + reed clusters at fixed, hash-picked spots so
    // they read as planted detail rather than noise, redrawn cheaply each frame.
    for (let y = s.y0 + 10; y < s.y1 - 10; y += 34) {
      if (inBridge(y)) continue;
      const wob = Math.sin(y * 0.3 + this.t * 2) * 2;
      const hL = hash(y * 0.37);
      const hR = hash(y * 0.53 + 9);
      if (hL < 0.4) drawRock(g, s.x + wob - 6, y, 0.7);
      else if (hL < 0.75) drawReeds(g, s.x + wob - 5, y, y, this.t);
      if (hR < 0.35) drawRock(g, s.x + wob + s.w + 6, y, 0.6);
      else if (hR < 0.7) drawReeds(g, s.x + wob + s.w + 5, y, y + 500, this.t);
    }

    // small in-water rocks near the banks, with a tiny foam ring where the
    // current breaks against them (upstream = north/top edge of each rock).
    for (let y = s.y0 + 26; y < s.y1 - 10; y += 90) {
      if (inBridge(y)) continue;
      const wob = Math.sin(y * 0.3 + this.t * 2) * 2;
      const side = hash(y * 0.19) < 0.5 ? -1 : 1;
      const rx = s.x + wob + s.w / 2 + side * (s.w / 2 - 4);
      disc(g, rx, y, 2, '#6b6f7c');
      disc(g, rx - 1, y - 1, 1, '#868b99');
      const foamA = 0.35 + Math.sin(this.t * 3 + y) * 0.15;
      g.globalAlpha = clamp01(foamA);
      rect(g, rx - 2, y - 3, 4, 1, '#dff3ff');
      g.globalAlpha = 1;
    }

    // flow lines: short white/cyan streaks travelling downstream, staggered
    // so they never move as one solid block.
    for (let i = 0; i < 8; i++) {
      const speed = 34 + (i % 3) * 6;
      const span = s.y1 - s.y0;
      const yy = s.y0 + ((this.t * speed + i * (span / 8)) % span);
      if (inBridge(yy)) continue;
      const wob = Math.sin(yy * 0.3 + this.t * 2) * 2;
      const lx = s.x + wob + 5 + hash(i * 3.1) * (s.w - 10);
      const fade = 0.5 + Math.sin(this.t * 2 + i * 1.7) * 0.5;
      g.globalAlpha = clamp01(0.5 + fade * 0.5);
      rect(g, Math.round(lx), Math.round(yy), 1, 4, '#f2ffff');
      g.globalAlpha = 1;
    }

    // occasional expanding ripple, same crisp scattered-dot technique as the
    // fountain, kept small so it doesn't compete with the flow lines.
    for (let i = 0; i < 2; i++) {
      const period = 3.2 + i * 0.6;
      const loop = Math.floor((this.t + i * 4.4) / period);
      const phase = ((this.t + i * 4.4) % period) / period;
      const yy = s.y0 + hash(i * 6.6 + loop * 2.2) * (s.y1 - s.y0);
      if (inBridge(yy)) continue;
      const wob = Math.sin(yy * 0.3 + this.t * 2) * 2;
      const grow = clamp01(phase / 0.3);
      const fade = 1 - clamp01((phase - 0.5) / 0.5);
      if (fade <= 0.02) continue;
      const r = lerp(1, 3.4, grow);
      pixelRingDots(g, s.x + wob + s.w / 2, yy, r, r * 0.6, `rgba(220,245,255,${(fade * 0.5).toFixed(2)})`);
    }

    // wooden bridge
    bridge(g, s.x - 6, s.bridgeY, s.w + 12, s.bridgeH);
  }

  _pond(g) {
    const { cx, cy, rx, ry } = this.pond;
    for (let yy = -ry; yy <= ry; yy++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry))));
      if (w <= 0) continue;
      rect(g, cx - w, cy + yy, w * 2, 1, yy < -ry * 0.4 ? '#3a6b8a' : '#2f5c7a');
    }
    for (let a = 0; a < Math.PI * 2; a += 0.22) rect(g, Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1, '#6b7a5a');
    for (let i = 0; i < 3; i++) rect(g, Math.round(cx + Math.sin(this.t + i) * rx * 0.5), Math.round(cy + Math.cos(this.t * 1.2 + i) * ry * 0.4), 3, 1, '#7fb0d8');
    // lily pads
    disc(g, cx - rx * 0.4, cy, 3, '#3a7a3e'); disc(g, cx + rx * 0.3, cy + ry * 0.3, 2, '#3a7a3e');
  }

  // ---- HUD + banners ------------------------------------------------------

  _drawHUD(g) {
    // slim plate: class + level, HP, gold
    const pw = 118, ph = 22;
    panel(g, 4, 4, pw, ph, { bg: 'rgba(12,10,22,0.82)' });
    drawText(g, `${this.hero.cls().name}`, 8, 6, { color: UI.ink });
    drawText(g, `Lv ${this.hero.s.level}`, pw - 2, 6, { color: UI.gold, align: 'right' });
    bar(g, 8, 15, this.hero.s.hp, this.hero.maxHp, { w: 74, h: 4, color: '#e0483c' });
    drawIcon(g, 'coin', pw - 26, 13);
    drawText(g, `${this.hero.s.gold}`, pw - 16, 14, { color: UI.gold });

    // transient district banner (top-center, fades)
    if (this.districtBannerT > 0 && this.districtBanner) {
      const a = clamp01(Math.min(1, this.districtBannerT * 1.5) * Math.min(1, (this.districtBannerT) * 2));
      g.globalAlpha = a;
      const w = textWidth(this.districtBanner, 2) + 24;
      const bx = this.W / 2 - w / 2;
      rect(g, bx, 12, w, 18, 'rgba(12,10,22,0.7)');
      rect(g, bx, 12, w, 1, UI.gold); rect(g, bx, 29, w, 1, UI.gold);
      drawText(g, this.districtBanner.toUpperCase(), this.W / 2, 15, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' });
      g.globalAlpha = 1;
    }

    // one-time control hint on load, then gone
    if (this.introHintT > 0) {
      g.globalAlpha = clamp01(Math.min(1, this.introHintT));
      drawText(g, 'WASD move   E interact   I inventory', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });
      g.globalAlpha = 1;
    }
  }
}

// ============================================================ shared drawers

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
  const w = 80, h = 50;
  shadow(g, cx, baseY, w * 0.55, 6, 0.32);
  const x = Math.round(cx - w / 2), y = Math.round(baseY - h);
  rect(g, x, y, w, h, '#8a8ea0');
  for (let ry = 0; ry < h; ry += 6) rect(g, x, y + ry, w, 1, '#767a8c');
  for (let rx = 0; rx < w; rx += 10) rect(g, x + ((rx / 10) % 2) * 5, y, 1, h, '#767a8c');
  rect(g, x - 1, baseY - 6, w + 2, 6, '#6b6f80');
  rectOutline(g, x, y, w, h, '#3a3e4a');
  pitchedRoof(g, cx, y - 18, w, 20, '#5a6178', '#42485a', '#2a2e38', 7);
  // grand arched windows
  for (const wx of [cx - 24, cx, cx + 24]) {
    rect(g, wx - 5, baseY - 30, 10, 24, '#2e2350');
    disc(g, wx, baseY - 30, 5, '#2e2350');
    rect(g, wx - 4, baseY - 28, 8, 22, '#6b4fb0');
    rect(g, wx - 1, baseY - 28, 2, 22, '#b8a8ff');
    rectOutline(g, wx - 5, baseY - 30, 10, 30, '#2a1e14');
  }
  // steps + columns + door
  rect(g, cx - 20, baseY, 40, 3, '#9a9eb0'); rect(g, cx - 24, baseY + 3, 48, 3, '#8a8ea0');
  door(g, cx, baseY, 15, 22, '#3a2b1a');
  // purple magical emblem above the door
  disc(g, cx, y - 4, 5, '#4a37a0'); disc(g, cx, y - 4, 3, '#9d8bff'); rect(g, cx - 1, y - 7, 2, 6, '#c9bcff');
  // banner
  rect(g, cx - w / 2 + 3, y + 4, 5, 20, '#4a37a0'); drawIcon(g, 'book', cx - w / 2 + 1, y + 8);
}

// The Weapon Shop & Blacksmith — rendered from the authored transparent PNG
// (forge, anvil, weapon rack and sign already in the art).
function drawBlacksmith(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, BLACKSMITH_W * 0.42, 6, 0.32);
  if (!BLACKSMITH_ART.ready) return;
  g.drawImage(BLACKSMITH_ART.img, Math.round(cx - BLACKSMITH_W / 2), Math.round(baseY - BLACKSMITH_H), BLACKSMITH_W, BLACKSMITH_H);
}

// The Potion Shop — rendered directly from the authored transparent PNG (real
// alpha, no baked background). Anchored bottom-centre at the shop's ground
// position with a subtle contact shadow. Nearest-neighbor, no smoothing.
function drawPotionShop(g, cx, baseY, t) {
  // subtle ground/contact shadow (light from upper-left -> shadow lower-right)
  contactShadow(g, cx, baseY, POTION_W * 0.42, 6, 0.30);
  if (!POTION_READY) return; // image not loaded yet this frame
  g.drawImage(POTION_IMG, Math.round(cx - POTION_W / 2), Math.round(baseY - POTION_H), POTION_W, POTION_H);
}

// The Crystal Plaza fountain — rendered from the authored transparent PNG.
// Anchored bottom-centre on the plaza with only a very subtle contact shadow
// beneath the stone base (the crystal glow/sparkles are separate particles).
function drawFountainSprite(g, cx, baseY, t) {
  contactShadow(g, cx, baseY, FOUNTAIN_W * 0.30, 3, 0.22); // tiny, base-only
  if (!FOUNTAIN_READY) return;
  g.drawImage(FOUNTAIN_IMG, Math.round(cx - FOUNTAIN_W / 2), Math.round(baseY - FOUNTAIN_H), FOUNTAIN_W, FOUNTAIN_H);
  drawFountainFX(g, cx, baseY, t);
}

// ---- Crystal Fountain animation overlay ------------------------------
// Pure-t procedural FX layered on top of the static fountain PNG — never
// touches the artwork, collision, Y-sort, or interaction. Basin/crystal
// geometry below is measured from the source art (127x86 px, drawn at
// FOUNTAIN_W x FOUNTAIN_H) and expressed as offsets from (cx, baseY).
const FX_BASIN = { cx: 0, cy: -24, rx: 26, ry: 12 };   // water ellipse

// Pixel-exact water mask sampled from the fountain art itself, so ripple and
// shimmer dots can only ever land on real water pixels — never on the stone
// arms, pedestal, rim, or crystal that sit inside the basin's bounding ellipse.
let FOUNTAIN_MASK = null, FOUNTAIN_MASK_W = 0, FOUNTAIN_MASK_H = 0;
function buildFountainMask() {
  if (FOUNTAIN_MASK || !FOUNTAIN_READY) return;
  const c = document.createElement('canvas');
  FOUNTAIN_MASK_W = FOUNTAIN_IMG.naturalWidth;
  FOUNTAIN_MASK_H = FOUNTAIN_IMG.naturalHeight;
  c.width = FOUNTAIN_MASK_W; c.height = FOUNTAIN_MASK_H;
  const mg = c.getContext('2d');
  mg.drawImage(FOUNTAIN_IMG, 0, 0);
  const d = mg.getImageData(0, 0, FOUNTAIN_MASK_W, FOUNTAIN_MASK_H).data;
  FOUNTAIN_MASK = new Uint8Array(FOUNTAIN_MASK_W * FOUNTAIN_MASK_H);
  for (let i = 0; i < FOUNTAIN_MASK.length; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
    if (a > 120 && b > 170 && gr > 140 && b > r && r < 170) FOUNTAIN_MASK[i] = 1;
  }
}
// dx/dy are world-unit offsets from the fountain anchor (cx, baseY).
function fountainWaterAt(dx, dy) {
  if (!FOUNTAIN_MASK) return false;
  const sx = Math.round((dx + FOUNTAIN_W / 2) * (FOUNTAIN_MASK_W / FOUNTAIN_W));
  const sy = Math.round((dy + FOUNTAIN_H) * (FOUNTAIN_MASK_H / FOUNTAIN_H));
  if (sx < 0 || sy < 0 || sx >= FOUNTAIN_MASK_W || sy >= FOUNTAIN_MASK_H) return false;
  return FOUNTAIN_MASK[sy * FOUNTAIN_MASK_W + sx] === 1;
}
const FX_CRYSTAL = { cx: 0, cy: -38, rx: 9, ry: 14 };  // main crystal silhouette
// The art's real water channels: two cascades sheet down from under the
// crystal platform, hugging the sides of the front pedestal, then spread
// into the pool. Measured from the source art and scaled to world units.
const FX_FALLS = [
  { xTop: -11.5, xBot: -13.5, yTop: -28, yBot: -20.5 }, // left cascade
  { xTop: 11.5, xBot: 13.5, yTop: -28, yBot: -20.5 },   // right cascade
];
const FX_RUNE_ARC = { cx: 0, cy: -14, rx: 13, y: -14, count: 6 }; // pedestal rune row

function drawFountainFX(g, cx, baseY, t) {
  buildFountainMask();
  g.save();
  fxRipples(g, cx, baseY, t);
  fxStreams(g, cx, baseY, t);
  fxHighlights(g, cx, baseY, t);
  fxRunes(g, cx, baseY, t);
  fxCrystalPulse(g, cx, baseY, t);
  fxMotes(g, cx, baseY, t);
  g.restore();
}

// 1. Water ripples: small -> expand -> fade, staggered, looping. Spawn points
// are rejection-sampled against the water mask (a few hash-salted tries per
// loop), and each ring dot is masked too, so nothing ever lands on stone.
function fxRipples(g, cx, baseY, t) {
  const N = 4;
  const mask = (x, y) => fountainWaterAt(x - cx, y - baseY);
  for (let i = 0; i < N; i++) {
    const period = 2.4 + i * 0.31;
    const loop = Math.floor((t + i * 5.1) / period);
    const phase = ((t + i * 5.1) % period) / period; // 0..1
    let px = 0, py = 0, found = false;
    for (let tries = 0; tries < 4 && !found; tries++) {
      const seedA = hash(i * 11.7 + loop * 3.3 + tries * 17.9);
      const seedB = hash(i * 7.1 + loop * 9.9 + 1 + tries * 13.3);
      px = FX_BASIN.cx + (seedA * 2 - 1) * (FX_BASIN.rx - 4);
      py = FX_BASIN.cy + (seedB * 2 - 1) * (FX_BASIN.ry - 2);
      found = fountainWaterAt(px, py);
    }
    if (!found) continue;
    const grow = clamp01(phase / 0.35);           // small -> expand
    const fade = 1 - clamp01((phase - 0.5) / 0.5); // hold -> fade
    if (fade <= 0.02) continue;
    const r = lerp(1, 4.2, grow);
    pixelRingDots(g, cx + px, baseY + py, r, r * 0.55, 'rgba(200,240,255,' + (fade * 0.55).toFixed(2) + ')', mask);
  }
}

// 2. Water flow: the art already paints the cascades and swirl texture, so
// instead of overlaying foreign pixel trails (which read as drips at this
// tiny scale), animate the painted water itself — soft brightness wavefronts
// that well up at the pedestal and travel outward to the rim, exactly how a
// fountain pool actually moves. Every dot is clipped to the water mask, so
// the waves wrap around the stone arms on their own.
function fxStreams(g, cx, baseY, t) {
  const WAVES = 3, period = 2.4;
  for (let w = 0; w < WAVES; w++) {
    const phase = ((t / period + w / WAVES) % 1); // 0 center -> 1 rim
    const s = lerp(0.3, 1.0, phase);              // wavefront scale
    const a = Math.sin(phase * Math.PI) * 0.3;    // swell in, fade at rim
    if (a <= 0.02) continue;
    const rx = FX_BASIN.rx * s, ry = FX_BASIN.ry * s;
    const DOTS = 22;
    for (let i = 0; i < DOTS; i++) {
      const ang = (i / DOTS) * Math.PI * 2 + w * 0.3; // slight per-wave twist
      const px = FX_BASIN.cx + Math.cos(ang) * rx;
      const py = FX_BASIN.cy + Math.sin(ang) * ry;
      if (!fountainWaterAt(px, py)) continue;
      // two-pixel crest: bright leading dot + soft cyan trailing dot
      g.globalAlpha = a;
      rect(g, Math.round(cx + px), Math.round(baseY + py), 1, 1, '#e8fbff');
      g.globalAlpha = a * 0.5;
      rect(g, Math.round(cx + px - Math.cos(ang)), Math.round(baseY + py - Math.sin(ang) * 0.6), 1, 1, '#9fdcf2');
      g.globalAlpha = 1;
    }
  }
  // churn where the painted cascades meet the pool (the art shows foam right
  // at the pedestal's sides) — a gentle blink, clipped to water.
  for (let f = 0; f < FX_FALLS.length; f++) {
    const fall = FX_FALLS[f];
    const lx = Math.round(cx + fall.xBot);
    const ly = Math.round(baseY + fall.yBot + 1);
    for (let p = 0; p < 3; p++) {
      const wob = Math.sin(t * 6 + p * 2.1 + f * 3);
      const a = 0.25 + Math.abs(Math.sin(t * 4 + p * 1.7 + f)) * 0.35;
      const fx2 = lx - 2 + p * 2 + Math.round(wob), fy2 = ly + (p % 2);
      if (!fountainWaterAt(fx2 - cx, fy2 - baseY)) continue;
      g.globalAlpha = a;
      rect(g, fx2, fy2, 1, 1, p === 1 ? '#ffffff' : '#d4f6ff');
      g.globalAlpha = 1;
    }
  }
}

// 3. Water highlights: tiny shimmer points that appear, drift 1-3px, fade.
function fxHighlights(g, cx, baseY, t) {
  const N = 5;
  for (let i = 0; i < N; i++) {
    const period = 1.8 + i * 0.23;
    const loop = Math.floor((t + i * 3.7) / period);
    const phase = ((t + i * 3.7) % period) / period;
    if (phase > 0.6) continue; // shimmer, don't sparkle constantly
    const seedA = hash(i * 5.3 + loop * 4.1 + 2);
    const seedB = hash(i * 9.7 + loop * 2.7 + 3);
    const px = FX_BASIN.cx + (seedA * 2 - 1) * (FX_BASIN.rx - 5);
    const py = FX_BASIN.cy + (seedB * 2 - 1) * (FX_BASIN.ry - 3);
    const k = phase / 0.6;
    const alpha = Math.sin(k * Math.PI) * 0.8;
    const drift = k * 2;
    if (!fountainWaterAt(px + drift, py)) continue; // water only, never stone
    rect(g, Math.round(cx + px + drift), Math.round(baseY + py), 1, 1, `rgba(255,255,255,${alpha.toFixed(2)})`);
  }
}

// 6. Runes: individual pedestal glyphs brighten/dim slightly out of phase.
function fxRunes(g, cx, baseY, t) {
  const { cx: rcx, y, rx, count } = FX_RUNE_ARC;
  for (let i = 0; i < count; i++) {
    const k = i / (count - 1);
    const px = rcx + (k - 0.5) * 2 * rx;
    const py = y - Math.sin(k * Math.PI) * 2; // follow the curved ledge
    const glow = 0.5 + Math.sin(t * 1.3 + i * 1.9) * 0.5; // 0..1, desynced
    g.globalAlpha = 0.12 + glow * 0.22;
    rect(g, Math.round(cx + px), Math.round(baseY + py), 1, 1, '#8fe8ff');
    g.globalAlpha = 1;
  }
}

// 4. Crystal pulse: additive glow only — no scale, no move, no blur.
function fxCrystalPulse(g, cx, baseY, t) {
  const pulse = (Math.sin(t * (2 * Math.PI / 2.6)) * 0.5 + 0.5); // 0..1, ~2.6s loop
  const alpha = 0.06 + pulse * 0.09; // subtle: reads as ~100%->115% brightness
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  disc(g, cx + FX_CRYSTAL.cx, baseY + FX_CRYSTAL.cy, FX_CRYSTAL.rx, '#bfeaff');
  g.globalAlpha = alpha * 0.7;
  disc(g, cx + FX_CRYSTAL.cx, baseY + FX_CRYSTAL.cy - 4, FX_CRYSTAL.rx * 0.6, '#ffffff');
  g.restore();
}

// 5. Magic motes: replaces the old plain purple squares. Each mote rises out
// of the crystal on a gentle sine sway, fades in/out smoothly, and flashes a
// tiny 4-arm glint at its brightest moment. Colors alternate cyan/violet per
// loop (hash-picked), and phases are staggered so they never move as a group.
const MOTE_COLORS = [
  { core: '#aef4ff', glint: '#e8fdff' },  // cyan
  { core: '#c9a0ff', glint: '#efe0ff' },  // violet
  { core: '#8fb8ff', glint: '#dceaff' },  // blue
];
function fxMotes(g, cx, baseY, t) {
  const N = 5;
  for (let i = 0; i < N; i++) {
    const period = 2.6 + i * 0.37;
    const loop = Math.floor((t + i * 2.9) / period);
    const phase = ((t + i * 2.9) % period) / period; // 0..1 birth -> death
    const seedX = hash(i * 8.3 + loop * 5.7);
    const seedC = hash(i * 4.9 + loop * 7.3 + 2);
    const col = MOTE_COLORS[Math.floor(seedC * MOTE_COLORS.length)];
    const x0 = (seedX * 2 - 1) * 8;                    // spawn spread across crystal
    const rise = phase * 16;                            // total climb in px
    const sway = Math.sin(phase * Math.PI * 3 + i * 1.3) * 2.2;
    const px = cx + x0 + sway;
    const py = baseY - 34 - rise;
    const a = Math.sin(phase * Math.PI);                // smooth in -> peak -> out
    if (a <= 0.03) continue;
    g.globalAlpha = a * 0.9;
    rect(g, Math.round(px), Math.round(py), 1, 1, col.core);
    // glint: brief 4-arm sparkle near peak brightness
    if (a > 0.82) {
      g.globalAlpha = (a - 0.82) / 0.18 * 0.8;
      rect(g, Math.round(px) - 1, Math.round(py), 1, 1, col.glint);
      rect(g, Math.round(px) + 1, Math.round(py), 1, 1, col.glint);
      rect(g, Math.round(px), Math.round(py) - 1, 1, 1, col.glint);
      rect(g, Math.round(px), Math.round(py) + 1, 1, 1, col.glint);
    }
    g.globalAlpha = 1;
  }
}

// Crisp scattered-dot "ring" — reads as a ripple crest without a true stroke.
function pixelRingDots(g, cx, cy, rx, ry, color, maskFn = null) {
  const DOTS = 8;
  for (let i = 0; i < DOTS; i++) {
    const a = (i / DOTS) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    if (maskFn && !maskFn(x, y)) continue; // e.g. keep fountain dots off the stone
    rect(g, Math.round(x), Math.round(y), 1, 1, color);
  }
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
}

function drawTrainingGround(g, cx, cy, t) {
  // a big fenced district: sparring ring, dummies, targets, racks, banners, crystal
  const w = 150, h = 120;
  const x = cx - w / 2, y = cy - h / 2;
  rect(g, x, y, w, h, '#8a6f4a');
  for (let rx = 4; rx < w; rx += 12) for (let ry = 6; ry < h; ry += 12) rect(g, x + rx, y + ry, 2, 1, '#7a6040');
  // fence
  for (let fx = x; fx <= x + w; fx += 9) { rect(g, fx, y - 3, 1, 7, '#6b4a2e'); rect(g, fx, y + h - 3, 1, 7, '#6b4a2e'); }
  for (let fy = y; fy <= y + h; fy += 9) { rect(g, x, fy, 7, 1, '#6b4a2e'); rect(g, x + w - 6, fy, 7, 1, '#6b4a2e'); }
  rect(g, x, y - 1, w, 1, '#7a5530'); rect(g, x, y + h, w, 1, '#7a5530');
  // sparring ring (sand circle)
  for (let yy = -18; yy <= 18; yy++) { const rw = Math.floor(20 * Math.sqrt(Math.max(0, 1 - (yy * yy) / 324))); rect(g, cx - rw, cy + 4 + yy, rw * 2, 1, '#a8905c'); }
  disc(g, cx, cy + 4, 18, '#9a835040'.slice(0, 7)); rectOutline(g, cx - 18, cy - 14, 36, 36, '#7a6040');
  // archery targets along the top
  for (const tx of [x + 20, x + 40, x + 60]) { disc(g, tx, y + 14, 6, '#e8e2c8'); disc(g, tx, y + 14, 4, '#e05a5a'); disc(g, tx, y + 14, 2, '#e8e2c8'); }
  // dummies
  drawDummy(g, x + 108, y + 26, t); drawDummy(g, x + 128, y + 30, t + 1.1);
  drawDummy(g, x + 30, cy + 30, t + 0.6);
  // weapon racks
  weaponRack(g, x + 14, y + h - 12); weaponRack(g, x + w - 22, y + h - 12);
  // magical training crystal
  const crx = x + w - 26, cry = y + 30;
  g.globalAlpha = 0.3 + Math.sin(t * 3) * 0.1; disc(g, crx, cry, 7, '#9fd6ff'); g.globalAlpha = 1;
  rect(g, crx - 1, cry - 7, 2, 14, '#bfe6ff'); rect(g, crx - 3, cry - 2, 6, 5, '#8fc6ef');
  // banners on the fence
  banner(g, x + 6, y + 6, '#3a5cc0'); banner(g, x + w - 8, y + 6, '#c0463c');
  // benches
  bench(g, cx - 30, cy + 40); bench(g, cx + 20, cy + 40);
}

function drawMarket(g, cx, cy, t) {
  // compact lively market: 5 stalls with colourful awnings, well, cart, produce
  const colors = ['#c0463c', '#3f7a5c', '#c99a2f', '#5c6a8a', '#8a4a8a'];
  const startX = cx - 84;
  for (let i = 0; i < 5; i++) {
    const sx = startX + i * 42;
    const sy = cy + (i % 2) * 8;
    rect(g, sx - 16, sy - 6, 32, 6, '#6b4a2e');            // counter
    awning(g, sx, sy - 26, 36, colors[i]);
    rect(g, sx - 18, sy - 26, 2, 24, '#5a3a24'); rect(g, sx + 16, sy - 26, 2, 24, '#5a3a24');
    // goods
    drawIcon(g, ['potionRed', 'coin', 'book', 'potionRed', 'coin'][i], sx - 12, sy - 12);
    drawIcon(g, ['coin', 'potionRed', 'coin', 'book', 'potionRed'][i], sx + 2, sy - 12);
  }
  // well centrepiece
  const wx = cx, wy = cy + 26;
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

// Cobblestone road styled after the Asset Kit: rounded, beveled stones set in
// warm mortar, an offset (brick-like) layout, with lit top-left and shaded
// bottom-right faces per stone, occasional mossy stones, and grass creeping in
// along the edges.
function roadSeg(g, x, y, w, h) {
  rect(g, x, y, w, h, '#5c5346');                 // dark mortar base
  rect(g, x, y, w, 1, '#6b6153');                 // mortar top light
  const SW = 7, SH = 5;                           // stone cell
  for (let ry = 1; ry < h - 1; ry += SH) {
    const off = ((ry / SH | 0) % 2) * Math.floor(SW / 2);
    for (let rx = 1; rx < w - 1; rx += SW) {
      const sx = x + rx + (off % SW), sy = y + ry;
      if (sx + SW - 1 > x + w) continue;
      const hh = hash((sx) * 1.3 + (sy) * 0.7);
      if (hh > 0.94) continue;                     // rare missing stone -> mortar
      const moss = hh > 0.86;
      const base = moss ? '#6f7a54' : (hh < 0.33 ? '#b4a888' : hh < 0.66 ? '#a99d80' : '#9a8f74');
      const lite = moss ? '#8a9668' : '#c8bc9e';
      const dark = moss ? '#566040' : '#7c7058';
      const sw = SW - 2, sh = SH - 1;
      // rounded stone body (clip the 4 corners)
      rect(g, sx + 1, sy, sw - 2, sh, base);
      rect(g, sx, sy + 1, sw, sh - 2, base);
      rect(g, sx + 1, sy, sw - 2, 1, lite);        // top-left highlight
      rect(g, sx, sy + 1, 1, sh - 2, lite);
      rect(g, sx + 1, sy + sh - 1, sw - 2, 1, dark); // bottom-right shade
      rect(g, sx + sw - 1, sy + 1, 1, sh - 2, dark);
    }
  }
  // grass creeping over the edges
  for (let i = 0; i < w; i += 3) {
    if (hash((x + i) * 2.1) > 0.6) { rect(g, x + i, y - 1, 2, 1, '#357338'); rect(g, x + i, y, 1, 1, '#2c6630'); }
    if (hash((x + i) * 1.4 + 9) > 0.6) rect(g, x + i, y + h - 1, 2, 1, '#2c6630');
  }
}

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

// ---------------------------------------------------------------- corruption
// A dark, wilted biome ringing the Dungeon Gate: cracked purple-black ground,
// bare dead trees and jagged stone, strongest right at the entrance and
// fading out as the intensity term drops toward 0.

function corruptPatch(g, x, y, r, k) {
  const a = Math.min(0.55, 0.18 + k * 0.4);
  fillEllipse(g, x, y, r, r * 0.5, `rgba(30,14,26,${a})`);
  fillEllipse(g, x, y, r * 0.55, r * 0.28, `rgba(58,20,52,${a * 0.7})`);
  if (k > 0.5) { rect(g, x - 1, y - 1, 2, 2, '#1a0a16'); rect(g, x + 3, y + 1, 1, 2, '#1a0a16'); } // cracks
}

function deadTree(g, x, y, t) {
  x = Math.round(x); y = Math.round(y);
  contactShadow(g, x, y, 8, 3, 0.4);
  rect(g, x - 1, y - 16, 3, 16, '#241a20');
  rect(g, x - 1, y - 16, 1, 16, '#382830');
  const branch = (bx, by, dx, dy, len) => { for (let i = 0; i < len; i++) rect(g, Math.round(bx + dx * i), Math.round(by + dy * i), 1, 1, '#241a20'); };
  branch(x, y - 13, 1, -0.7, 6); branch(x, y - 10, -1, -0.8, 5); branch(x - 1, y - 15, -1, -0.5, 4);
  if (Math.sin(t * 0.8 + x) > 0.6) rect(g, x + 4, y - 18, 1, 1, '#9d6bff'); // rare corrupted glow spore
}

function corruptedRock(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  contactShadow(g, x, y, 7, 2, 0.4);
  rect(g, x - 6, y - 3, 12, 4, '#3a3038'); rect(g, x - 5, y - 7, 5, 5, '#3a3038'); rect(g, x - 1, y - 9, 5, 6, '#453a44');
  rect(g, x - 5, y - 7, 2, 2, '#5c4a5c'); rect(g, x + 1, y - 9, 2, 2, '#5c4a5c');
  rect(g, x - 2, y - 4, 1, 1, '#8a5cd0'); // faint purple vein
}

function plaza(g, cx, cy, r) {
  for (let yy = -r; yy <= r; yy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, r * r - yy * yy)));
    if (w <= 0) continue;
    rect(g, cx - w, cy + yy, w * 2, 1, yy < 0 ? '#b4aa90' : '#a89e84');
  }
  // concentric cobble rings
  for (let rr = 16; rr < r; rr += 14) for (let a = 0; a < Math.PI * 2; a += 0.32) rect(g, Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 2, 2, '#9a8f78');
  // outer stone edge
  for (let a = 0; a < Math.PI * 2; a += 0.12) rect(g, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 2, 2, '#847a64');
}

// A raised, tiered fountain with visible stone height (front faces), an animated
// water basin and a floating faceted crystal. Drawn from the base upward so it
// reads as a solid volume; as a depth-sorted entity the player passes behind it
// from the north and in front from the south.
function fountainCrystal(g, cx, cy, t) {
  const baseY = cy + 6; // bottom of the structure
  contactShadow(g, cx, baseY, 28, 6, 0.36);
  // tier 1 (widest) — top slab + front face + edge
  stoneTier(g, cx, baseY, 26, 9, 7);
  // tier 2
  stoneTier(g, cx, baseY - 8, 18, 6, 6);
  // water basin on top of tier 2
  fillEllipse(g, cx, baseY - 15, 13, 4, '#356f96');
  fillEllipse(g, cx, baseY - 16, 12, 3.4, '#4f92bd');
  fillEllipse(g, cx, baseY - 17, 10, 2.6, '#77b8dc');
  for (let i = 0; i < 4; i++) rect(g, Math.round(cx + Math.sin(t * 2 + i * 1.6) * 8), Math.round(baseY - 16 + Math.cos(t + i) * 2), 3, 1, '#bfe6ff'); // shimmer
  // stone pillar in the middle
  rect(g, cx - 3, baseY - 26, 6, 11, '#9a9080'); rect(g, cx - 3, baseY - 26, 2, 11, '#b4aa90'); rect(g, cx + 1, baseY - 26, 2, 11, '#7c7258');
  // floating crystal
  const bob = Math.sin(t * 2) * 2, ccy = baseY - 42 + bob;
  g.globalAlpha = 0.26 + Math.sin(t * 3) * 0.1; disc(g, cx, ccy, 13, '#9d6bff'); g.globalAlpha = 1;
  // reflection in the basin (faint, below)
  g.globalAlpha = 0.22; crystalShape(g, cx, baseY - 15, 0.7, true); g.globalAlpha = 1;
  crystalShape(g, cx, ccy, 1, false);
  // orbiting fragments
  for (let i = 0; i < 3; i++) { const a = t * 1.1 + i * 2.1; rect(g, Math.round(cx + Math.cos(a) * 17), Math.round(ccy + Math.sin(a) * 6), 2, 3, '#b58bff'); }
  // water droplets falling from the crystal
  for (let i = 0; i < 4; i++) { const a = t * 2 + i * 1.6; rect(g, Math.round(cx + Math.cos(a) * 11), Math.round(baseY - 20 - Math.abs(Math.sin(a)) * 8), 1, 2, '#bfe6ff'); }
}

function stoneTier(g, cx, topY, rx, ry, faceH) {
  // front face (a band under the top ellipse) — darker, with lit top edge
  rect(g, cx - rx, topY - ry, rx * 2, faceH, '#8a8068');
  rect(g, cx - rx, topY - ry, rx * 2, 1, '#a89c82');
  rect(g, cx - rx, topY - ry + faceH - 1, rx * 2, 1, '#6f6656');
  // vertical seams on the face
  for (let sx = cx - rx + 4; sx < cx + rx; sx += 8) rect(g, sx, topY - ry, 1, faceH, '#7c7258');
  // top slab ellipse (lit)
  fillEllipse(g, cx, topY - ry, rx, ry, '#b4aa90');
  fillEllipse(g, cx, topY - ry - 1, rx - 2, ry - 1, '#c2b89a');
  fillEllipse(g, cx, topY - ry + 1, rx - 1, ry - 1, '#a89c82'); // lower-right shade
}

function crystalShape(g, cx, ccy, s = 1, flat = false) {
  const H = Math.round(14 * s), W = Math.round(5 * s);
  // body
  rect(g, cx - W, ccy - H / 2, W * 2, H, '#a06fe0');
  // facets: left lit, right shaded
  rect(g, cx - W, ccy - H / 2, W, H, '#c9a0ff');
  rect(g, cx + 1, ccy - H / 2 + 2, W - 1, H - 2, '#7c4fc0');
  // top point
  rect(g, cx - 1, ccy - H / 2 - 3, 2, 4, '#c9a0ff');
  // bright core highlight (upper-left)
  if (!flat) { rect(g, cx - 2, ccy - H / 2 + 1, 1, H - 3, '#eadcff'); rect(g, cx - 2, ccy - H / 2 + 1, 2, 2, '#ffffff'); }
}

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

function fillEllipse(g, cx, cy, rx, ry, color) {
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

// stable pseudo-random for ground tiles / placement
function hash(x) { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); }
function rand2(a, b) { return a + Math.random() * (b - a); }
