// Title screen and class-select.
//
// The title is composed as a real scene: a layered moonlit-forest backdrop
// (distant mountains -> mid pines -> foreground clearing) with a stone path
// leading to a glowing town gate, the two heroes flanking the path, torches
// framing it, and a unified outlined PIXEL QUEST logo with an emblem. It opens
// on a pulsing PRESS ENTER, then fades into a proper RPG menu.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, panelTitle, heading, bar, UI } from '../gfx/ui.js';
import { rect, rectOutline, disc, clamp01, lerp } from '../gfx/pixel.js';
import { drawActor, drawCharacter, drawPet } from '../gfx/actors.js';
import { drawPineTree, drawTorch, drawIcon } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { CLASSES, abilitiesForClass } from '../game/data.js';
import { Hero } from '../game/state.js';
import { Save } from '../core/save.js';

const HORIZON = 150;

// Real title-screen artwork (warrior + mage flanking the gate, logo baked in).
// Same 16:9 ratio as the internal canvas, so it draws edge-to-edge with no
// letterboxing or crop math needed.
const TITLE_IMG = new Image();
let TITLE_READY = false;
TITLE_IMG.onload = () => { TITLE_READY = true; };
TITLE_IMG.src = 'assets/title_screen.png';

// Position of the two torches/mage-orb in the artwork, converted from
// source-image pixels to canvas units, so ambient particles land right.
// This artwork has no "PRESS ENTER" baked in, so we draw our own below the
// tagline, in the gap before the gate.
const PRESS_Y = 112;
const LEFT_TORCH = { x: 188, y: 179 };
const RIGHT_TORCH = { x: 293, y: 179 };
const MAGE_ORB = { x: 391, y: 177 };

export class TitleScene {
  constructor(onStart) { this.onStart = onStart; }

  enter(game) {
    this.game = game; this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.hasSave = Save.exists();

    // presentation state machine: 'press' -> 'menu' (+ 'options'/'credits')
    this.mode = 'press';
    this.menuAlpha = 0;   // 0..1 fade of the menu
    this.pressAlpha = 1;  // 0..1 fade of the PRESS ENTER prompt
    this.buildMenu();
    this.sel = 0;
    this.confirmErase = false;
    this.soundOn = Audio.enabled;

    // pre-scatter a few stars (few, per the brief)
    this.stars = [];
    for (let i = 0; i < 10; i++) this.stars.push({ x: 20 + Math.random() * (this.W - 40), y: 8 + Math.random() * 90, tw: Math.random() * 6 });
    this.mageSparkTimer = 0;
  }

  buildMenu() {
    this.options = this.hasSave
      ? ['Continue', 'New Hero', 'Options', 'Credits']
      : ['New Hero', 'Options', 'Credits'];
  }

  update(dt) {
    this.t += dt;
    this.particles.update(dt);

    // ambient: torch embers + occasional mage spark, positioned over the artwork
    if (Math.random() < dt * 4) this.particles.ember(LEFT_TORCH.x + Math.random() * 4, LEFT_TORCH.y, '#f2942b');
    if (Math.random() < dt * 4) this.particles.ember(RIGHT_TORCH.x + Math.random() * 4, RIGHT_TORCH.y, '#f2942b');
    this.mageSparkTimer -= dt;
    if (this.mageSparkTimer <= 0) {
      this.mageSparkTimer = 1.6 + Math.random() * 1.5;
      this.particles.magicBurst(MAGE_ORB.x, MAGE_ORB.y, '#9d8bff', 4);
    }

    if (this.mode === 'press') return this._updatePress(dt);
    if (this.mode === 'options') return this._updateOptions(dt);
    if (this.mode === 'credits') return this._updateCredits(dt);
    return this._updateMenu(dt);
  }

  _updatePress(dt) {
    this.pressAlpha = 0.825 + Math.sin(this.t * 4.5) * 0.175; // pulse 65%-100%, ~1.4s loop
    if (Input.anyPressed('confirm', 'light', 'interact', 'jump')) {
      Audio.confirm();
      this.mode = 'menu';
    }
  }

  _updateMenu(dt) {
    this.menuAlpha = Math.min(1, this.menuAlpha + dt * 4);
    this.pressAlpha = Math.max(0, this.pressAlpha - dt * 6);

    if (Input.repeated('up')) { this.sel = (this.sel + this.options.length - 1) % this.options.length; Audio.select(); }
    if (Input.repeated('down')) { this.sel = (this.sel + 1) % this.options.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'light', 'interact')) this._choose();
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this.mode = 'press'; this.menuAlpha = 0; }
  }

  _choose() {
    const opt = this.options[this.sel];
    Audio.confirm();
    if (opt === 'Continue') { const h = Hero.load(); if (h) this.onStart(h); }
    else if (opt === 'New Hero') this.game.setScene(new ClassSelectScene(this.onStart));
    else if (opt === 'Options') { this.mode = 'options'; this.optSel = 0; }
    else if (opt === 'Credits') { this.mode = 'credits'; }
  }

  _updateOptions(dt) {
    const items = this.hasSave ? ['sound', 'erase', 'back'] : ['sound', 'back'];
    if (this.confirmErase) {
      if (Input.anyPressed('confirm', 'light')) { Save.clear(); this.hasSave = false; this.buildMenu(); this.sel = 0; this.confirmErase = false; Audio.deny(); }
      if (Input.pressed('back') || Input.pressed('menu')) this.confirmErase = false;
      return;
    }
    if (this.optSel === undefined) this.optSel = 0;
    if (Input.repeated('up')) { this.optSel = (this.optSel + items.length - 1) % items.length; Audio.select(); }
    if (Input.repeated('down')) { this.optSel = (this.optSel + 1) % items.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'light', 'interact')) {
      const it = items[this.optSel];
      if (it === 'sound') { this.soundOn = Audio.toggle(); Audio.select(); }
      else if (it === 'erase') { this.confirmErase = true; }
      else { this.mode = 'menu'; }
    }
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this.mode = 'menu'; }
  }

  _updateCredits(dt) {
    if (Input.anyPressed('confirm', 'light', 'interact', 'menu', 'back')) { Audio.deny(); this.mode = 'menu'; }
  }

  // ================================================================ draw

  draw(g) {
    this._drawBackground(g);
    this.particles.draw(g);

    if (this.mode === 'press' || (this.mode === 'menu' && this.pressAlpha > 0.01)) this._drawPress(g);
    if (this.mode !== 'press') this._drawMenu(g);
    if (this.mode === 'options') this._drawOptions(g);
    if (this.mode === 'credits') this._drawCredits(g);

    // bottom control hint
    const hint = this.mode === 'press' ? '' : 'W/S Navigate  •  J/Enter Select  •  Esc Back';
    if (hint) drawText(g, hint, this.W / 2, this.H - 9, { color: 'rgba(140,136,171,0.8)', align: 'center' });
  }

  // ---- background -----------------------------------------------------

  _drawBackground(g) {
    if (TITLE_READY) {
      g.drawImage(TITLE_IMG, 0, 0, this.W, this.H);
      return;
    }
    // brief fallback while the artwork loads, so the scene isn't blank
    this._drawBackdrop(g);
    this._drawMidground(g);
    this._drawForeground(g);
    this._drawLogo(g);
  }

  _drawBackdrop(g) {
    // sky gradient, darkest at top -> faint warmth at horizon
    const sky = ['#080611', '#0b0918', '#0f0d20', '#141129', '#1a1633', '#231d3e', '#2e2545'];
    for (let i = 0; i < sky.length; i++) {
      const y0 = Math.round((HORIZON) * i / sky.length);
      const y1 = Math.round((HORIZON) * (i + 1) / sky.length);
      rect(g, 0, y0, this.W, y1 - y0, sky[i]);
    }

    // stars (few), gentle twinkle
    for (const s of this.stars) {
      const tw = Math.sin(this.t * 1.5 + s.tw);
      if (tw > -0.2) { g.globalAlpha = 0.4 + tw * 0.4; rect(g, s.x, s.y, 1, 1, '#cfd6ff'); }
    }
    g.globalAlpha = 1;

    // moon, upper-right, with soft glow + craters
    const mx = 392, my = 42, mr = 11;
    for (let r = mr + 8; r > mr; r--) { g.globalAlpha = 0.03; disc(g, mx, my, r, '#8a86c0'); }
    g.globalAlpha = 1;
    disc(g, mx, my, mr, '#3f3a5e');
    disc(g, mx - 1, my - 1, mr - 1, '#565080');
    disc(g, mx - 2, my - 2, mr - 3, '#6a63a0');
    disc(g, mx + 3, my + 1, 3, '#4a4570');   // craters
    disc(g, mx - 3, my + 4, 2, '#4a4570');
    disc(g, mx + 1, my - 4, 1, '#4a4570');

    // distant mountain / forest silhouette
    g.fillStyle = '#141227';
    for (let x = -10; x < this.W + 20; x += 46) mountain(g, x, HORIZON, 40, 30, '#141227');
    g.fillStyle = '#171a30';
    for (let x = 20; x < this.W + 20; x += 54) mountain(g, x, HORIZON, 52, 20, '#171a30');
  }

  _drawMidground(g) {
    // back pine silhouettes (darker) then a nearer row
    for (let x = 0; x < this.W; x += 30) darkPine(g, x + 8, HORIZON + 2, 12, '#12241c');
    for (let x = -8; x < this.W; x += 40) drawPineTree(g, x + 20, HORIZON + 8, 0.75);
  }

  _drawForeground(g) {
    // ground: recede from grass at the horizon to a dark clearing in front
    const bands = ['#1f3a26', '#1b3322', '#172c1e', '#132518', '#0f1e14'];
    for (let i = 0; i < bands.length; i++) {
      const y0 = HORIZON + Math.round((this.H - HORIZON) * i / bands.length);
      const y1 = HORIZON + Math.round((this.H - HORIZON) * (i + 1) / bands.length);
      rect(g, 0, y0, this.W, y1 - y0, bands[i]);
    }

    // central stone/dirt path in perspective, leading to the gate
    for (let y = HORIZON; y < this.H; y++) {
      const k = (y - HORIZON) / (this.H - HORIZON);
      const halfW = lerp(7, 42, k);
      const cx = this.W / 2;
      const shade = k > 0.5 ? '#6b5f48' : '#5a5040';
      rect(g, cx - halfW, y, halfW * 2, 1, shade);
      // path edge stones
      rect(g, cx - halfW, y, 1, 1, '#4a4234');
      rect(g, cx + halfW - 1, y, 1, 1, '#4a4234');
      if ((y % 6) === 0) { rect(g, cx - halfW, y, halfW * 2, 1, '#4f4636'); }
    }

    // distant glowing town gate at the end of the path
    this._drawTownGate(g, this.W / 2, HORIZON);

    // torches framing the path
    drawTorch(g, 170, 204, this.t);
    drawTorch(g, 310, 204, this.t + 1.3);

    // heroes flanking the path, facing the gate
    drawActor(g, { x: 150, y: 232, facing: 1, sprite: 'warrior', weapon: 'sword', state: 'idle', animTime: this.t, scale: 1.4 });
    drawActor(g, { x: 330, y: 232, facing: -1, sprite: 'mage', weapon: 'staff', state: 'idle', animTime: this.t + 0.7, scale: 1.4 });

    // faint grass tufts + rocks in the clearing
    for (let x = 10; x < this.W; x += 34) { if (Math.abs(x - this.W / 2) > 60) { const h = 2 + (x % 3); rect(g, x, this.H - 30 - h, 1, h, '#2a4a30'); } }
  }

  _drawTownGate(g, cx, gy) {
    // warm glow behind the gate
    for (let r = 22; r > 0; r -= 2) { g.globalAlpha = 0.05; disc(g, cx, gy - 8, r, '#f2a03f'); }
    g.globalAlpha = 1;
    // two towers + arch
    rect(g, cx - 12, gy - 22, 5, 22, '#2a2740');
    rect(g, cx + 7, gy - 22, 5, 22, '#2a2740');
    rect(g, cx - 12, gy - 24, 5, 2, '#3a3658');
    rect(g, cx + 7, gy - 24, 5, 2, '#3a3658');
    rect(g, cx - 7, gy - 18, 14, 18, '#22203a');
    // glowing doorway
    rect(g, cx - 4, gy - 13, 8, 13, '#f2b24a');
    rect(g, cx - 3, gy - 11, 6, 11, '#ffd67a');
    // little pennants
    rect(g, cx - 10, gy - 26, 1, 3, '#8a76c8');
    rect(g, cx + 9, gy - 26, 1, 3, '#8a76c8');
  }

  // ---- logo ---------------------------------------------------------------

  _drawLogo(g) {
    const cx = this.W / 2;
    drawEmblem(g, cx, 16, this.t);
    // PIXEL (smaller, gold) above QUEST (larger, red-orange)
    logoWord(g, 'PIXEL', cx, 24, 3, '#f2c94f', '#fff0b0', '#3a2408');
    logoWord(g, 'QUEST', cx, 46, 5, '#e0563c', '#ff9a6a', '#2a0c06');
    // tagline, clearly separated and smaller
    drawText(g, 'TRAIN YOUR HERO  •  BECOME A LEGEND', cx, 90, { color: '#b8b2ce', align: 'center', shadow: '#0a0812' });
  }

  _drawPress(g) {
    if (this.pressAlpha <= 0.01) return;
    g.globalAlpha = clamp01(this.pressAlpha);

    // Chunky 16-bit RPG prompt: cream/gold fill, dark outline, tiny gold
    // drop-shadow — matches the PIXEL QUEST logo's treatment instead of the
    // plain single-shadow style used for regular UI text.
    const scale = 1.6, tracking = 2;
    const arrow = '▶', label = 'PRESS ENTER';
    const gap = 5;
    const arrowW = textWidth(arrow, scale, tracking);
    const labelW = textWidth(label, scale, tracking);
    const totalW = arrowW + gap + labelW;
    const startX = this.W / 2 - totalW / 2;
    const arrowShift = Math.round(Math.sin(this.t * 4.5) * 1.3);

    pressPromptText(g, arrow, startX + arrowW / 2 + arrowShift, PRESS_Y, scale, tracking);
    pressPromptText(g, label, startX + arrowW + gap + labelW / 2, PRESS_Y, scale, tracking);

    g.globalAlpha = 1;
  }

  _drawMenu(g) {
    if (this.menuAlpha <= 0.01) return;
    g.globalAlpha = clamp01(this.menuAlpha);

    const bw = 140, rowH = 15;
    const bh = this.options.length * rowH + 12;
    const bx = this.W / 2 - bw / 2, by = 172;
    panel(g, bx, by, bw, bh, { bg: 'rgba(10,8,20,0.82)' });

    this.options.forEach((opt, i) => {
      const ry = by + 6 + i * rowH;
      const on = i === this.sel;
      if (on) {
        rect(g, bx + 5, ry, bw - 10, rowH - 2, 'rgba(60,48,20,0.6)');
        rectOutline(g, bx + 5, ry, bw - 10, rowH - 2, UI.gold);
        // animated arrow/sword cursor
        const wob = Math.floor(this.t * 6) % 2;
        drawIcon(g, 'sword', bx + 12 + wob, ry + 3);
      }
      drawText(g, opt.toUpperCase(), this.W / 2 + 6, ry + 4, {
        color: on ? '#fff4d0' : '#8f88ab', align: 'center',
        shadow: '#0a0812',
      });
    });
    g.globalAlpha = 1;
  }

  _drawOptions(g) {
    const bw = 180, bh = 92, bx = this.W / 2 - bw / 2, by = this.H / 2 - bh / 2;
    g.fillStyle = 'rgba(6,5,14,0.7)'; g.fillRect(0, 0, this.W, this.H);
    panel(g, bx, by, bw, bh);
    panelTitle(g, bx, by, bw, 'OPTIONS');
    const items = this.hasSave ? ['sound', 'erase', 'back'] : ['sound', 'back'];
    const labels = { sound: 'Sound: ' + (this.soundOn ? 'ON' : 'OFF'), erase: 'Erase Save', back: 'Back' };
    items.forEach((it, i) => {
      const ry = by + 20 + i * 16;
      const on = i === this.optSel;
      if (on) { rect(g, bx + 8, ry, bw - 16, 14, UI.frameDark); rectOutline(g, bx + 8, ry, bw - 16, 14, UI.gold); }
      drawText(g, labels[it], this.W / 2, ry + 4, { color: on ? UI.ink : UI.inkDim, align: 'center' });
    });
    if (this.confirmErase) {
      g.fillStyle = 'rgba(6,5,14,0.85)'; g.fillRect(0, 0, this.W, this.H);
      panel(g, this.W / 2 - 90, this.H / 2 - 22, 180, 44, { frame: UI.bad });
      drawText(g, 'Erase saved hero?', this.W / 2, this.H / 2 - 12, { color: UI.ink, align: 'center' });
      drawText(g, 'J erase    Esc cancel', this.W / 2, this.H / 2 + 2, { color: UI.inkDim, align: 'center' });
    }
  }

  _drawCredits(g) {
    const bw = 220, bh = 110, bx = this.W / 2 - bw / 2, by = this.H / 2 - bh / 2;
    g.fillStyle = 'rgba(6,5,14,0.7)'; g.fillRect(0, 0, this.W, this.H);
    panel(g, bx, by, bw, bh);
    panelTitle(g, bx, by, bw, 'CREDITS');
    const lines = [
      'PIXEL QUEST',
      'An educational action RPG.',
      '',
      'Design & code: You',
      'Engine: hand-rolled Canvas + WebAudio',
      'Art: procedural pixel sprites',
      '',
      'Train your hero. Become a legend.',
    ];
    lines.forEach((l, i) => drawText(g, l, this.W / 2, by + 18 + i * 11, { color: i === 0 ? UI.gold : UI.inkDim, align: 'center' }));
    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (blink) drawText(g, 'Esc / J  back', this.W / 2, by + bh - 10, { color: UI.gold, align: 'center' });
  }
}

// ---- logo helpers ---------------------------------------------------------

const OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];

// Draw a word with a dark pixel outline, a top highlight, and a main fill.
function logoWord(g, str, cx, topY, scale, main, hi, outline) {
  for (const [dx, dy] of OUTLINE) drawText(g, str, cx + dx, topY + dy, { color: outline, scale, align: 'center', tracking: 1 });
  drawText(g, str, cx, topY, { color: hi, scale, align: 'center', tracking: 1 });          // highlight underneath
  drawText(g, str, cx, topY + 1, { color: main, scale, align: 'center', tracking: 1 });     // main, 1px down -> top edge stays bright
}

// Chunky retro-RPG prompt text: dark outline + tiny gold drop-shadow behind
// a warm cream/gold fill, in the same family as the logo's treatment but
// without the top highlight (so it reads as a prompt, not a title).
const PRESS_OUTLINE = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
function pressPromptText(g, str, cx, topY, scale, tracking) {
  drawText(g, str, cx + 2, topY + 2, { color: '#b8862c', scale, align: 'center', tracking }); // tiny gold shadow
  for (const [dx, dy] of PRESS_OUTLINE) drawText(g, str, cx + dx, topY + dy, { color: '#2a1c08', scale, align: 'center', tracking });
  drawText(g, str, cx, topY, { color: '#f4dfa0', scale, align: 'center', tracking });
}

// Small crossed-sword-and-open-book emblem (reusable icon placeholder).
function drawEmblem(g, cx, cy, t) {
  g.globalAlpha = 0.22 + Math.sin(t * 2) * 0.05; disc(g, cx, cy + 3, 11, '#4a3f86'); g.globalAlpha = 1;
  const by = cy + 2;
  for (let i = 0; i < 6; i++) {
    const w = 8 - i;
    rect(g, cx - 1 - w, by + i, w, 1, i < 1 ? '#c9b98a' : '#e8dcb8');
    rect(g, cx + 1, by + i, w, 1, i < 1 ? '#c9b98a' : '#e8dcb8');
  }
  rect(g, cx - 1, by - 1, 2, 8, '#8a6a3a');
  rect(g, cx - 7, by + 2, 5, 1, '#b8a878'); rect(g, cx - 7, by + 4, 5, 1, '#b8a878');
  rect(g, cx + 3, by + 2, 5, 1, '#b8a878'); rect(g, cx + 3, by + 4, 5, 1, '#b8a878');
  // sword crossing diagonally over the book
  for (let i = 0; i < 18; i++) rect(g, cx - 8 + i, cy + 9 - i, 1, 1, (i > 3 && i < 15) ? '#dfe6f2' : '#9aa3b8');
  rect(g, cx - 6, cy + 5, 5, 1, '#f2c94f');   // guard
  rect(g, cx - 9, cy + 8, 3, 3, '#8a6a2f');   // handle
  rect(g, cx + 9, cy - 9, 1, 1, '#ffffff');   // tip glint
}

function mountain(g, x, baseY, w, h, color) {
  g.fillStyle = color;
  for (let i = 0; i < h; i++) { const k = i / h; const rw = Math.round(w * (1 - Math.pow(1 - k, 1.4)) * 0.5); rect(g, x - rw, baseY - h + i, rw * 2, 1, color); }
}

function darkPine(g, x, y, h, color) {
  for (let t = 0; t < 3; t++) {
    const ty = y - (h / 3) * (t + 1);
    const tw = 6 - t * 2;
    for (let i = 0; i < h / 3; i++) { const k = i / (h / 3); const rw = Math.round(tw * (0.3 + k * 0.7)); rect(g, x - rw, ty + i, rw * 2, 1, color); }
  }
}

// ---------------------------------------------------------------- class select

export class ClassSelectScene {
  constructor(onStart) { this.onStart = onStart; }

  enter(game) {
    this.game = game; this.W = game.width; this.H = game.height;
    this.t = 0;
    this.classes = Object.values(CLASSES);
    this.sel = 0;
    this.particles = new Particles();
  }

  update(dt) {
    this.t += dt;
    this.particles.update(dt);
    if (Input.repeated('left')) { this.sel = (this.sel + this.classes.length - 1) % this.classes.length; Audio.select(); }
    if (Input.repeated('right')) { this.sel = (this.sel + 1) % this.classes.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'light', 'interact')) {
      Audio.confirm();
      const hero = Hero.create(this.classes[this.sel].id);
      hero.save();
      this.onStart(hero);
    }
    if (Input.pressed('back') || Input.pressed('menu')) { this.game.setScene(new TitleScene(this.onStart)); Audio.deny(); }
  }

  draw(g) {
    rect(g, 0, 0, this.W, this.H, '#0b0a14');
    for (let i = 0; i < 5; i++) rect(g, 0, i * 54, this.W, 1, '#141020');
    heading(g, this.W, 8, 'CHOOSE YOUR CLASS', { scale: 2 });

    // Carousel: the selected card stays centred and neighbours peek in from the
    // sides, so any number of classes fits the 480px viewport.
    const cardW = 150, gap = 16;
    const startX = this.W / 2 - cardW / 2 - this.sel * (cardW + gap);
    const cy = 36, cardH = 200;

    this.classes.forEach((cls, i) => {
      const cx = startX + i * (cardW + gap);
      const on = i === this.sel;
      panel(g, cx, cy, cardW, cardH, { frame: on ? cls.color : UI.frame, bg: on ? '#120f1e' : UI.bg });
      if (on) rect(g, cx + 2, cy + 2, cardW - 4, 2, cls.color);

      drawText(g, cls.name.toUpperCase(), cx + cardW / 2, cy + 8, { color: cls.color, align: 'center', scale: 2, shadow: '#000' });

      const sx = cx + cardW / 2, sy = cy + 76;
      g.globalAlpha = 0.3; disc(g, sx, sy + 2, 20, cls.color); g.globalAlpha = 1;
      // drawCharacter, not drawActor: it routes a class whose sprite id is
      // registered in gfx/spriteCatalog.js to its sheet and falls straight back
      // to the procedural renderer for every id that is not.
      //
      // `dir: 'down'` picks the three-quarter FRONT view. Without it the card
      // falls through to the un-suffixed animation, which is the side art, and
      // the roster introduces every class in profile -- a row of people looking
      // away from you while you pick one.
      drawCharacter(g, { x: sx, y: sy, facing: 1, dir: 'down', sprite: cls.sprite, weapon: cls.weapon, state: 'idle', animTime: this.t + i, scale: 1.6 });

      rect(g, cx + 8, cy + 92, cardW - 16, 9, UI.frameDark);
      drawText(g, 'RESOURCE: ' + cls.resource.toUpperCase(), cx + 12, cy + 93, { color: cls.resourceColor });

      const words = cls.blurb.split(' ');
      let line = '', ly = cy + 106;
      for (const w of words) {
        if (textWidth(line + ' ' + w) > cardW - 16) { drawText(g, line, cx + 8, ly, { color: UI.inkDim }); line = w; ly += 9; if (ly > cy + 132) break; }
        else line = line ? line + ' ' + w : w;
      }
      if (ly <= cy + 132) drawText(g, line, cx + 8, ly, { color: UI.inkDim });

      let ay = cy + 146;
      abilitiesForClass(cls.id).slice(0, 4).forEach((ab) => {
        drawIcon(g, ab.icon, cx + 10, ay);
        drawText(g, ab.name, cx + 22, ay + 1, { color: on ? UI.ink : UI.inkDim });
        ay += 12;
      });
    });

    const cls = this.classes[this.sel];
    drawText(g, `${cls.name}: trains any subject - your studies shape a unique build.`, this.W / 2, this.H - 22, { color: UI.inkDim, align: 'center' });
    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (blink) drawText(g, '←  →  choose      J  begin      Esc  back', this.W / 2, this.H - 10, { color: UI.gold, align: 'center' });
  }
}
