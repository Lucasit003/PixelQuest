// The Player House interior — a walkable cottage room, rendered from the
// authored transparent PNG (assets/house_interior.png). Same "diorama
// backdrop" approach as the Potion Shop / Weapon Shop: the player walks a
// floor strip in front of the art. The bed lets you rest (heal + save); the
// bookshelf gives a bit of flavour text. Home decoration is intentionally
// structured but not yet a live catalog: the save carries
// `hero.s.home.furniture` (empty for now) so a future decorate UI can hang
// off it without a rewrite — nothing here is faked.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, clamp } from '../gfx/pixel.js';
import { drawCharacter } from '../gfx/actors.js';
import { Particles } from '../gfx/particles.js';

// Authored art, cropped to its content bbox (from a 1536x1024 canvas) and
// scaled to fill the game's width. This one's proportions happen to nearly
// fill the whole canvas height, so there's barely any surround visible.
const INTERIOR_IMG = new Image();
let INTERIOR_READY = false;
INTERIOR_IMG.onload = () => { INTERIOR_READY = true; };
INTERIOR_IMG.src = 'assets/house_interior.png';
const CROP = { x: 118, y: 144, w: 1282, h: 730 };
const IMG_Y = 6; // backdrop's top on screen
const IMG_W = 480, IMG_H = Math.round(CROP.h * (IMG_W / CROP.w)); // ~273

export class HouseScene {
  constructor(hero, onExit) {
    this.hero = hero;
    this.onExit = onExit;
    // prepared structure for future home customization (no live catalog yet)
    if (!hero.s.home) hero.s.home = { furniture: [] };
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.dialogue = null; this.dialogueReveal = 0;

    this.room = { x: 40, y: 60, w: this.W - 80, h: 190 };
    // spawn/exit at the drawn door on the back wall, not the bottom of frame
    this.px = 242; this.py = 121; this.facing = 1;
    this.moving = false; this.walkT = 0;

    this.spots = [
      { id: 'bed', x: 52, y: 150, label: 'Rest' },
      { id: 'shelf', x: 122, y: 88, label: 'Read' },
      { id: 'door', x: 242, y: 121, label: 'Leave' },
    ];
    // hitboxes eyeballed against the art
    this.solids = [
      { x: 12, y: 90, w: 75, h: 95 },      // bed
      { x: 95, y: 62, w: 55, h: 46 },      // bookshelf + nightstand
      { x: 230, y: 175, w: 140, h: 45 },   // dining table + benches
      { x: 388, y: 128, w: 92, h: 58 },    // kitchen counter/stove
    ];
    this.near = null;
  }

  exit() {}

  update(dt) {
    this.t += dt;
    this.particles.update(dt); this.toasts.update(dt);
    // hearth/stove flicker over on the kitchen side
    if (Math.random() < dt * 4) this.particles.spawn({ x: 462 + Math.random() * 4, y: 165, kind: 'ember', color: '#f2942b', vx: 0, vy: -10, life: 0.6, size: 1 });

    if (this.dialogue) { this._updateDialogue(dt); return; }

    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      this._tryMove(ax.x * 78 * dt, 0);
      this._tryMove(0, ax.y * 78 * dt);
      if (ax.x !== 0) this.facing = ax.x > 0 ? 1 : -1;
      this.walkT += dt;
    }

    this.near = null; let best = 1e9;
    for (const s of this.spots) { const d = Math.hypot(this.px - s.x, this.py - s.y); if (d < 26 && d < best) { best = d; this.near = s; } }

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
    if (spot.id === 'bed') {
      const healed = this.hero.s.hp < this.hero.maxHp || this.hero.s.mana < this.hero.maxMana;
      this.hero.s.hp = this.hero.maxHp; this.hero.s.mana = this.hero.maxMana; this.hero.save();
      this.toasts.push(healed ? 'You feel well rested.' : 'Already rested', this.px, this.py - 26, UI.good, { life: 1.5 });
      Audio.levelUp();
    } else if (spot.id === 'shelf') {
      this.dialogue = { speaker: 'Bookshelf', lines: ["Your adventuring journal and a few dusty tomes.", 'Home decorating is coming soon — your house will grow with you.'], idx: 0 };
      this.dialogueReveal = 0;
    }
  }

  _leave() { this.hero.save(); this.onExit(); }

  _updateDialogue(dt) {
    this.dialogueReveal = Math.min(1, this.dialogueReveal + dt * 3);
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      if (this.dialogueReveal < 1) { this.dialogueReveal = 1; return; }
      const d = this.dialogue;
      if (d.idx < d.lines.length - 1) { d.idx++; this.dialogueReveal = 0; Audio.select(); }
      else { this.dialogue = null; Audio.confirm(); }
    }
    if (Input.pressed('menu')) this.dialogue = null;
  }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    rect(g, 0, 0, this.W, this.H, '#160e0a');

    if (INTERIOR_READY) {
      g.drawImage(INTERIOR_IMG, CROP.x, CROP.y, CROP.w, CROP.h, 0, IMG_Y, IMG_W, IMG_H);
    }

    const pet = this.hero.pet();
    if (pet) { /* pet stays outside; skip in house for calm */ }
    drawCharacter(g, { x: this.px, y: this.py, z: 0, facing: this.facing, sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(), state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t });

    this.particles.draw(g);
    this.toasts.draw(g);

    if (this.near && !this.dialogue) {
      const label = '[E] ' + this.near.label;
      const w = textWidth(label) + 10;
      panel(g, this.near.x - w / 2, this.near.y - 14, w, 12, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, label, this.near.x, this.near.y - 11, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }

    drawText(g, 'YOUR HOUSE', this.W / 2, 6, { color: UI.gold, align: 'center' });
    if (this.t < 4) drawText(g, 'WASD move   E interact   Esc leave', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });

    if (this.dialogue) dialogue(g, this.W, this.H, this.dialogue.speaker, this.dialogue.lines[this.dialogue.idx], this.dialogueReveal, { prompt: this.dialogue.idx < this.dialogue.lines.length - 1 ? 'J: more' : 'J: ok' });
  }
}
