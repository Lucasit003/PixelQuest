// Test-side stand-ins for the handful of browser globals the pure game modules
// touch. Nothing here fakes gameplay — it only lets state/save be imported
// outside a browser.

// An in-memory localStorage. Node has no real one (Web Storage is behind a flag
// and needs --localstorage-file), so a player's actual browser save is never
// reachable from the test suite, let alone writable.
export function installFakeStorage() {
  const map = new Map();
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    // test-only escape hatch for planting malformed data
    _raw: map,
  };
  globalThis.localStorage = storage;
  return storage;
}

export function clearStorage() {
  if (globalThis.localStorage) globalThis.localStorage.clear();
}

// Float-tolerant equality, for damage numbers that come out of the arithmetic
// as 54.400000000000006. Gameplay rounds these before they matter.
export function closeTo(actual, expected, msg) {
  const ok = Math.abs(actual - expected) < 1e-9;
  if (!ok) throw new Error(msg || `expected ${actual} to be close to ${expected}`);
}

// Silences the console.warn that save.js emits on malformed data, so a test that
// deliberately corrupts a save doesn't spam the runner's output. Returns the
// calls it swallowed, for assertions.
export function muteWarnings(fn) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args);
  try {
    return { result: fn(), warnings: calls };
  } finally {
    console.warn = original;
  }
}
