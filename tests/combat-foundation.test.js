// The shared combat foundation: ability scaling, authored combo curves and
// real chain targeting. These cover behaviour that was previously broken in
// ways the data could not see — a stun field nothing read, a speed multiplier
// that only worked next to an attack multiplier, a "chain" that was really
// "the nearest N enemies".
//
// Expected values are worked out by hand and written as literals. A test that
// recomputes the formula agrees with a broken implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  meleeBaseDamage, abilityPower, chainTargets,
  COMBO_OPENER, CHAIN_HOP_RANGE,
} from '../src/game/combatMath.js';
import { ABILITIES, CLASSES } from '../src/game/data.js';
import { closeTo } from './helpers/env.js';

// ------------------------------------------------------- ability scaling

test('a martial ability draws on attack, not magic', () => {
  const berserker = { attack: 27, magic: 4 };
  assert.equal(abilityPower(berserker, { scaling: 'attack' }), 27);
});

test('a spell draws on magic, not attack', () => {
  const mage = { attack: 12, magic: 24 };
  assert.equal(abilityPower(mage, { scaling: 'magic' }), 24);
});

test('a hybrid ability blends the stats it names', () => {
  const paladin = { attack: 20, magic: 14 };
  // 20*0.5 + 14*0.5
  assert.equal(abilityPower(paladin, { scaling: { attack: 0.5, magic: 0.5 } }), 17);
});

test('hybrid weights need not sum to one', () => {
  const stats = { attack: 10, magic: 10 };
  assert.equal(abilityPower(stats, { scaling: { attack: 1, magic: 1 } }), 20);
  assert.equal(abilityPower(stats, { scaling: { attack: 0.25 } }), 2.5);
});

test('an unstated scaling falls back to magic rather than to zero', () => {
  assert.equal(abilityPower({ attack: 9, magic: 5 }, {}), 5);
});

test('a stat the hero does not have counts as none, and does not throw', () => {
  assert.equal(abilityPower({ attack: 10 }, { scaling: 'spirit' }), 0);
  assert.equal(abilityPower({}, { scaling: { attack: 1, magic: 1 } }), 0);
});

test('every ability states the stat it scales from', () => {
  for (const [id, ab] of Object.entries(ABILITIES)) {
    assert.ok(ab.scaling, `ability ${id} has no scaling`);
    if (typeof ab.scaling === 'string') {
      assert.ok(['attack', 'magic'].includes(ab.scaling), `${id} scales from unknown "${ab.scaling}"`);
    } else {
      const keys = Object.keys(ab.scaling);
      assert.ok(keys.length, `${id} has an empty scaling map`);
      for (const k of keys) {
        assert.ok(['attack', 'magic'].includes(k), `${id} blends unknown stat "${k}"`);
        assert.ok(ab.scaling[k] > 0, `${id} weights ${k} at ${ab.scaling[k]}`);
      }
    }
  }
});

test('martial classes never scale their abilities off magic', () => {
  // The bug this replaces: a Berserker (magic 4, attack 27) powered every
  // ability off the 4.
  for (const cls of ['warrior', 'berserker', 'rogue', 'ranger']) {
    for (const [id, ab] of Object.entries(ABILITIES)) {
      if (ab.cls !== cls) continue;
      assert.equal(ab.scaling, 'attack', `${id} (${cls}) should scale from attack`);
    }
  }
});

test('caster classes scale their abilities off magic', () => {
  for (const cls of ['mage', 'summoner']) {
    for (const [id, ab] of Object.entries(ABILITIES)) {
      if (ab.cls !== cls) continue;
      assert.equal(ab.scaling, 'magic', `${id} (${cls}) should scale from magic`);
    }
  }
});

test('the paladin is a real hybrid, exercising the weighted form in content', () => {
  const kit = Object.entries(ABILITIES).filter(([, a]) => a.cls === 'paladin');
  assert.ok(kit.length > 0);
  for (const [id, ab] of kit) {
    assert.equal(typeof ab.scaling, 'object', `${id} should blend attack and magic`);
  }
});

// --------------------------------------------------- authored combo curve

test('the opener is unchanged by the authored curve', () => {
  // Whatever a class's curve, step 1 is still COMBO_OPENER of the attack stat,
  // so early-game feel did not move.
  const warrior = CLASSES.warrior.combo;      // [16, 20, 30]
  closeTo(meleeBaseDamage(20, { comboStep: 1, combo: warrior }), 20 * COMBO_OPENER);
});

test('later combo steps follow the class curve, not a flat ramp', () => {
  const warrior = CLASSES.warrior.combo;      // [16, 20, 30]
  // step 2 is 20/16 of the opener, step 3 is 30/16
  closeTo(meleeBaseDamage(20, { comboStep: 2, combo: warrior }), 20 * COMBO_OPENER * (20 / 16));
  closeTo(meleeBaseDamage(20, { comboStep: 3, combo: warrior }), 20 * COMBO_OPENER * (30 / 16));
});

test('two classes with different curves ramp differently from the same attack', () => {
  const bers = meleeBaseDamage(20, { comboStep: 3, combo: CLASSES.berserker.combo }); // [18,22,32]
  const summ = meleeBaseDamage(20, { comboStep: 3, combo: CLASSES.summoner.combo });  // [10,12,18]
  // 32/18 = 1.778 against 18/10 = 1.8 — close, but the finishers are not equal
  assert.notEqual(bers, summ);
  closeTo(bers, 20 * COMBO_OPENER * (32 / 18));
  closeTo(summ, 20 * COMBO_OPENER * (18 / 10));
});

test('the rogue keeps a four-step combo and its fourth step is the biggest', () => {
  const rogue = CLASSES.rogue.combo;
  assert.equal(rogue.length, 4, 'the rogue four-hit combo is a class identity');
  const steps = [1, 2, 3, 4].map((s) => meleeBaseDamage(20, { comboStep: s, combo: rogue }));
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i] > steps[i - 1], `rogue step ${i + 1} should exceed step ${i}`);
  }
  closeTo(steps[3], 20 * COMBO_OPENER * (22 / 12));
});

test('every class curve rises from first step to last', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    const c = cls.combo;
    assert.ok(Array.isArray(c) && c.length >= 3, `${id} has no usable combo curve`);
    for (let i = 1; i < c.length; i++) {
      assert.ok(c[i] > c[i - 1], `${id} combo dips at step ${i + 1}`);
    }
  }
});

test('a combo step past the end of the curve holds on the finisher', () => {
  const warrior = CLASSES.warrior.combo;
  const last = meleeBaseDamage(20, { comboStep: 3, combo: warrior });
  assert.equal(meleeBaseDamage(20, { comboStep: 9, combo: warrior }), last);
});

test('a heavy ignores the curve entirely', () => {
  const withCurve = meleeBaseDamage(20, { heavy: true, comboStep: 3, combo: CLASSES.warrior.combo });
  assert.equal(withCurve, 20 * 1.7);
});

test('omitting the curve keeps the original flat ramp', () => {
  // Callers that do not know the class must behave exactly as before.
  assert.equal(meleeBaseDamage(20, { comboStep: 0 }), 14);
  closeTo(meleeBaseDamage(20, { comboStep: 2 }), 20 * (0.7 + 2 * 0.18));
});

// ------------------------------------------------------- chain targeting

const at = (x, depth, hp = 10) => ({ x, depth, hp });

test('a chain hops from each target to the next, not from the caster', () => {
  const origin = { x: 0, depth: 0 };
  // a line marching away: each is far from the caster but near its neighbour
  const a = at(50, 0), b = at(120, 0), c = at(190, 0);
  const picked = chainTargets(origin, [c, b, a], { chains: 3, range: 60, hopRange: 80 });
  assert.deepEqual(picked, [a, b, c], 'should walk the line outward');
});

test('the first link must be inside the ability range', () => {
  const origin = { x: 0, depth: 0 };
  const far = at(300, 0);
  assert.deepEqual(chainTargets(origin, [far], { chains: 3, range: 100 }), []);
});

test('a hop beyond the hop range ends the chain instead of crossing the arena', () => {
  const origin = { x: 0, depth: 0 };
  const near = at(40, 0);
  const across = at(600, 0);
  const picked = chainTargets(origin, [near, across], { chains: 3, range: 100, hopRange: 90 });
  assert.deepEqual(picked, [near], 'the second enemy is 560 away and must not be reached');
});

test('a chain never strikes the same target twice', () => {
  const origin = { x: 0, depth: 0 };
  const only = at(30, 0);
  assert.deepEqual(chainTargets(origin, [only], { chains: 4, range: 100 }), [only]);
});

test('a chain stops at its target count even with more in reach', () => {
  const origin = { x: 0, depth: 0 };
  const list = [at(20, 0), at(50, 0), at(80, 0), at(110, 0), at(140, 0)];
  assert.equal(chainTargets(origin, list, { chains: 2, range: 100, hopRange: 90 }).length, 2);
});

test('dead enemies are not valid chain targets', () => {
  const origin = { x: 0, depth: 0 };
  const dead = at(20, 0, 0);
  const alive = at(60, 0);
  assert.deepEqual(chainTargets(origin, [dead, alive], { chains: 3, range: 100 }), [alive]);
});

test('chain distance accounts for depth, not just x', () => {
  const origin = { x: 0, depth: 0 };
  const sameLane = at(60, 0);
  const farLane = at(10, 200);
  const picked = chainTargets(origin, [farLane, sameLane], { chains: 1, range: 100 });
  assert.deepEqual(picked, [sameLane]);
});

test('the default hop range is finite, so an unstated chain cannot cross the map', () => {
  assert.ok(Number.isFinite(CHAIN_HOP_RANGE) && CHAIN_HOP_RANGE > 0);
  const origin = { x: 0, depth: 0 };
  const picked = chainTargets(origin, [at(10, 0), at(10 + CHAIN_HOP_RANGE + 50, 0)],
    { chains: 3, range: 100 });
  assert.equal(picked.length, 1);
});

// ------------------------------------------ data expectations after the fixes

test('no ability relies on the implicit chain stun that was removed', () => {
  // Chains used to stun every target 0.4s regardless. Anything that wants a
  // stun now has to say so, so nothing should be silently depending on it.
  for (const [id, ab] of Object.entries(ABILITIES)) {
    if (ab.kind !== 'chain') continue;
    if (ab.stun !== undefined) {
      assert.ok(ab.stun > 0, `${id} declares a non-positive stun`);
    }
  }
});

test('every chain ability states a range for its first link', () => {
  for (const [id, ab] of Object.entries(ABILITIES)) {
    if (ab.kind !== 'chain') continue;
    assert.ok(ab.range > 0, `chain ${id} has no range, so its first link is unbounded`);
  }
});

test('the abilities whose stun was dead now declare one the engine can apply', () => {
  // Earthshatter, Static Field and Wrath of Dawn are all aoe + stun. The data
  // always said so; only the engine ignored it.
  for (const id of ['earthshatter', 'static_field', 'wrath_of_dawn']) {
    const ab = ABILITIES[id];
    assert.ok(ab, `${id} should still exist`);
    assert.equal(ab.kind, 'aoe');
    assert.ok(ab.stun > 0, `${id} should carry a stun`);
  }
});

test('sanctuary still carries the slow that its description promises', () => {
  const s = ABILITIES.sanctuary;
  assert.ok(s.speedMult < 1, 'sanctuary should slow the wearer');
  assert.equal(s.atkMult, undefined,
    'sanctuary has no attack multiplier — which is exactly why its slow used to be ignored');
});
