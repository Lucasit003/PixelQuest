# PQDev — development console

Open the game on localhost (or add `?dev=1`), then use `PQDev` in the browser
console. `PQDev.help()` prints the same summary in-game.

Installed from `src/dev/console.js`, wired in `src/main.js` with one import and one
call. It self-disables off localhost unless `?dev=1` is present.

## Getting started

```js
PQDev.start()            // boot past the title into town (default warrior)
PQDev.start('mage')
PQDev.help()
```

Everything else needs a hero, so `start()` comes first on a cold load.

## Navigation

```js
PQDev.tp('lake')         // alias of teleport()
PQDev.where()            // 27 place ids, read live from the scene
PQDev.town()  PQDev.dungeon()  PQDev.training()
```

Place ids come from the map itself (`scene.districts` + `scene.locations`), so they
stay correct when the map moves — nothing is duplicated here. Teleporting from
another scene routes to town first and finishes the jump when it loads.

Useful ids: `plaza lake library weapon potion market home guild pets training watch
dungeon eldertree residential`, plus aliases `forge archive sanctuary valorhall gate`.

## Player

```js
PQDev.setClass('mage')       // any of the 7 classes; recomputes stats
PQDev.weapon('dragon')       // fuzzy — 'dragon cleaver', 'dragon-cleaver' also work
PQDev.give('health', 5)      // potion, weapon or trinket by id
PQDev.ability('all')         // unlock + slot every ability for the current class
PQDev.heal()                 // hp, mana and stamina to full
PQDev.setLevel(8)
PQDev.god()                  // toggle; tops resources back up every tick
```

Ids are matched loosely everywhere, so exact snake_case is never required.

## Combat

```js
PQDev.dungeon()              // enter combat first
PQDev.spawn('goblin')        // enemy ids: goblin slime slime_blue skeleton skeleton_archer
PQDev.spawn('slime', 5)      // spread ahead of the player, not stacked
PQDev.clearEnemies()
PQDev.ai()                   // toggle enemy AI (freezes them in place)
```

## Visual debugging

```js
PQDev.hitboxes()    // player green / enemies red (combat)
PQDev.collision()   // solid rects in cyan (town)
PQDev.coords()      // player xy + current district
PQDev.fps()         // fps, prop count, enemy count
PQDev.night()  PQDev.day()
PQDev.zoom(1.1)     // camera zoom; no argument resets
PQDev.debug()       // the pre-existing district/road overlay
PQDev.flags()       // what is currently on
```

Readout draws top-right, clear of the game HUD. Toggles flip with no argument;
pass `true`/`false` to force.

## Iteration

```js
PQDev.reload()      // rebuild the current area from scratch
PQDev.shot('name')  // save the canvas as a PNG (exactly what was drawn)
```

## Presets

```js
PQDev.preset('plaza')          // Crystal Plaza, daylight
PQDev.preset('lake')           // lake shore, zoomed for review
PQDev.preset('ancient-city')   // → Eldertree glade (see limitation below)
PQDev.preset('night')          // plaza at night
PQDev.preset('farm')           // market / farm side
PQDev.preset('warrior-test')   // warrior L8, all abilities, god on, in the dungeon
PQDev.preset('mage-test')  PQDev.preset('rogue-test')
```

Combat presets drop you in the dungeon ready to fight; spawn something to hit with
`PQDev.spawn('goblin', 3)`.

## Limitations

- **No "Ancient Crystal City" exists in the map.** `preset('ancient-city')` warns and
  goes to the Eldertree glade, the nearest ruined-stone location that is actually
  built.
- **Quest and academic manipulation are deliberately absent** — those systems are
  expected to change, and tooling built against them now would be rewritten.
- **`ai()` freezes enemies in place** by skipping their update; it does not give them
  a separate idle behaviour.
- `reload()` rebuilds town and dungeon only; other scenes report that they have no
  reload route.
- The preview pane throttles `requestAnimationFrame` when backgrounded. If commands
  appear to do nothing in an automated session, pump the loop manually:
  `for (let i=0;i<120;i++){ __game._update(1/60); __game._draw(); }`
