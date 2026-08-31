// The bowstring and the shot origin. Computed, never baked.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//
//     A bowstring belongs to the DRAW, not to the BOW.
//
// This is the same argument weaponTrail.js makes about swing streaks, and it
// bites harder here. A string baked into a bow sprite is drawn to one fixed
// depth: correct on exactly one frame of the shot and wrong on the other three.
// It would be wrong again the moment a second bow, a heavier draw, or a
// half-drawn "hold" pose appeared.
//
// So the bow sprite carries NO string at all. It carries two limb tips, and the
// string is stroked from the upper tip, through wherever the Ranger's drawing
// hand actually is this frame, to the lower tip. That gives, for free:
//
//   * a string that bends by exactly as much as he has drawn it, on every
//     frame, including partial draws and holds nobody authored;
//   * a longer bow that flexes further, because its limbs are further apart;
//   * the shot origin, which is that same nock point — so the arrow always
//     leaves from where the string actually is, not from a guessed offset.
//
// Nothing here is required for an actor to render. A bow with no limb points
// declared simply draws no string.

import { attachmentAnchor } from './sprites.js';
import { equipmentConfig, itemPointToWorld } from './equipment.js';

// The slot the bow itself is held in, and the slot whose anchor is the nock.
// Named rather than hardcoded because a crossbow holds both in one hand.
const BOW_SLOT = 'mainHand';
const NOCK_SLOT = 'nock';

/**
 * Where the arrow sits on the string this frame, in world coordinates.
 *
 * Prefers an explicit `nock` anchor when the animation authors one, because the
 * fingers hook the string slightly ahead of the fist and on a full draw that
 * difference is visible. Falls back to the drawing hand, which is right within
 * a pixel or two and means an animation can skip authoring `nock` entirely.
 */
export function nockPoint(cfg, actor) {
  return attachmentAnchor(cfg, actor, NOCK_SLOT)
      || attachmentAnchor(cfg, actor, 'offHand');
}

/**
 * The two limb tips of the equipped bow, in world coordinates.
 *
 * Returns null when there is no bow, no limb points on it, or no hand anchor
 * this frame — all three of which are ordinary states, not errors.
 */
export function limbPoints(cfg, actor, slot = BOW_SLOT) {
  const eq = actor.equipped;
  if (!eq || !eq[slot]) return null;
  const item = equipmentConfig(eq[slot]);
  if (!item || !item.limbTop || !item.limbBottom) return null;
  const top = itemPointToWorld(cfg, actor, slot, item.limbTop);
  const bottom = itemPointToWorld(cfg, actor, slot, item.limbBottom);
  if (!top || !bottom) return null;
  return { top, bottom };
}

/**
 * Where a loosed arrow starts, and which way it is pointing.
 *
 * This is the projectile origin the combat layer wants. It is deliberately the
 * NOCK and not the bow's grip: an arrow that spawns at the fist appears to pass
 * through the riser, and at 28px that reads as the arrow starting behind the
 * character.
 *
 * The direction is taken from the string's own geometry — the perpendicular to
 * the limb line, pointing away from the nock — so it stays correct when the
 * Ranger aims up or down without anyone authoring a separate aim angle.
 */
export function shotOrigin(cfg, actor) {
  const nock = nockPoint(cfg, actor);
  if (!nock) return null;
  const limbs = limbPoints(cfg, actor);
  if (!limbs) return { x: nock.x, y: nock.y, angle: nock.angle || 0 };

  // midpoint of the limb line: the string's rest position
  const mx = (limbs.top.x + limbs.bottom.x) / 2;
  const my = (limbs.top.y + limbs.bottom.y) / 2;
  // the arrow flies from the nock through that midpoint and out the front
  const dx = mx - nock.x, dy = my - nock.y;
  if (dx === 0 && dy === 0) return { x: nock.x, y: nock.y, angle: nock.angle || 0 };
  return { x: nock.x, y: nock.y, angle: Math.atan2(dy, dx) * 180 / Math.PI };
}

/**
 * Draw the bowstring for the current frame.
 *
 * Called AFTER the body and the bow: the string passes in front of the riser
 * and in front of the drawing hand, which is what makes the hand read as
 * gripping it rather than floating beside it.
 *
 * `style` lets a bow tier change the look without touching the geometry:
 *   { color: '#e8e4dc', width: 1, alpha: 0.9 }
 */
export function drawBowString(g, cfg, actor, style = {}) {
  const limbs = limbPoints(cfg, actor);
  if (!limbs) return false;
  const nock = nockPoint(cfg, actor);
  if (!nock) return false;

  const scale = (cfg.scale || 1) * (actor.scale || 1);

  g.save();
  if (actor.alpha !== undefined && actor.alpha < 1) g.globalAlpha = actor.alpha;
  g.globalAlpha = (g.globalAlpha || 1) * (style.alpha === undefined ? 0.9 : style.alpha);
  g.imageSmoothingEnabled = false;
  g.strokeStyle = style.color || '#efe9d8';
  g.lineWidth = Math.max(1, (style.width || 1) * scale);
  g.lineCap = 'butt';
  g.lineJoin = 'miter';

  g.beginPath();
  g.moveTo(Math.round(limbs.top.x), Math.round(limbs.top.y));
  g.lineTo(Math.round(nock.x), Math.round(nock.y));
  g.lineTo(Math.round(limbs.bottom.x), Math.round(limbs.bottom.y));
  g.stroke();

  g.restore();
  return true;
}
