// Sprite-sheet player for actors whose art has outgrown the procedural
// renderers. Self-contained on purpose: a full actor catalog is being built
// on the actor/combat side, and when it lands these registrations fold into
// it — until then this file is the only sheet system main needs.
//
// Conventions (shared with that work): frames run across then down, one
// animation per row, bottom-centre anchor, and a sheet that has not finished
// decoding reports false so the actor keeps its procedural look instead of
// blinking out.
//
// Slime sheets carry their airborne lift BAKED into the hop/slam cells so the
// rows read right when played flat (walking, dev tools, UI). When the engine
// is ALSO providing real height — the hop behavior's jump state drives a.z —
// the baked lift would stack on top of it, so each animation lists its
// per-frame lift and the player adds it back (draws that much lower) while
// airborne. One source of height at a time.
//
// The Frost Slime shares the 'slime' sprite id but is a different creature —
// blue, tinted at draw time. The green-baked sheet would erase that, so any
// non-default tint falls through to the procedural blob.

import { shadow } from './pixel.js';
import { COMBAT_ACTOR_SCALE } from './actorScale.js';

const SLIME_TINT = '#3fb872'; // the default green drawSlime() uses

const SLIME_ANIMS = {
  idle:   { row: 0, frames: 4, fps: 5, loop: true },
  walk:   { row: 1, frames: 6, fps: 10, loop: true, lift: [0, 1, 5, 6, 0, 0] },
  attack: { row: 2, frames: 6, fps: 12, loop: false, lift: [0, 2, 8, 0, 0, 0] },
  hurt:   { row: 3, frames: 3, fps: 12, loop: false },
  down:   { row: 4, frames: 5, fps: 8, loop: false },
};
const MINI_ANIMS = {
  ...SLIME_ANIMS,
  walk:   { ...SLIME_ANIMS.walk, fps: 12 },
  attack: { row: 2, frames: 4, fps: 12, loop: false, lift: [0, 3, 0, 0] },
};

function still(sheet, frameW, frameH, logicalHeight, shadowRadius) {
  const f = { row: 0, frames: 1, fps: 1, loop: true };
  return {
    // Authored at the FINAL on-screen size: combat draws actors at
    // COMBAT_ACTOR_SCALE, and 1/scale nets exactly 1.0 so these blit 1:1
    // with no fractional row doubling.
    sheet, frameW, frameH, anchorX: Math.floor(frameW / 2), anchorY: frameH,
    scale: 1 / COMBAT_ACTOR_SCALE, logicalHeight, shadowRadius,
    anims: { idle: f, walk: f, attack: f, hurt: f, down: f },
  };
}

function slime(sheet, logicalHeight, shadowRadius, anims = SLIME_ANIMS) {
  return {
    sheet, frameW: 32, frameH: 24, anchorX: 16, anchorY: 24,
    scale: 1, logicalHeight, shadowRadius, anims,
  };
}

const DEFS = {
  // The goblin's numbers mirror the actor-side catalog design: authored at
  // screen resolution for combat's ACTOR_SCALE 1.4, so 1/1.4 blits 1:1.
  goblin: {
    sheet: 'assets/actors/goblin.png',
    frameW: 32, frameH: 32, anchorX: 16, anchorY: 32,
    scale: 1 / 1.4, logicalHeight: 22, shadowRadius: 8,
    anims: {
      idle:   { row: 0, frames: 4, fps: 6, loop: true },
      walk:   { row: 1, frames: 6, fps: 10, loop: true },
      attack: { row: 2, frames: 4, fps: 16, loop: false },
      hurt:   { row: 3, frames: 2, fps: 10, loop: false },
      down:   { row: 4, frames: 4, fps: 8, loop: false },
    },
  },
  slime:      slime('assets/actors/slime_dollop.png', 11, 7),
  // Forest roster bodies, baked from the approved art pack. Single-frame
  // sheets for stage 1: the pose IS the sprite, motion comes from the
  // engine (positions, knockback, flash) until each unit's action poses
  // are baked in as extra frames in its own rollout stage.
  gob_bomber:    still('assets/actors/gob_bomber.png', 28, 34, 17, 9),
  gob_trapper:   still('assets/actors/gob_trapper.png', 30, 35, 17, 9),
  gob_shaman:    still('assets/actors/gob_shaman.png', 29, 36, 18, 9),
  gob_brute:     still('assets/actors/gob_brute.png', 55, 55, 26, 17),
  war_hound:     still('assets/actors/war_hound.png', 31, 23, 10, 12),
  gob_captain:   still('assets/actors/gob_captain.png', 28, 43, 21, 9),
  risen_footman: still('assets/actors/risen_footman.png', 21, 48, 23, 8),
  risen_archer:  still('assets/actors/risen_archer.png', 20, 48, 22, 7),
  // The Risen dig themselves out as individuals: each spawn draws one of
  // the approved skeleton builds from the concept sheet's top rows.
  risen_footman_b: still('assets/actors/risen_footman_b.png', 21, 48, 23, 8),
  risen_footman_c: still('assets/actors/risen_footman_c.png', 20, 48, 23, 8),
  risen_footman_d: still('assets/actors/risen_footman_d.png', 20, 49, 23, 8),
  risen_archer_b:  still('assets/actors/risen_archer_b.png', 19, 46, 22, 7),
  risen_archer_c:  still('assets/actors/risen_archer_c.png', 19, 46, 22, 7),
  risen_archer_d:  still('assets/actors/risen_archer_d.png', 22, 48, 22, 7),
  splitcrown: slime('assets/actors/slime_splitcrown.png', 12, 8),
  lobeling:   slime('assets/actors/slime_lobeling.png', 8, 5, MINI_ANIMS),
  nubling:    slime('assets/actors/slime_nubling.png', 6, 4, MINI_ANIMS),
};

// Lazy image loading + a white copy per sheet for the hit flash.
function ensure(def) {
  if (def._img) return def._ready;
  const img = new Image();
  def._img = img;
  def._ready = false;
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cg = c.getContext('2d');
    cg.drawImage(img, 0, 0);
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = '#ffffff';
    cg.fillRect(0, 0, c.width, c.height);
    def._white = c;
    def._ready = true;
  };
  img.src = def.sheet;
  return false;
}

export function hasActorSheet(sprite) {
  return Boolean(DEFS[sprite]);
}

/** Slime-family ids: while their sheet decodes they fall back to the
 * procedural blob, never the humanoid. */
export function isSlimeSprite(sprite) {
  return sprite === 'slime' || sprite === 'splitcrown' ||
         sprite === 'lobeling' || sprite === 'nubling';
}

export function sheetActorHeight(sprite) {
  const def = DEFS[sprite];
  return def ? def.logicalHeight : 0;
}

/** Draw a from its sheet. Returns false when the procedural path should run. */
export function drawSheetActor(g, a) {
  const def = DEFS[a.sprite];
  if (!def) return false;
  if (a.sprite === 'slime' && a.tint && a.tint !== SLIME_TINT) return false;
  if (!ensure(def)) return false;

  const state = a.state === 'jump' ? 'walk' : a.state;
  const anim = def.anims[state] || def.anims.idle;
  const t = a.animTime || 0;
  let i = Math.floor(t * anim.fps);
  i = anim.loop ? i % anim.frames : Math.min(i, anim.frames - 1);

  const k = (a.scale || 1) * def.scale;
  const z = a.z || 0;
  const gx = Math.round(a.x);
  const gy = Math.round(a.y);

  // real height cancels the baked lift so the two never stack
  let dy = 0;
  if (z > 0 && anim.lift) dy = (anim.lift[i] || 0) * k;

  const alive = state !== 'down';
  if (alive || (a.alpha ?? 1) > 0.5) {
    const shr = Math.max(0.55, 1 - z * 0.012);
    shadow(g, gx, gy, def.shadowRadius * k * shr, 3, 0.3 * shr * (a.alpha ?? 1));
  }

  g.save();
  g.imageSmoothingEnabled = false;
  if ((a.alpha ?? 1) < 1) g.globalAlpha = a.alpha;
  g.translate(gx, gy - z);
  if (a.facing < 0) g.scale(-1, 1);
  const sx = i * def.frameW;
  const sy = anim.row * def.frameH;
  const dx = -def.anchorX * k;
  const dyTop = -def.anchorY * k + dy;
  g.drawImage(def._img, sx, sy, def.frameW, def.frameH,
    dx, dyTop, def.frameW * k, def.frameH * k);
  if (a.flash > 0 && def._white) {
    g.globalAlpha = (a.alpha ?? 1) * Math.min(1, a.flash) * 0.8;
    g.drawImage(def._white, sx, sy, def.frameW, def.frameH,
      dx, dyTop, def.frameW * k, def.frameH * k);
  }
  g.restore();
  return true;
}
