#!/usr/bin/env python3
"""Turn source character poses into a game-ready actor sprite sheet.

This is the processing + packing stage of the actor pipeline:

    master art / generated frames
        -> build_actor_sheet.py        (this script)
        -> assets/actors/<name>.png    + a sprite config to paste into
                                         src/gfx/spriteCatalog.js

It is deliberately independent of where the frames came from, so the same step
serves art cut from an approved master sheet today and Gemini-generated frames
later without changing.

Two rules it exists to enforce, because both cause visible jitter if done
per-frame instead of per-sheet:

  ONE SCALE FOR THE WHOLE SHEET.  Every pose is reduced by the same factor,
  derived from a nominated reference pose. Scaling each pose to a fixed height
  independently would erase the bob in a walk cycle and make the character
  pulse.

  ONE BASELINE.  Poses are aligned by their FEET (content bottom) and centred on
  a nominated anchor column, never by their bounding box. Bounding-box centring
  drifts whenever a limb extends.

Usage:
    python3 tools/build_actor_sheet.py --manifest tools/actor_manifests/warrior_phase_a.json
"""

import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageEnhance


def preboost(img, saturation, contrast):
    """Compensate for the contrast a large reduction washes out.

    Averaging 9x9 blocks of source pixels into one greys everything down, and
    narrow features — the Warrior's blue tabard is two pixels wide once reduced —
    fade into the armour. A modest boost BEFORE the resize keeps them readable.
    Keep it modest: push too far and the palette itself drifts off the approved
    master, which is worse than losing a little contrast.
    """
    if saturation == 1.0 and contrast == 1.0:
        return img
    rgb = img.convert('RGB')
    if saturation != 1.0:
        rgb = ImageEnhance.Color(rgb).enhance(saturation)
    if contrast != 1.0:
        rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    out = rgb.convert('RGBA')
    out.putalpha(img.getchannel('A'))
    return out


def content_box(img):
    """Tight bbox of pixels that are meaningfully opaque."""
    a = np.array(img)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def foot_center(img, band=0.18):
    """Horizontal centre of the actor's FEET.

    Centring a frame on its bounding box makes the body slide sideways whenever
    a limb or weapon extends past it — which reads as jitter across a cycle. The
    feet stay planted through a walk, so they are the stable thing to align on.
    """
    a = np.array(img)[:, :, 3]
    ys = np.where(a.max(axis=1) > 8)[0]
    if len(ys) == 0:
        return img.width / 2
    bottom = ys.max()
    top = max(ys.min(), bottom - max(1, int(round(img.height * band))))
    xs = np.where(a[top:bottom + 1].max(axis=0) > 8)[0]
    return float(xs.mean()) if len(xs) else img.width / 2


def resize_premultiplied(img, w, h):
    """Resize with premultiplied alpha so transparent pixels cannot bleed their
    arbitrary colour into the sprite's edge."""
    arr = np.array(img).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    arr[:, :, :3] *= alpha
    pre = Image.fromarray(arr.astype(np.uint8)).resize((w, h), Image.LANCZOS)
    out = np.array(pre).astype(np.float32)
    a = out[:, :, 3:4] / 255.0
    with np.errstate(divide='ignore', invalid='ignore'):
        out[:, :, :3] = np.where(a > 0, out[:, :, :3] / np.maximum(a, 1e-6), 0)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def crisp_alpha(img, threshold):
    """Pixel art wants a hard edge, not a soft one."""
    arr = np.array(img)
    arr[:, :, 3] = np.where(arr[:, :, 3] >= threshold, 255, 0)
    return Image.fromarray(arr)


def quantize(img, colors):
    """Reduce the palette while keeping full transparency intact."""
    if colors <= 0:
        return img
    rgb = img.convert('RGB').quantize(colors=colors, method=Image.FASTOCTREE)
    out = rgb.convert('RGBA')
    out.putalpha(img.getchannel('A'))
    return out


def build(manifest, verbose=True):
    master = Image.open(manifest['source']).convert('RGBA')
    frame_w = manifest['frameWidth']
    frame_h = manifest['frameHeight']
    columns = manifest['columns']
    target_h = manifest['bodyHeight']       # rendered height of the reference pose
    anchor_x = manifest.get('anchorX', frame_w // 2)
    alpha_cut = manifest.get('alphaThreshold', 128)
    colors = manifest.get('colors', 48)

    # One scale factor for the entire sheet, from the reference pose.
    ref = manifest['referencePose']
    ref_box = content_box(master.crop(tuple(ref)))
    if ref_box is None:
        sys.exit('reference pose is empty')
    ref_h = ref_box[3] - ref_box[1]
    scale = target_h / ref_h
    if verbose:
        print(f"reference pose is {ref_h}px tall -> scale {scale:.4f} for the whole sheet")

    ordered = []          # (animation, index_in_animation, source_rect)
    for anim_name, rects in manifest['animations'].items():
        for i, rect in enumerate(rects):
            ordered.append((anim_name, i, rect))

    rows = (len(ordered) + columns - 1) // columns
    sheet = Image.new('RGBA', (frame_w * columns, frame_h * rows), (0, 0, 0, 0))

    frame_index = {}
    for idx, (anim_name, i, rect) in enumerate(ordered):
        pose = master.crop(tuple(rect))
        box = content_box(pose)
        if box is None:
            sys.exit(f'{anim_name}[{i}] is empty')
        pose = pose.crop(box)

        w = max(1, round(pose.width * scale))
        h = max(1, round(pose.height * scale))
        boosted = preboost(pose, manifest.get('saturation', 1.0), manifest.get('contrast', 1.0))
        small = quantize(crisp_alpha(resize_premultiplied(boosted, w, h), alpha_cut), colors)

        # Feet on the frame's bottom edge, feet centred on the anchor column.
        ox = int(round(anchor_x - foot_center(small)))
        oy = frame_h - h
        if w > frame_w or h > frame_h:
            print(f'  WARNING {anim_name}[{i}] is {w}x{h}, larger than the {frame_w}x{frame_h} frame')

        cell_x = (idx % columns) * frame_w
        cell_y = (idx // columns) * frame_h
        sheet.paste(small, (cell_x + ox, cell_y + oy), small)
        frame_index.setdefault(anim_name, []).append(idx)
        if verbose:
            print(f'  frame {idx:2d}  {anim_name}[{i}]  {w}x{h}')

    out_path = manifest['output']
    sheet.save(out_path)
    if verbose:
        print(f'\nwrote {out_path}  {sheet.width}x{sheet.height} '
              f'({columns} cols x {rows} rows of {frame_w}x{frame_h})')

    # Emit the config so the numbers in the catalog can never drift from the sheet.
    cfg = {
        'sheet': out_path,
        'frameWidth': frame_w,
        'frameHeight': frame_h,
        'columns': columns,
        'logicalHeight': manifest.get('logicalHeight', target_h),
        'animations': {
            name: {'frames': frames, 'fps': manifest['fps'].get(name, 8),
                   **({'loop': False} if name in manifest.get('oneShot', []) else {})}
            for name, frames in frame_index.items()
        },
    }
    if verbose:
        print('\n--- paste into src/gfx/spriteCatalog.js ---')
        print(json.dumps(cfg, indent=2))
    return cfg


def main():
    ap = argparse.ArgumentParser(description='Pack character poses into an actor sprite sheet')
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()
    with open(args.manifest) as f:
        manifest = json.load(f)
    build(manifest, verbose=not args.quiet)


if __name__ == '__main__':
    main()
