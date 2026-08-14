"""Slice individual props out of the PixelQuest asset-library sheets.

The sheets are catalogue pages: flat-colour panels holding one sprite each with
a text label underneath. This finds the sprite blobs, mattes the flat panel
colour (and its soft drop-shadow) to real alpha, and writes tight-cropped PNGs.

  python3 tools/sheetcut.py index <sheet>            -> contact sheet + blobs.json
  python3 tools/sheetcut.py cut <sheet> <i>:<name>.. -> assets/props/_src/<name>.png

The cuts land in assets/props/_src at full sheet resolution; tools/bake_props.py
then resamples them down to the sizes the game draws.
"""
import json, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets/props/_src")
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_index")

SHEETS = {
    "village":  "assets/village decor.jpg",
    "fence":    "assets/fences and property decor.jpeg",
    "veg":      "assets/Natural Vegatiation.jpeg",
    "rock":     "assets/rocks and forest floor.jpeg",
    "farm":     "assets/farm assets.png",
    "water":    "assets/river and water decor.jpeg",
}
# Rows of the sheet occupied by the page title, which is never a sprite.
TITLE_H = {"village": 40, "fence": 48, "veg": 40, "rock": 46, "farm": 46, "water": 46}


def load(sheet):
    im = Image.open(os.path.join(ROOT, SHEETS[sheet])).convert("RGB")
    return np.asarray(im).astype(np.int16)


def flat_tones(a, sheet, min_share=0.0025, min_spread=0.30):
    """The sheet's flat chrome: panel fills, gridlines, page ground. Chrome is
    both common AND spread across the whole page; a sprite colour may be common
    but only ever appears in the handful of tiles that sprite occupies, so the
    spread test is what separates the two."""
    body = a[TITLE_H[sheet]:]
    flat = body.reshape(-1, 3)
    q = (body // 5).astype(np.int32)
    key = q[..., 0] * 10000 + q[..., 1] * 100 + q[..., 2]
    fkey = key.reshape(-1)
    vals, counts = np.unique(fkey, return_counts=True)
    order = counts.argsort()[::-1]
    T = 64
    h, w = key.shape
    tiles = [(y, x) for y in range(0, h, T) for x in range(0, w, T)]
    tones = []
    for j in order[:24]:
        if counts[j] / len(flat) < min_share:
            break
        v = vals[j]
        seen = sum(1 for (y, x) in tiles if (key[y:y + T, x:x + T] == v).any())
        if seen / len(tiles) < min_spread:
            continue
        tones.append(flat[fkey == v].mean(axis=0))
    return np.array(tones)


def sheet_bg(a, sheet):
    """The single dominant flat tone of the sheet's panels."""
    body = a[TITLE_H[sheet]:]
    q = (body.reshape(-1, 3) // 4).astype(np.int32)
    key = q[:, 0] * 10000 + q[:, 1] * 100 + q[:, 2]
    vals, counts = np.unique(key, return_counts=True)
    k = vals[counts.argmax()]
    sel = key == k
    return body.reshape(-1, 3)[sel].mean(axis=0)


def foreground_mask(a, sheet, tol=24):
    """True where a pixel is none of the sheet's flat chrome tones."""
    tones = flat_tones(a, sheet)
    fg = np.ones(a.shape[:2], dtype=bool)
    for t in tones:
        fg &= np.abs(a - t).max(axis=2) > tol
    fg[:TITLE_H[sheet]] = False
    return fg


def index(sheet):
    os.makedirs(WORK, exist_ok=True)
    a = load(sheet)
    fg = foreground_mask(a, sheet)
    # Close small gaps so a sprite's own anti-aliased interior counts as one
    # blob. If the sheet's panel gridlines survived matting they bridge every
    # cell into one giant component, so open the mask harder until they break.
    H, W = fg.shape
    for erode in (0, 1, 2, 3):
        m = ndimage.binary_opening(fg, np.ones((erode * 2 + 1,) * 2)) if erode else fg
        solid = ndimage.binary_closing(m, np.ones((5, 5)))
        lab, n = ndimage.label(solid, structure=np.ones((3, 3)))
        if not n:
            continue
        # A component spanning most of the page means surviving gridlines have
        # bridged the cells together — judged by bbox span, not pixel count,
        # since a lattice of thin lines covers little area but reaches everywhere.
        spans = [(s[0].stop - s[0].start) / H * (s[1].stop - s[1].start) / W
                 for s in ndimage.find_objects(lab)]
        if max(spans) < 0.35:
            break
    objs = ndimage.find_objects(lab)
    blobs = []
    for i, sl in enumerate(objs, start=1):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        area = int((lab[sl] == i).sum())
        # Labels are wide, short and sparse; sprites are chunky.
        if h < 14 or w < 10 or area < 260:
            continue
        if h < 20 and w > 90:
            continue
        blobs.append({"i": len(blobs), "x": int(xs.start), "y": int(ys.start),
                      "w": int(w), "h": int(h), "area": area})
    # Contact sheet: each blob drawn on a checker with its index stamped.
    src = Image.open(os.path.join(ROOT, SHEETS[sheet])).convert("RGB")
    cols = 8
    cw = max(b["w"] for b in blobs) + 8
    ch = max(b["h"] for b in blobs) + 16
    rows = (len(blobs) + cols - 1) // cols
    contact = Image.new("RGB", (cols * cw, rows * ch), (40, 90, 50))
    from PIL import ImageDraw
    d = ImageDraw.Draw(contact)
    for b in blobs:
        crop = src.crop((b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
        r, c = b["i"] // cols, b["i"] % cols
        contact.paste(crop, (c * cw + 4, r * ch + 12))
        d.text((c * cw + 4, r * ch + 1), str(b["i"]), fill=(255, 230, 120))
        d.rectangle([c * cw, r * ch, c * cw + cw - 1, r * ch + ch - 1], outline=(20, 20, 20))
    contact.save(os.path.join(WORK, f"contact_{sheet}.png"))
    json.dump(blobs, open(os.path.join(WORK, f"blobs_{sheet}.json"), "w"))
    print(f"{sheet}: {len(blobs)} blobs -> contact_{sheet}.png")
    for b in blobs:
        print(f"  {b['i']:>3}  {b['w']}x{b['h']} at ({b['x']},{b['y']})")


def matte(a, box, bg, keep_shadow=False, tol=26):
    """Crop `box` and turn the flat panel tone (plus its soft drop shadow) into
    real alpha. The shadow test asks whether a pixel is the background colour
    simply scaled darker — true for a cast shadow, false for coloured art."""
    x, y, w, h = box
    pad = 10  # blob boxes come from an opened mask, so the real sprite runs wider
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(a.shape[1], x + w + pad), min(a.shape[0], y + h + pad)
    sub = a[y0:y1, x0:x1].astype(float)
    bg = np.asarray(bg, dtype=float)

    dist = np.abs(sub - bg).max(axis=2)
    is_bg = dist <= tol

    # A cast shadow is just the panel colour scaled darker, so ask how well the
    # pixel is explained by bg * k: shadows leave almost no colour behind, art
    # does. Requiring the pixel to also be reachable from the outside keeps the
    # test from eating a sprite's interior — pixel art's dark outline is too
    # saturated to pass, so it walls the flood off at the silhouette.
    k = (sub @ bg) / float(bg @ bg)
    resid = np.abs(sub - k[..., None] * bg).max(axis=2)
    shadowish = (~is_bg) & (resid <= 10) & (k > 0.45) & (k < 0.985)
    is_shadow = shadowish & ndimage.binary_propagation(is_bg, mask=is_bg | shadowish)

    rgba = np.zeros(sub.shape[:2] + (4,), dtype=np.uint8)
    rgba[..., :3] = np.clip(sub, 0, 255).astype(np.uint8)
    rgba[..., 3] = 255
    rgba[is_bg] = (0, 0, 0, 0)
    if keep_shadow:
        # Re-express the baked shadow as a translucent dark wash so it reads
        # correctly over grass instead of as a grey smudge.
        sh = np.clip((1.0 - k) * 2.2, 0, 0.55)
        idx = is_shadow
        rgba[..., 0][idx] = 20
        rgba[..., 1][idx] = 26
        rgba[..., 2][idx] = 16
        rgba[..., 3][idx] = (sh[idx] * 255).astype(np.uint8)
    else:
        rgba[is_shadow] = (0, 0, 0, 0)

    img = Image.fromarray(rgba, "RGBA")
    # Drop JPEG-ringing specks, and anything touching the crop border — that is
    # always a neighbouring panel's gridline caught by the padding, never part
    # of the sprite, which sits comfortably inside its own cell.
    al = np.asarray(img)[..., 3] > 8
    lab, n = ndimage.label(al, structure=np.ones((3, 3)))
    if n:
        edge = set(lab[0].tolist()) | set(lab[-1].tolist()) \
             | set(lab[:, 0].tolist()) | set(lab[:, -1].tolist())
        sizes = ndimage.sum(al, lab, range(1, n + 1))
        main = int(np.argmax(sizes)) + 1   # the sprite itself, border-touching or not
        keep = [main] + [i + 1 for i, s in enumerate(sizes)
                         if i + 1 != main and s >= 10 and (i + 1) not in edge]
        arr = np.asarray(img).copy()
        arr[~np.isin(lab, keep)] = 0
        img = Image.fromarray(arr, "RGBA")
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


# How close to the panel tone still counts as background. Tight where the
# sprites themselves are near the panel's own lightness (grey rock on tan
# paper, dark foliage on dark paper) or the matte eats the art.
CUT_TOL = {"village": 18, "fence": 12, "veg": 15, "rock": 13, "farm": 18, "water": 18}


def cut(sheet, specs):
    a = load(sheet)
    blobs = json.load(open(os.path.join(WORK, f"blobs_{sheet}.json")))
    bg = sheet_bg(a, sheet)
    tol = CUT_TOL.get(sheet, 20)
    os.makedirs(OUT, exist_ok=True)
    for spec in specs:
        idx, name = spec.split(":", 1)
        keep_shadow = name.endswith("!")
        name = name.rstrip("!")
        b = blobs[int(idx)]
        img = matte(a, (b["x"], b["y"], b["w"], b["h"]), bg, keep_shadow, tol)
        img.save(os.path.join(OUT, name + ".png"))
        print(f"  {name}.png  {img.width}x{img.height}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "index":
        index(sys.argv[2])
    elif cmd == "cut":
        cut(sys.argv[2], sys.argv[3:])
