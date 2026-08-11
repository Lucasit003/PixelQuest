// The Player House interior — a small, cozy, walkable room. The player enters
// from town and exits back to town. A bed lets you rest (heal + save); a
// fireplace, rug, table, bookshelf and a few pots dress the room. Home
// decoration is intentionally structured but not yet a live catalog: the save
// carries `hero.s.home.furniture` (empty for now) so a future decorate UI can
// hang off it without a rewrite — nothing here is faked.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, disc, shadow, clamp } from '../gfx/pixel.js';
import { drawCharacter } from '../gfx/actors.js';
import { drawIcon } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';

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

    // room bounds (the wooden floor area)
    this.room = { x: 96, y: 70, w: 288, h: 150 };
    this.px = this.W / 2; this.py = 190; this.facing = 1;
    this.moving = false; this.walkT = 0;

    // interactables: bed (rest), exit door, bookshelf (flavor)
    this.spots = [
      { id: 'bed', x: 140, y: 110, label: 'Rest' },
      { id: 'door', x: this.W / 2, y: this.room.y + this.room.h - 2, label: 'Leave' },
      { id: 'shelf', x: 330, y: 96, label: 'Read' },
    ];
    // solids inside the room (furniture footprints)
    this.solids = [
      { x: 116, y: 92, w: 54, h: 26 },   // bed
      { x: 300, y: 82, w: 60, h: 16 },   // bookshelf
      { x: 210, y: 150, w: 40, h: 16 },  // table
      { x: 340, y: 150, w: 30, h: 22 },  // fireplace
    ];
    this.near = null;
  }

  exit() {}

  update(dt) {
    this.t += dt;
    this.particles.update(dt); this.toasts.update(dt);
    // fireplace embers
    if (Math.random() < dt * 4) this.particles.spawn({ x: 355 + Math.random() * 4, y: 168, kind: 'ember', color: '#f2942b', vx: 0, vy: -10, life: 0.6, size: 1 });

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
    const ny = clamp(this.py + dy, r.y + 24, r.y + r.h - 6);
    const box = { x: (dx ? nx : this.px) - 4, y: (dy ? ny : this.py) - 3, w: 8, h: 5 };
    for (const s of this.solids) if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return;
    if (dx) this.px = nx; if (dy) this.py = ny;
  }

  _use(spot) {
    Audio.confirm();
    if (spot.id === 'door') { this._leave(); }
    else if (spot.id === 'bed') {
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
    const r = this.room;
    // dark surround
    rect(g, 0, 0, this.W, this.H, '#0e0b16');
    // wall
    rect(g, r.x - 8, r.y - 20, r.w + 16, 30, '#4a3d5a');
    for (let x = r.x - 8; x < r.x + r.w + 8; x += 12) rect(g, x, r.y - 20, 1, 30, '#3d3149');
    rect(g, r.x - 8, r.y - 20, r.w + 16, 3, '#5c4d70');
    // wooden floor
    rect(g, r.x, r.y + 10, r.w, r.h - 10, '#8a6a44');
    for (let y = r.y + 10; y < r.y + r.h; y += 8) rect(g, r.x, y, r.w, 1, '#7a5a38');
    for (let x = r.x; x < r.x + r.w; x += 24) rect(g, x, r.y + 10, 1, r.h - 10, '#7a5a38');
    rectOutline(g, r.x, r.y + 10, r.w, r.h - 10, '#3a2a1e');
    // rug
    rect(g, this.W / 2 - 40, 150, 80, 44, '#7a3550'); rectOutline(g, this.W / 2 - 40, 150, 80, 44, '#a85578');
    rect(g, this.W / 2 - 34, 156, 68, 32, '#8a4460');

    // wall dressings: window + hanging emblem + banner
    rect(g, r.x + 30, r.y - 16, 20, 16, '#2a3550'); rect(g, r.x + 31, r.y - 15, 18, 14, '#6fa0d8'); rect(g, r.x + 39, r.y - 16, 2, 16, '#2a3550');
    rect(g, r.x + r.w - 60, r.y - 16, 20, 16, '#2a3550'); rect(g, r.x + r.w - 59, r.y - 15, 18, 14, '#6fa0d8'); rect(g, r.x + r.w - 51, r.y - 16, 2, 16, '#2a3550');
    disc(g, this.W / 2, r.y - 8, 4, '#e0679a'); rect(g, this.W / 2 - 1, r.y - 12, 2, 8, '#dfe6f2'); // home emblem

    this._furniture(g);

    // player + pet
    const pet = this.hero.pet();
    if (pet) { /* pet stays outside; skip in house for calm */ }
    drawCharacter(g, { x: this.px, y: this.py, z: 0, facing: this.facing, sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(), state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t });

    this.particles.draw(g);
    this.toasts.draw(g);

    // prompt
    if (this.near) {
      const label = '[E] ' + this.near.label;
      const w = textWidth(label) + 10;
      panel(g, this.near.x - w / 2, this.near.y - 30, w, 12, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, label, this.near.x, this.near.y - 27, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }

    // header
    drawText(g, 'YOUR HOUSE', this.W / 2, 8, { color: UI.gold, align: 'center' });
    if (this.t < 4) drawText(g, 'WASD move   E interact   Esc leave', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });

    if (this.dialogue) dialogue(g, this.W, this.H, this.dialogue.speaker, this.dialogue.lines[this.dialogue.idx], this.dialogueReveal, { prompt: this.dialogue.idx < this.dialogue.lines.length - 1 ? 'J: more' : 'J: ok' });
  }

  _furniture(g) {
    // bed
    shadow(g, 143, 118, 26, 3, 0.25);
    rect(g, 116, 92, 54, 26, '#6b4a2e'); rectOutline(g, 116, 92, 54, 26, '#4a3220');
    rect(g, 120, 96, 16, 18, '#dfe6f2');          // pillow area
    rect(g, 136, 96, 30, 18, '#5c6a8a');          // blanket
    rect(g, 136, 96, 30, 3, '#7c8ab0');
    // bookshelf
    rect(g, 300, 82, 60, 16, '#5a3a24'); rectOutline(g, 300, 82, 60, 16, '#3a2414');
    for (let i = 0; i < 10; i++) rect(g, 304 + i * 5, 84, 3, 12, ['#c0463c', '#3f7a5c', '#5c6a8a', '#c99a2f', '#8a4a8a'][i % 5]);
    rect(g, 300, 90, 60, 1, '#3a2414');
    // table with a candle
    shadow(g, 230, 166, 20, 3, 0.24);
    rect(g, 210, 150, 40, 8, '#7a5530'); rect(g, 214, 158, 3, 8, '#5a3a24'); rect(g, 243, 158, 3, 8, '#5a3a24');
    rect(g, 228, 144, 3, 6, '#e8e2c8'); const cf = 0.6 + Math.sin(this.t * 6) * 0.2; g.globalAlpha = cf; disc(g, 229, 142, 2, '#ffd67a'); g.globalAlpha = 1;
    // fireplace
    rect(g, 340, 150, 30, 22, '#6b6b7a'); rectOutline(g, 340, 150, 30, 22, '#3a3e4a');
    rect(g, 346, 160, 18, 12, '#2a1a12');
    const ff = 0.6 + Math.sin(this.t * 7) * 0.25; g.globalAlpha = ff; disc(g, 355, 168, 5, '#f2942b'); disc(g, 355, 169, 3, '#ffd67a'); g.globalAlpha = 1;
    rect(g, 340, 148, 30, 3, '#5a5a68');
    // potted plants
    rect(g, 104, 200, 6, 5, '#6b4a2e'); rect(g, 105, 194, 2, 6, '#3a7a3e'); rect(g, 108, 195, 2, 5, '#3a7a3e');
    rect(g, 366, 200, 6, 5, '#6b4a2e'); rect(g, 367, 194, 2, 6, '#3a7a3e');
    // exit doormat + door on the south wall
    rect(g, this.W / 2 - 12, this.room.y + this.room.h - 6, 24, 6, '#8a5a3a');
    rect(g, this.W / 2 - 9, this.room.y + this.room.h - 16, 18, 16, '#4a2f1c'); rectOutline(g, this.W / 2 - 9, this.room.y + this.room.h - 16, 18, 16, '#2a1a10');
    rect(g, this.W / 2 + 4, this.room.y + this.room.h - 9, 2, 2, '#d8b24a');
  }
}
