/* =====================================================================
   router.js — tiny hash router + sidebar / bottom nav + role guards.

   Hashes may carry query parameters, e.g. "#memo?id=sale_123". The page
   name is the part before "?"; the parameters are passed to the page's
   render(root, params) as a URLSearchParams.
   ===================================================================== */
(function (global) {
  "use strict";

  // Sidebar navigation. `activeFor` lists extra pages that highlight the item.
  const ROUTES = [
    { hash: "dashboard", label: "Dashboard", icon: "dashboard", perm: "dashboard", section: "Overview" },
    { hash: "sales", label: "New Sale", icon: "cart", perm: "sales", section: "Sales" },
    { hash: "sales-history", label: "Sales History", icon: "receipt", perm: "sales", section: "Sales", activeFor: ["memo"] },
    { hash: "products", label: "Products", icon: "box", perm: "products", section: "Products" },
    { hash: "inventory", label: "Stock", icon: "layers", perm: "inventory", section: "Products" },
    { hash: "catalog", label: "Catalog", icon: "store", perm: "catalog", section: "Products" },
    { hash: "customers", label: "Customers", icon: "users", perm: "customers", section: "Customers & Payments" },
    { hash: "payments", label: "Payments", icon: "wallet", perm: "payments", section: "Customers & Payments" },
    { hash: "reports", label: "Reports", icon: "chart", perm: "reports", section: "Insights" },
    { hash: "settings", label: "Settings", icon: "settings", perm: "settings", section: "System" },
  ];

  // Phone bottom bar: the four most-used pages + "More" (opens the drawer).
  const BOTTOM = ["dashboard", "sales", "inventory", "sales-history"];

  function parse(hashString) {
    const raw = (hashString || "").replace(/^#/, "");
    const [name, query] = raw.split("?");
    return { name: name || Auth.homeRoute(), params: new URLSearchParams(query || "") };
  }

  function current() { return parse(location.hash); }

  function isActive(route, name) {
    return route.hash === name || (route.activeFor || []).includes(name);
  }

  function renderNav() {
    const nav = document.getElementById("nav-list");
    const { name } = current();
    let html = "";
    let lastSection = null;
    const visible = ROUTES.filter((r) => Auth.can(r.perm));
    visible.forEach((r) => {
      if (r.section !== lastSection) { html += `<div class="nav-section-label">${r.section}</div>`; lastSection = r.section; }
      const active = isActive(r, name);
      html += `<button class="nav-item ${active ? "active" : ""}" data-route="${r.hash}" title="${r.label}" ${active ? 'aria-current="page"' : ""}><span class="nav-icon">${Icons.svg(r.icon)}</span><span class="nav-label">${r.label}</span></button>`;
    });
    nav.innerHTML = html;
    nav.querySelectorAll("[data-route]").forEach((btn) => {
      btn.addEventListener("click", () => { location.hash = btn.dataset.route; closeMobileSidebar(); });
    });
    renderBottomNav(visible, name);
  }

  function renderBottomNav(visible, name) {
    const bar = document.getElementById("bottom-nav");
    if (!bar) return;
    const items = BOTTOM.map((h) => visible.find((r) => r.hash === h)).filter(Boolean);
    // Not worth a bottom bar for roles with a single page (e.g. Viewer).
    if (visible.length < 2 || !items.length) { bar.hidden = true; document.body.classList.remove("has-bottom-nav"); return; }
    bar.hidden = false;
    document.body.classList.add("has-bottom-nav");
    bar.innerHTML = items.map((r) => `
      <button class="bottom-nav-item ${isActive(r, name) ? "active" : ""}" data-route="${r.hash}">${Icons.svg(r.icon, 20)}<span>${r.label}</span></button>`).join("")
      + `<button class="bottom-nav-item" data-more>${Icons.svg("menu", 20)}<span>More</span></button>`;
    bar.querySelectorAll("[data-route]").forEach((b) => b.addEventListener("click", () => { location.hash = b.dataset.route; }));
    bar.querySelector("[data-more]").addEventListener("click", openMobileSidebar);
  }

  function openMobileSidebar() {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-backdrop").classList.add("show");
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-backdrop").classList.remove("show");
  }

  const PAGES = {}; // populated by page modules: PAGES.dashboard = { render, permission, title }

  function register(hash, def) { PAGES[hash] = def; }

  function emptyState(icon, title, text) {
    return `<div class="access-denied"><div class="big-icon">${Icons.svg(icon, 40)}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ""}</div>`;
  }

  function resolve() {
    const { name, params } = current();
    const page = PAGES[name];
    const container = document.getElementById("page-content");

    renderNav();
    window.scrollTo(0, 0);

    if (!page) {
      UI.setPageTitle("Page not found");
      container.innerHTML = emptyState("search", "Page not found", "");
      return;
    }
    if (page.permission && !Auth.can(page.permission)) {
      UI.setPageTitle("Access Restricted");
      container.innerHTML = emptyState("lock", "Access Restricted", "Your role does not have permission to view this page.");
      return;
    }
    UI.setPageTitle(page.title);
    container.innerHTML = `<div id="page-inner" class="page-enter"></div>`;
    Promise.resolve(page.render(document.getElementById("page-inner"), params)).catch((err) => {
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
    const page = PAGES[parse(hash).name];
    return !!page && (!page.permission || Auth.can(page.permission));
  }

  global.Router = { register, start, resolve, go, renderNav, canOpen, current, openMobileSidebar, closeMobileSidebar };
})(window);
