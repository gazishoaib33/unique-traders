/* =====================================================================
   router.js — tiny hash router + sidebar nav rendering + role guards.
   ===================================================================== */
(function (global) {
  "use strict";

  const ROUTES = [
    { hash: "dashboard", label: "Dashboard", icon: "📊", perm: "dashboard", section: "Overview" },
    { hash: "catalog", label: "Catalog", icon: "🚪", perm: "catalog", section: "Overview" },
    { hash: "products", label: "Products", icon: "📦", perm: "products", section: "Catalog" },
    { hash: "inventory", label: "Inventory", icon: "🏷️", perm: "inventory", section: "Catalog" },
    { hash: "sales", label: "Sales", icon: "🧾", perm: "sales", section: "Transactions" },
    { hash: "customers", label: "Customers", icon: "👥", perm: "customers", section: "Transactions" },
    { hash: "payments", label: "Payments", icon: "💳", perm: "payments", section: "Transactions" },
    { hash: "reports", label: "Reports", icon: "📈", perm: "reports", section: "Insights" },
    { hash: "settings", label: "Settings", icon: "⚙️", perm: "settings", section: "System" },
  ];

  function renderNav() {
    const nav = document.getElementById("nav-list");
    const current = location.hash.replace("#", "") || Auth.homeRoute();
    let html = "";
    let lastSection = null;
    ROUTES.forEach((r) => {
      if (!Auth.can(r.perm)) return;
      if (r.section !== lastSection) { html += `<div class="nav-section-label">${r.section}</div>`; lastSection = r.section; }
      html += `<button class="nav-item ${current === r.hash ? "active" : ""}" data-route="${r.hash}"><span class="nav-icon">${r.icon}</span><span>${r.label}</span></button>`;
    });
    nav.innerHTML = html;
    nav.querySelectorAll("[data-route]").forEach((btn) => {
      btn.addEventListener("click", () => { location.hash = btn.dataset.route; closeMobileSidebar(); });
    });
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-backdrop").classList.remove("show");
  }

  const PAGES = {}; // populated by page modules: PAGES.dashboard = { render, permission, title }

  function register(hash, def) { PAGES[hash] = def; }

  function resolve() {
    const hash = location.hash.replace("#", "") || Auth.homeRoute();
    const page = PAGES[hash];
    const container = document.getElementById("page-content");

    renderNav();

    if (!page) {
      container.innerHTML = `<div class="access-denied"><div class="big-icon">🔎</div><h3>Page not found</h3></div>`;
      return;
    }
    if (page.permission && !Auth.can(page.permission)) {
      UI.setPageTitle("Access Restricted");
      container.innerHTML = `<div class="access-denied"><div class="big-icon">🔒</div><h3>Access Restricted</h3><p>Your role does not have permission to view this page.</p></div>`;
      return;
    }
    UI.setPageTitle(page.title);
    container.innerHTML = `<div id="page-inner"></div>`;
    Promise.resolve(page.render(document.getElementById("page-inner"))).catch((err) => {
      console.error(err);
      UI.toast("error", "Something went wrong", err.message || String(err));
    });
  }

  let started = false;
  function start() {
    if (!started) { window.addEventListener("hashchange", resolve); started = true; }
    resolve();
  }

  function go(hash) { location.hash = hash; }

  function canOpen(hash) {
    const page = PAGES[hash];
    return !!page && (!page.permission || Auth.can(page.permission));
  }

  global.Router = { register, start, resolve, go, renderNav, canOpen };
})(window);
