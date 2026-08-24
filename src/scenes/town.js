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
import { hash, rand2, fillEllipse, loadBuildingArt, contactShadow, drawPropArt } from './town/primitives.js';
import {
  COTTAGE_ART, COTTAGE_H, COTTAGE_W, DUNGEON_ART, DUNGEON_H, DUNGEON_W, HOUSE_H, HOUSE_W,
  SANCTUARY_ART, SANCTUARY_H, SANCTUARY_W, WATCH_ART, WATCH_H, WATCH_W,
  drawBlacksmith, drawLibrary, drawMarker, drawMarket, drawPlayerHouse, drawPotionShop,
  drawQuestBoard, drawSignpost, drawTavern, drawTrainingGround,
} from './town/buildings.js';
import { FOUNTAIN_H, FOUNTAIN_W, MOTE_COLORS, drawFountainSprite } from './town/fountain.js';
import {
  DECOR_ART,
  drawButterfly, crystalGlow, lamp, brazier, fenceRun, bigTree,
} from './town/props.js';
import { MAP_W, MAP_H, ZOOM } from './town/dimensions.js';
import { buildTown } from './town/layout.js';
import { drawGround, buildFlare } from './town/ground.js';
import { POND_W, POND_H, POND_WATER_RECTS } from './town/lake.js';
import { drawNight } from './town/lighting.js';
import { ROAD_TILE, GRASS_TILES, GRASS_TILE, PLAZA_TILES } from './town/tiles.js';
import { ROAD_CELL, buildRoadCoverage, drawRoads, roadPath, strokeRoundedPath } from './town/roads.js';

// Master Town Layout v5 (final spacing polish — coordinates LOCKED once
// approved): a landscape settlement around Crystal Plaza with a compressed
// adventure branch north to the Runebound Gate. Sized from walk times
// (player speed 100 units/s -> 100 units = 1 second): fountain->gate is
// ~2370 units (~24s), and the adventure route's remaining length is meant
// to read through environment (forest/ruins/fortifications later), not
// empty grass. Perimeter margins stay wilderness/expansion space.
export class TownScene {
  constructor(hero, hooks) {
    this.hero = hero;
    this.hooks = hooks; // { toTraining, toDungeon, toHouse, toPotionShop, toWeaponShop }
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

    this.facing = 1; this.moving = false; this.walkT = 0;
    this.camX = 0; this.camY = 0;

    this.currentDistrict = null;
    this.districtBanner = null; this.districtBannerT = 0;
    this.introHintT = 4.5; // brief control hint, then it fades for good

    buildTown(this);
    // player starts just south of the plaza (the world origin)
    this.px = this.plazaCenter.x; this.py = this.plazaCenter.y + 60;
    this.near = null;
  }

  // ---- town definition ----------------------------------------------------

  // ---- Step 24: temporary development overview ----------------------------
  // Toggled from the console via `window.__townDebug = true` (paired with a
  // small `window.__townZoom` for whole-map screenshots). Draws the planned
  // road centerlines and district tags scaled to stay readable at any zoom.
  _drawDebugOverview(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const p of this.roadPlan) {
      g.strokeStyle = p.kind === 'adventure' ? 'rgba(226,124,60,0.85)'
        : p.kind === 'main' ? 'rgba(255,240,170,0.85)' : 'rgba(205,225,140,0.6)';
      g.lineWidth = Math.max(p.width * 0.3, 2 / Z);
      strokeRoundedPath(g, p.pts, 70);
    }
    const s = Math.max(2, Math.round(1.3 / Z));
    for (const [name, x, y] of this.debugLabels) {
      const w = textWidth(name, s) + 8 * s;
      rect(g, x - w / 2, y - 5 * s, w, 10 * s, 'rgba(10,8,20,0.75)');
      drawText(g, name, x, y - 3 * s, { color: '#ffd97a', align: 'center', scale: s });
    }
  }

  /** True if (x,y) sits inside (or near) any location's solid footprint. */
  _nearAnyDistrict(x, y, pad) {
    for (const l of this.locations) {
      if (!l.solid) continue;
      const s = l.solid;
      if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
    }
    return false;
  }

  /** True if (x,y) sits within `pad` of any road rect (keeps trees off roads). */
  _nearAnyRoad(x, y, pad) {
    for (const r of this.roads) {
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    }
    return false;
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
      case 'weapon': this.hero.save(); if (this.hooks.toWeaponShop) this.hooks.toWeaponShop(); break;
      case 'potion': this.hero.save(); if (this.hooks.toPotionShop) this.hooks.toPotionShop(); break;
      case 'market': this.overlay = new PotionShop(this.hero, () => { this.overlay = null; }); break;
      case 'pets': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 2); break;
      case 'library': this.hero.save(); if (this.hooks.toLibrary) this.hooks.toLibrary(); break;
      case 'quest': case 'guild': this._openQuest(loc.action === 'guild'); break;
      case 'dungeon': this._enterGate(); break;
      case 'rest': this._rest(); break;
      case 'house': this.hero.save(); if (this.hooks.toHouse) this.hooks.toHouse(); break;
    }
  }

  _rest() {
    const healed = this.hero.s.hp < this.hero.maxHp || this.hero.s.mana < this.hero.maxMana;
    this.hero.s.hp = this.hero.maxHp; this.hero.s.mana = this.hero.maxMana; this.hero.save();
    this.particles.pickup(this.px, this.py - 12, '#b58bff');
    this.toasts.push(healed ? 'The crystal restores you!' : 'Already at full health', this.px, this.py - 32, UI.good, { life: 1.6 });
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

    // The transform the scene was handed, before its own camera scale/translate.
    // The night pass composites in this space (same one the HUD draws in), so a
    // screen-sized buffer lands 1:1 on the frame whatever the camera zoom is.
    this._baseTf = g.getTransform ? g.getTransform() : null;

    g.save();
    g.imageSmoothingEnabled = false;
    g.scale(Z, Z);
    g.translate(-Math.round(this.camX), -Math.round(this.camY));
    drawGround(this, g, visW, visH);

    // flat props drawn under entities (still get their own contact shadows)
    for (const pg of this.propGroups) pg.fn(g);

    // depth-sorted entities: lower on screen (larger y) draws in front. Trees
    // and the fountain are entities too, so the player naturally passes behind
    // things north of them and in front of things south of them.
    const ents = [];
    for (const loc of this.locations) ents.push({ y: loc.sortY != null ? loc.sortY : (loc.solid ? loc.solid.y + loc.solid.h : loc.dy), draw: (gg) => this._drawLocation(gg, loc) });
    for (const tr of this.trees) ents.push({ y: tr.y, draw: (gg) => bigTree(gg, tr.x, tr.y, tr.kind === 'pine' ? 'pine' : 'oak', this.t) });
    for (const d of this.decor) ents.push({ y: d.sortY, draw: (gg) => drawPropArt(gg, DECOR_ART[d.name], d.x, d.y, d.w, d.h, d.shadow, d.flip) });
    for (const n of this.npcs) ents.push({ y: n.y, draw: (gg) => { contactShadow(gg, n.x, n.y, 6, 2); drawActor(gg, { x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, weapon: n.sprite === 'warrior' ? 'sword' : (n.sprite === 'mage' ? 'staff' : 'none'), state: 'idle', animTime: this.t + n.x }); } });
    for (const p of this.sanctuaryPets) ents.push({ y: p.y, draw: (gg) => drawPet(gg, p, p.x, p.y, this.t) });
    ents.push({ y: this.py, draw: (gg) => this._drawPlayer(gg) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw(g);

    // Nightfall. Runs on the FINISHED frame and changes nothing but the light —
    // every prop, road and sprite is exactly where the daytime pass put it.
    drawNight(this, g, Z);

    this._drawNearPrompt(g);

    // development-only overview overlay (labels + road centerlines)
    if (typeof window !== 'undefined' && window.__townDebug) this._drawDebugOverview(g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);
    for (const [x, y, hue, r] of this.crystalGlows) crystalGlow(g, x, y, this.t, hue, r);
    for (const b of this.butterflies) drawButterfly(g, b, this.t);

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
  }

  // The interaction prompt is world-space UI, drawn AFTER the depth-sorted
  // pass: it used to be painted inside _drawLocation, where anything south of
  // the location (the Eldertree's colonnade, plaza planting by the fountain)
  // could draw over the text.
  _drawNearPrompt(g) {
    const loc = this.near;
    if (loc) {
      const label = loc.label || { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest', house: 'Enter Your House' }[loc.action] || 'Enter';
      const w = textWidth('[E] ' + label) + 12;
      // at the location's foot, but never over the player: when they stand
      // south of the point (inside the near radius) drop it below their feet
      const py = Math.max(loc.dy + 2, this.py + 3);
      panel(g, loc.dx - w / 2, py, w, 13, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, '[E] ' + label, loc.dx, py + 3, { color: blink ? UI.gold : UI.ink, align: 'center' });
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

  // (The old tile-grid road painter lived here. It has been replaced by
  // _drawRoads() above, which paints from the finer coverage map so each
  // family keeps its real designed width, and which drives the adventure
  // decay from progress along the route rather than the old fixed world-Y
  // threshold — that constant went stale the moment districts moved.)

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

