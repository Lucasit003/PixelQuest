"""Pack a hero's separate action sheets into ONE grid the engine can register.

Actions are AUTHORED one sheet per action because their natural cell widths
genuinely differ -- a lunge reaches further than a stand, and forcing them into
a shared cell at authoring time would either clip the lunge or pad everything
else with dead space.

The engine, though, takes one sheet per actor. So packing is a build step: find
the widest cell across the actions, lay every frame into that common cell
bottom-aligned and horizontally centred on its own content, and emit the frame
index each animation starts at.

Bottom-aligned matters. Every cell's feet must sit on the same row or the actor
bobs vertically when the animation changes, which reads as a bug in the movement
code rather than in the art.

    python3 tools/pack_hero_sheet.py rogue
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PACKS = {
    # The Paladin's idle and walk come out of his original 16-frame sheet; his
    # ATTACK is the approved Heavy Side Crush, not the superseded forward punch
    # that sheet also holds.
    'paladin': {
        'out': 'assets/actors/paladin.png',
        'columns': 4,
        'actions': [
            ('idlewalk', 'assets/actors/paladin_idlewalk.png', 8),
            ('attack',   'assets/actors/paladin_crush.png',    4),
            ('heavy',    'assets/actors/paladin_heavy.png',    4),
            ('brace',    'assets/actors/paladin_brace.png',    4),
            ('cast',     'assets/actors/paladin_cast.png',     4),
            ('slam',     'assets/actors/paladin_slam.png',     4),
        ],
    },
    'rogue': {
        'out': 'assets/actors/rogue.png',
        'columns': 4,
        'actions': [
            ('walk',   'assets/actors/rogue_walk.png',     4),
            ('attack', 'assets/actors/rogue_combo.png',    4),
            ('lunge',  'assets/actors/rogue_lunge.png',    4),
            ('roll',   'assets/actors/rogue_roll.png',     4),
            ('hurt',   'assets/actors/rogue_hurtdown.png', 4),
            ('cast',   'assets/actors/rogue_throw.png',    4),
        ],
    },
}


def cells(path, n):
    im = Image.open(path).convert('RGBA')
    w = im.size[0] // n
    return [im.crop((i * w, 0, (i + 1) * w, im.size[1])) for i in range(n)]


def content_box(im):
    a = np.array(im)[:, :, 3] > 100
    if not a.any():
        return None
    ys, xs = np.where(a)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def foot_centre(im):
    """Horizontal centre of the bottom band -- the feet, not the bbox.

    Centring on the bounding box makes the body slide sideways whenever an arm
    or a cloak extends past it, which reads as jitter across a cycle.
    """
    a = np.array(im)[:, :, 3] > 100
    ys = np.where(a.any(axis=1))[0]
    if not len(ys):
        return im.size[0] / 2
    bot = ys.max()
    top = max(ys.min(), bot - max(1, int(round((bot - ys.min()) * 0.18))))
    xs = np.where(a[top:bot + 1].any(axis=0))[0]
    return float(xs.mean()) if len(xs) else im.size[0] / 2


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'rogue'
    spec = PACKS[name]
    cols = spec['columns']

    frames, index = [], {}
    for action, path, n in spec['actions']:
        got = cells(os.path.join(ROOT, path), n)
        index[action] = {'start': len(frames), 'count': len(got)}
        frames.extend(got)

    cw = max(f.size[0] for f in frames)
    ch = max(f.size[1] for f in frames)
    rows = (len(frames) + cols - 1) // cols

    out = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        box = content_box(f)
        if box is None:
            continue
        x0, y0, x1, y1 = box
        sub = f.crop(box)
        fx = foot_centre(f) - x0
        ox = int(round(cw / 2 - fx))
        oy = ch - (y1 - y0)                      # bottom-aligned: feet on one row
        cx, cy = (i % cols) * cw, (i // cols) * ch
        out.alpha_composite(sub, (cx + max(0, ox), cy + oy))

    dst = os.path.join(ROOT, spec['out'])
    out.save(dst)
    print(f"{name}: {len(frames)} frames, cell {cw}x{ch}, sheet {out.size} -> {spec['out']}")
    for action, v in index.items():
        print(f"  {action:8s} frames {v['start']}-{v['start'] + v['count'] - 1}")

    idx_path = os.path.join(ROOT, f'assets/actors/{name}_frames.json')
    json.dump({'cellW': cw, 'cellH': ch, 'columns': cols, 'actions': index},
              open(idx_path, 'w'), indent=2)
    print(f"  index -> assets/actors/{name}_frames.json")


if __name__ == '__main__':
    main()
