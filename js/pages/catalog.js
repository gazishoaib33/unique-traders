/* =====================================================================
   pages/catalog.js — read-only product catalog (showroom view).

   The only page the Viewer role can open, and also available to Admin and
   Staff. Shows each product with its size, variants (e.g. Left/Right),
   selling price and availability. Never shows cost price; exact stock
   quantities are shown only to roles with "stock.quantities".
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  const PAGE_SIZE = 48;
  let state = { search: "", categoryId: "", inStockOnly: false, limit: PAGE_SIZE };

  function availability(level, reorderLevel, showQty) {
    if (level <= 0) return UI.badge("Out of stock", "danger");
    if (level <= (reorderLevel || 0)) return UI.badge(showQty ? `${level} left` : "Few left", "warning");
    return UI.badge(showQty ? `${level} in stock` : "In stock", "success");
  }

  async function render(root) {
    const categories = await DB.Categories.list();
    root.innerHTML = `
      <div class="toolbar catalog-toolbar">
        <div class="search-input"><input id="cat-search" type="search" placeholder="Search name, size (7x3.5), Left/Right, SKU…" value="${U.escapeHtml(state.search)}" autocomplete="off"></div>
        <select id="cat-category">
          <option value="">All Categories</option>
          ${categories.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}
        </select>
        <label class="check-label"><input type="checkbox" id="cat-instock" ${state.inStockOnly ? "checked" : ""}> In stock only</label>
      </div>
      <p class="muted" id="cat-count" style="font-size:12.5px;margin:-6px 0 12px"></p>
      <div class="catalog-grid" id="cat-grid"></div>
      <div style="text-align:center;margin-top:16px"><button class="btn btn-secondary" id="cat-more" hidden>Show more</button></div>
    `;
    document.getElementById("cat-category").value = state.categoryId;
    document.getElementById("cat-search").addEventListener("input", U.debounce((e) => { state.search = e.target.value; state.limit = PAGE_SIZE; renderGrid(); }, 200));
    document.getElementById("cat-category").addEventListener("change", (e) => { state.categoryId = e.target.value; state.limit = PAGE_SIZE; renderGrid(); });
    document.getElementById("cat-instock").addEventListener("change", (e) => { state.inStockOnly = e.target.checked; state.limit = PAGE_SIZE; renderGrid(); });
    document.getElementById("cat-more").addEventListener("click", () => { state.limit += PAGE_SIZE; renderGrid(); });
    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById("cat-grid");
    if (!grid) return;
    const showQty = Auth.can("stock.quantities");

    // Group sellable variants by product, applying the filters per variant.
    let rows = DB.Products.sellableVariants();
    if (state.categoryId) rows = rows.filter((r) => r.product.categoryId === state.categoryId);
    if (state.search.trim()) rows = rows.filter((r) => U.matchesSearch(r.searchText, state.search));
    if (state.inStockOnly) rows = rows.filter((r) => r.stock > 0);
    const groups = [];
    const byId = {};
    rows.forEach((r) => {
      if (!byId[r.product.id]) { byId[r.product.id] = { product: r.product, categoryName: r.categoryName, variants: [] }; groups.push(byId[r.product.id]); }
      byId[r.product.id].variants.push(r);
    });

    document.getElementById("cat-count").textContent = `${groups.length} product${groups.length === 1 ? "" : "s"}`;
    const more = document.getElementById("cat-more");
    more.hidden = groups.length <= state.limit;
    more.textContent = `Show more (${groups.length - state.limit} left)`;

    if (!groups.length) { grid.innerHTML = `<div class="card card-pad muted" style="grid-column:1/-1;text-align:center">No products match your search.</div>`; return; }

    grid.innerHTML = groups.slice(0, state.limit).map((g) => {
      const p = g.product;
      return `
        <article class="card catalog-card">
          <div class="catalog-img">${p.imageUrl
            ? `<img src="${U.escapeHtml(p.imageUrl)}" alt="${U.escapeHtml(p.name)}" loading="lazy">`
            : Icons.svg("door", 44)}</div>
          <div class="catalog-body">
            <h3>${U.escapeHtml(p.name)}</h3>
            ${p.description ? `<p class="catalog-size">${U.escapeHtml(p.description)}</p>` : ""}
            <p class="muted catalog-meta">${U.escapeHtml([g.categoryName, p.brand].filter(Boolean).join(" · "))}</p>
            <ul class="catalog-variants">
              ${g.variants.map((r) => `
                <li>
                  <div><strong>${U.escapeHtml(r.variant.name)}</strong><div class="muted mono" style="font-size:11px">${U.escapeHtml(r.variant.sku)}</div></div>
                  <div style="text-align:right"><div class="mono catalog-price">${U.formatMoney(r.variant.sellingPrice)}</div>${availability(r.stock, r.variant.reorderLevel, showQty)}</div>
                </li>`).join("")}
            </ul>
          </div>
        </article>`;
    }).join("");
  }

  Router.register("catalog", { title: "Product Catalog", permission: "catalog", render });
})(window);
