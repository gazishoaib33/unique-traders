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
    admin: ["dashboard", "products", "inventory", "sales", "customers", "payments", "reports", "reports.profit", "settings", "users", "products.edit", "inventory.adjust", "sales.cancel"],
    staff: ["dashboard", "products", "inventory", "sales", "customers", "payments", "reports"],
  };

  function login(username, password) {
    const user = DB.Users.findByUsername(username);
    if (!user || user.password !== password) return { ok: false, message: "Invalid username or password" };
    if (!user.active) return { ok: false, message: "This account has been deactivated" };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id, at: Date.now() }));
    return { ok: true, user };
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function currentUserSync() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const { userId } = JSON.parse(raw);
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

  global.Auth = { login, logout, currentUser: currentUserSync, can, isAdmin };
})(window);
