// What happens when the player presses E, and the dialogue box that answers.
//
// This is interaction PLUMBING only. The dialogue strings still live inline
// here exactly as they were — pulling the writing out into a content file is a
// separate job, and doing it halfway would leave two places to look for a line.
//
// Two shapes of outcome, and the difference matters:
//   * a scene change — save the hero, then call through scene.hooks, which is
//     the only route out of the town and is owned by main.js
//   * an overlay — assigned to scene.overlay, which update() checks before
//     anything else, so the world keeps drawing underneath
//
// A dialogue can carry an onDone, which is how the Runebound Gate confirms
// before it sends the player into combat.

import { Input } from '../../core/input.js';
import { Audio } from '../../core/audio.js';
import { PotionShop, InventoryMenu } from '../menus.js';

export function enterLocation(scene, loc) {
  Audio.confirm();
  switch (loc.action) {
    case 'training': scene.hero.save(); scene.hooks.toTraining(); break;
    case 'weapon': scene.hero.save(); if (scene.hooks.toWeaponShop) scene.hooks.toWeaponShop(); break;
    case 'potion': scene.hero.save(); if (scene.hooks.toPotionShop) scene.hooks.toPotionShop(); break;
    case 'market': scene.overlay = new PotionShop(scene.hero, () => { scene.overlay = null; }); break;
    case 'pets': scene.overlay = new InventoryMenu(scene.hero, () => { scene.overlay = null; }, 2); break;
    case 'library': scene.hero.save(); if (scene.hooks.toLibrary) scene.hooks.toLibrary(); break;
    case 'quest': case 'guild': openQuest(scene, loc.action === 'guild'); break;
    case 'dungeon': enterGate(scene); break;
    case 'rest': rest(scene); break;
    case 'house': scene.hero.save(); if (scene.hooks.toHouse) scene.hooks.toHouse(); break;
  }
}

function rest(scene) {
  const healed = scene.hero.s.hp < scene.hero.maxHp || scene.hero.s.mana < scene.hero.maxMana;
  scene.hero.s.hp = scene.hero.maxHp; scene.hero.s.mana = scene.hero.maxMana; scene.hero.save();
  scene.particles.pickup(scene.px, scene.py - 12, '#b58bff');
  scene.toasts.push(healed ? 'The crystal restores you!' : 'Already at full health', scene.px, scene.py - 32, UI.good, { life: 1.6 });
  Audio.levelUp();
}

function openQuest(scene, atGuild) {
  const q = scene.hero.activeQuest();
  const who = atGuild ? 'Guildmaster' : 'Captain Mara';
  if (q) {
    scene.dialogue = { speaker: q.giver, lines: [q.intro, 'Objective: ' + q.objective, 'Rewards: ' + rewardText(q) + '. Head to the Dungeon Gate when ready!'], idx: 0 };
  } else if (scene.hero.s.quests.completed.includes('goblin_trouble')) {
    scene.dialogue = { speaker: who, lines: ['You cleared the goblin camp and felled their King. Embervale is in your debt!', 'Rest, train, and grow stronger — more adventures await.'], idx: 0 };
  } else {
    scene.dialogue = { speaker: who, lines: ['No quests right now, hero. Come back soon.'], idx: 0 };
  }
  scene.dialogueReveal = 0;
}

function rewardText(q) {
  const r = q.reward; const parts = [];
  if (r.gold) parts.push(r.gold + ' gold');
  if (r.xp) parts.push(r.xp + ' XP');
  if (r.item) parts.push('an item');
  if (r.petChance) parts.push('a pet egg');
  return parts.join(', ');
}

function enterGate(scene) {
  if (scene.hero.s.quests.completed.includes('goblin_trouble')) {
    scene.dialogue = { speaker: 'Gate Guard', lines: ['The goblin threat is over. The gate is quiet now — return when new dangers stir.'], idx: 0 };
    scene.dialogueReveal = 0; return;
  }
  scene.dialogue = {
    speaker: 'Dungeon Gate',
    lines: ['Beyond lies the Goblin Camp and the Goblin King. Ready yourself, hero.'],
    idx: 0,
    onDone: () => { scene.hero.save(); scene.hooks.toDungeon(); },
  };
  scene.dialogueReveal = 0;
}

export function updateDialogue(scene, dt) {
  scene.dialogueReveal = Math.min(1, scene.dialogueReveal + dt * 3);
  if (Input.anyPressed('confirm', 'interact', 'light')) {
    if (scene.dialogueReveal < 1) { scene.dialogueReveal = 1; return; }
    const d = scene.dialogue;
    if (d.idx < d.lines.length - 1) { d.idx++; scene.dialogueReveal = 0; Audio.select(); }
    else { const done = d.onDone; scene.dialogue = null; if (done) done(); else Audio.confirm(); }
  }
  if (Input.pressed('menu')) { scene.dialogue = null; Audio.deny(); }
}
