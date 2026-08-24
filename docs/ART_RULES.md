# Pixel Quest — art rules

Derived by measuring the assets already in the game, not from generic pixel-art
convention. Anything generated for this project should match these, and where a
good existing asset covers the need it should be used rather than replaced.

## Read this first: two rendering worlds

Pixel Quest draws in **two incompatible ways**, and which one an asset belongs to
decides everything about how it must be produced.

**Procedural** — the player, all NPCs, all enemies and all pets are drawn from code
in `gfx/actors.js` using `rect()` and `disc()` primitives against a named palette.
There are **zero image loads** in that file. A generated character sprite cannot be
dropped in; it would need a sprite-rendering path that does not exist yet.

**Sprite** — the world. Props, ground tiles, buildings, interiors and wildlife are
PNGs blitted 1:1. This is where generated art can go today.

## Canonical scale (world units)

One world unit ≈ one screen pixel at zoom 1.0. Gameplay camera is **ZOOM 1.6**;
internal resolution **480×270**, so the player sees ~300×169 world units.

| Class | Height | Examples |
|---|---|---|
| Player / NPC | ~24 | `SPECS[*].h × scale` in `gfx/actors.js` |
| Ground detail | 8–18 | `pebbles_01` 11×10, `bush_04` 18×10 |
| Small plant | 16–20 | `flowers_blue` 16×16, `grass_tuft_01` 17×18 |
| Crop | 20–28 | `crop_cabbage` 22×20, `crop_wheat_01` 20×28 |
| Furniture | 13–40 | `bench_01` 32×20, `lamppost_twin` 26×38, `topiary_round` 24×40 |
| Sapling / shrub | 22–34 | `tree_sapling` 22×34, `bush_big` 34×32 |
| Mid tree | 38–52 | `tree_young` 26×44, `tree_blossom_white` 43×52 |
| Canopy tree | 60–66 | `tree_oak_broad` 75×60, `tree_rooted` 50×66 |
| Building | 78–100 | `POTION 113×80`, `GUILD 122×78`, `FOUNTAIN 111×100` |

Full range across 288 wired props: width 5–176, height 8–200.

**The load-bearing ratio:** a canopy tree is ~2.5× the player's height and a building
~3.5×. A new asset that breaks this reads wrong immediately, even when it looks good
in isolation.

## Perspective and anchoring

- **Elevated three-quarter top-down.** You see the ground plane and the *face* of
  tall things — buildings show their frontage, fences show their rails, a lamp shows
  its post side-on.
- **Everything is bottom-centre anchored.** A sprite is drawn at
  `(cx - w/2, baseY - h)`. The bottom edge is where the object meets the ground, and
  it is what the depth sort uses.
- **No rotation, only horizontal mirroring.** Anything that must run north–south
  needs its own pre-rotated cut — the `_ns` suffix convention (`myst_wall_long_ns`).

## Depth, shadow, light

- Entities are y-sorted per frame; larger y draws in front.
- Ground-flat things (soil, paving, pads) go in `groundDecor` and draw beneath
  everything. Standing things go in `decor`.
- Contact shadow is a small dark ellipse under the base, ~28% of sprite width by
  default. Omit it on dark ground — a shadow on tilled soil is invisible.
- Light source is ambient/overhead; there is no single hard sun direction, so avoid
  baking a strong directional shadow into a sprite.
- Night is a post-pass: the frame is multiplied by `[90,124,186]` and lights *erase*
  holes in that darkness. Art therefore needs no night variant, but very dark art
  disappears after dusk.

## Colour

Palettes are named-key objects (`gfx/actors.js` `PALETTES`) — `k` outline, `m` mid,
`l` light, `d` dark, `s` skin, plus accents. Characteristics of the existing set:

- Deep, near-black desaturated outlines (`#1b1526`, `#120c28`) — never pure black.
- Mid-saturation bodies with a clear light/mid/dark triad; no gradients.
- One saturated accent per subject (`#c0463c` warrior red, `#c2b2ff` mage violet).
- Environment is more muted than characters, so actors read against it.
- **Quadrant colour coding is a design rule, not decoration:** NW blue/white,
  NE yellow/white, SW white/blue, SE red/yellow.

## Transparency and cleanliness

- Real alpha is mandatory. A JPEG can never have it; a "transparent" preview may be
  a checkerboard baked into RGB — check `PIL im.mode` and corner alpha before use.
- **The recurring defect is a pale desaturated matting fringe** on the alpha edge.
  Invisible on one prop, it draws a white grid when tiled. Detect with
  `visible AND brighter than the body AND low saturation`; the saturation test is
  what stops the repair eating real highlights.
- Tiles that form a surface must be fully opaque with wrapping edges — verify
  top-vs-bottom and left-vs-right mismatch both measure 0.00.

## Production pipeline

```
props      catalogue sheet → tools/sheetcut.py index → cut → assets/props/_src/
              → DECOR_SIZE entry in town/props.js → tools/bake_props.py
              → assets/props/                                   (draw size)

buildings  assets/buildings/_src/  → tools/bake_props.py --buildings
              → assets/buildings/                               (draw size)
           sizes come from the *_W/*_H constants in town/buildings.js
```

The bake picks its filter by reduction factor: LANCZOS up to 3x, BOX beyond.
LANCZOS overshoots, and at the 4-6x the buildings need that overshoot becomes a
white rim around every silhouette. The resize also runs in float — quantising
premultiplied colour to bytes first drives low-alpha pixels to white.

`bake_props.py` reads sizes from `DECOR_SIZE`, so the entry comes first and a size
change means a re-bake. `DECOR_ART` auto-registers from the `DECOR_SIZE` keys.

**Never let the canvas downscale pixel art.** Drawing a 31×22 sprite at 13×9 drops
three pixels in seven and destroys any read that depends on a 1px highlight. Bake to
the exact draw size and blit 1:1.

## Animation

No sprite-sheet animation system exists. Character motion is procedural limb offsets
driven by `animTime`; wildlife uses hand-sliced frame tables in `gfx/waterfx.js` with
per-row waterlines. If generated animation frames are ever introduced they need a
sheet-playback path first — and the wildlife work established the rule that frames
must share **one anchor per grounded cycle** (the median), not one per frame, or the
sprite twitches at whole-pixel rounding.
