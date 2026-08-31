// The Potion Shop interior — a walkable alchemy den, rendered from the
// authored transparent PNG (assets/potion_shop_interior.png). The artwork
// is a wide diorama (cauldron centred, shelving both walls, a back counter)
// drawn as a backdrop; the player walks a floor strip in front of it, same
// idea as a stage set. A bubbling cauldron opens the potion buy menu
// (reusing the existing PotionShop overlay); walking off the bottom leaves
// back to town.

import { Input, FACE_DEADZONE } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, UI, Toasts } from '../gfx/ui.js';
import { rect, clamp } from '../gfx/pixel.js';
import { drawCharacter } from '../gfx/actors.js';
import { Particles } from '../gfx/particles.js';
import { PotionShop } from './menus.js';

// Authored art, cropped to its content bbox (from a 1536x1024 canvas) and
// scaled to fill the game's width. Backdrop occupies the top of the screen;
// a plain floor strip below extends the room so there's room to walk.
const INTERIOR_IMG = new Image();
let INTERIOR_READY = false;
INTERIOR_IMG.onload = () => { INTERIOR_READY = true; };
INTERIOR_IMG.src = 'assets/potion_shop_interior.png';
const CROP = { x: 120, y: 272, w: 1292, h: 516 };
const IMG_Y = 18; // backdrop's top on screen
const IMG_W = 480, IMG_H = Math.round(CROP.h * (IMG_W / CROP.w)); // ~192

export class PotionShopScene {
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

    // walkable area: the lower (floor) part of the backdrop plus the added
    // floor strip beneath it
    this.room = { x: 40, y: IMG_Y + IMG_H - 70, w: this.W - 80, h: 90 };
    this.px = this.W / 2; this.py = this.room.y + this.room.h - 16; this.facing = 1; this.dir = 'down';
    this.moving = false; this.walkT = 0;

    this.spots = [
      { id: 'cauldron', x: this.W / 2, y: IMG_Y + IMG_H - 52, label: 'Browse Potions' },
      { id: 'door', x: this.W / 2, y: this.room.y + this.room.h - 4, label: 'Leave' },
    ];
    // hitboxes for the objects drawn into the backdrop art, eyeballed
    // against the image so the player collides with them instead of
    // walking through/over them
    this.solids = [
      { x: 206, y: 142, w: 68, h: 44 },        // cauldron
      { x: 95, y: 145, w: 65, h: 24 },         // left workbench (book + candle)
      { x: this.W - 160, y: 145, w: 65, h: 24 }, // right table (potion + candle)
    ];
    this.near = null;
  }

  exit() {}

  update(dt) {
    this.t += dt;
    this.particles.update(dt); this.toasts.update(dt);

    if (this.overlay) { this.overlay.update(dt); return; }

    // cauldron steam, positioned over the art's cauldron
    if (Math.random() < dt * 6) this.particles.ember(this.W / 2 + (Math.random() * 6 - 3), IMG_Y + IMG_H - 66, '#c98bff');

    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      this._tryMove(ax.x * 78 * dt, 0);
      this._tryMove(0, ax.y * 78 * dt);
      if (Math.abs(ax.x) > FACE_DEADZONE) this.facing = ax.x > 0 ? 1 : -1;
      // Which way he is turned relative to the camera. Vertical intent wins
      // ties as well as contests, because a 45-degree diagonal is exactly what
      // the three-quarter art is drawn for -- a pure profile there reads as
      // walking sideways along a diagonal. `facing` still carries left/right,
      // and now mirrors the three-quarter views too, so up and down each have a
      // left-ish and a right-ish pose. This persists when he stops, so he keeps
      // facing the way he was walking.
      this.dir = Math.abs(ax.y) >= Math.abs(ax.x)
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
    if (spot.id === 'cauldron') this.overlay = new PotionShop(this.hero, () => { this.overlay = null; });
  }

  _leave() { this.hero.save(); this.onExit(); }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    rect(g, 0, 0, this.W, this.H, '#120a1a');

    if (INTERIOR_READY) {
      g.drawImage(INTERIOR_IMG, CROP.x, CROP.y, CROP.w, CROP.h, 0, IMG_Y, IMG_W, IMG_H);
    }
    // area below the art stays part of the dark surround (no floor strip)

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

    drawText(g, 'POTION SHOP', this.W / 2, 6, { color: UI.gold, align: 'center' });
    if (this.t < 4) drawText(g, 'WASD move   E interact   Esc leave', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });

    if (this.overlay) this.overlay.draw(g, this.W, this.H);
  }
}
