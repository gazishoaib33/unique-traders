/* =====================================================================
   pages/login.js — wires up the login screen (#login-screen in index.html).
   ===================================================================== */
(function (global) {
  "use strict";

  function init(onSuccess) {
    const form = document.getElementById("login-form");
    const errorBox = document.getElementById("login-error");

    // Two parts: Admin/Staff sign-in, and a password-free read-only Viewer.
    document.querySelectorAll("[data-login-part]").forEach((btn) => {
      btn.onclick = () => {
        const part = btn.dataset.loginPart;
        document.querySelectorAll("[data-login-part]").forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-selected", String(b === btn));
        });
        document.querySelectorAll("[data-login-panel]").forEach((p) => { p.hidden = p.dataset.loginPanel !== part; });
      };
    });
    document.getElementById("viewer-enter").onclick = () => {
      const result = Auth.loginViewer();
      if (result.ok) onSuccess(result.user);
      else { refresh(); UI.toast("error", result.message); }
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const result = Auth.login(username, password);
      if (!result.ok) {
        errorBox.textContent = result.message;
        errorBox.hidden = false;
        return;
      }
      errorBox.hidden = true;
      form.reset();
      onSuccess(result.user);
    };
  }

  /** Shows or hides the Viewer tab according to the admin setting. */
  function refresh() {
    const enabled = Auth.viewerModeEnabled();
    const viewerTab = document.querySelector('[data-login-part="viewer"]');
    document.querySelector(".login-switch").hidden = !enabled;
    if (!enabled && viewerTab.classList.contains("active")) document.querySelector('[data-login-part="admin"]').click();
  }

  global.Pages = global.Pages || {};
  global.Pages.Login = { init, refresh };
})(window);
