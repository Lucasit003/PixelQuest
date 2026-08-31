#!/usr/bin/env python3
"""Generate actor animation frames from an APPROVED master pose, via Gemini.

Identity lock is the whole point: every frame is generated with the approved
master image attached as a reference, so the model is editing a known character
rather than inventing one. That is cheaper than generating a base frame first
and far more consistent than prompting from text alone.

    approved master pose  ->  gen_actor_frames.py  ->  raw frames/
                          ->  build_actor_sheet.py ->  packed sheet + config

Reads GEMINI_API_KEY from the environment. Never write the key into a file in
this repo.

    python3 tools/gen_actor_frames.py --check
    python3 tools/gen_actor_frames.py --pose walk_contact --out /tmp/f.png
"""

import argparse
import base64
import json
import os
import sys
import urllib.request

API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
DEFAULT_MODEL = 'gemini-2.5-flash-image'

MASTER = 'assets/warrior weaw.png'
# Front-facing idle with empty hands — the cleanest identity reference we have.
MASTER_POSE = (70, 56, 200, 304)

# Held constant across every call so the character cannot drift.
IDENTITY = (
    "This is a reference sheet character. Reproduce THIS EXACT character with no "
    "design changes: same brown wavy hair, same face, same steel plate armour with "
    "dark segments, same blue cloth tabard hanging at the front, same blue shoulder "
    "trim, same boots, same chibi body proportions, same colour palette, same "
    "outline weight. Do not restyle, do not add or remove equipment, do not change "
    "the armour. Side-on three-quarter view, FACING RIGHT. Full body, feet visible "
    "and flat at the bottom of the frame. Plain solid white background. "
    "Pixel art, crisp hard edges, no blur, no anti-aliasing, no drop shadow, "
    "no text, no watermark, single character only, centred."
)

POSES = {
    'idle':          "standing still in a neutral relaxed idle stance, arms at sides, weight even",
    'walk_contact':  "mid-walk, left leg forward and right leg back at full stride, arms swinging opposite",
    'walk_passing':  "mid-walk passing position, legs together, one foot lifting, body slightly raised",
    'jump_crouch':   "crouched low, knees bent deeply, about to leap upward",
    'jump_rise':     "airborne rising, legs tucked, arms up",
    'hurt':          "recoiling backward from a hit, head back, arms flung out",
    'down':          "collapsed defeated on the ground, lying down",
}


def load_reference():
    from PIL import Image
    import io
    im = Image.open(MASTER).convert('RGBA').crop(MASTER_POSE)
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    buf = io.BytesIO()
    bg.convert('RGB').save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def call(model, key, prompt, ref_b64):
    body = {
        'contents': [{
            'parts': [
                {'text': prompt},
                {'inline_data': {'mime_type': 'image/png', 'data': ref_b64}},
            ]
        }]
    }
    req = urllib.request.Request(
        API.format(model=model, key=key),
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, f'HTTP {e.code}: {e.read().decode()[:400]}'


def extract_image(resp):
    for cand in resp.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            blob = part.get('inline_data') or part.get('inlineData')
            if blob and blob.get('data'):
                return base64.b64decode(blob['data'])
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pose', default='walk_contact', choices=sorted(POSES))
    ap.add_argument('--out', default='/tmp/frame.png')
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--check', action='store_true', help='one cheap call to prove access')
    args = ap.parse_args()

    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        sys.exit('GEMINI_API_KEY is not set in the environment')

    ref = load_reference()
    pose = POSES[args.pose]
    prompt = f'{IDENTITY}\n\nPose: {pose}.'

    print(f'model={args.model}  pose={args.pose}')
    resp, err = call(args.model, key, prompt, ref)
    if err:
        print('FAILED:', err)
        sys.exit(1)

    img = extract_image(resp)
    if not img:
        print('no image in response:', json.dumps(resp)[:500])
        sys.exit(1)

    with open(args.out, 'wb') as f:
        f.write(img)
    usage = resp.get('usageMetadata', {})
    print(f'wrote {args.out}  ({len(img)} bytes)')
    print('usage:', {k: v for k, v in usage.items() if 'oken' in k})


if __name__ == '__main__':
    main()
