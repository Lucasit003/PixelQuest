// The river's source: a rock scarp across the map's north-west shoulder with
// the waterfall pouring out of the high forest into the plunge pool the
// spine begins in (river.js RIVER_PTS[0]).
//
// The elevation is FAKE — this is a face drawn on flat ground, sold by three
// things working together: the scarp's own shading (lit crest, deep base
// shadow), the collision band that refuses to let the player walk through
// it, and the composition above it (crown pines, the glimpse of the upper
// stream feeding the lip) implying land that continues higher. The same
// trick every 2D RPG cliff uses.
//
// The FALLING WATER is pure animation in the fountain idiom: deterministic
// streak columns, a churn band, mist and rings, all functions of t. The
// static art under them is just dark wet rock.
//
// A low cave mouth hides in the face east of the falls, half veiled by the
// spray — environmental storytelling only; it leads nowhere yet.

import { rect } from '../../gfx/pixel.js';
import { hash, fillEllipse, contactShadow } from './primitives.js';
import { ringDots } from '../../gfx/waterfx.js';

// The scarp: from WEST_END to EAST_END along the pool's north shore. BASE is
// the ground line the face stands on; the face rises FACE_H above it.
const WEST_END = 428, EAST_END = 828;
const BASE = 418, FACE_H = 74;
const TOP = BASE - FACE_H;
// The notch the falls pour through.
const FALL_X0 = 588, FALL_X1 = 650;
const POOL = { x: 620, y: 462 };          // plunge pool centre (spine pt 0)
// The cave mouth east of the falls, low in the face.
const CAVE = { x: 678, w: 30, h: 22 };

export function buildWaterfall(scene) {
  // ---- collision: the face is a wall ------------------------------------
  // One solid per stretch, sized to the DRAWN base course, so the player
  // stands at the foot of the rock rather than an invisible fence. The
  // stretch behind the falls is solid too — the cave is set dressing.
  scene.solids.push(
    { x: WEST_END - 6, y: BASE - 26, w: EAST_END - WEST_END + 12, h: 30 },
    // the upper stream above the lip, so nobody stands on painted water
    { x: FALL_X0 - 4, y: 286, w: FALL_X1 - FALL_X0 + 8, h: TOP - 286 },
  );

  // ---- the entity: face + falls + pool FX, y-sorted at the base ---------
  scene.locations.push({
    id: 'waterfall', name: null, dx: null, dy: null, action: null,
    district: null, sortY: BASE - 20,
    draw: (g) => drawWaterfallScarp(g, scene.t),
    solid: null,
  });

  // ---- the crown: pines and boulders on the high ground ------------------
  // Placed here, not in riverdecor, because they are THIS composition: the
  // forest the river falls out of. Bases stay north of the crest so no
  // trunk pokes through the face.
  const CROWN = [
    ['pine_tree_02', 470, 336, 1.05], ['pine_tree_01', 522, 318, 0.9],
    ['pine_tree_04', 500, 352, 0.8], ['pine_tree_03', 560, 330, 1.0],
    ['pine_tree_01', 688, 330, 1.05], ['pine_tree_02', 742, 344, 0.92],
    ['pine_tree_03', 786, 322, 1.0], ['pine_tree_04', 812, 350, 0.82],
    ['pine_tree_02', 448, 300, 0.85], ['pine_tree_03', 630, 296, 0.9],
    ['pine_tree_01', 764, 292, 0.88], ['pine_tree_04', 546, 288, 0.78],
  ];
  for (const [name, x, y, k] of CROWN) {
    scene.decor.push({ name, x, y, w: Math.round(47 * k), h: Math.round(70 * k),
                       flip: hash(x * 1.7) > 0.5, sortY: y, shadow: Math.round(12 * k) });
  }
  // a few grey boulders at the foot of the face, breaking the base line
  for (const [x, k] of [[452, 1.0], [548, 0.7], [706, 0.85], [802, 1.1], [762, 0.6]]) {
    scene.decor.push({ name: 'rock_small_0' + (1 + (Math.floor(x) % 3)), x, y: BASE + 6 + hash(x) * 8,
                       w: Math.round(18 * k), h: Math.round(15 * k),
                       flip: hash(x * 3.1) > 0.5, sortY: BASE + 6 + hash(x) * 8, shadow: Math.round(7 * k) });
  }
}

// ---------------------------------------------------------------- the scarp
function drawWaterfallScarp(g, t) {
  // ---- the upland behind the crest --------------------------------------
  // A darker grass shelf above the face, and the upper stream sliding out
  // of the trees into the lip — the geography the falls come FROM.
  g.fillStyle = 'rgba(34,58,38,0.45)';
  g.fillRect(WEST_END - 6, TOP - 60, EAST_END - WEST_END + 12, 60);
  // upper stream: a short dark channel with its own banks
  const sx0 = FALL_X0 + 8, sx1 = FALL_X1 - 8;
  g.fillStyle = '#6b5c40';
  g.fillRect(sx0 - 4, 288, sx1 - sx0 + 8, TOP - 288);
  g.fillStyle = '#33565f';
  g.fillRect(sx0, 288, sx1 - sx0, TOP - 288);
  g.fillStyle = '#3f6c76';
  g.fillRect(sx0 + 3, 288, sx1 - sx0 - 6, TOP - 288);
  // approach ripples: the water hurries as it nears the edge
  for (let i = 0; i < 8; i++) {
    const ph = ((t * 46 + i * 17 + hash(i * 3.3) * 30) % (TOP - 292));
    const y = 290 + ph;
    const a = 0.12 + (ph / (TOP - 292)) * 0.3;
    rect(g, Math.round(sx0 + 4 + hash(i * 7.1) * (sx1 - sx0 - 8)), Math.round(y), 2, 1,
         `rgba(215,240,248,${a.toFixed(2)})`);
  }

  // ---- the rock face -----------------------------------------------------
  // A few BIG masses, not a row of slabs. Each mass owns its crest height,
  // a wavering internal stratum line and a talus skirt; deep 2px crevices
  // divide them. The silhouette varies by ±14 and the base line is broken —
  // the flat-topped, flat-footed first pass read as a retaining wall.
  const masses = [];
  {
    // Masses never straddle the notch: force breaks at its edges, else a
    // wide mass that merely touches the falls paints its whole width as the
    // dark backing rock and the flanks become black slabs.
    let mx = WEST_END;
    let mi = 0;
    while (mx < EAST_END) {
      let mw = 38 + Math.floor(hash(mi * 5.17) * 52);
      if (mx < FALL_X0 - 3 && mx + mw > FALL_X0 - 3) mw = FALL_X0 - 3 - mx;
      if (mx >= FALL_X0 - 3 && mx < FALL_X1 + 3) mw = FALL_X1 + 3 - mx;
      masses.push({ x: mx, w: Math.min(mw, EAST_END - mx), i: mi });
      mx += mw + 2;                      // 2px crevice between masses
      mi++;
    }
  }
  // Three rock families so the wall is not one steel — cool grey, warm
  // weathered, dark slate — each [face, lower, upper] triple.
  const ROCK_HUES = [
    ['#565a62', '#494c54', '#6a6e76'],
    ['#5d584f', '#4c4841', '#6f6a5f'],
    ['#4d525c', '#41454e', '#5f6570'],
  ];
  for (const m of masses) {
    const inFall = m.x + m.w > FALL_X0 - 2 && m.x < FALL_X1 + 2;
    const h1 = hash(m.i * 7.3);
    // Real scarps STEP: every third mass drops well below its neighbours
    // (upland grass shows behind it), the others jut to varying heights.
    const short = m.i % 3 === 2;
    const crest = TOP + (short ? 14 + Math.floor(h1 * 8) : Math.floor((h1 - 0.6) * 30));
    const baseHere = BASE + Math.floor((hash(m.i * 3.9) - 0.3) * 6);
    if (inFall) {
      // dark wet rock behind the falls
      g.fillStyle = '#262b33';
      g.fillRect(m.x, TOP - 6, m.w, BASE - TOP + 8);
      continue;
    }
    const HUE = ROCK_HUES[Math.floor(hash(m.i * 4.31) * ROCK_HUES.length) % ROCK_HUES.length];
    // crevice shadow behind/right of the mass
    g.fillStyle = '#1d1f26';
    g.fillRect(m.x - 2, crest + 2, m.w + 4, baseHere - crest - 2);
    // the face, darkening downward in three uneven stops
    const H3 = baseHere - crest;
    g.fillStyle = HUE[0];
    g.fillRect(m.x, crest, m.w, H3);
    g.fillStyle = HUE[1];
    g.fillRect(m.x, crest + Math.round(H3 * 0.55), m.w, Math.round(H3 * 0.45));
    g.fillStyle = HUE[2];
    g.fillRect(m.x, crest, m.w, Math.round(H3 * 0.3));
    // top plane: the lit shelf you are looking down onto
    g.fillStyle = '#7e828b';
    g.fillRect(m.x, crest, m.w, 4);
    g.fillStyle = '#8f939c';
    g.fillRect(m.x + 1, crest, m.w - 2, 2);
    // crest notches so the silhouette is chipped, not ruled
    for (let nx = m.x + 3; nx < m.x + m.w - 4; nx += 7 + Math.floor(hash(nx * 1.3) * 9)) {
      const nh = 1 + Math.floor(hash(nx * 2.9) * 3);
      g.fillStyle = '#565a62';
      g.fillRect(nx, crest, 2 + Math.floor(hash(nx) * 3), nh);
    }
    // one wavering stratum line across the face
    const sy = crest + Math.round(H3 * (0.38 + hash(m.i * 9.1) * 0.2));
    for (let lx = m.x; lx < m.x + m.w; lx += 3) {
      const wob = Math.round(Math.sin(lx * 0.21 + m.i) * 1.6);
      g.fillStyle = 'rgba(28,30,38,0.5)';
      g.fillRect(lx, sy + wob, 3, 1);
      g.fillStyle = 'rgba(150,155,165,0.28)';
      g.fillRect(lx, sy + wob + 1, 3, 1);
    }
    // vertical cracks, chips, a warm slab now and then
    if (hash(m.i * 11.7) > 0.6) {
      g.fillStyle = 'rgba(110,100,86,0.18)';
      g.fillRect(m.x + Math.round(m.w * 0.2), crest + 3, Math.round(m.w * 0.4), H3 - 8);
    }
    const n = 3 + Math.floor(hash(m.i * 5.1) * 4);
    for (let i = 0; i < n; i++) {
      const cx2 = m.x + 3 + Math.floor(hash(m.i * 9.7 + i * 3.1) * (m.w - 6));
      const cy2 = crest + 8 + Math.floor(hash(m.i * 4.3 + i * 7.7) * (H3 - 24));
      const ch2 = 4 + Math.floor(hash(m.i * 6.1 + i) * 9);
      g.fillStyle = 'rgba(24,26,32,0.55)';
      g.fillRect(cx2, cy2, 1, ch2);
      g.fillRect(cx2 + 1, cy2 + ch2 - 2, 1, 2);
      if (hash(m.i + i * 11.1) > 0.55) { g.fillStyle = '#8a8e97'; g.fillRect(cx2 - 1, cy2 - 1, 2, 1); }
    }
    // base: shadowed foot with an UNEVEN bottom edge + talus lumps
    g.fillStyle = '#3a3c44';
    g.fillRect(m.x, baseHere - 13, m.w, 13);
    for (let bx = m.x; bx < m.x + m.w; bx += 4) {
      const dip = Math.floor(hash(bx * 0.77) * 4);
      g.fillStyle = '#26282f';
      g.fillRect(bx, baseHere - 4 + dip - 2, 4, 4);
    }
    for (let bi = 0; bi < Math.floor(m.w / 22); bi++) {
      const bx = m.x + 6 + Math.floor(hash(m.i * 13.1 + bi * 7.7) * (m.w - 14));
      const br = 3 + Math.floor(hash(m.i * 3.3 + bi) * 4);
      fillEllipse(g, bx, baseHere + 1, br, br * 0.6, '#4e5058');
      fillEllipse(g, bx - 1, baseHere - 1, br * 0.6, br * 0.35, '#6d7079');
    }
    // moss where the spray reaches, low on the face
    if (hash(m.i * 8.9) > 0.4) {
      const mw2 = 4 + Math.floor(hash(m.i * 2.3) * 6);
      const mx2 = m.x + 2 + Math.floor(hash(m.i * 1.9) * (m.w - mw2 - 4));
      const my2 = baseHere - 15 - Math.floor(hash(m.i) * 7);
      g.fillStyle = '#43603f';
      g.fillRect(mx2, my2, mw2, 3);
      g.fillStyle = '#587c4e';
      g.fillRect(mx2 + 1, my2 - 1, mw2 - 2, 2);
    }
  }

  // ---- the cave mouth ----------------------------------------------------
  // A low arch WITH ITS FEET ON THE GROUND east of the falls: flat dark
  // fill to the base line, rounded top, a worn lintel, one cold glint deep
  // inside blinking slowly — the "can I get back there?" invitation.
  const cx = CAVE.x, cw = CAVE.w, chh = CAVE.h;
  g.fillStyle = '#101318';
  g.fillRect(cx, BASE - chh + 4, cw, chh - 2);
  fillEllipse(g, cx + cw / 2, BASE - chh + 5, cw / 2, 7, '#101318');   // arched top
  g.fillStyle = '#07090c';
  g.fillRect(cx + 3, BASE - chh + 7, cw - 6, chh - 6);
  fillEllipse(g, cx + cw / 2, BASE - chh + 7, cw / 2 - 3, 5, '#07090c');
  // worn lintel stones over the arch
  g.fillStyle = '#5a5e66';
  g.fillRect(cx - 3, BASE - chh - 5, cw + 6, 4);
  g.fillStyle = '#787c85';
  g.fillRect(cx - 3, BASE - chh - 5, cw + 6, 1);
  g.fillStyle = '#33353d';
  g.fillRect(cx - 3, BASE - chh - 1, cw + 6, 1);
  const glint = Math.sin(t * 0.7 + 2.1);
  if (glint > 0.55) {
    g.fillStyle = `rgba(140,210,235,${((glint - 0.55) * 0.9).toFixed(2)})`;
    g.fillRect(cx + cw / 2 + 3, BASE - 9, 1, 2);
  }

  // ---- the falls ---------------------------------------------------------
  const fallTop = TOP - 2, fallBot = BASE + 24;      // pours past the base into the pool
  const H = fallBot - fallTop;
  // The sheet: drawn per-row so its edges can be IRREGULAR and it can flare
  // toward the bottom. Core is brighter than the edges; a straight-sided
  // translucent rectangle is what it must never look like.
  for (let ry = 0; ry < H; ry++) {
    const y = fallTop + ry;
    const k = ry / H;
    const flare = Math.round(k * k * 7);                       // widens as it falls
    const eL = Math.round(hash(ry * 3.1) * 2 + Math.sin(ry * 0.7 + t * 9) * 0.8);
    const eR = Math.round(hash(ry * 5.7 + 9) * 2 + Math.sin(ry * 0.6 - t * 8) * 0.8);
    const x0 = FALL_X0 + 4 - flare + eL, x1 = FALL_X1 - 4 + flare - eR;
    if (x1 <= x0) continue;
    g.fillStyle = 'rgba(96,160,180,0.60)';
    g.fillRect(x0, y, x1 - x0, 1);
    g.fillStyle = 'rgba(160,210,224,0.42)';
    g.fillRect(x0 + 3, y, Math.max(1, x1 - x0 - 6), 1);
    g.fillStyle = 'rgba(214,240,248,0.30)';
    g.fillRect(x0 + 7, y, Math.max(1, x1 - x0 - 14), 1);
  }
  // a rock nub interrupting the sheet — the falls split briefly around it
  const NUB = { x: FALL_X0 + 38, y: fallTop + Math.round(H * 0.46) };
  g.fillStyle = '#3a3e46';
  g.fillRect(NUB.x, NUB.y, 6, 4);
  g.fillStyle = '#575b63';
  g.fillRect(NUB.x, NUB.y, 6, 1);
  g.fillStyle = 'rgba(250,253,255,0.7)';
  g.fillRect(NUB.x - 1, NUB.y - 1 + Math.round(Math.sin(t * 11) * 0.6), 8, 1);   // water piling on it
  // falling streaks: two layers, back slower/dimmer, front faster/brighter.
  for (let layer = 0; layer < 2; layer++) {
    const speed = layer === 0 ? 62 : 96;
    const cols = layer === 0 ? 8 : 12;
    for (let i = 0; i < cols; i++) {
      const colX = FALL_X0 + 5 + Math.floor((i / cols) * (FALL_X1 - FALL_X0 - 10) + hash(i * 3.1 + layer) * 3);
      const ph = ((t * speed + hash(i * 7.7 + layer * 13) * H * 2) % H);
      const len = 8 + Math.floor(hash(i * 5.3 + layer) * 11);
      const bright = layer === 0 ? 0.36 : 0.6;
      for (let k = 0; k < len; k++) {
        const yy = ph + k;
        if (yy >= H) break;
        const fade = 0.4 + 0.6 * (yy / H);                     // brighter as it falls
        const a = bright * fade * (1 - k / len * 0.5);
        if (a < 0.05) continue;
        rect(g, colX, Math.round(fallTop + yy), layer === 0 ? 2 : 1, 1,
             layer === 0 ? `rgba(196,228,238,${a.toFixed(2)})` : `rgba(240,250,253,${a.toFixed(2)})`);
      }
    }
  }
  // the lip: water curling OVER the edge — a rounded bright bulge, then a
  // broken sparkle line on top of it
  g.fillStyle = 'rgba(198,232,242,0.8)';
  g.fillRect(FALL_X0 + 3, fallTop - 2, FALL_X1 - FALL_X0 - 6, 3);
  g.fillStyle = 'rgba(240,250,253,0.9)';
  g.fillRect(FALL_X0 + 5, fallTop - 2, FALL_X1 - FALL_X0 - 10, 1);
  for (let i = 0; i < FALL_X1 - FALL_X0 - 6; i += 2) {
    if (hash(i * 1.3 + Math.floor(t * 7)) > 0.5) {
      rect(g, FALL_X0 + 3 + i, fallTop, 2, 1, 'rgba(255,255,255,0.85)');
    }
  }

  // ---- impact: churn, rings, mist, spray ---------------------------------
  const fw = FALL_X1 - FALL_X0;
  const churnY = fallBot + 2;
  // churn band: dithered white boiling at the base, always alive
  for (let i = 0; i < 42; i++) {
    const bx = FALL_X0 - 6 + hash(i * 3.7) * (fw + 12);
    const wob = Math.sin(t * 6.2 + i * 2.7);
    const by = churnY + hash(i * 5.9) * 8 + wob * 1.5;
    const a = 0.28 + 0.42 * (0.5 + 0.5 * Math.sin(t * 4.9 + i * 1.9));
    rect(g, Math.round(bx), Math.round(by), hash(i * 8.3) > 0.55 ? 2 : 1, 1,
         `rgba(244,251,253,${a.toFixed(2)})`);
  }
  // rings pushing out into the pool
  for (let i = 0; i < 3; i++) {
    const per = 2.1 + i * 0.6;
    const ph = ((t + i * 1.7) % per) / per;
    const r = 4 + ph * 22;
    const a = 0.4 * (1 - ph);
    if (a > 0.04) {
      ringDots(g, POOL.x + (hash(i * 9.1) - 0.5) * 26, churnY + 6 + i * 3, r, r * 0.5,
               [214, 240, 248], a, null, i * 3.3 + Math.floor(t / per));
    }
  }
  // mist: soft light rising and fading over the impact
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const per = 3.1 + i * 0.83;
    const ph = ((t + i * 2.2) % per) / per;
    const a = Math.sin(ph * Math.PI) * 0.10;
    if (a <= 0.01) continue;
    g.globalAlpha = a;
    fillEllipse(g, POOL.x + (hash(i * 4.7) - 0.5) * 40, churnY - 4 - ph * 16,
                16 + ph * 14, 7 + ph * 5, 'rgb(190,220,235)');
  }
  g.globalAlpha = 1;
  g.restore();
  // stray spray specks kicked above the churn
  for (let i = 0; i < 6; i++) {
    const per = 1.1 + hash(i * 6.1) * 0.9;
    const ph = ((t + i * 0.9) % per) / per;
    const a = (1 - ph) * 0.5;
    if (a < 0.06) continue;
    const px = POOL.x + (hash(i * 3.9 + Math.floor((t + i * 0.9) / per)) - 0.5) * (fw + 10);
    const py = churnY - 2 - ph * 12;
    rect(g, Math.round(px), Math.round(py), 1, 1, `rgba(250,253,255,${a.toFixed(2)})`);
  }
  void contactShadow;
}
