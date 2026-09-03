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
import math
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


def side_stance(a, hip, hem, pad, size, near=(0, 0), far=(0, 0), body_off=(0, 0)):
    """One profile pose: far leg, near leg, garment, torso last."""
    top = max(hip, hem - STRIDE - 1)
    fwd = SOURCE_FACES
    return compose(a, [
        (band(a, top, a.shape[0]), far[0] * fwd, -far[1], FAR),
        (band(a, top, a.shape[0]), near[0] * fwd, -near[1], 1.0),
        (band(a, hip, hem), body_off[0], body_off[1], 1.0),
        (band(a, 0, hip), body_off[0], body_off[1], 1.0),
    ], size, pad)


# Weight, as a pelvis drop rather than a bob of the whole sprite.
#
# The drawn frames carry none: they measure 310-313px in the source, a 1%
# spread, because the generator was asked for six figures of equal height so
# they would pack cleanly. Equal height means the body never rises or falls,
# and a walk without that reads as a sprite sliding sideways through poses.
#
# So the torso is dropped INTO the legs at the beats where a real body sinks --
# lowest at contact where the weight lands, level as a leg passes under it and
# carries the body over its own straight support. Only the part above the hip
# moves; the feet stay where they were planted, which is what makes it read as
# the legs absorbing the weight rather than the whole figure bouncing.
#
# Two pixels at 68px authored is about two screen pixels in town. Any more looks
# like a limp at this size.
WALK_BOB = [2, 1, 0, 2, 1, 0]


def authored_walk(hero, pad, size):
    """Six drawn walk frames, if they exist, in place of the composed ones.

    The composed profile walk slides each leg as a rigid block -- no knee, no arm
    swing. That is a shuffle, and no amount of tuning makes a rigid block walk.
    Where real frames have been drawn for a hero they are used instead, dropped
    onto the same canvas and origin as everything else so the rest of the sheet
    does not care where they came from.
    """
    path = f'{SRC}/{hero}_walkside.png'
    if not os.path.isfile(path):
        return None
    im = Image.open(path).convert('RGBA')
    cw = im.size[0] // 6
    H, W = size
    out = []
    for i in range(6):
        cell = np.array(im.crop((i * cw, 0, (i + 1) * cw, im.size[1])))
        f = np.zeros((H, W, 4), np.uint8)
        ys, xs = np.where(cell[:, :, 3] > 0)
        # bottom-align on the canvas ground line, centre horizontally
        oy = (pad + 68 - 1) - ys.max()
        ox = (W - cw) // 2
        ny, nx = ys + oy, xs + ox
        ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
        f[ny[ok], nx[ok]] = cell[ys[ok], xs[ok]]
        drop = WALK_BOB[i]
        if drop:
            # Legs stay put; everything above the hip sinks into them. Drawn
            # last, so the hip join is covered by construction, exactly as the
            # composed frames handle it.
            hip = int(pad + 68 * HIP)
            upper = f[:hip].copy()
            f[:hip] = 0
            moved = np.zeros_like(f)
            moved[drop:hip + drop] = upper
            f = np.where(moved[:, :, 3:4] > 0, moved, f)
        # Drawn frames get the same pinhole repair as composed ones -- a
        # generated figure can enclose a few transparent pixels between an arm
        # and the body just as readily as a cut-up one can.
        out.append(fill_notches(f))
    return out


def side_frames(a, hip, hem, pad, size):
    """Profile: stamp the one drawn leg twice, fore and aft."""
    S = STRIDE

    # One leg through six beats: heel contact ahead, weight over it, passing
    # under the body, pushing off behind, toe lifting, swinging through raised.
    cyc = [(+S, 0), (+S // 2 + 1, 0), (0, 0), (-S, 0), (-S // 2 - 1, 2), (0, 2)]
    bob = [0, 0, -1, 0, 0, -1]      # lowest at contact, highest as a leg passes

    def f(p):
        nx, nl = cyc[p]
        fx, fl = cyc[(p + 3) % 6]           # far leg, half a cycle behind
        return side_stance(a, hip, hem, pad, size,
                           near=(nx, nl), far=(fx, fl), body_off=(0, bob[p]))

    idle = side_stance(a, hip, hem, pad, size)
    return [idle] + [f(p) for p in range(6)]


# --------------------------------------------------------------- actions
#
# Combat never passes a direction, so every fight renders the PROFILE. That is
# the only view these need.
#
# The body cannot be cut up for them. An arm sliced out of a flat profile takes
# the torso behind it with it, which is the same structural limit that rules out
# rotating a limb. So the attitude of the whole figure carries the action, and
# the two primitives below are both whole-frame, seamless by construction:
#
#   lean    a horizontal SHEAR. Row by row, an integer offset -- so the pixel
#           grid survives intact. A true rotation would resample every pixel and
#           turn crisp pixel art to mush at this size; a shear cannot, because no
#           pixel ever lands between two others.
#   crouch  a vertical squash about the feet, for weight dropping and for the
#           knees going out of a body on its way down.
#
# Everything else is a translation, or the leg stance already used for walking.
# One vocabulary, parameterised -- a heavy swing is the light one with a deeper
# coil, not a second animation drawn from scratch.


def lean(f, k, base):
    """Shear about the ground line. +k tips the figure the way it faces."""
    if not k:
        return f
    out = np.zeros_like(f)
    H, W = f.shape[:2]
    for y in range(H):
        dx = int(round(k * (base - y))) * SOURCE_FACES
        if dx == 0:
            out[y] = f[y]
        elif dx > 0 and dx < W:
            out[y, dx:] = f[y, :W - dx]
        elif dx < 0 and -dx < W:
            out[y, :W + dx] = f[y, -dx:]
    return out


def crouch(f, s, base):
    """Squash toward the ground line: s<1 compresses, feet stay put."""
    if s == 1.0:
        return f
    out = np.zeros_like(f)
    H = f.shape[0]
    for y in range(H):
        src = int(round(base - (base - y) / s))
        if 0 <= src < H:
            out[y] = f[src]
    return out


def _shear_x(f, k, cy):
    out = np.zeros_like(f)
    H, W = f.shape[:2]
    for y in range(H):
        dx = int(round(k * (y - cy)))
        if dx == 0:
            out[y] = f[y]
        elif 0 < dx < W:
            out[y, dx:] = f[y, :W - dx]
        elif -W < dx < 0:
            out[y, :W + dx] = f[y, -dx:]
    return out


def _shear_y(f, k, cx):
    out = np.zeros_like(f)
    H, W = f.shape[:2]
    for x in range(W):
        dy = int(round(k * (x - cx)))
        if dy == 0:
            out[:, x] = f[:, x]
        elif 0 < dy < H:
            out[dy:, x] = f[:H - dy, x]
        elif -H < dy < 0:
            out[:H + dy, x] = f[-dy:, x]
    return out


def rotate(f, deg, cx, cy):
    """Rotate about a pivot as THREE SHEARS, the Paeth decomposition.

    Death is the one action that needs a real rotation: a body tipping to the
    ground passes through every angle from upright to flat, and the shear that
    serves a lean cannot do it -- pushed that far it stops reading as a figure
    falling over and starts reading as one melting sideways, which is exactly
    what the first attempt looked like.

    A straight rotation is not an option either, because it resamples: every
    pixel lands between two others and crisp art turns to mush at 68px. Three
    successive shears compose to the same rotation while each one only ever
    moves whole rows or whole columns by whole pixels, so nothing is ever
    interpolated. At 90 degrees it is exact -- tan(45) is 1 and sin(90) is 1, so
    the shears are unit shifts.
    """
    if not deg:
        return f
    t = math.radians(deg)
    a, b = -math.tan(t / 2), math.sin(t)
    return _shear_x(_shear_y(_shear_x(f, a, cy), b, cx), a, cy)


def shift(f, dx, dy):
    if not dx and not dy:
        return f
    out = np.zeros_like(f)
    H, W = f.shape[:2]
    ys, xs = np.where(f[:, :, 3] > 0)
    ny, nx = ys + dy, xs + dx
    ok = (ny >= 0) & (ny < H) & (nx >= 0) & (nx < W)
    out[ny[ok], nx[ok]] = f[ys[ok], xs[ok]]
    return out


# stance = (near leg dx, far leg dx), then lean, shift and squash of the whole
# figure. Durations are matched to what combat.js actually waits for: attack
# 0.28s, heavy 0.5s, cast 0.4s, hurt 0.28s; death holds on its last frame.
ACTIONS = {
    'attack': dict(fps=18, frames=[
        # coil back onto the rear foot, then drive the whole body through it
        ((-1, +1), -0.10, (-1, 0), 1.00),
        ((-2, +1), -0.16, (-2, 0), 1.00),
        ((+3, -2), +0.16, (+3, 0), 1.00),
        ((+3, -2), +0.12, (+2, 0), 1.00),
        ((+1, -1), +0.04, (+1, 0), 1.00),
    ]),
    'heavy': dict(fps=12, frames=[
        ((-1, +1), -0.06, (-1, 0), 1.00),
        ((-2, +2), -0.20, (-3, 0), 0.97),
        ((-3, +2), -0.26, (-3, 0), 0.95),
        ((+4, -3), +0.22, (+4, 0), 1.00),
        ((+4, -3), +0.18, (+3, +1), 0.96),   # the weight lands
        ((+2, -1), +0.06, (+1, 0), 1.00),
    ]),
    'cast': dict(fps=12, frames=[
        ((0, 0), -0.04, (0, 0), 1.00),
        ((-1, +1), -0.09, (-1, -1), 1.00),   # gather, rising onto the toes
        ((-1, +1), -0.11, (-1, -2), 1.00),
        ((+2, -1), +0.12, (+2, 0), 1.00),    # release
        ((+1, 0), +0.03, (+1, 0), 1.00),
    ]),
    'hurt': dict(fps=14, frames=[
        ((-2, +1), -0.24, (-3, 0), 1.00),    # snapped off the feet
        ((-2, +1), -0.17, (-3, 0), 1.00),
        ((-1, 0), -0.08, (-2, 0), 0.97),
        ((0, 0), -0.02, (-1, 0), 1.00),
    ]),
    # Death is the exception: it carries a rotation, because a body goes all the
    # way to the ground and a lean cannot. The pivot is the feet, so he tips like
    # a felled tree rather than sliding over. Backwards, away from whatever hit
    # him. The last frame holds.
    'down': dict(fps=9, rot=[0, -12, -38, -66, -88], frames=[
        ((-1, +1), -0.06, (0, +1), 0.95),    # the knees go
        ((0, +1), 0.00, (0, +1), 0.88),
        ((+1, 0), 0.00, (0, +1), 1.00),
        ((+1, 0), 0.00, (0, +1), 1.00),
        ((+1, 0), 0.00, (0, +1), 1.00),
    ]),
}


def action_frames(a, hip, hem, pad, size, spec):
    base = pad + a.shape[0] - 1
    rots = spec.get('rot') or [0] * len(spec['frames'])
    out = []
    for ((near_dx, far_dx), k, (dx, dy), sq), deg in zip(spec['frames'], rots):
        f = side_stance(a, hip, hem, pad, size,
                        near=(near_dx, 0), far=(far_dx, 0))
        f = lean(f, k, base)
        f = crouch(f, sq, base)
        if deg:
            ys, xs = np.where(f[:, :, 3] > 0)
            f = rotate(f, deg * SOURCE_FACES, float(xs.mean()), float(base))
        out.append(fill_notches(shift(f, dx * SOURCE_FACES, dy)))
    return out


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
    art = {}
    for d, path in src.items():
        a = np.array(Image.open(path).convert('RGBA'))
        # Every view is packed facing the SAME way, so one mirror rule serves all
        # three and the game can turn a hero left or right without a second sheet.
        #
        # The profile and the front view already agree: measured on the face
        # pixels rather than the silhouette, the front view's face sits 1.4 to
        # 2.9px right of the head's centre on every hero, turned the same way the
        # profile faces. (The silhouette says the opposite -- hair mass drags the
        # head's centroid the other way -- which is why this is measured on skin.)
        #
        # The back view is the odd one out, and necessarily so. It is the same
        # body turn seen from behind, so the cheek that peeks out lands on the
        # far side: 1.7 to 4.4px LEFT of centre. Drawn as-is it would read as
        # walking away up-and-left while the front read down-and-right. So it is
        # mirrored once, here, rather than special-cased at draw time.
        if d == 'up':
            a = a[:, ::-1].copy()
        art[d] = a
    hip = int(next(iter(art.values())).shape[0] * HIP)
    hem = max(hem_row(a, hip) for a in art.values())        # one hem per hero
    # Room to move. A shear throws the head much further than a stride moves a
    # foot, and a body toppling to horizontal needs its whole HEIGHT in
    # horizontal room -- pivoting at the feet, the head ends up a figure's length
    # to one side. Undersize this and the rotation silently clips: the first
    # attempt lost the top half of every fallen hero, and the only symptom was a
    # cell that came out suspiciously narrow.
    fig = next(iter(art.values())).shape[0]
    pad = max(STRIDE + 3,
              int(max(abs(k) for spec in ACTIONS.values()
                      for _, k, _, _ in spec['frames']) * fig) + 4,
              fig + 6 if any('rot' in spec for spec in ACTIONS.values()) else 0)

    # Rows: the three walking views, then one per combat action. Actions are
    # profile-only because combat never passes a direction.
    # NB the row keys are prefixed. 'down' is BOTH a view (walking toward the
    # camera) and a combat state (the death collapse); unprefixed they collide,
    # and the death row silently inherits the walk row's origin.
    rows = []
    for d in ['side', 'up', 'down']:
        a = art[d]
        size = (a.shape[0] + pad * 2, a.shape[1] + pad * 2)
        fr = (side_frames if d == 'side' else frontal_frames)(a, hip, hem, pad, size)
        if d == 'side':
            drawn = authored_walk(hero, pad, size)
            if drawn:
                fr = [fr[0]] + drawn        # keep the artist's idle, swap the walk
        rows.append(('view:' + d, fr))
    a = art['side']
    size = (a.shape[0] + pad * 2, a.shape[1] + pad * 2)
    for name, spec in ACTIONS.items():
        rows.append(('act:' + name, action_frames(a, hip, hem, pad, size, spec)))

    # Register every row to ONE origin: the foot centre and ground row of its own
    # FIRST frame. Every frame of a row gets that row's offset, so the bob, the
    # lift and the lunge all survive -- re-centring each frame on its own content
    # would silently cancel the very motion it is meant to carry.
    #
    # The cell is then sized to the real content of every frame, not to the
    # padded canvas, so a deep lean fits and a light one wastes nothing.
    anch = {name: baseline(fr[0]) for name, fr in rows}
    left = right = top = bot = 0
    for name, frames in rows:
        ax, ay = anch[name]
        for f in frames:
            ys, xs = np.where(f[:, :, 3] > 0)
            if not len(ys):
                continue
            left = max(left, ax - xs.min())
            right = max(right, xs.max() + 1 - ax)
            top = max(top, ay - ys.min())
            bot = max(bot, ys.max() + 1 - ay)
    cw, ch = int(np.ceil(left + right)), int(np.ceil(top + bot))

    sheet = Image.new('RGBA', (cw * COLS, ch * len(rows)), (0, 0, 0, 0))
    index = {}
    for r, (name, frames) in enumerate(rows):
        ax, ay = anch[name]
        ox, oy = int(round(left - ax)), int(round(top - ay))
        for c, fr in enumerate(frames):
            sheet.alpha_composite(Image.fromarray(fr), (c * cw + ox, r * ch + oy))
        # Pad the row out with its own first frame so no cell is ever blank.
        for c in range(len(frames), COLS):
            sheet.alpha_composite(Image.fromarray(frames[0]), (c * cw + ox, r * ch + oy))
        kind, _, plain = name.partition(':')
        index[name] = {'first': r * COLS, 'count': len(frames),
                       'fps': ACTIONS[plain]['fps'] if kind == 'act' else None}
    sheet.save(f'{ROOT}/assets/actors/hi/{hero}.png')
    return {'cellW': cw, 'cellH': ch, 'columns': COLS, 'rows': len(rows),
            'anchorX': int(round(left)), 'anchorY': int(round(top)) + 1,
            'hem': hem, 'index': index}


if __name__ == '__main__':
    meta = {}
    for hero in HEROES:
        m = build(hero)
        meta[hero] = m
        print(f"  {hero:10s} cell {m['cellW']}x{m['cellH']}  "
              f"{m['rows']} rows  anchor ({m['anchorX']},{m['anchorY']})  hem y={m['hem']}")
    json.dump(meta, open(f'{ROOT}/assets/actors/hi/_cells.json', 'w'), indent=2)
