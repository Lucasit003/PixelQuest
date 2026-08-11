// Training Grounds: pick an academic LEVEL and CATEGORY, then answer adaptive
// questions. Correct answers grant Training XP (-> hero XP) and Mastery, which
// unlocks abilities. This is the ONLY place abilities are unlocked. Combat never
// asks a question — that boundary is the whole point.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth, wrapText } from '../gfx/font.js';
import { panel, panelTitle, bar, heading, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, clamp01, lerp } from '../gfx/pixel.js';
import { drawIcon } from '../gfx/props.js';
import { drawActor } from '../gfx/actors.js';
import { drawDummy, drawTorch } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { LEVELS, CATEGORIES, ABILITIES, masteryGain, trainingXp } from '../game/data.js';
import { AdaptiveSession } from '../academics/adaptive.js';

const PHASE = { PICK_LEVEL: 0, PICK_CAT: 1, QUIZ: 2, RESULT: 3, SUMMARY: 4 };

export class TrainingScene {
  constructor(hero, onExit) {
    this.hero = hero;
    this.onExit = onExit;
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.phase = PHASE.PICK_LEVEL;
    this.levelIdx = 0;
    this.catIdx = 0;
    this.sel = 0;
    this.toasts = new Toasts();
    this.particles = new Particles();
    this.t = 0;
    this.reveal = 0;
    this.session = null;
    this.q = null;
    this.answerIdx = 0;
    this.result = null;
    this.resultTimer = 0;
    this.sessionStats = { xp: 0, mastery: 0, unlocked: [], answered: 0, correct: 0 };
    this.hero.hurtActor = { sprite: hero => 0 };
    this.numericMode = false;
  }

  exit() { Input.endTextCapture(); }

  update(dt, game) {
    this.t += dt;
    this.toasts.update(dt);
    this.particles.update(dt);

    switch (this.phase) {
      case PHASE.PICK_LEVEL: this._updatePickLevel(); break;
      case PHASE.PICK_CAT: this._updatePickCat(); break;
      case PHASE.QUIZ: this._updateQuiz(dt); break;
      case PHASE.RESULT: this._updateResult(dt); break;
      case PHASE.SUMMARY: this._updateSummary(); break;
    }
  }

  // ---------------------------------------------------------- pick level

  _updatePickLevel() {
    if (Input.repeated('up')) { this.levelIdx = (this.levelIdx + LEVELS.length - 1) % LEVELS.length; Audio.select(); }
    if (Input.repeated('down')) { this.levelIdx = (this.levelIdx + 1) % LEVELS.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      Audio.confirm();
      this.phase = PHASE.PICK_CAT;
      this.catIdx = 0;
    }
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this._leave(); }
  }

  // ------------------------------------------------------------ pick cat

  _updatePickCat() {
    const cols = 2;
    if (Input.repeated('up')) { this.catIdx = (this.catIdx + CATEGORIES.length - cols) % CATEGORIES.length; Audio.select(); }
    if (Input.repeated('down')) { this.catIdx = (this.catIdx + cols) % CATEGORIES.length; Audio.select(); }
    if (Input.repeated('left')) { this.catIdx = (this.catIdx + CATEGORIES.length - 1) % CATEGORIES.length; Audio.select(); }
    if (Input.repeated('right')) { this.catIdx = (this.catIdx + 1) % CATEGORIES.length; Audio.select(); }
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      Audio.confirm();
      this._startSession();
    }
    if (Input.pressed('menu') || Input.pressed('back')) { Audio.deny(); this.phase = PHASE.PICK_LEVEL; }
  }

  _startSession() {
    const cat = CATEGORIES[this.catIdx].id;
    const level = LEVELS[this.levelIdx].id;
    this.session = new AdaptiveSession(this.hero, cat, level);
    this.sessionStats = { xp: 0, mastery: 0, unlocked: [], answered: 0, correct: 0 };
    this._nextQuestion();
    this.phase = PHASE.QUIZ;
  }

  _nextQuestion() {
    this.q = this.session.next();
    this.answerIdx = 0;
    this.reveal = 0;
    this.numericMode = !!this.q.numeric;
    if (this.numericMode) { Input.beginTextCapture(); Input.text = ''; }
    else Input.endTextCapture();
  }

  // --------------------------------------------------------------- quiz

  _updateQuiz(dt) {
    this.reveal = Math.min(1, this.reveal + dt * 2.5);

    if (Input.pressed('menu')) { Audio.deny(); Input.endTextCapture(); this._finishSession(); return; }

    if (this.numericMode) {
      if (Input.pressed('confirm')) {
        this._submit(Input.text);
      }
    } else {
      const n = this.q.presentedChoices.length;
      if (Input.repeated('up')) { this.answerIdx = (this.answerIdx + n - 1) % n; Audio.select(); }
      if (Input.repeated('down')) { this.answerIdx = (this.answerIdx + 1) % n; Audio.select(); }
      if (Input.pressed('slot1')) this.answerIdx = 0;
      if (Input.pressed('slot2') && n > 1) this.answerIdx = 1;
      if (Input.pressed('slot3') && n > 2) this.answerIdx = 2;
      if (Input.pressed('slot4') && n > 3) this.answerIdx = 3;
      if (Input.anyPressed('confirm', 'interact', 'light')) {
        this._submit(this.answerIdx);
      }
    }
  }

  _submit(response) {
    Input.endTextCapture();
    const res = this.session.grade(this.q, response);
    const level = LEVELS[this.levelIdx].id;
    const cat = CATEGORIES[this.catIdx].id;

    this.sessionStats.answered++;
    this.hero.s.stats.questionsAnswered++;

    if (res.correct) {
      this.hero.s.stats.correctAnswers++;
      this.sessionStats.correct++;
      Audio.correct();

      // XP with pet + streak bonuses
      let xp = trainingXp(level, true, res.streak);
      xp = Math.round(xp * (1 + this.hero.petBonus('trainXp')));
      const leveled = this.hero.addXp(xp);
      this.sessionStats.xp += xp;

      // Mastery -> may unlock abilities
      const gain = masteryGain(level, true);
      const unlocked = this.hero.addMastery(cat, level, gain);
      this.sessionStats.mastery += gain;
      if (unlocked.length) {
        this.sessionStats.unlocked.push(...unlocked);
        Audio.unlock();
      }

      this.particles.magicBurst(this.W / 2, 70, CATEGORIES[this.catIdx].color, 16);
      this.toasts.push(`+${xp} XP`, this.W / 2, 60, UI.xp, { crit: res.streak >= 3 });
      this.toasts.push(`+${gain.toFixed(0)} Mastery`, this.W / 2 + 40, 80, CATEGORIES[this.catIdx].color, { life: 1.1 });

      this.result = { correct: true, leveled, unlocked, streak: res.streak };
    } else {
      Audio.wrong();
      const xp = trainingXp(level, false, 0);
      this.hero.addXp(xp);
      this.sessionStats.xp += xp;
      const gain = masteryGain(level, false);
      this.hero.addMastery(cat, level, gain);
      this.result = { correct: false, unlocked: [] };
    }

    this.phase = PHASE.RESULT;
    this.resultTimer = 0;
  }

  // ------------------------------------------------------------- result

  _updateResult(dt) {
    this.resultTimer += dt;
    const advance = Input.anyPressed('confirm', 'interact', 'light') || this.resultTimer > 2.4;
    if (advance && this.resultTimer > 0.35) {
      // End the session after ~8 questions or when the player quits.
      if (this.sessionStats.answered >= 8) {
        this._finishSession();
      } else {
        this._nextQuestion();
        this.phase = PHASE.QUIZ;
      }
    }
  }

  _finishSession() {
    this.hero.save();
    this.phase = PHASE.SUMMARY;
    this.resultTimer = 0;
    if (this.sessionStats.unlocked.length) this.particles.levelStars(this.W / 2, this.H / 2);
  }

  _updateSummary() {
    if (Input.anyPressed('confirm', 'interact', 'light', 'menu') && this.t > 0.3) {
      Audio.confirm();
      this.phase = PHASE.PICK_LEVEL;
    }
  }

  _leave() {
    this.hero.save();
    if (this.onExit) this.onExit();
  }

  // ============================================================= drawing

  draw(g) {
    this._drawBackground(g);
    switch (this.phase) {
      case PHASE.PICK_LEVEL: this._drawPickLevel(g); break;
      case PHASE.PICK_CAT: this._drawPickCat(g); break;
      case PHASE.QUIZ: this._drawQuiz(g); break;
      case PHASE.RESULT: this._drawQuiz(g); this._drawResult(g); break;
      case PHASE.SUMMARY: this._drawSummary(g); break;
    }
    this.particles.draw(g);
    this.toasts.draw(g);
  }

  _drawBackground(g) {
    // training grounds: warm dusk sky + sand floor
    for (let i = 0; i < 6; i++) {
      const c = ['#2a2447', '#332a52', '#3d305c', '#4a3862', '#5c4468', '#6b4a5c'][i];
      rect(g, 0, i * 26, this.W, 27, c);
    }
    rect(g, 0, this.H - 70, this.W, 70, '#8a6f4a');
    rect(g, 0, this.H - 70, this.W, 3, '#9a805a');
    for (let x = 0; x < this.W; x += 12) rect(g, x, this.H - 60, 2, 1, '#7a6040');
    // hero practicing + a dummy
    drawActor(g, {
      x: 70, y: this.H - 30, facing: 1, sprite: this.hero.cls().sprite,
      weapon: this.hero.weaponSprite(), state: 'idle', animTime: this.t,
    });
    drawDummy(g, 130, this.H - 30, this.t);
    drawTorch(g, 20, this.H - 40, this.t);
    drawTorch(g, this.W - 20, this.H - 40, this.t + 1.3);
  }

  _drawPickLevel(g) {
    heading(g, this.W, 16, 'TRAINING GROUNDS');
    drawText(g, 'Choose your academic level', this.W / 2, 36, { color: UI.inkDim, align: 'center' });

    const bx = this.W / 2 - 90, by = 52, bw = 180, rh = 30;
    panel(g, bx, by, bw, LEVELS.length * rh + 8);
    LEVELS.forEach((lv, i) => {
      const ry = by + 4 + i * rh;
      const on = i === this.levelIdx;
      if (on) { rect(g, bx + 3, ry, bw - 6, rh - 2, UI.frameDark); rectOutline(g, bx + 3, ry, bw - 6, rh - 2, lv.color); }
      rect(g, bx + 8, ry + 6, 14, 14, lv.color);
      rectOutline(g, bx + 8, ry + 6, 14, 14, '#000');
      drawText(g, lv.short, bx + 15, ry + 9, { color: '#000', align: 'center' });
      drawText(g, lv.name, bx + 28, ry + 5, { color: on ? UI.ink : UI.inkDim });
      drawText(g, lv.tier, bx + 28, ry + 15, { color: lv.color, scale: 1 });
      // overall mastery at this level
      let m = 0;
      for (const c of CATEGORIES) m += this.hero.s.mastery[c.id][lv.id];
      m = Math.round(m / CATEGORIES.length);
      drawText(g, `${m}%`, bx + bw - 8, ry + 9, { color: UI.gold, align: 'right' });
    });

    drawText(g, 'W/S move   J/Enter select   Esc leave', this.W / 2, this.H - 10, { color: UI.inkDim, align: 'center' });
  }

  _drawPickCat(g) {
    const lv = LEVELS[this.levelIdx];
    heading(g, this.W, 14, 'CHOOSE SUBJECT', { scale: 2 });
    drawText(g, lv.name + ' — ' + lv.tier, this.W / 2, 34, { color: lv.color, align: 'center' });

    const cols = 2, cellW = 200, cellH = 26, gap = 6;
    const gridW = cols * cellW + gap;
    const bx = this.W / 2 - gridW / 2, by = 48;
    CATEGORIES.forEach((c, i) => {
      const cx = bx + (i % cols) * (cellW + gap);
      const cy = by + Math.floor(i / cols) * (cellH + gap);
      const on = i === this.catIdx;
      panel(g, cx, cy, cellW, cellH, { frame: on ? c.color : UI.frame });
      if (on) rect(g, cx + 2, cy + 2, cellW - 4, 1, c.color);
      rect(g, cx + 5, cy + 7, 12, 12, c.color);
      rectOutline(g, cx + 5, cy + 7, 12, 12, '#000');
      drawText(g, c.name, cx + 22, cy + 5, { color: on ? UI.ink : UI.inkDim });
      const m = Math.round(this.hero.s.mastery[c.id][lv.id]);
      bar(g, cx + 22, cy + 16, m, 100, { w: cellW - 60, h: 5, color: c.color });
      drawText(g, `${m}%`, cx + cellW - 6, cy + 15, { color: UI.gold, align: 'right' });
    });

    drawText(g, 'Arrows move   J/Enter start   Esc back', this.W / 2, this.H - 10, { color: UI.inkDim, align: 'center' });
  }

  _drawQuiz(g) {
    const cat = CATEGORIES[this.catIdx];
    const lv = LEVELS[this.levelIdx];

    // top status ribbon
    rect(g, 0, 0, this.W, 14, '#160f26');
    drawText(g, `${lv.short} - ${cat.name}`, 6, 4, { color: cat.color });
    drawText(g, `${this.session.tierLabel()}`, this.W / 2, 4, { color: UI.inkDim, align: 'center' });
    drawText(g, `Q ${this.sessionStats.answered + 1}/8`, this.W - 6, 4, { color: UI.gold, align: 'right' });

    // question panel
    const bx = 20, bw = this.W - 40, by = 22, bh = this.q.numeric ? 66 : 60;
    panel(g, bx, by, bw, bh);
    const qlines = wrapText(this.q.q, bw - 16);
    qlines.forEach((line, i) => {
      const shown = this.reveal >= 1 ? line : line.slice(0, Math.floor(line.length * this.reveal * qlines.length - i * line.length));
      drawText(g, this.reveal >= 1 ? line : shown, bx + 8, by + 8 + i * 10, { color: UI.ink });
    });
    if (this.q.hint) drawText(g, '(' + this.q.hint + ')', bx + 8, by + bh - 12, { color: UI.inkDim });

    // answers
    const ay = by + bh + 8;
    if (this.q.numeric) {
      const iw = 160, ih = 20;
      const ix = this.W / 2 - iw / 2;
      panel(g, ix, ay + 6, iw, ih, { frame: cat.color });
      const txt = Input.text || '';
      const blink = (Math.floor(this.t * 2) % 2) === 0;
      drawText(g, txt + (blink ? '_' : ' '), ix + 8, ay + 12, { color: UI.ink, scale: 1 });
      drawText(g, 'Type your answer, then press Enter', this.W / 2, ay + 32, { color: UI.inkDim, align: 'center' });
    } else {
      const n = this.q.presentedChoices.length;
      const cols = n > 3 ? 2 : 1;
      const cw = cols === 2 ? (this.W - 60) / 2 : this.W - 60;
      const ch = 18;
      this.q.presentedChoices.forEach((choice, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx = 30 + col * (cw + 4);
        const cy = ay + row * (ch + 4);
        const on = i === this.answerIdx;
        panel(g, cx, cy, cw, ch, { frame: on ? cat.color : UI.frame, bg: on ? UI.bgLite : UI.bg });
        drawText(g, `${i + 1}`, cx + 5, cy + 6, { color: on ? cat.color : UI.inkDim });
        drawText(g, choice, cx + 16, cy + 6, { color: on ? UI.ink : UI.inkDim });
        if (on) { const wob = Math.sin(this.t * 8) > 0 ? 0 : 1; drawText(g, '>', cx - 3 + wob, cy + 6, { color: cat.color }); }
      });
    }
  }

  _drawResult(g) {
    const ok = this.result.correct;
    const bw = 200, bh = 54;
    const bx = this.W / 2 - bw / 2, by = this.H / 2 - bh / 2;
    // dim
    g.fillStyle = 'rgba(8,6,16,0.55)'; g.fillRect(0, 0, this.W, this.H);
    panel(g, bx, by, bw, bh, { frame: ok ? UI.good : UI.bad });
    heading(g, this.W, by + 6, ok ? 'CORRECT!' : 'NOT QUITE', { color: ok ? UI.good : UI.bad, scale: 2 });

    if (ok) {
      let msg = this.result.streak >= 3 ? `Streak x${this.result.streak}! Mastery climbing.` : 'Well reasoned.';
      drawText(g, msg, this.W / 2, by + 26, { color: UI.ink, align: 'center' });
      if (this.result.leveled > 0) drawText(g, `LEVEL UP! Now level ${this.hero.s.level}`, this.W / 2, by + 38, { color: UI.gold, align: 'center' });
      else if (this.result.unlocked.length) {
        const ab = ABILITIES[this.result.unlocked[0]];
        drawText(g, `New ability: ${ab.name}!`, this.W / 2, by + 38, { color: '#a56bd9', align: 'center' });
      } else drawText(g, `+${trainingXp(LEVELS[this.levelIdx].id, true, this.result.streak)} training XP`, this.W / 2, by + 38, { color: UI.xp, align: 'center' });
    } else {
      // show the correct answer as a teaching moment
      let correctText;
      if (this.q.numeric) correctText = `Answer: ${this.q.answer}`;
      else correctText = `Answer: ${this.q.presentedChoices[this.q.answerIndex]}`;
      drawText(g, correctText, this.W / 2, by + 28, { color: UI.ink, align: 'center' });
      drawText(g, 'Dropping to targeted practice.', this.W / 2, by + 40, { color: UI.inkDim, align: 'center' });
    }
  }

  _drawSummary(g) {
    g.fillStyle = 'rgba(8,6,16,0.7)'; g.fillRect(0, 0, this.W, this.H);
    const bw = 220, bh = 130;
    const bx = this.W / 2 - bw / 2, by = this.H / 2 - bh / 2;
    panel(g, bx, by, bw, bh);
    panelTitle(g, bx, by, bw, 'SESSION COMPLETE');

    const s = this.sessionStats;
    const acc = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
    let y = by + 14;
    const line = (label, val, col) => { drawText(g, label, bx + 12, y, { color: UI.inkDim }); drawText(g, val, bx + bw - 12, y, { color: col || UI.ink, align: 'right' }); y += 12; };
    line('Questions', `${s.answered}`);
    line('Accuracy', `${acc}%`, acc >= 70 ? UI.good : acc >= 40 ? UI.gold : UI.bad);
    line('Training XP', `+${s.xp}`, UI.xp);
    line('Mastery gained', `+${s.mastery.toFixed(0)}`, CATEGORIES[this.catIdx].color);
    line('Hero level', `${this.hero.s.level}`, UI.gold);

    if (s.unlocked.length) {
      y += 4;
      drawText(g, 'ABILITIES UNLOCKED:', bx + 12, y, { color: '#a56bd9' }); y += 11;
      for (const id of s.unlocked) {
        drawIcon(g, ABILITIES[id].icon, bx + 14, y - 1);
        drawText(g, ABILITIES[id].name, bx + 26, y, { color: UI.ink }); y += 10;
      }
    } else {
      y += 4;
      drawText(g, 'Keep training to unlock abilities!', bx + bw / 2, y, { color: UI.inkDim, align: 'center' });
    }

    const blink = (Math.floor(this.t * 2) % 2) === 0;
    if (blink) drawText(g, 'Press J to continue', this.W / 2, by + bh - 10, { color: UI.gold, align: 'center' });
  }
}
