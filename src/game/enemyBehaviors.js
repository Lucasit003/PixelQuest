// Enemy AI, one entry per archetype. The combat scene owns the world (physics,
// knockback, damage, drops); a behavior only decides how an enemy moves and when
// it commits to an attack. That split is what lets a new enemy be a data entry
// in ENEMIES rather than another branch inside combat.js.
//
// A behavior gets (e, c):
//   e   the live enemy — reads e.def for its stats, e.tuning for its knobs
//   c   this frame's context: dt, the player, the vector to them, and the two
//       actions the scene owns (c.tryMelee, c.shoot)
//
// `defaults` are the archetype's feel constants. Any of them can be overridden
// per enemy by putting a field of the same name in its ENEMIES entry, so tuning
// one slime to hop further never touches this file.
//
// BOSSES DO NOT USE THIS. The Goblin King runs a scripted controller in
// combat.js (_updateBoss) because its phases, summons and slam/sweep choice are
// bespoke set-piece logic, not a reusable archetype. That boundary is
// deliberate: generic enemies are data, bosses are code.

export const ENEMY_BEHAVIORS = {
  // Walks straight at the player and swings once in reach. Goblins, skeletons.
  chase: {
    requires: ['speed', 'reach', 'attack', 'attackCd'],
    defaults: { depthArc: 14, depthChase: 0.55, windup: 0.18 },
    update(e, c) {
      const t = e.tuning;
      const spd = e.def.speed;
      if (c.dist > e.def.reach || Math.abs(c.ddepth) > t.depthArc) {
        e.x += e.facing * spd * c.dt;
        e.depth += Math.sign(c.ddepth) * Math.min(Math.abs(c.ddepth), spd * t.depthChase * c.dt);
        e.depth = c.clampDepth(e.depth);
        e.state = 'walk';
      } else {
        c.tryMelee(e);
      }
    },
  },

  // Shuffles forward, then lunges in an arc once its cooldown is up. Slimes.
  hop: {
    requires: ['speed', 'reach', 'attack', 'attackCd'],
    defaults: { depthArc: 16, depthChase: 0.5, hopRange: 60, hopPower: 90, hopLunge: 80, windup: 0.18 },
    update(e, c) {
      const t = e.tuning;
      const spd = e.def.speed;
      if (e.z === 0 && e.attackTimer <= 0 && c.dist < t.hopRange) {
        e.vz = t.hopPower; e.z = 1; e.knockVx = e.facing * t.hopLunge; e.state = 'jump';
        e.attackTimer = e.def.attackCd; e.animTime = 0;
      } else if (e.z === 0) {
        if (c.dist > e.def.reach) {
          e.x += e.facing * spd * c.dt;
          e.depth += Math.sign(c.ddepth) * spd * t.depthChase * c.dt;
          e.state = 'walk';
        } else {
          e.state = 'idle';
        }
      }
      // A slime can still connect mid-hop, so this is checked every frame.
      if (c.dist < e.def.reach && Math.abs(c.ddepth) < t.depthArc) c.tryMelee(e);
    },
  },

  // Backs off when crowded, closes when too far, and shoots from the gap it
  // keeps. Bone Archers.
  ranged: {
    requires: ['speed', 'attack', 'attackCd', 'projSpeed'],
    defaults: {
      keepMin: 90, keepMax: 150, approachRate: 0.6, depthChase: 0.4,
      fireArc: 30, projLife: 2.5, projColor: '#d9d2c0', projRadius: 3,
    },
    update(e, c) {
      const t = e.tuning;
      const spd = e.def.speed;
      // A shot in progress: the projectile leaves on the release beat of the
      // attack animation (def.shootDelay), not the moment it starts.
      if (e._loose !== undefined) {
        e._loose -= c.dt;
        if (e._loose <= 0) { c.shoot(e); e._loose = undefined; }
      }
      e.attackAnimT = Math.max(0, (e.attackAnimT || 0) - c.dt);
      if (e.attackAnimT > 0) { e.state = 'attack'; return; } // planted mid-draw

      if (c.dist < t.keepMin) { e.x -= e.facing * spd * c.dt; e.state = 'walk'; }
      else if (c.dist > t.keepMax) { e.x += e.facing * spd * t.approachRate * c.dt; e.state = 'walk'; }
      else e.state = 'idle';

      e.depth += Math.sign(c.ddepth) * Math.min(Math.abs(c.ddepth), spd * t.depthChase * c.dt);

      if (e.attackTimer <= 0 && Math.abs(c.ddepth) < t.fireArc) {
        e.attackTimer = e.def.attackCd;
        e.state = 'attack'; e.animTime = 0;
        e.attackAnimT = e.def.attackAnim ?? 0;
        if (e.def.shootDelay) e._loose = e.def.shootDelay;
        else c.shoot(e);
      }
    },
  },
};

export const BEHAVIOR_IDS = Object.keys(ENEMY_BEHAVIORS);

// Resolved once when an enemy spawns, so a bad `behavior` fails loudly at spawn
// with the name of the offending enemy rather than silently doing nothing on
// every frame of the fight.
export function resolveBehavior(def, type = def && def.name) {
  const behavior = ENEMY_BEHAVIORS[def.behavior];
  if (!behavior) {
    throw new Error(
      `enemy "${type}" has unknown behavior "${def.behavior}" — expected one of: ${BEHAVIOR_IDS.join(', ')}`,
    );
  }
  for (const field of behavior.requires) {
    if (def[field] === undefined) {
      throw new Error(`enemy "${type}" uses behavior "${def.behavior}" but is missing "${field}"`);
    }
  }
  return behavior;
}

// Archetype defaults with any per-enemy override applied. Only keys the behavior
// actually declares are read, so an unrelated field in ENEMIES can never leak in.
export function tuningFor(def) {
  const behavior = ENEMY_BEHAVIORS[def.behavior];
  if (!behavior) return {};
  const out = { ...behavior.defaults };
  for (const key of Object.keys(behavior.defaults)) {
    if (def[key] !== undefined) out[key] = def[key];
  }
  return out;
}
