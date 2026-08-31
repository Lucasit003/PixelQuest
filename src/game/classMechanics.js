// The seven class signature mechanics, as pure arithmetic.
//
// Same contract as combatMath.js: no game state, no rendering, no RNG. The
// scene owns the timers and the entities; this file only answers "given these
// numbers, what should happen". That keeps every mechanic testable without an
// arena, and keeps combat.js free of class-specific branching beyond a few
// small hooks.
//
// Nothing here is a generic "passive framework". Each class stores one number
// (or one status field on an enemy) using state the combat loop already ticks.

// ============================================================ WARRIOR: Momentum
// Landing hits builds Momentum; stopping loses it. Spenders convert it into a
// single large payoff rather than a passive damage bonus, so the class rewards
// staying on the offensive instead of buffing and waiting.

export const MOMENTUM_MAX = 5;
/** Seconds without landing a hit before Momentum drains away. */
export const MOMENTUM_DECAY = 2.5;
/** Fraction of a spender's damage added per stack consumed. */
export const MOMENTUM_PER_STACK = 0.25;
/** Earthshatter is the finisher, so each stack is worth more to it. */
export const MOMENTUM_FINISHER_PER_STACK = 0.4;

/** A light combo hit is worth one stack; a committed heavy is worth two. */
export function momentumGain({ heavy = false } = {}) {
  return heavy ? 2 : 1;
}

export function addMomentum(current, gain, max = MOMENTUM_MAX) {
  return Math.min(max, (current || 0) + gain);
}

/** The multiplier a spender gets for the stacks it is about to consume. */
export function momentumMultiplier(stacks, perStack = MOMENTUM_PER_STACK) {
  return 1 + Math.max(0, Math.min(MOMENTUM_MAX, stacks || 0)) * perStack;
}

// ============================================================== MAGE: Arcane Flow
// Cheap spells charge expensive ones. Flow is deliberately small and capped so
// the loop is "dart, dart, dart, big spell" rather than a resource to hoard.

export const FLOW_MAX = 3;
/** Fraction of the spender's damage added per Flow charge. */
export const FLOW_PER_STACK = 0.3;
/** Flow drains if the Mage stops casting entirely. */
export const FLOW_DECAY = 6;

export function addFlow(current, gain = 1, max = FLOW_MAX) {
  return Math.min(max, (current || 0) + gain);
}

export function flowMultiplier(stacks) {
  return 1 + Math.max(0, Math.min(FLOW_MAX, stacks || 0)) * FLOW_PER_STACK;
}

// ================================================================ ROGUE: Exposure
// Backstab opens a target up; Assassinate closes it. Exposure raises the crit
// chance the Rogue already has rather than introducing a second damage stat —
// the class's 16% base crit finally does something the others' does not.

export const EXPOSED_DUR = 5;
/** Percentage points of crit chance added against an exposed target. */
export const EXPOSED_CRIT_BONUS = 0.35;
/** Assassinate's multiplier when it consumes Exposure. */
export const EXPOSED_EXECUTE_MULT = 1.8;

export function critChanceAgainst(baseCrit, { exposed = false } = {}) {
  return Math.min(1, (baseCrit || 0) + (exposed ? EXPOSED_CRIT_BONUS : 0));
}

export function exposureMultiplier(exposed) {
  return exposed ? EXPOSED_EXECUTE_MULT : 1;
}

/**
 * Damage-over-time tick. Returns the damage to deal this frame and the
 * remaining state; the caller applies it through the normal damage path so
 * poison shares armour, toasts and death handling with everything else.
 */
export function poisonTick(poison, dt) {
  if (!poison || poison.t <= 0) return { damage: 0, left: null };
  const step = Math.min(dt, poison.t);
  const left = poison.t - step;
  return { damage: poison.dps * step, left: left > 0 ? { ...poison, t: left } : null };
}

// ================================================================= RANGER: Mark
// A mark is a debuff on a target, not a buff on the Ranger. Only the precision
// abilities cash it in, which is what makes marking a decision rather than
// something to keep up permanently.

export const MARK_DUR = 8;
/** Extra damage precision abilities do to a marked target. */
export const MARK_BONUS = 0.5;

export function markMultiplier(marked, { precision = false } = {}) {
  return marked && precision ? 1 + MARK_BONUS : 1;
}

// ========================================================= PALADIN: Divine Guard
// Damage the Paladin's shield eats is banked, then spent as holy damage. The
// class's defence stops being a way to survive a mistake and becomes the thing
// that pays for its offence.

/** Most damage that can be banked at once. */
export const GUARD_MAX = 120;
/** Share of the banked pool added to a holy payoff. */
export const GUARD_CONVERSION = 0.8;

export function bankGuard(current, absorbed, max = GUARD_MAX) {
  return Math.min(max, (current || 0) + Math.max(0, absorbed || 0));
}

/** What a payoff gains from the bank, and what is left afterwards. */
export function spendGuard(pool, { share = 1 } = {}) {
  const used = Math.max(0, pool || 0) * share;
  return { bonus: used * GUARD_CONVERSION, left: (pool || 0) - used };
}

// ============================================================== BERSERKER: Rage
// Power from missing health. Capped hard, and measured from the Berserker's own
// health fraction so it cannot be farmed by stacking maximum HP.

/** Rage is worth nothing at full health and most at the floor. */
export const RAGE_MAX_BONUS = 0.8;
/** Below this fraction Rage stops growing, so there is no reward for 1 HP. */
export const RAGE_FLOOR = 0.2;

export function rageMultiplier(hpFraction) {
  const frac = Math.max(0, Math.min(1, hpFraction ?? 1));
  const missing = 1 - Math.max(RAGE_FLOOR, frac);
  const span = 1 - RAGE_FLOOR;
  return 1 + RAGE_MAX_BONUS * (missing / span);
}

/** Health a self-damaging ability may not take you below. */
export const SELF_DAMAGE_FLOOR = 0.2;

export function selfDamageAllowed(hp, maxHp, cost) {
  const floor = maxHp * SELF_DAMAGE_FLOOR;
  if (hp - cost < floor) return Math.max(0, hp - floor);
  return cost;
}

/** Execute hits far harder once a target is nearly down. */
export const EXECUTE_THRESHOLD = 0.3;
export const EXECUTE_MULT = 2.0;

export function executeMultiplier(targetHpFraction) {
  return (targetHpFraction ?? 1) <= EXECUTE_THRESHOLD ? EXECUTE_MULT : 1;
}

// ========================================================= SUMMONER: Totem control
// Placed entities with a lifetime and a pulse timer. Deliberately stationary:
// this gives the class space control without pet pathfinding.

/** More than this and the field turns into a wall of totems. */
export const TOTEM_LIMIT = 2;

export function makeTotem(kind, x, depth, { life, pulse = 0, radius = 0, power = 0 }) {
  return { kind, x, depth, life, maxLife: life, pulse, pulseT: pulse, radius, power };
}

/**
 * Advance a totem. Returns whether it should fire this frame and whether it
 * has expired, leaving the caller to apply damage through the normal path.
 */
export function totemTick(totem, dt) {
  const life = totem.life - dt;
  let fired = false;
  let pulseT = totem.pulseT;
  if (totem.pulse > 0) {
    pulseT -= dt;
    if (pulseT <= 0 && life > 0) { fired = true; pulseT += totem.pulse; }
  }
  return { life, pulseT, fired, expired: life <= 0 };
}

/** Totems are placed, not spawned on top of you — put it out in front. */
export function totemPlacement(x, depth, facing, distance = 46) {
  return { x: x + facing * distance, depth };
}
