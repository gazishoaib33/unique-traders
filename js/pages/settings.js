/* =====================================================================
   pages/settings.js — company profile, categories, users, theme,
   backup/restore & demo data reset.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let activeTab = "general";

  async function render(root) {
    const isAdmin = Auth.isAdmin();
    root.innerHTML = `
      <div class="tabs">
        <button class="tab-btn ${activeTab === "general" ? "active" : ""}" data-tab="general">General</button>
        <button class="tab-btn ${activeTab === "categories" ? "active" : ""}" data-tab="categories">Categories</button>
        ${isAdmin ? `<button class="tab-btn ${activeTab === "users" ? "active" : ""}" data-tab="users">Users</button>` : ""}
        ${isAdmin ? `<button class="tab-btn ${activeTab === "data" ? "active" : ""}" data-tab="data">Data & Backup</button>` : ""}
      </div>
      <div id="settings-body"></div>
    `;
    root.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; render(root); }));
    const body = document.getElementById("settings-body");
    if (activeTab === "general") await renderGeneral(body);
    else if (activeTab === "categories") await renderCategories(body);
    else if (activeTab === "users" && isAdmin) await renderUsers(body);
    else if (activeTab === "data" && isAdmin) await renderData(body);
  }

  async function renderGeneral(root) {
    const isAdmin = Auth.isAdmin();
    const settings = await DB.Settings.get();
    root.innerHTML = `
      <div class="card" style="max-width:640px;">
        <div class="card-header"><h3>Company Profile</h3></div>
        <div class="card-pad">
          <div class="field"><label>Company Name</label><input id="s-name" value="${U.escapeHtml(settings.companyName)}" ${isAdmin ? "" : "disabled"}></div>
          <div class="field" style="margin-top:12px;"><label>Address</label><textarea id="s-address" rows="2" ${isAdmin ? "" : "disabled"}>${U.escapeHtml(settings.companyAddress)}</textarea></div>
          <div class="field-row" style="margin-top:12px;">
            <div class="field"><label>Phone</label><input id="s-phone" value="${U.escapeHtml(settings.companyPhone)}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Email</label><input id="s-email" value="${U.escapeHtml(settings.companyEmail)}" ${isAdmin ? "" : "disabled"}></div>
          </div>

          <div class="section-title" style="margin-top:22px;">Transaction Defaults</div>
          <div class="field-row">
            <div class="field"><label>Currency Symbol</label><input id="s-currency-symbol" value="${U.escapeHtml(settings.currencySymbol)}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Currency Code</label><input id="s-currency-code" value="${U.escapeHtml(settings.currencyCode)}" ${isAdmin ? "" : "disabled"}></div>
          </div>
          <div class="field-row" style="margin-top:12px;">
            <div class="field"><label>Tax Rate (%)</label><input id="s-tax" type="number" min="0" step="0.01" value="${settings.taxRatePercent}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Invoice Prefix</label><input id="s-prefix" value="${U.escapeHtml(settings.invoicePrefix)}" ${isAdmin ? "" : "disabled"}></div>
            <div class="field"><label>Low Stock Threshold</label><input id="s-lowstock" type="number" min="0" step="1" value="${settings.lowStockDefaultThreshold}" ${isAdmin ? "" : "disabled"}></div>
          </div>

          ${isAdmin ? `<button class="btn btn-primary" id="s-save" style="margin-top:18px;">Save Settings</button>` : `<p class="muted" style="margin-top:16px;font-size:12.5px;">Only Admins can change company settings.</p>`}
        </div>
      </div>
    `;
    if (isAdmin) {
      document.getElementById("s-save").addEventListener("click", async () => {
        try {
        await DB.Settings.update({
          companyName: document.getElementById("s-name").value.trim(),
          companyAddress: document.getElementById("s-address").value.trim(),
          companyPhone: document.getElementById("s-phone").value.trim(),
          companyEmail: document.getElementById("s-email").value.trim(),
          currencySymbol: document.getElementById("s-currency-symbol").value.trim() || "৳",
          currencyCode: document.getElementById("s-currency-code").value.trim() || "BDT",
          taxRatePercent: Number(document.getElementById("s-tax").value) || 0,
          invoicePrefix: document.getElementById("s-prefix").value.trim() || "INV",
          lowStockDefaultThreshold: Number(document.getElementById("s-lowstock").value) || 0,
        });
        UI.toast("success", "Settings saved");
        } catch (err) { UI.toast("error", "Could not save settings", err.message); }
      });
    }
  }

  async function renderCategories(root) {
    const isAdmin = Auth.isAdmin();
    const categories = await DB.Categories.list();
    root.innerHTML = `
      <div class="card" style="max-width:560px;">
        <div class="card-header"><h3>Product Categories</h3>${isAdmin ? `<button class="btn btn-primary btn-sm" id="cat-add">+ Add</button>` : ""}</div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
          <tbody>${categories.length ? categories.map((c) => `<tr><td>${U.escapeHtml(c.name)}</td>${isAdmin ? `<td><div class="row-actions"><button class="icon-btn" data-rename="${c.id}">✏️</button><button class="icon-btn" data-del="${c.id}">🗑️</button></div></td>` : ""}</tr>`).join("") : UI.emptyRow(isAdmin ? 2 : 1, "No categories yet")}</tbody>
        </table></div>
      </div>
    `;
    if (!isAdmin) return;
    document.getElementById("cat-add").addEventListener("click", () => promptCategory());
    root.querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", async () => {
      const c = await DB.Categories.get(b.dataset.rename);
      promptCategory(c);
    }));
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      UI.confirmDialog({ title: "Delete category?", message: "Categories used by products cannot be deleted.", confirmText: "Delete", danger: true, onConfirm: async () => { try { await DB.Categories.remove(b.dataset.del); renderCategories(root); } catch (err) { UI.toast("error", "Cannot delete", err.message); } } });
    }));
  }

  function promptCategory(existing) {
    const bodyHTML = `<div class="field"><label>Category Name *</label><input id="cat-name" value="${U.escapeHtml(existing?.name || "")}"></div>`;
    const modalEl = UI.openModal({ title: existing ? "Rename Category" : "New Category", bodyHTML, footerHTML: `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="cat-save">Save</button>` });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    modalEl.querySelector("#cat-save").addEventListener("click", async () => {
      const name = modalEl.querySelector("#cat-name").value.trim();
      if (!name) { UI.toast("error", "Name is required"); return; }
      try {
        if (existing) await DB.Categories.update(existing.id, { name }); else await DB.Categories.create({ name });
        UI.closeModal();
        UI.toast("success", "Saved");
        Router.resolve();
      } catch (err) { UI.toast("error", "Could not save category", err.message); }
    });
  }

  async function renderUsers(root) {
    const users = await DB.Users.list();
    const me = Auth.currentUser();
    root.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Team Members</h3><button class="btn btn-primary btn-sm" id="u-add">+ Add User</button></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td><strong>${U.escapeHtml(u.name)}</strong>${u.id === me.id ? ' <span class="muted" style="font-size:11px">(you)</span>' : ""}</td>
              <td class="mono">${U.escapeHtml(u.username)}</td>
              <td>${UI.badge(u.role, u.role === "admin" ? "info" : "neutral")}</td>
              <td>${u.active ? UI.badge("Active", "success") : UI.badge("Inactive", "neutral")}</td>
              <td><div class="row-actions">
                <button class="icon-btn" data-edit="${u.id}" title="Edit">✏️</button>
                ${u.id !== me.id ? `<button class="icon-btn" data-del="${u.id}" title="Delete">🗑️</button>` : ""}
              </div></td>
            </tr>`).join("")}</tbody>
        </table></div>
      </div>
    `;
    document.getElementById("u-add").addEventListener("click", () => openUserModal(null));
    root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openUserModal(b.dataset.edit)));
    root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      UI.confirmDialog({ title: "Remove user?", message: "Users who have recorded sales will be deactivated instead of deleted.", confirmText: "Remove", danger: true, onConfirm: async () => { try { await DB.Users.remove(b.dataset.del); UI.toast("success", "User removed"); renderUsers(root); } catch (err) { UI.toast("error", "Cannot remove user", err.message); } } });
    }));
  }

  function openUserModal(userId) {
    const isEdit = !!userId;
    const bodyHTML = `
      <form id="user-form">
        <div class="field"><label>Full Name *</label><input id="uf-name" required></div>
        <div class="field-row">
          <div class="field"><label>Username *</label><input id="uf-username" required></div>
          <div class="field"><label>${isEdit ? "New Password (leave blank to keep)" : "Password *"}</label><input id="uf-password" type="text"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Role</label><select id="uf-role"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
          <div class="field"><label>Status</label><select id="uf-active"><option value="true">Active</option><option value="false">Inactive</option></select></div>
        </div>
      </form>`;
    const modalEl = UI.openModal({ title: isEdit ? "Edit User" : "New User", bodyHTML, footerHTML: `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="uf-save">${isEdit ? "Save Changes" : "Create User"}</button>` });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);

    (async () => {
      if (isEdit) {
        const u = await DB.Users.get(userId);
        modalEl.querySelector("#uf-name").value = u.name;
        modalEl.querySelector("#uf-username").value = u.username;
        modalEl.querySelector("#uf-role").value = u.role;
        modalEl.querySelector("#uf-active").value = String(u.active);
      }
    })();

    modalEl.querySelector("#uf-save").addEventListener("click", async () => {
      const name = modalEl.querySelector("#uf-name").value.trim();
      const username = modalEl.querySelector("#uf-username").value.trim();
      const password = modalEl.querySelector("#uf-password").value;
      const role = modalEl.querySelector("#uf-role").value;
      const active = modalEl.querySelector("#uf-active").value === "true";
      try {
        if (isEdit) {
          const data = { name, username, role, active };
          if (password) data.password = password;
          await DB.Users.update(userId, data);
        } else {
          if (!password) { UI.toast("error", "Password is required"); return; }
          await DB.Users.create({ name, username, password, role });
        }
        UI.toast("success", isEdit ? "User updated" : "User created");
        UI.closeModal();
        Router.resolve();
      } catch (err) { UI.toast("error", "Could not save user", err.message); }
    });
  }

  async function renderData(root) {
    root.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><h3>Backup & Restore</h3></div>
          <div class="card-pad">
            <p class="muted" style="font-size:13px;margin-bottom:14px;">Export a full backup of all data (products, sales, customers, payments…) as a JSON file, or restore from a previous export.</p>
            <button class="btn btn-secondary" id="d-export" style="margin-right:8px;">⬇ Export Backup</button>
            <label class="btn btn-secondary" style="cursor:pointer;">
              ⬆ Import Backup <input type="file" id="d-import" accept="application/json" hidden>
            </label>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Reload Starter Catalog</h3></div>
          <div class="card-pad">
            <p class="muted" style="font-size:13px;margin-bottom:14px;">Wipe all current data (products, sales, customers, payments) and reload the original imported catalog — 482 products from your real price list, with zero stock movements or sales. Useful if you want to undo changes and start over from the imported baseline.</p>
            <button class="btn btn-danger" id="d-reset">Reload Starter Catalog</button>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:18px; border-color:var(--danger);">
        <div class="card-header"><h3>Switch to Real Data</h3></div>
        <div class="card-pad">
          <p class="muted" style="font-size:13px;margin-bottom:14px;">Ready to stop using demo content? This permanently deletes every demo product, customer, sale and payment, and leaves a genuinely empty workspace with just one admin login you choose below. Export a backup first if you want to keep the demo data for reference.</p>
          <div class="field-row" style="max-width:640px;">
            <div class="field"><label>Your Company Name</label><input id="sf-company" placeholder="e.g. Unique Traders"></div>
            <div class="field"><label>Your Name</label><input id="sf-name" placeholder="Your full name"></div>
          </div>
          <div class="field-row" style="max-width:640px;">
            <div class="field"><label>Admin Username</label><input id="sf-username" placeholder="admin"></div>
            <div class="field"><label>Admin Password</label><input id="sf-password" placeholder="choose a password"></div>
          </div>
          <button class="btn btn-danger" id="d-fresh" style="margin-top:6px;">Start Fresh — Delete All Demo Data</button>
        </div>
      </div>
      <div class="card" style="margin-top:18px;">
        <div class="card-header"><h3>Connect Supabase (coming soon)</h3></div>
        <div class="card-pad">
          <p class="muted" style="font-size:13px;">This app currently stores everything locally in your browser (localStorage), through a single data-layer module (<code>js/db.js</code>). When you're ready to go live with Supabase, only <code>js/storage.js</code> and the internals of <code>js/db.js</code> need to change — every page already calls the data layer asynchronously, so no page code needs to change.</p>
        </div>
      </div>
    `;
    document.getElementById("d-export").addEventListener("click", () => {
      const data = DB.Backup.exportJSON();
      U.downloadTextFile(`unique-traders-backup-${U.todayISO()}.json`, JSON.stringify(data, null, 2), "application/json");
      UI.toast("success", "Backup exported");
    });
    document.getElementById("d-import").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      UI.confirmDialog({
        title: "Import backup?", message: "This will replace ALL current data with the contents of the backup file.", confirmText: "Import & Replace", danger: true,
        onConfirm: () => {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const obj = JSON.parse(reader.result);
              await DB.Backup.importJSON(obj);
              UI.toast("success", "Backup restored — reloading…");
              setTimeout(() => location.reload(), 800);
            } catch (err) { UI.toast("error", "Invalid backup file", err.message); }
          };
          reader.readAsText(file);
        },
      });
    });
    document.getElementById("d-reset").addEventListener("click", () => {
      UI.confirmDialog({
        title: "Reload starter catalog?", message: "This permanently deletes everything — including any products, sales, or customers you've added — and reloads the original 482-product catalog. This cannot be undone.", confirmText: "Reload Catalog", danger: true,
        onConfirm: async () => { await DB.Backup.resetDemoData(); UI.toast("success", "Catalog reloaded — refreshing…"); setTimeout(() => location.reload(), 800); },
      });
    });
    document.getElementById("d-fresh").addEventListener("click", () => {
      const companyName = document.getElementById("sf-company").value.trim();
      const adminName = document.getElementById("sf-name").value.trim();
      const adminUsername = document.getElementById("sf-username").value.trim();
      const adminPassword = document.getElementById("sf-password").value;
      if (!companyName || !adminName || !adminUsername || !adminPassword) { UI.toast("error", "Fill in all fields", "Company name, your name, username and password are all required"); return; }
      UI.confirmDialog({
        title: "Delete all demo data?", message: `This permanently deletes every demo product, sale, customer and payment. You'll be left with a blank workspace and one login: ${adminUsername}. This cannot be undone.`, confirmText: "Yes, Start Fresh", danger: true,
        onConfirm: async () => {
          await DB.Backup.startFresh({ companyName, adminName, adminUsername, adminPassword });
          UI.toast("success", "Workspace cleared — reloading…");
          setTimeout(() => location.reload(), 800);
        },
      });
    });
  }

  Router.register("settings", { title: "Settings", permission: "settings", render });
})(window);
