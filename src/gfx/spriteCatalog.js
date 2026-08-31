import { registerActorSprite } from './sprites.js';
import { ACTOR_ZOOM } from './actorScale.js';

// Which actors are drawn from sprite sheets.
//
// This is the one place actor sheets get registered. Everything not listed here
// keeps rendering procedurally through gfx/actors.js — that is the default and
// nothing needs to change to keep it.
//
// ---------------------------------------------------------------- the format
//
//   registerActorSprite('<sprite id>', {
//     sheet:        'assets/actors/<name>.png',
//     frameWidth:   24,        // one cell
//     frameHeight:  32,
//     columns:      4,         // cells per row; frames are numbered across then down
//     anchorX:      12,        // foot point in frame pixels. defaults to centre
//     anchorY:      32,        //   ...and to the bottom edge, which is what the
//                              //   art tooling's baseline alignment produces
//     logicalHeight: 26,       // optional, for nameplates. AUTHORED, not measured
//     scale:        1,         // optional base scale for the sheet
//     shadowRadius: 9,         // optional; matches the procedural actors by default
//     hand:         [17, 18],  // default weapon anchor, right-facing frame pixels
//     shield:       [5, 16],   // default shield anchor
//     animations: {
//       idle: { frames: [0, 1], fps: 4 },
//       walk: { frames: [4, 5, 6, 7], fps: 10 },
//       attack: { frames: [8, 9, 10, 11], fps: 14, loop: false },
//     },
//   });
//
// -------------------------------------------------- modular equipment
//
// A body sheet should be authored EMPTY-HANDED. Weapons and shields are their
// own small sprites positioned at the anchors above, which is what lets one
// animation set serve every weapon a class owns — six Warrior weapons need six
// weapon sprites, not six complete Warrior animation sets.
//
// A single anchor is enough while the hand barely moves (idle, walk), but a
// sword travels through a swing, so an attack animation gives one anchor per
// frame, and may say which frames draw the weapon behind the body:
//
//   attack: {
//     frames: [8, 9, 10, 11], fps: 14, loop: false,
//     hand:       [[14, 8], [22, 10], [26, 16], [20, 18]],
//     handBehind: [true, false, false, false],   // cocked back on the wind-up
//   }
//
// Anchor counts are validated against frame counts, so a mismatch is caught at
// registration rather than showing up as a sword snapping across the screen.
// Armour is NOT separable this way — it deforms with the pose. Armour variants
// mean either a palette swap of the same sheet or a second body sheet.
//
// Only `idle` is required; every other state falls back toward it (see
// STATE_FALLBACK in sprites.js), so a two-animation actor is perfectly valid.
//
// ------------------------------------------------------- converting an actor
//
// When the Warrior sheets exist, the Warrior becomes sheet-backed by adding one
// entry here — no change to combat, scenes, or actors.js:
//
//   // -------------------------------------------------------------- traveller
// The adventurer camped by the arrival point. Cut from the same approved
// master as the Warrior, but from the AXE pose on purpose: the player's
// Warrior carries a sword, and a sword-bearer stood beside them reads as a
// clone rather than as somebody else.
//
// This is the first NPC on the sheet-backed path. town.js now draws NPCs with
// drawCharacter instead of drawActor, so any npc whose sprite id is NOT
// registered here (villager, sage, ...) still renders procedurally exactly as
// before -- registering is what opts one in.
//
//     python3 tools/build_actor_sheet.py --manifest tools/actor_manifests/traveller.json
// The phase-A Warrior look-dev sheet. It predates the hero art that was
// cleared for the Spine rebuild and is registered under its OWN id, never a
// class id, so nothing selects it by picking a class.
registerActorSprite('warrior_sprite', {
  sheet: 'assets/actors/warrior_phase_a.png',
  frameWidth: 24,
  frameHeight: 24,
  columns: 4,
  // The BODY is authored 18px tall — the measured drawn height of the
  // procedural Warrior at scale 1.0, so the two stand eye to eye and the game's
  // scale is untouched. SPECS.warrior.h (26) is a nominal UI number, not a drawn
  // height; authoring to it made the sprite 44% too tall.
  logicalHeight: 26,          // matches SPECS.warrior.h, so nameplates do not move
  animations: {
    idle: { frames: [0], fps: 4 },
    walk: { frames: [1, 2, 3, 4], fps: 6 },
  },
});

registerActorSprite('traveller', {
  sheet: 'assets/actors/traveller.png',
  frameWidth: 24,
  frameHeight: 24,
  columns: 1,
  logicalHeight: 24,
  animations: {
    idle: { frames: [0], fps: 4 },
  },
});

// ---------------------------------------------------------- dev fixture only
// A deliberately plain dummy used to prove the sprite path end to end. It is
// NOT game content and nothing spawns it on its own — the sheet is only fetched
// if something actually draws a 'test_dummy'. Regenerate with:
//     python3 tools/make_test_actor.py
registerActorSprite('test_dummy', {
  sheet: 'assets/actors/dummy.png',
  frameWidth: 24,
  frameHeight: 32,
  columns: 4,
  logicalHeight: 26,
  hand: [18, 17],
  animations: {
    idle:   { frames: [0, 1], fps: 3 },
    walk:   { frames: [4, 5, 6, 7], fps: 10 },
    attack: { frames: [8, 9, 10, 11], fps: 14, loop: false },
  },
});

// ---------------------------------------------------------------- goblin
// The first production actor sheet. Authored at SCREEN resolution, not world
// resolution: combat draws actors at ACTOR_SCALE 1.4, so `scale: 1/1.4` nets
// exactly 1.0 and the art blits 1:1 instead of being upscaled 1.4x with some
// pixel rows doubled and others not.
//
// The 20px body height and the 2px of empty cell under the feet are MEASURED
// off the procedural goblin, not taken from SPECS.goblin.h — that field is a
// rig parameter, not a pixel height, and trusting it made the first cut 50%
// oversized. This way the sprite occupies the same footprint and stands on the
// same ground line as every other actor.
//
// Frames run across then down at 6 columns, so each animation starts on its own
// row: idle 0-3, walk 6-11, attack 12-15, hurt 18-19, down 24-27.
//
// The dagger is drawn INTO the frames rather than attached at a `hand` anchor.
// That convention exists so one Warrior body can serve six weapons; a goblin
// carries one dagger forever, and posing it per frame reads better.
//
// attack runs at 16fps so its 4th frame lands at 0.1875s, matching the 0.18s
// windup in the chase behaviour — the thrust and the damage coincide.
registerActorSprite('goblin', {
  sheet: 'assets/actors/goblin.png',
  frameWidth: 32, frameHeight: 32, columns: 6,
  anchorX: 16, anchorY: 32,
  logicalHeight: 22,        // world units, matches the procedural SPECS.goblin
  scale: 1 / 1.4,
  shadowRadius: 8,
  animations: {
    idle:   { frames: [0, 1, 2, 3], fps: 6 },
    walk:   { frames: [6, 7, 8, 9, 10, 11], fps: 10 },
    attack: { frames: [12, 13, 14, 15], fps: 16, loop: false },
    hurt:   { frames: [18, 19], fps: 10, loop: false },
    down:   { frames: [24, 25, 26, 27], fps: 8, loop: false },
  },
});

// =====================================================================
// PALADIN and ROGUE — the two finished hero classes
// =====================================================================
//
// Registered under the ids the CLASSES table already uses ('paladin',
// 'rogue'), so drawCharacter routes them here and every scene picks them up
// with no further change. The five remaining classes have no sheet and keep
// rendering procedurally, exactly as before.
//
// SCALE. Art is authored at 215px figure height and baked to 28px by
// tools/bake_hero.py. `scale: 1 / ACTOR_ZOOM` then cancels the town camera's
// zoom, so in town the sheet blits 1:1 — no resampling at all, which is the
// case worth optimising because that is where the player spends their time.
// Combat draws 1.4x larger (39px), which is within a pixel of what the already
// shipped warrior_sprite does (40px), so the three heroes stand eye to eye.
//
// EQUIPMENT. Weapon and shield anchors live in assets/actors/*_anchors.json,
// emitted by the SAME bake run that produced the sheets and scaled by the same
// factor. They are deliberately not hand-copied: anchors are authored in source
// pixels, and a sheet baked without its anchors detaches every weapon from
// every fist silently.

const HERO_SCALE = 1 / ACTOR_ZOOM;


// The hand-authored and Gemini-generated hero sheets were cleared for the Spine
// rebuild -- see git tag `pre-spine-reset` for the last state that had them.
// With nothing registered under a class id, gfx/actors.js falls straight through
// to the procedural renderer, which is what every unfinished class already does.
// Re-register here when the Spine-driven sheets exist.


// ------------------------------------------------------------------ heroes
//
// All seven classes, cut from the artist's own model sheets. The source is each
// hero's full FRONT 3/4 illustration reduced to 68px, not the 35px gameplay
// sprite -- with the buffer supersampled 2x there is room for the extra detail,
// and at 35px the characters read as four beige pixels where a face should be.
//
// Idle is a SINGLE static frame. A breathing cycle read as an odd little bounce
// at this size -- the same failure the Warrior's original sheet had, where an
// idle cycle made him rotate on the spot. A character standing still stands still.
//
// The walk is six beats -- contact, lift, pass, twice -- composed from each
// sprite's own pixels. The legs LIFT rather than splay: in a front view a stride
// travels toward and away from the camera, so a sideways splay is not a step,
// and it opens a gap between the legs that the torso encloses. The upper body
// also sways a pixel toward the planted foot, which is what separates walking
// from marching on the spot. Verified zero enclosed holes added by any frame.
//
// HERO_WORLD_H is the height they occupy in logical units. 34 was the old size;
// 1.35x reads as a person rather than a doll against the benches and wells.
const HERO_WORLD_H = 34 * 1.35;

registerActorSprite('warrior', {
  sheet: 'assets/actors/hi/warrior.png',
  frameWidth: 41, frameHeight: 76, columns: 5,
  anchorX: 20, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('mage', {
  sheet: 'assets/actors/hi/mage.png',
  frameWidth: 40, frameHeight: 76, columns: 5,
  anchorX: 20, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('rogue', {
  sheet: 'assets/actors/hi/rogue.png',
  frameWidth: 39, frameHeight: 76, columns: 5,
  anchorX: 19, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('ranger', {
  sheet: 'assets/actors/hi/ranger.png',
  frameWidth: 39, frameHeight: 76, columns: 5,
  anchorX: 19, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('paladin', {
  sheet: 'assets/actors/hi/paladin.png',
  frameWidth: 41, frameHeight: 76, columns: 5,
  anchorX: 20, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('berserker', {
  sheet: 'assets/actors/hi/berserker.png',
  frameWidth: 41, frameHeight: 76, columns: 5,
  anchorX: 20, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});

registerActorSprite('summoner', {
  sheet: 'assets/actors/hi/summoner.png',
  frameWidth: 40, frameHeight: 76, columns: 5,
  anchorX: 20, anchorY: 76,
  logicalHeight: 26,
  scale: (HERO_WORLD_H / 68) / ACTOR_ZOOM,
  shadowRadius: 8,
  animations: {
    idle: { frames: [0], fps: 1 },
    walk: { frames: [4, 5, 6, 7, 8, 9], fps: 12 },
  },
});
