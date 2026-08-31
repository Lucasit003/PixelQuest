# Ranger — class #4, design review

Generated in the same Gemini chat as the Rogue, from a matched-height roster of
the three approved heroes (`00_roster_reference.png`) rather than from a text
description. That is the whole reason he reads as the same hand: the model is
matching three finished characters in front of it, not inventing a fourth from
adjectives.

## Measured against the approved three

All four normalised to 215px figure height first — build is only comparable at
matched height.

| | width | shoulder | chin % | heads tall |
|---|---|---|---|---|
| Warrior | 121 | 80 | — | — |
| Paladin | 107 | 90 | — | — |
| Rogue | 140 | 83 | — | — |
| **Ranger** | **129** | **78** | **18.1** | **5.51** |

Chin at 18.1% and 5.51 heads tall sit dead centre of the house band measured off
the approved art (17–20%, 5.0–5.8 heads).

Shoulder span is the class differentiator, and the Ranger's 78 is the narrowest
of the four — correct for a class whose data says *lean and mobile*. He is
wider overall than the Paladin only because the coat flares; the body inside it
is the slightest of the group after the Rogue.

The chin/head figures are blank for the other three because the neck-detection
heuristic needs a visible neck, and a great helm and a drawn hood both merge the
head into the shoulders. Not worth special-casing; the Ranger's own numbers are
the ones under review.

## Reading of the design

* Hood pushed **back**, face and hair visible — the deliberate opposite of the
  Rogue's drawn hood, which is what separates them at a glance.
* Green over brown layered leather; the Rogue is purple-black, the Warrior red
  and steel, the Paladin white and silver. Four distinct colour identities.
* Long open coat with a split tail — the silhouette cue that survives to 28px.
* Authored **empty-handed**, per the house rule. No bow pixel anywhere.

## Open item: the quiver

The class data calls for *quiver as secondary cue* and the body has none. That
is deliberate rather than an oversight — a quiver belongs in the **equipment**
layer, not baked into the body:

* it should appear when a bow is equipped and vanish when it is not;
* it draws in the `behind` pass, which the equipment system already has;
* baking it into the body would mean regenerating approved art every time the
  quiver design changes.

So the quiver ships as a `back`-slot equipment sprite alongside the bow, and the
body stays as approved here.
