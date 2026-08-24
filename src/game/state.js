// The single source of truth for a player's hero. Holds progression, inventory,
// mastery, equipped gear/abilities/pet and quest flags, and knows how to derive
// combat stats from all of that. Persisted via core/save.js.

import {
  CLASSES, WEAPONS, ABILITIES, PETS, STARTER_ABILITY, STARTER_WEAPON, CATEGORIES, LEVELS,
  xpForLevel,
} from './data.js';
import { Save } from '../core/save.js';

export const QUESTS = [
  {
    id: 'goblin_trouble',
    name: 'Goblin Trouble',
    giver: 'Captain Mara',
    intro: 'The goblins have overrun the eastern forest and raided our stores. Clear the camp and drive them back!',
    objective: 'Clear the Goblin Camp and defeat the Goblin King',
    reward: { gold: 200, xp: 120, item: 'guard_ring', petChance: 1 },
    done: 'You did it! The forest is safe. The village owes you a debt — and this ring is yours.',
  },
];

function freshState(clsId) {
  const cls = CLASSES[clsId];
  const mastery = {};
  for (const c of CATEGORIES) mastery[c.id] = { middle: 0, high: 0, college: 0 };

  return {
    class: clsId,
    name: cls.name,
    level: 1,
    xp: 0,
    gold: 40,

    // resources are stored as "current"; max is derived
    hp: 0, mana: 0, // filled after deriveStats

    mastery,               // per category, per academic level (0..100)
    unlocked: [STARTER_ABILITY[clsId]], // ability ids the player has unlocked
    equippedAbilities: [STARTER_ABILITY[clsId], null, null, null], // slots 1-4

    inventory: {
      weapons: [STARTER_WEAPON[clsId]],
      trinkets: [],
      potions: { health: 2, mana: 2, speed: 0, defense: 0 },
      pets: [],
      eggs: 0,
    },
    equipped: {
      weapon: STARTER_WEAPON[clsId],
      trinket: null,
      pet: null,
    },

    quests: { active: 'goblin_trouble', completed: [], bossDefeated: false },
    stats: { enemiesDefeated: 0, questionsAnswered: 0, correctAnswers: 0, deepestWave: 0 },
    trainingSeen: {}, // question ids answered correctly, to avoid repeats
  };
}

export class Hero {
  constructor(state) {
    this.s = state;
    this.recompute();
    // On a fresh hero, fill pools to max.
    if (this.s.hp === 0) this.s.hp = this.maxHp;
    if (this.s.mana === 0) this.s.mana = this.maxMana;
  }

  static create(clsId) { return new Hero(freshState(clsId)); }

  static load() {
    const st = Save.read();
    return st ? new Hero(st) : null;
  }

  save() { Save.write(this.s); }

  // --- derived stats ------------------------------------------------------

  recompute() {
    const cls = CLASSES[this.s.class];
    const lv = this.s.level;
    const b = cls.base, gr = cls.growth;

    let hp = b.hp + gr.hp * (lv - 1);
    let mana = b.mana + gr.mana * (lv - 1);
    let attack = b.attack + gr.attack * (lv - 1);
    let defense = b.defense + gr.defense * (lv - 1);
    let magic = b.magic + gr.magic * (lv - 1);
    let speed = b.speed + gr.speed * (lv - 1);
    let crit = cls.critBase;

    // Mastery bonuses: each category feeds a stat. Total mastery (avg across
    // levels) contributes a modest passive boost — training literally makes you
    // stronger, per the core philosophy.
    for (const c of CATEGORIES) {
      const m = this.categoryMastery(c.id); // 0..100
      const amt = m / 100;
      switch (c.stat) {
        case 'hp': hp += amt * 60; break;
        case 'mana': mana += amt * 50; break;
        case 'attack': attack += amt * 10; break;
        case 'defense': defense += amt * 8; break;
        case 'magic': magic += amt * 12; break;
        case 'gold': /* handled as loot bonus */ break;
      }
    }

    // Gear
    for (const item of this.equippedItems()) {
      if (item.hp) hp += item.hp;
      if (item.mana) mana += item.mana;
      if (item.attack) attack += item.attack;
      if (item.defense) defense += item.defense;
      if (item.magic) magic += item.magic;
      if (item.speed) speed += item.speed;
      if (item.crit) crit += item.crit;
    }

    // Pet
    const pet = this.pet();
    if (pet && pet.bonus === 'defense') defense *= 1 + pet.amount;
    if (pet && pet.bonus === 'moveSpeed') speed *= 1 + pet.amount;

    this.maxHp = Math.round(hp);
    this.maxMana = Math.round(mana);
    this.attack = Math.round(attack);
    this.defense = Math.round(defense);
    this.magic = Math.round(magic);
    this.speed = Math.round(speed);
    this.crit = crit;

    // clamp pools
    this.s.hp = Math.min(this.s.hp, this.maxHp);
    this.s.mana = Math.min(this.s.mana, this.maxMana);
  }

  equippedItems() {
    const out = [];
    const w = WEAPONS[this.s.equipped.weapon];
    if (w) out.push(w);
    const tr = WEAPONS[this.s.equipped.trinket];
    if (tr) out.push(tr);
    return out;
  }

  cls() { return CLASSES[this.s.class]; }
  pet() { return this.s.equipped.pet ? PETS[this.s.equipped.pet] : null; }
  weapon() { return WEAPONS[this.s.equipped.weapon]; }
  weaponSprite() { return this.weapon()?.icon === 'axe' ? 'axe' : this.cls().weapon; }

  // --- mastery ------------------------------------------------------------

  // Weighted average across academic levels (college counts more).
  categoryMastery(catId) {
    const m = this.s.mastery[catId];
    if (!m) return 0;
    return (m.middle * 1 + m.high * 1.5 + m.college * 2) / 4.5;
  }

  totalMastery() {
    let sum = 0;
    for (const c of CATEGORIES) sum += this.categoryMastery(c.id);
    return sum / CATEGORIES.length;
  }

  addMastery(catId, levelId, amount) {
    const m = this.s.mastery[catId];
    m[levelId] = Math.min(100, m[levelId] + amount);
    const newlyUnlocked = this.checkUnlocks();
    this.recompute();
    return newlyUnlocked;
  }

  // Returns array of ability ids unlocked by current mastery that weren't before.
  //
  // Learning makes an ability KNOWN. It does not equip it — that choice is made
  // at the Eldertree, and it is the whole reason the tree is a place you walk to.
  // This used to auto-slot into the first empty slot, which was harmless while a
  // class had exactly four abilities for exactly four slots, but it means the
  // player never chooses. With more abilities than slots, choosing is the build.
  checkUnlocks() {
    const found = [];
    for (const [id, ab] of Object.entries(ABILITIES)) {
      if (ab.cls !== this.s.class) continue;
      if (this.s.unlocked.includes(id)) continue;
      const m = this.categoryMastery(ab.gate.cat);
      if (m >= ab.gate.mastery) {
        this.s.unlocked.push(id);
        found.push(id);
      }
    }
    return found;
  }

  /** Known abilities that are not currently in a slot — what the tree offers. */
  unequippedAbilityDefs() {
    return this.unlockedAbilityDefs().filter((ab) => !this.s.equippedAbilities.includes(ab.id));
  }

  // --- progression --------------------------------------------------------

  get xpToNext() { return xpForLevel(this.s.level); }

  addXp(amount) {
    this.s.xp += amount;
    let leveled = 0;
    while (this.s.xp >= this.xpToNext) {
      this.s.xp -= this.xpToNext;
      this.s.level++;
      leveled++;
      this.recompute();
      this.s.hp = this.maxHp;
      this.s.mana = this.maxMana;
    }
    return leveled;
  }

  addGold(amount) {
    // finance mastery boosts gold gains
    const bonus = 1 + this.categoryMastery('finance') / 100 * 0.5;
    const g = Math.round(amount * bonus);
    this.s.gold += g;
    return g;
  }

  spendGold(amount) {
    if (this.s.gold < amount) return false;
    this.s.gold -= amount;
    return true;
  }

  // --- inventory ----------------------------------------------------------

  ownsWeapon(id) {
    return this.s.inventory.weapons.includes(id) || this.s.inventory.trinkets.includes(id);
  }

  addItem(id) {
    const item = WEAPONS[id];
    if (!item) return;
    const bucket = item.slot === 'trinket' ? 'trinkets' : 'weapons';
    if (!this.s.inventory[bucket].includes(id)) this.s.inventory[bucket].push(id);
  }

  equip(id) {
    const item = WEAPONS[id];
    if (!item) return;
    if (item.slot === 'trinket') this.s.equipped.trinket = id;
    else this.s.equipped.weapon = id;
    this.recompute();
  }

  equipPet(id) {
    this.s.equipped.pet = id;
    this.recompute();
  }

  addPotion(kind, n = 1) { this.s.inventory.potions[kind] = (this.s.inventory.potions[kind] || 0) + n; }
  usePotion(kind) {
    if ((this.s.inventory.potions[kind] || 0) <= 0) return false;
    this.s.inventory.potions[kind]--;
    return true;
  }

  // --- abilities ----------------------------------------------------------

  equippedAbilityDefs() {
    return this.s.equippedAbilities.map((id) => (id ? { id, ...ABILITIES[id] } : null));
  }

  unlockedAbilityDefs() {
    return this.s.unlocked.map((id) => ({ id, ...ABILITIES[id] }));
  }

  setAbilitySlot(slot, id) {
    // prevent the same ability in two slots
    const existing = this.s.equippedAbilities.indexOf(id);
    if (existing >= 0) this.s.equippedAbilities[existing] = null;
    this.s.equippedAbilities[slot] = id;
  }

  // --- quests -------------------------------------------------------------

  activeQuest() {
    return QUESTS.find((q) => q.id === this.s.quests.active) || null;
  }

  petBonus(kind) {
    const p = this.pet();
    return p && p.bonus === kind ? p.amount : 0;
  }
}
