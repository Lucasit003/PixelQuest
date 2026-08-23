# Pixel Quest — architecture map

Vanilla ES modules + Canvas 2D. **No build step, no dependencies, no package.json.**
Run with `python3 -m http.server` and open `index.html`. Internal resolution is
**480×270**, CSS-upscaled with `image-rendering: pixelated`.

13,373 lines of JS across 26 files.

```
PIXEL QUEST
│
├── PLAYER
│   ├── movement       scenes/town.js  (_move, camera clamp)   · scenes/combat.js (_updatePlayer)
│   ├── animation      gfx/actors.js   drawCharacter / drawActor / SPECS / PALETTES
│   ├── combat         scenes/combat.js  _startAttack, _useAbility, _cast{Projectile,Aoe,Chain,Buff}
│   └── progression    game/state.js   Hero class · game/data.js  xpForLevel, masteryGain
│
├── WORLD
│   ├── maps           scenes/town.js  _buildTown()  — 3600×4400 world units, all districts
│   │                                   derived from PZ = {x:2050, y:2750}
│   ├── roads          scenes/town.js  _buildRoadCoverage() → roadCov (4-unit cells)
│   ├── props          scenes/town.js  _buildPlazaDecor()  — authored level, ~300 lines
│   ├── collisions     scenes/town.js  this.solids (axis-aligned rects)
│   ├── interiors      scenes/{house,library,potionshop,weaponshop}.js
│   ├── lighting       scenes/town.js  _drawNight() + NIGHT table  (multiply buffer + light holes)
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
| `scenes/town.js` | 4,916 | 198 |
| `scenes/combat.js` | 1,568 | 94 |
| `gfx/waterfx.js` | 1,491 | — |
| everything else | 5,398 | — |
