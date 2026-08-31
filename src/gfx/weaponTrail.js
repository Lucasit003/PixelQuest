// The swing trail. A VFX layer, deliberately NOT part of any weapon sprite.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//
//     A trail belongs to the SWING, not to the WEAPON.
//
// Baking a motion streak into a hammer sprite would mean the streak is present
// on every frame the hammer is drawn — while it hangs at the Paladin's side, in
// the shop, on the inventory icon. It would also mean a second hammer needs a
// second hand-drawn streak, and a legendary one needs a third.
//
// So the trail is COMPUTED from where the weapon's business end actually was on
// the previous frames. That has three consequences worth having:
//
//   * a longer weapon automatically throws a longer arc, because its tip
//     travels further, with no extra authoring;
//   * the arc always matches the animation, because it IS the animation;
//   * a plain iron hammer can throw a dull grey streak and a blessed one can
//     throw gold, from the same body frames and the same trail code.
//
// Nothing here is required for an actor to render. A weapon with no `tip`
// declared simply throws no trail.

import { attachmentAnchor } from './sprites.js';
import { equipmentConfig } from './equipment.js';

// ------------------------------------------------------------- tip tracking
//
// `tip` on an equipment config is the point on the ITEM IMAGE that leads the
// swing — the centre of a hammer head, the point of a sword. Same coordinate
// space as `grip`, so both are read straight off the sprite.

/**
 * Where the weapon's tip sits in world space on a given animation step.
 *
 * Mirrors the transform equipment.js uses to draw the item, so the trail can
 * never drift away from where the weapon actually is: translate to the hand,
 * mirror for facing, rotate about the GRIP, then measure the tip's offset from
 * that grip.
 */
export function tipAt(cfg, actor, step, slot = 'hand') {
  const eq = actor.equipped;
  if (!eq || !eq[slot]) return null;
  const item = equipmentConfig(eq[slot]);
  if (!item || !item.tip) return null;

  const anim = cfg.animations[actor.state];
  if (!anim) return null;
  const fps = anim.fps || 10;
  const probe = { ...actor, animTime: step / fps };
  const anchor = attachmentAnchor(cfg, probe, slot);
  if (!anchor) return null;

  // tip relative to the grip, in item pixels
  const dx = item.tip[0] - item.grip[0];
  const dy = item.tip[1] - item.grip[1];

  const deg = (anchor.angle || 0) + (item.angle || 0);
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  let rx = dx * cos - dy * sin;
  let ry = dx * sin + dy * cos;

  const s = anchor.scale === undefined ? 1 : anchor.scale;
  rx *= s; ry *= s;
  if (anchor.flip) rx = -rx;
  if (anchor.facing < 0) rx = -rx;

  return { x: anchor.x + rx, y: anchor.y + ry };
}

/**
 * The arc the tip swept over the `span` steps ending at `step`.
 *
 * Sampled BETWEEN frames, not just at them. A heavy swing turns the wrist
 * 90 degrees or more per frame, so joining the four frame positions directly
 * draws the chords of the arc — a flat polygon that reads as a thrown plank
 * rather than a swing. Interpolating the anchor and the angle and recomputing
 * the tip at each sub-step traces the curve the head actually travels.
 */
export function tipArc(cfg, actor, step, span = 3, sub = 4) {
  const anim = cfg.animations[actor.state];
  if (!anim) return [];
  const eq = actor.equipped;
  if (!eq || !eq.hand) return [];
  const item = equipmentConfig(eq.hand);
  if (!item || !item.tip) return [];

  const from = Math.max(0, step - span);
  const pts = [];
  for (let s = from; s <= step; s++) {
    const steps = (s === from) ? 1 : sub;
    for (let k = (s === from ? 0 : 1); k <= steps; k++) {
      const t = s - 1 + k / steps;          // fractional step
      const p = tipAtFraction(cfg, actor, Math.max(from, t), item);
      if (p) pts.push(p);
    }
  }
  return pts;
}

/**
 * Tip position at a FRACTIONAL step, by lerping the authored anchor and angle
 * either side of it. Falls back to the whole-step path when there is nothing
 * to interpolate between.
 */
function tipAtFraction(cfg, actor, t, item) {
  const anim = cfg.animations[actor.state];
  const n = anim.frames.length;
  const a = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const b = Math.max(0, Math.min(n - 1, a + 1));
  const f = t - a;

  const hands = anim.hand;
  const angles = anim.handAngle;
  if (!Array.isArray(hands) || !Array.isArray(hands[a])) {
    return tipAt(cfg, actor, Math.round(t), 'hand');
  }

  const pa = hands[a];
  const pb = Array.isArray(hands[b]) ? hands[b] : pa;
  const hx = pa[0] + (pb[0] - pa[0]) * f;
  const hy = pa[1] + (pb[1] - pa[1]) * f;

  let ang = 0;
  if (Array.isArray(angles) && Number.isFinite(angles[a])) {
    const aa = angles[a];
    const ab = Number.isFinite(angles[b]) ? angles[b] : aa;
    ang = aa + (ab - aa) * f;
  }

  // Same transform equipment.js draws with, at this fractional pose.
  const anchorCfg = anchorOfCfg(cfg);
  const scale = (cfg.scale || 1) * (actor.scale || 1);
  const mirrored = actor.facing < 0;
  const offset = hx - anchorCfg.x;
  const localX = mirrored ? -offset - 1 : offset;
  const localY = hy - anchorCfg.y;
  const wx = actor.x + localX * scale;
  const wy = actor.y - (actor.z || 0) + localY * scale;

  const deg = (mirrored ? -ang : ang) + (item.angle || 0);
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = item.tip[0] - item.grip[0];
  const dy = item.tip[1] - item.grip[1];
  let rx = (dx * cos - dy * sin) * scale;
  const ry = (dx * sin + dy * cos) * scale;
  if (mirrored) rx = -rx;

  return { x: wx + rx, y: wy + ry };
}

function anchorOfCfg(cfg) {
  return {
    x: cfg.anchorX === undefined ? cfg.frameWidth / 2 : cfg.anchorX,
    y: cfg.anchorY === undefined ? cfg.frameHeight : cfg.anchorY,
  };
}

// ------------------------------------------------------------------ drawing

/**
 * Draw the swing trail for the current frame.
 *
 * Called BEFORE the body and the equipment, so the streak sits behind the
 * Paladin rather than painting over his helmet — a trail in front reads as a
 * scratch on the screen instead of as speed.
 *
 * `style` lets a weapon tier change the look without touching the geometry:
 *   { colors: ['#e8e4dc', '#9aa2b4'], width: 5, alpha: 0.5 }
 */
export function drawSwingTrail(g, cfg, actor, step, style = {}) {
  const anim = cfg.animations[actor.state];
  if (!anim || !anim.trail) return false;

  // `trail` is authored per frame: 0 = no streak, 1 = full. The wind-up gets
  // nothing, the impact frame gets the most. Without that the trail would be
  // constant and the strike would lose its accent.
  const strength = Array.isArray(anim.trail) ? (anim.trail[step] || 0) : 0;
  if (strength <= 0) return false;

  const pts = tipArc(cfg, actor, step, style.span || 3);
  if (pts.length < 2) return false;

  const colors = style.colors || ['#f2efe6', '#98a0b2'];
  const width = (style.width || 5) * (actor.scale || 1);
  // Restrained on purpose. A trail is an accent on the strike, not a second
  // character on screen — pushed opaque it stops reading as speed and starts
  // reading as a grey slab bolted to the hammer.
  const alpha = (style.alpha === undefined ? 0.30 : style.alpha) * strength;

  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = false;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Two passes: a wide cool underlay and a narrow bright core. One flat stroke
  // reads as a drawn line; two read as motion.
  //
  // Drawn segment by segment so the tail can FADE and TAPER toward the oldest
  // sample. A trail of constant weight looks like a rigid ribbon welded to the
  // head; the fade is what makes the near end read as "now" and the far end as
  // "a moment ago".
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = colors[pass === 0 ? 1 : 0];
    const base = pass === 0 ? width : Math.max(1, width * 0.42);
    for (let i = 1; i < pts.length; i++) {
      const t = i / (pts.length - 1);        // 0 = oldest, 1 = newest
      g.globalAlpha = alpha * (pass === 0 ? 0.7 : 1) * (0.15 + 0.85 * t);
      g.lineWidth = Math.max(1, base * (0.35 + 0.65 * t));
      g.beginPath();
      g.moveTo(Math.round(pts[i - 1].x), Math.round(pts[i - 1].y));
      g.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
      g.stroke();
    }
  }

  g.restore();
  return true;
}
