// The dungeon: a Castle-Crashers-style 2.5D beat-'em-up. The arena has depth
// (actors move on an x/depth plane and are y-sorted) plus a z axis for jumping.
// Combat is pure action — light/heavy combos, knockback, juggling, dodge, jump
// attacks and the trained abilities. NO questions ever appear here.
//
// Flow: forest waves -> mini-boss (Bone Archer + skeletons) -> Goblin King with
// four phases -> loot. The camera scrolls as the player clears each gate.

import { Input, FACE_DEADZONE } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, bar, heading, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, clamp, clamp01, lerp, disc, shadow } from '../gfx/pixel.js';
import { drawCharacter, actorHeight, drawPet } from '../gfx/actors.js';
// The Thorn King's approved artwork, cut from assets/goblinking.png. He is NOT
// drawn through the actor sprite system: `sprite: 'king'` is a hand-coded pixel
// grid in actors.js that was only ever a placeholder, and nothing about the
// approved design survives being squeezed into it. Every pose here shares one
// character scale taken from the standing figure, so his proportions cannot
// drift between poses.
// The step edge in front of the throne seat, in arena-plate pixels. Tuned so it
// covers his shins and the foot of the mantle without eating his knees.
const THRONE_FG = { x: 470, y: 138, w: 105, h: 52 };

const THORN_ART = {};
for (const [k, f] of Object.entries({
  throne:  'assets/actors/thornking_throne_side.png',
  p1:      'assets/actors/thornking_p1.png',
  p2:      'assets/actors/thornking_p2.png',
  kneel:   'assets/actors/thornking_kneel.png',
  cleaver: 'assets/actors/thornking_cleaver.png',
})) { const im = new Image(); im.src = f; THORN_ART[k] = im; }

// Animation strips, one per state, generated from the same rig as the cutscene
// so he is the same character standing still, walking and swinging. Each strip
// is a row of frames; FRAME_W/H and the ground line inside them are fixed, so
// placing him is just "put the ground line on his feet".
const THORN_FRAME_H = 148, THORN_GROUND = 121;
// World px covered by one full walk cycle, measured off the packed strip: a
// planted foot sweeps backward through the frame by exactly the distance the
// body travels during that foot's stance, so cycle = sweep / stance fraction
// (~0.62). Measured sweep is 39px, giving 63. Getting this wrong is precisely
// what reads as skating — too large and the legs cycle slower than he moves.
const THORN_STRIDE = 63;
// Frame width and body centre are PER STRIP. The swings were drawn rather than
// rigged, and a cleaver arc sweeps far outside the body, so those strips carry
// a wider frame than the standing ones — `cx` is where his feet are inside it,
// which is all the draw needs to line every strip up on the same spot.
const THORN_ANIM = {};
for (const [k, spec] of Object.entries({
  idle:   { n: 8,  w: 107, cx: 58 },
  walk:   { n: 8,  w: 107, cx: 58 },
  attack: { n: 14, w: 107, cx: 58 },
  hurt:   { n: 8,  w: 107, cx: 58 },
  summon: { n: 12, w: 107, cx: 58 },
})) {
  const im = new Image();
  im.src = `assets/actors/thornking_${k}.png`;
  THORN_ANIM[k] = { img: im, ...spec };
}

import { ThornCinematic, drawLetterbox, drawCinematicLine, drawCinematicGrade,
         drawRoots, drawEye, drawFloorFracture } from '../gfx/thornCinematic.js';
import { COMBAT_ACTOR_SCALE } from '../gfx/actorScale.js';
import { drawIcon, drawPineTree, drawBush, drawTorch, drawStoneFloor, drawRock } from '../gfx/props.js';
import { drawForestArena, drawArenaSlice } from '../gfx/forestArena.js';
import { Particles } from '../gfx/particles.js';
import { Cutscene } from '../gfx/cutscene.js';
import { resolveFx, playAbilityFx, CLASS_FX } from '../gfx/abilityFx.js';
import { rand, randInt, chance, pick, weighted } from '../core/rng.js';
import {
  ENEMIES, BOSS, WEAPONS, ABILITIES, RARITY, PETS,
} from '../game/data.js';
import {
  meleeBaseDamage, meleeKnockback, finalHitDamage, abilityBaseDamage,
  enemyDamageAfterDefense, playerDamageAfterDefense, absorbWithShield,
  bossPhaseIndex, CHAIN_FALLOFF, chainTargets, CHAIN_HOP_RANGE, abilityPower,
} from '../game/combatMath.js';
import {
  MOMENTUM_DECAY, MOMENTUM_PER_STACK, MOMENTUM_FINISHER_PER_STACK,
  momentumGain, addMomentum, momentumMultiplier,
  FLOW_DECAY, addFlow, flowMultiplier,
  EXPOSED_DUR, critChanceAgainst, exposureMultiplier, poisonTick,
  MARK_DUR, markMultiplier,
  bankGuard, spendGuard,
  rageMultiplier, selfDamageAllowed, executeMultiplier,
  TOTEM_LIMIT, makeTotem, totemTick, totemPlacement,
} from '../game/classMechanics.js';
import { resolveBehavior, tuningFor } from '../game/enemyBehaviors.js';

// Arena depth band (the "floor" the actors walk on).
const DEPTH_MIN = 150;
const DEPTH_MAX = 250;

// Render-only scale bump for actors so they read clearly in the arena. Collision
// math still uses the unscaled reach/width constants — this only affects drawing.
// The value now comes from gfx/actorScale.js so town and combat stay in step;
// it was a bare 1.4 before the heroes were scaled up for detail.
const ACTOR_SCALE = COMBAT_ACTOR_SCALE;

// How long an enemy keeps its 'attack' pose after committing to a swing. This
// is an ANIMATION length, not a combat one — it must stay well under the
// shortest attackCd (1.2s, the skeleton) so it can never delay a swing, and it
// exists so a sprite attack animation can actually finish. Per-enemy override:
// put `attackAnim` in that enemy's ENEMIES entry.
const ATTACK_ANIM_HOLD = 0.25;

// Stable pseudo-random in [0,1) from a world coordinate, for placing terrain
// detail that doesn't flicker as the camera scrolls.
function hash(x) {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export class CombatScene {
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
    this.camX = 0;
    this.worldEnd = 1400;          // total scroll length to the boss arena
    this.enemies = [];
    this.projectiles = [];
    this.totems = [];   // Summoner: placed, stationary, expire on their own
    this.drops = [];
    this.hitStop = 0;              // freeze frames on big hits
    this.slowmo = 0;
    this.message = null; this.messageT = 0; this.messageSub = null; this.messageDur = 1;
    this.bossIntroT = 0;   // counts down while the Goblin King walks in
    this.state = 'play';          // play | victory | defeat | reward
    this.rewardData = null;
    this.rewardTimer = 0;

    // Presentation state: contextual tutorial prompts + wave tracking. The
    // opening box teaches move/attack, then single tips reveal as mechanics
    // become relevant, then never nag again.
    this.tutorialBox = { lines: ['WASD  -  MOVE', 'J  -  LIGHT ATTACK', 'K  -  HEAVY ATTACK'], t: 0, dur: 5.5 };
    this.tips = [
      { at: 6.5, text: 'SHIFT  -  DODGE', shown: false },
      { at: 9.5, text: 'SPACE  -  JUMP', shown: false },
      { at: 12.5, text: '1-4  -  ABILITIES', shown: false },
    ];
    this.activeTip = null; this.activeTipT = 0;
    this.awaitingArena = false; this.arenaPrompt = false; this.inArena = false;
    this.cine = null; this.phase2 = false;
    this.cut = null;
    this.waveNum = 0; this.waveTotal = 0;
    this.clearFlash = 0;

    // The player entity mirrors hero stats but tracks live combat state.
    const h = this.hero;
    this.p = {
      x: 100, depth: 200, z: 0, vz: 0,
      facing: 1, sprite: h.cls().sprite, weapon: h.weaponSprite(),
      state: 'idle', animTime: 0, animDuration: 0,
      hp: h.s.hp, maxHp: h.maxHp, mana: h.s.mana, maxMana: h.maxMana,
      flash: 0, invuln: 0, comboStep: 0, comboTimer: 0,
      attackTimer: 0, hitList: new Set(),
      cooldowns: {}, buffs: {},
      dodgeTimer: 0, dodgeCd: 0, speed: h.speed,
      ghostHp: h.s.hp / h.maxHp, dispMana: h.s.mana, manaPulse: 0,
      // Stamina is a light action pool shown as the 3rd HUD bar. It regenerates
      // and is nudged by dodge/heavy/jump for feedback, but never gates actions,
      // so combat balance is unchanged.
      sta: 100, maxSta: 100, dispSta: 100, staPulse: 0,
      // Class signature resources. Each is one number the loop already ticks —
      // there is no passive framework behind these. A class that does not use
      // its resource simply leaves it at zero.
      momentum: 0, momentumT: 0,   // Warrior: built by landing hits, spent by Sundering Blow
      flow: 0, flowT: 0,           // Mage: built by Ember Dart, spent by Fireball / Barrage
      guard: 0,                    // Paladin: damage the Guard absorbed, owed back as holy
      primedExposed: false,        // Rogue: Vanish doubles the next Backstab's opening
      trail: [],
      isPlayer: true,
    };

    // Handed to every enemy behavior each frame. The vector fields are refilled
    // per enemy in _updateEnemies; the rest are the world actions a behavior is
    // allowed to take, so archetypes never reach into the scene themselves.
    this._aiContext = {
      dt: 0, dx: 0, ddepth: 0, dist: 0,
      p: this.p,
      clampDepth: (d) => clamp(d, DEPTH_MIN, DEPTH_MAX),
      tryMelee: (e) => this._enemyTryMelee(e, this._aiContext.dt),
      shoot: (e) => this._enemyShoot(e),
    };

    // Gate progression: each gate spawns a wave; clearing it scrolls the camera.
    this._buildGates();
    this.currentGate = 0;
    this._spawnGate(0); // sets the "WAVE 1 / 3 ENEMIES" banner
    Audio.door();
  }

  _buildGates() {
    // x positions along the world where a wave must be cleared before the camera
    // advances. The last is the boss.
    this.gates = [
      { x: 220, spawns: [['goblin', 2], ['slime', 1]] },
      { x: 480, spawns: [['goblin', 2], ['slime', 2]] },
      { x: 740, spawns: [['skeleton', 2], ['goblin', 1]] },
      // Three waves through the wood, then the hall. The mini-boss wave that
      // used to sit at 980 is gone: the walk now ends at the keep gate, and the
      // king is fought inside rather than in a fourth stretch of forest.
      { x: 1240, boss: 'goblin_king', arena: true },
    ];
  }

  _spawnGate(i) {
    const gate = this.gates[i];
    if (!gate) return;
    this.gateCleared = false;
    if (gate.boss) {
      this._spawnBoss(gate.boss);
      // The title and the roar land when he reaches the clearing, not at the
      // instant he spawns off-screen. _updateBossIntro fires them.
      this.bossIntroT = this.inArena ? 2.1 : 1.25;
    } else {
      for (const [type, count] of gate.spawns) {
        for (let n = 0; n < count; n++) {
          this._spawnEnemy(type, this.camX + this.W + rand(10, 80), rand(DEPTH_MIN, DEPTH_MAX));
        }
      }
      this.waveNum = i + 1;
      this.waveTotal = this.enemies.filter((e) => !e.isBoss).length;
      if (gate.mini) this._setMessage('MINI-BOSS', 2.2, 'BONE VANGUARD');
      else this._setMessage(`WAVE ${this.waveNum}`, 1.8, `${this.waveTotal} ENEMIES`);
    }
  }

  _spawnEnemy(type, x, depth) {
    const def = ENEMIES[type];
    const lvScale = 1 + (this.hero.s.level - 1) * 0.06;
    const e = {
      type, def, sprite: def.sprite,
      x, depth, z: 0, vz: 0, facing: -1,
      hp: Math.round(def.hp * lvScale), maxHp: Math.round(def.hp * lvScale),
      state: 'idle', animTime: rand(0, 1), animDuration: 0,
      flash: 0, attackTimer: rand(0.3, def.attackCd), hurtTimer: 0, attackAnimT: 0,
      knockVx: 0, knockVdepth: 0, stunned: 0, frozen: 0,
      scale: 1, w: def.w,
      tint: def.tint, tintDark: def.tintDark, tintLite: def.tintLite,
      isBoss: false,
      // AI resolved once here; a bad `behavior` throws now, not mid-fight.
      behavior: resolveBehavior(def, type), tuning: tuningFor(def),
    };
    this.enemies.push(e);
    return e;
  }

  _spawnBoss(type) {
    const def = BOSS[type];
    const lvScale = 1 + (this.hero.s.level - 1) * 0.05;
    this.boss = {
      type, def, sprite: def.sprite,
      // Off-screen right: the existing walk AI brings him in, which gives the
      // fight an entrance instead of the boss simply being there. Position
      // only — no change to stats, AI or timers.
      x: this.camX + this.W + 44, depth: 200, z: 0, vz: 0, facing: -1,
      seated: false, riseT: 0,
      hp: Math.round(def.hp * lvScale), maxHp: Math.round(def.hp * lvScale),
      state: 'idle', animTime: 0, animDuration: 0,
      flash: 0, attackTimer: 2, hurtTimer: 0, knockVx: 0, knockVdepth: 0,
      stunned: 0, frozen: 0, scale: 1.6, w: def.w, isBoss: true,
      phaseIdx: 0, phaseAnnounced: -1, summonTimer: 3,
    };
    // In the hall he is already here, on the dais at the end of the carpet, and
    // the fight starts when he gets up. Placeholder staging only: no stats, AI
    // or timers are touched, so a real seated build can replace it cleanly.
    if (this.inArena) {
      const b = this.boss;
      // Seated in profile on the top step, facing down the carpet toward the
      // door — a throne faces its own hall. Tuned against the dais art, not
      // inherited from the placeholder's box.
      b.x = 1342;
      b.depth = 158;
      b.z = 20;              // sat on the step, not perched above it
      b.seated = true;
      b.facing = -1;
      b.state = 'idle';
    }
    // §4 recalibration. `w` and `reach` in data.js were sized to the coded
    // placeholder, which was a fraction of the real King's mass. Set on the
    // INSTANCE rather than in data.js so the shared enemy table is untouched.
    // The hitbox tracks his body, not his mantle or the Cleaver — a hurtbox
    // that includes trailing cloth is a hurtbox that feels wrong to hit.
    {
      const b = this.boss;
      b.w = 34;
      b.reach = (b.def.reach || 34) + 10;
    }
    this.enemies.push(this.boss);
  }

  exit() {}

  // ================================================================ update

  update(dt, game) {
    this.t += dt;
    // Cinematic owns the frame: player input, enemy AI, spawns, timers and the
    // combat sim are all simply not run. Nothing is disabled flag-by-flag,
    // because a flag someone forgets is a boss that attacks during a cutscene.
    // The opening cutscene freezes everything the same way the phase-2 one
    // does: no input, no AI, no timers. Skippable on any of the confirm keys.
    if (this.cut) {
      this.cut.update(dt);
      if (Input.anyPressed('confirm', 'menu', 'interact')) this.cut.skip();
      if (this.cut.done) this._endArenaCutscene();
      return;
    }
    if (this.cine) {
      this.cine.update(dt);
      if (this.cine.shakeReq) this.game.addShake(this.cine.shakeReq);
      if (this.cine.canSkip && Input.anyPressed('confirm', 'menu')) this.cine.skip();
      this.particles.update(dt);
      return;
    }
    this._updateBossIntro(dt);
    this._updateBossRise(dt);
    this._updateBossSummonPose(dt);
    this._updateArenaGate();

    // pause toggle takes priority so you can always unpause
    if (Input.pressed('menu') && this.state === 'play') {
      this.paused = !this.paused;
      Audio.select();
    }
    if (this.paused) { this.p.animTime += dt; return; }

    if (this.state === 'victory' || this.state === 'defeat') {
      this._updateEndState(dt);
      return;
    }
    if (this.state === 'reward') { this._updateReward(dt); return; }

    // hit-stop makes heavy blows feel weighty
    if (this.hitStop > 0) { this.hitStop -= dt; this.particles.update(dt * 0.2); this.toasts.update(dt); return; }
    const sdt = this.slowmo > 0 ? dt * 0.35 : dt;
    if (this.slowmo > 0) this.slowmo -= dt;

    if (this.messageT > 0) this.messageT -= dt;

    this._updatePresentation(dt);
    this._updatePlayer(sdt);
    this._updateEnemies(sdt);
    this._updateTotems(sdt);
    this._updateProjectiles(sdt);
    this._updateDrops(sdt);
    this._updateCamera(sdt);
    this.particles.update(sdt);
    this.toasts.update(dt);

    // wave / gate progression
    if (!this.boss && !this.gateCleared && this.enemies.length === 0) {
      this.gateCleared = true;
      this._advanceGate();
    }
    if (this.boss && this.boss.hp <= 0) {
      this._onBossDefeated();
    }

    if (this.p.hp <= 0 && this.state === 'play') {
      this.state = 'defeat'; this.endTimer = 0; Audio.death();
      this.p.state = 'down'; this.p.animTime = 0;
    }
  }

  // Contextual tutorial reveals + HUD easing. Uses real (unscaled) dt so tips
  // fire on wall-clock time regardless of slow-mo.
  _updatePresentation(dt) {
    if (this.tutorialBox) {
      this.tutorialBox.t += dt;
      if (this.tutorialBox.t > this.tutorialBox.dur) this.tutorialBox = null;
    }
    if (this.clearFlash > 0) this.clearFlash = Math.max(0, this.clearFlash - dt * 1.5);
    // track the "last enemy" transition so the banner animates once, then shrinks
    const remaining = this.boss ? -1 : this.enemies.filter((e) => e.hp > 0).length;
    if (remaining === 1) { if (this.lastEnemyT === undefined) this.lastEnemyT = 0; else this.lastEnemyT += dt; }
    else this.lastEnemyT = undefined;

    // smooth the resource bars toward their real values; pulse on empty spend
    const p = this.p;
    p.dispMana = lerp(p.dispMana, p.mana, Math.min(1, dt * 8));
    p.dispSta = lerp(p.dispSta, p.sta, Math.min(1, dt * 8));
    if (p.manaPulse > 0) p.manaPulse = Math.max(0, p.manaPulse - dt * 2);
    if (p.staPulse > 0) p.staPulse = Math.max(0, p.staPulse - dt * 2);

    // enemy health-bar fade timers
    for (const e of this.enemies) if (e.showHp > 0) e.showHp -= dt;
  }

  _advanceGate() {
    // brief freeze + gold flash to punctuate clearing the wave
    this.hitStop = 0.12;
    this.clearFlash = 1;
    this.game.addShake(2);
    Audio.confirm();
    this._setMessage('AREA CLEARED', 1.6);

    this.currentGate++;
    if (this.currentGate >= this.gates.length) return;
    // The hall is entered, not scrolled into. Clearing the last wave outside
    // leaves the player standing at the keep gate with the way open; the boss
    // does not exist until they choose to walk in.
    if (this.gates[this.currentGate].arena) {
      this.awaitingArena = true;
      this._setMessage('THE GATE IS OPEN', 1.8);
      return;
    }
    // scroll camera to next gate, then spawn
    this._scrollTarget = Math.min(this.gates[this.currentGate].x - this.W / 2, this.worldEnd - this.W);
    this._scrollTarget = Math.max(0, this._scrollTarget);
    this._pendingSpawn = this.currentGate;
  }

  // The gate stands at the right-hand end of the walk. The prompt appears only
  // once the player has actually gone to it, so the last stretch is still
  // theirs to cross rather than a cutscene.
  _updateArenaGate() {
    if (!this.awaitingArena || this.inArena) { this.arenaPrompt = false; return; }
    const p = this.p;
    this.arenaPrompt = !!p && p.x > this.camX + this.W - 120;
  }

  _enterArena() {
    this.awaitingArena = false;
    this.arenaPrompt = false;
    this.inArena = true;
    Audio.door();
    this.game.addShake(3);
    // The hall is drawn at a fixed anchor, so the camera has to be standing in
    // it before anything else happens — scrolling there would fly the view
    // through the keep wall. Cut, like stepping through a door.
    this.camX = Math.max(0, Math.min(1240 - this.W / 2, this.worldEnd - this.W));
    this._scrollTarget = undefined;
    // Put the player just inside the doorway, on the flagstones, and let the
    // boss walk in from the far side as he already does.
    if (this.p) { this.p.x = this.camX + 96; this.p.depth = 210; }
    this._spawnGate(this.currentGate);
    // The pre-rendered rise plays as he is found on his throne. The boss is
    // spawned FIRST and simply held seated behind it, so if the video fails to
    // load or is skipped the fight is already staged correctly underneath —
    // the cutscene is a curtain, not a step in the setup.
    this.cut = new Cutscene('assets/cutscenes/throne_rise.mp4');
    this.cut.start();
    this.message = null; this.messageT = 0; this.messageSub = null;
    this.tutorialBox = null; this.tips = []; this.activeTip = null;
  }

  // Ends the opening cutscene and leaves him standing, exactly as the video
  // leaves him. One place decides, so the skipped and played paths agree.
  _endArenaCutscene() {
    if (this.cut) { this.cut.dispose(); this.cut = null; }
    const b = this.boss;
    if (b) {
      b.seated = false;
      b.z = 0;
      b.riseT = 0;
      b.attackTimer = 1.0;          // a beat before he moves
    }
    this.bossIntroT = 0.01;         // let the title and roar land immediately
  }

  // ------------------------------------------------------------- player

  _updatePlayer(dt) {
    const p = this.p;
    p.animTime += dt;
    if (p.flash > 0) p.flash -= dt * 4;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.dodgeCd > 0) p.dodgeCd -= dt;
    if (p.comboTimer > 0) p.comboTimer -= dt; else p.comboStep = 0;
    for (const k in p.cooldowns) if (p.cooldowns[k] > 0) p.cooldowns[k] -= dt;

    // Momentum drains when the Warrior stops landing hits. Iron Bulwark holds
    // it: that is the whole reason to press the button.
    if (p.momentum > 0 && !p.buffs.hold) {
      p.momentumT -= dt;
      if (p.momentumT <= 0) p.momentum = 0;
    }
    // Flow is gentler — it only lapses if the Mage stops casting entirely.
    if (p.flow > 0) { p.flowT -= dt; if (p.flowT <= 0) p.flow = 0; }

    // buffs tick down
    for (const b in p.buffs) { p.buffs[b].t -= dt; if (p.buffs[b].t <= 0) delete p.buffs[b]; }

    // mana + stamina regen
    p.mana = Math.min(p.maxMana, p.mana + dt * 5);
    p.sta = Math.min(p.maxSta, p.sta + dt * 26);

    // ghost hp bar easing
    p.ghostHp = lerp(p.ghostHp, p.hp / p.maxHp, dt * 3);

    // vertical (jump) physics
    if (p.z > 0 || p.vz !== 0) {
      p.vz -= 340 * dt;
      p.z += p.vz * dt;
      if (p.z <= 0) {
        p.z = 0; p.vz = 0;
        if (p.state === 'jump') { p.state = 'idle'; this.particles.landPuff(p.x, p.depth); Audio.step(); }
      }
    }

    const busy = ['attack', 'heavy', 'cast', 'dodge', 'hurt'].includes(p.state);

    // --- movement
    if (!busy || p.state === 'jump') {
      const ax = Input.axis();
      // Honour the ability's own speedMult instead of a flat 1.4 — the authored
      // values range from Sanctuary's 0.9 slow to Vanish's 1.6 sprint.
      const spdMult = p.buffs.speed ? (p.buffs.speed.mult ?? 1.4) : 1;
      const spd = p.speed * spdMult * (1 + this.hero.petBonus('moveSpeed'));
      if (ax.x !== 0 || ax.y !== 0) {
        p.x += ax.x * spd * dt;
        p.depth += ax.y * spd * 0.7 * dt;
        p.depth = clamp(p.depth, DEPTH_MIN, DEPTH_MAX);
        p.x = clamp(p.x, this.camX + 8, this.camX + this.W - 8);
        if (Math.abs(ax.x) > FACE_DEADZONE) p.facing = ax.x > 0 ? 1 : -1;
        if (p.z === 0 && p.state !== 'jump') p.state = 'walk';
        if (p.z === 0 && Math.random() < dt * 6) this.particles.dust(p.x, p.depth, 1);
      } else if (p.z === 0 && p.state === 'walk') {
        p.state = 'idle';
      }
    }

    // --- jump
    if (Input.pressed('jump') && p.z === 0 && !busy) {
      p.vz = 150; p.state = 'jump'; Audio.jump();
      p.sta = Math.max(0, p.sta - 12);
    }

    // --- dodge roll (i-frames)
    if (Input.pressed('dodge') && p.dodgeCd <= 0 && p.z === 0) {
      p.state = 'dodge'; p.animTime = 0; p.dodgeTimer = 0.32; p.invuln = 0.34; p.dodgeCd = 0.7;
      if (p.sta < 20) p.staPulse = 0.6;
      p.sta = Math.max(0, p.sta - 20);
      const ax = Input.axis();
      p.dodgeVx = (ax.x || p.facing) * 220;
      p.dodgeVdepth = ax.y * 120;
      Audio.dodge();
      this.particles.ring(p.x, p.depth, '#cfc6ff', 14);
    }
    if (p.state === 'dodge') {
      p.dodgeTimer -= dt;
      p.x += p.dodgeVx * dt; p.depth += (p.dodgeVdepth || 0) * dt;
      p.depth = clamp(p.depth, DEPTH_MIN, DEPTH_MAX);
      p.x = clamp(p.x, this.camX + 8, this.camX + this.W - 8);
      p.dodgeVx *= 0.86;
      // record an afterimage trail so the roll reads clearly
      p.trail.push({ x: p.x, depth: p.depth, facing: p.facing, t: 0 });
      if (Math.random() < 0.4) this.particles.dust(p.x, p.depth, 1);
      if (p.dodgeTimer <= 0) p.state = 'idle';
    }
    // age + cull the afterimage trail
    for (const tr of p.trail) tr.t += dt;
    p.trail = p.trail.filter((tr) => tr.t < 0.22);

    // --- light attack (combo)
    if (Input.pressed('light') && !busy) {
      this._startAttack('attack');
    }
    // --- heavy attack
    if (Input.pressed('heavy') && !busy) {
      this._startAttack('heavy');
    }

    // --- ability slots 1-4 and special (L uses slot the player last picked)
    if (Input.pressed('slot1')) this._useAbility(0);
    if (Input.pressed('slot2')) this._useAbility(1);
    if (Input.pressed('slot3')) this._useAbility(2);
    if (Input.pressed('slot4')) this._useAbility(3);
    if (Input.pressed('special')) this._useAbility(0);

    // --- quick potions (E = health, handled minimally)
    // E is the potion key everywhere except standing in the open gate, where it
    // is the only thing it can sensibly mean. Guarded on the prompt actually
    // being up so a mistimed press never silently swallows a heal.
    if (Input.pressed('interact')) {
      if (this.arenaPrompt) this._enterArena();
      else this._quaffHealth();
    }

    // resolve attack windows
    if (p.state === 'attack' || p.state === 'heavy') {
      p.attackTimer += dt;
      this._resolveMeleeHits();
      if (p.attackTimer >= p.animDuration) {
        p.state = 'idle';
        p.hitList.clear();
      }
    }
    if (p.state === 'cast') {
      p.attackTimer += dt;
      if (p.attackTimer >= p.animDuration) { p.state = 'idle'; }
    }
    if (p.state === 'hurt') {
      p.attackTimer += dt;
      if (p.attackTimer >= 0.28) p.state = 'idle';
    }

    // sync back to hero for potions/HUD persistence at scene end
    this.hero.s.hp = Math.max(0, Math.round(p.hp));
    this.hero.s.mana = Math.round(p.mana);
  }

  _startAttack(kind) {
    const p = this.p;
    const cls = this.hero.cls();
    // The swing itself is drawn, not just its impact. Before this, a miss was
    // visually silent — the only feedback was the hit spark on an enemy — and
    // every class swung in the same colourless way.
    const look = CLASS_FX[this.hero.s.class] || CLASS_FX.warrior;
    if (kind === 'attack') {
      p.comboStep = (p.comboStep % cls.combo.length) + 1;
      p.comboTimer = 0.55;
      p.state = 'attack';
      p.animDuration = 0.28;
      this.particles.slash(p.x + p.facing * 16, p.depth - 12, p.facing, look.color);
      Audio.swing();
    } else {
      p.state = 'heavy';
      p.animDuration = 0.5;
      this.particles.slash(p.x + p.facing * 14, p.depth - 15, p.facing, look.color);
      this.particles.slash(p.x + p.facing * 20, p.depth - 10, p.facing, look.color2);
      this.particles.dust(p.x + p.facing * 16, p.depth, 4);
      Audio.swing();
      p.sta = Math.max(0, p.sta - 16);
    }
    p.animTime = 0; p.attackTimer = 0; p.hitList.clear();
  }

  _resolveMeleeHits() {
    const p = this.p;
    // hit window in the middle of the swing
    const k = p.attackTimer / p.animDuration;
    if (k < 0.3 || k > 0.75) return;

    const cls = this.hero.cls();
    const heavy = p.state === 'heavy';
    const reach = cls.reach + (heavy ? 10 : 0);

    // A ranged class looses a shot at the same point in the swing that a melee
    // class connects. Everything else about the attack is untouched — combo
    // step, animation, hit window, dodge and cooldowns are shared — so the bow
    // is a different delivery of the same attack, not a parallel system.
    if (cls.ranged) { this._loosBasicShot(cls, heavy); return; }
    // cls.combo is the class's authored per-step curve. Only its LENGTH was
    // read before, so every class ramped identically and the numbers themselves
    // — a Berserker finishing on 32, a Rogue's four smaller steps — did nothing.
    const dmg = meleeBaseDamage(this.hero.attack, {
      heavy, comboStep: p.comboStep, combo: cls.combo,
      rageMult: p.buffs.rage ? p.buffs.rage.mult : 1,
    });

    for (const e of this.enemies) {
      if (e.hp <= 0 || p.hitList.has(e)) continue;
      const dx = e.x - p.x;
      const facingRight = p.facing > 0;
      if ((facingRight && dx < -6) || (!facingRight && dx > 6)) continue;
      if (Math.abs(dx) > reach) continue;
      if (Math.abs(e.depth - p.depth) > 18) continue;

      p.hitList.add(e);
      // Exposure raises the Rogue's crit chance against this target rather than
      // adding a separate damage stat — the class's 16% base finally matters.
      const crit = Math.random() < critChanceAgainst(this.hero.crit, { exposed: e.exposed > 0 });
      const finalDmg = finalHitDamage(dmg, { crit, variance: rand(0.9, 1.1) });
      const kb = meleeKnockback({ heavy, comboStep: p.comboStep });
      this._damageEnemy(e, finalDmg, p.facing, kb, {
        crit, launch: heavy, air: e.z > 0 || heavy,
      });
      this._buildMomentum({ heavy });

      if (heavy) { this.hitStop = 0.08; this.game.addShake(3); Audio.heavyHit(); }
      else Audio.hit();
    }
  }

  _useAbility(slot) {
    const p = this.p;
    const id = this.hero.s.equippedAbilities[slot];
    if (!id) return;
    const ab = ABILITIES[id];
    if (['attack', 'heavy', 'cast', 'dodge', 'hurt'].includes(p.state) && p.state !== 'walk') {
      if (p.state !== 'idle' && p.state !== 'walk') return;
    }
    if ((p.cooldowns[id] || 0) > 0) { Audio.deny(); return; }
    if (p.mana < ab.mana) { Audio.deny(); p.manaPulse = 0.6; return; }

    p.mana -= ab.mana;
    p.cooldowns[id] = ab.cd;
    p.state = 'cast'; p.animTime = 0; p.attackTimer = 0; p.animDuration = 0.4;
    Audio.cast();

    // Each ability names the stat it draws on (see `scaling` in data.js). This
    // used to read `magic || attack`, and since no class has zero magic the
    // attack half was unreachable — a Berserker with 4 magic and 27 attack
    // scaled every ability off the 4.
    let power = abilityPower(this.hero, ab);
    // Signature resources are read once, at the moment of the cast.
    power += this._spendGuard(ab);                       // Paladin
    const boost = this._spendMomentum(ab) * this._spendFlow(ab);   // Warrior, Mage
    if (ab.buildsFlow) {                                 // Mage
      p.flow = addFlow(p.flow, ab.buildsFlow);
      p.flowT = FLOW_DECAY;
    }

    switch (ab.kind) {
      case 'projectile': this._castProjectile(ab, power, boost); break;
      case 'aoe': this._castAoe(ab, power, boost); break;
      case 'melee': this._castMeleeAbility(ab, power, boost); break;
      case 'chain': this._castChain(ab, power, boost); break;
      case 'buff': this._castBuff(ab); break;
      case 'mark': this._castMark(ab); break;
      case 'heal': this._castHeal(ab); break;
      case 'aura': this._castAura(ab); break;
      case 'totem': this._placeTotem(ab); break;
    }
  }

  /** Mage: a spender takes the whole Flow bar. */
  _spendFlow(ab) {
    const p = this.p;
    if (!ab.spendsFlow || !p.flow) return 1;
    const mult = flowMultiplier(p.flow);
    this.toasts.push(`FLOW x${p.flow}`, p.x, p.depth - 40, '#c2b2ff', { crit: true });
    p.flow = 0;
    return mult;
  }

  /** Ranger: name a target. The mark lives on the enemy, not on the Ranger. */
  _castMark(ab) {
    const p = this.p;
    let best = null; let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - p.x, e.depth - p.depth);
      if (d < bestD && d <= (ab.range || 240)) { best = e; bestD = d; }
    }
    if (!best) { this.toasts.push('No target', p.x, p.depth - 34, UI.inkDim); return null; }
    best.marked = ab.dur || MARK_DUR;
    this.toasts.push('MARKED', best.x, best.depth - 30, '#b8e8a8', { crit: true });
    this.particles.ring(best.x, best.depth, '#b8e8a8', 18);
    return best;
  }

  /** Paladin: an actual heal, which the class had none of. */
  _castHeal(ab) {
    const p = this.p;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + ab.heal);
    this.toasts.push(`+${Math.round(p.hp - before)}`, p.x, p.depth - 34, UI.good, { crit: true });
    this.particles.pickup(p.x, p.depth - 16, '#ffe9a8');
    this._playFx(ab, p.x, p.depth, 20);
  }

  /** Paladin: a defensive field on the caster. Solo now, party-ready later. */
  _castAura(ab) {
    const p = this.p;
    p.buffs.aura = { t: ab.dur, ...ab.aura };
    this._playFx(ab, p.x, p.depth, 40);
    this.toasts.push(ab.name + '!', p.x, p.depth - 34, '#ffe9a8');
  }

  _castProjectile(ab, power, boost = 1) {
    const p = this.p;
    const dmg = abilityBaseDamage(ab, power, { fireBonus: this.hero.petBonus('fireDmg') }) * boost;
    this.projectiles.push({
      x: p.x + p.facing * 12, depth: p.depth, z: 14,
      vx: p.facing * ab.speed, life: ab.range / ab.speed,
      dmg: Math.round(dmg), owner: 'player', element: ab.element,
      color: this._abilityFx(ab).color, color2: this._abilityFx(ab).color2,
      pierce: 1, hit: new Set(), r: 4,
      // carried so the hit can apply the ability's own rider
      poison: ab.poison || null, precision: !!ab.precision, homing: !!ab.homing,
    });
    this._playFx(ab, p.x, p.depth, ab.range || 40);
  }

  /**
   * Where an area effect goes off. Every AoE today is a burst centred on the
   * caster, and that stays the default. The seam exists so a placed effect —
   * a trap, a totem, a targeted blast — can name a different origin later
   * without every existing ability changing behaviour.
   */
  _aoeOrigin(ab) {
    const p = this.p;
    switch (ab.origin) {
      case 'ahead': return { x: p.x + p.facing * (ab.offset ?? 40), depth: p.depth };
      case 'self':
      default:      return { x: p.x, depth: p.depth };
    }
  }

  /**
   * Apply one area hit at a point. Split out from _castAoe so a persistent
   * area (a burning patch, a totem pulse) can call the same resolution on a
   * timer instead of duplicating it.
   */
  _applyAoeBurst(ab, dmg, ox, oy) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(e.x - ox, e.depth - oy) > ab.range) continue;
      const dir = e.x >= ox ? 1 : -1;
      this._damageEnemy(e, Math.round(dmg * rand(0.9, 1.1)), dir, ab.kb || 100, { launch: true, air: true });
      if (ab.freeze) e.frozen = ab.freeze;
      // An AoE's stun was read from the data but never applied, so
      // Earthshatter, Static Field and Wrath of Dawn all carried a stun that
      // did nothing.
      if (ab.stun) e.stunned = Math.max(e.stunned, ab.stun);
    }
  }

  _castAoe(ab, power, boost = 1) {
    const p = this.p;
    const dmg = abilityBaseDamage(ab, power) * boost;
    // Smoke Bomb is an escape: it buys untouchable seconds and a sprint, and
    // its damage is incidental.
    if (ab.invuln) p.invuln = Math.max(p.invuln, ab.invuln);
    if (ab.kind === 'aoe' && ab.speedMult) p.buffs.speed = { t: ab.dur || 2, mult: ab.speedMult };
    const at = this._aoeOrigin(ab);
    this._playFx(ab, at.x, at.depth, ab.range);
    this.hitStop = 0.06;
    this._applyAoeBurst(ab, dmg, at.x, at.depth);
  }

  /** The look of an ability, resolved from its own vfx, its element, then its class. */
  _abilityFx(ab) { return resolveFx(ab, this.hero.s.class); }

  _playFx(ab, x, y, range) {
    playAbilityFx(this._abilityFx(ab), this.particles, (n) => this.game.addShake(n),
                  x, y, this.p.facing, range);
  }

  _castMeleeAbility(ab, power, boost = 1) {
    const p = this.p;
    let dmg = abilityBaseDamage(ab, power) * boost;
    if (ab.rageScaled) dmg *= this._rageMultiplier();
    this._playFx(ab, p.x, p.depth, ab.range || 40);
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - p.x;
      if ((p.facing > 0 && dx < 0) || (p.facing < 0 && dx > 0)) continue;
      if (Math.abs(dx) > ab.range || Math.abs(e.depth - p.depth) > 22) continue;
      let hit = dmg;
      let crit = false;
      // Assassinate cashes in the opening Backstab made.
      if (ab.consumesExposed && e.exposed > 0) {
        hit *= exposureMultiplier(true); e.exposed = 0; crit = true;
      }
      // Execute finishes anything already close to the end.
      if (ab.executes) hit *= executeMultiplier(e.hp / Math.max(1, e.maxHp));
      this._damageEnemy(e, Math.round(hit), p.facing, ab.kb || 120, { launch: true, crit });
      // Backstab opens the target up instead of just hitting it.
      if (ab.appliesExposed) {
        e.exposed = EXPOSED_DUR * (p.primedExposed ? 2 : 1);
        p.primedExposed = false;
        this.particles.ring(e.x, e.depth, '#c9b8ff', 14);
      }
      if (ab.stun) e.stunned = ab.stun;
    }
  }

  _castChain(ab, power, boost = 1) {
    const p = this.p;
    let dmg = abilityBaseDamage(ab, power) * boost;
    // A real chain: the first link must be within the ability's range of the
    // caster, and every hop after it is measured from the PREVIOUS target. The
    // old version sorted every living enemy by distance to the player and took
    // the first N, which ignored range entirely and let a chain cross the arena.
    // Ancestral Chorus answers from every totem the Summoner holds, so the
    // chain starts where the totems are rather than where the caster is.
    const roots = (ab.fromTotems && this.totems.length)
      ? this.totems.map((t) => ({ x: t.x, depth: t.depth }))
      : [{ x: p.x, depth: p.depth }];
    const seen = new Set();
    const targets = [];
    for (const root of roots) {
      for (const e of chainTargets(root, this.enemies, {
        chains: ab.chains, range: ab.range ?? Infinity, hopRange: ab.hopRange ?? CHAIN_HOP_RANGE,
      })) if (!seen.has(e)) { seen.add(e); targets.push(e); }
      if (targets.length >= ab.chains) break;
    }
    let prev = { x: p.x, depth: p.depth - 12 };
    for (const e of targets) {
      // Precision abilities punish a marked target; everything else ignores it.
      const hit = dmg * markMultiplier(e.marked > 0, { precision: !!ab.precision });
      this._damageEnemy(e, Math.round(hit), e.x >= p.x ? 1 : -1, 40, {});
      // Chains used to stun every target for 0.4s, which no ability asked for
      // and which quietly made every chain a crowd-control tool. Now only an
      // ability that states a stun applies one.
      if (ab.stun) e.stunned = Math.max(e.stunned, ab.stun);
      this._lightning = this._lightning || [];
      const cfx = this._abilityFx(ab);
      this._lightning.push({ x1: prev.x, y1: prev.depth, x2: e.x, y2: e.depth - 12, t: 0,
                             color: cfx.color, color2: cfx.color2, shape: cfx.shape });
      prev = { x: e.x, depth: e.depth - 12 };
      dmg *= CHAIN_FALLOFF;
    }
    this.game.addShake(3);
  }

  _castBuff(ab) {
    const p = this.p;
    // Independent effects. speedMult used to be nested inside the atkMult
    // branch, so a buff that only changed speed did nothing at all — which is
    // why Sanctuary's slow never applied.
    // Blood Frenzy is worth more the closer to death the Berserker is.
    if (ab.rageScaled) p.buffs.rage = { t: ab.dur, mult: this._rageMultiplier() };
    else if (ab.atkMult) p.buffs.rage = { t: ab.dur, mult: ab.atkMult };
    if (ab.speedMult) p.buffs.speed = { t: ab.dur, mult: ab.speedMult };
    if (ab.shield) {
      p.buffs.shield = { t: ab.dur, amount: ab.shield, banksGuard: !!ab.banksGuard };
      p.shieldHp = ab.shield;
    }
    // Iron Bulwark holds Momentum in place instead of letting it drain.
    if (ab.holdsMomentum) p.buffs.hold = { t: ab.dur };
    // Vanish primes the next Backstab to open twice as wide.
    if (ab.primesExposed) p.primedExposed = true;
    // Bloodletting buys its power with health, floored so it cannot kill you.
    if (ab.selfDamage) {
      const cost = selfDamageAllowed(p.hp, p.maxHp, p.maxHp * ab.selfDamage);
      p.hp -= cost;
      if (cost > 0) this.toasts.push(`-${Math.round(cost)}`, p.x, p.depth - 30, '#ff6a5a', { vy: -24 });
    }
    const fx = this._abilityFx(ab);
    this._playFx(ab, p.x, p.depth, 20);
    this.toasts.push(ab.name + '!', p.x, p.depth - 34, fx.color);
  }

  _quaffHealth() {
    if (this.p.hp >= this.p.maxHp) return;
    if (!this.hero.usePotion('health')) { this.toasts.push('No potions', this.p.x, this.p.depth - 30, UI.inkDim); return; }
    this.p.hp = Math.min(this.p.maxHp, this.p.hp + 60);
    this.particles.pickup(this.p.x, this.p.depth - 16, '#57d98a');
    this.toasts.push('+60', this.p.x, this.p.depth - 30, UI.good);
    Audio.confirm();
  }

  _damageEnemy(e, dmg, dir, kb, opts = {}) {
    const reduced = enemyDamageAfterDefense(dmg, e.def.defense);
    e.hp -= reduced;
    e.flash = 1; e.hurtTimer = 0.2; e.state = 'hurt'; e.animTime = 0;
    e.knockVx = dir * kb;
    e.showHp = 3.5; // reveal this enemy's name+health, then fade
    if (opts.launch && !e.def.launchImmune) { e.vz = Math.max(e.vz, 120); e.z = Math.max(e.z, 1); }
    e.stunned = Math.max(e.stunned, 0.25);

    // impact particles: normal 3-5, heavy 5-8, crit gold spark
    const n = opts.crit ? 8 : (opts.air ? 6 : 4);
    const look = CLASS_FX[this.hero.s.class] || CLASS_FX.warrior;
    this.particles.hitSpark(e.x, e.depth - 14, dir, opts.crit ? '#ffd76a' : look.color, n);
    this.particles.blood(e.x, e.depth, dir, e.def.bloodColor || '#c23b3b');
    // damage number: off-white normal, gold + "!" for crits, short life w/ drift
    this.toasts.push(opts.crit ? `${reduced}!` : `${reduced}`, e.x + rand(-3, 3), e.depth - 24,
      opts.crit ? '#ffd76a' : '#f4f0ff', { crit: opts.crit, vy: -34, vx: rand(-10, 10), life: opts.crit ? 0.8 : 0.6 });

    if (e.hp <= 0) this._onEnemyKilled(e, dir);
  }

  _onEnemyKilled(e, dir) {
    this.hero.s.stats.enemiesDefeated++;
    this.particles.magicBurst(e.x, e.depth - 12, e.tintDark || '#c23b3b', 12);
    this.game.addShake(2);
    // gold + xp drops
    const gold = randInt(e.def.gold[0], e.def.gold[1]);
    this._spawnDrop('coin', e.x, e.depth, { gold });
    const xp = e.def.xp;
    const gained = this.hero.addXp(xp);
    if (gained > 0) this._onLevelUp();
    // rare item chance boosted by lucky rabbit
    const dropChance = 0.12 + this.hero.petBonus('rareLoot');
    if (!e.isBoss && chance(dropChance)) {
      this._spawnLootItem(e.x, e.depth);
    }
    // remove after a beat handled in enemy update (hp<=0 fades)
  }

  _onLevelUp() {
    Audio.levelUp();
    this.p.maxHp = this.hero.maxHp; this.p.maxMana = this.hero.maxMana;
    this.p.hp = this.hero.maxHp; this.p.mana = this.hero.maxMana;
    this.p.speed = this.hero.speed;
    this.particles.levelStars(this.p.x, this.p.depth - 16);
    this.toasts.push('LEVEL UP!', this.p.x, this.p.depth - 36, UI.gold, { crit: true, life: 1.4 });
    this._setMessage(`Level ${this.hero.s.level}!`, 1.6);
  }

  // ------------------------------------------------------------- enemies

  _updateEnemies(dt) {
    const p = this.p;
    for (const e of this.enemies) {
      e.animTime += dt;
      if (e.flash > 0) e.flash -= dt * 4;

      // The throne hold: he breathes and nothing else. Skipped here rather than
      // marked `frozen`, because frozen draws the ice disc and this is not a
      // status effect. Everything below — AI, movement, attack timers — is
      // simply not reached until he stands.
      if (e.seated) continue;

      if (e.hp <= 0) {
        // death fade
        e.deathT = (e.deathT || 0) + dt;
        e.alpha = clamp01(1 - e.deathT * 2.5);
        e.z += dt * 6; e.knockVx *= 0.9; e.x += e.knockVx * dt;
        continue;
      }

      // Target-side statuses. Exposed (Rogue) and Marked (Ranger) are read at
      // the moment a hit resolves; poison damages on its own clock but goes
      // through the normal damage path so it shares armour, toasts and death.
      if (e.exposed > 0) e.exposed -= dt;
      if (e.marked > 0) e.marked -= dt;
      if (e.poison) {
        const tick = poisonTick(e.poison, dt);
        e.poison = tick.left;
        if (tick.damage > 0 && e.hp > 0) {
          this._damageEnemy(e, Math.max(1, Math.round(tick.damage)), 0, 0, { silent: true });
        }
      }

      if (e.frozen > 0) { e.frozen -= dt; e.state = 'idle'; e.animTime = 0; continue; }
      if (e.stunned > 0) e.stunned -= dt;

      // knockback + air physics
      if (Math.abs(e.knockVx) > 2) {
        e.x += e.knockVx * dt; e.knockVx *= 0.86;
        e.x = clamp(e.x, this.camX - 20, this.camX + this.W + 40);
      }
      if (e.z > 0 || e.vz !== 0) {
        e.vz -= 300 * dt; e.z += e.vz * dt;
        if (e.z <= 0) { e.z = 0; e.vz = 0; if (e.state === 'hurt') this.particles.dust(e.x, e.depth, 3); }
      }

      if (e.hurtTimer > 0) { e.hurtTimer -= dt; if (e.hurtTimer <= 0 && e.stunned <= 0) e.state = 'idle'; continue; }
      if (e.stunned > 0) continue;

      if (e.isBoss) { this._updateBoss(e, dt); continue; }

      // AI: the scene supplies the frame's context, the archetype decides.
      const dx = p.x - e.x;
      const c = this._aiContext;
      c.dt = dt;
      c.dx = dx;
      c.ddepth = p.depth - e.depth;
      c.dist = Math.abs(dx);
      e.facing = dx >= 0 ? 1 : -1;

      e.attackTimer -= dt;
      e.behavior.update(e, c);
    }

    // cull fully-dead
    this.enemies = this.enemies.filter((e) => !(e.hp <= 0 && (e.alpha ?? 1) <= 0));
    if (this.boss && this.boss.hp <= 0 && (this.boss.alpha ?? 1) <= 0) { /* handled elsewhere */ }
  }

  // ======================================================= class mechanics
  // Thin hooks. All the arithmetic lives in game/classMechanics.js; what is
  // here is only the wiring to entities the scene already owns.

  /** Warrior: landing a hit builds Momentum and refreshes its window. */
  _buildMomentum({ heavy = false } = {}) {
    const p = this.p;
    if (this.hero.s.class !== 'warrior') return;
    p.momentum = addMomentum(p.momentum, momentumGain({ heavy }));
    p.momentumT = MOMENTUM_DECAY;
  }

  /** Warrior: a spender takes the whole bar. Returns the damage multiplier. */
  _spendMomentum(ab) {
    const p = this.p;
    if (!ab.spendsMomentum || !p.momentum) return 1;
    const perStack = ab.spendsMomentum === 'finisher'
      ? MOMENTUM_FINISHER_PER_STACK : MOMENTUM_PER_STACK;
    const mult = momentumMultiplier(p.momentum, perStack);
    if (p.momentum >= 3) {
      this.toasts.push(`MOMENTUM x${p.momentum}`, p.x, p.depth - 40, UI.gold, { crit: true });
    }
    p.momentum = 0;
    return mult;
  }

  /** Paladin: a holy payoff cashes in what the Guard absorbed. */
  _spendGuard(ab) {
    const p = this.p;
    if (!ab.spendsGuard || p.guard <= 0) return 0;
    const { bonus, left } = spendGuard(p.guard, { share: ab.spendsGuard });
    p.guard = left;
    if (bonus >= 1) {
      this.toasts.push(`+${Math.round(bonus)} GUARD`, p.x, p.depth - 40, '#ffe9a8', { crit: true });
    }
    return bonus;
  }

  /** Berserker: Blood Frenzy's strength is read from missing health at cast. */
  _rageMultiplier() {
    const p = this.p;
    return rageMultiplier(p.hp / Math.max(1, p.maxHp));
  }

  /** Ranger: the basic attack as an arrow, fired from the swing's hit window. */
  _loosBasicShot(cls, heavy) {
    const p = this.p;
    if (p.hitList.has('shot')) return;      // one arrow per swing
    p.hitList.add('shot');
    const dmg = meleeBaseDamage(this.hero.attack, {
      heavy, comboStep: p.comboStep, combo: cls.combo,
      rageMult: p.buffs.rage ? p.buffs.rage.mult : 1,
    });
    const fx = CLASS_FX[this.hero.s.class] || CLASS_FX.warrior;
    this.projectiles.push({
      x: p.x + p.facing * 12, depth: p.depth, z: 14,
      vx: p.facing * (heavy ? 200 : 250), life: (cls.shotRange || 220) / (heavy ? 200 : 250),
      dmg: Math.round(dmg), owner: 'player', basic: true, precision: true,
      color: fx.color, color2: fx.color2, pierce: heavy ? 2 : 1, hit: new Set(), r: 3,
    });
    Audio.swing();
  }

  /** A totem is placed in front of the caster, oldest retired past the cap. */
  _placeTotem(ab) {
    const p = this.p;
    const at = totemPlacement(p.x, p.depth, p.facing);
    const t = makeTotem(ab.totem.kind, at.x, at.depth, {
      life: ab.totem.life, pulse: ab.totem.pulse || 0,
      radius: ab.totem.radius, power: ab.totem.power || 0,
    });
    t.damageTaken = ab.totem.damageTaken || null;
    t.ability = ab;
    this.totems.push(t);
    while (this.totems.length > TOTEM_LIMIT) this.totems.shift();
    this._playFx(ab, at.x, at.depth, ab.totem.radius);
    return t;
  }

  /** Totems age, pulse and expire. Damage goes through the normal path. */
  _updateTotems(dt) {
    if (!this.totems.length) return;
    const keep = [];
    for (const t of this.totems) {
      const step = totemTick(t, dt);
      t.life = step.life; t.pulseT = step.pulseT;
      if (step.fired) {
        const power = abilityPower(this.hero, t.ability);
        const dmg = abilityBaseDamage(t.ability, power);
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - t.x, e.depth - t.depth) > t.radius) continue;
          this._damageEnemy(e, Math.round(dmg * rand(0.9, 1.1)), e.x >= t.x ? 1 : -1, 40, {});
        }
        this.particles.ring(t.x, t.depth, this._abilityFx(t.ability).color, t.radius * 0.7);
      }
      if (!step.expired) keep.push(t);
    }
    this.totems = keep;
  }

  /** A stone totem softens hits while the player stands in its circle. */
  _totemDamageTaken() {
    const p = this.p;
    let mult = 1;
    for (const t of this.totems) {
      if (!t.damageTaken) continue;
      if (Math.hypot(p.x - t.x, p.depth - t.depth) <= t.radius) mult = Math.min(mult, t.damageTaken);
    }
    return mult;
  }

  _enemyTryMelee(e, dt) {
    // The pose is held for ATTACK_ANIM_HOLD, the swing itself is not. Without
    // the hold this reassigns 'idle' on the very next frame, so a sprite-backed
    // attack animation gets exactly one frame on screen before it is cancelled.
    // Purely a rendering state: cooldown, windup, reach and damage are untouched.
    e.attackAnimT = Math.max(0, (e.attackAnimT || 0) - dt);
    e.state = e.attackAnimT > 0 ? 'attack' : 'idle';
    if (e.attackTimer <= 0) {
      e.attackTimer = e.def.attackCd;
      e.state = 'attack'; e.animTime = 0;
      e.attackAnimT = e.tuning.attackAnim ?? ATTACK_ANIM_HOLD;
      e._swing = e.tuning.windup ?? 0.18; // telegraph, then the hit lands
    }
    if (e._swing > 0) {
      e._swing -= dt;
      if (e._swing <= 0) this._enemyHitPlayer(e);
    }
  }

  _enemyHitPlayer(e) {
    const p = this.p;
    if (Math.abs(p.x - e.x) <= e.def.reach + 6 && Math.abs(p.depth - e.depth) < 20 && p.z < 20) {
      this._hurtPlayer(e.def.attack, e.facing);
    }
  }

  _enemyShoot(e) {
    const p = this.p;
    const t = e.tuning;
    const dx = p.x - e.x, dy = (p.depth) - (e.depth);
    const d = Math.hypot(dx, dy) || 1;
    const spd = e.def.projSpeed;
    this.projectiles.push({
      x: e.x, depth: e.depth, z: 12,
      vx: (dx / d) * spd, vdepth: (dy / d) * spd, life: t.projLife,
      dmg: e.def.attack, owner: 'enemy', color: t.projColor, r: t.projRadius, hit: new Set(),
    });
  }

  _updateBoss(b, dt) {
    const p = this.p;
    const def = b.def;
    const frac = b.hp / b.maxHp;

    // phase transitions
    const idx = bossPhaseIndex(def.phases, frac);
    b.phaseIdx = idx;
    const phase = def.phases[idx];
    if (b.phaseAnnounced !== idx) {
      b.phaseAnnounced = idx;
      this._setMessage(phase.name, 2.0, phase.note);
      Audio.bossRoar(); this.game.addShake(6);
      b.summonTimer = 1.2;
    }

    const dx = p.x - b.x;
    b.facing = dx >= 0 ? 1 : -1;
    const dist = Math.abs(dx);
    b.attackTimer -= dt;

    // summon adds on later phases
    if (phase.summon > 0) {
      b.summonTimer -= dt;
      if (b.summonTimer <= 0) {
        b.summonTimer = 6;
        b._summoning = 0.9;          // drives the call animation
        const n = Math.min(phase.summon, 5 - this.enemies.filter(e => !e.isBoss && e.hp > 0).length);
        for (let i = 0; i < n; i++) {
          const m = this._spawnEnemy('goblin', b.x + rand(-30, 30), clamp(b.depth + rand(-20, 20), DEPTH_MIN, DEPTH_MAX));
          this.particles.magicBurst(m.x, m.depth - 10, '#7cb356', 8);
        }
        this._setMessage('The King summons goblins!', 1.4);
      }
    }

    // movement + attacks
    if (dist > def.reach + 4 || Math.abs(p.depth - b.depth) > 20) {
      b.x += b.facing * phase.speed * dt;
      b.depth += Math.sign(p.depth - b.depth) * Math.min(Math.abs(p.depth - b.depth), phase.speed * 0.5 * dt);
      b.depth = clamp(b.depth, DEPTH_MIN, DEPTH_MAX);
      b.state = 'walk';
    } else if (b.attackTimer <= 0) {
      b.attackTimer = phase.cd;
      // choose slam (aoe) on last phase sometimes, else club sweep
      if (idx >= 2 && chance(0.5)) {
        b.state = 'heavy'; b.animTime = 0; b._slam = 0.4;
      } else {
        b.state = 'attack'; b.animTime = 0; b._swing = 0.28;
      }
    } else {
      b.state = 'idle';
    }

    if (b._swing > 0) { b._swing -= dt; if (b._swing <= 0) {
      if (Math.abs(p.x - b.x) < def.reach + 10 && Math.abs(p.depth - b.depth) < 24 && p.z < 24) this._hurtPlayer(def.attack, b.facing);
    }}
    if (b._slam > 0) { b._slam -= dt; if (b._slam <= 0) {
      // ground slam AoE with a shockwave
      this.game.addShake(5); this.hitStop = 0.05;
      this.particles.ring(b.x, b.depth, '#f2a03f', 60);
      if (Math.hypot(p.x - b.x, p.depth - b.depth) < 56 && p.z < 12) this._hurtPlayer(def.attack * 1.4, b.facing);
      Audio.heavyHit();
    }}
  }

  _hurtPlayer(amount, dir) {
    const p = this.p;
    if (p.invuln > 0) return;
    // shield absorbs first
    if (p.buffs.shield && p.shieldHp > 0) {
      const { absorbed, shieldLeft, remaining } = absorbWithShield(p.shieldHp, amount);
      p.shieldHp = shieldLeft; amount = remaining;
      // The Paladin's Guard remembers what it turned aside and owes it back as
      // holy damage. Other classes bank nothing, so their shields are unchanged.
      if (p.buffs.shield.banksGuard) p.guard = bankGuard(p.guard, absorbed);
      this.particles.ring(p.x, p.depth, '#9d8bff', 16);
      if (p.shieldHp <= 0) delete p.buffs.shield;
      if (amount <= 0) return;
    }
    let dmg = playerDamageAfterDefense(amount, this.hero.defense, {
      defenseBuff: !!p.buffs.defense,
    });
    // Sanctuary's field and a Stone Totem's circle both soften what lands.
    if (p.buffs.aura && p.buffs.aura.damageTaken) dmg = Math.round(dmg * p.buffs.aura.damageTaken);
    dmg = Math.round(dmg * this._totemDamageTaken());
    p.hp -= Math.max(1, dmg);
    // Taking a hit is losing pressure: Momentum goes with it. That is the
    // risk that stops Momentum being a free damage bonus.
    p.momentum = 0;
    p.flash = 1; p.invuln = 0.6; p.state = 'hurt'; p.animTime = 0; p.attackTimer = 0;
    p.knockVx = dir * 40; p.x += dir * 6;
    this.toasts.push(`${dmg}`, p.x, p.depth - 30, '#ff6a5a', { vy: -24 });
    this.particles.blood(p.x, p.depth, dir, '#e05a5a');
    this.game.addShake(2); Audio.hurt();
  }

  // --------------------------------------------------------- projectiles

  _updateProjectiles(dt) {
    const p = this.p;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      if (pr.vdepth) pr.depth += pr.vdepth * dt;
      // A wisp steers; an arrow does not. Cheap seek toward the nearest
      // living enemy, capped so it curves rather than snapping onto a target.
      if (pr.homing && pr.owner === 'player') {
        let best = null, bd = Infinity;
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          const d = Math.hypot(e.x - pr.x, e.depth - pr.depth);
          if (d < bd) { best = e; bd = d; }
        }
        if (best && bd < 200) {
          const dx = best.x - pr.x, dy = best.depth - pr.depth;
          const len = Math.hypot(dx, dy) || 1;
          const sp = Math.hypot(pr.vx, pr.vdepth || 0) || 1;
          pr.vx += (dx / len) * sp * 2.2 * dt;
          pr.vdepth = (pr.vdepth || 0) + (dy / len) * sp * 2.2 * dt;
          const ns = Math.hypot(pr.vx, pr.vdepth) || 1;
          pr.vx = (pr.vx / ns) * sp; pr.vdepth = (pr.vdepth / ns) * sp;
        }
      }
      pr.trailT = (pr.trailT || 0) + dt;
      if (pr.trailT > 0.03) { pr.trailT = 0; this.particles.spawn({ x: pr.x, y: pr.depth - pr.z, kind: 'ember', color: pr.color, vx: 0, vy: 0, life: 0.25, size: 1 }); }

      if (pr.owner === 'player') {
        for (const e of this.enemies) {
          if (e.hp <= 0 || pr.hit.has(e)) continue;
          if (Math.abs(e.x - pr.x) < e.w + 4 && Math.abs(e.depth - pr.depth) < 16) {
            pr.hit.add(e);
            // Precision shots punish a marked target — the Ranger's whole loop.
            const hit = pr.dmg * markMultiplier(e.marked > 0, { precision: !!pr.precision });
            this._damageEnemy(e, Math.round(hit), Math.sign(pr.vx) || 1, 50, {});
            if (pr.element === 'ice') e.frozen = Math.max(e.frozen, 1.5);
            // Poison is a real damage-over-time now, not just a green tint.
            if (pr.poison) e.poison = { dps: pr.poison.dps, t: pr.poison.dur };
            if (pr.basic) this._buildMomentum({});
            pr.pierce--;
            if (pr.pierce <= 0) pr.life = 0;
          }
        }
      } else {
        if (Math.abs(p.x - pr.x) < 10 && Math.abs(p.depth - pr.depth) < 14 && p.z < 20) {
          this._hurtPlayer(pr.dmg, Math.sign(pr.vx) || 1);
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => pr.life > 0 && pr.x > this.camX - 40 && pr.x < this.camX + this.W + 40);
    // fade lightning arcs
    if (this._lightning) {
      for (const l of this._lightning) l.t += dt;
      this._lightning = this._lightning.filter((l) => l.t < 0.2);
    }
  }

  // -------------------------------------------------------------- drops

  _spawnDrop(kind, x, depth, data) {
    this.drops.push({ kind, x, depth, z: 12, vz: rand(60, 110), vx: rand(-30, 30), data, t: 0, picked: false });
  }

  _spawnLootItem(x, depth) {
    // pick a weapon/trinket by rarity weighting, class-appropriate
    const pool = Object.entries(WEAPONS).filter(([id, w]) => w.price && (!w.cls || w.cls === this.hero.s.class));
    const rarityRoll = weighted([['common', 50], ['uncommon', 30], ['rare', 15], ['epic', 5]]);
    const matching = pool.filter(([, w]) => w.rarity === rarityRoll);
    const chosen = matching.length ? pick(matching) : pick(pool);
    this.drops.push({ kind: 'item', x, depth, z: 14, vz: 90, vx: rand(-20, 20), itemId: chosen[0], t: 0, picked: false });
  }

  _updateDrops(dt) {
    const p = this.p;
    for (const d of this.drops) {
      d.t += dt;
      d.vz -= 300 * dt; d.z += d.vz * dt;
      d.x += d.vx * dt; d.vx *= 0.9;
      if (d.z <= 0) { d.z = 0; d.vz = 0; }
      // auto-collect when close
      if (!d.picked && Math.abs(p.x - d.x) < 16 && Math.abs(p.depth - d.depth) < 20) {
        d.picked = true;
        if (d.kind === 'coin') {
          const g = this.hero.addGold(d.data.gold);
          this.toasts.push(`+${g}g`, p.x, p.depth - 30, UI.gold);
          Audio.coin();
        } else if (d.kind === 'item') {
          this.hero.addItem(d.itemId);
          const item = WEAPONS[d.itemId];
          this.toasts.push(`Found ${item.name}!`, p.x, p.depth - 32, RARITY[item.rarity].color, { life: 1.6 });
          Audio.unlock();
        }
        this.particles.pickup(p.x, p.depth - 14, UI.gold);
      }
    }
    this.drops = this.drops.filter((d) => !(d.picked && d.t > 0.1) && d.t < 20);
  }

  // -------------------------------------------------------------- camera

  _updateCamera(dt) {
    if (this._scrollTarget !== undefined && Math.abs(this.camX - this._scrollTarget) > 1) {
      this.camX = lerp(this.camX, this._scrollTarget, dt * 2.5);
      if (Math.abs(this.camX - this._scrollTarget) <= 2) {
        this.camX = this._scrollTarget;
        const s = this._pendingSpawn;
        this._scrollTarget = undefined;
        if (s !== undefined) { this._pendingSpawn = undefined; this._spawnGate(s); }
      }
    }
  }

  _onBossDefeated() {
    if (this.state !== 'play') return;
    // The FIRST time his bar empties he does not die — he refuses to. Control
    // is handed to the cinematic, which hands it back with Phase 2 standing.
    // Guarded on phase2 so the second defeat is a real one and the normal
    // victory/reward path is untouched.
    if (this.inArena && !this.phase2 && !this.cine) { this._beginThornCinematic(); return; }
    this.state = 'victory'; this.endTimer = 0;
    this.boss.hp = 0;
    this.hero.s.quests.bossDefeated = true;
    this.game.addShake(6); Audio.levelUp();
    this.particles.levelStars(this.boss.x, this.boss.depth - 20);
    this._setMessage('THE GOBLIN KING FALLS!', 3);
    // rewards
    this._grantRewards();
  }

  _beginThornCinematic() {
    const seen = !!(this.hero.s.flags && this.hero.s.flags.thornCinematicSeen);
    this.boss.hp = 1;                       // he is not dead; the bar is spent
    this.boss.seated = false;
    this.state = 'cinematic';
    this.message = null; this.messageT = 0; this.messageSub = null;
    this.tutorialBox = null; this.activeTip = null; this.tips = [];
    this.clearFlash = 0;
    Audio.confirm();
    this.cine = new ThornCinematic(this.boss, {
      W: this.W, H: this.H, camX: this.camX, canSkip: seen,
      // The hall's walls, so no shot can frame past the scenery.
      bounds: { x0: this.camX - 4, x1: this.camX + this.W + 4, y0: 0, y1: this.H },
      onFinish: () => this._endThornCinematic(),
    });
    if (this.hero.s.flags) this.hero.s.flags.thornCinematicSeen = true;
  }

  // Everything the cinematic changed about the fight is set HERE, once, so the
  // skip path and the played path cannot disagree about what Phase 2 is.
  _endThornCinematic() {
    this.cine = null;
    this.phase2 = true;
    this.state = 'play';
    const b = this.boss;
    if (b) {
      b.maxHp = Math.round(b.maxHp * 0.85);   // a fresh, shorter second bar
      b.hp = b.maxHp;
      b.phaseIdx = 0; b.phaseAnnounced = -1;
      b.attackTimer = 0.9;                    // a beat before he moves
      b.speed = (b.def.speed || 40) * 1.25;
      b.seated = false; b.z = 0;
    }
    this.arenaAwakened = true;                // the floor stays fractured
  }

  _grantRewards() {
    const q = this.hero.activeQuest();
    const reward = { gold: 0, xp: 0, items: [], pet: null, levels: 0 };
    // boss gold/xp
    const bg = randInt(this.boss.def.gold[0], this.boss.def.gold[1]);
    reward.gold += this.hero.addGold(bg);
    reward.levels += this.hero.addXp(this.boss.def.xp);
    // quest reward
    if (q && !this.hero.s.quests.completed.includes(q.id)) {
      this.hero.s.quests.completed.push(q.id);
      this.hero.s.quests.active = null;
      if (q.reward.gold) reward.gold += this.hero.addGold(q.reward.gold);
      if (q.reward.xp) reward.levels += this.hero.addXp(q.reward.xp);
      if (q.reward.item) { this.hero.addItem(q.reward.item); reward.items.push(q.reward.item); }
      // pet egg -> hatch a random pet the player doesn't have
      if (q.reward.petChance && chance(q.reward.petChance)) {
        const have = this.hero.s.inventory.pets;
        const options = Object.keys(PETS).filter((id) => !have.includes(id));
        if (options.length) {
          const petId = pick(options);
          this.hero.s.inventory.pets.push(petId);
          if (!this.hero.s.equipped.pet) this.hero.equipPet(petId);
          reward.pet = petId;
        }
      }
    }
    this.rewardData = reward;
    this.hero.save();
  }

  _updateEndState(dt) {
    this.endTimer += dt;
    this.particles.update(dt); this.toasts.update(dt);
    this.p.animTime += dt;
    for (const e of this.enemies) e.animTime += dt;
    if (this.messageT > 0) this.messageT -= dt;
    if (this.state === 'victory' && this.endTimer > 2.2) {
      this.state = 'reward'; this.rewardTimer = 0;
    }
    if (this.state === 'defeat' && this.endTimer > 2.0) {
      if (Input.anyPressed('confirm', 'interact', 'light')) {
        // revive at town with penalty
        this.hero.s.hp = Math.round(this.hero.maxHp * 0.5);
        this.hero.s.mana = Math.round(this.hero.maxMana * 0.5);
        this.hero.save();
        this.onExit('defeat');
      }
    }
  }

  _updateReward(dt) {
    this.rewardTimer += dt;
    this.particles.update(dt); this.toasts.update(dt);
    if (this.rewardTimer > 0.5 && Input.anyPressed('confirm', 'interact', 'light')) {
      this.onExit('victory');
    }
  }

  _setMessage(text, dur, sub = null) { this.message = text; this.messageT = dur; this.messageDur = dur; this.messageSub = sub; }

  // The boss walks in from off-screen; when he arrives the grove announces him.
  _updateBossIntro(dt) {
    if (this.bossIntroT <= 0) return;
    this.bossIntroT -= dt;
    if (this.bossIntroT > 0) return;
    this._setMessage('THE GOBLIN KING', 2.6, 'FOREST TYRANT');
    Audio.bossRoar();
    this.game.addShake(6);
    if (this.boss && this.boss.seated) {
      this.boss.seated = false;
      this.boss.riseT = 0.75;      // steps down off the dais, then AI takes over
    }
  }

  // Brings him off the platform over riseT. Purely the z drop — his own walk AI
  // carries him the rest of the way, so nothing here has to know about the fight.
  _updateBossSummonPose(dt) {
    const b = this.boss;
    if (b && b._summoning > 0) b._summoning = Math.max(0, b._summoning - dt);
  }

  _thornAnim(e) {
    if (e.state === 'attack') {
      const d = e.tuning?.attackAnim ?? 0.55;
      return { key: 'attack', u: Math.min(0.999, (e.animTime || 0) / d), loop: false };
    }
    if (e.state === 'hurt') {
      return { key: 'hurt', u: Math.min(0.999, (e.animTime || 0) / 0.34), loop: false };
    }
    if (e._summoning > 0) {
      return { key: 'summon', u: 1 - Math.min(1, e._summoning / 0.9), loop: false };
    }
    // Walking is detected from actual movement and advanced by DISTANCE, so his
    // feet cannot skate however fast a phase makes him chase. THORN_STRIDE is
    // measured off the art, not guessed: the widest foot separation in the walk
    // strip is one step, and a cycle is two of them. Get it wrong and his legs
    // cycle at a speed his body is not travelling at, which is exactly what
    // reads as skating.
    const moved = Math.abs(e.x - (e._prevX ?? e.x));
    e._prevX = e.x;
    if (moved > 0.08) {
      e._gait = ((e._gait || 0) + moved / THORN_STRIDE) % 1;
      return { key: 'walk', u: e._gait, loop: true };
    }
    e._idle = ((e._idle || 0) + 1 / 60 / 2.6) % 1;
    return { key: 'idle', u: e._idle, loop: true };
  }

  _drawThornKing(g, e) {
    // The cinematic poses are single plates and take priority.
    const posed = this._thornPose();
    if (posed === 'throne' || posed === 'kneel' || this.cine) {
      const img = THORN_ART[posed];
      if (!img || !img.complete || !img.naturalWidth) return false;
      const x = Math.round(e.x - img.naturalWidth / 2);
      const y = Math.round(e.depth - (e.z || 0) - img.naturalHeight);
      g.globalAlpha = e.alpha ?? 1;
      g.drawImage(img, x, y);
      g.globalAlpha = 1;
      return true;
    }

    const a = this._thornAnim(e);
    const set = THORN_ANIM[a.key];
    if (!set || !set.img.complete || !set.img.naturalWidth) return false;
    const i = a.i !== undefined
      ? Math.min(set.n - 1, Math.max(0, a.i))
      : Math.min(set.n - 1, Math.max(0, Math.floor(a.u * set.n)));
    const sx = i * set.w;
    const dx = Math.round(e.x - set.cx);
    const dy = Math.round(e.depth - (e.z || 0) - THORN_GROUND);
    const flip = e.facing > 0;
    g.save();
    if (flip) { g.translate(Math.round(e.x) * 2, 0); g.scale(-1, 1); }
    g.globalAlpha = e.alpha ?? 1;
    g.drawImage(set.img, sx, 0, set.w, THORN_FRAME_H,
                dx, dy, set.w, THORN_FRAME_H);
    // Phase 2 is the same performance seen through the thorn light, so he keeps
    // every animation instead of reverting to a single static plate.
    if (this.phase2) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.20;
      g.drawImage(set.img, sx, 0, set.w, THORN_FRAME_H,
                  dx, dy, set.w, THORN_FRAME_H);
      g.globalCompositeOperation = 'source-over';
    }
    if (e.flash > 0) {
      g.globalAlpha = Math.min(0.7, e.flash);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(set.img, sx, 0, set.w, THORN_FRAME_H,
                  dx, dy, set.w, THORN_FRAME_H);
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    g.restore();
    return true;
  }

  _drawEnemy(g, e) {
    if (e.isBoss && e.type === 'goblin_king' && this._drawThornKing(g, e)) return;
    const sc = e.isBoss ? e.scale : e.scale * ACTOR_SCALE;
    drawCharacter(g, {
      x: e.x, y: e.depth, z: e.z, facing: e.facing,
      sprite: e.sprite, state: e.hp <= 0 ? 'down' : e.state,
      animTime: e.animTime, animDuration: 0.3, flash: e.flash,
      alpha: e.alpha ?? 1, scale: sc,
      tint: e.tint, tintDark: e.tintDark, tintLite: e.tintLite,
    });
    if (e.frozen > 0) {
      g.globalAlpha = 0.4; disc(g, e.x, e.depth - 12, 12 * sc, '#9fd0ff'); g.globalAlpha = 1;
    }
    // small name + health, shown only while recently in combat, then faded
    if (!e.isBoss && e.hp > 0 && (e.showHp || 0) > 0) {
      const a = clamp01(e.showHp);
      g.globalAlpha = a;
      const w = 18;
      const yy = e.depth - actorHeight(e.sprite) * sc - 9;
      drawText(g, e.def.name.toUpperCase(), e.x, yy - 6, { color: '#d9d2e8', align: 'center', shadow: '#000' });
      bar(g, e.x - w / 2, yy, e.hp, e.maxHp, { w, h: 3, color: '#e0483c', back: '#160f22', frame: '#000' });
      g.globalAlpha = 1;
    }
  }

  /**
   * Totems. Drawn from the existing primitives rather than new art: a carved
   * post, a hovering mote, and a ring showing the ground it controls. The post
   * shortens as its life runs out, so you can see when it is about to go.
   */
  _drawTotems(g) {
    for (const t of this.totems) {
      const fx = this._abilityFx(t.ability);
      const frac = Math.max(0, t.life / t.maxLife);
      const h = 6 + Math.round(10 * frac);
      shadow(g, t.x, t.depth, 5, 2, 0.3);
      rect(g, t.x - 2, t.depth - h, 4, h, '#6b4a2e');
      rect(g, t.x - 3, t.depth - h - 2, 6, 3, '#8a6a44');
      // the area it holds, breathing so it reads as active
      const pulse = 0.5 + Math.sin(this.t * 3 + t.x) * 0.5;
      g.save();
      g.globalAlpha = 0.10 + pulse * 0.06;
      disc(g, t.x, t.depth, t.radius, fx.color);
      g.globalAlpha = 0.5 + pulse * 0.4;
      disc(g, t.x, t.depth - h - 5, 2, fx.color);
      g.restore();
    }
  }

  _drawProjectiles(g) {
    for (const pr of this.projectiles) {
      const y = pr.depth - pr.z;
      // A trailing tail behind the head reads as travel; a bare disc reads as a
      // dot that teleports. Three shrinking discs is enough at this resolution.
      const dir = Math.sign(pr.vx) || 1;
      disc(g, pr.x - dir * pr.r * 2.0, y, Math.max(1, pr.r - 3), pr.color2 || pr.color);
      disc(g, pr.x - dir * pr.r * 1.1, y, Math.max(1, pr.r - 2), pr.color);
      disc(g, pr.x, y, pr.r, pr.color);
      disc(g, pr.x, y, Math.max(1, pr.r - 2), '#ffffff');
    }
  }

  _drawLightning(g) {
    if (!this._lightning) return;
    for (const l of this._lightning) {
      const core = l.color2 || '#ffe066';
      const hot = l.color || '#fff2a0';
      // A vine creeps in a smooth arc; lightning forks. Same geometry, different
      // jitter — enough to tell a Ranger's Thornvine from Chain Lightning.
      const vine = l.shape === 'vine' || l.shape === 'chorus';
      const steps = vine ? 8 : 6;
      const jit = vine ? 1.2 : 3;
      let px = l.x1, py = l.y1;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const bow = vine ? Math.sin(t * Math.PI) * -7 : 0;
        const nx = lerp(l.x1, l.x2, t) + rand(-jit, jit);
        const ny = lerp(l.y1, l.y2, t) + bow + rand(-jit, jit);
        rect(g, px, py, Math.max(1, Math.abs(nx - px)), 1, core);
        rect(g, nx, Math.min(py, ny), 1, Math.max(1, Math.abs(ny - py)), hot);
        px = nx; py = ny;
      }
    }
  }

  _drawDrops(g) {
    for (const d of this.drops) {
      const y = d.depth - d.z;
      shadow(g, d.x, d.depth, 3, 1, 0.3);
      if (d.kind === 'coin') {
        const spin = Math.abs(Math.sin(d.t * 6));
        drawIcon(g, 'coin', d.x - 2 - spin, y - 4);
      } else if (d.kind === 'item') {
        const item = WEAPONS[d.itemId];
        // glow by rarity
        g.globalAlpha = 0.4 + Math.sin(this.t * 6) * 0.1;
        disc(g, d.x, y - 3, 6, RARITY[item.rarity].color);
        g.globalAlpha = 1;
        drawIcon(g, item.icon, d.x - 3, y - 6);
      }
    }
  }

  // -------------------------------------------------------------- HUD

  _drawHUD(g) {
    // The opening cutscene is the whole frame: drawn here, in screen space,
    // after the world transform is undone, and nothing else is drawn over it.
    if (this.cut) {
      this.cut.draw(g, this.W, this.H);
      if (this.cut.canSkip && this.cut.t > 1.2) {
        g.globalAlpha = 0.45;
        drawText(g, 'ENTER  SKIP', this.W - 10, this.H - 12, { color: '#9a9184', align: 'right' });
        g.globalAlpha = 1;
      }
      return;
    }

    // gold flash on area-clear
    if (this.clearFlash > 0) {
      g.globalAlpha = this.clearFlash * 0.18; g.fillStyle = '#f2c94f'; g.fillRect(0, 0, this.W, this.H); g.globalAlpha = 1;
    }

    // The cinematic owns the whole frame. Nothing of the fight's UI survives
    // into it — a health plate under a king's last words is the fastest way to
    // make a cutscene look like a menu.
    if (this.cine) { this._drawCinematicOverlay(g); return; }

    this._drawPlayerPlate(g);
    this._drawAbilityBar(g);
    this._drawTopBanner(g);
    this._drawMessage(g);
    this._drawTutorial(g);
    this._drawArenaPrompt(g);
  }

  // BOTTOM-LEFT: portrait + [NAME  LV] header + HP / MP / ST bars + pet.
  _drawPlayerPlate(g) {
    const h = this.hero, cls = h.cls(), p = this.p;
    const px = 4, py = this.H - 48, pw = 156, ph = 44;
    panel(g, px, py, pw, ph, { bg: 'rgba(9,7,16,0.9)' });

    // square portrait (reusable component), class-colored frame
    const fs = 34, fx = px + 5, fy = py + 5;
    this._drawPortrait(g, cls, fx, fy, fs);
    // equipped pet mini-icon tucked at the portrait's top-right corner
    const pet = h.pet();
    if (pet) { g.save(); drawPet(g, pet, fx + fs - 3, fy + 3, this.t); g.restore(); }

    // header: class name (class color) + level
    const colX = fx + fs + 7;
    const numRight = px + pw - 6;
    drawText(g, cls.name.toUpperCase(), colX, py + 5, { color: cls.color });
    drawText(g, `LV ${h.s.level}`, numRight, py + 5, { color: UI.gold, align: 'right' });

    // three evenly-spaced, equal-size bars with a dedicated number column
    const labelW = 15;
    const barX = colX + labelW;
    const barRight = numRight - 42;
    const barW = barRight - barX;
    const rows = [
      { label: 'HP', val: p.hp, max: p.maxHp, color: '#e0483c', ghost: p.ghostHp, ghostColor: '#5a2028' },
      { label: 'MP', val: p.dispMana, max: p.maxMana, color: UI.mana, pulse: p.manaPulse },
      { label: 'ST', val: p.dispSta, max: p.maxSta, color: UI.gold, pulse: p.staPulse },
    ];
    rows.forEach((r, i) => {
      const ry = py + 16 + i * 9;
      drawText(g, r.label, colX, ry, { color: UI.inkDim });
      let col = r.color;
      if (r.pulse > 0 && Math.floor(this.t * 12) % 2) col = '#ffffff';
      bar(g, barX, ry, r.val, r.max, { w: barW, h: 6, color: col, ghost: r.ghost, ghostColor: r.ghostColor });
      drawText(g, `${Math.ceil(r.val)}/${r.max}`, numRight, ry, { color: UI.ink, align: 'right', shadow: '#000' });
    });
    // XP sliver beneath the plate
    bar(g, px, py + ph, h.s.xp, h.xpToNext, { w: pw, h: 2, color: UI.xp, back: '#160f22', frame: '#160f22' });
  }

  // Reusable portrait: renders an enlarged head+shoulders crop of the class
  // sprite inside a framed square. Any class works; weapon is hidden.
  _drawPortrait(g, cls, x, y, size) {
    rect(g, x, y, size, size, '#0b0818');
    // subtle class-tinted backdrop
    g.globalAlpha = 0.14; disc(g, x + size / 2, y + size / 2 + 2, size / 2, cls.color); g.globalAlpha = 1;
    g.save(); g.beginPath(); g.rect(x, y, size, size); g.clip();
    drawCharacter(g, { x: x + size / 2, y: y + size + 20, z: 0, facing: 1, sprite: cls.sprite, weapon: 'none', state: 'idle', animTime: this.t, scale: 2.0 });
    g.restore();
    rectOutline(g, x, y, size, size, cls.color);
  }

  // BOTTOM-CENTER (viewport-centered): [1][2][3][4][Q][E].
  _drawAbilityBar(g) {
    const p = this.p;
    const defs = this.hero.equippedAbilityDefs();
    const unlockedCount = this.hero.s.unlocked.length;
    const labels = ['1', '2', '3', '4', 'Q', 'E'];
    const slotW = 25, slotH = 25, gap = 3;
    const total = labels.length * slotW + (labels.length - 1) * gap;
    const startX = Math.round(this.W / 2 - total / 2); // centered on the viewport
    const sy = this.H - slotH - 6;                      // margin off the bottom edge
    const ic = (name, bx, extra = 0) => drawIcon(g, name, Math.round(bx + (slotW - 7 * 1.6) / 2), sy + 9 + extra, 1.6);

    for (let i = 0; i < labels.length; i++) {
      const bx = startX + i * (slotW + gap);
      const isAbility = i < 4;
      const d = isAbility ? defs[i] : null;

      let frame = UI.frameDark;
      if (d && (p.cooldowns[d.id] || 0) <= 0 && p.mana >= (d.mana || 0)) frame = UI.gold;
      panel(g, bx, sy, slotW, slotH, { bg: 'rgba(9,7,16,0.92)', frame });

      if (isAbility) {
        if (d) {
          ic(d.icon, bx);
          const cd = p.cooldowns[d.id] || 0;
          if (cd > 0) {
            const frac = clamp01(cd / d.cd);
            g.fillStyle = 'rgba(7,5,14,0.72)';
            g.fillRect(bx + 1, sy + 1, slotW - 2, (slotH - 2) * frac);
            drawText(g, cd.toFixed(cd < 1 ? 1 : 0), bx + slotW / 2, sy + 10, { color: '#fff', align: 'center', shadow: '#000' });
          } else if (d.mana && p.mana < d.mana) {
            g.fillStyle = 'rgba(9,7,16,0.5)'; g.fillRect(bx + 1, sy + 1, slotW - 2, slotH - 2);
          }
          if (d.mana) drawText(g, `${d.mana}`, bx + slotW - 2, sy + slotH - 7, { color: UI.mana, align: 'right' });
        } else if (i < unlockedCount) {
          ic('plus', bx);
        } else {
          ic('lock', bx);
        }
      } else if (labels[i] === 'Q') {
        const q = defs[0];
        if (q) { g.globalAlpha = 0.65; ic(q.icon, bx); g.globalAlpha = 1; }
        else ic('plus', bx);
      } else { // E = health potion
        ic('potionRed', bx);
        drawText(g, `${this.hero.s.inventory.potions.health || 0}`, bx + slotW - 2, sy + slotH - 7, { color: UI.good, align: 'right' });
      }

      // keybind chip, top-left
      rect(g, bx + 1, sy + 1, 8, 8, 'rgba(7,5,14,0.85)');
      drawText(g, labels[i], bx + 3, sy + 2, { color: '#c9c2e0' });
    }
  }

  // TOP-CENTER: boss bar, or a wave/enemy banner. Never both.
  _drawTopBanner(g) {
    // Not while he is still on the throne: the bar going up before he moves
    // announces the fight the staging is trying to let you discover.
    if (this.boss && this.boss.hp > 0 && !this.boss.seated && !this.cine) {
      const bw = this.W - 80, bx = 40, by = 16;
      // dark banner strip behind
      rect(g, bx - 6, by - 12, bw + 12, 30, 'rgba(9,7,16,0.7)');
      drawText(g, this.boss.def.name.toUpperCase(), this.W / 2, by - 10, { color: '#ff6a5a', align: 'center', scale: 2, shadow: '#000' });
      bar(g, bx, by + 8, this.boss.hp, this.boss.maxHp, { w: bw, h: 8, color: '#c0463c', frame: '#2a0f14', lite: '#e88' });
      const ph = this.boss.def.phases[this.boss.phaseIdx];
      drawText(g, 'THE FOREST TYRANT  •  ' + ph.name, this.W / 2, by + 18, { color: UI.gold, align: 'center' });
      return;
    }

    // wave / enemy counter banner
    const remaining = this.enemies.filter((e) => e.hp > 0).length;
    if (remaining === 0) return; // AREA CLEARED handled by the center message

    // LAST ENEMY: big animated banner for ~1s, then a small "sword 1" indicator.
    if (remaining === 1 && (this.lastEnemyT || 0) < 1.1) {
      const pop = Math.min(1, (this.lastEnemyT || 0) * 6);
      const pulse = 1 + Math.sin(this.t * 10) * 0.06;
      g.save();
      const label = 'LAST ENEMY';
      const w = textWidth(label, 2) + 26;
      const bx = this.W / 2 - w / 2, by = 6;
      g.globalAlpha = pop;
      rect(g, bx, by, w, 16, 'rgba(9,7,16,0.85)');
      rectOutline(g, bx, by, w, 16, '#ff6a5a');
      drawIcon(g, 'sword', bx + 6, by + 5, 1.3);
      drawText(g, label, bx + w / 2 + 6, by + 2, { color: '#ff8a6a', align: 'center', scale: 2 * pulse, shadow: '#000' });
      g.restore();
      return;
    }

    // compact counter
    const label = remaining === 1 ? '1' : `WAVE ${this.waveNum || 1}  •  ${remaining} REMAINING`;
    const w = textWidth(label) + 20;
    const bx = this.W / 2 - w / 2, by = 4;
    rect(g, bx, by, w, 12, 'rgba(9,7,16,0.82)');
    rectOutline(g, bx, by, w, 12, UI.frameDark);
    drawIcon(g, 'sword', bx + 5, by + 3);
    drawText(g, label, bx + w / 2 + 6, by + 3, { color: UI.ink, align: 'center' });
  }

  _drawMessage(g) {
    if (this.messageT <= 0 || !this.message) return;
    const fade = Math.min(1, this.messageT * 2) * Math.min(1, (this.messageDur - this.messageT + 0.2) * 4);
    g.globalAlpha = clamp01(fade);
    // auto-fit so long banners never run off-screen; sit lower during boss
    // fights so it never collides with the boss health bar at the top.
    // Boss banners sit smaller and higher than wave banners: at scale 3 the
    // title ran across the middle of the frame and covered the arena, which is
    // the one thing a boss reveal should be showing off. The HP bar carries the
    // persistent information, so this only has to be a flourish.
    const isBoss = !!this.boss;
    let sc = isBoss ? 2 : 3;
    while (sc > 1 && textWidth(this.message, sc) > this.W - 28) sc--;
    const my = isBoss ? 58 : 40;
    // fade in with a slight expansion, hold, fade out
    const inT = clamp01((this.messageDur - this.messageT) / 0.32);
    const grow = 0.88 + 0.12 * (1 - (1 - inT) * (1 - inT));
    g.save();
    g.translate(this.W / 2, my);
    g.scale(grow, grow);
    g.translate(-this.W / 2, -my);
    heading(g, this.W, my, this.message, { scale: sc, color: '#ffe066' });
    if (this.messageSub) drawText(g, this.messageSub, this.W / 2, my + sc * 8 + 4, { color: UI.ink, align: 'center', shadow: '#000' });
    g.restore();
    g.globalAlpha = 1;
  }

  _drawTutorial(g) {
    // Only the brief opening control box (top-right), which fades out. No
    // permanent or center-screen prompts — the ability keys live on the slots.
    if (!this.tutorialBox) return;
    const tb = this.tutorialBox;
    const fade = Math.min(1, tb.t * 3) * clamp01((tb.dur - tb.t) * 2);
    g.globalAlpha = clamp01(fade);
    const bw = 128, bh = tb.lines.length * 11 + 10;
    const bx = this.W - bw - 8, by = 40;
    panel(g, bx, by, bw, bh, { bg: 'rgba(9,7,16,0.85)' });
    tb.lines.forEach((l, i) => drawText(g, l, bx + 8, by + 6 + i * 11, { color: UI.ink }));
    g.globalAlpha = 1;
  }

  // Shown only while the player is actually standing in the gateway, and it
  // pulses so it reads as an invitation rather than a HUD element.
  _drawArenaPrompt(g) {
    if (!this.arenaPrompt) return;
    const label = 'E   ENTER THE HALL';
    const bw = 118, bh = 18;
    const bx = this.W / 2 - bw / 2, by = this.H - 96;
    g.globalAlpha = 0.72 + Math.sin(this.t * 4) * 0.22;
    panel(g, bx, by, bw, bh, { bg: 'rgba(12,8,10,0.88)', frame: UI.gold });
    drawText(g, label, bx + 10, by + 5, { color: UI.gold });
    g.globalAlpha = 1;
  }

  _drawRewardScreen(g) {
    g.fillStyle = 'rgba(8,6,16,0.8)'; g.fillRect(0, 0, this.W, this.H);
    const r = this.rewardData || { gold: 0, levels: 0, items: [], pet: null };
    const bw = 220, bh = 140, bx = this.W / 2 - bw / 2, by = this.H / 2 - bh / 2;
    panel(g, bx, by, bw, bh, { frame: UI.gold });
    heading(g, this.W, by + 8, 'VICTORY!', { scale: 3, color: UI.gold });
    drawText(g, 'The Goblin King is defeated.', this.W / 2, by + 34, { color: UI.ink, align: 'center' });

    let y = by + 50;
    const line = (label, val, col) => { drawText(g, label, bx + 16, y, { color: UI.inkDim }); drawText(g, val, bx + bw - 16, y, { color: col, align: 'right' }); y += 13; };
    line('Gold earned', `+${r.gold}`, UI.gold);
    line('Hero level', `${this.hero.s.level}`, UI.good);
    if (r.items.length) {
      for (const id of r.items) { drawIcon(g, WEAPONS[id].icon, bx + 16, y - 1); drawText(g, WEAPONS[id].name, bx + 28, y, { color: RARITY[WEAPONS[id].rarity].color }); y += 12; }
    }
    if (r.pet) {
      drawText(g, `NEW PET: ${PETS[r.pet].name}!`, this.W / 2, y, { color: '#e0679a', align: 'center' }); y += 12;
      drawText(g, PETS[r.pet].desc, this.W / 2, y, { color: UI.inkDim, align: 'center' }); y += 12;
    }

    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (blink) drawText(g, 'Press J to return to town', this.W / 2, by + bh - 12, { color: UI.gold, align: 'center' });
  }

  _drawDefeatScreen(g) {
    g.fillStyle = 'rgba(20,4,8,0.75)'; g.fillRect(0, 0, this.W, this.H);
    heading(g, this.W, this.H / 2 - 20, 'YOU FELL', { scale: 3, color: '#e05a5a' });
    drawText(g, 'The dungeon claims another hero...', this.W / 2, this.H / 2 + 8, { color: UI.inkDim, align: 'center' });
    drawText(g, 'Train harder, then return stronger.', this.W / 2, this.H / 2 + 20, { color: UI.ink, align: 'center' });
    if (this.endTimer > 2.0) {
      const blink = Math.floor(this.t * 2) % 2 === 0;
      if (blink) drawText(g, 'Press J to retreat to town', this.W / 2, this.H / 2 + 40, { color: UI.gold, align: 'center' });
    }
  }

  _drawPause(g) {
    g.fillStyle = 'rgba(8,6,16,0.7)'; g.fillRect(0, 0, this.W, this.H);
    heading(g, this.W, this.H / 2 - 24, 'PAUSED', { scale: 2 });
    drawText(g, 'Esc resume', this.W / 2, this.H / 2, { color: UI.ink, align: 'center' });
    drawText(g, 'Esc again to keep fighting', this.W / 2, this.H / 2 + 12, { color: UI.inkDim, align: 'center' });
  }
}

// ---------------------------------------------------------- terrain detail
// Small, low-contrast environment props so the forest floor reads with depth
// without competing with the actors. All deterministic by world-x.

function mountain(g, x, baseY, w, h, color) {
  g.fillStyle = color;
  for (let i = 0; i < h; i++) { const k = i / h; const rw = Math.round(w * (1 - Math.pow(1 - k, 1.5)) * 0.5); rect(g, x - rw, baseY - h + i, rw * 2, 1, color); }
}

// A small designed cluster of Goblin-Forest debris. `r` selects the theme so a
// given world spot always renders the same tableau (stump+axe+chips, broken
// shield+arrow, dead campfire, goblin sign, etc.).
function drawForestCluster(g, x, y, r, t) {
  x = Math.round(x); y = Math.round(y);
  if (r < 0.22) {            // logging site: stump + axe + wood chips
    drawStump(g, x, y);
    drawAxe(g, x + 7, y - 2);
    woodChips(g, x - 6, y + 1);
  } else if (r < 0.40) {     // skirmish remains: broken shield + arrow + dirt
    softPatch(g, x, y + 1, 9, '#3a3020');
    brokenShield(g, x - 4, y);
    arrowInGround(g, x + 6, y - 1);
  } else if (r < 0.55) {     // dead campfire with a lazy ember
    deadCampfire(g, x, y, t);
  } else if (r < 0.68) {     // crude goblin sign
    goblinSign(g, x, y);
  } else if (r < 0.80) {     // abandoned sack + coins spill
    sack(g, x, y);
  }
  // else: leave this spot open (breathing room)
}

function drawAxe(g, x, y) {
  rect(g, x, y - 8, 1, 8, '#5c3a1a');       // handle
  rect(g, x - 3, y - 9, 4, 3, '#9aa3b8');   // head
  rect(g, x - 3, y - 9, 1, 3, '#cdd6dd');
}
function woodChips(g, x, y) {
  for (let i = 0; i < 4; i++) rect(g, x + i * 3, y + (i % 2), 2, 1, '#8a6a3a');
}
function brokenShield(g, x, y) {
  shadow(g, x, y, 5, 1, 0.2);
  rect(g, x - 4, y - 8, 8, 8, '#6b4a2e');
  rect(g, x - 3, y - 7, 6, 6, '#8a93a8');
  rect(g, x - 1, y - 6, 2, 4, '#c0463c');   // emblem
  rect(g, x + 1, y - 4, 3, 4, '#3a2a1e');   // broken corner (missing)
}
function arrowInGround(g, x, y) {
  rect(g, x, y - 9, 1, 9, '#6b4a2e');
  rect(g, x - 1, y - 10, 3, 1, '#9aa3b8');  // head
  rect(g, x - 1, y - 8, 3, 1, '#cdd6dd');   // fletching
}
function deadCampfire(g, x, y, t) {
  shadow(g, x, y, 6, 2, 0.25);
  // ring of stones
  for (let a = 0; a < 6; a++) { const ax = x + Math.cos(a) * 5, ay = y + Math.sin(a) * 2; rect(g, Math.round(ax), Math.round(ay) - 1, 2, 2, '#5c5f6b'); }
  rect(g, x - 3, y - 2, 6, 2, '#2a1a12');   // charred wood
  rect(g, x - 2, y - 1, 1, 1, '#4a3020');
  if (Math.sin(t * 3) > 0.6) rect(g, x, y - 3, 1, 1, '#f2942b'); // faint ember
}
function goblinSign(g, x, y) {
  rect(g, x - 1, y - 12, 2, 12, '#4a3220');
  rect(g, x - 7, y - 16, 14, 6, '#6b4a2e');
  rectOutline(g, x - 7, y - 16, 14, 6, '#3a2a1e');
  rect(g, x - 5, y - 14, 3, 1, '#2a1a12');  // crude glyphs
  rect(g, x - 1, y - 14, 4, 1, '#2a1a12');
  rect(g, x - 4, y - 13, 8, 1, '#2a1a12');
}
function sack(g, x, y) {
  shadow(g, x, y, 5, 2, 0.25);
  rect(g, x - 4, y - 6, 8, 6, '#8a7a54');
  rect(g, x - 4, y - 6, 8, 1, '#6b5c3a');
  rect(g, x - 2, y - 8, 4, 2, '#6b5c3a');   // tied neck
  rect(g, x + 5, y - 1, 2, 1, '#f2c94f');   // a spilled coin
  rect(g, x + 7, y - 1, 1, 1, '#f2c94f');
}

function drawFgGrass(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < 5; i++) {
    const gx = x + i * 3 - 6;
    const h = 5 + ((i * 7) % 4);
    rect(g, gx, y - h, 1, h, '#1c3a20');
    rect(g, gx, y - h, 1, 2, '#2a5030');
  }
}

function pineSil(g, x, baseY, h, color) {
  x = Math.round(x);
  for (let t = 0; t < 3; t++) {
    const ty = baseY - (h / 3) * (t + 1) + 4;
    const tw = 8 - t * 2;
    for (let i = 0; i < h / 3; i++) { const k = i / (h / 3); const rw = Math.round(tw * (0.3 + k * 0.7)); rect(g, x - rw, ty + i, rw * 2, 1, color); }
  }
}

function softPatch(g, x, y, r, color) {
  x = Math.round(x); y = Math.round(y); r = Math.round(r);
  g.fillStyle = color;
  for (let dy = -2; dy <= 2; dy++) { const w = Math.round(r * (1 - Math.abs(dy) / 3)); if (w > 0) g.fillRect(x - w, y + dy, w * 2, 1); }
}

function drawStump(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 5, 2, 0.25);
  rect(g, x - 4, y - 5, 8, 5, '#4a3220');
  rect(g, x - 4, y - 6, 8, 2, '#5c4028');
  rect(g, x - 2, y - 6, 1, 1, '#6b4a2e');
  rect(g, x + 1, y - 5, 1, 1, '#6b4a2e');
}

function drawMushrooms(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  shadow(g, x, y, 4, 1, 0.2);
  rect(g, x - 1, y - 3, 2, 3, '#d8cbb0');
  rect(g, x - 3, y - 5, 6, 2, '#c0463c');
  rect(g, x - 2, y - 4, 1, 1, '#ffd6c0');
  rect(g, x + 3, y - 2, 1, 2, '#d8cbb0');
  rect(g, x + 2, y - 3, 3, 1, '#c0463c');
}

function drawFlowers(g, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < 3; i++) {
    const fx = x + (i - 1) * 4;
    rect(g, fx, y - 3, 1, 3, '#2f5836');
    const col = ['#f2c94f', '#e0679a', '#9d8bff'][i % 3];
    rect(g, fx, y - 4, 1, 1, col);
    rect(g, fx - 1, y - 3, 3, 1, col);
  }
}
