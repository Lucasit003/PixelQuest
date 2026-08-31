// Hooking the equipment layer up to the shipped heroes.
//
// gfx/equipment.js has been able to hang a weapon on a body for a while, and
// nothing in the game used it -- every in-game weapon still came from the
// procedural renderer. This module is the missing wiring: it registers the
// baked item sprites, merges the baked per-frame anchors into the actor
// configs, and exposes what a class should be holding.
//
// Both halves are BAKED, and by the same factor. bake_hero.py scaled the
// anchors from 215px authoring density to the 28px the game blits at, and
// tools/bake_items.py scales the item art by that identical K. If the two ever
// disagree the weapon lands in the right place at the wrong size, which reads
// as "the art is wrong" rather than "a constant drifted".

import { ACTOR_SPRITES } from './sprites.js';
import { registerEquipment } from './equipment.js';

const ITEMS = 'assets/items/';

// Grip points come from the same anchor files as the hand positions, so an item
// and the fist it sits in are always described in one coordinate space.
export async function loadHeroEquipment(fetchJson = (u) => fetch(u).then(r => r.json())) {
  const loaded = [];

  for (const [hero, spec] of Object.entries(HEROES)) {
    const cfg = ACTOR_SPRITES[hero];
    if (!cfg) continue;                        // class still renders procedurally

    let anchors;
    try {
      anchors = await fetchJson(spec.anchors);
    } catch {
      continue;                                // no anchor data: stay unarmed
    }

    const grip = anchors.grip || {};
    for (const [id, item] of Object.entries(spec.items)) {
      const g = grip[item.gripKey];
      if (!g) continue;
      registerEquipment(id, {
        sprite: ITEMS + item.file,
        grip: g,
        ...(item.tipKey && grip[item.tipKey] ? { tip: grip[item.tipKey] } : {}),
      });
    }

    // Merge the per-frame anchors into the animations the catalog registered.
    // Only actions the sheet actually has are touched, so an anchor file that
    // still lists a superseded action cannot resurrect it.
    for (const [action, data] of Object.entries(anchors)) {
      if (action === 'grip') continue;
      const anim = cfg.animations[action];
      if (!anim) continue;
      for (const [slot, frames] of Object.entries(data)) {
        if (Array.isArray(frames) && frames.length >= anim.frames.length) {
          anim[slot] = frames;
        }
      }
    }
    if (spec.slots) cfg.slots = spec.slots;
    loaded.push(hero);
  }
  return loaded;
}

const HEROES = {
  paladin: {
    anchors: 'assets/actors/paladin_anchors.json',
    slots: ['shield', 'hand'],
    items: {
      hammer_default: { file: 'hammer_default.png', gripKey: 'hammer', tipKey: 'hammerTip' },
      shield_default: { file: 'shield_default.png', gripKey: 'shield' },
    },
  },
  rogue: {
    anchors: 'assets/actors/rogue_anchors.json',
    // off-hand under main: the two blades read better with the lead one on top
    slots: ['offHand', 'mainHand'],
    items: {
      dagger_main: { file: 'dagger_main.png', gripKey: 'main', tipKey: 'mainTip' },
      dagger_off:  { file: 'dagger_off.png',  gripKey: 'off',  tipKey: 'offTip' },
    },
  },
};

/** What a class carries. Absent classes simply render unarmed. */
export const CLASS_LOADOUT = {
  paladin: { hand: 'hammer_default', shield: 'shield_default' },
  rogue:   { mainHand: 'dagger_main', offHand: 'dagger_off' },
};

export function loadoutFor(sprite) {
  return CLASS_LOADOUT[sprite] || null;
}
