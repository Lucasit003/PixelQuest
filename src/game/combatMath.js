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

// Light swings ramp up through the combo; a heavy is one flat, bigger hit.
export function meleeBaseDamage(attack, { heavy = false, comboStep = 0, rageMult = 1 } = {}) {
  const base = heavy ? attack * 1.7 : attack * (0.7 + comboStep * 0.18);
  return base * rageMult;
}

// Knockback grows with the combo, but a heavy always launches hardest.
export function meleeKnockback({ heavy = false, comboStep = 0 } = {}) {
  return heavy ? 150 : 60 + comboStep * 12;
}

// `variance` is the per-hit random spread the scene rolls (around 0.9..1.1).
export function finalHitDamage(base, { crit = false, variance = 1 } = {}) {
  return Math.round(base * (crit ? CRIT_MULT : 1) * variance);
}

// `power` is the hero's magic, or attack for the martial classes.
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
