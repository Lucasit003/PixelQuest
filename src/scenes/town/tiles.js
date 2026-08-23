// Ground and paving tile art for the town.
//
// One registry, because the same masonry pack has to serve two consumers that
// would otherwise each load their own copy: the road rasteriser samples stone
// from PLAZA_TILES, and the plaza floor is drawn from the very same variants.
// Keeping the images in one module is what makes the road read as continuous
// where it enters the square instead of as a different material butting up
// against it.
//
// Every entry is a { img, ready } pair rather than a bare Image, so a draw can
// cheaply skip a tile whose PNG has not decoded yet instead of blitting a blank.

// --------------------------------------------------------- road stone grid
// The size one masonry tile covers on the ground. The road surface itself is
// painted by the ROAD_FAM family system below, but the stone variant for any
// given point is picked per ROAD_TILE cell (see roadTileFor), so this is what
// sets the apparent scale of the paving across the roads and the plaza alike.
const ROAD_TILE = 28;               // world units per stone cell

// Town grass ground tiles (sliced from the user's Town Grass sheet). Variants:
// 01 base, 02 base variation, 03 light flowers, 04 patchy dirt.
const GRASS_TILES = [];
for (const n of ['grass_01', 'grass_02', 'grass_03', 'grass_04']) {
  const img = new Image();
  const st = { img, ready: false };
  img.onload = () => { st.ready = true; };
  img.src = `assets/ground/${n}.png`;
  GRASS_TILES.push(st);
}
const GRASS_TILE = 96; // world units per ground tile (keeps blade density near road-tile scale)
// DEAD as of the vegetation pass — the meadow wash that consumed this was
// disabled and nothing reads MEADOW_TILE/MEADOW_TILE_STATE any more. Kept so
// the asset still loads exactly as before; delete both if the wash is not
// coming back.
// Taller/wilder meadow tile for outskirts (Sanctuary, Training edges, Gate
// approach, map perimeter) per the layout's terrain rule: short town grass in
// the developed core, meadow only where the wild starts.
const MEADOW_TILE_IMG = new Image();
const MEADOW_TILE_STATE = { img: MEADOW_TILE_IMG, ready: false };
MEADOW_TILE_IMG.onload = () => { MEADOW_TILE_STATE.ready = true; };
MEADOW_TILE_IMG.src = 'assets/ground/meadow_01.png';
const MEADOW_TILE = 56;

// Crystal Plaza floor: real modular stone tiles from the user's Crystal
// Plaza Modular Stone Pack — base/worn/moss/cracked/weathered variants,
// crystal accents, and grass-edge tiles. (The pack's "transparent overlay"
// tiles are RGB with no alpha channel like the earlier sheets, so they're
// not usable as true overlays — their look is instead achieved by using the
// equivalent solid weathered/cracked/mossy TILES zonally, which is what the
// zone system below already does.)
const PLAZA_TILES = {};
for (const n of ['base1', 'base2', 'base3', 'base4', 'worn1', 'worn2', 'lightmoss',
  'grasscracks', 'cracked', 'weathered', 'crystal1', 'crystal2', 'crystal3', 'crystal4',
  'edge_grass1', 'edge_grass2', 'edge_broken', 'edge_moss',
  'mix_base01', 'mix_base02', 'mix_base03', 'mix_base04', 'mix_base05',
  'mix_weathered06', 'mix_weathered07', 'mix_weathered08', 'mix_weathered09']) {
  const img = new Image();
  const st = { img, ready: false };
  img.onload = () => { st.ready = true; };
  img.src = `assets/plaza/${n}.png`;
  PLAZA_TILES[n] = st;
}

export { ROAD_TILE, GRASS_TILES, GRASS_TILE, MEADOW_TILE, MEADOW_TILE_STATE, PLAZA_TILES };
