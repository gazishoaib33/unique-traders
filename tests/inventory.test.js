/* Inventory correctness tests for the data layer (js/db.js + js/storage.js).
   Run with:  npm test   (or: node --test tests/*.test.js) */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, freshApp, createDoor, createLocalStorage } = require("./harness");

const level = (DB, v) => DB.Stock.getLevel(v.id);
const plain = (x) => JSON.parse(JSON.stringify(x)); // vm objects -> this realm, for deepEqual

// ---------------------------------------------------------------- Products
test("create a valid product with variants and opening stock", async () => {
  const { DB } = await freshApp();
  const { product, left, right } = await createDoor(DB, { left: 5, right: 3 });
  assert.equal(product.name, "Cosmic Door Bronze");
  assert.equal(level(DB, left), 5);
  assert.equal(level(DB, right), 3);
  // Opening stock is recorded as its own, distinguishable ledger type.
  const entries = await DB.Stock.ledgerFor(left.id);
  assert.deepEqual(plain(entries.map((e) => e.type)), ["initial"]);
  // Multi-variant products get distinct, auto-generated variant SKUs.
  assert.notEqual(left.sku, right.sku);
});

test("reject a product with missing name or SKU", async () => {
  const { DB } = await freshApp();
  await assert.rejects(DB.Products.create({ name: "", sku: "X1" }, []), /name is required/);
  await assert.rejects(DB.Products.create({ name: "Door", sku: "  " }, []), /SKU is required/);
  assert.equal((await DB.Products.list()).length, 0);
});

test("reject invalid numbers on a product (negative price, fractional/negative stock)", async () => {
  const { DB } = await freshApp();
  await assert.rejects(DB.Products.create({ name: "D", sku: "S1" }, [{ name: "A", sellingPrice: -5 }]), /Selling price/);
  await assert.rejects(DB.Products.create({ name: "D", sku: "S1" }, [{ name: "A", openingStock: -2 }]), /Opening stock/);
  await assert.rejects(DB.Products.create({ name: "D", sku: "S1" }, [{ name: "A", openingStock: 1.5 }]), /Opening stock/);
  // Nothing half-created after the failures.
  assert.equal((await DB.Products.list()).length, 0);
  assert.equal(DB.Variants.all().length, 0);
});

test("prevent duplicate product SKU (create and edit)", async () => {
  const { DB } = await freshApp();
  await createDoor(DB, { sku: "UT-1" });
  await assert.rejects(DB.Products.create({ name: "Other", sku: "ut-1" }, []), /already used/);
  const other = await DB.Products.create({ name: "Other", sku: "UT-2" }, []);
  await assert.rejects(DB.Products.update(other.id, { sku: "UT-1" }), /already used/);
});

test("prevent duplicate variants (same name twice, duplicate SKU or barcode)", async () => {
  const { DB } = await freshApp();
  await assert.rejects(
    DB.Products.create({ name: "Door", sku: "D1" }, [{ name: "Left Hand" }, { name: "left hand " }]),
    /listed twice/
  );
  const { product, left } = await createDoor(DB, { sku: "UT-9" });
  await assert.rejects(DB.Products.create({ name: "Other", sku: "O1" }, [{ name: "A", sku: left.sku }]), /SKU .* already in use/);
  await DB.Products.create({ name: "Third", sku: "T1" }, [{ name: "A", barcode: "884034" }]);
  await assert.rejects(DB.Products.create({ name: "Fourth", sku: "F1" }, [{ name: "A", barcode: "884034" }]), /Barcode .* already in use/);
  // Adding a second "Left Hand" to an existing product via edit is rejected too.
  const rows = DB.Variants.listByProduct(product.id).map((v) => ({ id: v.id, name: v.name }));
  await assert.rejects(DB.Products.update(product.id, {}, [...rows, { name: "LEFT HAND" }]), /listed twice/);
});

test("an archived variant's name can't be re-added, but a removed never-used one can", async () => {
  const { DB } = await freshApp();
  const p = await DB.Products.create({ name: "Door", sku: "D1" }, [{ name: "Left" }, { name: "Right", openingStock: 0 }]);
  const [left, right] = DB.Variants.listByProduct(p.id);
  // Right never had stock or sales: removing it and adding "Right" again is fine.
  await DB.Products.update(p.id, {}, [{ id: left.id, name: "Left" }, { name: "Right" }]);
  assert.equal(DB.Variants.listByProduct(p.id).length, 2);
  assert.equal(DB.Variants.get(right.id), null, "unused variant was deleted, not archived");
  // Left gets history, then is removed (archived) — re-adding "Left" is refused.
  await DB.Stock.adjust({ variantId: left.id, change: 1, type: "initial" });
  await DB.Stock.adjust({ variantId: left.id, change: -1, type: "correction" });
  const rightNow = DB.Variants.listByProduct(p.id).find((v) => v.name === "Right" && v.active);
  await DB.Products.update(p.id, {}, [{ id: rightNow.id, name: "Right" }]);
  assert.equal(DB.Variants.get(left.id).active, false);
  await assert.rejects(DB.Products.update(p.id, {}, [{ id: rightNow.id, name: "Right" }, { name: "left" }]), /archived variant/);
});

test("editing a product never changes stock of existing variants", async () => {
  const { DB } = await freshApp();
  const { product, left, right } = await createDoor(DB, { left: 5, right: 3 });
  const rows = [left, right].map((v) => ({ id: v.id, name: v.name, sellingPrice: 15000, openingStock: 99 }));
  await DB.Products.update(product.id, { name: "Cosmic Door Bronze (new price)" }, rows);
  assert.equal(level(DB, left), 5);
  assert.equal(level(DB, right), 3);
  assert.equal(DB.Variants.get(left.id).sellingPrice, 15000);
});

test("a variant with stock cannot be removed from a product (stock would vanish)", async () => {
  const { DB } = await freshApp();
  const { product, left } = await createDoor(DB, { left: 5, right: 3 });
  await assert.rejects(DB.Products.update(product.id, {}, [{ id: left.id, name: left.name }]), /still has 3 in stock/);
  assert.equal(DB.Variants.listByProduct(product.id).filter((v) => v.active).length, 2);
});

// ---------------------------------------------------------------- Stock
test("add opening stock later, then additional stock (distinct ledger types)", async () => {
  const { DB } = await freshApp();
  const p = await DB.Products.create({ name: "Frame", sku: "FR-1" }, [{ name: "Standard" }]);
  const v = DB.Variants.listByProduct(p.id)[0];
  assert.equal(level(DB, v), 0);
  await DB.Stock.adjust({ variantId: v.id, change: 10, type: "initial" });
  await DB.Stock.adjust({ variantId: v.id, change: 4, type: "purchase", reference: "PO-1" });
  assert.equal(level(DB, v), 14);
  const types = (await DB.Stock.ledgerFor(v.id)).map((e) => e.type).sort();
  assert.deepEqual(plain(types), ["initial", "purchase"]);
  // A second "opening stock" is refused — later stock must be a purchase/correction.
  await assert.rejects(DB.Stock.adjust({ variantId: v.id, change: 3, type: "initial" }), /already recorded/);
});

test("stock adjustments reject zero, fractional, wrong-direction and over-removal", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5 });
  await assert.rejects(DB.Stock.adjust({ variantId: left.id, change: 0, type: "purchase" }), /other than 0/);
  await assert.rejects(DB.Stock.adjust({ variantId: left.id, change: 1.5, type: "purchase" }), /whole number/);
  await assert.rejects(DB.Stock.adjust({ variantId: left.id, change: -1, type: "purchase" }), /only add/);
  await assert.rejects(DB.Stock.adjust({ variantId: left.id, change: 1, type: "damage" }), /only remove/);
  await assert.rejects(DB.Stock.adjust({ variantId: left.id, change: -6, type: "damage" }), /only 5 in stock/);
  await assert.rejects(DB.Stock.adjust({ variantId: "nope", change: 1, type: "purchase" }), /valid product variant/);
  assert.equal(level(DB, left), 5);
  await DB.Stock.adjust({ variantId: left.id, change: -5, type: "damage" });
  assert.equal(level(DB, left), 0);
});

// ---------------------------------------------------------------- Sales
const sell = (DB, variant, qty, extra = {}) =>
  DB.Sales.create({ items: [{ variantId: variant.id, qty, unitPrice: variant.sellingPrice, discount: 0 }], paymentMethod: "cash", staffId: "u1", ...extra });

test("selling available stock reduces exactly that variant", async () => {
  const { DB } = await freshApp();
  const { left, right } = await createDoor(DB, { left: 5, right: 3 });
  const sale = await sell(DB, left, 2);
  assert.equal(level(DB, left), 3);
  assert.equal(level(DB, right), 3, "the other handing is untouched");
  assert.equal(sale.items[0].variantName, "Left Hand");
  assert.equal(sale.items[0].sku, left.sku);
  assert.equal(sale.grandTotal, 2 * 14200);
  const s = await DB.Sales.get(sale.id);
  assert.equal(s.status, "paid");
});

test("reject a sale larger than available stock (nothing is written)", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 2 });
  await assert.rejects(sell(DB, left, 3), /Not enough stock .* 2 available, 3 requested/);
  assert.equal(level(DB, left), 2);
  assert.equal((await DB.Sales.list()).length, 0);
  assert.equal((await DB.Payments.list()).length, 0);
});

test("the same variant on two cart lines is checked as one total", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 3 });
  const line = { variantId: left.id, qty: 2, unitPrice: 100 };
  await assert.rejects(DB.Sales.create({ items: [line, line], paymentMethod: "cash" }), /3 available, 4 requested/);
  assert.equal(level(DB, left), 3);
});

test("reject invalid sale lines: zero/negative/fractional qty, negative price, unknown variant, empty cart", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5 });
  await assert.rejects(sell(DB, left, 0), /Quantity .* at least 1/);
  await assert.rejects(sell(DB, left, -1), /Quantity/);
  await assert.rejects(sell(DB, left, 1.5), /Quantity/);
  await assert.rejects(DB.Sales.create({ items: [{ variantId: left.id, qty: 1, unitPrice: -10 }] }), /Price/);
  await assert.rejects(DB.Sales.create({ items: [{ variantId: left.id, qty: 1, unitPrice: 10, discount: 11 }] }), /Discount .* more than the line total/);
  await assert.rejects(DB.Sales.create({ items: [{ variantId: left.id, qty: 1, unitPrice: 10 }], discountTotal: 50 }), /more than the subtotal/);
  await assert.rejects(DB.Sales.create({ items: [{ variantId: "var_missing", qty: 1, unitPrice: 10 }] }), /no longer exists/);
  await assert.rejects(DB.Sales.create({ items: [] }), /at least one item/);
  assert.equal(level(DB, left), 5);
});

test("archived products cannot be sold", async () => {
  const { DB } = await freshApp();
  const { product, left } = await createDoor(DB, { left: 5 });
  await DB.Products.archive(product.id, false);
  await assert.rejects(sell(DB, left, 1), /archived/);
});

test("duplicate submission of the same cart creates one sale only", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5 });
  const a = await sell(DB, left, 2, { clientRef: "chk_1" });
  const b = await sell(DB, left, 2, { clientRef: "chk_1" });
  assert.equal(a.id, b.id);
  assert.equal(level(DB, left), 3);
  assert.equal((await DB.Sales.list()).length, 1);
});

test("rapid back-to-back sales stop exactly at zero stock", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => sell(DB, left, 1)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
  assert.equal(level(DB, left), 0);
  const invoices = (await DB.Sales.list()).map((s) => s.invoiceNo);
  assert.equal(new Set(invoices).size, 5, "invoice numbers are unique");
});

test("two open tabs cannot overwrite each other's sales or oversell", async () => {
  const shared = createLocalStorage();
  const tab1 = await freshApp({ localStorage: shared });
  const { left } = await createDoor(tab1.DB, { left: 3 });
  const tab2 = createApp({ localStorage: shared }); // opened after setup, has its own cache

  await sell(tab1.DB, left, 2); // tab2's cache is now stale
  await assert.rejects(sell(tab2.DB, tab2.DB.Variants.get(left.id), 2), /1 available, 2 requested/);
  await sell(tab2.DB, tab2.DB.Variants.get(left.id), 1);

  const fresh = createApp({ localStorage: shared });
  assert.equal(fresh.DB.Stock.getLevel(left.id), 0);
  assert.equal((await fresh.DB.Sales.list()).length, 2, "both tabs' sales survived");
});

test("cancelling a sale restores stock once, even if cancelled twice", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5 });
  const sale = await sell(DB, left, 2);
  await DB.Sales.cancel(sale.id, "u1");
  await DB.Sales.cancel(sale.id, "u1");
  assert.equal(level(DB, left), 5);
  assert.equal((await DB.Sales.get(sale.id)).status, "cancelled");
});

test("stock after many mixed transactions equals the ledger history", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 10 });
  await DB.Stock.adjust({ variantId: left.id, change: 6, type: "purchase" }); // 16
  const s1 = await sell(DB, left, 4); // 12
  await sell(DB, left, 3); // 9
  await DB.Stock.adjust({ variantId: left.id, change: -1, type: "damage" }); // 8
  await DB.Sales.cancel(s1.id); // 12
  await DB.Stock.adjust({ variantId: left.id, change: -2, type: "correction" }); // 10
  assert.equal(level(DB, left), 10);

  const history = await DB.Stock.ledgerFor(left.id);
  assert.deepEqual(plain(history.map((e) => e.type).sort()), ["correction", "damage", "initial", "purchase", "return", "sale", "sale"].sort());
  assert.equal(history.reduce((a, e) => a + e.change, 0), 10);
  const saleEntries = history.filter((e) => e.type === "sale");
  assert.ok(saleEntries.every((e) => /^INV-\d{4}-\d{4}$/.test(e.reference)), "sale movements reference their invoice");
});

test("a failed save (storage full) rolls back the whole sale", async () => {
  const app = await freshApp();
  const { left } = await createDoor(app.DB, { left: 5 });
  app.localStorage.failWrites = true;
  await assert.rejects(sell(app.DB, left, 2), /storage may be full/);
  app.localStorage.failWrites = false;
  assert.equal(level(app.DB, left), 5);
  assert.equal((await app.DB.Sales.list()).length, 0);
});

// ---------------------------------------------------------------- Payments
test("payments cannot exceed what is due, and voided payments stay in history", async () => {
  const { DB } = await freshApp();
  const { left } = await createDoor(DB, { left: 5, price: 1000 });
  const customer = await DB.Customers.create({ name: "Rahim Contractor" });
  const sale = await sell(DB, left, 2, { customerId: customer.id, paidNow: 500 });
  assert.equal((await DB.Sales.get(sale.id)).due, 1500);

  await assert.rejects(DB.Payments.create({ customerId: customer.id, saleId: sale.id, amount: 1600 }), /more than/);
  const pay = await DB.Payments.create({ customerId: customer.id, saleId: sale.id, amount: 1500 });
  assert.equal((await DB.Sales.get(sale.id)).status, "paid");

  await DB.Payments.remove(pay.id, "admin");
  assert.equal((await DB.Sales.get(sale.id)).due, 1500);
  assert.equal(DB.Customers.balance(customer.id), 1500);
  const raw = app_payments(DB).find((p) => p.id === pay.id);
  assert.equal(raw.voided, true, "voided payment kept for audit");
});
function app_payments(DB) { return DB.Backup.exportJSON().collections.payments; }

// ---------------------------------------------------------------- Search & catalog
test("search finds the right variant by size, handing and partial words", async () => {
  const { DB, Utils } = await freshApp();
  await createDoor(DB, { name: "Cosmic Door Bronze", sku: "UT-1" });
  await DB.Products.create({ name: "Hasbol Door", sku: "UT-2", description: "7x2.5 feet" }, [{ name: "Left" }, { name: "Right" }]);
  const names = async (q) => (await DB.Products.list({ search: q })).map((p) => p.name);
  assert.deepEqual(plain(await names("7 x 2.5")), ["Hasbol Door"]);
  assert.deepEqual(plain(await names("7×3.5 cosmic")), ["Cosmic Door Bronze"]);
  assert.deepEqual(plain(await names("hasbol right")), ["Hasbol Door"]);
  const variants = DB.Products.sellableVariants().filter((r) => Utils.matchesSearch(r.searchText, "hasbol 7x2.5 left"));
  assert.equal(variants.length, 1);
  assert.equal(variants[0].variant.name, "Left");
});

test("the real catalog seeds with unique SKUs and only opening-stock movements", () => {
  const { DB } = createApp({ catalog: true });
  return DB.init().then(() => {
    const variants = DB.Variants.all();
    assert.equal(variants.length, 532);
    assert.equal(new Set(variants.map((v) => v.sku.toLowerCase())).size, 532);
    const ledger = DB.Backup.exportJSON().collections.stockLedger;
    assert.ok(ledger.length > 0 && ledger.every((e) => e.type === "initial" && e.change > 0));
  });
});

test("the last active admin cannot be removed or demoted", async () => {
  const { DB } = await freshApp();
  const [admin] = await DB.Users.list();
  await assert.rejects(DB.Users.update(admin.id, { role: "staff" }), /active Admin/);
  await assert.rejects(DB.Users.remove(admin.id), /active Admin/);
});

// ---------------------------------------------------------------- Roles
test("viewer mode is read-only: catalog only, no quantities, costs or admin pages", async () => {
  const { Auth } = await freshApp();
  Auth.loginViewer();
  assert.equal(Auth.currentUser().role, "viewer");
  assert.equal(Auth.can("catalog"), true);
  for (const perm of ["dashboard", "products", "inventory", "sales", "customers", "payments", "reports", "settings", "products.edit", "inventory.adjust", "stock.quantities"]) {
    assert.equal(Auth.can(perm), false, `viewer must not have ${perm}`);
  }
  assert.equal(Auth.homeRoute(), "catalog");
  Auth.logout();
  assert.equal(Auth.currentUser(), null);
});

test("admin and staff keep their access and land on the dashboard", async () => {
  const { DB, Auth } = await freshApp();
  assert.equal(Auth.login("owner", "pw").ok, true);
  assert.equal(Auth.can("inventory.adjust"), true);
  assert.equal(Auth.can("catalog"), true);
  assert.equal(Auth.homeRoute(), "dashboard");
  await DB.Users.create({ name: "Karim", username: "karim", password: "k", role: "staff" });
  Auth.login("karim", "k");
  assert.equal(Auth.can("sales"), true);
  assert.equal(Auth.can("inventory.adjust"), false);
});

test("viewer accounts can be created; unknown roles are rejected", async () => {
  const { DB, Auth } = await freshApp();
  const v = await DB.Users.create({ name: "Showroom", username: "showroom", password: "s", role: "viewer" });
  assert.equal(v.role, "viewer");
  assert.equal(Auth.login("showroom", "s").ok, true);
  assert.equal(Auth.can("sales"), false);
  await assert.rejects(DB.Users.update(v.id, { role: "superuser" }), /Unknown role/);
});
