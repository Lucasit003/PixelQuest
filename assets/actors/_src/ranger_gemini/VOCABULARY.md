# Ranger animation vocabulary

The governing rule, from the brief: **do not draw a new body animation for every
ability.** Four shot families carry every bow ability the class will ever have;
identity comes from the projectile, the VFX, the timing and the sound.

## The four shot families

| family | body sheet | serves |
|---|---|---|
| **STANDARD SHOT** | `shot.png` | basic shot, elemental arrows, debuff arrows, **multishot** |
| **POWER DRAW** | `power.png` | power shot, piercing shot, signature precision shot |
| **UPWARD SHOT** | `skyshot.png` | rain of arrows, any lobbed ability |
| **MOBILE SHOT** | `mobileshot.png` | evasive shot, backstep shot |

How the abilities differ inside a family:

* **Multishot** is the STANDARD body with a fan of projectiles and a wider
  release VFX. No new frames — the brief says not to invent a large unique body
  unless necessary, and a fan is a projectile pattern.
* **Piercing shot** is the POWER body held one beat longer with a narrow,
  concentrated arrow VFX and a hard linear trail.
* **Aim / hold draw** is the STANDARD body's FULL DRAW frame plus a two-frame
  micro-sway — not a generated animation. The brief wants it alive but not
  unstable, which is exactly a ±1px loop.
* **Cancel draw** is the DRAW stage played backwards into combat idle, with the
  `arrow` anchor nulled. No frames, no projectile.

## Phase 1 — the required core

| # | action | frames | source |
|---|---|---|---|
| 1 | combat idle | 4 | generated — staggered, knees bent, bow arm low and forward |
| 2 | exploration idle | 4 | generated — relaxed, weight on one leg |
| 3 | walk | 6 | generated |
| 4 | run | 6 | generated |
| 5 | basic shot | 7 | STANDARD SHOT: 4 core frames generated, 3 stages to add |
| 6 | aim / hold | 2 | **derived** from the FULL DRAW frame |
| 7 | hurt light + heavy | 4 | generated, one strip |
| 8 | death | 4 | generated |
| 9 | quickstep / backstep | 4 | generated |

Deferred to Phase 2 and 3 exactly as the brief orders them.

## The shot, stage by stage

Seven frames, and the arrow's lifetime is anchor data rather than art:

| frame | stage | `arrow` anchor |
|---|---|---|
| 0 | READY — bow rises, draw hand moves toward the quiver | none |
| 1 | NOCK — arrow reaches the string | present |
| 2 | DRAW — draw hand travels back, bow starts to bend | present |
| 3 | FULL DRAW — one brief readable frame | present |
| 4 | RELEASE — string snaps forward | none |
| 5 | FOLLOW THROUGH — bow arm still extended, draw hand drifting back | none |
| 6 | RECOVERY — returning to combat idle | none |

"Do not make the arrow appear before the nock stage; do not have it remain
attached after release" is enforced by frames 0 and 4–6 having no `arrow`
anchor at all. `attachmentAnchor` returns null and nothing draws — the rule is
structural, not a timing convention someone has to remember.

The projectile spawns at frame 4 from `shotOrigin`, which is the nock on the
string, never the Ranger's centre, feet, or a guessed hand offset.

## Mirroring

The engine mirrors when `facing < 0`, and anchors, angles and the computed
string all mirror with it. The quiver is deliberately allowed to swap sides:
it is worn on the back, so the side it appears on IS the side he is facing away
from. Nothing about it needs continuity across a turn.
