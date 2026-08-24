// The question bank and the adaptive engine. These exercise the real bank and a
// real Hero — the point is to check the behaviour students actually get, not to
// rebuild the selection logic inside the tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BANK, pool } from '../src/academics/bank.js';
import { AdaptiveSession } from '../src/academics/adaptive.js';
import { Hero } from '../src/game/state.js';
import { CATEGORIES, LEVELS } from '../src/game/data.js';

const warrior = () => Hero.create('warrior');

// ------------------------------------------------------------- the question bank

test('every category has questions at every academic level', () => {
  for (const c of CATEGORIES) {
    for (const l of LEVELS) {
      const qs = pool(c.id, l.id);
      assert.ok(qs.length > 0, `${c.id}/${l.id} has no questions`);
    }
  }
});

test('an unknown category or level yields an empty pool, not a crash', () => {
  assert.deepEqual(pool('astrology', 'middle'), []);
  assert.deepEqual(pool('math', 'kindergarten'), []);
});

test('every question is stamped with a unique id, its category and its level', () => {
  const ids = new Set();
  for (const [cat, levels] of Object.entries(BANK)) {
    for (const [level, qs] of Object.entries(levels)) {
      for (const q of qs) {
        assert.ok(q.id, 'question is missing an id');
        assert.ok(!ids.has(q.id), `duplicate question id ${q.id}`);
        ids.add(q.id);
        assert.equal(q.cat, cat);
        assert.equal(q.level, level);
      }
    }
  }
});

test('every question is answerable and tagged for the concept ladder', () => {
  for (const levels of Object.values(BANK)) {
    for (const qs of Object.values(levels)) {
      for (const q of qs) {
        assert.ok(q.q && typeof q.q === 'string', `question ${q.id} has no prompt`);
        assert.ok(typeof q.sub === 'string' && q.sub, `question ${q.id} has no sub-topic`);
        assert.ok([0, 1, 2].includes(q.tier), `question ${q.id} has tier ${q.tier}`);

        if (q.numeric) {
          assert.ok(q.answer !== undefined, `numeric question ${q.id} has no answer`);
        } else {
          assert.ok(Array.isArray(q.choices) && q.choices.length >= 2,
            `question ${q.id} needs at least two choices`);
          assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.choices.length,
            `question ${q.id} has answer index ${q.a} outside its choices`);
        }
      }
    }
  }
});

test('multiple-choice options are distinct', () => {
  for (const levels of Object.values(BANK)) {
    for (const qs of Object.values(levels)) {
      for (const q of qs) {
        if (q.numeric) continue;
        assert.equal(new Set(q.choices).size, q.choices.length,
          `question ${q.id} repeats a choice`);
      }
    }
  }
});

// ---------------------------------------------------------- starting tier

test('a new student starts at the foundations tier', () => {
  const s = new AdaptiveSession(warrior(), 'math', 'middle');
  assert.equal(s.tier, 0);
  assert.equal(s.tierLabel(), 'Foundations');
});

test('a returning student skips the basics they have already mastered', () => {
  const hero = warrior();
  hero.s.mastery.math = { middle: 100, high: 100, college: 0 }; // 55.6
  const mid = new AdaptiveSession(hero, 'math', 'high');
  assert.equal(mid.tier, 1);
  assert.equal(mid.tierLabel(), 'Developing');

  hero.s.mastery.math = { middle: 100, high: 100, college: 100 }; // 100
  const top = new AdaptiveSession(hero, 'math', 'high');
  assert.equal(top.tier, 2);
  assert.equal(top.tierLabel(), 'Advanced');
});

// --------------------------------------------------------------- selection

test('next returns a question from the requested category and level', () => {
  const s = new AdaptiveSession(warrior(), 'science', 'high');
  const q = s.next();
  assert.ok(q);
  assert.equal(q.cat, 'science');
  assert.equal(q.level, 'high');
});

test('a shuffled multiple-choice question still points at the right answer', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'high');
  for (let i = 0; i < 200; i++) {
    const q = s.next();
    if (q.numeric) continue;
    const expected = q.choices[q.a];
    assert.equal(q.presentedChoices[q.answerIndex], expected,
      `shuffle lost the answer for ${q.id}`);
    assert.equal(q.presentedChoices.length, q.choices.length);
  }
});

test('a numeric question is presented without choices', () => {
  const s = new AdaptiveSession(warrior(), 'math', 'middle');
  for (let i = 0; i < 40; i++) {
    const q = s.next();
    if (!q.numeric) continue;
    assert.equal(q.presentedChoices, null);
    return;
  }
});

test('the engine does not repeat a question it just asked', () => {
  const s = new AdaptiveSession(warrior(), 'math', 'middle');
  const first = s.next();
  const second = s.next();
  assert.notEqual(first.id, second.id);
});

test('questions answered right twice are retired while fresh ones remain', () => {
  const hero = warrior();
  const all = pool('math', 'middle'); // ten questions, comfortably more than the
  const retired = [all[0], all[1]];   // four-deep recency window
  for (const q of retired) hero.s.trainingSeen[q.id] = 2;

  const s = new AdaptiveSession(hero, 'math', 'middle');
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(s.next().id);
  for (const q of retired) {
    assert.ok(!seen.has(q.id), `retired question ${q.id} came back`);
  }
});

test('the engine still serves a question once everything has been retired', () => {
  // Retirement is a preference, not a hard stop: rather than run dry the engine
  // relaxes its filters and re-asks. Note the recency filter outranks the
  // mastered filter, so a nearly-exhausted pool will revisit retired questions.
  const hero = warrior();
  const all = pool('cs', 'middle');
  for (const q of all) hero.s.trainingSeen[q.id] = 2;

  const s = new AdaptiveSession(hero, 'cs', 'middle');
  for (let i = 0; i < 10; i++) {
    const q = s.next();
    assert.ok(q && q.id, 'the engine ran dry instead of relaxing its filters');
  }
});

// ----------------------------------------------------------------- grading

test('a correct multiple-choice answer is graded correct', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  const q = s.next();
  const res = s.grade(q, q.answerIndex);
  assert.equal(res.correct, true);
  assert.equal(s.correct, 1);
  assert.equal(s.answered, 1);
});

test('a wrong multiple-choice answer is graded wrong', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  const q = s.next();
  const wrong = (q.answerIndex + 1) % q.presentedChoices.length;
  const res = s.grade(q, wrong);
  assert.equal(res.correct, false);
  assert.equal(s.correct, 0);
  assert.equal(s.answered, 1);
});

test('numeric answers are matched leniently but not loosely', () => {
  const s = new AdaptiveSession(warrior(), 'math', 'middle');
  const q = { numeric: true, answer: 56, id: 'x', sub: 'arithmetic' };
  assert.equal(s.grade(q, '56').correct, true);
  assert.equal(s.grade(q, ' 56 ').correct, true);
  assert.equal(s.grade(q, '56 apples').correct, true);
  assert.equal(s.grade(q, '57').correct, false);
  assert.equal(s.grade(q, '').correct, false);
  assert.equal(s.grade(q, 'fifty-six').correct, false);
});

test('a negative numeric answer is accepted', () => {
  const s = new AdaptiveSession(warrior(), 'math', 'middle');
  const q = { numeric: true, answer: -12, id: 'x', sub: 'arithmetic' };
  assert.equal(s.grade(q, '-12').correct, true);
  assert.equal(s.grade(q, '12').correct, false);
});

test('accuracy tracks the running score', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  assert.equal(s.accuracy, 0);
  const a = s.next();
  s.grade(a, a.answerIndex);
  const b = s.next();
  s.grade(b, (b.answerIndex + 1) % b.presentedChoices.length);
  assert.equal(s.accuracy, 0.5);
});

// ------------------------------------------------------ the concept ladder

test('two right in a row climbs a tier', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  assert.equal(s.tier, 0);
  for (let i = 0; i < 2; i++) {
    const q = s.next();
    s.grade(q, q.answerIndex);
  }
  assert.equal(s.tier, 1);
});

test('the ladder stops at the top tier', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  for (let i = 0; i < 20; i++) {
    const q = s.next();
    s.grade(q, q.answerIndex);
  }
  assert.equal(s.tier, 2);
});

test('two wrong in a row drops a tier and drills the sub-topic', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  s.tier = 2;
  let last;
  for (let i = 0; i < 2; i++) {
    last = s.next();
    s.grade(last, (last.answerIndex + 1) % last.presentedChoices.length);
  }
  assert.equal(s.tier, 1);
  assert.equal(s.subFocus, last.sub);
});

test('the ladder does not drop below the bottom tier', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  for (let i = 0; i < 20; i++) {
    const q = s.next();
    s.grade(q, (q.answerIndex + 1) % q.presentedChoices.length);
  }
  assert.equal(s.tier, 0);
});

test('getting it right clears the remedial focus', () => {
  const s = new AdaptiveSession(warrior(), 'cs', 'middle');
  const wrong = s.next();
  s.grade(wrong, (wrong.answerIndex + 1) % wrong.presentedChoices.length);
  assert.ok(s.subFocus);
  const right = s.next();
  s.grade(right, right.answerIndex);
  assert.equal(s.subFocus, null);
});

// ------------------------------------------------------- retention tracking

test('answering right builds toward retiring a question', () => {
  const hero = warrior();
  const s = new AdaptiveSession(hero, 'cs', 'middle');
  const q = s.next();
  s.grade(q, q.answerIndex);
  assert.equal(hero.s.trainingSeen[q.id], 1);
});

test('getting it wrong resets that question progress', () => {
  const hero = warrior();
  const s = new AdaptiveSession(hero, 'cs', 'middle');
  const q = s.next();
  hero.s.trainingSeen[q.id] = 1;
  s.grade(q, (q.answerIndex + 1) % q.presentedChoices.length);
  assert.equal(hero.s.trainingSeen[q.id], 0);
});
