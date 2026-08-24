// Save/load round trips against an in-memory localStorage. Node has no real Web
// Storage, so nothing here can reach — let alone overwrite — a player's actual
// browser save.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeStorage, clearStorage, muteWarnings } from './helpers/env.js';

installFakeStorage();

const { Save } = await import('../src/core/save.js');
const { Hero } = await import('../src/game/state.js');

const KEY = 'pixelquest.save.v1';

beforeEach(() => clearStorage());

// --------------------------------------------------------------- round trip

test('a hero survives a save and load with its progression intact', () => {
  const hero = Hero.create('mage');
  hero.s.level = 7;
  hero.s.xp = 120;
  hero.s.gold = 999;
  hero.s.mastery.math = { middle: 80, high: 40, college: 10 };
  hero.addItem('runed_staff');
  hero.equip('runed_staff');
  hero.s.quests.bossDefeated = true;
  hero.s.stats.enemiesDefeated = 42;
  hero.save();

  const loaded = Hero.load();
  assert.ok(loaded, 'nothing loaded back');
  assert.equal(loaded.s.class, 'mage');
  assert.equal(loaded.s.level, 7);
  assert.equal(loaded.s.xp, 120);
  assert.equal(loaded.s.gold, 999);
  assert.deepEqual(loaded.s.mastery.math, { middle: 80, high: 40, college: 10 });
  assert.equal(loaded.s.equipped.weapon, 'runed_staff');
  assert.ok(loaded.s.inventory.weapons.includes('runed_staff'));
  assert.equal(loaded.s.quests.bossDefeated, true);
  assert.equal(loaded.s.stats.enemiesDefeated, 42);
});

test('derived stats are rebuilt on load, not persisted stale', () => {
  const hero = Hero.create('mage');
  hero.s.level = 7;
  hero.recompute();
  hero.save();

  const loaded = Hero.load();
  assert.equal(loaded.maxHp, hero.maxHp);
  assert.equal(loaded.magic, hero.magic);
  assert.equal(loaded.attack, hero.attack);
});

test('unlocked abilities and equipped slots come back as they were', () => {
  const hero = Hero.create('warrior');
  hero.addMastery('history', 'middle', 100);
  hero.addMastery('history', 'high', 100); // unlocks Shield Bash
  hero.save();

  const loaded = Hero.load();
  assert.ok(loaded.s.unlocked.includes('shield_bash'));
  assert.deepEqual(loaded.s.equippedAbilities, hero.s.equippedAbilities);
});

// ------------------------------------------------------------ missing saves

test('loading with nothing saved returns null rather than throwing', () => {
  assert.equal(Save.read(), null);
  assert.equal(Hero.load(), null);
});

test('exists reports whether a save is present', () => {
  assert.equal(Save.exists(), false);
  Hero.create('rogue').save();
  assert.equal(Save.exists(), true);
});

test('clearing removes the save', () => {
  Hero.create('rogue').save();
  Save.clear();
  assert.equal(Save.exists(), false);
  assert.equal(Save.read(), null);
});

// ---------------------------------------------------------- malformed data

test('malformed json is refused instead of crashing the game', () => {
  localStorage.setItem(KEY, '{not valid json');
  const { result, warnings } = muteWarnings(() => Save.read());
  assert.equal(result, null);
  assert.equal(warnings.length, 1, 'the failure should be reported to the console');
});

test('a truncated save is refused', () => {
  localStorage.setItem(KEY, '');
  const { result } = muteWarnings(() => Save.read());
  assert.equal(result, null);
});

// -------------------------------------------------------- version handling

test('the payload is stamped with a version and a timestamp', () => {
  Hero.create('ranger').save();
  const parsed = JSON.parse(localStorage.getItem(KEY));
  assert.equal(parsed.v, 1);
  assert.equal(typeof parsed.t, 'number');
  assert.ok(parsed.state, 'the hero state should live under `state`');
});

test('a save from an unknown version is refused rather than misread', () => {
  localStorage.setItem(KEY, JSON.stringify({ v: 99, t: Date.now(), state: { class: 'warrior' } }));
  assert.equal(Save.read(), null);
  assert.equal(Hero.load(), null);
});

test('a save with no version at all is refused', () => {
  localStorage.setItem(KEY, JSON.stringify({ state: { class: 'warrior' } }));
  assert.equal(Save.read(), null);
});

test('saving twice keeps only the newest hero', () => {
  const first = Hero.create('warrior');
  first.s.gold = 10;
  first.save();
  const second = Hero.create('mage');
  second.s.gold = 20;
  second.save();

  const loaded = Hero.load();
  assert.equal(loaded.s.class, 'mage');
  assert.equal(loaded.s.gold, 20);
});
