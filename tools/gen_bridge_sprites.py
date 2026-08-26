#!/usr/bin/env python3
"""Generate the two stream-bridge sprites with Gemini, in the game's own style.

Follows tools/gen_city_sheet.py's conventions: GEMINI_API_KEY from the env or
a gitignored .env at the repo root, model gemini-2.5-flash-image, and a
REFERENCE IMAGE so the model extends the game's existing look instead of
inventing one. The reference here is an actual in-game capture of the main
stone bridge (and the dock, for the wooden variant) — the exact masonry,
palette and camera the little bridges must match.

Pipeline per sprite:
  1. generate on a flat #FF00FF ground, horizontal span (models can't do the
     roads' diagonal; we shear afterwards, losslessly)
  2. chroma-key the magenta + defringe (the recurring matting defect —
     ART_RULES.md)
  3. bake to the exact draw size (premultiplied float resize, the
     bake_props.py rule)
  4. SHEAR: shift whole pixel columns down by round(slope * x) — no
     resampling, so the pixels stay crisp and the deck rides the road's own
     diagonal (spur +0.357, link +0.44)
  5. write assets/props/bridge_spur.png / bridge_link.png

Then wire SPUR_ART/LINK_ART in src/scenes/town/bridge.js (loadBuildingArt)
— left unwired until the art exists so tests/assets.test.js stays green.

Usage:
  python3 tools/gen_bridge_sprites.py            # both sprites
  python3 tools/gen_bridge_sprites.py --check    # auth check only
  python3 tools/gen_bridge_sprites.py --only spur|link
"""
import argparse
import base64
import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
MODEL = 'gemini-2.5-flash-image'
CAPS = ('/private/tmp/claude-501/-Users-lucassetji-Downloads/'
        '1409c981-985d-4307-99b7-28329e32ce9d/scratchpad/captures')

# target draw geometry — MUST match SPUR_BRIDGE/LINK_BRIDGE in town/bridge.js
SPRITES = {
    'spur': {
        'ref': ['bridge_day.png'],
        'w': 78, 'h': 56, 'slope': 0.357, 'out': 'assets/props/bridge_spur.png',
        'prompt': (
            'Look at the attached game screenshot: an elevated three-quarter '
            'top-down pixel-art RPG. Note the big stone bridge: its grey '
            'coursed masonry, low parapet walls, chunky corner posts, deep '
            'desaturated outlines, muted colours, and the camera angle '
            '(ground plane visible, south faces of tall things visible).\n\n'
            'Generate ONE new sprite in EXACTLY that art style: a SMALL squat '
            'stone road-bridge, seen from the same camera, spanning '
            'horizontally (left to right). Low coursed-stone parapet walls '
            'along its top edge and bottom edge, small square end posts at '
            'all four corners, and below the bottom parapet a short dark '
            'south-facing stone face with ONE small arched culvert opening. '
            'Same grey masonry as the reference bridge, a little moss. '
            'Proportions: about 3 times wider than tall, deck open in the '
            'middle (it is walked on). Flat solid #FF00FF magenta background, '
            'nothing else in the image: no water, no grass, no shadows '
            'outside the bridge, no characters, no text.'
        ),
    },
    'link': {
        'ref': ['riverfront.png', 'bridge_day.png'],
        'w': 62, 'h': 42, 'slope': 0.44, 'out': 'assets/props/bridge_link.png',
        'prompt': (
            'Look at the attached game screenshots: an elevated three-quarter '
            'top-down pixel-art RPG. Note the wooden plank dock in the first '
            'image (board colours, seams, posts) and the stone bridge in the '
            'second (camera angle, outline treatment).\n\n'
            'Generate ONE new sprite in EXACTLY that art style: a SMALL '
            'weathered wooden plank FOOTBRIDGE, same camera, spanning '
            'horizontally (left to right). Deck of worn grey-brown planks '
            'with visible board seams, one low wooden rail beam along the '
            'top edge and one along the bottom edge, small round timber '
            'posts at the four corners, and below the bottom rail a short '
            'dark underside face showing two or three support legs. '
            'Proportions: about 3 times wider than tall, deck open in the '
            'middle (it is walked on). Flat solid #FF00FF magenta '
            'background, nothing else: no water, no grass, no characters, '
            'no text.'
        ),
    },
}


def load_key():
    key = os.environ.get('GEMINI_API_KEY')
    if key:
        return key.strip()
    dotenv = os.path.join(ROOT, '.env')
    if os.path.exists(dotenv):
        for line in open(dotenv):
            line = line.strip()
            if line.startswith('GEMINI_API_KEY'):
                return line.split('=', 1)[1].strip().strip('"').strip("'")
    return None


def ref_b64(names):
    """In-game captures, upscaled 2x nearest so the model sees the pixels."""
    from PIL import Image
    parts = []
    for n in names:
        p = os.path.join(CAPS, n)
        im = Image.open(p).convert('RGB')
        im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
        buf = io.BytesIO()
        im.save(buf, 'PNG')
        parts.append(base64.b64encode(buf.getvalue()).decode())
    return parts


def call(key, prompt, refs):
    parts = [{'inline_data': {'mime_type': 'image/png', 'data': r}} for r in refs]
    parts.append({'text': prompt})
    body = json.dumps({
        'contents': [{'parts': parts}],
        'generationConfig': {'responseModalities': ['IMAGE']},
    }).encode()
    req = urllib.request.Request(
        API.format(model=MODEL, key=key), data=body,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.load(r)
    for cand in resp.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            blob = part.get('inlineData') or part.get('inline_data')
            if blob:
                return base64.b64decode(blob['data'])
    raise RuntimeError('no image in response: ' + json.dumps(resp)[:400])


def key_magenta(im):
    """Chroma-key the flat magenta ground + kill the defringe halo."""
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # magenta and its blurry rim: red+blue high, green well below both
            if r > 130 and b > 130 and g < min(r, b) - 45:
                px[x, y] = (0, 0, 0, 0)
    # defringe: strip pale pink halo pixels that touch transparency
    for _ in range(2):
        drop = []
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                edge = any(
                    0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3] == 0
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                if edge and r > 150 and b > 120 and g < r - 30:
                    drop.append((x, y))
        for x, y in drop:
            px[x, y] = (0, 0, 0, 0)
    return im


def crop_content(im):
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def bake(im, w, h):
    """Premultiplied float resize to the exact draw size (bake_props rule)."""
    from PIL import Image
    factor = max(im.width / w, im.height / h)
    resample = Image.LANCZOS if factor <= 3 else Image.BOX
    import numpy as np
    a = np.asarray(im.convert('RGBA'), dtype=np.float64)
    alpha = a[..., 3:4] / 255.0
    pre = a.copy()
    pre[..., :3] *= alpha
    pim = Image.fromarray(pre.astype('uint8'), 'RGBA').resize((w, h), resample)
    out = np.asarray(pim, dtype=np.float64)
    al = out[..., 3:4]
    with np.errstate(divide='ignore', invalid='ignore'):
        un = out[..., :3] * 255.0 / np.maximum(al, 1e-6)
    out2 = np.concatenate([np.clip(un, 0, 255), al], axis=-1).astype('uint8')
    res = Image.fromarray(out2, 'RGBA')
    # crispen: pixels either opaque or gone — the game never alpha-blends props
    px = res.load()
    for y in range(h):
        for x in range(w):
            r, g, b, al2 = px[x, y]
            px[x, y] = (r, g, b, 255) if al2 >= 128 else (0, 0, 0, 0)
    return res


def shear(im, slope):
    """Shift whole columns down by round(slope*x): lossless diagonal."""
    from PIL import Image
    drop = int(round(slope * (im.width - 1)))
    out = Image.new('RGBA', (im.width, im.height + drop), (0, 0, 0, 0))
    for x in range(im.width):
        col = im.crop((x, 0, x + 1, im.height))
        out.paste(col, (x, int(round(slope * x))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--only', choices=['spur', 'link'])
    args = ap.parse_args()
    key = load_key()
    if not key:
        sys.exit('GEMINI_API_KEY not set (env, or GEMINI_API_KEY=... in the '
                 'gitignored .env at the repo root)')
    if args.check:
        print('key found (%d chars) — ready to generate' % len(key))
        return
    for name, S in SPRITES.items():
        if args.only and name != args.only:
            continue
        print('generating', name, '...')
        raw = call(key, S['prompt'], ref_b64(S['ref']))
        keep = os.path.join(CAPS, 'gen_%s_raw.png' % name)
        open(keep, 'wb').write(raw)
        from PIL import Image
        im = Image.open(io.BytesIO(raw))
        im = crop_content(key_magenta(im))
        im = bake(im, S['w'], S['h'])
        im = shear(im, S['slope'])
        out = os.path.join(ROOT, S['out'])
        im.save(out)
        print('  raw kept at', keep)
        print('  wrote', out, im.size)


if __name__ == '__main__':
    main()
