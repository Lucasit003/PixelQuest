# The four prompts, verbatim

Every one attaches `ref.png` (approved idle + approved impact pose) and demands
EMPTY HANDS. Kept short deliberately — long multi-part prompts degrade badly
with this model, and the four-phase brief had to be cut down before it worked.

## A. HEAVY ATTACK  (4 frames)
Draw this exact pixel-art Paladin as a 4-frame HEAVY overhead-to-forward hammer
strike, one horizontal row, facing right, flat magenta background, same armour
and colours. EMPTY-HANDED in every frame - no hammer, no shield, just closed
fists. This is SLOWER and MORE COMMITTED than a normal swing: both arms work
together and his whole weight goes forward. Frame 1: deep crouch, both fists
drawn back high above his rear shoulder, knees bent, weight fully on the rear
leg. Frame 2: torso uncoiling, both fists starting down and forward, front foot
planting hard. Frame 3: full commitment, both arms driven down and forward past
his knee, front knee deeply bent, rear leg straight out behind, body low and
far forward. Frame 4: hunched over the follow-through, fists low, head down,
still recovering. Make the four poses dramatically different. No text, no
labels, no shadows.

## B. SHIELD BRACE  (3 frames)
Draw this exact pixel-art Paladin as a 3-frame DEFENSIVE SHIELD BRACE, one
horizontal row, facing right, flat magenta background, same armour and colours.
EMPTY-HANDED - no shield, no weapon, just closed fists. His left forearm is
raised across his front as though a large shield were strapped to it. Frame 1:
starting to drop, knees bending, left forearm coming up and forward. Frame 2:
fully braced - centre of gravity LOW, feet spread wide, left forearm forward
and vertical, torso tucked in behind it, head lowered, right fist held back at
his hip. Frame 3: absorbing an impact - pushed back slightly, rear foot sliding,
shoulders compressed, still low. He must read as DEFENDING even with no shield
drawn. No text, no labels, no shadows.

## C. HOLY CAST  (4 frames)
Draw this exact pixel-art Paladin as a 4-frame HOLY INVOCATION, one horizontal
row, facing right, flat magenta background, same armour and colours.
EMPTY-HANDED - no weapon, no shield, no effects, no glow, no light, just closed
fists. He is DISCIPLINED AND DEVOTIONAL, a knight praying, NOT a wizard casting.
He stays UPRIGHT and STILL - no wide theatrical arms. Frame 1: standing tall,
head bowing slightly, right fist coming to his chest. Frame 2: head bowed, right
fist pressed flat against his chest over the heart, left arm straight down at
his side. Frame 3: head lifting, chin up, chest opening, right arm raising
straight up beside his head. Frame 4: standing at full height, head up, right
arm fully raised overhead, back straight, resolute. No text, no labels, no
shadows, no magic effects.

## D. JUDGMENT SLAM  (4 frames)
Draw this exact pixel-art Paladin as a 4-frame OVERHEAD SLAM into the ground,
one horizontal row, facing right, flat magenta background, same armour and
colours. EMPTY-HANDED - no hammer, no shield, just closed fists. Frame 1: huge
anticipation - stretched tall, up on the balls of his feet, both fists raised
high above his head, back arched, looking up. Frame 2: driving down hard, arms
coming down in front of him, knees starting to bend, weight dropping. Frame 3:
COMPRESSED IMPACT - crouched very low, both fists smashed down at ground level
in front of his feet, knees deeply bent, head down, body compressed into the
smallest pose of the set. Frame 4: rising out of it, arms still low, knees
straightening, head starting to lift. Make frame 1 the tallest pose and frame 3
the shortest. No text, no labels, no shadows.

---

## Status

NOT YET GENERATED. Attach `_reference_for_generation.png` (the approved idle +
walk frame on magenta) and send one prompt per fresh chat.

## How to actually get an image out of Gemini

* **One fresh chat per generation.** A chat that has answered once settles into
  art-director mode and will keep writing critique instead of drawing.
* **Use the single-pose reference**, not a sheet showing two poses. Given two
  poses Gemini reads them as "candidate designs" and reviews them — it said so
  in as many words: *"candidate knight sprite designs"*.
* **Return does not submit.** Click the button whose aria-label contains "send".
* The composer's Y position differs between the fresh-chat layout (~438) and
  the in-conversation layout (~679).
* The UI wedges showing a stop square and refuses new messages; a page reload
  clears it.
* To get the file out, use Gemini's own **"Download full size image"** button.
  Page-initiated downloads get silently blocked partway through a session, and
  Gemini's CSP blocks fetch to a local receiver.

## Once the four sheets exist

`tools/` has no bespoke step for these — reuse what built the crush:
cut by connected component (a column cut severs an extended limb), bake at
`215 / tallest_frame` with LANCZOS, then add a `registerActorSprite` block per
action and point `dev_paladin_attacks.html` at it. That page is cfg-driven, so
each new action appears in the review sheet automatically.
