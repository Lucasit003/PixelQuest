// Content validation for game/data.js. These are cheap, and they get more
// valuable with every class, weapon and ability added — a typo'd id or a
// dangling cross-reference is caught here instead of in the arena.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RARITY, LEVELS, CATEGORIES, ABILITIES, CLASSES, WEAPONS, POTIONS,
  ENEMIES, BOSS, PETS, STARTER_ABILITY, STARTER_WEAPON,
  abilitiesForClass, weaponsFor,
} from '../src/game/data.js';
import { ICONS } from '../src/gfx/props.js';
import { SPECS, PALETTES } from '../src/gfx/actors.js';
import { hasActorSheet } from '../src/gfx/actorSheets.js';

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const LEVEL_IDS = new Set(LEVELS.map((l) => l.id));
const ICON_NAMES = new Set(Object.keys(ICONS));
const STAT_KEYS = ['hp', 'mana', 'attack', 'defense', 'magic', 'speed'];

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ------------------------------------------------------------------ taxonomy

test('rarities are ordered and scale upward', () => {
  const entries = Object.entries(RARITY);
  const orders = entries.map(([, r]) => r.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'rarity order is not ascending');
  assert.equal(new Set(orders).size, orders.length, 'two rarities share an order');
  let prev = 0;
  for (const [id, r] of entries) {
    assert.ok(r.name && r.color, `rarity ${id} is missing name or color`);
    assert.ok(r.mult >= prev, `rarity ${id} does not scale up`);
    prev = r.mult;
  }
});

test('academic levels and categories are well formed and unique', () => {
  assert.equal(LEVEL_IDS.size, LEVELS.length);
  assert.equal(CATEGORY_IDS.size, CATEGORIES.length);
  for (const l of LEVELS) {
    assert.ok(l.id && l.name && l.short && l.tier && l.color, `level ${l.id} is incomplete`);
  }
  for (const c of CATEGORIES) {
    assert.ok(c.id && c.name && c.color, `category ${c.id} is incomplete`);
    assert.ok(ICON_NAMES.has(c.icon), `category ${c.id} uses unknown icon "${c.icon}"`);
  }
});

// ------------------------------------------------------------------- classes

test('every class is complete and self-consistent', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    assert.equal(cls.id, id, `class ${id} disagrees with its own id`);
    assert.ok(cls.name && cls.blurb && cls.color, `class ${id} is missing presentation fields`);
    assert.ok(cls.resource && cls.resourceColor, `class ${id} is missing its resource`);

    for (const stat of STAT_KEYS) {
      assert.ok(isFiniteNumber(cls.base[stat]) && cls.base[stat] > 0,
        `class ${id} has a bad base ${stat}`);
      assert.ok(isFiniteNumber(cls.growth[stat]) && cls.growth[stat] > 0,
        `class ${id} has a bad ${stat} growth`);
    }

    assert.ok(Array.isArray(cls.combo) && cls.combo.length >= 3,
      `class ${id} needs a combo chain`);
    assert.ok(cls.combo.every((n) => isFiniteNumber(n) && n > 0),
      `class ${id} has a bad combo step`);
    assert.ok(isFiniteNumber(cls.reach) && cls.reach > 0, `class ${id} has a bad reach`);
    assert.ok(cls.critBase >= 0 && cls.critBase <= 1, `class ${id} has a bad crit rate`);
    assert.ok(Array.isArray(cls.trees) && cls.trees.length > 0, `class ${id} has no skill trees`);
    assert.equal(new Set(cls.trees).size, cls.trees.length, `class ${id} repeats a skill tree`);
  }
});

test('every class sprite has a renderer and a palette', () => {
  for (const [id, cls] of Object.entries(CLASSES)) {
    assert.ok(SPECS[cls.sprite], `class ${id} uses unknown sprite "${cls.sprite}"`);
    assert.ok(PALETTES[SPECS[cls.sprite].pal],
      `class ${id} sprite has no palette "${SPECS[cls.sprite].pal}"`);
  }
});

// ------------------------------------------------------------------ starters

test('every class starts with an ability and a weapon that exist', () => {
  for (const id of Object.keys(CLASSES)) {
    const ability = STARTER_ABILITY[id];
    const weapon = STARTER_WEAPON[id];
    assert.ok(ability, `class ${id} has no starter ability`);
    assert.ok(weapon, `class ${id} has no starter weapon`);
    assert.ok(ABILITIES[ability], `class ${id} starts with unknown ability "${ability}"`);
    assert.ok(WEAPONS[weapon], `class ${id} starts with unknown weapon "${weapon}"`);
  }
});

test('starter gear belongs to the class it is given to', () => {
  for (const id of Object.keys(CLASSES)) {
    assert.equal(ABILITIES[STARTER_ABILITY[id]].cls, id,
      `${id}'s starter ability belongs to another class`);
    assert.equal(WEAPONS[STARTER_WEAPON[id]].cls, id,
      `${id}'s starter weapon belongs to another class`);
  }
});

test('a starter ability is actually usable from level one', () => {
  for (const id of Object.keys(CLASSES)) {
    const ability = ABILITIES[STARTER_ABILITY[id]];
    assert.equal(ability.gate.mastery, 0,
      `${id}'s starter ability is gated behind mastery it cannot have yet`);
    // Casters pay for their starter, but always out of a pool they begin with.
    assert.ok(ability.mana <= CLASSES[id].base.mana,
      `${id}'s starter ability costs more resource than the class starts with`);
  }
});

test('starter weapons are not sold in the shop', () => {
  for (const id of Object.keys(CLASSES)) {
    assert.equal(WEAPONS[STARTER_WEAPON[id]].price, undefined,
      `${id}'s starter weapon is also shop stock`);
  }
});

// ----------------------------------------------------------------- abilities

test('every ability is complete and points at real data', () => {
  for (const [id, ab] of Object.entries(ABILITIES)) {
    assert.ok(ab.name && ab.desc, `ability ${id} is missing name or description`);
    assert.ok(CLASSES[ab.cls], `ability ${id} belongs to unknown class "${ab.cls}"`);
    assert.ok(CLASSES[ab.cls].trees.includes(ab.branch),
      `ability ${id} is on branch "${ab.branch}" which ${ab.cls} does not have`);
    assert.ok(ICON_NAMES.has(ab.icon), `ability ${id} uses unknown icon "${ab.icon}"`);

    assert.ok(ab.gate && CATEGORY_IDS.has(ab.gate.cat),
      `ability ${id} gates on unknown category "${ab.gate?.cat}"`);
    assert.ok(ab.gate.mastery >= 0 && ab.gate.mastery <= 100,
      `ability ${id} gates at unreachable mastery ${ab.gate.mastery}`);

    assert.ok(isFiniteNumber(ab.mana) && ab.mana >= 0, `ability ${id} has a bad mana cost`);
    assert.ok(isFiniteNumber(ab.cd) && ab.cd > 0, `ability ${id} has a bad cooldown`);
    assert.ok(['melee', 'projectile', 'aoe', 'chain', 'buff'].includes(ab.kind),
      `ability ${id} has unknown kind "${ab.kind}"`);
  }
});

test('each ability kind carries the fields its behaviour needs', () => {
  for (const [id, ab] of Object.entries(ABILITIES)) {
    if (ab.kind === 'buff') {
      assert.ok(ab.dur > 0, `buff ${id} has no duration`);
      assert.ok(ab.atkMult || ab.shield, `buff ${id} does nothing`);
      continue;
    }
    assert.ok(isFiniteNumber(ab.dmg) && ab.dmg > 0, `ability ${id} deals no damage`);
    assert.ok(isFiniteNumber(ab.range) && ab.range > 0, `ability ${id} has no range`);
    if (ab.kind === 'projectile') {
      assert.ok(isFiniteNumber(ab.speed) && ab.speed > 0, `projectile ${id} has no speed`);
    }
    if (ab.kind === 'chain') {
      assert.ok(Number.isInteger(ab.chains) && ab.chains >= 2, `chain ${id} has a bad chain count`);
    }
  }
});

test('ability names are unique so the UI cannot show two the same', () => {
  const names = Object.values(ABILITIES).map((a) => a.name);
  assert.equal(new Set(names).size, names.length, 'two abilities share a name');
});

test('every class has more abilities than slots, so equipping is a choice', () => {
  // The four slots are deliberately fewer than the kit. When they matched, the
  // player never chose anything and the Eldertree had nothing to offer.
  const SLOTS = 4;
  for (const id of Object.keys(CLASSES)) {
    const kit = abilitiesForClass(id);
    assert.ok(kit.length > SLOTS, `class ${id} has ${kit.length} abilities, needs more than ${SLOTS}`);
    const starters = kit.filter((a) => a.gate.mastery === 0);
    assert.equal(starters.length, 1, `class ${id} has ${starters.length} free starter abilities`);
  }
});

test('every class kit is the same size, so no class is short-changed', () => {
  const sizes = Object.keys(CLASSES).map((id) => abilitiesForClass(id).length);
  assert.equal(new Set(sizes).size, 1, `kit sizes differ: ${sizes.join(', ')}`);
});

test('a gate is never set above the mastery its question bank can produce', () => {
  // A question retires after two correct answers, so a subject's reachable
  // mastery is bounded by its bank. A gate above that ceiling is unreachable
  // content — the ability would be authored and never obtainable.
  const BANKS = { math: [10, 10, 10], cs: [6, 8, 8], science: [6, 7, 8], geo: [6, 6, 6],
                  history: [5, 6, 5], lang: [5, 6, 5], finance: [5, 6, 6] };
  const SCALE = [1.0, 1.15, 1.4];
  for (const [cat, bank] of Object.entries(BANKS)) {
    const ceiling = bank
      .map((n, i) => Math.min(100, 2 * n * 6 * SCALE[i]))
      .reduce((a, b) => a + b, 0) / 3;
    for (const ab of Object.values(ABILITIES)) {
      if (ab.gate.cat !== cat) continue;
      assert.ok(ab.gate.mastery <= ceiling,
        `${ab.name} gates ${cat} at ${ab.gate.mastery} but ${cat} tops out near ${Math.round(ceiling)}`);
    }
  }
});

test('every ability belongs to exactly one class kit', () => {
  const claimed = Object.keys(CLASSES).flatMap((id) => abilitiesForClass(id).map((a) => a.id));
  assert.equal(claimed.length, Object.keys(ABILITIES).length, 'an ability is orphaned');
  assert.equal(new Set(claimed).size, claimed.length);
});

test('ability unlocks are spread across a climbable range', () => {
  for (const id of Object.keys(CLASSES)) {
    const gates = abilitiesForClass(id).map((a) => a.gate.mastery).sort((a, b) => a - b);
    assert.equal(new Set(gates).size, gates.length,
      `class ${id} unlocks two abilities at the same mastery`);
    assert.ok(gates[gates.length - 1] <= 100, `class ${id} has an unreachable unlock`);
  }
});

// ------------------------------------------------------------------- weapons

test('every weapon is complete and points at real data', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.ok(w.name && w.desc, `weapon ${id} is missing name or description`);
    assert.ok(['weapon', 'trinket'].includes(w.slot), `weapon ${id} has unknown slot "${w.slot}"`);
    assert.ok(RARITY[w.rarity], `weapon ${id} has unknown rarity "${w.rarity}"`);
    assert.ok(ICON_NAMES.has(w.icon), `weapon ${id} uses unknown icon "${w.icon}"`);
    if (w.cls !== undefined) {
      assert.ok(CLASSES[w.cls], `weapon ${id} is restricted to unknown class "${w.cls}"`);
    }
  }
});

test('weapon stat bonuses are sane numbers', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    for (const stat of [...STAT_KEYS, 'crit']) {
      if (w[stat] === undefined) continue;
      assert.ok(isFiniteNumber(w[stat]), `weapon ${id} has a non-numeric ${stat}`);
    }
    if (w.crit !== undefined) {
      assert.ok(w.crit >= 0 && w.crit <= 1, `weapon ${id} has an out-of-range crit bonus`);
    }
    if (w.price !== undefined) {
      assert.ok(isFiniteNumber(w.price) && w.price > 0, `weapon ${id} has a bad price`);
    }
  }
});

test('weapon names are unique', () => {
  const names = Object.values(WEAPONS).map((w) => w.name);
  assert.equal(new Set(names).size, names.length, 'two weapons share a name');
});

test('trinkets are open to every class', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    if (w.slot !== 'trinket') continue;
    assert.equal(w.cls, undefined, `trinket ${id} is locked to one class`);
  }
});

test('every class has weapons it can actually buy', () => {
  for (const id of Object.keys(CLASSES)) {
    const stock = weaponsFor(id);
    assert.ok(stock.length > 0, `class ${id} has nothing to buy`);
    for (const w of stock) {
      assert.ok(w.price > 0, `${id} shop lists ${w.id} with no price`);
      assert.ok(!w.cls || w.cls === id, `${id} shop lists another class's ${w.id}`);
    }
  }
});

test('rarer weapons of a class cost more than commoner ones', () => {
  for (const id of Object.keys(CLASSES)) {
    const stock = weaponsFor(id)
      .filter((w) => w.slot === 'weapon')
      .sort((a, b) => RARITY[a.rarity].order - RARITY[b.rarity].order);
    for (let i = 1; i < stock.length; i++) {
      assert.ok(stock[i].price >= stock[i - 1].price,
        `${id}: ${stock[i].id} (${stock[i].rarity}) is cheaper than ${stock[i - 1].id}`);
    }
  }
});

// ------------------------------------------------------------------- potions

test('every potion is complete and does something', () => {
  for (const [id, p] of Object.entries(POTIONS)) {
    assert.ok(p.name && p.desc && p.color, `potion ${id} is incomplete`);
    assert.ok(ICON_NAMES.has(p.icon), `potion ${id} uses unknown icon "${p.icon}"`);
    assert.ok(isFiniteNumber(p.price) && p.price > 0, `potion ${id} has a bad price`);
    assert.ok(p.heal || p.mana || p.buff, `potion ${id} has no effect`);
    if (p.buff) assert.ok(p.dur > 0, `potion ${id} buffs for no time`);
  }
});

// ------------------------------------------------------------------- enemies

test('every enemy is complete and renderable', () => {
  for (const [id, e] of Object.entries(ENEMIES)) {
    assert.ok(e.name, `enemy ${id} has no name`);
    assert.ok(e.sprite === 'slime' || SPECS[e.sprite] || hasActorSheet(e.sprite),
      `enemy ${id} uses unknown sprite "${e.sprite}"`);
    for (const stat of ['hp', 'attack', 'speed', 'reach', 'w', 'xp', 'attackCd']) {
      assert.ok(isFiniteNumber(e[stat]) && e[stat] > 0, `enemy ${id} has a bad ${stat}`);
    }
    assert.ok(isFiniteNumber(e.defense) && e.defense >= 0, `enemy ${id} has a bad defense`);
    assert.ok(['chase', 'hop', 'ranged', 'lobber', 'brute'].includes(e.behavior),
      `enemy ${id} has unknown behavior "${e.behavior}"`);
  }
});

test('enemy gold drops are valid ranges', () => {
  for (const [id, e] of Object.entries(ENEMIES)) {
    assert.ok(Array.isArray(e.gold) && e.gold.length === 2, `enemy ${id} has a bad gold range`);
    const [min, max] = e.gold;
    assert.ok(isFiniteNumber(min) && isFiniteNumber(max), `enemy ${id} gold is not numeric`);
    assert.ok(min >= 0 && min <= max, `enemy ${id} gold range is inverted`);
  }
});

test('a ranged enemy has a projectile to fire', () => {
  for (const [id, e] of Object.entries(ENEMIES)) {
    if (e.behavior !== 'ranged') continue;
    assert.ok(e.projectile, `ranged enemy ${id} has no projectile`);
    assert.ok(isFiniteNumber(e.projSpeed) && e.projSpeed > 0,
      `ranged enemy ${id} has a bad projectile speed`);
  }
});

test('the boss is worth more than any regular enemy', () => {
  const best = Math.max(...Object.values(ENEMIES).map((e) => e.xp));
  const bestGold = Math.max(...Object.values(ENEMIES).map((e) => e.gold[1]));
  for (const [id, b] of Object.entries(BOSS)) {
    assert.ok(b.xp > best, `boss ${id} pays no more xp than a common enemy`);
    assert.ok(b.gold[0] > bestGold, `boss ${id} pays no more gold than a common enemy`);
    assert.ok(b.hp > Math.max(...Object.values(ENEMIES).map((e) => e.hp)),
      `boss ${id} is no tougher than a common enemy`);
  }
});

// ---------------------------------------------------------------------- boss

test('the boss is complete and renderable', () => {
  for (const [id, b] of Object.entries(BOSS)) {
    assert.ok(b.name, `boss ${id} has no name`);
    assert.ok(SPECS[b.sprite], `boss ${id} uses unknown sprite "${b.sprite}"`);
    assert.ok(b.hp > 0 && b.attack > 0 && b.xp > 0, `boss ${id} has bad combat stats`);
    assert.ok(Array.isArray(b.gold) && b.gold[0] <= b.gold[1], `boss ${id} has a bad gold range`);
  }
});

test('boss phases descend from full health without gaps', () => {
  for (const [id, b] of Object.entries(BOSS)) {
    assert.ok(b.phases.length >= 2, `boss ${id} has too few phases`);
    assert.equal(b.phases[0].at, 1.0, `boss ${id} does not start at full health`);
    for (let i = 1; i < b.phases.length; i++) {
      assert.ok(b.phases[i].at < b.phases[i - 1].at,
        `boss ${id} phase ${i} does not come after the one before it`);
    }
    for (const ph of b.phases) {
      assert.ok(ph.at > 0 && ph.at <= 1, `boss ${id} has an unreachable phase at ${ph.at}`);
      assert.ok(ph.name && ph.note, `boss ${id} has an unlabelled phase`);
      assert.ok(ph.speed > 0 && ph.cd > 0, `boss ${id} phase "${ph.name}" has bad pacing`);
      assert.ok(Number.isInteger(ph.summon) && ph.summon >= 0,
        `boss ${id} phase "${ph.name}" has a bad summon count`);
    }
  }
});

test('the boss gets more dangerous as the fight goes on', () => {
  const phases = BOSS.goblin_king.phases;
  const last = phases[phases.length - 1];
  assert.ok(last.speed > phases[0].speed, 'the boss does not speed up');
  assert.ok(last.cd < phases[0].cd, 'the boss does not attack faster');
});

// ---------------------------------------------------------------------- pets

test('every pet is complete and grants a known bonus', () => {
  const known = ['fireDmg', 'trainXp', 'moveSpeed', 'defense', 'rareLoot'];
  for (const [id, p] of Object.entries(PETS)) {
    assert.ok(p.name && p.desc, `pet ${id} is incomplete`);
    assert.ok(p.sprite, `pet ${id} has no sprite`);
    assert.ok(known.includes(p.bonus), `pet ${id} grants unknown bonus "${p.bonus}"`);
    assert.ok(p.amount > 0 && p.amount <= 1, `pet ${id} has an out-of-range bonus amount`);
  }
});

test('pet names and bonuses do not collide', () => {
  const bonuses = Object.values(PETS).map((p) => p.bonus);
  assert.equal(new Set(bonuses).size, bonuses.length, 'two pets grant the same bonus');
  const sprites = Object.values(PETS).map((p) => p.sprite);
  assert.equal(new Set(sprites).size, sprites.length, 'two pets share a sprite');
});

// ------------------------------------------------------------ cross-cutting

test('the quest reward item exists', async () => {
  const { QUESTS } = await import('../src/game/state.js');
  for (const q of QUESTS) {
    assert.ok(q.name && q.objective && q.giver, `quest ${q.id} is incomplete`);
    if (q.reward.item) {
      assert.ok(WEAPONS[q.reward.item], `quest ${q.id} rewards unknown item "${q.reward.item}"`);
    }
    assert.ok(q.reward.gold >= 0 && q.reward.xp >= 0, `quest ${q.id} has a bad reward`);
  }
});

test('every academic category feeds a real hero stat', () => {
  const feedable = new Set([...STAT_KEYS, 'gold']);
  for (const c of CATEGORIES) {
    assert.ok(feedable.has(c.stat), `category ${c.id} feeds unknown stat "${c.stat}"`);
  }
});
