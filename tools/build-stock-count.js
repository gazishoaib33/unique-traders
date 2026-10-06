#!/usr/bin/env node
/* =====================================================================
   tools/build-stock-count.js — turns a stock-count export (the
   "unique_trader_export_*.xlsx" sheet, saved as JSON rows) into
   js/stock-count-data.js, which Settings → Data & Backup → "Apply stock
   count" uses to update the app.

   The export uses its own product codes (e.g. "BRONZE-7-2P5-HAS-L"), so
   rows are matched to the app's products by design name + size + side
   (Left/Right) + type (HB/TB). Matching is deliberately strict: a row is
   matched only when exactly one existing variant fits. Everything else
   becomes a new product/variant (prices copied only from the same
   design, size and type — L and R always share a price in the catalogue).

   Usage:
     python3 -c "..."   # xlsx → tools/stock-count/<date>.json (see README)
     node tools/build-stock-count.js tools/stock-count/2026-10-06.json
   ===================================================================== */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const input = process.argv[2] || path.join(__dirname, "stock-count", "2026-10-06.json");
const COUNT_ID = path.basename(input, ".json");
const rows = JSON.parse(fs.readFileSync(input, "utf8"));

global.window = {};
require(path.join(ROOT, "js", "real-catalog-data.js"));
const CATALOG = window.REAL_CATALOG;

// Export design name → the app's existing products for that design
// (product-level SKUs from js/real-catalog-data.js). Reviewed by hand.
const ALIASES = {
  "Bronze": ["UT-884034", "UT-869698", "UT-93303"],
  "Brick": ["UT-981074"],
  "Brick (Old)": ["UT-981034"],
  "Butterfly Vanesa": ["UT-800048"],
  "Crown": ["UT-800126"],
  "Decent": ["UT-93465"],
  "Fiver": ["UT-981356"],            // "Victoria Fiber door"
  "Wood Fiver": ["UT-980342"],       // "Victoria Door wood fiber"
  "Glorish": ["UT-800110"],          // "Epic Door GLORSIH"
  "Jhumka Coffee": ["UT-89172", "UT-89173", "UT-89174"],
  "Liner": ["UT-944973", "UT-981190", "UT-981188"],
  "Lotto": ["UT-980486", "UT-980488", "UT-800104"],  // "Butterfly Loto"
  "Marigold": ["UT-980406", "UT-980408", "UT-980410"],
  "Merun Star": ["UT-980692", "UT-980716", "UT-800102"],
  "Naksi": ["UT-981129", "UT-981131", "UT-981133"],
  "Bloom": ["UT-980356", "UT-980358", "UT-980360"],
  "Onion Flower": ["UT-980502"],
  "Parabola": ["UT-980496"],
  "Rank": ["UT-980630"],
  "Slicer": ["UT-800131"],
  "Spark": ["UT-89427"],
  "Spectra": ["UT-88991"],
  "Super Stiff": ["UT-800129"],      // "Cosmic Super Door Stiff"
  "Thunder": ["UT-93386"],
  "Trio": ["UT-980490"],
  "Unique": ["UT-944680"],
  "Veneer": ["UT-980500"],
  "Venut": ["UT-981527", "UT-980384", "UT-980388"],
};

// Single rows matched to a specific variant SKU, for cases the rules
// can't decide. Empty for this count.
const ROW_OVERRIDES = {};

// Price-only references for designs with no matching variant (same
// design and size; every listed variant has the same price).
const PRICE_ALIASES = {
  "Louver Coffee": ["UT-853321", "UT-853320"],                         // "Solid Lobar Cat Door Coffee"
  "Louver Light": ["UT-92057", "UT-802503", "UT-92058", "UT-802504"],  // "Solid Lobar Cat Door Light"
  "Spectra": ["UT-944418", "UT-944419"],                                // "Super Spectra L.-HB" / "Super Spectra ." (HB, 9,400)
};

const CATEGORY_IDS = { "PVC Door": "cat_pvc_door", "Cat Door": "cat_cat_door" };
const NEW_CATEGORIES = [];

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmt = (n) => String(Math.round(n * 100) / 100);
const sizeKey = (a, b) => [a, b].map((n) => Math.round(n * 100) / 100).sort((x, y) => x - y).join("x");

/** Size from the code ("BRONZE-7-2P5-HAS-L" → 7 × 2.5 ft), else the Width/Height columns. */
function rowSize(r) {
  const m = str(r["Product Code"]).match(/-(\d+(?:P\d+)?)-(\d+(?:P\d+)?)(?:-|$)/i);
  const fromCode = m ? [m[1], m[2]].map((s) => Number(s.replace(/p/i, "."))) : null;
  const w = num(r.Width), h = num(r.Height);
  const fromCols = w && h ? [w, h] : null;
  const ft = fromCode || fromCols;
  if (!ft) return null;
  return { ft, inches: sizeKey(ft[0] * 12, ft[1] * 12), codeDisagrees: !!(fromCode && fromCols && sizeKey(...fromCode) !== sizeKey(...fromCols)) };
}

/** Size of an app product from its description ("COSMIC Door . 7x2.5 feet", "Cat Door . 24x30 inch"). */
function productSize(p) {
  const m = str(p.description).match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(feet|inch)/i);
  if (!m) return null;
  const k = m[3].toLowerCase() === "feet" ? 12 : 1;
  return sizeKey(Number(m[1]) * k, Number(m[2]) * k);
}

function variantSideType(name) {
  const m = str(name).match(/\((L|R)-(HB|TB)\)/i);
  if (m) return { side: m[1].toUpperCase() === "L" ? "Left" : "Right", type: m[2].toUpperCase() };
  if (/^(standard|default)$/i.test(str(name))) return { side: "", type: "" };
  return null;
}

function variantName(side, type) {
  if (side && type) return `${side} Hand (${side[0]}-${type})`;
  if (side) return `${side} Hand`;
  if (type) return type;
  return "Standard";
}

const productBySku = Object.fromEntries(CATALOG.products.map((p) => [p.sku, p]));
const variantBySku = {};
CATALOG.products.forEach((p) => p.variants.forEach((v) => { variantBySku[v.sku] = { ...v, product: p }; }));
for (const [name, skus] of Object.entries({ ...ALIASES, ...PRICE_ALIASES })) {
  skus.forEach((s) => { if (!productBySku[s]) throw new Error(`${name}: unknown product SKU ${s}`); });
}

const updates = [];       // existing variant → counted stock
const unmatched = [];     // rows that need a new variant
const usedVariants = new Set();
const notes = [];

rows.forEach((r) => {
  const code = str(r["Product Code"]);
  const name = str(r["Product Name"]);
  const side = str(r.Side);
  const type = str(r.Type);
  const size = rowSize(r);
  if (size && size.codeDisagrees) notes.push(`${code}: Width/Height columns disagree with the code — used the size in the code (${size.ft.join("x")} ft)`);
  const stock = num(r["Current Stock"]);
  const reorderLevel = num(r["Minimum Stock"]);
  if (!Number.isInteger(stock) || stock < 0) throw new Error(`${code}: bad stock ${r["Current Stock"]}`);
  const row = { code, name, series: str(r.Series), category: str(r.Category), brand: str(r.Brand), side, type, size, stock, reorderLevel };

  let match = null;
  if (ROW_OVERRIDES[code]) {
    match = variantBySku[ROW_OVERRIDES[code]];
  } else if (ALIASES[name]) {
    const products = ALIASES[name].map((s) => productBySku[s]);
    const sizes = new Set(products.map(productSize));
    const candidates = [];
    products.forEach((p) => p.variants.forEach((v) => {
      const st = variantSideType(v.name);
      if (!st) return;
      if (size ? productSize(p) !== size.inches : sizes.size > 1) return;
      if (side && st.side !== side) return;
      if (type && st.type !== type) return;
      if (!side && !type && (st.side || st.type)) {
        // Blank side and type in the export only matches a "Standard" variant.
        return;
      }
      if (side && !type && !st.type) return;
      candidates.push({ ...v, product: p });
    }));
    if (candidates.length === 1) match = candidates[0];
    else if (candidates.length > 1) notes.push(`${code}: ${candidates.length} possible matches — added as new instead of guessing`);
  }
  if (match) {
    if (usedVariants.has(match.sku)) throw new Error(`${code}: variant ${match.sku} matched twice`);
    usedVariants.add(match.sku);
    updates.push({ code, variantSku: match.sku, productSku: match.product.sku, stock, reorderLevel, _row: row, _variant: match });
  } else {
    unmatched.push(row);
  }
});

/** Price for a new variant: a matched variant of the same design, size and type. */
function priceDonor(row) {
  const sameDesign = updates.filter((u) => u._row.name === row.name
    && (u._row.size && row.size ? u._row.size.inches === row.size.inches : !u._row.size && !row.size)
    && u._row.type === row.type);
  const prices = new Set(sameDesign.map((u) => `${u._variant.costPrice}/${u._variant.sellingPrice}`));
  if (sameDesign.length && prices.size === 1) return sameDesign[0].variantSku;
  if (PRICE_ALIASES[row.name] && row.size) {
    const vs = PRICE_ALIASES[row.name].map((s) => productBySku[s]).filter((p) => productSize(p) === row.size.inches).flatMap((p) => p.variants);
    const ps = new Set(vs.map((v) => `${v.costPrice}/${v.sellingPrice}`));
    if (vs.length && ps.size === 1) return vs[0].sku;
  }
  return null;
}

/** An existing product of the same design and size that new variants can join. */
function hostProduct(row) {
  if (!ALIASES[row.name]) return null;
  const hosts = new Set(updates.filter((u) => u._row.name === row.name && (u._row.size && row.size ? u._row.size.inches === row.size.inches : false)).map((u) => u.productSku));
  return hosts.size === 1 ? [...hosts][0] : null;
}

function categoryId(name) {
  if (CATEGORY_IDS[name]) return CATEGORY_IDS[name];
  const id = "cat_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!NEW_CATEGORIES.some((c) => c.id === id) && !CATALOG.categories.some((c) => c.id === id)) NEW_CATEGORIES.push({ id, name });
  return id;
}

function newProductName(row) {
  if (row.series === "Cat Door") return `${row.name} Cat Door`;
  const first = row.series.split(/\s+/)[0].toLowerCase();
  if (!row.series || row.series === row.name || row.name.toLowerCase().includes(first)) return row.name;
  return `${row.series} ${row.name}`;
}

const addVariants = [];
const newProductsByKey = new Map();
const allSkus = new Set([...Object.keys(variantBySku), ...Object.keys(productBySku)]);

unmatched.forEach((row) => {
  const vName = variantName(row.side, row.type);
  const donor = priceDonor(row);
  if (allSkus.has(row.code)) throw new Error(`${row.code} collides with an existing SKU`);
  allSkus.add(row.code);
  const variant = { code: row.code, name: vName, stock: row.stock, reorderLevel: row.reorderLevel, priceFromSku: donor };
  const host = hostProduct(row);
  if (host) {
    if (productBySku[host].variants.some((v) => v.name.toLowerCase() === vName.toLowerCase()) || addVariants.some((a) => a.productSku === host && a.name === vName)) {
      throw new Error(`${row.code}: variant "${vName}" already exists on ${host}`);
    }
    addVariants.push({ productSku: host, ...variant });
    return;
  }
  const key = [row.name, row.series, row.size ? row.size.inches : ""].join("|");
  if (!newProductsByKey.has(key)) {
    const isCat = row.series === "Cat Door";
    const size = row.size ? (isCat ? `${fmt(row.size.ft[0] * 12)}x${fmt(row.size.ft[1] * 12)} inch` : `${fmt(row.size.ft[0])}x${fmt(row.size.ft[1])} feet`) : "";
    const base = row.code.replace(/[-_](HAS|CHI)(-[LR])?$/i, "").replace(/[-_][LR]$/i, "").replace(/\*/g, "x").toUpperCase();
    newProductsByKey.set(key, {
      sku: base,
      name: newProductName(row),
      categoryId: categoryId(row.category || "Others"),
      categoryName: row.category || "Others",
      brand: row.brand,
      description: [row.series, size].filter(Boolean).join(" . "),
      unit: isCat ? "pcs" : "feet",
      variants: [],
    });
  }
  const p = newProductsByKey.get(key);
  if (p.variants.some((v) => v.name === vName)) throw new Error(`${row.code}: duplicate variant "${vName}" in new product ${p.name}`);
  p.variants.push(variant);
});

// Product SKUs must be unique too.
const newProducts = [...newProductsByKey.values()];
newProducts.forEach((p) => {
  let sku = p.sku, n = 2;
  while (allSkus.has(sku) && !p.variants.some((v) => v.code === sku)) sku = `${p.sku}-${n++}`;
  p.sku = sku; allSkus.add(sku);
  p.hasVariants = !(p.variants.length === 1 && p.variants[0].name === "Standard");
});

const keptProducts = new Set([...updates.map((u) => u.productSku), ...addVariants.map((a) => a.productSku)]);
const out = {
  id: COUNT_ID,
  label: `Stock count ${new Date(COUNT_ID + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`,
  source: "unique_trader_export_2026-10-06T23-37-04.xlsx",
  rows: rows.length,
  totalUnits: rows.reduce((a, r) => a + num(r["Current Stock"]), 0),
  categories: NEW_CATEGORIES,
  updates: updates.map(({ code, variantSku, stock, reorderLevel }) => ({ code, variantSku, stock, reorderLevel })),
  addVariants,
  newProducts,
  notes,
};

const header = `/* Auto-generated by tools/build-stock-count.js from ${path.relative(ROOT, input)}.
   Applied from Settings → Data & Backup → "Apply stock count" (admin only).
   updates: existing variants (by SKU) set to the counted stock.
   addVariants: new variants added to an existing product.
   newProducts: products in the count that the app didn't have.
   priceFromSku: copy cost/selling price from that variant (same design,
   size and type); null = no reliable price, set it in Products.
   Active products not in the count are archived and set to 0 stock. */
`;
fs.writeFileSync(path.join(ROOT, "js", "stock-count-data.js"), header + "window.STOCK_COUNT = " + JSON.stringify(out, null, 1) + ";\n");

// ---- Report ----
const archived = CATALOG.products.filter((p) => !keptProducts.has(p.sku));
const report = [];
report.push(`Rows: ${rows.length} · units: ${out.totalUnits}`);
report.push(`Matched to existing variants: ${updates.length} (in ${new Set(updates.map((u) => u.productSku)).size} products)`);
report.push(`New variants on existing products: ${addVariants.length}`);
report.push(`New products: ${newProducts.length} (${newProducts.reduce((a, p) => a + p.variants.length, 0)} variants)`);
report.push(`Starter-catalogue products not in the count (archived): ${archived.length} of ${CATALOG.products.length}`);
const noPrice = [...addVariants, ...newProducts.flatMap((p) => p.variants)].filter((v) => !v.priceFromSku);
report.push(`New variants without a price: ${noPrice.length}`);
report.push("", "MATCHES:");
updates.forEach((u) => report.push(`  ${u.code.padEnd(34)} → ${u.variantSku.padEnd(10)} ${u._variant.product.name} · ${u._variant.name} (${u._variant.product.description})`));
report.push("", "NEW VARIANTS ON EXISTING PRODUCTS:");
addVariants.forEach((a) => report.push(`  ${a.code.padEnd(34)} → ${productBySku[a.productSku].name} (${a.productSku}) · ${a.name}${a.priceFromSku ? ` · price from ${a.priceFromSku}` : " · NO PRICE"}`));
report.push("", "NEW PRODUCTS:");
newProducts.forEach((p) => report.push(`  ${p.name} [${p.description}] (${p.sku}): ${p.variants.map((v) => `${v.name}=${v.stock}${v.priceFromSku ? "" : " (no price)"}`).join(", ")}`));
report.push("", "NOTES:", ...notes.map((n) => "  " + n));
console.log(report.join("\n"));
