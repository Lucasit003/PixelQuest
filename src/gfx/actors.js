// Character rendering. Actors are composed from hand-authored pixel parts
// (head / torso / limbs / weapon) positioned by an animation pose, rather than
// being full pre-drawn frames. That keeps the sprite data small while still
// giving a real walk cycle and weapon swings.
//
// Weapons are authored in three fixed orientations instead of being rotated,
// because rotating pixel art through canvas transforms destroys the grid.

import { drawGrid, shadow, disc, rect } from './pixel.js';

// ---------------------------------------------------------------- palettes

export const PALETTES = {
  warrior: {
    k: '#1b1526', m: '#8c93a8', l: '#c8cfe0', d: '#5c6376',
    s: '#e8b58a', e: '#241a2e', h: '#7a4326',
    a: '#c0463c', b: '#8f2f2b', t: '#e8d36a',
    w: '#dfe6f2', g: '#9aa3b8', p: '#6d3b1f',
  },
  mage: {
    k: '#120c28', m: '#6f57d8', l: '#9a86f2', d: '#4a37a0',
    s: '#f4cda0', e: '#241a2e', h: '#5a45c0',
    a: '#c2b2ff', b: '#4a37a0', t: '#ffe08a',
    w: '#d8ccff', g: '#7c68e0', p: '#a6864a',
  },
  rogue: {
    k: '#120e1c', m: '#463a5c', l: '#645580', d: '#2e2440',
    s: '#e8b58a', e: '#241a2e', h: '#38304e',
    a: '#8a4fc0', b: '#2e2440', t: '#c9a0f2',
    w: '#dfe6f2', g: '#544870', p: '#5c3a24',
  },
  ranger: {
    k: '#0f1c12', m: '#3d6b42', l: '#57945c', d: '#28472c',
    s: '#e8b58a', e: '#241a2e', h: '#2f5636',
    a: '#8a6a3a', b: '#28472c', t: '#e8d36a',
    w: '#dfe6f2', g: '#477a4e', p: '#6b4a2e',
  },
  paladin: {
    k: '#1e1a12', m: '#cfc9b8', l: '#efe9d8', d: '#9a927c',
    s: '#e8b58a', e: '#241a2e', h: '#b8ab8a',
    a: '#e0b34a', b: '#a8832f', t: '#f2c94f',
    w: '#f5f2e6', g: '#b8b09a', p: '#8a6a2f',
  },
  goblin: {
    k: '#16240f', m: '#5b8c3a', l: '#7cb356', d: '#3d6127',
    s: '#7cb356', e: '#f2e14a', h: '#3d6127',
    a: '#8a5a2b', b: '#5c3a1a', t: '#cdd6dd',
    w: '#cdd6dd', g: '#46702e', p: '#6b4423',
  },
  skeleton: {
    k: '#1c1a22', m: '#c9c6b8', l: '#eae7d8', d: '#8e8b7e',
    s: '#eae7d8', e: '#d94f3d', h: '#8e8b7e',
    a: '#6b6558', b: '#4a4640', t: '#cdd6dd',
    w: '#cdd6dd', g: '#a8a496', p: '#5c564a',
  },
  king: {
    k: '#1a1208', m: '#4f7a2f', l: '#6fa044', d: '#33501f',
    s: '#6fa044', e: '#ff5a3c', h: '#33501f',
    a: '#8a2f2b', b: '#5c1f1c', t: '#ffd23f',
    w: '#e8e2c8', g: '#3f6626', p: '#6b4423',
  },
  villager: {
    k: '#1e1622', m: '#a35f3a', l: '#c98a5c', d: '#6d3d24',
    s: '#e8b58a', e: '#241a2e', h: '#4a2c18',
    a: '#3f7a5c', b: '#2a5440', t: '#e8d36a',
    w: '#dfe6f2', g: '#8a5030', p: '#6d3b1f',
  },
  sage: {
    k: '#141a26', m: '#2f5b7a', l: '#4a83a8', d: '#1f3d52',
    s: '#e8b58a', e: '#241a2e', h: '#cfd6e0',
    a: '#d8b24a', b: '#8a6a2f', t: '#ffd86a',
    w: '#e6eef7', g: '#3d6d8f', p: '#8a6a2f',
  },
  berserker: {
    k: '#1a0e0e', m: '#8a3a2a', l: '#c2503a', d: '#5c2418',
    s: '#e8b58a', e: '#241a2e', h: '#7a2010',
    a: '#f2743f', b: '#5c1810', t: '#ffb02f',
    w: '#dfe6f2', g: '#8a3a2a', p: '#4a2010',
  },
  summoner: {
    k: '#0e1626', m: '#2f5c6b', l: '#4a8a9c', d: '#1c3a44',
    s: '#e8b58a', e: '#241a2e', h: '#245a68',
    a: '#7fe8c9', b: '#1c3a44', t: '#a0f2d8',
    w: '#c8f5ea', g: '#2f5c6b', p: '#3a6a5a',
  },
};

// ------------------------------------------------------------------- heads

const HEADS = {
  warriorHelm: [
    '..kkkk..',
    '.kmmmmk.',
    'kmllllmk',
    'kmkkkkmk',
    'ksessesk',
    '.ksssск.'.replace('с', 's'),
    '..kkkk..',
  ],
  mageHood: [
    '...kk...',
    '..kmmk..',
    '.kmllmk.',
    'kmllllmk',
    'kmseesmk',
    '.kmsskm.',
    '..kkkk..',
  ],
  goblin: [
    'k......k',
    'kmk..kmk',
    '.kmmmmk.',
    'kmmmmmmk',
    'kmeммemk'.replace(/м/g, 'm'),
    'kmkwwkmk',
    '.kmmmmk.',
  ],
  skull: [
    '..kkkk..',
    '.kllllk.',
    'kllllllk',
    'klkeeklk',
    'kllllllk',
    '.klkklk.',
    '..kkkk..',
  ],
  kingHelm: [
    '.ttttttt',
    'ktkttktk',
    'kmmmmmmk',
    'kmeммemk'.replace(/м/g, 'm'),
    'kmmmmmmk',
    'kmwkkwmk',
    '.kmmmmk.',
  ],
  villager: [
    '..hhhh..',
    '.hhhhhh.',
    'khssssнk'.replace('н', 'h'),
    'ksesseslk'.slice(0, 8),
    'ksssssk.',
    '.kssssk.',
    '..kkkk..',
  ],
  sageHood: [
    '..kkkk..',
    '.kmmmmk.',
    'kmhhhhmk',
    'kmseesmk',
    'kmshhsmk',
    '.kmhhmk.',
    '..kkkk..',
  ],
};

// ------------------------------------------------------------------ torsos

const TORSOS = {
  warrior: [
    '..kkkkkk..',
    '.kmmmmmmk.',
    'kmllaallmk',
    'kmlaaaalmk',
    'kmllaallmk',
    'kmmllllmmk',
    'kmmmmmmmmk',
    '.kbbbbbbk.',
    '..kkkkkk..',
  ],
  mage: [
    '...kkkk...',
    '..kmmmmk..',
    '.kmlaalmk.',
    '.kmlaaalk.',
    'kmllaallmk',
    'kmlllllllk',
    'kmlltllllk',
    'kmllllllmk',
    '.kmmmmmmk.',
  ],
  goblin: [
    '..kkkkkk..',
    '.kmmmmmmk.',
    'kmllllllmk',
    'kmlaaaalmk',
    'kmlaaaalmk',
    'kmmllllmmk',
    '.kbbbbbbk.',
    '..kkkkkk..',
  ],
  skeleton: [
    '..kkkkkk..',
    '.kllllllk.',
    'klkllllkkk'.slice(0, 10),
    'klkllllklk'.slice(0, 10),
    'kdlllllldk',
    '.kdllllkd.',
    '..kllllk..',
    '..kkkkkk..',
  ],
  king: [
    '.kkkkkkkk.',
    'kmmmmmmmmk',
    'kmlaaaalmk',
    'kmlatталmk'.replace(/т/g, 't'),
    'kmlaaaalmk',
    'kmllaallmk',
    'kmmmmmmmmk',
    'kbbbbbbbbk',
    '.kkkkkkkk.',
  ],
  villager: [
    '..kkkkkk..',
    '.kaaaaaak.',
    'kalllllаk'.replace('а', 'a'),
    'kallllllak',
    'kallllllak',
    'kaaaaaaaak',
    '.kmmmmmmk.',
    '..kkkkkk..',
  ],
  sage: [
    '...kkkk...',
    '..kmmmmk..',
    '.kmllllmk.',
    'kmlltllllk',
    'kmllllllmk',
    'kmllllllmk',
    'kmllllllmk',
    '.kmmmmmmk.',
    '..kkkkkk..',
  ],
};

// ------------------------------------------------------------------ limbs

const ARM = ['km', 'kl', 'kl', 'ks'];
const ARM_BACK = ['kd', 'kd', 'kd', 'kd'];
const LEG = ['mm', 'mm', 'dd', 'kk'];

// ----------------------------------------------------------------- weapons
// Each weapon has three orientations used across the swing.

const WEAPONS = {
  sword: {
    idle: ['.w.', '.w.', '.w.', '.w.', '.w.', '.w.', 'twt', '.p.', '.p.'],
    up:   ['......w', '.....ww', '....ww.', '...ww..', '..ww...', '.tw....', 'tp.....', 'p......'],
    out:  ['...wwwwwww.', 'ptwwwwwwwww', '...wwwwwww.'],
  },
  axe: {
    idle: ['.ww', 'www', '.wp', '..p', '..p', '..p', '..p', '..p'],
    up:   ['..www', '.wwww', '..wwp', '...p.', '..p..', '.p...', 'p....'],
    out:  ['....wwww', 'ppppwwwww', '....wwww'],
  },
  staff: {
    idle: ['.a.', 'aaa', '.a.', '.p.', '.p.', '.p.', '.p.', '.p.', '.p.'],
    up:   ['....aaa', '....aaa', '.....p.', '....p..', '...p...', '..p....', '.p.....', 'p......'],
    out:  ['.......aaa', 'pppppppaaa', '.......aaa'],
  },
  dagger: {
    idle: ['.w.', '.w.', '.w.', 'twt', '.p.', '.p.'],
    up:   ['...w', '..ww', '.tw.', 'tp..', 'p...'],
    out:  ['..wwww', 'ptwwwww', '..wwww'],
  },
  bow: {
    idle: ['.pw', 'p.w', 'p.w', 'p.w', 'p.w', 'p.w', '.pw'],
    up:   ['.pw', 'p.w', 'p.w', 'p.w', 'p.w', 'p.w', '.pw'],
    out:  ['.pw', 'p.w', 'p.w', 'p.w', 'p.w', 'p.w', '.pw'],
  },
  club: {
    idle: ['.ppp', 'ppppp', '.ppp', '..p.', '..p.', '..p.', '..p.'],
    up:   ['...ppp', '..ppppp', '...ppp', '..p...', '.p....', 'p.....'],
    out:  ['.....ppp', 'pppp ppppp'.replace(' ', 'p'), '.....ppp'],
  },
  bone: {
    idle: ['.ww', 'w.w', '.w.', '.w.', '.w.', 'w.w', '.ww'],
    up:   ['....ww', '...w.w', '..ww..', '.ww...', 'w.w...', 'ww....'],
    out:  ['.ww....ww', 'w.wwwwww.w'.slice(0, 9), '.ww....ww'],
  },
  none: { idle: [], up: [], out: [] },
};

// ------------------------------------------------------------------ specs

const SPECS = {
  warrior:  { pal: 'warrior',  head: 'warriorHelm', torso: 'warrior',  weapon: 'sword',  h: 26 },
  mage:     { pal: 'mage',     head: 'mageHood',    torso: 'mage',     weapon: 'staff',  h: 26 },
  rogue:    { pal: 'rogue',    head: 'mageHood',    torso: 'warrior',  weapon: 'dagger', h: 25 },
  ranger:   { pal: 'ranger',   head: 'mageHood',    torso: 'villager', weapon: 'bow',    h: 25 },
  paladin:  { pal: 'paladin',  head: 'warriorHelm', torso: 'warrior',  weapon: 'sword',  h: 26 },
  berserker:{ pal: 'berserker',head: 'warriorHelm', torso: 'warrior',  weapon: 'axe',    h: 26 },
  summoner: { pal: 'summoner', head: 'mageHood',    torso: 'mage',     weapon: 'staff',  h: 26 },
  goblin:   { pal: 'goblin',   head: 'goblin',      torso: 'goblin',   weapon: 'dagger', h: 22 },
  skeleton: { pal: 'skeleton', head: 'skull',       torso: 'skeleton', weapon: 'bone',   h: 24 },
  king:     { pal: 'king',     head: 'kingHelm',    torso: 'king',     weapon: 'club',   h: 34, scale: 1.6 },
  villager: { pal: 'villager', head: 'villager',    torso: 'villager', weapon: 'none',   h: 24 },
  sage:     { pal: 'sage',     head: 'sageHood',    torso: 'sage',     weapon: 'none',   h: 25 },
};

export function actorHeight(sprite) {
  const s = SPECS[sprite];
  return s ? s.h * (s.scale || 1) : 24;
}

// ---------------------------------------------------------------- the pose
// Returns limb offsets for the current animation state. Everything is in
// pixels relative to a neutral standing pose.

function computePose(a) {
  const t = a.animTime || 0;
  const p = {
    bob: 0, lean: 0,
    legFront: 0, legBack: 0, legLift: 0, legLiftBack: 0,
    armFront: 0, armFrontY: 0, armBack: 0,
    weaponPose: 'idle', weaponDX: 0, weaponDY: 0,
    squashX: 1, squashY: 1,
    headDY: 0,
  };

  switch (a.state) {
    case 'walk': {
      const ph = t * 9;
      p.legFront = Math.sin(ph) * 3;
      p.legBack = -Math.sin(ph) * 3;
      p.legLift = Math.max(0, Math.sin(ph)) * -1.5;
      p.legLiftBack = Math.max(0, -Math.sin(ph)) * -1.5;
      p.armFront = -Math.sin(ph) * 2;
      p.armBack = Math.sin(ph) * 2;
      p.bob = Math.abs(Math.sin(ph * 2)) * -1;
      break;
    }
    case 'attack': {
      // Wind up back, then whip through to a horizontal follow-through.
      const d = a.animDuration || 0.32;
      const k = Math.min(1, t / d);
      if (k < 0.32) {
        p.weaponPose = 'up';
        p.lean = -1.5;
        p.armFront = -2;
        p.weaponDX = -3 + k * 4;
        p.weaponDY = -5;
      } else if (k < 0.6) {
        p.weaponPose = 'out';
        p.lean = 2;
        p.armFront = 4;
        p.weaponDX = 4;
        p.weaponDY = -1;
      } else {
        p.weaponPose = 'out';
        p.lean = 1;
        p.armFront = 3;
        p.weaponDX = 3;
        p.weaponDY = 0;
      }
      break;
    }
    case 'heavy': {
      const d = a.animDuration || 0.52;
      const k = Math.min(1, t / d);
      if (k < 0.45) {
        p.weaponPose = 'up';
        p.lean = -3;
        p.armFront = -3;
        p.armFrontY = -2;
        p.weaponDX = -5;
        p.weaponDY = -8;
        p.bob = -1;
      } else if (k < 0.7) {
        p.weaponPose = 'out';
        p.lean = 3;
        p.armFront = 5;
        p.weaponDX = 5;
        p.weaponDY = 2;
        p.squashY = 0.94;
      } else {
        p.weaponPose = 'out';
        p.lean = 2;
        p.armFront = 4;
        p.weaponDX = 4;
        p.weaponDY = 1;
      }
      break;
    }
    case 'cast': {
      const d = a.animDuration || 0.42;
      const k = Math.min(1, t / d);
      p.weaponPose = 'up';
      p.armFront = 2;
      p.armFrontY = -4;
      p.weaponDX = 2 + k * 2;
      p.weaponDY = -7;
      p.lean = k < 0.5 ? -1 : 1;
      p.bob = -Math.sin(k * Math.PI) * 1.5;
      break;
    }
    case 'hurt': {
      p.lean = -2;
      p.bob = -1;
      p.armFront = -2;
      p.armBack = -2;
      break;
    }
    case 'dodge': {
      p.squashX = 1.15;
      p.squashY = 0.85;
      p.lean = 2;
      p.armFront = -3;
      p.armBack = -3;
      break;
    }
    case 'jump': {
      p.legFront = 2;
      p.legBack = -2;
      p.legLift = -2;
      p.armFront = -3;
      p.armFrontY = -2;
      p.armBack = -3;
      break;
    }
    case 'down': {
      p.squashY = 0.4;
      p.squashX = 1.3;
      break;
    }
    default: { // idle
      p.bob = Math.sin(t * 2.6) * 0.6;
      p.headDY = Math.sin(t * 2.6 + 0.5) * 0.4;
      break;
    }
  }
  return p;
}

/**
 * Draw an actor. Expects:
 *   x, y      ground position (y = feet)
 *   z         height above ground (jumping)
 *   facing    1 or -1
 *   sprite    key into SPECS
 *   state     idle | walk | attack | heavy | cast | hurt | dodge | jump | down
 *   animTime  seconds in the current state
 *   flash     0..1 white hit flash
 *   alpha     optional
 */
export function drawActor(g, a) {
  const spec = SPECS[a.sprite] || SPECS.warrior;
  const pal = PALETTES[spec.pal];
  const flip = a.facing < 0;
  const scale = (spec.scale || 1) * (a.scale || 1);
  const pose = computePose(a);

  const gx = Math.round(a.x);
  const gy = Math.round(a.y);
  const z = a.z || 0;

  // Ground shadow shrinks as the actor rises.
  const shadowScale = Math.max(0.35, 1 - z / 48);
  shadow(g, gx, gy, 9 * scale * shadowScale * pose.squashX, 3 * scale * shadowScale, 0.34);

  g.save();
  if (a.alpha !== undefined && a.alpha < 1) g.globalAlpha = a.alpha;

  // Everything below is drawn in a local space where (0,0) is at the feet.
  g.translate(gx, gy - z);
  if (scale !== 1 || pose.squashX !== 1 || pose.squashY !== 1) {
    g.scale(scale * pose.squashX, scale * pose.squashY);
  }
  if (flip) g.scale(-1, 1);

  const lean = pose.lean;
  const bob = pose.bob;

  const torso = TORSOS[spec.torso];
  const head = HEADS[spec.head];
  const torsoH = torso.length;
  const legH = LEG.length;

  const torsoY = -legH - torsoH + 1 + bob;
  const headY = torsoY - head.length + 1 + bob * 0.3 + pose.headDY;
  const torsoX = -5 + lean * 0.5;

  // --- back leg / back arm (behind the body)
  drawGrid(g, LEG, -3 + pose.legBack * 0.4, -legH + pose.legLiftBack, pal);
  drawGrid(g, ARM_BACK, torsoX + 1 + pose.armBack, torsoY + 2, pal);

  // --- weapon behind the body during wind-up so it reads as "cocked back"
  const weapon = WEAPONS[a.weapon || spec.weapon] || WEAPONS.none;
  const wGrid = weapon[pose.weaponPose] || weapon.idle;
  const drawWeaponBehind = pose.weaponPose === 'up';
  if (drawWeaponBehind && wGrid.length) {
    drawGrid(g, wGrid, torsoX + 4 + pose.weaponDX, torsoY + 2 + pose.weaponDY, pal);
  }

  // --- torso
  drawGrid(g, torso, torsoX, torsoY, pal);

  // --- head
  drawGrid(g, head, -4 + lean * 0.7, headY, pal);

  // --- front leg
  drawGrid(g, LEG, 1 + pose.legFront * 0.4, -legH + pose.legLift, pal);

  // --- front arm
  drawGrid(g, ARM, torsoX + 7 + pose.armFront, torsoY + 2 + pose.armFrontY, pal);

  // --- weapon in front
  if (!drawWeaponBehind && wGrid.length) {
    drawGrid(g, wGrid, torsoX + 8 + pose.weaponDX, torsoY + 1 + pose.weaponDY, pal);
  }

  g.restore();

  // Hit flash: re-stamp the silhouette in white.
  if (a.flash > 0) {
    g.save();
    g.globalAlpha = Math.min(1, a.flash) * 0.85;
    g.globalCompositeOperation = 'lighter';
    g.translate(gx, gy - z);
    if (scale !== 1) g.scale(scale, scale);
    if (flip) g.scale(-1, 1);
    const white = {};
    for (const k of Object.keys(pal)) white[k] = '#ffffff';
    drawGrid(g, torso, torsoX, torsoY, white);
    drawGrid(g, head, -4, headY, white);
    g.restore();
  }
}

/** The slime is round, so it gets its own drawing routine. */
export function drawSlime(g, a) {
  const t = a.animTime || 0;
  const gx = Math.round(a.x);
  const gy = Math.round(a.y);
  const z = a.z || 0;

  let sx = 1, sy = 1;
  if (a.state === 'jump' || z > 0) { sx = 0.85; sy = 1.2; }
  else if (a.state === 'hurt') { sx = 1.2; sy = 0.8; }
  else { const w = Math.sin(t * 4) * 0.06; sx = 1 + w; sy = 1 - w; }

  const r = 8 * (a.scale || 1);
  shadow(g, gx, gy, r * 1.05, 3, 0.3);

  g.save();
  g.translate(gx, gy - z);
  g.scale(sx, sy);

  const body = a.tint || '#3fb872';
  const dark = a.tintDark || '#2a8a52';
  const lite = a.tintLite || '#7fe8a8';

  disc(g, 0, -r, r, dark);
  disc(g, 0, -r - 1, r - 1, body);
  disc(g, -3, -r - 3, 2, lite);              // highlight
  rect(g, -r + 1, -2, r * 2 - 2, 2, dark);   // flat base

  // eyes
  rect(g, -4, -r - 2, 2, 3, '#15201a');
  rect(g, 2, -r - 2, 2, 3, '#15201a');
  rect(g, -4, -r - 2, 1, 1, '#ffffff');
  rect(g, 2, -r - 2, 1, 1, '#ffffff');

  g.restore();

  if (a.flash > 0) {
    g.save();
    g.globalAlpha = Math.min(1, a.flash) * 0.8;
    g.translate(gx, gy - z);
    g.scale(sx, sy);
    disc(g, 0, -r, r, '#ffffff');
    g.restore();
  }
}

/** Dispatch: slimes use the blob renderer, everything else the humanoid one. */
export function drawCharacter(g, a) {
  if (a.sprite === 'slime') drawSlime(g, a);
  else drawActor(g, a);
}

// ------------------------------------------------------------------- pets

export function drawPet(g, pet, x, y, t) {
  const bobY = Math.sin(t * 3) * 2;
  const px = Math.round(x);
  const py = Math.round(y + bobY);
  shadow(g, px, y + 10, 5, 2, 0.22);

  if (pet.sprite === 'dragon') {
    const pal = { k: '#2a0f14', b: '#d1483c', l: '#f08a5c', w: '#ffd76a', e: '#fff2b0' };
    drawGrid(g, [
      '..kk....',
      '.kbbk.kk',
      'kblllbkb',
      'kbewwebk',
      '.kbbbbk.',
      '..kwwk..',
    ], px - 4, py - 6, pal);
    // wings flap
    const flap = Math.sin(t * 9) > 0 ? 0 : 1;
    drawGrid(g, flap ? ['.ll.', 'llll'] : ['llll', '.ll.'],
      px - 8, py - 6 + flap, pal);
    drawGrid(g, flap ? ['.ll.', 'llll'] : ['llll', '.ll.'],
      px + 4, py - 6 + flap, pal);
  } else if (pet.sprite === 'owl') {
    const pal = { k: '#1a1630', b: '#6b5bb8', l: '#a394e8', w: '#ffd76a', e: '#fff2b0' };
    drawGrid(g, [
      '.k....k.',
      'kbk..kbk',
      'kbllllbk',
      'kbweewbk',
      'kbllllbk',
      '.kbbbbk.',
      '..kwwk..',
    ], px - 4, py - 7, pal);
    const flap = Math.sin(t * 8) > 0 ? 0 : 1;
    drawGrid(g, ['bb', 'bb', 'lb'], px - 6, py - 5 + flap, pal);
    drawGrid(g, ['bb', 'bb', 'bl'], px + 4, py - 5 + flap, pal);
  } else if (pet.sprite === 'fox') {
    const pal = { k: '#2a1408', b: '#c2662b', l: '#e89a4e', w: '#f5e6cc', e: '#241a2e' };
    drawGrid(g, [
      'k......k',
      'kbk..kbk',
      'kbbbbbbk',
      'kbeбbebk'.replace('б', 'b'),
      '.kbwwbk.',
      '..kbbk..',
    ], px - 4, py - 6, pal);
    drawGrid(g, ['.ll', 'lll', '.ll'], px + 4, py - 2, pal);
  } else if (pet.sprite === 'turtle') {
    const pal = { k: '#12240f', b: '#3f7a3a', l: '#6aa85c', w: '#c9d97a', e: '#241a2e' };
    drawGrid(g, [
      '..kkkk..',
      '.kllllk.',
      'kbwbbwbk',
      'kbbbbbbk',
      '.kkkkkk.',
    ], px - 4, py - 5, pal);
    drawGrid(g, ['.ll', 'lel', '.ll'], px + 4, py - 2, pal);
  } else { // rabbit
    const pal = { k: '#2a2436', b: '#d8d2e8', l: '#ffffff', w: '#e8a0b8', e: '#c04060' };
    drawGrid(g, [
      '.k..k.',
      'kbk kbk'.replace(' ', '.'),
      'kbk.kbk',
      '.kbbbk.',
      'kbebebk',
      '.kbbbk.',
    ], px - 3, py - 6, pal);
  }
}
