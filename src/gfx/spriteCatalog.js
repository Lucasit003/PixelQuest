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
//   registerActorSprite('warrior', {
//     sheet: 'assets/actors/warrior.png',
//     frameWidth: 32, frameHeight: 32, columns: 8,
//     logicalHeight: 26,           // keep the procedural SPECS height
//     hand: [22, 17],
//     animations: {
//       idle:   { frames: [0, 1, 2, 3], fps: 6 },
//       walk:   { frames: [8, 9, 10, 11], fps: 10 },
//       attack: { frames: [16, 17, 18, 19], fps: 14, loop: false },
//       heavy:  { frames: [24, 25, 26, 27], fps: 12, loop: false },
//       hurt:   { frames: [32], fps: 1 },
//       down:   { frames: [33, 34], fps: 6, loop: false },
//     },
//   });
//
// A pet or wildlife actor works identically — a dog providing idle/walk/sit/
// sleep/bark just names those animations; the extra ones are played by asking
// for that state.

import { registerActorSprite } from './sprites.js';
import { ACTOR_ZOOM } from './actorScale.js';

// ------------------------------------------------------ Warrior, phase A
// Registered as 'warrior_sprite', NOT 'warrior' — the procedural Warrior stays
// the default everywhere. To look at this one, point an actor's sprite id here
// (PQDev or `scene.p.sprite = 'warrior_sprite'`); nothing switches on its own.
//
// Frames are real poses cut from the approved master (assets/warrior weaw.png)
// by tools/build_actor_sheet.py — regenerate with:
//     python3 tools/build_actor_sheet.py --manifest tools/actor_manifests/warrior_phase_a.json
//
// Phase A scope: this validates the pipeline, it is not finished art.
//   * jump / dodge / hurt / down have no pose in the master yet, so they fall
//     back toward idle until real frames are generated.
//   * the sword and shield are BAKED IN here because the master's action poses
//     hold them. Production frames must be authored empty-handed so the
//     per-frame `hand` / `shield` anchors can carry equipment instead.
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

// -------------------------------------------------------------- traveller
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

// All actions packed into one 4-column grid by tools/pack_hero_sheet.py.
// idle 0-3, walk 4-7, then the reusable combat vocabulary.
//
// ATTACK is the approved Heavy Side Crush. The forward punch that shipped in
// the original 16-frame sheet is deliberately NOT here: it was superseded
// because the arm extended while the hips, knees and stance barely moved.
registerActorSprite('paladin', {
  sheet: 'assets/actors/paladin.png',
  frameWidth: 34, frameHeight: 29, columns: 4,
  anchorX: 17, anchorY: 29,
  logicalHeight: 26,          // SPECS.paladin.h, so nameplates do not move
  scale: HERO_SCALE,
  shadowRadius: 7,
  animations: {
    idle:   { frames: [0, 1, 2, 3], fps: 6 },
    walk:   { frames: [4, 5, 6, 7], fps: 10 },
    attack: { frames: [8, 9, 10, 11], fps: 14, loop: false },
    heavy:  { frames: [12, 13, 14, 15], fps: 11, loop: false },
    brace:  { frames: [16, 17, 18, 19], fps: 12, loop: false },
    cast:   { frames: [20, 21, 22, 23], fps: 10, loop: false },
    slam:   { frames: [24, 25, 26, 27], fps: 12, loop: false },
  },
});

registerActorSprite('rogue', {
  sheet: 'assets/actors/rogue.png',
  frameWidth: 32, frameHeight: 29, columns: 4,
  anchorX: 16, anchorY: 29,
  logicalHeight: 25,          // SPECS.rogue.h
  scale: HERO_SCALE,
  shadowRadius: 6,
  animations: {
    idle:   { frames: [0], fps: 4 },
    walk:   { frames: [0, 1, 2, 3], fps: 10 },
    attack: { frames: [4, 5, 6, 7], fps: 16, loop: false },
    lunge:  { frames: [8, 9, 10, 11], fps: 16, loop: false },
    dodge:  { frames: [12, 13, 14, 15], fps: 14, loop: false },
    hurt:   { frames: [16, 17], fps: 10, loop: false },
    down:   { frames: [18, 19], fps: 8, loop: false },
    cast:   { frames: [20, 21, 22, 23], fps: 12, loop: false },
  },
});
// ------------------------------------------------------------------ Warrior
// Registered as 'warrior' (not 'warrior_sprite'), so the CLASSES table picks it
// up and the player's Warrior finally uses the approved art everywhere.
// 'warrior_sprite' above is left alone -- other things may still point at it.
//
// Cut from 03_sheet_emptyhanded_v2, the EMPTY-HANDED pass. The armed sheet has
// the sword and shield painted into every frame, which would make an equipment
// shop impossible; this one keeps the body weaponless like the other two.
//
// FACING. That sheet's walk faces LEFT. The engine mirrors only when
// facing < 0, so it requires art that faces RIGHT — unmirrored art came out
// backwards in BOTH directions. The frames are mirrored once at bake time
// rather than corrected at draw time.
//
// IDLE is ONE front-facing frame, held static. The sheet offers two standing
// poses and they are not the same body angle -- one is square-on, the other is
// turned three-quarters. Alternating them made the Warrior rock between angles
// while standing still, which reads as the character rotating on the spot. One
// frame, no cycle.
//
// Only idle and walk: that sheet's attack rows are a level jab, not a swing,
// and the Warrior's swing frames were never cut. Attack falls back to idle
// until they are, which is the documented fallback rather than a broken pose.
// Row 0 is the side view, row 1 the back, row 2 the front -- see
// tools/pack_directions.py, which writes assets/actors/warrior_dirs.json with
// these indices. A `*Up` / `*Down` animation is picked automatically when the
// actor carries dir: 'up' / 'down'; without them he simply keeps the side view.
registerActorSprite('warrior', {
  sheet: 'assets/actors/warrior.png',
  frameWidth: 26, frameHeight: 31, columns: 5,
  anchorX: 13, anchorY: 31,
  logicalHeight: 26,          // SPECS.warrior.h
  scale: HERO_SCALE,
  shadowRadius: 7,
  animations: {
    idle: { frames: [0], fps: 1 },      // single pose: a cycle here rotates him
    walk: { frames: [1, 2, 3, 4], fps: 10 },
    idleUp: { frames: [5], fps: 1 },
    walkUp: { frames: [6, 7, 8, 9], fps: 10 },
    idleDown: { frames: [10], fps: 1 },
    walkDown: { frames: [11, 12, 13, 14], fps: 10 },
  },
});
