/* =====================================================================
   pages/sales.js — POS-style sale creation + sales history + invoices.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  let activeTab = "new";
  let cart = []; // { variantId, productName, variantName, sku, unitPrice, qty, discount, maxStock }
  let historyFilters = { from: "", to: "", customerId: "", status: "" };

  async function render(root) {
    root.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${activeTab === "new" ? "active" : ""}" data-tab="new">New Sale</button>
        <button class="tab-btn ${activeTab === "history" ? "active" : ""}" data-tab="history">Sales History</button>
      </div>
      <div id="sales-tab-body"></div>
    `;
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; render(root); }));
    if (activeTab === "new") await renderNewSale(document.getElementById("sales-tab-body"));
    else await renderHistory(document.getElementById("sales-tab-body"));
  }

  // ---------------------------------------------------------------
  // NEW SALE (POS)
  // ---------------------------------------------------------------
  async function renderNewSale(root) {
    const [products, customers, settings] = await Promise.all([DB.Products.list({ activeOnly: true }), DB.Customers.list(), DB.Settings.get()]);
    const variantOptions = [];
    products.forEach((p) => DB.Variants.listByProduct(p.id).filter((v) => v.active).forEach((v) => {
      variantOptions.push({ id: v.id, label: `${p.name} — ${v.name}`, sku: v.sku, barcode: v.barcode, price: v.sellingPrice, stock: DB.Stock.getLevel(v.id), productName: p.name, variantName: v.name });
    }));

    root.innerHTML = `
      <div class="grid" style="grid-template-columns: 1.6fr 1fr; align-items:start; gap:18px;">
        <div class="card">
          <div class="card-header"><h3>Items</h3></div>
          <div class="card-pad">
            <div class="search-input" style="margin-bottom:12px;"><input id="item-search" placeholder="Search product name, SKU or barcode to add…" autocomplete="off"></div>
            <div id="item-suggestions" class="card" style="display:none; max-height:220px; overflow-y:auto; margin-bottom:12px;"></div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Item</th><th style="width:90px">Qty</th><th style="width:110px">Price</th><th style="width:90px">Discount</th><th class="text-right">Line Total</th><th></th></tr></thead>
              <tbody id="cart-body"></tbody>
            </table></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Checkout</h3></div>
          <div class="card-pad">
            <div class="field"><label>Customer</label>
              <select id="sale-customer"><option value="">Walk-in Customer</option>${customers.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)} (${c.type})</option>`).join("")}</select>
            </div>
            <div class="field-row">
              <div class="field"><label>Payment Method</label>
                <select id="sale-method"><option value="cash">Cash</option><option value="bkash">bKash</option><option value="card">Card</option><option value="bank">Bank Transfer</option></select>
              </div>
              <div class="field"><label>Extra Discount</label><input id="sale-discount" type="number" min="0" step="0.01" value="0"></div>
            </div>

            <div class="kv-list" style="margin:14px 0;">
              <div class="kv-row"><span>Subtotal</span><span id="sum-subtotal">${U.formatMoney(0)}</span></div>
              <div class="kv-row"><span>Discount</span><span id="sum-discount">${U.formatMoney(0)}</span></div>
              <div class="kv-row"><span>Tax (${settings.taxRatePercent || 0}%)</span><span id="sum-tax">${U.formatMoney(0)}</span></div>
              <div class="kv-row" style="font-size:15px;"><span>Grand Total</span><span id="sum-total">${U.formatMoney(0)}</span></div>
            </div>

            <div class="field" id="paid-now-wrap">
              <label>Amount Paid Now</label>
              <input id="sale-paid" type="number" min="0" step="0.01" value="0">
              <span class="field-hint" id="paid-hint"></span>
            </div>

            <button class="btn btn-primary btn-block" id="complete-sale" style="margin-top:10px;">Complete Sale</button>
          </div>
        </div>
      </div>
    `;

    const searchInput = document.getElementById("item-search");
    const suggestBox = document.getElementById("item-suggestions");

    searchInput.addEventListener("input", U.debounce(() => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q) { suggestBox.style.display = "none"; return; }
      const matches = variantOptions.filter((v) => v.label.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.barcode.includes(q)).slice(0, 8);
      if (!matches.length) { suggestBox.innerHTML = `<div class="card-pad muted">No matching items</div>`; suggestBox.style.display = "block"; return; }
      suggestBox.innerHTML = matches.map((v) => `
        <div class="card-pad" style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);cursor:pointer;" data-pick="${v.id}">
          <div><strong>${U.escapeHtml(v.label)}</strong><div class="muted mono" style="font-size:11.5px">${U.escapeHtml(v.sku)} · ${v.stock} in stock</div></div>
          <div class="mono">${U.formatMoney(v.price)}</div>
        </div>`).join("");
      suggestBox.style.display = "block";
      suggestBox.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", () => { addToCart(el.dataset.pick, variantOptions); searchInput.value = ""; suggestBox.style.display = "none"; }));
    }, 150));
    document.addEventListener("click", (e) => { if (!suggestBox.contains(e.target) && e.target !== searchInput) suggestBox.style.display = "none"; });

    document.getElementById("sale-customer").addEventListener("change", updateTotals);
    document.getElementById("sale-discount").addEventListener("input", updateTotals);
    document.getElementById("sale-paid").addEventListener("input", updateTotals);

    document.getElementById("complete-sale").addEventListener("click", async () => {
      if (!cart.length) { UI.toast("error", "Cart is empty", "Add at least one item"); return; }
      for (const item of cart) {
        if (item.qty > item.maxStock) { UI.toast("error", "Not enough stock", `${item.productName} — ${item.variantName} has only ${item.maxStock} left`); return; }
      }
      const customerId = document.getElementById("sale-customer").value || null;
      const method = document.getElementById("sale-method").value;
      const extraDiscount = Number(document.getElementById("sale-discount").value) || 0;
      const paidNow = customerId ? Number(document.getElementById("sale-paid").value) || 0 : undefined;
      try {
        const sale = await DB.Sales.create({
          customerId,
          items: cart.map((c) => ({ variantId: c.variantId, qty: c.qty, unitPrice: c.unitPrice, discount: c.discount })),
          discountTotal: extraDiscount,
          paymentMethod: method,
          staffId: Auth.currentUser().id,
          paidNow,
        });
        UI.toast("success", "Sale completed", sale.invoiceNo);
        cart = [];
        renderNewSale(root);
        openInvoiceModal(sale.id);
      } catch (err) {
        UI.toast("error", "Could not complete sale", err.message);
      }
    });

    renderCart();
    updateTotals();

    function addToCart(variantId, options) {
      const v = options.find((x) => x.id === variantId);
      if (!v) return;
      if (v.stock <= 0) { UI.toast("warning", "Out of stock", `${v.label} has no available stock`); return; }
      const existing = cart.find((c) => c.variantId === variantId);
      if (existing) { if (existing.qty < v.stock) existing.qty += 1; else UI.toast("warning", "Stock limit reached"); }
      else cart.push({ variantId: v.id, productName: v.productName, variantName: v.variantName, sku: v.sku, unitPrice: v.price, qty: 1, discount: 0, maxStock: v.stock });
      renderCart(); updateTotals();
    }

    function renderCart() {
      const body = document.getElementById("cart-body");
      body.innerHTML = cart.length ? cart.map((c, idx) => `
        <tr>
          <td><strong>${U.escapeHtml(c.productName)}</strong><div class="muted" style="font-size:11.5px">${U.escapeHtml(c.variantName)}</div></td>
          <td><input type="number" min="1" max="${c.maxStock}" value="${c.qty}" data-qty="${idx}" style="width:70px;padding:6px 8px;"></td>
          <td><input type="number" min="0" step="0.01" value="${c.unitPrice}" data-price="${idx}" style="width:95px;padding:6px 8px;"></td>
          <td><input type="number" min="0" step="0.01" value="${c.discount}" data-discount="${idx}" style="width:80px;padding:6px 8px;"></td>
          <td class="text-right mono">${U.formatMoney(c.qty * c.unitPrice - c.discount)}</td>
          <td><button class="icon-btn" data-remove="${idx}">✕</button></td>
        </tr>`).join("") : UI.emptyRow(6, "Search and add items above");

      body.querySelectorAll("[data-qty]").forEach((i) => i.addEventListener("input", (e) => { cart[+e.target.dataset.qty].qty = U.clamp(Number(e.target.value) || 1, 1, cart[+e.target.dataset.qty].maxStock); renderCart(); updateTotals(); }));
      body.querySelectorAll("[data-price]").forEach((i) => i.addEventListener("input", (e) => { cart[+e.target.dataset.price].unitPrice = Number(e.target.value) || 0; updateTotals(); }));
      body.querySelectorAll("[data-discount]").forEach((i) => i.addEventListener("input", (e) => { cart[+e.target.dataset.discount].discount = Number(e.target.value) || 0; updateTotals(); }));
      body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", (e) => { cart.splice(+e.target.dataset.remove, 1); renderCart(); updateTotals(); }));
    }

    function updateTotals() {
      const subtotal = U.sum(cart, (c) => c.qty * c.unitPrice);
      const lineDiscounts = U.sum(cart, (c) => c.discount);
      const extraDiscount = Number(document.getElementById("sale-discount").value) || 0;
      const discountTotal = lineDiscounts + extraDiscount;
      const taxTotal = Math.round((subtotal - discountTotal) * ((settings.taxRatePercent || 0) / 100));
      const grandTotal = Math.max(0, subtotal - discountTotal + taxTotal);
      document.getElementById("sum-subtotal").textContent = U.formatMoney(subtotal);
      document.getElementById("sum-discount").textContent = U.formatMoney(discountTotal);
      document.getElementById("sum-tax").textContent = U.formatMoney(taxTotal);
      document.getElementById("sum-total").textContent = U.formatMoney(grandTotal);

      const customerId = document.getElementById("sale-customer").value;
      const paidWrap = document.getElementById("paid-now-wrap");
      const paidInput = document.getElementById("sale-paid");
      const hint = document.getElementById("paid-hint");
      if (!customerId) {
        paidInput.value = grandTotal.toFixed(2); paidInput.disabled = true;
        hint.textContent = "Full payment required for walk-in sales.";
      } else {
        paidInput.disabled = false;
        if (Number(paidInput.value) > grandTotal) paidInput.value = grandTotal.toFixed(2);
        const due = Math.max(0, grandTotal - (Number(paidInput.value) || 0));
        hint.textContent = due > 0 ? `Remaining due: ${U.formatMoney(due)} (added to customer balance)` : "Fully paid";
      }
    }
  }

  // ---------------------------------------------------------------
  // SALES HISTORY
  // ---------------------------------------------------------------
  async function renderHistory(root) {
    const [customers] = await Promise.all([DB.Customers.list()]);
    root.innerHTML = `
      <div class="filter-bar card card-pad">
        <div class="field"><label>From</label><input type="date" id="h-from" value="${historyFilters.from}"></div>
        <div class="field"><label>To</label><input type="date" id="h-to" value="${historyFilters.to}"></div>
        <div class="field"><label>Customer</label>
          <select id="h-customer"><option value="">All Customers</option>${customers.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Status</label>
          <select id="h-status"><option value="">All</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option><option value="cancelled">Cancelled</option></select>
        </div>
        <button class="btn btn-secondary" id="h-apply">Apply</button>
        <button class="btn btn-ghost" id="h-clear">Clear</button>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th><th></th></tr></thead>
          <tbody id="h-tbody"></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("h-customer").value = historyFilters.customerId;
    document.getElementById("h-status").value = historyFilters.status;
    document.getElementById("h-apply").addEventListener("click", () => {
      historyFilters = { from: document.getElementById("h-from").value, to: document.getElementById("h-to").value, customerId: document.getElementById("h-customer").value, status: document.getElementById("h-status").value };
      loadRows();
    });
    document.getElementById("h-clear").addEventListener("click", () => {
      historyFilters = { from: "", to: "", customerId: "", status: "" };
      renderHistory(root);
    });
    await loadRows();

    async function loadRows() {
      const customersList = await DB.Customers.list();
      const custMap = Object.fromEntries(customersList.map((c) => [c.id, c.name]));
      const sales = await DB.Sales.list(historyFilters);
      const tbody = document.getElementById("h-tbody");
      const canCancel = Auth.can("sales.cancel");
      tbody.innerHTML = sales.length ? sales.map((s) => `
        <tr>
          <td class="mono">${s.invoiceNo}</td>
          <td>${U.formatDate(s.date)}</td>
          <td>${s.customerId ? U.escapeHtml(custMap[s.customerId] || "—") : "Walk-in"}</td>
          <td class="text-right mono">${U.formatMoney(s.grandTotal)}</td>
          <td class="text-right mono">${U.formatMoney(s.paid)}</td>
          <td class="text-right mono">${U.formatMoney(s.due)}</td>
          <td>${UI.statusBadge(s.status)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-view="${s.id}" title="View invoice">🧾</button>
            ${s.due > 0 && s.status !== "cancelled" && s.customerId ? `<button class="icon-btn" data-pay="${s.id}" title="Record payment">💳</button>` : ""}
            ${canCancel && s.status !== "cancelled" ? `<button class="icon-btn" data-cancel="${s.id}" title="Cancel sale">🚫</button>` : ""}
          </div></td>
        </tr>`).join("") : UI.emptyRow(8, "No sales match these filters");

      tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openInvoiceModal(b.dataset.view)));
      tbody.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
        const sale = await DB.Sales.get(b.dataset.pay);
        Pages.Payments.openPaymentModal({ customerId: sale.customerId, saleId: sale.id, suggestedAmount: sale.due, onDone: loadRows });
      }));
      tbody.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => {
        UI.confirmDialog({
          title: "Cancel this sale?", message: "Stock will be restored. Any recorded payments will remain on the customer's account as credit.", confirmText: "Cancel Sale", danger: true,
          onConfirm: async () => { await DB.Sales.cancel(b.dataset.cancel, Auth.currentUser().id); UI.toast("success", "Sale cancelled"); loadRows(); },
        });
      }));
    }
  }

  // ---------------------------------------------------------------
  // Invoice view / print
  // ---------------------------------------------------------------
  async function openInvoiceModal(saleId) {
    const [sale, settings] = await Promise.all([DB.Sales.get(saleId), DB.Settings.get()]);
    const customer = sale.customerId ? await DB.Customers.get(sale.customerId) : null;
    const bodyHTML = `
      <div id="invoice-print">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
          <div><h3 style="margin-bottom:2px">${U.escapeHtml(settings.companyName)}</h3><div class="muted" style="font-size:12px">${U.escapeHtml(settings.companyAddress)}<br>${U.escapeHtml(settings.companyPhone)}</div></div>
          <div style="text-align:right"><div class="muted" style="font-size:12px">Invoice</div><strong class="mono">${sale.invoiceNo}</strong><div class="muted" style="font-size:12px">${U.formatDate(sale.date)}</div></div>
        </div>
        <div style="margin-bottom:14px;font-size:13px;"><strong>Bill To:</strong> ${customer ? U.escapeHtml(customer.name) + " · " + U.escapeHtml(customer.phone || "") : "Walk-in Customer"}</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Discount</th><th class="text-right">Total</th></tr></thead>
          <tbody>${sale.items.map((it) => `<tr><td>${U.escapeHtml(it.productName)}<div class="muted" style="font-size:11px">${U.escapeHtml(it.variantName)}</div></td><td class="text-right">${it.qty}</td><td class="text-right mono">${U.formatMoney(it.unitPrice)}</td><td class="text-right mono">${U.formatMoney(it.discount)}</td><td class="text-right mono">${U.formatMoney(it.lineTotal)}</td></tr>`).join("")}</tbody>
          <tfoot>
            <tr><td colspan="4" class="text-right">Subtotal</td><td class="text-right mono">${U.formatMoney(sale.subtotal)}</td></tr>
            <tr><td colspan="4" class="text-right">Discount</td><td class="text-right mono">${U.formatMoney(sale.discountTotal)}</td></tr>
            <tr><td colspan="4" class="text-right">Tax</td><td class="text-right mono">${U.formatMoney(sale.taxTotal)}</td></tr>
            <tr><td colspan="4" class="text-right">Grand Total</td><td class="text-right mono">${U.formatMoney(sale.grandTotal)}</td></tr>
            <tr><td colspan="4" class="text-right">Paid</td><td class="text-right mono">${U.formatMoney(sale.paid)}</td></tr>
            <tr><td colspan="4" class="text-right">Due</td><td class="text-right mono">${U.formatMoney(sale.due)}</td></tr>
          </tfoot>
        </table></div>
        <div style="margin-top:10px;">${UI.statusBadge(sale.status)} <span class="muted" style="font-size:12px;margin-left:8px;">Payment: ${U.escapeHtml(sale.paymentMethod)}</span></div>
      </div>`;
    const modalEl = UI.openModal({ title: "Invoice", bodyHTML, size: "lg", footerHTML: `<button class="btn btn-ghost" data-close-modal>Close</button><button class="btn btn-primary" id="print-invoice">🖨️ Print</button>` });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    modalEl.querySelector("#print-invoice").addEventListener("click", () => window.print());
  }

  Router.register("sales", { title: "Sales", permission: "sales", render });
  global.Pages = global.Pages || {};
  global.Pages.Sales = { openInvoiceModal };
})(window);
