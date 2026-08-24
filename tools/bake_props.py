"""Bake full-resolution art down to the exact size the game draws it.

Covers two asset families through one pipeline:
  props     assets/props/_src      -> assets/props       (DECOR_SIZE)
  buildings assets/buildings/_src  -> assets/buildings   (the *_W/*_H constants)

The asset-library sheets are authored at roughly twice the game's scale, and
letting the canvas do that reduction at draw time is destructive: nearest
neighbour at ~0.42x simply drops three pixels in seven, which on a sprite whose
read depends on a one-pixel highlight and a one-pixel outline leaves a dark
smudge. Resampling offline with a proper filter keeps the shape, and the game
then blits 1:1 with no scaling at all.

Alpha is premultiplied around the resize so transparent pixels cannot bleed
their (arbitrary) colour into the sprite's edge.

Sizes are read out of the source, so the tables never drift from what the scene
actually asks for.

**Filter choice matters and is picked by reduction factor.** LANCZOS sharpens,
which is what a ~2x prop reduction wants. It also has negative lobes, and at the
4-6x reduction the building art needs those overshoot past the alpha bound: the
un-premultiply then divides an overshooting colour by an undershooting alpha and
paints a white fringe right around the silhouette — the matting halo this
codebase keeps rediscovering. BOX (area average) cannot overshoot, so beyond 3x
it is used instead. Verified visually against the building set; do not "improve"
this to LANCZOS everywhere.

  python3 tools/bake_props.py                  # bake every prop
  python3 tools/bake_props.py bench_01         # bake just these props
  python3 tools/bake_props.py --buildings      # bake every building
  python3 tools/bake_props.py --buildings LIBRARY
"""
import os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/props/_src")
OUT = os.path.join(ROOT, "assets/props")
BSRC = os.path.join(ROOT, "assets/buildings/_src")
BOUT = os.path.join(ROOT, "assets/buildings")


def sizes():
    js = open(os.path.join(ROOT, "src/scenes/town/props.js")).read()
    block = re.search(r"const DECOR_SIZE = \{(.*?)\n\};", js, re.S).group(1)
    return {m[0]: (int(m[1]), int(m[2]))
            for m in re.findall(r"(\w+):\s*\[(\d+),\s*(\d+)\]", block)}


def building_sizes():
    """{filename: (w, h)} from the *_ART loader paths paired with their *_W/*_H."""
    js = open(os.path.join(ROOT, "src/scenes/town/buildings.js")).read()
    arts = dict(re.findall(r"const (\w+)_ART = loadBuildingArt\('assets/buildings/([\w.]+)'\)", js))
    dims = {m[0]: (int(m[1]), int(m[2]))
            for m in re.findall(r"const (\w+)_W = (\d+), \w+_H = (\d+)", js)}
    return {key: (fn[:-4], dims[key]) for key, fn in arts.items() if key in dims}


def bake(name, w, h, src_dir=SRC, out_dir=OUT):
    src = Image.open(os.path.join(src_dir, name + ".png")).convert("RGBA")
    a = np.asarray(src).astype(np.float64)
    alpha = a[..., 3:4] / 255.0
    pre = np.concatenate([a[..., :3] * alpha, a[..., 3:4]], axis=2)

    # See the module docstring: LANCZOS overshoots and haloes past ~3x reduction.
    shrink = max(src.size[0] / w, src.size[1] / h)
    flt = Image.LANCZOS if shrink <= 3 else Image.BOX

    # Resize each channel in FLOAT, never as uint8. Quantising the premultiplied
    # colour to bytes first is what put a white rim on every building: a pixel
    # that lands on alpha 20 keeps a premultiplied value of a few units, and
    # un-premultiplying then divides those few units by 20/255 and drives them to
    # white. The rim was 78% of the dungeon gate's edge pixels before this.
    ch = [np.asarray(Image.fromarray(pre[..., i].astype(np.float32), mode="F")
                     .resize((w, h), flt)).astype(np.float64) for i in range(4)]
    al = np.clip(ch[3], 0, 255)[..., None]
    prergb = np.stack(ch[:3], axis=2)
    # Premultiplied colour can never exceed its own alpha; anything above is
    # filter overshoot, not art.
    prergb = np.minimum(prergb, al)
    rgb = np.where(al > 0, prergb / np.maximum(al / 255.0, 1e-6), 0)
    out = np.concatenate([rgb.clip(0, 255), al], axis=2).round().astype(np.uint8)
    # Anything the filter left barely visible is resampling haze, not art.
    out[..., 3] = np.where(out[..., 3] < 14, 0, out[..., 3])
    Image.fromarray(out).save(os.path.join(out_dir, name + ".png"))
    return src.size, ("LANCZOS" if flt == Image.LANCZOS else "BOX")


if __name__ == "__main__":
    args = sys.argv[1:]
    buildings = "--buildings" in args
    want = set(a for a in args if not a.startswith("--"))

    if buildings:
        for key, (name, (w, h)) in sorted(building_sizes().items()):
            if want and key not in want and name not in want:
                continue
            if not os.path.exists(os.path.join(BSRC, name + ".png")):
                print(f"  MISSING SOURCE {name}")
                continue
            (sw, sh), flt = bake(name, w, h, BSRC, BOUT)
            print(f"  {name:22s} {sw}x{sh} -> {w}x{h}  [{flt}]")
    else:
        for name, (w, h) in sorted(sizes().items()):
            if want and name not in want:
                continue
            if not os.path.exists(os.path.join(SRC, name + ".png")):
                print(f"  MISSING SOURCE {name}")
                continue
            (sw, sh), flt = bake(name, w, h)
            print(f"  {name:18s} {sw}x{sh} -> {w}x{h}  [{flt}]")
