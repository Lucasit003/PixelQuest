// Keyboard input with edge detection. Scenes poll `down()` for held state and
// `pressed()` for this-frame taps; `endFrame()` clears the tap buffer.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  KeyJ: 'light',
  KeyK: 'heavy',
  KeyL: 'special',
  ShiftLeft: 'dodge', ShiftRight: 'dodge',
  KeyE: 'interact',
  Escape: 'menu',
  KeyI: 'inventory',
  Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4',
  Enter: 'confirm',
  Backspace: 'back',
  Tab: 'tab',
};

const held = new Set();
const taps = new Set();
const repeats = new Set();
const repeatTimers = new Map();

// Text typed this frame (for the training answer box).
let textBuffer = '';
let captureText = false;

const REPEAT_DELAY = 0.42;
const REPEAT_RATE = 0.06;

export const Input = {
  install(target = window) {
    target.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        if (!held.has(action)) {
          held.add(action);
          taps.add(action);
          repeats.add(action);
          repeatTimers.set(action, REPEAT_DELAY);
        }
        // Don't let space/arrows scroll the page behind the canvas.
        if (!captureText || action !== 'confirm') e.preventDefault();
      }
      if (captureText) {
        if (e.key === 'Backspace') {
          textBuffer = textBuffer.slice(0, -1);
          e.preventDefault();
        } else if (e.key.length === 1 && textBuffer.length < 24) {
          textBuffer += e.key;
          e.preventDefault();
        }
      }
    });

    target.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (action) {
        held.delete(action);
        repeatTimers.delete(action);
      }
    });

    // Losing focus mid-hold would otherwise leave the hero sprinting forever.
    target.addEventListener('blur', () => {
      held.clear();
      repeatTimers.clear();
    });
  },

  down(action) { return held.has(action); },
  pressed(action) { return taps.has(action); },
  // True on tap and again on key-repeat — for menu navigation.
  repeated(action) { return repeats.has(action); },

  anyPressed(...actions) { return actions.some((a) => taps.has(a)); },

  axis() {
    let x = 0, y = 0;
    if (held.has('left')) x -= 1;
    if (held.has('right')) x += 1;
    if (held.has('up')) y -= 1;
    if (held.has('down')) y += 1;
    if (x && y) { x *= 0.7071; y *= 0.7071; }
    return { x, y };
  },

  beginTextCapture() { captureText = true; textBuffer = ''; },
  endTextCapture() { captureText = false; },
  get text() { return textBuffer; },
  set text(v) { textBuffer = v; },

  update(dt) {
    for (const [action, t] of repeatTimers) {
      const nt = t - dt;
      if (nt <= 0) {
        repeats.add(action);
        repeatTimers.set(action, REPEAT_RATE);
      } else {
        repeatTimers.set(action, nt);
      }
    }
  },

  endFrame() {
    taps.clear();
    repeats.clear();
  },
};
