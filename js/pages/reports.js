/* =====================================================================
   pages/reports.js — Sales, Profit (admin), Stock Valuation (admin),
   Customer Dues reports with date filters and CSV export.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let activeTab = "sales";
  let range = { from: U.daysAgoISO(30).slice(0, 10), to: U.todayISO() };

  async function render(root) {
    const isAdmin = Auth.can("reports.profit");
    root.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${activeTab === "sales" ? "active" : ""}" data-tab="sales">Sales Report</button>
        ${isAdmin ? `<button class="tab-btn ${activeTab === "profit" ? "active" : ""}" data-tab="profit">Profit Report</button>` : ""}
        ${isAdmin ? `<button class="tab-btn ${activeTab === "stock" ? "active" : ""}" data-tab="stock">Stock Valuation</button>` : ""}
        <button class="tab-btn ${activeTab === "dues" ? "active" : ""}" data-tab="dues">Customer Dues</button>
      </div>
      <div id="report-body"></div>
    `;
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; render(root); }));
    const body = document.getElementById("report-body");
    if (activeTab === "sales") await renderSales(body);
    else if (activeTab === "profit" && isAdmin) await renderProfit(body);
    else if (activeTab === "stock" && isAdmin) await renderStock(body);
    else await renderDues(body);
  }

  function dateFilterBar() {
    return `
      <div class="filter-bar card card-pad">
        <div class="field"><label>From</label><input type="date" id="rp-from" value="${range.from}"></div>
        <div class="field"><label>To</label><input type="date" id="rp-to" value="${range.to}"></div>
        <button class="btn btn-secondary" id="rp-apply">Apply</button>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="rp-export">⬇ Export CSV</button>
      </div>`;
  }

  function wireFilterBar(onApply, onExport) {
    document.getElementById("rp-apply").addEventListener("click", () => {
      range = { from: document.getElementById("rp-from").value, to: document.getElementById("rp-to").value };
      onApply();
    });
    document.getElementById("rp-export").addEventListener("click", onExport);
  }

  async function renderSales(root) {
    const data = await DB.Reports.salesReport(range);
    root.innerHTML = dateFilterBar() + `
      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="card stat-card"><span class="stat-label">Orders</span><div class="stat-value">${U.formatNumber(data.totals.orders)}</div></div>
        <div class="card stat-card"><span class="stat-label">Revenue</span><div class="stat-value">${U.formatMoney(data.totals.revenue)}</div></div>
        <div class="card stat-card"><span class="stat-label">Discounts Given</span><div class="stat-value">${U.formatMoney(data.totals.discount)}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Daily Breakdown</h3></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th class="text-right">Orders</th><th class="text-right">Discount</th><th class="text-right">Revenue</th></tr></thead>
          <tbody>${data.rows.length ? data.rows.map((r) => `<tr><td>${U.formatDate(r.date)}</td><td class="text-right">${r.orders}</td><td class="text-right mono">${U.formatMoney(r.discount)}</td><td class="text-right mono">${U.formatMoney(r.revenue)}</td></tr>`).join("") : UI.emptyRow(4, "No sales in this range")}</tbody>
        </table></div>
      </div>`;
    wireFilterBar(() => renderSales(root), () => U.downloadTextFile("sales-report.csv", U.toCSV(data.rows), "text/csv"));
  }

  async function renderProfit(root) {
    const data = await DB.Reports.profitReport(range);
    root.innerHTML = dateFilterBar() + `
      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="card stat-card"><span class="stat-label">Revenue</span><div class="stat-value">${U.formatMoney(data.totals.revenue)}</div></div>
        <div class="card stat-card"><span class="stat-label">Cost of Goods</span><div class="stat-value">${U.formatMoney(data.totals.cost)}</div></div>
        <div class="card stat-card"><span class="stat-label">Profit (${data.totals.margin.toFixed(1)}%)</span><div class="stat-value" style="color:var(--success)">${U.formatMoney(data.totals.profit)}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Profit by Product</h3></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Product</th><th class="text-right">Qty Sold</th><th class="text-right">Revenue</th><th class="text-right">Cost</th><th class="text-right">Profit</th><th class="text-right">Margin</th></tr></thead>
          <tbody>${data.rows.length ? data.rows.map((r) => `<tr><td>${U.escapeHtml(r.name)}</td><td class="text-right">${r.qty}</td><td class="text-right mono">${U.formatMoney(r.revenue)}</td><td class="text-right mono">${U.formatMoney(r.cost)}</td><td class="text-right mono">${U.formatMoney(r.profit)}</td><td class="text-right">${r.margin.toFixed(1)}%</td></tr>`).join("") : UI.emptyRow(6, "No sales in this range")}</tbody>
        </table></div>
      </div>`;
    wireFilterBar(() => renderProfit(root), () => U.downloadTextFile("profit-report.csv", U.toCSV(data.rows), "text/csv"));
  }

  async function renderStock(root) {
    const data = await DB.Reports.stockValuation();
    root.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="card stat-card"><span class="stat-label">Total Units</span><div class="stat-value">${U.formatNumber(data.totals.qty)}</div></div>
        <div class="card stat-card"><span class="stat-label">Value at Cost</span><div class="stat-value">${U.formatMoney(data.totals.value)}</div></div>
        <div class="card stat-card"><span class="stat-label">Value at Retail</span><div class="stat-value">${U.formatMoney(data.totals.retailValue)}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Stock Valuation by Variant</h3><button class="btn btn-ghost btn-sm" id="rp-export">⬇ Export CSV</button></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Product</th><th>Variant</th><th>SKU</th><th class="text-right">Qty</th><th class="text-right">Cost</th><th class="text-right">Value</th></tr></thead>
          <tbody>${data.rows.length ? data.rows.map((r) => `<tr><td>${U.escapeHtml(r.product)}</td><td>${U.escapeHtml(r.variant)}</td><td class="mono muted">${U.escapeHtml(r.sku)}</td><td class="text-right">${r.qty}</td><td class="text-right mono">${U.formatMoney(r.cost)}</td><td class="text-right mono">${U.formatMoney(r.value)}</td></tr>`).join("") : UI.emptyRow(6, "No stock recorded")}</tbody>
        </table></div>
      </div>`;
    document.getElementById("rp-export").addEventListener("click", () => U.downloadTextFile("stock-valuation.csv", U.toCSV(data.rows), "text/csv"));
  }

  async function renderDues(root) {
    const data = await DB.Reports.customerDues();
    root.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:16px;">
        <div class="card stat-card"><span class="stat-label">Customers with Dues</span><div class="stat-value">${U.formatNumber(data.rows.length)}</div></div>
        <div class="card stat-card"><span class="stat-label">Total Outstanding</span><div class="stat-value" style="color:var(--danger)">${U.formatMoney(data.totals.balance)}</div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Customer Dues</h3><button class="btn btn-ghost btn-sm" id="rp-export">⬇ Export CSV</button></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Customer</th><th>Phone</th><th>Type</th><th class="text-right">Balance</th></tr></thead>
          <tbody>${data.rows.length ? data.rows.map((r) => `<tr><td>${U.escapeHtml(r.customer.name)}</td><td>${U.escapeHtml(r.customer.phone || "—")}</td><td>${UI.badge(r.customer.type, "neutral")}</td><td class="text-right mono">${U.formatMoney(r.balance)}</td></tr>`).join("") : UI.emptyRow(4, "No outstanding balances 🎉")}</tbody>
        </table></div>
      </div>`;
    document.getElementById("rp-export").addEventListener("click", () => U.downloadTextFile("customer-dues.csv", U.toCSV(data.rows.map((r) => ({ customer: r.customer.name, phone: r.customer.phone, type: r.customer.type, balance: r.balance }))), "text/csv"));
  }

  Router.register("reports", { title: "Reports", permission: "reports", render });
})(window);
