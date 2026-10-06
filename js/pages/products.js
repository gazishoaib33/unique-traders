/* =====================================================================
   pages/products.js — product & variant catalog management.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  // Fewer rows per page on phones, where each row is a tall stacked card.
  const PAGE_SIZE = window.innerWidth <= 700 ? 30 : 100;
  let state = { search: "", categoryId: "", stock: "", sort: "name", showInactive: false, categories: [], limit: PAGE_SIZE };

  function priceRange(variants) {
    const prices = variants.map((v) => v.sellingPrice);
    if (!prices.length) return { label: "—", min: 0 };
    const min = Math.min(...prices), max = Math.max(...prices);
    return { label: min === max ? U.formatMoney(min) : `${U.formatMoney(min)} – ${U.formatMoney(max)}`, min };
  }

  /** "in" | "low" | "out" for a product, from its active variants. */
  function stockState(variants, levels) {
    if (!variants.length) return "out";
    const lv = variants.map((v) => levels[v.id] || 0);
    if (lv.every((l) => l <= 0)) return "out";
    if (variants.some((v, i) => lv[i] <= (v.reorderLevel || 0))) return "low";
    return "in";
  }

  const AVAILABILITY = { in: ["In stock", "success"], low: ["Low stock", "warning"], out: ["Out of stock", "danger"] };

  async function render(root) {
    const canEdit = Auth.can("products.edit");
    state.categories = await DB.Categories.list();

    root.innerHTML = `
      <div class="toolbar">
        <div class="search-input" style="flex:1 1 280px"><input id="p-search" type="search" placeholder="Search name, code, size (7x3.5), Left/Right…" value="${U.escapeHtml(state.search)}" style="width:100%"></div>
        <select id="p-category" aria-label="Category">
          <option value="">All categories</option>
          ${state.categories.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}
        </select>
        <select id="p-stock" aria-label="Availability">
          <option value="">Any availability</option>
          <option value="in">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <select id="p-sort" aria-label="Sort by">
          <option value="name">Name A–Z</option>
          <option value="stock-asc">Stock: low → high</option>
          <option value="stock-desc">Stock: high → low</option>
          <option value="price-asc">Price: low → high</option>
          <option value="price-desc">Price: high → low</option>
        </select>
        <label class="check-label"><input type="checkbox" id="p-inactive" ${state.showInactive ? "checked" : ""}> Show archived</label>
        ${canEdit ? `<button class="btn btn-primary" id="p-add">${Icons.svg("plus", 16)} New Product</button>` : ""}
      </div>
      <p class="muted" id="p-count" style="font-size:12.5px;margin:-4px 0 12px"></p>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>Product</th><th>Category</th><th>Size</th><th>Side / variants</th><th class="text-right">Stock</th><th class="text-right">Price</th><th>Availability</th>${canEdit ? '<th class="text-right">Actions</th>' : ""}
          </tr></thead>
          <tbody id="p-tbody"></tbody>
        </table></div>
      </div>
      <div id="p-more" style="text-align:center;margin-top:14px"></div>
    `;

    const $ = (id) => document.getElementById(id);
    $("p-category").value = state.categoryId;
    $("p-stock").value = state.stock;
    $("p-sort").value = state.sort;
    const reset = () => { state.limit = PAGE_SIZE; renderTable(); };
    $("p-search").addEventListener("input", U.debounce((e) => { state.search = e.target.value; reset(); }, 180));
    $("p-category").addEventListener("change", (e) => { state.categoryId = e.target.value; reset(); });
    $("p-stock").addEventListener("change", (e) => { state.stock = e.target.value; reset(); });
    $("p-sort").addEventListener("change", (e) => { state.sort = e.target.value; reset(); });
    $("p-inactive").addEventListener("change", (e) => { state.showInactive = e.target.checked; reset(); });
    if (canEdit) $("p-add").addEventListener("click", () => openProductModal(null));

    await renderTable();
  }

  async function renderTable() {
    const canEdit = Auth.can("products.edit");
    const tbody = document.getElementById("p-tbody");
    if (!tbody) return;
    let products = await DB.Products.list({ search: state.search, categoryId: state.categoryId });
    if (!state.showInactive) products = products.filter((p) => p.active);
    const catMap = Object.fromEntries(state.categories.map((c) => [c.id, c.name]));
    const levels = DB.Stock.levelsMap();

    // Build display rows once (stock, price, availability) so we can filter and sort on them.
    let rows = products.map((p) => {
      const activeVariants = DB.Variants.listByProduct(p.id).filter((v) => v.active);
      const totalStock = activeVariants.reduce((a, v) => a + Math.max(0, levels[v.id] || 0), 0);
      return { p, activeVariants, totalStock, price: priceRange(activeVariants), avail: stockState(activeVariants, levels), size: U.parseSize(p.description, p.name) };
    });
    if (state.stock) rows = rows.filter((r) => r.avail === state.stock);
    const sorters = {
      name: (a, b) => a.p.name.localeCompare(b.p.name),
      "stock-asc": (a, b) => a.totalStock - b.totalStock || a.p.name.localeCompare(b.p.name),
      "stock-desc": (a, b) => b.totalStock - a.totalStock || a.p.name.localeCompare(b.p.name),
      "price-asc": (a, b) => a.price.min - b.price.min,
      "price-desc": (a, b) => b.price.min - a.price.min,
    };
    rows.sort(sorters[state.sort] || sorters.name);

    document.getElementById("p-count").textContent = `${rows.length} product${rows.length === 1 ? "" : "s"}`;
    UI.showMore(document.getElementById("p-more"), rows.length, state.limit, () => { state.limit += PAGE_SIZE; renderTable(); });
    if (!rows.length) {
      tbody.innerHTML = UI.emptyRow(canEdit ? 8 : 7, state.search || state.categoryId || state.stock ? "No products match these filters" : "No products yet — add your first product with “New Product”");
      return;
    }

    tbody.innerHTML = rows.slice(0, state.limit).map(({ p, activeVariants, totalStock, price, avail, size }) => {
      const showVariants = activeVariants.length > 1 || p.hasVariants;
      const [availText, availKind] = p.active ? AVAILABILITY[avail] : ["Archived", "neutral"];
      return `
        <tr>
          <td><div class="prod-cell">
            ${p.imageUrl ? `<img class="thumb" src="${U.escapeHtml(p.imageUrl)}" alt="" loading="lazy">` : `<span class="thumb">${Icons.svg("door", 18)}</span>`}
            <div style="min-width:0">
              <div class="cell-title">${U.escapeHtml(p.name)}</div>
              <div class="cell-sub"><span class="code">${U.escapeHtml(p.sku)}</span>${p.brand ? ` · ${U.escapeHtml(p.brand)}` : ""}</div>
            </div>
          </div></td>
          <td>${U.escapeHtml(catMap[p.categoryId] || "—")}</td>
          <td>${size ? U.escapeHtml(size) : '<span class="muted">—</span>'}</td>
          <td>${showVariants
            ? `<div class="variant-lines">${activeVariants.map((v) => `<div class="variant-line"><span class="vl-name">${U.escapeHtml(v.name)}</span><span class="mono ${(levels[v.id] || 0) <= 0 ? "text-danger" : ""}">${levels[v.id] || 0}</span></div>`).join("")}</div>`
            : `<span class="muted">${U.escapeHtml(U.parseSide(p.name) || "Single")}</span>`}</td>
          <td class="text-right mono" style="font-weight:600">${U.formatNumber(totalStock)}</td>
          <td class="text-right mono">${price.label}</td>
          <td>${UI.badge(availText, availKind)}</td>
          ${canEdit ? `<td><div class="row-actions">
              <button class="icon-btn" data-edit="${p.id}" title="Edit product" aria-label="Edit ${U.escapeHtml(p.name)}">${Icons.svg("edit", 17)}</button>
              <button class="icon-btn" data-archive="${p.id}" title="${p.active ? "Archive" : "Restore"}" aria-label="${p.active ? "Archive" : "Restore"} ${U.escapeHtml(p.name)}">${Icons.svg(p.active ? "archive" : "restore", 17)}</button>
              <button class="icon-btn danger" data-delete="${p.id}" title="Delete" aria-label="Delete ${U.escapeHtml(p.name)}">${Icons.svg("trash", 17)}</button>
            </div></td>` : ""}
        </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openProductModal(b.dataset.edit)));
    tbody.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", async () => {
      const p = await DB.Products.get(b.dataset.archive);
      const doIt = async () => {
        try {
          await DB.Products.archive(p.id, !p.active);
          UI.toast("success", p.active ? "Archived" : "Restored", p.name);
          renderTable();
        } catch (err) { UI.toast("error", "Could not update product", err.message); }
      };
      if (p.active) UI.confirmDialog({ title: "Archive product?", message: `“${p.name}” will be hidden from sales and the catalog. Its history is kept and you can restore it any time.`, confirmText: "Archive", onConfirm: doIt });
      else doIt();
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
  const VARIANT_HEAD = `
      <div class="variant-row variant-head">
        <span>Variant (e.g. Left Hand)</span><span>SKU (auto if blank)</span><span>Barcode</span><span>Cost</span><span>Sell price</span><span>Opening stock</span><span>Reorder at</span><span></span>
      </div>`;
  function variantRowHTML(v) {
    rowSeq++;
    const rid = `vr_${rowSeq}`;
    const isExisting = !!v.id;
    const stock = isExisting ? DB.Stock.getLevel(v.id) : null;
    return `
      <div class="variant-row" data-row-id="${rid}" data-variant-id="${v.id || ""}">
        <input class="v-name" placeholder="Variant, e.g. Left Hand" value="${U.escapeHtml(v.name || "")}">
        <input class="v-sku" placeholder="SKU (auto)" value="${U.escapeHtml(v.sku || "")}">
        <input class="v-barcode" placeholder="Barcode" value="${U.escapeHtml(v.barcode || "")}">
        <input class="v-cost" type="number" min="0" step="0.01" placeholder="Cost" value="${v.costPrice ?? ""}">
        <input class="v-sell" type="number" min="0" step="0.01" placeholder="Sell price" value="${v.sellingPrice ?? ""}">
        ${isExisting
          ? `<input type="text" value="${stock} in stock" disabled title="Change stock on the Inventory page">`
          : `<input class="v-stock" type="number" min="0" step="1" placeholder="Opening stock" value="${v.openingStock ?? 0}">`}
        <input class="v-reorder" type="number" min="0" step="1" placeholder="Reorder at" value="${v.reorderLevel ?? 10}">
        <button type="button" class="icon-btn danger" data-remove-row title="Remove variant" aria-label="Remove variant">${Icons.svg("close", 16)}</button>
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
        <div class="field"><label>Description / Size</label><textarea id="pf-desc" rows="2" placeholder="e.g. 7x3.5 feet — searchable"></textarea></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin:12px 0 14px;">
          <input type="checkbox" id="pf-has-variants"> This product has multiple variants (e.g. Left Hand / Right Hand)
        </label>

        <div class="section-title">Variants</div>
        <p class="muted" style="font-size:12px;margin-bottom:6px">Opening stock is recorded once, when a variant is created. Later stock goes through Inventory → Stock Adjustment.</p>
        ${VARIANT_HEAD}
        <div id="variant-rows"></div>
        <div id="pf-warning" class="login-error" hidden style="margin-top:10px"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="add-variant-row" style="margin-top:10px">${Icons.svg("plus", 15)} Add Variant</button>
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

    const saveBtn = modalEl.querySelector("#save-product-btn");
    const warningEl = modalEl.querySelector("#pf-warning");
    let confirmedDuplicateName = null;
    saveBtn.addEventListener("click", async () => {
      if (saveBtn.disabled) return;
      const name = modalEl.querySelector("#pf-name").value.trim();
      const sku = modalEl.querySelector("#pf-sku").value.trim();
      if (!name || !sku) { UI.toast("error", "Missing fields", "Name and SKU are required"); return; }

      // Warn (once) before creating a product whose name matches an existing one.
      const similar = !isEdit || name !== product.name ? DB.Products.findSimilar(name, productId) : [];
      if (similar.length && confirmedDuplicateName !== name) {
        warningEl.innerHTML = `A product with this name already exists: ${similar.map((p) => `<strong>${U.escapeHtml(p.name)}</strong> (${U.escapeHtml(p.sku)}${p.active ? "" : ", archived"})`).join(", ")}. If you meant to add stock, use Inventory instead. Click <strong>${isEdit ? "Save Changes" : "Create Product"}</strong> again to save anyway.`;
        warningEl.hidden = false;
        confirmedDuplicateName = name;
        return;
      }

      const hasVariants = modalEl.querySelector("#pf-has-variants").checked;
      const rows = [...rowsContainer.querySelectorAll(".variant-row")];
      const variantsData = rows.map((row) => ({
        id: row.dataset.variantId || undefined,
        name: row.querySelector(".v-name").value.trim() || "Default",
        sku: row.querySelector(".v-sku").value.trim(),
        barcode: row.querySelector(".v-barcode").value.trim(),
        // Raw values: the data layer validates them and reports bad input
        // (e.g. negative or fractional stock) instead of silently using 0.
        costPrice: row.querySelector(".v-cost").value,
        sellingPrice: row.querySelector(".v-sell").value,
        reorderLevel: row.querySelector(".v-reorder").value,
        openingStock: row.querySelector(".v-stock") ? row.querySelector(".v-stock").value : undefined,
      }));

      const productData = {
        name, sku,
        categoryId: modalEl.querySelector("#pf-category").value || null,
        brand: modalEl.querySelector("#pf-brand").value.trim(),
        unit: modalEl.querySelector("#pf-unit").value.trim() || "pcs",
        description: modalEl.querySelector("#pf-desc").value.trim(),
        hasVariants,
        userId: Auth.currentUser().id,
      };

      saveBtn.disabled = true;
      try {
        if (isEdit) await DB.Products.update(productId, productData, variantsData);
        else await DB.Products.create(productData, variantsData);
        UI.toast("success", isEdit ? "Product updated" : "Product created", name);
        UI.closeModal();
        renderTable();
      } catch (err) {
        warningEl.textContent = err.message;
        warningEl.hidden = false;
        UI.toast("error", "Could not save product", err.message);
        saveBtn.disabled = false;
      }
    });
  }

  Router.register("products", { title: "Products", permission: "products", render });
})(window);
