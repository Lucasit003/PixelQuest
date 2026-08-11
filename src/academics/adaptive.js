// Adaptive question selection. The goal from the spec is MASTERY, not repetition:
// answer correctly and the engine climbs the concept ladder (tier 0 -> 1 -> 2)
// and varies sub-topics; struggle and it hands you targeted practice at the tier
// you're stuck on. It also avoids repeating questions you've already nailed.

import { pool } from './bank.js';
import { shuffle, pick } from '../core/rng.js';

export class AdaptiveSession {
  constructor(hero, cat, level) {
    this.hero = hero;
    this.cat = cat;
    this.level = level;
    this.tier = 0;            // current target difficulty tier (0..2)
    this.recent = [];         // last few question ids to avoid immediate repeats
    this.correctStreak = 0;
    this.wrongStreak = 0;
    this.answered = 0;
    this.correct = 0;
    this.subFocus = null;     // when struggling, drill this sub-topic
    // Seed the starting tier from existing mastery so returning players don't
    // re-grind the basics.
    const m = hero.categoryMastery(cat);
    if (m > 60) this.tier = 2;
    else if (m > 30) this.tier = 1;
  }

  get accuracy() { return this.answered ? this.correct / this.answered : 0; }

  // Pick the next question honoring the current tier and avoiding repeats.
  next() {
    const all = pool(this.cat, this.level);
    if (!all.length) return null;

    const seen = this.hero.s.trainingSeen;
    const notRecent = (q) => !this.recent.includes(q.id);
    const notMastered = (q) => !(seen[q.id] >= 2); // answered right twice = retired

    // Preference order of candidate filters, from strict to loose.
    const tries = [];
    if (this.subFocus) {
      tries.push((q) => q.tier === this.tier && q.sub === this.subFocus && notRecent(q) && notMastered(q));
    }
    tries.push((q) => q.tier === this.tier && notRecent(q) && notMastered(q));
    tries.push((q) => Math.abs(q.tier - this.tier) <= 1 && notRecent(q) && notMastered(q));
    tries.push((q) => notRecent(q) && notMastered(q));
    tries.push((q) => notRecent(q));
    tries.push(() => true);

    let candidates = [];
    for (const f of tries) {
      candidates = all.filter(f);
      if (candidates.length) break;
    }

    const q = pick(shuffle(candidates));
    this.recent.push(q.id);
    if (this.recent.length > 4) this.recent.shift();
    this.current = q;
    return this._present(q);
  }

  // Shuffle MC choices so the answer isn't always in the same slot, and return a
  // presentation object the scene can render without mutating the bank.
  _present(q) {
    if (q.numeric) {
      return { ...q, presentedChoices: null };
    }
    const order = shuffle(q.choices.map((c, i) => ({ c, i })));
    const presentedChoices = order.map((o) => o.c);
    const answerIndex = order.findIndex((o) => o.i === q.a);
    return { ...q, presentedChoices, answerIndex };
  }

  // Grade an answer. For MC pass the chosen presented index. For numeric pass
  // the raw string; we fuzzy-match numbers.
  grade(presented, response) {
    let correct;
    if (presented.numeric) {
      correct = this._checkNumeric(presented, response);
    } else {
      correct = response === presented.answerIndex;
    }

    this.answered++;
    const seen = this.hero.s.trainingSeen;
    if (correct) {
      this.correct++;
      this.correctStreak++;
      this.wrongStreak = 0;
      seen[presented.id] = (seen[presented.id] || 0) + 1;
      // Climb: two right in a row at this tier -> raise difficulty.
      if (this.correctStreak >= 2 && this.tier < 2) {
        this.tier++;
        this.correctStreak = 0;
      }
      this.subFocus = null;
    } else {
      this.wrongStreak++;
      this.correctStreak = 0;
      seen[presented.id] = 0; // reset mastery on this item
      // Struggle: drop a tier and drill the sub-topic that tripped you up.
      if (this.wrongStreak >= 2 && this.tier > 0) {
        this.tier--;
        this.wrongStreak = 0;
      }
      this.subFocus = presented.sub;
    }

    return { correct, streak: this.correctStreak };
  }

  _checkNumeric(q, response) {
    const want = Number(q.answer);
    // strip everything but number-ish characters
    const cleaned = String(response).replace(/[^0-9.\-]/g, '');
    if (cleaned === '') return false;
    const got = Number(cleaned);
    if (Number.isNaN(got)) return false;
    const tol = Math.max(0.001, Math.abs(want) * 0.001);
    return Math.abs(got - want) <= tol;
  }

  // A short human-readable label for the concept ladder position.
  tierLabel() {
    return ['Foundations', 'Developing', 'Advanced'][this.tier] || 'Advanced';
  }
}
