"""Remove the matting halo from a baked hero sheet.

WHY IT EXISTS
-------------
bake_hero.py resizes premultiplied (correct), unpremultiplies (correct), then
snaps alpha to 0 or 255 so pixel art keeps a hard edge:

    a[:, :, 3] = np.where(a[:, :, 3] >= 110, 255, 0)

That last step is where the halo is born. A pixel on the silhouette that was,
say, 45% covered by bright silver armour carries the armour's FULL brightness
once it is unpremultiplied -- the coverage lived in the alpha, and the alpha has
just been thrown away. Snapping it to 255 promotes a pale, mostly-background
pixel into a solid one sitting on the outside of the character.

The result is a pale rim, and it is worst on the brightest characters. Measured
on the shipped sheets: Rogue 0.5% of edge pixels pale, Warrior 9.7%, Paladin
35.6% -- exactly ordered by how bright each character's interior is.

THE REPAIR
----------
Every hero in this game carries a 1px dark outline, so an OUTER EDGE pixel that
is bright is wrong by definition. Each one is repushed to the darkest of its
opaque neighbours, which is the outline colour it should have had. Interior
pixels are never touched, so highlights, faces and armour keep their values --
only the ring the player sees as the character's edge is repaired.

    python3 tools/fix_halo.py                # all three heroes, in place
    python3 tools/fix_halo.py --check        # report only, change nothing
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SHEETS = [
    ('warrior', 'assets/actors/warrior.png', 26, 29),
    ('paladin', 'assets/actors/paladin.png', 34, 29),
    ('rogue',   'assets/actors/rogue.png',   32, 29),
    ('ranger',  'assets/actors/ranger.png',  0,  0),   # skipped until it exists
]

PALE = 130          # luminance above which an edge pixel is suspect
MARGIN = 26         # ...and how much brighter than its neighbourhood it must be


def lum(px):
    return float(px[:3].astype(int).sum()) / 3.0


def edge_pixels(op):
    """The outermost opaque pixel of every row and every column.

    This is the ring the player reads as the character's edge. Using rows AND
    columns catches the top of a helmet and the side of a cloak alike, which a
    plain erosion would also do -- but this ring is exactly the set a halo can
    live in, and keeping it small keeps the repair conservative.
    """
    ring = set()
    h, w = op.shape
    for y in range(h):
        xs = np.where(op[y])[0]
        if len(xs):
            ring.add((y, int(xs.min()))); ring.add((y, int(xs.max())))
    for x in range(w):
        ys = np.where(op[:, x])[0]
        if len(ys):
            ring.add((int(ys.min()), x)); ring.add((int(ys.max()), x))
    return ring


def repair_cell(cell):
    """Return (repaired cell, pixels changed)."""
    op = cell[:, :, 3] > 0
    if not op.any():
        return cell, 0
    h, w = op.shape
    out = cell.copy()
    fixed = 0
    for y, x in edge_pixels(op):
        L = lum(cell[y, x])
        if L <= PALE:
            continue
        nb = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if (dy or dx) and 0 <= ny < h and 0 <= nx < w and op[ny, nx]:
                    nb.append(cell[ny, nx])
        if not nb:
            out[y, x, 3] = 0            # a lone bright speck is pure artifact
            fixed += 1
            continue
        darkest = min(nb, key=lum)
        if L - lum(darkest) < MARGIN:
            continue                     # genuinely a bright area, leave it
        out[y, x, :3] = darkest[:3]
        fixed += 1
    return out, fixed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='report only')
    args = ap.parse_args()

    for name, rel, fw, fh in SHEETS:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path) or not fw:
            continue
        im = Image.open(path).convert('RGBA')
        a = np.array(im)
        H, W = a.shape[:2]
        cols, rows = W // fw, H // fh
        total = 0
        for r in range(rows):
            for c in range(cols):
                sl = (slice(r * fh, (r + 1) * fh), slice(c * fw, (c + 1) * fw))
                fixed_cell, n = repair_cell(a[sl])
                total += n
                if not args.check:
                    a[sl] = fixed_cell
        verb = 'would repair' if args.check else 'repaired'
        print(f'{name:8s} {cols}x{rows} frames  {verb} {total} halo pixels')
        if not args.check and total:
            Image.fromarray(a).save(path)


if __name__ == '__main__':
    main()
