// Equipment rendering: the layer that puts a weapon and a shield onto a body.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//
//     CHARACTER = BODY
//     EQUIPMENT = SEPARATE SPRITES
//     ATTACK    = BODY MOTION + EQUIPMENT ANCHORS
//     VFX       = A SEPARATE LAYER
//
// A body sheet is authored EMPTY-HANDED, with the hands posed as though gripping
// an invisible weapon. Every frame carries `hand` / `shield` anchors, per-frame
// `handAngle` / `shieldAngle` rotations, and `handBehind` / `shieldBehind`
// layering flags (see gfx/sprites.js). This module reads those and draws
// whatever is currently equipped at them.
//
// The payoff: Iron Warhammer -> Blessed Hammer -> Sunforged Hammer -> Legendary
// Hammer are four small sprites played through ONE Paladin body sheet. Adding a
// weapon never means regenerating character art. Same for Wooden Shield ->
// Iron Shield -> Knight Shield -> Blessed Aegis.
//
// Swing trails, impact flashes and holy glows are deliberately NOT drawn here.
// They belong to the combat/VFX layer so a plain iron hammer can throw a dull
// grey streak while a legendary one throws something else entirely — from the
// same body frames.
//
// ------------------------------------------------------------- on layering
//
// There are TWO layers here, not three, and that is a property of the art
// rather than a shortcut: the body is one flat sprite, so an item can sit
// behind all of it or in front of all of it, and nothing can be threaded
// BETWEEN the torso and the front arm. A pose that needs a haft passing behind
// the forearm while its head stays in front of the chest cannot be expressed
// this way.
//
// Closing that gap means splitting the front arm out as its own sprite layer
// with its own anchor, and drawing body -> item -> arm. That is a body-sheet
// change, not an equipment change, so it is deliberately NOT done here. In
// practice most poses read correctly with two layers as long as the wind-up
// frames are flagged `behind`.

import { attachmentAnchor } from './sprites.js';

// ------------------------------------------------------------- item registry
// An equipment item is just a sprite plus the point on that sprite which sits
// in the wielder's fist. Nothing here knows about classes, damage or rarity.
//
//   registerEquipment('hammer_iron', {
//     sprite: 'assets/items/hammer_iron.png',
//     grip:   [6, 26],   // pixel in the item image that lands on the hand anchor
//     angle:  0,         // baked correction if the art is drawn off-axis
//   });

const ITEMS = {};

export function registerEquipment(id, config) {
  const problems = validateEquipment(config);
  if (problems.length) {
    throw new Error(`equipment "${id}" is invalid: ${problems.join('; ')}`);
  }
  ITEMS[id] = config;
  return config;
}

export function equipmentConfig(id) { return ITEMS[id] || null; }
export function unregisterEquipment(id) { delete ITEMS[id]; }
export function _clearEquipment() { for (const k of Object.keys(ITEMS)) delete ITEMS[k]; }

export function validateEquipment(cfg) {
  const problems = [];
  if (!cfg || typeof cfg !== 'object') return ['config is not an object'];
  if (!cfg.sprite) problems.push('missing "sprite"');
  if (!Array.isArray(cfg.grip) || cfg.grip.length !== 2
      || !Number.isFinite(cfg.grip[0]) || !Number.isFinite(cfg.grip[1])) {
    problems.push('"grip" must be [x, y] in item-image pixels');
  }
  if (cfg.angle !== undefined && !Number.isFinite(cfg.angle)) {
    problems.push('"angle" must be a number when given');
  }
  return problems;
}

// ---------------------------------------------------------------- sheet cache
// Shared with nothing: equipment images are small and independent, and keeping
// their own cache means a weapon can be swapped without disturbing body sheets.

const images = new Map();

export function getItemImage(url) {
  let entry = images.get(url);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false };
    img.onload = () => { entry.ready = true; };
    img.onerror = () => { entry.failed = true; };
    img.src = url;
    images.set(url, entry);
  }
  return entry;
}

export function _putItemImage(url, entry) { images.set(url, entry); }

// ------------------------------------------------------------------ drawing

/**
 * Draw one equipped item at its anchor. Returns false when there is nothing to
 * draw — no item, no anchor on this frame, or the image has not decoded — so
 * the caller can simply carry on. A missing weapon must never take the body
 * down with it.
 *
 * `pass` selects the layering half: 'behind' draws only items the frame flags
 * as behind the body, 'front' draws only the rest. Call once before the body
 * and once after, which is what lets a haft pass behind the head during a
 * wind-up while the head stays in front of it.
 */
export function drawEquipped(g, actor, cfg, itemId, slot, pass) {
  const item = ITEMS[itemId];
  if (!item) return false;

  const anchor = attachmentAnchor(cfg, actor, slot);
  if (!anchor) return false;
  if ((pass === 'behind') !== !!anchor.behind) return false;

  const sheet = getItemImage(item.sprite);
  if (!sheet.ready) return false;

  const deg = (anchor.angle || 0) + (item.angle || 0);
  const [gx, gy] = item.grip;

  g.save();
  if (actor.alpha !== undefined && actor.alpha < 1) g.globalAlpha = actor.alpha;
  g.imageSmoothingEnabled = false;

  // Move to the hand, mirror with the actor, rotate about the grip, then draw
  // the item so its grip pixel sits exactly on that point. Rotating about the
  // grip rather than the image centre is what stops a hammer sliding out of the
  // fist as it turns through a swing.
  g.translate(Math.round(anchor.x), Math.round(anchor.y));
  if (anchor.facing < 0) g.scale(-1, 1);
  if (anchor.flip) g.scale(-1, 1);   // per-frame item mirror, independent of facing
  if (anchor.scale !== 1) g.scale(anchor.scale, anchor.scale);
  if (deg) g.rotate(deg * Math.PI / 180);
  g.drawImage(sheet.img, -gx, -gy);

  g.restore();
  return true;
}

/**
 * Where a point on an equipped ITEM IMAGE lands in world coordinates.
 *
 * `point` is [x, y] in the item's own pixels, the same space as `grip` and
 * `tip`. This repeats, exactly, the transform `drawEquipped` draws with —
 * translate to the anchor, mirror for facing, rotate about the GRIP — because
 * anything that needs to know where part of a weapon IS must agree with where
 * it was DRAWN. A swing trail that computes its own transform drifts away from
 * the hammer the first time the draw path changes; so does a bowstring.
 *
 * Returns null when the slot has no anchor this frame or nothing is equipped.
 */
export function itemPointToWorld(cfg, actor, slot, point) {
  const eq = actor.equipped;
  if (!eq || !eq[slot] || !point) return null;
  const item = ITEMS[eq[slot]];
  if (!item) return null;

  const anchor = attachmentAnchor(cfg, actor, slot);
  if (!anchor) return null;

  const dx = point[0] - item.grip[0];
  const dy = point[1] - item.grip[1];

  const rad = ((anchor.angle || 0) + (item.angle || 0)) * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  let rx = (dx * cos - dy * sin) * anchor.scale;
  const ry = (dx * sin + dy * cos) * anchor.scale;
  if (anchor.flip) rx = -rx;
  if (anchor.facing < 0) rx = -rx;

  return { x: anchor.x + rx, y: anchor.y + ry };
}

// The order slots draw in when a config does not say otherwise. Shield before
// weapon: when both land on the same side, the weapon reads better over the
// shield than under it.
const DEFAULT_SLOTS = ['shield', 'offHand', 'hand', 'mainHand'];

/**
 * Draw everything an actor has equipped for one layering pass.
 *
 * `actor.equipped` maps slot -> item id, e.g. `{ hand, shield }` for a
 * sword-and-board character or `{ mainHand, offHand }` for a dual wielder.
 * Absent slots are skipped, so an unarmed actor costs nothing.
 *
 * ------------------------------------------------------- on dual wielding
 *
 * `handBehind` splits the body: an item is either behind ALL of the actor or in
 * front of ALL of it. That is enough for one weapon, and not enough for two.
 * Through a spin the off-hand blade has to cross in front of the main-hand
 * blade and then back behind it, and both are in front of the body the whole
 * time — so the ordering has to exist WITHIN a pass, not just between passes.
 *
 * Hence `slotOrder`, authored per frame:
 *
 *   slotOrder: [['offHand','mainHand'],    // off-hand leads, drawn under
 *               ['mainHand','offHand'],    // they cross — order flips
 *               ['mainHand','offHand'],
 *               ['offHand','mainHand']]
 *
 * Later in the list = drawn later = on top. Anything the frame omits falls back
 * to the config order, so a frame only has to name the slots it wants to
 * reorder.
 */
export function drawActorEquipment(g, actor, cfg, pass) {
  const eq = actor.equipped;
  if (!eq) return;

  let order = cfg.slots || DEFAULT_SLOTS;

  const anim = cfg.animations && cfg.animations[actor.state];
  if (anim && Array.isArray(anim.slotOrder)) {
    const fps = anim.fps || 10;
    const n = anim.frames.length;
    let step = Math.floor((actor.animTime || 0) * fps);
    step = anim.loop === false ? Math.min(step, n - 1) : ((step % n) + n) % n;
    const perFrame = anim.slotOrder[step];
    if (Array.isArray(perFrame)) {
      // named slots first, in the frame's order, then whatever it left out
      order = perFrame.concat(order.filter(s => perFrame.indexOf(s) < 0));
    }
  }

  for (const slot of order) {
    if (eq[slot]) drawEquipped(g, actor, cfg, eq[slot], slot, pass);
  }
}
