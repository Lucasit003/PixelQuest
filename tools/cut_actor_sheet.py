"""Cut the generated goblin sheet into a game-ready actor sheet.

Chroma-key -> per-frame extract -> shared baseline anchor -> BOX downscale ->
quantize onto the game's own goblin ramp -> pack a 6-column sheet.

The anchor is the load-bearing part. ART_RULES: one anchor per grounded cycle,
never one per frame, or the sprite twitches at whole-pixel rounding. The anchor
here is the MEDIAN foot point across the idle+walk frames (the reliably grounded
ones) and every frame is placed against it, so the goblin stays locked to one
ground point even across state changes.
"""
from PIL import Image
import numpy as np, os

SP = os.path.dirname(os.path.abspath(__file__))
CELL, COLS = 32, 6
FOOT_PAD = 2      # rows of empty cell below the feet; see note by TARGET_H
ANIMS = [('idle', 0, 4), ('walk', 1, 6), ('attack', 2, 4), ('hurt', 3, 2), ('down', 4, 4)]

# The game's own goblin ramp (PALETTES.goblin in gfx/actors.js) plus its metal.
RAMP = ['#16240f', '#3d6127', '#46702e', '#5b8c3a', '#7cb356',
        '#f2e14a', '#8a5a2b', '#6b4423', '#5c3a1a', '#cdd6dd']
PAL = np.array([[int(h[i:i+2], 16) for i in (1, 3, 5)] for h in RAMP], dtype=float)

src = Image.open(os.path.join(SP, 'goblin_raw.jpeg')).convert('RGB')
a = np.asarray(src).astype(np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
bg = (r > 150) & (b > 150) & (g < (r + b) // 2 - 60)
H, W = bg.shape
CW, CHt = W / 6, H / 5

def cell(row, col):
    x0, x1 = int(round(col * CW)) + 5, int(round((col + 1) * CW)) - 5
    y0, y1 = int(round(row * CHt)) + 5, int(round((row + 1) * CHt)) - 5
    return a[y0:y1, x0:x1], ~bg[y0:y1, x0:x1]

# --- pass 1: measure, so every frame shares one scale and one anchor ---------
raw = {}
for name, row, n in ANIMS:
    for i in range(n):
        rgb, mask = cell(row, i)
        if mask.mean() < 0.02:
            continue
        ys, xs = np.where(mask)
        raw[(name, i)] = dict(rgb=rgb, mask=mask,
                              x0=xs.min(), x1=xs.max(), y0=ys.min(), y1=ys.max())

# Scale and footing are both MEASURED off the procedural goblin rather than
# derived from SPECS.goblin.h — that field is a rig parameter, not a pixel
# height, and trusting it produced a sprite 50% too tall. At ACTOR_SCALE 1.4 the
# procedural goblin renders a 20px body whose feet sit 3px above its y
# coordinate; FOOT_PAD reproduces that 3px so the new art stands on exactly the
# same ground line as everything else in the scene.
TARGET_H = 20
idle_h = np.median([v['y1'] - v['y0'] + 1 for k, v in raw.items() if k[0] == 'idle'])
SCALE = float(TARGET_H) / idle_h

def foot(v):
    """Bottom-most row, and the horizontal centre of the pixels standing on it."""
    m = v['mask']
    band = m[max(0, v['y1'] - 5): v['y1'] + 1]
    xs = np.where(band.any(0))[0]
    return (xs.min() + xs.max()) / 2.0, v['y1']

grounded = [foot(v) for k, v in raw.items() if k[0] in ('idle', 'walk')]
ax = np.median([f[0] for f in grounded])
ay = np.median([f[1] for f in grounded])

# --- pass 2: cut, scale, quantize, place ------------------------------------
def quantize(rgb, mask):
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    px = rgb[mask].astype(float)
    if len(px):
        # luma-weighted distance: keeps the dark outline from collapsing into mid green
        w = np.array([0.9, 1.2, 0.7])
        d = (((px[:, None, :] - PAL[None, :, :]) * w) ** 2).sum(2)
        out[mask] = np.concatenate([PAL[d.argmin(1)], np.full((len(px), 1), 255)], 1)
    return out

sheet = Image.new('RGBA', (CELL * COLS, CELL * len(ANIMS)), (0, 0, 0, 0))
placed = {}
for ai, (name, row, n) in enumerate(ANIMS):
    for i in range(n):
        v = raw.get((name, i))
        if v is None:
            continue
        q = quantize(v['rgb'], v['mask'])
        big = Image.fromarray(q)
        nw, nh = max(1, round(big.width * SCALE)), max(1, round(big.height * SCALE))
        small = big.resize((nw, nh), Image.BOX)          # BOX: no overshoot, no halo
        arr = np.asarray(small).copy()
        arr[..., 3] = np.where(arr[..., 3] < 90, 0, 255)  # hard alpha, pixel-art edges
        small = Image.fromarray(arr)
        # place so the shared anchor lands on the cell's bottom-centre
        px = round(CELL * i + CELL / 2 - ax * SCALE)
        py = round(CELL * ai + CELL - FOOT_PAD - (ay + 1) * SCALE)
        sheet.alpha_composite(small, (px, py))
        placed[(name, i)] = True

sheet.save(os.path.join(SP, 'goblin_sheet.png'))
print(f'  source idle height {idle_h:.0f}px -> {TARGET_H}px   (scale {SCALE:.3f})')
print(f'  shared anchor: x={ax:.1f} y={ay:.1f} (source px)')
print(f'  placed {len(placed)} frames into {CELL*COLS}x{CELL*len(ANIMS)} sheet')
for name, row, n in ANIMS:
    got = sum(1 for i in range(n) if (name, i) in placed)
    print(f'    {name:7s} {got}/{n}')
