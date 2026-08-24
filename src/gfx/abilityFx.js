// What an ability LOOKS like when it goes off.
//
// The cast functions in combat.js used to hardcode their own colours, so every
// non-ice AoE in the game drew the same yellow ring and every chain drew
// lightning — a Ranger's Thornvine and a Mage's Chain Lightning were pixel
// identical, and a Warrior's Earthshatter looked like a Paladin's Wrath of Dawn.
//
// Identity is resolved in three layers, most specific winning:
//
//   1. ability.vfx      an explicit override on the ability itself
//   2. ELEMENT_FX       fire / ice / storm / holy / poison / nature palettes
//   3. CLASS_FX         the class's own look — this is what makes a Warrior's
//                       abilities read as steel and a Summoner's as spirits
//
// A `shape` picks the composition; the palette is separate, so Frost Nova and
// Static Field can share the nova shape while staying obviously different.

// ------------------------------------------------------------- class identity
// color is the bright core, color2 the darker trailing tone. The per-kind shape
// is the class's default for that kind of ability.
export const CLASS_FX = {
  warrior:   { color: '#dfe6f2', color2: '#8fa3bd', weight: 1.0,
               projectile: 'slash', melee: 'slash',  aoe: 'shockwave', chain: 'lightning', buff: 'steel' },
  berserker: { color: '#ff9a5c', color2: '#c23b3b', weight: 1.3,
               projectile: 'cleave', melee: 'cleave', aoe: 'shockwave', chain: 'lightning', buff: 'rage' },
  paladin:   { color: '#ffe9a8', color2: '#f2c94f', weight: 1.1,
               projectile: 'holy', melee: 'holy',   aoe: 'holy',      chain: 'holy',      buff: 'holy' },
  rogue:     { color: '#c9b8ff', color2: '#6f57d8', weight: 0.7,
               projectile: 'thrust', melee: 'thrust', aoe: 'gas',       chain: 'lightning', buff: 'shadow' },
  ranger:    { color: '#b8e8a8', color2: '#4f9a45', weight: 0.8,
               projectile: 'arrow', melee: 'slash',  aoe: 'volley',    chain: 'vine',      buff: 'nature' },
  mage:      { color: '#c2b2ff', color2: '#6f57d8', weight: 0.9,
               projectile: 'bolt', melee: 'arcane', aoe: 'nova',      chain: 'lightning', buff: 'arcane' },
  summoner:  { color: '#a8f0e0', color2: '#3fd9c9', weight: 0.9,
               projectile: 'wisp', melee: 'spirit', aoe: 'spirits',   chain: 'chorus',    buff: 'spirit' },
};

// Elements override the palette but keep the class's shape, so a Mage's ice
// spell still casts like a Mage — it is just cold.
export const ELEMENT_FX = {
  fire:   { color: '#ffd76a', color2: '#f2601c' },
  ice:    { color: '#cfe9ff', color2: '#4f9fe0' },
  storm:  { color: '#fff2a0', color2: '#ffd000' },
  holy:   { color: '#fff4c2', color2: '#f2c94f' },
  poison: { color: '#b6f07a', color2: '#4c8a2a' },
  nature: { color: '#c2f0a8', color2: '#4f9a45' },
};

/** The resolved look for one ability cast by one class. */
export function resolveFx(ability, clsId) {
  const cls = CLASS_FX[clsId] || CLASS_FX.warrior;
  const el = ability.element ? ELEMENT_FX[ability.element] : null;
  const own = ability.vfx || {};
  return {
    color:  own.color  || (el && el.color)  || cls.color,
    color2: own.color2 || (el && el.color2) || cls.color2,
    shape:  own.shape  || cls[ability.kind] || 'slash',
    weight: own.weight != null ? own.weight : cls.weight,
  };
}

/**
 * Play one ability's effect. `fx` comes from resolveFx; `pt` is the scene's
 * Particles; `shake(n)` lets the caller decide how screen shake is applied.
 *
 * Every shape is built from the existing particle kinds — no new art is
 * required for any of this. Layering two or three emissions with different
 * colours and radii is what separates "a ring appeared" from "something hit".
 */
export function playAbilityFx(fx, pt, shake, x, y, facing = 1, range = 40) {
  const { color, color2, shape, weight } = fx;
  switch (shape) {
    // ---- melee ----------------------------------------------------------
    case 'slash':                                   // clean steel arc
      pt.slash(x + facing * 16, y - 12, facing, color);
      pt.slash(x + facing * 20, y - 9, facing, color2);
      pt.hitSpark(x + facing * 22, y - 12, facing, color, 12);
      pt.hitSpark(x + facing * 18, y - 16, facing, color2, 6);
      shake(3 * weight);
      break;
    case 'cleave':                                  // wide, heavy, three arcs
      for (let i = 0; i < 3; i++) pt.slash(x + facing * (12 + i * 7), y - 16 + i * 5, facing, i === 1 ? color : color2);
      pt.hitSpark(x + facing * 24, y - 12, facing, color, 18);
      pt.hitSpark(x + facing * 16, y - 18, facing, color2, 8);
      pt.dust(x + facing * 18, y, 9);
      pt.ember(x + facing * 20, y - 10, color2);
      shake(5 * weight);
      break;
    case 'thrust':                                  // tight, fast, precise
      pt.slash(x + facing * 20, y - 12, facing, color);
      pt.hitSpark(x + facing * 26, y - 12, facing, color, 20);
      pt.hitSpark(x + facing * 22, y - 12, facing, color2, 8);
      shake(2 * weight);
      break;
    case 'holy':                                    // gilded arc + rising motes
      pt.slash(x + facing * 16, y - 12, facing, color);
      pt.ring(x, y, color2, 22);
      pt.magicBurst(x + facing * 14, y - 14, color, 18);
      pt.levelStars(x + facing * 10, y - 18);
      shake(3 * weight);
      break;
    case 'arcane':
      pt.magicBurst(x + facing * 16, y - 12, color, 24);
      pt.slash(x + facing * 16, y - 12, facing, color2);
      shake(2 * weight);
      break;
    case 'spirit':
      pt.magicBurst(x + facing * 14, y - 14, color, 20);
      pt.ring(x, y, color2, 18);
      shake(2 * weight);
      break;

    case 'arrow':                                   // a bowstring, not a spell
      pt.hitSpark(x + facing * 18, y - 13, facing, color, 5);
      pt.dust(x, y, 2);
      shake(1.5 * weight);
      break;
    case 'bolt':                                    // elemental muzzle flash
      pt.magicBurst(x + facing * 14, y - 13, color, 10);
      pt.ring(x + facing * 14, y - 13, color2, 10);
      shake(2 * weight);
      break;
    case 'wisp':                                    // soft, slow, drifting
      pt.magicBurst(x + facing * 13, y - 14, color, 7);
      shake(1 * weight);
      break;

    // ---- area ------------------------------------------------------------
    case 'shockwave':                               // the ground itself moves
      pt.ring(x, y, color, range);
      pt.ring(x, y, color2, range * 0.62);
      pt.ring(x, y, color, range * 0.32);
      pt.dust(x, y, 22);
      pt.hitSpark(x, y - 6, 1, color, 10);
      shake(6 * weight);
      break;
    case 'nova':
      pt.ring(x, y, color, range);
      pt.magicBurst(x, y - 8, color, 34);
      pt.ring(x, y, color2, range * 0.5);
      pt.magicBurst(x, y - 16, color2, 16);
      shake(4 * weight);
      break;
    case 'gas':                                     // slow, low, creeping
      pt.ring(x, y, color2, range);
      pt.magicBurst(x, y - 4, color, 26);
      pt.magicBurst(x, y - 10, color2, 20);
      pt.magicBurst(x, y - 16, color, 12);
      shake(2 * weight);
      break;
    case 'volley':                                  // arrows raining down
      for (let i = 0; i < 8; i++) pt.hitSpark(x + (i - 3.5) * (range / 4), y - 4, 1, color, 6);
      pt.ring(x, y, color2, range);
      pt.dust(x, y, 8);
      shake(3 * weight);
      break;
    case 'spirits':
      pt.ring(x, y, color, range);
      pt.magicBurst(x, y - 12, color2, 28);
      pt.magicBurst(x, y - 20, color, 14);
      shake(3 * weight);
      break;

    // ---- buffs -----------------------------------------------------------
    case 'steel':  pt.ring(x, y, color, 20); pt.ring(x, y, color2, 12); pt.hitSpark(x, y - 14, 1, color2, 12); break;
    case 'rage':   pt.ring(x, y, color, 22); for (let i=0;i<6;i++) pt.ember(x + (i-3)*3, y - 8 - i*2, i%2 ? color2 : color); pt.hitSpark(x, y-12, 1, color, 8); break;
    case 'shadow': pt.ring(x, y, color2, 18); pt.magicBurst(x, y - 10, color, 20); pt.magicBurst(x, y - 18, color2, 10); break;
    case 'nature': pt.ring(x, y, color, 20); pt.magicBurst(x, y - 12, color2, 18); pt.magicBurst(x, y - 4, color, 10); break;
    default:       pt.ring(x, y, color, 20); pt.magicBurst(x, y - 10, color, 10); break;
  }
}
