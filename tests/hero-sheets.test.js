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

// The four-direction layout: one row per view, 1 idle + 6 walk in each.
const DIRECTIONS = ['side', 'up', 'down'];
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
    assert.equal(h, cfg.frameHeight * DIRECTIONS.length,
      `${id}: sheet is ${h}px tall but the catalog claims ` +
      `${DIRECTIONS.length} rows of ${cfg.frameHeight}px`);
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

    // The three views must not overlap: each frame belongs to exactly one.
    const seen = new Set();
    for (const anim of Object.values(anims)) {
      for (const f of anim.frames) seen.add(f);
    }
    assert.equal(seen.size, DIRECTIONS.length * PER_ROW,
      `${id} reaches ${seen.size} distinct frames, expected ` +
      `${DIRECTIONS.length * PER_ROW}`);
  }
});
