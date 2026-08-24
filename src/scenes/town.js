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
import { dialogue, UI, Toasts } from '../gfx/ui.js';
import { clamp, lerp } from '../gfx/pixel.js';
import { drawCharacter, drawActor, drawPet } from '../gfx/actors.js';
import { Particles } from '../gfx/particles.js';
import { InventoryMenu } from './menus.js';
import { hash, contactShadow, drawPropArt } from './town/primitives.js';
import { DECOR_ART, drawButterfly, crystalGlow, lamp, brazier, bigTree } from './town/props.js';
import { MAP_W, MAP_H, ZOOM } from './town/dimensions.js';
import { buildTown } from './town/layout.js';
import { drawHUD, drawNearPrompt, drawDebugOverview } from './town/hud.js';
import { enterLocation, updateDialogue } from './town/interactions.js';
import { drawGround } from './town/ground.js';
import { drawNight } from './town/lighting.js';

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
    if (this.dialogue) { updateDialogue(this, dt); return; }

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

    if (this.near && Input.pressed('interact')) enterLocation(this, this.near);
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

    drawNearPrompt(this, g);

    // development-only overview overlay (labels + road centerlines)
    if (typeof window !== 'undefined' && window.__townDebug) drawDebugOverview(this, g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);
    for (const [x, y, hue, r] of this.crystalGlows) crystalGlow(g, x, y, this.t, hue, r);
    for (const b of this.butterflies) drawButterfly(g, b, this.t);

    this.particles.draw(g);
    this.toasts.draw(g);
    g.restore();

    drawHUD(this, g);

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

}

// ============================================================ shared drawers

