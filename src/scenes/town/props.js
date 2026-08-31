// Small procedural props, drawn in code rather than blitted from art.
//
// These predate the sprite pipeline and are the town's original street
// furniture: benches, lamps, fences, barrels, market clutter, the reeds at the
// water's edge and the two procedural trees. Most are deliberately one-liners
// — at this resolution a bench really is six rects, and spreading that over
// twenty lines would hide the shape rather than clarify it.
//
// The authored PNG props that replaced most of these are placed through
// DECOR_SIZE/DECOR_ART and drawn with drawPropArt; what remains here is still
// used by the procedural buildings and by the lake and Eldertree dressing.
//
// Pure draw calls — no scene state, no `this`.

// ---- the authored sprite registry ------------------------------------------
// DECOR_SIZE is the single source of truth for prop art: adding an entry is
// what wires a sprite into the game, and tools/bake_props.py reads these very
// numbers to resample the master at exactly the size it will be drawn. Never
// let the canvas rescale a prop — a 31x22 sprite drawn at 13x9 loses three
// pixels in seven and destroys any read that depends on a 1px highlight.
// DECOR_ART auto-registers one loader per DECOR_SIZE key.
// ------------------------------------------------------------ decor props
// Sliced out of the project's asset-library sheets (village decorations,
// fences & property decor, natural vegetation, rocks & forest floor) and
// matted to real alpha. Every sprite is bottom-anchored like the lamps
// above, so an entry is just its on-screen size in world units — the sheets
// are drawn at roughly twice the game's scale, hence the consistent
// reduction. Only what the Crystal Plaza dressing actually uses is loaded.
const DECOR_SIZE = {
  // civic furniture — the benches match each other on purpose; a square reads
  // as municipal when its furniture is a set, not an assortment
  bench_01: [32, 20],
  planter_01: [28, 21], planter_02: [32, 16],
  lamppost_twin: [26, 38],
  // The single lantern is the ROAD fitting: the twin pair is plaza
  // architecture and stays unique to the fountain, so the navigation lamps
  // out on the approaches read as a lighter class of thing even by day.
  lamppost_single: [17, 36],
  // The plain wooden post from the village decor sheet — cut long ago but
  // never baked or wired. No stone base, so it reads as a lane lamp rather
  // than civic plaza furniture.
  lamppost_wood: [18, 36],
  // ---- farm crops (from 'farm assets.png', labelled on the sheet) ---------
  // Each crop sprite carries its OWN patch of tilled soil, so a grid of them
  // reads as worked rows without needing a separate ground layer under it.
  // Sized so one plant occupies about a quarter of a player width, which is
  // what makes a field read as many plants rather than a few big props.
  soil_plot: [26, 26],
  crop_carrot: [21, 26], crop_cabbage: [22, 20],
  crop_mature_01: [21, 25], crop_wheat_01: [20, 28],
  signpost: [20, 26],
  // a trader's pitch — the plaza in use, not just furnished. Sized against the
  // player rather than the sheet: a barrel reaches a hero's waist, a stack of
  // crates their shoulder, so these run smaller than the civic furniture.
  crate_stack: [23, 25], crate_01: [14, 16], barrel_01: [13, 16], barrel_stack: [21, 23],
  sack_pile: [22, 18], sack_01: [12, 14], cart: [28, 24],
  // planting
  bush_01: [20, 18], bush_02: [20, 17], bush_03: [18, 16], bush_04: [18, 10],
  bush_low: [26, 20], bush_big: [34, 32],
  flowers_white: [16, 14], flowers_yellow: [17, 16], flowers_blue: [16, 16],
  flowers_red: [17, 16], flowers_mixed: [23, 22],
  grass_tuft_01: [17, 18], grass_tuft_02: [18, 17], grass_tuft_03: [17, 16], grass_tuft_04: [17, 17],
  fern_clump: [25, 26], weeds_01: [18, 17], weeds_02: [16, 16],
  // Wetland planting for the lake shore, sliced from assets/pond vegg.png into
  // real props so they go through the depth-sorted prop pass like everything
  // else. Drawn flat in the ground pass they read as stickers laid on the
  // bank — the player walked in front of tall cattails instead of behind them.
  // Large vegetation masses from assets/download.png — the anchors the
  // shoreline is composed from. Grass is meant to be the region's primary
  // ground cover, so these go down first and the smaller tufts feather their
  // edges afterwards, rather than the shore being built from hundreds of tufts.
  grass_lg_01: [36, 30], grass_lg_02: [37, 30], grass_lg_03: [33, 30], grass_lg_04: [20, 30], grass_lg_05: [20, 30], grass_lg_06: [23, 30], grass_lg_07: [31, 30], grass_lg_08: [27, 30], grass_lg_09: [25, 30],
  grass_dark_01: [37, 26], grass_dark_02: [41, 26], grass_dark_03: [38, 26], grass_dark_04: [37, 26], grass_dark_05: [41, 26], grass_dark_06: [37, 26],
  grass_strip_01: [42, 22], grass_strip_02: [38, 22], grass_strip_03: [26, 22], grass_strip_04: [26, 22], grass_strip_05: [27, 22], grass_strip_06: [53, 22],
  reedbed_01: [31, 34], reedbed_02: [37, 34], reedbed_03: [30, 34], reedbed_04: [31, 34], reedbed_05: [40, 34], reedbed_06: [70, 34], reedbed_07: [40, 34], reedbed_08: [26, 34],
  rockgrass_01: [29, 24], rockgrass_02: [29, 24], rockgrass_03: [42, 24], rockgrass_04: [36, 24], rockgrass_05: [24, 24],
  fernbank_01: [29, 26], fernbank_02: [37, 26], fernbank_03: [40, 26],
  // Medium and small grass, for feathering the large masses down to open ground.
  grass_md_01: [37, 20], grass_md_02: [39, 20], grass_md_03: [28, 20], grass_md_04: [24, 20], grass_md_05: [29, 20],
  grass_teal_01: [35, 18], grass_teal_02: [27, 18], grass_teal_03: [25, 18], grass_teal_04: [30, 18], grass_teal_05: [26, 18],
  grass_tall_01: [29, 24], grass_tall_02: [23, 24], grass_tall_03: [15, 24], grass_tall_04: [19, 24],
  grass_bloom_01: [26, 18], grass_bloom_02: [26, 18], grass_bloom_03: [24, 18],
  leafplant_01: [19, 16], leafplant_02: [14, 16],
  rockgrass_md_01: [24, 18], rockgrass_md_02: [27, 18], rockgrass_md_03: [27, 18], rockgrass_md_04: [27, 18],
  cattail_md_01: [21, 22], cattail_md_02: [37, 22],
  grass_sm_01: [11, 12], grass_sm_02: [30, 12], grass_sm_03: [14, 12], grass_sm_04: [13, 12], grass_sm_05: [17, 12], grass_sm_06: [16, 12],
  grass_tiny_01: [8, 8], grass_tiny_02: [8, 8], grass_tiny_03: [7, 8], grass_tiny_04: [11, 8], grass_tiny_05: [11, 8], grass_tiny_06: [9, 8],
  grass_lean_01: [18, 16], grass_lean_02: [22, 16], grass_lean_03: [22, 16], grass_lean_04: [23, 16],
  cattail_01: [20, 27], cattail_02: [25, 29], cattail_03: [23, 28],
  cattail_flower_01: [19, 27], cattail_flower_02: [19, 27],
  reeds_01: [14, 27], reeds_02: [20, 25], reeds_03: [26, 28], reeds_04: [27, 26],
  wetgrass_01: [18, 17], wetgrass_02: [25, 19], wetgrass_03: [30, 20],
  waterleaf_01: [22, 24], waterleaf_02: [32, 24],
  tree_small_pine: [30, 38],
  // Broadleaf stock (sliced from the tree sheet). Sized as a planting
  // hierarchy rather than to the art's own proportions: a whip, an understory
  // tree, ornamentals, then canopy. Real planting never jumps straight from a
  // 32-unit shrub to a 62-unit canopy — the intermediate sizes are what let a
  // group read as one planted mass instead of as big sprites next to small
  // ones. Heights are the design; each width is the source aspect held exactly,
  // so nothing is squashed.
  tree_sapling: [22, 34], tree_young: [26, 44],
  tree_blossom_white: [43, 52], tree_blossom_blue: [42, 52], tree_blossom_violet: [42, 51],
  tree_oak_round: [52, 62], tree_oak_spread: [50, 64], tree_oak_broad: [75, 60],
  // DECIDUOUS_TREE_01, matted off the labelled sheet at
  // assets/Natural Vegatiation.jpeg (a JPEG on a flat panel, so the background
  // was flood-filled from the crop border and the panel's own rule trimmed at
  // the blank gap above it). Carries its own ground shadow, so it is placed
  // with shadow 0 rather than getting a second one from drawPropArt.
  // Cut from the labelled natural-vegetation sheet. Crop INSIDE each panel's
  // border and sample the background from the crop's own corners — cropping
  // wider starts the flood on the sheet ground, and the panel's border line
  // then blocks it, leaving the panel square baked into the sprite.
  // Understory off the same sheet. Panels there enclose their own caption, so
  // the cut drops components that look like text (short, small) or a rule
  // (wide, thin) before splitting the panel into sprites.
  nv_bush_01: [36, 32], nv_bush_02: [60, 32], nv_bush_03: [37, 32], nv_bush_04: [36, 32], nv_tallgrass_01: [21, 24], nv_tallgrass_02: [22, 24], nv_tallgrass_04: [25, 24], nv_tallgrass_05: [26, 24], nv_tallgrass_06: [27, 24], nv_tallgrass_07: [27, 24], nv_weeds_01: [17, 17], nv_weeds_02: [17, 17], nv_weeds_03: [16, 17], nv_weeds_04: [17, 17],
  pine_tree_01: [47, 70], pine_tree_02: [46, 70],
  pine_tree_03: [49, 70], pine_tree_04: [49, 70],
  deciduous_tree_01: [62, 70], deciduous_tree_02: [62, 70],
  deciduous_tree_03: [62, 70], deciduous_tree_04: [57, 70],
  deciduous_tree_05: [64, 70], deciduous_tree_06: [57, 70],
  // MUSHROOMS_01/_02 off the same sheet; each labelled cell held two clusters
  // side by side, so they are split into four variants.
  mushrooms_01: [14, 12], mushrooms_02: [13, 12],
  mushrooms_03: [17, 13], mushrooms_04: [14, 13],
  // Specimens that carry their own ground treatment — a root flare with rough
  // grass, and a skirt of flowers. They dress their own base, so they read as
  // planted rather than dropped, and need no understory placed around them.
  tree_rooted: [50, 66], tree_flowerbed: [42, 62],
  // Built containers: civic furniture that happens to be alive. Kept near
  // lamppost height (38) on purpose — they belong to the furniture set that
  // frames the square, not to the landscape beyond it.
  topiary_square: [28, 42], topiary_round: [24, 40],
  // ---- quadrant props (new cuts) -----------------------------------------
  // Sized against the player (~20 units tall), not against the sheet: a barrel
  // reaches the waist, a fence rail the chest, a well the shoulder. Each width
  // holds the source aspect so nothing is squashed.
  // SE — the market approach
  wheelbarrow: [30, 16], hay_bale: [22, 17], hay_pile: [28, 22],
  barrel_02: [13, 17], crate_02: [14, 16], wooden_sign: [18, 20],
  // NE — archive and forge
  wood_pile_01: [24, 19], wood_pile_03: [25, 18], chopping_block: [18, 20],
  log_long: [28, 17], tree_stump_01: [20, 16],
  // SW — the cottage gardens
  fence_run: [52, 13], fence_short: [28, 18], fence_vertical: [38, 14],
  // A single post. `fence_vertical` is a face-on picket SECTION, not a
  // fence running away from camera — stacked it reads as a wooden wall.
  // A line of these is how a side run is actually drawn in this view.
  fence_post: [5, 18],
  fence_corner_ne: [32, 19], fence_corner_sw: [28, 18], fence_corner_se: [26, 20],
  fence_end_e: [23, 14], fence_end_w: [23, 13], fence_gate: [62, 13],
  garden_patch_01: [34, 25], garden_patch_02: [33, 24],
  flower_box_01: [24, 18], flower_box_02: [28, 14], clothes_line: [34, 21],
  mailbox: [9, 20], wooden_post: [6, 26], water_well: [26, 29], water_bucket: [12, 15],
  // NW — lake, guild, the wild edge
  tree_stump_02: [21, 16], fallen_log_01: [30, 22], fallen_log_02: [24, 12],
  direction_sign: [18, 23], fallen_branch: [28, 19], twig_pile: [26, 17],
  leaf_pile: [26, 20], mushrooms_red: [12, 10], mushrooms_mixed: [12, 10],
  // ground detail
  rock_small_01: [18, 15], rock_small_02: [18, 15], rock_small_03: [17, 15], rock_med_01: [27, 23],
  pebbles_01: [11, 10], pebbles_02: [13, 9], pebbles_03: [18, 13],
  // ---- Eldertree ruin set (sliced from the Mystical Tree sheet) ----------
  // This sheet is authored much larger than the library pages, so sizes come
  // from design height, not a fixed ratio: statues read at ~1.5 player
  // heights, temple columns at ~2, and the grand tree is the biggest thing
  // in the world on purpose — a landmark seen over everything else.
  mystic_tree_grand: [176, 200],
  myst_col_a: [12, 40], myst_col_b: [12, 40], myst_col_cracked: [12, 40], myst_col_tall: [13, 42],
  myst_col_lean: [11, 29], myst_col_broken: [10, 25], myst_col_stub: [9, 19], myst_col_drum: [18, 11],
  myst_arch_a: [37, 46], myst_arch_b: [37, 46], myst_arch_narrow: [21, 45], myst_arch_vine: [33, 44],
  myst_ped_book: [14, 26], myst_ped_sword: [14, 26], myst_ped_leaf: [14, 26],
  myst_ped_crystal_dim: [14, 28], myst_ped_crystal_lit: [14, 30],
  myst_bench_a: [30, 20], myst_bench_b: [31, 20], myst_bench_c: [28, 20], myst_bench_d: [22, 20],
  myst_bench_bit: [18, 12],
  myst_pond: [96, 37],
  // the sheet's own ancient paving, laid flat as the shrine walkway (the _ew
  // pieces are pre-rotated by the cutter, since props only ever mirror)
  myst_path_straight: [18, 37], myst_path_straight_ew: [37, 18],
  myst_path_curve: [20, 37], myst_path_curve_ew: [37, 20],
  myst_path_cross: [34, 40], myst_path_edge: [19, 15], myst_path_steps: [22, 22],
  myst_statue_maiden: [13, 30], myst_statue_knight: [15, 30], myst_statue_crystal: [14, 28],
  myst_statue_kneel: [12, 23], myst_statue_glow: [14, 22], myst_statue_sit: [17, 20],
  myst_crystals_purple: [21, 24], myst_crystals_cyan: [22, 22], myst_crystals_mini: [14, 13],
  myst_rock_a: [16, 15], myst_rock_b: [16, 16], myst_rock_c: [16, 15], myst_rock_d: [16, 16], myst_rock_e: [17, 16],
  myst_wall_long: [40, 22], myst_wall_gap: [40, 22], myst_wall_vine: [41, 22], myst_wall_steps: [41, 22],
  myst_wall_long_ns: [22, 40], myst_wall_gap_ns: [22, 40], myst_wall_vine_ns: [22, 41], myst_wall_steps_ns: [22, 41],
  myst_door_flowers: [23, 36], myst_stone_pair: [10, 20], myst_stone_one: [12, 22],
  myst_pillar_moss_a: [9, 29], myst_pillar_moss_b: [10, 26],
  myst_bush_white: [34, 26], myst_bush_meadow: [46, 25], myst_stump_flowers: [38, 38],
  myst_flower_spray: [30, 31],
  myst_shrine_niche: [19, 34], myst_fountain_mini: [33, 34],
  myst_arch_ruin: [52, 48], myst_gazebo: [39, 52],
  myst_tree_round: [49, 56], myst_tree_roots: [49, 62],
  myst_rubble_a: [38, 12], myst_rubble_b: [12, 11], myst_rubble_c: [13, 12],
  myst_crystal_spike: [13, 14],

  // ---- Ancient City set (generated; see tools/gen_city_sheet.py + citycut.py) --
  // Sizes come from a design HEIGHT per prop, with width following the cut's
  // own aspect so nothing is squashed. Heights are read off the scale table in
  // docs/ART_RULES.md: player ~24, canopy tree ~2.5x that, building ~3.5x.
  // These are the pieces the Mystical Tree sheet never had — things with
  // storeys and roofs — so the quarter can read as a city rather than a walled
  // garden. The watchtower is the tallest thing in the world after the
  // Eldertree, on purpose: it is what you see over the wall on approach.
  city_watchtower: [61, 118], city_temple: [117, 92], city_townhouse: [82, 94],
  city_rotunda: [85, 96], city_gatehouse: [111, 96], city_hall_colonnade: [128, 80],
  city_granary: [73, 88], city_shrine: [84, 80], city_merchant_house: [78, 86],
  city_chapel: [73, 96], city_greathall: [115, 88], city_archive: [112, 84],
  // civic sculpture — ~1.5 player heights, except the colossal king and the arch
  city_statue_king: [36, 58], city_statue_rider: [46, 54], city_arch_triumph: [94, 66],
  city_statue_winged: [30, 40], city_statue_scholar: [16, 38],
  city_statue_warrior: [19, 38], city_statue_headless: [25, 34], city_obelisk: [15, 46],
  city_stele: [22, 34], city_statue_toppled: [43, 22], city_lion_l: [15, 32],
  city_lion_r: [15, 32], city_votive_column: [12, 44], city_standing_stones: [51, 34],
  city_stardial: [26, 38],
  // walls, streets and rubble — the connective stone. The _ns piece is drawn
  // north-south on the sheet itself, so unlike the myst_ set nothing here
  // needs a pre-rotated twin.
  city_wall: [54, 32], city_wall_broken: [52, 34], city_wall_ivy: [54, 30],
  city_wall_steps: [54, 32], city_wall_door: [55, 30], city_wall_gap: [56, 32],
  city_wall_low: [51, 22], city_wall_ns: [42, 40], city_wall_corner: [55, 42],
  city_steps: [46, 28], city_ramp: [37, 24], city_rubble_heap: [34, 22],
  city_rubble_a: [18, 11], city_rubble_b: [13, 10], city_rubble_c: [13, 10],
  // laid FLAT (groundDecor) — these are seen looking straight down
  city_paving: [54, 20], city_paving_ns: [41, 40], city_paving_cross: [40, 38],
  // waterworks — the city's water still running. The pool, the canals and the
  // dry basin are laid FLAT; the fountain, aqueducts, wall fountain and well
  // stand up and show their face.
  // The canal is drawn deliberately larger than its "correct" scale. At the
  // size the rest of the set implies, its stone kerbs came out ~3px and the
  // whole watercourse read as a flat blue ribbon painted on the grass; at this
  // size the kerbs are ~8px and it reads as masonry with water in it. The
  // canal, cross, bridge and cascade come from the second (corrective) water
  // sheet — see the water2 block in tools/citycut.py.
  city_fountain: [63, 70], city_pool: [69, 40], city_canal: [62, 34],
  city_canal_ns: [53, 82], city_canal_cross: [60, 60],
  // The aqueducts come from their own sheet (see the aqueduct block in
  // tools/citycut.py) — the water sheet's versions were drawn at an angle and
  // read as blue slides. These are three-arch spans, wide enough to march
  // along the east wall and still be read as a single structure.
  city_aqueduct: [94, 58], city_aqueduct_broken: [87, 62],
  city_aqueduct_pier: [29, 52], city_aqueduct_end: [96, 48],
  city_wallfountain: [26, 40], city_well: [23, 34], city_cascade: [50, 44],
  city_bath: [47, 30], city_waterbridge: [47, 34], city_basin_dry: [37, 26],
  // the green half of the ruin — every piece tied to the stone it grew on, so
  // the vegetation reads as reclamation rather than as landscaping
  city_tree_wall: [80, 66], city_tree_door: [45, 60], city_sapling: [18, 40],
  city_ivy_curtain: [46, 36], city_ivy_mound: [51, 40], city_shrub_white: [32, 22],
  city_shrub_blue: [31, 22], city_stump_shoots: [21, 18], city_ferns: [45, 24],
  city_wildflowers: [25, 20], city_grass_clump: [25, 24], city_stump_small: [19, 18],
  city_vine_trellis: [39, 34], city_moss_patch: [44, 22],

  // ---- Moonbell + maintenance kit (generated) -----------------------------
  // The Moonbell is the garden's one rare plant. The cool tint lives only in
  // the bell mouths and there is no glow, no aura and no light — it reads as a
  // rare species, not a magic item, which is what keeps the ruin subtle.
  // Used TWICE in the whole garden and nowhere else.
  gk_moonbell: [9, 14], gk_moonbell_clump: [11, 15],
  // A trellis that is already grown into, rather than a bare frame with plants
  // parked next to it. Replaces gk_trellis wherever the frame should look
  // established.
  gk_trellis_vine: [33, 44],
  gk_basket: [18, 12],

  // ---- Garden hero + ruin kit (generated) ---------------------------------
  // The hero tree is the garden's SECONDARY landmark, after the pond. At 96x88
  // it is meaningfully larger than tree_oak_broad (75x60), the biggest tree the
  // game had, but nowhere near mystic_tree_grand (176x200) — a fine garden
  // tree, not a world tree.
  gk_herotree: [96, 88],
  // the northern nook's overgrown ruin garden
  gk_ruin_foundation: [44, 20], gk_ruin_stub: [30, 26], gk_ruin_fragments: [26, 16],
  // the only signs anyone tends the place
  gk_tools: [18, 26], gk_wateringcan: [19, 14],

  // ---- Garden redesign kit (generated) ------------------------------------
  // The pond is the garden's focal point at the approved ~72x46 — smaller than
  // the town fountain's stone apron and carrying no crystal, jet or glow, so it
  // reads as quiet rather than as a second landmark.
  //
  // The three beds exist to kill the rectangles. gk_bed_blue/gk_bed_white are
  // straight stone-kerbed boxes, and four of them inside a rectangular hedge is
  // what made the garden read as a grid. These are a crescent, an elongated
  // ribbon and a broad lobed mass — their SILHOUETTES are the point, not their
  // contents.
  gk_pond: [72, 46],
  gk_bed_crescent: [47, 22], gk_bed_ribbon: [33, 20], gk_bed_broad: [37, 26],
  gk_pedestal: [16, 20],

  // ---- Farm kit (generated) -----------------------------------------------
  // The scarecrow reads at ~1.5 player heights, the same rule the statues use.
  // The crows share a body size and differ only in wingspan, so the beat does
  // not jitter as the frame changes: up 14 wide, half 13, down 18, glide 23.
  scarecrow: [33, 36],
  crow_up: [11, 11], crow_half: [10, 9], crow_down: [14, 8],
  crow_glide: [18, 6], crow_perch: [10, 8],

  // ---- Garden kit (generated) ---------------------------------------------
  // Made against a reference sheet of the game's OWN props (bench, stalls,
  // fences, trees) rather than a generic pixel-art brief, so it matches the
  // town's muted palette and soft shading instead of the sandstone city set.
  // The three hedge pieces are what finally give the garden a boundary that
  // is not a row of identical potted topiary.
  // 24 not 18: at 18 the hedge is a dark stripe against grass at gameplay
  // zoom and stops reading as a boundary. Measured in-frame, not in preview.
  gk_hedge: [56, 24], gk_hedge_ns: [24, 56], gk_hedge_corner: [26, 30],
  gk_hedge_end: [27, 24],
  gk_arch: [51, 54], gk_trellis: [51, 40], gk_birdbath: [18, 26],
  gk_sundial: [13, 22], gk_bed_blue: [38, 20], gk_bed_white: [39, 20],
  gk_urn: [22, 28],
  // laid FLAT — the garden's own path materials, which is what the district
  // was missing: garden_patch is a VEGETABLE BED, not paving.
  gk_gravel: [38, 22], gk_stepstones: [35, 26],

  // ---- Plaza district set -------------------------------------------------
  // Nothing here is new art. The five market stalls and the cottage were
  // already authored for the far-south Market and for Wayfarer's Watch, but
  // were reachable only from inside drawMarket()/the Watch compound, so the
  // plaza could never use them. Copied into the prop pipeline at their native
  // size — which IS their draw size — they now Y-sort, cull and take contact
  // shadows like every other prop, with no new rendering path.
  stall_produce: [50, 33], stall_bakery: [42, 36], stall_cloth: [42, 37],
  stall_goods: [52, 32], stall_merchant: [50, 33], cottage_small: [140, 88],
  // Cut or baked long ago and then never given a DECOR_SIZE entry, so they
  // have been sitting unused on disk: a second bench, an outdoor table, and
  // two lamps. Sized to match bench_01 (32x20) and lamppost_twin (26x38).
  bench_02: [32, 20], table_outdoor: [32, 20],
  lamp_04: [29, 38], lamp_crystal: [29, 40],

  // Plaza life — a market pitch, a hung banner, and the small signs of people
  // living here. Generated as one sheet and cut to these exact sizes by
  // tools/cut_prop_sheet.py, so the art is already at draw size.
  market_stall: [34, 44], banner_shield: [18, 38], handcart: [28, 22],
  laundry_line: [38, 24], cat_sitting: [9, 11], barrel_apples: [14, 18],
};
const DECOR_ART = {};
for (const n of Object.keys(DECOR_SIZE)) DECOR_ART[n] = loadBuildingArt(`assets/props/${n}.png`);

import { rect, rectOutline, disc, shadow } from '../../gfx/pixel.js';
import { drawIcon } from '../../gfx/props.js';
// The Eldertree's crystal motes reuse the fountain's mote palette.
import { MOTE_COLORS } from './fountain.js';
import { hash, contactShadow, fillEllipse, loadBuildingArt } from './primitives.js';

function bench(g, x, y) { shadow(g, x, y, 8, 2, 0.22); rect(g, x - 8, y - 4, 16, 3, '#7a5a3a'); rect(g, x - 8, y - 7, 16, 2, '#8a6a44'); rect(g, x - 7, y - 1, 2, 3, '#5a3a24'); rect(g, x + 5, y - 1, 2, 3, '#5a3a24'); }
function lamp(g, x, y, t) { rect(g, x - 1, y - 18, 2, 18, '#3a2e22'); rect(g, x - 3, y - 22, 6, 5, '#4a3a2a'); const f = 0.6 + Math.sin(t * 4 + x) * 0.2; g.globalAlpha = f; disc(g, x, y - 19, 3, '#ffd67a'); g.globalAlpha = 1; disc(g, x, y - 19, 1, '#fff2c0'); g.globalAlpha = 0.07 + f * 0.04; disc(g, x, y - 16, 20, '#ffcc66'); g.globalAlpha = 1; }
function brazier(g, x, y, t) { shadow(g, x, y, 6, 2, 0.3); rect(g, x - 4, y - 6, 8, 6, '#3a3a46'); rect(g, x - 5, y - 8, 10, 2, '#4a4a58'); rect(g, x - 1, y - 2, 2, 6, '#2a2a34'); const f = 0.6 + Math.sin(t * 8 + x) * 0.3; g.globalAlpha = f; disc(g, x, y - 10, 4, '#f2942b'); disc(g, x, y - 11, 2, '#ffd67a'); g.globalAlpha = 1; g.globalAlpha = 0.1 + f * 0.05; disc(g, x, y - 8, 18, '#ff9a3c'); g.globalAlpha = 1; }
function fenceRun(g, x, y, w) { for (let fx = x; fx <= x + w; fx += 8) rect(g, fx, y - 5, 1, 7, '#6b4a2e'); rect(g, x, y - 3, w, 1, '#7a5530'); rect(g, x, y, w, 1, '#5a3a24'); }
function barrel(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 9, 8, 9, '#7a5530'); rect(g, x - 4, y - 7, 8, 1, '#4a3220'); rect(g, x - 4, y - 3, 8, 1, '#4a3220'); rect(g, x - 4, y - 9, 8, 1, '#8a6a44'); }
function crate(g, x, y) { shadow(g, x, y, 4, 1, 0.25); rect(g, x - 4, y - 8, 9, 8, '#8a6a44'); rectOutline(g, x - 4, y - 8, 9, 8, '#5a3a24'); rect(g, x - 4, y - 4, 9, 1, '#5a3a24'); rect(g, x, y - 8, 1, 8, '#5a3a24'); }
function logPile(g, x, y) { shadow(g, x, y, 6, 1, 0.22); for (let i = 0; i < 3; i++) rect(g, x - 6 + i * 4, y - 4, 3, 4, '#6b4a2e'); for (let i = 0; i < 2; i++) rect(g, x - 4 + i * 4, y - 7, 3, 3, '#7a5530'); }
function planter(g, x, y) { rect(g, x - 5, y - 5, 10, 5, '#6b4a2e'); rect(g, x - 5, y - 5, 10, 1, '#8a6a44'); rect(g, x - 4, y - 8, 2, 3, '#3a7a3e'); rect(g, x, y - 9, 2, 4, '#3a7a3e'); rect(g, x - 4, y - 9, 1, 1, '#e0679a'); rect(g, x + 1, y - 10, 1, 1, '#f2c94f'); }
function flowerbed(g, x, y) { for (let i = 0; i < 4; i++) { const fx = x + i * 4; rect(g, fx, y - 3, 1, 3, '#2f5836'); rect(g, fx, y - 4, 1, 1, ['#f2c94f', '#e0679a', '#9d8bff', '#e05a5a'][i % 4]); } }
function well(g, x, y) { shadow(g, x, y, 8, 3, 0.3); rect(g, x - 8, y - 8, 16, 8, '#8a8ea0'); rectOutline(g, x - 8, y - 8, 16, 8, '#3a3e4a'); rect(g, x - 9, y - 18, 2, 10, '#5a3a24'); rect(g, x + 7, y - 18, 2, 10, '#5a3a24'); rect(g, x - 10, y - 20, 20, 3, '#7a3e2c'); }
function cart(g, x, y) { shadow(g, x, y, 10, 2, 0.28); rect(g, x - 12, y - 8, 24, 6, '#7a5530'); rectOutline(g, x - 12, y - 8, 24, 6, '#4a3220'); disc(g, x - 8, y, 3, '#4a3220'); disc(g, x + 8, y, 3, '#4a3220'); disc(g, x - 8, y, 1, '#8a6a44'); disc(g, x + 8, y, 1, '#8a6a44'); drawIcon(g, 'potionRed', x - 4, y - 14); }
function mailbox(g, x, y) { rect(g, x - 1, y - 8, 2, 8, '#5a3a24'); rect(g, x - 4, y - 13, 9, 6, '#c0463c'); rectOutline(g, x - 4, y - 13, 9, 6, '#2a1a10'); rect(g, x + 4, y - 12, 2, 3, '#d8b24a'); }
function clothesline(g, x, y) { rect(g, x - 12, y - 14, 1, 14, '#5a3a24'); rect(g, x + 12, y - 14, 1, 14, '#5a3a24'); rect(g, x - 12, y - 13, 24, 1, '#8a8070'); rect(g, x - 6, y - 12, 4, 5, '#5c6a8a'); rect(g, x + 2, y - 12, 4, 6, '#c0463c'); }
function signpost(g, x, y) { rect(g, x - 1, y - 12, 2, 12, '#5a3a24'); rect(g, x - 8, y - 12, 16, 4, '#7a5530'); rect(g, x - 8, y - 12, 16, 1, '#8a6a44'); }
function banner(g, x, y, color) { rect(g, x, y, 3, 20, color); rect(g, x, y + 20, 3, 2, '#2a1e14'); rect(g, x - 1, y + 16, 5, 4, color); }
function weaponRack(g, x, y) { rect(g, x - 8, y - 2, 16, 3, '#6b4a2e'); rect(g, x - 8, y - 14, 2, 14, '#5a3a24'); rect(g, x + 6, y - 14, 2, 14, '#5a3a24'); drawIcon(g, 'sword', x - 6, y - 12); drawIcon(g, 'axe', x + 1, y - 12); }
function outdoorTable(g, x, y) { shadow(g, x, y, 8, 2, 0.24); rect(g, x - 8, y - 6, 16, 3, '#7a5530'); rect(g, x - 7, y - 3, 2, 3, '#5a3a24'); rect(g, x + 5, y - 3, 2, 3, '#5a3a24'); drawIcon(g, 'coin', x - 3, y - 11); }
function petHouse(g, x, y, color) { shadow(g, x, y, 5, 1, 0.22); rect(g, x - 5, y - 5, 10, 5, '#8a6a44'); for (let i = 0; i < 6; i++) rect(g, x - 5 + i, y - 5 - i * 0.5, 10 - i * 2, 1, color); disc(g, x, y - 2, 2, '#2a1a10'); }
function bowl(g, x, y) { rect(g, x - 3, y - 2, 6, 2, '#8a8ea0'); rect(g, x - 2, y - 1, 4, 1, '#5c6a8a'); }
function egg(g, x, y, color) { rect(g, x - 1, y - 3, 3, 4, color); rect(g, x - 1, y - 3, 1, 1, '#ffffff'); }
function bridge(g, x, y, w, h) { rect(g, x, y, w, h, '#7a5530'); for (let by = 0; by < h; by += 4) rect(g, x, y + by, w, 1, '#5a3a24'); rect(g, x, y, w, 1, '#8a6a44'); rect(g, x, y + h - 1, w, 1, '#8a6a44'); rect(g, x - 1, y, 1, h, '#4a3220'); rect(g, x + w, y, 1, h, '#4a3220'); }

// A small reed/cattail cluster for riverbanks — a few thin blades and one
// cattail head, with a barely-there sway so the bank doesn't feel static.
function drawReeds(g, x, y, seed, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 0.6 + seed) * 0.6;
  shadow(g, x, y, 5, 2, 0.2);
  for (let i = 0; i < 3; i++) {
    const bx = x + (i - 1) * 3;
    const h = 9 + (i % 2) * 2;
    const tip = bx + sway * (i - 1 === 0 ? 0.4 : 1);
    rect(g, bx, y - h, 1, h, '#3a7a3e');
    rect(g, Math.round(tip), y - h, 1, 3, '#5cad5e');
  }
  rect(g, x + 1, y - 12 + sway * 0.5, 1, 5, '#4a7a3a'); // cattail stem
  rect(g, x, y - 16 + sway * 0.5, 3, 4, '#7a5a34'); // cattail head
  rect(g, x, y - 16 + sway * 0.5, 3, 1, '#9a7a4a'); // head highlight
}

// Volumetric tree: trunk, layered canopy (dark underside -> bright upper-left
// highlight), a lower-right shade crescent and a ground contact shadow. Gentle
// sway. Reads with real volume rather than as a flat symbol.
function bigTree(g, x, y, kind, t) {
  x = Math.round(x); y = Math.round(y);
  const sway = Math.sin(t * 1.1 + x * 0.3) * 1;
  if (kind === 'pine') {
    contactShadow(g, x, y, 9, 3, 0.34);
    rect(g, x - 1, y - 6, 3, 6, '#4a3018'); rect(g, x - 1, y - 6, 1, 6, '#5c3e22');
    pineTier(g, x + sway * 0.3, y - 4, 12, 7);
    pineTier(g, x + sway * 0.5, y - 12, 9, 7);
    pineTier(g, x + sway * 0.7, y - 20, 6, 6);
    rect(g, x - 1 + sway, y - 28, 2, 3, '#1f4a26'); // tip
  } else {
    contactShadow(g, x, y, 13, 4, 0.34);
    rect(g, x - 2, y - 9, 4, 9, '#5a3a24'); rect(g, x - 2, y - 9, 2, 9, '#6b4a2e');
    const cy = y - 13 + sway;
    fillEllipse(g, x + 1, cy + 3, 13, 9, '#1e4824');   // dark underside
    fillEllipse(g, x - 1, cy, 13, 9, '#2c6a32');       // mid canopy
    fillEllipse(g, x - 2, cy - 2, 10, 7, '#3d8a40');   // lit
    fillEllipse(g, x - 4, cy - 4, 6, 4, '#57b356');    // highlight (upper-left)
    fillEllipse(g, x + 6, cy + 3, 5, 4, '#173d1c');    // lower-right shade
    // a couple of leaf clumps for texture
    rect(g, x - 6, cy - 1, 1, 1, '#57b356'); rect(g, x + 4, cy - 3, 1, 1, '#3d8a40');
  }
}

function pineTier(g, cx, baseY, halfW, hgt) {
  cx = Math.round(cx);
  for (let i = 0; i < hgt; i++) {
    const k = i / hgt;
    const w = Math.round(halfW * (0.15 + k * 0.85));
    const y = baseY - hgt + i;
    rect(g, cx - w, y, w * 2, 1, '#2c6a32');            // mid
    rect(g, cx - w, y, Math.max(1, w), 1, '#3d8a40');   // left/upper lit
    rect(g, cx + Math.floor(w * 0.4), y, Math.ceil(w * 0.6), 1, '#1f4a26'); // right shade
  }
  rect(g, cx - halfW, baseY - 1, halfW * 2, 1, '#173d1c'); // dark base line
}


// ---- the Eldertree ---------------------------------------------------------
// The glade's landmark, and the one prop carrying its own animation overlay.
// ---- The Eldertree -------------------------------------------------------
// The grand crystal tree on its dais, from the Mystical Tree sheet, plus a
// pure-t animation overlay in the same idiom as the fountain's: additive
// glow only (no scale, no move, no blur) on the crystals that grow from the
// trunk, and a slow drift of motes rising through the canopy. Crystal
// positions are measured off the source art (532x603, drawn at 176x200) and
// expressed as offsets from the base anchor (cx, baseY).
const ELDER_CRYSTALS = [
  // [dx, dy, r, hue] — measured from the baked sprite (opaque cyan / violet
  // pixel clusters, centroid + area), so the glow sits on the gems themselves
  [-31, -114, 3, 'c'], [5, -100, 4, 'c'], [18, -110, 3, 'v'],
  [-16, -86, 3, 'c'], [12, -80, 3, 'v'], [-11, -71, 3, 'c'], [14, -67, 3, 'c'],
  [-23, -64, 3, 'c'], [-4, -61, 3, 'v'], [16, -39, 3, 'c'],
  // the two hanging in the canopy (art has them at the crown's left/right)
  [-46, -166, 2, 'c'], [66, -150, 2, 'c'],
];
const ELDER_HUE = { c: ['#aef4ff', '#e8fdff'], v: ['#c9a0ff', '#efe0ff'] };
function drawEldertree(g, cx, baseY, t) {
  const art = DECOR_ART.mystic_tree_grand;
  if (!art.ready) return;
  g.drawImage(art.img, Math.round(cx - 88), Math.round(baseY - 200), 176, 200);
  g.save();
  g.globalCompositeOperation = 'lighter';
  // 1. crystal pulse: each gem breathes on its own phase, ~2.5s loop
  for (let i = 0; i < ELDER_CRYSTALS.length; i++) {
    const [dx, dy, r, h] = ELDER_CRYSTALS[i];
    const p = Math.sin(t * (2 * Math.PI / 2.5) + i * 1.7) * 0.5 + 0.5;
    g.globalAlpha = 0.05 + p * 0.09;
    disc(g, cx + dx, baseY + dy, r * 2.2, ELDER_HUE[h][0]);
    g.globalAlpha = 0.10 + p * 0.16;
    disc(g, cx + dx, baseY + dy, r, ELDER_HUE[h][1]);
  }
  // 2. the heart glow: a soft standing light at the root cluster, so the
  // whole trunk base reads as lit from within
  const hp = Math.sin(t * 0.9) * 0.5 + 0.5;
  g.globalAlpha = 0.045 + hp * 0.03;
  disc(g, cx - 2, baseY - 74, 30, '#8fe8ff');
  g.globalAlpha = 1;
  g.restore();
  // 3. motes: rise out of the trunk crystals on a gentle sway, fade in and
  // out, glint at their brightest. Same recipe as the fountain's fxMotes,
  // spread across the whole crown since this is a much bigger subject.
  const N = 7;
  for (let i = 0; i < N; i++) {
    const period = 3.4 + i * 0.41;
    const loop = Math.floor((t + i * 2.9) / period);
    const phase = ((t + i * 2.9) % period) / period;
    const seedX = hash(i * 8.3 + loop * 5.7);
    const seedC = hash(i * 4.9 + loop * 7.3 + 2);
    const col = MOTE_COLORS[Math.floor(seedC * MOTE_COLORS.length)];
    const x0 = (seedX * 2 - 1) * 46;
    const rise = phase * 84;
    const sway = Math.sin(phase * Math.PI * 3 + i * 1.3) * 3;
    const px = Math.round(cx + x0 + sway);
    const py = Math.round(baseY - 58 - rise);
    const a = Math.sin(phase * Math.PI);
    g.globalAlpha = a * 0.9;
    rect(g, px, py, 2, 2, col.core);
    if (a > 0.85) {
      g.globalAlpha = (a - 0.85) * 5;
      rect(g, px - 2, py, 6, 2, col.glint);
      rect(g, px, py - 2, 2, 6, col.glint);
    }
  }
  g.globalAlpha = 1;
}

// ---- Butterflies ---------------------------------------------------------
// Six-frame flap strips (12x9 per frame) baked from assets/butterfly.png.
//
// The flight used to be two summed sines, which traces a smooth closed loop.
// That is a moth's idea of flying, or a bee's — a butterfly is the least smooth
// thing in a garden. It commits to a short heading, darts, coasts, changes its
// mind, and drops height between wingbeats. All three of those are modelled
// here, and it is the last one the eye actually reads.
//
// Still driven entirely off `t`, with no per-frame state: the same time always
// gives the same position, which is what lets the render harnesses hash a frame
// and compare it. Randomness comes from hash() keyed on the butterfly's own
// home point, so two butterflies over the same bed never fly in step.
const BUTTERFLY_ART = {};
for (const n of ['blue', 'violet', 'gold', 'white']) BUTTERFLY_ART[n] = loadBuildingArt(`assets/props/butterfly_${n}.png`);
const BF_W = 12, BF_H = 9;
const BF_LEG = 0.95;          // seconds committed to one heading

function drawButterfly(g, b, t) {
  const art = BUTTERFLY_ART[b.col];
  if (!art.ready) return;
  // Derived rather than stored, so every existing spawn site keeps working
  // unchanged — they push {x, y, col, rx, ry, speed, phase} and nothing else.
  const seed = b.x * 0.37 + b.y * 0.71 + b.phase * 13.1;
  const tt = t * b.speed + b.phase;

  // ---- path: legs, not orbits ---------------------------------------------
  const i = Math.floor(tt / BF_LEG);
  const u = tt / BF_LEG - i;
  const at = (k) => [(hash(seed + k * 13.7) - 0.5) * 2 * b.rx,
                     (hash(seed + 511 + k * 7.3) - 0.5) * 2 * b.ry];
  // Roughly one leg in four is a REST: it has found something and stays on it,
  // wings beating slowly. Without these the flight is relentless and reads as
  // machinery; the pauses are what make the darting look like a decision.
  const resting = (k) => hash(seed + 977 + k * 3.9) < 0.26;
  const rest = resting(i);
  const [x0, y0] = at(i);
  const [x1, y1] = rest ? [x0, y0] : at(i + 1);
  // Fast out of the turn, slow into the next one. That asymmetry is the whole
  // difference between a dart and a drift; an eased-both-ends curve just gives
  // back the sine loop this replaced.
  const e = 1 - Math.pow(1 - u, 2.6);
  const x = b.x + x0 + (x1 - x0) * e;
  let y = b.y + y0 + (y1 - y0) * e;

  // ---- wingbeat, and the bob that comes off it ----------------------------
  // Height is lost between beats and won back on the downstroke, so the path
  // scallops instead of running level. Frame and bob are taken from the same
  // phase; driving them separately makes the wings fight the body.
  const beat = (t * (rest ? 3.4 : 9.5) + b.phase * 3) % 1;
  const FLAP = [0, 1, 4, 5];   // top-down frames only — 2 and 3 are edge-on and
  const f = FLAP[Math.min(3, Math.floor(beat * 4))];   // vanish at this size
  y -= Math.sin(beat * Math.PI * 2) * (rest ? 0.5 : 2.4);

  const px = Math.round(x), py = Math.round(y);
  contactShadow(g, px, py + 6, 3, 1, 0.14);
  g.save();
  // face the way it is going, not the way it is leaning
  if (x1 - x0 < 0) { g.translate(px, 0); g.scale(-1, 1); g.translate(-px, 0); }
  g.drawImage(art.img, f * BF_W, 0, BF_W, BF_H, px - BF_W / 2, py - BF_H / 2, BF_W, BF_H);
  g.restore();
}

// Ground crystal clusters glow the same way, drawn in the overlay pass with
// the lamps so the light sits on top of whatever grows around them.
function crystalGlow(g, x, y, t, hue, r) {
  const p = Math.sin(t * 2.1 + x * 0.05) * 0.5 + 0.5;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.05 + p * 0.06;
  disc(g, x, y - r * 0.5, r * 1.6, ELDER_HUE[hue][0]);
  g.globalAlpha = 0.08 + p * 0.10;
  disc(g, x, y - r * 0.6, r * 0.7, ELDER_HUE[hue][1]);
  g.restore();
  g.globalAlpha = 1;
}

export {
  DECOR_SIZE, DECOR_ART,
  drawEldertree, drawButterfly, crystalGlow,
  bench, lamp, brazier, fenceRun, barrel, crate,
  logPile, planter, flowerbed, well, cart, mailbox,
  clothesline, signpost, banner, weaponRack, outdoorTable, petHouse,
  bowl, egg, bridge, drawReeds, bigTree, pineTier,
};
