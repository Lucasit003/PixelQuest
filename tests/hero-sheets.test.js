// A hero sprite sheet and its catalog entry have to agree about geometry, and
// nothing in the running game says so when they don't.
//
// The failure is silent and confusing: frameWidth/columns that no longer match
// the PNG make every frame sample the wrong rectangle, so a hero either walks
// with a slice of his neighbour attached or vanishes entirely, with no error
// anywhere. This bit during the four-direction work -- the sheets went from 5
// columns to 7 and only the catalog knew.
//
// So the PNG's real dimensions are read here (straight out of the IHDR header,
// no image library needed) and checked against what the catalog claims, along
// with every frame index each animation actually asks for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Width and height from a PNG's IHDR chunk, which is always first. */
function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.readUInt32BE(0), 0x89504e47, `${path} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const HEROES = ['warrior', 'mage', 'rogue', 'ranger', 'paladin', 'berserker', 'summoner'];

// Sheet layout: three walking views (1 idle + 6 walk each), then one row per
// combat action. Actions are profile-only, because combat never passes a `dir`.
const DIRECTIONS = ['side', 'up', 'down'];
const ACTIONS = ['attack', 'heavy', 'cast', 'hurt', 'down'];
const ROWS = DIRECTIONS.length + ACTIONS.length;
const PER_ROW = 7;

async function catalog() {
  await import('../src/gfx/spriteCatalog.js');
  return (await import('../src/gfx/sprites.js')).ACTOR_SPRITES;
}

test('every hero sheet matches the geometry its catalog entry declares', async () => {
  const sprites = await catalog();
  for (const id of HEROES) {
    const cfg = sprites[id];
    assert.ok(cfg, `${id} is not registered`);
    const file = join(ROOT, cfg.sheet);
    assert.ok(existsSync(file), `${id}: missing sheet ${cfg.sheet}`);
    const { w, h } = pngSize(file);
    assert.equal(w, cfg.frameWidth * cfg.columns,
      `${id}: sheet is ${w}px wide but the catalog claims ` +
      `${cfg.columns} columns of ${cfg.frameWidth}px`);
    assert.equal(h, cfg.frameHeight * ROWS,
      `${id}: sheet is ${h}px tall but the catalog claims ` +
      `${ROWS} rows of ${cfg.frameHeight}px`);
  }
});

test('every frame a hero animation asks for exists on its sheet', async () => {
  const sprites = await catalog();
  for (const id of HEROES) {
    const cfg = sprites[id];
    const { w, h } = pngSize(join(ROOT, cfg.sheet));
    const total = (w / cfg.frameWidth) * (h / cfg.frameHeight);
    for (const [name, anim] of Object.entries(cfg.animations)) {
      assert.ok(anim.frames.length, `${id}.${name} has no frames`);
      for (const f of anim.frames) {
        assert.ok(Number.isInteger(f) && f >= 0 && f < total,
          `${id}.${name} asks for frame ${f}, but the sheet holds ${total}`);
      }
    }
  }
});

test('every hero can act in combat, not just stand there', async () => {
  const sprites = await catalog();
  for (const id of HEROES) {
    const cfg = sprites[id];
    for (const state of ACTIONS) {
      const anim = cfg.animations[state];
      // Without its own art a state falls back through STATE_FALLBACK to the
      // single-frame idle and the hero freezes mid-fight -- silently, since a
      // fallback is a feature rather than an error. That was the state of every
      // hero before these rows existed: attack, heavy, cast, hurt and death all
      // resolved to one static frame.
      assert.ok(anim, `${id} has no ${state} animation`);
      assert.ok(anim.frames.length > 1,
        `${id}.${state} has ${anim.frames.length} frame(s) -- it would look frozen`);
      // One-shots, not loops: combat holds the state for a fixed window and the
      // pose should settle, not restart partway through.
      assert.equal(anim.loop, false, `${id}.${state} should not loop`);
    }
  }
});

test('retiming a walk does not change how long the cycle takes', async () => {
  const { frameIndexFor } = await import('../src/gfx/sprites.js');
  // The cycle duration is load-bearing: it is what keeps the stride in step
  // with the movement speed, so `holds` must redistribute time WITHIN the
  // cycle and never stretch it. A cycle that ran long would put the feet back
  // to skating, silently.
  const flat = { frames: [0, 1, 2, 3, 4, 5], fps: 14 };
  const held = { frames: [0, 1, 2, 3, 4, 5], fps: 14,
                 holds: [1.15, 0.85, 1.05, 1.15, 0.85, 1.05] };
  const dur = flat.frames.length / flat.fps;
  // both wrap at exactly one cycle
  assert.equal(frameIndexFor(held, 0), 0);
  assert.equal(frameIndexFor(held, dur - 1e-6), held.frames.length - 1);
  assert.equal(frameIndexFor(held, dur + 1e-6), 0);
  // every pose is reached, and the long ones really are longer
  const counts = new Array(6).fill(0);
  const N = 6000;
  for (let i = 0; i < N; i++) counts[frameIndexFor(held, i * dur / N)]++;
  for (let i = 0; i < 6; i++) assert.ok(counts[i] > 0, `pose ${i} never shows`);
  assert.ok(counts[0] > counts[1], 'contact should hold longer than the transition');
  assert.ok(counts[2] > counts[1], 'passing should hold longer than the transition');
  // and a flat animation is untouched by the new code path
  for (let i = 0; i < 50; i++) {
    assert.equal(frameIndexFor(flat, i * dur / 50),
                 Math.floor(i * dur / 50 * flat.fps) % 6);
  }
});

test('a hero walk cycle covers the ground his stride does', async () => {
  const sprites = await catalog();
  // Measured on the art: one step spans 45.6% of the figure's height, so a
  // full cycle of two steps covers 0.912 of his height. He is drawn 45.9 world
  // units tall and town walks him at 100 units a second. If the cycle lasts
  // longer than that stride takes, the planted foot drags -- which is exactly
  // what a 12fps cycle was doing, by 19%.
  const STRIDE = 0.912 * 45.9;
  const SPEED = 100;
  const walk = sprites.warrior.animations.walk;
  const travel = SPEED * (walk.frames.length / walk.fps);
  const slide = Math.abs(travel / STRIDE - 1);
  assert.ok(slide < 0.06,
    `walk cycle travels ${travel.toFixed(1)} units against a ${STRIDE.toFixed(1)} ` +
    `unit stride -- ${(slide * 100).toFixed(0)}% of foot slide`);
});

test('every hero carries its own art for walking toward and away', async () => {
  const sprites = await catalog();
  for (const id of HEROES) {
    const anims = sprites[id].animations;
    // A back view is its own drawing, not a mirrored profile -- you can flip a
    // profile forever and never see the back of a head. resolveAnimation falls
    // back to the side view when the directional art is missing, which is safe
    // but wrong-looking, and silent. So the art is required to be present.
    for (const name of ['walkUp', 'walkDown', 'idleUp', 'idleDown']) {
      assert.ok(anims[name], `${id} has no ${name}`);
    }
    // The vertical views are three-quarter drawings, already turned a little,
    // so they are mirrored by `facing` to give a left-ish and a right-ish pose.
    // Without this flag the engine leaves them unmirrored and every hero walks
    // the same way whichever diagonal he takes -- which looks almost right, and
    // is therefore easy to miss.
    assert.equal(sprites[id].threeQuarter, true,
      `${id} does not declare threeQuarter, so its 3/4 views will not mirror`);

    // No two animations may share a frame. They live in separate rows, so an
    // overlap means an index went stale -- and a stale index does not error, it
    // just plays somebody else's pose.
    const seen = new Set();
    let total = 0;
    for (const anim of Object.values(anims)) {
      for (const f of anim.frames) seen.add(f);
      total += anim.frames.length;
    }
    assert.equal(seen.size, total, `${id} has animations sharing frames`);
  }
});
