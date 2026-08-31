# Equipment attachment harness — TEST SCAFFOLDING ONLY

Open `dev_equipment.html` from the repo root.

Nothing in `items/` is game art. They are deliberately crude, deliberately
different-sized placeholders whose only job is to prove the anchor maths:
three hammers (30x70, 42x98, 62x138) and two shields (44x56, 78x100).
They are NOT obtainable weapons and must not be shipped.

`paladin_swing.png` is a 4-frame strip packed from existing Paladin frames so
the harness has something to run. It is NOT the real combo animation — those
frames still need generating.

## What the harness proves

One body sheet + one anchor table drives every item:
  * equipment stays locked to the fist across all four frames
  * it ROTATES through the swing via per-frame `handAngle`
  * it layers behind the body on the wind-up (`handBehind`) and in front after
  * three different hammer sizes work unchanged
  * two different shield sizes work unchanged
  * facing left mirrors both position and angle automatically
  * the body renders correctly with no equipment at all

Adding a fourth hammer costs one sprite and one `registerEquipment()` call.
It costs zero character art.
