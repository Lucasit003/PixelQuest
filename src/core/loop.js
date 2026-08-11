// Fixed-timestep update with interpolated render, plus a stack-free scene manager.
// Scenes are objects: { enter(ctx), exit(), update(dt), draw(g) }.

import { Input } from './input.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.width = canvas.width;
    this.height = canvas.height;

    this.scene = null;
    this.pendingScene = null;
    this.accumulator = 0;
    this.step = 1 / 60;
    this.last = 0;
    this.running = false;
    this.time = 0;

    // Screen shake, used liberally by combat.
    this.shake = 0;
    this.shakeDecay = 7;

    // Full-screen fade for scene transitions.
    this.fade = 0;
    this.fadeTarget = 0;
    this.fadeSpeed = 3.2;
    this.onFadeDone = null;
  }

  setScene(scene) {
    this.pendingScene = scene;
  }

  // Fade out, swap, fade in.
  transition(sceneFactory) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.fadeTarget = 1;
    this.onFadeDone = () => {
      this.setScene(sceneFactory());
      this.fadeTarget = 0;
      this.onFadeDone = () => { this.transitioning = false; };
    };
  }

  addShake(amount) {
    this.shake = Math.min(12, this.shake + amount);
  }

  start(scene) {
    this.scene = scene;
    if (scene.enter) scene.enter(this);
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  _frame = (now) => {
    if (!this.running) return;
    let delta = (now - this.last) / 1000;
    this.last = now;
    // A tab that was backgrounded shouldn't fast-forward the whole fight.
    if (delta > 0.25) delta = 0.25;
    this.accumulator += delta;

    let guard = 0;
    while (this.accumulator >= this.step && guard < 5) {
      this._update(this.step);
      this.accumulator -= this.step;
      guard++;
    }
    this._draw();
    requestAnimationFrame(this._frame);
  };

  _update(dt) {
    this.time += dt;
    Input.update(dt);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt);
    }

    if (this.fade !== this.fadeTarget) {
      const dir = Math.sign(this.fadeTarget - this.fade);
      this.fade += dir * this.fadeSpeed * dt;
      if ((dir > 0 && this.fade >= this.fadeTarget) || (dir < 0 && this.fade <= this.fadeTarget)) {
        this.fade = this.fadeTarget;
        const cb = this.onFadeDone;
        this.onFadeDone = null;
        if (cb) cb();
      }
    }

    if (this.scene && this.scene.update) this.scene.update(dt, this);

    if (this.pendingScene) {
      if (this.scene && this.scene.exit) this.scene.exit(this);
      this.scene = this.pendingScene;
      this.pendingScene = null;
      if (this.scene.enter) this.scene.enter(this);
    }

    Input.endFrame();
  }

  // Screen shake is NOT applied globally here — that would shake the HUD too.
  // The current shake magnitude is exposed via `game.shake` so a scene can
  // offset only its world layer while keeping UI fixed. `shakeOffset()` gives a
  // fresh jitter each call.
  shakeOffset() {
    if (this.shake <= 0.05) return { x: 0, y: 0 };
    const s = this.shake;
    return {
      x: Math.round((Math.random() - 0.5) * s * 2),
      y: Math.round((Math.random() - 0.5) * s * 2),
    };
  }

  _draw() {
    const g = this.g;
    g.save();
    g.fillStyle = '#0d0b14';
    g.fillRect(-16, -16, this.width + 32, this.height + 32);
    if (this.scene && this.scene.draw) this.scene.draw(g, this);
    g.restore();

    if (this.fade > 0) {
      g.fillStyle = `rgba(6,5,12,${Math.min(1, this.fade)})`;
      g.fillRect(0, 0, this.width, this.height);
    }
  }
}
