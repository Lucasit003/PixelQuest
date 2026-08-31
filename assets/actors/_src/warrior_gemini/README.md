# Warrior source art — generated via the Gemini web UI

Character origin: cut from `assets/title_screen.png`, the game's own hero art.
Skeleton measured off that reference — head top 0%, chin 20% (5 heads tall),
shoulder line 28%, waist 52%, knee 76%, widest point 31% at the pauldron.

| File | What it is |
|---|---|
| `00_reference_from_titlescreen.png` | The reference character, cut from the title screen. Source of truth for the design. |
| `01_sheet_armed_24frames.png` | First sheet. Idle / walk / attack / damage, in 3/4, front and back. **Sword and shield are BAKED IN** — look-dev only, cannot back an equipment shop. |
| `02_sheet_emptyhanded.png` | Empty-handed body sheet. Includes open-hand "attachment-ready" poses and isolated gauntlet sprites. |
| `03_sheet_emptyhanded_v2.png` | Second empty-handed pass, plus a palette swatch. Attack rows are a level jab, not a swing. |
| `04_palette_swatch.png` | The character's palette, for keeping the other six classes on-model. |
| `frames/` | 24 frames cut out of sheet 01 with the background keyed (flood-fill from the edges — colour-keying punches holes through the grey armour). |

## Known issues
* Everything is ~160-185px per frame; gameplay draws the hero at ~29px, so a
  ~6x reduction is needed and edges blend rather than staying crisp.
* Sheet 01 has sword AND shield painted in. Warrior's default is a longsword
  only — sword+shield belongs to Paladin.
* Costume drifts slightly between generations (pauldron count, cowl shape).
* Gemini holds character consistency well but does NOT follow frame-by-frame
  choreography — three attempts at a swing arc all returned a level jab.

## Equipment architecture
Bodies must be authored EMPTY-HANDED. `src/gfx/sprites.js` resolves `hand` and
`shield` anchors per frame (`attachmentAnchor()`), with `handBehind` for
wind-ups, so one animation set serves every weapon. Armour is NOT separable
this way — it deforms with the pose, so tiers are a palette swap or a second
body sheet. See the notes at the top of `src/gfx/spriteCatalog.js`.
