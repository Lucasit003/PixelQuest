# Dual-wield support

`mainHand` and `offHand` are fully independent slots. Proven in
`dev_dualwield.html`, which repeats ONE standing body in all four cells on
purpose — everything that moves is anchor data, so the test isolates the anchor
system from the art.

| property | mechanism | proof |
|---|---|---|
| position | `anim.mainHand` / `anim.offHand` | hands travel in opposite directions in the same frame |
| rotation | `anim.mainHandAngle` / `anim.offHandAngle` | same anchor point, +90&deg; vs &minus;90&deg; per frame |
| mirroring | `anim.offHandFlip` | off-hand mirrors on the middle two frames, main-hand never |
| body layering | `anim.offHandBehind` | off-hand passes behind the body while main stays in front |
| **draw order** | `anim.slotOrder` | the blades CROSS: red under blue, then red over blue |

## Why `slotOrder` had to exist

`handBehind` splits the body — an item is either behind ALL of the actor or in
front of ALL of it. That is enough for one weapon and not enough for two.
Through a spin the off-hand blade crosses in front of the main-hand blade and
then back behind it, and both are in front of the body the whole time. The
ordering has to exist WITHIN a pass, not just between passes.

    slotOrder: [['offHand','mainHand'],   // off-hand drawn first = underneath
                ['offHand','mainHand'],
                ['mainHand','offHand'],   // they cross - order flips
                ['mainHand','offHand']]

Later in the list = drawn later = on top. A frame only names the slots it wants
to reorder; anything omitted falls back to `cfg.slots`, which itself falls back
to `['shield','offHand','hand','mainHand']`. Existing sword-and-board configs
are untouched.

## Test weapons

`harness/items/test_long_blue.png` and `test_short_red.png` are deliberately
different sizes and colours so which slot is which is obvious at a glance. They
are scaffolding, NOT game art, and must not ship.

## Trap: stale module cache

The dev server sends no cache headers, so the browser will happily keep an old
copy of a module it has already loaded. The symptom is silent — page renders,
nothing errors, and the feature you just wrote does nothing at all. This cost a
long debug: the page was running a `drawActorEquipment` that predated
`mainHand`/`offHand`, so both slots fell through and drew nothing while
`drawEquipped` worked perfectly when called by hand.

Dev harnesses now load their modules with `?v=<timestamp>`. If a dev page ever
seems to ignore a change you just made, check this first.
