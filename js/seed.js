/* =====================================================================
   seed.js — first-run data generator for Unique Traders.

   Product catalog (categories, products, variants, opening stock) is
   built from the REAL business catalogue — see js/real-catalog-data.js,
   generated from D:\Projects\unique_trader_inventory\unique_trader_catalogue_cleaned.xlsx
   (the same source data as the companion Flutter app). Customers, sales
   and payments start empty since those are real transactions, not demo
   filler — this is meant to be used for real from day one.

   costEstimated:true on a variant means the source spreadsheet had no
   recorded cost price for that SKU; its cost was estimated at 72% of
   selling price so profit reports still work. Correct it any time via
   Products → edit → variant cost price.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  function generate() {
    const collections = {};

    // ---------------- Users ----------------
    collections.users = [
      { id: "user_admin", name: "Admin", username: "admin", password: "admin123", role: "admin", email: "", active: true, createdAt: U.nowISO() },
      { id: "user_staff", name: "Staff", username: "staff", password: "staff123", role: "staff", email: "", active: true, createdAt: U.nowISO() },
    ];

    // ---------------- Categories (from real catalog) ----------------
    collections.categories = (global.REAL_CATALOG ? global.REAL_CATALOG.categories : []).map((c) => ({ ...c }));

    // ---------------- Products & Variants (from real catalog) ----------------
    const products = [];
    const variants = [];
    const stockLedger = [];
    const catalogProducts = global.REAL_CATALOG ? global.REAL_CATALOG.products : [];

    catalogProducts.forEach((p, idx) => {
      const productId = `prod_${idx + 1}`;
      products.push({
        id: productId,
        sku: p.sku,
        name: p.name,
        categoryId: p.categoryId,
        brand: p.brand || "",
        description: p.description || "",
        unit: p.unit || "pcs",
        hasVariants: !!p.hasVariants,
        imageUrl: p.imageUrl || "",
        active: true,
        createdAt: U.nowISO(),
        updatedAt: U.nowISO(),
      });

      (p.variants || []).forEach((v, vIdx) => {
        const variantId = `var_${idx + 1}_${vIdx + 1}`;
        variants.push({
          id: variantId,
          productId,
          name: v.name || "Standard",
          sku: v.sku,
          barcode: v.barcode || "",
          attributes: {},
          costPrice: v.costPrice || 0,
          costEstimated: !!v.costEstimated,
          sellingPrice: v.sellingPrice || 0,
          reorderLevel: v.reorderLevel != null ? v.reorderLevel : 5,
          active: true,
        });

        const opening = Number(v.openingStock) || 0;
        if (opening > 0) {
          stockLedger.push({
            id: U.uid("stk"),
            variantId,
            change: opening,
            type: "initial",
            reference: "Opening Balance",
            note: "Initial stock — imported from catalogue",
            date: U.nowISO(),
            userId: "user_admin",
          });
        }
      });
    });

    collections.products = products;
    collections.variants = variants;
    collections.stockLedger = stockLedger;

    // ---------------- Customers, Sales, Payments — start empty ----------------
    collections.customers = [];
    collections.sales = [];
    collections.payments = [];

    // ---------------- Settings ----------------
    collections.settings = {
      companyName: "Unique Traders",
      companyAddress: "",
      companyPhone: "",
      companyEmail: "",
      currencySymbol: "৳",
      currencyCode: "BDT",
      taxRatePercent: 0,
      invoicePrefix: "INV",
      lowStockDefaultThreshold: 10,
      theme: "light",
      invoiceSeq: 1,
    };

    return collections;
  }

  global.Seed = { generate };
})(window);
