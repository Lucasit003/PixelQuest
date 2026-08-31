#!/usr/bin/env python3
"""Cut individual props out of a generated asset sheet into game-ready PNGs.

    generated sheet (white background, items in a row)
        -> cut_prop_sheet.py
        -> assets/props/<name>.png  at the size the game actually draws it

Two things this handles that a naive crop does not:

  KEYING.  The generated background is near-white with noise, and pale cloth or
  highlights are also near-white. Keying on "light AND desaturated" keeps a white
  shirt while dropping the page behind it.

  MATTING HALO.  Resizing RGBA straight lets fully transparent pixels bleed their
  arbitrary colour into the edge, which shows up as a light fringe once the prop
  is drawn over grass. Alpha is premultiplied around the resize to prevent it.

Sizes are given as target HEIGHT in world units and taken from docs/ART_RULES.md's
bands, not from whatever size the generator happened to draw.
"""
import argparse, json, sys
import numpy as np
from PIL import Image
from scipy import ndimage


def key_background(im):
    a = np.array(im.convert('RGBA')).astype(np.int16)
    mx, mn = a[:, :, :3].max(axis=2), a[:, :, :3].min(axis=2)
    bg = (mn > 228) & ((mx - mn) < 18)
    return ~bg


def segment(fg, min_px=400):
    closed = ndimage.binary_closing(fg, structure=np.ones((5, 5)))
    lab, n = ndimage.label(closed, structure=np.ones((3, 3)))
    sizes = ndimage.sum(closed, lab, range(1, n + 1))
    boxes = []
    for i, s in enumerate(sizes, start=1):
        if s < min_px:
            continue
        ys, xs = np.where(lab == i)
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    return sorted(boxes, key=lambda b: b[0])


def resize_premultiplied(img, w, h):
    arr = np.array(img).astype(np.float32)
    al = arr[:, :, 3:4] / 255.0
    arr[:, :, :3] *= al
    pre = Image.fromarray(arr.astype(np.uint8)).resize((w, h), Image.LANCZOS)
    out = np.array(pre).astype(np.float32)
    a2 = out[:, :, 3:4] / 255.0
    with np.errstate(divide='ignore', invalid='ignore'):
        out[:, :, :3] = np.where(a2 > 0, out[:, :, :3] / np.maximum(a2, 1e-6), 0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def defringe(arr, rounds=2, light=215, sat=26):
    """Strip the pale halo left where a keyed background met the sprite edge.

    Only pixels that are light, desaturated AND touching transparency are
    removed, so an interior white — a shirt on the line, a cream awning stripe —
    is never eaten: interior pixels do not touch transparency.
    """
    for _ in range(rounds):
        al = arr[:, :, 3] > 0
        edge = al & ~ndimage.binary_erosion(al, structure=np.ones((3, 3)))
        rgb = arr[:, :, :3].astype(np.int16)
        mx, mn = rgb.max(axis=2), rgb.min(axis=2)
        halo = edge & (mn > light) & ((mx - mn) < sat)
        if not halo.any():
            break
        arr[halo, 3] = 0
    return arr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', required=True)
    ap.add_argument('--manifest', required=True, help='JSON: [{name, height}] left to right')
    ap.add_argument('--outdir', default='assets/props')
    ap.add_argument('--alpha', type=int, default=120)
    args = ap.parse_args()

    im = Image.open(args.sheet).convert('RGBA')
    fg = key_background(im)
    boxes = segment(fg)
    spec = json.load(open(args.manifest))
    if len(boxes) != len(spec):
        sys.exit(f'sheet has {len(boxes)} items but manifest lists {len(spec)}')

    alpha_full = Image.fromarray((fg * 255).astype(np.uint8))
    src = im.copy()
    src.putalpha(alpha_full)

    sizes = {}
    for (x0, y0, x1, y1), item in zip(boxes, spec):
        crop = src.crop((x0, y0, x1, y1))
        th = item['height']
        tw = max(1, round(crop.width * th / crop.height))
        small = resize_premultiplied(crop, tw, th)
        arr = np.array(small)
        arr[:, :, 3] = np.where(arr[:, :, 3] >= args.alpha, 255, 0)
        arr = defringe(arr)
        out = Image.fromarray(arr)
        path = f"{args.outdir}/{item['name']}.png"
        out.save(path)
        sizes[item['name']] = [tw, th]
        print(f"  {item['name']:16s} {crop.width}x{crop.height} -> {tw}x{th}   {path}")

    print('\nDECOR_SIZE entries:')
    for k, (w, h) in sizes.items():
        print(f"  {k}: [{w}, {h}],")


if __name__ == '__main__':
    main()
