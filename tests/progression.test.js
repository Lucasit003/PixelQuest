// XP curve, level-ups, mastery and the stat derivation that hangs off them.
// Expected numbers are written out as literals rather than recomputed from the
// formulas under test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { xpForLevel, masteryGain, trainingXp, CLASSES, ABILITIES } from '../src/game/data.js';
import { Hero } from '../src/game/state.js';
import { closeTo } from './helpers/env.js';

// -------------------------------------------------------------- the XP curve

test('the level curve matches its published thresholds', () => {
  // floor(40 * level^1.5) + 30, spot-checked by hand.
  assert.equal(xpForLevel(1), 70);
  assert.equal(xpForLevel(2), 143);
  assert.equal(xpForLevel(3), 237);
  assert.equal(xpForLevel(5), 477);
  assert.equal(xpForLevel(10), 1294);
});

test('every level costs more than the one before it', () => {
  for (let lv = 1; lv < 50; lv++) {
    assert.ok(xpForLevel(lv + 1) > xpForLevel(lv), `curve flattened at level ${lv}`);
  }
});

// ------------------------------------------------------------- levelling up

test('xp just short of the threshold does not level the hero', () => {
  const hero = Hero.create('warrior');
  const gained = hero.addXp(69); // needs 70
  assert.equal(gained, 0);
  assert.equal(hero.s.level, 1);
  assert.equal(hero.s.xp, 69);
});

test('hitting the threshold exactly levels the hero and clears the bar', () => {
  const hero = Hero.create('warrior');
  const gained = hero.addXp(70);
  assert.equal(gained, 1);
  assert.equal(hero.s.level, 2);
  assert.equal(hero.s.xp, 0);
});

test('a big xp award can carry the hero through several levels at once', () => {
  const hero = Hero.create('warrior');
  const gained = hero.addXp(70 + 143 + 237); // levels 1, 2 and 3
  assert.equal(gained, 3);
  assert.equal(hero.s.level, 4);
  assert.equal(hero.s.xp, 0);
});

test('leftover xp carries into the next level', () => {
  const hero = Hero.create('warrior');
  hero.addXp(75);
  assert.equal(hero.s.level, 2);
  assert.equal(hero.s.xp, 5);
});

test('levelling up refills health and mana', () => {
  const hero = Hero.create('warrior');
  hero.s.hp = 1;
  hero.s.mana = 0;
  hero.addXp(70);
  assert.equal(hero.s.hp, hero.maxHp);
  assert.equal(hero.s.mana, hero.maxMana);
});

test('a level raises stats by the class growth rates', () => {
  const hero = Hero.create('warrior');
  const { base, growth } = { base: CLASSES.warrior.base, growth: CLASSES.warrior.growth };
  assert.equal(hero.maxHp, base.hp);        // 140 at level 1
  hero.addXp(70);
  assert.equal(hero.s.level, 2);
  assert.equal(hero.maxHp, base.hp + growth.hp); // 140 + 22
});

// -------------------------------------------------------------------- mastery

test('mastery is a weighted average that tops out at 100', () => {
  const hero = Hero.create('warrior');
  hero.s.mastery.history = { middle: 100, high: 100, college: 100 };
  assert.equal(hero.categoryMastery('history'), 100);
});

test('college study counts for more than middle school', () => {
  const hero = Hero.create('warrior');
  hero.s.mastery.history = { middle: 90, high: 0, college: 0 };
  const fromMiddle = hero.categoryMastery('history');
  hero.s.mastery.history = { middle: 0, high: 0, college: 90 };
  const fromCollege = hero.categoryMastery('history');
  assert.ok(fromCollege > fromMiddle);
  closeTo(fromMiddle, 20);   // 90 / 4.5
  closeTo(fromCollege, 40);  // 90 * 2 / 4.5
});

test('mastery in a level is capped at 100 however much is poured in', () => {
  const hero = Hero.create('warrior');
  hero.addMastery('history', 'middle', 500);
  assert.equal(hero.s.mastery.history.middle, 100);
});

test('training makes the hero measurably stronger', () => {
  const hero = Hero.create('warrior');
  const before = hero.defense;
  // History feeds defense.
  hero.addMastery('history', 'middle', 100);
  hero.addMastery('history', 'high', 100);
  assert.ok(hero.defense > before, 'defense did not rise with history mastery');
});

test('abilities unlock by mastery, never by purchase', () => {
  const hero = Hero.create('warrior');
  assert.deepEqual(hero.s.unlocked, ['heavy_strike']);

  // Shield Bash gates on 25 history mastery.
  assert.equal(ABILITIES.shield_bash.gate.cat, 'history');
  assert.equal(ABILITIES.shield_bash.gate.mastery, 25);

  hero.addMastery('history', 'middle', 100); // 100/4.5 = 22.2, still short
  assert.ok(!hero.s.unlocked.includes('shield_bash'));

  const unlocked = hero.addMastery('history', 'high', 100); // now 55.6
  assert.ok(unlocked.includes('shield_bash'));
  assert.ok(hero.s.unlocked.includes('shield_bash'));
});

test('learning an ability makes it known but does NOT equip it', () => {
  // Equipping is a choice made at the Eldertree. Auto-slotting would make that
  // choice for the player, which is exactly what the tree exists to hand back.
  const hero = Hero.create('warrior');
  assert.deepEqual(hero.s.equippedAbilities, ['heavy_strike', null, null, null]);
  hero.addMastery('history', 'middle', 100);
  hero.addMastery('history', 'high', 100);
  assert.ok(hero.s.unlocked.includes('shield_bash'), 'it should be known');
  assert.deepEqual(hero.s.equippedAbilities, ['heavy_strike', null, null, null],
    'slots must be untouched until the player assigns one');
});

test('the tree offers exactly the known abilities that are not slotted', () => {
  const hero = Hero.create('warrior');
  hero.addMastery('history', 'middle', 100);
  hero.addMastery('history', 'high', 100);
  const offered = hero.unequippedAbilityDefs().map((a) => a.id);
  assert.ok(offered.includes('shield_bash'), 'newly learned and unslotted');
  assert.ok(!offered.includes('heavy_strike'), 'already in a slot');
  hero.setAbilitySlot(1, 'shield_bash');
  assert.ok(!hero.unequippedAbilityDefs().map((a) => a.id).includes('shield_bash'));
});

test('an ability is never unlocked twice', () => {
  const hero = Hero.create('warrior');
  hero.addMastery('history', 'middle', 100);
  hero.addMastery('history', 'high', 100);
  const again = hero.addMastery('history', 'college', 50);
  assert.ok(!again.includes('shield_bash'));
  const count = hero.s.unlocked.filter((id) => id === 'shield_bash').length;
  assert.equal(count, 1);
});

// ----------------------------------------------------------- training payout

test('harder academic levels pay more mastery', () => {
  assert.equal(masteryGain('middle', true), 6);
  closeTo(masteryGain('high', true), 6.9);     // 6 * 1.15
  closeTo(masteryGain('college', true), 8.4);  // 6 * 1.4
});

test('a wrong answer still earns a little mastery', () => {
  assert.equal(masteryGain('middle', false), 1);
  closeTo(masteryGain('college', false), 1.4);
});

test('training xp rises with academic level and streak', () => {
  assert.equal(trainingXp('middle', true, 0), 9);
  assert.equal(trainingXp('high', true, 0), 13);
  assert.equal(trainingXp('college', true, 0), 18);
  assert.equal(trainingXp('college', true, 5), 27); // 18 * 1.5
});

test('the streak bonus stops at double', () => {
  assert.equal(trainingXp('middle', true, 10), 18); // 9 * 2.0, capped
  assert.equal(trainingXp('middle', true, 100), 18);
});

test('a wrong answer pays a flat consolation xp', () => {
  assert.equal(trainingXp('middle', false, 0), 2);
  assert.equal(trainingXp('college', false, 9), 2);
});

// ----------------------------------------------------------------- economy

test('gold is awarded as given without finance mastery', () => {
  const hero = Hero.create('warrior');
  const before = hero.s.gold;
  const got = hero.addGold(100);
  assert.equal(got, 100);
  assert.equal(hero.s.gold, before + 100);
});

test('finance mastery boosts gold up to +50%', () => {
  const hero = Hero.create('warrior');
  hero.s.mastery.finance = { middle: 100, high: 100, college: 100 };
  assert.equal(hero.addGold(100), 150);
});

test('gold can only be spent when the hero has it', () => {
  const hero = Hero.create('warrior');
  hero.s.gold = 50;
  assert.equal(hero.spendGold(60), false);
  assert.equal(hero.s.gold, 50, 'a failed purchase must not deduct gold');
  assert.equal(hero.spendGold(50), true);
  assert.equal(hero.s.gold, 0);
});

// ---------------------------------------------------------------- inventory

test('equipping a weapon changes the derived stats', () => {
  const hero = Hero.create('warrior');
  const before = hero.attack;
  hero.addItem('iron_sword');
  hero.equip('iron_sword');
  assert.equal(hero.attack, before + 6); // Iron Sword is +6 attack
});

test('a trinket goes to the trinket slot, not the weapon slot', () => {
  const hero = Hero.create('warrior');
  hero.addItem('guard_ring');
  hero.equip('guard_ring');
  assert.equal(hero.s.equipped.trinket, 'guard_ring');
  assert.equal(hero.s.equipped.weapon, 'worn_sword');
});

test('picking up the same item twice does not duplicate it', () => {
  const hero = Hero.create('warrior');
  hero.addItem('iron_sword');
  hero.addItem('iron_sword');
  const count = hero.s.inventory.weapons.filter((id) => id === 'iron_sword').length;
  assert.equal(count, 1);
});

test('potions are consumed and run out', () => {
  const hero = Hero.create('warrior');
  hero.s.inventory.potions.health = 1;
  assert.equal(hero.usePotion('health'), true);
  assert.equal(hero.s.inventory.potions.health, 0);
  assert.equal(hero.usePotion('health'), false, 'used a potion the hero does not have');
});

test('the same ability cannot occupy two slots', () => {
  const hero = Hero.create('warrior');
  hero.setAbilitySlot(2, 'heavy_strike'); // already in slot 0
  assert.equal(hero.s.equippedAbilities[0], null);
  assert.equal(hero.s.equippedAbilities[2], 'heavy_strike');
  const used = hero.s.equippedAbilities.filter((id) => id === 'heavy_strike').length;
  assert.equal(used, 1);
});

test('health and mana pools are clamped to their maximums', () => {
  const hero = Hero.create('warrior');
  hero.s.hp = 99999;
  hero.recompute();
  assert.equal(hero.s.hp, hero.maxHp);
});
