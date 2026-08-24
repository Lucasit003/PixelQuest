# Pixel Quest — architecture map

Vanilla ES modules + Canvas 2D. **No build step, no dependencies, no package.json.**
Run with `python3 -m http.server` and open `index.html`. Internal resolution is
**480×270**, CSS-upscaled with `image-rendering: pixelated`.

13,373 lines of JS across 26 files.

```
PIXEL QUEST
│
├── PLAYER
│   ├── movement       scenes/town.js  (_tryMove, camera clamp) · scenes/combat.js (_updatePlayer)
│   ├── animation      gfx/actors.js   drawCharacter / drawActor / SPECS / PALETTES
│   ├── combat         scenes/combat.js  _startAttack, _useAbility, _cast{Projectile,Aoe,Chain,Buff}
│   └── progression    game/state.js   Hero class · game/data.js  xpForLevel, masteryGain
│
├── WORLD  — scenes/town.js is the scene; scenes/town/* are its systems
│   ├── maps           town/layout.js   buildTown() — 3600×4400 units, all districts
│   │                                    derived from PZ = {x:2050, y:2750}
│   ├── roads          town/roads.js    buildRoadCoverage() → roadCov (4-unit cells)
│   │                                    + the five material families
│   ├── ground         town/ground.js   grass, plaza floor, flares, corruption
│   ├── tiles          town/tiles.js    ground/paving art registry (shared: roads
│   │                                    and the plaza sample the same stone pack)
│   ├── props          town/props.js    DECOR_SIZE/DECOR_ART registry + procedural
│   │                                    street furniture, trees, the Eldertree
│   ├── dressing       town/plaza.js        Crystal Plaza — an AUTHORED level
│   │                  town/lake.js         pond art, water collision, shoreline
│   │                  town/ancientcity.js  Eldertree glade, four outside-in passes
│   ├── buildings      town/buildings.js  authored PNGs + procedural structures
│   ├── fountain       town/fountain.js   the plaza centrepiece and its water FX
│   ├── collisions     scene.solids (axis-aligned rects), filled by layout.js
│   ├── interiors      scenes/{house,library,potionshop,weaponshop}.js
│   ├── lighting       town/lighting.js drawNight() + NIGHT (multiply + light holes)
│   ├── town UI        town/hud.js          composes gfx/ui.js — not a second one
│   ├── interactions   town/interactions.js what [E] does + the dialogue box
│   └── water/wildlife gfx/waterfx.js  ducks, ducklings, frogs, fish, lily pads
│
├── ENTITIES
│   ├── enemies        game/data.js ENEMIES (5)  ·  AI hardcoded in scenes/combat.js
│   ├── NPCs           scenes/town.js  this.npcs  (positions + sprite only)
│   └── wildlife       gfx/waterfx.js  (lake-only; formation maths, not an entity system)
│
├── CONTENT
│   ├── quests         game/state.js  QUESTS (1 entry)
│   ├── dialogue       inline strings in scene files
│   ├── shops          scenes/menus.js WeaponShop/PotionShop → read game/data.js
│   └── education      academics/bank.js  BANK: 7 subjects × 3 levels
│                      academics/adaptive.js  AdaptiveSession (tier ladder)
│
├── ASSETS
│   ├── assets/props/        294 baked, game-ready sprites (288 wired via DECOR_SIZE)
│   ├── assets/props/_src/   177 full-resolution cut masters
│   ├── assets/ground/       grass + meadow tiles
│   ├── assets/plaza/        stone pack for roads and paving
│   ├── assets/*.png         buildings, interiors, fountain, wildlife sheets
│   └── assets/*.jpeg|jpg    uncut source catalogue sheets
│
└── DEVELOPMENT TOOLS
    ├── dev_plaza.html       boots TownScene directly; ?shot ?zoom ?cx ?cy ?only ?stage
    ├── pondfx_*.html        9 water/wildlife iteration harnesses
    ├── tools/sheetcut.py    index + cut sprites from catalogue sheets
    ├── tools/bake_props.py  resample masters to DECOR_SIZE draw sizes
    └── window.__*           console-only toggles (see below)
```

## Core loop

`src/main.js` → `core/loop.js` `Game` → `scene.update(dt, game)` then `scene.draw(g, game)`.
Screen shake is exposed via `game.shakeOffset()` and applied per-scene, never globally,
so the HUD stays still. Scenes are swapped with `game.setScene()`.

## Scene graph

`TitleScene → ClassSelectScene → TownScene ⇄ {House, Library, PotionShop, WeaponShop,
Training, Combat}`

## Existing console hooks

`__game`, `__townZoom`, `__townDebug`, `__townNight`, `__NIGHT`, `__plazaStage`,
`__plazaOnly`, `__duckTrace`, `__duckFrame`. All console-only — there is no in-game
debug menu and no debug key bindings.

## Save

`core/save.js` — single localStorage slot, key `pixelquest.save.v1`, versioned shape.

## Notable size concentrations

| File | Lines | Methods |
|---|---|---|
| `scenes/combat.js` | 1,568 | 94 |
| `gfx/waterfx.js` | 1,491 | — |
| `scenes/town.js` + `scenes/town/*` | 5,266 across 16 files | — |
| everything else | 5,398 | — |

`town.js` itself is 256 lines: construct, enter, update, draw, movement and two
spatial queries. It coordinates the sixteen modules above rather than
implementing them. The largest single town module is `town/plaza.js` (738),
which is authored level content and is *meant* to be long.
