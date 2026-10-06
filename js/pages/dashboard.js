/* =====================================================================
   pages/dashboard.js — business status at a glance.
   Every number here is calculated from the stored data (DB.Dashboard
   .summary); nothing is estimated or made up.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let period = "daily"; // daily | weekly | monthly

  function statCard({ icon, label, value, sub, tone, href, alert }) {
    const tag = href ? "a" : "div";
    return `
      <${tag} class="card stat-card ${alert ? "is-alert" : ""}" ${href ? `href="${href}"` : ""}>
        <div class="stat-top">
          <span class="stat-label">${label}</span>
          <span class="stat-icon ${tone || ""}">${Icons.svg(icon, 17)}</span>
        </div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
      </${tag}>`;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }

  async function render(root) {
    const user = Auth.currentUser();
    const isAdmin = Auth.isAdmin();
    const s = await DB.Dashboard.summary();
    const customers = await DB.Customers.list();
    const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

    root.innerHTML = `
      <div class="page-head">
        <div class="dash-greeting">
          <h1>${greeting()}, ${U.escapeHtml(user.name.split(" ")[0])}</h1>
          <p>${today} · Here's how Unique Traders is doing.</p>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${Auth.can("inventory.adjust") ? `<a class="btn btn-secondary" href="#inventory">${Icons.svg("layers", 16)} Add Stock</a>` : ""}
          <a class="btn btn-primary" href="#sales">${Icons.svg("plus", 16)} New Sale</a>
        </div>
      </div>

      <div class="dash-kpis" id="kpi-grid"></div>

      <div class="dash-row">
        <div class="card">
          <div class="card-header">
            <h3>Sales overview</h3>
            <div class="segmented" role="group" aria-label="Chart period">
              <button type="button" data-period="daily">Daily</button>
              <button type="button" data-period="weekly">Weekly</button>
              <button type="button" data-period="monthly">Monthly</button>
            </div>
          </div>
          <div class="card-pad"><div class="chart-box" id="trend-box"><canvas id="chart-trend"></canvas></div></div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Top products · 30 days</h3></div>
          <div class="card-pad"><div class="chart-box" id="top-box"><canvas id="chart-top"></canvas></div></div>
        </div>
      </div>

      <div class="dash-row">
        <div class="card">
          <div class="card-header">
            <h3>Recent sales</h3>
            <a href="#sales-history" class="card-header-sub">View all →</a>
          </div>
          <div class="table-wrap"><table class="data-table" id="recent-sales-table">
            <thead><tr><th>Memo</th><th>Customer</th><th>Date</th><th class="text-right">Amount</th><th>Status</th><th class="text-right">Actions</th></tr></thead>
            <tbody></tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3>Needs attention</h3>
            <a href="#inventory" class="card-header-sub">Stock →</a>
          </div>
          <ul class="lowstock-list" id="low-stock-list"></ul>
        </div>
      </div>
    `;

    // ---- KPI cards (only figures the data supports) ----
    const cards = [
      statCard({ icon: "coins", label: "Today's sales", value: U.formatMoney(s.revenueToday), sub: `This week ${U.formatMoney(s.revenueWeek)}`, tone: "success" }),
      statCard({ icon: "receipt", label: "Today's orders", value: U.formatNumber(s.ordersToday), sub: `${U.formatNumber(s.ordersMonth)} this month`, tone: "brand", href: "#sales-history" }),
      statCard({ icon: "trend", label: "This month", value: U.formatMoney(s.revenueMonth), sub: `${U.formatNumber(s.ordersMonth)} memo${s.ordersMonth === 1 ? "" : "s"}` }),
      statCard({ icon: "chart", label: "Total sales", value: U.formatMoney(s.revenueAllTime), sub: `${U.formatNumber(s.ordersAllTime)} memo${s.ordersAllTime === 1 ? "" : "s"}, excluding cancelled` }),
      statCard({ icon: "layers", label: "Current stock", value: `${U.formatNumber(s.stockUnits)} <span style="font-size:13px;font-weight:500;color:var(--text-muted)">units</span>`, sub: `${U.formatNumber(s.outOfStockCount)} variant${s.outOfStockCount === 1 ? "" : "s"} out of stock`, href: "#inventory" }),
      statCard({ icon: "alert", label: "Low stock", value: U.formatNumber(s.lowStockCount), sub: "At or below reorder level", tone: s.lowStockCount ? "warning" : "", href: "#inventory", alert: s.lowStockCount > 0 }),
      statCard({ icon: "wallet", label: "Customer dues", value: U.formatMoney(s.totalDue), sub: `${U.formatNumber(s.totalCustomers)} customer${s.totalCustomers === 1 ? "" : "s"}`, tone: s.totalDue > 0 ? "danger" : "", href: "#customers" }),
    ];
    if (isAdmin) cards.push(statCard({ icon: "box", label: "Stock value (cost)", value: U.formatMoney(s.stockValue), sub: "Admin only" }));
    else cards.push(statCard({ icon: "users", label: "Customers", value: U.formatNumber(s.totalCustomers) }));
    document.getElementById("kpi-grid").innerHTML = cards.join("");

    // ---- Sales overview chart ----
    const series = { daily: s.trend, weekly: s.trendWeekly, monthly: s.trendMonthly };
    function drawTrend() {
      root.querySelectorAll("[data-period]").forEach((b) => b.classList.toggle("active", b.dataset.period === period));
      const data = series[period];
      const box = document.getElementById("trend-box");
      if (Charts.available()) {
        if (!box.querySelector("canvas")) box.innerHTML = `<canvas id="chart-trend"></canvas>`;
        Charts.lineChart("chart-trend", data.map((t) => t.label), data.map((t) => t.value), { moneyAxis: true });
      } else {
        Charts.simpleBars(box, data.map((t) => t.label), data.map((t) => t.value), { money: true, ariaLabel: "Sales over time" });
      }
    }
    root.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => { period = b.dataset.period; drawTrend(); }));
    drawTrend();

    const topBox = document.getElementById("top-box");
    if (!s.topProducts.length) {
      topBox.innerHTML = `<div class="chart-fallback">No sales in the last 30 days yet.</div>`;
    } else if (Charts.available()) {
      Charts.barChart("chart-top", s.topProducts.map((p) => p.name), s.topProducts.map((p) => p.total), { horizontal: true });
    } else {
      topBox.innerHTML = `<ul class="lowstock-list">${s.topProducts.map((p) => `<li><span class="ls-name">${U.escapeHtml(p.name)}</span><span class="mono">${U.formatMoney(p.total)}</span></li>`).join("")}</ul>`;
    }

    // ---- Recent sales ----
    const tbody = document.querySelector("#recent-sales-table tbody");
    tbody.innerHTML = s.recentSales.length ? s.recentSales.map((sale) => `
      <tr>
        <td><a class="cell-title mono" style="color:var(--text)" href="#memo?id=${encodeURIComponent(sale.id)}">${U.escapeHtml(sale.invoiceNo)}</a></td>
        <td>${sale.customerId ? U.escapeHtml(custMap[sale.customerId] || "—") : U.escapeHtml(sale.customerName || "Walk-in")}</td>
        <td>${U.formatDateTime(sale.date)}</td>
        <td class="text-right mono">${U.formatMoney(sale.grandTotal)}</td>
        <td>${UI.statusBadge(DB.Sales.statusOf(sale))}</td>
        <td><div class="row-actions">
          <a class="icon-btn" href="#memo?id=${encodeURIComponent(sale.id)}" title="View memo" aria-label="View memo ${U.escapeHtml(sale.invoiceNo)}">${Icons.svg("eye", 17)}</a>
          <a class="icon-btn" href="#memo?id=${encodeURIComponent(sale.id)}&print=1" title="Print memo" aria-label="Print memo ${U.escapeHtml(sale.invoiceNo)}">${Icons.svg("printer", 17)}</a>
        </div></td>
      </tr>`).join("") : UI.emptyRow(6, "No sales yet — your first memo will appear here");

    // ---- Low stock ----
    const list = document.getElementById("low-stock-list");
    list.innerHTML = s.lowStock.length ? s.lowStock.map((row) => {
      const size = row.product ? U.parseSize(row.product.description, row.product.name) : "";
      const sub = [U.isPlainVariant(row.variant.name) ? "" : row.variant.name, size].filter(Boolean).join(" · ");
      return `<li>
        <div style="min-width:0"><div class="ls-name">${U.escapeHtml(row.product ? row.product.name : "—")}</div>${sub ? `<div class="ls-sub">${U.escapeHtml(sub)}</div>` : ""}</div>
        ${UI.badge(row.level <= 0 ? "Out of stock" : `${row.level} left`, row.level <= 0 ? "danger" : "warning")}
      </li>`;
    }).join("") + (s.lowStockCount > s.lowStock.length ? `<li><a href="#inventory" class="card-header-sub">+ ${s.lowStockCount - s.lowStock.length} more on the Stock page</a></li>` : "")
      : `<li><div class="ls-sub" style="padding:18px 0;display:flex;gap:8px;align-items:center">${Icons.svg("check", 18)} Stock levels look healthy</div></li>`;
  }

  Router.register("dashboard", { title: "Dashboard", permission: "dashboard", render });
})(window);
