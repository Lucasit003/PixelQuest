"""Slice the tree sheet (assets/_src/treee.png) into individual prop cuts.

Unlike the asset-library sheets that sheetcut.py handles, this one arrives with
a real alpha channel and no panel chrome, so there is nothing to matte — the
only work is finding the grid and cropping each cell to its own art.

Cells are found by projecting alpha onto each axis and reading the gutters,
rather than assuming an even 4x3 split: the trees are not centred in their
cells and the last column is half again as wide as the first. Cropping is done
per CELL and not per connected blob, because several of these trees are drawn
as detached leaf clusters around a thin trunk — blob labelling splits those
into confetti, while the cell bounds keep each tree whole.

  python3 tools/treecut.py            # write every cut + a labelled contact sheet

Cuts land in assets/props/_src at sheet resolution; tools/bake_props.py then
resamples them to the sizes DECOR_SIZE asks for, same as every other prop.
"""
import os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, "assets/_src/treee.png")
OUT = os.path.join(ROOT, "assets/props/_src")
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_index")

# Row-major names for the 4x3 grid. Row 1 is plain canopy, row 2 is flowering
# and young stock, row 3 is the "based" pieces that carry their own ground
# treatment (skirt planting, or a built stone planter).
NAMES = [
    "tree_oak_round",  "tree_oak_spread",   "tree_young",         "tree_oak_broad",
    "tree_blossom_white", "tree_blossom_blue", "tree_blossom_violet", "tree_sapling",
    "tree_rooted",     "tree_flowerbed",    "topiary_square",     "topiary_round",
]


def bands(profile, min_gap=8):
    """Contiguous runs of True, merged across gaps shorter than `min_gap` so a
    tree's own internal transparency does not read as a cell boundary."""
    runs, start = [], None
    for i, v in enumerate(profile):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append([start, i - 1])
            start = None
    if start is not None:
        runs.append([start, len(profile) - 1])
    merged = [runs[0]]
    for r in runs[1:]:
        if r[0] - merged[-1][1] <= min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return merged


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    sheet = Image.open(SHEET).convert("RGBA")
    a = np.asarray(sheet)
    op = a[..., 3] > 8

    cols = bands(op.any(axis=0))
    rows = bands(op.any(axis=1))
    if len(cols) * len(rows) != len(NAMES):
        raise SystemExit(f"expected a {len(NAMES) // 3}x3 grid, found "
                         f"{len(cols)}x{len(rows)} — check the sheet")

    cuts = []
    for r, (y0, y1) in enumerate(rows):
        for c, (x0, x1) in enumerate(cols):
            name = NAMES[r * len(cols) + c]
            cell = sheet.crop((x0, y0, x1 + 1, y1 + 1))
            # Tight-crop inside the cell: the projected bands are the union over
            # the whole row/column, so an individual tree rarely fills its cell.
            box = cell.getbbox()
            img = cell.crop(box) if box else cell
            img.save(os.path.join(OUT, name + ".png"))
            cuts.append((name, img))
            print(f"  {name:22s} {img.width}x{img.height}")

    # Contact sheet on a grass-green ground, so alpha edges and any leftover
    # halo are obvious at a glance rather than hidden against white.
    pad, lbl = 10, 16
    cw = max(i.width for _, i in cuts) + pad * 2
    ch = max(i.height for _, i in cuts) + pad * 2 + lbl
    sheet_out = Image.new("RGB", (4 * cw, 3 * ch), (86, 130, 74))
    d = ImageDraw.Draw(sheet_out)
    for i, (name, img) in enumerate(cuts):
        r, c = i // 4, i % 4
        ox, oy = c * cw, r * ch
        sheet_out.paste(img, (ox + (cw - img.width) // 2, oy + lbl + pad), img)
        d.text((ox + 4, oy + 3), f"{i} {name} {img.width}x{img.height}", fill=(255, 236, 150))
        d.rectangle([ox, oy, ox + cw - 1, oy + ch - 1], outline=(30, 40, 28))
    path = os.path.join(WORK, "contact_trees.png")
    sheet_out.save(path)
    print(f"\n{len(cuts)} cuts -> {path}")


if __name__ == "__main__":
    main()
