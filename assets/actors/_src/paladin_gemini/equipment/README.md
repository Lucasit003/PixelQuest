# Paladin default equipment

Two sprites. Neither is baked into any character frame, and neither ever will
be — that is the whole point of `src/gfx/equipment.js`.

| file | size | grip | notes |
|---|---|---|---|
| `hammer_default.png` | 32x81 | `[16, 67]` | on the shaft, just above the pommel |
| `shield_default.png` | 50x74 | `[25, 30]` | where the forearm sits behind the boss |

Sizes are at the **body sheet's own pixel density** (the Paladin figure is 215px
tall in `15_paladin_sheet_16frames.png`), so the hammer is ~37% and the shield
~34% of body height. When the body is later baked down to its shipping
resolution the equipment bakes down by the same factor and the anchor table
scales with it. Authoring them at a guessed shipping size instead would lock in
a resolution decision that belongs to the body sheet.

## Provenance

Design generated with Google Gemini and kept: `_gemini_master_smooth.png` was
the first pass, `_gemini_master_chunky.png` the re-render that actually carries
large flat pixel blocks. The chunky one is the master everything is baked from.

**Gemini cannot hit an exact block count.** Asked twice for "28 blocks tall" it
returned ~96 blocks once and a whole Paladin character the next time. So the
design is Gemini's and the pixel-grid fit is mechanical — `tools/bake_props.py`
rules apply (BOX beyond 3x reduction, never LANCZOS, or the matting halo comes
back). The outline is REBUILT rather than preserved: a 1px outline is 0.9% of a
900px master and cannot survive any honest reduction.

## Review-board corrections applied

A critique pass raised five problems. All five were fixed in EQUIPMENT art or
in the anchor table — no body pixel was touched:

1. **Hammer looked detached from the fist.** The suggested fix was to paint
   fingers over the haft; that is character art, so it was not done. The real
   cause was a grip anchor that missed the fist, corrected in the anchor table.
2. **Wind-up hid the hammer entirely** behind the body, killing anticipation.
   The frame stays `handBehind`, but the anchor and angle now put the head clear
   of the shoulder line.
3. **Hammer head vanished at true 1x.** Head enlarged 22%, striking face
   brightened.
4. **Shield face read as a flat brown slab.** Field brightened and the
   low-contrast crest replaced with a bold gold cross, which is the only kind of
   emblem that survives at this size.
5. **Shield overhung the knee.** Reduced 12% in height.

## Still outstanding

* No 1-2-3 combo and no distinct heavy attack — the sheet holds one 4-frame
  attack, so those review rows show what exists rather than faking it.
* Pose-dependent shield transforms are authored for idle / walk / attack only.
* These are the DEFAULT tier. No further weapon tiers exist yet, by instruction.
