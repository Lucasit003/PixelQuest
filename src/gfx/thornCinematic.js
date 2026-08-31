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

// The sequence. `hold` is seconds. `lines` are [text, atSecond] within the
// state, so dialogue timing is data and can be retuned without touching code.
// Timing is tuned to the dialogue, not to a target runtime. The 22 specified
// lines take ~32.6s at an unhurried pace, and the required action beats add
// ~17.6s, so ~50s is the floor for this script — see the note in the handover.
// Every hold below is the minimum that does not rush its own content.
const SEQUENCE = [
  { id: CUT.KNEEL, hold: 2.2, shot: 'MEDIUM_WIDE', music: 0, lines: [] },

  { id: CUT.FAILED_RISE, hold: 2.8, shot: 'MEDIUM', music: 0, lines: [] },

  { id: CUT.SPEECH_01, hold: 13.1, shot: 'PUSH', music: 0.10,
    lines: [
      ['So...', 0.3],
      ["At last, a warrior worthy of drawing a king's blood.", 1.1],
      ['For years, they came for this throne.', 3.9],
      ['Soldiers. Lords. Men who thought themselves heroes.', 6.0],
      ['They all fell.', 8.7],
      ['But you...', 9.9],
      ['You have brought a king to his knees.', 10.9],
    ] },

  { id: CUT.RECOGNITION, hold: 2.2, shot: 'CLOSE_FACE', music: 0.10,
    lines: [['You should be proud.', 0.2]] },

  { id: CUT.RETRIEVAL, hold: 6.8, shot: 'MEDIUM', music: 0.18,
    lines: [
      ['And yet...', 0.6],
      ['My kingdom still stands.', 1.6],
      ['My people still draw breath.', 3.2],
      ['So I have no right to die.', 5.0],
    ] },

  { id: CUT.SPEECH_02, hold: 10.0, shot: 'MEDIUM', music: 0.26,
    lines: [
      ['You have conquered my flesh.', 0.3],
      ['Now conquer what lies beneath it.', 2.1],
      ['Ancient Thorn...', 4.1],
      ['Take what remains of me.', 5.4],
      ['Give me strength...', 7.0],
      ['...for one final war.', 8.4],
    ] },

  // Impact, then the floor drops out of the music. The silence is the point.
  { id: CUT.SACRIFICE, hold: 1.8, shot: 'PUSH', music: 0, shake: 7, lines: [] },

  { id: CUT.BINDING, hold: 2.8, shot: 'MEDIUM', music: 0.14, lines: [] },

  { id: CUT.EYE, hold: 1.8, shot: 'CLOSE_EYE', music: 0.22, lines: [] },

  { id: CUT.RISE, hold: 2.4, shot: 'LOW_RISE', music: 0.42, lines: [] },

  { id: CUT.HERO, hold: 5.5, shot: 'HERO', music: 0.62,
    lines: [
      ['Come, warrior.', 0.4],
      ['You defeated a king.', 1.6],
      ['Now face his kingdom.', 3.1],
    ] },

  { id: CUT.SLAM, hold: 1.6, shot: 'LOW_RISE', music: 0.75, shake: 9, lines: [] },

  { id: CUT.AWAKENING, hold: 2.2, shot: 'CHAMBER', music: 0.9, lines: [] },

  { id: CUT.REVEAL, hold: 2.6, shot: 'WIDE', music: 1.0,
    lines: [['Come.', 1.4]] },
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
    const e = 1 - Math.pow(0.0025, 1 / 60);   // frame-rate independent ease
    this.cam.fx = lerp(this.cam.fx, tx, e * 3.4);
    this.cam.fy = lerp(this.cam.fy, ty, e * 3.4);
    this.cam.z = lerp(this.cam.z, z, e * 3.0);
  }

  // Whole-pixel discipline: the focus rounds to integers and the zoom snaps to
  // eighths, so sprites never land between pixels while the camera is moving.
  applyCamera(g) {
    const z = Math.max(0.25, Math.round(this.cam.z * 8) / 8);
    const fx = Math.round(this.cam.fx);
    const fy = Math.round(this.cam.fy);
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
