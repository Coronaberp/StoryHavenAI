"use strict";

const store = (() => {
  let mem = {};
  let ok = true;
  try {
    localStorage.setItem("__t", "1");
    localStorage.removeItem("__t");
  } catch {
    ok = false;
  }
  return {
    get(key, fallback) {
      if (!ok) return key in mem ? mem[key] : fallback;
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    },
    set(key, value) {
      if (!ok) { mem[key] = value; return; }
      localStorage.setItem(key, JSON.stringify(value));
    },
  };
})();

const AUTOSAVE_INTERVAL_MS = 5000;

class LocalAutosave {
  constructor(key, getState) {
    this.key = key;
    this.getState = getState;
    this.timer = null;
    this.lastSerialized = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.saveNow(), AUTOSAVE_INTERVAL_MS);
  }

  saveNow() {
    const state = this.getState();
    const serialized = JSON.stringify(state);
    if (serialized === this.lastSerialized) return;
    this.lastSerialized = serialized;
    store.set(this.key, state);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  clear() {
    this.stop();
    store.set(this.key, null);
    this.lastSerialized = null;
  }

  static restore(key) {
    return store.get(key, null);
  }
}
