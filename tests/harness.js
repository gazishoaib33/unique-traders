/* Loads the app's browser scripts into an isolated Node `vm` context with
   an in-memory localStorage, so the real data layer (storage.js + db.js)
   can be tested without a browser. Two "tabs" can share one storage to
   simulate the app being open twice. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function createLocalStorage() {
  const data = new Map();
  return {
    failWrites: false,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      if (this.failWrites) throw new Error("QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem(k) { data.delete(k); },
    clear() { data.clear(); },
  };
}

function createSessionStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

/**
 * Boots one app instance ("tab").
 * options.localStorage — share with another tab to simulate two tabs.
 * options.catalog — true to seed the real 482-product catalog.
 */
function createApp({ localStorage = createLocalStorage(), catalog = false } = {}) {
  const context = {
    console,
    localStorage,
    sessionStorage: createSessionStorage(),
    addEventListener() {},
    setTimeout, clearTimeout,
  };
  context.window = context;
  vm.createContext(context);
  const files = ["js/utils.js", "js/storage.js"];
  if (catalog) files.push("js/real-catalog-data.js");
  files.push("js/seed.js", "js/db.js", "js/auth.js");
  files.forEach((f) => vm.runInContext(read(f), context, { filename: f }));
  return { DB: context.DB, Store: context.Store, Auth: context.Auth, Utils: context.Utils, localStorage, context };
}

/** A fresh, empty workspace with one admin and one category. */
async function freshApp(opts) {
  const app = createApp(opts);
  await app.DB.Backup.startFresh({ companyName: "Unique Traders", adminName: "Owner", adminUsername: "owner", adminPassword: "pw" });
  return app;
}

/** Creates a door product with Left/Right variants and opening stock. */
async function createDoor(DB, { name = "Cosmic Door Bronze", sku = "UT-1000", left = 5, right = 3, price = 14200 } = {}) {
  const product = await DB.Products.create(
    { name, sku, description: "7x3.5 feet", hasVariants: true },
    [
      { name: "Left Hand", costPrice: 11300, sellingPrice: price, reorderLevel: 2, openingStock: left },
      { name: "Right Hand", costPrice: 11300, sellingPrice: price, reorderLevel: 2, openingStock: right },
    ]
  );
  const variants = DB.Variants.listByProduct(product.id);
  return { product, left: variants.find((v) => v.name === "Left Hand"), right: variants.find((v) => v.name === "Right Hand") };
}

module.exports = { createApp, freshApp, createDoor, createLocalStorage };
