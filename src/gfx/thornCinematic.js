// =========================================================================
// THORN KING — PHASE 1 -> PHASE 2 CINEMATIC
// =========================================================================
//
// Self-contained by design. The scene hands this module control and gets it
// back; nothing in here reaches into combat, waves, inventory or the town, and
// the only state it mutates outside itself is what `finish()` hands back. That
// is deliberate: a cinematic that has fingers in the combat loop is one that
// breaks the combat loop when it is skipped halfway through.
//
// The sequence is a table of explicit states rather than one long function, so
// each beat can be found, retimed or skipped to on its own. Every state
// declares its own duration, camera and dialogue, and the runner interpolates
// between them — there is no per-beat bespoke code path.
//
// CAMERA. The gameplay camera is an x offset and nothing else. Cinematic shots
// need a focus point and a zoom, so this module owns a small camera of its own
// (focus x/y in world units, plus scale) and the scene defers its transform to
// `applyCamera` while the cinematic is running. Shots are interpolated with a
// smoothstep, never cut, except where a cut is the point.
//
// PIXEL INTEGRITY. Zoom is quantised to whole steps and the focus is rounded to
// integer world units before the transform is built, so the art never lands on
// half pixels. A cinematic that blurs the sprite it is showing off has defeated
// itself.

import { clamp01, lerp } from './pixel.js';

// ------------------------------------------------------------------ states
//
// Named exactly as the production spec names them, so the two can be read side
// by side. Order in this array IS the sequence.
export const CUT = {
  KNEEL:        'CUTSCENE_DEFEATED_KNEEL',
  FAILED_RISE:  'CUTSCENE_FAILED_RISE',
  SPEECH_01:    'CUTSCENE_SPEECH_01',
  RECOGNITION:  'CUTSCENE_CLEAVER_RECOGNITION',
  RETRIEVAL:    'CUTSCENE_CLEAVER_RETRIEVAL',
  SPEECH_02:    'CUTSCENE_SPEECH_02',
  SACRIFICE:    'CUTSCENE_SACRIFICE',
  BINDING:      'CUTSCENE_BINDING',
  EYE:          'CUTSCENE_EYE_AWAKENING',
  RISE:         'CUTSCENE_RISE',
  HERO:         'CUTSCENE_HERO_SHOT',
  SLAM:         'CUTSCENE_GROUND_SLAM',
  AWAKENING:    'CUTSCENE_ARENA_AWAKENING',
  REVEAL:       'PHASE_2_REVEAL',
  DONE:         'PHASE_2_COMBAT',
};

// Shot vocabulary. `z` is the zoom; `fx`/`fy` are the focus in world units,
// expressed relative to the king so the whole sequence follows him if he is
// ever restaged. A shot never names an absolute screen position.
const SHOT = {
  //            dx    dy    zoom
  WIDE:        [  0,  -14,  1.00],
  MEDIUM_WIDE: [ -6,  -16,  1.30],
  MEDIUM:      [ -4,  -18,  1.65],
  PUSH:        [ -2,  -20,  1.85],
  CLOSE_FACE:  [  1,  -30,  3.10],
  CLOSE_EYE:   [  3,  -32,  4.40],
  CLOSE_BLADE: [-26,   -8,  3.20],
  LOW_RISE:    [ -2,  -12,  1.90],
  HERO:        [  0,  -20,  1.45],
  CHAMBER:     [  0,  -10,  0.92],
};

// THE SCRIPT.
//
// Cut from 22 lines to 13, and the cut IS the craft. A defeated king who
// explains himself at length is a king being narrated at; one who says three
// things and lets the room go quiet is a king. Every line dropped here was
// doing work a surviving line already does — the roll-call of dead challengers
// is carried by "all of them fell", and "come, warrior" was redundant with the
// last word he says. What is left has to earn its place on screen.
//
// Silence is scored as deliberately as speech. `music` runs 0 through the
// defeat, barely lifts under the speech, and returns to ZERO on the sacrifice:
// the loudest moment in the sequence has nothing under it at all. It only
// swells once he is already standing.
//
// `ease` is the camera's approach speed for that shot — low numbers make the
// lens crawl. The push during the speech and the drift onto the eye are slow on
// purpose; the slam is fast because the cut should hit as hard as the weapon.
// `hold` is seconds; `lines` are [text, atSecond] so timing stays data.
const SEQUENCE = [
  // He is finished. Play it long and completely silent — the player should have
  // time to believe the fight is over before anything contradicts them.
  { id: CUT.KNEEL, hold: 3.4, shot: 'MEDIUM_WIDE', music: 0, ease: 1.2, letterbox: 1, lines: [] },

  { id: CUT.FAILED_RISE, hold: 2.9, shot: 'MEDIUM', music: 0, ease: 1.4, letterbox: 1, lines: [] },

  { id: CUT.SPEECH_01, hold: 7.2, shot: 'PUSH', music: 0.08, ease: 0.55, letterbox: 1,
    lines: [
      ['So.', 0.5],
      ['Many came for this throne. All of them fell.', 1.8],
      ['You have brought a king to his knees.', 4.6],
    ] },

  { id: CUT.RECOGNITION, hold: 2.6, shot: 'CLOSE_FACE', music: 0.08, ease: 0.9, letterbox: 1,
    lines: [['You should be proud.', 0.3]] },

  { id: CUT.RETRIEVAL, hold: 5.2, shot: 'MEDIUM', music: 0.16, ease: 1.1, letterbox: 1,
    lines: [
      ['And yet my kingdom stands.', 1.2],
      ['So I have no right to die.', 3.2],
    ] },

  { id: CUT.SPEECH_02, hold: 7.4, shot: 'MEDIUM', music: 0.24, ease: 0.8, letterbox: 1,
    lines: [
      ['You have conquered my flesh.', 0.4],
      ['Now conquer what lies beneath it.', 2.1],
      ['Ancient Thorn. Take what remains of me.', 4.1],
      ['...for one final war.', 6.2],
    ] },

  // Impact, and the score cuts out entirely. Hold on him in the silence.
  { id: CUT.SACRIFICE, hold: 2.6, shot: 'PUSH', music: 0, ease: 2.4, shake: 7, letterbox: 1, lines: [] },

  { id: CUT.BINDING, hold: 3.2, shot: 'MEDIUM', music: 0.12, ease: 0.9, letterbox: 1, lines: [] },

  // The image the sequence is built around. The lens barely moves.
  { id: CUT.EYE, hold: 2.6, shot: 'CLOSE_EYE', music: 0.20, ease: 0.45, letterbox: 1, lines: [] },

  { id: CUT.RISE, hold: 3.0, shot: 'LOW_RISE', music: 0.44, ease: 0.9, letterbox: 1, lines: [] },

  { id: CUT.HERO, hold: 4.2, shot: 'HERO', music: 0.66, ease: 0.7, letterbox: 1,
    lines: [
      ['You defeated a king.', 0.6],
      ['Now face his kingdom.', 2.2],
    ] },

  { id: CUT.SLAM, hold: 1.9, shot: 'LOW_RISE', music: 0.78, ease: 3.0, shake: 9, letterbox: 1, lines: [] },

  { id: CUT.AWAKENING, hold: 2.6, shot: 'CHAMBER', music: 0.92, ease: 1.0, letterbox: 1, lines: [] },

  // Bars retract here, handing the frame back to gameplay before he moves.
  { id: CUT.REVEAL, hold: 3.0, shot: 'WIDE', music: 1.0, ease: 1.3, letterbox: 0,
    lines: [['Come.', 1.5]] },
];

export const CINEMATIC_LENGTH = SEQUENCE.reduce((a, s) => a + s.hold, 0);

// ------------------------------------------------------------------ runner

export class ThornCinematic {
  // `king` is the boss entity; the cinematic reads its position and writes its
  // pose, and touches nothing else on it. `onFinish` hands control back.
  constructor(king, opts) {
    const o = opts || {};
    this.king = king;
    this.W = o.W || 480;
    this.H = o.H || 270;
    this.baseCamX = o.camX || 0;
    // The walls of the set. The King stands at the room's right end, so every
    // shot framed on him wants to overrun it; a camera that leaves the room
    // shows you the void behind the scenery.
    this.bounds = o.bounds || null;
    this.onFinish = o.onFinish || (() => {});
    this.canSkip = !!o.canSkip;

    this.i = 0;
    this.t = 0;
    this.total = 0;
    this.done = false;
    this.skipped = false;

    // Pose state the renderer reads. Written only by _poseFor, so a skip that
    // jumps to the end still lands on a fully-specified pose rather than
    // whatever the last partially-run beat happened to leave behind.
    this.pose = {
      kneel: 1,        // 1 = fully down on one knee, 0 = fully upright
      lean: 0,         // forward collapse of the torso
      reach: 0,        // arm extension toward the cleaver
      breath: 0,       // slow chest rise, sampled by the renderer
      cleaverHeld: 0,  // 0 = on the floor, 1 = in his hands
      cleaverDrag: 0,  // how far it has been dragged toward him
      impaled: 0,      // the blade driven in
      rootTravel: 0,   // 0..1 up the body: weapon -> torso -> shoulder -> crown
      eyeOpen: 0,
      crownLit: 0,
      slam: 0,         // the downward strike
      slamRaise: 0,    // the anticipation before it
      phase2: 0,       // crossfade weight to the transformed design
      look: 0,         // eyes, then head, then torso, toward the cleaver
      turnIn: 0,       // the blade rotated inward before the sacrifice
    };
    // Every field above must also be set by _settle(). A pose value that only
    // some beats write is a value the skip path leaves undefined, which is how
    // a skipped cutscene ends up missing its own VFX.

    // Environment layers, all deterministic functions of `floor`.
    this.env = { floor: 0, carpetTear: 0, brazier: 0, dust: 0, throneRoots: 0 };

    this.cam = { fx: 0, fy: 0, z: 1 };
    this.music = 0;
    // Cinematic bars. They ride in over the first beat and retract before
    // control returns, so the handover to gameplay is felt rather than cut.
    this.letterbox = 0;
    this.line = null;
    this.lineT = 0;
    this.shakeReq = 0;
    this._enter(0);
  }

  // ---------------------------------------------------------------- control

  get state() { return SEQUENCE[this.i] ? SEQUENCE[this.i].id : CUT.DONE; }

  // Skipping is not "run it faster": it jumps straight to the settled end
  // state, so every pose, layer and UI value is exactly what it would have been
  // had the sequence played out. Half-applied VFX is the classic skip bug.
  skip() {
    if (!this.canSkip || this.done) return false;
    this.skipped = true;
    this.i = SEQUENCE.length - 1;
    this.t = SEQUENCE[this.i].hold;
    this._settle();
    this._finish();
    return true;
  }

  _enter(i) {
    this.i = i;
    this.t = 0;
    const s = SEQUENCE[i];
    if (!s) return;
    this.line = null;
    this.music = s.music != null ? s.music : this.music;
    this.shakeReq = 0;
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    this.onFinish(this);
  }

  // The end-of-cinematic truth, in one place. Both the natural finish and the
  // skip route through here, which is what makes them agree.
  _settle() {
    const p = this.pose;
    p.kneel = 0; p.lean = 0; p.reach = 0; p.breath = 0;
    p.cleaverHeld = 1; p.cleaverDrag = 1; p.impaled = 0;
    p.rootTravel = 1; p.eyeOpen = 1; p.crownLit = 1; p.slam = 1; p.phase2 = 1;
    p.slamRaise = 0; p.look = 1; p.turnIn = 1;
    this.env.floor = 1; this.env.carpetTear = 1;
    this.env.brazier = 1; this.env.dust = 0; this.env.throneRoots = 1;
    this.music = 1;
    this.letterbox = 0;
    this.line = null;
  }

  // ----------------------------------------------------------------- update

  update(dt) {
    if (this.done) return;
    this.t += dt;
    this.total += dt;
    const s = SEQUENCE[this.i];
    if (!s) { this._finish(); return; }

    const u = clamp01(this.t / s.hold);
    const lbTarget = s.letterbox != null ? s.letterbox : 1;
    this.letterbox += (lbTarget - this.letterbox) * Math.min(1, dt * 3.2);
    this._poseFor(s.id, u, this.t);
    this._camFor(s.shot, u);
    this._lineFor(s);

    if (s.shake && this.t < 0.1) this.shakeReq = s.shake;
    else this.shakeReq = 0;

    if (this.t >= s.hold) {
      if (this.i + 1 >= SEQUENCE.length) { this._settle(); this._finish(); }
      else this._enter(this.i + 1);
    }
  }

  _lineFor(s) {
    if (!s.lines || !s.lines.length) { this.line = null; return; }
    let cur = null;
    for (const [text, at] of s.lines) if (this.t >= at) cur = { text, at };
    if (!cur) { this.line = null; return; }
    this.line = cur.text;
    this.lineT = this.t - cur.at;
  }

  // ----------------------------------------------------------------- camera

  _camFor(shotName, u) {
    const [dx, dy, z] = SHOT[shotName] || SHOT.WIDE;
    const k = this.king;
    const tx = (k ? k.x : this.baseCamX + this.W / 2) + dx;
    const ty = (k ? k.depth : 200) + dy;
    // Ease into every shot rather than snapping. First frame of a state seeds
    // the camera so the ease has somewhere to come from.
    if (this.t <= 0.001) { this.cam.fx = tx; this.cam.fy = ty; this.cam.z = z; return; }
    const st = SEQUENCE[this.i];
    const spd = (st && st.ease != null) ? st.ease : 1;   // per-shot lens speed
    const e = 1 - Math.pow(0.0025, 1 / 60);   // frame-rate independent ease
    this.cam.fx = lerp(this.cam.fx, tx, e * 3.4 * spd);
    this.cam.fy = lerp(this.cam.fy, ty, e * 3.4 * spd);
    this.cam.z = lerp(this.cam.z, z, e * 3.0 * spd);
  }

  // Whole-pixel discipline: the focus rounds to integers and the zoom snaps to
  // eighths, so sprites never land between pixels while the camera is moving.
  applyCamera(g) {
    const z = Math.max(0.25, Math.round(this.cam.z * 8) / 8);
    let fx = this.cam.fx, fy = this.cam.fy;
    if (this.bounds) {
      const hw = this.W / 2 / z, hh = this.H / 2 / z;
      const b = this.bounds;
      // When the set is narrower than the shot, centre on it rather than
      // clamping to a nonsensical range.
      fx = (b.x1 - b.x0) <= hw * 2 ? (b.x0 + b.x1) / 2
         : Math.min(Math.max(fx, b.x0 + hw), b.x1 - hw);
      fy = (b.y1 - b.y0) <= hh * 2 ? (b.y0 + b.y1) / 2
         : Math.min(Math.max(fy, b.y0 + hh), b.y1 - hh);
    }
    fx = Math.round(fx);
    fy = Math.round(fy);
    g.translate(Math.round(this.W / 2), Math.round(this.H / 2));
    g.scale(z, z);
    g.translate(-fx, -fy);
  }

  // The world x the background layers should be drawn around, so the chamber
  // keeps drawing while the cinematic camera roams.
  get drawCamX() { return this.baseCamX; }

  // ------------------------------------------------------------------ poses
  //
  // Every beat writes the FULL pose it implies, not a delta. That way a jump to
  // any state — a skip, a debug scrub — produces a coherent body rather than
  // whatever the previous beat left set.

  _poseFor(id, u, t) {
    const p = this.pose;
    const ease = (x) => x * x * (3 - 2 * x);
    // A wounded armoured body: slow, shallow, and never a clean sine.
    const breathe = (rate) => (Math.sin(t * rate) * 0.6 + Math.sin(t * rate * 0.41 + 1.1) * 0.4);

    switch (id) {
      case CUT.KNEEL:
        p.kneel = 1; p.lean = 0.82 + breathe(1.15) * 0.06;
        p.breath = breathe(1.15); p.reach = 0;
        p.cleaverHeld = 0; p.cleaverDrag = 0;
        break;

      // Presses up, gets partway, the leg goes. The failure is the point: it
      // establishes that ordinary strength is spent, so the later rise reads as
      // something other than effort.
      case CUT.FAILED_RISE: {
        const push = u < 0.55 ? ease(u / 0.55) : 1 - ease(clamp01((u - 0.55) / 0.45));
        p.kneel = 1 - push * 0.42;
        p.lean = 0.82 - push * 0.30 + breathe(1.9) * 0.05;
        p.breath = breathe(1.9) * (1 + push);
        break;
      }

      case CUT.SPEECH_01:
        p.kneel = 1; p.lean = 0.80 + breathe(1.0) * 0.05;
        p.breath = breathe(1.0);
        break;

      case CUT.RECOGNITION:
        // Eyes first, then head, then a little torso. Handled as one value the
        // renderer splits, so the parts can never desynchronise.
        p.kneel = 1; p.lean = 0.78 + breathe(1.0) * 0.04;
        p.look = ease(clamp01((u - 0.35) / 0.5));
        p.breath = breathe(1.0);
        break;

      case CUT.RETRIEVAL: {
        // reach, almost, stop, pull, reach again, grip, then drag
        const r = u < 0.18 ? ease(u / 0.18) * 0.72
                : u < 0.28 ? 0.72 - ease((u - 0.18) / 0.10) * 0.12
                : u < 0.46 ? 0.60 + ease((u - 0.28) / 0.18) * 0.40
                : 1;
        p.reach = r;
        p.kneel = 1; p.lean = 0.80 + r * 0.10;
        p.cleaverHeld = u > 0.46 ? 1 : 0;
        p.cleaverDrag = clamp01((u - 0.46) / 0.44);
        p.breath = breathe(2.2);
        break;
      }

      case CUT.SPEECH_02:
        p.kneel = 1; p.lean = 0.66; p.reach = 0;
        p.cleaverHeld = 1; p.cleaverDrag = 1;
        // turns the blade inward, slowly, so the intent lands before the act
        p.turnIn = ease(clamp01((u - 0.55) / 0.45));
        p.breath = breathe(1.5);
        break;

      case CUT.SACRIFICE: {
        const hit = clamp01(u / 0.22);
        p.impaled = ease(hit);
        p.kneel = 1;
        p.lean = 0.66 + ease(hit) * 0.22 - clamp01((u - 0.3) / 0.7) * 0.10;
        p.turnIn = 1; p.cleaverHeld = 1;
        p.breath = 0;
        break;
      }

      // The transformation TRAVELS. One value, consumed by the renderer as a
      // height threshold up the body, so nothing lights before the roots reach it.
      case CUT.BINDING:
        p.impaled = 1; p.kneel = 1; p.lean = 0.74;
        p.rootTravel = ease(u);
        p.crownLit = clamp01((u - 0.86) / 0.14);
        p.breath = breathe(0.8) * 0.4;
        break;

      case CUT.EYE:
        p.impaled = 1; p.kneel = 1; p.lean = 0.70;
        p.rootTravel = 1; p.crownLit = 1;
        p.eyeOpen = ease(clamp01((u - 0.45) / 0.4));
        break;

      case CUT.RISE: {
        const r = ease(u);
        p.impaled = 1 - clamp01(u / 0.25);      // pulls the cleaver free first
        p.kneel = 1 - r;
        p.lean = 0.70 * (1 - r);
        p.rootTravel = 1; p.crownLit = 1; p.eyeOpen = 1;
        p.phase2 = clamp01((u - 0.15) / 0.5);
        break;
      }

      case CUT.HERO:
        p.kneel = 0; p.lean = 0; p.impaled = 0;
        p.rootTravel = 1; p.crownLit = 1; p.eyeOpen = 1; p.phase2 = 1;
        p.breath = breathe(0.9) * 0.5;
        break;

      case CUT.SLAM: {
        // slow raise, then a fast drop — anticipation carries the weight
        const raise = ease(clamp01(u / 0.62));
        const drop = clamp01((u - 0.66) / 0.10);
        p.slamRaise = raise * (1 - drop);
        p.slam = ease(drop);
        p.kneel = 0; p.phase2 = 1;
        break;
      }

      case CUT.AWAKENING:
        p.slam = 1; p.phase2 = 1; p.kneel = 0;
        this.env.floor = ease(clamp01(u / 0.7));
        this.env.carpetTear = ease(clamp01((u - 0.15) / 0.6));
        this.env.brazier = Math.max(this.env.brazier, ease(clamp01(u / 0.3)));
        this.env.throneRoots = ease(clamp01((u - 0.3) / 0.6));
        this.env.dust = Math.max(0, 1 - u * 1.6);
        break;

      case CUT.REVEAL:
        p.phase2 = 1; p.kneel = 0; p.slam = 1;
        p.breath = breathe(0.9) * 0.5;
        this.env.floor = 1; this.env.carpetTear = 1;
        this.env.brazier = 1; this.env.throneRoots = 1; this.env.dust = 0;
        break;
    }
  }
}

// =========================================================================
// RENDERER
// =========================================================================
//
// Atmosphere here is carried by restraint, not by effects. The rules this
// follows, in priority order: the room stays the room; the light comes from
// somewhere; nothing glows that has not been reached yet; and the frame gets
// quieter as the moment gets bigger.

// Local hash. The fracture owns its own noise so callers do not have to supply
// one, and so the same impact always produces the same crack network — §28
// wants the final arena reproducible, which means deterministic.
function hsh(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const TEAL = { core: '#bdf6e8', body: '#3fd0bb', deep: '#12736c', dim: '#0b3a3a' };

// Cinematic bars. Drawn in SCREEN space, after the camera transform is undone,
// so they never scale with the shot.
export function drawLetterbox(g, cine, W, H) {
  const h = Math.round(cine.letterbox * 26);
  if (h <= 0) return;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, h);
  g.fillRect(0, H - h, W, h);
}

// Subtitle, not a dialogue box. A panel with a frame around it turns a king's
// last words into a UI element; plain text over the floor does not.
export function drawCinematicLine(g, cine, W, H, drawText) {
  if (!cine.line) return;
  const fade = clamp01(cine.lineT * 4) * clamp01((3.6 - cine.lineT) * 2.2);
  if (fade <= 0.01) return;
  g.globalAlpha = clamp01(fade);
  drawText(g, cine.line, W / 2, H - 40, { color: '#e8dfc8', align: 'center', shadow: '#000' });
  g.globalAlpha = 1;
}

// The chamber's own light, pushed around by the sequence. Desaturated and cold
// while he is beaten; warmth returns only as the roots do.
export function drawCinematicGrade(g, cine, camX, W, H) {
  const p = cine.pose;
  const dead = 1 - clamp01(p.rootTravel * 1.2);
  if (dead > 0.01) {                     // the colour drains out of the defeat
    g.fillStyle = `rgba(26,30,38,${0.30 * dead})`;
    g.fillRect(camX, 0, W, H);
  }
  const lit = clamp01(p.rootTravel);
  if (lit > 0.01) {
    g.fillStyle = `rgba(18,90,86,${0.10 * lit})`;
    g.fillRect(camX, 0, W, H);
  }
  // The vignette tightens as the shot closes in, which is what makes a push
  // feel like a push rather than a zoom.
  const tight = clamp01((cine.cam.z - 1) / 3.2);
  const vig = g.createRadialGradient(camX + W / 2, H / 2, 40 + (1 - tight) * 120,
                                     camX + W / 2, H / 2, 210 + (1 - tight) * 150);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, `rgba(0,0,0,${0.34 + tight * 0.30})`);
  g.fillStyle = vig;
  g.fillRect(camX, 0, W, H);
}

// The transformation, travelling. `rootTravel` is a HEIGHT THRESHOLD up the
// body: a root only draws once the front has climbed past where it starts, so
// nothing above the shoulder can light while the shoulder is still dark.
export function drawRoots(g, cine, kx, ky, bodyH) {
  const p = cine.pose;
  if (p.rootTravel <= 0.001) return;
  const front = p.rootTravel;
  const top = ky - bodyH * 0.9;              // crown height above his feet
  for (let i = 0; i < 14; i++) {
    const seed = i * 3.77;
    const start = (i % 5) / 5 * 0.55;    // where up the body this root begins
    if (front < start) continue;
    const grow = clamp01((front - start) / 0.30);
    const side = i % 2 ? 1 : -1;
    const x0 = kx + side * (1 + (i % 3));
    const y0 = ky - (ky - top) * start;
    const len = (7 + (i % 4) * 4) * grow;
    let x = x0, y = y0;
    for (let d = 0; d < len; d++) {
      const w = Math.sin(d * 0.5 + seed) * 0.9;
      x += side * 0.22 + w * 0.12;
      y -= 0.85;
      g.fillStyle = d > len - 3 ? TEAL.core : (d % 4 === 0 ? TEAL.body : TEAL.deep);
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  // Crown, last and only once the front has actually reached it.
  if (p.crownLit > 0.01) {
    g.globalAlpha = p.crownLit;
    g.fillStyle = TEAL.core;
    for (let i = -3; i <= 3; i++) g.fillRect(Math.round(kx + i * 2), Math.round(top), 1, 2);
    g.globalAlpha = 1;
  }
}

// One eye. The other stays as it was — a whole glowing face is a monster, and
// this is still a king.
export function drawEye(g, cine, kx, ky, bodyH) {
  const p = cine.pose;
  if (p.eyeOpen <= 0.01) return;
  const ex = Math.round(kx + 2), ey = Math.round(ky - bodyH * 0.82);
  const open = clamp01(p.eyeOpen);
  g.globalAlpha = open;
  g.fillStyle = TEAL.core;
  g.fillRect(ex, ey, 2, Math.max(1, Math.round(open * 2)));
  g.globalAlpha = open * 0.45;
  g.fillStyle = TEAL.body;
  g.fillRect(ex - 1, ey - 1, 4, Math.max(1, Math.round(open * 4)));
  g.globalAlpha = 1;
}

// The floor. Cracks BRANCH from the impact point rather than being scattered,
// and they are drawn under a dark overlay so the light reads as coming from
// beneath the stone instead of being painted onto it.
export function drawFloorFracture(g, cine, ix, iy, camX, W, H) {
  const f = cine.env.floor;
  if (f <= 0.001) return;
  const branch = (x, y, ang, len, depth, seed) => {
    let cx = x, cy = y, a = ang;
    const reach = len * clamp01(f * 1.4 - depth * 0.12);
    for (let d = 0; d < reach; d++) {
      a += (hsh(seed + d * 0.21) - 0.5) * 0.30;
      cx += Math.cos(a); cy += Math.sin(a) * 0.42;
      if (cx < camX - 10 || cx > camX + W + 10) break;
      const glow = 1 - d / Math.max(1, reach);
      // Mostly the dim tones, with the bright core only at the growing tip.
      // A crack network in full cyan turns the hall into a blue arena, which is
      // the one thing the spec is most emphatic about not doing.
      g.globalAlpha = 0.34 + glow * 0.42;
      g.fillStyle = glow > 0.90 ? TEAL.body : (glow > 0.55 ? TEAL.deep : TEAL.dim);
      g.fillRect(Math.round(cx), Math.round(cy), 1, 1);
      g.globalAlpha = 1;
      if (depth < 3 && d > reach * 0.35 && hsh(seed + d * 1.7) > 0.955) {
        branch(cx, cy, a + (hsh(seed + d) > 0.5 ? 0.8 : -0.8),
               len * 0.55, depth + 1, seed + d * 3.1);
      }
    }
  };
  for (let i = 0; i < 6; i++) {
    branch(ix, iy, (i / 6) * Math.PI * 2 + 0.3, 74, 0, i * 9.13);
  }
  // Under-stone bloom at the strike itself.
  const r = 8 + f * 26;
  const gl = g.createRadialGradient(ix, iy, 0, ix, iy, r);
  gl.addColorStop(0, `rgba(63,208,187,${0.16 * f})`);
  gl.addColorStop(1, 'rgba(63,208,187,0)');
  g.fillStyle = gl;
  g.fillRect(ix - r, iy - r, r * 2, r * 2);
}
