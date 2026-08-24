// The seeded generator underpins training's stable question sets, so its
// reproducibility is worth pinning down. The unseeded helpers are only checked
// for their ranges — they're meant to be unpredictable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, rand, randInt, chance, pick, shuffle, weighted } from '../src/core/rng.js';

test('the same seed replays the same sequence', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const first = Array.from({ length: 20 }, () => a());
  const second = Array.from({ length: 20 }, () => b());
  assert.deepEqual(first, second);
});

test('different seeds diverge', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const first = Array.from({ length: 10 }, () => a());
  const second = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(first, second);
});

test('seeded output stays in [0, 1)', () => {
  const r = mulberry32(987654321);
  for (let i = 0; i < 500; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('a seeded run is stable across sessions', () => {
  // Pinned literals: if the generator is ever swapped out, saved question sets
  // would silently reshuffle and this catches it.
  const r = mulberry32(42);
  const got = [r(), r(), r()].map((v) => Number(v.toFixed(10)));
  assert.deepEqual(got, [0.6011037519, 0.448290559, 0.8524657935]);
});

test('rand stays within its bounds', () => {
  for (let i = 0; i < 200; i++) {
    const v = rand(5, 10);
    assert.ok(v >= 5 && v < 10, `out of range: ${v}`);
  }
});

test('randInt is inclusive at both ends', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(randInt(1, 3));
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('chance honours certainty and impossibility', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(chance(1), true);
    assert.equal(chance(0), false);
  }
});

test('pick returns a member of the array', () => {
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(pick(arr)));
});

test('shuffle preserves the contents and leaves the original alone', () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(arr);
  assert.deepEqual(arr, [1, 2, 3, 4, 5, 6, 7, 8], 'input was mutated');
  assert.deepEqual([...out].sort((a, b) => a - b), arr);
});

test('weighted never returns a zero-weight entry', () => {
  for (let i = 0; i < 300; i++) {
    assert.equal(weighted([['yes', 1], ['never', 0]]), 'yes');
  }
});
