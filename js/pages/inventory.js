/* =====================================================================
   pages/inventory.js — stock levels, manual adjustments, movement history.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let state = { search: "", lowOnly: false };

  const TYPE_BADGE = {
    initial: ["Opening", "info"], purchase: ["Purchase", "success"], sale: ["Sale", "neutral"],
    return: ["Return", "info"], damage: ["Damage/Loss", "danger"], correction: ["Correction", "warning"], other: ["Other", "neutral"],
  };

  async function render(root) {
    const canAdjust = Auth.can("inventory.adjust");
    root.innerHTML = `
      <div class="toolbar">
        <div class="search-input"><input id="i-search" placeholder="Search product, SKU, barcode…"></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted)">
          <input type="checkbox" id="i-low"> Low stock only
        </label>
        <div class="spacer"></div>
        ${canAdjust ? `<button class="btn btn-primary" id="i-adjust">+ Stock Adjustment</button>` : ""}
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th class="text-right">In Stock</th><th class="text-right">Reorder Level</th><th>Status</th><th></th></tr></thead>
          <tbody id="i-tbody"></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("i-search").addEventListener("input", U.debounce((e) => { state.search = e.target.value; renderTable(); }, 200));
    document.getElementById("i-low").addEventListener("change", (e) => { state.lowOnly = e.target.checked; renderTable(); });
    if (canAdjust) document.getElementById("i-adjust").addEventListener("click", () => openAdjustModal());
    await renderTable();
  }

  async function renderTable() {
    const canAdjust = Auth.can("inventory.adjust");
    const products = await DB.Products.list({ activeOnly: true });
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    let variants = DB.Variants.all().filter((v) => v.active && productMap[v.productId]);

    if (state.search) {
      const q = state.search.toLowerCase();
      variants = variants.filter((v) => v.sku.toLowerCase().includes(q) || v.barcode.includes(q) || productMap[v.productId].name.toLowerCase().includes(q));
    }
    const rows = variants.map((v) => ({ variant: v, product: productMap[v.productId], level: DB.Stock.getLevel(v.id) }));
    let filtered = rows;
    if (state.lowOnly) filtered = filtered.filter((r) => r.level <= (r.variant.reorderLevel || 0));
    filtered.sort((a, b) => a.product.name.localeCompare(b.product.name) || a.variant.name.localeCompare(b.variant.name));

    const tbody = document.getElementById("i-tbody");
    if (!filtered.length) { tbody.innerHTML = UI.emptyRow(7, "No matching stock records"); return; }

    tbody.innerHTML = filtered.map((r) => {
      const status = r.level <= 0 ? ["Out of Stock", "danger"] : r.level <= (r.variant.reorderLevel || 0) ? ["Low Stock", "warning"] : ["In Stock", "success"];
      return `
        <tr>
          <td>${U.escapeHtml(r.product.name)}</td>
          <td>${U.escapeHtml(r.variant.name)}</td>
          <td class="mono muted">${U.escapeHtml(r.variant.sku)}</td>
          <td class="text-right mono"><strong>${U.formatNumber(r.level)}</strong></td>
          <td class="text-right muted">${U.formatNumber(r.variant.reorderLevel || 0)}</td>
          <td>${UI.badge(status[0], status[1])}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-history="${r.variant.id}" title="Movement history">🕘</button>
            ${canAdjust ? `<button class="icon-btn" data-adjust="${r.variant.id}" title="Adjust stock">➕</button>` : ""}
          </div></td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-history]").forEach((b) => b.addEventListener("click", () => openHistoryModal(b.dataset.history, productMap)));
    tbody.querySelectorAll("[data-adjust]").forEach((b) => b.addEventListener("click", () => openAdjustModal(b.dataset.adjust)));
  }

  function openHistoryModal(variantId, productMap) {
    const variant = DB.Variants.get(variantId);
    DB.Stock.ledgerFor(variantId).then((entries) => {
      const bodyHTML = `
        <p class="muted" style="margin-bottom:12px">${U.escapeHtml(variant.name)} · <span class="mono">${U.escapeHtml(variant.sku)}</span> · Current stock: <strong>${DB.Stock.getLevel(variantId)}</strong></p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Type</th><th class="text-right">Change</th><th>Reference</th><th>Note</th></tr></thead>
          <tbody>
            ${entries.length ? entries.map((e) => {
              const t = TYPE_BADGE[e.type] || ["Other", "neutral"];
              return `<tr>
                <td>${U.formatDateTime(e.date)}</td>
                <td>${UI.badge(t[0], t[1])}</td>
                <td class="text-right mono" style="color:${e.change >= 0 ? "var(--success)" : "var(--danger)"}">${e.change > 0 ? "+" : ""}${e.change}</td>
                <td class="mono muted">${U.escapeHtml(e.reference || "—")}</td>
                <td class="muted">${U.escapeHtml(e.note || "—")}</td>
              </tr>`;
            }).join("") : UI.emptyRow(5, "No movements yet")}
          </tbody>
        </table></div>`;
      UI.openModal({ title: "Stock Movement History", bodyHTML, size: "lg", footerHTML: `<button class="btn btn-secondary" data-close-modal>Close</button>` });
      document.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    });
  }

  async function openAdjustModal(preselectVariantId) {
    const products = await DB.Products.list({ activeOnly: true });
    const options = [];
    products.forEach((p) => DB.Variants.listByProduct(p.id).filter((v) => v.active).forEach((v) => {
      options.push(`<option value="${v.id}" ${v.id === preselectVariantId ? "selected" : ""}>${U.escapeHtml(p.name)} — ${U.escapeHtml(v.name)} (${DB.Stock.getLevel(v.id)} in stock)</option>`);
    }));

    const bodyHTML = `
      <form id="adjust-form">
        <div class="field"><label>Product / Variant *</label><select id="af-variant">${options.join("")}</select></div>
        <div class="field-row">
          <div class="field"><label>Direction *</label>
            <select id="af-direction">
              <option value="add">Add Stock (+)</option>
              <option value="remove">Remove Stock (−)</option>
            </select>
          </div>
          <div class="field"><label>Quantity *</label><input id="af-qty" type="number" min="1" step="1" value="1" required></div>
        </div>
        <div class="field"><label>Reason *</label>
          <select id="af-reason">
            <option value="purchase">Purchase / Restock</option>
            <option value="return">Customer Return</option>
            <option value="damage">Damaged / Lost</option>
            <option value="correction">Stock Count Correction</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="field"><label>Reference (optional)</label><input id="af-ref" placeholder="e.g. PO-1029, supplier invoice #"></div>
        <div class="field"><label>Note (optional)</label><textarea id="af-note" rows="2"></textarea></div>
      </form>`;
    const footerHTML = `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="af-save">Save Adjustment</button>`;
    const modalEl = UI.openModal({ title: "Stock Adjustment", bodyHTML, footerHTML });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    modalEl.querySelector("#af-save").addEventListener("click", async () => {
      const variantId = modalEl.querySelector("#af-variant").value;
      const direction = modalEl.querySelector("#af-direction").value;
      const qty = Number(modalEl.querySelector("#af-qty").value);
      const reason = modalEl.querySelector("#af-reason").value;
      if (!variantId || !qty || qty <= 0) { UI.toast("error", "Enter a valid quantity"); return; }
      const change = direction === "add" ? qty : -qty;
      try {
        await DB.Stock.adjust({ variantId, change, type: reason, note: modalEl.querySelector("#af-note").value.trim(), reference: modalEl.querySelector("#af-ref").value.trim() || null, userId: Auth.currentUser().id });
        UI.toast("success", "Stock updated");
        UI.closeModal();
        renderTable();
      } catch (err) { UI.toast("error", "Could not adjust stock", err.message); }
    });
  }

  Router.register("inventory", { title: "Inventory", permission: "inventory", render });
})(window);
