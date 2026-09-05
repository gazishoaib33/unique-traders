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

  // ---------------------------------------------------------------
  // Bootstrap / seeding
  // ---------------------------------------------------------------
  function init() {
    if (Store.isEmpty()) {
      const seeded = Seed.generate();
      Object.keys(seeded).forEach((k) => Store.setCollection(k, seeded[k]));
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
      const rec = { id: U.uid("cat"), name: data.name.trim() };
      const list = col("categories", []); list.push(rec); saveCol("categories", list);
      return ok(rec);
    },
    update(id, data) {
      const list = col("categories", []);
      const rec = list.find((c) => c.id === id);
      if (!rec) return fail("Category not found");
      Object.assign(rec, data);
      saveCol("categories", list);
      return ok(rec);
    },
    remove(id) {
      const inUse = col("products", []).some((p) => p.categoryId === id);
      if (inUse) return fail("Category is used by existing products");
      saveCol("categories", col("categories", []).filter((c) => c.id !== id));
      return ok(true);
    },
  };

  // ---------------------------------------------------------------
  // Stock (ledger-based; level = sum of signed changes per variant)
  // ---------------------------------------------------------------
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
      if (!variantId || !change) return fail("Variant and quantity are required");
      const entry = { id: U.uid("stk"), variantId, change: Math.round(change), type: type || "adjustment", note: note || "", reference: reference || null, date: U.nowISO(), userId: userId || null };
      const ledger = col("stockLedger", []); ledger.push(entry); saveCol("stockLedger", ledger);
      return ok(entry);
    },
    lowStockList(defaultThreshold) {
      const levels = Stock.levelsMap();
      const variants = col("variants", []);
      const products = col("products", []);
      const rows = [];
      variants.forEach((v) => {
        if (!v.active) return;
        const level = levels[v.id] || 0;
        const threshold = v.reorderLevel != null ? v.reorderLevel : defaultThreshold;
        if (level <= threshold) {
          const p = products.find((pr) => pr.id === v.productId);
          rows.push({ variant: v, product: p, level, threshold });
        }
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

  // ---------------------------------------------------------------
  // Products (+ nested variant reconciliation)
  // ---------------------------------------------------------------
  const Products = {
    list({ search, categoryId, activeOnly } = {}) {
      let rows = col("products", []);
      if (activeOnly) rows = rows.filter((p) => p.active);
      if (categoryId) rows = rows.filter((p) => p.categoryId === categoryId);
      if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || Variants.listByProduct(p.id).some((v) => v.sku.toLowerCase().includes(q) || v.barcode.includes(q)));
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

    create(productData, variantsData) {
      if (!productData.name || !productData.sku) return fail("Name and SKU are required");
      const products = col("products", []);
      if (products.some((p) => p.sku.toLowerCase() === productData.sku.toLowerCase())) return fail("SKU already exists");
      const product = {
        id: U.uid("prod"),
        sku: productData.sku.trim(),
        name: productData.name.trim(),
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
      products.push(product);
      saveCol("products", products);

      const variants = col("variants", []);
      const ledger = col("stockLedger", []);
      (variantsData && variantsData.length ? variantsData : [{ name: "Default" }]).forEach((v) => {
        const variant = {
          id: U.uid("var"),
          productId: product.id,
          name: v.name || "Default",
          sku: v.sku || product.sku,
          barcode: v.barcode || "",
          attributes: v.attributes || {},
          costPrice: Number(v.costPrice) || 0,
          sellingPrice: Number(v.sellingPrice) || 0,
          reorderLevel: v.reorderLevel != null ? Number(v.reorderLevel) : 10,
          active: true,
        };
        variants.push(variant);
        const opening = Number(v.openingStock) || 0;
        if (opening > 0) {
          ledger.push({ id: U.uid("stk"), variantId: variant.id, change: opening, type: "initial", reference: "Opening Balance", note: "Added via Products page", date: U.nowISO(), userId: v.userId || null });
        }
      });
      saveCol("variants", variants);
      saveCol("stockLedger", ledger);
      return ok(product);
    },

    update(id, productData, variantsData) {
      const products = col("products", []);
      const product = products.find((p) => p.id === id);
      if (!product) return fail("Product not found");
      Object.assign(product, {
        name: productData.name?.trim() ?? product.name,
        sku: productData.sku?.trim() ?? product.sku,
        categoryId: productData.categoryId ?? product.categoryId,
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
        const allVariants = col("variants", []);
        const ledger = col("stockLedger", []);
        const existingIds = allVariants.filter((v) => v.productId === id).map((v) => v.id);
        const keepIds = new Set();

        variantsData.forEach((v) => {
          if (v.id) {
            const existing = allVariants.find((x) => x.id === v.id);
            if (existing) {
              Object.assign(existing, {
                name: v.name || existing.name,
                sku: v.sku || existing.sku,
                barcode: v.barcode ?? existing.barcode,
                attributes: v.attributes ?? existing.attributes,
                costPrice: Number(v.costPrice) || 0,
                sellingPrice: Number(v.sellingPrice) || 0,
                reorderLevel: v.reorderLevel != null ? Number(v.reorderLevel) : existing.reorderLevel,
                active: v.active ?? existing.active,
              });
              keepIds.add(v.id);
            }
          } else {
            const variant = {
              id: U.uid("var"), productId: id, name: v.name || "Default", sku: v.sku || product.sku,
              barcode: v.barcode || "", attributes: v.attributes || {},
              costPrice: Number(v.costPrice) || 0, sellingPrice: Number(v.sellingPrice) || 0,
              reorderLevel: v.reorderLevel != null ? Number(v.reorderLevel) : 10, active: true,
            };
            allVariants.push(variant);
            keepIds.add(variant.id);
            const opening = Number(v.openingStock) || 0;
            if (opening > 0) ledger.push({ id: U.uid("stk"), variantId: variant.id, change: opening, type: "initial", reference: "Opening Balance", note: "Added via edit", date: U.nowISO(), userId: null });
          }
        });

        // Archive (not hard-delete) variants removed from the form if they have history; else drop them.
        existingIds.filter((vid) => !keepIds.has(vid)).forEach((vid) => {
          const referenced = ledger.some((l) => l.variantId === vid) || col("sales", []).some((s) => s.items.some((it) => it.variantId === vid));
          if (referenced) {
            const v = allVariants.find((x) => x.id === vid);
            if (v) v.active = false;
          } else {
            const idx = allVariants.findIndex((x) => x.id === vid);
            if (idx >= 0) allVariants.splice(idx, 1);
          }
        });

        saveCol("variants", allVariants);
        saveCol("stockLedger", ledger);
      }

      return ok(product);
    },

    archive(id, active) {
      const products = col("products", []);
      const p = products.find((x) => x.id === id);
      if (!p) return fail("Product not found");
      p.active = active;
      saveCol("products", products);
      return ok(p);
    },

    remove(id) {
      const variantIds = col("variants", []).filter((v) => v.productId === id).map((v) => v.id);
      const referenced = col("stockLedger", []).some((l) => variantIds.includes(l.variantId)) || col("sales", []).some((s) => s.items.some((it) => variantIds.includes(it.variantId)));
      if (referenced) return fail("Product has stock or sales history — archive it instead of deleting.");
      saveCol("products", col("products", []).filter((p) => p.id !== id));
      saveCol("variants", col("variants", []).filter((v) => v.productId !== id));
      return ok(true);
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
      if (!data.name) return fail("Customer name is required");
      const rec = { id: U.uid("cust"), name: data.name.trim(), phone: data.phone || "", email: data.email || "", address: data.address || "", type: data.type || "retail", creditLimit: Number(data.creditLimit) || 0, createdAt: U.nowISO() };
      const list = col("customers", []); list.push(rec); saveCol("customers", list);
      return ok(rec);
    },
    update(id, data) {
      const list = col("customers", []);
      const rec = list.find((c) => c.id === id);
      if (!rec) return fail("Customer not found");
      Object.assign(rec, { ...data, creditLimit: data.creditLimit != null ? Number(data.creditLimit) : rec.creditLimit });
      saveCol("customers", list);
      return ok(rec);
    },
    remove(id) {
      const referenced = col("sales", []).some((s) => s.customerId === id) || col("payments", []).some((p) => p.customerId === id);
      if (referenced) return fail("Customer has sales/payment history and cannot be deleted");
      saveCol("customers", col("customers", []).filter((c) => c.id !== id));
      return ok(true);
    },
    balance(customerId) {
      const sold = col("sales", []).filter((s) => s.customerId === customerId && !s.cancelled).reduce((a, s) => a + s.grandTotal, 0);
      const paid = col("payments", []).filter((p) => p.customerId === customerId).reduce((a, p) => a + p.amount, 0);
      return Math.round((sold - paid) * 100) / 100;
    },
    statement(customerId) {
      const sales = col("sales", []).filter((s) => s.customerId === customerId).map((s) => ({ kind: "sale", date: s.date, ref: s.invoiceNo, debit: s.cancelled ? 0 : s.grandTotal, credit: 0, id: s.id }));
      const payments = col("payments", []).filter((p) => p.customerId === customerId).map((p) => ({ kind: "payment", date: p.date, ref: p.saleId ? `Payment for ${col("sales", []).find((s) => s.id === p.saleId)?.invoiceNo || ""}` : "Credit payment", debit: 0, credit: p.amount, id: p.id }));
      return [...sales, ...payments].sort((a, b) => new Date(a.date) - new Date(b.date));
    },
  };

  // ---------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------
  const Sales = {
    list({ from, to, customerId, staffId, status } = {}) {
      let rows = col("sales", []);
      if (from || to) rows = rows.filter((s) => U.inRange(s.date, from, to));
      if (customerId) rows = rows.filter((s) => s.customerId === customerId);
      if (staffId) rows = rows.filter((s) => s.staffId === staffId);
      rows = rows.map((s) => ({ ...s, paid: Sales.paidAmount(s.id), due: 0 })).map((s) => ({ ...s, due: Math.round((s.grandTotal - s.paid) * 100) / 100, status: Sales.statusOf(s) }));
      if (status) rows = rows.filter((s) => s.status === status);
      return ok(rows.sort((a, b) => new Date(b.date) - new Date(a.date)));
    },
    get(id) {
      const s = col("sales", []).find((x) => x.id === id);
      if (!s) return ok(null);
      const paid = Sales.paidAmount(id);
      const due = Math.round((s.grandTotal - paid) * 100) / 100;
      return ok({ ...s, paid, due, status: Sales.statusOf({ ...s, paid, due }) });
    },
    paidAmount(saleId) { return col("payments", []).filter((p) => p.saleId === saleId).reduce((a, p) => a + p.amount, 0); },
    statusOf(sale) {
      if (sale.cancelled) return "cancelled";
      const paid = sale.paid != null ? sale.paid : Sales.paidAmount(sale.id);
      const due = Math.round((sale.grandTotal - paid) * 100) / 100;
      if (due <= 0.009) return "paid";
      if (paid > 0) return "partial";
      return "due";
    },

    create({ customerId, items, discountTotal = 0, paymentMethod, staffId, note, paidNow }) {
      if (!items || !items.length) return fail("Add at least one item");
      if (!customerId && (paidNow == null || paidNow < 0)) paidNow = null; // resolved below

      const variants = col("variants", []);
      const products = col("products", []);
      const settings = col("settings", {});

      const lineItems = items.map((it) => {
        const variant = variants.find((v) => v.id === it.variantId);
        const product = products.find((p) => p.id === variant.productId);
        const gross = it.qty * it.unitPrice;
        const lineDiscount = Number(it.discount) || 0;
        return { variantId: variant.id, productId: product.id, productName: product.name, variantName: variant.name, sku: variant.sku, qty: it.qty, unitPrice: it.unitPrice, discount: lineDiscount, lineTotal: gross - lineDiscount };
      });

      const subtotal = U.sum(lineItems, (x) => x.qty * x.unitPrice);
      const lineDiscounts = U.sum(lineItems, (x) => x.discount);
      const grandDiscount = lineDiscounts + Number(discountTotal || 0);
      const taxTotal = Math.round((subtotal - grandDiscount) * (Number(settings.taxRatePercent || 0) / 100));
      const grandTotal = Math.round((subtotal - grandDiscount + taxTotal) * 100) / 100;

      const invoiceSeq = (settings.invoiceSeq || 1);
      const invoiceNo = `${settings.invoicePrefix || "INV"}-${new Date().getFullYear()}-${String(invoiceSeq).padStart(4, "0")}`;

      const saleId = U.uid("sale");
      const date = U.nowISO();
      const sale = { id: saleId, invoiceNo, date, customerId: customerId || null, items: lineItems, subtotal, discountTotal: grandDiscount, taxTotal, grandTotal, paymentMethod: paymentMethod || "cash", staffId, note: note || "", cancelled: false, createdAt: date };

      const sales = col("sales", []); sales.push(sale); saveCol("sales", sales);

      const ledger = col("stockLedger", []);
      lineItems.forEach((it) => ledger.push({ id: U.uid("stk"), variantId: it.variantId, change: -it.qty, type: "sale", reference: invoiceNo, note: "Sold via invoice", date, userId: staffId }));
      saveCol("stockLedger", ledger);

      const actualPaidNow = customerId == null ? grandTotal : U.clamp(Number(paidNow ?? grandTotal), 0, grandTotal);
      if (actualPaidNow > 0) {
        const payments = col("payments", []);
        payments.push({ id: U.uid("pay"), date, customerId: customerId || null, saleId, amount: actualPaidNow, method: paymentMethod || "cash", type: "sale", note: "", userId: staffId });
        saveCol("payments", payments);
      }

      settings.invoiceSeq = invoiceSeq + 1;
      saveCol("settings", settings);

      return ok(sale);
    },

    cancel(id, userId) {
      const sales = col("sales", []);
      const sale = sales.find((s) => s.id === id);
      if (!sale) return fail("Sale not found");
      if (sale.cancelled) return ok(sale);
      sale.cancelled = true;
      saveCol("sales", sales);
      const ledger = col("stockLedger", []);
      sale.items.forEach((it) => ledger.push({ id: U.uid("stk"), variantId: it.variantId, change: it.qty, type: "return", reference: sale.invoiceNo, note: "Sale cancelled — stock restored", date: U.nowISO(), userId: userId || null }));
      saveCol("stockLedger", ledger);
      return ok(sale);
    },
  };

  // ---------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------
  const Payments = {
    list({ customerId, saleId, from, to } = {}) {
      let rows = col("payments", []);
      if (customerId) rows = rows.filter((p) => p.customerId === customerId);
      if (saleId) rows = rows.filter((p) => p.saleId === saleId);
      if (from || to) rows = rows.filter((p) => U.inRange(p.date, from, to));
      return ok([...rows].sort((a, b) => new Date(b.date) - new Date(a.date)));
    },
    create(data) {
      if (!data.amount || data.amount <= 0) return fail("Amount must be greater than zero");
      if (!data.customerId) return fail("Select a customer to record a payment against");
      const rec = { id: U.uid("pay"), date: data.date || U.nowISO(), customerId: data.customerId, saleId: data.saleId || null, amount: Number(data.amount), method: data.method || "cash", type: data.type || "customer-credit", note: data.note || "", userId: data.userId || null };
      const list = col("payments", []); list.push(rec); saveCol("payments", list);
      return ok(rec);
    },
    remove(id) {
      saveCol("payments", col("payments", []).filter((p) => p.id !== id));
      return ok(true);
    },
  };

  // ---------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------
  const Users = {
    list() { return ok([...col("users", [])].sort((a, b) => a.name.localeCompare(b.name))); },
    get(id) { return ok(col("users", []).find((u) => u.id === id) || null); },
    findByUsername(username) { return col("users", []).find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null; },
    create(data) {
      if (!data.username || !data.password || !data.name) return fail("Name, username and password are required");
      const users = col("users", []);
      if (users.some((u) => u.username.toLowerCase() === data.username.toLowerCase())) return fail("Username already taken");
      const rec = { id: U.uid("user"), name: data.name.trim(), username: data.username.trim(), password: data.password, role: data.role || "staff", email: data.email || "", active: true, createdAt: U.nowISO() };
      users.push(rec); saveCol("users", users);
      return ok(rec);
    },
    update(id, data) {
      const users = col("users", []);
      const rec = users.find((u) => u.id === id);
      if (!rec) return fail("User not found");
      Object.assign(rec, data);
      saveCol("users", users);
      return ok(rec);
    },
    remove(id) {
      if (col("sales", []).some((s) => s.staffId === id)) {
        const users = col("users", []);
        const rec = users.find((u) => u.id === id);
        if (rec) rec.active = false;
        saveCol("users", users);
        return ok(true);
      }
      saveCol("users", col("users", []).filter((u) => u.id !== id));
      return ok(true);
    },
  };

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------
  const Settings = {
    get() { return ok({ ...col("settings", {}) }); },
    update(data) {
      const settings = col("settings", {});
      Object.assign(settings, data);
      saveCol("settings", settings);
      U.setCurrency(settings.currencySymbol || "৳", settings.currencyCode || "BDT");
      return ok(settings);
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

  const Backup = {
    exportJSON() { return Store.snapshot(); },
    importJSON(obj) {
      if (!obj || !obj.collections) return fail("Invalid backup file");
      Store.replaceAll(obj);
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
        settings: { companyName: companyName || "My Company", companyAddress: "", companyPhone: "", companyEmail: "", currencySymbol: "$", currencyCode: "USD", taxRatePercent: 0, invoicePrefix: "INV", lowStockDefaultThreshold: 10, theme: "light", invoiceSeq: 1 },
      };
      Object.keys(collections).forEach((k) => Store.setCollection(k, collections[k]));
      return ok(true);
    },
  };

  global.DB = { init, Categories, Products, Variants, Stock, Customers, Sales, Payments, Users, Settings, Dashboard, Reports, Backup };
})(window);
