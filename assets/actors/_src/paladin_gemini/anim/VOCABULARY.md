# Paladin reusable combat vocabulary

Five body actions. Every frame is authored EMPTY-HANDED — there is no weapon or
shield pixel anywhere in any of these sheets. Ability identity comes from VFX
layered over these bodies, never from baked-in equipment, so a future mace,
sword or legendary hammer swaps in without regenerating character art.

| action | sheet | cell | figure heights | what the body does |
|---|---|---|---|---|
| basic combo | `heavy_side_crush.png` | 264 | 215 / 210 / 189 / 199 | one-handed side swing, drops into the strike |
| heavy | `heavy_forward.png` | 240 | 215 / 201 / 190 / 203 | two-handed, weight travels FORWARD not down |
| shield brace | `shield_brace.png` | 216 | 215 / 204 / 189 / 205 | lowest when braced, forearm forward, torso behind it |
| holy cast | `holy_cast.png` | 216 | 193 / 183 / 191 / **215** | bows, then rises TALLEST — upright and devotional |
| judgment slam | `judgment_slam.png` | 216 | 215 / 191 / **136** / 142 | loses 79px of height into the impact |

The height column is the quickest proof that the BODY carries each action.
Judgment slam compresses hardest because it is the ground-strike; holy cast is
the only one that ends taller than it starts, because it is an invocation rather
than a blow.

## Cell widths differ on purpose

264 for the side crush and 240 for the heavy, because the hammer head swings
57px from the fist and a narrower cell clips the arc precisely where the swing
needs to read. Frame size never feeds gameplay (`src/gfx/sprites.js`), so the
extra width costs nothing.

## Trail

Only the three striking actions declare a `trail`. Brace and cast set it to
zero: nothing is swinging, and a streak on a prayer would read as a mistake.

## Still equipment-independent

Verified in `dev_paladin_vocabulary.html`: every action is shown BODY ONLY with
no equipment registered at all, then again equipped, then at true 1x in both
facings. The hammer and shield are positioned purely by the per-frame `hand` /
`shield` anchors plus `handAngle` / `shieldAngle`, and mirror automatically.

## Known rough edges

* Anchor values were estimated from the poses rather than measured off detected
  fists; they track correctly but a pass with the real fist centroids would
  tighten the slam's last two frames and the cast's raised arm.
* Gemini added small dust puffs at the feet on the brace frames. The cutter drops
  disconnected strays under 2500px, which removes them — dust is VFX and does not
  belong in a body sheet.
