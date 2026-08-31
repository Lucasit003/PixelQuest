// The Runewood Archive interior — the town library, rendered from the authored
// PNG (assets/libaryinside.png). Same "diorama backdrop" approach as the
// Player House / Potion Shop / Weapon Shop: the player walks the hall floor in
// front of the art, the front door (bottom centre) takes you back to town.
//
// This is the game's LEARNING venue: the study table opens the adaptive question
// session. Learning happens here and nowhere else — combat never asks a
// question, and the Eldertree is where what you learn gets spent.
//
// The backdrop is drawn 1:1 from assets/library_interior.png, which is the
// source art baked offline to exactly 480x262 (premultiplied LANCZOS) — the
// project rule is to never let the canvas downscale pixel art at draw time.
// Re-bake if the draw size ever changes.
//
// Collision was traced from gridded crops of the art: walls/partitions/stairs
// and anything with height block, floor dressing is walkable (see the list in
// enter()). The upper-left archway and the locked door in the right wing are
// drawn in the art but not yet interactive — hooks for later.

import { Input, FACE_DEADZONE } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, clamp } from '../gfx/pixel.js';
import { drawCharacter } from '../gfx/actors.js';
import { Particles } from '../gfx/particles.js';

const INTERIOR_IMG = new Image();
let INTERIOR_READY = false;
INTERIOR_IMG.onload = () => { INTERIOR_READY = true; };
INTERIOR_IMG.src = 'assets/library_interior.png';
const IMG_W = 480, IMG_H = 262;
const IMG_Y = 4; // centred on the 270-tall canvas

export class LibraryScene {
  constructor(hero, onExit, onStudy) {
    this.hero = hero;
    this.onExit = onExit;
    this.onStudy = onStudy;
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.dialogue = null; this.dialogueReveal = 0;

    // Walkable envelope (hero feet), in backdrop units. The outer walls are
    // solids too; this clamp is only a backstop.
    this.room = { x: 10, y: 40, w: 460, h: 220 };
    // spawn just inside the front door, on the mat at the bottom centre
    this.px = 240; this.py = 238; this.facing = 1; this.dir = 'side';
    this.moving = false; this.walkT = 0;

    this.spots = [
      { id: 'door', x: 240, y: 250, label: 'Leave' },
      // The left study table. This is where the game is actually LEARNED —
      // the only place questions are asked. Valorhall used to host the quiz,
      // which put algebra in a building whose art is a sparring yard.
      { id: 'study', x: 200, y: 162, label: 'Study' },
    ];

    // Collision, traced from 4x gridded crops of the art (tools: see the
    // session notes). Rule: walls, partitions, stairs and anything with
    // height block; carpets, rugs, the stone ring, floor diagrams and small
    // floor clutter are walkable. Floor lines: wings y>=85 (stairs end
    // at y=122, wing floors end at y=170), hall y>=120, lower-left room y>=214,
    // lower-right room y>=218, everything ends at the bottom wall (~258). Coordinates are [x, y, w, h] in backdrop units.
    const S = (x, y, w, h, what) => ({ x, y, w, h, what });
    this.solids = [
      // ---- walls / structure ----
      S(0, 0, 480, 85, 'back wall + upper galleries (all wings)'),
      S(0, 0, 10, 262, 'outer left wall'),
      S(470, 0, 10, 262, 'outer right wall'),
      S(152, 36, 176, 120 - 36, 'great bookshelf wall + its two plants'),
      S(132, 36, 30, 122 - 36, 'left stair + column (hall/wing partition)'),
      S(318, 36, 34, 122 - 36, 'right stair + column (hall/wing partition)'),
      S(0, 170, 152, 214 - 170, 'left wing bottom wall + lower-left back wall (maps, bookcase, cabinets)'),
      S(330, 170, 150, 218 - 170, 'right wing bottom wall + lower-right back wall (shelves, alchemy desk)'),
      S(152, 172, 24, 218 - 172, 'lower-left partition + planter (the stone ring beside it stays walkable)'),
      S(306, 172, 24, 218 - 172, 'lower-right partition + planter (the stone ring beside it stays walkable)'),
      // ---- central hall ----
      S(168, 120, 64, 36, 'left study table + chairs'),
      S(248, 120, 68, 36, 'right study table + chairs'),
      // The zodiac disc under the crystal is a flat floor mosaic — walkable.
      // Only the dark crystal base has height; it fills the gap between the
      // two study tables, so the sliver of floor behind the crystal is
      // enclosed by furniture on all sides (that's the art, not a bad box).
      S(226, 136, 32, 26, 'crystal base'),
      S(190, 196, 124, 16, 'the five pedestals'),
      S(164, 232, 46, 26, 'writing desk + lamp stand (left of door)'),
      S(262, 232, 48, 26, 'notice board + lamp stand (right of door)'),
      S(150, 236, 20, 22, 'potted plant (left of the hall mouth)'),
      S(312, 236, 22, 22, 'potted plant (right of the hall mouth)'),
      // ---- upper-left wing (chalkboard / rune room) ----
      S(100, 84, 34, 36, 'potted tree + round table with chairs'),
      S(30, 124, 56, 24, 'rune desk with both screens'),
      S(0, 126, 20, 28, 'wall-mounted rune screen'),
      S(104, 164, 28, 8, 'low bench by the wing mouth'),
      // ---- upper-right wing (astronomy / history) ----
      S(382, 85, 32, 12, 'locked door (foot)'),
      S(346, 80, 38, 22, 'scroll cabinet + bust (left of the door)'),
      S(418, 82, 50, 20, 'plant + flask shelf (right of the door)'),
      S(454, 96, 16, 26, 'flask shelf on the right wall'),
      S(352, 94, 24, 22, 'telescope'),
      S(424, 98, 22, 24, 'armillary sphere'),
      S(404, 124, 66, 48, 'three busts + world-map table + flanking statues'),
      S(344, 132, 42, 40, 'green map table + globe (walkway runs above it)'),
      // ---- lower-left room (geography) ----
      S(22, 226, 50, 26, 'desk + chairs'),
      S(8, 242, 22, 16, 'book pile (left)'),
      S(62, 240, 26, 18, 'book pile (right)'),
      S(102, 236, 22, 22, 'bench with map'),
      S(128, 238, 20, 20, 'bust'),
      // ---- lower-right room (reading nook) ----
      S(406, 218, 64, 26, 'armchairs + side table'),
      S(456, 238, 16, 20, 'floor lamp'),
      S(338, 232, 18, 26, 'bust'),
      S(354, 234, 30, 22, 'small desk'),
    ];
    this.near = null;
  }

  exit() {}

  update(dt) {
    this.t += dt;
    this.particles.update(dt); this.toasts.update(dt);
    // soft motes rising off the crystal
    if (Math.random() < dt * 3) this.particles.spawn({ x: 232 + Math.random() * 16, y: 128 + IMG_Y, kind: 'ember', color: '#cfa6ff', vx: 0, vy: -8, life: 0.8, size: 1 });

    if (this.dialogue) { this._updateDialogue(dt); return; }

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
    if (spot.id === 'study') {
      if (!this.onStudy) return;
      Audio.confirm();
      this.hero.save();
      this.onStudy();
      return;
    }
    Audio.confirm();
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
    rect(g, 0, 0, this.W, this.H, '#120b08');

    if (INTERIOR_READY) g.drawImage(INTERIOR_IMG, 0, IMG_Y, IMG_W, IMG_H);

    drawCharacter(g, { x: this.px, y: this.py, z: 0, facing: this.facing, dir: this.dir, sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(), state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t });

    this.particles.draw(g);
    this.toasts.draw(g);

    if (this.near && !this.dialogue) {
      const label = '[E] ' + this.near.label;
      const w = textWidth(label) + 10;
      panel(g, this.near.x - w / 2, this.near.y - 14, w, 12, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, label, this.near.x, this.near.y - 11, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }

    drawText(g, 'RUNEWOOD ARCHIVE', this.W / 2, 6, { color: UI.gold, align: 'center' });
    if (this.t < 4) drawText(g, 'WASD move   E interact   Esc leave', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });

    if (this.dialogue) dialogue(g, this.W, this.H, this.dialogue.speaker, this.dialogue.lines[this.dialogue.idx], this.dialogueReveal, { prompt: this.dialogue.idx < this.dialogue.lines.length - 1 ? 'J: more' : 'J: ok' });
  }
}
