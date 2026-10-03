/* =====================================================================
   pages/inventory.js — stock levels, manual adjustments, movement history.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let state = { search: "", lowOnly: false };

  const TYPE_BADGE = {
    initial: ["Opening", "info"], purchase: ["Purchase", "success"], sale: ["Sale", "neutral"],
    return: ["Return", "info"], damage: ["Damage/Loss", "danger"], correction: ["Correction", "warning"], other: ["Other", "neutral"], adjustment: ["Adjustment", "neutral"],
  };

  // Reason → direction. "either" reasons let the user pick + or −.
  const REASONS = [
    { value: "purchase", label: "Purchase / Restock (+)", direction: "add" },
    { value: "initial", label: "Opening stock — first count (+)", direction: "add" },
    { value: "return", label: "Customer return (+)", direction: "add" },
    { value: "damage", label: "Damaged / Lost (−)", direction: "remove" },
    { value: "correction", label: "Stock count correction (±)", direction: "either" },
    { value: "other", label: "Other (±)", direction: "either" },
  ];

  async function render(root) {
    const canAdjust = Auth.can("inventory.adjust");
    root.innerHTML = `
      <div class="toolbar">
        <div class="search-input"><input id="i-search" placeholder="Search name, size (7x3.5), Left/Right, SKU, barcode…" value="${U.escapeHtml(state.search)}"></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted)">
          <input type="checkbox" id="i-low" ${state.lowOnly ? "checked" : ""}> Low stock only
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

  function stockStatus(level, reorderLevel) {
    return level <= 0 ? ["Out of Stock", "danger"] : level <= (reorderLevel || 0) ? ["Low Stock", "warning"] : ["In Stock", "success"];
  }

  async function renderTable() {
    const canAdjust = Auth.can("inventory.adjust");
    let rows = DB.Products.sellableVariants();
    if (state.search.trim()) rows = rows.filter((r) => U.matchesSearch(r.searchText, state.search));
    if (state.lowOnly) rows = rows.filter((r) => r.stock <= (r.variant.reorderLevel || 0));

    const tbody = document.getElementById("i-tbody");
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = UI.emptyRow(7, "No matching stock records"); return; }

    tbody.innerHTML = rows.map((r) => {
      const status = stockStatus(r.stock, r.variant.reorderLevel);
      return `
        <tr>
          <td>${U.escapeHtml(r.product.name)}${r.product.description ? `<div class="muted" style="font-size:11.5px">${U.escapeHtml(r.product.description)}</div>` : ""}</td>
          <td><strong>${U.escapeHtml(r.variant.name)}</strong></td>
          <td class="mono muted">${U.escapeHtml(r.variant.sku)}</td>
          <td class="text-right mono"><strong>${U.formatNumber(r.stock)}</strong></td>
          <td class="text-right muted">${U.formatNumber(r.variant.reorderLevel || 0)}</td>
          <td>${UI.badge(status[0], status[1])}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-history="${r.variant.id}" title="Movement history">🕘</button>
            ${canAdjust ? `<button class="icon-btn" data-adjust="${r.variant.id}" title="Add / remove stock">➕</button>` : ""}
          </div></td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-history]").forEach((b) => b.addEventListener("click", () => openHistoryModal(b.dataset.history)));
    tbody.querySelectorAll("[data-adjust]").forEach((b) => b.addEventListener("click", () => openAdjustModal(b.dataset.adjust)));
  }

  async function openHistoryModal(variantId) {
    const variant = DB.Variants.get(variantId);
    const [product, entries, users] = await Promise.all([DB.Products.get(variant.productId), DB.Stock.ledgerFor(variantId), DB.Users.list()]);
    const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    // Running balance after each movement (entries arrive newest first).
    let balance = entries.reduce((a, e) => a + e.change, 0);
    const rows = entries.map((e) => { const row = { e, after: balance }; balance -= e.change; return row; });

    const bodyHTML = `
      <p style="margin-bottom:4px"><strong>${U.escapeHtml(product ? product.name : "—")}</strong> — <strong>${U.escapeHtml(variant.name)}</strong></p>
      <p class="muted" style="margin-bottom:12px"><span class="mono">${U.escapeHtml(variant.sku)}</span>${product && product.description ? ` · ${U.escapeHtml(product.description)}` : ""} · Current stock: <strong>${DB.Stock.getLevel(variantId)}</strong></p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Type</th><th class="text-right">Change</th><th class="text-right">Balance</th><th>Reference</th><th>Note</th><th>By</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map(({ e, after }) => {
            const t = TYPE_BADGE[e.type] || ["Other", "neutral"];
            return `<tr>
              <td>${U.formatDateTime(e.date)}</td>
              <td>${UI.badge(t[0], t[1])}</td>
              <td class="text-right mono" style="color:${e.change >= 0 ? "var(--success)" : "var(--danger)"}">${e.change > 0 ? "+" : ""}${e.change}</td>
              <td class="text-right mono">${after}</td>
              <td class="mono muted">${U.escapeHtml(e.reference || "—")}</td>
              <td class="muted">${U.escapeHtml(e.note || "—")}</td>
              <td class="muted">${U.escapeHtml(userMap[e.userId] || "—")}</td>
            </tr>`;
          }).join("") : UI.emptyRow(7, "No movements yet")}
        </tbody>
      </table></div>`;
    const modalEl = UI.openModal({ title: "Stock Movement History", bodyHTML, size: "lg", footerHTML: `<button class="btn btn-secondary" data-close-modal>Close</button>` });
    modalEl.querySelector(".modal-footer [data-close-modal]").addEventListener("click", UI.closeModal);
  }

  function openAdjustModal(preselectVariantId) {
    const all = DB.Products.sellableVariants();
    const optionHTML = (list) => list.map((r) => `<option value="${r.variant.id}">${U.escapeHtml(r.product.name)} — ${U.escapeHtml(r.variant.name)}${r.product.description ? ` (${U.escapeHtml(r.product.description)})` : ""} · ${r.stock} in stock</option>`).join("");

    const bodyHTML = `
      <form id="adjust-form">
        <div class="field"><label>Find product</label><input id="af-filter" placeholder="Type to filter: name, size, Left/Right, SKU…" autocomplete="off"></div>
        <div class="field"><label>Product / Variant *</label><select id="af-variant">${optionHTML(all)}</select>
          <span class="field-hint" id="af-current"></span></div>
        <div class="field"><label>Reason *</label>
          <select id="af-reason">${REASONS.map((r) => `<option value="${r.value}">${r.label}</option>`).join("")}</select>
        </div>
        <div class="field-row">
          <div class="field"><label>Direction</label>
            <select id="af-direction">
              <option value="add">Add Stock (+)</option>
              <option value="remove">Remove Stock (−)</option>
            </select>
          </div>
          <div class="field"><label>Quantity *</label><input id="af-qty" type="number" min="1" step="1" value="1" required inputmode="numeric"></div>
        </div>
        <div class="field"><label>Reference (optional)</label><input id="af-ref" placeholder="e.g. PO-1029, supplier invoice #"></div>
        <div class="field"><label>Note (optional)</label><textarea id="af-note" rows="2"></textarea></div>
        <p id="af-preview" style="font-size:13px;margin-top:8px"></p>
      </form>`;
    const footerHTML = `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="af-save">Save Adjustment</button>`;
    const modalEl = UI.openModal({ title: "Stock Adjustment", bodyHTML, footerHTML });
    modalEl.querySelector(".modal-footer [data-close-modal]").addEventListener("click", UI.closeModal);

    const $ = (sel) => modalEl.querySelector(sel);
    const select = $("#af-variant"), reasonSel = $("#af-reason"), dirSel = $("#af-direction"), qtyInput = $("#af-qty");
    if (preselectVariantId) select.value = preselectVariantId;

    function currentRow() { return all.find((r) => r.variant.id === select.value); }
    function refresh() {
      const reason = REASONS.find((r) => r.value === reasonSel.value);
      if (reason.direction !== "either") dirSel.value = reason.direction;
      dirSel.disabled = reason.direction !== "either";
      const row = currentRow();
      const qty = Number(qtyInput.value);
      $("#af-current").textContent = row ? `Current stock: ${row.stock}` : "";
      if (!row || !Number.isInteger(qty) || qty <= 0) { $("#af-preview").textContent = ""; return; }
      const after = row.stock + (dirSel.value === "add" ? qty : -qty);
      $("#af-preview").innerHTML = after < 0
        ? `<span class="text-danger">Cannot remove ${qty} — only ${row.stock} in stock.</span>`
        : `Stock will change from <strong>${row.stock}</strong> to <strong>${after}</strong>.`;
    }
    $("#af-filter").addEventListener("input", (e) => {
      const keep = select.value;
      const list = e.target.value.trim() ? all.filter((r) => U.matchesSearch(r.searchText, e.target.value)) : all;
      select.innerHTML = list.length ? optionHTML(list) : `<option value="">No matching products</option>`;
      if (list.some((r) => r.variant.id === keep)) select.value = keep;
      refresh();
    });
    [select, reasonSel, dirSel].forEach((el) => el.addEventListener("change", refresh));
    qtyInput.addEventListener("input", refresh);
    refresh();

    const saveBtn = $("#af-save");
    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;
      const variantId = select.value;
      const qty = Number(qtyInput.value);
      if (!variantId) { UI.toast("error", "Choose a product variant"); return; }
      if (!Number.isInteger(qty) || qty <= 0) { UI.toast("error", "Enter a whole-number quantity of at least 1"); return; }
      const change = dirSel.value === "add" ? qty : -qty;
      saveBtn.disabled = true;
      try {
        await DB.Stock.adjust({ variantId, change, type: reasonSel.value, note: $("#af-note").value.trim(), reference: $("#af-ref").value.trim() || null, userId: Auth.currentUser().id });
        const row = currentRow();
        UI.toast("success", "Stock updated", row ? `${row.product.name} — ${row.variant.name}: ${row.stock} → ${row.stock + change}` : "");
        UI.closeModal();
        renderTable();
      } catch (err) {
        UI.toast("error", "Could not adjust stock", err.message);
        saveBtn.disabled = false;
      }
    });
  }

  Router.register("inventory", { title: "Inventory", permission: "inventory", render });
})(window);
