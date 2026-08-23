// Development console. Nothing in here runs in a release build: install() is
// called once from main.js and returns immediately unless the page is served
// from localhost or carries ?dev=1.
//
// The design rule is that this file must never require an edit to a gameplay
// file. Everything it needs it gets by (a) reading state the scenes already
// expose, and (b) wrapping the two Game methods at install time. That keeps the
// harness deletable in one step and means it cannot drift out of sync with
// systems it does not touch.
//
// Location data is NOT duplicated here. Teleports read `scene.districts` (the
// D table `_buildTown` already publishes) and `scene.locations`, so the harness
// stays correct when the map moves.

import { CLASSES, WEAPONS, ABILITIES, ENEMIES, POTIONS, abilitiesForClass } from '../game/data.js';
import { CombatScene } from '../scenes/combat.js';
import { Hero } from '../game/state.js';

const ON = () => {
  if (typeof window === 'undefined') return false;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '' || location.search.includes('dev');
};

// Toggles live here rather than on window so there is one namespace to inspect.
// The three that already existed as globals (__townNight, __townDebug,
// __townZoom) are driven through those globals, not re-implemented.
const flags = { god: false, hitboxes: false, collision: false, coords: false, fps: false, aiOff: false };

let game = null;
let routes = null;
const fpsHist = [];

// ---------------------------------------------------------------- helpers

const scene = () => game && game.scene;
const isTown = () => { const s = scene(); return s && s.locations && s.districts; };
const isCombat = () => scene() instanceof CombatScene;
const hero = () => { const s = scene(); return s && s.hero; };

function need(test, msg) {
  if (!test) { console.warn('[PQDev] ' + msg); return false; }
  return true;
}

// Fuzzy id match so `weapon('dragon cleaver')`, `'dragon-cleaver'` and
// `'dragoncleaver'` all land. Typing exact snake_case ids from memory is the
// kind of friction this harness exists to remove.
function findId(table, q) {
  if (!q) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(q);
  const keys = Object.keys(table);
  return keys.find((k) => norm(k) === t)
      || keys.find((k) => norm(table[k].name || '') === t)
      || keys.find((k) => norm(k).includes(t))
      || keys.find((k) => norm(table[k].name || '').includes(t))
      || null;
}

// ---------------------------------------------------------------- navigation

// Every place the player can stand, assembled from what the scene publishes.
// `districts` covers the raw anchors (including lake and gate); `locations`
// adds the interactable buildings with their doorstep offsets, which are the
// better target when both exist.
function places() {
  const s = scene();
  if (!isTown()) return {};
  const out = {};
  for (const [k, p] of Object.entries(s.districts)) out[k] = { x: p.x, y: p.y, from: 'district' };
  for (const loc of s.locations) out[loc.id] = { x: loc.dx, y: loc.dy + 26, from: 'location', name: loc.name };
  // A couple of aliases for names that are said out loud more often than the id.
  const alias = { forge: 'weapon', archive: 'library', sanctuary: 'pets',
                  valorhall: 'training', watchtower: 'watch', gate: 'dungeon' };
  for (const [a, real] of Object.entries(alias)) if (out[real] && !out[a]) out[a] = out[real];
  if (s.lakeTopLeft) out.lake = { x: s.lakeTopLeft.x + 408, y: s.lakeTopLeft.y + 440, from: 'lake shore' };
  return out;
}

// If you are not in town, route there and finish the teleport once the scene
// swap lands. A teleport that silently does nothing because you happened to be
// in the dungeon is exactly the kind of friction this harness is for — and the
// swap is asynchronous, so it has to be picked up by the update wrapper.
let pendingTp = null;

function teleport(where) {
  if (!isTown()) {
    if (!need(routes && hero(), 'no hero yet — run PQDev.start() first')) return;
    pendingTp = where;
    routes.town(hero());
    console.log('[PQDev] routing to town, then →', where);
    return where;
  }
  const p = places();
  const key = findId(p, where) || (p[where] ? where : null);
  if (!key) { console.warn('[PQDev] unknown place:', where, '\n  try:', Object.keys(p).sort().join(', ')); return; }
  const s = scene();
  s.px = p[key].x; s.py = p[key].y;
  console.log('[PQDev] →', key, `(${Math.round(s.px)}, ${Math.round(s.py)})`, p[key].name || '');
  return key;
}

// ---------------------------------------------------------------- player

function setClass(id) {
  const h = hero();
  if (!need(h, 'no hero in this scene')) return;
  const key = findId(CLASSES, id);
  if (!key) { console.warn('[PQDev] unknown class. have:', Object.keys(CLASSES).join(', ')); return; }
  h.s.class = key;
  h.s.name = CLASSES[key].name;
  h.recompute();
  h.s.hp = h.maxHp; h.s.mana = h.maxMana;
  const s = scene();
  if (s && s.p) { s.p.sprite = h.cls().sprite; s.p.weapon = h.weaponSprite(); }
  console.log('[PQDev] class →', key);
  return key;
}

function weapon(id) {
  const h = hero();
  if (!need(h, 'no hero')) return;
  const key = findId(WEAPONS, id);
  if (!key) { console.warn('[PQDev] unknown weapon. have:', Object.keys(WEAPONS).join(', ')); return; }
  if (!h.s.inventory.weapons.includes(key)) h.s.inventory.weapons.push(key);
  h.equip(key);
  const s = scene();
  if (s && s.p) s.p.weapon = h.weaponSprite();
  console.log('[PQDev] equipped', key, '—', WEAPONS[key].name);
  return key;
}

function give(id, n = 1) {
  const h = hero();
  if (!need(h, 'no hero')) return;
  const pot = findId(POTIONS, id);
  if (pot) { h.addPotion(pot, n); console.log('[PQDev] +' + n, pot, 'potion'); return pot; }
  const w = findId(WEAPONS, id);
  if (w) { if (!h.s.inventory.weapons.includes(w)) h.s.inventory.weapons.push(w); console.log('[PQDev] +', w); return w; }
  h.addItem(id);
  console.log('[PQDev] +', id, '(as trinket)');
  return id;
}

function ability(id) {
  const h = hero();
  if (!need(h, 'no hero')) return;
  if (id === undefined || id === 'all') {
    const list = abilitiesForClass(h.s.class).map((a) => a.id);
    for (const a of list) if (!h.s.unlocked.includes(a)) h.s.unlocked.push(a);
    for (let i = 0; i < 4; i++) h.s.equippedAbilities[i] = list[i] || null;
    console.log('[PQDev] unlocked + slotted all', list.length, 'abilities for', h.s.class);
    return list;
  }
  const key = findId(ABILITIES, id);
  if (!key) { console.warn('[PQDev] unknown ability'); return; }
  if (!h.s.unlocked.includes(key)) h.s.unlocked.push(key);
  const slot = h.s.equippedAbilities.indexOf(null);
  if (slot >= 0) h.s.equippedAbilities[slot] = key;
  console.log('[PQDev] unlocked', key);
  return key;
}

function heal() {
  const h = hero();
  if (!need(h, 'no hero')) return;
  h.recompute();
  h.s.hp = h.maxHp; h.s.mana = h.maxMana;
  const s = scene();
  if (s && s.p) { s.p.hp = s.p.maxHp; s.p.mana = s.p.maxMana; s.p.sta = s.p.maxSta; }
  console.log('[PQDev] restored — hp', h.maxHp, 'mana', h.maxMana);
}

function setLevel(n) {
  const h = hero();
  if (!need(h, 'no hero')) return;
  h.s.level = Math.max(1, Math.floor(n));
  h.recompute();
  h.s.hp = h.maxHp; h.s.mana = h.maxMana;
  console.log('[PQDev] level →', h.s.level, '(hp', h.maxHp + ')');
}

// God mode is enforced in the update wrapper rather than by editing combat.js:
// resources are topped back up after every tick, so nothing in the damage path
// needs to know this exists.
function god(on) {
  flags.god = on === undefined ? !flags.god : !!on;
  if (flags.god) heal();
  console.log('[PQDev] god mode', flags.god ? 'ON' : 'off');
  return flags.god;
}

// ---------------------------------------------------------------- combat

function spawn(type, n = 1) {
  if (!need(isCombat(), 'spawn needs the combat scene — use PQDev.dungeon() first')) return;
  const key = findId(ENEMIES, type);
  if (!key) { console.warn('[PQDev] unknown enemy. have:', Object.keys(ENEMIES).join(', ')); return; }
  const s = scene();
  const made = [];
  for (let i = 0; i < n; i++) {
    // Spread them ahead of the player so a group is immediately visible rather
    // than stacked on one pixel.
    const x = s.p.x + 90 + (i % 4) * 34 + Math.random() * 10;
    const depth = 170 + Math.floor(i / 4) * 26 + Math.random() * 20;
    made.push(s._spawnEnemy(key, x, depth));
  }
  console.log('[PQDev] spawned', n, '×', key, '— total now', s.enemies.length);
  return made;
}

function clearEnemies() {
  if (!need(isCombat(), 'no combat scene')) return;
  const s = scene();
  const n = s.enemies.length;
  s.enemies.length = 0;
  console.log('[PQDev] cleared', n, 'enemies');
  return n;
}

// Freezing AI patches the scene's own _updateEnemies behind a flag check. The
// patch is idempotent and self-removing in effect (the flag gates it), so
// toggling it repeatedly cannot stack wrappers.
function ai(on) {
  flags.aiOff = on === undefined ? !flags.aiOff : !on;
  console.log('[PQDev] enemy AI', flags.aiOff ? 'FROZEN' : 'running');
  return !flags.aiOff;
}

function patchCombat(s) {
  if (!s || s.__pqPatched) return;
  s.__pqPatched = true;
  const orig = s._updateEnemies.bind(s);
  s._updateEnemies = (dt) => { if (!flags.aiOff) orig(dt); };
}

// ---------------------------------------------------------------- visual

const toggle = (k) => (on) => {
  flags[k] = on === undefined ? !flags[k] : !!on;
  console.log('[PQDev]', k, flags[k] ? 'ON' : 'off');
  return flags[k];
};

function night(on) {
  const v = on === undefined ? !(window.__townNight !== false) : !!on;
  window.__townNight = v;             // the lighting pass already reads this
  console.log('[PQDev]', v ? 'night' : 'day');
  return v;
}
const day = () => night(false);

function zoom(z) {
  if (z === undefined) { window.__townZoom = null; console.log('[PQDev] zoom reset'); return; }
  window.__townZoom = z;
  console.log('[PQDev] zoom', z);
}

// ---------------------------------------------------------------- iteration

// Boot straight past the title into town with a fresh hero. Without this the
// whole harness is unreachable on a cold load, because every other command
// needs a hero and the title screen has not made one yet.
function start(cls = 'warrior') {
  const key = findId(CLASSES, cls) || 'warrior';
  const h = Hero.create(key);
  routes.town(h);
  console.log('[PQDev] started as', key, '— give it a moment, then PQDev.help()');
  return key;
}

function reload() {
  const s = scene();
  if (!need(s && routes, 'nothing to reload')) return;
  const h = hero();
  if (isTown() && routes.town) { routes.town(h); console.log('[PQDev] town rebuilt'); return; }
  if (isCombat() && routes.dungeon) { routes.dungeon(h); console.log('[PQDev] dungeon rebuilt'); return; }
  console.warn('[PQDev] no reload route for', s.constructor.name);
}

// Screenshot uses the real canvas, so what lands on disk is exactly what the
// game drew — including any dev overlay that is currently on.
function shot(name) {
  const c = document.querySelector('canvas');
  if (!need(c, 'no canvas')) return;
  c.toBlob((b) => {
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'pq_' + Date.now()) + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    console.log('[PQDev] saved', a.download, `(${c.width}×${c.height})`);
  }, 'image/png');
}

// ---------------------------------------------------------------- presets

// Deliberately not a framework — a lookup of small functions. Each one leaves
// the game in a state you can immediately act in.
const PRESETS = {
  plaza() { teleport('plaza'); day(); },
  lake() { teleport('lake'); day(); zoom(1.1); },
  'ancient-city'() {
    // There is no Ancient Crystal City in the map yet; the Eldertree glade is
    // the closest ruined-stone location that exists.
    console.warn('[PQDev] no "Ancient Crystal City" location exists — going to the Eldertree glade');
    teleport('eldertree'); day();
  },
  night() { teleport('plaza'); night(true); },
  farm() { teleport('market'); day(); },
  'warrior-test'() { combatTest('warrior'); },
  'mage-test'() { combatTest('mage'); },
  'rogue-test'() { combatTest('rogue'); },
};

function combatTest(cls) {
  setClass(cls);
  setLevel(8);
  ability('all');
  heal();
  god(true);
  if (routes && routes.dungeon) {
    routes.dungeon(hero());
    console.log('[PQDev] entering dungeon — spawn enemies once it loads: PQDev.spawn("goblin", 3)');
  }
}

function preset(name) {
  const fn = PRESETS[name] || PRESETS[findId(PRESETS, name)];
  if (!fn) { console.warn('[PQDev] presets:', Object.keys(PRESETS).join(', ')); return; }
  fn();
  return name;
}

// ---------------------------------------------------------------- overlay

// Drawn after the scene, in screen space, so it never disturbs the world
// transform or the depth sort.
function overlay(g) {
  const s = scene();
  if (!s) return;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);

  if (flags.collision && s.solids && s.camX !== undefined) {
    const Z = (window.__townZoom) || 1.6;
    g.strokeStyle = 'rgba(90,200,255,0.85)'; g.lineWidth = 1;
    for (const o of s.solids) {
      const x = (o.x - s.camX) * Z, y = (o.y - s.camY) * Z;
      const w = o.w * Z, h = o.h * Z;
      if (x > 480 || y > 270 || x + w < 0 || y + h < 0) continue;
      g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    }
  }

  if (flags.hitboxes && isCombat()) {
    g.lineWidth = 1;
    const box = (e, col) => {
      const w = (e.w || 16), h = 26;
      g.strokeStyle = col;
      g.strokeRect(Math.round(e.x - w / 2) + 0.5, Math.round(e.depth - h) + 0.5, w, h);
    };
    for (const e of s.enemies || []) box(e, 'rgba(255,80,80,0.9)');
    if (s.p) box(s.p, 'rgba(120,255,120,0.9)');
  }

  const lines = [];
  if (flags.coords) {
    if (s.px !== undefined) lines.push(`xy ${Math.round(s.px)}, ${Math.round(s.py)}`);
    else if (s.p) lines.push(`x ${Math.round(s.p.x)} depth ${Math.round(s.p.depth)}`);
    if (s.currentDistrict) lines.push(String(s.currentDistrict));
  }
  if (flags.fps && fpsHist.length) {
    const avg = fpsHist.reduce((a, b) => a + b, 0) / fpsHist.length;
    const n = (s.decor ? s.decor.length : 0) + (s.groundDecor ? s.groundDecor.length : 0);
    lines.push(`${avg.toFixed(0)} fps` + (n ? `  ${n} props` : '') +
               (s.enemies ? `  ${s.enemies.length} enemies` : ''));
  }
  if (flags.god) lines.push('GOD');
  if (flags.aiOff) lines.push('AI FROZEN');

  if (lines.length) {
    // Top-RIGHT: the game's own HUD panel owns the top-left corner, and the
    // readout was landing on top of the level and gold display.
    g.font = '8px monospace'; g.textBaseline = 'top';
    const w = Math.max(...lines.map((l) => l.length)) * 5 + 8;
    const x = 480 - w - 2;
    g.fillStyle = 'rgba(8,6,16,0.72)';
    g.fillRect(x, 2, w, lines.length * 10 + 4);
    g.fillStyle = '#8df0a0';
    lines.forEach((l, i) => g.fillText(l, x + 4, 5 + i * 10));
  }
  g.restore();
}

// ---------------------------------------------------------------- install

export function installDevConsole(g, r) {
  if (!ON()) return null;
  game = g; routes = r;

  const origUpdate = game._update.bind(game);
  game._update = (dt) => {
    origUpdate(dt);
    if (dt > 0) { fpsHist.push(1 / dt); if (fpsHist.length > 30) fpsHist.shift(); }
    const s = scene();
    if (s instanceof CombatScene) patchCombat(s);
    if (pendingTp && isTown() && s.locations) { const w = pendingTp; pendingTp = null; teleport(w); }
    if (flags.god) {
      const h = hero();
      if (h) { h.s.hp = h.maxHp; h.s.mana = h.maxMana; }
      if (s && s.p) { s.p.hp = s.p.maxHp; s.p.mana = s.p.maxMana; s.p.sta = s.p.maxSta; s.p.invuln = Math.max(s.p.invuln, 0.2); }
    }
  };

  const origDraw = game._draw.bind(game);
  game._draw = () => { origDraw(); overlay(game.g); };

  const API = {
    // navigation
    start,
    teleport, tp: teleport, where: () => Object.keys(places()).sort(),
    town: () => routes.town(hero()), dungeon: () => routes.dungeon(hero()),
    training: () => routes.training(hero()),
    // player
    setClass, weapon, give, ability, heal, setLevel, god,
    // combat
    spawn, clearEnemies, ai,
    // visual
    hitboxes: toggle('hitboxes'), collision: toggle('collision'),
    coords: toggle('coords'), fps: toggle('fps'),
    night, day, zoom,
    debug: (on) => { window.__townDebug = on === undefined ? !window.__townDebug : !!on;
                     console.log('[PQDev] district overlay', window.__townDebug ? 'ON' : 'off'); },
    // iteration
    reload, shot, preset,
    flags: () => ({ ...flags }),
    help,
  };

  window.PQDev = API;
  console.log('%c[PQDev] dev console ready — PQDev.help()', 'color:#8df0a0');
  return API;
}

function help() {
  console.log(`
PQDev — Pixel Quest development console

NAVIGATE                          PLAYER
  start('mage')  boot into town      setClass('mage')
  tp('lake')  teleport(id)          weapon('dragon')     fuzzy id match
  where()      list every place     give('health', 5)    potion / weapon / trinket
  town() dungeon() training()       ability('all')       unlock + slot all for class
COMBAT                              heal()   setLevel(8)   god()
  spawn('goblin')  spawn('slime',5)
  clearEnemies()   ai()            VISUAL
                                    hitboxes()  collision()  coords()  fps()
ITERATION                           night()  day()  zoom(1.1)  debug()
  reload()   rebuild current area
  shot('name')  save a PNG         PRESETS
  flags()                           preset('plaza' | 'lake' | 'night' | 'farm'
                                           | 'ancient-city' | 'warrior-test'
                                           | 'mage-test' | 'rogue-test')

Toggles flip when called with no argument; pass true/false to force.
Ids are fuzzy — weapon('dragon cleaver') and weapon('dragon-cleaver') both work.`);
}
