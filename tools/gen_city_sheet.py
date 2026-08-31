#!/usr/bin/env python3
"""Generate the Ancient City art sheets with Gemini, locked to the existing palette.

The Eldertree glade used to be dressed entirely out of `assets/Tree Mystical.png`
— a sheet of columns, low walls and benches. It had no BUILDINGS in it, so the
quarter could only ever read as a walled garden. These sheets add the pieces a
city actually needs: storeyed ruins with roofs, gatehouses and towers, grand
statuary, real water, and the overgrowth reclaiming all of it.

Colour lock works the same way `gen_actor_frames.py` locks a character: the
original Mystical Tree sheet rides along as a reference image on EVERY call, so
the model is extending a known palette rather than inventing one. The prompt
names the hexes as well, because a reference alone still drifts warm/cool.

    export GEMINI_API_KEY=...            (or put it in a gitignored .env)
    python3 tools/gen_city_sheet.py --check
    python3 tools/gen_city_sheet.py --sheet buildings
    python3 tools/gen_city_sheet.py --all --variants 2

Sheets land in assets/_src/city/ (gitignored), and tools/citycut.py slices them.
"""

import argparse
import base64
import io
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}'
DEFAULT_MODEL = 'gemini-2.5-flash-image'
# 1290 output tokens per image at $30/1M — the number is printed after each call
# so a long iteration session never becomes a surprise.
COST_PER_IMAGE = 0.039

STYLE_REF = os.path.join(ROOT, 'assets/Tree Mystical.png')
OUT_DIR = os.path.join(ROOT, 'assets/_src/city')

# ---- the style contract ---------------------------------------------------
# Held constant across every sheet. Everything here was measured off the
# reference sheet or taken from docs/ART_RULES.md; none of it is generic
# pixel-art advice, and changing one line changes every sheet's read.
STYLE = """\
The attached image is the STYLE REFERENCE for an existing game. Produce a new
asset sheet that looks like it was drawn by the same artist, in the same
session, for the same game. Match it exactly on all of:

PALETTE — warm sandstone limestone in a light-to-dark ramp (#e8c898 highlight,
#d8b888 body, #a08058 mid, #806848 shade, #605038 deep), mossy green growing
over the stone (#185030, #104030), rich foliage green (#2c6a32, #3d8a40 lit,
#1e4824 shadow), bright cyan crystal (#1890d8, #aef4ff glint) with occasional
violet crystal (#c9a0ff), and clean blue water (#1890d8 body, lighter at the
rim). Near-black outlines. NO other hues — no grey concrete, no orange terra
cotta, no purple stone, no teal wash.

RENDERING — hand-painted pixel art at roughly the reference's density. Crisp
hard pixel edges, no anti-aliasing, no blur, no gradients, no glow, no bevel
filter, no cel-shaded vector look. Solid near-black outline around every object.
Flat readable shading in three or four tones per material, plus a single bright
highlight edge. Weathering is painted in: chips, cracks, missing blocks, moss in
the joints, water stains under sills.

PERSPECTIVE — elevated three-quarter top-down, exactly like the reference: you
see the ground the object stands on AND the front face of anything tall. Every
object sits flat on an implied ground plane, upright, seen from the same camera.
No isometric cubes, no straight side elevation, no true overhead plan view, no
vanishing-point perspective, no tilting between objects.

SHEET FORMAT — objects laid out separately on a plain flat off-white background
(#f7f3ec), well spaced with clear empty gaps between them so each one can be cut
out. Each object complete and unclipped, none touching or overlapping another,
none running off the edge. NO text, NO labels, NO numbers, NO grid lines, NO
panel borders, NO drop shadows cast onto the background, NO framing, NO
title card, NO colour swatches, NO watermark.
"""

# ---- the sheets -----------------------------------------------------------
# Split by subject rather than by size: one call has to hold a consistent idea,
# and "a ruined city" is too many ideas for one image. Each sheet lists its
# pieces explicitly, because an open brief comes back as six variations on the
# same arch.
SHEETS = {
    'buildings': """\
Draw a sheet of RUINED ANCIENT CITY BUILDINGS — the standing remains of a stone
city, each one clearly a building with storeys and a roof, not a garden wall.

Draw these 12 separate buildings, laid out in 3 rows of 4:
1. A tall square watchtower, four storeys, its top floor collapsed to jagged
   stone teeth, narrow arched windows, ivy up one corner.
2. A temple front: a wide pediment on six fluted columns, two columns snapped
   off, broad steps running down the front.
3. A two-storey townhouse, tiled roof half fallen in showing the rafters,
   shuttered windows, a doorway with the lintel cracked.
4. A domed rotunda, the dome broken open at the crown, ring of columns around it.
5. A city gatehouse: a deep arched gateway between two stubby square towers,
   battlements along the top, one portcullis chain still hanging.
6. A long colonnaded hall, roof gone, a double row of columns standing in it.
7. A round granary or cistern house with a conical roof, part of the wall burst
   outward in a spill of blocks.
8. A stepped ziggurat-like terrace shrine, three tiers, a small crystal-lit
   doorway at the top.
9. A merchant house with an outside stone stair up the side to a first-floor
   door, awning frame still bolted to the wall, no cloth left.
10. A small chapel with a broken bell arch on the gable, one bell still hanging.
11. A ruined corner of a great hall: two walls meeting, tall pointed windows
    with the tracery half gone, floor visible inside.
12. A library or archive block, blind arcading along the front, its roof
    collapsed into the interior.

Scale: these are the biggest pieces in the game. Draw them large and detailed —
each building should fill a good part of its cell. Ivy, moss and small saplings
have taken hold on several of them. A few cyan crystals grow from the stonework
of two or three buildings. Keep every roof, window and doorway readable.
""",

    'monuments': """\
Draw a sheet of ANCIENT CITY MONUMENTS AND STATUARY — the civic sculpture of a
fallen city, weathered and part broken.

Draw these 14 separate pieces, well spaced:
1. A colossal seated king on a high square plinth, hands on knees, face worn
   smooth.
2. An equestrian statue: rider and rearing horse on a long plinth, one of the
   horse's forelegs broken away.
3. A winged guardian figure, wings half shattered, standing on a round base.
4. A robed scholar holding an open book, on a stepped pedestal.
5. A warrior with a great sword point-down in front of them, shield on the arm.
6. A toppled statue lying on its side beside its empty plinth, cracked across
   the waist.
7. A headless standing figure, the head lying at its feet.
8. A tall stone obelisk carved with worn glyphs, its tip broken off.
9. A triumphal arch, single span, statues in niches either side, cracked keystone.
10. A memorial stele: a flat carved slab standing upright, moss in the carving.
11. A pair of guardian lions on low blocks, facing forward, one missing a paw.
12. A votive column with a small figure on top, the column leaning noticeably.
13. A ring of five standing stones around a cyan crystal growing out of the
    ground, drawn as one piece.
14. An armillary sphere or star-dial of stone and metal on a carved base.

The stone matches the buildings exactly — same sandstone ramp, same near-black
outline. Moss in every crevice, streaks of dark weathering below the details,
one or two pieces with cyan crystal growing through a crack. These read at
roughly one and a half times a person's height, except the colossal king and the
arch, which are much larger.
""",

    'walls': """\
Draw a sheet of ANCIENT CITY WALLS, STREETS AND RUBBLE — the connective stone
that turns separate buildings into a city.

Draw these 16 separate pieces, well spaced:
1. A straight run of high city wall with battlements along the top, seen
   three-quarter from the front, running LEFT-TO-RIGHT across the cell.
2. The same wall with a collapsed section in the middle, blocks spilled at the
   foot of the gap.
3. The same wall smothered in ivy.
4. A wall run with a flight of stone steps going up its inside face.
5. A wall with a small arched postern door in it, door long gone.
6. A wall run seen END-ON so it runs AWAY FROM THE VIEWER, top to bottom of the
   cell — a north-south wall, foreshortened.
7. The same north-south wall run, broken in the middle.
8. A square corner tower where two walls meet.
9. A broad flight of civic steps, seven or eight treads, going up away from the
   viewer, with a low balustrade either side.
10. A stone ramp with a low kerb.
11. A cracked paved street section, flat on the ground, running left-to-right,
    weeds in the joints.
12. The same paving running away from the viewer, top to bottom.
13. A paved crossroads piece, flat on the ground.
14. A heap of collapsed masonry: cut blocks, a broken column drum, a fragment of
    carved cornice.
15. A scatter of smaller rubble and loose stones.
16. A low boundary wall about waist height, half fallen, moss on the top course.

Every piece is the same sandstone as the buildings. The tall wall pieces show
their front FACE and the ground at their foot. The flat paving pieces are seen
looking DOWN on them with no face at all — they lie on the ground. Keep those
two categories clearly different.
""",

    'water': """\
Draw a sheet of ANCIENT CITY WATERWORKS — the city's water, still running through
the ruins.

Draw these 12 separate pieces, well spaced:
1. A grand tiered fountain: three stacked basins on a wide round pool, water
   spilling from each tier to the one below.
2. A long rectangular reflecting pool with a carved stone kerb, lily pads and a
   few reeds at one end, seen three-quarter from above.
3. A stone canal section running LEFT-TO-RIGHT, water in it, kerbs both sides.
4. The same canal section running AWAY FROM THE VIEWER, top to bottom.
5. A short aqueduct span on two arches, a channel of water along the top.
6. A broken aqueduct span, the arch collapsed, water pouring from the cut end
   into a pool below.
7. A wall fountain: a carved lion or face mask set in a stone panel, spouting
   into a basin.
8. A round stone well with a wooden winch frame and bucket.
9. A stepped water terrace, three shallow ledges, water sheeting over each.
10. A circular sunken bathing pool with steps down into it on one side.
11. A small stone bridge over a narrow channel, arched, low parapets.
12. A cracked dry basin with no water, weeds growing out of the bottom.

The water is clean bright blue (#1890d8) going lighter toward the rim and where
it breaks, with white foam only where it actually falls or spills. Stone matches
the buildings exactly. Wet stone at the waterline is darker. Moss and reeds where
water meets stone.
""",

    'vegetation': """\
Draw a sheet of VEGETATION RECLAIMING A STONE CITY — the green half of the ruin,
every piece tied to the stone it grew on.

Draw these 14 separate pieces, well spaced:
1. A broad-canopied tree growing THROUGH a broken wall, its roots splitting the
   masonry, drawn as one piece.
2. A tree grown up inside a ruined doorway, the frame still standing around it.
3. A big spreading tree with heavy exposed surface roots over paving stones.
4. A slim young tree, no stone.
5. A curtain of hanging ivy, long trailing strands, as if from a ledge above.
6. A mound of dense ivy completely swallowing a shapeless block of masonry.
7. A flowering shrub covered in small white blossom.
8. A flowering shrub covered in blue and violet blossom.
9. A spray of wildflowers in white, yellow and blue growing out of a cracked
   paving slab.
10. A clump of tall grass and weeds with a fallen carved fragment among it.
11. A tree stump with new shoots and mushrooms around the base.
12. A bank of ferns against a low mossy stone.
13. A climbing rose or vine on a broken trellis of stone.
14. A patch of thick moss and small ground plants spreading flat over paving,
    seen looking down on it.

Foliage greens match the reference sheet's tree exactly — deep #1e4824 in the
shadow, #2c6a32 body, #3d8a40 lit, with the brightest leaves picked out. Stone is
the same sandstone. Every leaf mass keeps a clear silhouette; no soft fuzzy
edges.
""",
}


def load_key():
    """Env first, then a gitignored .env at the repo root. Never a tracked file."""
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


def load_style_ref(max_w=896):
    """The Mystical Tree sheet, flattened onto its own off-white and downscaled.

    Flattening matters: sent with alpha the model reads the transparent field as
    part of the design and comes back with checkerboard artefacts.
    """
    from PIL import Image
    im = Image.open(STYLE_REF).convert('RGBA')
    bg = Image.new('RGBA', im.size, (247, 243, 236, 255))
    bg.alpha_composite(im)
    im = bg.convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def call(model, key, prompt, ref_b64, aspect='3:2'):
    body = {
        'contents': [{
            'parts': [
                {'text': prompt},
                {'inline_data': {'mime_type': 'image/png', 'data': ref_b64}},
            ]
        }],
    }
    if aspect:
        body['generationConfig'] = {'imageConfig': {'aspectRatio': aspect}}
    req = urllib.request.Request(
        API.format(model=model, key=key),
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:500]
        # Older API revisions reject imageConfig outright; retry square rather
        # than fail the whole sheet over an aspect ratio.
        if aspect and e.code == 400 and 'imageConfig' in detail:
            return call(model, key, prompt, ref_b64, aspect=None)
        return None, f'HTTP {e.code}: {detail}'
    except Exception as e:  # noqa: BLE001 - surfaced to the caller as text
        return None, f'{type(e).__name__}: {e}'


def extract_image(resp):
    for cand in resp.get('candidates', []):
        for part in cand.get('content', {}).get('parts', []):
            blob = part.get('inline_data') or part.get('inlineData')
            if blob and blob.get('data'):
                return base64.b64decode(blob['data'])
    return None


def generate(name, model, key, ref, out_dir, variant=None, aspect='3:2'):
    prompt = STYLE + '\n\n' + SHEETS[name]
    tag = name if variant is None else f'{name}_v{variant}'
    resp, err = call(model, key, prompt, ref, aspect)
    if err:
        print(f'  {tag}: FAILED {err}')
        return None
    img = extract_image(resp)
    if not img:
        txt = json.dumps(resp)[:300]
        print(f'  {tag}: no image in response — {txt}')
        return None
    path = os.path.join(out_dir, f'{tag}.png')
    with open(path, 'wb') as f:
        f.write(img)
    from PIL import Image
    w, h = Image.open(path).size
    print(f'  {tag}: {w}x{h}  {len(img) // 1024}KB  -> {os.path.relpath(path, ROOT)}')
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sheet', choices=sorted(SHEETS), help='one sheet by name')
    ap.add_argument('--all', action='store_true', help='every sheet')
    ap.add_argument('--variants', type=int, default=1, help='draws per sheet; pick the best')
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--aspect', default='3:2', help="e.g. 3:2, 4:3, 1:1, '' for default")
    ap.add_argument('--out', default=OUT_DIR)
    ap.add_argument('--check', action='store_true', help='prove access with one tiny call')
    args = ap.parse_args()

    key = load_key()
    if not key:
        sys.exit('GEMINI_API_KEY not set (env or a gitignored .env at the repo root)')

    if args.check:
        ref = load_style_ref(max_w=384)
        resp, err = call(args.model, key, 'Reply with the single word OK.', ref, aspect=None)
        if err:
            sys.exit(f'access check FAILED: {err}')
        parts = resp.get('candidates', [{}])[0].get('content', {}).get('parts', [])
        text = ' '.join(p.get('text', '') for p in parts).strip()
        print(f'access OK — model={args.model} replied: {text[:80]!r}')
        return

    names = sorted(SHEETS) if args.all else ([args.sheet] if args.sheet else [])
    if not names:
        sys.exit('pass --sheet NAME or --all (names: ' + ', '.join(sorted(SHEETS)) + ')')

    os.makedirs(args.out, exist_ok=True)
    total = len(names) * args.variants
    print(f'{total} image(s), ~${total * COST_PER_IMAGE:.2f} at {args.model}\n')
    made = 0
    for name in names:
        print(f'{name}:')
        for v in range(args.variants):
            if generate(name, args.model, key, load_style_ref(), args.out,
                        None if args.variants == 1 else v + 1, args.aspect or None):
                made += 1
    print(f'\n{made}/{total} written to {os.path.relpath(args.out, ROOT)}  '
          f'(~${made * COST_PER_IMAGE:.2f})')


if __name__ == '__main__':
    main()
