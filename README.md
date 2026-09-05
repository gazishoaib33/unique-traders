# Unique Traders — Inventory Management (Web)

A complete, self-contained inventory management web app for Unique Traders:
products & variants, stock, sales (POS-style), customers, payments,
dashboard, reports, settings, and role-based Admin/Staff access.

No build step, no dependencies to install — plain HTML/CSS/JS. Data is
stored in the browser via `localStorage`.

> This is a companion **web** app, separate from the existing Flutter
> mobile app at `D:\Projects\unique_trader_inventory`. They are independent
> projects with independent, unsynced data; nothing here touches the
> Flutter codebase or its database.

## Real catalog, not demo data

On first run this seeds your **actual product catalog** — 482 products /
532 SKUs across 13 categories, imported from
`unique_trader_catalogue_cleaned.xlsx` (the same source file the Flutter
app was built from). Brand color, currency formatting (0 decimal places),
and company name all match the Flutter app too. Customers, sales, and
payments start **empty** — this is meant for real use, not a demo.

- `js/real-catalog-data.js` is the generated data (regenerate it from the
  spreadsheet any time your price list changes — ask Claude, or see the
  transform logic that produced it).
- 391 of the 532 SKUs had no recorded cost price in the spreadsheet; those
  were estimated at 72% of selling price (flagged `costEstimated: true`
  internally) so profit reports still work — correct them via Products →
  edit → variant cost price as you get real numbers.
- 88 real product photos were copied into `assets/products/` and matched
  to their SKUs.
- Settings → General still needs your real company address, phone, and
  email — those weren't found anywhere in the Flutter project.
- Settings → Data & Backup has **"Reload Starter Catalog"** (wipes
  everything back to this imported baseline) and **"Start Fresh"** (wipes
  to a truly empty workspace, no catalog at all) if you ever want either.

## Run it

Just open [index.html](index.html) in a browser (double-click it, or
right-click → Open with → your browser). Everything runs client-side.

If your browser blocks local file access for any reason, serve it instead:

```bash
python -m http.server 8000
```

then visit `http://localhost:8000`.

## Demo accounts

| Role  | Username | Password  |
|-------|----------|-----------|
| Admin | `admin`  | `admin123`|
| Staff | `staff`  | `staff123`|

Admin has full access (products, inventory adjustments, users, settings,
profit reports, cancelling sales). Staff can sell, manage customers,
record payments, and view non-financial reports, but cannot edit the
catalog, adjust stock, or see cost/profit figures.

## Project layout

```
index.html            Shell markup (login screen + app shell)
css/styles.css         Design system (light/dark theme via CSS variables)
js/
  utils.js             Generic helpers (formatting, CSV export, dates…)
  storage.js            localStorage persistence — the ONLY file that
                        touches localStorage directly (see below)
  seed.js               First-run mock data generator
  db.js                 Data / repository layer — every page talks to
                        this, never to storage.js directly
  auth.js                Mock local authentication + role permissions
  ui.js                  Toasts, modals, confirm dialogs, badges
  charts.js               Chart.js wrapper (dashboard/report charts)
  router.js                Hash router + sidebar nav + role guards
  app.js                    Bootstraps the app
  pages/
    login.js, dashboard.js, products.js, inventory.js, sales.js,
    customers.js, payments.js, reports.js, settings.js
```

## Connecting Supabase later

The data layer is deliberately split into two files so swapping the
backend doesn't touch any page code:

- **`js/db.js`** exposes the entire public API every page calls
  (`DB.Products.list()`, `DB.Sales.create()`, `DB.Customers.balance()`,
  etc.). Every function already returns a `Promise`, even though the
  current implementation is synchronous — so pages already do
  `await DB.Products.list()` the same way they would against Supabase.
- **`js/storage.js`** is the only file that reads/writes `localStorage`.

To migrate:
1. Add the `@supabase/supabase-js` client (via the CDN allowlist or a
   bundler if you introduce one).
2. Re-implement the internals of each `DB.*` function in `js/db.js` to
   call `supabase.from('products').select()` etc. instead of `col(...)`
   / `Store`.
3. Replace `js/auth.js`'s mock login with `supabase.auth.signInWithPassword`.
4. Retire `js/storage.js` and `js/seed.js` once Supabase is the source
   of truth (or keep `seed.js` as a one-time DB-seeding script).

No page in `js/pages/` needs to change.

## Data model notes

- **Products** are the catalog entry (name, category, brand, description).
  **Variants** hold price/cost/SKU/barcode/reorder level — every product
  has at least one variant (a "Default" one if it has no real variants),
  so stock and sales always operate at the variant level.
- **Stock** is ledger-based: every purchase, sale, return, and manual
  adjustment is an immutable entry in `stockLedger`; the current level is
  always the sum of entries for that variant. This gives you a full
  audit trail (see the 🕘 history icon on the Inventory page) for free.
- **Sales** store line items + totals; paid/due amounts are derived from
  the `payments` collection (linked via `saleId`), not stored redundantly.
- **Customer balance** = sum of their non-cancelled sale totals minus
  every payment recorded against them (sale-linked or standalone credit
  payments).

## Backup & reset

Settings → Data & Backup lets you export the entire dataset as JSON,
import a previous export, or wipe everything and regenerate fresh demo
data — handy for demos or starting clean before connecting Supabase.
