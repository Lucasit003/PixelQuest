"""Slice the Mystical Tree ruins sheet (assets/Tree Mystical.png) into props.

Like treee.png this sheet arrives with a real alpha channel and no panel
chrome, so there is nothing to matte. Unlike the tree sheet it is NOT a grid —
sprites are scattered freely — so cells come from connected-component labelling
on the alpha, dilated a few pixels so a sprite drawn as detached clusters
(canopy + trunk, flower sprays) stays one piece.

  python3 tools/mysticut.py index          # contact sheet + blobs json
  python3 tools/mysticut.py cut            # write every NAMED blob to _src
  python3 tools/mysticut.py cut name..     # just these names

Cuts land in assets/props/_src at sheet resolution; tools/bake_props.py then
resamples them to the sizes DECOR_SIZE asks for, same as every other prop.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "assets/Tree Mystical.png")
OUT = os.path.join(ROOT, "assets/props/_src")
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_index")

# blob index -> prop name, filled in after eyeballing the indexed contact
# sheet. A name of None leaves the blob uncut. One blob may carry several
# names with explicit sub-boxes when two sprites touch (name, x0,y0,x1,y1
# relative to the blob's own crop).
NAMES = {
    0: "mystic_tree_grand",
    1: "myst_col_a", 2: "myst_col_b", 3: "myst_col_cracked", 4: "myst_col_tall",
    5: "myst_col_lean", 6: "myst_col_broken",
    11: [("myst_col_stub", 0, 0, 47, 87), ("myst_col_drum", 47, 0, 129, 87)],
    7: "myst_arch_a", 8: "myst_arch_b", 9: "myst_arch_narrow", 10: "myst_arch_vine",
    12: "myst_ped_book", 13: "myst_ped_sword", 14: "myst_ped_leaf",
    15: "myst_ped_crystal_dim", 16: "myst_ped_crystal_lit",
    17: "myst_bench_a",
    18: [("myst_bench_b", 0, 0, 120, 88), ("myst_bench_c", 118, 0, 225, 88),
         ("myst_bench_d", 222, 0, 318, 88)],
    19: "myst_bench_bit",
    22: ["myst_path_straight", "myst_path_straight_ew"],
    23: ["myst_path_curve", "myst_path_curve_ew"], 20: "myst_path_cross",
    24: "myst_path_edge", 25: "myst_path_steps",
    21: "myst_pond",
    26: "myst_statue_maiden", 27: "myst_statue_knight", 28: "myst_statue_crystal",
    29: "myst_statue_kneel", 30: "myst_statue_glow", 31: "myst_statue_sit",
    32: "myst_crystals_purple", 33: "myst_crystals_cyan",
    34: "myst_rock_a", 35: "myst_rock_b", 36: "myst_rock_c", 37: "myst_rock_d",
    38: "myst_rock_e", 39: "myst_crystals_mini",
    46: "myst_wall_long", 47: "myst_wall_gap", 48: "myst_wall_vine", 49: "myst_wall_steps",
    40: "myst_door_flowers", 41: "myst_stone_pair", 42: "myst_stone_one",
    43: "myst_pillar_moss_a", 44: "myst_pillar_moss_b",
    50: "myst_bush_white", 51: "myst_bush_meadow", 45: "myst_stump_flowers",
    52: "myst_vine_curtain_a", 53: "myst_vine_curtain_b",
    54: "myst_vine_a", 55: "myst_vine_b", 63: "myst_vine_c", 64: "myst_vine_d",
    56: "myst_flower_spray",
    57: "myst_shrine_niche", 58: "myst_fountain_mini",
    59: "myst_arch_ruin", 60: "myst_gazebo",
    61: [("myst_tree_round", 0, 0, 168, 218), ("myst_tree_roots", 166, 0, 339, 218)],
    62: "myst_rubble_a", 65: "myst_rubble_b", 66: "myst_rubble_c",
    67: "myst_crystal_spike",
}


def blobs():
    im = Image.open(SHEET).convert("RGBA")
    a = np.asarray(im)
    alpha = a[..., 3] > 24
    # Merge detached clusters: a canopy floating over its trunk, a spray of
    # flowers. 5px reaches across the biggest internal gap on this sheet
    # without bridging the real gutters between neighbouring sprites.
    fat = ndimage.binary_dilation(alpha, iterations=DILATE)
    lab, n = ndimage.label(fat)
    boxes = []
    for k, sl in enumerate(ndimage.find_objects(lab), start=1):
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        # only THIS blob's pixels: two sprites whose boxes overlap (the grand
        # tree's canopy brushes column 1) must not leak into each other's cut
        m = alpha[sl] & (lab[sl] == k)
        if m.sum() < 120:  # dust
            continue
        ys, xs = np.where(m)
        boxes.append([int(x0 + xs.min()), int(y0 + ys.min()),
                      int(x0 + xs.max() + 1), int(y0 + ys.max() + 1), k])
    boxes.sort(key=lambda b: (b[1] // 96, b[0]))  # rough reading order
    return im, boxes, lab


DILATE = 2  # px; merges a sprite's detached clusters without bridging gutters


def index():
    im, boxes, _ = blobs()
    os.makedirs(WORK, exist_ok=True)
    sheet = im.convert("RGB")
    d = ImageDraw.Draw(sheet)
    for i, (x0, y0, x1, y1, _k) in enumerate(boxes):
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 60, 60), width=2)
        d.text((x0 + 3, y0 + 2), str(i), fill=(255, 255, 80))
    sheet.save(os.path.join(WORK, "mystic_contact.png"))
    json.dump(boxes, open(os.path.join(WORK, "blobs_mystic.json"), "w"))
    print(f"{len(boxes)} blobs -> {WORK}/mystic_contact.png")


# Cuts that are pre-rotated on disk (degrees CCW). The engine draws props
# upright and can only mirror them, so an E-W run of the sheet's N-S paving
# strip is made here rather than there.
ROTATE = {"myst_path_straight_ew": 90, "myst_path_curve_ew": 90}


def cut(want):
    im = Image.open(SHEET).convert("RGBA")
    boxes = json.load(open(os.path.join(WORK, "blobs_mystic.json")))
    _, _, lab = blobs()
    os.makedirs(OUT, exist_ok=True)
    for i, spec in NAMES.items():
        if spec is None:
            continue
        entries = spec if isinstance(spec, list) else [spec]
        for e in entries:
            if isinstance(e, str):
                name, sub = e, None
            else:
                name, sub = e[0], e[1:]
            if want and name not in want:
                continue
            x0, y0, x1, y1, k = boxes[i]
            if sub:
                sx0, sy0, sx1, sy1 = sub
                x0, y0, x1, y1 = x0 + sx0, y0 + sy0, x0 + sx1, y0 + sy1
            arr = np.array(im.crop((x0, y0, x1, y1)))
            arr[..., 3] = np.where(lab[y0:y1, x0:x1] == k, arr[..., 3], 0)
            crop = Image.fromarray(arr)
            # tighten once more after a sub-box / label mask
            a = arr[..., 3] > 24
            ys, xs = np.where(a)
            crop = crop.crop((int(xs.min()), int(ys.min()),
                              int(xs.max() + 1), int(ys.max() + 1)))
            if name in ROTATE:
                crop = crop.rotate(ROTATE[name], expand=True)
            crop.save(os.path.join(OUT, name + ".png"))
            print(f"  {name:24s} blob {i:3d}  {crop.size[0]}x{crop.size[1]}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "index"
    if mode == "index":
        index()
    elif mode == "cut":
        cut(set(sys.argv[2:]))
