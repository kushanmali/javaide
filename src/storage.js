// localStorage wrapper that never throws (private mode, blocked storage, quota errors).
const PREFIX = 'java-ide:';

export const storage = {
  get(key) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, value);
    } catch {
      // storage unavailable: the IDE still works, code just is not persisted
    }
  },
};
