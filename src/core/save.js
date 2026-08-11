// localStorage save. One slot for now; the shape is versioned so future fields
// can be migrated instead of wiping a player's hero.

const KEY = 'pixelquest.save.v1';

export const Save = {
  write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, t: Date.now(), state }));
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) return null;
      return parsed.state;
    } catch (e) {
      console.warn('load failed', e);
      return null;
    }
  },

  exists() {
    return localStorage.getItem(KEY) !== null;
  },

  clear() {
    localStorage.removeItem(KEY);
  },
};
