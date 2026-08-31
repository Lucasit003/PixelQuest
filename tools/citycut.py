"""Slice the generated Ancient City sheets (assets/_src/city/*.png) into props.

Unlike the Mystical Tree sheet, these arrive from Gemini as flat RGB with an
off-white background and no alpha at all, so there is a keying stage before
anything else can happen:

  key      flood the off-white in from the border -> real alpha
  deflange strip the pale desaturated matting ring the key leaves behind
  label    connected components (dilated) -> one blob per sprite
  cut      write named blobs to assets/props/_src/ at sheet resolution

Flooding from the BORDER rather than thresholding on colour is what keeps a
sunlit sandstone wall or a white blossom from being punched out of the middle
of a sprite: only background actually connected to the edge is removed.

  python3 tools/citycut.py index buildings        # contact sheet + blobs json
  python3 tools/citycut.py keyed buildings        # keyed PNG, for eyeballing
  python3 tools/citycut.py cut   buildings        # every NAMED blob -> _src
  python3 tools/citycut.py cut   buildings name.. # just these names

Cuts land at sheet resolution; tools/bake_props.py then resamples them to the
sizes DECOR_SIZE asks for, same as every other prop.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, "assets/_src/city")
OUT = os.path.join(ROOT, "assets/props/_src")
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_index")

DILATE = 3    # px; merges a sprite's detached clusters without bridging gutters
MIN_PX = 400  # blobs smaller than this are keying dust, not sprites

# blob index -> prop name, filled in after eyeballing the indexed contact
# sheet. Same contract as mysticut.py: None leaves a blob uncut, a list gives
# one blob several names, and a tuple carries an explicit sub-box
# (name, x0, y0, x1, y1) relative to the blob's own crop for sprites that
# ended up merged.
NAMES = {
    # Blob indices come from `index`, which sorts roughly in reading order.
    # Where the sheet's own row banding fights that sort the entry is placed by
    # its printed (x, y), not by its index — see the comments.
    "buildings": {
        0: "city_watchtower", 1: "city_temple", 2: "city_townhouse", 3: "city_rotunda",
        4: "city_gatehouse", 7: "city_hall_colonnade",   # 7 sorts late; it is row 2 col 2
        5: "city_granary", 6: "city_shrine",
        8: "city_merchant_house", 9: "city_chapel", 10: "city_greathall", 11: "city_archive",
    },
    "monuments": {
        0: "city_statue_king", 1: "city_statue_rider", 2: "city_arch_triumph",
        3: "city_statue_winged", 4: "city_statue_scholar", 5: "city_statue_warrior",
        6: "city_statue_headless", 7: "city_obelisk", 8: "city_stele",
        14: "city_statue_toppled",                        # 14 is row 3 col 1
        9: "city_lion_l", 10: "city_lion_r", 11: "city_votive_column",
        12: "city_standing_stones", 13: "city_stardial",
    },
    "vegetation": {
        # row 1 — the three tree-and-stone set pieces and a bare sapling. Blob 2
        # (the big rooted tree) touches y=0 on the sheet, so its canopy is
        # clipped; it is left uncut rather than shipped with a flat top.
        0: "city_tree_wall", 1: "city_tree_door", 2: None, 3: "city_sapling",
        # row 2 — ivy, flowering shrubs, a stump and ferns
        5: "city_ivy_curtain", 6: "city_ivy_mound", 7: "city_shrub_white",
        4: "city_shrub_blue", 8: "city_stump_shoots", 9: "city_ferns",
        # row 3 — ground-level growth, and the flat moss patch
        10: "city_wildflowers", 11: "city_grass_clump", 13: "city_stump_small",
        12: "city_vine_trellis", 14: "city_moss_patch",
    },
    # ---- Plaza set: town-style kits, generated against a reference sheet of
    # the game's OWN props so they sit beside bench_01 and the market stalls
    # rather than beside the sandstone city set.
    "moonkit": {
        0: "gk_moonbell", 1: "gk_moonbell_clump",
        2: "gk_trellis_vine", 3: "gk_basket",
    },
    "herokit": {
        0: "gk_herotree", 2: "gk_ruin_foundation", 1: "gk_ruin_stub",
        3: "gk_ruin_fragments", 4: "gk_tools", 5: "gk_wateringcan",
    },
    "pondkit": {
        0: "gk_pond", 1: "gk_bed_crescent", 2: "gk_bed_broad",
        3: "gk_bed_ribbon", 4: "gk_pedestal",
    },
    "farmkit": {
        0: "scarecrow",
        # the wingbeat cycle: up -> half -> down, plus a flat glide and a perch
        1: "crow_up", 2: "crow_down", 3: "crow_half", 4: "crow_glide", 5: "crow_perch",
    },
    "gardenkit": {
        0: ["gk_hedge", "gk_hedge_ns"], 1: "gk_hedge_corner", 2: "gk_hedge_end",
        3: "gk_arch", 4: "gk_trellis", 5: "gk_birdbath", 6: "gk_sundial",
        7: "gk_bed_blue", 8: "gk_bed_white", 9: "gk_urn",
        10: "gk_gravel", 11: "gk_stepstones",
    },
    # A third sheet, for the aqueducts alone. On the first water sheet they
    # were drawn with the channel receding diagonally, which at draw size read
    # as a blue water slide rather than as architecture; these are dead
    # front-on. All four are punched, since the arch voids are holes.
    "aqueduct": {
        0: "city_aqueduct", 1: "city_aqueduct_broken",
        2: "city_aqueduct_pier", 3: "city_aqueduct_end",
    },
    # A second, corrective water sheet. The first one came back with the
    # terrace, the bridge and the canals drawn at an isometric angle, and with
    # kerbs too thin to survive the downscale. These five replace them by name,
    # so the cut simply overwrites the earlier _src files.
    "water2": {
        0: "city_cascade", 1: "city_waterbridge", 2: "city_canal",
        # both N-S variants came out inside one blob; the left one is the
        # broad-kerbed run this sheet was asked for, the right one is a
        # narrower channel that is not needed.
        3: [("city_canal_ns", 0, 0, 255, 397)],
        4: "city_canal_cross",
    },
    "water": {
        # row 1 — the grand fountain, the reflecting pool, and the two canal runs
        0: "city_fountain", 1: "city_pool", 2: "city_canal", 3: "city_canal_ns",
        # row 2 — aqueduct whole and broken, the mask fountain, the well
        4: "city_aqueduct", 5: "city_aqueduct_broken", 6: "city_wallfountain", 7: "city_well",
        # row 3 — cascade, bathing pool, water bridge, dry basin
        8: "city_cascade", 9: "city_bath", 10: "city_waterbridge", 11: "city_basin_dry",
    },
    "walls": {
        # row 1 — E-W battlemented runs
        0: "city_wall", 1: "city_wall_broken", 2: "city_wall_ivy", 3: "city_wall_steps",
        # row 2 — postern, the N-S run seen from above, a battlement breach, corner tower
        4: "city_wall_door", 5: "city_wall_ns", 6: "city_wall_gap", 7: "city_wall_corner",
        # row 3 — civic steps, ramp, and the two flat paving runs
        8: "city_steps", 9: "city_ramp", 10: "city_paving", 11: "city_paving_ns",
        # row 4 — crossroads, rubble, and the low boundary wall. The rubble
        # scatter keys as six separate specks; the three biggest are worth
        # having as ground detail, the rest are dust.
        12: "city_paving_cross", 13: "city_rubble_heap", 19: "city_wall_low",
        15: "city_rubble_a", 17: "city_rubble_b", 16: "city_rubble_c",
    },
}

# Cuts with a genuine HOLE in them — an arch you should see grass through.
# The border flood cannot reach an enclosed void, so it survives the key as a
# blob of background colour sitting inside the sprite. This cannot be decided
# by colour: the bridge's arch void measures (245,241,230) and the great hall's
# window tracery, which must NOT be punched, measures (252,243,236). So it is
# an explicit list, one entry per verified sprite.
PUNCH = {"city_waterbridge", "city_arch_triumph", "city_gatehouse",
         "city_aqueduct", "city_aqueduct_broken", "city_aqueduct_pier",
         "city_aqueduct_end", "city_hall_colonnade",
         "gk_arch", "gk_trellis"}


def punch_holes(arr, min_px=60):
    """Clear enclosed background-coloured regions inside an already-cut sprite."""
    rgb = arr[..., :3].astype(np.int16)
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    bgish = (arr[..., 3] > 0) & (mn > 200) & ((mx - mn) < 26)
    lab, n = ndimage.label(bgish)
    out = arr.copy()
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() < min_px:
            continue
        out[..., 3] = np.where(m, 0, out[..., 3])
    return out


# Cuts that are pre-rotated on disk (degrees CCW). The engine draws props
# upright and can only mirror them, so anything that must run north-south gets
# its rotated twin made here rather than at draw time. Nothing needs it yet —
# the walls sheet was drawn with its own north-south pieces.
ROTATE = {"gk_hedge_ns": 90}


# Sheets live under assets/_src/<set>/. The city set came first; the plaza set
# is the town-style kit. Looked up by search rather than by prefix so a sheet
# can be moved between sets without renaming every reference to it.
SHEET_DIRS = [SHEETS, os.path.join(ROOT, "assets/_src/plaza")]


def sheet_path(name):
    fn = name if name.endswith(".png") else name + ".png"
    for d in SHEET_DIRS:
        p = os.path.join(d, fn)
        if os.path.exists(p):
            return p
    sys.exit(f"no such sheet: {fn} (looked in {', '.join(SHEET_DIRS)})")


def key(path):
    """Off-white background -> transparent, flooded in from the border."""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx, mn = a.max(axis=2), a.min(axis=2)
    # Background is light and near-neutral. Generous on both counts — the
    # flood, not this test, is what protects the sprites' own light pixels.
    bgish = (mn > 200) & ((mx - mn) < 26)
    # Flood from the border: only background touching the edge is removed.
    seed = np.zeros_like(bgish)
    seed[0, :] = seed[-1, :] = True
    seed[:, 0] = seed[:, -1] = True
    seed &= bgish
    bg = ndimage.binary_propagation(seed, mask=bgish)
    # Close single-pixel pinholes in the background (JPEG-ish speckle from the
    # generator) so they do not survive as dust blobs.
    bg = ndimage.binary_closing(bg, structure=np.ones((3, 3)))
    bg = ndimage.binary_propagation(seed, mask=bg | seed)

    out = np.dstack([np.asarray(im), np.where(bg, 0, 255).astype(np.uint8)])
    return deflange(out)


def deflange(arr):
    """Strip the pale desaturated ring the key leaves on every silhouette.

    docs/ART_RULES.md calls this out as the recurring defect: invisible on one
    prop, it draws a white grid the moment several are placed together. The
    saturation test is what stops the repair eating real highlights.
    """
    rgb = arr[..., :3].astype(np.int16)
    alpha = arr[..., 3] > 0
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    edge = alpha & ~ndimage.binary_erosion(alpha, iterations=2)
    body_v = np.median(mx[alpha]) if alpha.any() else 255
    flange = edge & (mn > 190) & ((mx - mn) < 24) & (mx > body_v)
    arr = arr.copy()
    arr[..., 3] = np.where(flange, 0, arr[..., 3])
    return arr


def blobs(name):
    arr = key(sheet_path(name))
    alpha = arr[..., 3] > 24
    fat = ndimage.binary_dilation(alpha, iterations=DILATE)
    lab, _n = ndimage.label(fat)
    boxes = []
    for k, sl in enumerate(ndimage.find_objects(lab), start=1):
        y0, x0 = sl[0].start, sl[1].start
        # only THIS blob's pixels, so two sprites whose boxes overlap never
        # leak into each other's cut
        m = alpha[sl] & (lab[sl] == k)
        if m.sum() < MIN_PX:
            continue
        ys, xs = np.where(m)
        boxes.append([int(x0 + xs.min()), int(y0 + ys.min()),
                      int(x0 + xs.max() + 1), int(y0 + ys.max() + 1), k])
    boxes.sort(key=lambda b: (b[1] // 110, b[0]))  # rough reading order
    return arr, boxes, lab


def index(name):
    arr, boxes, _ = blobs(name)
    os.makedirs(WORK, exist_ok=True)
    sheet = Image.fromarray(arr).convert("RGB")
    d = ImageDraw.Draw(sheet)
    for i, (x0, y0, x1, y1, _k) in enumerate(boxes):
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 60, 60), width=2)
        d.text((x0 + 3, y0 + 2), str(i), fill=(255, 255, 80))
    sheet.save(os.path.join(WORK, f"city_{name}_contact.png"))
    json.dump(boxes, open(os.path.join(WORK, f"blobs_city_{name}.json"), "w"))
    for i, (x0, y0, x1, y1, _k) in enumerate(boxes):
        print(f"  {i:3d}  {x1 - x0:4d}x{y1 - y0:<4d}  at ({x0},{y0})")
    print(f"{len(boxes)} blobs -> {WORK}/city_{name}_contact.png")


def keyed(name):
    """Write the keyed sheet on a checkerboard so the alpha can be eyeballed."""
    arr = key(sheet_path(name))
    im = Image.fromarray(arr)
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    checks = np.where(((xx // 16 + yy // 16) % 2) == 0, 210, 170).astype(np.uint8)
    bg = Image.fromarray(np.dstack([checks] * 3 + [np.full_like(checks, 255)]))
    bg.alpha_composite(im)
    os.makedirs(WORK, exist_ok=True)
    p = os.path.join(WORK, f"city_{name}_keyed.png")
    bg.convert("RGB").save(p)
    print(f"{p}  ({(arr[..., 3] > 24).mean() * 100:.1f}% opaque)")


def cut(name, want):
    arr, _boxes, lab = blobs(name)
    boxes = json.load(open(os.path.join(WORK, f"blobs_city_{name}.json")))
    im = Image.fromarray(arr)
    os.makedirs(OUT, exist_ok=True)
    for i, spec in NAMES.get(name, {}).items():
        if spec is None:
            continue
        entries = spec if isinstance(spec, list) else [spec]
        for e in entries:
            nm, sub = (e, None) if isinstance(e, str) else (e[0], e[1:])
            if want and nm not in want:
                continue
            x0, y0, x1, y1, k = boxes[i]
            if sub:
                sx0, sy0, sx1, sy1 = sub
                x0, y0, x1, y1 = x0 + sx0, y0 + sy0, x0 + sx1, y0 + sy1
            a = np.array(im.crop((x0, y0, x1, y1)))
            a[..., 3] = np.where(lab[y0:y1, x0:x1] == k, a[..., 3], 0)
            crop = Image.fromarray(a)
            m = a[..., 3] > 24
            if not m.any():
                print(f"  {nm:26s} blob {i:3d}  EMPTY after mask — skipped")
                continue
            ys, xs = np.where(m)
            crop = crop.crop((int(xs.min()), int(ys.min()),
                              int(xs.max() + 1), int(ys.max() + 1)))
            if nm in PUNCH:
                crop = Image.fromarray(punch_holes(np.array(crop)))
            if nm in ROTATE:
                crop = crop.rotate(ROTATE[nm], expand=True)
            crop.save(os.path.join(OUT, nm + ".png"))
            print(f"  {nm:26s} blob {i:3d}  {crop.size[0]}x{crop.size[1]}")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "index"
    if len(sys.argv) < 3:
        sys.exit(f"usage: python3 tools/citycut.py {mode} SHEET [names..]")
    sheet = sys.argv[2]
    if mode == "index":
        index(sheet)
    elif mode == "keyed":
        keyed(sheet)
    elif mode == "cut":
        cut(sheet, set(sys.argv[3:]))
    else:
        sys.exit(f"unknown mode {mode!r} (index | keyed | cut)")
