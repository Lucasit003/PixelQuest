# Ranger equipment — the bow mechanism

The Warrior, Paladin and Rogue all needed the same thing from the equipment
layer: put a rigid object in a fist and rotate it. The Ranger is the first class
that needs something the layer could not already do, and that is the reason he
was built fourth.

A bow is not one rigid object. It is two rigid limbs joined by a string whose
shape is a function of *how far he has drawn it*. And a bow is the first weapon
that has to tell the combat layer where a projectile is born.

## What was added

### 1. `itemPointToWorld` (equipment.js)

Where a point on an item image lands in world space. `weaponTrail.js` already
did this privately for the swing tip; the bowstring needs it for two limb tips,
and the shot origin needs it again. Three copies of a subtle transform is how a
trail silently drifts away from the weapon it belongs to, so it is now one
exported function that lives next to the draw call it has to agree with.

### 2. `bowString.js`

The bow sprite carries **no string**. It carries `limbTop` and `limbBottom`, and
the string is stroked limb → nock → limb every frame, where the nock is wherever
his drawing hand actually is.

Baking the string into the sprite would have been correct on exactly one frame
of the four. Computing it means:

* the string bends by exactly the amount he has drawn, on every frame, including
  half-draws and holds nobody authored;
* a longer bow flexes further with no extra authoring, because its limbs are
  further apart;
* a bow tier changes look through `style`, not through geometry.

This is the same argument `weaponTrail.js` makes about swing streaks, applied to
a second kind of computed geometry.

### 3. `shotOrigin` — the projectile origin

Returns the world point an arrow leaves from and the direction it leaves in.

The origin is the **nock**, not the grip. An arrow spawned at the fist appears to
pass through the riser, and at 28px that reads as the arrow starting behind the
character.

The direction is derived from the string's own geometry — the line from the nock
through the midpoint of the two limb tips — so it stays correct when he aims up
or down without anyone authoring a separate aim angle.

## What was NOT added

No engine change was needed for the anchors themselves. `attachmentAnchor(cfg,
actor, slot)` was already generic over the slot name — that is what made
dual-wielding free for the Rogue — so `nock` and `muzzle` are just slot names
the animation authors. A slot with no entry in `actor.equipped` is never drawn,
so a pure-geometry slot costs nothing.

## Slots the Ranger uses

| slot | drawn? | purpose |
|---|---|---|
| `mainHand` | yes | the bow, rotated to the aim angle |
| `offHand` | yes | the drawing hand — carries the arrow's nock end |
| `back` | yes, `behind` pass | the quiver |
| `nock` | no | geometry only: where the string is pinched |
| `muzzle` | no | geometry only: fallback shot origin |

The quiver lives here rather than in the body art on purpose: it appears when a
bow is equipped and vanishes when it is not, and changing its design never means
regenerating approved character art.
