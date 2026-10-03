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

   Consistency rules (why this file looks the way it does):
   - Writes are synchronous (no debounce), so a sale is on disk before
     the UI says "Sale completed" and nothing is lost if the tab closes.
   - Every mutation in db.js runs inside Store.transaction(): it re-reads
     the latest data from localStorage first (so a second open tab can't
     overwrite this tab's sales with a stale copy), applies the change,
     and persists once. If the change throws or the write fails, the
     in-memory state is rolled back to what is on disk — no half-applied
     sales or stock movements.
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

  // In-memory cache of what is on disk. Reads come from here; every
  // mutation reloads it first (see transaction()).
  let _state = load();
  let _txDepth = 0;

  function persistOrThrow() {
    if (!writeRaw(_state)) {
      _state = load(); // discard the unsaved change
      throw new Error("Could not save — browser storage may be full. Nothing was changed.");
    }
  }

  // Another tab changed the data: refresh our cache so this tab sees it.
  if (typeof global.addEventListener === "function") {
    global.addEventListener("storage", (e) => {
      if (e.key === KEY && _txDepth === 0) _state = load();
    });
  }

  const Store = {
    /** Get a full collection array (or {} for singleton collections). */
    getCollection(name, fallback) {
      if (!(name in _state.collections)) _state.collections[name] = fallback !== undefined ? fallback : [];
      return _state.collections[name];
    },
    setCollection(name, value) {
      _state.collections[name] = value;
      if (_txDepth === 0) persistOrThrow();
    },
    /**
     * Run fn() as one all-or-nothing unit against the latest saved data.
     * Returns fn's result; rethrows (after rolling back) if fn throws or
     * the result cannot be saved.
     */
    transaction(fn) {
      if (_txDepth > 0) return fn(); // nested: the outer transaction commits
      _state = load();
      _txDepth++;
      let result;
      try {
        result = fn();
      } catch (e) {
        _state = load(); // roll back in-memory changes
        throw e;
      } finally {
        _txDepth--;
      }
      persistOrThrow();
      return result;
    },
    /** Replace the entire DB (used by import/restore). */
    replaceAll(newState) {
      const previous = _state;
      _state = newState;
      if (!writeRaw(_state)) {
        _state = previous;
        throw new Error("Could not save — browser storage may be full.");
      }
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
      writeRaw(_state);
    },
  };

  global.Store = Store;
})(window);
