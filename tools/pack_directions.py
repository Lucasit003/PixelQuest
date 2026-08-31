"""Pack a hero's side / back / front walk strips into ONE sheet.

The three source strips are `<hero>_side.png`, `<hero>_back.png` and
`<hero>_front.png`; the packed result is `<hero>.png`, which is what the engine
loads. Reading and writing different files matters: an earlier version read the
packed sheet as its own side input, so a second run would have packed a packed
sheet and quietly tripled it.

registerActorSprite takes a single sheet per actor, so the three views have to
share it. They are AUTHORED separately because a back view is its own drawing,
not a transform of the side, and their natural cell widths differ -- a cape seen
from behind is wider than the same cape in profile.

Layout is one row per direction, 5 columns each:

    row 0   frames  0-4    side   (idle, then a 4-frame walk)
    row 1   frames  5-9    up     (back to camera)
    row 2   frames 10-14   down   (facing camera)

Every frame is bottom-aligned in a common cell and centred on its own FEET, not
its bounding box -- centring on the box makes the body slide sideways whenever
a cape or an arm swings past it, which reads as jitter across the cycle.

    python3 tools/pack_directions.py warrior
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLS = 5
DIRS = ['_side', '_back', '_front']
ROW_NAME = ['side', 'up', 'down']


def cells(path, n):
    im = Image.open(path).convert('RGBA')
    w = im.size[0] // n
    return [im.crop((i * w, 0, (i + 1) * w, im.size[1])) for i in range(n)]


def content_box(im):
    a = np.array(im)[:, :, 3] > 100
    if not a.any():
        return None
    ys, xs = np.where(a)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def foot_centre(im):
    """Horizontal centre of the bottom band -- the feet, not the bbox."""
    a = np.array(im)[:, :, 3] > 100
    ys = np.where(a.any(axis=1))[0]
    if not len(ys):
        return im.size[0] / 2
    bot = ys.max()
    top = max(ys.min(), bot - max(1, int(round((bot - ys.min()) * 0.22))))
    xs = np.where(a[top:bot + 1].any(axis=0))[0]
    return float(xs.mean()) if len(xs) else im.size[0] / 2


def main():
    name = sys.argv[1]
    rows, present = [], []
    for suffix, row in zip(DIRS, ROW_NAME):
        p = os.path.join(ROOT, f'assets/actors/{name}{suffix}.png')
        if not os.path.isfile(p):
            print(f'  {row:5s} missing ({os.path.basename(p)}) — skipped')
            continue
        rows.append(cells(p, COLS))
        present.append(row)

    if not rows:
        sys.exit(f'no sheets found for {name}')

    flat = [c for r in rows for c in r]
    cw = max(c.size[0] for c in flat)
    ch = max(c.size[1] for c in flat)
    out = Image.new('RGBA', (cw * COLS, ch * len(rows)), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, frame in enumerate(row):
            box = content_box(frame)
            if box is None:
                continue
            x0, y0, x1, y1 = box
            sub = frame.crop(box)
            fx = foot_centre(frame) - x0
            ox = int(round(cw / 2 - fx))
            oy = ch - (y1 - y0)                 # bottom-aligned: feet on one row
            out.alpha_composite(sub, (c * cw + max(0, ox), r * ch + oy))

    dst = os.path.join(ROOT, f'assets/actors/{name}.png')
    out.save(dst)
    idx = {d: {'idle': i * COLS, 'walk': list(range(i * COLS + 1, i * COLS + COLS))}
           for i, d in enumerate(present)}
    print(f'{name}: {len(rows)} directions ({", ".join(present)})  '
          f'cell {cw}x{ch}  sheet {out.size}')
    for d, v in idx.items():
        print(f'  {d:5s} idle {v["idle"]}  walk {v["walk"]}')
    json.dump({'cellW': cw, 'cellH': ch, 'columns': COLS, 'directions': idx},
              open(os.path.join(ROOT, f'assets/actors/{name}_dirs.json'), 'w'), indent=2)


if __name__ == '__main__':
    main()
