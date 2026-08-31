// The optional sprite-sheet rendering path for actors.
//
// Pixel Quest draws actors procedurally (gfx/actors.js) and always will by
// default. This module is the SECOND path: an actor whose sprite id is present
// in ACTOR_SPRITES is drawn from a sheet instead. Everything else — every class,
// enemy, NPC and pet — keeps rendering exactly as before. Opting in is one
// registerActorSprite() call; nothing else in the game changes.
//
// The sheet layout matches what the pixel-art tooling emits: fixed-size frames
// packed left-to-right, top-to-bottom, `columns` per row, every frame
// bottom-baseline aligned. Animations index into that grid by frame number, so
// one sheet holds every state an actor has.
//
// Two rules this module exists to protect:
//   * ART IS NOT COLLISION. Frame size never feeds a hitbox, a reach, or an
//     interaction range. A sword that overhangs the frame changes nothing about
//     gameplay. `logicalHeight` is authored, never measured from the image.
//   * WEAPONS STAY SEPARATE. Sheets are not required to include a weapon. A
//     config can declare a `hand` anchor, which handAnchor() resolves to a world
//     position (mirroring included) so a weapon can be layered on later.

import { shadow } from './pixel.js';

// ------------------------------------------------------------- sheet cache
// One Image per URL, created on first draw and shared by every actor using it.
// Lazy on purpose: registering a config costs nothing until something draws it.

const sheets = new Map();

export function getSheet(url) {
  let entry = sheets.get(url);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false };
    img.onload = () => { entry.ready = true; };
    img.onerror = () => { entry.failed = true; };
    img.src = url;
    sheets.set(url, entry);
  }
  return entry;
}

// Test seam: lets the suite prime the cache without a browser.
export function _putSheet(url, entry) { sheets.set(url, entry); }
export function _clearSheets() { sheets.clear(); }

// -------------------------------------------------------------- registry

export const ACTOR_SPRITES = {};

export function registerActorSprite(id, config) {
  const problems = validateSpriteConfig(config);
  if (problems.length) {
    throw new Error(`sprite config for "${id}" is invalid: ${problems.join('; ')}`);
  }
  ACTOR_SPRITES[id] = config;
  return config;
}

export function unregisterActorSprite(id) { delete ACTOR_SPRITES[id]; }

// An actor opts in by its sprite id, or by naming a config directly.
export function spriteConfigFor(actor) {
  if (!actor) return null;
  if (actor.spriteConfig) return actor.spriteConfig;
  return ACTOR_SPRITES[actor.sprite] || null;
}

// ------------------------------------------------------------ validation

export function validateSpriteConfig(cfg) {
  const problems = [];
  if (!cfg || typeof cfg !== 'object') return ['config is not an object'];
  if (!cfg.sheet) problems.push('missing "sheet"');
  if (!(cfg.frameWidth > 0)) problems.push('"frameWidth" must be a positive number');
  if (!(cfg.frameHeight > 0)) problems.push('"frameHeight" must be a positive number');
  if (cfg.columns !== undefined && !(Number.isInteger(cfg.columns) && cfg.columns > 0)) {
    problems.push('"columns" must be a positive integer when given');
  }

  const anims = cfg.animations;
  if (!anims || typeof anims !== 'object' || !Object.keys(anims).length) {
    problems.push('no animations defined');
    return problems;
  }
  if (!anims.idle) problems.push('an "idle" animation is required as the final fallback');

  for (const [name, anim] of Object.entries(anims)) {
    if (!anim || !Array.isArray(anim.frames) || !anim.frames.length) {
      problems.push(`animation "${name}" has no frames`);
      continue;
    }
    for (const f of anim.frames) {
      if (!Number.isInteger(f) || f < 0) {
        problems.push(`animation "${name}" has invalid frame index ${JSON.stringify(f)}`);
        break;
      }
    }
    if (anim.fps !== undefined && !(anim.fps > 0)) {
      problems.push(`animation "${name}" has a non-positive fps`);
    }
    // Per-frame equipment anchors must line up with the frames they describe,
    // or a weapon silently snaps to the wrong place mid-swing.
    for (const slot of ['hand', 'shield']) {
      const perFrame = anim[slot];
      if (perFrame === undefined) continue;
      if (!Array.isArray(perFrame) || perFrame.length !== anim.frames.length) {
        problems.push(
          `animation "${name}" has ${Array.isArray(perFrame) ? perFrame.length : 'a non-array'} `
          + `"${slot}" anchors for ${anim.frames.length} frames`,
        );
        continue;
      }
      if (!perFrame.every((p) => Array.isArray(p) && p.length === 2
        && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
        problems.push(`animation "${name}" has a malformed "${slot}" anchor`);
      }
    }
    // Rotation is validated the same way and for the same reason: a swing whose
    // angle list is one short silently stops turning on the last frame, which
    // looks like the weapon sticking mid-air rather than like a bug.
    for (const slot of ['hand', 'shield']) {
      const angles = anim[`${slot}Angle`];
      if (angles === undefined) continue;
      if (!Array.isArray(angles)) {
        problems.push(`animation "${name}" has a non-array "${slot}Angle"`);
        continue;
      }
      if (angles.length !== anim.frames.length) {
        problems.push(
          `animation "${name}" has ${angles.length} "${slot}Angle" entries `
          + `for ${anim.frames.length} frames`,
        );
        continue;
      }
      if (!angles.every((d) => Number.isFinite(d))) {
        problems.push(`animation "${name}" has a malformed "${slot}Angle"`);
      }
    }
  }
  return problems;
}

// --------------------------------------------------------- state -> anim
// An actor never has to implement every state. Each falls back along a chain
// that degrades toward idle, so a two-animation sheet still renders every state
// the game can put an actor into.

export const STATE_FALLBACK = {
  walk:   ['idle'],
  attack: ['idle'],
  heavy:  ['attack', 'idle'],
  cast:   ['attack', 'idle'],
  hurt:   ['idle'],
  down:   ['hurt', 'idle'],
  dodge:  ['walk', 'idle'],
  jump:   ['walk', 'idle'],
};

// ------------------------------------------------------- facing direction
//
// An actor walking away from the camera is NOT a mirrored side view -- you can
// flip a profile left and right forever and never see the back of a head. So a
// vertical direction needs its own art, named by suffixing the state:
//
//     walk      side-on, mirrored by `facing`
//     walkUp    walking away from the camera
//     walkDown  walking toward the camera
//
// `dir` on an actor is 'side' (the default), 'up' or 'down'. A sheet that has
// no directional art simply falls through to the side view, so adding `dir`
// changed nothing for the classes that still render procedurally.
const DIR_SUFFIX = { up: 'Up', down: 'Down' };

/**
 * The animation an actor in `state` should actually play, and its name.
 *
 * `vertical` in the result says the chosen animation is a back or front view,
 * which the renderer needs because those must NOT be mirrored by `facing` --
 * mirroring a back view would flip a quiver onto the wrong shoulder while
 * leaving the character still facing away.
 */
export function resolveAnimation(cfg, state, dir) {
  const anims = cfg.animations;
  const suffix = DIR_SUFFIX[dir];
  const chain = [];
  if (suffix) {
    // Exhaust this direction's own art before falling back to the side view.
    // A missing `walkUp` should try `idleUp` first: showing the side profile
    // while he walks away reads worse than showing a static back.
    chain.push(state + suffix);
    for (const f of STATE_FALLBACK[state] || []) chain.push(f + suffix);
    chain.push('idle' + suffix);
  }
  chain.push(state, ...(STATE_FALLBACK[state] || []), 'idle');
  for (const name of chain) {
    if (name && anims[name]) {
      return { name, anim: anims[name], vertical: !!suffix && name.endsWith(suffix) };
    }
  }
  const first = Object.keys(anims)[0];
  return first ? { name: first, anim: anims[first], vertical: false } : null;
}

// ----------------------------------------------------------- frame timing
// Driven straight off the actor's `animTime`, which the game loop already
// maintains. No per-actor animation state, so this stays a pure function.

export function frameIndexFor(anim, time) {
  const n = anim.frames.length;
  if (n <= 1) return 0;
  const fps = anim.fps || 8;
  const raw = Math.floor(Math.max(0, time) * fps);
  if (anim.loop === false) return Math.min(raw, n - 1);
  return raw % n;
}

/** Everything needed to draw one frame: which cell, and whether a one-shot ended. */
export function spriteFrame(cfg, state, time, dir) {
  const resolved = resolveAnimation(cfg, state, dir);
  if (!resolved) return null;
  const { name, anim, vertical } = resolved;
  const step = frameIndexFor(anim, time);
  const fps = anim.fps || 8;
  const done = anim.loop === false
    && Math.floor(Math.max(0, time) * fps) >= anim.frames.length - 1;
  return { name, anim, step, frame: anim.frames[step], done, vertical };
}

// ------------------------------------------------------------- geometry

export function anchorOf(cfg) {
  return {
    x: cfg.anchorX !== undefined ? cfg.anchorX : cfg.frameWidth / 2,
    y: cfg.anchorY !== undefined ? cfg.anchorY : cfg.frameHeight,
  };
}

function columnsOf(cfg, img) {
  if (cfg.columns) return cfg.columns;
  if (img && img.width) return Math.max(1, Math.floor(img.width / cfg.frameWidth));
  return 1;
}

/** Source rect of a frame index within the sheet grid. */
export function frameRect(cfg, frame, img) {
  const cols = columnsOf(cfg, img);
  return {
    sx: (frame % cols) * cfg.frameWidth,
    sy: Math.floor(frame / cols) * cfg.frameHeight,
    sw: cfg.frameWidth,
    sh: cfg.frameHeight,
  };
}

/**
 * Where a weapon should sit, in world coordinates. `cfg.hand` is authored in
 * right-facing image pixels from the frame's top-left; this converts it through
 * the anchor, the scale and the facing flip. Weapons are drawn by whoever owns
 * them — this only says where.
 *
 * The flip subtracts one pixel because a mirrored pixel reflects about its
 * BOUNDARY, not its centre: a pixel whose left edge sits at local x lands with
 * its left edge at -x-1. The procedural renderer flips the same way (both just
 * apply scale(-1,1)), so this keeps the anchor on the art rather than a pixel
 * beside it.
 */
export function handAnchor(cfg, actor) {
  return attachmentAnchor(cfg, actor, 'hand');
}

/**
 * Where a held item sits this frame, in world coordinates.
 *
 * `slot` is 'hand' or 'shield'. A config gives a default position
 * (`cfg.hand = [x, y]`) and any animation may override it per frame
 * (`anim.hand = [[x, y], ...]`, one entry per frame) — a sword travels through a
 * swing, so a single anchor is not enough for attack animations.
 *
 * `behind` says whether the item draws behind the body this frame, which is how
 * a wind-up reads as "cocked back". The procedural renderer does the same thing.
 *
 * `angle` is the item's ROTATION in degrees this frame, clockwise, 0 = the
 * weapon sprite's own authored orientation. A hammer does not merely travel
 * through a swing, it TURNS through it — without rotation the head points the
 * same way at the top of a wind-up as it does at the bottom of the follow
 * through, which reads as a weapon being dragged rather than swung. Authored as
 * `anim.handAngle = [deg, ...]`, one per frame, or a single `cfg.handAngle` for
 * animations where the wrist barely moves. Mirrored automatically when the
 * actor faces left, so an animation is authored once.
 *
 * This is what keeps EQUIPMENT PROGRESSION out of the character art: an Iron
 * Warhammer and a Sunforged Warhammer are two small sprites played through the
 * same body frames, the same anchors and the same angles.
 *
 * This is what keeps equipment modular: the body sheet is authored empty-handed
 * and each weapon is its own small sprite positioned here, so six Warrior
 * weapons need six weapon sprites, not six complete animation sets.
 */
export function attachmentAnchor(cfg, actor, slot = 'hand') {
  const picked = spriteFrame(cfg, actor.state, actor.animTime || 0, actor.dir);
  let point = cfg[slot];
  let behind = false;
  let angle = cfg[`${slot}Angle`];
  if (!Number.isFinite(angle)) angle = 0;
  // Mirroring the ITEM independently of the actor. A shield strapped to the far
  // arm reads back-to-front on some poses, and a weapon carried across the body
  // needs its lit edge kept on the light side. Authored per frame as
  // `anim.handFlip = [bool, ...]`, default false.
  let flip = !!cfg[`${slot}Flip`];

  if (picked) {
    const perFrame = picked.anim[slot];
    if (Array.isArray(perFrame) && Array.isArray(perFrame[picked.step])) {
      point = perFrame[picked.step];
    }
    const behindList = picked.anim[`${slot}Behind`];
    if (Array.isArray(behindList)) behind = !!behindList[picked.step];
    const angleList = picked.anim[`${slot}Angle`];
    if (Array.isArray(angleList) && Number.isFinite(angleList[picked.step])) {
      angle = angleList[picked.step];
    }
    const flipList = picked.anim[`${slot}Flip`];
    if (Array.isArray(flipList)) flip = !!flipList[picked.step];
  }
  if (!point) return null;

  const a = anchorOf(cfg);
  const scale = (cfg.scale || 1) * (actor.scale || 1);
  const offset = point[0] - a.x;
  const mirrored = actor.facing < 0;
  const localX = mirrored ? -offset - 1 : offset;
  const localY = point[1] - a.y;
  return {
    x: actor.x + localX * scale,
    y: (actor.y - (actor.z || 0)) + localY * scale,
    behind,
    // Mirroring the actor mirrors the swing, so the rotation negates with it.
    // Authoring an animation once therefore covers both facings.
    angle: mirrored ? -angle : angle,
    flip,
    scale,
    facing: mirrored ? -1 : 1,
  };
}

/** Authored height for nameplates and UI. Never measured from the artwork. */
export function logicalHeightOf(cfg) {
  return cfg.logicalHeight !== undefined ? cfg.logicalHeight : null;
}

// --------------------------------------------------------------- drawing

// Reused for the white hit-flash stamp so a flashing actor doesn't allocate.
let scratch = null;
function scratchCanvas(w, h) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) { scratch.width = w; scratch.height = h; }
  const sg = scratch.getContext('2d');
  sg.imageSmoothingEnabled = false;
  sg.clearRect(0, 0, scratch.width, scratch.height);
  return { canvas: scratch, g: sg };
}

/**
 * Draw an actor from its sheet. Returns false when the sheet is not usable yet,
 * so the caller can fall back to the procedural renderer rather than showing a
 * hole while an image decodes.
 *
 * Positioning matches the procedural path exactly: (a.x, a.y) is the ground
 * point under the actor's feet and a.z lifts it off the ground.
 */
export function drawSpriteActor(g, a, cfg) {
  const sheet = getSheet(cfg.sheet);
  if (!sheet.ready) return false;

  const picked = spriteFrame(cfg, a.state, a.animTime || 0, a.dir);
  if (!picked) return false;

  const anchor = anchorOf(cfg);
  const rect = frameRect(cfg, picked.frame, sheet.img);
  const scale = (cfg.scale || 1) * (a.scale || 1);
  // Whether the vertical views may be mirrored depends on how they were drawn.
  // A dead-on front view gains nothing from it and can lose an asymmetric
  // detail, so it is off by default. Art drawn in THREE-QUARTER, where the
  // figure is already turned a little, is the opposite case: mirroring is the
  // whole point, because it turns a single drawing into a left-ish and a
  // right-ish pose. Such a sheet opts in with `threeQuarter`, and every view on
  // it must be authored facing the same way -- see the note in spriteCatalog.
  const flip = a.facing < 0 && (!picked.vertical || !!cfg.threeQuarter);

  const gx = Math.round(a.x);
  const gy = Math.round(a.y);
  const z = a.z || 0;

  // Same ground shadow the procedural actors use, so mixed scenes read alike.
  const shadowScale = Math.max(0.35, 1 - z / 48);
  const shadowR = cfg.shadowRadius !== undefined ? cfg.shadowRadius : 9;
  shadow(g, gx, gy, shadowR * scale * shadowScale, 3 * scale * shadowScale, 0.34);

  g.save();
  if (a.alpha !== undefined && a.alpha < 1) g.globalAlpha = a.alpha;
  g.imageSmoothingEnabled = false;

  // Local space with the origin on the ground under the actor. The anchor sits
  // at local x=0, so the mirror pivots about the foot point and the actor does
  // not slide when it turns around.
  g.translate(gx, gy - z);
  if (scale !== 1) g.scale(scale, scale);
  if (flip) g.scale(-1, 1);

  g.drawImage(
    sheet.img,
    rect.sx, rect.sy, rect.sw, rect.sh,
    -anchor.x, -anchor.y, rect.sw, rect.sh,
  );

  // Hit flash: stamp the frame's silhouette in white.
  if (a.flash > 0) {
    const { canvas, g: sg } = scratchCanvas(rect.sw, rect.sh);
    sg.drawImage(sheet.img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh);
    sg.globalCompositeOperation = 'source-atop';
    sg.fillStyle = '#ffffff';
    sg.fillRect(0, 0, rect.sw, rect.sh);
    sg.globalCompositeOperation = 'source-over';
    g.globalAlpha = Math.min(1, a.flash) * 0.85;
    g.drawImage(canvas, 0, 0, rect.sw, rect.sh, -anchor.x, -anchor.y, rect.sw, rect.sh);
  }

  g.restore();
  return true;
}
