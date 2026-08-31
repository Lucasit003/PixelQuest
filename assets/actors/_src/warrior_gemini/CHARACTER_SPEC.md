# Pixel Quest — Warrior character spec

Portable brief. Everything needed to reproduce this character, and to design the
other six classes so they look like the same artist made them.

---

## 1. The game this lives in

- 2D top-down action RPG, hand-authored pixel art.
- **Native render target is 480 × 270 pixels — that is the entire screen.**
- The player character occupies roughly **18–21 px wide × 29 px tall on screen**.
  Town camera zoom 1.6, combat 1.4. That is the whole canvas for a character.
- 3/4 top-down view — characters seen slightly from above and in front.
- Environment palette: desaturated blue-grey stone, muted greens, warm lamp
  pools, cool dusk ambient. Characters need to separate from **both** blue-grey
  stone (mean luminance ~87) and green grass (mean ~61).
- Every object carries a hard dark outline and a soft elliptical contact shadow.

---

## 2. Character identity

**The Warrior — a seasoned wandering swordsman.**

He has fought enough battles to have replaced and repaired pieces of his kit, so
nothing matches perfectly. His equipment is practical, not ceremonial. He is the
visual *middle* of the roster: capable, grounded, martial. Mid-20s to mid-30s,
experienced, determined. Not royal, not a generic guard, not a brute.

He is **not** wearing a matched suit of plate — that visual territory is reserved
for the Paladin.

---

## 3. Physical description, head to toe

**Head — no helmet.** This is the single most important choice. Auburn/chestnut
hair, swept and slightly tousled, falling to just below the ears with a visible
fringe. Full face on show: brow, eyes, nose, jaw. Warm skin. A determined,
level expression — not angry, not smiling.

**Neck and shoulders.** A crimson cowl or scarf wraps the throat and sits over
the collarbone. Below it the shoulders slope out from the neck through a visible
trapezius before reaching the shoulder line — the shoulders start *below* the
jaw, never bracketing the head.

**Shoulders.** **One large steel pauldron**, rounded, with a lighter rim
highlight. The opposite shoulder is lighter — cloth or a smaller plate. This
asymmetry is a signature and should be preserved.

**Torso.** A steel breastplate over a dark gambeson/undershirt. The plate follows
the chest and **tapers toward the waist** — never a slab or a circle. Dark cloth
shows at the sides and under the arms so the armour reads as something *worn*
rather than as the body itself.

**Waist.** A leather belt with a **gold buckle** — the one warm metal accent.
Below it a **crimson tabard** hangs to mid-thigh.

**Cape.** Crimson, hanging from the shoulders down the back, breaking the
silhouette on one side and trailing in motion.

**Arms.** Steel or leather bracers, chunky gauntlets. The elbow sits at waist
height; the hand hangs at upper-thigh height when relaxed.

**Legs.** Dark trousers with steel greaves over the shins. **Brown leather
boots**, slightly oversized for readability.

**Weapon.** A broad arming sword / compact longsword: readable blade with a
slight taper, a real crossguard, a wrapped grip, a pommel. Dark blade edge,
mid-steel body, one narrow highlight — never a flat white stick.

---

## 4. Proportions — measured, not estimated

Taken off the game's own title-screen artwork, as fractions of total body height:

| Landmark | Position |
|---|---|
| top of head | 0% |
| chin | **20%** → the figure is **5 heads tall** |
| shoulder line | 28% |
| widest point (the pauldron) | 31% |
| waist / belt | 52% |
| knee | 76% |
| feet | 100% |

Supporting numbers: head about **50–60% of shoulder width**; legs occupy the
**lower third**; elbow at waist height; hand at upper thigh; centre of gravity
about **54%** down the figure.

**Target: stylized realistic adult.** Two directions were tried and rejected —
worth stating explicitly so they aren't repeated:

- ❌ **Too human** — 3.0–3.8 heads, head 47–68% of shoulder width. Read as "a
  small realistic person squeezed into a tiny canvas."
- ❌ **Too chibi** — 2.8–3.1 heads, head 86% of shoulder width, big-head
  proportions. Read as "toy-like, blocky, mascot."

The approved look sits between them, nearer the realistic end, at ~5 heads.

---

## 5. Palette

Material families, not "one colour per class." Sampled from the source art;
treat as a starting ramp rather than gospel.

| Material | Dark | Mid | Light |
|---|---|---|---|
| Outline | `#0A0A10` near-black, slightly warm | — | — |
| Hair (auburn) | `#4A2A18` | `#8A4E28` | `#B06E3C` |
| Skin | `#9A6042` | `#D39981` | `#F0C49C` |
| Steel | `#3E4250` | `#747C8C` | `#C6B9B1` → `#DBD7CE` |
| Crimson cloth | `#4A1F1E` | `#8E2E2C` | `#B44438` |
| Leather | `#2C1C12` | `#5C3A1E` | `#7E5247` |
| Gold | `#8D6043` | `#C29A44` | `#D8A840` |

Rules:
- Crimson is an **accent** — cowl, cape, tabard. Never a red torso, never a chest
  emblem or logo.
- Steel is a **material**, not an identity. Do not let the figure become all grey.
- Dark cloth and leather carry the visual foundation.
- Gold appears **once** (the belt buckle) plus the sword furniture.
- Budget roughly **12–20 colours**. No anti-aliasing, no semi-transparent pixels.

A sampled swatch is saved as `04_palette_swatch.png`.

---

## 6. Style rules

- Hard 1px dark outline. No anti-aliasing. No gradients. No blur.
- Deliberate pixel clusters — if a detail cannot survive at 29px tall, delete it.
- Consistent light direction (upper-left).
- Silhouette must read with the weapon removed. Class identity comes from
  **silhouette + proportion + posture + clothing shape**, with colour and weapon
  as secondary reinforcement.
- Negative space is what makes a small sprite readable: a gap between arm and
  torso, a gap between the legs, a visible neck notch.

---

## 7. Equipment must be separable

The engine attaches weapons and shields at per-frame anchor points, so:

- **Bodies are authored EMPTY-HANDED.** Hands drawn open or as a closed fist
  around an invisible hilt, clearly visible and held away from the torso.
- **Swords and shields are their own small sprites.** Twelve swords = twelve
  sprites, not twelve animation sets.
- **Armour is NOT separable this way** — it deforms with the pose. Armour tiers
  are either a palette swap of the same sheet or a second body sheet.

---

## 8. Animation set

`idle`, `walk`, `attack`, `heavy`, `cast`, `hurt`, `dodge`, `jump`, `down`.
Only `idle` is strictly required; the others fall back toward it.

Four attack arcs are already generated: **overhead chop**, **horizontal sweep**,
**rising uppercut**, **downward diagonal** — 4 frames each.

---

## 9. Generation notes that actually matter

If you are generating frames with an image model:

1. **Ask for a white motion trail following the blade path.** This is the single
   thing that made attack animation work. Describing an arc in words returns a
   static pose repeated four times; asking for a *trail* gives the model
   something to draw, and the blade angles fall into place around it. Three
   attempts failed before this; the first attempt with it succeeded.
2. **Ask for a flat magenta `#FF00FF` background.** Keys out cleanly, and it
   suppresses the label text, panel dividers and drop shadows the model
   otherwise bakes in.
3. **One clear instruction per generation.** Long multi-part prompts degrade
   badly.
4. Image models hold *character consistency* well and *choreography* poorly.
   Expect to specify motion as drawable evidence, not as described movement.
5. Costume drifts slightly between generations — a consistent set should come
   from a single generation rather than being accumulated across sessions.

---

## 10. Deriving the other six classes

All seven inherit **the same skeleton, the same head and hand scale, the same
palette discipline, the same lighting and outline language**. They diverge
through equipment, clothing shape and posture — not through different anatomy.

| Class | Silhouette territory | Notes |
|---|---|---|
| **Warrior** | medium-heavy, balanced, grounded | the baseline — this document |
| **Paladin** | tallest and heaviest, full plate, large shield | owns pristine matched armour; ivory/pale steel/warm gold |
| **Berserker** | broadest upper body, top-heavy, least armour | fur and rough leather, wild hair not a helm; dark iron, burnt red |
| **Rogue** | smallest and narrowest, angular, asymmetric | dark fitted leather, short hood, partial face; charcoal, muted violet |
| **Ranger** | lean and mobile, long curved elements | layered leather, green cloth, quiver as secondary cue |
| **Mage** | vertical, robe-heavy, elegant | deep hood or arcane headwear, geometric staff; indigo/violet |
| **Summoner** | organic, asymmetric, uncanny | ritual cloth, charms, crooked staff; deep teal/turquoise |

Two pairs need deliberate separation:
- **Mage vs Summoner** — Mage's magic is engineered and controlled (clean,
  geometric); Summoner's is alive and ancient (organic, asymmetric).
- **Warrior vs Paladin vs Berserker** — technique vs defence vs raw force. The
  Warrior must stay mid-weight so the other two have room.

Constraint that binds all of them: **stay humanoid.** Small differences in height
and build are wanted. Extreme silhouette gimmicks — triangle mage, rectangle
paladin, giant inverted-triangle berserker — are not.
