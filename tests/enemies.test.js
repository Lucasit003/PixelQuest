// Enemy archetypes. Behaviors are plain functions over (enemy, context), so they
// can be driven here with a stub context — no arena, no canvas, no frame loop.
// These check the wiring and the decisions; how a fight *feels* is still manual QA.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENEMY_BEHAVIORS, BEHAVIOR_IDS, resolveBehavior, tuningFor,
} from '../src/game/enemyBehaviors.js';
import { ENEMIES, BOSS } from '../src/game/data.js';
import { closeTo } from './helpers/env.js';

const DT = 1 / 60;

// A live enemy built from real game data, the way _spawnEnemy builds one.
function mkEnemy(type, overrides = {}) {
  const def = { ...ENEMIES[type], ...overrides };
  return {
    type, def,
    behavior: resolveBehavior(def, type),
    tuning: tuningFor(def),
    x: 0, depth: 200, z: 0, vz: 0, facing: 1,
    state: 'idle', animTime: 0, attackTimer: 0, knockVx: 0,
  };
}

// The context the combat scene hands a behavior each frame.
function mkCtx({ dist, ddepth = 0, dt = DT } = {}) {
  const calls = { melee: 0, shoot: 0 };
  const ctx = {
    dt, dist, ddepth, dx: dist,
    p: { x: 0, depth: 200, z: 0 },
    clampDepth: (d) => Math.max(150, Math.min(250, d)),
    tryMelee: () => { calls.melee++; },
    shoot: () => { calls.shoot++; },
  };
  return { ctx, calls };
}

// ------------------------------------------------------------ data integrity

test('every enemy declares a behavior the game implements', () => {
  for (const [type, def] of Object.entries(ENEMIES)) {
    assert.ok(def.behavior, `enemy ${type} has no behavior`);
    assert.ok(BEHAVIOR_IDS.includes(def.behavior),
      `enemy ${type} uses unknown behavior "${def.behavior}"`);
  }
});

test('every enemy resolves without throwing', () => {
  for (const [type, def] of Object.entries(ENEMIES)) {
    assert.doesNotThrow(() => resolveBehavior(def, type), `enemy ${type} failed to resolve`);
  }
});

test('every enemy carries the fields its behavior requires', () => {
  for (const [type, def] of Object.entries(ENEMIES)) {
    const behavior = ENEMY_BEHAVIORS[def.behavior];
    for (const field of behavior.requires) {
      assert.notEqual(def[field], undefined,
        `enemy ${type} (${def.behavior}) is missing required field "${field}"`);
    }
  }
});

test('every behavior declares what it requires and what it defaults', () => {
  for (const id of BEHAVIOR_IDS) {
    const b = ENEMY_BEHAVIORS[id];
    assert.ok(Array.isArray(b.requires) && b.requires.length, `behavior ${id} declares no requirements`);
    assert.equal(typeof b.update, 'function', `behavior ${id} has no update`);
    assert.equal(typeof b.defaults, 'object', `behavior ${id} has no defaults`);
  }
});

test('tuning keys never collide with core enemy stats', () => {
  // A default named `speed` would let a tuning override silently shadow the
  // enemy's real stat. Keep the two namespaces disjoint.
  const core = ['name', 'sprite', 'hp', 'attack', 'defense', 'speed', 'reach',
    'gold', 'xp', 'behavior', 'attackCd', 'w', 'projSpeed'];
  for (const id of BEHAVIOR_IDS) {
    for (const key of Object.keys(ENEMY_BEHAVIORS[id].defaults)) {
      assert.ok(!core.includes(key), `behavior ${id} default "${key}" shadows a core stat`);
    }
  }
});

// -------------------------------------------------------------- bad data

test('an unknown behavior fails loudly and names the culprit', () => {
  const def = { ...ENEMIES.goblin, behavior: 'teleporter' };
  assert.throws(
    () => resolveBehavior(def, 'gremlin'),
    (err) => err.message.includes('gremlin')
      && err.message.includes('teleporter')
      && err.message.includes('chase'),
    'the error should name the enemy, the bad id, and the valid options',
  );
});

test('a behavior missing a required field fails loudly', () => {
  const def = { ...ENEMIES.skeleton_archer };
  delete def.projSpeed;
  assert.throws(
    () => resolveBehavior(def, 'archer'),
    (err) => err.message.includes('archer') && err.message.includes('projSpeed'),
  );
});

// ---------------------------------------------------------------- tuning

test('an enemy inherits its archetype defaults', () => {
  const t = tuningFor(ENEMIES.goblin);
  assert.equal(t.depthArc, 14);
  assert.equal(t.depthChase, 0.55);
  assert.equal(t.windup, 0.18);
});

test('an enemy can override a single knob without touching the others', () => {
  const t = tuningFor({ ...ENEMIES.goblin, windup: 0.5 });
  assert.equal(t.windup, 0.5, 'the override did not take');
  assert.equal(t.depthArc, 14, 'an unrelated default was disturbed');
});

test('unrelated data fields never leak into tuning', () => {
  const t = tuningFor({ ...ENEMIES.goblin, hp: 999, sprite: 'dragon', nonsense: 1 });
  assert.equal(t.hp, undefined);
  assert.equal(t.sprite, undefined);
  assert.equal(t.nonsense, undefined);
});

test('the ranged archetype carries its projectile presentation', () => {
  const t = tuningFor(ENEMIES.skeleton_archer);
  assert.equal(t.projLife, 2.5);
  assert.equal(t.projColor, '#d9d2c0');
  assert.equal(t.projRadius, 3);
});

// ------------------------------------------------------------------ chase

test('a chaser walks toward a player out of reach', () => {
  const e = mkEnemy('goblin');          // speed 46, reach 20
  const { ctx, calls } = mkCtx({ dist: 100 });
  e.behavior.update(e, ctx);
  closeTo(e.x, 46 / 60, 'chaser did not advance at its own speed');
  assert.equal(e.state, 'walk');
  assert.equal(calls.melee, 0, 'swung from out of reach');
});

test('a chaser swings once it is in reach', () => {
  const e = mkEnemy('goblin');
  const { ctx, calls } = mkCtx({ dist: 10 }); // inside reach 20
  e.behavior.update(e, ctx);
  assert.equal(calls.melee, 1);
  assert.equal(e.x, 0, 'kept walking while attacking');
});

test('a chaser closes the depth gap before committing', () => {
  const e = mkEnemy('goblin');
  const { ctx, calls } = mkCtx({ dist: 10, ddepth: 30 }); // in x-reach, wrong lane
  e.behavior.update(e, ctx);
  assert.equal(calls.melee, 0, 'attacked across lanes');
  assert.equal(e.state, 'walk');
  assert.ok(e.depth > 200, 'did not move toward the player lane');
});

test('a chaser stays inside the arena depth band', () => {
  const e = mkEnemy('goblin');
  e.depth = 149;
  const { ctx } = mkCtx({ dist: 100, ddepth: -400 });
  e.behavior.update(e, ctx);
  assert.ok(e.depth >= 150, `depth escaped the band: ${e.depth}`);
});

// -------------------------------------------------------------------- hop

test('a slime lunges when close and off cooldown', () => {
  const e = mkEnemy('slime');           // hopRange 60, hopPower 90, hopLunge 80
  e.attackTimer = 0;
  const { ctx } = mkCtx({ dist: 50 });
  e.behavior.update(e, ctx);
  assert.equal(e.vz, 90);
  assert.equal(e.z, 1);
  assert.equal(e.knockVx, 80, 'lunged the wrong way');
  assert.equal(e.state, 'jump');
  assert.equal(e.attackTimer, ENEMIES.slime.attackCd, 'hop did not reset the cooldown');
});

test('a slime on cooldown shuffles instead of hopping', () => {
  const e = mkEnemy('slime');
  e.attackTimer = 1.0;
  const { ctx } = mkCtx({ dist: 50 });
  e.behavior.update(e, ctx);
  assert.equal(e.z, 0, 'hopped while on cooldown');
  assert.equal(e.state, 'walk');
  closeTo(e.x, 30 / 60);
});

test('a slime can still connect while airborne', () => {
  const e = mkEnemy('slime');
  e.z = 8; e.attackTimer = 1.0;
  const { ctx, calls } = mkCtx({ dist: 10 }); // inside reach 16
  e.behavior.update(e, ctx);
  assert.equal(calls.melee, 1, 'a mid-hop slime should still be able to hit');
});

test('a slime out of reach does not swing', () => {
  const e = mkEnemy('slime');
  e.attackTimer = 1.0;
  const { ctx, calls } = mkCtx({ dist: 40 });
  e.behavior.update(e, ctx);
  assert.equal(calls.melee, 0);
});

// ----------------------------------------------------------------- ranged

test('an archer backs away when the player closes in', () => {
  const e = mkEnemy('skeleton_archer'); // speed 34, keepMin 90
  e.attackTimer = 1;
  const { ctx } = mkCtx({ dist: 50 });
  e.behavior.update(e, ctx);
  closeTo(e.x, -(34 / 60), 'archer did not retreat');
  assert.equal(e.state, 'walk');
});

test('an archer closes when the player is too far', () => {
  const e = mkEnemy('skeleton_archer'); // keepMax 150, approachRate 0.6
  e.attackTimer = 1;
  const { ctx } = mkCtx({ dist: 200 });
  e.behavior.update(e, ctx);
  closeTo(e.x, (34 * 0.6) / 60, 'archer did not advance');
});

test('an archer holds its ground inside the keep-away band', () => {
  const e = mkEnemy('skeleton_archer');
  e.attackTimer = 1;
  const { ctx } = mkCtx({ dist: 120 });
  e.behavior.update(e, ctx);
  assert.equal(e.x, 0, 'archer drifted inside its band');
  assert.equal(e.state, 'idle');
});

test('an archer shoots when off cooldown and lined up', () => {
  const e = mkEnemy('skeleton_archer');
  e.attackTimer = 0;
  const { ctx, calls } = mkCtx({ dist: 120 });
  e.behavior.update(e, ctx);
  assert.equal(calls.shoot, 1);
  assert.equal(e.attackTimer, ENEMIES.skeleton_archer.attackCd);
  assert.equal(e.state, 'attack');
});

test('an archer holds fire when the player is out of its firing arc', () => {
  const e = mkEnemy('skeleton_archer'); // fireArc 30
  e.attackTimer = 0;
  const { ctx, calls } = mkCtx({ dist: 120, ddepth: 45 });
  e.behavior.update(e, ctx);
  assert.equal(calls.shoot, 0, 'fired across too many lanes');
});

test('an archer never swings in melee', () => {
  const e = mkEnemy('skeleton_archer');
  e.attackTimer = 1;
  const { ctx, calls } = mkCtx({ dist: 5 });
  e.behavior.update(e, ctx);
  assert.equal(calls.melee, 0);
});

// -------------------------------------------------- adding a new enemy

test('a new enemy needs data only — no combat code', () => {
  // The whole point of the archetype system: this entry never appears in
  // combat.js, yet it resolves, tunes and acts.
  const def = {
    name: 'Test Sniper', sprite: 'skeleton', hp: 20, attack: 7, defense: 1,
    speed: 40, gold: [1, 2], xp: 1, w: 12,
    behavior: 'ranged', attackCd: 1.0, projSpeed: 220,
    keepMin: 170, keepMax: 240, projColor: '#66ffcc',
  };
  const behavior = resolveBehavior(def, 'test_sniper');
  const tuning = tuningFor(def);
  assert.equal(tuning.keepMin, 170);
  assert.equal(tuning.projColor, '#66ffcc');

  // It keeps its own, larger distance rather than the stock archer's.
  const e = { def, behavior, tuning, x: 0, depth: 200, z: 0, vz: 0, facing: 1,
    state: 'idle', animTime: 0, attackTimer: 1, knockVx: 0 };
  const { ctx } = mkCtx({ dist: 160 }); // inside 170 -> should retreat
  behavior.update(e, ctx);
  assert.ok(e.x < 0, 'the custom keep-away distance was ignored');
});

// ----------------------------------------------------------- boss boundary

test('bosses are scripted, not archetypes', () => {
  // Documented boundary: the Goblin King runs _updateBoss in combat.js. It must
  // not be expected to carry a behavior id.
  for (const [id, b] of Object.entries(BOSS)) {
    assert.equal(b.behavior, undefined,
      `boss ${id} declares a behavior — bosses use their own scripted controller`);
    assert.ok(Array.isArray(b.phases) && b.phases.length > 1,
      `boss ${id} has no phases, which is what justifies scripting it`);
  }
});
