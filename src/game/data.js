// Static game data: classes, skill trees, abilities, weapons, potions, enemies,
// pets, and the loot/economy tables. Pure data + small helpers — no rendering,
// no game state. The design rule from the spec is enforced here: abilities are
// unlocked by TRAINING MASTERY, never bought.

// ------------------------------------------------------------- rarities

export const RARITY = {
  common:    { name: 'Common',    color: '#c8cfe0', order: 0, mult: 1.0 },
  uncommon:  { name: 'Uncommon',  color: '#57d98a', order: 1, mult: 1.25 },
  rare:      { name: 'Rare',      color: '#5b8cf2', order: 2, mult: 1.6 },
  epic:      { name: 'Epic',      color: '#a56bd9', order: 3, mult: 2.1 },
  legendary: { name: 'Legendary', color: '#f2a03f', order: 4, mult: 2.8 },
};

// --------------------------------------------------------- academic model
// Three academic LEVELS (not difficulties): Middle / High / College.
// Seven CATEGORIES. Mastery is tracked per (category) 0..100 and per level.

export const LEVELS = [
  { id: 'middle',  name: 'Middle School', short: 'MS', tier: 'Apprentice', color: '#57d98a' },
  { id: 'high',    name: 'High School',   short: 'HS', tier: 'Adventurer',  color: '#5b8cf2' },
  { id: 'college', name: 'College',       short: 'CO', tier: 'Master',      color: '#e05a5a' },
];

export const CATEGORIES = [
  { id: 'math',    name: 'Math & Logic',       icon: 'book', color: '#5b8cf2', stat: 'magic' },
  { id: 'cs',      name: 'Computer Science',    icon: 'book', color: '#57d98a', stat: 'attack' },
  { id: 'science', name: 'Science',             icon: 'book', color: '#a56bd9', stat: 'magic' },
  { id: 'geo',     name: 'World & Geography',    icon: 'book', color: '#3fd9c9', stat: 'hp' },
  { id: 'history', name: 'History',             icon: 'book', color: '#f2a03f', stat: 'defense' },
  { id: 'lang',    name: 'Language & Comm.',     icon: 'book', color: '#e0679a', stat: 'mana' },
  { id: 'finance', name: 'Finance & Economics',  icon: 'coin', color: '#f2c94f', stat: 'gold' },
];

// --------------------------------------------------------------- abilities
// Each ability belongs to a class + skill-tree branch, and is gated behind a
// mastery threshold in a specific academic category. Training that category
// past the threshold unlocks it.

export const ABILITIES = {
  // ---- Warrior ----
  heavy_strike: {
    name: 'Heavy Strike', cls: 'warrior', branch: 'Might', icon: 'sword',
    gate: { cat: 'cs', mastery: 0 }, // starter, effectively free
    mana: 0, cd: 3.5, dmg: 34, kind: 'melee', range: 34, kb: 90,
    desc: 'A crushing overhead blow with big knockback.',
  },
  shield_bash: {
    name: 'Shield Bash', cls: 'warrior', branch: 'Guard', icon: 'shield',
    gate: { cat: 'history', mastery: 25 },
    mana: 10, cd: 6, dmg: 18, kind: 'melee', range: 26, kb: 140, stun: 1.1,
    desc: 'Stuns and knocks back everything in front of you.',
  },
  ground_slam: {
    name: 'Ground Slam', cls: 'warrior', branch: 'Might', icon: 'axe',
    gate: { cat: 'math', mastery: 45 },
    mana: 18, cd: 8, dmg: 40, kind: 'aoe', range: 42, kb: 120,
    desc: 'Slam the earth; damages and launches all nearby foes.',
  },
  berserker_rage: {
    name: "Berserker Rage", cls: 'warrior', branch: 'Fury', icon: 'star',
    gate: { cat: 'science', mastery: 60 },
    mana: 25, cd: 16, kind: 'buff', dur: 6, atkMult: 1.6, speedMult: 1.3,
    desc: '+60% damage and +30% speed for 6 seconds.',
  },
  // ---- Mage ----
  fireball: {
    name: 'Fireball', cls: 'mage', branch: 'Fire', icon: 'staff',
    gate: { cat: 'math', mastery: 0 }, // starter
    mana: 8, cd: 1.6, dmg: 22, kind: 'projectile', speed: 150, range: 220, element: 'fire',
    desc: 'Hurl a bolt of flame that pierces on impact.',
  },
  frost_nova: {
    name: 'Frost Nova', cls: 'mage', branch: 'Ice', icon: 'star',
    gate: { cat: 'science', mastery: 30 },
    mana: 16, cd: 7, dmg: 16, kind: 'aoe', range: 46, freeze: 2.2, element: 'ice',
    desc: 'Freeze all nearby enemies solid for a moment.',
  },
  lightning: {
    name: 'Chain Lightning', cls: 'mage', branch: 'Storm', icon: 'staff',
    gate: { cat: 'cs', mastery: 45 },
    mana: 20, cd: 5, dmg: 30, kind: 'chain', chains: 3, range: 200, element: 'storm',
    desc: 'Lightning leaps between up to three enemies.',
  },
  arcane_shield: {
    name: 'Arcane Shield', cls: 'mage', branch: 'Arcane', icon: 'shield',
    gate: { cat: 'lang', mastery: 55 },
    mana: 22, cd: 14, kind: 'buff', dur: 7, shield: 60,
    desc: 'Absorbs the next 60 damage for 7 seconds.',
  },
  // ---- Rogue ----
  backstab: {
    name: 'Backstab', cls: 'rogue', branch: 'Shadow', icon: 'sword',
    gate: { cat: 'cs', mastery: 0 }, // starter
    mana: 0, cd: 2.5, dmg: 26, kind: 'melee', range: 24, kb: 60,
    desc: 'A vicious lunge that hits where it hurts.',
  },
  poison_dagger: {
    name: 'Poison Dagger', cls: 'rogue', branch: 'Poison', icon: 'sword',
    gate: { cat: 'science', mastery: 25 },
    mana: 10, cd: 3.5, dmg: 20, kind: 'projectile', speed: 190, range: 190, element: 'poison',
    desc: 'A thrown blade coated in something unpleasant.',
  },
  smoke_bomb: {
    name: 'Smoke Bomb', cls: 'rogue', branch: 'Shadow', icon: 'star',
    gate: { cat: 'geo', mastery: 45 },
    mana: 18, cd: 9, dmg: 10, kind: 'aoe', range: 44, freeze: 1.6, kb: 40,
    desc: 'Choking smoke leaves everyone around you reeling.',
  },
  shadow_rush: {
    name: 'Shadow Rush', cls: 'rogue', branch: 'Speed', icon: 'star',
    gate: { cat: 'lang', mastery: 60 },
    mana: 24, cd: 15, kind: 'buff', dur: 5, atkMult: 1.4, speedMult: 1.5,
    desc: '+40% damage and +50% speed for 5 seconds.',
  },
  // ---- Ranger ----
  precision_shot: {
    name: 'Precision Shot', cls: 'ranger', branch: 'Precision', icon: 'sword',
    gate: { cat: 'math', mastery: 0 }, // starter
    mana: 0, cd: 2, dmg: 20, kind: 'projectile', speed: 240, range: 260,
    desc: 'A fast, dead-accurate arrow.',
  },
  volley: {
    name: 'Volley', cls: 'ranger', branch: 'Precision', icon: 'star',
    gate: { cat: 'geo', mastery: 30 },
    mana: 16, cd: 6, dmg: 22, kind: 'chain', chains: 3, range: 220,
    desc: 'A rain of arrows finds up to three targets.',
  },
  snare_trap: {
    name: 'Snare Trap', cls: 'ranger', branch: 'Traps', icon: 'shield',
    gate: { cat: 'science', mastery: 45 },
    mana: 18, cd: 9, dmg: 14, kind: 'aoe', range: 42, freeze: 2.0, element: 'nature',
    desc: 'Roots every nearby enemy in place.',
  },
  hunters_mark: {
    name: "Hunter's Mark", cls: 'ranger', branch: 'Nature', icon: 'star',
    gate: { cat: 'history', mastery: 60 },
    mana: 22, cd: 14, kind: 'buff', dur: 7, atkMult: 1.45, speedMult: 1.15,
    desc: '+45% damage and quicker feet for 7 seconds.',
  },
  // ---- Paladin ----
  holy_strike: {
    name: 'Holy Strike', cls: 'paladin', branch: 'Holy', icon: 'sword',
    gate: { cat: 'history', mastery: 0 }, // starter
    mana: 0, cd: 3, dmg: 30, kind: 'melee', range: 30, kb: 80, element: 'holy',
    desc: 'A radiant blow that smites the wicked.',
  },
  divine_shield: {
    name: 'Divine Shield', cls: 'paladin', branch: 'Guard', icon: 'shield',
    gate: { cat: 'lang', mastery: 25 },
    mana: 16, cd: 13, kind: 'buff', dur: 8, shield: 70,
    desc: 'Absorbs the next 70 damage for 8 seconds.',
  },
  consecration: {
    name: 'Consecration', cls: 'paladin', branch: 'Light', icon: 'star',
    gate: { cat: 'finance', mastery: 45 },
    mana: 20, cd: 8, dmg: 34, kind: 'aoe', range: 44, kb: 100, element: 'holy',
    desc: 'Holy fire erupts around you, scattering foes.',
  },
  judgement: {
    name: 'Judgement', cls: 'paladin', branch: 'Holy', icon: 'staff',
    gate: { cat: 'math', mastery: 60 },
    mana: 24, cd: 6, dmg: 34, kind: 'chain', chains: 2, range: 200, element: 'storm',
    desc: 'Bolts of light condemn up to two enemies.',
  },
  // ---- Berserker ----
  reckless_swing: {
    name: 'Reckless Swing', cls: 'berserker', branch: 'Fury', icon: 'axe',
    gate: { cat: 'cs', mastery: 0 }, // starter
    mana: 0, cd: 2.2, dmg: 30, kind: 'melee', range: 28, kb: 70,
    desc: 'A wild axe swing that leaves you open but hits hard.',
  },
  blood_frenzy: {
    name: 'Blood Frenzy', cls: 'berserker', branch: 'Bloodlust', icon: 'star',
    gate: { cat: 'science', mastery: 25 },
    mana: 12, cd: 8, kind: 'buff', dur: 6, atkMult: 1.5, speedMult: 1.2,
    desc: 'The more you bleed, the harder you hit: +50% damage for 6 seconds.',
  },
  whirling_axes: {
    name: 'Whirling Axes', cls: 'berserker', branch: 'Onslaught', icon: 'axe',
    gate: { cat: 'math', mastery: 45 },
    mana: 20, cd: 9, dmg: 36, kind: 'aoe', range: 46, kb: 130,
    desc: 'Spin your axes, cleaving everything nearby.',
  },
  execute: {
    name: 'Execute', cls: 'berserker', branch: 'Fury', icon: 'sword',
    gate: { cat: 'history', mastery: 60 },
    mana: 26, cd: 12, dmg: 55, kind: 'melee', range: 30, kb: 160,
    desc: 'A finishing blow that comes down like judgement itself.',
  },
  // ---- Summoner ----
  spirit_bolt: {
    name: 'Spirit Bolt', cls: 'summoner', branch: 'Spirits', icon: 'staff',
    gate: { cat: 'math', mastery: 0 }, // starter
    mana: 8, cd: 1.8, dmg: 20, kind: 'projectile', speed: 170, range: 210,
    desc: 'Launch a bolt of raw spirit energy.',
  },
  wolf_totem: {
    name: 'Wolf Totem', cls: 'summoner', branch: 'Totems', icon: 'star',
    gate: { cat: 'geo', mastery: 30 },
    mana: 18, cd: 8, dmg: 18, kind: 'aoe', range: 48, kb: 80,
    desc: 'Slam a totem into the ground as spirit wolves burst outward.',
  },
  chain_spirits: {
    name: 'Chain Spirits', cls: 'summoner', branch: 'Spirits', icon: 'staff',
    gate: { cat: 'lang', mastery: 45 },
    mana: 22, cd: 6, dmg: 26, kind: 'chain', chains: 3, range: 210,
    desc: 'Spectral energy arcs between up to three foes.',
  },
  wild_growth: {
    name: 'Wild Growth', cls: 'summoner', branch: 'Wild', icon: 'star',
    gate: { cat: 'finance', mastery: 60 },
    mana: 24, cd: 15, kind: 'buff', dur: 7, atkMult: 1.35, speedMult: 1.25, element: 'nature',
    desc: 'Nature answers your call: +35% damage and quicker feet for 7 seconds.',
  },

  // ======================================================================
  // Second tier. Four more per class, so eight abilities compete for four
  // slots and equipping at the Eldertree becomes a real build decision
  // instead of a formality. Every one of these resolves through a kind
  // combat.js already dispatches — no new engine behaviour was added.
  //
  // Gates interleave with the first tier (0 / 25-30 / 45 / 55-60) at
  // 15 / 35 / 50 / 65, and were checked against each subject's reachable
  // mastery ceiling: the bank sizes cap math at ~100 and history/lang at
  // ~76, so the 65 gates sit on subjects with headroom.
  // ======================================================================

  // ---- Warrior ----
  rallying_cry: {
    name: 'Rallying Cry', cls: 'warrior', branch: 'Guard', icon: 'star',
    gate: { cat: 'lang', mastery: 15 },
    mana: 12, cd: 11, kind: 'buff', dur: 7, shield: 45,
    desc: 'A battle shout that steels you against the next 45 damage.',
  },
  sundering_blow: {
    name: 'Sundering Blow', cls: 'warrior', branch: 'Might', icon: 'sword',
    gate: { cat: 'cs', mastery: 35 },
    mana: 10, cd: 5, dmg: 30, kind: 'melee', range: 32, kb: 60, stun: 0.8,
    desc: 'A shattering swing that leaves the target reeling.',
  },
  iron_bulwark: {
    name: 'Iron Bulwark', cls: 'warrior', branch: 'Guard', icon: 'shield',
    gate: { cat: 'history', mastery: 50 },
    mana: 20, cd: 15, kind: 'buff', dur: 9, shield: 95,
    desc: 'Plant your feet behind a wall of iron for nine seconds.',
  },
  earthshatter: {
    name: 'Earthshatter', cls: 'warrior', branch: 'Might', icon: 'axe',
    gate: { cat: 'math', mastery: 65 },
    mana: 26, cd: 12, dmg: 52, kind: 'aoe', range: 54, kb: 150, stun: 1.2,
    desc: 'Split the ground open; everything nearby is thrown and stunned.',
  },

  // ---- Mage ----
  ember_dart: {
    name: 'Ember Dart', cls: 'mage', branch: 'Fire', icon: 'staff',
    gate: { cat: 'math', mastery: 15 },
    mana: 4, cd: 0.9, dmg: 14, kind: 'projectile', speed: 190, range: 200, element: 'fire',
    desc: 'A quick cheap spark for keeping pressure on.',
  },
  ice_lance: {
    name: 'Ice Lance', cls: 'mage', branch: 'Ice', icon: 'staff',
    gate: { cat: 'science', mastery: 35 },
    mana: 12, cd: 3.2, dmg: 28, kind: 'projectile', speed: 165, range: 230,
    element: 'ice', freeze: 1.4,
    desc: 'A spear of ice that pins whatever it strikes.',
  },
  static_field: {
    name: 'Static Field', cls: 'mage', branch: 'Storm', icon: 'star',
    gate: { cat: 'cs', mastery: 50 },
    mana: 20, cd: 8, dmg: 26, kind: 'aoe', range: 50, element: 'storm', stun: 1.0,
    desc: 'Charge the air around you until it cracks.',
  },
  arcane_barrage: {
    name: 'Arcane Barrage', cls: 'mage', branch: 'Arcane', icon: 'staff',
    gate: { cat: 'math', mastery: 65 },
    mana: 28, cd: 7, dmg: 34, kind: 'chain', chains: 4, range: 230,
    desc: 'Raw arcane force ricochets between up to four enemies.',
  },

  // ---- Rogue ----
  throwing_knife: {
    name: 'Throwing Knife', cls: 'rogue', branch: 'Speed', icon: 'sword',
    gate: { cat: 'cs', mastery: 15 },
    mana: 5, cd: 1.1, dmg: 16, kind: 'projectile', speed: 210, range: 190,
    desc: 'Off the belt and away before they see your hand move.',
  },
  venom_cloud: {
    name: 'Venom Cloud', cls: 'rogue', branch: 'Poison', icon: 'star',
    gate: { cat: 'science', mastery: 35 },
    mana: 16, cd: 8, dmg: 24, kind: 'aoe', range: 46, freeze: 1.2, element: 'poison',
    desc: 'A burst of green fog that leaves everything choking.',
  },
  vanish: {
    name: 'Vanish', cls: 'rogue', branch: 'Shadow', icon: 'star',
    gate: { cat: 'lang', mastery: 50 },
    mana: 18, cd: 14, kind: 'buff', dur: 5, speedMult: 1.6, atkMult: 1.25,
    desc: 'Slip out of sight and come back faster and sharper.',
  },
  assassinate: {
    name: 'Assassinate', cls: 'rogue', branch: 'Shadow', icon: 'sword',
    gate: { cat: 'geo', mastery: 65 },
    mana: 24, cd: 13, dmg: 70, kind: 'melee', range: 28, kb: 40,
    desc: 'One strike, placed exactly where it ends things.',
  },

  // ---- Ranger ----
  quick_shot: {
    name: 'Quick Shot', cls: 'ranger', branch: 'Precision', icon: 'star',
    gate: { cat: 'cs', mastery: 15 },
    mana: 4, cd: 0.8, dmg: 13, kind: 'projectile', speed: 220, range: 210,
    desc: 'Nocked, loosed and nocked again in one motion.',
  },
  bear_trap: {
    name: 'Bear Trap', cls: 'ranger', branch: 'Traps', icon: 'shield',
    gate: { cat: 'geo', mastery: 35 },
    mana: 14, cd: 9, dmg: 26, kind: 'aoe', range: 38, freeze: 2.6,
    desc: 'Iron jaws that hold whatever wanders into them.',
  },
  thornvine: {
    name: 'Thornvine', cls: 'ranger', branch: 'Nature', icon: 'star',
    gate: { cat: 'science', mastery: 50 },
    mana: 20, cd: 7, dmg: 28, kind: 'chain', chains: 3, range: 210, element: 'nature',
    desc: 'A living vine whips from one enemy to the next.',
  },
  rain_of_arrows: {
    name: 'Rain of Arrows', cls: 'ranger', branch: 'Precision', icon: 'star',
    gate: { cat: 'math', mastery: 65 },
    mana: 26, cd: 11, dmg: 46, kind: 'aoe', range: 60, kb: 60,
    desc: 'Blot out the sky over everything in front of you.',
  },

  // ---- Paladin ----
  lay_on_hands: {
    name: 'Lay on Hands', cls: 'paladin', branch: 'Holy', icon: 'shield',
    gate: { cat: 'lang', mastery: 15 },
    mana: 10, cd: 10, kind: 'buff', dur: 6, shield: 50,
    desc: 'A steadying light that turns aside the next 50 damage.',
  },
  hammer_of_light: {
    name: 'Hammer of Light', cls: 'paladin', branch: 'Light', icon: 'staff',
    gate: { cat: 'history', mastery: 35 },
    mana: 13, cd: 3.4, dmg: 30, kind: 'projectile', speed: 150, range: 200, element: 'holy',
    desc: 'A thrown hammer wreathed in daylight.',
  },
  sanctuary: {
    name: 'Sanctuary', cls: 'paladin', branch: 'Guard', icon: 'shield',
    gate: { cat: 'geo', mastery: 50 },
    mana: 22, cd: 16, kind: 'buff', dur: 10, shield: 110, speedMult: 0.9,
    desc: 'Hallowed ground: enormous protection, slightly slower going.',
  },
  wrath_of_dawn: {
    name: 'Wrath of Dawn', cls: 'paladin', branch: 'Light', icon: 'star',
    gate: { cat: 'math', mastery: 65 },
    mana: 30, cd: 14, dmg: 54, kind: 'aoe', range: 58, stun: 1.0, element: 'holy',
    desc: 'Sunrise breaks over the field and everything unholy reels.',
  },

  // ---- Berserker ----
  cleave: {
    name: 'Cleave', cls: 'berserker', branch: 'Onslaught', icon: 'axe',
    gate: { cat: 'cs', mastery: 15 },
    mana: 6, cd: 2.2, dmg: 24, kind: 'melee', range: 38, kb: 70,
    desc: 'A wide horizontal swing that catches everything in front.',
  },
  bloodletting: {
    name: 'Bloodletting', cls: 'berserker', branch: 'Bloodlust', icon: 'star',
    gate: { cat: 'science', mastery: 35 },
    mana: 12, cd: 12, kind: 'buff', dur: 8, atkMult: 1.35,
    desc: 'Trade caution for eight seconds of pure aggression.',
  },
  rampage: {
    name: 'Rampage', cls: 'berserker', branch: 'Fury', icon: 'axe',
    gate: { cat: 'history', mastery: 50 },
    mana: 22, cd: 10, dmg: 44, kind: 'aoe', range: 52, kb: 130,
    desc: 'Spin through the whole crowd and send it flying.',
  },
  undying_wrath: {
    name: 'Undying Wrath', cls: 'berserker', branch: 'Bloodlust', icon: 'star',
    gate: { cat: 'finance', mastery: 65 },
    mana: 32, cd: 20, kind: 'buff', dur: 9, atkMult: 1.7, speedMult: 1.4, shield: 60,
    desc: 'Nine seconds where nothing you meet gets to finish its swing.',
  },

  // ---- Summoner ----
  spirit_wisp: {
    name: 'Spirit Wisp', cls: 'summoner', branch: 'Spirits', icon: 'staff',
    gate: { cat: 'lang', mastery: 15 },
    mana: 5, cd: 1.0, dmg: 15, kind: 'projectile', speed: 175, range: 205,
    desc: 'A small drifting light that finds its own way to a target.',
  },
  stone_totem: {
    name: 'Stone Totem', cls: 'summoner', branch: 'Totems', icon: 'shield',
    gate: { cat: 'geo', mastery: 35 },
    mana: 15, cd: 12, kind: 'buff', dur: 9, shield: 65,
    desc: 'Set a stone guardian at your feet and let it take the hits.',
  },
  thorn_grove: {
    name: 'Thorn Grove', cls: 'summoner', branch: 'Wild', icon: 'star',
    gate: { cat: 'science', mastery: 50 },
    mana: 21, cd: 9, dmg: 32, kind: 'aoe', range: 54, freeze: 1.5, element: 'nature',
    desc: 'Briars erupt from the ground and hold the field.',
  },
  ancestral_chorus: {
    name: 'Ancestral Chorus', cls: 'summoner', branch: 'Spirits', icon: 'staff',
    gate: { cat: 'finance', mastery: 65 },
    mana: 30, cd: 8, dmg: 36, kind: 'chain', chains: 4, range: 225,
    desc: 'Four voices answer at once, each finding its own throat.',
  },

};

export function abilitiesForClass(cls) {
  return Object.entries(ABILITIES)
    .filter(([, a]) => a.cls === cls)
    .map(([id, a]) => ({ id, ...a }));
}

// The starter ability and weapon every class begins with.
export const STARTER_ABILITY = {
  warrior: 'heavy_strike', mage: 'fireball',
  rogue: 'backstab', ranger: 'precision_shot', paladin: 'holy_strike',
  berserker: 'reckless_swing', summoner: 'spirit_bolt',
};
export const STARTER_WEAPON = {
  warrior: 'worn_sword', mage: 'cracked_staff',
  rogue: 'rusty_dagger', ranger: 'old_bow', paladin: 'squire_blade',
  berserker: 'chipped_axe', summoner: 'bone_totem_staff',
};

// ----------------------------------------------------------------- classes

export const CLASSES = {
  warrior: {
    id: 'warrior', name: 'Warrior', sprite: 'warrior',
    color: '#c8cfe0',
    blurb: 'Balanced fighter with strong defense and reliable offense. High HP, heavy melee, shrugs off hits.',
    resource: 'Stamina', resourceColor: '#f2a03f',
    base: { hp: 140, mana: 40, attack: 22, defense: 14, magic: 6, speed: 62 },
    growth: { hp: 22, mana: 4, attack: 3.2, defense: 2.4, magic: 0.6, speed: 1.2 },
    weapon: 'sword', combo: [16, 20, 30], reach: 26,
    trees: ['Might', 'Guard', 'Fury'],
    critBase: 0.06,
  },
  mage: {
    id: 'mage', name: 'Mage', sprite: 'mage',
    color: '#9d8bff',
    blurb: 'Master of the arcane. Uses powerful spells to control the battlefield. Big mana, low armour.',
    resource: 'Mana', resourceColor: '#5b8cf2',
    base: { hp: 92, mana: 120, attack: 12, defense: 7, magic: 24, speed: 66 },
    growth: { hp: 12, mana: 14, attack: 1.4, defense: 1.1, magic: 3.4, speed: 1.3 },
    weapon: 'staff', combo: [12, 14, 20], reach: 24,
    trees: ['Fire', 'Ice', 'Storm', 'Arcane'],
    critBase: 0.08,
  },
  rogue: {
    id: 'rogue', name: 'Rogue', sprite: 'rogue',
    color: '#b06ad9',
    blurb: 'Agile and deadly. Strikes fast from the shadows with critical hits and quick escapes.',
    resource: 'Energy', resourceColor: '#b06ad9',
    base: { hp: 104, mana: 70, attack: 18, defense: 8, magic: 10, speed: 78 },
    growth: { hp: 15, mana: 8, attack: 2.8, defense: 1.4, magic: 1.2, speed: 1.8 },
    weapon: 'dagger', combo: [12, 14, 18, 22], reach: 22,
    trees: ['Shadow', 'Poison', 'Speed'],
    critBase: 0.16,
  },
  ranger: {
    id: 'ranger', name: 'Ranger', sprite: 'ranger',
    color: '#57d98a',
    blurb: 'Master of ranged combat and nature. Hits hard from a distance and stays on the move.',
    resource: 'Focus', resourceColor: '#57d98a',
    base: { hp: 110, mana: 80, attack: 19, defense: 9, magic: 12, speed: 72 },
    growth: { hp: 16, mana: 9, attack: 2.9, defense: 1.6, magic: 1.6, speed: 1.5 },
    weapon: 'bow', combo: [14, 16, 22], reach: 30,
    trees: ['Precision', 'Traps', 'Nature'],
    critBase: 0.12,
  },
  paladin: {
    id: 'paladin', name: 'Paladin', sprite: 'paladin',
    color: '#f2c94f',
    blurb: 'Holy warrior who protects and punishes with divine power. Sturdy, radiant, unbreakable.',
    resource: 'Holy Power', resourceColor: '#f2c94f',
    base: { hp: 150, mana: 70, attack: 19, defense: 17, magic: 14, speed: 58 },
    growth: { hp: 24, mana: 8, attack: 2.6, defense: 2.8, magic: 1.8, speed: 1.0 },
    weapon: 'sword', combo: [15, 18, 26], reach: 25,
    trees: ['Holy', 'Guard', 'Light'],
    critBase: 0.05,
  },
  berserker: {
    id: 'berserker', name: 'Berserker', sprite: 'berserker',
    color: '#e0533f',
    blurb: 'A wild axe-wielder who grows stronger the harder the fight gets. High damage, fragile defense, no fear.',
    resource: 'Rage', resourceColor: '#e0533f',
    base: { hp: 132, mana: 50, attack: 27, defense: 9, magic: 4, speed: 68 },
    growth: { hp: 21, mana: 5, attack: 3.8, defense: 1.5, magic: 0.4, speed: 1.3 },
    weapon: 'axe', combo: [18, 22, 32], reach: 28,
    trees: ['Fury', 'Bloodlust', 'Onslaught'],
    critBase: 0.1,
  },
  summoner: {
    id: 'summoner', name: 'Summoner', sprite: 'summoner',
    color: '#5fd6c4',
    blurb: 'Calls forth spirits and totems to fight at range. Fragile up close, devastating from a distance.',
    resource: 'Spirit', resourceColor: '#5fd6c4',
    base: { hp: 88, mana: 130, attack: 10, defense: 6, magic: 26, speed: 64 },
    growth: { hp: 11, mana: 15, attack: 1.2, defense: 1.0, magic: 3.6, speed: 1.2 },
    weapon: 'staff', combo: [10, 12, 18], reach: 24,
    trees: ['Spirits', 'Totems', 'Wild'],
    critBase: 0.07,
  },
};

// ----------------------------------------------------------------- weapons
// Shop stock + drop pool. `stat` fields are added to the hero.

export const WEAPONS = {
  // starters (owned from the beginning)
  worn_sword:  { name: 'Worn Sword',  slot: 'weapon', cls: 'warrior', icon: 'sword',  rarity: 'common', attack: 0,  desc: 'It has seen better days.' },
  cracked_staff:{ name: 'Cracked Staff', slot: 'weapon', cls: 'mage', icon: 'staff',  rarity: 'common', magic: 0,   desc: 'Barely holds a spark.' },
  rusty_dagger: { name: 'Rusty Dagger', slot: 'weapon', cls: 'rogue', icon: 'sword',  rarity: 'common', attack: 0,  desc: 'Still sharp enough.' },
  old_bow:      { name: 'Old Bow',      slot: 'weapon', cls: 'ranger', icon: 'sword', rarity: 'common', attack: 0,  desc: 'The string creaks.' },
  squire_blade: { name: 'Squire Blade', slot: 'weapon', cls: 'paladin', icon: 'sword', rarity: 'common', attack: 0, desc: 'Polished with pride.' },
  chipped_axe:  { name: 'Chipped Axe',  slot: 'weapon', cls: 'berserker', icon: 'axe', rarity: 'common', attack: 0, desc: 'Notched from countless swings.' },
  bone_totem_staff: { name: 'Bone Totem Staff', slot: 'weapon', cls: 'summoner', icon: 'staff', rarity: 'common', magic: 0, desc: 'Carved with half-remembered spirits.' },

  // rogue weapons
  steel_dagger: { name: 'Steel Dagger', slot: 'weapon', cls: 'rogue', icon: 'sword', rarity: 'common',  attack: 5, crit: 0.03, price: 60,  desc: 'Quick and quiet.' },
  venom_fang:   { name: 'Venom Fang',   slot: 'weapon', cls: 'rogue', icon: 'sword', rarity: 'rare',    attack: 13, crit: 0.08, price: 320, desc: 'It drips with malice.' },
  nightpiercer: { name: 'Nightpiercer', slot: 'weapon', cls: 'rogue', icon: 'sword', rarity: 'epic',    attack: 20, crit: 0.12, speed: 6, price: 640, desc: 'Cut from a moonless sky.' },

  // ranger weapons
  hunting_bow:  { name: 'Hunting Bow',  slot: 'weapon', cls: 'ranger', icon: 'sword', rarity: 'common',  attack: 5, speed: 4, price: 60,  desc: 'A trusty companion.' },
  hawk_bow:     { name: 'Hawk Bow',     slot: 'weapon', cls: 'ranger', icon: 'sword', rarity: 'rare',    attack: 14, crit: 0.06, price: 320, desc: 'Sees what you see.' },
  windrunner:   { name: 'Windrunner',   slot: 'weapon', cls: 'ranger', icon: 'sword', rarity: 'epic',    attack: 21, speed: 8, crit: 0.06, price: 640, desc: 'Arrows race the gale.' },

  // paladin weapons
  holy_blade:   { name: 'Holy Blade',   slot: 'weapon', cls: 'paladin', icon: 'sword', rarity: 'common', attack: 5, defense: 2, price: 60,  desc: 'Blessed at the temple.' },
  lightbringer: { name: 'Lightbringer', slot: 'weapon', cls: 'paladin', icon: 'sword', rarity: 'rare',   attack: 14, magic: 6, price: 320, desc: 'It glows near evil.' },
  dawnhammer:   { name: 'Dawnhammer',   slot: 'weapon', cls: 'paladin', icon: 'axe',  rarity: 'epic',    attack: 22, defense: 6, hp: 30, price: 640, desc: 'Sunrise, weaponized.' },

  // warrior weapons
  iron_sword:  { name: 'Iron Sword',   slot: 'weapon', cls: 'warrior', icon: 'sword', rarity: 'common',   attack: 6,  price: 60,  desc: 'Reliable steel.' },
  battle_axe:  { name: 'Battle Axe',   slot: 'weapon', cls: 'warrior', icon: 'axe',   rarity: 'uncommon', attack: 11, speed: -4, price: 140, desc: 'Slow but brutal.' },
  knight_blade:{ name: 'Knight Blade', slot: 'weapon', cls: 'warrior', icon: 'sword', rarity: 'rare',     attack: 16, crit: 0.04, price: 320, desc: 'Balanced and keen.' },
  dragon_cleaver:{ name: 'Dragon Cleaver', slot: 'weapon', cls: 'warrior', icon: 'axe', rarity: 'epic',   attack: 24, defense: 4, price: 640, desc: 'Forged from a wyrm fang.' },
  excalibur:   { name: 'Sunforged Edge', slot: 'weapon', cls: 'warrior', icon: 'sword', rarity: 'legendary', attack: 34, crit: 0.1, magic: 8, price: 1200, desc: 'It hums with dawnlight.' },

  // mage weapons
  oak_staff:   { name: 'Oak Staff',    slot: 'weapon', cls: 'mage', icon: 'staff', rarity: 'common',   magic: 6,  price: 60,  desc: 'A sturdy focus.' },
  crystal_wand:{ name: 'Crystal Wand', slot: 'weapon', cls: 'mage', icon: 'staff', rarity: 'uncommon', magic: 11, mana: 20, price: 140, desc: 'Cool to the touch.' },
  runed_staff: { name: 'Runed Staff',  slot: 'weapon', cls: 'mage', icon: 'staff', rarity: 'rare',     magic: 16, crit: 0.04, price: 320, desc: 'Glyphs crawl along it.' },
  storm_scepter:{ name: 'Storm Scepter', slot: 'weapon', cls: 'mage', icon: 'staff', rarity: 'epic',   magic: 24, mana: 40, price: 640, desc: 'Distant thunder answers it.' },
  archmage_rod:{ name: 'Archmage Rod', slot: 'weapon', cls: 'mage', icon: 'staff', rarity: 'legendary', magic: 34, mana: 60, crit: 0.08, price: 1200, desc: 'Reality bends politely.' },

  // berserker weapons
  rusty_cleaver: { name: 'Rusty Cleaver', slot: 'weapon', cls: 'berserker', icon: 'axe', rarity: 'common',  attack: 5,  price: 60,  desc: 'Heavy and eager.' },
  bloodaxe:      { name: 'Bloodaxe',      slot: 'weapon', cls: 'berserker', icon: 'axe', rarity: 'rare',    attack: 14, crit: 0.05, price: 320, desc: 'Thirsty for more.' },
  ragebringer:   { name: 'Ragebringer',   slot: 'weapon', cls: 'berserker', icon: 'axe', rarity: 'epic',    attack: 22, speed: -2, crit: 0.08, price: 640, desc: 'Screams as it swings.' },

  // summoner weapons
  carved_wand:    { name: 'Carved Wand',    slot: 'weapon', cls: 'summoner', icon: 'staff', rarity: 'common', magic: 6,  price: 60,  desc: 'Whittled beneath a full moon.' },
  spirit_scepter: { name: 'Spirit Scepter', slot: 'weapon', cls: 'summoner', icon: 'staff', rarity: 'rare',   magic: 14, mana: 20, price: 320, desc: 'Voices linger in the wood.' },
  ancestral_staff:{ name: 'Ancestral Staff',slot: 'weapon', cls: 'summoner', icon: 'staff', rarity: 'epic',   magic: 21, mana: 34, price: 640, desc: 'Generations of spirits answer.' },

  // shared trinkets (any class)
  leather_charm:{ name: 'Leather Charm', slot: 'trinket', icon: 'shield', rarity: 'common',   defense: 3, hp: 20, price: 80, desc: 'A lucky cord.' },
  guard_ring:  { name: 'Guardian Ring', slot: 'trinket', icon: 'shield', rarity: 'uncommon', defense: 6, hp: 40, price: 180, desc: 'Warm and protective.' },
  sage_amulet: { name: 'Sage Amulet',   slot: 'trinket', icon: 'star',   rarity: 'rare',     magic: 8, mana: 30, price: 260, desc: 'For the studious.' },
  swift_boots: { name: 'Swift Boots',   slot: 'trinket', icon: 'star',   rarity: 'uncommon', speed: 10, crit: 0.03, price: 200, desc: 'Light on the feet.' },
};

export function weaponsFor(cls) {
  return Object.entries(WEAPONS)
    .filter(([, w]) => (!w.cls || w.cls === cls) && w.price)
    .map(([id, w]) => ({ id, ...w }));
}

// ----------------------------------------------------------------- potions

export const POTIONS = {
  health:  { name: 'Health Potion',  icon: 'potionRed',    color: '#e05a5a', price: 25,  heal: 60,  desc: 'Restore 60 HP.' },
  mana:    { name: 'Mana Potion',    icon: 'potionBlue',   color: '#5b8cf2', price: 25,  mana: 60,  desc: 'Restore 60 MP.' },
  speed:   { name: 'Speed Draught',  icon: 'potionGreen',  color: '#57d98a', price: 40,  buff: 'speed', dur: 12, desc: '+40% speed for 12s.' },
  defense: { name: 'Iron Skin Brew', icon: 'potionYellow', color: '#f2c94f', price: 40,  buff: 'defense', dur: 12, desc: 'Halve damage for 12s.' },
};

// ------------------------------------------------------------------ enemies
//
// An enemy is pure data — combat.js reads these fields and never branches on the
// enemy's id. To add one, copy an entry and pick a `behavior`; no combat code
// needs to change.
//
// Required by every enemy:
//   name sprite hp attack defense speed w gold xp behavior attackCd
//   reach     melee stopping distance ('chase' and 'hop' only — 'ranged' ignores it)
//   projSpeed arrow speed ('ranged' only)
//
// Optional, all defaulted in game/enemyBehaviors.js — set one only to make this
// enemy feel different from others sharing its behavior:
//   chase   depthArc depthChase windup
//   hop     depthArc depthChase windup hopRange hopPower hopLunge
//   ranged  keepMin keepMax approachRate depthChase fireArc
//           projLife projColor projRadius
//
// Cosmetic/optional anywhere: tint tintDark tintLite bloodColor launchImmune

export const ENEMIES = {
  goblin: {
    name: 'Goblin', sprite: 'goblin', hp: 34, attack: 8, speed: 46, defense: 2,
    reach: 20, gold: [4, 9], xp: 6, behavior: 'chase', attackCd: 1.4, w: 12,
  },
  slime: {
    name: 'Slime', sprite: 'slime', hp: 26, attack: 6, speed: 30, defense: 0,
    reach: 16, gold: [2, 6], xp: 4, behavior: 'hop', attackCd: 1.8, w: 14,
    tint: '#3fb872', tintDark: '#2a8a52', tintLite: '#7fe8a8',
    bloodColor: '#2a8a52', deathHold: 0.65,
  },
  slime_blue: {
    name: 'Frost Slime', sprite: 'slime', hp: 40, attack: 9, speed: 26, defense: 3,
    reach: 16, gold: [4, 8], xp: 7, behavior: 'hop', attackCd: 1.6, w: 14,
    tint: '#4f9fe0', tintDark: '#2f6fb0', tintLite: '#9fd0ff',
    bloodColor: '#2f6fb0',
  },
  // The elite slime: on death it tears at its saddle into its two children.
  // deathHold lets the 5-frame split play before the fade; splitInto is what
  // combat spawns when it finishes. Children never split again.
  splitcrown: {
    name: 'Splitcrown', sprite: 'splitcrown', hp: 36, attack: 8, speed: 28, defense: 1,
    reach: 17, gold: [3, 7], xp: 8, behavior: 'hop', attackCd: 1.7, w: 17,
    bloodColor: '#2a8a52', deathHold: 0.65, splitInto: ['lobeling', 'nubling'],
  },
  lobeling: {
    name: 'Lobeling', sprite: 'lobeling', hp: 11, attack: 4, speed: 40, defense: 0,
    reach: 12, gold: [1, 3], xp: 3, behavior: 'hop', attackCd: 1.4, w: 10,
    bloodColor: '#2a8a52', deathHold: 0.65,
  },
  nubling: {
    name: 'Nubling', sprite: 'nubling', hp: 8, attack: 3, speed: 46, defense: 0,
    reach: 10, gold: [1, 2], xp: 2, behavior: 'hop', attackCd: 1.2, w: 8,
    bloodColor: '#2a8a52', deathHold: 0.65,
  },
  // ---- Forest roster (approved art pack, staged rollout). Stage 1 gives
  // every unit a body and a proven archetype; specialised state machines
  // (bomber arcs, hound circling, shaman support, captain command) arrive
  // per-enemy in later stages without touching these identities.
  gob_bomber: {
    name: 'Goblin Bomber', sprite: 'gob_bomber', hp: 18, attack: 8, speed: 38,
    defense: 0, reach: 150, gold: [4, 8], xp: 7, behavior: 'ranged',
    attackCd: 2.4, w: 12, projectile: true, projSpeed: 95,
    bloodColor: '#3f7a3f',
  },
  gob_trapper: {
    name: 'Goblin Trapper', sprite: 'gob_trapper', hp: 20, attack: 6,
    speed: 46, defense: 0, reach: 16, gold: [3, 7], xp: 6, behavior: 'chase',
    attackCd: 1.3, w: 12, bloodColor: '#3f7a3f',
  },
  gob_shaman: {
    name: 'Goblin Shaman', sprite: 'gob_shaman', hp: 22, attack: 7, speed: 30,
    defense: 0, reach: 150, gold: [5, 10], xp: 9, behavior: 'ranged',
    attackCd: 2.8, w: 12, projectile: true, projSpeed: 115,
    bloodColor: '#3f7a3f',
  },
  gob_brute: {
    name: 'Goblin Brute', sprite: 'gob_brute', hp: 95, attack: 16, speed: 26,
    defense: 6, reach: 26, gold: [10, 18], xp: 16, behavior: 'chase',
    attackCd: 2.6, w: 22, telegraph: 'arc', bloodColor: '#3f7a3f',
  },
  war_hound: {
    name: 'War Hound', sprite: 'war_hound', hp: 22, attack: 8, speed: 88,
    defense: 0, reach: 15, gold: [2, 6], xp: 6, behavior: 'chase',
    attackCd: 1.5, w: 16, bloodColor: '#7a3f2f',
  },
  gob_captain: {
    name: 'Goblin Captain', sprite: 'gob_captain', hp: 62, attack: 12,
    speed: 44, defense: 5, reach: 20, gold: [12, 20], xp: 18,
    behavior: 'chase', attackCd: 1.6, w: 13, telegraph: 'arc',
    bloodColor: '#3f7a3f',
  },
  risen_footman: {
    name: 'Risen Footman', sprite: 'risen_footman', hp: 46, attack: 13,
    spriteVariants: ['risen_footman', 'risen_footman_b', 'risen_footman_c',
                     'risen_footman_d'],
    speed: 33, defense: 4, reach: 21, gold: [6, 12], xp: 12,
    behavior: 'chase', attackCd: 2.3, w: 12, telegraph: 'arc',
    bloodColor: '#b8a888',
  },
  risen_archer: {
    name: 'Risen Archer', sprite: 'risen_archer', hp: 26, attack: 10,
    spriteVariants: ['risen_archer', 'risen_archer_b', 'risen_archer_c',
                     'risen_archer_d'],
    speed: 30, defense: 1, reach: 175, gold: [6, 12], xp: 12,
    behavior: 'ranged', attackCd: 2.7, w: 11, projectile: true,
    projSpeed: 155, bloodColor: '#b8a888',
  },
  skeleton: {
    name: 'Skeleton', sprite: 'skeleton', hp: 30, attack: 10, speed: 40, defense: 4,
    reach: 22, gold: [5, 11], xp: 8, behavior: 'chase', attackCd: 1.2, w: 12,
  },
  skeleton_archer: {
    name: 'Bone Archer', sprite: 'skeleton', hp: 24, attack: 9, speed: 34, defense: 2,
    reach: 140, gold: [6, 12], xp: 10, behavior: 'ranged', attackCd: 2.2, w: 12,
    projectile: true, projSpeed: 130,
  },
};

// Goblin King boss with four phases as specified.
export const BOSS = {
  goblin_king: {
    name: 'Goblin King', sprite: 'king', hp: 520, attack: 16, speed: 40, defense: 6,
    reach: 34, w: 24, gold: [120, 180], xp: 140,
    phases: [
      { at: 1.0,  name: 'The Warlord',   summon: 0, speed: 40, cd: 1.8, note: 'Club sweeps.' },
      { at: 0.7,  name: 'Call the Horde', summon: 3, speed: 44, cd: 1.6, note: 'Summons goblins!' },
      { at: 0.4,  name: 'Enraged',       summon: 2, speed: 60, cd: 1.1, note: 'Faster and furious!' },
      { at: 0.18, name: 'Last Stand',    summon: 4, speed: 66, cd: 0.9, note: 'Ground-shaking slams!' },
    ],
  },
};

// -------------------------------------------------------------------- pets

export const PETS = {
  ember_dragon: { name: 'Ember Dragon', sprite: 'dragon', bonus: 'fireDmg',  amount: 0.05, desc: '+5% Fire damage.' },
  arcane_owl:   { name: 'Arcane Owl',   sprite: 'owl',    bonus: 'trainXp',  amount: 0.05, desc: '+5% Training XP.' },
  shadow_fox:   { name: 'Shadow Fox',   sprite: 'fox',    bonus: 'moveSpeed',amount: 0.05, desc: '+5% Movement speed.' },
  ancient_turtle:{ name: 'Ancient Turtle', sprite: 'turtle', bonus: 'defense', amount: 0.05, desc: '+5% Defense.' },
  lucky_rabbit: { name: 'Lucky Rabbit', sprite: 'rabbit', bonus: 'rareLoot', amount: 0.05, desc: '+5% Rare loot chance.' },
};

// --------------------------------------------------------- leveling curve

export function xpForLevel(level) {
  return Math.floor(40 * Math.pow(level, 1.5)) + 30;
}

// Mastery gained per correct answer, scaled by academic level difficulty.
export function masteryGain(levelId, correct) {
  const base = correct ? 6 : 1;
  const scale = levelId === 'college' ? 1.4 : levelId === 'high' ? 1.15 : 1.0;
  return base * scale;
}

// Training XP -> hero XP conversion.
export function trainingXp(levelId, correct, streak) {
  if (!correct) return 2;
  const base = levelId === 'college' ? 18 : levelId === 'high' ? 13 : 9;
  const streakBonus = Math.min(2, 1 + streak * 0.1);
  return Math.round(base * streakBonus);
}
