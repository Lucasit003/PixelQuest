// The seven class signature mechanics. The arithmetic lives in
// game/classMechanics.js and is tested directly here; the data assertions check
// that the abilities which are supposed to drive each mechanic actually carry
// the fields the scene reads.
//
// Expected values are written as literals rather than recomputed, so a broken
// formula cannot agree with its own test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOMENTUM_MAX, MOMENTUM_PER_STACK, MOMENTUM_FINISHER_PER_STACK,
  momentumGain, addMomentum, momentumMultiplier,
  FLOW_MAX, addFlow, flowMultiplier,
  EXPOSED_DUR, EXPOSED_CRIT_BONUS, critChanceAgainst, exposureMultiplier, poisonTick,
  MARK_BONUS, markMultiplier,
  GUARD_MAX, GUARD_CONVERSION, bankGuard, spendGuard,
  RAGE_FLOOR, rageMultiplier, selfDamageAllowed, executeMultiplier,
  EXECUTE_THRESHOLD, TOTEM_LIMIT, makeTotem, totemTick, totemPlacement,
} from '../src/game/classMechanics.js';
import { ABILITIES, CLASSES } from '../src/game/data.js';
import { closeTo } from './helpers/env.js';

// ==================================================== WARRIOR: Momentum

test('landing hits builds Momentum, a heavy commit counting double', () => {
  assert.equal(momentumGain({}), 1);
  assert.equal(momentumGain({ heavy: true }), 2);
});

test('Momentum caps rather than growing forever', () => {
  let m = 0;
  for (let i = 0; i < 20; i++) m = addMomentum(m, 1);
  assert.equal(m, MOMENTUM_MAX);
});

test('a spender is worth more the more Momentum it eats', () => {
  assert.equal(momentumMultiplier(0), 1);
  closeTo(momentumMultiplier(3), 1 + 3 * MOMENTUM_PER_STACK);
  closeTo(momentumMultiplier(5), 1 + 5 * MOMENTUM_PER_STACK);
});

test('the finisher values each stack higher than the normal spender', () => {
  const normal = momentumMultiplier(5, MOMENTUM_PER_STACK);
  const finisher = momentumMultiplier(5, MOMENTUM_FINISHER_PER_STACK);
  assert.ok(finisher > normal, 'Earthshatter should out-pay Sundering Blow at equal stacks');
  closeTo(finisher, 1 + 5 * MOMENTUM_FINISHER_PER_STACK);
});

test('Momentum is not simply a damage buff — it has to be spent', () => {
  // Nothing reads Momentum passively; only abilities that declare a spend.
  const spenders = Object.values(ABILITIES).filter((a) => a.spendsMomentum);
  assert.ok(spenders.length >= 2, 'the Warrior needs both a spender and a finisher');
});

test('the Warrior kit wires Momentum end to end', () => {
  assert.equal(ABILITIES.heavy_strike.momentum, 2, 'Heavy Strike should build');
  assert.equal(ABILITIES.sundering_blow.spendsMomentum, true, 'Sundering Blow should spend');
  assert.equal(ABILITIES.earthshatter.spendsMomentum, 'finisher', 'Earthshatter is the finisher');
  assert.equal(ABILITIES.iron_bulwark.holdsMomentum, true, 'Iron Bulwark should hold it');
});

// ======================================================== MAGE: Arcane Flow

test('Ember Dart builds Flow and Flow caps', () => {
  assert.equal(ABILITIES.ember_dart.buildsFlow, 1);
  let f = 0;
  for (let i = 0; i < 10; i++) f = addFlow(f, 1);
  assert.equal(f, FLOW_MAX);
});

test('Flow makes the next big spell hit harder', () => {
  assert.equal(flowMultiplier(0), 1);
  closeTo(flowMultiplier(1), 1.3);
  closeTo(flowMultiplier(3), 1.9);
});

test('only the intended spenders consume Flow', () => {
  assert.equal(ABILITIES.fireball.spendsFlow, true);
  assert.equal(ABILITIES.arcane_barrage.spendsFlow, true);
  // Not every spell requires Flow — Ice and Storm stay independent.
  for (const id of ['frost_nova', 'ice_lance', 'lightning', 'static_field']) {
    assert.equal(ABILITIES[id].spendsFlow, undefined, `${id} should not depend on Flow`);
  }
});

test('the Ice interaction is untouched by the Flow rework', () => {
  assert.equal(ABILITIES.frost_nova.freeze, 2.2);
  assert.equal(ABILITIES.ice_lance.freeze, 1.4);
});

// ========================================================== ROGUE: Exposure

test('Exposure raises the crit chance the Rogue already has', () => {
  const base = CLASSES.rogue.critBase;              // 0.16
  assert.equal(critChanceAgainst(base, { exposed: false }), base);
  closeTo(critChanceAgainst(base, { exposed: true }), base + EXPOSED_CRIT_BONUS);
});

test('crit chance from Exposure can never exceed certainty', () => {
  assert.equal(critChanceAgainst(0.9, { exposed: true }), 1);
});

test('Assassinate pays off against an exposed target only', () => {
  assert.equal(exposureMultiplier(false), 1);
  assert.equal(exposureMultiplier(true), 1.8);
});

test('Backstab opens and Assassinate closes', () => {
  assert.equal(ABILITIES.backstab.appliesExposed, true);
  assert.equal(ABILITIES.assassinate.consumesExposed, true);
  assert.ok(EXPOSED_DUR >= 3, 'the opening must last long enough to act on');
});

test('poison does real damage over time, not just a colour', () => {
  const p = { dps: 7, t: 4 };
  const first = poisonTick(p, 1);
  closeTo(first.damage, 7);
  assert.equal(first.left.t, 3);
});

test('poison expires and stops dealing damage', () => {
  let state = { dps: 7, t: 0.5 };
  const tick = poisonTick(state, 1);
  closeTo(tick.damage, 3.5, 'only the remaining half second should land');
  assert.equal(tick.left, null, 'poison should be finished');
  assert.equal(poisonTick(null, 1).damage, 0);
});

test('Poison Dagger carries a real dot payload', () => {
  const pd = ABILITIES.poison_dagger.poison;
  assert.ok(pd && pd.dps > 0 && pd.dur > 0, 'poison dagger should apply a dot');
});

test('the two overlapping self-buffs became different tools', () => {
  // Shadow Rush stays the offensive buff; Vanish became the Exposure enabler.
  assert.ok(ABILITIES.shadow_rush.atkMult > 1, 'Shadow Rush remains the damage buff');
  assert.equal(ABILITIES.vanish.atkMult, undefined, 'Vanish should no longer duplicate it');
  assert.equal(ABILITIES.vanish.primesExposed, true);
});

test('Smoke Bomb is an escape rather than another damage burst', () => {
  const sb = ABILITIES.smoke_bomb;
  assert.ok(sb.invuln > 0, 'an escape has to actually make you untouchable');
  assert.ok(sb.speedMult > 1, 'and let you leave');
  assert.ok(sb.dmg <= 10, 'its damage should be incidental');
});

test('the Rogue keeps its four-hit combo', () => {
  assert.equal(CLASSES.rogue.combo.length, 4);
});

// ============================================================ RANGER: Mark

test('a mark only pays off for precision abilities', () => {
  assert.equal(markMultiplier(true, { precision: true }), 1 + MARK_BONUS);
  assert.equal(markMultiplier(true, { precision: false }), 1, 'non-precision ignores the mark');
  assert.equal(markMultiplier(false, { precision: true }), 1, 'no mark, no payoff');
});

test("Hunter's Mark is a target debuff, not a self buff", () => {
  const hm = ABILITIES.hunters_mark;
  assert.equal(hm.kind, 'mark');
  assert.equal(hm.atkMult, undefined, 'it should no longer buff the Ranger');
  assert.ok(hm.range > 0 && hm.dur > 0);
});

test('the precision abilities are the ones that cash a mark in', () => {
  assert.equal(ABILITIES.precision_shot.precision, true);
  assert.equal(ABILITIES.volley.precision, true);
  assert.equal(ABILITIES.thornvine.precision, undefined, 'nature chain is not precision');
});

test('the Ranger basic attack is ranged', () => {
  assert.equal(CLASSES.ranger.ranged, true);
  assert.ok(CLASSES.ranger.shotRange > 100, 'a bow needs real reach');
  // and no other class became ranged by accident
  for (const [id, c] of Object.entries(CLASSES)) {
    if (id !== 'ranger') assert.ok(!c.ranged, `${id} should still be melee`);
  }
});

test('the ranged basic keeps the class combo curve', () => {
  // The bow is a different delivery of the same attack, so the authored combo
  // still shapes it.
  assert.equal(CLASSES.ranger.combo.length, 3);
});

test('the two traps became different tools', () => {
  const bear = ABILITIES.bear_trap, snare = ABILITIES.snare_trap;
  assert.equal(bear.origin, 'ahead', 'Bear Trap is placed in front of you');
  assert.ok(bear.offset > 0, 'and away from your feet');
  assert.equal(snare.origin, undefined, 'Snare Trap stays the self-centred root');
  assert.ok(snare.range > bear.range, 'the panic option should cover more ground');
});

// ==================================================== PALADIN: Divine Guard

test('the Guard banks what it absorbs, up to a cap', () => {
  assert.equal(bankGuard(0, 30), 30);
  assert.equal(bankGuard(100, 50), GUARD_MAX);
  assert.equal(bankGuard(10, -5), 10, 'negative absorption cannot drain the bank');
});

test('a holy payoff converts the bank into damage and empties it', () => {
  const full = spendGuard(100, { share: 1 });
  closeTo(full.bonus, 100 * GUARD_CONVERSION);
  assert.equal(full.left, 0);
});

test('a partial spender leaves the rest banked', () => {
  const part = spendGuard(100, { share: 0.6 });
  closeTo(part.bonus, 60 * GUARD_CONVERSION);
  closeTo(part.left, 40);
});

test('an empty bank simply pays nothing', () => {
  assert.equal(spendGuard(0).bonus, 0);
});

test('the Paladin has one shield, one heal and one aura — not three shields', () => {
  const kit = Object.entries(ABILITIES).filter(([, a]) => a.cls === 'paladin');
  const shields = kit.filter(([, a]) => a.shield);
  assert.equal(shields.length, 1, 'exactly one shield should remain');
  assert.equal(ABILITIES.divine_shield.banksGuard, true, 'and it is the Guard');
  assert.equal(ABILITIES.lay_on_hands.kind, 'heal');
  assert.ok(ABILITIES.lay_on_hands.heal > 0, 'the classic heal should actually heal');
  assert.equal(ABILITIES.sanctuary.kind, 'aura');
  assert.ok(ABILITIES.sanctuary.aura.damageTaken < 1, 'the aura should reduce damage');
});

test('Holy Strike and Wrath of Dawn are the Guard payoffs', () => {
  assert.ok(ABILITIES.holy_strike.spendsGuard > 0);
  assert.equal(ABILITIES.wrath_of_dawn.spendsGuard, 1, 'the capstone empties the bank');
  assert.ok(ABILITIES.wrath_of_dawn.spendsGuard > ABILITIES.holy_strike.spendsGuard);
});

test('Judgement reads as holy, not as a Mage storm spell', () => {
  assert.equal(ABILITIES.judgement.element, 'holy');
});

// ========================================================== BERSERKER: Rage

test('Rage is worth nothing at full health', () => {
  assert.equal(rageMultiplier(1), 1);
});

test('Rage grows as health falls', () => {
  const half = rageMultiplier(0.5);
  const low = rageMultiplier(0.25);
  assert.ok(half > 1, 'a wounded Berserker hits harder');
  assert.ok(low > half, 'and harder still closer to death');
});

test('Rage stops growing at the floor, so 1 HP is no better than the floor', () => {
  const atFloor = rageMultiplier(RAGE_FLOOR);
  assert.equal(rageMultiplier(0.01), atFloor, 'no reward for sitting at 1 HP');
  assert.equal(rageMultiplier(0), atFloor);
});

test('Rage is capped rather than unbounded', () => {
  assert.ok(rageMultiplier(0) <= 1.85, 'the ceiling keeps it risk, not stat inflation');
});

test('self-damage can never take the Berserker below the floor', () => {
  // 12% of 200 is 24, which is allowed from full health
  assert.equal(selfDamageAllowed(200, 200, 24), 24);
  // but from 50/200 the floor is 40, so only 10 may be taken
  assert.equal(selfDamageAllowed(50, 200, 24), 10);
  // and at the floor exactly, nothing more may be taken
  assert.equal(selfDamageAllowed(40, 200, 24), 0);
});

test('Execute pays off only against a nearly-dead target', () => {
  assert.equal(executeMultiplier(1), 1, 'a healthy target gets no bonus');
  assert.equal(executeMultiplier(0.5), 1);
  assert.equal(executeMultiplier(EXECUTE_THRESHOLD), 2);
  assert.equal(executeMultiplier(0.05), 2);
});

test('the Berserker kit wires Rage end to end', () => {
  assert.equal(ABILITIES.blood_frenzy.rageScaled, true);
  assert.equal(ABILITIES.blood_frenzy.atkMult, undefined, 'no flat buff any more');
  assert.equal(ABILITIES.execute.executes, true);
  assert.ok(ABILITIES.bloodletting.selfDamage > 0, 'the twin buff became a real cost');
  assert.ok(ABILITIES.undying_wrath.shield > 0, 'the capstone stays dramatic');
});

test('Whirling Axes and Rampage became different shapes', () => {
  assert.equal(ABILITIES.whirling_axes.origin, undefined, 'a spin in place');
  assert.equal(ABILITIES.rampage.origin, 'ahead', 'a charge forward');
});

// =================================================== SUMMONER: Totem control

test('a totem is placed in front of the caster, not on their feet', () => {
  const right = totemPlacement(100, 200, 1, 46);
  assert.equal(right.x, 146);
  const left = totemPlacement(100, 200, -1, 46);
  assert.equal(left.x, 54);
  assert.equal(right.depth, 200, 'placement stays in the caster lane');
});

test('a totem persists, ticking down its life', () => {
  const t = makeTotem('wolf', 0, 0, { life: 10, pulse: 2, radius: 50 });
  const step = totemTick(t, 1);
  assert.equal(step.life, 9);
  assert.equal(step.expired, false);
});

test('a totem expires when its life runs out', () => {
  const t = makeTotem('wolf', 0, 0, { life: 1, pulse: 2, radius: 50 });
  const step = totemTick(t, 1.5);
  assert.ok(step.life <= 0);
  assert.equal(step.expired, true);
});

test('a pulsing totem fires on its own timer, not every frame', () => {
  let t = makeTotem('wolf', 0, 0, { life: 10, pulse: 1, radius: 50 });
  const s1 = totemTick(t, 0.5);
  assert.equal(s1.fired, false, 'half a second in, it should not have pulsed');
  t = { ...t, life: s1.life, pulseT: s1.pulseT };
  const s2 = totemTick(t, 0.6);
  assert.equal(s2.fired, true, 'past its interval it should fire');
});

test('an expired totem does not get a final free pulse', () => {
  const t = makeTotem('wolf', 0, 0, { life: 0.2, pulse: 0.1, radius: 50 });
  const step = totemTick(t, 1);
  assert.equal(step.expired, true);
  assert.equal(step.fired, false, 'a dead totem should not still be attacking');
});

test('a defensive totem does not pulse damage', () => {
  const t = makeTotem('stone', 0, 0, { life: 12, pulse: 0, radius: 60 });
  const step = totemTick(t, 5);
  assert.equal(step.fired, false);
  assert.equal(step.expired, false);
});

test('the totem cap is small enough to stay a choice', () => {
  assert.ok(TOTEM_LIMIT >= 1 && TOTEM_LIMIT <= 3, 'a field of totems is not control');
});

test('both totems are real placed entities, not disguised buffs', () => {
  const wolf = ABILITIES.wolf_totem, stone = ABILITIES.stone_totem;
  assert.equal(wolf.kind, 'totem');
  assert.equal(stone.kind, 'totem');
  assert.ok(wolf.totem.pulse > 0, 'the wolf totem attacks on a timer');
  assert.ok(stone.totem.damageTaken < 1, 'the stone totem protects the ground it holds');
  assert.equal(stone.shield, undefined, 'and is no longer a generic self-shield');
});

test('Spirit Wisp behaves differently from a plain projectile', () => {
  assert.equal(ABILITIES.spirit_wisp.homing, true);
  assert.equal(ABILITIES.spirit_bolt.homing, undefined, 'the plain bolt stays plain');
});

test('Ancestral Chorus answers from the totems, differentiating it from Chain Spirits', () => {
  assert.equal(ABILITIES.ancestral_chorus.fromTotems, true);
  assert.equal(ABILITIES.chain_spirits.fromTotems, undefined);
  assert.ok(ABILITIES.ancestral_chorus.chains > ABILITIES.chain_spirits.chains);
});

// ============================================ roster-wide shape after phase 3

test('every class still has exactly eight abilities', () => {
  for (const id of Object.keys(CLASSES)) {
    const kit = Object.values(ABILITIES).filter((a) => a.cls === id);
    assert.equal(kit.length, 8, `${id} should still have eight abilities`);
  }
});

test('each signature resource belongs to exactly one class', () => {
  const owner = (field) => {
    const classes = new Set(Object.values(ABILITIES).filter((a) => a[field]).map((a) => a.cls));
    return [...classes];
  };
  assert.deepEqual(owner('spendsMomentum'), ['warrior']);
  assert.deepEqual(owner('spendsFlow'), ['mage']);
  assert.deepEqual(owner('appliesExposed'), ['rogue']);
  assert.deepEqual(owner('spendsGuard'), ['paladin']);
  assert.deepEqual(owner('rageScaled'), ['berserker']);
  assert.deepEqual(owner('totem'), ['summoner']);
});
