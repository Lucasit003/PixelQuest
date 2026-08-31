#!/usr/bin/env python3
"""Generate the sprite-renderer test actor sheet (assets/actors/dummy.png).

This is a DEVELOPMENT FIXTURE, not game art. It exists so the sprite rendering
path can be proven — loading, animation, mirroring, ground anchoring — without
spending anything on image generation. Real actor sheets come from the
ai-pixel-art-image-generation skill and drop into the same grid layout.

Layout matches that skill's output convention:
  * fixed-size frames packed left-to-right, top-to-bottom, `columns` per row
  * every frame bottom-baseline aligned (feet on the last opaque row)

  row 0  frames 0-1   idle   (2 frames)
  row 1  frames 4-7   walk   (4 frames)
  row 2  frames 8-11  attack (4 frames, non-looping)

The dummy is deliberately asymmetric — it faces RIGHT, with a beak and a plume
trailing left — so horizontal mirroring is obvious on screen.
"""

from PIL import Image, ImageDraw

FW, FH = 24, 32          # frame size
COLS, ROWS = 4, 3
CLEAR = (0, 0, 0, 0)

INK   = (26, 22, 38, 255)
BODY  = (92, 138, 200, 255)
BODY_D= (58, 92, 148, 255)
SKIN  = (232, 200, 160, 255)
PLUME = (224, 90, 90, 255)
BOOT  = (58, 44, 34, 255)


def frame(draw, ox, oy, legs=0, bob=0, arm=0):
    """One dummy pose. `oy` is the frame's TOP; feet always land on row 31."""
    def box(x, y, w, h, c):
        draw.rectangle([ox + x, oy + y, ox + x + w - 1, oy + y + h - 1], fill=c)

    b = bob

    # legs (feet pinned to the frame bottom so every frame shares a baseline)
    box(8 + legs, 24 + b, 3, 8 - b, BODY_D)
    box(13 - legs, 24 + b, 3, 8 - b, BODY_D)
    box(8 + legs, 30, 3, 2, BOOT)
    box(13 - legs, 30, 3, 2, BOOT)

    # torso
    box(7, 14 + b, 10, 10, BODY)
    box(7, 20 + b, 10, 2, BODY_D)

    # head
    box(8, 6 + b, 8, 8, SKIN)
    box(12, 9 + b, 2, 2, INK)          # eye, right of centre -> reads as facing
    box(16, 10 + b, 2, 1, INK)         # beak, points right
    box(5, 5 + b, 3, 4, PLUME)         # plume trails left

    # arms: front arm swings / extends on the attack
    box(16 + arm, 15 + b, 3, 6 - (2 if arm else 0), SKIN)
    box(5, 15 + b, 2, 5, SKIN)


def main():
    sheet = Image.new('RGBA', (FW * COLS, FH * ROWS), CLEAR)
    d = ImageDraw.Draw(sheet)

    poses = {
        0:  dict(legs=0, bob=0),            # idle a
        1:  dict(legs=0, bob=1),            # idle b (breathe)
        4:  dict(legs=2, bob=0),            # walk contact
        5:  dict(legs=0, bob=1),            # walk passing
        6:  dict(legs=-2, bob=0),           # walk contact mirrored
        7:  dict(legs=0, bob=1),            # walk passing
        8:  dict(legs=0, bob=0, arm=0),     # attack wind-up
        9:  dict(legs=1, bob=0, arm=3),     # attack strike
        10: dict(legs=1, bob=0, arm=2),     # attack recoil
        11: dict(legs=0, bob=1, arm=0),     # attack recovery
    }

    for idx, kw in poses.items():
        ox = (idx % COLS) * FW
        oy = (idx // COLS) * FH
        frame(d, ox, oy, **kw)

    out = 'assets/actors/dummy.png'
    sheet.save(out)
    print(f'wrote {out}  {sheet.width}x{sheet.height}  '
          f'({COLS}x{ROWS} grid of {FW}x{FH} frames)')


if __name__ == '__main__':
    main()
