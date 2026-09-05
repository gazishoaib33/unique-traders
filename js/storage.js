/* =====================================================================
   storage.js — persistence engine.

   IMPORTANT (read this when connecting Supabase later):
   This is the ONLY file that talks to localStorage directly. Everything
   above it (db.js and the rest of the app) calls Store.get()/Store.set()
   and never touches `localStorage` itself. To migrate to Supabase:
     1. Keep db.js's public API (DB.products.list(), .create(), etc.)
        exactly as-is — pages call those, not Store.
     2. Re-implement db.js's internals to call `supabase.from(...)`
        instead of Store, and return Promises (the async wrapper below
        already returns Promises, so calling code needs no changes).
     3. Retire this file once nothing references it.
   ===================================================================== */
(function (global) {
  "use strict";

  const NS = "uti"; // localStorage key namespace
  const KEY = `${NS}::db`;
  const SCHEMA_VERSION = 1;

  function readRaw() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error("Storage read failed", e);
      return null;
    }
  }

  function writeRaw(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error("Storage write failed", e);
      if (global.UI) global.UI.toast("error", "Storage full", "Could not save — browser storage may be full.");
      return false;
    }
  }

  /** Returns the whole DB object (creating an empty shell if absent). */
  function load() {
    let data = readRaw();
    if (!data || typeof data !== "object") {
      data = { schemaVersion: SCHEMA_VERSION, collections: {} };
    }
    if (!data.collections) data.collections = {};
    return data;
  }

  function persist(data) {
    return writeRaw(data);
  }

  // In-memory cache, single source of truth for the session. Every
  // mutation goes through here then is (debounced) flushed to localStorage.
  let _state = load();

  const flush = Utils && Utils.debounce ? Utils.debounce(() => persist(_state), 120) : () => persist(_state);

  const Store = {
    /** Get a full collection array (or {} for singleton collections). */
    getCollection(name, fallback) {
      if (!(name in _state.collections)) _state.collections[name] = fallback !== undefined ? fallback : [];
      return _state.collections[name];
    },
    setCollection(name, value) {
      _state.collections[name] = value;
      flush();
    },
    /** Replace the entire DB (used by import/restore & seeding). */
    replaceAll(newState) {
      _state = newState;
      persist(_state);
    },
    /** Snapshot for export/backup. */
    snapshot() {
      return JSON.parse(JSON.stringify(_state));
    },
    isEmpty() {
      const c = _state.collections;
      return !c || Object.keys(c).length === 0;
    },
    clearAll() {
      _state = { schemaVersion: SCHEMA_VERSION, collections: {} };
      persist(_state);
    },
  };

  global.Store = Store;
})(window);
