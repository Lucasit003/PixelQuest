// All sound is synthesized with WebAudio — no asset files, no downloads.
// Chiptune-ish blips: square/triangle waves with fast envelopes.

let ctx = null;
let master = null;
let enabled = true;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.28;
  master.connect(ctx.destination);
  return ctx;
}

function tone({ freq = 440, to = null, dur = 0.09, type = 'square', vol = 0.5, delay = 0 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.12, vol = 0.35, delay = 0, hp = 400 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const gain = c.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
}

export const Audio = {
  // Browsers suspend audio until a gesture; call this on the first keypress.
  unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume();
  },
  toggle() { enabled = !enabled; return enabled; },
  get enabled() { return enabled; },

  swing()    { noise({ dur: 0.08, vol: 0.16, hp: 900 }); },
  hit()      { tone({ freq: 320, to: 90, dur: 0.10, type: 'square', vol: 0.35 }); noise({ dur: 0.07, vol: 0.22, hp: 600 }); },
  heavyHit() { tone({ freq: 200, to: 55, dur: 0.18, type: 'sawtooth', vol: 0.4 }); noise({ dur: 0.14, vol: 0.3, hp: 300 }); },
  hurt()     { tone({ freq: 180, to: 70, dur: 0.16, type: 'sawtooth', vol: 0.35 }); },
  dodge()    { tone({ freq: 700, to: 1400, dur: 0.08, type: 'triangle', vol: 0.18 }); },
  jump()     { tone({ freq: 340, to: 620, dur: 0.09, type: 'square', vol: 0.2 }); },
  step()     { noise({ dur: 0.04, vol: 0.05, hp: 1200 }); },
  cast()     { tone({ freq: 520, to: 1100, dur: 0.16, type: 'triangle', vol: 0.28 }); tone({ freq: 780, to: 1500, dur: 0.16, type: 'sine', vol: 0.18, delay: 0.03 }); },
  coin()     { tone({ freq: 980, dur: 0.05, type: 'square', vol: 0.22 }); tone({ freq: 1480, dur: 0.09, type: 'square', vol: 0.22, delay: 0.05 }); },
  select()   { tone({ freq: 620, dur: 0.04, type: 'square', vol: 0.16 }); },
  confirm()  { tone({ freq: 620, dur: 0.05, type: 'square', vol: 0.2 }); tone({ freq: 930, dur: 0.08, type: 'square', vol: 0.2, delay: 0.05 }); },
  deny()     { tone({ freq: 220, to: 150, dur: 0.14, type: 'square', vol: 0.22 }); },
  correct()  { [660, 880, 1320].forEach((f, i) => tone({ freq: f, dur: 0.10, type: 'square', vol: 0.22, delay: i * 0.06 })); },
  wrong()    { tone({ freq: 300, to: 140, dur: 0.22, type: 'sawtooth', vol: 0.25 }); },
  levelUp()  { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'square', vol: 0.26, delay: i * 0.09 })); },
  unlock()   { [784, 988, 1319].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.3, delay: i * 0.10 })); },
  bossRoar() { tone({ freq: 140, to: 48, dur: 0.9, type: 'sawtooth', vol: 0.45 }); noise({ dur: 0.8, vol: 0.22, hp: 120 }); },
  death()    { tone({ freq: 400, to: 60, dur: 0.7, type: 'square', vol: 0.3 }); },
  door()     { tone({ freq: 160, to: 240, dur: 0.25, type: 'sine', vol: 0.25 }); noise({ dur: 0.2, vol: 0.12, hp: 200 }); },
};
