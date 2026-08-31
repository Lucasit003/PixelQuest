// The sprite-sheet rendering path. Animation selection, frame timing and the
// geometry are pure functions, so they test cleanly outside a browser. Nothing
// here asserts pixels — how the art actually looks stays visual QA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The catalog registers the shipped actor sheets as a side effect of import.
import '../src/gfx/spriteCatalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

import {
  validateSpriteConfig, registerActorSprite, unregisterActorSprite,
  spriteConfigFor, ACTOR_SPRITES,
  resolveAnimation, frameIndexFor, spriteFrame, STATE_FALLBACK,
  anchorOf, frameRect, handAnchor, attachmentAnchor, logicalHeightOf,
} from '../src/gfx/sprites.js';
import { closeTo } from './helpers/env.js';

const CFG = {
  sheet: 'assets/actors/dummy.png',
  frameWidth: 24, frameHeight: 32, columns: 4,
  logicalHeight: 26, hand: [18, 17],
  animations: {
    idle:   { frames: [0, 1], fps: 3 },
    walk:   { frames: [4, 5, 6, 7], fps: 10 },
    attack: { frames: [8, 9, 10, 11], fps: 14, loop: false },
  },
};

// --------------------------------------------------------------- validation

test('a well-formed config validates clean', () => {
  assert.deepEqual(validateSpriteConfig(CFG), []);
});

test('a config without a sheet or frame size is rejected', () => {
  const problems = validateSpriteConfig({ animations: { idle: { frames: [0] } } });
  assert.ok(problems.some((p) => p.includes('sheet')));
  assert.ok(problems.some((p) => p.includes('frameWidth')));
  assert.ok(problems.some((p) => p.includes('frameHeight')));
});

test('a config with no animations is rejected', () => {
  const problems = validateSpriteConfig({ ...CFG, animations: {} });
  assert.ok(problems.some((p) => p.includes('no animations')));
});

test('idle is required because everything falls back to it', () => {
  const { idle, ...rest } = CFG.animations;
  const problems = validateSpriteConfig({ ...CFG, animations: rest });
  assert.ok(problems.some((p) => p.includes('idle')));
});

test('an animation with no frames is rejected', () => {
  const problems = validateSpriteConfig({
    ...CFG, animations: { idle: { frames: [0] }, walk: { frames: [] } },
  });
  assert.ok(problems.some((p) => p.includes('walk') && p.includes('no frames')));
});

test('invalid frame indices and fps are rejected', () => {
  const bad = validateSpriteConfig({
    ...CFG, animations: { idle: { frames: [0, -3] } },
  });
  assert.ok(bad.some((p) => p.includes('invalid frame index')));

  const slow = validateSpriteConfig({
    ...CFG, animations: { idle: { frames: [0], fps: 0 } },
  });
  assert.ok(slow.some((p) => p.includes('fps')));
});

test('registering an invalid config throws instead of failing at draw time', () => {
  assert.throws(
    () => registerActorSprite('broken', { sheet: 'x.png' }),
    (err) => err.message.includes('broken') && err.message.includes('invalid'),
  );
  assert.equal(ACTOR_SPRITES.broken, undefined, 'a bad config must not be registered');
});

// ----------------------------------------------------------------- opt-in

test('an unregistered actor has no sprite config, so it stays procedural', () => {
  // This fixture has to be an actor that genuinely has no sheet or the test
  // stops testing anything. 'goblin' stood here first and was swapped when it
  // became sheet-backed; 'warrior' replaced it and has now gone the same way.
  // 'villager' and 'skeleton' are procedural-only.
  assert.equal(spriteConfigFor({ sprite: 'villager' }), null);
  assert.equal(spriteConfigFor({ sprite: 'skeleton' }), null);
  assert.equal(spriteConfigFor(null), null);
});

test('registering opts exactly one actor in, and it can be removed again', () => {
  registerActorSprite('unit_probe', CFG);
  assert.equal(spriteConfigFor({ sprite: 'unit_probe' }), CFG);
  assert.equal(spriteConfigFor({ sprite: 'villager' }), null, 'others were affected');
  unregisterActorSprite('unit_probe');
  assert.equal(spriteConfigFor({ sprite: 'unit_probe' }), null);
});

test('an actor can carry its own config without touching the registry', () => {
  const cfg = spriteConfigFor({ sprite: 'villager', spriteConfig: CFG });
  assert.equal(cfg, CFG);
  assert.equal(ACTOR_SPRITES.villager, undefined, 'the registry was not touched');
});

// ------------------------------------------------------- state resolution

test('a state with its own animation plays it', () => {
  assert.equal(resolveAnimation(CFG, 'walk').name, 'walk');
  assert.equal(resolveAnimation(CFG, 'attack').name, 'attack');
});

test('a missing state degrades along its fallback chain', () => {
  // no 'heavy' on this sheet -> attack
  assert.equal(resolveAnimation(CFG, 'heavy').name, 'attack');
  // no 'dodge' -> walk
  assert.equal(resolveAnimation(CFG, 'dodge').name, 'walk');
  // no 'hurt' -> idle
  assert.equal(resolveAnimation(CFG, 'hurt').name, 'idle');
});

test('fallback keeps degrading when the middle of the chain is absent too', () => {
  const minimal = { ...CFG, animations: { idle: CFG.animations.idle } };
  for (const state of ['walk', 'attack', 'heavy', 'cast', 'hurt', 'down', 'dodge', 'jump']) {
    assert.equal(resolveAnimation(minimal, state).name, 'idle',
      `${state} should have degraded to idle`);
  }
});

test('every state the game can set resolves to something', () => {
  const states = ['idle', 'walk', 'attack', 'heavy', 'cast', 'hurt', 'dodge', 'jump', 'down'];
  for (const state of states) {
    const r = resolveAnimation(CFG, state);
    assert.ok(r && r.anim, `state ${state} resolved to nothing`);
  }
});

test('an unknown state falls back to idle rather than breaking', () => {
  assert.equal(resolveAnimation(CFG, 'moonwalk').name, 'idle');
  assert.equal(resolveAnimation(CFG, undefined).name, 'idle');
});

test('every fallback chain terminates at idle', () => {
  for (const [state, chain] of Object.entries(STATE_FALLBACK)) {
    const last = [state, ...chain].at(-1);
    assert.equal(last, 'idle', `chain for ${state} does not end at idle`);
  }
});

// ---------------------------------------------------------- frame timing

test('a looping animation advances with time and wraps', () => {
  const walk = CFG.animations.walk; // 4 frames at 10fps -> 0.1s each
  assert.equal(frameIndexFor(walk, 0), 0);
  assert.equal(frameIndexFor(walk, 0.05), 0);
  assert.equal(frameIndexFor(walk, 0.10), 1);
  assert.equal(frameIndexFor(walk, 0.25), 2);
  assert.equal(frameIndexFor(walk, 0.30), 3);
  assert.equal(frameIndexFor(walk, 0.40), 0, 'did not loop back to the first frame');
  assert.equal(frameIndexFor(walk, 0.50), 1);
});

test('a non-looping animation holds on its last frame', () => {
  const attack = CFG.animations.attack; // 4 frames at 14fps
  assert.equal(frameIndexFor(attack, 0), 0);
  assert.equal(frameIndexFor(attack, 1 / 14), 1);
  assert.equal(frameIndexFor(attack, 3 / 14), 3);
  assert.equal(frameIndexFor(attack, 10), 3, 'a one-shot must not wrap');
});

test('a single-frame animation is always frame zero', () => {
  const still = { frames: [7], fps: 12 };
  assert.equal(frameIndexFor(still, 0), 0);
  assert.equal(frameIndexFor(still, 99), 0);
});

test('negative or missing time does not produce a negative frame', () => {
  const walk = CFG.animations.walk;
  assert.equal(frameIndexFor(walk, -5), 0);
  assert.equal(frameIndexFor(walk, 0), 0);
});

test('fps defaults when an animation does not state one', () => {
  const anim = { frames: [0, 1, 2, 3, 4, 5, 6, 7] }; // default 8fps
  assert.equal(frameIndexFor(anim, 0.125), 1);
  assert.equal(frameIndexFor(anim, 0.5), 4);
});

test('spriteFrame maps a state and a time onto a sheet cell', () => {
  const f = spriteFrame(CFG, 'walk', 0.25);
  assert.equal(f.name, 'walk');
  assert.equal(f.step, 2);
  assert.equal(f.frame, 6, 'should index into the sheet, not the animation');
});

test('spriteFrame reports when a one-shot has finished', () => {
  assert.equal(spriteFrame(CFG, 'attack', 0).done, false);
  assert.equal(spriteFrame(CFG, 'attack', 3 / 14).done, true);
  assert.equal(spriteFrame(CFG, 'attack', 5).done, true);
  assert.equal(spriteFrame(CFG, 'walk', 99).done, false, 'a loop is never done');
});

// ------------------------------------------------------------- geometry

test('the anchor defaults to the bottom-centre foot point', () => {
  const a = anchorOf({ frameWidth: 24, frameHeight: 32 });
  assert.deepEqual(a, { x: 12, y: 32 });
});

test('an explicit anchor overrides the default', () => {
  const a = anchorOf({ frameWidth: 24, frameHeight: 32, anchorX: 10, anchorY: 30 });
  assert.deepEqual(a, { x: 10, y: 30 });
});

test('frames are addressed across the grid then down', () => {
  assert.deepEqual(frameRect(CFG, 0), { sx: 0, sy: 0, sw: 24, sh: 32 });
  assert.deepEqual(frameRect(CFG, 3), { sx: 72, sy: 0, sw: 24, sh: 32 });
  assert.deepEqual(frameRect(CFG, 4), { sx: 0, sy: 32, sw: 24, sh: 32 });
  assert.deepEqual(frameRect(CFG, 9), { sx: 24, sy: 64, sw: 24, sh: 32 });
});

test('columns can be inferred from the loaded sheet', () => {
  const cfg = { ...CFG }; delete cfg.columns;
  assert.deepEqual(frameRect(cfg, 5, { width: 96 }), { sx: 24, sy: 32, sw: 24, sh: 32 });
});

test('actors of different frame sizes share one ground anchor', () => {
  // A short and a tall sheet, both bottom-anchored, must put feet in the same
  // place — that is what keeps mixed-size actors standing on the same ground.
  const short = anchorOf({ frameWidth: 16, frameHeight: 16 });
  const tall = anchorOf({ frameWidth: 48, frameHeight: 64 });
  assert.equal(short.y, 16);
  assert.equal(tall.y, 64);
  // drawn at -anchor.y, both land their last row on the actor's y
  assert.equal(-short.y + 16, 0);
  assert.equal(-tall.y + 64, 0);
});

// ----------------------------------------------------------- hand anchor

test('the hand anchor resolves to a world position', () => {
  const actor = { x: 100, y: 200, z: 0, facing: 1 };
  const h = handAnchor(CFG, actor);
  closeTo(h.x, 100 + (18 - 12));  // 6px right of the foot point
  closeTo(h.y, 200 + (17 - 32));  // 15px above the ground
});

test('the hand anchor mirrors with the actor', () => {
  // A mirrored pixel reflects about its boundary, so the flipped offset is
  // -(offset) - 1. The procedural renderer flips identically; this keeps the
  // weapon anchor on the artwork instead of one pixel beside it.
  const left = handAnchor(CFG, { x: 100, y: 200, z: 0, facing: -1 });
  closeTo(left.x, 100 - 6 - 1, 'the hand did not mirror onto the art');
  closeTo(left.y, 200 - 15, 'mirroring must not move the hand vertically');
});

test('the hand anchor lands on the same pixel the flipped art occupies', () => {
  // hand column 18 with anchor 12 -> offset +6 facing right, -7 facing left,
  // which is where column 18 actually draws once mirrored.
  const right = handAnchor(CFG, { x: 0, y: 0, z: 0, facing: 1 });
  const left = handAnchor(CFG, { x: 0, y: 0, z: 0, facing: -1 });
  assert.equal(right.x, 6);
  assert.equal(left.x, -7);
  assert.equal(right.y, left.y, 'a flip must not change height');
});

test('the hand anchor rises with a jumping actor and scales', () => {
  const airborne = handAnchor(CFG, { x: 100, y: 200, z: 20, facing: 1 });
  closeTo(airborne.y, 200 - 20 + (17 - 32));
  const big = handAnchor(CFG, { x: 100, y: 200, z: 0, facing: 1, scale: 2 });
  closeTo(big.x, 100 + 12);
});

test('a sheet without a hand anchor simply has none', () => {
  const cfg = { ...CFG }; delete cfg.hand;
  assert.equal(handAnchor(cfg, { x: 0, y: 0, facing: 1, state: 'idle', animTime: 0 }), null);
});

// ------------------------------------- per-frame equipment (modular weapons)

const SWING = {
  ...CFG,
  shield: [4, 16],
  animations: {
    ...CFG.animations,
    attack: {
      frames: [8, 9, 10, 11], fps: 14, loop: false,
      hand: [[14, 8], [22, 10], [26, 16], [20, 18]],
      handBehind: [true, false, false, false],
    },
  },
};

test('a weapon follows a per-frame anchor through a swing', () => {
  const at = (t) => attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'attack', animTime: t });
  // anchorX is 12, so local x = authored x - 12
  assert.equal(at(0).x, 2);          // wind-up, drawn back
  assert.equal(at(1 / 14).x, 10);    // swinging through
  assert.equal(at(2 / 14).x, 14);    // full extension
  assert.equal(at(3 / 14).x, 8);     // recovery
});

test('a weapon can be drawn behind the body during a wind-up', () => {
  const at = (t) => attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'attack', animTime: t });
  assert.equal(at(0).behind, true, 'the wind-up frame should hold the weapon behind');
  assert.equal(at(1 / 14).behind, false);
  assert.equal(at(3 / 14).behind, false);
});

test('per-frame anchors mirror with the actor like the art does', () => {
  const right = attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'attack', animTime: 2 / 14 });
  const left = attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: -1, state: 'attack', animTime: 2 / 14 });
  assert.equal(right.x, 14);
  assert.equal(left.x, -15, 'mirrored anchors reflect about the pixel boundary');
  assert.equal(right.y, left.y);
  assert.equal(left.facing, -1);
});

test('an animation with no per-frame anchors falls back to the sheet default', () => {
  const at = attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'walk', animTime: 0 });
  assert.equal(at.x, 18 - 12, 'walk should use the config-level hand anchor');
  assert.equal(at.behind, false);
});

test('the shield resolves through the same mechanism as the weapon', () => {
  const s = attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'idle', animTime: 0 }, 'shield');
  assert.equal(s.x, 4 - 12);
  const h = attachmentAnchor(SWING, { x: 0, y: 0, z: 0, facing: 1, state: 'idle', animTime: 0 }, 'hand');
  assert.notEqual(s.x, h.x, 'shield and weapon must resolve independently');
});

test('per-frame anchors must cover every frame', () => {
  const problems = validateSpriteConfig({
    ...CFG,
    animations: {
      idle: CFG.animations.idle,
      attack: { frames: [8, 9, 10, 11], fps: 14, hand: [[1, 2], [3, 4]] },
    },
  });
  assert.ok(problems.some((p) => p.includes('attack') && p.includes('hand')),
    'a short anchor list should be rejected');
});

test('malformed per-frame anchors are rejected', () => {
  const problems = validateSpriteConfig({
    ...CFG,
    animations: { idle: { frames: [0, 1], hand: [[1, 2], 'nope'] } },
  });
  assert.ok(problems.some((p) => p.includes('malformed')));
});

// -------------------------------------------------- art is not gameplay

test('logical height is authored, never taken from the frame', () => {
  assert.equal(logicalHeightOf(CFG), 26);
  assert.notEqual(logicalHeightOf(CFG), CFG.frameHeight,
    'the whole point is that these differ');
  assert.equal(logicalHeightOf({ ...CFG, logicalHeight: undefined }), null);
});

test('changing frame size does not change the authored height', () => {
  const chunky = { ...CFG, frameWidth: 64, frameHeight: 64 };
  assert.equal(logicalHeightOf(chunky), 26, 'art size leaked into a gameplay-facing value');
});

// ------------------------------------------- registered sheets vs their art
// The catalog's numbers are hand-written but the sheets are generated, so they
// can drift apart the moment a sheet is rebuilt at a different size. These read
// the real PNGs and check the two still agree.

function pngSize(path) {
  // width and height are big-endian uint32s at byte 16 and 20 of an IHDR chunk.
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('every registered actor sheet exists on disk', () => {
  for (const [id, cfg] of Object.entries(ACTOR_SPRITES)) {
    const path = join(ROOT, cfg.sheet);
    assert.ok(existsSync(path), `sprite "${id}" points at missing sheet ${cfg.sheet}`);
  }
});

test('every registered sheet is big enough for the frames it claims', () => {
  for (const [id, cfg] of Object.entries(ACTOR_SPRITES)) {
    const { width, height } = pngSize(join(ROOT, cfg.sheet));
    const cols = cfg.columns || Math.floor(width / cfg.frameWidth);
    assert.ok(cols >= 1, `sprite "${id}" has no usable columns`);

    const maxFrame = Math.max(...Object.values(cfg.animations).flatMap((a) => a.frames));
    const neededRows = Math.floor(maxFrame / cols) + 1;
    assert.ok(cols * cfg.frameWidth <= width,
      `sprite "${id}" claims ${cols} columns of ${cfg.frameWidth}px but the sheet is ${width}px wide`);
    assert.ok(neededRows * cfg.frameHeight <= height,
      `sprite "${id}" needs ${neededRows} rows for frame ${maxFrame}, but the sheet is only ${height}px tall`);
  }
});

test('the Warrior sheet matches its catalog entry exactly', () => {
  const cfg = ACTOR_SPRITES.warrior_sprite;
  assert.ok(cfg, 'the phase A Warrior should be registered');
  const { width, height } = pngSize(join(ROOT, cfg.sheet));
  assert.equal(width, cfg.frameWidth * cfg.columns, 'sheet width disagrees with frameWidth x columns');
  assert.equal(height % cfg.frameHeight, 0, 'sheet height is not a whole number of frame rows');
});

// This assertion has now flipped three times, which is why it is kept rather
// than deleted. It first said 'warrior' must stay UNREGISTERED so the
// procedural Warrior remained the default; then that three finished heroes must
// be registered; then that NONE may be, while the art was cleared for the
// rebuild; and now that all seven are. Each flip states what the game currently
// is, and catches a hero being wired in or dropped by accident.
test('all seven classes are sheet-backed', () => {
  for (const id of ['warrior', 'mage', 'rogue', 'ranger', 'paladin', 'berserker', 'summoner']) {
    const cfg = ACTOR_SPRITES[id];
    assert.ok(cfg, `${id} should have a sheet`);
    assert.ok(cfg.animations.idle && cfg.animations.walk,
      `${id} needs both idle and walk`);
    assert.equal(cfg.logicalHeight, 26,
      `${id} must report the gameplay height, not its frame height`);
  }
  assert.ok(ACTOR_SPRITES.warrior_sprite, 'the phase-A look-dev sheet keeps its own id');
});


test('the Warrior reports the procedural logical height, not its frame height', () => {
  const cfg = ACTOR_SPRITES.warrior_sprite;
  assert.equal(cfg.logicalHeight, 26, 'must match SPECS.warrior.h so nameplates do not move');
  assert.notEqual(cfg.logicalHeight, cfg.frameHeight, 'art size must not become the gameplay height');
});

// --------------------------------------------------------------- direction
//
// A back view is its own drawing, not a mirrored profile. These pin the rule
// that a sheet WITHOUT directional art keeps behaving exactly as it did, so
// adding `dir` could never have regressed the classes that have no back view.

test('an actor with no directional art falls back to the side view', () => {
  const cfg = {
    sheet: 's.png', frameWidth: 8, frameHeight: 8, columns: 4,
    animations: { idle: { frames: [0], fps: 1 }, walk: { frames: [1, 2], fps: 8 } },
  };
  for (const dir of [undefined, 'side', 'up', 'down']) {
    const r = resolveAnimation(cfg, 'walk', dir);
    assert.equal(r.name, 'walk', `dir=${dir} should still resolve to walk`);
    assert.equal(r.vertical, false);
  }
});

test('directional art is preferred when the sheet has it', () => {
  const cfg = {
    sheet: 's.png', frameWidth: 8, frameHeight: 8, columns: 5,
    animations: {
      idle: { frames: [0], fps: 1 }, walk: { frames: [1, 2], fps: 8 },
      idleUp: { frames: [5], fps: 1 }, walkUp: { frames: [6, 7], fps: 8 },
      idleDown: { frames: [10], fps: 1 }, walkDown: { frames: [11, 12], fps: 8 },
    },
  };
  assert.equal(resolveAnimation(cfg, 'walk', 'up').name, 'walkUp');
  assert.equal(resolveAnimation(cfg, 'walk', 'down').name, 'walkDown');
  assert.equal(resolveAnimation(cfg, 'walk', 'side').name, 'walk');
  assert.equal(resolveAnimation(cfg, 'walk', 'up').vertical, true);
  assert.equal(resolveAnimation(cfg, 'walk', 'side').vertical, false);
});

test('a missing walkUp falls back within its own direction before the side view', () => {
  // Showing a side profile while he walks away reads worse than a static back.
  const cfg = {
    sheet: 's.png', frameWidth: 8, frameHeight: 8, columns: 5,
    animations: {
      idle: { frames: [0], fps: 1 }, walk: { frames: [1, 2], fps: 8 },
      idleUp: { frames: [5], fps: 1 },
    },
  };
  const r = resolveAnimation(cfg, 'walk', 'up');
  assert.equal(r.name, 'idleUp');
  assert.equal(r.vertical, true);
});

test('a vertical view is never mirrored by facing', () => {
  // The renderer reads `vertical` to decide, so this is the contract it needs.
  const cfg = {
    sheet: 's.png', frameWidth: 8, frameHeight: 8, columns: 5,
    animations: { idle: { frames: [0], fps: 1 }, walkUp: { frames: [6], fps: 8 } },
  };
  const picked = spriteFrame(cfg, 'walk', 0, 'up');
  assert.equal(picked.vertical, true, 'up view must be flagged so facing cannot flip it');
});
