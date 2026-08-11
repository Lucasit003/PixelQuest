// Lightweight particle system. One pool per scene; particles are plain objects
// so spawning is cheap. Kinds: spark, dust, ember, magic, ring, slash, star.

import { rect, disc } from './pixel.js';
import { rand, randInt, pick } from '../core/rng.js';

export class Particles {
  constructor() { this.list = []; }

  clear() { this.list.length = 0; }

  spawn(p) {
    this.list.push(Object.assign({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0.5, t: 0, size: 1, color: '#fff',
      kind: 'spark', gravity: 0, drag: 1, fade: true,
    }, p));
  }

  // --- presets ------------------------------------------------------------

  hitSpark(x, y, dir = 1, color = '#ffd76a', count = 8) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x, y, kind: 'spark', color,
        vx: dir * rand(20, 90) + rand(-30, 30),
        vy: rand(-70, 20),
        z: rand(0, 6), vz: rand(20, 70), gravity: 180,
        life: rand(0.2, 0.45), size: randInt(1, 2), drag: 0.9,
      });
    }
  }

  blood(x, y, dir = 1, color = '#c23b3b') {
    for (let i = 0; i < 6; i++) {
      this.spawn({
        x, y: y - 8, kind: 'spark', color,
        vx: dir * rand(10, 60), vy: rand(-40, -5),
        z: rand(2, 8), vz: rand(10, 40), gravity: 200,
        life: rand(0.25, 0.5), size: randInt(1, 2), drag: 0.92,
      });
    }
  }

  dust(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + rand(-4, 4), y, kind: 'dust', color: pick(['#8a7d68', '#a8987e', '#6b5f4e']),
        vx: rand(-25, 25), vy: rand(-6, 2),
        z: 0, vz: rand(6, 20), gravity: 60,
        life: rand(0.3, 0.6), size: randInt(1, 2), drag: 0.88,
      });
    }
  }

  landPuff(x, y) {
    for (let i = 0; i < 10; i++) {
      const dir = i < 5 ? -1 : 1;
      this.spawn({
        x, y, kind: 'dust', color: '#9a8d78',
        vx: dir * rand(30, 80), vy: 0,
        z: rand(0, 3), vz: rand(4, 14), gravity: 50,
        life: rand(0.25, 0.5), size: randInt(1, 2), drag: 0.85,
      });
    }
  }

  ember(x, y, color = '#f2942b') {
    this.spawn({
      x: x + rand(-2, 2), y, kind: 'ember', color,
      vx: rand(-8, 8), vy: rand(-24, -12),
      life: rand(0.5, 1.1), size: 1, gravity: -8, drag: 0.98, fade: true,
    });
  }

  magicBurst(x, y, color = '#9d8bff', n = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = rand(30, 80);
      this.spawn({
        x, y, kind: 'magic', color,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6,
        z: rand(2, 10), vz: rand(-10, 30), gravity: 40,
        life: rand(0.35, 0.7), size: randInt(1, 2), drag: 0.9,
      });
    }
  }

  ring(x, y, color = '#ffffff', maxR = 22) {
    this.spawn({ x, y, kind: 'ring', color, life: 0.35, r: 2, maxR });
  }

  slash(x, y, dir = 1, color = '#ffffff') {
    this.spawn({ x, y, kind: 'slash', color, life: 0.18, dir, r: 4 });
  }

  levelStars(x, y) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.spawn({
        x, y, kind: 'star', color: pick(['#f2c94f', '#ffe89a', '#fff']),
        vx: Math.cos(a) * rand(20, 50), vy: Math.sin(a) * rand(20, 50) - 20,
        z: 0, vz: 0, gravity: 40, life: rand(0.6, 1.0), size: 1, drag: 0.95,
      });
    }
  }

  pickup(x, y, color = '#f2c94f') {
    for (let i = 0; i < 6; i++) {
      this.spawn({
        x, y, kind: 'star', color,
        vx: rand(-20, 20), vy: rand(-50, -20),
        gravity: 60, life: rand(0.4, 0.7), size: 1, drag: 0.9,
      });
    }
  }

  // --- sim ----------------------------------------------------------------

  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      if (p.kind === 'ring' || p.kind === 'slash') continue;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vz !== undefined) {
        p.vz -= (p.gravity || 0) * dt;
        p.z = (p.z || 0) + p.vz * dt;
        if (p.z < 0) { p.z = 0; p.vz = 0; }
      }
    }
    this.list = this.list.filter((p) => p.t < p.life);
  }

  draw(g) {
    for (const p of this.list) {
      const k = p.t / p.life;
      const alpha = p.fade === false ? 1 : (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      g.globalAlpha = Math.max(0, alpha);

      if (p.kind === 'ring') {
        const r = 2 + (p.maxR - 2) * k;
        g.strokeStyle = p.color;
        g.globalAlpha = Math.max(0, 1 - k) * 0.8;
        // pixel ring: stamp points around the circle
        for (let a = 0; a < Math.PI * 2; a += 0.35) {
          rect(g, Math.round(p.x + Math.cos(a) * r), Math.round(p.y + Math.sin(a) * r * 0.6), 1, 1, p.color);
        }
      } else if (p.kind === 'slash') {
        g.globalAlpha = Math.max(0, 1 - k) * 0.9;
        const r = p.r + k * 16;
        for (let a = -0.7; a < 0.7; a += 0.12) {
          const yy = a * r;
          rect(g, Math.round(p.x + p.dir * (r - Math.abs(a) * r * 0.4)), Math.round(p.y + yy), 2, 1, p.color);
        }
      } else if (p.kind === 'magic' || p.kind === 'star') {
        const s = p.size + (p.kind === 'star' ? 1 : 0);
        rect(g, p.x - s / 2, p.y - (p.z || 0) - s / 2, s, s, p.color);
        if (p.kind === 'star') {
          rect(g, p.x - s, p.y - (p.z || 0), s * 2 + 1, 1, p.color);
          rect(g, p.x, p.y - (p.z || 0) - s, 1, s * 2 + 1, p.color);
        }
      } else {
        rect(g, p.x, p.y - (p.z || 0), p.size, p.size, p.color);
      }
    }
    g.globalAlpha = 1;
  }
}
