// Entry point: sizes the canvas to fill the window at integer-ish scale, wires
// the scene graph together, and starts the loop.

import { Game } from './core/loop.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { TouchControls } from './core/touch.js';
import { TitleScene } from './scenes/title.js';
import { TownScene } from './scenes/town.js';
import { TrainingScene } from './scenes/training.js';
import { CombatScene } from './scenes/combat.js';
import { HouseScene } from './scenes/house.js';

const canvas = document.getElementById('game');
const BASE_W = canvas.width;   // 480
const BASE_H = canvas.height;  // 270

// Scale the canvas up to fill the viewport while preserving aspect ratio and
// crisp pixels. We scale via CSS so the drawing buffer stays at native res.
function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.max(1, Math.floor(Math.min(vw / BASE_W, vh / BASE_H)));
  // if the window is smaller than one integer scale, fall back to fractional
  const s = scale >= 1 && BASE_W * scale <= vw && BASE_H * scale <= vh
    ? scale
    : Math.min(vw / BASE_W, vh / BASE_H);
  canvas.style.width = Math.floor(BASE_W * s) + 'px';
  canvas.style.height = Math.floor(BASE_H * s) + 'px';
}
window.addEventListener('resize', resize);
resize();

const game = new Game(canvas);
Input.install(window);
// Some environments report touch capability a tick late, so retry a few times.
TouchControls.install();
window.addEventListener('load', () => TouchControls.install());
window.addEventListener('pointerdown', () => TouchControls.install(), { once: true });
setTimeout(() => TouchControls.install(), 300);
setTimeout(() => TouchControls.install(), 1000);

// Unlock audio on first interaction (browser autoplay policy).
const unlock = () => { Audio.unlock(); window.removeEventListener('keydown', unlock); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('keydown', unlock);
window.addEventListener('pointerdown', unlock);

// ---- scene routing ------------------------------------------------------

function goTown(hero, outcome) {
  const town = new TownScene(hero, {
    toTraining: () => goTraining(hero),
    toDungeon: () => goDungeon(hero),
    toHouse: () => goHouse(hero),
  });
  game.transition(() => town);
  if (outcome) setTimeout(() => town.setOutcome && town.setOutcome(outcome), 400);
}

function goHouse(hero) {
  game.transition(() => new HouseScene(hero, () => goTown(hero)));
}

function goTraining(hero) {
  game.transition(() => new TrainingScene(hero, () => goTown(hero)));
}

function goDungeon(hero) {
  game.transition(() => new CombatScene(hero, (result) => goTown(hero, result)));
}

function startGame(hero) {
  goTown(hero);
}

game.start(new TitleScene(startGame));

// expose for debugging in the console
window.__game = game;
