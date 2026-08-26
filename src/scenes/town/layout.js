// The town's master layout: where every district sits, what is interactable,
// what is solid, and how the roads connect it all.
//
// Everything is derived from the plaza centre rather than hardcoded in world
// coordinates, so moving the square moves the town with it. That is why a
// "fixed world-Y threshold" bug keeps recurring in this codebase — any
// constant that is not expressed relative to PZ goes stale the moment a
// district moves.
//
// Order matters at the end of this function: architecture and roads are laid
// down before any dressing runs, because every placement helper tests against
// roads, solids and district footprints. Dressing that runs first finds an
// empty world and scatters into it.

import { buildFlare } from './ground.js';
import { roadPath, buildRoadCoverage } from './roads.js';
import { POND_W, POND_H, POND_WATER_RECTS, buildLakeDetail, buildLakeDecor } from './lake.js';
import { buildPlazaDecor } from './plaza.js';
import { buildAncientCity } from './city.js';
import {
  COTTAGE_ART, COTTAGE_H, COTTAGE_W, DUNGEON_ART, DUNGEON_H, DUNGEON_W, HOUSE_H, HOUSE_W,
  SANCTUARY_ART, SANCTUARY_H, SANCTUARY_W, WATCH_ART, WATCH_H, WATCH_W,
  drawBlacksmith, drawLibrary, drawMarker, drawMarket, drawPlayerHouse, drawPotionShop,
  drawQuestBoard, drawSignpost, drawTavern, drawTrainingGround,
} from './buildings.js';
import { drawFountainSprite, FOUNTAIN_W, FOUNTAIN_H } from './fountain.js';
import { buildRiver } from './river.js';
import { buildRiverDecor } from './riverdecor.js';
import { buildCrossings } from './bridge.js';
import { buildWaterfall } from './waterfall.js';
import { buildRiverfront } from './riverfront.js';
import { drawEldertree } from './props.js';
import { drawPropArt, hash } from './primitives.js';
import { MAP_W, MAP_H } from './dimensions.js';
import { ROAD_TILE } from './tiles.js';

export function buildTown(scene) {
  // ======================================================================
  // MASTER TOWN LAYOUT v4 — full spatial reorganization. One compact
  // settlement radiating from Crystal Plaza, with the dungeon route
  // running due NORTH: Plaza -> Guild -> Wayfarer's Watch -> Adventure
  // Road -> Runebound Gate. Distances are speed-derived (100 units = 1s
  // of walking) and chosen against the approved time targets: potion
  // 5-8s, forge 7-10s, market/guild 8-12s, homes 10-15s, archive 12-18s,
  // training/sanctuary 15-20s, watch 20-25s, gate 30-40s.
  //
  // Mental compass (core navigation): NORTH adventure, EAST shops,
  // SOUTH/SE market, WEST/SW homes. Outer ring: training NW, archive NE,
  // sanctuary SW. Nothing but the Gate lies beyond the Watch.
  // FINAL SPACING POLISH: same landscape relationships, three density
  // rings —
  //   CORE (compact, around the plaza): potion 6.1s, forge 8.4s,
  //     market 8.4s, guild 9.6s, residential ~11s (player house 13.7s)
  //   OUTER TOWN: archive 13.5s, sanctuary 16.2s, training 17.0s
  //   ADVENTURE OUTSKIRTS: watch 16.2s, gate 23.7s (longest route)
  // vs the previous pass: market pulled 16% closer, archive 23% closer,
  // guild->watch shortened 35%, watch->gate shortened 25%. The Gate is
  // still the northernmost destination; its remaining distance is meant
  // to read through environment, not empty grass. Developed-town bbox
  // (training<->archive x guild<->market): ~2750x1750 on centers,
  // ~2930x1930 on sprite edges -> ~1.5:1 landscape either way.
  const PZ = { x: 2050, y: 2750 };
  const OFF = (dx, dy) => ({ x: PZ.x + dx, y: PZ.y + dy });

  const D = {
    plaza: PZ,
    market: OFF(260, 800),        // S/SE core: destination square (~8.4s)
    residential: OFF(-1050, 400), // W/SW core: neighborhood center (~11s)
    southRoad: OFF(280, 1250),    // S: future world exit past the market
    // Moved off the main trunk: slightly further up, and a lot further
    // left — now shares the Lake's exact x (same side-to-side position),
    // sitting just north of it instead of east on the adventure spine.
    guild: OFF(-750, -1100),      // W, level with the Lake (~14.1s)
    archive: OFF(1150, -700),     // NE outer: quiet landscaped property (~13.5s)
    training: OFF(-1600, -560),   // W/NW outer: large dedicated compound (~17s)
    sanctuary: OFF(-1500, 620),   // W/SW outer: green outskirts (~16.2s)
    watch: OFF(0, -1620),         // N adventure: fortified checkpoint (~16.2s)
    gate: OFF(0, -2370),          // FAR NORTH (locked): northernmost destination (~23.7s)
    // Same side-to-side (x) position as the original NW placement; y
    // recentred to sit between the Guild and the Fountain (halfway
    // between their anchors) after the 170% size-up — see the in-browser
    // clearance check this pass for exact neighbor gaps at the new size.
    lake: OFF(-750, -415),        // between Guild and Crystal Fountain, nudged toward the plaza
    // The meadow gap west of the Archive, framed by the Archive link road
    // to the north and the Forge->Archive road to the east: a ruined
    // shrine glade around the grand crystal tree.
    eldertree: OFF(570, -605),    // NE gap, west of the Archive (~8.6s)
  };
  const ET = D.eldertree;
  // Commercial: the Forge keeps the east street. The Potion Shop was moved
  // off that street and down the market-bound lane — the two shops were
  // crowding each other at ~230 units apart, and each needs room for its
  // own prop set later (herbs/crates vs firewood/weapon racks). They now sit
  // ~490 apart on different roads, and the Potion Shop is on the OUTSIDE
  // (south) side of the commercial street, roughly halfway toward Market.
  const forgeSpot = OFF(820, -180);   // ~8.4s, on the east street
  const potionSpot = OFF(560, 250);   // ~6.1s, south of the street, market-bound lane
  // Residential quarter members: the player house gets the largest lot on
  // the loop's quiet southwest side; Hearthwood cottage fronts the east.
  const houseSpot = { x: D.residential.x - 200, y: D.residential.y + 160 };  // ~13.7s, largest lot
  const cottageSpot = { x: D.residential.x + 150, y: D.residential.y - 140 };// ~9.4s

  scene.plazaCenter = PZ;
  // The fountain sprite is anchored at its base (PZ.y) and drawn upward, so
  // its true VISUAL center sits FOUNTAIN_H/2 above PZ.y — the plaza disc and
  // the four road exits are built around that point, not PZ.y itself, so
  // the fountain is actually centered on both axes rather than just close.
  const FC = { x: PZ.x, y: PZ.y - FOUNTAIN_H / 2 };
  scene.plazaFocus = FC;
  // Plaza disc diameter as a multiple of the fountain's width, so the paving
  // always scales with the landmark rather than being a fixed pixel figure.
  // Tightened from 2.2x to 1.9x: with the roads widened, the old disc read
  // as a large empty apron around the fountain. The four road exits, both
  // lamps and the flares are all derived from this radius, so they follow it
  // inward automatically.
  scene.plazaRadius = Math.round(FOUNTAIN_W * 1.9 / 2); // ~1.9x fountain diameter

  scene.locations = [
    { id: 'plaza', name: 'Crystal Plaza', dx: PZ.x, dy: PZ.y + 18, action: 'rest', district: 'Crystal Plaza',
      draw: (g) => drawFountainSprite(g, PZ.x, PZ.y, scene.t, scene.plazaRadius), solid: { x: PZ.x - 26, y: PZ.y - 27, w: 52, h: 16 } },

    // ---- Weapon Smith + Potion Shop: standalone column below Training ----
    { id: 'weapon', name: 'Ironhearth Forge', dx: forgeSpot.x, dy: forgeSpot.y, action: 'weapon', district: 'Ironhearth Forge',
      draw: (g) => drawBlacksmith(g, forgeSpot.x, forgeSpot.y, scene.t),
      solid: { x: forgeSpot.x - 56, y: forgeSpot.y - 68, w: 112, h: 68 } },
    { id: 'potion', name: 'Potion Shop', dx: potionSpot.x, dy: potionSpot.y, action: 'potion', district: 'Potion Shop',
      draw: (g) => drawPotionShop(g, potionSpot.x, potionSpot.y, scene.t),
      solid: { x: potionSpot.x - 56, y: potionSpot.y - 80, w: 113, h: 80 } },

    // ---- Market Square: one shared open square, stalls on its edges ----
    { id: 'market', name: 'Market Square', dx: D.market.x, dy: D.market.y, action: 'market', district: 'Market Square', zone: true,
      draw: (g) => drawMarket(g, D.market.x, D.market.y, scene.t), solid: null },

    // ---- Residential Quarter: neighborhood loop with 4 lots ----
    { id: 'home', name: 'Player House', dx: houseSpot.x, dy: houseSpot.y, action: 'house', district: 'Player House',
      draw: (g) => drawPlayerHouse(g, houseSpot.x, houseSpot.y, scene.t),
      solid: { x: houseSpot.x - HOUSE_W / 2, y: houseSpot.y - HOUSE_H, w: HOUSE_W, h: HOUSE_H } },
    { id: 'cottage', name: 'Hearthwood Cottage (reserved)', dx: cottageSpot.x, dy: cottageSpot.y, action: null, district: 'Residential Quarter',
      draw: (g) => drawPropArt(g, COTTAGE_ART, cottageSpot.x, cottageSpot.y, COTTAGE_W, COTTAGE_H, 0),
      solid: { x: cottageSpot.x - COTTAGE_W / 2, y: cottageSpot.y - COTTAGE_H, w: COTTAGE_W, h: COTTAGE_H } },
    // Reserved future-home lots fronting the neighborhood loop (NW + E),
    // so all four residential properties face the same street.
    { id: 'lotA', name: null, dx: null, dy: null, action: null, sortY: D.residential.y - 85,
      draw: (g) => drawMarker(g, D.residential.x - 175, D.residential.y - 130, 62, 46, 'Future Home') },
    { id: 'lotB', name: null, dx: null, dy: null, action: null, sortY: D.residential.y + 130,
      draw: (g) => drawMarker(g, D.residential.x + 175, D.residential.y + 85, 62, 46, 'Future Home') },

    // ---- South Road ----
    { id: 'southExpand', name: null, dx: null, dy: null, action: null, sortY: D.southRoad.y,
      draw: (g) => drawSignpost(g, D.southRoad.x + 40, D.southRoad.y, 'South Road - Future Expansion') },

    // ---- Shield & Stein: building + social courtyard ----
    { id: 'guild', name: 'Shield & Stein', dx: D.guild.x, dy: D.guild.y + 72, action: 'guild', district: 'Shield & Stein',
      draw: (g) => drawTavern(g, D.guild.x, D.guild.y + 72, scene.t),
      solid: { x: D.guild.x - 61, y: D.guild.y - 6, w: 122, h: 78 } },

    // ---- Runewood Archive: landscaped property ----
    { id: 'library', name: 'Runewood Archive', dx: D.archive.x, dy: D.archive.y + 45, action: 'library', district: 'Runewood Archive',
      draw: (g) => drawLibrary(g, D.archive.x, D.archive.y + 45, scene.t),
      solid: { x: D.archive.x - 45, y: D.archive.y - 25, w: 90, h: 70 } },

    // ---- The Eldertree: grand crystal tree on its ruined dais ----
    // The dais is part of the art, so the sprite carries its own ground
    // (shadowRx 0, same as the compound buildings). Solid is the dais
    // ellipse's AABB; the interact point sits on the south steps.
    // Collision is three boxes stepping in toward the ellipse's tips
    // (the rest are appended to scene.solids below), so the player can walk
    // right up to the stone beside the dais and never bumps into air.
    { id: 'eldertree', name: 'The Eldertree', dx: ET.x, dy: ET.y + 26, action: 'tree', label: 'Upgrade skills at the Eldertree', district: 'Eldertree Glade',
      sortY: ET.y - 2,
      draw: (g) => drawEldertree(g, ET.x, ET.y, scene.t),
      solid: { x: ET.x - 82, y: ET.y - 46, w: 164, h: 32 } },

    // ---- Moonpaw Sanctuary: large green fenced property ----
    { id: 'pets', name: 'Moonpaw Sanctuary (reserved)', dx: D.sanctuary.x, dy: D.sanctuary.y + 55, action: 'pets', district: 'Moonpaw Sanctuary',
      draw: (g) => drawPropArt(g, SANCTUARY_ART, D.sanctuary.x, D.sanctuary.y + 55, SANCTUARY_W, SANCTUARY_H, 0),
      solid: { x: D.sanctuary.x - SANCTUARY_W / 2, y: D.sanctuary.y + 55 - SANCTUARY_H, w: SANCTUARY_W, h: SANCTUARY_H } },

    // ---- Valorhall: large dedicated compound ----
    { id: 'training', name: 'Valorhall Training Grounds', dx: D.training.x, dy: D.training.y, // Valorhall is a sparring yard, not a classroom — the quiz it used to host
      // now lives at the Archive. Left as a walk-in zone until practice combat
      // gives it something to do.
      action: null, district: 'Valorhall Training Grounds', zone: true,
      draw: (g) => drawTrainingGround(g, D.training.x, D.training.y, scene.t),
      solid: { x: D.training.x - 75, y: D.training.y - 60, w: 150, h: 24 } },

    // ---- Wayfarer's Watch: fortified checkpoint straddling the road ----
    // Compound art with baked courtyard ground: sortY sits at the base of
    // the gatehouse wall so the player renders on top of the art while
    // inside the courtyard, but behind the wall when north of it.
    // Collision is the two wall slabs + the keeper's cottage (appended to
    // scene.solids below), leaving the central arch OPEN so the Adventure
    // Road passes straight through the compound.
    { id: 'watchGate', name: null, dx: null, dy: null, action: null, district: "Wayfarer's Watch", sortY: D.watch.y - 29,
      draw: (g) => drawPropArt(g, WATCH_ART, D.watch.x + 35, D.watch.y + 30, WATCH_W, WATCH_H, 0),
      solid: null },

    // ---- Runebound Gate: large northern landmark approach ----
    { id: 'dungeon', name: 'Runebound Gate', dx: D.gate.x, dy: D.gate.y + 48, action: 'dungeon', district: 'Runebound Gate',
      draw: (g) => drawPropArt(g, DUNGEON_ART, D.gate.x, D.gate.y + 28, DUNGEON_W, DUNGEON_H, 0),
      solid: { x: D.gate.x - DUNGEON_W / 2, y: D.gate.y + 28 - DUNGEON_H, w: DUNGEON_W, h: DUNGEON_H * 0.65 } },

    // ---- Quest Board: small functional prop beside the Watch approach ----
    { id: 'quest', name: 'Quest Board', dx: D.watch.x - 70, dy: D.watch.y + 115, action: 'quest', district: "Wayfarer's Watch",
      draw: (g) => drawQuestBoard(g, D.watch.x - 70, D.watch.y + 111, scene.t, !!scene.hero.activeQuest()),
      solid: { x: D.watch.x - 82, y: D.watch.y + 95, w: 24, h: 16 } },
  ];

  scene.districts = D;
  scene.solids = scene.locations.filter((l) => l.solid).map((l) => l.solid);
  scene.solids.push({ x: ET.x - 54, y: ET.y - 14, w: 108, h: 12 },   // dais front steps
                   { x: ET.x - 54, y: ET.y - 58, w: 108, h: 12 });  // dais back
  // Wayfarer's Watch collision (measured off the art's own proportions):
  // wall slabs flanking the open central arch, plus the keeper's cottage.
  {
    const wx = D.watch.x + 35, wTop = D.watch.y + 30 - WATCH_H;
    scene.solids.push(
      { x: wx - 46, y: wTop + 1, w: 30, h: 51 },  // gatehouse wall, west of arch
      { x: wx + 17, y: wTop + 1, w: 28, h: 51 },  // gatehouse wall, east of arch
      { x: wx - 89, y: wTop + 16, w: 49, h: 59 }, // keeper's cottage
    );
  }
  // Lake collision: axis-aligned rects decomposed from the matted PNG's
  // own water pixels (POND_WATER_RECTS above) — the closest fit to
  // "polygon collision" this engine's AABB-only solids can express. Only
  // the water is solid, so the grass/dirt/rock shoreline stays walkable
  // and the player can approach the water's edge.
  scene.lakeTopLeft = { x: D.lake.x - POND_W / 2, y: D.lake.y - POND_H / 2 };
  for (const [fx, fy, fw, fh] of POND_WATER_RECTS) {
    const x = scene.lakeTopLeft.x + fx * POND_W, y = scene.lakeTopLeft.y + fy * POND_H;
    scene.solids.push({ x, y, w: fw * POND_W, h: fh * POND_H });
  }

  // district entry-banner regions (Player House folded into Residential —
  // the house is a member of the neighborhood now, not its own district)
  scene.regions = [
    { name: 'Crystal Plaza', x: PZ.x - 160, y: PZ.y - 180, w: 320, h: 320 },
    { name: 'Potion Shop', x: potionSpot.x - 130, y: potionSpot.y - 140, w: 250, h: 210 },
    { name: 'Ironhearth Forge', x: forgeSpot.x - 110, y: forgeSpot.y - 140, w: 230, h: 210 },
    { name: 'Market Square', x: D.market.x - 260, y: D.market.y - 210, w: 520, h: 420 },
    { name: 'Residential Quarter', x: D.residential.x - 340, y: D.residential.y - 270, w: 660, h: 600 },
    { name: 'Shield & Stein', x: D.guild.x - 130, y: D.guild.y - 90, w: 260, h: 250 },
    { name: 'Runewood Archive', x: D.archive.x - 140, y: D.archive.y - 110, w: 280, h: 270 },
    { name: 'Eldertree Glade', x: ET.x - 400, y: ET.y - 300, w: 830, h: 720 },
    { name: 'Moonpaw Sanctuary', x: D.sanctuary.x - 200, y: D.sanctuary.y - 170, w: 400, h: 340 },
    { name: 'Valorhall Training Grounds', x: D.training.x - 190, y: D.training.y - 160, w: 380, h: 330 },
    { name: "Wayfarer's Watch", x: D.watch.x - 160, y: D.watch.y - 140, w: 390, h: 300 },
    { name: 'Runebound Gate', x: D.gate.x - 320, y: D.gate.y - 240, w: 640, h: 470 },
    { name: 'South Road', x: D.southRoad.x - 140, y: D.southRoad.y - 110, w: 280, h: 220 },
  ];

  // ------------------------------------------------------------ roads ---
  // SPATIAL PASS ONLY: these are logical centerlines for the coming
  // handcrafted modular road pieces — no procedural road drawing. The
  // waypoint polylines live in scene.roadPlan (dev overview + future
  // passes); scene.roads/roadCells are still rasterised so tree/prop
  // placement keeps avoiding the planned streets.
  const mainWidth = 42, resWidth = 26, narrowWidth = 16, advWidth = 38; // main matches flareFarW below exactly

  // Crystal Plaza is a true 4-way intersection: exactly one road meets it
  // per cardinal direction (N/E/S/W), all the same width, all starting at
  // the same distance (the plaza radius) from the fountain's visual center
  // FC — never from the center itself, so nothing ever overlaps the
  // fountain's collision box.
  const exitN = [FC.x, FC.y - scene.plazaRadius];
  const exitS = [FC.x, FC.y + scene.plazaRadius];
  const exitE = [FC.x + scene.plazaRadius, FC.y];
  const exitW = [FC.x - scene.plazaRadius, FC.y];
  const R = scene.plazaRadius;
  // Flare trapezoids: short (~1-2 player lengths) transition at each exit,
  // tapering from a widened mouth down to the plaza's own jittered circle
  // boundary — see buildFlare(). Locked to explicit values (not derived
  // from mainWidth) so plaza-connection geometry never drifts if the
  // regular road width elsewhere changes.
  // Near width is generously wider than the road it feeds so the funnel
  // overlaps the circle well past the outward wobble above, leaving no
  // sliver at the join; far width matches the main road exactly.
  const flareNearW = 62, flareFarW = 42, flareDepth = 34;
  scene.plazaFlares = [
    buildFlare(FC, R, -90, flareNearW, flareFarW, flareDepth), // N
    buildFlare(FC, R, 90, flareNearW, flareFarW, flareDepth),  // S
    buildFlare(FC, R, 0, flareNearW, flareFarW, flareDepth),   // E
    buildFlare(FC, R, 180, flareNearW, flareFarW, flareDepth), // W
  ];

  // WX = the Watch art's centerline (the arch); WX-24 = the south fence gap.
  const WX = D.watch.x + 35;
  // Each segment declares its material family and painted width. `famTo`
  // makes a segment blend from one family into another along its length
  // (the §7 transition rule — families never cut at a hard straight line);
  // `w1` tapers the width along the same axis, which is how the Ancient
  // road narrows as it approaches the Gate.
  const plan = [
    // MAIN N: Plaza -> Watch south approach, straight up the spine — no
    // longer detours to the Guild now that it's moved west to the Lake
    // (see the Guild spur below instead). The one road that matters for
    // progression: town -> adventure, so it eases main -> civic as it goes.
    { kind: 'main', fam: 'main', famTo: 'civic', w0: 42, w1: 38, width: mainWidth, pts: [
      exitN, [PZ.x, PZ.y - 700], [WX - 24, D.watch.y + 500], [WX - 24, D.watch.y + 130]] },
    // SECONDARY: main trunk -> Guild spur. Branches off the Plaza->Watch
    // spine well north of the Lake (y=PZ.y-700, ~285 units clear of its
    // top edge) and drops straight down into the Guild's courtyard —
    // Guild's second connection besides the Training link below, so it's
    // not a dead end reachable only by way of Training.
    { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 33, w1: 33, width: narrowWidth, pts: [
      [PZ.x, PZ.y - 700], [PZ.x - 250, PZ.y - 760], [D.guild.x + 180, D.guild.y + 190],
      [D.guild.x + 55, D.guild.y + 40]] },
    // ADVENTURE ROAD: through the Watch (fence gap -> courtyard -> arch),
    // then the long wilderness run north to the Runebound Gate. Ancient
    // family throughout, narrowing 30 -> 21 as civilization falls away.
    { kind: 'adventure', fam: 'ancient', w0: 38, w1: 27, width: advWidth, pts: [
      [WX - 24, D.watch.y + 130], [WX - 24, D.watch.y], [WX, D.watch.y - 30], [WX, D.watch.y - 90],
      [D.gate.x + 40, D.gate.y + 620], [D.gate.x, D.gate.y + 370], [D.gate.x, D.gate.y + 45]] },
    // MAIN E: Plaza -> Commercial street, running to the Forge's front.
    { kind: 'main', fam: 'main', w0: 42, w1: 42, width: mainWidth, pts: [
      exitE, [PZ.x + 330, PZ.y - 20], [PZ.x + 600, PZ.y - 90], [forgeSpot.x, forgeSpot.y + 55]] },
    // MAIN S: Plaza -> Market Square. Runs down the square's WEST rim
    // rather than through it, so the stalls front a real street while the
    // open middle stays clear for NPC traffic and events.
    { kind: 'main', fam: 'main', w0: 42, w1: 37, width: mainWidth, pts: [
      exitS, [PZ.x + 60, PZ.y + 430], [D.market.x - 240, D.market.y - 300],
      [D.market.x - 205, D.market.y - 60], [D.market.x - 195, D.market.y + 60]] },
    // Market -> South Road (future world exit) — continues from the same
    // rim point so the street reads as one continuous route through town,
    // then tapers toward the map edge.
    { kind: 'main', fam: 'main', w0: 37, w1: 30, width: mainWidth, pts: [
      [D.market.x - 195, D.market.y + 60], [D.market.x - 120, D.market.y + 250],
      [D.southRoad.x, D.southRoad.y]] },
    // MAIN W: Plaza -> Residential entry (a long, clearly horizontal run)
    { kind: 'main', fam: 'main', famTo: 'res', w0: 42, w1: 28, width: mainWidth, pts: [
      exitW, [PZ.x - 420, PZ.y + 60], [PZ.x - 700, PZ.y + 260], [D.residential.x + 215, D.residential.y - 70]] },
    // Residential neighborhood loop — a compact ring street with all four
    // properties fronting it: Hearthwood + lotA on the north arc, lotB
    // east, Player House on the south arc with the deepest yard.
    // The west arc swings out to x-300 rather than x-235: at the tighter
    // radius the arc ran diagonally straight THROUGH the Player House's
    // footprint (the house sat on the street, not beside it). Pushed west,
    // the house now sits inside the ring fronting the south arc, with its
    // yard between.
    { kind: 'res', fam: 'res', w0: 26, w1: 26, width: resWidth, pts: [
      [D.residential.x + 215, D.residential.y - 70], [cottageSpot.x, cottageSpot.y + 40],
      [D.residential.x - 95, D.residential.y - 65], [D.residential.x - 280, D.residential.y - 55],
      [D.residential.x - 300, D.residential.y + 80], [houseSpot.x - 30, houseSpot.y + 62],
      [D.residential.x + 60, D.residential.y + 175], [D.residential.x + 215, D.residential.y + 85],
      [D.residential.x + 215, D.residential.y - 70]] },
    // SECONDARY: Residential -> Valorhall (northwest lane), firming from
    // neighbourhood stone into the wilder outskirts.
    { kind: 'secondary', fam: 'res', famTo: 'nature', w0: 25, w1: 23, width: narrowWidth, pts: [
      [D.residential.x - 280, D.residential.y - 55], [D.training.x + 230, D.residential.y - 240],
      [D.training.x + 60, D.training.y + 230], [D.training.x, D.training.y + 100]] },
    // SECONDARY: Valorhall -> Guild — closes the house -> training -> guild
    // -> adventure loop and gives the north side a long east/west run.
    // Rerouted (lake up to 170%/recentred pass) around the lake's north
    // shore instead of straight through it: same two endpoints, a nub up
    // and a sweep at y=1975 clears the lake's top edge (2075) by ~100
    // units before dropping down into the Guild's courtyard. This is the
    // scenic lakeside route, so it runs Nature until it reaches the Guild.
    // Starts at Valorhall's own entrance (the same point the Residential
    // lane arrives at) and runs up the compound's east side, so the two
    // form one continuous Residential -> Training -> lakeside -> Guild
    // route instead of this one dead-ending in grass beside the compound.
    { kind: 'secondary', fam: 'nature', famTo: 'civic', w0: 23, w1: 28, width: narrowWidth, pts: [
      [D.training.x + 30, D.training.y + 100], [D.training.x + 205, D.training.y + 20],
      [D.training.x + 250, 1985], [D.guild.x - 150, 1930], [D.guild.x - 75, D.guild.y + 60]] },
    // SECONDARY: Commercial -> Archive (quiet landscaped NE path)
    { kind: 'secondary', fam: 'main', w0: 26, w1: 26, width: narrowWidth, pts: [
      [forgeSpot.x + 30, forgeSpot.y + 30], [D.archive.x - 120, PZ.y - 420],
      [D.archive.x, D.archive.y + 200], [D.archive.x, D.archive.y + 70]] },
    // SECONDARY: Archive -> north road (adventure-route link, no backtrack)
    // — joins the main trunk at the same waypoint the trunk itself bends
    // through, now that this no longer doubles as "near the Guild".
    { kind: 'secondary', fam: 'main', famTo: 'civic', w0: 24, w1: 24, width: narrowWidth, pts: [
      [D.archive.x - 40, D.archive.y - 20], [D.archive.x - 700, D.archive.y - 200], [WX - 24, D.watch.y + 500]] },
    // ---- Eldertree Glade approaches ---------------------------------
    // The glade is entered from the SOUTH (see city.js for
    // why the axis is fixed). Both spurs are town cobble easing into the
    // Nature family — grass reclaiming a footpath — because the town keeps
    // the shrine way walkable but stopped paving it long ago; the glade's
    // own ancient flagstones take over where the road ends. (Ancient was
    // tried for this: at 17 units wide its dark wash + 46% rubble rate
    // reads as a smear, not a road.)
    // MAIN APPROACH: leaves the commercial street north of the Potion
    // Shop lane and runs straight up the meadow to the gate — ~9s from the
    // plaza, in scale with the landmark. Wander nearly off (a processional
    // way stays deliberate) and the end pinned between the guardian
    // statues, dead on the walkway axis, so the hand-off is exact.
    { kind: 'secondary', fam: 'main', famTo: 'nature', w0: 24, w1: 19, width: narrowWidth,
      wob: [10, 300], pts: [
      [2600, 2673], [2596, 2565], [2614, 2445], [ET.x, ET.y + 300]] },
    { kind: 'secondary', fam: 'main', famTo: 'nature', w0: 22, w1: 17, width: narrowWidth,
      wob: [10, 300], pts: [
      [2740, 1915], [2812, 1988], [2846, 2110], [2810, 2250], [2720, 2350], [2616, 2400]] },
    // ---- Ancient City interior streets: the SAME ROAD_FAM stone as the
    // rest of the map (replacing the mystical flagstone paths). Straight
    // (wander off) — a city grid, not a meandering trail.
    { kind: 'main', fam: 'main', famTo: 'ancient', w0: 46, w1: 46, width: mainWidth, wob: [0, 0], pts: [
      [ET.x, ET.y - 258], [ET.x, ET.y + 356]] },              // main avenue N-S
    { kind: 'secondary', fam: 'main', famTo: 'ancient', w0: 34, w1: 34, width: narrowWidth, wob: [0, 0], pts: [
      [ET.x - 306, ET.y + 40], [ET.x + 306, ET.y + 40]] },    // cross street E-W
    // market plaza: a short, wide road node on the avenue (the paved square)
    { kind: 'main', fam: 'main', famTo: 'ancient', w0: 92, w1: 92, width: mainWidth, wob: [0, 0], pts: [
      [ET.x, ET.y + 168], [ET.x, ET.y + 214]] },
    // SECOND ROUTE: from the Archive link road, swinging down the glade's
    // east side and joining the main approach a little south of the gate,
    // so the north of town reaches the glade without going via the plaza.
    // SECONDARY: Commercial -> Market (east loop, skips the plaza). Runs
    // down the square's EAST rim, mirroring the main road on the west, so
    // the market sits framed between two streets instead of having a lane
    // dead-end in the grass north of the stalls.
    // It leaves the commercial street, passes the Potion Shop's front door
    // on the way down, then continues to the market.
    { kind: 'secondary', fam: 'main', w0: 28, w1: 26, width: narrowWidth, pts: [
      [PZ.x + 480, PZ.y - 60], [potionSpot.x + 40, potionSpot.y - 130],
      [potionSpot.x + 105, potionSpot.y + 30], [D.market.x + 235, D.market.y - 200],
      [D.market.x + 205, D.market.y + 40]] },
    // SECONDARY: Residential -> Market (south loop, skips the plaza).
    // Starts exactly on a loop vertex — branching a few dozen units off the
    // ring left a blobby smear of overlapping road at the junction.
    { kind: 'secondary', fam: 'res', famTo: 'main', w0: 25, w1: 26, width: narrowWidth, pts: [
      [D.residential.x + 60, D.residential.y + 175], [PZ.x - 700, D.market.y - 150],
      [PZ.x - 250, D.market.y + 40], [D.market.x - 250, D.market.y + 30]] },
    // SECONDARY: Residential -> Sanctuary (green outskirts lane, westward),
    // starting on the loop's west vertex. Its second waypoint used to sit
    // EAST of its own start, so the lane doubled back on itself and the
    // resulting hook cut straight through the Player House; it now runs
    // consistently south-west from the ring to the Sanctuary's front.
    // The approach also used to place a waypoint inside the Sanctuary's own
    // footprint, running the lane under the building; it now passes down its
    // east side and comes back west along the front to reach the door.
    { kind: 'secondary', fam: 'nature', w0: 19, w1: 18, width: narrowWidth, pts: [
      [D.residential.x - 300, D.residential.y + 80], [D.sanctuary.x + 200, D.sanctuary.y - 40],
      [D.sanctuary.x + 130, D.sanctuary.y + 90], [D.sanctuary.x, D.sanctuary.y + 80]] },
    // NATURE: Lake shoreline spur — branches off the Residential->Valorhall
    // lane and runs east to the Lake's calm SOUTH cove, stopping at the
    // water's edge. Reserved future home of the fishing spot / bench /
    // dock. Deliberately approaches from the town side: the north and west
    // shores stay roadless wilderness, which is what keeps the far side of
    // the lake feeling untouched.
    { kind: 'secondary', fam: 'nature', w0: 17, w1: 18, width: narrowWidth, pts: [
      [D.training.x + 165, D.training.y + 510], [D.lake.x - 400, D.lake.y + 305],
      [D.lake.x - 150, D.lake.y + 215], [D.lake.x - 135, D.lake.y + 188]] },
    // NATURE: Archive -> the river landing. A short lane from the end of the
    // Commercial->Archive road down to the dock on the west bank, so the
    // riverfront reads reached rather than conjured. Ends at the dock root.
    { kind: 'secondary', fam: 'nature', w0: 15, w1: 13, width: narrowWidth, pts: [
      [D.archive.x, D.archive.y + 195], [D.archive.x + 84, D.archive.y + 214],
      [D.archive.x + 146, D.archive.y + 168]] },
  ];
  scene.roadPlan = plan;
  scene.roads = plan.flatMap((p) => roadPath(p.pts, p.width));

  // Coarse tile-grid rasterisation, kept only for the vegetation/prop
  // avoidance checks that already depend on it (_nearAnyRoad uses the
  // rects; this Set is the cheap "is there road here" lookup). The visible
  // road surface is painted from the finer coverage map built below.
  scene.roadCells = new Set();
  for (const r of scene.roads) {
    const horizontal = r.w >= r.h;
    const across = Math.max(1, Math.round(Math.min(r.w, r.h) / ROAD_TILE));
    const cy = Math.floor((r.y + r.h / 2) / ROAD_TILE);
    const cx = Math.floor((r.x + r.w / 2) / ROAD_TILE);
    if (horizontal) {
      const c0 = Math.floor(r.x / ROAD_TILE), c1 = Math.floor((r.x + r.w) / ROAD_TILE);
      for (let c = c0; c <= c1; c++) for (let k = 0; k < across; k++) scene.roadCells.add(`${c},${cy + k}`);
    } else {
      const r0 = Math.floor(r.y / ROAD_TILE), r1 = Math.floor((r.y + r.h) / ROAD_TILE);
      for (let rr = r0; rr <= r1; rr++) for (let k = 0; k < across; k++) scene.roadCells.add(`${cx + k},${rr}`);
    }
  }

  buildRoadCoverage(scene, FC);

  // The river system: waterway geometry, water collision and the clearance
  // queries. After the road coverage (the bridge and the ford sit on the
  // painted roads) and before any dressing pass, so planting can test
  // scene.waterways and stay out of the channel.
  buildRiver(scene);

  // ----------------------------------------------------------- terrain --
  // wild/meadow zones: outer districts + gate approach only
  scene.wildZones = [
    { x: D.sanctuary.x, y: D.sanctuary.y, r: 230 },
    { x: D.training.x - 60, y: D.training.y, r: 210 },
    { x: D.gate.x, y: D.gate.y, r: 260 },
  ];

  // Market Square ground: one substantial open square southeast of the
  // plaza — bigger than a building lot, far smaller than a field. Stalls
  // sit on its rim (see drawMarket), the center stays open.
  scene.marketGround = { cx: D.market.x, cy: D.market.y, rx: 230, ry: 175 };
  // Forge + Potion + Guild + Archive courtyards: small stone aprons in front of the shops
  scene.courtyards = [
    { cx: forgeSpot.x, cy: forgeSpot.y, rx: 85, ry: 35 },
    { cx: potionSpot.x, cy: potionSpot.y, rx: 85, ry: 35 },
    { cx: D.guild.x, cy: D.guild.y + 72, rx: 90, ry: 38 },
    { cx: D.archive.x, cy: D.archive.y + 45, rx: 85, ry: 35 },
  ];
  // Keep road-tile texture out from under each courtyard oval — same reason
  // the plaza subtracts its own circle: without it, the approaching road's
  // full-width tiles show through/against the oval's edge as a hard seam.
  for (const key of [...scene.roadCells]) {
    const [c, r] = key.split(',').map(Number);
    const cx2 = c * ROAD_TILE + ROAD_TILE / 2, cy2 = r * ROAD_TILE + ROAD_TILE / 2;
    for (const ct of scene.courtyards) {
      const nx = (cx2 - ct.cx) / (ct.rx - 4), ny = (cy2 - ct.cy) / (ct.ry - 4);
      if (nx * nx + ny * ny < 1) { scene.roadCells.delete(key); break; }
    }
  }

  // Vegetation defines the space: dense perimeter forest (town carved out
  // of the woods), thick clusters between districts, all auto-avoiding
  // roads and reserved footprints.
  scene.trees = [];
  const cluster = (cx, cy, n, spread, kind) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash(cx + i) * 2;
      const r = spread * (0.4 + hash(cx * i + cy) * 0.6);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7;
      if (scene._nearAnyDistrict(x, y, 70) || scene._nearAnyRoad(x, y, 26)) continue;
      if (Math.hypot(x - FC.x, y - FC.y) < scene.plazaRadius + 40) continue;
      if (Math.hypot((x - scene.marketGround.cx) / 1.15, y - scene.marketGround.cy) < scene.marketGround.rx + 30) continue;
      scene.trees.push({ x, y, kind: (i % 3 === 0) ? 'pine' : kind });
    }
  };
  // between-district buffers (reference-style density)
  cluster(PZ.x - 190, PZ.y - 330, 7, 90, 'pine');      // plaza NW / guild N gap
  cluster(PZ.x + 330, PZ.y - 300, 8, 110, 'tree');     // plaza NE / archive S gap
  cluster(PZ.x - 360, PZ.y + 330, 7, 100, 'tree');     // residential N buffer
  cluster(PZ.x + 480, PZ.y + 260, 8, 110, 'tree');     // market E buffer
  cluster(PZ.x - 40, PZ.y + 520, 6, 90, 'pine');       // south road flanks
  cluster(D.guild.x - 220, D.guild.y + 130, 6, 90, 'pine');
  cluster(D.archive.x - 240, D.archive.y - 40, 6, 90, 'pine');
  cluster(D.archive.x + 160, D.archive.y + 120, 6, 80, 'tree');
  cluster(D.sanctuary.x + 220, D.sanctuary.y + 60, 7, 100, 'pine');
  cluster(D.sanctuary.x - 60, D.sanctuary.y + 220, 6, 90, 'tree');
  cluster(D.training.x + 220, D.training.y + 160, 6, 90, 'pine');
  cluster(D.training.x - 40, D.training.y + 260, 5, 80, 'tree');
  cluster(D.watch.x - 240, D.watch.y + 60, 7, 100, 'pine');
  cluster(D.watch.x + 260, D.watch.y - 60, 6, 90, 'pine');
  cluster(D.gate.x - 240, D.gate.y + 120, 7, 90, 'pine');
  cluster(D.gate.x + 240, D.gate.y + 120, 7, 90, 'pine');
  cluster(D.market.x + 60, D.market.y + 260, 6, 90, 'tree');
  cluster(D.residential.x - 80, D.residential.y + 320, 6, 90, 'pine');
  // dense multi-row perimeter forest
  for (let x = 20; x < MAP_W; x += 42) {
    for (let row = 0; row < 3; row++) {
      const yN = 30 + row * 34 + hash(x * (row + 1)) * 26;
      const yS = MAP_H - 26 - row * 34 - hash(x * (row + 2)) * 26;
      if (!scene._nearAnyDistrict(x, yN, 40) && !scene._nearAnyRoad(x, yN, 30)) scene.trees.push({ x: x + row * 12, y: yN, kind: 'pine' });
      if (!scene._nearAnyDistrict(x, yS, 40) && !scene._nearAnyRoad(x, yS, 30)) scene.trees.push({ x: x + row * 14, y: yS, kind: 'pine' });
    }
  }
  for (let y = 70; y < MAP_H - 50; y += 46) {
    for (let row = 0; row < 3; row++) {
      const xW = 24 + row * 34 + hash(y * (row + 1)) * 24;
      const xE = MAP_W - 24 - row * 34 - hash(y * (row + 2)) * 24;
      if (!scene._nearAnyDistrict(xW, y, 40) && !scene._nearAnyRoad(xW, y, 30)) scene.trees.push({ x: xW, y: y + row * 10, kind: 'pine' });
      if (!scene._nearAnyDistrict(xE, y, 40) && !scene._nearAnyRoad(xE, y, 30)) scene.trees.push({ x: xE, y: y + row * 12, kind: 'pine' });
    }
  }
  // Vegetation stripped for now (per direction) — plain grass only. The
  // generation above is left intact so trees/meadow can come back later;
  // this just empties what actually gets drawn.
  scene.trees = [];
  scene.wildZones = [];

  // still a geometry pass: no props/lamps/NPCs yet
  scene.propGroups = [];
  scene.lamps = [];
  scene.braziers = [];
  scene.crystalGlows = [];  // [x, y, hue, r] — Eldertree ground crystals
  scene.butterflies = [];   // see drawButterfly
  scene.npcs = [];
  scene.sanctuaryPets = [];
  scene.sanctuary = { x: D.sanctuary.x - 40, y: D.sanctuary.y - 20, w: 80, h: 40 };

  buildPlazaDecor(scene, FC);
  // The lake region is left undecorated. Trees, shrubs, waterside planting,
  // flowers, rocks and the destination compositions were each tried and each
  // taken back out; the lake reads better as water in open meadow. The pass
  // itself is kept intact below — restore it by calling it again.
  // buildLakeDecor(scene);
  buildLakeDetail(scene);
  buildAncientCity(scene);
  // Riverbank planting, riverside tree stands and the in-water stones.
  // After buildPlazaDecor — that pass RESETS scene.decor/groundDecor, so
  // anything pushed earlier would be wiped.
  buildRiverDecor(scene);
  // The bridge, the ford stones and the boulder-hop: parapet solids, corner
  // lamps, and the piers joining the wake-source list riverdecor just built.
  buildCrossings(scene);
  // The river's source: the scarp, the falls, the plunge pool's churn, the
  // crown pines and the cave mouth.
  buildWaterfall(scene);
  // The Archive landing: dock, boat, cargo, lantern.
  buildRiverfront(scene);

  // Step-24 development overview data (drawn only while window.__townDebug
  // is set from the console — never gameplay UI): big district tags, plus
  // the road centerlines above.
  scene.debugLabels = [
    ['CRYSTAL PLAZA', PZ.x, PZ.y - 190],
    ['FORGE', forgeSpot.x, forgeSpot.y - 150],
    ['POTION', potionSpot.x, potionSpot.y - 150],
    ['MARKET', D.market.x, D.market.y + 260],
    ['RESIDENTIAL', D.residential.x, D.residential.y + 330],
    ['GUILD', D.guild.x, D.guild.y - 120],
    ['TRAINING', D.training.x, D.training.y - 130],
    ['ARCHIVE', D.archive.x, D.archive.y - 100],
    ['ELDERTREE', D.eldertree.x, D.eldertree.y - 226],
    ['SANCTUARY', D.sanctuary.x, D.sanctuary.y + 130],
    ['WATCH', D.watch.x + 35, D.watch.y - 150],
    ['RUNEBOUND GATE', D.gate.x, D.gate.y - 130],
    ['LAKE', D.lake.x, D.lake.y - POND_H / 2 - 24],
  ];
}
