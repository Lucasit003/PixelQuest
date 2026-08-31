# Rogue animation vocabulary

Five reusable body actions. Every frame is authored EMPTY-HANDED — there is no
dagger pixel anywhere in any of these sheets. Both blades are separate sprites
on independent `mainHand` / `offHand` anchors.

| action | sheet | cell | figure heights | serves |
|---|---|---|---|---|
| 4-hit combo | `combo.png` | 232 | 212 / 215 / 196 / 215 | basic attack chain |
| precision lunge | `lunge.png` | 248 | 191 / 215 / 199 / 212 | **Backstab AND Assassinate** |
| dodge roll | `roll.png` | 232 | 185 / **149** / 166 / 215 | evade |
| hurt + down | `hurtdown.png` | 248 | 215 / 189 / 158 / **67** | frames 1–2 hurt, 3–4 down |
| utility throw | `throw.png` | 232 | 193 / 215 / 215 / 209 | thrown items, smoke, utility |

The height column is the quickest proof the BODY carries each action. The roll
compresses to **149** for the tucked ball and the death pose flattens to **67** —
under a third of standing height.

## Reuse, as instructed

Backstab and Assassinate share the LUNGE body. They differ by VFX and timing,
not by frames:

* **Backstab** — lunge at normal speed, standard hit VFX
* **Assassinate** — the same four frames, held longer on frame 1 (the coil) to
  telegraph, then snapped through, with heavier VFX on frame 3

That is the point of a vocabulary: ability identity comes from weapon motion,
effects and timing over shared bodies. Adding an ability should cost a VFX
definition, not a new animation.

`hurtdown.png` is deliberately one strip holding two short animations — hurt is
frames 0–1, down is frames 2–3. Registering them is two `animations` entries
pointing into the same sheet at different frame indices.

## Default daggers

| file | size | grip | tip |
|---|---|---|---|
| `equipment/dagger_main.png` | 17x66 | `[8, 56]` | `[8, 2]` |
| `equipment/dagger_off.png` | 16x50 | `[6, 40]` | `[4, 2]` |

Deliberately different silhouettes — the main is a longer straight double-edged
blade, the off-hand a shorter curved single-edge with a knuckle guard — so which
slot is which stays readable even at 1x.

## Known rough edge

Anchor values were estimated from the poses by eye, not measured from detected
fist positions. Every blade tracks and no frame is broken, but a measuring pass
would tighten the grip on several frames where a dagger sits slightly proud of
the fist. Same caveat as the Paladin's vocabulary.

## Provenance

Generated with Gemini from the approved Rogue, one fresh prompt per action, in
the chat that was already producing images — see `../paladin_gemini/anim/
VOCABULARY_PROMPTS.md` for why that matters. Cut by connected component, baked
at `215 / tallest_frame`, LANCZOS under 3x reduction and BOX beyond it.
