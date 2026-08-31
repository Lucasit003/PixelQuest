// The Weapon Shop / Blacksmith interior — a walkable forge room, rendered
// from the authored transparent PNG (assets/weapon_smith_interior.png).
// Same "diorama backdrop + floor strip" approach as the Potion Shop: the
// player walks in front of the art, a central counter opens the weapon buy
// menu, and the forge on the left throws off embers for a touch of life.

import { Input, FACE_DEADZONE } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, UI, Toasts } from '../gfx/ui.js';
import { rect, clamp } from '../gfx/pixel.js';
import { drawCharacter } from '../gfx/actors.js';
import { Particles } from '../gfx/particles.js';
import { WeaponShop } from './menus.js';

// Authored art, cropped to its content bbox (from a 1536x1024 canvas) and
// scaled to fill the game's width.
const INTERIOR_IMG = new Image();
let INTERIOR_READY = false;
INTERIOR_IMG.onload = () => { INTERIOR_READY = true; };
INTERIOR_IMG.src = 'assets/weapon_smith_interior.png';
const CROP = { x: 114, y: 204, w: 1274, h: 628 };
const IMG_Y = 10; // backdrop's top on screen
const IMG_W = 480, IMG_H = Math.round(CROP.h * (IMG_W / CROP.w)); // ~237

export class WeaponShopScene {
  constructor(hero, onExit) {
    this.hero = hero;
    this.onExit = onExit;
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.overlay = null;

    this.room = { x: 40, y: IMG_Y + IMG_H - 62, w: this.W - 80, h: 78 };
    this.px = this.W / 2; this.py = this.room.y + this.room.h - 14; this.facing = 1; this.dir = 'down';
    this.moving = false; this.walkT = 0;

    this.spots = [
      { id: 'counter', x: this.W / 2, y: IMG_Y + IMG_H - 55, label: 'Browse Weapons' },
      { id: 'door', x: this.W / 2, y: this.room.y + this.room.h - 4, label: 'Leave' },
    ];
    // hitboxes eyeballed against the art
    this.solids = [
      { x: 168, y: 172, w: 158, h: 26 },  // central counter/table
      { x: 8, y: 60, w: 92, h: 118 },     // forge (stone furnace, left wall)
    ];
    this.near = null;
  }

  exit() {}

  update(dt) {
    this.t += dt;
    this.particles.update(dt); this.toasts.update(dt);

    if (this.overlay) { this.overlay.update(dt); return; }

    // forge embers, drifting up from the fire on the left
    if (Math.random() < dt * 8) this.particles.ember(54 + (Math.random() * 10 - 5), 108, '#f2942b');

    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      this._tryMove(ax.x * 78 * dt, 0);
      this._tryMove(0, ax.y * 78 * dt);
      if (Math.abs(ax.x) > FACE_DEADZONE) this.facing = ax.x > 0 ? 1 : -1;
      // Which way he is turned relative to the camera. Vertical intent wins over
      // horizontal so a mostly-up diagonal shows his back rather than his side;
      // `facing` still carries left/right for the side view. This persists when
      // he stops, so he keeps facing the way he was walking.
      this.dir = Math.abs(ax.y) > Math.abs(ax.x)
        ? (ax.y < 0 ? 'up' : 'down') : 'side';
      this.walkT += dt;
    }

    this.near = null; let best = 1e9;
    for (const s of this.spots) { const d = Math.hypot(this.px - s.x, this.py - s.y); if (d < 28 && d < best) { best = d; this.near = s; } }

    if (this.near && Input.pressed('interact')) this._use(this.near);
    if (Input.pressed('menu')) this._leave();
  }

  _tryMove(dx, dy) {
    const r = this.room;
    const nx = clamp(this.px + dx, r.x + 8, r.x + r.w - 8);
    const ny = clamp(this.py + dy, r.y, r.y + r.h - 4);
    const box = { x: (dx ? nx : this.px) - 4, y: (dy ? ny : this.py) - 3, w: 8, h: 5 };
    for (const s of this.solids) if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return;
    if (dx) this.px = nx; if (dy) this.py = ny;
  }

  _use(spot) {
    if (spot.id === 'door') { this._leave(); return; }
    Audio.confirm();
    if (spot.id === 'counter') this.overlay = new WeaponShop(this.hero, () => { this.overlay = null; });
  }

  _leave() { this.hero.save(); this.onExit(); }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    rect(g, 0, 0, this.W, this.H, '#160e0a');

    if (INTERIOR_READY) {
      g.drawImage(INTERIOR_IMG, CROP.x, CROP.y, CROP.w, CROP.h, 0, IMG_Y, IMG_W, IMG_H);
    }

    drawCharacter(g, { x: this.px, y: this.py, z: 0, facing: this.facing, dir: this.dir, sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(), state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t });

    this.particles.draw(g);
    this.toasts.draw(g);

    if (this.near && !this.overlay) {
      const label = '[E] ' + this.near.label;
      const w = textWidth(label) + 10;
      panel(g, this.near.x - w / 2, this.near.y - 14, w, 12, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, label, this.near.x, this.near.y - 11, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }

    drawText(g, 'IRONHEARTH FORGE', this.W / 2, 6, { color: UI.gold, align: 'center' });
    if (this.t < 4) drawText(g, 'WASD move   E interact   Esc leave', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });

    if (this.overlay) this.overlay.draw(g, this.W, this.H);
  }
}
