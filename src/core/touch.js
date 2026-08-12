// Touch controls: a DOM overlay (not canvas-drawn, so it scales independently
// of the game's internal resolution) that drives the same virtual-input API a
// gamepad or extra keyboard would use. Only installs on touch-capable devices
// so desktop keyboard/mouse play is untouched.

import { Input } from './input.js';

function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

const BUTTONS = [
  { cls: 'tc-btn tc-atk',   label: 'ATK', actions: ['light', 'confirm'] },
  { cls: 'tc-btn tc-hvy',   label: 'HVY', actions: ['heavy'] },
  { cls: 'tc-btn tc-spc',   label: 'SPC', actions: ['special'] },
  { cls: 'tc-btn tc-dge',   label: 'DGE', actions: ['dodge'] },
  { cls: 'tc-btn tc-jmp',   label: 'JMP', actions: ['jump'] },
  { cls: 'tc-btn tc-int',   label: 'E',   actions: ['interact'] },
  { cls: 'tc-btn tc-inv',   label: 'BAG', actions: ['inventory'] },
  { cls: 'tc-btn tc-menu',  label: 'ESC', actions: ['menu', 'back'] },
];

const DEAD = 0.4; // fraction of joystick radius before a digital direction fires

export const TouchControls = {
  install() {
    if (!isTouchDevice() || document.getElementById('touch-controls')) return;

    const root = document.createElement('div');
    root.id = 'touch-controls';
    document.body.appendChild(root);

    const joyBase = document.createElement('div');
    joyBase.className = 'tc-joy-base';
    const joyKnob = document.createElement('div');
    joyKnob.className = 'tc-joy-knob';
    joyBase.appendChild(joyKnob);
    root.appendChild(joyBase);
    this._wireJoystick(joyBase, joyKnob);

    for (const b of BUTTONS) {
      const el = document.createElement('div');
      el.className = b.cls;
      el.textContent = b.label;
      root.appendChild(el);
      this._wireButton(el, b.actions);
    }
  },

  _wireButton(el, actions) {
    const down = (e) => {
      e.preventDefault();
      el.classList.add('tc-active');
      for (const a of actions) Input.virtualDown(a);
    };
    const up = (e) => {
      if (e) e.preventDefault();
      el.classList.remove('tc-active');
      for (const a of actions) Input.virtualUp(a);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  _wireJoystick(base, knob) {
    let activeId = null;
    let dirs = { up: false, down: false, left: false, right: false };

    const setDirs = (nx, ny) => {
      const want = { up: ny < -DEAD, down: ny > DEAD, left: nx < -DEAD, right: nx > DEAD };
      for (const k of Object.keys(want)) {
        if (want[k] && !dirs[k]) Input.virtualDown(k);
        if (!want[k] && dirs[k]) Input.virtualUp(k);
      }
      dirs = want;
    };

    const move = (clientX, clientY) => {
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const max = rect.width / 2;
      let dx = clientX - cx, dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / max, ny = dy / max;
      Input.setVirtualAxis(nx, ny);
      setDirs(nx, ny);
    };

    const reset = () => {
      knob.style.transform = 'translate(0px, 0px)';
      Input.setVirtualAxis(0, 0);
      setDirs(0, 0);
    };

    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activeId = e.pointerId;
      base.setPointerCapture(activeId);
      move(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      reset();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    base.addEventListener('lostpointercapture', end);
  },
};
