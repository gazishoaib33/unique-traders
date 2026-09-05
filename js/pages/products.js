/* =====================================================================
   pages/products.js — product & variant catalog management.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let state = { search: "", categoryId: "", showInactive: false, categories: [] };

  function priceRangeLabel(variants) {
    const prices = variants.filter((v) => v.active).map((v) => v.sellingPrice);
    if (!prices.length) return "—";
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? U.formatMoney(min) : `${U.formatMoney(min)} – ${U.formatMoney(max)}`;
  }

  async function render(root) {
    const canEdit = Auth.can("products.edit");
    state.categories = await DB.Categories.list();

    root.innerHTML = `
      <div class="toolbar">
        <div class="search-input"><input id="p-search" placeholder="Search name, SKU or barcode…"></div>
        <select id="p-category" class="field-select">
          <option value="">All Categories</option>
          ${state.categories.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}
        </select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted)">
          <input type="checkbox" id="p-inactive"> Show archived
        </label>
        <div class="spacer"></div>
        ${canEdit ? `<button class="btn btn-primary" id="p-add">+ New Product</button>` : ""}
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th></th><th>Product</th><th>Category</th><th>Variants</th><th class="text-right">Stock</th><th class="text-right">Price</th><th>Status</th>${canEdit ? "<th></th>" : ""}
          </tr></thead>
          <tbody id="p-tbody"></tbody>
        </table></div>
      </div>
    `;

    document.getElementById("p-search").addEventListener("input", U.debounce((e) => { state.search = e.target.value; renderTable(); }, 200));
    document.getElementById("p-category").addEventListener("change", (e) => { state.categoryId = e.target.value; renderTable(); });
    document.getElementById("p-inactive").addEventListener("change", (e) => { state.showInactive = e.target.checked; renderTable(); });
    if (canEdit) document.getElementById("p-add").addEventListener("click", () => openProductModal(null));

    await renderTable();
  }

  async function renderTable() {
    const canEdit = Auth.can("products.edit");
    const tbody = document.getElementById("p-tbody");
    let products = await DB.Products.list({ search: state.search, categoryId: state.categoryId });
    if (!state.showInactive) products = products.filter((p) => p.active);
    const catMap = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));

    if (!products.length) { tbody.innerHTML = UI.emptyRow(canEdit ? 8 : 7, "No products found"); return; }

    tbody.innerHTML = products.map((p) => {
      const variants = DB.Variants.listByProduct(p.id);
      const activeVariants = variants.filter((v) => v.active);
      const totalStock = activeVariants.reduce((a, v) => a + DB.Stock.getLevel(v.id), 0);
      const lowest = Math.min(...activeVariants.map((v) => DB.Stock.getLevel(v.id) - (v.reorderLevel || 0)), 0);
      return `
        <tr>
          <td>${p.imageUrl
            ? `<img src="${U.escapeHtml(p.imageUrl)}" alt="" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">`
            : `<div style="width:36px;height:36px;border-radius:6px;background:var(--bg-subtle);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--text-faint);">🚪</div>`}
          </td>
          <td>
            <strong>${U.escapeHtml(p.name)}</strong>
            <div class="muted mono" style="font-size:11.5px">${U.escapeHtml(p.sku)}</div>
          </td>
          <td>${U.escapeHtml(catMap[p.categoryId] || "—")}</td>
          <td>${p.hasVariants ? `${activeVariants.length} variants` : "Single"}</td>
          <td class="text-right">${UI.badge(totalStock, lowest < 0 ? "warning" : "neutral")}</td>
          <td class="text-right mono">${priceRangeLabel(activeVariants)}</td>
          <td>${p.active ? UI.badge("Active", "success") : UI.badge("Archived", "neutral")}</td>
          ${canEdit ? `<td><div class="row-actions">
              <button class="icon-btn" data-edit="${p.id}" title="Edit">✏️</button>
              <button class="icon-btn" data-archive="${p.id}" title="${p.active ? "Archive" : "Restore"}">${p.active ? "📦" : "♻️"}</button>
              <button class="icon-btn" data-delete="${p.id}" title="Delete">🗑️</button>
            </div></td>` : ""}
        </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openProductModal(b.dataset.edit)));
    tbody.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", async () => {
      const p = await DB.Products.get(b.dataset.archive);
      await DB.Products.archive(p.id, !p.active);
      UI.toast("success", p.active ? "Archived" : "Restored", p.name);
      renderTable();
    }));
    tbody.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => {
      UI.confirmDialog({
        title: "Delete product?", message: "This cannot be undone. Products with sales/stock history cannot be deleted — archive them instead.", confirmText: "Delete", danger: true,
        onConfirm: async () => {
          try { await DB.Products.remove(b.dataset.delete); UI.toast("success", "Product deleted"); renderTable(); }
          catch (err) { UI.toast("error", "Cannot delete", err.message); }
        },
      });
    }));
  }

  // ---------------------------------------------------------------
  // Add / Edit modal
  // ---------------------------------------------------------------
  let rowSeq = 0;
  function variantRowHTML(v) {
    rowSeq++;
    const rid = `vr_${rowSeq}`;
    const isExisting = !!v.id;
    const stock = isExisting ? DB.Stock.getLevel(v.id) : null;
    return `
      <div class="variant-row" data-row-id="${rid}" data-variant-id="${v.id || ""}">
        <input class="v-name" placeholder="e.g. Red / L or Default" value="${U.escapeHtml(v.name || "")}">
        <input class="v-cost" type="number" min="0" step="0.01" placeholder="Cost" value="${v.costPrice ?? ""}">
        <input class="v-sell" type="number" min="0" step="0.01" placeholder="Sell price" value="${v.sellingPrice ?? ""}">
        ${isExisting
          ? `<input type="text" value="${stock} in stock" disabled title="Adjust via Inventory page">`
          : `<input class="v-stock" type="number" min="0" step="1" placeholder="Opening stock" value="${v.openingStock ?? 0}">`}
        <input class="v-reorder" type="number" min="0" step="1" placeholder="Reorder" value="${v.reorderLevel ?? 10}">
        <button type="button" class="icon-btn" data-remove-row title="Remove">✕</button>
      </div>`;
  }

  function refreshRowsUI(container, hasVariants) {
    container.querySelectorAll("[data-remove-row]").forEach((btn) => {
      btn.onclick = () => {
        const rows = container.querySelectorAll(".variant-row");
        if (rows.length <= 1) { UI.toast("warning", "At least one variant is required"); return; }
        btn.closest(".variant-row").remove();
      };
    });
  }

  function openProductModal(productId) {
    const isEdit = !!productId;
    let product = null, variants = [];
    const bodyHTML = `
      <form id="product-form">
        <div class="field-row">
          <div class="field"><label>Product Name *</label><input id="pf-name" required></div>
          <div class="field"><label>SKU *</label><input id="pf-sku" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Category</label>
            <select id="pf-category"><option value="">— None —</option>${state.categories.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Brand</label><input id="pf-brand" placeholder="Unique Traders"></div>
          <div class="field"><label>Unit</label><input id="pf-unit" placeholder="pcs, kg, box…" value="pcs"></div>
        </div>
        <div class="field"><label>Description</label><textarea id="pf-desc" rows="2"></textarea></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:12px 0 14px;">
          <input type="checkbox" id="pf-has-variants"> This product has multiple variants (size, color, etc.)
        </label>

        <div class="section-title">Variants</div>
        <div id="variant-rows"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="add-variant-row" style="margin-top:10px">+ Add Variant Row</button>
      </form>`;

    const footerHTML = `
      <button class="btn btn-ghost" data-close-modal>Cancel</button>
      <button class="btn btn-primary" id="save-product-btn">${isEdit ? "Save Changes" : "Create Product"}</button>`;

    const modalEl = UI.openModal({ title: isEdit ? "Edit Product" : "New Product", bodyHTML, footerHTML, size: "lg" });
    const rowsContainer = modalEl.querySelector("#variant-rows");
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);

    async function loadExisting() {
      if (!isEdit) {
        rowsContainer.innerHTML = variantRowHTML({});
        refreshRowsUI(rowsContainer);
        return;
      }
      const full = await DB.Products.getWithVariants(productId);
      product = full; variants = full.variants.filter((v) => v.active);
      modalEl.querySelector("#pf-name").value = product.name;
      modalEl.querySelector("#pf-sku").value = product.sku;
      modalEl.querySelector("#pf-category").value = product.categoryId || "";
      modalEl.querySelector("#pf-brand").value = product.brand || "";
      modalEl.querySelector("#pf-unit").value = product.unit || "pcs";
      modalEl.querySelector("#pf-desc").value = product.description || "";
      modalEl.querySelector("#pf-has-variants").checked = product.hasVariants;
      rowsContainer.innerHTML = (variants.length ? variants : [{}]).map(variantRowHTML).join("");
      refreshRowsUI(rowsContainer);
    }
    loadExisting();

    modalEl.querySelector("#add-variant-row").addEventListener("click", () => {
      rowsContainer.insertAdjacentHTML("beforeend", variantRowHTML({}));
      refreshRowsUI(rowsContainer);
    });

    modalEl.querySelector("#save-product-btn").addEventListener("click", async () => {
      const name = modalEl.querySelector("#pf-name").value.trim();
      const sku = modalEl.querySelector("#pf-sku").value.trim();
      if (!name || !sku) { UI.toast("error", "Missing fields", "Name and SKU are required"); return; }

      const hasVariants = modalEl.querySelector("#pf-has-variants").checked;
      const rows = [...rowsContainer.querySelectorAll(".variant-row")];
      const variantsData = rows.map((row) => ({
        id: row.dataset.variantId || undefined,
        name: row.querySelector(".v-name").value.trim() || "Default",
        costPrice: Number(row.querySelector(".v-cost").value) || 0,
        sellingPrice: Number(row.querySelector(".v-sell").value) || 0,
        reorderLevel: Number(row.querySelector(".v-reorder").value) || 0,
        openingStock: row.querySelector(".v-stock") ? Number(row.querySelector(".v-stock").value) || 0 : undefined,
      }));

      const productData = {
        name, sku,
        categoryId: modalEl.querySelector("#pf-category").value || null,
        brand: modalEl.querySelector("#pf-brand").value.trim(),
        unit: modalEl.querySelector("#pf-unit").value.trim() || "pcs",
        description: modalEl.querySelector("#pf-desc").value.trim(),
        hasVariants,
      };

      try {
        if (isEdit) await DB.Products.update(productId, productData, variantsData);
        else await DB.Products.create(productData, variantsData);
        UI.toast("success", isEdit ? "Product updated" : "Product created", name);
        UI.closeModal();
        renderTable();
      } catch (err) {
        UI.toast("error", "Could not save product", err.message);
      }
    });
  }

  Router.register("products", { title: "Products", permission: "products", render });
})(window);
