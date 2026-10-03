/* =====================================================================
   db.js — the data / repository layer.

   Every call returns a Promise, even though the underlying engine
   (Store → localStorage) is synchronous. This is deliberate: it means
   every page in this app already talks to the data layer the same way
   a Supabase-backed version would (`await DB.products.list()`), so
   swapping storage.js + the internals of this file for real Supabase
   calls later requires NO changes to any page/component code.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  function ok(value) { return Promise.resolve(value); }
  function fail(message) { return Promise.reject(new Error(message)); }

  function col(name, fallback) { return Store.getCollection(name, fallback); }
  function saveCol(name, arr) { Store.setCollection(name, arr); }

  /** Runs fn as one all-or-nothing write (see Store.transaction). Any
   *  validation error thrown inside rolls everything back and rejects. */
  function mutate(fn) {
    try { return ok(Store.transaction(fn)); }
    catch (e) { return Promise.reject(e instanceof Error ? e : new Error(String(e))); }
  }
  function check(condition, message) { if (!condition) throw new Error(message); }
  function isBlank(v) { return v === undefined || v === null || String(v).trim() === ""; }
  function wholeNumber(value, label, { min = 0 } = {}) {
    const n = Number(value);
    check(!isBlank(value) && Number.isInteger(n) && n >= min, `${label} must be a whole number${min > 0 ? ` of at least ${min}` : " (0 or more)"}`);
    return n;
  }
  function money(value, label) {
    const n = Number(value);
    check(!isBlank(value) && Number.isFinite(n) && n >= 0, `${label} must be 0 or more`);
    return Math.round(n * 100) / 100;
  }
  const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const round2 = (n) => Math.round(n * 100) / 100;

  // Payments are voided rather than deleted so the history stays auditable;
  // every balance/paid calculation goes through this.
  function activePayments() { return col("payments", []).filter((p) => !p.voided); }

  // ---------------------------------------------------------------
  // Bootstrap / seeding
  // ---------------------------------------------------------------
  function init() {
    if (Store.isEmpty()) {
      const seeded = Seed.generate();
      Store.transaction(() => Object.keys(seeded).forEach((k) => Store.setCollection(k, seeded[k])));
    }
    const settings = col("settings", {});
    U.setCurrency(settings.currencySymbol || "৳", settings.currencyCode || "BDT");
    return ok(true);
  }

  // ---------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------
  const Categories = {
    list() { return ok([...col("categories", [])].sort((a, b) => a.name.localeCompare(b.name))); },
    get(id) { return ok(col("categories", []).find((c) => c.id === id) || null); },
    create(data) {
      return mutate(() => {
        const name = String(data.name || "").trim();
        check(name, "Category name is required");
        const list = col("categories", []);
        check(!list.some((c) => sameText(c.name, name)), `Category "${name}" already exists`);
        const rec = { id: U.uid("cat"), name };
        list.push(rec); saveCol("categories", list);
        return rec;
      });
    },
    update(id, data) {
      return mutate(() => {
        const list = col("categories", []);
        const rec = list.find((c) => c.id === id);
        check(rec, "Category not found");
        const name = String(data.name || "").trim();
        check(name, "Category name is required");
        check(!list.some((c) => c.id !== id && sameText(c.name, name)), `Category "${name}" already exists`);
        rec.name = name;
        saveCol("categories", list);
        return rec;
      });
    },
    remove(id) {
      return mutate(() => {
        check(!col("products", []).some((p) => p.categoryId === id), "Category is used by existing products");
        saveCol("categories", col("categories", []).filter((c) => c.id !== id));
        return true;
      });
    },
  };

  // ---------------------------------------------------------------
  // Stock (ledger-based; level = sum of signed changes per variant)
  //
  // Ledger entry types:
  //   initial   — opening stock (only when a variant has no movements yet)
  //   purchase  — restock from supplier (+)
  //   sale      — sold via invoice (−), written only by Sales.create
  //   return    — customer return / cancelled sale (+)
  //   damage    — damaged or lost (−)
  //   correction, other — stock-count fixes (±)
  // Entries are never edited or deleted; mistakes are fixed with a new
  // correction entry so the history stays auditable.
  // ---------------------------------------------------------------
  const ADJUST_TYPES = {
    initial: "add", purchase: "add", return: "add", damage: "remove",
    correction: "either", other: "either", adjustment: "either",
  };

  const Stock = {
    ledgerFor(variantId) {
      return ok(col("stockLedger", []).filter((s) => s.variantId === variantId).sort((a, b) => new Date(b.date) - new Date(a.date)));
    },
    getLevel(variantId) {
      const total = col("stockLedger", []).filter((s) => s.variantId === variantId).reduce((a, s) => a + s.change, 0);
      return total;
    },
    levelsMap() {
      const map = {};
      col("stockLedger", []).forEach((s) => { map[s.variantId] = (map[s.variantId] || 0) + s.change; });
      return map;
    },
    adjust({ variantId, change, type, note, reference, userId }) {
      return mutate(() => {
        const variant = col("variants", []).find((v) => v.id === variantId);
        check(variant, "Select a valid product variant");
        const qty = Number(change);
        check(Number.isInteger(qty) && qty !== 0, "Quantity must be a whole number other than 0");
        const kind = type || "adjustment";
        check(kind in ADJUST_TYPES, `Unknown stock movement type "${kind}"`);
        if (ADJUST_TYPES[kind] === "add") check(qty > 0, "This reason can only add stock");
        if (ADJUST_TYPES[kind] === "remove") check(qty < 0, "This reason can only remove stock");

        const ledger = col("stockLedger", []);
        const entries = ledger.filter((s) => s.variantId === variantId);
        if (kind === "initial") check(!entries.length, "Opening stock was already recorded for this variant — use Purchase or Stock Count Correction instead");
        const level = entries.reduce((a, s) => a + s.change, 0);
        check(level + qty >= 0, `Cannot remove ${-qty} — only ${level} in stock`);

        const entry = { id: U.uid("stk"), variantId, change: qty, type: kind, note: String(note || "").trim(), reference: reference || (kind === "initial" ? "Opening Balance" : null), date: U.nowISO(), userId: userId || null };
        ledger.push(entry); saveCol("stockLedger", ledger);
        return entry;
      });
    },
    lowStockList(defaultThreshold) {
      const levels = Stock.levelsMap();
      const variants = col("variants", []);
      const productMap = Object.fromEntries(col("products", []).map((p) => [p.id, p]));
      const rows = [];
      variants.forEach((v) => {
        const p = productMap[v.productId];
        if (!v.active || !p || !p.active) return;
        const level = levels[v.id] || 0;
        const threshold = v.reorderLevel != null ? v.reorderLevel : defaultThreshold;
        if (level <= threshold) rows.push({ variant: v, product: p, level, threshold });
      });
      return rows.sort((a, b) => a.level - b.level);
    },
    stockValue() {
      const levels = Stock.levelsMap();
      return col("variants", []).reduce((sum, v) => sum + (levels[v.id] || 0) * v.costPrice, 0);
    },
    retailValue() {
      const levels = Stock.levelsMap();
      return col("variants", []).reduce((sum, v) => sum + (levels[v.id] || 0) * v.sellingPrice, 0);
    },
  };

  // ---------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------
  const Variants = {
    listByProduct(productId) { return col("variants", []).filter((v) => v.productId === productId); },
    get(id) { return col("variants", []).find((v) => v.id === id) || null; },
    all() { return col("variants", []); },
  };

  /** Text a search query is matched against for one variant. */
  function variantSearchText(product, variant, categoryName) {
    return [product.name, product.sku, product.description, product.brand, categoryName, variant.name, variant.sku, variant.barcode].join(" ");
  }

  // ---------------------------------------------------------------
  // Products (+ nested variant reconciliation)
  // ---------------------------------------------------------------
  function cleanProductFields(data) {
    const name = String(data.name || "").trim();
    const sku = String(data.sku || "").trim();
    check(name, "Product name is required");
    check(sku, "Product SKU is required");
    return { name, sku };
  }

  function assertProductSkuFree(sku, exceptProductId) {
    check(!col("products", []).some((p) => p.id !== exceptProductId && sameText(p.sku, sku)), `SKU "${sku}" is already used by another product`);
  }

  /**
   * Validates the variant rows from the product form and returns cleaned
   * records. Rules (this is the "unique constraint" layer):
   *  - every variant name is unique within its product (e.g. only one
   *    "Left Hand"), so a sold variant is always identifiable;
   *  - variant SKUs are unique across the whole catalog — a blank SKU is
   *    auto-generated (the product SKU for single-variant products,
   *    PRODUCTSKU-2, -3… otherwise);
   *  - barcodes, when given, are unique across the whole catalog;
   *  - prices are numbers ≥ 0, reorder level / opening stock are whole numbers ≥ 0.
   */
  function prepareVariants(product, rows) {
    check(rows.length > 0, "At least one variant is required");
    const allVariants = col("variants", []);
    const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id));

    const cleaned = rows.map((r) => {
      const existing = r.id ? allVariants.find((v) => v.id === r.id) : null;
      if (r.id) check(existing && existing.productId === product.id, "A variant in this form no longer exists — reopen the product and try again");
      const name = String(r.name || "").trim() || "Default";
      return {
        existing,
        name,
        sku: String(r.sku ?? "").trim() || (existing ? existing.sku : ""),
        barcode: String(r.barcode ?? (existing ? existing.barcode : "") ?? "").trim(),
        costPrice: money(isBlank(r.costPrice) ? 0 : r.costPrice, `Cost price for "${name}"`),
        sellingPrice: money(isBlank(r.sellingPrice) ? 0 : r.sellingPrice, `Selling price for "${name}"`),
        reorderLevel: wholeNumber(isBlank(r.reorderLevel) ? (existing ? existing.reorderLevel : 10) : r.reorderLevel, `Reorder level for "${name}"`),
        openingStock: existing ? 0 : wholeNumber(isBlank(r.openingStock) ? 0 : r.openingStock, `Opening stock for "${name}"`),
        attributes: r.attributes ?? (existing ? existing.attributes : {}),
      };
    });

    // Every variant not being saved by this form: other products' variants
    // plus this product's archived ones and any rows just removed that have
    // history (those get archived, so their name/SKU stays taken). Removed
    // rows without history are deleted, so they don't block anything.
    const ledger = col("stockLedger", []);
    const sales = col("sales", []);
    const willBeDeleted = (v) => v.productId === product.id && v.active && !ledger.some((l) => l.variantId === v.id) && !sales.some((s) => s.items.some((it) => it.variantId === v.id));
    const outside = allVariants.filter((v) => !keptIds.has(v.id) && !willBeDeleted(v));

    // Unique names within the product, so "Left Hand" can't exist twice as
    // two separate stock lines.
    cleaned.forEach((c, i) => {
      check(!cleaned.some((o, j) => j < i && sameText(o.name, c.name)), `Variant "${c.name}" is listed twice — each variant name must be different`);
      check(!outside.some((v) => v.productId === product.id && sameText(v.name, c.name)), `"${c.name}" matches an existing or archived variant of this product — keep the existing row instead of adding it again`);
    });

    const skuTaken = (sku, self) => outside.some((v) => sameText(v.sku, sku)) || cleaned.some((o) => o !== self && sameText(o.sku, sku));

    cleaned.forEach((c, i) => {
      if (c.sku) return;
      let candidate = cleaned.length === 1 ? product.sku : `${product.sku}-${i + 1}`;
      let n = i + 1;
      while (skuTaken(candidate, c)) candidate = `${product.sku}-${++n}`;
      c.sku = candidate;
    });
    cleaned.forEach((c) => {
      check(!skuTaken(c.sku, c), `Variant SKU "${c.sku}" is already in use`);
      if (c.barcode) {
        check(!outside.some((v) => v.barcode && sameText(v.barcode, c.barcode)) && !cleaned.some((o) => o !== c && sameText(o.barcode, c.barcode)), `Barcode "${c.barcode}" is already in use`);
      }
    });
    return cleaned;
  }

  function newVariantRecord(productId, c) {
    return { id: U.uid("var"), productId, name: c.name, sku: c.sku, barcode: c.barcode, attributes: c.attributes || {}, costPrice: c.costPrice, sellingPrice: c.sellingPrice, reorderLevel: c.reorderLevel, active: true };
  }

  function openingEntry(variantId, qty, note, userId) {
    return { id: U.uid("stk"), variantId, change: qty, type: "initial", reference: "Opening Balance", note, date: U.nowISO(), userId: userId || null };
  }

  const Products = {
    list({ search, categoryId, activeOnly } = {}) {
      let rows = col("products", []);
      if (activeOnly) rows = rows.filter((p) => p.active);
      if (categoryId) rows = rows.filter((p) => p.categoryId === categoryId);
      if (search && search.trim()) {
        const catMap = Object.fromEntries(col("categories", []).map((c) => [c.id, c.name]));
        const byProduct = U.groupBy(col("variants", []), (v) => v.productId);
        rows = rows.filter((p) => {
          const variants = byProduct[p.id] || [];
          const text = [p.name, p.sku, p.description, p.brand, catMap[p.categoryId], ...variants.map((v) => `${v.name} ${v.sku} ${v.barcode}`)].join(" ");
          return U.matchesSearch(text, search);
        });
      }
      rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
      return ok(rows);
    },
    get(id) { return ok(col("products", []).find((p) => p.id === id) || null); },
    getWithVariants(id) {
      const p = col("products", []).find((x) => x.id === id);
      if (!p) return ok(null);
      return ok({ ...p, variants: Variants.listByProduct(id) });
    },
    /** Other products whose name looks the same (ignoring case, spaces and
     *  punctuation) — used to warn before creating a likely duplicate. */
    findSimilar(name, exceptId) {
      const key = U.normalizeSearch(name).replace(/[^a-z0-9]/g, "");
      if (!key) return [];
      return col("products", []).filter((p) => p.id !== exceptId && U.normalizeSearch(p.name).replace(/[^a-z0-9]/g, "") === key);
    },
    /** Every sellable variant with its product, category and stock — the
     *  data behind the POS and stock-adjustment pickers. */
    sellableVariants() {
      const levels = Stock.levelsMap();
      const productMap = Object.fromEntries(col("products", []).filter((p) => p.active).map((p) => [p.id, p]));
      const catMap = Object.fromEntries(col("categories", []).map((c) => [c.id, c.name]));
      return col("variants", []).filter((v) => v.active && productMap[v.productId]).map((v) => {
        const p = productMap[v.productId];
        return { variant: v, product: p, categoryName: catMap[p.categoryId] || "", stock: levels[v.id] || 0, searchText: variantSearchText(p, v, catMap[p.categoryId]) };
      }).sort((a, b) => a.product.name.localeCompare(b.product.name) || a.variant.name.localeCompare(b.variant.name));
    },

    create(productData, variantsData) {
      return mutate(() => {
        const { name, sku } = cleanProductFields(productData);
        assertProductSkuFree(sku, null);
        const products = col("products", []);
        const product = {
          id: U.uid("prod"),
          sku,
          name,
          categoryId: productData.categoryId || null,
          brand: productData.brand || "",
          description: productData.description || "",
          unit: productData.unit || "pcs",
          hasVariants: !!productData.hasVariants,
          imageUrl: productData.imageUrl || "",
          active: true,
          createdAt: U.nowISO(),
          updatedAt: U.nowISO(),
        };
        const rows = (variantsData && variantsData.length ? variantsData : [{ name: "Default" }]).map((v) => ({ ...v, id: undefined }));
        const cleaned = prepareVariants(product, rows);
        products.push(product);
        saveCol("products", products);

        const variants = col("variants", []);
        const ledger = col("stockLedger", []);
        cleaned.forEach((c) => {
          const variant = newVariantRecord(product.id, c);
          variants.push(variant);
          if (c.openingStock > 0) ledger.push(openingEntry(variant.id, c.openingStock, "Added via Products page", productData.userId));
        });
        saveCol("variants", variants);
        saveCol("stockLedger", ledger);
        return product;
      });
    },

    update(id, productData, variantsData) {
      return mutate(() => {
        const products = col("products", []);
        const product = products.find((p) => p.id === id);
        check(product, "Product not found");
        const name = productData.name !== undefined ? String(productData.name).trim() : product.name;
        const sku = productData.sku !== undefined ? String(productData.sku).trim() : product.sku;
        cleanProductFields({ name, sku });
        assertProductSkuFree(sku, id);
        Object.assign(product, {
          name,
          sku,
          categoryId: productData.categoryId !== undefined ? productData.categoryId : product.categoryId,
          brand: productData.brand ?? product.brand,
          description: productData.description ?? product.description,
          unit: productData.unit ?? product.unit,
          hasVariants: productData.hasVariants ?? product.hasVariants,
          imageUrl: productData.imageUrl ?? product.imageUrl,
          active: productData.active ?? product.active,
          updatedAt: U.nowISO(),
        });
        saveCol("products", products);

        if (variantsData) {
          const cleaned = prepareVariants(product, variantsData);
          const allVariants = col("variants", []);
          const ledger = col("stockLedger", []);
          const levels = Stock.levelsMap();
          const keepIds = new Set();

          cleaned.forEach((c) => {
            if (c.existing) {
              Object.assign(c.existing, { name: c.name, sku: c.sku, barcode: c.barcode, attributes: c.attributes, costPrice: c.costPrice, sellingPrice: c.sellingPrice, reorderLevel: c.reorderLevel, active: true });
              keepIds.add(c.existing.id);
            } else {
              const variant = newVariantRecord(id, c);
              allVariants.push(variant);
              keepIds.add(variant.id);
              if (c.openingStock > 0) ledger.push(openingEntry(variant.id, c.openingStock, "Added via edit", productData.userId));
            }
          });

          // Archive (not hard-delete) variants removed from the form if they have history; else drop them.
          // A variant that still has stock can't be removed — that stock would silently vanish.
          allVariants.filter((v) => v.productId === id && v.active && !keepIds.has(v.id)).forEach((v) => {
            const level = levels[v.id] || 0;
            check(level === 0, `Variant "${v.name}" still has ${level} in stock — adjust it to 0 on the Inventory page before removing it`);
            const referenced = ledger.some((l) => l.variantId === v.id) || col("sales", []).some((s) => s.items.some((it) => it.variantId === v.id));
            if (referenced) v.active = false;
            else allVariants.splice(allVariants.indexOf(v), 1);
          });

          saveCol("variants", allVariants);
          saveCol("stockLedger", ledger);
        }
        return product;
      });
    },

    archive(id, active) {
      return mutate(() => {
        const products = col("products", []);
        const p = products.find((x) => x.id === id);
        check(p, "Product not found");
        p.active = active;
        saveCol("products", products);
        return p;
      });
    },

    remove(id) {
      return mutate(() => {
        const variantIds = col("variants", []).filter((v) => v.productId === id).map((v) => v.id);
        const referenced = col("stockLedger", []).some((l) => variantIds.includes(l.variantId)) || col("sales", []).some((s) => s.items.some((it) => variantIds.includes(it.variantId)));
        check(!referenced, "Product has stock or sales history — archive it instead of deleting.");
        saveCol("products", col("products", []).filter((p) => p.id !== id));
        saveCol("variants", col("variants", []).filter((v) => v.productId !== id));
        return true;
      });
    },
  };

  // ---------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------
  const Customers = {
    list({ search, type } = {}) {
      let rows = col("customers", []);
      if (type) rows = rows.filter((c) => c.type === type);
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || "").includes(q));
      }
      return ok([...rows].sort((a, b) => a.name.localeCompare(b.name)));
    },
    get(id) { return ok(col("customers", []).find((c) => c.id === id) || null); },
    create(data) {
      return mutate(() => {
        const name = String(data.name || "").trim();
        check(name, "Customer name is required");
        const rec = { id: U.uid("cust"), name, phone: String(data.phone || "").trim(), email: data.email || "", address: data.address || "", type: data.type || "retail", creditLimit: money(isBlank(data.creditLimit) ? 0 : data.creditLimit, "Credit limit"), createdAt: U.nowISO() };
        const list = col("customers", []); list.push(rec); saveCol("customers", list);
        return rec;
      });
    },
    update(id, data) {
      return mutate(() => {
        const list = col("customers", []);
        const rec = list.find((c) => c.id === id);
        check(rec, "Customer not found");
        if (data.name !== undefined) check(String(data.name).trim(), "Customer name is required");
        Object.assign(rec, { ...data, id: rec.id, creditLimit: data.creditLimit != null ? money(data.creditLimit, "Credit limit") : rec.creditLimit });
        saveCol("customers", list);
        return rec;
      });
    },
    remove(id) {
      return mutate(() => {
        const referenced = col("sales", []).some((s) => s.customerId === id) || col("payments", []).some((p) => p.customerId === id);
        check(!referenced, "Customer has sales/payment history and cannot be deleted");
        saveCol("customers", col("customers", []).filter((c) => c.id !== id));
        return true;
      });
    },
    balance(customerId) {
      const sold = col("sales", []).filter((s) => s.customerId === customerId && !s.cancelled).reduce((a, s) => a + s.grandTotal, 0);
      const paid = activePayments().filter((p) => p.customerId === customerId).reduce((a, p) => a + p.amount, 0);
      return round2(sold - paid);
    },
    statement(customerId) {
      const sales = col("sales", []).filter((s) => s.customerId === customerId).map((s) => ({ kind: "sale", date: s.date, ref: s.invoiceNo, debit: s.cancelled ? 0 : s.grandTotal, credit: 0, id: s.id }));
      const payments = activePayments().filter((p) => p.customerId === customerId).map((p) => ({ kind: "payment", date: p.date, ref: p.saleId ? `Payment for ${col("sales", []).find((s) => s.id === p.saleId)?.invoiceNo || ""}` : "Credit payment", debit: 0, credit: p.amount, id: p.id }));
      return [...sales, ...payments].sort((a, b) => new Date(a.date) - new Date(b.date));
    },
  };

  // ---------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------
  const PAYMENT_METHODS = ["cash", "bkash", "card", "bank"];

  const Sales = {
    list({ from, to, customerId, staffId, status } = {}) {
      let rows = col("sales", []);
      if (from || to) rows = rows.filter((s) => U.inRange(s.date, from, to));
      if (customerId) rows = rows.filter((s) => s.customerId === customerId);
      if (staffId) rows = rows.filter((s) => s.staffId === staffId);
      const paidBySale = {};
      activePayments().forEach((p) => { if (p.saleId) paidBySale[p.saleId] = (paidBySale[p.saleId] || 0) + p.amount; });
      rows = rows.map((s) => {
        const paid = paidBySale[s.id] || 0;
        return { ...s, paid, due: round2(s.grandTotal - paid), status: Sales.statusOf({ ...s, paid }) };
      });
      if (status) rows = rows.filter((s) => s.status === status);
      return ok(rows.sort((a, b) => new Date(b.date) - new Date(a.date)));
    },
    get(id) {
      const s = col("sales", []).find((x) => x.id === id);
      if (!s) return ok(null);
      const paid = Sales.paidAmount(id);
      const due = round2(s.grandTotal - paid);
      return ok({ ...s, paid, due, status: Sales.statusOf({ ...s, paid, due }) });
    },
    paidAmount(saleId) { return activePayments().filter((p) => p.saleId === saleId).reduce((a, p) => a + p.amount, 0); },
    statusOf(sale) {
      if (sale.cancelled) return "cancelled";
      const paid = sale.paid != null ? sale.paid : Sales.paidAmount(sale.id);
      const due = round2(sale.grandTotal - paid);
      if (due <= 0.009) return "paid";
      if (paid > 0) return "partial";
      return "due";
    },

    /**
     * Creates a sale and its stock-out ledger entries atomically. Prices
     * come from the cart (staff may negotiate), but quantities, stock and
     * totals are validated and recalculated here against the latest saved
     * data — never trusted from the page.
     *
     * clientRef: an id the POS generates once per cart. Submitting the same
     * clientRef twice (double-click, retry) returns the first sale instead
     * of selling the goods twice.
     */
    create({ customerId, items, discountTotal = 0, paymentMethod, staffId, note, paidNow, clientRef }) {
      return mutate(() => {
        const sales = col("sales", []);
        if (clientRef) {
          const dup = sales.find((s) => s.clientRef === clientRef);
          if (dup) return dup;
        }
        check(Array.isArray(items) && items.length, "Add at least one item");
        const variants = col("variants", []);
        const products = col("products", []);
        const settings = col("settings", {});
        if (customerId) check(col("customers", []).some((c) => c.id === customerId), "Selected customer no longer exists");
        const method = paymentMethod || "cash";
        check(PAYMENT_METHODS.includes(method), "Choose a valid payment method");

        const lineItems = items.map((it) => {
          const variant = variants.find((v) => v.id === it.variantId);
          check(variant, "An item in the cart no longer exists — remove it and add it again");
          const product = products.find((p) => p.id === variant.productId);
          const label = `${product ? product.name : "Item"} — ${variant.name}`;
          check(variant.active && product && product.active, `${label} is archived and can't be sold`);
          const qty = wholeNumber(it.qty, `Quantity for ${label}`, { min: 1 });
          const unitPrice = money(it.unitPrice, `Price for ${label}`);
          const discount = money(isBlank(it.discount) ? 0 : it.discount, `Discount for ${label}`);
          check(discount <= qty * unitPrice, `Discount for ${label} is more than the line total`);
          return { variantId: variant.id, productId: product.id, productName: product.name, variantName: variant.name, sku: variant.sku, qty, unitPrice, discount, lineTotal: round2(qty * unitPrice - discount), label };
        });

        // Stock check against the ledger (same variant may appear on several lines).
        const levels = Stock.levelsMap();
        const wanted = {};
        lineItems.forEach((it) => { wanted[it.variantId] = (wanted[it.variantId] || 0) + it.qty; });
        lineItems.forEach((it) => {
          const available = levels[it.variantId] || 0;
          check(wanted[it.variantId] <= available, `Not enough stock for ${it.label}: ${available} available, ${wanted[it.variantId]} requested`);
        });

        const subtotal = round2(U.sum(lineItems, (x) => x.qty * x.unitPrice));
        const lineDiscounts = U.sum(lineItems, (x) => x.discount);
        const extraDiscount = money(isBlank(discountTotal) ? 0 : discountTotal, "Extra discount");
        const grandDiscount = round2(lineDiscounts + extraDiscount);
        check(grandDiscount <= subtotal, "Total discount is more than the subtotal");
        const taxTotal = Math.round((subtotal - grandDiscount) * (Number(settings.taxRatePercent || 0) / 100));
        const grandTotal = round2(subtotal - grandDiscount + taxTotal);

        let paid;
        if (!customerId) paid = grandTotal; // walk-in: full payment
        else if (paidNow === undefined || paidNow === null || paidNow === "") paid = grandTotal;
        else paid = Math.min(money(paidNow, "Amount paid"), grandTotal);

        let invoiceSeq = settings.invoiceSeq || 1;
        const makeNo = (seq) => `${settings.invoicePrefix || "INV"}-${new Date().getFullYear()}-${String(seq).padStart(4, "0")}`;
        while (sales.some((s) => s.invoiceNo === makeNo(invoiceSeq))) invoiceSeq++;
        const invoiceNo = makeNo(invoiceSeq);

        const saleId = U.uid("sale");
        const date = U.nowISO();
        const sale = { id: saleId, invoiceNo, date, customerId: customerId || null, items: lineItems.map(({ label, ...rest }) => rest), subtotal, discountTotal: grandDiscount, taxTotal, grandTotal, paymentMethod: method, staffId, note: note || "", cancelled: false, createdAt: date, clientRef: clientRef || null };
        sales.push(sale); saveCol("sales", sales);

        const ledger = col("stockLedger", []);
        lineItems.forEach((it) => ledger.push({ id: U.uid("stk"), variantId: it.variantId, change: -it.qty, type: "sale", reference: invoiceNo, note: "Sold via invoice", date, userId: staffId || null }));
        saveCol("stockLedger", ledger);

        if (paid > 0) {
          const payments = col("payments", []);
          payments.push({ id: U.uid("pay"), date, customerId: customerId || null, saleId, amount: paid, method, type: "sale", note: "", userId: staffId || null });
          saveCol("payments", payments);
        }

        settings.invoiceSeq = invoiceSeq + 1;
        saveCol("settings", settings);
        return sale;
      });
    },

    cancel(id, userId) {
      return mutate(() => {
        const sales = col("sales", []);
        const sale = sales.find((s) => s.id === id);
        check(sale, "Sale not found");
        if (sale.cancelled) return sale; // already cancelled: never restore stock twice
        sale.cancelled = true;
        sale.cancelledAt = U.nowISO();
        sale.cancelledBy = userId || null;
        saveCol("sales", sales);
        const ledger = col("stockLedger", []);
        sale.items.forEach((it) => ledger.push({ id: U.uid("stk"), variantId: it.variantId, change: it.qty, type: "return", reference: sale.invoiceNo, note: "Sale cancelled — stock restored", date: U.nowISO(), userId: userId || null }));
        saveCol("stockLedger", ledger);
        return sale;
      });
    },
  };

  // ---------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------
  const Payments = {
    list({ customerId, saleId, from, to } = {}) {
      let rows = activePayments();
      if (customerId) rows = rows.filter((p) => p.customerId === customerId);
      if (saleId) rows = rows.filter((p) => p.saleId === saleId);
      if (from || to) rows = rows.filter((p) => U.inRange(p.date, from, to));
      return ok([...rows].sort((a, b) => new Date(b.date) - new Date(a.date)));
    },
    create(data) {
      return mutate(() => {
        const amount = Number(data.amount);
        check(Number.isFinite(amount) && amount > 0, "Amount must be greater than zero");
        check(data.customerId, "Select a customer to record a payment against");
        check(col("customers", []).some((c) => c.id === data.customerId), "Customer not found");
        const method = data.method || "cash";
        check(PAYMENT_METHODS.includes(method), "Choose a valid payment method");
        if (data.saleId) {
          const sale = col("sales", []).find((s) => s.id === data.saleId);
          check(sale, "Sale not found");
          check(sale.customerId === data.customerId, "This sale belongs to a different customer");
          check(!sale.cancelled, "This sale was cancelled — record a general credit payment instead");
          const due = round2(sale.grandTotal - Sales.paidAmount(sale.id));
          check(round2(amount) <= due + 0.009, `Amount is more than the ${U.formatMoney(due)} due on ${sale.invoiceNo}`);
        }
        const rec = { id: U.uid("pay"), date: data.date || U.nowISO(), customerId: data.customerId, saleId: data.saleId || null, amount: round2(amount), method, type: data.type || "customer-credit", note: data.note || "", userId: data.userId || null };
        const list = col("payments", []); list.push(rec); saveCol("payments", list);
        return rec;
      });
    },
    /** Voids a payment (kept for the audit trail, excluded from all totals). */
    remove(id, userId) {
      return mutate(() => {
        const rec = col("payments", []).find((p) => p.id === id);
        check(rec, "Payment not found");
        if (!rec.voided) Object.assign(rec, { voided: true, voidedAt: U.nowISO(), voidedBy: userId || null });
        return true;
      });
    },
  };

  // ---------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------
  function activeAdminCount(users) { return users.filter((u) => u.active && u.role === "admin").length; }

  const Users = {
    list() { return ok([...col("users", [])].sort((a, b) => a.name.localeCompare(b.name))); },
    get(id) { return ok(col("users", []).find((u) => u.id === id) || null); },
    findByUsername(username) { return col("users", []).find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null; },
    create(data) {
      return mutate(() => {
        check(data.username && data.password && data.name, "Name, username and password are required");
        const users = col("users", []);
        check(!users.some((u) => sameText(u.username, data.username)), "Username already taken");
        const rec = { id: U.uid("user"), name: data.name.trim(), username: data.username.trim(), password: data.password, role: data.role === "admin" ? "admin" : "staff", email: data.email || "", active: true, createdAt: U.nowISO() };
        users.push(rec); saveCol("users", users);
        return rec;
      });
    },
    update(id, data) {
      return mutate(() => {
        const users = col("users", []);
        const rec = users.find((u) => u.id === id);
        check(rec, "User not found");
        if (data.username !== undefined) {
          check(String(data.username).trim(), "Username is required");
          check(!users.some((u) => u.id !== id && sameText(u.username, data.username)), "Username already taken");
        }
        if (data.name !== undefined) check(String(data.name).trim(), "Name is required");
        Object.assign(rec, data, { id: rec.id });
        check(activeAdminCount(users) > 0, "At least one active Admin account is required");
        saveCol("users", users);
        return rec;
      });
    },
    remove(id) {
      return mutate(() => {
        const users = col("users", []);
        const rec = users.find((u) => u.id === id);
        check(rec, "User not found");
        if (col("sales", []).some((s) => s.staffId === id)) rec.active = false;
        else users.splice(users.indexOf(rec), 1);
        check(activeAdminCount(users) > 0, "At least one active Admin account is required");
        saveCol("users", users);
        return true;
      });
    },
  };

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------
  const Settings = {
    get() { return ok({ ...col("settings", {}) }); },
    update(data) {
      return mutate(() => {
        const settings = col("settings", {});
        data = { ...data };
        if (data.taxRatePercent !== undefined) data.taxRatePercent = money(data.taxRatePercent, "Tax rate");
        if (data.lowStockDefaultThreshold !== undefined) data.lowStockDefaultThreshold = wholeNumber(data.lowStockDefaultThreshold, "Low stock threshold");
        const { invoiceSeq, ...safe } = data; // the invoice counter is only advanced by Sales.create
        Object.assign(settings, safe);
        saveCol("settings", settings);
        U.setCurrency(settings.currencySymbol || "৳", settings.currencyCode || "BDT");
        return settings;
      });
    },
  };

  // ---------------------------------------------------------------
  // Dashboard aggregates & Reports
  // ---------------------------------------------------------------
  const Dashboard = {
    summary() {
      const sales = col("sales", []).filter((s) => !s.cancelled);
      const today = U.todayISO();
      const startOfToday = U.startOfDay(new Date()).getTime();
      const startOfWeek = U.startOfDay(new Date(Date.now() - 6 * 86400000)).getTime();
      const startOfMonth = U.startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)).getTime();

      const revenueSince = (ts) => sales.filter((s) => new Date(s.date).getTime() >= ts).reduce((a, s) => a + s.grandTotal, 0);
      const countSince = (ts) => sales.filter((s) => new Date(s.date).getTime() >= ts).length;

      const totalDue = col("customers", []).reduce((a, c) => a + Math.max(0, Customers.balance(c.id)), 0);
      const lowStock = Stock.lowStockList(col("settings", {}).lowStockDefaultThreshold || 10);
      const stockValue = Stock.stockValue();

      // 14-day trend
      const trend = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
        const dayStart = d.getTime(); const dayEnd = dayStart + 86399999;
        const dayRevenue = sales.filter((s) => { const t = new Date(s.date).getTime(); return t >= dayStart && t <= dayEnd; }).reduce((a, s) => a + s.grandTotal, 0);
        trend.push({ label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: dayRevenue });
      }

      // top products (30 days)
      const cutoff = Date.now() - 30 * 86400000;
      const productTotals = {};
      sales.filter((s) => new Date(s.date).getTime() >= cutoff).forEach((s) => {
        s.items.forEach((it) => {
          productTotals[it.productName] = (productTotals[it.productName] || 0) + it.qty * it.unitPrice - it.discount;
        });
      });
      const topProducts = Object.entries(productTotals).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 6);

      const recentSales = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8).map((s) => ({ ...s, paid: Sales.paidAmount(s.id) }));

      return ok({
        revenueToday: revenueSince(startOfToday),
        revenueWeek: revenueSince(startOfWeek),
        revenueMonth: revenueSince(startOfMonth),
        ordersToday: countSince(startOfToday),
        ordersMonth: countSince(startOfMonth),
        totalCustomers: col("customers", []).length,
        totalDue,
        lowStockCount: lowStock.length,
        lowStock: lowStock.slice(0, 6),
        stockValue,
        trend,
        topProducts,
        recentSales,
      });
    },
  };

  const Reports = {
    salesReport({ from, to }) {
      const sales = col("sales", []).filter((s) => !s.cancelled && U.inRange(s.date, from, to));
      const byDay = {};
      sales.forEach((s) => {
        const day = s.date.slice(0, 10);
        byDay[day] = byDay[day] || { date: day, orders: 0, revenue: 0, discount: 0 };
        byDay[day].orders += 1;
        byDay[day].revenue += s.grandTotal;
        byDay[day].discount += s.discountTotal;
      });
      const rows = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
      const totals = { orders: U.sum(rows, (r) => r.orders), revenue: U.sum(rows, (r) => r.revenue), discount: U.sum(rows, (r) => r.discount) };
      return ok({ rows, totals, sales });
    },
    profitReport({ from, to }) {
      const sales = col("sales", []).filter((s) => !s.cancelled && U.inRange(s.date, from, to));
      const variants = col("variants", []);
      let revenue = 0, cost = 0;
      const byProduct = {};
      sales.forEach((s) => {
        s.items.forEach((it) => {
          const variant = variants.find((v) => v.id === it.variantId);
          const lineRevenue = it.lineTotal;
          const lineCost = (variant ? variant.costPrice : 0) * it.qty;
          revenue += lineRevenue; cost += lineCost;
          byProduct[it.productName] = byProduct[it.productName] || { name: it.productName, revenue: 0, cost: 0, qty: 0 };
          byProduct[it.productName].revenue += lineRevenue;
          byProduct[it.productName].cost += lineCost;
          byProduct[it.productName].qty += it.qty;
        });
      });
      const rows = Object.values(byProduct).map((r) => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 })).sort((a, b) => b.profit - a.profit);
      return ok({ rows, totals: { revenue, cost, profit: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : 0 } });
    },
    stockValuation() {
      const levels = Stock.levelsMap();
      const products = col("products", []);
      const rows = col("variants", []).filter((v) => v.active).map((v) => {
        const p = products.find((pr) => pr.id === v.productId);
        const qty = levels[v.id] || 0;
        return { product: p ? p.name : "—", variant: v.name, sku: v.sku, qty, cost: v.costPrice, value: qty * v.costPrice, retailValue: qty * v.sellingPrice };
      }).sort((a, b) => b.value - a.value);
      const totals = { qty: U.sum(rows, (r) => r.qty), value: U.sum(rows, (r) => r.value), retailValue: U.sum(rows, (r) => r.retailValue) };
      return ok({ rows, totals });
    },
    customerDues() {
      const rows = col("customers", []).map((c) => ({ customer: c, balance: Customers.balance(c.id) })).filter((r) => r.balance > 0.009).sort((a, b) => b.balance - a.balance);
      return ok({ rows, totals: { balance: U.sum(rows, (r) => r.balance) } });
    },
  };

  const BACKUP_ARRAYS = ["users", "categories", "products", "variants", "customers", "sales", "payments", "stockLedger"];

  const Backup = {
    exportJSON() { return Store.snapshot(); },
    importJSON(obj) {
      const c = obj && obj.collections;
      if (!c || typeof c !== "object") return fail("Invalid backup file");
      const bad = BACKUP_ARRAYS.filter((k) => k in c && !Array.isArray(c[k]));
      if (bad.length) return fail(`Invalid backup file (${bad.join(", ")} is not a list)`);
      if (!Array.isArray(c.users) || !c.users.some((u) => u && u.active && u.role === "admin")) return fail("Backup has no active Admin account — importing it would lock you out");
      try { Store.replaceAll(obj); } catch (e) { return fail(e.message); }
      return ok(true);
    },
    resetDemoData() {
      Store.clearAll();
      return init();
    },
    /** Wipes everything and leaves a genuinely empty workspace (one admin
     *  login, blank company profile) — for switching from demo to real use. */
    startFresh({ companyName, adminName, adminUsername, adminPassword } = {}) {
      Store.clearAll();
      const collections = {
        users: [{ id: U.uid("user"), name: adminName || "Admin", username: adminUsername || "admin", password: adminPassword || "admin123", role: "admin", email: "", active: true, createdAt: U.nowISO() }],
        categories: [], products: [], variants: [], customers: [], sales: [], payments: [], stockLedger: [],
        settings: { companyName: companyName || "My Company", companyAddress: "", companyPhone: "", companyEmail: "", currencySymbol: "৳", currencyCode: "BDT", taxRatePercent: 0, invoicePrefix: "INV", lowStockDefaultThreshold: 10, theme: "light", invoiceSeq: 1 },
      };
      return mutate(() => { Object.keys(collections).forEach((k) => Store.setCollection(k, collections[k])); return true; });
    },
  };

  global.DB = { init, Categories, Products, Variants, Stock, Customers, Sales, Payments, Users, Settings, Dashboard, Reports, Backup };
})(window);
