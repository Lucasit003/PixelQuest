// The dungeon: a Castle-Crashers-style 2.5D beat-'em-up. The arena has depth
// (actors move on an x/depth plane and are y-sorted) plus a z axis for jumping.
// Combat is pure action — light/heavy combos, knockback, juggling, dodge, jump
// attacks and the trained abilities. NO questions ever appear here.
//
// Flow: forest waves -> mini-boss (Bone Archer + skeletons) -> Goblin King with
// four phases -> loot. The camera scrolls as the player clears each gate.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, bar, heading, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, clamp, clamp01, lerp, disc, shadow } from '../gfx/pixel.js';
import { drawCharacter, actorHeight, drawPet } from '../gfx/actors.js';
import { drawIcon, drawPineTree, drawBush, drawTorch, drawStoneFloor, drawRock } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { resolveFx, playAbilityFx, CLASS_FX } from '../gfx/abilityFx.js';
import { rand, randInt, chance, pick, weighted } from '../core/rng.js';
import {
  ENEMIES, BOSS, WEAPONS, ABILITIES, RARITY, PETS,
} from '../game/data.js';
import {
  meleeBaseDamage, meleeKnockback, finalHitDamage, abilityBaseDamage,
  enemyDamageAfterDefense, playerDamageAfterDefense, absorbWithShield,
  bossPhaseIndex, CHAIN_FALLOFF,
} from '../game/combatMath.js';
import { resolveBehavior, tuningFor } from '../game/enemyBehaviors.js';

// Arena depth band (the "floor" the actors walk on).
const DEPTH_MIN = 150;
const DEPTH_MAX = 250;

// Render-only scale bump for actors so they read clearly in the arena. Collision
// math still uses the unscaled reach/width constants — this only affects drawing.
const ACTOR_SCALE = 1.4;

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
    this.drops = [];
    this.hitStop = 0;              // freeze frames on big hits
    this.slowmo = 0;
    this.message = null; this.messageT = 0; this.messageSub = null; this.messageDur = 1;
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
      { x: 480, spawns: [['goblin', 2], ['slime', 1], ['splitcrown', 1]] },
      { x: 740, spawns: [['skeleton', 2], ['goblin', 1]] },
      { x: 980, spawns: [['skeleton_archer', 1], ['skeleton', 2], ['slime_blue', 1]], mini: true },
      { x: 1300, boss: 'goblin_king' },
    ];
  }

  _spawnGate(i) {
    const gate = this.gates[i];
    if (!gate) return;
    this.gateCleared = false;
    if (gate.boss) {
      this._spawnBoss(gate.boss);
      this._setMessage('THE GOBLIN KING', 2.4);
      Audio.bossRoar();
      this.game.addShake(6);
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

  _splitEnemy(e) {
    for (let i = 0; i < e.def.splitInto.length; i++) {
      const dir = i === 0 ? -1 : 1;
      const child = this._spawnEnemy(e.def.splitInto[i],
        e.x + dir * 10, clamp(e.depth + dir * 4, DEPTH_MIN, DEPTH_MAX));
      child.facing = e.facing;
      child.knockVx = dir * 45;          // burst apart...
      child.z = 1; child.vz = 85;        // ...with a little hop out
      child.showHp = 2;
    }
    this.particles.magicBurst(e.x, e.depth - 8, '#7fe8a8', 10);
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
      x: this.camX + this.W - 60, depth: 200, z: 0, vz: 0, facing: -1,
      hp: Math.round(def.hp * lvScale), maxHp: Math.round(def.hp * lvScale),
      state: 'idle', animTime: 0, animDuration: 0,
      flash: 0, attackTimer: 2, hurtTimer: 0, knockVx: 0, knockVdepth: 0,
      stunned: 0, frozen: 0, scale: 1.6, w: def.w, isBoss: true,
      phaseIdx: 0, phaseAnnounced: -1, summonTimer: 3,
    };
    this.enemies.push(this.boss);
  }

  exit() {}

  // ================================================================ update

  update(dt, game) {
    this.t += dt;

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
    // scroll camera to next gate, then spawn
    this._scrollTarget = Math.min(this.gates[this.currentGate].x - this.W / 2, this.worldEnd - this.W);
    this._scrollTarget = Math.max(0, this._scrollTarget);
    this._pendingSpawn = this.currentGate;
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
      const spd = p.speed * (p.buffs.speed ? 1.4 : 1) * (1 + this.hero.petBonus('moveSpeed'));
      if (ax.x !== 0 || ax.y !== 0) {
        p.x += ax.x * spd * dt;
        p.depth += ax.y * spd * 0.7 * dt;
        p.depth = clamp(p.depth, DEPTH_MIN, DEPTH_MAX);
        p.x = clamp(p.x, this.camX + 8, this.camX + this.W - 8);
        if (ax.x !== 0) p.facing = ax.x > 0 ? 1 : -1;
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
    if (Input.pressed('interact')) this._quaffHealth();

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
    const dmg = meleeBaseDamage(this.hero.attack, {
      heavy, comboStep: p.comboStep, rageMult: p.buffs.rage ? p.buffs.rage.mult : 1,
    });

    for (const e of this.enemies) {
      if (e.hp <= 0 || p.hitList.has(e)) continue;
      const dx = e.x - p.x;
      const facingRight = p.facing > 0;
      if ((facingRight && dx < -6) || (!facingRight && dx > 6)) continue;
      if (Math.abs(dx) > reach) continue;
      if (Math.abs(e.depth - p.depth) > 18) continue;

      p.hitList.add(e);
      const crit = Math.random() < this.hero.crit;
      const finalDmg = finalHitDamage(dmg, { crit, variance: rand(0.9, 1.1) });
      const kb = meleeKnockback({ heavy, comboStep: p.comboStep });
      this._damageEnemy(e, finalDmg, p.facing, kb, {
        crit, launch: heavy, air: e.z > 0 || heavy,
      });

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

    const power = this.hero.magic || this.hero.attack;
    switch (ab.kind) {
      case 'projectile': this._castProjectile(ab, power); break;
      case 'aoe': this._castAoe(ab, power); break;
      case 'melee': this._castMeleeAbility(ab, power); break;
      case 'chain': this._castChain(ab, power); break;
      case 'buff': this._castBuff(ab); break;
    }
  }

  _castProjectile(ab, power) {
    const p = this.p;
    const dmg = abilityBaseDamage(ab, power, { fireBonus: this.hero.petBonus('fireDmg') });
    this.projectiles.push({
      x: p.x + p.facing * 12, depth: p.depth, z: 14,
      vx: p.facing * ab.speed, life: ab.range / ab.speed,
      dmg: Math.round(dmg), owner: 'player', element: ab.element,
      color: this._abilityFx(ab).color, color2: this._abilityFx(ab).color2,
      pierce: 1, hit: new Set(), r: 4,
    });
    this._playFx(ab, p.x, p.depth, ab.range || 40);
  }

  _castAoe(ab, power) {
    const p = this.p;
    const dmg = abilityBaseDamage(ab, power);
    this._playFx(ab, p.x, p.depth, ab.range);
    this.hitStop = 0.06;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - p.x, e.depth - p.depth);
      if (d <= ab.range) {
        const dir = e.x >= p.x ? 1 : -1;
        this._damageEnemy(e, Math.round(dmg * rand(0.9, 1.1)), dir, ab.kb || 100, { launch: true, air: true });
        if (ab.freeze) { e.frozen = ab.freeze; }
      }
    }
  }

  /** The look of an ability, resolved from its own vfx, its element, then its class. */
  _abilityFx(ab) { return resolveFx(ab, this.hero.s.class); }

  _playFx(ab, x, y, range) {
    playAbilityFx(this._abilityFx(ab), this.particles, (n) => this.game.addShake(n),
                  x, y, this.p.facing, range);
  }

  _castMeleeAbility(ab, power) {
    const p = this.p;
    const dmg = abilityBaseDamage(ab, power);
    this._playFx(ab, p.x, p.depth, ab.range || 40);
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - p.x;
      if ((p.facing > 0 && dx < 0) || (p.facing < 0 && dx > 0)) continue;
      if (Math.abs(dx) > ab.range || Math.abs(e.depth - p.depth) > 22) continue;
      this._damageEnemy(e, Math.round(dmg), p.facing, ab.kb || 120, { launch: true });
      if (ab.stun) e.stunned = ab.stun;
    }
  }

  _castChain(ab, power) {
    const p = this.p;
    let dmg = abilityBaseDamage(ab, power);
    // find nearest, then chain to nearest others
    const targets = this.enemies.filter((e) => e.hp > 0)
      .sort((a, b) => Math.hypot(a.x - p.x, a.depth - p.depth) - Math.hypot(b.x - p.x, b.depth - p.depth))
      .slice(0, ab.chains);
    let prev = { x: p.x, depth: p.depth - 12 };
    for (const e of targets) {
      this._damageEnemy(e, Math.round(dmg), e.x >= p.x ? 1 : -1, 40, {});
      e.stunned = Math.max(e.stunned, 0.4);
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
    if (ab.atkMult) { p.buffs.rage = { t: ab.dur, mult: ab.atkMult }; if (ab.speedMult) p.buffs.speed = { t: ab.dur }; }
    if (ab.shield) { p.buffs.shield = { t: ab.dur, amount: ab.shield }; p.shieldHp = ab.shield; }
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
    e.animTime = 0; // the down animation starts on its first frame
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

      if (e.hp <= 0) {
        e.deathT = (e.deathT || 0) + dt;
        const hold = e.def.deathHold || 0;
        if (hold) {
          // sheet slimes play their down row flat on the ground, then fade;
          // no corpse float. Splitcrown's down row IS the split, so its two
          // children take over the moment it finishes.
          e.alpha = clamp01(1 - Math.max(0, e.deathT - hold) * 4);
          if (e.def.splitInto && !e._split && e.deathT >= hold) {
            e._split = true;
            this._splitEnemy(e);
          }
        } else {
          // death fade
          e.alpha = clamp01(1 - e.deathT * 2.5);
          e.z += dt * 6;
        }
        e.knockVx *= 0.9; e.x += e.knockVx * dt;
        continue;
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
      const { shieldLeft, remaining } = absorbWithShield(p.shieldHp, amount);
      p.shieldHp = shieldLeft; amount = remaining;
      this.particles.ring(p.x, p.depth, '#9d8bff', 16);
      if (p.shieldHp <= 0) delete p.buffs.shield;
      if (amount <= 0) return;
    }
    const dmg = playerDamageAfterDefense(amount, this.hero.defense, {
      defenseBuff: !!p.buffs.defense,
    });
    p.hp -= dmg;
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
      pr.trailT = (pr.trailT || 0) + dt;
      if (pr.trailT > 0.03) { pr.trailT = 0; this.particles.spawn({ x: pr.x, y: pr.depth - pr.z, kind: 'ember', color: pr.color, vx: 0, vy: 0, life: 0.25, size: 1 }); }

      if (pr.owner === 'player') {
        for (const e of this.enemies) {
          if (e.hp <= 0 || pr.hit.has(e)) continue;
          if (Math.abs(e.x - pr.x) < e.w + 4 && Math.abs(e.depth - pr.depth) < 16) {
            pr.hit.add(e);
            this._damageEnemy(e, pr.dmg, Math.sign(pr.vx) || 1, 50, {});
            if (pr.element === 'ice') e.frozen = Math.max(e.frozen, 1.5);
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
    this.state = 'victory'; this.endTimer = 0;
    this.boss.hp = 0;
    this.hero.s.quests.bossDefeated = true;
    this.game.addShake(6); Audio.levelUp();
    this.particles.levelStars(this.boss.x, this.boss.depth - 20);
    this._setMessage('THE GOBLIN KING FALLS!', 3);
    // rewards
    this._grantRewards();
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

  // ================================================================ draw

  draw(g) {
    // Shake is applied to the WORLD layer only; the HUD stays perfectly still.
    const sh = this.game.shakeOffset();
    const ox = -Math.round(this.camX) + sh.x;

    g.save();
    g.translate(ox, sh.y);
    this._drawWorld(g);

    // y-sort actors by depth
    const actors = [this.p, ...this.enemies];
    actors.sort((a, b) => a.depth - b.depth);
    for (const a of actors) {
      if (a === this.p) this._drawPlayer(g);
      else this._drawEnemy(g, a);
    }

    // projectiles + drops on top of actors roughly
    this._drawProjectiles(g);
    this._drawDrops(g);
    this._drawLightning(g);
    this.particles.draw(g);
    this.toasts.draw(g);
    g.restore();

    // HUD is screen-space: no camera translate, no shake.
    this._drawHUD(g);
    if (this.state === 'reward') this._drawRewardScreen(g);
    if (this.state === 'defeat' && this.endTimer > 0.6) this._drawDefeatScreen(g);
    if (this.paused) this._drawPause(g);
  }

  _drawWorld(g) {
    const camX = this.camX;
    const bossZone = camX > 1050;
    if (bossZone) return this._drawBossZone(g, camX);

    const W = this.W;
    const GROUND_TOP = 84; // grass horizon on screen — keeps the sky compact

    // --- compact sky (darkest up top), ~21% of the frame
    const sky = ['#161d33', '#1b2440', '#212c4c', '#283457', '#313e62'];
    for (let i = 0; i < sky.length; i++) {
      const y0 = Math.round((GROUND_TOP - 26) * i / sky.length);
      rect(g, camX, y0, W, Math.ceil((GROUND_TOP - 26) / sky.length) + 1, sky[i]);
    }
    // atmospheric haze at the horizon
    rect(g, camX, GROUND_TOP - 28, W, 6, 'rgba(120,130,170,0.10)');

    // --- FAR: dark blue mountains (lowest contrast), slow parallax
    const mp = -(camX * 0.18);
    for (let x = Math.floor((camX * 0.82) / 64) * 64 - 64; x < camX + W + 64; x += 64) {
      mountain(g, x + (mp % 64) + 32, GROUND_TOP - 6, 60, 34, '#1b2740');
    }
    for (let x = Math.floor((camX * 0.82) / 52) * 52 - 52; x < camX + W + 52; x += 52) {
      mountain(g, x + (mp % 52) + 26, GROUND_TOP - 4, 44, 22, '#212e4a');
    }
    // very dark distant pine silhouettes
    const p1 = -(camX * 0.3);
    for (let x = Math.floor((camX * 0.7) / 30) * 30 - 30; x < camX + W + 30; x += 30) {
      pineSil(g, x + (p1 % 30) + 15, GROUND_TOP + 2, 20, '#131c2a');
    }
    // --- MID: nearer pines (medium contrast)
    const p2 = -(camX * 0.55);
    for (let x = Math.floor((camX * 0.45) / 46) * 46 - 46; x < camX + W + 46; x += 46) {
      drawPineTree(g, x + (p2 % 46) + 23, GROUND_TOP + 12, 1.05);
    }

    // --- BATTLEFIELD: grass ground filling ~65% of the frame
    rect(g, camX, GROUND_TOP, W, this.H - GROUND_TOP, '#274d2c');
    rect(g, camX, GROUND_TOP, W, 2, '#31602f');
    // darker shading just under the treeline (subtle lighting)
    rect(g, camX, GROUND_TOP + 2, W, 20, 'rgba(10,20,12,0.18)');
    // back grass fringe
    for (let x = Math.floor(camX / 8) * 8; x < camX + W; x += 8) {
      const hh = 2 + ((hash(x) * 3) | 0);
      rect(g, x, GROUND_TOP - hh, 1, hh, '#2c5730');
    }

    // low-contrast terrain patches across the whole field (grass/dirt/stone)
    for (let x = Math.floor(camX / 22) * 22 - 22; x < camX + W + 22; x += 22) {
      const r = hash(x * 1.7);
      const yy = GROUND_TOP + 12 + hash(x * 2.3) * (this.H - GROUND_TOP - 20);
      const cx2 = x + hash(x) * 18;
      if (r < 0.30) softPatch(g, cx2, yy, 10 + r * 22, '#224326');
      else if (r < 0.50) softPatch(g, cx2, yy, 8 + r * 12, '#2f5836');
      else if (r < 0.62) { softPatch(g, cx2, yy, 8, '#3a3020'); softPatch(g, cx2, yy, 4, '#463726'); }
    }
    // a few brighter open patches (lighting variation)
    for (let x = Math.floor(camX / 90) * 90 - 90; x < camX + W + 90; x += 90) {
      if (hash(x * 5.1) < 0.4) softPatch(g, x + hash(x) * 40, GROUND_TOP + 40 + hash(x) * 30, 22, 'rgba(90,140,80,0.10)');
    }

    // --- environmental STORYTELLING clusters (Goblin Forest), spaced out
    for (let x = Math.floor(camX / 150) * 150 - 150; x < camX + W + 150; x += 150) {
      const cx2 = x + 40 + hash(x) * 60;
      const cy2 = GROUND_TOP - 6 - hash(x * 1.3) * 6;
      drawForestCluster(g, cx2, cy2, hash(x * 7.7), this.t);
    }
    // simple back-edge greenery (bushes/rocks/mushrooms), off the play lanes
    for (let x = Math.floor(camX / 64) * 64 - 64; x < camX + W + 64; x += 64) {
      const r = hash(x * 0.9 + 3);
      const bx = x + hash(x) * 44, by = GROUND_TOP + 4 + hash(x * 3.1) * 6;
      if (r < 0.3) drawBush(g, bx, by, 0.85);
      else if (r < 0.5) drawMushrooms(g, bx, by);
      else if (r < 0.62) drawFlowers(g, bx, by);
    }

    // gentle depth vignette toward the very front
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(camX, DEPTH_MAX + 10, W, this.H - DEPTH_MAX - 10);

    // --- FOREGROUND: a little scenery at the extreme bottom corners for depth
    drawFgGrass(g, camX + 12, this.H - 2);
    drawFgGrass(g, camX + 40, this.H - 1);
    drawFgGrass(g, camX + W - 20, this.H - 2);
    drawFgGrass(g, camX + W - 46, this.H - 1);
  }

  _drawBossZone(g, camX) {
    const sky = ['#1a0f18', '#241220', '#2e1626', '#3a1a2a'];
    for (let i = 0; i < sky.length; i++) rect(g, camX, i * (DEPTH_MIN / 4), this.W, DEPTH_MIN / 4 + 1, sky[i]);
    for (let x = Math.floor(camX / 60) * 60 - 60; x < camX + this.W + 60; x += 60) {
      g.fillStyle = '#2a1830';
      g.fillRect(x - (camX * 0.3) % 60, 80, 30, DEPTH_MIN - 80);
    }
    drawStoneFloor(g, camX, DEPTH_MIN - 20, this.W, this.H - (DEPTH_MIN - 20), Math.floor(camX / 16));
    for (let x = Math.floor(camX / 120) * 120; x < camX + this.W + 40; x += 120) {
      drawTorch(g, x + 30, DEPTH_MIN - 8, this.t + x);
    }
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(camX, DEPTH_MAX + 10, this.W, this.H - DEPTH_MAX - 10);
  }

  _drawPlayer(g) {
    const p = this.p;
    // dodge afterimages (drawn behind the hero)
    for (const tr of p.trail) {
      g.globalAlpha = 0.3 * (1 - tr.t / 0.22);
      drawCharacter(g, { x: tr.x, y: tr.depth, z: 0, facing: tr.facing, sprite: p.sprite, weapon: p.weapon, state: 'dodge', animTime: 0, scale: ACTOR_SCALE, tint: '#8a7fd0' });
    }
    g.globalAlpha = 1;

    // shield bubble
    if (p.buffs.shield && p.shieldHp > 0) {
      g.globalAlpha = 0.25 + Math.sin(this.t * 8) * 0.05;
      disc(g, p.x, p.depth - 12, 15, '#9d8bff');
      g.globalAlpha = 1;
    }
    // rage aura
    if (p.buffs.rage && Math.floor(this.t * 10) % 2) {
      g.globalAlpha = 0.18; disc(g, p.x, p.depth - 13, 13, '#ff5a3c'); g.globalAlpha = 1;
    }
    drawCharacter(g, {
      x: p.x, y: p.depth, z: p.z, facing: p.facing,
      sprite: p.sprite, weapon: p.weapon, state: p.state,
      animTime: p.animTime, animDuration: p.animDuration, scale: ACTOR_SCALE,
      flash: p.flash, alpha: p.invuln > 0 && Math.floor(this.t * 20) % 2 ? 0.5 : 1,
    });

    // small magical glow at the mage's staff tip (readability, not a big aura)
    if (p.sprite === 'mage') {
      const tx = p.x + p.facing * 12;
      const ty = p.depth - p.z - 26;
      g.globalAlpha = 0.5 + Math.sin(this.t * 5) * 0.15;
      disc(g, tx, ty, 3, '#b8a8ff');
      g.globalAlpha = 0.9;
      disc(g, tx, ty, 1, '#eae2ff');
      g.globalAlpha = 1;
      if (Math.random() < 0.15) this.particles.spawn({ x: tx, y: ty, kind: 'ember', color: '#c2b2ff', vx: 0, vy: -6, life: 0.5, size: 1 });
    }
  }

  _drawEnemy(g, e) {
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
    // gold flash on area-clear
    if (this.clearFlash > 0) {
      g.globalAlpha = this.clearFlash * 0.18; g.fillStyle = '#f2c94f'; g.fillRect(0, 0, this.W, this.H); g.globalAlpha = 1;
    }

    this._drawPlayerPlate(g);
    this._drawAbilityBar(g);
    this._drawTopBanner(g);
    this._drawMessage(g);
    this._drawTutorial(g);
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
    if (this.boss && this.boss.hp > 0) {
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
    let sc = 3;
    while (sc > 1 && textWidth(this.message, sc) > this.W - 28) sc--;
    const my = this.boss ? 92 : 40;
    heading(g, this.W, my, this.message, { scale: sc, color: '#ffe066' });
    if (this.messageSub) drawText(g, this.messageSub, this.W / 2, my + sc * 8 + 4, { color: UI.ink, align: 'center', shadow: '#000' });
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
