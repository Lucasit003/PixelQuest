// Damage arithmetic. Expected values here are worked out by hand and written as
// literals on purpose — if these tests recomputed the formula they'd agree with
// a broken implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  meleeBaseDamage, meleeKnockback, finalHitDamage, abilityBaseDamage,
  enemyDamageAfterDefense, playerDamageAfterDefense, absorbWithShield,
  bossPhaseIndex, CRIT_MULT, CHAIN_FALLOFF,
} from '../src/game/combatMath.js';
import { ABILITIES, BOSS, ENEMIES } from '../src/game/data.js';
import { closeTo } from './helpers/env.js';

// ---------------------------------------------------------------- basic melee

test('a light opener lands 70% of the hero attack stat', () => {
  // 20 attack * 0.7
  assert.equal(meleeBaseDamage(20, { comboStep: 0 }), 14);
});

test('each combo step raises the light swing', () => {
  closeTo(meleeBaseDamage(20, { comboStep: 1 }), 17.6); // 20 * 0.88
  closeTo(meleeBaseDamage(20, { comboStep: 2 }), 21.2); // 20 * 1.06
});

test('a heavy swing is a flat 1.7x and ignores the combo step', () => {
  assert.equal(meleeBaseDamage(20, { heavy: true }), 34);
  assert.equal(meleeBaseDamage(20, { heavy: true, comboStep: 3 }), 34);
});

test('rage multiplies the swing that lands under it', () => {
  // Berserker Rage is 1.6x: 34 * 1.6
  closeTo(meleeBaseDamage(20, { heavy: true, rageMult: 1.6 }), 54.4);
});

test('knockback grows with the combo, heavy always launches hardest', () => {
  assert.equal(meleeKnockback({ comboStep: 0 }), 60);
  assert.equal(meleeKnockback({ comboStep: 2 }), 84);
  assert.equal(meleeKnockback({ heavy: true }), 150);
  assert.equal(meleeKnockback({ heavy: true, comboStep: 3 }), 150);
});

// ----------------------------------------------------------------- crit rolls

test('a crit multiplies the hit and the result is a whole number', () => {
  assert.equal(finalHitDamage(14), 14);
  assert.equal(finalHitDamage(14, { crit: true }), 25); // 25.2 rounded
  assert.equal(CRIT_MULT, 1.8);
});

test('per-hit variance scales the result', () => {
  assert.equal(finalHitDamage(20, { crit: true, variance: 1.1 }), 40); // 39.6
  assert.equal(finalHitDamage(20, { variance: 0.9 }), 18);
});

// ------------------------------------------------------------------ abilities

test('ability damage adds a share of hero power by ability kind', () => {
  const power = 30;
  assert.equal(abilityBaseDamage(ABILITIES.ground_slam, power), 55);     // aoe: 40 + 30*0.5
  assert.equal(abilityBaseDamage(ABILITIES.heavy_strike, 20), 48);       // melee: 34 + 20*0.7
  assert.equal(abilityBaseDamage(ABILITIES.fireball, power), 40);        // projectile: 22 + 30*0.6
  assert.equal(abilityBaseDamage(ABILITIES.lightning, 40), 50);          // chain: 30 + 40*0.5
});

test('an ember dragon boosts only fire abilities', () => {
  // Ember Dragon is +5%. Fireball is the fire-element ability.
  assert.equal(abilityBaseDamage(ABILITIES.fireball, 30, { fireBonus: 0.05 }), 42);
  // Chain Lightning is storm — the same bonus must not touch it.
  assert.equal(abilityBaseDamage(ABILITIES.lightning, 40, { fireBonus: 0.05 }), 50);
});

test('buff abilities carry no direct damage', () => {
  assert.equal(abilityBaseDamage(ABILITIES.berserker_rage, 50), 0);
  assert.equal(abilityBaseDamage(ABILITIES.arcane_shield, 50), 0);
});

test('each link in a chain hits for less than the last', () => {
  assert.equal(CHAIN_FALLOFF, 0.8);
  const first = abilityBaseDamage(ABILITIES.lightning, 40); // 50
  assert.equal(first * CHAIN_FALLOFF, 40);
  assert.equal(first * CHAIN_FALLOFF * CHAIN_FALLOFF, 32);
});

// ------------------------------------------------------------------- defense

test('enemy armour subtracts flat from the hit', () => {
  // Skeleton has 4 defense.
  assert.equal(ENEMIES.skeleton.defense, 4);
  assert.equal(enemyDamageAfterDefense(30, ENEMIES.skeleton.defense), 26);
});

test('a hit always registers for at least 1 damage', () => {
  assert.equal(enemyDamageAfterDefense(2, 6), 1);
  assert.equal(enemyDamageAfterDefense(0, 100), 1);
});

test('missing enemy defense is treated as none', () => {
  assert.equal(enemyDamageAfterDefense(10, undefined), 10);
  assert.equal(ENEMIES.slime.defense, 0);
  assert.equal(enemyDamageAfterDefense(10, ENEMIES.slime.defense), 10);
});

test('hero defense removes half its value from incoming damage', () => {
  assert.equal(playerDamageAfterDefense(20, 14), 13); // 20 - 7
});

test('iron skin halves what defense left behind', () => {
  assert.equal(playerDamageAfterDefense(20, 14, { defenseBuff: true }), 7); // 6.5 rounded
});

test('incoming damage never falls to zero, even fully mitigated', () => {
  assert.equal(playerDamageAfterDefense(1, 100), 1);
  assert.equal(playerDamageAfterDefense(1, 100, { defenseBuff: true }), 1);
});

// -------------------------------------------------------------------- shields

test('a shield absorbs a hit it can cover in full', () => {
  assert.deepEqual(absorbWithShield(60, 25), { absorbed: 25, shieldLeft: 35, remaining: 0 });
});

test('a shield breaks and passes the overflow through', () => {
  assert.deepEqual(absorbWithShield(60, 90), { absorbed: 60, shieldLeft: 0, remaining: 30 });
});

test('arcane shield covers exactly its rated damage', () => {
  const rated = ABILITIES.arcane_shield.shield; // 60
  assert.equal(absorbWithShield(rated, rated).remaining, 0);
  assert.equal(absorbWithShield(rated, rated + 1).remaining, 1);
});

// --------------------------------------------------------------- boss phases

test('the goblin king advances a phase as his health falls', () => {
  const phases = BOSS.goblin_king.phases;
  assert.equal(bossPhaseIndex(phases, 1.0), 0);
  assert.equal(bossPhaseIndex(phases, 0.8), 0);
  assert.equal(bossPhaseIndex(phases, 0.7), 1);  // Call the Horde
  assert.equal(bossPhaseIndex(phases, 0.5), 1);
  assert.equal(bossPhaseIndex(phases, 0.4), 2);  // Enraged
  assert.equal(bossPhaseIndex(phases, 0.18), 3); // Last Stand
  assert.equal(bossPhaseIndex(phases, 0), 3);
});

test('boss phases never skip backwards as health drops', () => {
  const phases = BOSS.goblin_king.phases;
  let last = 0;
  for (let frac = 1; frac >= 0; frac -= 0.01) {
    const idx = bossPhaseIndex(phases, frac);
    assert.ok(idx >= last, `phase went backwards at ${frac.toFixed(2)}`);
    last = idx;
  }
  assert.equal(last, phases.length - 1);
});
