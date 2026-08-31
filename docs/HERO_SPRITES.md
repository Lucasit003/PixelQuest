# Shipping the hero sprites

Warrior, Paladin and Rogue are sheet-backed and registered under the ids the
`CLASSES` table already uses, so `drawCharacter` routes to them everywhere with
no per-scene change. Mage, Ranger, Berserker and Summoner have no art yet and
keep rendering procedurally — registering one of them before its art exists
would silently swap a finished-looking hero for a missing sheet, and there is a
test guarding that.

## The pipeline

    tools/bake_hero.py        source art  ->  shipping sheet + scaled anchors
    tools/pack_hero_sheet.py  per-action sheets -> one grid the engine registers

Run them in that order. `hero_manifest.json` drives the first.

## Scale, and why 28px

Art is authored at **215px** figure height so a face, a buckle and a 1px outline
have somewhere to live. The game draws heroes at **28px**, with
`scale: 1 / ACTOR_ZOOM` in the registration:

| | maths | result |
|---|---|---|
| town | 28 x (1/1.59) x 1.59 | **28.0px — blits 1:1, no resampling at all** |
| combat | 28 x (1/1.59) x 2.23 | 39.2px (1.4x) |

Town is the case worth optimising: it is where the player spends most of their
time and the camera never changes. The combat number lands within a pixel of
what the already-shipped `warrior_sprite` draws (40.1px), so all four stand eye
to eye.

## The trap: anchors are authored in SOURCE pixels

Every weapon position, every trail tip, every grip is authored against the 215px
art. **Bake a sheet without scaling its anchors and every weapon silently
detaches from every fist** — nothing errors, the game just looks wrong.

`bake_hero.py` therefore emits the sheet AND the scaled anchors from one scale
factor, into `assets/actors/*_anchors.json`. They cannot drift apart. Angles are
deliberately NOT scaled: a rotation is scale-invariant, and scaling one is the
kind of bug that looks almost right.

## The other trap: stale module cache

The dev server sends no cache headers, so the browser will keep an old copy of
`spriteCatalog.js` and the new heroes simply will not appear — no error, no
warning. This bit this integration twice. To force it:

    // in the page console
    for (const m of ['src/gfx/spriteCatalog.js','src/gfx/sprites.js']) {
      await fetch('./' + m, {cache:'reload'});
    }
    location.reload();

Dev harnesses (`dev_*.html`) already import with `?v=<timestamp>` to sidestep it.

## Facing: art must face RIGHT

`drawSpriteActor` mirrors only when `facing < 0`, so every sheet must be
authored facing RIGHT. Art that faces left comes out backwards in BOTH
directions — walking right it faces left, and walking left the mirror turns it
right. It looks like a movement bug and is not one.

The Warrior's source sheet faced left. Frames are mirrored once at bake time
rather than corrected at draw time.

**An idle cycle needs frames at the SAME body angle.** The Warrior's sheet
offers two standing poses and they are not the same angle — one is square-on,
the other turned three-quarters. Cycling them made him rock between angles while
standing still, which reads as the character rotating on the spot. His idle is
now ONE front-facing frame, held. A front-facing idle beside a side-facing walk
is fine and matches the Paladin; two body angles inside one idle is not.

To check a sheet quickly, measure where the upper-body mass sits relative to the
figure's centre. Positive means it faces right:

    warrior  +0.09 .. +0.16     paladin  +0.04     rogue  +0.03 .. +0.08

## Known gaps

* **Warrior has idle and walk only.** The empty-handed sheet's attack rows are a
  level jab rather than a swing, and his swing frames were never cut. Attack
  falls back to idle, which is the documented fallback rather than a broken pose.
* **Equipment is not yet attached in-game.** The anchors are baked and correct,
  but no scene passes `equipped` to `drawCharacter` yet, so weapons still come
  from the procedural weapon layer. That is the next step, not a defect.
* **The Paladin changes view between locomotion and combat.** His idle and walk
  come from the approved 16-frame sheet and are FRONT-facing; his attack actions
  are side-facing. He therefore turns as he swings — the same class of problem
  the Warrior had, at lower severity because the attack reads as a deliberate
  turn-and-strike. Fixing it means regenerating his idle/walk in profile, which
  is approved art, so it is flagged rather than changed.
* `goblin` still carries `scale: 1 / 1.4`, whose comment promises a 1:1 blit.
  That was true before `ACTOR_ZOOM` existed; it now draws at 1.59x. Pre-existing,
  flagged, not touched here.
