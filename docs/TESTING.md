# Testing

Fast regression tests for the parts of Pixel Quest that are pure logic. They run
on Node's built-in test runner — **no dependencies, no install step, no build**.

```bash
npm test
```

```bash
npm run test:watch
```

The whole suite runs in well under a second. There is nothing to `npm install`;
`package.json` exists only to give the tests a runner and to mark the project as
ESM so Node reads `src/*.js` the same way the browser does.

## What is covered

| Area | File | Notes |
| --- | --- | --- |
| Damage arithmetic | `tests/combat-math.test.js` | Swings, combos, crits, armour, shields, boss phases |
| XP and progression | `tests/progression.test.js` | Level curve, mastery, ability unlocks, gold, inventory |
| Save / load | `tests/save.test.js` | Round trip, missing saves, malformed data, version handling |
| Academics | `tests/academics.test.js` | Question bank integrity, adaptive tier ladder, grading |
| Game data | `tests/data.test.js` | Content validation — required fields, cross-references, unique ids |
| Asset paths | `tests/assets.test.js` | Every `assets/…` path the source loads exists on disk |
| RNG | `tests/rng.test.js` | Seeded reproducibility and helper ranges |

The data and asset suites are the cheap ones that keep paying off: a typo'd
category id or a renamed PNG is caught here rather than showing up as an ability
that can never unlock or a silently blank layer in the browser.

## What still needs a human

Tests do **not** replace playing the game. They say nothing about:

- rendering, art, animation, lighting, or anything on the canvas
- town layout, navigation, collision, and scene transitions
- input feel — combo timing, dodge windows, knockback and hit-stop
- audio
- whether the fight is actually *fun* or fairly tuned

Workflow: make the change → `npm test` → run the game → visual/gameplay QA.

## Notes for future sessions

- `src/game/combatMath.js` holds the damage formulas as pure functions. The
  combat scene imports them, so tuning a number there changes the game and the
  tests together. Randomness stays in the scene and is passed in, which is what
  makes the arithmetic testable.
- Tests never touch a real browser save. Node has no `localStorage`, and
  `tests/helpers/env.js` installs an in-memory stand-in.
- Expected values are written as literals rather than recomputed from the
  formula under test, so a broken implementation cannot quietly agree with a
  broken test. Keep it that way.
