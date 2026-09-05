/* =====================================================================
   pages/dashboard.js
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  function statCard({ icon, label, value, kind }) {
    return `
      <div class="card stat-card">
        <div class="stat-top">
          <span class="stat-label">${label}</span>
          <span class="stat-icon" style="background:var(--${kind}-soft,var(--brand-soft));color:var(--${kind},var(--brand))">${icon}</span>
        </div>
        <div class="stat-value">${value}</div>
      </div>`;
  }

  async function render(root) {
    const user = Auth.currentUser();
    const isAdmin = Auth.isAdmin();
    const s = await DB.Dashboard.summary();

    root.innerHTML = `
      <div class="toolbar">
        <div>
          <h3 style="font-size:15px;margin:0">Welcome back, ${U.escapeHtml(user.name.split(" ")[0])} 👋</h3>
          <span class="muted" style="font-size:12.5px">Here's what's happening at Unique Traders today.</span>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="dash-new-sale">+ New Sale</button>
      </div>

      <div class="grid grid-4" id="kpi-grid"></div>

      <div class="grid grid-2" style="margin-top:18px; align-items:start;">
        <div class="card">
          <div class="card-header"><h3>Revenue — Last 14 Days</h3></div>
          <div class="card-pad"><div class="chart-box"><canvas id="chart-trend"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Top Products (30 days)</h3></div>
          <div class="card-pad"><div class="chart-box"><canvas id="chart-top"></canvas></div></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:18px; align-items:start;">
        <div class="card">
          <div class="card-header">
            <h3>Recent Sales</h3>
            <a href="#sales" class="card-header-sub">View all →</a>
          </div>
          <div class="table-wrap"><table class="data-table" id="recent-sales-table">
            <thead><tr><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody></tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3>Low Stock Alerts</h3>
            <a href="#inventory" class="card-header-sub">View all →</a>
          </div>
          <div class="table-wrap"><table class="data-table" id="low-stock-table">
            <thead><tr><th>Product</th><th>Variant</th><th class="text-right">Stock</th></tr></thead>
            <tbody></tbody>
          </table></div>
        </div>
      </div>
    `;

    document.getElementById("dash-new-sale").addEventListener("click", () => Router.go("sales"));

    // ---- KPI cards ----
    const cards = [
      statCard({ icon: "💰", label: "Revenue Today", value: U.formatMoney(s.revenueToday), kind: "success" }),
      statCard({ icon: "📅", label: "Revenue This Month", value: U.formatMoney(s.revenueMonth), kind: "info" }),
      statCard({ icon: "🧾", label: "Orders Today", value: U.formatNumber(s.ordersToday), kind: "brand" }),
      statCard({ icon: "⚠️", label: "Customer Dues", value: U.formatMoney(s.totalDue), kind: "danger" }),
    ];
    if (isAdmin) {
      cards.push(statCard({ icon: "📦", label: "Low Stock Items", value: U.formatNumber(s.lowStockCount), kind: "warning" }));
      cards.push(statCard({ icon: "🏬", label: "Stock Value (cost)", value: U.formatMoney(s.stockValue), kind: "info" }));
      cards.push(statCard({ icon: "👥", label: "Total Customers", value: U.formatNumber(s.totalCustomers), kind: "brand" }));
      cards.push(statCard({ icon: "🛒", label: "Orders This Month", value: U.formatNumber(s.ordersMonth), kind: "success" }));
    } else {
      cards.push(statCard({ icon: "📦", label: "Low Stock Items", value: U.formatNumber(s.lowStockCount), kind: "warning" }));
      cards.push(statCard({ icon: "👥", label: "Total Customers", value: U.formatNumber(s.totalCustomers), kind: "brand" }));
    }
    document.getElementById("kpi-grid").innerHTML = cards.join("");

    // ---- Charts ----
    Charts.lineChart("chart-trend", s.trend.map((t) => t.label), s.trend.map((t) => t.value), { moneyAxis: true });
    if (s.topProducts.length) {
      Charts.barChart("chart-top", s.topProducts.map((p) => p.name), s.topProducts.map((p) => p.total), { horizontal: true });
    } else {
      document.getElementById("chart-top").parentElement.innerHTML = `<p class="muted" style="text-align:center;padding:40px 0">No sales yet in the last 30 days.</p>`;
    }

    // ---- Recent sales table ----
    const customers = await DB.Customers.list();
    const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
    const tbody = document.querySelector("#recent-sales-table tbody");
    tbody.innerHTML = s.recentSales.length ? s.recentSales.map((sale) => `
      <tr>
        <td class="mono">${sale.invoiceNo}</td>
        <td>${sale.customerId ? U.escapeHtml(custMap[sale.customerId] || "—") : "Walk-in"}</td>
        <td class="text-right mono">${U.formatMoney(sale.grandTotal)}</td>
        <td>${UI.statusBadge(Sales_status(sale))}</td>
      </tr>`).join("") : UI.emptyRow(4, "No sales yet");

    function Sales_status(sale) {
      const due = Math.round((sale.grandTotal - sale.paid) * 100) / 100;
      if (due <= 0.009) return "paid";
      if (sale.paid > 0) return "partial";
      return "due";
    }

    // ---- Low stock table ----
    const lowBody = document.querySelector("#low-stock-table tbody");
    lowBody.innerHTML = s.lowStock.length ? s.lowStock.map((row) => `
      <tr>
        <td>${U.escapeHtml(row.product ? row.product.name : "—")}</td>
        <td>${U.escapeHtml(row.variant.name)}</td>
        <td class="text-right">${UI.badge(row.level + " left", row.level <= 0 ? "danger" : "warning")}</td>
      </tr>`).join("") : UI.emptyRow(3, "Stock levels look healthy");
  }

  Router.register("dashboard", { title: "Dashboard", permission: "dashboard", render });
})(window);
