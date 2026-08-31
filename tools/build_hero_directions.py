"""Build a hero's four-direction idle + walk sheet from three source views.

WHY THE SIDE VIEW NEEDS A DIFFERENT TECHNIQUE
---------------------------------------------
The front and back views are frontal-plane drawings, so the two legs sit side by
side and a split down the figure's own centre separates them. Both are animated
by LIFTING a leg -- never splaying it, because in a frontal view a stride travels
toward and away from the camera, so a sideways splay is not a step, it is the
splits, and it opens a gap the torso then encloses.

The side view cannot be cut that way. Measured across all seven heroes, the
profile legs form a SINGLE opaque run on 118 of 119 rows below the hip: the near
leg completely occludes the far one. A centre split there would not separate left
leg from right leg, it would slice the body front from back and tear the figure
in half lengthwise as the halves swung apart.

So the far leg is not cut out -- it is RECONSTRUCTED. The one leg the artist drew
is stamped twice, offset fore and aft and darkened behind, which is how a
side-view walk is drawn by hand. Nothing is redesigned: the silhouette, the
palette and every pixel of shading are still the artist's.

THE HEM
-------
Animating everything below the hip would scissor the Mage's coat and the
Summoner's robe -- it tore a 21px void in the Summoner's skirt. So the band is
split where the opaque width collapses: garment above, bare leg below. Only the
bare leg walks; the garment travels with the torso. For a robed hero that leaves
just the boots stepping out from under the hem, which is exactly right.

One hem per hero, not per view: a garment hangs at one height on the body
whichever way he is turned, and the tallest of the three readings is used because
under-detecting tears a robe while over-detecting merely animates less leg.

DRAW ORDER
----------
Far leg, near leg, garment, torso -- torso LAST in every view, so the hip join is
covered by construction whatever the legs do. Each leg mask also reaches up UNDER
the garment by its own travel distance, so a leg at full extension still has
cover overlapping the hem; those hidden rows are painted over and never seen.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

# Source views live outside the repo, in the scratch area where the model sheets
# were cut up. Point SRC at that directory to re-run:
#
#     SRC=/path/to/views python3 tools/build_hero_directions.py
#
# It expects <hero>_front.png, <hero>_side.png and <hero>_back.png, each the same
# figure at the same scale.
SRC = os.environ.get('SRC', '')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEROES = ['warrior', 'mage', 'rogue', 'ranger', 'paladin', 'berserker', 'summoner']

HIP = 0.58          # where the legs start, as a fraction of figure height
STRIDE = 3          # half the fore/aft foot separation, in px, at 68px tall
LIFT = 2            # how far a foot rises in the frontal views
FAR = 0.72          # how much the far leg darkens
COLS = 7            # 1 idle + 6 walk
NOTCH = 6           # largest void the repair pass may close (see fill_notches)

# Every one of the seven source profiles faces RIGHT -- checked by eye against
# spine/side_facing.png, noses and boot toes alike. A toe-versus-shin heuristic
# was tried first and got four of the seven backwards, which would have had half
# the roster walking backwards, so the canon is asserted rather than guessed.
SOURCE_FACES = 1


def band(a, y0, y1, side=None, cx=None):
    m = np.zeros(a.shape[:2], bool)
    m[y0:y1] = a[y0:y1, :, 3] > 0
    if side == 'l':
        m[:, int(cx):] = False
    elif side == 'r':
        m[:, :int(cx)] = False
    return m


def compose(a, parts, size, pad):
    """parts: (mask, dx, dy, dim). Later parts paint over earlier ones."""
    H, W = size
    out = np.zeros((H, W, 4), np.uint8)
    for m, dx, dy, dim in parts:
        ys, xs = np.where(m)
        ny, nx = ys + dy + pad, xs + dx + pad
        ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
        px = a[ys[ok], xs[ok]].astype(np.int32)
        if dim != 1.0:
            px[:, :3] = (px[:, :3] * dim).astype(np.int32)
        out[ny[ok], nx[ok]] = np.clip(px, 0, 255).astype(np.uint8)
    return fill_notches(out)


def fill_notches(f):
    """Close the pinholes that offsetting cut pieces inevitably opens.

    Sliding one piece of a flat illustration past another leaves 1-3px voids at
    the corners where their outlines no longer agree. They are not a bug in any
    one number -- they are the structural cost of cutout animation, the same
    reason a rotated limb exposes the hole behind it.

    Only voids of NOTCH px or fewer are closed, and only ones fully enclosed by
    the body. That bound is what keeps this honest: the real gaps in the source
    art -- between the Rogue's legs under his tunic, the Ranger's under his --
    measure 8 to 25px, so this pass provably cannot reach them. It closes seams
    the animation opened and nothing the artist drew.
    """
    op = f[:, :, 3] > 0
    lab, n = ndimage.label(~op)
    if n == 0:
        return f
    edge = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
    inner = [i for i in range(1, n + 1) if i not in edge]
    if not inner:
        return f
    sizes = ndimage.sum(np.ones_like(lab), lab, inner)
    small = [i for i, s in zip(inner, sizes) if s <= NOTCH]
    if not small:
        return f
    hole = np.isin(lab, small)
    # Paint each pinhole from its nearest opaque neighbour, so the fill takes the
    # local shading rather than a flat colour.
    _, (iy, ix) = ndimage.distance_transform_edt(hole, return_indices=True)
    f[hole] = f[iy[hole], ix[hole]]
    return f


def hem_row(a, hip):
    """Where a coat or tabard ends and bare leg begins.

    The signal is a sharp DROP in opaque width, not a low absolute width. An
    earlier version thresholded on width and picked the ankle taper on every
    hero -- it put the Warrior's hem at y=57, four rows above his boot, when he
    wears plain trousers and has no hem at all.

    The search starts below the hip-to-thigh taper and ends above the ankle,
    the two other places the width falls away. Measured over a two-row window,
    because a hem can shade out over two rows. A hero in trousers has no such
    drop and falls through to the hip.
    """
    op = a[:, :, 3] > 0
    w = [int(op[y].sum()) for y in range(hip, a.shape[0])]
    lo, hi = 4, int(len(w) * 0.62)          # below hi it is ankle, above lo it is hip
    best, at = 0, None
    for i in range(lo, hi):
        d = w[i - 2] - w[i]
        if d > best:
            best, at = d, hip + i
    hem = at if best >= 3 else hip
    # Always keep a short pelvis strip with the torso. The pelvis does not swing,
    # and being wider than the legs it covers the top of them as they do.
    return max(hem, hip + 4)


def frontal_frames(a, hip, hem, pad, size):
    """Front or back: split the bare legs left/right and LIFT them."""
    top = max(hip, hem - LIFT - 1)
    skirt = band(a, hip, hem)
    ys, xs = np.where(band(a, top, a.shape[0]))
    # Split the legs on THEIR centre, not the figure's: a cape or a pauldron
    # pulls the whole figure's centroid off the hips.
    cx = xs.mean() if len(xs) else a.shape[1] / 2
    body = band(a, 0, hip)
    legL = band(a, top, a.shape[0], 'l', cx)
    legR = band(a, top, a.shape[0], 'r', cx)

    def f(bob, upL, upR, sway=0):
        return compose(a, [(legR, 0, bob - upR, 1.0), (legL, 0, bob - upL, 1.0),
                           (skirt, sway, bob, 1.0), (body, sway, bob, 1.0)],
                       size, pad)

    # contact, down, pass -- twice, once per leg. `sway` leans the upper body a
    # pixel toward the planted foot; without it the feet move but the weight
    # never transfers, and it reads as marching on the spot.
    return [f(0, 0, 0),                                     # idle, static
            f(0, LIFT, 0, +1), f(-1, LIFT // 2, 0, +1), f(0, 0, 0, 0),
            f(0, 0, LIFT, -1), f(-1, 0, LIFT // 2, -1), f(0, 0, 0, 0)]


def side_frames(a, hip, hem, pad, size):
    """Profile: stamp the one drawn leg twice, fore and aft."""
    top = max(hip, hem - STRIDE - 1)
    body = band(a, 0, hip)
    skirt = band(a, hip, hem)
    legs = band(a, top, a.shape[0])
    S, fwd = STRIDE, SOURCE_FACES

    # One leg through six beats: heel contact ahead, weight over it, passing
    # under the body, pushing off behind, toe lifting, swinging through raised.
    cyc = [(+S, 0), (+S // 2 + 1, 0), (0, 0), (-S, 0), (-S // 2 - 1, 2), (0, 2)]
    bob = [0, 0, -1, 0, 0, -1]      # lowest at contact, highest as a leg passes

    def f(p):
        nx, nl = cyc[p]
        fx, fl = cyc[(p + 3) % 6]           # far leg, half a cycle behind
        return compose(a, [
            (legs, fx * fwd, -fl, FAR),     # far leg, behind and darker
            (legs, nx * fwd, -nl, 1.0),     # near leg, in front
            (skirt, 0, bob[p], 1.0),
            (body, 0, bob[p], 1.0),         # torso last: the hip is covered
        ], size, pad)

    idle = compose(a, [(legs, 0, 0, 1.0), (skirt, 0, 0, 1.0), (body, 0, 0, 1.0)],
                   size, pad)
    return [idle] + [f(p) for p in range(6)]


def baseline(frame):
    """Foot centre and ground row of a composed frame."""
    op = frame[:, :, 3] > 0
    ys = np.where(op.any(axis=1))[0]
    bot = ys.max()
    top = max(ys.min(), bot - max(1, int(round((bot - ys.min()) * 0.22))))
    xs = np.where(op[top:bot + 1].any(axis=0))[0]
    return (float(xs.mean()) if len(xs) else frame.shape[1] / 2), int(bot)


def build(hero):
    src = {'down': f'{SRC}/{hero}_front.png',
           'side': f'{SRC}/{hero}_side.png',
           'up':   f'{SRC}/{hero}_back.png'}
    art = {d: np.array(Image.open(p).convert('RGBA')) for d, p in src.items()}
    hip = int(next(iter(art.values())).shape[0] * HIP)
    hem = max(hem_row(a, hip) for a in art.values())        # one hem per hero
    pad = STRIDE + 3

    views = {}
    for d, a in art.items():
        size = (a.shape[0] + pad * 2, a.shape[1] + pad * 2)
        views[d] = (side_frames if d == 'side' else frontal_frames)(a, hip, hem, pad, size)

    # Register the three views to ONE origin: the foot centre and ground row of
    # each view's IDLE frame. Every frame of a view gets that view's offset, so
    # the bob and the lift survive -- re-centring each frame on its own content
    # would silently cancel the very animation it is meant to carry.
    order = ['side', 'up', 'down']
    anch = {d: baseline(views[d][0]) for d in order}
    left = max(anch[d][0] for d in order)
    right = max(views[d][0].shape[1] - anch[d][0] for d in order)
    top = max(anch[d][1] for d in order)
    bot = max(views[d][0].shape[0] - anch[d][1] for d in order)
    cw, ch = int(np.ceil(left + right)), int(top + bot)

    sheet = Image.new('RGBA', (cw * COLS, ch * len(order)), (0, 0, 0, 0))
    for r, d in enumerate(order):
        ox, oy = int(round(left - anch[d][0])), int(top - anch[d][1])
        for c, fr in enumerate(views[d]):
            sheet.alpha_composite(Image.fromarray(fr), (c * cw + ox, r * ch + oy))
    sheet.save(f'{ROOT}/assets/actors/hi/{hero}.png')
    return {'cellW': cw, 'cellH': ch, 'columns': COLS,
            'anchorX': int(round(left)), 'anchorY': int(top) + 1, 'hem': hem}


if __name__ == '__main__':
    meta = {}
    for hero in HEROES:
        m = build(hero)
        meta[hero] = m
        print(f"  {hero:10s} cell {m['cellW']}x{m['cellH']}  "
              f"anchor ({m['anchorX']},{m['anchorY']})  hem y={m['hem']}")
    json.dump(meta, open(f'{ROOT}/assets/actors/hi/_cells.json', 'w'), indent=2)
