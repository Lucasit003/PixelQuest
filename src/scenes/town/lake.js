// The lake: its artwork, its size, and the water geometry everything else
// derives from.
//
// The collision rects are stored as FRACTIONS of POND_W/POND_H rather than
// world units, so resizing the lake does not silently leave its collision
// behind at the old scale. They were decomposed from the matted PNG's own
// water pixels — the closest an AABB-only engine gets to polygon collision.
// Only the water is solid, so the grass/dirt/rock shoreline stays walkable and
// the player can reach the water's edge.
//
// POND_MASK_INFO is the water mask the wildlife and ripple effects are clipped
// to; it is built lazily the first time the art is ready, and exported through
// an accessor pair because it is genuinely mutable module state.

import { loadBuildingArt } from './primitives.js';

// The Lake — real transparent PNG (author's source was a JPEG "transparency
// preview" with the checker pattern baked into the pixels as literal RGB, no
// alpha channel; it was matted to real alpha by flood-filling the checker's
// grayscale/bright pixels from the canvas border, then cropped tight to its
// content bbox — see assets/pond.jpeg for the untouched original. No water
// pixel was redrawn, recolored, or reshaped; only the surrounding checker
// canvas became transparent). Native content 962x472 (2.038:1, already
// broader E/W — no rotation needed).
const POND_ART = loadBuildingArt('assets/pond.png');
const POND_W = 816, POND_H = 400; // 170% of the original 480x236 pass, aspect preserved (2.040:1, <0.1% off)

// A gazebo bridge over the lake was tried and removed: the art is a
// side-elevation sprite, and stretching one span from bank to bank meant
// squashing it well off its own proportions, which read as chopped up rather
// than as a crossing. assets/bridge.png (matted) and assets/bridgedock.png
// (the author's untouched original) are kept for a future attempt — that
// attempt wants art drawn for the span, not this one rescaled to fit it.

// Pond water FX (see gfx/waterfx.js): pixel-dot ripples/shimmer masked to
// the pond art's own water pixels, same technique as the fountain's FX.
// Mask built once, lazily, the first time the pond art is ready.
let POND_MASK_INFO = null;
export function pondMask() { return POND_MASK_INFO; }
export function setPondMask(m) { POND_MASK_INFO = m; }

// Lake collision, as fractions (0..1) of POND_W/POND_H so it stays correct
// under any future rescale. Generated (not hand-drawn) from the matted PNG's
// own water pixels — classified by hue (blue channel clearly over red, per
// the art's actual water tones) rather than grass/dirt/rock/reed/lily-pad
// pixels, then eroded ~9 source px inward (~4-5 world units at this scale)
// so the collision edge sits slightly inside the drawn shoreline and the
// player can visually reach the water's edge, then decomposed into
// axis-aligned horizontal-run rects per 10px row-band (the collision system
// only supports axis-aligned rects — this is the closest fit to "polygon
// collision" it can express). Correctly leaves the island and lily pads as
// non-solid gaps (surrounded by water either way, so unreachable on foot).
const POND_WATER_RECTS = [
  [0.2131,0.1271,0.0042,0.0212], [0.2464,0.1271,0.0042,0.0212], [0.7121,0.1271,0.0042,0.0212],
  [0.1892,0.1483,0.0052,0.0212], [0.2027,0.1483,0.0728,0.0212], [0.6559,0.1483,0.0010,0.0212],
  [0.6632,0.1483,0.1133,0.0212], [0.1965,0.1695,0.0811,0.0212], [0.3046,0.1695,0.0052,0.0212],
  [0.4023,0.1695,0.0094,0.0212], [0.4501,0.1695,0.0052,0.0212], [0.6736,0.1695,0.1341,0.0212],
  [0.1975,0.1907,0.1279,0.0212], [0.3493,0.1907,0.1081,0.0212], [0.6757,0.1907,0.1383,0.0212],
  [0.1985,0.2119,0.2661,0.0212], [0.6237,0.2119,0.0010,0.0212], [0.6726,0.2119,0.1435,0.0212],
  [0.1518,0.2331,0.0031,0.0212], [0.1913,0.2331,0.2807,0.0212], [0.6195,0.2331,0.0146,0.0212],
  [0.6726,0.2331,0.1466,0.0212], [0.1393,0.2542,0.3389,0.0212], [0.6112,0.2542,0.0405,0.0212],
  [0.6632,0.2542,0.1538,0.0212], [0.1414,0.2754,0.3638,0.0212], [0.5967,0.2754,0.2183,0.0212],
  [0.1351,0.2966,0.4366,0.0212], [0.5769,0.2966,0.2380,0.0212], [0.0936,0.3178,0.0094,0.0212],
  [0.1154,0.3178,0.6778,0.0212], [0.7983,0.3178,0.0052,0.0212], [0.0925,0.3390,0.6902,0.0212],
  [0.0915,0.3602,0.6892,0.0212], [0.0842,0.3814,0.6944,0.0212], [0.8285,0.3814,0.0135,0.0212],
  [0.0572,0.4025,0.0094,0.0212], [0.0717,0.4025,0.7141,0.0212], [0.8285,0.4025,0.0655,0.0212],
  [0.0572,0.4237,0.5260,0.0212], [0.6216,0.4237,0.1840,0.0212], [0.8181,0.4237,0.0884,0.0212],
  [0.0593,0.4449,0.0208,0.0212], [0.0863,0.4449,0.4854,0.0212], [0.6320,0.4449,0.2817,0.0212],
  [0.0946,0.4661,0.4678,0.0212], [0.6362,0.4661,0.2900,0.0212], [0.1019,0.4873,0.4584,0.0212],
  [0.6362,0.4873,0.3004,0.0212], [0.1019,0.5085,0.4595,0.0212], [0.6331,0.5085,0.3077,0.0212],
  [0.0998,0.5297,0.4709,0.0212], [0.6247,0.5297,0.3160,0.0212], [0.0946,0.5508,0.4990,0.0212],
  [0.5988,0.5508,0.3222,0.0212], [0.1175,0.5720,0.2235,0.0212], [0.3815,0.5720,0.5291,0.0212],
  [0.1258,0.5932,0.2027,0.0212], [0.3929,0.5932,0.5156,0.0212], [0.1299,0.6144,0.1892,0.0212],
  [0.4002,0.6144,0.5052,0.0212], [0.1372,0.6356,0.1788,0.0212], [0.4044,0.6356,0.4802,0.0212],
  [0.1403,0.6568,0.1123,0.0212], [0.2599,0.6568,0.0031,0.0212], [0.2807,0.6568,0.0333,0.0212],
  [0.4044,0.6568,0.4699,0.0212], [0.1435,0.6780,0.0125,0.0212], [0.1622,0.6780,0.0811,0.0212],
  [0.2900,0.6780,0.0218,0.0212], [0.4023,0.6780,0.3950,0.0212], [0.8326,0.6780,0.0364,0.0212],
  [0.1736,0.6992,0.0696,0.0212], [0.2900,0.6992,0.0166,0.0212], [0.3960,0.6992,0.0312,0.0212],
  [0.4605,0.6992,0.3306,0.0212], [0.8399,0.6992,0.0083,0.0212], [0.1798,0.7203,0.0634,0.0212],
  [0.2890,0.7203,0.0052,0.0212], [0.3929,0.7203,0.0270,0.0212], [0.4667,0.7203,0.3243,0.0212],
  [0.1798,0.7415,0.0707,0.0212], [0.3950,0.7415,0.0249,0.0212], [0.4657,0.7415,0.3254,0.0212],
  [0.1809,0.7627,0.0260,0.0212], [0.2516,0.7627,0.0239,0.0212], [0.3992,0.7627,0.0208,0.0212],
  [0.4657,0.7627,0.3337,0.0212], [0.8160,0.7627,0.0010,0.0212], [0.4106,0.7839,0.0198,0.0212],
  [0.4605,0.7839,0.3638,0.0212], [0.4241,0.8051,0.3368,0.0212], [0.4470,0.8263,0.2900,0.0212],
  [0.4615,0.8475,0.1040,0.0212], [0.6559,0.8475,0.0229,0.0212],
];

export { POND_ART, POND_W, POND_H, POND_WATER_RECTS };
