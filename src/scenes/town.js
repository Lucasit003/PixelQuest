// The town hub — a dense, walkable top-down map modelled on the concept art:
// a stone Crystal Plaza landmark at the centre, an interconnected cobblestone
// street network, and detailed districts (Library, Weapon Shop & Blacksmith,
// Training Grounds, Potion Shop, Pet Sanctuary, Market Square, Adventurer's
// Guild & Tavern, Residential Quarter with the Player House, a Quest Board and
// checkpoint on the Adventure Road, and the great Dungeon Gate). Buildings are
// framed by tree clusters, gardens, fences and prop groups so there is very
// little empty grass.
//
// The player walks in 8 directions; the camera follows within the map bounds.
// District names appear briefly on entry (no permanent floating labels), and an
// [E] prompt shows only at a building's entrance. Shops/inventory reuse the
// existing overlay controllers.

import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { drawText, textWidth } from '../gfx/font.js';
import { panel, bar, dialogue, UI, Toasts } from '../gfx/ui.js';
import { rect, rectOutline, disc, shadow, clamp, lerp, clamp01 } from '../gfx/pixel.js';
import { drawCharacter, drawActor, drawPet } from '../gfx/actors.js';
import { drawTree, drawPineTree, drawBush, drawRock, drawTorch, drawIcon, drawDummy } from '../gfx/props.js';
import { Particles } from '../gfx/particles.js';
import { WeaponShop, PotionShop, InventoryMenu } from './menus.js';
import { hash, rand2, fillEllipse, loadBuildingArt, contactShadow, drawPropArt } from './town/primitives.js';
import {
  COTTAGE_ART, COTTAGE_H, COTTAGE_W, DUNGEON_ART, DUNGEON_H, DUNGEON_W, HOUSE_H, HOUSE_W,
  SANCTUARY_ART, SANCTUARY_H, SANCTUARY_W, WATCH_ART, WATCH_H, WATCH_W,
  drawBlacksmith, drawLibrary, drawMarker, drawMarket, drawPlayerHouse, drawPotionShop,
  drawQuestBoard, drawSignpost, drawTavern, drawTrainingGround,
} from './town/buildings.js';
import { FOUNTAIN_H, FOUNTAIN_W, MOTE_COLORS, drawFountainSprite } from './town/fountain.js';
import {
  DECOR_SIZE, DECOR_ART,
  drawEldertree, drawButterfly, crystalGlow, lamp, brazier, fenceRun, bigTree,
} from './town/props.js';
import { drawGround, buildFlare } from './town/ground.js';
import { POND_W, POND_H, POND_WATER_RECTS } from './town/lake.js';
import { drawNight } from './town/lighting.js';
import { ROAD_TILE, GRASS_TILES, GRASS_TILE, PLAZA_TILES } from './town/tiles.js';
import { ROAD_CELL, buildRoadCoverage, drawRoads, roadPath, strokeRoundedPath } from './town/roads.js';

// Master Town Layout v5 (final spacing polish — coordinates LOCKED once
// approved): a landscape settlement around Crystal Plaza with a compressed
// adventure branch north to the Runebound Gate. Sized from walk times
// (player speed 100 units/s -> 100 units = 1 second): fountain->gate is
// ~2370 units (~24s), and the adventure route's remaining length is meant
// to read through environment (forest/ruins/fortifications later), not
// empty grass. Perimeter margins stay wilderness/expansion space.
const MAP_W = 3600;
const MAP_H = 4400;


// The two original road lamps that stood at the north and south approaches
// were removed: the square's lighting is now the matched twin-lantern pair in
// the formal ring, and a second, different lamp on two of the four approaches
// broke the symmetry that pair exists to establish.


// Town camera zoom: the world is drawn scaled up so the player sees roughly one
// district plus a little of its neighbours, and the character reads at a good
// size. Pure 2D — this only changes framing, not the pixel art.
const ZOOM = 1.6;

export class TownScene {
  constructor(hero, hooks) {
    this.hero = hero;
    this.hooks = hooks; // { toTraining, toDungeon, toHouse, toPotionShop, toWeaponShop }
  }

  enter(game) {
    this.game = game;
    this.W = game.width; this.H = game.height;
    this.t = 0;
    this.particles = new Particles();
    this.toasts = new Toasts();
    this.overlay = null;
    this.dialogue = null;
    this.dialogueReveal = 0;

    this.facing = 1; this.moving = false; this.walkT = 0;
    this.camX = 0; this.camY = 0;

    this.currentDistrict = null;
    this.districtBanner = null; this.districtBannerT = 0;
    this.introHintT = 4.5; // brief control hint, then it fades for good

    this._buildTown();
    // player starts just south of the plaza (the world origin)
    this.px = this.plazaCenter.x; this.py = this.plazaCenter.y + 60;
    this.near = null;
  }

  // ---- town definition ----------------------------------------------------

  _buildTown() {
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

    this.plazaCenter = PZ;
    // The fountain sprite is anchored at its base (PZ.y) and drawn upward, so
    // its true VISUAL center sits FOUNTAIN_H/2 above PZ.y — the plaza disc and
    // the four road exits are built around that point, not PZ.y itself, so
    // the fountain is actually centered on both axes rather than just close.
    const FC = { x: PZ.x, y: PZ.y - FOUNTAIN_H / 2 };
    this.plazaFocus = FC;
    // Plaza disc diameter as a multiple of the fountain's width, so the paving
    // always scales with the landmark rather than being a fixed pixel figure.
    // Tightened from 2.2x to 1.9x: with the roads widened, the old disc read
    // as a large empty apron around the fountain. The four road exits, both
    // lamps and the flares are all derived from this radius, so they follow it
    // inward automatically.
    this.plazaRadius = Math.round(FOUNTAIN_W * 1.9 / 2); // ~1.9x fountain diameter

    this.locations = [
      { id: 'plaza', name: 'Crystal Plaza', dx: PZ.x, dy: PZ.y + 18, action: 'rest', district: 'Crystal Plaza',
        draw: (g) => drawFountainSprite(g, PZ.x, PZ.y, this.t, this.plazaRadius), solid: { x: PZ.x - 26, y: PZ.y - 27, w: 52, h: 16 } },

      // ---- Weapon Smith + Potion Shop: standalone column below Training ----
      { id: 'weapon', name: 'Ironhearth Forge', dx: forgeSpot.x, dy: forgeSpot.y, action: 'weapon', district: 'Ironhearth Forge',
        draw: (g) => drawBlacksmith(g, forgeSpot.x, forgeSpot.y, this.t),
        solid: { x: forgeSpot.x - 56, y: forgeSpot.y - 68, w: 112, h: 68 } },
      { id: 'potion', name: 'Potion Shop', dx: potionSpot.x, dy: potionSpot.y, action: 'potion', district: 'Potion Shop',
        draw: (g) => drawPotionShop(g, potionSpot.x, potionSpot.y, this.t),
        solid: { x: potionSpot.x - 56, y: potionSpot.y - 80, w: 113, h: 80 } },

      // ---- Market Square: one shared open square, stalls on its edges ----
      { id: 'market', name: 'Market Square', dx: D.market.x, dy: D.market.y, action: 'market', district: 'Market Square', zone: true,
        draw: (g) => drawMarket(g, D.market.x, D.market.y, this.t), solid: null },

      // ---- Residential Quarter: neighborhood loop with 4 lots ----
      { id: 'home', name: 'Player House', dx: houseSpot.x, dy: houseSpot.y, action: 'house', district: 'Player House',
        draw: (g) => drawPlayerHouse(g, houseSpot.x, houseSpot.y, this.t),
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
        draw: (g) => drawTavern(g, D.guild.x, D.guild.y + 72, this.t),
        solid: { x: D.guild.x - 61, y: D.guild.y - 6, w: 122, h: 78 } },

      // ---- Runewood Archive: landscaped property ----
      { id: 'library', name: 'Runewood Archive', dx: D.archive.x, dy: D.archive.y + 45, action: 'library', district: 'Runewood Archive',
        draw: (g) => drawLibrary(g, D.archive.x, D.archive.y + 45, this.t),
        solid: { x: D.archive.x - 45, y: D.archive.y - 25, w: 90, h: 70 } },

      // ---- The Eldertree: grand crystal tree on its ruined dais ----
      // The dais is part of the art, so the sprite carries its own ground
      // (shadowRx 0, same as the compound buildings). Solid is the dais
      // ellipse's AABB; the interact point sits on the south steps.
      // Collision is three boxes stepping in toward the ellipse's tips
      // (the rest are appended to this.solids below), so the player can walk
      // right up to the stone beside the dais and never bumps into air.
      { id: 'eldertree', name: 'The Eldertree', dx: ET.x, dy: ET.y + 26, action: 'rest', label: 'Rest beneath the Eldertree', district: 'Eldertree Glade',
        sortY: ET.y - 2,
        draw: (g) => drawEldertree(g, ET.x, ET.y, this.t),
        solid: { x: ET.x - 82, y: ET.y - 46, w: 164, h: 32 } },

      // ---- Moonpaw Sanctuary: large green fenced property ----
      { id: 'pets', name: 'Moonpaw Sanctuary (reserved)', dx: D.sanctuary.x, dy: D.sanctuary.y + 55, action: 'pets', district: 'Moonpaw Sanctuary',
        draw: (g) => drawPropArt(g, SANCTUARY_ART, D.sanctuary.x, D.sanctuary.y + 55, SANCTUARY_W, SANCTUARY_H, 0),
        solid: { x: D.sanctuary.x - SANCTUARY_W / 2, y: D.sanctuary.y + 55 - SANCTUARY_H, w: SANCTUARY_W, h: SANCTUARY_H } },

      // ---- Valorhall: large dedicated compound ----
      { id: 'training', name: 'Valorhall Training Grounds', dx: D.training.x, dy: D.training.y, action: 'training', district: 'Valorhall Training Grounds', zone: true,
        draw: (g) => drawTrainingGround(g, D.training.x, D.training.y, this.t),
        solid: { x: D.training.x - 75, y: D.training.y - 60, w: 150, h: 24 } },

      // ---- Wayfarer's Watch: fortified checkpoint straddling the road ----
      // Compound art with baked courtyard ground: sortY sits at the base of
      // the gatehouse wall so the player renders on top of the art while
      // inside the courtyard, but behind the wall when north of it.
      // Collision is the two wall slabs + the keeper's cottage (appended to
      // this.solids below), leaving the central arch OPEN so the Adventure
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
        draw: (g) => drawQuestBoard(g, D.watch.x - 70, D.watch.y + 111, this.t, !!this.hero.activeQuest()),
        solid: { x: D.watch.x - 82, y: D.watch.y + 95, w: 24, h: 16 } },
    ];

    this.districts = D;
    this.solids = this.locations.filter((l) => l.solid).map((l) => l.solid);
    this.solids.push({ x: ET.x - 54, y: ET.y - 14, w: 108, h: 12 },   // dais front steps
                     { x: ET.x - 54, y: ET.y - 58, w: 108, h: 12 });  // dais back
    // Wayfarer's Watch collision (measured off the art's own proportions):
    // wall slabs flanking the open central arch, plus the keeper's cottage.
    {
      const wx = D.watch.x + 35, wTop = D.watch.y + 30 - WATCH_H;
      this.solids.push(
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
    this.lakeTopLeft = { x: D.lake.x - POND_W / 2, y: D.lake.y - POND_H / 2 };
    for (const [fx, fy, fw, fh] of POND_WATER_RECTS) {
      const x = this.lakeTopLeft.x + fx * POND_W, y = this.lakeTopLeft.y + fy * POND_H;
      this.solids.push({ x, y, w: fw * POND_W, h: fh * POND_H });
    }

    // district entry-banner regions (Player House folded into Residential —
    // the house is a member of the neighborhood now, not its own district)
    this.regions = [
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
    // waypoint polylines live in this.roadPlan (dev overview + future
    // passes); this.roads/roadCells are still rasterised so tree/prop
    // placement keeps avoiding the planned streets.
    const mainWidth = 42, resWidth = 26, narrowWidth = 16, advWidth = 38; // main matches flareFarW below exactly

    // Crystal Plaza is a true 4-way intersection: exactly one road meets it
    // per cardinal direction (N/E/S/W), all the same width, all starting at
    // the same distance (the plaza radius) from the fountain's visual center
    // FC — never from the center itself, so nothing ever overlaps the
    // fountain's collision box.
    const exitN = [FC.x, FC.y - this.plazaRadius];
    const exitS = [FC.x, FC.y + this.plazaRadius];
    const exitE = [FC.x + this.plazaRadius, FC.y];
    const exitW = [FC.x - this.plazaRadius, FC.y];
    const R = this.plazaRadius;
    // Flare trapezoids: short (~1-2 player lengths) transition at each exit,
    // tapering from a widened mouth down to the plaza's own jittered circle
    // boundary — see buildFlare(). Locked to explicit values (not derived
    // from mainWidth) so plaza-connection geometry never drifts if the
    // regular road width elsewhere changes.
    // Near width is generously wider than the road it feeds so the funnel
    // overlaps the circle well past the outward wobble above, leaving no
    // sliver at the join; far width matches the main road exactly.
    const flareNearW = 62, flareFarW = 42, flareDepth = 34;
    this.plazaFlares = [
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
      // The glade is entered from the SOUTH (see _buildEldertreeGrove for
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
    ];
    this.roadPlan = plan;
    this.roads = plan.flatMap((p) => roadPath(p.pts, p.width));

    // Coarse tile-grid rasterisation, kept only for the vegetation/prop
    // avoidance checks that already depend on it (_nearAnyRoad uses the
    // rects; this Set is the cheap "is there road here" lookup). The visible
    // road surface is painted from the finer coverage map built below.
    this.roadCells = new Set();
    for (const r of this.roads) {
      const horizontal = r.w >= r.h;
      const across = Math.max(1, Math.round(Math.min(r.w, r.h) / ROAD_TILE));
      const cy = Math.floor((r.y + r.h / 2) / ROAD_TILE);
      const cx = Math.floor((r.x + r.w / 2) / ROAD_TILE);
      if (horizontal) {
        const c0 = Math.floor(r.x / ROAD_TILE), c1 = Math.floor((r.x + r.w) / ROAD_TILE);
        for (let c = c0; c <= c1; c++) for (let k = 0; k < across; k++) this.roadCells.add(`${c},${cy + k}`);
      } else {
        const r0 = Math.floor(r.y / ROAD_TILE), r1 = Math.floor((r.y + r.h) / ROAD_TILE);
        for (let rr = r0; rr <= r1; rr++) for (let k = 0; k < across; k++) this.roadCells.add(`${cx + k},${rr}`);
      }
    }

    buildRoadCoverage(this, FC);

    // ----------------------------------------------------------- terrain --
    // wild/meadow zones: outer districts + gate approach only
    this.wildZones = [
      { x: D.sanctuary.x, y: D.sanctuary.y, r: 230 },
      { x: D.training.x - 60, y: D.training.y, r: 210 },
      { x: D.gate.x, y: D.gate.y, r: 260 },
    ];

    // Market Square ground: one substantial open square southeast of the
    // plaza — bigger than a building lot, far smaller than a field. Stalls
    // sit on its rim (see drawMarket), the center stays open.
    this.marketGround = { cx: D.market.x, cy: D.market.y, rx: 230, ry: 175 };
    // Forge + Potion + Guild + Archive courtyards: small stone aprons in front of the shops
    this.courtyards = [
      { cx: forgeSpot.x, cy: forgeSpot.y, rx: 85, ry: 35 },
      { cx: potionSpot.x, cy: potionSpot.y, rx: 85, ry: 35 },
      { cx: D.guild.x, cy: D.guild.y + 72, rx: 90, ry: 38 },
      { cx: D.archive.x, cy: D.archive.y + 45, rx: 85, ry: 35 },
    ];
    // Keep road-tile texture out from under each courtyard oval — same reason
    // the plaza subtracts its own circle: without it, the approaching road's
    // full-width tiles show through/against the oval's edge as a hard seam.
    for (const key of [...this.roadCells]) {
      const [c, r] = key.split(',').map(Number);
      const cx2 = c * ROAD_TILE + ROAD_TILE / 2, cy2 = r * ROAD_TILE + ROAD_TILE / 2;
      for (const ct of this.courtyards) {
        const nx = (cx2 - ct.cx) / (ct.rx - 4), ny = (cy2 - ct.cy) / (ct.ry - 4);
        if (nx * nx + ny * ny < 1) { this.roadCells.delete(key); break; }
      }
    }

    // Vegetation defines the space: dense perimeter forest (town carved out
    // of the woods), thick clusters between districts, all auto-avoiding
    // roads and reserved footprints.
    this.trees = [];
    const cluster = (cx, cy, n, spread, kind) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(cx + i) * 2;
        const r = spread * (0.4 + hash(cx * i + cy) * 0.6);
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.7;
        if (this._nearAnyDistrict(x, y, 70) || this._nearAnyRoad(x, y, 26)) continue;
        if (Math.hypot(x - FC.x, y - FC.y) < this.plazaRadius + 40) continue;
        if (Math.hypot((x - this.marketGround.cx) / 1.15, y - this.marketGround.cy) < this.marketGround.rx + 30) continue;
        this.trees.push({ x, y, kind: (i % 3 === 0) ? 'pine' : kind });
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
        if (!this._nearAnyDistrict(x, yN, 40) && !this._nearAnyRoad(x, yN, 30)) this.trees.push({ x: x + row * 12, y: yN, kind: 'pine' });
        if (!this._nearAnyDistrict(x, yS, 40) && !this._nearAnyRoad(x, yS, 30)) this.trees.push({ x: x + row * 14, y: yS, kind: 'pine' });
      }
    }
    for (let y = 70; y < MAP_H - 50; y += 46) {
      for (let row = 0; row < 3; row++) {
        const xW = 24 + row * 34 + hash(y * (row + 1)) * 24;
        const xE = MAP_W - 24 - row * 34 - hash(y * (row + 2)) * 24;
        if (!this._nearAnyDistrict(xW, y, 40) && !this._nearAnyRoad(xW, y, 30)) this.trees.push({ x: xW, y: y + row * 10, kind: 'pine' });
        if (!this._nearAnyDistrict(xE, y, 40) && !this._nearAnyRoad(xE, y, 30)) this.trees.push({ x: xE, y: y + row * 12, kind: 'pine' });
      }
    }
    // Vegetation stripped for now (per direction) — plain grass only. The
    // generation above is left intact so trees/meadow can come back later;
    // this just empties what actually gets drawn.
    this.trees = [];
    this.wildZones = [];

    // still a geometry pass: no props/lamps/NPCs yet
    this.propGroups = [];
    this.lamps = [];
    this.braziers = [];
    this.crystalGlows = [];  // [x, y, hue, r] — Eldertree ground crystals
    this.butterflies = [];   // see drawButterfly
    this.npcs = [];
    this.sanctuaryPets = [];
    this.sanctuary = { x: D.sanctuary.x - 40, y: D.sanctuary.y - 20, w: 80, h: 40 };

    this._buildPlazaDecor(FC);
    // The lake region is left undecorated. Trees, shrubs, waterside planting,
    // flowers, rocks and the destination compositions were each tried and each
    // taken back out; the lake reads better as water in open meadow. The pass
    // itself is kept intact below — restore it by calling it again.
    // this._buildLakeDecor();
    this._buildLakeDetail();
    this._buildEldertreeGrove();

    // Step-24 development overview data (drawn only while window.__townDebug
    // is set from the console — never gameplay UI): big district tags, plus
    // the road centerlines above.
    this.debugLabels = [
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

  // ---- The Ancient Crystal Village ---------------------------------------
  // The remains of a settlement built around a sacred Crystal Tree (the HEART
  // TREE) and slowly reclaimed by nature. This is composed like architecture,
  // not like a garden: every wall implies a building, every column belongs to
  // a structure, every statue guards something, every street leads somewhere.
  // The player should read FOOTPRINTS — "a house stood here", "this was the
  // square", "a street ran through" — not scattered decoration.
  //
  // It is built in layers (see the three _acg* stages): ARCHITECTURE first
  // (walls/columns/streets/shrine/pond — must read as a village with all
  // vegetation stripped), then TREES reclaiming it, then FLOWERS/ROCKS/
  // CRYSTALS as detail. Axis is NORTH-SOUTH, entered from the south: the tree
  // is a 200-tall bottom-anchored sprite only seen from the front, so the
  // square, street and gate all run south of it. Canopy rule: nothing meant
  // to be SEEN sits in x +/-88 north of the tree base (y<0).
  //
  // Layout (offsets from the tree base X,Y; +y is SOUTH):
  //        NW residence            NE scholar's house
  //                 \\   HEART TREE   /
  //                     village square
  //   pond house --- main street --- shrine courtyard
  //            SW ruin    market/gathering
  //                     ancient gate
  //                     (road to town)
  _buildEldertreeGrove() {
    const ET = this.districts.eldertree;
    const put = (name, x, y, opts = {}) => {
      const [w, h] = DECOR_SIZE[name];
      this.decor.push({ name, x, y, w, h, flip: !!opts.flip,
                        sortY: opts.sortY != null ? opts.sortY : y,
                        shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
      if (opts.solid) {
        const [sw, sh] = opts.solid;
        this.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
      }
    };
    const flat = (name, x, y, flip = false) => {
      const [w, h] = DECOR_SIZE[name];
      this.groundDecor.push({ name, x, y, w, h, flip });
    };
    const glow = (x, y, hue, r) => this.crystalGlows.push([x, y, hue, r]);
    const X = ET.x, Y = ET.y;
    // Full compact-city build re-enabled (2026-08-22) — all four stages.
    this._acgArchitecture(put, flat, X, Y);
    this._acgTrees(put, flat, X, Y);
    this._acgUnderstory(put, flat, X, Y);
    this._acgDetail(put, flat, glow, X, Y);
  }

  // ===== PASS 1: ARCHITECTURE — reference-matched compact city ===========
  // Rectangular WALLED building footprints (horizontal + rotated vertical wall
  // pieces) packed tight around the Heart Tree, arches straddling the streets,
  // north & south gates, pool and shrine in walled courtyards, outer wall
  // fragments. Layout stored on this._acgL for the vegetation stages.
  _acgArchitecture(put, flat, X, Y) {
    const colSolid = [8, 6];
    const WH = ['myst_wall_long', 'myst_wall_gap', 'myst_wall_vine', 'myst_wall_steps'];             // E-W walls
    const WV = ['myst_wall_long_ns', 'myst_wall_gap_ns', 'myst_wall_vine_ns', 'myst_wall_steps_ns']; // N-S walls
    const COLV = ['myst_col_a', 'myst_col_b', 'myst_col_tall', 'myst_col_cracked', 'myst_col_broken'];
    const RUB = ['myst_rubble_a', 'myst_rubble_b', 'myst_rubble_c', 'myst_stone_one', 'myst_stone_pair'];
    const floor = (cx, cy, cols, rows, skip = 0.25) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (hash(cx * 3.1 + cy * 1.7 + r * 7.3 + c * 13.1) < skip) continue;
        flat('myst_path_straight_ew', Math.round(cx + (c - (cols - 1) / 2) * 32), Math.round(cy + (r - (rows - 1) / 2) * 15));
      }
    };
    const rubbleAt = (cx, cy, n = 3, rad = 18, seed = 1) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.3) * 6.283, d = Math.sqrt(hash(seed + i * 2.6)) * rad;
        put(RUB[Math.floor(hash(seed + i * 3.9) * RUB.length) % RUB.length], Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6), { shadow: 0 });
      }
    };
    // E-W wall run (centres from x0..x1 at cy), with an optional doorway gap and ~16% collapse.
    const wallRunH = (x0, x1, cy, gapC, gapW, seed) => {
      for (let cx = x0, i = 0; cx <= x1 + 1; cx += 34, i++) {
        if (gapW && Math.abs(cx - gapC) < gapW / 2) continue;
        if (hash(seed + i * 3.1) < 0.16) continue;
        put(WH[(i + seed) % WH.length], Math.round(cx), Math.round(cy), { solid: [30, 6] });
      }
    };
    // N-S wall run (centres from y0..y1 at cx); vertical pieces are 40 tall, bottom-anchored (+20).
    const wallRunV = (cx, y0, y1, gapC, gapH, seed) => {
      for (let cy = y0, i = 0; cy <= y1 + 1; cy += 34, i++) {
        if (gapH && Math.abs(cy - gapC) < gapH / 2) continue;
        if (hash(seed + i * 3.7) < 0.16) continue;
        put(WV[(i + seed) % WV.length], Math.round(cx), Math.round(cy + 20), { solid: [12, 32] });
      }
    };
    // A rectangular ruined building: floor + four walled edges with a doorway
    // on the street side + corner columns + rubble. face = doorway direction.
    const building = (a) => {
      const { x, y, w, h } = a, face = a.face || 'S', seed = (x * 0.7 + y) | 0;
      const hw = Math.round(w / 2), hh = Math.round(h / 2);
      floor(x, y, Math.max(2, Math.round(w / 30)), Math.max(2, Math.round(h / 28)), a.floorSkip != null ? a.floorSkip : 0.28);
      if (!a.omitN) wallRunH(x - hw, x + hw, y - hh, face === 'N' ? x : 0, face === 'N' ? 26 : 0, seed + 1);
      if (!a.omitS) wallRunH(x - hw, x + hw, y + hh, face === 'S' ? x : 0, face === 'S' ? 26 : 0, seed + 2);
      if (!a.omitW) wallRunV(x - hw, y - hh, y + hh, face === 'W' ? y : 0, face === 'W' ? 32 : 0, seed + 3);
      if (!a.omitE) wallRunV(x + hw, y - hh, y + hh, face === 'E' ? y : 0, face === 'E' ? 32 : 0, seed + 4);
      for (const [cxx, cyy] of [[x - hw, y - hh], [x + hw, y - hh], [x - hw, y + hh], [x + hw, y + hh]])
        if (hash(cxx * 1.1 + cyy) < 0.72) put(COLV[Math.abs((cxx + cyy) | 0) % COLV.length], Math.round(cxx), Math.round(cyy + 4), { solid: colSolid });
      rubbleAt(x, y, 3, Math.min(w, h) * 0.32, seed + 9);
      if (a.stat) put(a.stat, x, y - 2, { solid: colSolid });
    };
    // An arch straddling a passage (feet solid, centre opening walkable).
    const archway = (name, ax, ay) => {
      put(name, ax, ay, { shadow: 0 });
      this.solids.push({ x: ax - 16, y: ay - 10, w: 8, h: 10 }, { x: ax + 8, y: ay - 10, w: 8, h: 10 });
    };
    const streetNS = (cx, y0, y1, lanes, skip = 0.2) => {
      for (let y = y0, i = 0; y <= y1; y += 30, i++) { if (hash(cx * 1.9 + y + i * 4.7) < skip) continue;
        for (let L = 0; L < lanes; L++) flat('myst_path_straight', Math.round(cx + (L - (lanes - 1) / 2) * 17), Math.round(y)); } };
    const streetEW = (x0, x1, cy, skip = 0.22) => {
      for (let x = x0, i = 0; x <= x1; x += 34, i++) { if (hash(x + cy * 2.3 + i * 5.1) < skip) continue;
        flat('myst_path_straight_ew', Math.round(x), Math.round(cy)); } };

    // ---------- STREETS ----------------------------------------------------

    // ---------- BUILDING BLOCKS (rectangular walled footprints) -----------
    const B = [
      { x: X - 175, y: Y - 155, w: 112, h: 86, face: 'S', d: 'north', stat: 'myst_statue_glow' },
      { x: X + 175, y: Y - 155, w: 112, h: 86, face: 'S', d: 'north' },
      { x: X, y: Y - 250, w: 104, h: 64, face: 'S', d: 'north' },
      { x: X - 252, y: Y - 52, w: 92, h: 74, face: 'E', d: 'west' },
      { x: X - 150, y: Y - 60, w: 78, h: 62, face: 'S', d: 'west' },
      { x: X - 256, y: Y + 122, w: 92, h: 74, face: 'E', d: 'west' },
      { x: X + 252, y: Y - 52, w: 92, h: 74, face: 'W', d: 'east' },
      { x: X + 150, y: Y - 60, w: 78, h: 62, face: 'S', d: 'east' },
      { x: X - 112, y: Y + 150, w: 80, h: 58, face: 'S', d: 'south' },
      { x: X + 112, y: Y + 150, w: 80, h: 58, face: 'S', d: 'south' },
      { x: X - 122, y: Y + 250, w: 78, h: 58, face: 'N', d: 'south' },
      { x: X + 122, y: Y + 250, w: 78, h: 58, face: 'N', d: 'south' },
      { x: X - 82, y: Y + 312, w: 70, h: 54, face: 'N', d: 'south', floorSkip: 0.4 },
      { x: X + 82, y: Y + 312, w: 70, h: 54, face: 'N', d: 'south', floorSkip: 0.4 },
    ];
    for (const a of B) building(a);

    // ---------- POOL COURTYARD (SW) — walled civic garden around the pool ---
    const pcx = X - 250, pcy = Y + 218;
    building({ x: pcx, y: pcy, w: 116, h: 84, face: 'N', floorSkip: 0.55, omitN: true });  // 3-sided court, open north
    put('myst_pond', pcx, pcy + 6, { shadow: 0, solid: [88, 26] });
    put('myst_bench_a', pcx, pcy + 34, { flip: true });
    put('myst_statue_crystal', pcx - 40, pcy - 18, { solid: colSolid });
    archway('myst_arch_narrow', pcx, pcy - 44);

    // ---------- SHRINE COURTYARD (E) — rectangular temple court ------------
    const scx = X + 252, scy = Y + 140;
    building({ x: scx, y: scy, w: 128, h: 100, face: 'W', floorSkip: 0.42, omitW: true });
    put('myst_gazebo', scx, scy, { solid: [30, 12] });
    put('myst_shrine_niche', scx + 34, scy - 26, { solid: [10, 6] });
    put('myst_ped_crystal_lit', scx, scy - 22, { solid: [10, 7] });
    put('myst_statue_maiden', scx - 40, scy + 30, { solid: colSolid });
    put('myst_statue_knight', scx + 44, scy + 30, { solid: colSolid, flip: true });
    put('myst_bench_b', scx, scy + 40);
    archway('myst_arch_b', scx - 70, scy);   // west entrance to the court

    // ---------- HEART-TREE PROCESSIONAL (south of the square) --------------
    put('myst_statue_maiden', X - 44, Y + 92, { solid: colSolid });
    put('myst_statue_crystal', X + 44, Y + 96, { solid: colSolid });
    put('myst_col_tall', X - 26, Y + 122, { solid: colSolid });
    put('myst_col_broken', X + 26, Y + 126, { solid: colSolid });

    // scholar relic in a north compound
    put('myst_ped_book', X - 175, Y - 150, { solid: [10, 7] });
    put('myst_ped_leaf', X - 150, Y - 146, { solid: [10, 7] });

    // ---------- ARCHES ON THE STREETS (gates + district entrances) ---------
    // NORTH GATE
    archway('myst_arch_vine', X, Y - 250);
    put('myst_col_tall', X - 40, Y - 250, { solid: colSolid }); put('myst_col_tall', X + 40, Y - 250, { solid: colSolid });
    put('myst_statue_knight', X - 60, Y - 244, { solid: colSolid }); put('myst_statue_maiden', X + 60, Y - 244, { solid: colSolid });
    // SOUTH GATE (more destroyed)
    archway('myst_arch_ruin', X, Y + 350);
    put('myst_col_broken', X - 34, Y + 350, { solid: colSolid }); put('myst_col_lean', X + 36, Y + 352, { solid: colSolid });
    put('myst_statue_knight', X - 58, Y + 356, { solid: colSolid }); put('myst_statue_maiden', X + 58, Y + 356, { solid: colSolid });
    rubbleAt(X - 64, Y + 338, 4, 24, 41); rubbleAt(X + 66, Y + 340, 4, 24, 47);
    // cross-street district gates + main-street mid arches
    archway('myst_arch_a', X - 118, Y + 40);     // west residential gate
    archway('myst_arch_narrow', X + 118, Y + 40); // east temple gate
    archway('myst_arch_a', X, Y + 116);          // square -> market
    archway('myst_arch_b', X, Y + 288);          // market -> south gate

    // ---------- OUTER CITY-WALL FRAGMENTS (partial, big gaps) -------------
    wallRunH(X - 360, X - 250, Y - 210, 0, 0, 3);   // NW
    wallRunH(X + 250, X + 360, Y - 210, 0, 0, 9);   // NE
    wallRunV(X - 366, Y + 20, Y + 150, 0, 0, 15);   // W
    wallRunV(X + 366, Y + 20, Y + 150, 0, 0, 19);   // E
    wallRunH(X - 320, X - 210, Y + 330, 0, 0, 23);  // SW
    wallRunH(X + 210, X + 320, Y + 320, 0, 0, 27);  // SE

    this._acgL = {
      houses: B.concat([{ x: pcx, y: pcy, d: 'west' }, { x: scx, y: scy, d: 'temple' }]),
      market: { x: X, y: Y + 190, w: 150, h: 80 }, temple: { x: scx, y: scy, w: 128, h: 100 },
      gate: { x: X, y: Y + 350 }, crossY: Y + 40, mainX: X, pool: { x: pcx, y: pcy },
    };
  }

  // ===== PASS 2: TREES — forest framing + reclaiming the blocks =========
  // The perimeter forest rings the city OUTSIDE its wall-line; inside, trees
  // grow through selected footprints and in the gaps between blocks, reclaiming
  // the architecture without hiding the streets. Ordinary oaks make the forest;
  // crystal-rooted mystic trees mark the magical zones.
  _acgTrees(put, flat, X, Y) {
    const treeSolid = [12, 8];
    const OAK = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted', 'tree_flowerbed'];
    const MED = ['tree_blossom_white', 'tree_blossom_blue', 'tree_young', 'tree_small_pine'];
    const SMALL = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const MYST = ['myst_tree_round', 'myst_tree_roots'];
    const mass = (cx, cy, n, rad, pool, seed, debris = true) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.7) * 6.283, d = Math.sqrt(hash(seed + i * 2.3 + 0.5)) * rad;
        const name = pool[Math.floor(hash(seed + i * 3.1 + 0.2) * pool.length) % pool.length];
        put(name, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.66), { shadow: 0, solid: treeSolid });
      }
      if (debris) {
        put(hash(seed + 9.1) < 0.5 ? 'tree_stump_01' : 'tree_stump_02', Math.round(cx + (hash(seed + 5.5) - 0.5) * rad), Math.round(cy + rad * 0.4));
        put(hash(seed + 7.3) < 0.5 ? 'fallen_log_01' : 'log_long', Math.round(cx - (hash(seed + 6.1) - 0.5) * rad), Math.round(cy + rad * 0.5), { shadow: 0 });
      }
    };
    // ---- perimeter forest ringing the city (outside the wall fragments),
    // with the southern gate funnel left open and gaps off the Heart Tree crown.
    for (const [cx, cy, n, r, sd] of [
      [X - 150, Y - 360, 6, 66, 11], [X + 180, Y - 356, 6, 66, 21],   // north, behind the crown
      [X - 500, Y - 150, 6, 64, 33], [X - 520, Y + 90, 6, 66, 45],    // west
      [X - 440, Y + 340, 6, 64, 52],                                  // SW
      [X + 520, Y + 60, 6, 64, 64], [X + 470, Y - 150, 5, 60, 71],    // east
      [X + 452, Y + 320, 6, 64, 83],                                  // SE
      [X - 250, Y + 440, 5, 58, 91], [X + 260, Y + 440, 5, 58, 97],   // gate funnel
    ]) mass(cx, cy, n, r, OAK, sd);

    // ---- reclaim the blocks: a tree through ~half the footprints, and one in
    // the gap beside each, keyed to the stored layout so it lands on real ruins.
    const H = (this._acgL && this._acgL.houses) || [];
    H.forEach((a, i) => {
      const pool = a.d === 'north' || a.d === 'temple' ? MYST : (a.big ? MED : SMALL);
      if (i % 2 === 0) {  // grows THROUGH the building
        put(pool[i % pool.length], Math.round(a.x - a.w * 0.18), Math.round(a.y - a.h * 0.1),
            { shadow: 0, solid: a.big ? treeSolid : [8, 6] });
      }
      if (i % 3 === 0) {  // in the gap beside the block
        put(SMALL[i % SMALL.length], Math.round(a.x + a.w * 0.62), Math.round(a.y + a.h * 0.3), { shadow: 0, solid: [8, 6] });
      }
    });

    // ---- NE-outer crystal grove (subordinate to the Heart Tree) ----
    mass(X + 300, Y - 66, 4, 42, MYST, 151, false);
    put('tree_blossom_blue', X + 262, Y - 46, { shadow: 0, solid: [8, 6] });
    put('tree_blossom_violet', X + 336, Y - 44, { shadow: 0, solid: [8, 6] });

    // ---- southern outskirts thinning into ordinary land toward the road ----
    put('tree_oak_round', X - 150, Y + 500, { shadow: 0, solid: treeSolid });
    put('tree_young', X + 130, Y + 510, { shadow: 0, solid: [8, 6] });
    put('tree_small_pine', X - 30, Y + 520, { shadow: 0, solid: [8, 6] });
  }

  // ===== PASS 2b: UNDERSTORY — bushes, grass, ferns; reveal the streets ==
  // Fills the forest floor and the gaps BETWEEN buildings, and washes the lawn
  // into meadow — but the street network and squares are protected so the city
  // stays readable. Everything here is walk-through (no collision).
  _acgUnderstory(put, flat, X, Y) {
    const BUSH = ['bush_big', 'bush_low', 'bush_01', 'bush_02', 'bush_03', 'myst_bush_meadow', 'myst_bush_white'];
    const GRASS = ['grass_lg_01','grass_lg_02','grass_lg_03','grass_lg_04','grass_lg_05','grass_lg_06','grass_lg_07','grass_lg_08','grass_lg_09'];
    const DARK = ['grass_dark_01','grass_dark_02','grass_dark_03','grass_dark_04','grass_dark_05','grass_dark_06'];
    const FERN = ['fern_clump','fernbank_01','fernbank_02','fernbank_03'];
    const scatter = (cx, cy, count, rad, pools, seed) => {
      for (let i = 0; i < count; i++) {
        const a = hash(seed + i * 1.9) * 6.283, d = Math.sqrt(hash(seed + i * 2.7 + 0.3)) * rad;
        const pool = pools[Math.floor(hash(seed + i * 3.3 + 0.1) * pools.length) % pools.length];
        put(pool[Math.floor(hash(seed + i * 4.1 + 0.6) * pool.length) % pool.length],
            Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6));
      }
    };
    // understory beneath the perimeter forest (same centres as the trees)
    for (const [cx, cy, sd] of [
      [X - 150, Y - 360, 201], [X + 180, Y - 356, 214], [X - 500, Y - 150, 233],
      [X - 520, Y + 90, 246], [X - 440, Y + 340, 252], [X + 520, Y + 60, 268],
      [X + 470, Y - 150, 271], [X + 452, Y + 320, 283], [X - 250, Y + 440, 291], [X + 260, Y + 440, 296],
    ]) scatter(cx, cy, 12, 70, [BUSH, GRASS, FERN], sd);

    // between-building overgrowth: a clump at each footprint's edge (alley side)
    const H = (this._acgL && this._acgL.houses) || [];
    H.forEach((a, i) => scatter(Math.round(a.x + a.w * 0.55), Math.round(a.y + a.h * 0.15), 6, 34, [BUSH, GRASS, GRASS], 320 + i * 9));

    // crystal-altered blue grass in the magical zones
    scatter(X - 96, Y + 24, 5, 46, [DARK], 401); scatter(X + 96, Y + 28, 5, 46, [DARK], 407);
    scatter(X + 256, Y + 94, 6, 52, [DARK, GRASS], 413);      // temple
    scatter(X + 300, Y - 66, 10, 70, [DARK, DARK, GRASS], 419); // crystal grove
    scatter(X - 240, Y + 156, 4, 40, [DARK, GRASS], 427);     // pond

    // ---- MEADOW WASH (§22/§26): overgrown-meadow the remaining lawn, but
    // PROTECT the streets/squares so the urban geometry stays legible.
    const L = this._acgL || {};
    const inRect = (x, y, r, pad) => r && x > r.x - r.w / 2 - pad && x < r.x + r.w / 2 + pad && y > r.y - r.h / 2 - pad && y < r.y + r.h / 2 + pad;
    const clearing = (x, y) => (
      (Math.abs(x - X) < 32 && y > Y - 320 && y < Y + 360) ||   // main avenue
      (Math.abs(y - (Y + 74)) < 22 && x > X - 210 && x < X + 200) || // cross street
      (Math.hypot(x - X, y - (Y + 30)) < 70) ||                 // civic square
      inRect(x, y, L.market, 8) || inRect(x, y, L.temple, 6)    // market + temple court
    );
    const SMALL = ['grass_tiny_01','grass_tiny_02','grass_tiny_03','grass_tiny_04','grass_tiny_05','grass_tiny_06',
                   'grass_sm_01','grass_sm_02','grass_sm_03','grass_sm_04','grass_sm_05','grass_sm_06',
                   'grass_lean_01','grass_lean_02','grass_lean_03','grass_lean_04'];
    const STRIP = ['grass_strip_01','grass_strip_02','grass_strip_03','grass_strip_04','grass_strip_05','grass_strip_06'];
    for (let gy = Y - 300; gy <= Y + 420; gy += 40) {
      for (let gx = X - 420; gx <= X + 420; gx += 42) {
        if (hash(gx * 1.7 + gy * 2.3) > 0.7) continue;
        const jx = Math.round(gx + (hash(gx * 3.1 + gy) - 0.5) * 34);
        const jy = Math.round(gy + (hash(gx + gy * 3.7) - 0.5) * 30);
        if (clearing(jx, jy)) continue;
        put(SMALL[Math.floor(hash(gx * 5.3 + gy * 7.1) * SMALL.length) % SMALL.length], jx, jy);
      }
    }
    // low grass creeping in along the street/paving edges (§22 deterioration)
    for (const [cx, cy, sd] of [
      [X - 34, Y + 150, 701], [X + 34, Y + 210, 707], [X - 34, Y + 264, 713],
      [X - 210, Y + 74, 719], [X + 190, Y + 82, 725], [X + 34, Y - 200, 731],
    ]) scatter(cx, cy, 3, 22, [STRIP], sd);
  }

  // ===== PASS 3: FLOWERS, CRYSTALS, ROCKS, RUBBLE (compact anchors) =====
  _acgDetail(put, flat, glow, X, Y) {
    const bloom = (cx, cy, n, rad, seed) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 2.1) * 6.283, d = Math.sqrt(hash(seed + i * 2.9 + 0.4)) * rad;
        flat('myst_flower_spray', Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6), hash(seed + i * 4.3) < 0.5);
      }
    };
    const ROCK = ['myst_rock_a','myst_rock_b','myst_rock_c','myst_rock_d','myst_rock_e','rock_small_01','rock_med_01'];
    const rocks = (cx, cy, n, rad, seed) => {
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 1.6) * 6.283, d = Math.sqrt(hash(seed + i * 2.2)) * rad;
        put(ROCK[Math.floor(hash(seed + i * 3.4) * ROCK.length) % ROCK.length], Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.6));
      }
    };
    // crystal night trail: tree -> temple -> grove -> pond -> gate
    glow(X - 88, Y + 20, 'v', 13); put('myst_crystals_purple', X - 88, Y + 32, { solid: [12, 8] });
    glow(X + 88, Y + 26, 'c', 13); put('myst_crystals_cyan', X + 88, Y + 38, { solid: [12, 8] });
    put('myst_crystals_mini', X - 110, Y + 8); put('myst_crystal_spike', X + 112, Y + 12);
    glow(X + 256, Y + 78, 'c', 9);
    glow(X + 216, Y + 116, 'v', 11); put('myst_crystals_purple', X + 216, Y + 128, { solid: [12, 8] });
    glow(X + 298, Y + 120, 'c', 11); put('myst_crystals_cyan', X + 298, Y + 132, { solid: [12, 8] });
    glow(X + 300, Y - 56, 'c', 10); put('myst_crystals_purple', X + 274, Y - 48, { solid: [12, 8] });
    put('myst_crystals_cyan', X + 328, Y - 44, { solid: [12, 8] }); put('myst_crystals_mini', X + 302, Y - 32);
    glow(X - 240, Y + 138, 'c', 9); put('myst_crystals_cyan', X - 240, Y + 150, { solid: [12, 8] });
    glow(X + 4, Y + 322, 'v', 8); put('myst_crystals_mini', X + 4, Y + 328);

    // large flower masses at the districts (off the streets)
    bloom(X - 84, Y + 34, 7, 30, 801); bloom(X + 84, Y + 40, 7, 30, 809);   // heart ring
    bloom(X + 256, Y + 92, 9, 44, 817); bloom(X + 216, Y + 126, 6, 26, 823); // temple
    bloom(X - 240, Y + 138, 8, 42, 831);                                     // pond court
    bloom(X + 300, Y - 50, 10, 48, 843);                                     // crystal grove
    bloom(X - 70, Y - 224, 5, 32, 851); bloom(X + 44, Y - 234, 5, 32, 857);  // north district
    bloom(X - 70, Y + 150, 3, 20, 863); bloom(X + 70, Y + 150, 3, 20, 869);  // market shopfronts
    bloom(X - 150, Y + 120, 4, 22, 875);                                     // west residences

    // rock clusters supporting reclaiming trees / ruins
    rocks(X - 240, Y + 160, 3, 20, 901); rocks(X + 44, Y - 246, 3, 18, 907);
    rocks(X - 120, Y + 24, 3, 16, 913); rocks(X + 256, Y + 94, 3, 18, 919);
    rocks(X - 70, Y - 236, 3, 18, 925); rocks(X + 300, Y - 50, 3, 20, 931);

    // overgrown bases on statues / columns / guardians (one side)
    for (const [bx, by, sd] of [
      [X - 44, Y + 96, 981], [X + 44, Y + 102, 985],     // processional
      [X - 38, Y + 308, 989], [X + 40, Y + 308, 993],    // gate guardians
      [X - 38, Y + 122, 997], [X + 42, Y + 124, 1001],   // temple statues
      [X + 40, Y - 202, 1005],                           // scholar monument
    ]) { bloom(bx - 10, by + 6, 3, 12, sd); put('bush_low', bx + 10, by + 6); }

    // daytime butterflies over the bloomiest sites
    for (const [bx, by, col, rx, ry, sp, ph] of [
      [X - 240, Y + 150, 'blue', 26, 13, 0.92, 0.0],
      [X - 76, Y + 34, 'blue', 24, 12, 0.88, 1.1],
      [X + 76, Y + 40, 'violet', 22, 11, 1.00, 3.3],
      [X + 256, Y + 92, 'white', 22, 11, 1.05, 2.2],
      [X + 300, Y - 50, 'white', 24, 12, 0.95, 4.6],
      [X + 44, Y - 234, 'blue', 22, 11, 0.83, 5.2],
    ]) this.butterflies.push({ x: bx, y: by, col, rx, ry, speed: sp, phase: ph });
  }

  // ---- Crystal Plaza landscaping ------------------------------------------
  // The square is read outward from the fountain in three zones, and the whole
  // design is that transition:
  //
  //   A  INNER STONE      swept paving, the fountain alone in it
  //   B  FORMAL RING      containers, benches, lamps, bedding — all placed
  //   C  NATURAL OUTER    clustered shrub, graded canopy, rock, rough grass
  //
  // Symmetry is spent only on the architecture: the four containers, the two
  // pairs of seating, the lamp pair. Everything alive breaks it on purpose —
  // matched planting on both diagonals would read as wallpaper, and the eye
  // stops believing a place the moment it notices the pattern.
  //
  // Every road exit stays a clear corridor. The square is the centre of a giant
  // plus sign and that plus has to stay readable from a standing start, so
  // nothing built or planted goes inside one.
  // ---- the lake region ----------------------------------------------------
  //
  // The lake was a pond sitting in an enormous empty field. This pass turns the
  // ground around it into a place: not by scattering props evenly over the
  // grass — that reads as confetti at any zoom — but by building a few LARGE
  // MASSES with deliberate open ground between them. At the wide camera the
  // silhouettes of those masses are what the eye reads; the individual rock is
  // invisible. So groves are dense and few, and the meadow between them is left
  // genuinely empty.
  //
  // Appended to the plaza pass's lists rather than replacing them, and every
  // placement is guarded against the roads and districts, so nothing here can
  // reach into the town's own composition.
  // The lake's small props: three deciduous trees on the shore and mushrooms
  // scattered over the surrounding ground. The wider decoration passes are
  // switched off above; this is deliberately everything the region has.
  //
  // All three are DECIDUOUS_TREE_01, cut from the labelled natural-vegetation
  // sheet; the sizes vary rather than the sprite.
  //
  // Positions come from the pond's own collision rather than from the eye. The
  // north bank pushes furthest into the water at x=1162 — the corner where the
  // lake's two lobes meet — and that one is drawn largest, as asked. The other
  // two sit just off the west and east water edges (x=939 and x=1660).
  _buildLakeDetail() {
    const NAME = 'deciduous_tree_01';
    const [bw, bh] = DECOR_SIZE[NAME];
    // [x, y, scale, flip]
    const SPOTS = [
      // On the tongue of grass that comes down into the water just right of the
      // lake's centre (centre is x=1300), and set back up it rather than at the
      // waterline — the bank there plateaus at +119 from x=1306 to 1378, so
      // standing at y=2213 leaves a clear margin of grass in front of it.
      [1338, 2213, 1.35, false],   // the big one, set back off the water
      [916, 2298, 1.00, false],    // west side
      [1686, 2350, 0.88, true],    // east side
    ];
    for (const [x, y, k, flip] of SPOTS) {
      const w = Math.round(bw * k), h = Math.round(bh * k);
      this.decor.push({ name: NAME, x, y, w, h, flip, sortY: y,
                        shadow: Math.round(w * 0.26) });
    }

    // ---- a mix of pine and deciduous over the wider ground -----------------
    //
    // Gathered near the lake and thinning outward, so the water sits in a wood
    // that opens into meadow rather than in a field with trees dotted over it.
    // The shoreline itself is still left clear — nothing is planted within
    // TREE_KEEP of the water, because planting against the bank is what built
    // the ring of decoration that had to be torn out before. The gradient is
    // carried by the SPACING, as with the mushrooms: biasing where candidates
    // are drawn does nothing on its own, since a single minimum gap flattens
    // the result back out.
    const L = this.lakeTopLeft;
    const water = POND_WATER_RECTS.map(([fx, fy, fw, fh]) => ({
      x: L.x + fx * POND_W, y: L.y + fy * POND_H, w: fw * POND_W, h: fh * POND_H,
    }));
    // `_nearAnyRoad` tests the coarse road RECTS, and those do not agree with
    // the surface that actually gets painted — nine trees were standing on
    // stone with six of them anchored right on it. `roadCov` is the paint
    // itself, cell by cell, so that is what a footprint has to be cleared
    // against. Tested across the prop's width, not just its anchor, because a
    // wide canopy reaches the road long before its trunk does.
    const onRoadPaint = (x, y, halfW, up) => {
      const C = ROAD_CELL;
      for (let dx = -halfW; dx <= halfW; dx += C) {
        for (let dy = -up; dy <= C; dy += C) {
          if (this.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
        }
      }
      return false;
    };
    const distToWater = (x, y) => {
      let best = Infinity;
      for (const r of water) {
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        const d = Math.hypot(dx, dy);
        if (d < best) best = d;
      }
      return best;
    };
    // Species and variant are both taken from COUNTERS, not from a random draw.
    // Drawing species at 38% pine gave 18% on the ground: the draw itself is
    // uniform (checked), but which candidates survive the spacing test is not
    // independent of it, so the ratio drifts. A repeating pattern fixes the
    // split exactly, and cycling the variant lists means all four pines and all
    // six broadleaves get used evenly rather than the same two recurring.
    const PINES = ['pine_tree_01', 'pine_tree_02', 'pine_tree_03', 'pine_tree_04'];
    const BROAD = ['deciduous_tree_01', 'deciduous_tree_02', 'deciduous_tree_03',
                   'deciduous_tree_04', 'deciduous_tree_05', 'deciduous_tree_06'];
    const MIX = [1, 0, 1, 0, 0];        // 2 pine : 3 broadleaf = 40 / 60
    let placedN = 0, pineN = 0, broadN = 0;
    const nextTree = () => {
      const pine = MIX[placedN % MIX.length] === 1;
      placedN++;
      return pine ? PINES[pineN++ % PINES.length] : BROAD[broadN++ % BROAD.length];
    };
    const TREE_KEEP = 58;        // clear ground between the water and the wood
    const trunks = [];           // where each tree landed, for the base planting
    const stand = [];
    for (let n = 0; n < 1800 && stand.length < 165; n++) {
      const a = hash(8000 + n * 3.9) * Math.PI * 2;
      const rr = hash(8100 + n * 6.7);
      const out = 90 + rr * rr * 390;                // squared: favours the lakeside
      const x = Math.round(L.x + POND_W / 2 + Math.cos(a) * (POND_W * 0.5 + out - 40));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(a) * (POND_H * 0.5 + out - 40));
      const d = distToWater(x, y);
      if (d < TREE_KEEP || d > 470) continue;         // never against the water
      if (this._nearAnyRoad(x, y, 34) || this._nearAnyDistrict(x, y, 60)) continue;
      if (onRoadPaint(x, y, 54, 16)) continue;
      const gap = 40 + Math.max(0, d - TREE_KEEP) * 0.30;  // opens up with distance
      if (stand.some((t) => Math.hypot(t.x - x, t.y - y) < gap)) continue;
      const name = nextTree();
      const [w, h] = DECOR_SIZE[name];
      const k = 0.85 + hash(8400 + n * 2.7) * 0.4;
      const tw = Math.round(w * k), th = Math.round(h * k);
      this.decor.push({ name, x, y, w: tw, h: th, flip: hash(8500 + n) > 0.5,
                        sortY: y, shadow: Math.round(tw * 0.26) });
      stand.push({ x, y });
      trunks.push({ x, y, w: tw });
      // a companion beside about a third of them, so they read as stands
      if (hash(8600 + n * 4.3) > 0.42) {
        const ca = hash(8700 + n * 3.3) * Math.PI * 2;
        const cr = 34 + hash(8800 + n * 5.7) * 26;
        const cx2 = Math.round(x + Math.cos(ca) * cr), cy2 = Math.round(y + Math.sin(ca) * cr * 0.7);
        if (distToWater(cx2, cy2) > TREE_KEEP && !this._nearAnyRoad(cx2, cy2, 30)
            && !this._nearAnyDistrict(cx2, cy2, 60) && !onRoadPaint(cx2, cy2, 46, 14)) {
          const n2 = nextTree();
          const [w2, h2] = DECOR_SIZE[n2];
          const k2 = 0.7 + hash(9000 + n * 6.1) * 0.3;
          this.decor.push({ name: n2, x: cx2, y: cy2, w: Math.round(w2 * k2), h: Math.round(h2 * k2),
                            flip: hash(9100 + n) > 0.5, sortY: cy2,
                            shadow: Math.round(w2 * k2 * 0.26) });
          stand.push({ x: cx2, y: cy2 });
          trunks.push({ x: cx2, y: cy2, w: Math.round(w2 * k2) });
        }
      }
    }

    // ---- understory: bushes, tall grass and weeds --------------------------
    //
    // Same gradient as the mushrooms and the trees: gathered near the water and
    // thinning outward, carried by the SPACING rather than by where candidates
    // are drawn. Unlike the trees these are allowed right up to the bank, since
    // low planting reads as ground cover rather than as an outline round the
    // lake — but they still stop short of the water itself.
    const BUSHES = ['nv_bush_01', 'nv_bush_02', 'nv_bush_03', 'nv_bush_04'];
    const TALLG = ['nv_tallgrass_01', 'nv_tallgrass_02', 'nv_tallgrass_04',
                   'nv_tallgrass_05', 'nv_tallgrass_06', 'nv_tallgrass_07'];
    const WEEDY = ['nv_weeds_01', 'nv_weeds_02', 'nv_weeds_03', 'nv_weeds_04'];
    // one bush to roughly two grass to one weed, by counter so the mix holds
    const UNDER_MIX = [0, 1, 1, 2];
    let uN = 0, bI = 0, gI = 0, wI = 0;
    const nextUnder = () => {
      const k = UNDER_MIX[uN % UNDER_MIX.length]; uN++;
      return k === 0 ? BUSHES[bI++ % BUSHES.length]
           : k === 1 ? TALLG[gI++ % TALLG.length]
                     : WEEDY[wI++ % WEEDY.length];
    };
    // Planting tucked against the trunks. The sheet paints a ground shadow under
    // every tree, and cutting it away leaves the foot of the trunk looking bare
    // and slightly cut-off; a tuft or two at the base reads as the tree growing
    // out of the ground rather than being stood on it.
    const BASEPLANT = ['nv_tallgrass_01', 'nv_tallgrass_02', 'nv_tallgrass_04',
                       'nv_tallgrass_05', 'nv_weeds_01', 'nv_weeds_03', 'nv_bush_01'];
    trunks.forEach((t, i) => {
      if (hash(11500 + i * 3.7) < 0.35) return;         // not every tree
      const n = 1 + Math.floor(hash(11600 + i * 5.1) * 2);
      for (let k = 0; k < n; k++) {
        const side = hash(11700 + i * 7.3 + k * 4.9) > 0.5 ? 1 : -1;
        const off = (t.w * 0.16 + hash(11800 + i * 2.9 + k * 6.1) * t.w * 0.3) * side;
        const bx = Math.round(t.x + off);
        const by = Math.round(t.y + (hash(11900 + i * 4.3 + k) - 0.35) * 6);
        if (onRoadPaint(bx, by, 20, 8) || distToWater(bx, by) < 10) continue;
        const nm = BASEPLANT[Math.floor(hash(12000 + i * 8.1 + k * 3.3) * BASEPLANT.length) % BASEPLANT.length];
        const [bw, bh] = DECOR_SIZE[nm];
        const bk = 0.65 + hash(12100 + i * 5.7 + k) * 0.35;
        this.decor.push({ name: nm, x: bx, y: by, w: Math.round(bw * bk), h: Math.round(bh * bk),
                          flip: side < 0, sortY: by + 1, shadow: 0 });
      }
    });

    const under = [];
    for (let n = 0; n < 3200 && under.length < 460; n++) {
      const ang = hash(9500 + n * 3.3) * Math.PI * 2;
      const rr = hash(9600 + n * 5.1);
      const out = 12 + rr * rr * 400;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(ang) * (POND_W * 0.5 + out - 30));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(ang) * (POND_H * 0.5 + out - 30));
      const d = distToWater(x, y);
      if (d < 10 || d > 440) continue;
      if (this._nearAnyRoad(x, y, 22) || this._nearAnyDistrict(x, y, 48)) continue;
      if (onRoadPaint(x, y, 38, 12)) continue;   // widest bush scales to ~75 across
      const gap = 15 + d * 0.17;                 // tight at the bank, open far out
      if (under.some((u) => Math.hypot(u.x - x, u.y - y) < gap)) continue;
      const name = nextUnder();
      const [w, h] = DECOR_SIZE[name];
      const k = 0.8 + hash(9700 + n * 2.9) * 0.45;
      this.decor.push({ name, x, y, w: Math.round(w * k), h: Math.round(h * k),
                        flip: hash(9800 + n) > 0.5, sortY: y,
                        shadow: Math.round(w * k * 0.2) });
      under.push({ x, y });
    }

    // ---- rocks -------------------------------------------------------------
    //
    // In groups, never singly, and graded like everything else. `rockgrass_*`
    // are rock-and-grass masses cut from the grass sheet, which sit into a
    // forest floor better than a bare boulder does.
    const BOULDER = ['rock_med_01', 'rockgrass_01', 'rockgrass_02', 'rockgrass_03',
                     'rockgrass_04', 'rockgrass_05'];
    const COBBLE = ['rock_small_01', 'rock_small_02', 'rock_small_03',
                    'pebbles_01', 'pebbles_02', 'pebbles_03'];
    const rocks = [];
    for (let n = 0; n < 1600 && rocks.length < 78; n++) {
      const ang = hash(10200 + n * 3.1) * Math.PI * 2;
      const rr = hash(10300 + n * 5.7);
      const out = 14 + rr * rr * 410;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(ang) * (POND_W * 0.5 + out - 30));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(ang) * (POND_H * 0.5 + out - 30));
      const d = distToWater(x, y);
      if (d < 12 || d > 440) continue;
      if (this._nearAnyRoad(x, y, 24) || this._nearAnyDistrict(x, y, 48)) continue;
      if (onRoadPaint(x, y, 30, 10)) continue;   // widest rock mass scales to ~55
      const gap = 34 + d * 0.26;
      if (rocks.some((r) => Math.hypot(r.x - x, r.y - y) < gap)) continue;
      const big = BOULDER[Math.floor(hash(10400 + n * 7.3) * BOULDER.length) % BOULDER.length];
      const [bw, bh] = DECOR_SIZE[big];
      const k = 0.8 + hash(10500 + n * 2.3) * 0.5;
      this.decor.push({ name: big, x, y, w: Math.round(bw * k), h: Math.round(bh * k),
                        flip: hash(10600 + n) > 0.5, sortY: y,
                        shadow: Math.round(bw * k * 0.22) });
      rocks.push({ x, y });
      // one or two smaller stones tucked against it
      const extra = 1 + Math.floor(hash(10700 + n * 4.1) * 2);
      for (let e = 0; e < extra; e++) {
        const ea = hash(10800 + n * 6.1 + e * 9.7) * Math.PI * 2;
        const er = 12 + hash(10900 + n * 3.7 + e * 5.3) * 16;
        const ex = Math.round(x + Math.cos(ea) * er), ey = Math.round(y + Math.sin(ea) * er * 0.7);
        if (distToWater(ex, ey) < 8 || onRoadPaint(ex, ey, 12, 6)) continue;
        const sm = COBBLE[Math.floor(hash(11000 + n * 8.9 + e) * COBBLE.length) % COBBLE.length];
        const [sw, sh] = DECOR_SIZE[sm];
        this.decor.push({ name: sm, x: ex, y: ey, w: sw, h: sh,
                          flip: hash(11100 + n + e) > 0.5, sortY: ey,
                          shadow: Math.round(sw * 0.2) });
      }
    }

    // ---- mushrooms ---------------------------------------------------------
    //
    // In small clumps rather than sprinkled one at a time: they grow that way,
    // and single mushrooms at this size just read as specks. Placed on land
    // only — the lake's own collision rects are the water test — and kept off
    // the roads and out of the districts.
    //
    // Weighted toward the tree bases and the lakeside, thinning outward, so the
    // ground still reads as mostly open meadow.
    const wet = (x, y, pad = 8) => water.some((r) =>
      x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad);
    const CAPS = ['mushrooms_01', 'mushrooms_02', 'mushrooms_03', 'mushrooms_04'];
    const clumps = [];
    const ok = (x, y, gap) => !wet(x, y) && !this._nearAnyRoad(x, y, 20) && !onRoadPaint(x, y, 16, 6)
      && !this._nearAnyDistrict(x, y, 46)
      && !clumps.some((c) => Math.hypot(c.x - x, c.y - y) < gap);

    const clump = (x, y, seed, n) => {
      clumps.push({ x, y });
      for (let i = 0; i < n; i++) {
        const a = hash(seed + i * 4.7) * Math.PI * 2;
        const r = 3 + hash(seed + i * 6.9 + 1) * 13;
        const mx = Math.round(x + Math.cos(a) * r), my = Math.round(y + Math.sin(a) * r * 0.7);
        if (wet(mx, my, 4) || onRoadPaint(mx, my, 8, 4)) continue;
        const name = CAPS[Math.floor(hash(seed + i * 8.3 + 2) * CAPS.length) % CAPS.length];
        const [w, h] = DECOR_SIZE[name];
        this.groundDecor.push({ name, x: mx, y: my, w, h,
                                flip: hash(seed + i * 2.9 + 3) > 0.5, sortY: my, shadow: 0 });
      }
    };

    // a couple of clumps at the foot of each tree
    SPOTS.forEach(([tx, ty], k) => {
      for (let i = 0; i < 2; i++) {
        const a = hash(7000 + k * 9.1 + i * 5.3) * Math.PI * 2;
        const r = 22 + hash(7010 + k * 7.7 + i * 3.1) * 26;
        const x = Math.round(tx + Math.cos(a) * r), y = Math.round(ty + Math.sin(a) * r * 0.7);
        if (ok(x, y, 26)) clump(x, y, 7100 + k * 31 + i * 13, 2 + Math.floor(hash(7120 + k + i) * 3));
      }
    });

    // and clumps over the surrounding ground, packed close to the water and
    // thinning outward.
    //
    // The gradient is carried by the SPACING, not by how often a candidate is
    // accepted. A single minimum gap everywhere — which is what this did at
    // first — spreads clumps evenly however the candidates are drawn, because
    // the spacing rule overrides the bias. Scaling the required gap with the
    // distance to the water is what actually makes the lakeside congested and
    // the far field open. Clump size is graded the same way.
    const gapAt = (d) => 30 + d * 0.42;      // 30 at the bank, ~200 out in the field
    const sizeAt = (d, h) => d < 70 ? 3 + Math.floor(h * 3)      // 3-5 by the water
                          : d < 190 ? 2 + Math.floor(h * 3)      // 2-4 mid
                          : 1 + Math.floor(h * 2);               // 1-2 far out

    for (let n = 0; n < 420 && clumps.length < 64; n++) {
      const a = hash(7200 + n * 3.7) * Math.PI * 2;
      const rr = hash(7300 + n * 5.9);
      // squared so candidates crowd the shore, then the spacing rule does the
      // rest of the work
      const out = rr * rr * 430;
      const x = Math.round(L.x + POND_W / 2 + Math.cos(a) * (POND_W * 0.5 + out - 16));
      const y = Math.round(L.y + POND_H / 2 + Math.sin(a) * (POND_H * 0.5 + out - 16));
      const d = distToWater(x, y);
      if (d > 430) continue;
      if (!ok(x, y, gapAt(d))) continue;
      clump(x, y, 7400 + n * 17, sizeAt(d, hash(7500 + n)));
    }
  }

  _buildLakeDecor() {
    const L = this.lakeTopLeft;
    // The lake's own water, in world units — vegetation may stand on the bank
    // but nothing may stand in the water.
    const water = POND_WATER_RECTS.map(([fx, fy, fw, fh]) => ({
      x: L.x + fx * POND_W, y: L.y + fy * POND_H, w: fw * POND_W, h: fh * POND_H,
    }));
    const inWater = (x, y) => water.some((r) =>
      x > r.x - 6 && x < r.x + r.w + 6 && y > r.y - 6 && y < r.y + r.h + 6);

    const decor0 = this.decor.length, ground0 = this.groundDecor.length;
    const placed = [];
    const vegAll = [];   // everything this pass puts down, for the feathering
    const fits = (name, x, y, slack) => {
      const [w, h] = DECOR_SIZE[name];
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h, area = w * h;
      for (const p of placed) {
        const ox = Math.min(x1, p.x1) - Math.max(x0, p.x0);
        const oy = Math.min(y, p.y1) - Math.max(y0, p.y0);
        if (ox <= 0 || oy <= 0) continue;
        if ((ox * oy) / Math.min(area, p.area) > slack) return false;
      }
      return true;
    };
    // slack is how much two plants may overlap on screen: a grove wants its
    // canopies knitted together, loose scatter does not.
    // No trees and no shrubs anywhere in this pass. Every arrangement tried
    // around the lake — groves in the north field, a woodland to the
    // south-west, framing at the overlook and the fishing cove — read badly at
    // the wide camera, and once the trees went the bushes that framed them were
    // just green blobs in a field. Blocked here rather than by deleting the
    // arrangements, so the compositions stay legible in the code and either
    // pool can be switched back on in one line. Planting from other passes —
    // the Crystal Plaza grove, the town's forest perimeter — is untouched.
    const WOODY_NAME = /^(tree_|mystic_tree|myst_tree|bush_|topiary)/;
    const put = (name, x, y, opts = {}) => {
      if (!DECOR_SIZE[name] || WOODY_NAME.test(name)) return false;
      x = Math.round(x); y = Math.round(y);
      if (inWater(x, y)) return false;
      if (this._nearAnyRoad(x, y, opts.roadPad != null ? opts.roadPad : 26)) return false;
      if (this._nearAnyDistrict(x, y, 46)) return false;
      if (!fits(name, x, y, opts.slack != null ? opts.slack : 0.3)) return false;
      const [w, h] = DECOR_SIZE[name];
      const list = opts.flat ? this.groundDecor : this.decor;
      list.push({ name, x, y, w, h, flip: !!opts.flip, sortY: y,
                  shadow: opts.flat ? 0 : Math.round(w * 0.28) });
      if (!opts.flat) placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y, area: w * h });
      vegAll.push({ x, y, flat: !!opts.flat });
      return { x, y };          // truthy, and tells later passes where it landed
    };
    const pick = (pool, h) => pool[Math.floor(h * pool.length) % pool.length];

    // ---------------------------------------------------------------- groves
    // Three of them across the northern field, deliberately NOT joined up and
    // deliberately at different distances from the water, so the gaps between
    // them read as meadow rather than as gaps in a hedge.
    const CANOPY = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted'];
    const UNDER = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const SHRUB = ['bush_big', 'bush_01', 'bush_02', 'bush_low', 'bush_03'];
    // Two things make a grove read as one mass rather than as separate trees,
    // and the first attempt had neither. Canopies must be allowed to OVERLAP
    // heavily — in this art a wood is drawn as crowns growing into each other,
    // and a 0.4 overlap cap spaced them out like an orchard. And each plant
    // needs several candidate spots: with one try apiece and a tight radius
    // most were rejected on the first collision, and asking for eighteen plants
    // put down two.
    const woody = [];         // trees and shrubs, so pass 2 can floor them
    const sow = (pool, seed, n, cx, cy, rx, ry, slack) => {
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 14; k++) {
          const h1 = hash(seed + i * 3.7 + k * 11.3);
          const h2 = hash(seed + i * 5.3 + k * 7.9 + 1);
          const h3 = hash(seed + i * 7.1 + 2);
          const at = put(pick(pool, h3), cx + (h1 - 0.5) * 2 * rx, cy + (h2 - 0.5) * 2 * ry,
                         { slack, flip: h1 > 0.5 });
          if (at) { woody.push(at); break; }
        }
      }
    };
    // A handful of things thrown around a point, biased to one side so the
    // result never reads as a planted circle.
    const around = (pool, salt, at, n, r0, r1, slack, flat) => {
      const bias = hash(salt + 0.5) * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const h1 = hash(salt + i * 3.9), h2 = hash(salt + i * 6.1 + 1), h3 = hash(salt + i * 8.3 + 2);
        const a = bias + (h1 - 0.5) * 3.4;
        const r = r0 + h2 * (r1 - r0);
        put(pick(pool, h3), at.x + Math.cos(a) * r, at.y + Math.sin(a) * r * 0.66,
            { slack, flip: h3 > 0.5, flat, roadPad: 16 });
      }
    };
    const grove = (seed, cx, cy, rx, ry, big, small, shrubs) => {
      sow(CANOPY, seed, big, cx, cy, rx, ry, 0.72);
      sow(UNDER, seed + 40, small, cx, cy, rx * 1.25, ry * 1.25, 0.62);
      sow(SHRUB, seed + 90, shrubs, cx, cy, rx * 1.4, ry * 1.4, 0.55);
    };
    // Radii are deliberately TIGHT. The first attempt spread five trees over
    // 190x100 units and the grove read as a handful of separate trees standing
    // in a field — at this camera a mass only registers if the canopies touch.
    // Staggered in distance from the water, and all three kept inside the band
    // of field the player actually sees from the shore — the first placement
    // pushed two of them so far north they were half out of frame and framed
    // nothing.
    grove(1100, 660, 1990, 96, 50, 15, 8, 12);   // west, nearest the shore
    grove(1200, 1520, 1950, 104, 48, 17, 9, 13); // north-east, set furthest back
    grove(1300, 1180, 2058, 84, 40, 12, 7, 10);  // north-centre, hard by the bank

    // ----------------------------------------------------- the shoreline ring
    //
    // What was missing was the MIDDLE of the sequence. The groves sat back in
    // the field and the water had bare rock, so the eye jumped
    // forest -> empty grass -> water. The land now runs
    //
    //   canopy -> bushes -> meadow flowers -> wet grass -> reeds -> water
    //
    // and the ring is deliberately BROKEN: roughly half the perimeter is
    // planted and the rest left bare, in runs long enough to read as stretches
    // of open bank rather than as gaps in a hedge.
    //
    // Shore points come from the pond's own collision rects: for a column of x
    // the topmost and bottommost water give the north and south bank, and for a
    // row of y the leftmost and rightmost give west and east. That tracks the
    // real outline of both lobes without needing the drawn mask, which does not
    // exist yet at build time.
    // The shoreline is left bare on purpose. Successive attempts to plant it —
    // a graded ring, then five consolidated habitats — all read at wide zoom as
    // decoration around the water rather than as a lake, so the waterside
    // planting was removed. The density lives inland instead (below). The
    // wetland and grass props sliced for it are still on disk and still
    // registered, so this is one block to restore, not a re-cut.

    // ------------------------------------------- landscape masses, set inland
    //
    // The density that used to crowd the water lives out here instead, 100-300
    // units back, as a handful of destinations. The lake sits inside a
    // landscape rather than inside a ring of plants.
    const CANOPY2 = ['tree_oak_broad', 'tree_oak_round', 'tree_oak_spread', 'tree_rooted'];
    const UNDER2 = ['tree_young', 'tree_sapling', 'tree_small_pine'];
    const SHRUB2 = ['bush_big', 'bush_01', 'bush_02', 'bush_low', 'bush_03'];
    const BLOSSOM = ['tree_blossom_white', 'tree_blossom_blue'];
    const DEADWOOD = ['fallen_log_01', 'fallen_log_02', 'log_long', 'tree_stump_01', 'tree_stump_02'];

    // North-central grove: the anchor the big field above the water was missing.
    grove(4100, 1268, 2010, 62, 32, 6, 4, 7);
    put(pick(DEADWOOD, hash(4150)), 1310, 2036, { slack: 0.4, flip: true });
    around(['rock_med_01', 'rock_small_01', 'rock_small_02'], 4160, { x: 1224, y: 2028 }, 3, 8, 22, 0.4);

    // South-west woodland: the biggest new mass, and the emptiest field.
    grove(4200, 902, 2662, 104, 52, 8, 5, 10);
    put(pick(DEADWOOD, hash(4250)), 946, 2694, { slack: 0.4 });
    put(pick(DEADWOOD, hash(4260)), 858, 2620, { slack: 0.4, flip: true });
    around(['rock_med_01', 'rock_small_01', 'rock_small_03'], 4270, { x: 968, y: 2640 }, 3, 10, 26, 0.4);
    // ... and a smaller one, with open meadow deliberately left between them
    grove(4300, 1268, 2742, 58, 30, 4, 3, 5);
    around(['rock_med_01', 'rock_small_02'], 4320, { x: 1310, y: 2760 }, 2, 10, 22, 0.4);

    // North-east scenic overlook: the kept side, facing the water. One large
    // tree, a flowering one, a bench and low planting — and the lawn between it
    // and the lake is left clear so the view is not blocked.
    put('tree_oak_broad', 1584, 2148, { slack: 0.4 });
    put(pick(BLOSSOM, hash(4400)), 1640, 2176, { slack: 0.4, flip: true });
    put('tree_young', 1536, 2130, { slack: 0.4 });
    around(SHRUB2, 4410, { x: 1604, y: 2170 }, 4, 14, 30, 0.4);
    around(['flowers_white', 'flowers_blue'], 4420, { x: 1592, y: 2196 }, 5, 10, 26, 1, true);
    put('bench_01', 1596, 2214, { slack: 0.2 });

    // South fishing cove. The peninsula is real geometry — the south bank pushes
    // north to +229 around x=1162..1202 — so the clearing is cut behind its tip
    // and framed in a U, leaving the walk to the water open.
    put('tree_oak_spread', 1104, 2452, { slack: 0.4 });
    put('tree_young', 1256, 2444, { slack: 0.4, flip: true });
    around(SHRUB2, 4500, { x: 1116, y: 2470 }, 3, 12, 26, 0.45);
    around(SHRUB2, 4510, { x: 1246, y: 2466 }, 3, 12, 26, 0.45);
    put(pick(DEADWOOD, hash(4520)), 1128, 2492, { slack: 0.4 });
    around(['rock_med_01', 'rock_small_01'], 4530, { x: 1238, y: 2492 }, 2, 10, 20, 0.4);

    // ------------------------------------------- supporting detail, keyed only
    // to the compositions above. Nothing is placed to fill empty grass: every
    // entry here belongs to a grove, a cove or the overlook. Grass sprites are
    // deliberately not used — flowers and stone carry the detail instead.
    const ROCKSET = ['rock_med_01', 'rock_small_01', 'rock_small_02', 'rock_small_03'];
    // [x, y, radius, flowers, a rock group?]
    const SITES = [
      [660, 1990, 96, 3, true],    // west grove
      [1520, 1950, 100, 2, true],  // north-east grove
      [1180, 2058, 82, 2, false],  // north-centre grove
      [1268, 2010, 66, 2, true],   // new north grove
      [902, 2662, 108, 4, true],   // south-west woodland
      [1268, 2742, 62, 2, true],   // south-west small grove
      [1600, 2180, 74, 5, false],  // north-east overlook, flowers led
      [1180, 2470, 96, 3, true],   // fishing cove
    ];
    SITES.forEach(([sx, sy, r, blooms, rocks], i) => {
      if (blooms) around(['flowers_white', 'flowers_blue', 'flowers_white'],
                         5300 + i * 7, { x: sx, y: sy }, blooms, r * 0.5, r * 0.95, 1, true);
      if (rocks) {
        const a2 = hash(5400 + i) * Math.PI * 2, rr = r * 0.55;
        const cx = sx + Math.cos(a2) * rr, cy = sy + Math.sin(a2) * rr * 0.66;
        put('rock_med_01', cx, cy, { slack: 0.35 });
        around(ROCKSET, 5500 + i * 9, { x: cx, y: cy }, 2, 10, 20, 0.4);
      }
    });

    // ------------------------------------------------------- wildflower meadow
    // Not one carpet: a handful of irregular patches with grass corridors left
    // between them, so it reads as a meadow rather than as a painted rectangle.
    // White and blue lead, yellow is occasional, red stays out — Crystal Plaza
    // owns organised colour, and the lake has to look like nobody planted it.
    const BLOOM = ['flowers_white', 'flowers_blue', 'flowers_white', 'flowers_blue',
                   'flowers_white', 'flowers_blue', 'flowers_yellow'];
    // Sits in the gap between the west grove and the north-centre one, so the
    // eye reads grove -> meadow -> grove rather than one continuous band.
    const patches = [[872, 2020, 34, 18], [960, 1986, 30, 16], [840, 2074, 28, 15],
                     [1012, 2040, 30, 17], [910, 2058, 25, 14], [986, 2090, 24, 13],
                     [900, 1962, 26, 14], [1040, 1988, 22, 12]];
    patches.forEach((pt, k) => {
      const [px, py, rx, ry] = pt;
      for (let i = 0; i < 14; i++) {
        const h1 = hash(2000 + k * 31 + i * 3.7), h2 = hash(2000 + k * 31 + i * 5.1 + 1);
        const h3 = hash(2000 + k * 31 + i * 6.9 + 2);
        put(pick(BLOOM, h3), px + (h1 - 0.5) * 2 * rx, py + (h2 - 0.5) * 2 * ry,
            { flat: true, slack: 1, flip: h1 > 0.5 });
      }
    });

    // ---------------------------------------------------------- keep water clear
    // Nothing of this pass may sit against the bank: that is what kept reading
    // as an outline round the lake instead of as a landscape containing one.
    const nearWater = (d) => water.some((r) =>
      d.x > r.x - 22 && d.x < r.x + r.w + 22 && d.y > r.y - 22 && d.y < r.y + r.h + 22);
    const dropD = new Set(this.decor.slice(decor0).filter(nearWater));
    const dropG = new Set(this.groundDecor.slice(ground0).filter(nearWater));
    this.decor = this.decor.filter((d) => !dropD.has(d));
    this.groundDecor = this.groundDecor.filter((d) => !dropG.has(d));
  }

  _buildPlazaDecor(FC) {
    this.decor = [];        // depth-sorted against the player
    this.groundDecor = [];  // flat detail, drawn beneath every entity
    const R = this.plazaRadius;

    // ---------------------------------------------------------- primitives
    const placed = [];
    const FURNITURE = /^(bench|planter|lamppost|signpost|cart|crate|barrel|sack|topiary|fence|garden_patch|flower_box|clothes_line|mailbox|wooden_post|wooden_sign|water_well|water_bucket|wheelbarrow|hay_|wood_pile|chopping_block|log_long|direction_sign)/;
    const onPaint = (x, y, pad = 0) => {
      const C = ROAD_CELL;
      for (let dy = -pad; dy <= pad; dy += C) {
        for (let dx = -pad; dx <= pad; dx += C) {
          if (this.roadCov.has(Math.floor((x + dx) / C) + ',' + Math.floor((y + dy) / C))) return true;
        }
      }
      return false;
    };
    // Nearest spot off the paint, searched straight out from the fountain, or
    // null if there is none within a prop's width. Inside the rim the grit is
    // meant to lie on the stone, so the rule starts at the plaza edge.
    const GRID = 8;
    const snap = (v) => Math.round(v / GRID) * GRID;
    const offPaint = (x, y) => {
      const rr = Math.hypot(x - FC.x, y - FC.y);
      if (rr <= R + 2 || !onPaint(x, y, 6)) return [x, y];
      const ux = (x - FC.x) / rr, uy = (y - FC.y) / rr;
      for (let push = GRID; push <= GRID * 4; push += GRID) {
        const nx = snap(x + ux * push), ny = snap(y + uy * push);
        if (!onPaint(nx, ny, 6)) return [nx, ny];
      }
      return null;
    };
    // Rough grass and loose stone must clear the paving by their whole drawn
    // width, not just by their anchor: a tuft whose base sits a few units off
    // the kerb still lies half across the road, and it is the sprite the player
    // sees, not the anchor. Everything else may overhang a little — a shrub
    // breaking the rim is what stops the stone edge reading as a cut line.
    const STONE_SHY = /^(grass_tuft|weeds|fern|bush|flowers|tree_|rock|pebbles)/;
    const footprintOnStone = (name, x, y) => {
      const [w, h] = DECOR_SIZE[name];
      for (let dx = -w / 2; dx <= w / 2; dx += 4) {
        for (let dy = -Math.min(h, 14); dy <= 0; dy += 4) {
          if (onPaint(x + dx, y + dy, 0)) return true;
        }
      }
      return Math.hypot(x - FC.x, y - FC.y) < R + 4;
    };
    // Everything lands on an 8-unit grid. This is where a tile-built town gets
    // its order from — not from symmetry, which we already had and which still
    // read loose. Props placed at arbitrary polar offsets never line up with
    // each other or with anything else on screen; snapped, they share edges and
    // spacings the eye picks up even when the arrangement itself is irregular.
    // Groups stay irregular because their ANCHORS differ, not because their
    // individual members sit at fractional offsets.
    // The funnel. From the plaza edge out to 205, within 40 units of any
    // carriageway, is the ground a player reads a road BY — so nothing loose
    // stands in it. Formal furniture is exempt on purpose: containers and
    // lanterns are what frame an entrance, and the north gateway pair is meant
    // to stand right at one.
    const MOUTH_OK = /^(topiary|lamppost|planter)/;
    // Ground held back for the four directional statues, which are not built
    // yet: roughly two player widths across, one just off each road mouth,
    // clear of the carriageway itself. Nothing may be planted or stacked here.
    const STATUE_PLOTS = [[-72, -158], [166, -68], [-72, 162], [-168, 66]];
    const onStatuePlot = (x, y) => STATUE_PLOTS.some(([ox, oy]) =>
      Math.hypot(x - (FC.x + ox), y - (FC.y + oy)) < 24);
    // ---- SOUTH-EAST HELD CLEAR --------------------------------------------
    // The SE is being rebuilt from scratch, so for now nothing but a lamp may
    // stand anywhere in its review frame. Placed here rather than by deleting
    // the yard code, so the composition survives in source and comes straight
    // back when this block goes. Rect matches the standard SE camera exactly:
    // dx -46..518, dy -7..311 from the plaza focus.
    const SE_HOLD = true;
    const seHeld = (name, x, y, opts) => SE_HOLD
      && !(opts && opts.holdOk)              // an explicit, per-placement exemption
      && !/^(lamppost|crop_|soil_)/.test(name)
      && x >= FC.x - 46 && x <= FC.x + 518
      && y >= FC.y - 7 && y <= FC.y + 311;

    const nearMouth = (x, y) => {
      const rr = Math.hypot(x - FC.x, y - FC.y);
      if (rr < R - 4 || rr > 205) return false;
      return this._nearAnyRoad(x, y, 40);
    };
    const put = (name, x, y, opts = {}) => {
      const [w, h] = DECOR_SIZE[name];
      // Everything lands on the 8-grid except where a prop has to be placed
      // EXACTLY — see the fountain's lantern pair, which cannot be symmetric
      // about a focus that is not itself a grid point.
      if (!opts.exact) { x = snap(x); y = snap(y); }
      const clear = offPaint(x, y);
      if (!clear) return false;
      if (STONE_SHY.test(name) && footprintOnStone(name, clear[0], clear[1])) return false;
      if (!MOUTH_OK.test(name) && nearMouth(clear[0], clear[1])) return false;
      if (onStatuePlot(clear[0], clear[1])) return false;
      if (seHeld(name, clear[0], clear[1], opts)) return false;
      // A nudge happens after the caller cleared the original spot, so re-check
      // the furniture rule or a moved prop slides into something already avoided.
      if ((clear[0] !== x || clear[1] !== y) && !fits(name, clear[0], clear[1], 1)) return false;
      x = clear[0]; y = clear[1];
      const list = opts.flat ? this.groundDecor : this.decor;
      list.push({ name, x, y, w, h, flip: !!opts.flip,
                  sortY: opts.sortY != null ? opts.sortY : y,
                  shadow: opts.shadow != null ? opts.shadow : Math.round(w * 0.28) });
      if (!opts.flat) {
        placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y,
                      area: w * h, furn: FURNITURE.test(name) });
      }
      if (opts.solid) {
        const [sw, sh] = opts.solid;
        this.solids.push({ x: x - sw / 2, y: y - sh, w: sw, h: sh });
      }
      return true;
    };
    // Sprites are bottom-anchored and drawn UPWARD, so two props whose bases sit
    // well apart can still cover each other on screen. Compare drawn rectangles.
    // Planting may knit together; nothing may grow through the furniture.
    const fits = (name, x, y, plantSlack = 0.28) => {
      const [w, h] = DECOR_SIZE[name];
      const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h, area = w * h;
      for (const p of placed) {
        const ox = Math.min(x1, p.x1) - Math.max(x0, p.x0);
        const oy = Math.min(y, p.y1) - Math.max(y0, p.y0);
        if (ox <= 0 || oy <= 0) continue;
        if ((ox * oy) / Math.min(area, p.area) > (p.furn ? 0.02 : plantSlack)) return false;
      }
      return true;
    };
    const pick = (pool, h) => pool[Math.floor(h * pool.length) % pool.length];
    const place = (name, x, y, opts = {}) => {
      // Clearance is tested at the SNAPPED position, which is where the prop
      // will actually stand — checking the raw one and letting put() snap
      // afterwards leaves half a grid step of untested drift. The search is a
      // spiral rather than a straight radial push: a spot blocked on the way
      // out is very often free a step to one side, and radial-only failed to
      // seat the wheelbarrow, the washing line and the forge's hay at all.
      const sx = snap(x), sy = snap(y);
      if (fits(name, sx, sy, 0.05) && put(name, sx, sy, opts)) return true;
      for (let ring = 1; ring <= 5; ring++) {
        for (let a = 0; a < 12; a++) {
          const th = (a / 12) * Math.PI * 2;
          const nx = snap(x + Math.cos(th) * ring * GRID);
          const ny = snap(y + Math.sin(th) * ring * GRID);
          if (fits(name, nx, ny, 0.05) && put(name, nx, ny, opts)) return true;
        }
      }
      // No fallback. Forcing it in when every offset was rejected is how a
      // fence ends up running through a tree; for anything laid in a run a
      // missing segment just shortens the run, which costs far less.
      return false;
    };
    // Everything past the formal ring is pulled in toward the square. A town
    // centre reads as a place when you can take it in at once; spread out, the
    // fountain looks small and lonely and the planting and the enclosing wall
    // become two unrelated things with lawn between them. The formal ring keeps
    // its own distances — that geometry is set against the paving — so only the
    // landscape beyond it compresses.
    const COSY_FROM = 190, COSY = 0.60;
    const at = (deg, dist) => {
      const d = dist <= COSY_FROM ? dist : COSY_FROM + (dist - COSY_FROM) * COSY;
      const a = deg * Math.PI / 180;
      return [FC.x + Math.cos(a) * d, FC.y + Math.sin(a) * d];
    };
    // Which quadrant a point falls in — the ground layers below weight
    // themselves by it, so rock and rough grass belong to the wild side of the
    // town and stay off the swept and the cultivated sides.
    const quadOf = (x, y) => {
      const g = Math.atan2(y - FC.y, x - FC.x) * 180 / Math.PI;
      return g > -90 && g < 0 ? 'NE' : g >= 0 && g < 90 ? 'SE' : g >= 90 ? 'SW' : 'NW';
    };
    // The four walking corridors. Everything built or planted keeps out; the
    // pad is generous for canopy because a crown overhangs its own trunk.
    const corridor = (x, y, pad = 20) => this._nearAnyRoad(x, y, pad);

    // An irregular organic patch — polar jitter with a sqrt radius so the
    // density falls off toward the edge rather than stopping at a boundary.
    // Deliberately not a grid: bedding laid out on a rectangle reads as tiles.
    const patch = (base, cx, cy, names, n, spread, opts = {}) => {
      let made = 0;
      for (let i = 0; i < n * 4 && made < n; i++) {
        const k = base + i * 3;
        const h1 = hash(k), h2 = hash(k + 1), h3 = hash(k + 2);
        const a = h1 * Math.PI * 2, rr = spread * Math.sqrt(h2);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.7;
        if (corridor(x, y, opts.road != null ? opts.road : 18)) continue;
        if (opts.avoid && opts.avoid(x, y)) continue;
        const name = pick(names, h3);
        if (!fits(name, x, y, opts.slack != null ? opts.slack : 0.45)) continue;
        if (put(name, x, y, { flip: h3 > 0.5, flat: opts.flat })) made++;
      }
      return made;
    };
    // A planted group: one anchor with its companions tucked around it. Groups
    // are what stop a landscape reading as a sprinkle of individual sprites.
    const clump = (base, cx, cy, names, opts = {}) => {
      let made = 0;
      for (let i = 0; i < names.length; i++) {
        const k = base + i * 3;
        const h1 = hash(k), h2 = hash(k + 1), h3 = hash(k + 2);
        for (let t = 0; t < 8; t++) {
          const a = (i / names.length) * Math.PI * 2 + (h1 - 0.5) * 1.6 + t * 0.7;
          const rr = (i === 0 ? 0 : 16 + h2 * 20 + t * 3);
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.65;
          if (corridor(x, y, opts.road != null ? opts.road : 26)) continue;
          if (opts.avoid && opts.avoid(x, y)) continue;
          if (!fits(names[i], x, y, 0.22)) continue;
          if (put(names[i], x, y, { flip: h3 > 0.5 })) { made++; break; }
        }
      }
      return made;
    };

    // ==================================================== CRYSTAL PLAZA LAYOUT
    // Rebuilt from zero as an AUTHORED level, not a decoration system. The
    // previous layout was ~1000 lines of generative passes that each scattered
    // props by rule; every refinement moved sprites around inside the same
    // structure, which is why it kept looking different without looking better.
    //
    // Three things changed in approach:
    //   1. Built OUTSIDE-IN. The outer tree belt is placed first and the
    //      fountain surround last, so the scene is contained before it is
    //      decorated.
    //   2. Deliberately ASYMMETRIC. Four equally dressed quadrants is what
    //      reads as artificial; these four destinations differ in size,
    //      density and character, and only the formal garden is geometric.
    //   3. Authored placements call put() DIRECTLY and skip fits(). A designed
    //      composition does not want automatic spacing — and fits() gates
    //      furniture at a hard 0.02, which makes a crate stack impossible.
    //      Automatic spacing is kept only for the scatter fillers.
    //
    // window.__plazaStage = 'bare' | 'macro' | 'mid' | 'final' renders the
    // layout at successive levels of detail, which is how the macro
    // composition gets judged before any grass is laid.
    const STAGE = (typeof window !== 'undefined' && window.__plazaStage) || 'final';
    const MACRO = STAGE !== 'bare';
    const MID = STAGE === 'mid' || STAGE === 'final';
    const MICRO = STAGE === 'final';

    // Piece-by-piece editing. `window.__plazaOnly = 'nw'` (or an array) builds
    // ONLY that composition, so one garden can be judged and reworked without
    // the rest of the site arguing with it. Every placement helper below checks
    // the current area, so switching one on or off is a single line, never a
    // re-indent. Ids: belt, nw, ne, sw, yard, plaza, lamps, mid, micro.
    const ONLY = (typeof window !== 'undefined' && window.__plazaOnly) || null;
    let AREA = 'core';
    const area = (id) => { AREA = id; };
    const wanted = () => !ONLY || AREA === ONLY
      || (Array.isArray(ONLY) && ONLY.indexOf(AREA) >= 0);

    const P = (dx, dy) => [FC.x + dx, FC.y + dy];
    const BLUE = ['flowers_blue', 'flowers_blue', 'flowers_white', 'flowers_mixed'];
    const BLUEWHITE = ['flowers_blue', 'flowers_white', 'flowers_white'];
    const WHITEBLUE = ['flowers_white', 'flowers_white', 'flowers_blue'];
    const YELLOW = ['flowers_yellow', 'flowers_yellow', 'flowers_white'];
    const MARKET = ['flowers_red', 'flowers_red', 'flowers_yellow'];

    // Nothing may be built into the lake or a building.
    const WORLD_BLOCK = this.locations.filter((l) => l.solid).map((l) => l.solid);
    const LK = this.lakeTopLeft;
    const blocked = (x, y) => {
      if (LK && x > LK.x - 24 && x < LK.x + POND_W + 24
              && y > LK.y - 24 && y < LK.y + POND_H + 24) return true;
      for (const o of WORLD_BLOCK) {
        if (x > o.x - 16 && x < o.x + o.w + 16 && y > o.y - 16 && y < o.y + o.h + 16) return true;
      }
      return false;
    };
    // Six designated lawns. These are DESIGN, not leftovers: the dense masses
    // only read as dense against ground that is genuinely empty, and three of
    // them sit on the fountain's north, west and east sightlines so each road
    // leaves through open ground before it reaches anything.
    const LAWNS = [
      [0, -168, 74],     // north of the fountain — the grand approach
      [-214, 16, 70],    // west sightline
      [216, 8, 68],      // east sightline
      [-242, -118, 54],  // the civic garden's own clearing
      [-214, 170, 48],   // the park's clearing
      [-70, 204, 56],    // south lawn, between park and market road
    ];
    const onLawn = (x, y) => LAWNS.some(([ox, oy, r]) =>
      Math.hypot(x - (FC.x + ox), y - (FC.y + oy)) < r);

    // AUTHORED placement: exact position, no spacing test, guards still apply.
    const set = (name, dx, dy, opts = {}) => {
      if (!wanted()) return false;
      const [x, y] = P(dx, dy);
      if (blocked(x, y)) return false;
      return put(name, x, y, opts);
    };
    // SCATTERED placement: for fillers only, spacing-tested and lawn-aware.
    const grow = (name, dx, dy, opts = {}, slack = 0.5) => {
      if (!wanted()) return false;
      const [x, y] = P(dx, dy);
      if (blocked(x, y) || onLawn(x, y)) return false;
      if (corridor(x, y, opts.road != null ? opts.road : 22)) return false;
      const sx = snap(x), sy = snap(y);
      if (fits(name, sx, sy, slack) && put(name, sx, sy, opts)) return true;
      for (let k = 1; k <= 3; k++) {
        for (let a = 0; a < 6; a++) {
          const th = (a / 6) * Math.PI * 2 + k;
          const nx = snap(x + Math.cos(th) * k * GRID), ny = snap(y + Math.sin(th) * k * GRID);
          if (blocked(nx, ny) || onLawn(nx, ny) || corridor(nx, ny, opts.road != null ? opts.road : 22)) continue;
          if (fits(name, nx, ny, slack) && put(name, nx, ny, opts)) return true;
        }
      }
      return false;
    };
    const bed = (seed, dx, dy, names, n, spread) => {
      if (!wanted()) return 0;
      const [x, y] = P(dx, dy);
      if (blocked(x, y)) return 0;
      return patch(seed, x, y, names, n, spread, { road: 24, slack: 0.72 });
    };
    const fenceRun = (dx, dy, segs, vertical) => {
      if (!wanted()) return;
      const [w, h] = DECOR_SIZE[vertical ? 'fence_vertical' : 'fence_run'];
      for (let i = 0; i < segs; i++) {
        const ddx = vertical ? dx : dx + i * (w - 2);
        const ddy = vertical ? dy + i * (h - 3) : dy;
        const [x, y] = P(ddx, ddy);
        if (corridor(x, y, 16) || blocked(x, y)) continue;
        put(vertical ? 'fence_vertical' : 'fence_run', x, y,
            { solid: [w - 4, 5], shadow: 0 });
      }
    };

    // ---- THE TWO PLAZA LANTERNS -------------------------------------------
    // Kept exactly. A precise pair: snapping each side independently against a
    // focus that is not on the 8-grid pulls them out of true, so these opt out.
    {
      const rad = 157 * Math.PI / 180;
      const off = Math.round(Math.abs(Math.cos(rad)) * (R + 26));
      const ly = Math.round(FC.y + Math.sin(rad) * (R + 26));
      for (const side of [-1, 1]) {
        put('lamppost_twin', FC.x + side * off, ly, { flip: side > 0, solid: [8, 6], exact: true });
      }
    }
    if (!MACRO) {
      this.propGroups.push({ fn: (g) => {
        for (const d of this.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
      } });
      return;
    }

    area('belt');
    // ---- MASS E: THE OUTER TREE BELT --------------------------------------
    // Placed FIRST. Five masses of different size and shape, with concave and
    // convex edges rather than a row — some push inward, some pull out, and
    // the openings between them are as designed as the masses. The north-west
    // is short a mass because the lake shore starts at dx -342 there.
    const BELT = [
      { at: [-248, -216], trees: [['tree_oak_broad', 0, 0], ['tree_oak_spread', 54, 16],
          ['tree_oak_round', -52, 10], ['tree_young', 22, 34], ['tree_small_pine', -18, -26],
          ['tree_oak_round', 96, -8], ['tree_young', -92, -14]] },
      { at: [-408, 46], trees: [['tree_oak_spread', 0, 0], ['tree_oak_broad', 40, 44],
          ['tree_young', -30, 30], ['tree_small_pine', 18, -34], ['tree_oak_round', -34, -34]] },
      { at: [-336, 236], trees: [['tree_oak_broad', 0, 0], ['tree_oak_round', 58, -18],
          ['tree_young', -46, -22], ['tree_oak_spread', 20, 30], ['tree_sapling', -70, 14],
          ['tree_small_pine', 88, 10]] },
      { at: [336, -228], trees: [['tree_oak_broad', 0, 0], ['tree_oak_spread', -56, 18],
          ['tree_oak_round', 52, 22], ['tree_young', 12, 38], ['tree_small_pine', -22, -20],
          ['tree_young', 96, 4], ['tree_sapling', -96, 34]] },
      { at: [412, 128], trees: [['tree_oak_spread', 0, 0], ['tree_oak_broad', -44, 40],
          ['tree_oak_round', 34, -34], ['tree_young', -12, 58], ['tree_small_pine', 46, 30]] },
    ];
    BELT.forEach((m, i) => {
      m.trees.forEach(([nm, ox, oy], j) => {
        set(nm, m.at[0] + ox, m.at[1] + oy, { flip: (i + j) % 3 === 0 });
      });
    });

    area('nw');
    // ---- MASS A: THE NORTH-WEST CIVIC GARDEN ------------------------------
    // The largest designed space on the site, roughly twice the formal
    // garden's area. Built as a room: canopy along the back and west, three
    // flower beds inside it, a clearing in the middle and the open side facing
    // the plaza so the player can walk in.
    set('tree_oak_broad', -338, -196);
    set('tree_oak_spread', -276, -222, { flip: true });
    set('tree_blossom_blue', -206, -206);
    set('tree_oak_round', -350, -132, { flip: true });
    set('tree_blossom_violet', -160, -178);
    set('tree_oak_round', -330, -66);
    set('tree_young', -180, -132, { flip: true });
    bed(9100, -296, -168, BLUE, 16, 36);          // the large blue bed
    bed(9200, -212, -166, BLUEWHITE, 9, 24);      // blue/white, toward the road
    bed(9300, -318, -104, WHITEBLUE, 7, 20);      // small white, at the west edge
    set('bench_01', -250, -78, { solid: [26, 9] });          // faces the plaza
    set('bench_01', -336, -158, { flip: true, solid: [26, 9] });
    fenceRun(-368, -228, 2);
    set('signpost', -196, -96, { solid: [8, 6] });

    area('ne');
    // ---- MASS B: THE NORTH-EAST FORMAL GARDEN -----------------------------
    // Compact and the one geometric composition on the site: a tree behind,
    // two beds either side, matched containers, a bench square to them.
    set('tree_oak_round', 258, -230);
    set('tree_young', 314, -196, { flip: true });
    set('topiary_square', 214, -162, { solid: [18, 8], shadow: 7 });
    set('topiary_square', 300, -162, { flip: true, solid: [18, 8], shadow: 7 });
    bed(9400, 224, -198, YELLOW, 10, 22);
    bed(9500, 292, -196, ['flowers_white', 'flowers_yellow'], 7, 18);
    set('bench_01', 257, -132, { solid: [26, 9] });

    area('sw');
    // ---- MASS C: THE SOUTH-WEST PARK --------------------------------------
    // Three flowering trees set 42-48 apart against a 43-wide canopy, so the
    // crowns close over a single clearing instead of standing as three trees.
    set('tree_blossom_white', -268, 166);
    set('tree_blossom_white', -224, 150, { flip: true });
    set('tree_blossom_white', -248, 206);
    set('tree_oak_round', -308, 196, { flip: true });
    set('tree_young', -186, 214);
    set('bench_01', -212, 196, { solid: [26, 9] });
    bed(9600, -286, 236, WHITEBLUE, 9, 24);
    bed(9700, -170, 168, WHITEBLUE, 7, 20);
    fenceRun(-318, 134, 3);

    area('yard');
    // ---- MASS D: THE SOUTH-EAST WORK YARD ---------------------------------
    // The counterpoint to four organic gardens: a hard rectangle about 6 by 5
    // player widths, fenced on two and a half sides, open toward the plaza.
    // The goods are STACKED — authored offsets straight into put(), because
    // fits() would refuse every one of these overlaps.
    const YX = 232, YY = 168;
    set('tree_oak_round', YX - 96, YY - 84);
    set('tree_oak_spread', YX + 104, YY - 70, { flip: true });
    fenceRun(YX - 74, YY - 62, 4);                       // back edge
    fenceRun(YX + 106, YY - 46, 3, true);                // east return
    set('crate_stack', YX - 44, YY - 26, { solid: [20, 10], shadow: 9 });
    set('crate_01', YX - 28, YY - 34, { solid: [12, 7], shadow: 6 });
    set('crate_01', YX - 56, YY - 8, { flip: true, solid: [12, 7], shadow: 6 });
    set('crate_02', YX - 20, YY - 6, { solid: [12, 7], shadow: 6 });
    set('barrel_stack', YX + 12, YY - 30, { flip: true, solid: [18, 8], shadow: 9 });
    set('barrel_01', YX + 34, YY - 18, { solid: [12, 7], shadow: 6 });
    set('barrel_01', YX + 20, YY - 4, { flip: true, solid: [12, 7], shadow: 6 });
    set('barrel_02', YX + 48, YY - 32, { solid: [11, 6], shadow: 6 });
    set('sack_pile', YX - 44, YY + 14, { solid: [18, 8], shadow: 8 });
    set('sack_01', YX - 22, YY + 18, { shadow: 5 });
    set('hay_bale', YX + 62, YY + 4, { solid: [18, 7], shadow: 8 });
    set('hay_pile', YX + 80, YY + 22, { shadow: 11 });
    set('cart', YX + 54, YY + 34, { flip: true, solid: [24, 10], shadow: 11 });
    set('wheelbarrow', YX - 70, YY + 34, { solid: [22, 8], shadow: 10 });
    set('wood_pile_01', YX + 88, YY - 24, { solid: [20, 8], shadow: 9 });
    set('log_long', YX + 6, YY + 40, { flip: true, shadow: 10 });
    // the rest spot, OUTSIDE the entrance
    set('bench_01', YX - 118, YY + 26, { solid: [26, 9] });
    set('wooden_sign', YX - 124, YY - 4, { solid: [8, 5], shadow: 6 });
    bed(9800, YX - 96, YY + 66, MARKET, 9, 24);

    area('plaza');
    // ---- THE PLAZA TRANSITION ---------------------------------------------
    // THREE containers, not four. The fountain already supplies the symmetry;
    // a matching ring around it is what made the square read as laid out by a
    // machine. The north gateway keeps its matched pair because that is
    // architecture marking the way out, and it is the only mirrored thing here.
    set('topiary_round', -106, -106, { solid: [17, 8], shadow: 7 });
    set('topiary_round', 122, -84, { flip: true, solid: [17, 8], shadow: 7 });
    set('topiary_round', -118, 96, { solid: [17, 8], shadow: 7 });
    for (const side of [-1, 1]) {
      set('topiary_square', side * 44, -150, { flip: side > 0, solid: [18, 8], shadow: 7 });
    }
    set('flower_box_01', -150, 62, { solid: [18, 6], shadow: 8 });
    set('flower_box_02', 138, 78, { flip: true, solid: [18, 6], shadow: 8 });

    area('lamps');
    // ---- ROAD NAVIGATION LAMPS --------------------------------------------
    // One per road, well out from the square and beside the carriageway, each
    // with a companion so it is never a post alone in grass.
    for (const [dx, dy, mate, pal] of [
      // East moved up and out to the fork: the two carriageways diverge here
      // and leave a wedge of grass between them (clear dx 430-470 at dy 20-40,
      // sampled off roadCov), which reads as a junction rather than as a plain
      // stretch of kerb.
      [-92, -238, 'topiary_round', BLUEWHITE], [454, 28, 'topiary_round', YELLOW],
      [-330, 76, 'bench_01', WHITEBLUE], [-16, 236, 'signpost', MARKET],
    ]) {
      if (!set('lamppost_single', dx, dy, { flip: dx > 0, solid: [6, 5] })) continue;
      const side = dx > 0 ? -1 : 1;
      set(mate, dx + side * 36, dy + 14,
          { solid: mate === 'bench_01' ? [26, 9] : [17, 8], shadow: 7 });
      bed(9900 + Math.abs(dx), dx - side * 30, dy + 24, pal, 5, 16);
    }

    // A lane lamp at the bend in the east road, on the outside of the turn.
    // The coarse road rects describe that bend as a square step, but the
    // PAINTED road sweeps it into a diagonal — sampled from roadCov, the kerb
    // runs from about (dx 452, dy -38) down to (dx 340, dy 18). The first
    // attempt at dy -14 sat squarely on that paint and was rejected outright.
    // This stands on the grass wedge just above the kerb, flipped so the arm
    // and lantern reach back left over the corner rather than away from it.
    // NOTE the offset is one put() SNAPS TO: it rounds the world coordinate to
    // the 8-grid before testing clearance, so a spot that measures clear at an
    // arbitrary offset can still be rejected after snapping. Solved against
    // snapped positions — this one sits 8 units off the paint.
    set('lamppost_wood', 382, -20, { flip: true, solid: [6, 5] });

    // The farm's eastern boundary: a stone wall rather than more rail, so the
    // holding reads as closed on the side away from town. `_ns` is the
    // pre-rotated north-south cut — props only mirror, they cannot rotate.
    area('farm');
    for (let k = 0; k < 7; k++) {
      set('myst_wall_long_ns', 446, 96 + k * 37, { solid: [20, 10], holdOk: true });
    }

    // ---- THE CROP FIELD ---------------------------------------------------
    // Four beds around a walking cross. Laid on a strict lattice on purpose:
    // everything else on this site is deliberately irregular, and a field is
    // the one thing a town WOULD set out in rows — the straightness is what
    // makes it read as cultivated rather than wild.
    //
    // Plant spacing (17 x 15) is TIGHTER than the sprites are wide, so the
    // crops touch and overlap slightly. That is the whole difference between a
    // field and a grid of potted plants; at the old 24 x 22 every plant sat in
    // its own square of bare soil.
    //
    // Soil runs on its own coarser lattice, sized to reach a little past the
    // planting, so each bed gets a tilled margin instead of ending flush with
    // the outermost stalks. It goes down FLAT (it is ground) while the plants
    // stand as sorted entities, so the player passes behind the back rows and
    // in front of the near ones. Nothing here takes a solid — a field you
    // cannot walk into is a wall with vegetables painted on it.
    area('farm');
    {
      // EVERY pitch here is a multiple of the 8-unit snap grid, and every
      // offset lands on it — odd counts give whole multiples, even counts give
      // halves, which is why the even ones only use a 16 pitch (half of 16 is
      // still 8). put() snaps each prop to that grid, so a lattice that is not
      // aligned to it gets quantised unevenly: a 26 pitch came out 32/24/24/24
      // and tore visible slivers of grass through the middle of the beds.
      //
      // FY was 176, which put the top soil row at dy 52 — inside the road's
      // paint — so seven tiles of that row were silently rejected or nudged and
      // the beds came out with a torn top edge. One row further down clears it.
      const FX = 290, FY = 200;                 // field centre (both land on-grid)
      // The soil lattice is decoupled per axis. Square 24-pitch rows made each
      // bed 122 tall against planting that only reached 106, which left a bare
      // band of dirt running the full width above and below every bed. A
      // 16-pitch vertically brings the tilled ground to exactly the planting's
      // reach; the tiles overlap by 10, which is free now they are opaque and
      // their edges wrap.
      // The soil is deliberately SMALLER than the planting now. Pulled in at
      // the sides and pushed down at the back, so the crops overhang the bed
      // on three edges and only a lip of earth shows at the front. A plant
      // sitting wholly inside its patch of dirt reads flat; one breaking the
      // edge of it reads as standing up off the ground.
      const SC = 6, SSX = 16;                   // soil across: 5*16 + 26 = 106
      // One row FEWER down than across: the bed is trimmed top and bottom only,
      // so the crops break the earth at front and back while the sides keep
      // their margin. 4*16 + 26 = 90 against 106 across.
      const SR = 5, SSY = 16;                   // soil down:   4*16 + 26 = 90
      // The lip of bare earth at the FRONT of each bed equals this offset
      // exactly, and the back tuck is (sprite height - 26 + this). They are
      // locked together, so 8 was the smallest lip the snap grid could give.
      // The soil is therefore placed with `exact`, which skips snapping — the
      // lattice is computed on whole numbers anyway, so it stays perfectly
      // even and a 4 now survives instead of being rounded back out to 8.
      const SOFF = 8;                           // sits the shortened bed on the plant bases
      const PC = 7, PR = 6, PP = 16;            // planting, tighter than the sprites
      const GAP = 30;                           // clear walking lane between beds
      // Spacing is measured off the planting, not the soil, because the plants
      // are now the wider thing and they are what the eye reads as the bed.
      const OFFX = 76, OFFY = 68;               // both keep bed centres on-grid
      const BEDS = [
        [-1, -1, 'crop_carrot'], [1, -1, 'crop_cabbage'],
        [-1, 1, 'crop_wheat_01'], [1, 1, 'crop_mature_01'],
      ];
      for (const [sx, sy, crop] of BEDS) {
        const bx = FX + sx * OFFX, by = FY + sy * OFFY;
        // tilled ground: a solid, edge-wrapping tile, so the bed is one worked
        // surface rather than a grid of separate pads
        for (let j = 0; j < SR; j++) for (let i = 0; i < SC; i++) {
          set('soil_plot', bx + (i - (SC - 1) / 2) * SSX, by + (j - (SR - 1) / 2) * SSY + SOFF,
              { flat: true, flip: (i + j) % 3 === 0, exact: true });
        }
        // then the crop, pitched tighter than the sprites are wide so the
        // plants touch, and mirrored per plant so the rows are not a stamp
        // ---- the bed's fence ----------------------------------------------
        // Every piece in this pack is drawn FRONT-ON — there is no sprite for a
        // fence running away from camera — so the back and front rails are
        // proper runs and the sides are the picket block stacked down. The run
        // facing the central crossing is left OPEN rather than gated: these
        // beds are worked from the path, and a closed rail there would mean the
        // player could not step in at all.
        // The rail is 52 wide, so a 44 pitch threw the run out to +/-70 against
        // a bed that is only +/-53 of soil and +/-58 of planting — the fence
        // stuck out a dozen units past its own field at each end. A 34 pitch
        // lands the outer edge on +/-60: just past the crop and no further.
        const FL = bx - 60, FR = bx + 60;        // fence rectangle, just past the field
        const RP = 34;                           // rail pitch
        const FT = by - 54, FB = by + 46;
        // Back rail runs unbroken; the front carries the gate. The gate sprite
        // is already rail-post-door-post-rail, so it drops straight into the
        // run in place of the middle segment and the flanking rails overlap it
        // enough to read continuous.
        for (let i = -1; i <= 1; i++) {
          set('fence_run', bx + i * RP, FT, { solid: [36, 5], shadow: 0, holdOk: true });
        }
        set('fence_run', bx - RP, FB, { solid: [36, 5], shadow: 0, holdOk: true });
        set('fence_run', bx + RP, FB, { solid: [36, 5], shadow: 0, holdOk: true });
        // The gate is SHUT. The beds are enclosed on every side — the lanes
        // between them stay walkable, but the crop itself is not public ground.
        set('fence_gate', bx, FB, { solid: [54, 5], shadow: 0, holdOk: true });
        // Sides are a line of POSTS, not stacked picket sections. The picket
        // block is a face-on fence 38 units wide; stacking it built a wooden
        // wall two player-widths thick that swallowed the walking gap. A run of
        // posts is how a fence going away from camera reads in this view, and
        // at 5 wide it costs the path nothing. Only the outer side is fenced —
        // the bed stays open to the crossing it is worked from.
        for (let k = 0; k < 9; k++) {
          const yy = FT + 10 + k * 12;
          if (yy > FB) break;
          set('fence_post', FL + 2, yy, { shadow: 0, holdOk: true });
          set('fence_post', FR - 2, yy, { shadow: 0, holdOk: true });
        }
        // ONE solid per edge, not one per prop. The individual rail and post
        // boxes left 8-unit holes at the rail ends and 7-unit holes between
        // posts, and the player walked straight through them — measured, only
        // 5 of 20 edge samples actually blocked. A closed rectangle is
        // unambiguous, and it is what makes this a holding you cannot enter.
        {
          const wx = FC.x + bx, wyT = FC.y + FT, wyB = FC.y + FB;
          this.solids.push(
            { x: wx - 62, y: wyT - 4, w: 124, h: 8 },          // back rail
            { x: wx - 62, y: wyB - 4, w: 124, h: 8 },          // front rail + gate
            { x: wx - 64, y: wyT, w: 8, h: wyB - wyT },        // west posts
            { x: wx + 56, y: wyT, w: 8, h: wyB - wyT },        // east posts
          );
        }

        // Alternate rows interlock instead of lining up in a lattice — that is
        // how a bed is actually drilled, and the broken columns are what stop
        // it reading as a flat tiling. The staggered rows carry one plant FEWER
        // and sit inset by half a pitch, which keeps both edges of the bed
        // straight; simply shifting a full-length row sideways left every other
        // row poking 8 units past the right-hand edge. Half of 16 is 8, so both
        // arrangements still land on the snap grid.
        for (let j = 0; j < PR; j++) {
          const odd = j % 2 === 1;
          const n = odd ? PC - 1 : PC;
          for (let i = 0; i < n; i++) {
            set(crop, bx + (i - (n - 1) / 2) * PP, by + (j - (PR - 1) / 2) * PP,
                // No contact shadow: tried one, and a dark ellipse on dark
                // tilled soil is invisible — 168 extra draws and nothing to see.
                { flip: (i * 3 + j) % 2 === 0, shadow: 0 });
          }
        }
      }
    }

    if (MID) {
      area('mid');
      // ---- MID DETAIL ----------------------------------------------------
      // Strengthens what already exists; creates nothing new. Bushes go to
      // trunks, rocks to tree bases and garden edges, deadfall to the belt.
      const trees = this.decor.filter((d) => /^tree_/.test(d.name));
      trees.forEach((t, i) => {
        const h1 = hash(12000 + i * 5), h2 = hash(12001 + i * 5), h3 = hash(12002 + i * 5);
        const n = h1 < 0.30 ? 0 : h1 < 0.72 ? 1 : 2;
        for (let j = 0; j < n; j++) {
          const a = (h2 + j * 0.5) * Math.PI * 2, rr = 14 + h3 * 20;
          grow(pick(['bush_01', 'bush_02', 'bush_03', 'bush_low', 'bush_big', 'fern_clump'], h3 + j * 0.3),
               t.x - FC.x + Math.cos(a) * rr, t.y - FC.y + Math.sin(a) * rr * 0.62,
               { flip: h2 > 0.5, road: 24 }, 0.62);
        }
      });
      // rocks: seven clusters, all anchored to a canopy or a garden edge
      for (const [dx, dy] of [[-300, -218], [-372, 74], [-300, 240], [352, -212],
                              [402, 152], [-186, 152], [286, -232]]) {
        const h1 = hash(13000 + dx), h2 = hash(13001 + dx);
        if (!grow('rock_med_01', dx, dy, { flip: h1 > 0.5, road: 24 }, 0.5)) continue;
        grow(pick(['rock_small_01', 'rock_small_02', 'rock_small_03'], h2), dx + 16, dy + 8,
             { flip: h2 > 0.5, road: 22 }, 0.55);
        if (h1 > 0.5) grow(pick(['rock_small_02', 'rock_small_03'], h1), dx - 14, dy + 11,
                           { road: 22 }, 0.55);
      }
      // deadfall belongs to the belt and nowhere near the gardens
      for (const [nm, dx, dy] of [['fallen_log_01', -206, -232], ['tree_stump_01', -390, 82],
                                  ['fallen_log_02', -298, 254], ['tree_stump_02', 372, -206],
                                  ['fallen_branch', 430, 160], ['twig_pile', -238, -190]]) {
        grow(nm, dx, dy, { road: 24, shadow: 9 }, 0.5);
      }
      // secondary flower colour, at the edges of the masses only
      bed(14100, -352, -232, BLUE, 6, 20);
      bed(14200, 380, -252, YELLOW, 5, 18);
      bed(14300, -368, 262, WHITEBLUE, 6, 20);
      bed(14400, 300, 236, MARKET, 6, 20);
    }

    if (MICRO) {
      area('micro');
      // ---- MICRO DETAIL --------------------------------------------------
      // Boundaries only: where a mass meets lawn, and where grass meets stone.
      // Never in the middle of a designated lawn, and never on the paving.
      let mk = 15000;
      for (let i = 0; i < 150; i++) {
        const h1 = hash(mk++), h2 = hash(mk++), h3 = hash(mk++);
        const a = h1 * Math.PI * 2, rr = 150 + h2 * 300;
        const dx = Math.cos(a) * rr, dy = Math.sin(a) * rr * 0.62;
        if (Math.abs(dx) > 440 || Math.abs(dy) > 250) continue;
        grow(pick(['grass_tuft_01', 'grass_tuft_02', 'grass_tuft_03', 'grass_tuft_04',
                   'weeds_01', 'weeds_02'], h3), dx, dy,
             { flat: true, flip: h3 > 0.5, road: 14 }, 0.75);
      }
    }

    this.propGroups.push({ fn: (g) => {
      for (const d of this.groundDecor) drawPropArt(g, DECOR_ART[d.name], d.x, d.y, d.w, d.h, 0, d.flip);
    } });
  }

  // ---- Step 24: temporary development overview ----------------------------
  // Toggled from the console via `window.__townDebug = true` (paired with a
  // small `window.__townZoom` for whole-map screenshots). Draws the planned
  // road centerlines and district tags scaled to stay readable at any zoom.
  _drawDebugOverview(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const p of this.roadPlan) {
      g.strokeStyle = p.kind === 'adventure' ? 'rgba(226,124,60,0.85)'
        : p.kind === 'main' ? 'rgba(255,240,170,0.85)' : 'rgba(205,225,140,0.6)';
      g.lineWidth = Math.max(p.width * 0.3, 2 / Z);
      strokeRoundedPath(g, p.pts, 70);
    }
    const s = Math.max(2, Math.round(1.3 / Z));
    for (const [name, x, y] of this.debugLabels) {
      const w = textWidth(name, s) + 8 * s;
      rect(g, x - w / 2, y - 5 * s, w, 10 * s, 'rgba(10,8,20,0.75)');
      drawText(g, name, x, y - 3 * s, { color: '#ffd97a', align: 'center', scale: s });
    }
  }

  /** True if (x,y) sits inside (or near) any location's solid footprint. */
  _nearAnyDistrict(x, y, pad) {
    for (const l of this.locations) {
      if (!l.solid) continue;
      const s = l.solid;
      if (x > s.x - pad && x < s.x + s.w + pad && y > s.y - pad && y < s.y + s.h + pad) return true;
    }
    return false;
  }

  /** True if (x,y) sits within `pad` of any road rect (keeps trees off roads). */
  _nearAnyRoad(x, y, pad) {
    for (const r of this.roads) {
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    }
    return false;
  }

  exit() {}

  setOutcome(kind) {
    if (kind === 'victory') this.toasts.push('Returned victorious!', this.px, this.py - 30, UI.gold, { life: 2.5, vy: -3 });
    else if (kind === 'defeat') this.toasts.push('You retreat to recover.', this.px, this.py - 30, UI.bad, { life: 2.5, vy: -3 });
  }

  // ---- update -------------------------------------------------------------

  update(dt, game) {
    this.t += dt;
    this.toasts.update(dt);
    this.particles.update(dt);
    if (this.introHintT > 0) this.introHintT -= dt;
    if (this.districtBannerT > 0) this.districtBannerT -= dt;

    // (crystal motes are drawn in drawFountainFX's fxMotes — no generic
    // particle spawns needed here anymore)

    // wandering sanctuary pets
    for (const p of this.sanctuaryPets) {
      if (Math.hypot(p.x - p.tx, p.y - p.ty) < 3 || Math.random() < dt * 0.4) {
        p.tx = this.sanctuary.x + hash(this.t + p.x) * this.sanctuary.w;
        p.ty = this.sanctuary.y + hash(this.t * 1.3 + p.y) * this.sanctuary.h;
      }
      p.x = lerp(p.x, p.tx, dt * 1.2); p.y = lerp(p.y, p.ty, dt * 1.2);
    }

    if (this.overlay) { this.overlay.update(dt); return; }
    if (this.dialogue) { this._updateDialogue(dt); return; }

    // movement with per-axis collision
    const ax = Input.axis();
    this.moving = Math.abs(ax.x) > 0.05 || Math.abs(ax.y) > 0.05;
    if (this.moving) {
      const spd = 100 * (1 + this.hero.petBonus('moveSpeed'));
      this._tryMove(ax.x * spd * dt, 0);
      this._tryMove(0, ax.y * spd * dt);
      if (ax.x !== 0) this.facing = ax.x > 0 ? 1 : -1;
      this.walkT += dt;
      if (Math.random() < dt * 4) this.particles.dust(this.px, this.py, 1);
    }

    // camera follow with clamp (in zoomed world units). The player sits a little
    // below centre so there's headroom to see the roofs of buildings ahead.
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    // district banner on entry
    let region = null;
    for (const r of this.regions) if (this.px >= r.x && this.px <= r.x + r.w && this.py >= r.y && this.py <= r.y + r.h) { region = r.name; break; }
    if (region && region !== this.currentDistrict) { this.currentDistrict = region; this.districtBanner = region; this.districtBannerT = 2.4; }
    if (!region) this.currentDistrict = null;

    // nearest interactable
    this.near = null; let best = 1e9;
    for (const loc of this.locations) {
      if (!loc.action) continue;
      const d = Math.hypot(this.px - loc.dx, this.py - loc.dy);
      if (d < 30 && d < best) { best = d; this.near = loc; }
    }

    if (this.near && Input.pressed('interact')) this._enter(this.near);
    if (Input.pressed('inventory')) { Audio.confirm(); this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }); }
  }

  _tryMove(dx, dy) {
    const nx = clamp(this.px + dx, 10, MAP_W - 10);
    const ny = clamp(this.py + dy, 40, MAP_H - 10);
    const box = { x: (dx ? nx : this.px) - 5, y: (dy ? ny : this.py) - 4, w: 10, h: 6 };
    for (const s of this.solids) {
      if (box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y) return;
    }
    if (dx) this.px = nx;
    if (dy) this.py = ny;
  }

  _enter(loc) {
    Audio.confirm();
    switch (loc.action) {
      case 'training': this.hero.save(); this.hooks.toTraining(); break;
      case 'weapon': this.hero.save(); if (this.hooks.toWeaponShop) this.hooks.toWeaponShop(); break;
      case 'potion': this.hero.save(); if (this.hooks.toPotionShop) this.hooks.toPotionShop(); break;
      case 'market': this.overlay = new PotionShop(this.hero, () => { this.overlay = null; }); break;
      case 'pets': this.overlay = new InventoryMenu(this.hero, () => { this.overlay = null; }, 2); break;
      case 'library': this.hero.save(); if (this.hooks.toLibrary) this.hooks.toLibrary(); break;
      case 'quest': case 'guild': this._openQuest(loc.action === 'guild'); break;
      case 'dungeon': this._enterGate(); break;
      case 'rest': this._rest(); break;
      case 'house': this.hero.save(); if (this.hooks.toHouse) this.hooks.toHouse(); break;
    }
  }

  _rest() {
    const healed = this.hero.s.hp < this.hero.maxHp || this.hero.s.mana < this.hero.maxMana;
    this.hero.s.hp = this.hero.maxHp; this.hero.s.mana = this.hero.maxMana; this.hero.save();
    this.particles.pickup(this.px, this.py - 12, '#b58bff');
    this.toasts.push(healed ? 'The crystal restores you!' : 'Already at full health', this.px, this.py - 32, UI.good, { life: 1.6 });
    Audio.levelUp();
  }

  _openQuest(atGuild) {
    const q = this.hero.activeQuest();
    const who = atGuild ? 'Guildmaster' : 'Captain Mara';
    if (q) {
      this.dialogue = { speaker: q.giver, lines: [q.intro, 'Objective: ' + q.objective, 'Rewards: ' + this._rewardText(q) + '. Head to the Dungeon Gate when ready!'], idx: 0 };
    } else if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: who, lines: ['You cleared the goblin camp and felled their King. Embervale is in your debt!', 'Rest, train, and grow stronger — more adventures await.'], idx: 0 };
    } else {
      this.dialogue = { speaker: who, lines: ['No quests right now, hero. Come back soon.'], idx: 0 };
    }
    this.dialogueReveal = 0;
  }

  _rewardText(q) {
    const r = q.reward; const parts = [];
    if (r.gold) parts.push(r.gold + ' gold');
    if (r.xp) parts.push(r.xp + ' XP');
    if (r.item) parts.push('an item');
    if (r.petChance) parts.push('a pet egg');
    return parts.join(', ');
  }

  _enterGate() {
    if (this.hero.s.quests.completed.includes('goblin_trouble')) {
      this.dialogue = { speaker: 'Gate Guard', lines: ['The goblin threat is over. The gate is quiet now — return when new dangers stir.'], idx: 0 };
      this.dialogueReveal = 0; return;
    }
    this.dialogue = {
      speaker: 'Dungeon Gate',
      lines: ['Beyond lies the Goblin Camp and the Goblin King. Ready yourself, hero.'],
      idx: 0,
      onDone: () => { this.hero.save(); this.hooks.toDungeon(); },
    };
    this.dialogueReveal = 0;
  }

  _updateDialogue(dt) {
    this.dialogueReveal = Math.min(1, this.dialogueReveal + dt * 3);
    if (Input.anyPressed('confirm', 'interact', 'light')) {
      if (this.dialogueReveal < 1) { this.dialogueReveal = 1; return; }
      const d = this.dialogue;
      if (d.idx < d.lines.length - 1) { d.idx++; this.dialogueReveal = 0; Audio.select(); }
      else { const done = d.onDone; this.dialogue = null; if (done) done(); else Audio.confirm(); }
    }
    if (Input.pressed('menu')) { this.dialogue = null; Audio.deny(); }
  }

  // ---- draw ---------------------------------------------------------------

  draw(g) {
    const Z = (typeof window !== 'undefined' && window.__townZoom) || ZOOM;
    const visW = this.W / Z, visH = this.H / Z;
    this.camX = clamp(this.px - visW / 2, 0, MAP_W - visW);
    this.camY = clamp(this.py - visH * 0.62, 0, MAP_H - visH);

    // The transform the scene was handed, before its own camera scale/translate.
    // The night pass composites in this space (same one the HUD draws in), so a
    // screen-sized buffer lands 1:1 on the frame whatever the camera zoom is.
    this._baseTf = g.getTransform ? g.getTransform() : null;

    g.save();
    g.imageSmoothingEnabled = false;
    g.scale(Z, Z);
    g.translate(-Math.round(this.camX), -Math.round(this.camY));
    drawGround(this, g, visW, visH);

    // flat props drawn under entities (still get their own contact shadows)
    for (const pg of this.propGroups) pg.fn(g);

    // depth-sorted entities: lower on screen (larger y) draws in front. Trees
    // and the fountain are entities too, so the player naturally passes behind
    // things north of them and in front of things south of them.
    const ents = [];
    for (const loc of this.locations) ents.push({ y: loc.sortY != null ? loc.sortY : (loc.solid ? loc.solid.y + loc.solid.h : loc.dy), draw: (gg) => this._drawLocation(gg, loc) });
    for (const tr of this.trees) ents.push({ y: tr.y, draw: (gg) => bigTree(gg, tr.x, tr.y, tr.kind === 'pine' ? 'pine' : 'oak', this.t) });
    for (const d of this.decor) ents.push({ y: d.sortY, draw: (gg) => drawPropArt(gg, DECOR_ART[d.name], d.x, d.y, d.w, d.h, d.shadow, d.flip) });
    for (const n of this.npcs) ents.push({ y: n.y, draw: (gg) => { contactShadow(gg, n.x, n.y, 6, 2); drawActor(gg, { x: n.x, y: n.y, facing: n.facing, sprite: n.sprite, weapon: n.sprite === 'warrior' ? 'sword' : (n.sprite === 'mage' ? 'staff' : 'none'), state: 'idle', animTime: this.t + n.x }); } });
    for (const p of this.sanctuaryPets) ents.push({ y: p.y, draw: (gg) => drawPet(gg, p, p.x, p.y, this.t) });
    ents.push({ y: this.py, draw: (gg) => this._drawPlayer(gg) });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) e.draw(g);

    // Nightfall. Runs on the FINISHED frame and changes nothing but the light —
    // every prop, road and sprite is exactly where the daytime pass put it.
    drawNight(this, g, Z);

    this._drawNearPrompt(g);

    // development-only overview overlay (labels + road centerlines)
    if (typeof window !== 'undefined' && window.__townDebug) this._drawDebugOverview(g);

    // lamps + braziers glow on top
    for (const [x, y] of this.lamps) lamp(g, x, y, this.t);
    for (const [x, y] of this.braziers) brazier(g, x, y, this.t);
    for (const [x, y, hue, r] of this.crystalGlows) crystalGlow(g, x, y, this.t, hue, r);
    for (const b of this.butterflies) drawButterfly(g, b, this.t);

    this.particles.draw(g);
    this.toasts.draw(g);
    g.restore();

    this._drawHUD(g);

    if (this.overlay) this.overlay.draw(g, this.W, this.H);
    if (this.dialogue) {
      const d = this.dialogue;
      dialogue(g, this.W, this.H, d.speaker, d.lines[d.idx], this.dialogueReveal, {
        prompt: d.idx < d.lines.length - 1 ? 'J: more' : 'J: ok',
      });
    }
  }

  _drawLocation(g, loc) {
    loc.draw(g);
  }

  // The interaction prompt is world-space UI, drawn AFTER the depth-sorted
  // pass: it used to be painted inside _drawLocation, where anything south of
  // the location (the Eldertree's colonnade, plaza planting by the fountain)
  // could draw over the text.
  _drawNearPrompt(g) {
    const loc = this.near;
    if (loc) {
      const label = loc.label || { training: 'Enter Training Grounds', weapon: 'Enter Weapon Shop', potion: 'Enter Potion Shop', market: 'Browse Market', pets: 'Visit Pet Keeper', library: 'Enter Library', quest: 'Read Quest Board', guild: 'Enter Guild', dungeon: 'Enter Dungeon', rest: 'Rest', house: 'Enter Your House' }[loc.action] || 'Enter';
      const w = textWidth('[E] ' + label) + 12;
      // at the location's foot, but never over the player: when they stand
      // south of the point (inside the near radius) drop it below their feet
      const py = Math.max(loc.dy + 2, this.py + 3);
      panel(g, loc.dx - w / 2, py, w, 13, { bg: 'rgba(12,10,22,0.9)' });
      const blink = Math.floor(this.t * 3) % 2 === 0;
      drawText(g, '[E] ' + label, loc.dx, py + 3, { color: blink ? UI.gold : UI.ink, align: 'center' });
    }
  }

  _drawPlayer(g) {
    const pet = this.hero.pet();
    if (pet) drawPet(g, pet, this.px - this.facing * 14, this.py - 16, this.t);
    drawCharacter(g, {
      x: this.px, y: this.py, z: 0, facing: this.facing,
      sprite: this.hero.cls().sprite, weapon: this.hero.weaponSprite(),
      state: this.moving ? 'walk' : 'idle', animTime: this.moving ? this.walkT : this.t,
    });
  }

  // ---- ground -------------------------------------------------------------

  // (The old tile-grid road painter lived here. It has been replaced by
  // _drawRoads() above, which paints from the finer coverage map so each
  // family keeps its real designed width, and which drives the adventure
  // decay from progress along the route rather than the old fixed world-Y
  // threshold — that constant went stale the moment districts moved.)

  // ---- HUD + banners ------------------------------------------------------

  _drawHUD(g) {
    // slim plate: class + level, HP, gold
    const pw = 118, ph = 22;
    panel(g, 4, 4, pw, ph, { bg: 'rgba(12,10,22,0.82)' });
    drawText(g, `${this.hero.cls().name}`, 8, 6, { color: UI.ink });
    drawText(g, `Lv ${this.hero.s.level}`, pw - 2, 6, { color: UI.gold, align: 'right' });
    bar(g, 8, 15, this.hero.s.hp, this.hero.maxHp, { w: 74, h: 4, color: '#e0483c' });
    drawIcon(g, 'coin', pw - 26, 13);
    drawText(g, `${this.hero.s.gold}`, pw - 16, 14, { color: UI.gold });

    // transient district banner (top-center, fades)
    if (this.districtBannerT > 0 && this.districtBanner) {
      const a = clamp01(Math.min(1, this.districtBannerT * 1.5) * Math.min(1, (this.districtBannerT) * 2));
      g.globalAlpha = a;
      const w = textWidth(this.districtBanner, 2) + 24;
      const bx = this.W / 2 - w / 2;
      rect(g, bx, 12, w, 18, 'rgba(12,10,22,0.7)');
      rect(g, bx, 12, w, 1, UI.gold); rect(g, bx, 29, w, 1, UI.gold);
      drawText(g, this.districtBanner.toUpperCase(), this.W / 2, 15, { color: UI.gold, align: 'center', scale: 2, shadow: '#000' });
      g.globalAlpha = 1;
    }

    // one-time control hint on load, then gone
    if (this.introHintT > 0) {
      g.globalAlpha = clamp01(Math.min(1, this.introHintT));
      drawText(g, 'WASD move   E interact   I inventory', this.W / 2, this.H - 10, { color: 'rgba(230,223,251,0.55)', align: 'center' });
      g.globalAlpha = 1;
    }
  }
}

// ============================================================ shared drawers

