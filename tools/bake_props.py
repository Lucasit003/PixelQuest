"""Bake the full-resolution prop cuts down to the exact size the game draws them.

The asset-library sheets are authored at roughly twice the game's scale, and
letting the canvas do that reduction at draw time is destructive: nearest
neighbour at ~0.42x simply drops three pixels in seven, which on a sprite whose
read depends on a one-pixel highlight and a one-pixel outline leaves a dark
smudge. Resampling offline with a proper filter keeps the shape, and the game
then blits 1:1 with no scaling at all.

Alpha is premultiplied around the resize so transparent pixels cannot bleed
their (arbitrary) colour into the sprite's edge.

Source of truth for the sizes is DECOR_SIZE in src/scenes/town/props.js, so the table
never drifts from what the scene actually asks for.

  python3 tools/bake_props.py            # bake every entry
  python3 tools/bake_props.py bench_01   # bake just these
"""
import os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/props/_src")
OUT = os.path.join(ROOT, "assets/props")


def sizes():
    js = open(os.path.join(ROOT, "src/scenes/town/props.js")).read()
    block = re.search(r"const DECOR_SIZE = \{(.*?)\n\};", js, re.S).group(1)
    return {m[0]: (int(m[1]), int(m[2]))
            for m in re.findall(r"(\w+):\s*\[(\d+),\s*(\d+)\]", block)}


def bake(name, w, h):
    src = Image.open(os.path.join(SRC, name + ".png")).convert("RGBA")
    a = np.asarray(src).astype(np.float64)
    alpha = a[..., 3:4] / 255.0
    pre = np.concatenate([a[..., :3] * alpha, a[..., 3:4]], axis=2)
    small = Image.fromarray(pre.round().clip(0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    b = np.asarray(small).astype(np.float64)
    al = np.clip(b[..., 3:4], 0, 255)
    rgb = np.where(al > 0, b[..., :3] / np.maximum(al / 255.0, 1e-6), 0)
    out = np.concatenate([rgb.clip(0, 255), al], axis=2).round().astype(np.uint8)
    # Anything the filter left barely visible is resampling haze, not art.
    out[..., 3] = np.where(out[..., 3] < 14, 0, out[..., 3])
    Image.fromarray(out).save(os.path.join(OUT, name + ".png"))
    return src.size


if __name__ == "__main__":
    want = set(sys.argv[1:])
    tbl = sizes()
    for name, (w, h) in sorted(tbl.items()):
        if want and name not in want:
            continue
        if not os.path.exists(os.path.join(SRC, name + ".png")):
            print(f"  MISSING SOURCE {name}")
            continue
        sw, sh = bake(name, w, h)
        print(f"  {name:18s} {sw}x{sh} -> {w}x{h}")
