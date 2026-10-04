/* =====================================================================
   auth.js — mock local authentication (no backend). Session lives in
   sessionStorage so each browser tab/window logs in independently and
   is cleared when the tab closes. Swap this for real Supabase Auth
   later; the rest of the app only calls Auth.currentUser()/can().
   ===================================================================== */
(function (global) {
  "use strict";
  const SESSION_KEY = "uti::session";

  const PERMISSIONS = {
    admin: ["dashboard", "catalog", "products", "inventory", "sales", "customers", "payments", "reports", "reports.profit", "settings", "users", "products.edit", "inventory.adjust", "sales.cancel", "stock.quantities"],
    staff: ["dashboard", "catalog", "products", "inventory", "sales", "customers", "payments", "reports", "stock.quantities"],
    // Read-only showroom/customer view: the product catalog with prices and
    // in-stock status only — no costs, quantities, customers or editing.
    viewer: ["catalog"],
  };

  // Viewer mode needs no password (it can only read the public catalog).
  const GUEST_VIEWER = { id: "guest_viewer", name: "Viewer", username: "viewer", role: "viewer", active: true };

  function login(username, password) {
    const user = DB.Users.findByUsername(username);
    if (!user || user.password !== password) return { ok: false, message: "Invalid username or password" };
    if (!user.active) return { ok: false, message: "This account has been deactivated" };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, at: Date.now() }));
    return { ok: true, user };
  }

  /** Admins can switch password-free Viewer mode off in Settings (on by default). */
  function viewerModeEnabled() {
    return Store.getCollection("settings", {}).viewerModeEnabled !== false;
  }

  function loginViewer() {
    if (!viewerModeEnabled()) return { ok: false, message: "Viewer mode is turned off" };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: GUEST_VIEWER.id, at: Date.now() }));
    return { ok: true, user: GUEST_VIEWER };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function currentUserSync() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const { userId } = JSON.parse(raw);
      if (userId === GUEST_VIEWER.id) return viewerModeEnabled() ? GUEST_VIEWER : null;
      const users = Store.getCollection("users", []);
      const user = users.find((u) => u.id === userId);
      return user && user.active ? user : null;
    } catch (e) { return null; }
  }

  function can(permission) {
    const user = currentUserSync();
    if (!user) return false;
    const perms = PERMISSIONS[user.role] || [];
    return perms.includes(permission);
  }

  function isAdmin() {
    const user = currentUserSync();
    return !!user && user.role === "admin";
  }

  /** Where a user lands after login (the first page their role may open). */
  function homeRoute() {
    const user = currentUserSync();
    return user && user.role === "viewer" ? "catalog" : "dashboard";
  }

  global.Auth = { login, loginViewer, logout, currentUser: currentUserSync, can, isAdmin, homeRoute, viewerModeEnabled };
})(window);
