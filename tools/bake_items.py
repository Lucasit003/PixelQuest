"""Bake hero equipment sprites down to the density the game blits at.

The items are authored beside the 215px hero bodies so a buckle and a 1px
outline have somewhere to live. The heroes ship at ~28px, and their anchors were
already scaled to match by bake_hero.py -- so the items have to travel the same
distance or every weapon lands in the right place at the wrong size.

Scale factor is the SAME K the bodies used: 28/215. Reading it from anywhere
else is how a weapon ends up subtly too big forever.

    python3 tools/bake_items.py
"""
import os

import numpy as np
from PIL import Image

import fix_halo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = 28.0 / 215.0

SRC = 'assets/actors/_src'
ITEMS = [
    ('hammer_default', f'{SRC}/paladin_gemini/equipment/hammer_default.png'),
    ('shield_default', f'{SRC}/paladin_gemini/equipment/shield_default.png'),
    ('dagger_main',    f'{SRC}/rogue_gemini/equipment/dagger_main.png'),
    ('dagger_off',     f'{SRC}/rogue_gemini/equipment/dagger_off.png'),
    ('bow_short',      f'{SRC}/ranger_gemini/equipment/bow_short.png'),
    ('arrow',          f'{SRC}/ranger_gemini/equipment/arrow.png'),
    ('quiver',         f'{SRC}/ranger_gemini/equipment/quiver.png'),
]


def bake(src, dst):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    nw, nh = max(1, round(w * K)), max(1, round(h * K))

    # Premultiplied, so transparent pixels cannot bleed into the edge.
    arr = np.array(im).astype(np.float32)
    al = arr[:, :, 3:4] / 255.0
    arr[:, :, :3] *= al
    # Same filter rule as the bodies: LANCZOS sharpens and is right up to ~3x,
    # but its negative lobes overshoot the alpha bound beyond that.
    f = Image.LANCZOS if (h / max(1, nh)) < 3.0 else Image.BOX
    o = np.array(Image.fromarray(arr.astype(np.uint8)).resize((nw, nh), f)).astype(np.float32)
    oa = o[:, :, 3:4] / 255.0
    o[:, :, :3] = np.where(oa > 0, o[:, :, :3] / np.maximum(oa, 1e-6), 0)
    o = np.clip(o, 0, 255).astype(np.uint8)
    o[:, :, 3] = np.where(o[:, :, 3] >= 110, 255, 0)
    o = fix_halo.repair_cell(o)[0]          # the alpha snap creates a halo
    Image.fromarray(o).save(dst)
    return (w, h), (nw, nh)


def main():
    out_dir = os.path.join(ROOT, 'assets/items')
    os.makedirs(out_dir, exist_ok=True)
    print(f'scale {K:.4f}  (215px authoring -> 28px shipping)')
    for name, rel in ITEMS:
        src = os.path.join(ROOT, rel)
        if not os.path.isfile(src):
            print(f'  {name:16s} MISSING {rel}')
            continue
        before, after = bake(src, os.path.join(out_dir, f'{name}.png'))
        print(f'  {name:16s} {before[0]:3d}x{before[1]:3d} -> {after[0]:2d}x{after[1]:2d}')


if __name__ == '__main__':
    main()
