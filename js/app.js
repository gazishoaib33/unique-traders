/* =====================================================================
   app.js — bootstraps the whole application.
   ===================================================================== */
(function () {
  "use strict";

  const THEME_KEY = "uti::theme";

  // Last-resort visible error banner — if something throws during startup
  // (e.g. localStorage is blocked by the browser), show it on the page
  // instead of failing silently with an unresponsive Sign In button.
  function showFatalError(message) {
    let banner = document.getElementById("fatal-error-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "fatal-error-banner";
      banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;padding:12px 20px;font:600 13px/1.4 -apple-system,Segoe UI,sans-serif;text-align:center;";
      document.body.prepend(banner);
    }
    banner.textContent = "⚠ " + message;
  }
  window.addEventListener("error", (e) => showFatalError("A script failed to run: " + (e.message || e.error) + ". Try reloading the page, or open this file through a local server instead of double-clicking it."));
  window.addEventListener("unhandledrejection", (e) => showFatalError("Something went wrong: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));

  function applyTheme(theme) {
    if (theme === "dark") { document.documentElement.setAttribute("data-theme", "dark"); document.getElementById("theme-toggle").textContent = "☀️"; }
    else { document.documentElement.setAttribute("data-theme", "light"); document.getElementById("theme-toggle").textContent = "🌙"; }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || "light";
    applyTheme(saved);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
      Router.resolve(); // re-render current page so charts pick up new theme colors
    });
  }

  function initSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    document.getElementById("menu-toggle").addEventListener("click", () => { sidebar.classList.add("open"); backdrop.classList.add("show"); });
    document.getElementById("sidebar-close").addEventListener("click", () => { sidebar.classList.remove("open"); backdrop.classList.remove("show"); });
    backdrop.addEventListener("click", () => { sidebar.classList.remove("open"); backdrop.classList.remove("show"); });
  }

  function showApp(user) {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("app-shell").hidden = false;
    document.getElementById("user-name").textContent = user.name;
    document.getElementById("user-role").textContent = user.role === "viewer" ? "Read-only" : user.role;
    document.getElementById("user-avatar").textContent = Utils.initials(user.name);
    document.getElementById("logout-btn").textContent = user.role === "viewer" ? "Exit" : "Log Out";
    document.body.classList.toggle("is-viewer", user.role === "viewer");
    // Land on the role's home page if there's no page in the URL, or if the
    // URL points at a page this role can't open (e.g. a viewer at #sales).
    const hash = location.hash.replace("#", "");
    if (!hash || !Router.canOpen(hash)) location.hash = Auth.homeRoute();
    Router.start();
  }

  function showLogin() {
    document.getElementById("app-shell").hidden = true;
    document.getElementById("login-screen").hidden = false;
    document.title = "Unique Traders | Inventory Management";
  }

  function initLogout() {
    document.getElementById("logout-btn").addEventListener("click", () => {
      Auth.logout();
      document.body.classList.remove("is-viewer");
      location.hash = "";
      Pages.Login.refresh();
      showLogin();
    });
  }

  // Keep table cells labelled for the stacked phone layout as pages and
  // modals re-render (see UI.labelTables and the "Phone layout" CSS).
  function watchTables() {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; UI.labelTables(document); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  async function boot() {
    watchTables();
    // Wire up the login form FIRST and independently of DB/localStorage
    // initialization, so the Sign In button always does *something* (even
    // if it's showing a clear error) rather than silently no-op'ing.
    showLogin();
    Pages.Login.init((user) => showApp(user));
    initTheme();
    initSidebarToggle();
    initLogout();

    try {
      await DB.init();
    } catch (err) {
      console.error("DB.init failed", err);
      showFatalError("Could not initialize local storage (" + err.message + "). If you opened this file directly, try running it via a local server instead (see README.md).");
      return;
    }

    Pages.Login.refresh();
    const existing = Auth.currentUser();
    if (existing) showApp(existing);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
