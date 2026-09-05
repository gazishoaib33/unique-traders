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
      brand: styles.getPropertyValue("--brand").trim() || "#2563eb",
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
      data: { labels, datasets: [{ label: opts.label || "Revenue", data, borderColor: c.brand, backgroundColor: c.brand + "22", fill: true, tension: 0.35, pointRadius: 2 }] },
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
      data: { labels, datasets: [{ label: opts.label || "", data, backgroundColor: c.brand, borderRadius: 5, maxBarThickness: 34 }] },
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
    const palette = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#0891b2", "#7c3aed", "#db2777"];
    instances[canvasId] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: palette, borderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: { legend: { position: "right", labels: { color: themeColors().text, boxWidth: 10, font: { size: 11 } } } },
      },
    });
  }

  global.Charts = { available, lineChart, barChart, doughnutChart, destroy };
})(window);
