/* =====================================================================
   pages/sales.js — New Sale (POS) and Sales History.

   Routes:  #sales          → New Sale
            #sales-history  → Sales History (memo / print / payment / cancel)
   The memo itself lives in pages/memo.js (#memo?id=…).
   All stock / total / validation rules are enforced by DB.Sales.create;
   this page only collects input and shows previews.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  let cart = []; // { variantId, productName, variantName, sku, size, unitPrice, qty, discount, maxStock }
  // One id per cart, sent with the sale: if "Complete Sale" is submitted
  // twice the data layer returns the first sale instead of selling twice.
  let checkoutRef = U.uid("chk");
  // Checkout form state survives navigating away and back.
  let draft = { customerId: "", customerName: "", customerPhone: "", method: "cash", extraDiscount: "0", paid: "" };
  let historyFilters = { from: "", to: "", customerId: "", status: "", q: "" };

  const PAYMENT_METHODS = [["cash", "Cash"], ["bkash", "bKash"], ["card", "Card"], ["bank", "Bank Transfer"]];

  function customerLabel(sale, custMap) {
    if (sale.customerId) return custMap[sale.customerId] || "—";
    return sale.customerName ? `${sale.customerName}` : "Walk-in";
  }

  // ---------------------------------------------------------------
  // NEW SALE (POS)
  // ---------------------------------------------------------------
  async function renderNewSale(root) {
    const [customers, settings] = await Promise.all([DB.Customers.list(), DB.Settings.get()]);
    const variantOptions = DB.Products.sellableVariants().map((r) => ({
      id: r.variant.id, sku: r.variant.sku, barcode: r.variant.barcode, price: r.variant.sellingPrice,
      stock: r.stock, reorderLevel: r.variant.reorderLevel, productName: r.product.name, variantName: r.variant.name,
      categoryName: r.categoryName, size: U.parseSize(r.product.description, r.product.name),
      description: r.product.description || "", searchText: r.searchText,
    }));
    // Cart lines from an earlier visit: refresh their stock limits.
    cart.forEach((c) => { const o = variantOptions.find((x) => x.id === c.variantId); c.maxStock = o ? o.stock : 0; });

    root.innerHTML = `
      <div class="pos-grid">
        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-pad">
              <div class="pos-search search-input">
                <input id="item-search" type="search" placeholder="Search product, size (7x3.5), Left/Right, code — or scan a barcode" autocomplete="off" aria-label="Search products" aria-controls="item-suggestions" aria-autocomplete="list">
                <div id="item-suggestions" class="pos-results" role="listbox" hidden></div>
              </div>
              <p class="pos-hint">↑ ↓ to choose · Enter to add · scanning a barcode adds the item directly</p>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3 id="cart-title">Items</h3>
              <button class="btn btn-ghost btn-sm" id="cart-clear" hidden>${Icons.svg("trash", 15)} Clear</button>
            </div>
            <div id="cart-body" class="cart-list"></div>
          </div>
        </div>

        <div class="pos-checkout">
          <div class="card">
            <div class="card-header"><h3>Checkout</h3></div>
            <div class="card-pad" style="display:flex;flex-direction:column;gap:14px">
              <div class="field">
                <label for="sale-customer">Customer</label>
                <select id="sale-customer">
                  <option value="">Walk-in customer</option>
                  ${customers.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}${c.phone ? ` · ${U.escapeHtml(c.phone)}` : ""}</option>`).join("")}
                </select>
              </div>
              <div class="walkin-fields" id="walkin-fields">
                <div class="field"><label for="walkin-name">Name on memo <span class="muted">(optional)</span></label><input id="walkin-name" maxlength="120" placeholder="e.g. Rahim Uddin" autocomplete="off"></div>
                <div class="field"><label for="walkin-phone">Phone <span class="muted">(optional)</span></label><input id="walkin-phone" maxlength="40" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="off"></div>
              </div>
              <div class="field-row">
                <div class="field"><label for="sale-method">Payment</label>
                  <select id="sale-method">${PAYMENT_METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
                </div>
                <div class="field"><label for="sale-discount">Extra discount</label><input id="sale-discount" type="number" min="0" step="1" inputmode="decimal"></div>
              </div>

              <div class="kv-list">
                <div class="kv-row"><span>Subtotal</span><span id="sum-subtotal">${U.formatMoney(0)}</span></div>
                <div class="kv-row"><span>Discount</span><span id="sum-discount">${U.formatMoney(0)}</span></div>
                ${Number(settings.taxRatePercent || 0) ? `<div class="kv-row"><span>Tax (${settings.taxRatePercent}%)</span><span id="sum-tax">${U.formatMoney(0)}</span></div>` : `<span id="sum-tax" hidden></span>`}
                <div class="kv-row kv-total"><span>Total</span><span id="sum-total">${U.formatMoney(0)}</span></div>
              </div>

              <div class="field" id="paid-now-wrap">
                <label for="sale-paid">Amount paid now</label>
                <input id="sale-paid" type="number" min="0" step="1" inputmode="decimal">
                <span class="field-hint" id="paid-hint"></span>
              </div>

              <button class="btn btn-primary btn-lg btn-block" id="complete-sale">${Icons.svg("check", 18)} Complete Sale</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const $ = (id) => document.getElementById(id);
    const searchInput = $("item-search");
    const suggestBox = $("item-suggestions");
    const customerSel = $("sale-customer");
    customerSel.value = customers.some((c) => c.id === draft.customerId) ? draft.customerId : "";
    $("walkin-name").value = draft.customerName;
    $("walkin-phone").value = draft.customerPhone;
    $("sale-method").value = draft.method;
    $("sale-discount").value = draft.extraDiscount;
    $("sale-paid").value = draft.paid;

    // ---------- product search ----------
    let matches = [];
    let activeIdx = 0;
    function findMatches(query) {
      const q = query.trim();
      if (!q) return [];
      // An exact barcode/SKU (e.g. from a scanner) wins outright.
      const exact = variantOptions.filter((v) => v.barcode === q || v.sku.toLowerCase() === q.toLowerCase());
      if (exact.length) return exact;
      return variantOptions.filter((v) => U.matchesSearch(v.searchText, q)).sort((a, b) => (b.stock > 0) - (a.stock > 0)).slice(0, 12);
    }
    function renderSuggestions() {
      if (!searchInput.value.trim()) { suggestBox.hidden = true; return; }
      suggestBox.hidden = false;
      if (!matches.length) { suggestBox.innerHTML = `<div class="pos-result" style="cursor:default"><span class="muted">No matching products</span></div>`; return; }
      suggestBox.innerHTML = matches.map((v, i) => `
        <div class="pos-result ${i === activeIdx ? "is-active" : ""} ${v.stock <= 0 ? "is-out" : ""}" data-pick="${v.id}" role="option" aria-selected="${i === activeIdx}">
          <div style="min-width:0">
            <div class="r-title">${U.escapeHtml(v.productName)}${U.isPlainVariant(v.variantName) ? "" : ` — ${U.escapeHtml(v.variantName)}`}</div>
            <div class="r-sub">${[v.size, v.categoryName, v.sku].filter(Boolean).map(U.escapeHtml).join(" · ")}</div>
          </div>
          <div class="r-right"><span class="mono" style="font-weight:600">${U.formatMoney(v.price)}</span>${UI.stockBadge(v.stock, v.reorderLevel)}</div>
        </div>`).join("");
      suggestBox.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(el.dataset.pick); }));
    }
    function pick(variantId) { addToCart(variantId); searchInput.value = ""; matches = []; renderSuggestions(); searchInput.focus(); }

    searchInput.addEventListener("input", U.debounce(() => { matches = findMatches(searchInput.value); activeIdx = 0; renderSuggestions(); }, 120));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!matches.length) return;
        e.preventDefault();
        activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
        renderSuggestions();
      } else if (e.key === "Enter") {
        e.preventDefault();
        matches = findMatches(searchInput.value);
        if (matches.length) pick(matches[Math.min(activeIdx, matches.length - 1)].id);
        else if (searchInput.value.trim()) UI.toast("warning", "No matching item", searchInput.value.trim());
      } else if (e.key === "Escape") {
        searchInput.value = ""; matches = []; renderSuggestions();
      }
    });
    searchInput.addEventListener("blur", () => setTimeout(() => { suggestBox.hidden = true; }, 120));
    searchInput.addEventListener("focus", () => { if (searchInput.value.trim()) renderSuggestions(); });

    // ---------- checkout fields ----------
    const saveDraft = () => {
      draft = { customerId: customerSel.value, customerName: $("walkin-name").value, customerPhone: $("walkin-phone").value, method: $("sale-method").value, extraDiscount: $("sale-discount").value, paid: $("sale-paid").value };
    };
    customerSel.addEventListener("change", () => { saveDraft(); updateTotals(); });
    ["walkin-name", "walkin-phone", "sale-method"].forEach((id) => $(id).addEventListener("input", saveDraft));
    $("sale-discount").addEventListener("input", () => { saveDraft(); updateTotals(); });
    $("sale-paid").addEventListener("input", () => { saveDraft(); updateTotals(); });
    $("cart-clear").addEventListener("click", () => {
      UI.confirmDialog({ title: "Clear all items?", message: "This removes every item from the current sale. Nothing has been saved yet.", confirmText: "Clear Items", danger: true,
        onConfirm: () => { cart = []; renderCart(); updateTotals(); } });
    });

    // ---------- complete sale ----------
    const completeBtn = $("complete-sale");
    completeBtn.addEventListener("click", async () => {
      if (completeBtn.disabled) return;
      if (!cart.length) { UI.toast("error", "No items yet", "Search and add at least one product"); searchInput.focus(); return; }
      for (const item of cart) {
        if (item.qty > item.maxStock) { UI.toast("error", "Not enough stock", `${item.productName} — ${item.variantName} has only ${item.maxStock} left`); return; }
      }
      const customerId = customerSel.value || null;
      const paidNow = customerId ? (Number($("sale-paid").value) || 0) : undefined;
      completeBtn.disabled = true;
      completeBtn.innerHTML = `${Icons.svg("history", 18)} Saving…`;
      try {
        const sale = await DB.Sales.create({
          clientRef: checkoutRef,
          customerId,
          customerName: customerId ? "" : $("walkin-name").value,
          customerPhone: customerId ? "" : $("walkin-phone").value,
          items: cart.map((c) => ({ variantId: c.variantId, qty: c.qty, unitPrice: c.unitPrice, discount: c.discount })),
          discountTotal: Number($("sale-discount").value) || 0,
          paymentMethod: $("sale-method").value,
          staffId: Auth.currentUser().id,
          paidNow,
        });
        UI.toast("success", "Sale completed", sale.invoiceNo);
        cart = [];
        checkoutRef = U.uid("chk");
        draft = { customerId: "", customerName: "", customerPhone: "", method: "cash", extraDiscount: "0", paid: "" };
        Pages.Memo.open(sale.id, { justSold: true });
      } catch (err) {
        UI.toast("error", "Could not complete sale", err.message);
        // Stock may have changed (e.g. sold from another tab) — refresh limits.
        const levels = DB.Stock.levelsMap();
        cart.forEach((c) => { c.maxStock = levels[c.variantId] || 0; });
        variantOptions.forEach((v) => { v.stock = levels[v.id] || 0; });
        renderCart(); updateTotals();
        completeBtn.disabled = false;
        completeBtn.innerHTML = `${Icons.svg("check", 18)} Complete Sale`;
      }
    });

    renderCart();
    updateTotals();
    searchInput.focus();

    function addToCart(variantId) {
      const v = variantOptions.find((x) => x.id === variantId);
      if (!v) return;
      if (v.stock <= 0) { UI.toast("warning", "Out of stock", `${v.productName} — ${v.variantName} has no available stock`); return; }
      const existing = cart.find((c) => c.variantId === variantId);
      if (existing) {
        if (existing.qty < v.stock) existing.qty += 1;
        else UI.toast("warning", "Stock limit reached", `Only ${v.stock} available`);
      } else {
        cart.push({ variantId: v.id, productName: v.productName, variantName: v.variantName, sku: v.sku, size: v.size, unitPrice: v.price, qty: 1, discount: 0, maxStock: v.stock });
      }
      renderCart(); updateTotals();
    }

    function lineTotal(c) { return c.qty * c.unitPrice - c.discount; }

    function renderCart() {
      const body = $("cart-body");
      const units = cart.reduce((a, c) => a + c.qty, 0);
      $("cart-title").textContent = cart.length ? `Items · ${cart.length} line${cart.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}` : "Items";
      $("cart-clear").hidden = !cart.length;
      if (!cart.length) {
        body.innerHTML = `<div class="cart-empty"><span class="empty-icon">${Icons.svg("cart", 34)}</span><div style="font-weight:600;color:var(--text)">No items yet</div><div style="font-size:13px;margin-top:2px">Search above to add products to this sale.</div></div>`;
        return;
      }
      body.innerHTML = cart.map((c, idx) => `
        <div class="cart-line">
          <div style="min-width:0">
            <div class="cl-title">${U.escapeHtml(c.productName)}</div>
            <div class="cl-meta">
              ${U.isPlainVariant(c.variantName) ? "" : `<span class="chip">${U.escapeHtml(c.variantName)}</span>`}
              ${c.size ? `<span class="chip">${U.escapeHtml(c.size)}</span>` : ""}
              <span class="code">${U.escapeHtml(c.sku)}</span>
              <span class="${c.qty > c.maxStock ? "text-danger" : ""}">· ${c.maxStock} in stock</span>
            </div>
          </div>
          <div class="cl-total">${U.formatMoney(lineTotal(c))}</div>
          <div class="cl-controls">
            <label>Qty
              <span class="qty-stepper">
                <button type="button" data-dec="${idx}" aria-label="Decrease quantity" ${c.qty <= 1 ? "disabled" : ""}>${Icons.svg("minus", 15)}</button>
                <input type="number" min="1" max="${c.maxStock}" value="${c.qty}" data-qty="${idx}" inputmode="numeric" aria-label="Quantity">
                <button type="button" data-inc="${idx}" aria-label="Increase quantity" ${c.qty >= c.maxStock ? "disabled" : ""}>${Icons.svg("plus", 15)}</button>
              </span>
            </label>
            <label>Unit price<input type="number" min="0" step="1" value="${c.unitPrice}" data-price="${idx}" inputmode="decimal"></label>
            <label>Discount<input type="number" min="0" step="1" value="${c.discount}" data-discount="${idx}" inputmode="decimal"></label>
            <button class="icon-btn danger cl-remove" data-remove="${idx}" title="Remove item" aria-label="Remove ${U.escapeHtml(c.productName)}">${Icons.svg("trash", 17)}</button>
          </div>
        </div>`).join("");

      const setQty = (idx, q) => { cart[idx].qty = U.clamp(q, 1, Math.max(1, cart[idx].maxStock)); renderCart(); updateTotals(); };
      body.querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => setQty(+b.dataset.dec, cart[+b.dataset.dec].qty - 1)));
      body.querySelectorAll("[data-inc]").forEach((b) => b.addEventListener("click", () => setQty(+b.dataset.inc, cart[+b.dataset.inc].qty + 1)));
      body.querySelectorAll("[data-qty]").forEach((i) => i.addEventListener("change", (e) => setQty(+e.target.dataset.qty, Number(e.target.value) || 1)));
      body.querySelectorAll("[data-price]").forEach((i) => i.addEventListener("input", (e) => { cart[+e.target.dataset.price].unitPrice = Number(e.target.value) || 0; refreshLineTotals(); updateTotals(); }));
      body.querySelectorAll("[data-discount]").forEach((i) => i.addEventListener("input", (e) => { cart[+e.target.dataset.discount].discount = Number(e.target.value) || 0; refreshLineTotals(); updateTotals(); }));
      body.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => { cart.splice(+b.dataset.remove, 1); renderCart(); updateTotals(); }));
    }

    // Update line totals in place while typing (re-rendering would steal focus).
    function refreshLineTotals() {
      $("cart-body").querySelectorAll(".cl-total").forEach((el, i) => { if (cart[i]) el.textContent = U.formatMoney(lineTotal(cart[i])); });
    }

    function updateTotals() {
      const subtotal = U.sum(cart, (c) => c.qty * c.unitPrice);
      const lineDiscounts = U.sum(cart, (c) => c.discount);
      const extraDiscount = Number($("sale-discount").value) || 0;
      const discountTotal = lineDiscounts + extraDiscount;
      const taxTotal = Math.round((subtotal - discountTotal) * ((settings.taxRatePercent || 0) / 100));
      const grandTotal = Math.max(0, subtotal - discountTotal + taxTotal);
      $("sum-subtotal").textContent = U.formatMoney(subtotal);
      $("sum-discount").textContent = discountTotal ? `− ${U.formatMoney(discountTotal)}` : U.formatMoney(0);
      $("sum-tax").textContent = U.formatMoney(taxTotal);
      $("sum-total").textContent = U.formatMoney(grandTotal);

      const customerId = customerSel.value;
      $("walkin-fields").hidden = !!customerId;
      const paidInput = $("sale-paid");
      const hint = $("paid-hint");
      if (!customerId) {
        paidInput.value = String(Math.round(grandTotal)); paidInput.disabled = true;
        hint.textContent = "Walk-in sales are paid in full.";
      } else {
        paidInput.disabled = false;
        if (paidInput.value === "") paidInput.value = String(Math.round(grandTotal));
        if (Number(paidInput.value) > grandTotal) paidInput.value = String(Math.round(grandTotal));
        const due = Math.max(0, grandTotal - (Number(paidInput.value) || 0));
        hint.innerHTML = due > 0 ? `<span class="text-warning">Due ${U.formatMoney(due)} will be added to the customer's balance.</span>` : "Fully paid.";
      }
      $("complete-sale").disabled = !cart.length;
    }
  }

  // ---------------------------------------------------------------
  // SALES HISTORY
  // ---------------------------------------------------------------
  async function renderHistory(root) {
    const customers = await DB.Customers.list();
    root.innerHTML = `
      <div class="filter-bar card card-pad">
        <div class="field search-input" style="flex:1 1 220px"><label for="h-q">Search</label><input id="h-q" type="search" placeholder="Memo no. or customer" value="${U.escapeHtml(historyFilters.q)}"></div>
        <div class="field"><label for="h-from">From</label><input type="date" id="h-from" value="${historyFilters.from}"></div>
        <div class="field"><label for="h-to">To</label><input type="date" id="h-to" value="${historyFilters.to}"></div>
        <div class="field"><label for="h-customer">Customer</label>
          <select id="h-customer"><option value="">All customers</option>${customers.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}</select>
        </div>
        <div class="field"><label for="h-status">Status</label>
          <select id="h-status"><option value="">All</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="due">Due</option><option value="cancelled">Cancelled</option></select>
        </div>
        <button class="btn btn-ghost" id="h-clear">Clear</button>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Memo</th><th>Date</th><th>Customer</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
          <tbody id="h-tbody"></tbody>
        </table></div>
      </div>
      <div id="h-more" style="text-align:center;margin-top:14px"></div>
    `;
    document.getElementById("h-customer").value = historyFilters.customerId;
    document.getElementById("h-status").value = historyFilters.status;
    const apply = () => {
      historyFilters = { q: document.getElementById("h-q").value, from: document.getElementById("h-from").value, to: document.getElementById("h-to").value, customerId: document.getElementById("h-customer").value, status: document.getElementById("h-status").value };
      limit = PAGE; loadRows();
    };
    document.getElementById("h-q").addEventListener("input", U.debounce(apply, 180));
    ["h-from", "h-to", "h-customer", "h-status"].forEach((id) => document.getElementById(id).addEventListener("change", apply));
    document.getElementById("h-clear").addEventListener("click", () => { historyFilters = { from: "", to: "", customerId: "", status: "", q: "" }; renderHistory(root); });

    const PAGE = 50;
    let limit = PAGE;
    await loadRows();

    async function loadRows() {
      const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
      let sales = await DB.Sales.list(historyFilters);
      if (historyFilters.q.trim()) {
        sales = sales.filter((s) => U.matchesSearch(`${s.invoiceNo} ${customerLabel(s, custMap)} ${s.customerPhone || ""}`, historyFilters.q));
      }
      const tbody = document.getElementById("h-tbody");
      if (!tbody) return;
      const canCancel = Auth.can("sales.cancel");
      UI.showMore(document.getElementById("h-more"), sales.length, limit, () => { limit += PAGE; loadRows(); });
      tbody.innerHTML = sales.length ? sales.slice(0, limit).map((s) => `
        <tr>
          <td><a href="#memo?id=${encodeURIComponent(s.id)}" class="cell-title mono" style="color:var(--text)">${U.escapeHtml(s.invoiceNo)}</a><div class="cell-sub">${s.items.length} item${s.items.length === 1 ? "" : "s"}</div></td>
          <td>${U.formatDateTime(s.date)}</td>
          <td>${U.escapeHtml(customerLabel(s, custMap))}</td>
          <td class="text-right mono">${U.formatMoney(s.grandTotal)}</td>
          <td class="text-right mono">${U.formatMoney(s.paid)}</td>
          <td class="text-right mono">${s.status === "cancelled" ? "—" : U.formatMoney(Math.max(0, s.due))}</td>
          <td>${UI.statusBadge(s.status)}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-view="${s.id}" title="View memo" aria-label="View memo ${U.escapeHtml(s.invoiceNo)}">${Icons.svg("eye", 17)}</button>
            <button class="icon-btn" data-print="${s.id}" title="Print memo" aria-label="Print memo ${U.escapeHtml(s.invoiceNo)}">${Icons.svg("printer", 17)}</button>
            ${s.due > 0 && s.status !== "cancelled" && s.customerId ? `<button class="icon-btn" data-pay="${s.id}" title="Record payment" aria-label="Record payment">${Icons.svg("card", 17)}</button>` : ""}
            ${canCancel && s.status !== "cancelled" ? `<button class="icon-btn danger" data-cancel="${s.id}" title="Cancel sale" aria-label="Cancel sale ${U.escapeHtml(s.invoiceNo)}">${Icons.svg("cancel", 17)}</button>` : ""}
          </div></td>
        </tr>`).join("") : UI.emptyRow(8, historyFilters.q || historyFilters.from || historyFilters.to || historyFilters.customerId || historyFilters.status ? "No sales match these filters" : "No sales yet — completed sales and their memos will appear here");

      tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => Pages.Memo.open(b.dataset.view)));
      tbody.querySelectorAll("[data-print]").forEach((b) => b.addEventListener("click", () => Router.go(`memo?id=${encodeURIComponent(b.dataset.print)}&print=1`)));
      tbody.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", async () => {
        const sale = await DB.Sales.get(b.dataset.pay);
        Pages.Payments.openPaymentModal({ customerId: sale.customerId, saleId: sale.id, suggestedAmount: sale.due, onDone: loadRows });
      }));
      tbody.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => {
        UI.confirmDialog({
          title: "Cancel this sale?", message: "Stock will be restored. Any recorded payments will remain on the customer's account as credit. The memo stays in history, marked CANCELLED.", confirmText: "Cancel Sale", danger: true,
          onConfirm: async () => { try { await DB.Sales.cancel(b.dataset.cancel, Auth.currentUser().id); UI.toast("success", "Sale cancelled"); loadRows(); } catch (err) { UI.toast("error", "Could not cancel sale", err.message); } },
        });
      }));
    }
  }

  Router.register("sales", { title: "New Sale", permission: "sales", render: renderNewSale });
  Router.register("sales-history", { title: "Sales History", permission: "sales", render: renderHistory });
  global.Pages = global.Pages || {};
  // Kept for any caller that still opens a memo by id.
  global.Pages.Sales = { openInvoiceModal: (saleId) => Pages.Memo.open(saleId) };
})(window);
