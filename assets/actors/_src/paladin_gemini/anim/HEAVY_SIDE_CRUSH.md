# Heavy Side Crush — the Paladin's basic hammer attack

`heavy_side_crush.png` — 4 frames, 264 x 219 cells, 1056 x 219 total.

Generated with Gemini from the approved Paladin as reference, EMPTY-HANDED.
No weapon or shield pixel exists anywhere in this sheet, so any future hammer,
mace, or shield swaps in without regenerating a single frame of character art.

## The body carries the attack

Figure heights, in order: **215 / 210 / 189 / 199**. The lunge is 26px shorter
than the wind-up — the Paladin genuinely drops into the strike rather than the
hammer swinging past a static man. Between frames the shoulders, elbows, hips,
knee bend, stance width, centre of gravity and cape all change.

| frame | phase | what the body does |
|---|---|---|
| 1 | LOAD | weight on rear leg, feet wide, fist cocked back past his centreline, torso twisted away |
| 2 | ACCELERATION | hips and shoulders driving forward, fist swinging low at the waist, rear heel lifting, cape trailing |
| 3 | IMPACT | full reach, front knee deeply bent, rear leg extended, weight over the front foot, cape thrown forward |
| 4 | FOLLOW-THROUGH | fist carried past and dropping, shoulders still rotated, still leaning forward |

## The head arcs further than the hand

    fist   (61,62) -> (77,112) -> (188,112) -> (184,130)   ~130px travelled
    head   (27,17) -> (21,124) -> (205,167) -> (238,148)   ~300px travelled

That 2.3x difference is what makes the hammer read as heavy. It comes entirely
from `handAngle` sweeping counter-clockwise through ~215 degrees while the
anchor moves only a little.

**The angles are written as one descending run (-35, -110, -195, -250) rather
than wrapped into 0-360.** Wrapped, the trail interpolates the short way round
and cuts a chord straight through his chest; unwrapped, it follows the arc the
head actually travels.

Cells are 264px wide, not 164: the head swings 57px from the fist, and a
narrower cell clips the arc exactly where the swing needs to read. Frame size
never feeds gameplay (see `src/gfx/sprites.js`), so the width costs nothing.

## Shield reacts, it is not glued on

Tucked in on the load, opening as the torso turns, shoved back and out by
inertia at impact, returning toward guard. Restrained on purpose — he is
trained, not flailing.

## The trail is not part of the hammer

`src/gfx/weaponTrail.js` COMPUTES the arc from where the hammer's `tip` actually
was on previous frames. Nothing is painted onto the sprite, so the streak never
shows up while the hammer hangs at his side or sits in an inventory slot, and a
longer weapon throws a longer arc for free. Intensity is authored per frame
(`trail: [0, 0.4, 1, 0.55]`) — none on the wind-up, peak at impact.

## Provenance / regenerating

Source render: Gemini, reference `ref_body.png` (the approved idle + walk frame
on magenta). Cut with connected-component labelling — a column-valley cut
severed the impact frame's extended fist. Baked at 0.4004x with LANCZOS (2.5x
reduction stays under the 3x point where LANCZOS starts painting the matting
halo; see `tools/bake_props.py`).
