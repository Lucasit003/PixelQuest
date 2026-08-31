"""Restore pixel-art discipline to a hero sheet the bake washed out.

DIAGNOSIS (measured on the Paladin, assets/actors/paladin.png):

    outline ring median luminance 80   vs   body median 74
    contrast p10..p90                  42..131  (range 89 of 255)
    distinct colours                   5016  in  6782 opaque pixels

Three separate failures, all born in the 7.7x reduction from the 215px master:

1. NO OUTLINE. The ring around the silhouette is the same value as the body, so
   nothing separates him from the background. On the town's blue-grey flagstones
   he effectively disappears. Every other hero reads because of a dark edge.

2. NO CONTRAST. An 89-point range on a character whose whole identity is
   polished plate. Armour needs a bright specular and a deep shadow or it reads
   as felt.

3. NO PALETTE. 5016 colours in 6782 pixels means almost every pixel is a
   slightly different grey -- continuous tone, not pixel art. That is what makes
   the legs read as mud rather than as legs.

The 215px master is fine; averaging destroyed it on the way down. So this is a
post-pass on the SHIPPED sheet:

    contrast curve  ->  quantize to a small palette  ->  rebuild the outline

Order matters. Quantizing before the curve bakes the mud in, and outlining
before quantizing lets the quantizer eat the outline.

    python3 tools/repolish_hero.py paladin --colors 14 --out-suffix _polished
    python3 tools/repolish_hero.py paladin --colors 14 --apply
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lift(lum, gamma=0.72):
    """Raise the midtones without blowing the highlights.

    The Paladin's body median sits at 74 -- dark, for a character whose whole
    identity is polished silver plate. Contrast alone cannot fix that: an
    S-curve pivots about the midpoint, so on an already-dark sprite it pushes
    most pixels DOWN and turns a holy knight into a black knight. Lift first,
    then add contrast around the new, higher midpoint.
    """
    x = np.clip(lum / 255.0, 0, 1)
    return np.power(x, gamma) * 255.0


def s_curve(lum, strength=0.55):
    """Push darks down and lights up around the midpoint.

    A plain multiply would clip the highlights; this pivots about 0.5 so the
    specular on a pauldron survives while the shadow under it actually darkens.
    """
    x = np.clip(lum / 255.0, 0, 1)
    y = x + strength * (x - 0.5) * (1 - np.abs(2 * x - 1))
    return np.clip(y, 0, 1) * 255.0


def quantize(rgb, mask, n_colors):
    """Median-cut style quantization over the opaque pixels only.

    Quantizing the whole image would spend palette entries on transparent
    black, which is why this masks first.
    """
    px = rgb[mask].astype(np.float32)
    if len(px) == 0:
        return rgb
    # k-means, seeded deterministically by luminance percentiles so the same
    # sheet always yields the same palette
    lum = px.mean(axis=1)
    seeds = np.percentile(lum, np.linspace(2, 98, n_colors))
    centers = np.stack([px[np.argmin(np.abs(lum - s))] for s in seeds])
    for _ in range(24):
        d = ((px[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        for k in range(n_colors):
            sel = lab == k
            if sel.any():
                centers[k] = px[sel].mean(axis=0)
    out = rgb.copy()
    out[mask] = centers[lab].astype(np.uint8)
    return out


def rebuild_outline(rgba, target_lum=34.0):
    """Darken the OUTERMOST opaque ring to a fixed low luminance.

    Converting the existing ring rather than growing a new one keeps the
    silhouette exactly the same size -- growing it would make the character a
    pixel taller and wider than the other heroes, which is worse than the
    problem being fixed.

    The target is ABSOLUTE, not a mix of the sprite's own darks. Mixing made the
    outline track the midtone lift: brightening the armour to silver dragged the
    edge up with it to luminance 82, which is no separation at all. An outline
    exists to divide the character from the background, so its value has to be
    chosen against the background, not against the character.

    Hue is preserved by scaling the channels together, so a warm character keeps
    a warm edge rather than picking up a cold halo.
    """
    a = rgba[:, :, 3] > 0
    inner = ndimage.binary_erosion(a, np.ones((3, 3)))
    ring = a & ~inner

    # A thin feature is ALL ring: a 2px-wide leg has no interior, so outlining
    # it converts the whole leg to ink and the character loses its legs. Skip
    # ring pixels sitting in a run narrower than 3px in both axes -- they are
    # the feature, not its edge.
    h, w = a.shape
    runs_x = np.zeros_like(a, dtype=np.int16)
    runs_y = np.zeros_like(a, dtype=np.int16)
    for y in range(h):
        x = 0
        while x < w:
            if not a[y, x]:
                x += 1; continue
            x2 = x
            while x2 < w and a[y, x2]:
                x2 += 1
            runs_x[y, x:x2] = x2 - x
            x = x2
    for x in range(w):
        y = 0
        while y < h:
            if not a[y, x]:
                y += 1; continue
            y2 = y
            while y2 < h and a[y2, x]:
                y2 += 1
            runs_y[y:y2, x] = y2 - y
            y = y2
    thin = (runs_x < 3) & (runs_y < 3)
    ring = ring & ~thin

    if not ring.any():
        return rgba
    out = rgba.copy()
    rgb = rgba[:, :, :3].astype(np.float32)
    lum = np.maximum(rgb.mean(axis=2), 1e-3)
    scale = np.clip(target_lum / lum, 0, 1)[:, :, None]
    out[:, :, :3][ring] = (rgb * scale).astype(np.uint8)[ring]
    return out


def report(rgba, label):
    a = rgba[:, :, 3] > 0
    lum = rgba[:, :, :3].astype(float).mean(axis=2)
    inner = ndimage.binary_erosion(a, np.ones((3, 3)))
    ring = a & ~inner
    cols = len(set(map(tuple, rgba[:, :, :3][a])))
    print(f'  {label:9s} contrast {np.percentile(lum[a],90)-np.percentile(lum[a],10):5.0f}   '
          f'outline {np.median(lum[ring]):5.0f} vs body {np.median(lum[a]):5.0f}   '
          f'colours {cols:5d}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('hero')
    ap.add_argument('--colors', type=int, default=14)
    ap.add_argument('--contrast', type=float, default=0.55)
    ap.add_argument('--ink', type=float, default=34.0,
                    help='absolute luminance for the rebuilt outline')
    ap.add_argument('--lift', type=float, default=0.72,
                    help='gamma; below 1 brightens the midtones')
    ap.add_argument('--out-suffix', default='_polished')
    ap.add_argument('--apply', action='store_true', help='overwrite the sheet in place')
    args = ap.parse_args()

    src = os.path.join(ROOT, f'assets/actors/{args.hero}.png')
    rgba = np.array(Image.open(src).convert('RGBA'))
    report(rgba, 'before')

    a = rgba[:, :, 3] > 0
    rgb = rgba[:, :, :3].astype(np.float32)

    # 1. lift, then contrast — preserving hue by scaling each channel by the
    # luminance change rather than operating on channels independently, which
    # would drift the armour toward whichever channel clips first.
    lum = rgb.mean(axis=2)
    target = s_curve(lift(lum, args.lift), args.contrast)
    ratio = np.divide(target, np.maximum(lum, 1e-3))[:, :, None]
    rgb = np.clip(rgb * ratio, 0, 255)
    rgba[:, :, :3] = rgb.astype(np.uint8)

    # 2. palette
    rgba[:, :, :3] = quantize(rgba[:, :, :3], a, args.colors)

    # 3. outline
    rgba = rebuild_outline(rgba, args.ink)

    report(rgba, 'after')

    dst = src if args.apply else os.path.join(
        ROOT, f'assets/actors/{args.hero}{args.out_suffix}.png')
    Image.fromarray(rgba).save(dst)
    print(f'  -> {os.path.relpath(dst, ROOT)}')


if __name__ == '__main__':
    main()
