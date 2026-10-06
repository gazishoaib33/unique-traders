/* =====================================================================
   charts.js — thin Chart.js wrapper. Degrades gracefully if the CDN
   script failed to load (e.g. offline), so the rest of the app still
   works without charts.
   ===================================================================== */
(function (global) {
  "use strict";
  const instances = {};

  function available() { return typeof Chart !== "undefined"; }

  function themeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      text: styles.getPropertyValue("--text-muted").trim() || "#667085",
      grid: styles.getPropertyValue("--border").trim() || "#e2e6f0",
      brand: styles.getPropertyValue("--brand").trim() || "#8c5e33",
      success: styles.getPropertyValue("--success").trim() || "#16a34a",
    };
  }

  function destroy(canvasId) {
    if (instances[canvasId]) { instances[canvasId].destroy(); delete instances[canvasId]; }
  }

  function lineChart(canvasId, labels, data, opts = {}) {
    if (!available()) return;
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const c = themeColors();
    instances[canvasId] = new Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: opts.label || "Revenue", data, borderColor: c.brand, backgroundColor: c.brand + "1f", fill: true, tension: 0.3, pointRadius: 2.5, pointBackgroundColor: c.brand, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: c.text, font: { size: 11 }, callback: (v) => (opts.moneyAxis ? Utils.formatMoney(v) : v) }, grid: { color: c.grid } },
        },
      },
    });
  }

  function barChart(canvasId, labels, data, opts = {}) {
    if (!available()) return;
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const c = themeColors();
    instances[canvasId] = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: opts.label || "", data, backgroundColor: c.brand, borderRadius: 6, maxBarThickness: 30 }] },
      options: {
        indexAxis: opts.horizontal ? "y" : "x",
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: !opts.horizontal ? false : true, color: c.grid } },
          y: { ticks: { color: c.text, font: { size: 11 } }, grid: { display: opts.horizontal ? false : true, color: c.grid } },
        },
      },
    });
  }

  function doughnutChart(canvasId, labels, data, opts = {}) {
    if (!available()) return;
    destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const palette = ["#8c5e33", "#2f7d4f", "#b8925a", "#3d6a87", "#a8671a", "#6b6257", "#b42318"];
    instances[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: palette, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: { legend: { position: "right", labels: { color: themeColors().text, boxWidth: 10, font: { size: 11 } } } },
      },
    });
  }

  /**
   * Dependency-free bar chart (plain HTML/CSS) used when Chart.js could not
   * load — e.g. the shop computer is offline — so the dashboard still shows
   * the sales trend.
   */
  function simpleBars(container, labels, data, opts = {}) {
    if (!container) return;
    const max = Math.max(...data, 0);
    if (!max) { container.innerHTML = `<div class="chart-fallback">${opts.emptyText || "No sales in this period yet."}</div>`; return; }
    const step = Math.max(1, Math.ceil(labels.length / 7));
    container.innerHTML = `
      <div class="simple-bars" role="img" aria-label="${opts.ariaLabel || "Bar chart"}">
        ${data.map((v, i) => `
          <div class="sb-col" title="${labels[i]}: ${opts.money ? Utils.formatMoney(v) : v}">
            <div class="sb-bar" style="height:${Math.max(v > 0 ? 2 : 0, Math.round((v / max) * 100))}%"></div>
            <div class="sb-label">${i % step === 0 || i === data.length - 1 ? labels[i] : ""}</div>
          </div>`).join("")}
      </div>`;
  }

  global.Charts = { available, lineChart, barChart, doughnutChart, destroy, simpleBars };
})(window);
