"""Bake a source hero sheet down to the size the game blits, and scale its
per-frame equipment anchors by the same factor.

WHY THIS EXISTS
---------------
Hero art is authored at 215px figure height so a face, a buckle and a 1px
outline have somewhere to live. The game draws heroes at ~28px. Letting the
canvas do that reduction at draw time is destructive: nearest-neighbour at 0.13x
throws away seven pixels in eight, and what survives is noise.

The subtler half is the ANCHORS. Every weapon position, and every trail tip, is
authored in SOURCE pixels. Bake the sheet and forget the anchors and every
weapon detaches from every fist -- silently, because nothing errors. So this
tool emits both, from one scale factor, and they cannot drift apart.

TARGET SIZE
-----------
28px body with `scale: 1 / ACTOR_ZOOM`:

    town   28 * (1/1.59) * 1.59 = 28.0px   -- blits 1:1, no resampling at all
    combat 28 * (1/1.59) * 2.23 = 39.2px   -- 1.4x, the same treatment the
                                              already-shipped warrior_sprite
                                              gets (40.1px), so the three heroes
                                              stand exactly beside it.

Blitting 1:1 in town is the case worth optimising: town is where the player
spends most of their time and where the camera never changes.

    python3 tools/bake_hero.py --list
    python3 tools/bake_hero.py paladin
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fix_halo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_H = 215.0          # authored figure height
DST_H = 28.0           # drawn figure height in town
K = DST_H / SRC_H

MANIFEST = os.path.join(ROOT, 'tools', 'hero_manifest.json')


def figure_height(img):
    """Tallest opaque run in the sheet -- the authored figure height."""
    a = np.array(img.convert('RGBA'))[:, :, 3] > 128
    ys = np.where(a.any(axis=1))[0]
    return int(ys.max() - ys.min() + 1) if len(ys) else 0


def resize_pm(img, w, h):
    """Premultiplied resize so transparent pixels cannot bleed into the edge.

    Note the alpha snap in bake_sheet is what UNDOES half of this: a pixel that
    was 45% covered by bright armour carries the armour's full brightness once
    unpremultiplied, and forcing its alpha to 255 lands a pale pixel on the
    outside of the silhouette. That is why every cell goes through
    fix_halo.repair_cell afterwards -- see tools/fix_halo.py for the measurement
    that found it (Paladin: 35.6% of edge pixels).

    Filter by reduction factor, matching tools/bake_props.py: LANCZOS sharpens
    and is right up to ~3x, but its negative lobes overshoot the alpha bound
    beyond that and paint the matting halo. A hero bake is ~7.7x, so BOX.
    """
    arr = np.array(img.convert('RGBA')).astype(np.float32)
    al = arr[:, :, 3:4] / 255.0
    arr[:, :, :3] *= al
    f = Image.LANCZOS if (img.size[1] / max(1, h)) < 3.0 else Image.BOX
    pre = Image.fromarray(arr.astype(np.uint8)).resize((w, h), f)
    o = np.array(pre).astype(np.float32)
    oa = o[:, :, 3:4] / 255.0
    o[:, :, :3] = np.where(oa > 0, o[:, :, :3] / np.maximum(oa, 1e-6), 0)
    return Image.fromarray(np.clip(o, 0, 255).astype(np.uint8))


def bake_sheet(src_path, cols, cell_w, cell_h, out_path):
    """Bake cell by cell so no cell can bleed into its neighbour."""
    sheet = Image.open(src_path).convert('RGBA')
    rows = sheet.size[1] // cell_h
    nw, nh = max(1, round(cell_w * K)), max(1, round(cell_h * K))
    out = Image.new('RGBA', (nw * cols, nh * rows), (0, 0, 0, 0))
    for r in range(rows):
        for c in range(cols):
            cell = sheet.crop((c * cell_w, r * cell_h,
                               (c + 1) * cell_w, (r + 1) * cell_h))
            small = resize_pm(cell, nw, nh)
            a = np.array(small)
            a[:, :, 3] = np.where(a[:, :, 3] >= 110, 255, 0)   # pixel art wants a hard edge
            a = fix_halo.repair_cell(a)[0]                     # ...which creates a halo
            out.alpha_composite(Image.fromarray(a), (c * nw, r * nh))
    out.save(out_path)
    return (nw, nh), out.size


def scale_anchors(node):
    """Scale every anchor pair and every grip/tip by K, recursively.

    Angles are NOT scaled -- a rotation is scale-invariant, and scaling one is
    the kind of bug that looks almost right.
    """
    if isinstance(node, dict):
        return {k: (v if k.endswith('Angle') or k in ('fps', 'frames', 'loop', 'trail')
                    else scale_anchors(v))
                for k, v in node.items()}
    if isinstance(node, list):
        # an [x, y] pair
        if len(node) == 2 and all(isinstance(v, (int, float)) for v in node):
            return [round(node[0] * K), round(node[1] * K)]
        return [scale_anchors(v) for v in node]
    return node


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('heroes', nargs='*')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()

    man = json.load(open(MANIFEST))
    if args.list:
        for k, v in man.items():
            print(f"  {k:10s} {len(v['sheets'])} sheets")
        return

    names = args.heroes or list(man)
    for name in names:
        spec = man[name]
        print(f"\n=== {name} ===  scale {K:.4f}  ({SRC_H:.0f}px -> {DST_H:.0f}px)")
        for s in spec['sheets']:
            src = os.path.join(ROOT, s['src'])
            dst = os.path.join(ROOT, s['out'])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            fh = figure_height(Image.open(src))
            cell, total = bake_sheet(src, s['columns'], s['cellW'], s['cellH'], dst)
            print(f"  {os.path.basename(s['out']):26s} figure {fh}px  "
                  f"cell {s['cellW']}x{s['cellH']} -> {cell[0]}x{cell[1]}  sheet {total}")
        if 'anchors' in spec:
            scaled = scale_anchors(spec['anchors'])
            out = os.path.join(ROOT, spec['anchorsOut'])
            os.makedirs(os.path.dirname(out), exist_ok=True)
            json.dump(scaled, open(out, 'w'), indent=2)
            print(f"  anchors scaled -> {spec['anchorsOut']}")


if __name__ == '__main__':
    main()
