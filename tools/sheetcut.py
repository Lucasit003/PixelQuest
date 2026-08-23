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


def matte(a, box, bg, keep_shadow=False, tol=26, reach=False):
    """Crop `box` and turn the flat panel tone (plus its soft drop shadow) into
    real alpha. The shadow test asks whether a pixel is the background colour
    simply scaled darker — true for a cast shadow, false for coloured art."""
    x, y, w, h = box
    pad = 10  # blob boxes come from an opened mask, so the real sprite runs wider
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(a.shape[1], x + w + pad), min(a.shape[0], y + h + pad)
    sub = a[y0:y1, x0:x1].astype(float)
    bg = np.asarray(bg, dtype=float)

    # Straight colour test, applied everywhere. Connectivity was tried here and
    # is wrong for this art: the page shows THROUGH the gaps in a fence, and
    # those gaps are enclosed by the sprite, so a flood from the border leaves
    # them as solid white bands. Measured, the page and the wood are 133 apart
    # while the page and its own JPEG rim are 3-19 apart, so one threshold
    # separates them — the rim that a global test used to bite off the art is
    # now handled properly by the de-fringe pass below instead.
    dist = np.abs(sub - bg).max(axis=2)
    near_bg = dist <= tol
    if reach:
        # Reachability mode, for art whose own colour IS the page: the well's
        # masonry is the same grey as the paper it was drawn on, so no threshold
        # can separate them. What separates them is that the page runs out to
        # the crop border and the masonry is walled in by the well's own outline.
        # Only correct where the page does NOT show through the sprite — use the
        # plain test for anything with real gaps in it, like a fence, or the page
        # trapped inside those gaps survives as solid bands.
        seed = np.zeros(near_bg.shape, dtype=bool)
        seed[0, :] = seed[-1, :] = True
        seed[:, 0] = seed[:, -1] = True
        is_bg = ndimage.binary_propagation(seed & near_bg, mask=near_bg)
        # Reachability keeps everything walled in — including page that the art
        # has trapped, like the gap under a bucket's handle. Such a pocket is
        # FLAT page colour; the masonry this mode exists to rescue is textured
        # with mortar lines. Flatness is what tells them apart, so drop enclosed
        # pockets that are both very close to the page and almost variance-free.
        trapped = near_bg & ~is_bg
        tl, tn = ndimage.label(trapped)
        for i in range(1, tn + 1):
            m = tl == i
            if m.sum() < 8:
                continue
            if np.percentile(dist[m], 90) <= 10 and sub[m].std(axis=0).max() < 6:
                is_bg |= m
    else:
        is_bg = near_bg

    # A cast shadow is just the panel colour scaled darker, so ask how well the
    # pixel is explained by bg * k: shadows leave almost no colour behind, art
    # does. Requiring the pixel to also be reachable from the outside keeps the
    # test from eating a sprite's interior — pixel art's dark outline is too
    # saturated to pass, so it walls the flood off at the silhouette.
    k = (sub @ bg) / float(bg @ bg)
    resid = np.abs(sub - k[..., None] * bg).max(axis=2)
    # Reachability mode is chosen precisely for art whose own colour matches the
    # page, and on such art the shadow test cannot work: grey masonry on a grey
    # page IS the page scaled darker by every measure this test has, so it
    # strips the stonework as if it were a cast shadow. These sheets show no
    # baked drop shadow anyway, so in that mode the test is switched off.
    shadowish = np.zeros(is_bg.shape, dtype=bool) if reach else (
        (~is_bg) & (resid <= 10) & (k > 0.45) & (k < 0.985))
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

    # Close pinholes. Shading inside a sprite can match the paper closely enough
    # to be matted away — a mushroom's shaded underside, a fold in a shirt —
    # leaving transparent specks in the middle of solid art. Anything FULLY
    # enclosed by opaque pixels is such a mistake, since none of this art has a
    # real interior window; a fence's gaps stay open because they connect to the
    # outside and so are never counted as holes.
    solid = rgba[..., 3] > 40
    holes = ndimage.binary_fill_holes(solid) & ~solid
    # Size-limit it. A pinhole is a handful of pixels; the gap between two fence
    # rails, or the space framed by a clothes line and its two posts, is also
    # "enclosed" and filling those paints the sheet's own paper back in as a
    # solid band. Only specks are mistakes.
    if holes.any():
        hl, hn = ndimage.label(holes)
        if hn:
            big = [i + 1 for i, sz in enumerate(ndimage.sum(holes, hl, range(1, hn + 1))) if sz > 14]
            holes &= ~np.isin(hl, big)
    if holes.any():
        rgba[..., :3][holes] = np.clip(sub, 0, 255).astype(np.uint8)[holes]
        rgba[..., 3][holes] = 255

    # De-fringe. JPEG blurs each sprite's outline into the paper, leaving a rim
    # of intermediate pixels the flood fill cannot reach — invisible on grass,
    # glaring against anything pale. A rim pixel is ringing if it sits markedly
    # CLOSER to the paper colour than the art immediately behind it does; that
    # comparison is what protects genuinely pale art, because a white shirt's
    # rim and its interior are equally white and the test comes out flat.
    for _ in range(0 if reach else 2):
        al = rgba[..., 3] > 40
        if not al.any():
            break
        rim = al & ~ndimage.binary_erosion(al, np.ones((3, 3)))
        dist = np.abs(rgba[..., :3].astype(float) - bg).max(axis=2)
        inner = (al & ~rim).astype(float)
        dsum = ndimage.uniform_filter(np.where(al & ~rim, dist, 0.0), 3)
        dcnt = ndimage.uniform_filter(inner, 3)
        # Where a pixel has NO opaque interior behind it the sprite is only a
        # few pixels thick there — a shirt on a line, a mushroom stem — and the
        # comparison has nothing to say. Default that case to keep. Defaulting
        # it to remove (a large sentinel) strips exactly the thin pale art the
        # test was supposed to protect, which is what shredded the clothes line.
        behind = np.where(dcnt > 1e-6, dsum / np.maximum(dcnt, 1e-6), 0.0)
        rgba[rim & (dist + 10 < behind)] = 0

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
        # Also drop hairline fragments: a surviving scrap of the sheet's own cell
        # gridline lands inside the padded crop without touching its border, so
        # the border test misses it. Nothing in this art is a two-pixel-tall
        # isolated rule, so thinness identifies them exactly.
        boxes = ndimage.find_objects(lab)
        def hairline(i):
            sl = boxes[i]
            h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
            return min(h, w) <= 3 and max(h, w) >= 10
        keep = [main] + [i + 1 for i, s in enumerate(sizes)
                         if i + 1 != main and s >= 10 and (i + 1) not in edge
                         and not hairline(i)]
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
    os.makedirs(OUT, exist_ok=True)
    for spec in specs:
        idx, name = spec.split(":", 1)
        keep_shadow = name.endswith("!")
        name = name.rstrip("!")
        # name~N overrides the sheet tolerance for one sprite. The fence sheet's
        # background is nearly white, so its default has to run tight or pale art
        # dissolves — but that same tightness leaves a bright halo on the few
        # sprites whose own edges are light. Per-sprite is the right grain here.
        tol = CUT_TOL.get(sheet, 20)
        reach = name.endswith("^")     # flood from the border instead of keying
        name = name.rstrip("^")
        if "~" in name:
            name, t = name.split("~", 1)
            tol = int(t)
        b = blobs[int(idx)]
        img = matte(a, (b["x"], b["y"], b["w"], b["h"]), bg, keep_shadow, tol, reach)
        img.save(os.path.join(OUT, name + ".png"))
        print(f"  {name}.png  {img.width}x{img.height}")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "index":
        index(sys.argv[2])
    elif cmd == "cut":
        cut(sys.argv[2], sys.argv[3:])
