// The arithmetic behind a hit. Pulled out of scenes/combat.js so the numbers can
// be reasoned about — and regression-tested — without an arena, a canvas or a
// frame loop. Every function here is pure: no game state, no rendering, no RNG.
// Randomness (crit rolls, damage variance) stays in the scene and is passed in.

// A crit multiplies the swing that landed it.
export const CRIT_MULT = 1.8;

// How much of the hero's power an ability adds on top of its flat `dmg`, by
// ability kind. Melee abilities scale hardest because they demand you close in;
// area and chain hits scale least because they hit several targets at once.
export const ABILITY_POWER_SCALE = {
  melee: 0.7,
  projectile: 0.6,
  aoe: 0.5,
  chain: 0.5,
};

// Each successive target in a chain takes less than the last.
export const CHAIN_FALLOFF = 0.8;

// How far a chain may jump from one target to the NEXT. Separate from the
// ability's own `range`, which gates how far the first target can be from the
// caster. Without this a "chain" is just "the N nearest enemies to you".
export const CHAIN_HOP_RANGE = 90;

// What the opening light swing is worth, as a fraction of the attack stat. The
// authored combo array scales every later step relative to its own first entry,
// so this constant alone sets where a combo starts.
export const COMBO_OPENER = 0.88;

/**
 * Light swings ramp up through the combo; a heavy is one flat, bigger hit.
 *
 * `combo` is the class's authored per-step curve (CLASSES[x].combo). Those
 * numbers were written as the shape of each class's combo — a Berserker
 * finishing on 32 against an opener of 18 — but nothing read them, so every
 * class ramped identically. They are used as RATIOS against the array's own
 * first entry, not as raw damage: that keeps them independent of the attack
 * stat and leaves the opener exactly where it has always been.
 *
 * Omitting `combo` falls back to the old flat ramp, so callers that do not know
 * the class (and the existing tests) behave unchanged.
 */
export function meleeBaseDamage(attack, { heavy = false, comboStep = 0, combo = null, rageMult = 1 } = {}) {
  let base;
  if (heavy) {
    base = attack * 1.7;
  } else if (Array.isArray(combo) && combo.length && combo[0] > 0) {
    const step = clampStep(comboStep, combo.length);
    base = attack * COMBO_OPENER * (combo[step - 1] / combo[0]);
  } else {
    base = attack * (0.7 + comboStep * 0.18);
  }
  return base * rageMult;
}

function clampStep(step, len) {
  if (!(step >= 1)) return 1;
  return Math.min(Math.round(step), len);
}

/**
 * The hero stat an ability draws its power from.
 *
 * Previously the scene read `hero.magic || hero.attack`, and since no class has
 * zero magic the `attack` half was unreachable — a Berserker with 4 magic and 27
 * attack scaled every ability off the 4.
 *
 * `ability.scaling` states it explicitly:
 *    'attack'                     a martial ability
 *    'magic'                      a spell
 *    { attack: 0.5, magic: 0.5 }  a hybrid, weights need not sum to 1
 *
 * Defaults to magic when unstated so an ability added without the field behaves
 * as it did before rather than silently reading 0.
 */
export function abilityPower(stats, ability = {}) {
  const scaling = ability.scaling || 'magic';
  if (typeof scaling === 'string') return stats[scaling] || 0;
  let total = 0;
  for (const stat of Object.keys(scaling)) total += (stats[stat] || 0) * scaling[stat];
  return total;
}

/**
 * The ordered targets of a chain: nearest to the caster first, then each
 * successive hop from the PREVIOUS target rather than from the caster.
 *
 * `range` gates the first target's distance from the caster; `hopRange` gates
 * every jump after it. Both are needed — without the hop limit a chain crosses
 * the whole arena, which is what it used to do.
 *
 * Pure: takes plain points, returns a subset of `enemies` in strike order.
 */
export function chainTargets(origin, enemies, { chains = 1, range = Infinity, hopRange = CHAIN_HOP_RANGE } = {}) {
  const pool = enemies.filter((e) => e && e.hp > 0);
  const picked = [];
  let from = origin;
  let reach = range;
  while (picked.length < chains) {
    let best = null;
    let bestDist = Infinity;
    for (const e of pool) {
      if (picked.includes(e)) continue;
      const d = Math.hypot(e.x - from.x, e.depth - from.depth);
      if (d > reach || d >= bestDist) continue;
      best = e; bestDist = d;
    }
    if (!best) break;          // nothing else in reach: the chain simply stops
    picked.push(best);
    from = best;
    reach = hopRange;
  }
  return picked;
}

// Knockback grows with the combo, but a heavy always launches hardest.
export function meleeKnockback({ heavy = false, comboStep = 0 } = {}) {
  return heavy ? 150 : 60 + comboStep * 12;
}

// `variance` is the per-hit random spread the scene rolls (around 0.9..1.1).
export function finalHitDamage(base, { crit = false, variance = 1 } = {}) {
  return Math.round(base * (crit ? CRIT_MULT : 1) * variance);
}

// `power` comes from abilityPower(), which resolves the ability's own scaling
// stat rather than assuming magic.
export function abilityBaseDamage(ab, power, { fireBonus = 0 } = {}) {
  const scale = ABILITY_POWER_SCALE[ab.kind] ?? 0;
  let dmg = (ab.dmg || 0) + power * scale;
  if (ab.element === 'fire') dmg *= 1 + fireBonus;
  return dmg;
}

// Enemy armour subtracts flat, but a hit always registers for at least 1.
export function enemyDamageAfterDefense(dmg, defense = 0) {
  return Math.max(1, dmg - (defense || 0));
}

// Incoming damage: hero defense removes half its value, Iron Skin halves what's
// left. The floor is applied before the buff, so a brew can round a scratch down
// but never to nothing.
export function playerDamageAfterDefense(amount, defense = 0, { defenseBuff = false } = {}) {
  let dmg = Math.max(1, amount - defense * 0.5);
  if (defenseBuff) dmg *= 0.5;
  return Math.round(dmg);
}

// Arcane/Divine Shield eats damage before defense is considered.
export function absorbWithShield(shieldHp, amount) {
  const absorbed = Math.min(shieldHp, amount);
  return { absorbed, shieldLeft: shieldHp - absorbed, remaining: amount - absorbed };
}

// Phases are listed from full health downward; the last one whose threshold the
// boss has fallen to is the one it's in.
export function bossPhaseIndex(phases, hpFraction) {
  let idx = 0;
  for (let i = 0; i < phases.length; i++) if (hpFraction <= phases[i].at) idx = i;
  return idx;
}
