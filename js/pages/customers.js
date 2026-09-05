/* =====================================================================
   pages/customers.js — customer directory, ledger statements.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let state = { search: "", type: "" };

  async function render(root) {
    root.innerHTML = `
      <div class="toolbar">
        <div class="search-input"><input id="c-search" placeholder="Search name or phone…"></div>
        <select id="c-type"><option value="">All Types</option><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="c-add">+ New Customer</button>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Customer</th><th>Contact</th><th>Type</th><th class="text-right">Credit Limit</th><th class="text-right">Balance</th><th></th></tr></thead>
          <tbody id="c-tbody"></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("c-search").addEventListener("input", U.debounce((e) => { state.search = e.target.value; renderTable(); }, 200));
    document.getElementById("c-type").addEventListener("change", (e) => { state.type = e.target.value; renderTable(); });
    document.getElementById("c-add").addEventListener("click", () => openCustomerModal(null));
    await renderTable();
  }

  async function renderTable() {
    const customers = await DB.Customers.list({ search: state.search, type: state.type });
    const tbody = document.getElementById("c-tbody");
    if (!customers.length) { tbody.innerHTML = UI.emptyRow(6, "No customers found"); return; }
    tbody.innerHTML = customers.map((c) => {
      const balance = DB.Customers.balance(c.id);
      const overLimit = c.creditLimit > 0 && balance > c.creditLimit;
      return `
        <tr>
          <td><strong>${U.escapeHtml(c.name)}</strong><div class="muted" style="font-size:11.5px">${U.escapeHtml(c.address || "")}</div></td>
          <td>${U.escapeHtml(c.phone || "—")}<div class="muted" style="font-size:11.5px">${U.escapeHtml(c.email || "")}</div></td>
          <td>${UI.badge(c.type === "wholesale" ? "Wholesale" : "Retail", c.type === "wholesale" ? "info" : "neutral")}</td>
          <td class="text-right mono">${U.formatMoney(c.creditLimit)}</td>
          <td class="text-right mono">${UI.badge(U.formatMoney(balance), balance <= 0 ? "success" : overLimit ? "danger" : "warning")}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-statement="${c.id}" title="Statement">📄</button>
            <button class="icon-btn" data-edit="${c.id}" title="Edit">✏️</button>
            <button class="icon-btn" data-delete="${c.id}" title="Delete">🗑️</button>
          </div></td>
        </tr>`;
    }).join("");

    tbody.querySelectorAll("[data-statement]").forEach((b) => b.addEventListener("click", () => openStatementModal(b.dataset.statement)));
    tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openCustomerModal(b.dataset.edit)));
    tbody.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => {
      UI.confirmDialog({
        title: "Delete customer?", message: "This cannot be undone. Customers with sales/payment history cannot be deleted.", confirmText: "Delete", danger: true,
        onConfirm: async () => {
          try { await DB.Customers.remove(b.dataset.delete); UI.toast("success", "Customer deleted"); renderTable(); }
          catch (err) { UI.toast("error", "Cannot delete", err.message); }
        },
      });
    }));
  }

  async function openStatementModal(customerId) {
    const customer = await DB.Customers.get(customerId);
    const rows = DB.Customers.statement(customerId);
    let running = 0;
    const rowsHTML = rows.map((r) => {
      running += r.debit - r.credit;
      return `<tr><td>${U.formatDate(r.date)}</td><td>${U.escapeHtml(r.ref)}</td><td class="text-right mono">${r.debit ? U.formatMoney(r.debit) : "—"}</td><td class="text-right mono">${r.credit ? U.formatMoney(r.credit) : "—"}</td><td class="text-right mono">${U.formatMoney(running)}</td></tr>`;
    }).join("");
    const bodyHTML = `
      <div class="kv-list" style="margin-bottom:14px;">
        <div class="kv-row"><span>Customer</span><span>${U.escapeHtml(customer.name)}</span></div>
        <div class="kv-row"><span>Credit Limit</span><span>${U.formatMoney(customer.creditLimit)}</span></div>
        <div class="kv-row"><span>Current Balance</span><span>${U.formatMoney(DB.Customers.balance(customerId))}</span></div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Reference</th><th class="text-right">Charged</th><th class="text-right">Paid</th><th class="text-right">Balance</th></tr></thead>
        <tbody>${rows.length ? rowsHTML : UI.emptyRow(5, "No transactions yet")}</tbody>
      </table></div>`;
    const modalEl = UI.openModal({ title: "Customer Statement", bodyHTML, size: "lg", footerHTML: `<button class="btn btn-secondary" data-close-modal>Close</button><button class="btn btn-primary" id="stmt-pay">Record Payment</button>` });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    modalEl.querySelector("#stmt-pay").addEventListener("click", () => {
      Pages.Payments.openPaymentModal({ customerId, suggestedAmount: Math.max(0, DB.Customers.balance(customerId)), onDone: () => { UI.closeModal(); renderTable(); } });
    });
  }

  function openCustomerModal(customerId) {
    const isEdit = !!customerId;
    const bodyHTML = `
      <form id="customer-form">
        <div class="field"><label>Full Name *</label><input id="cf-name" required></div>
        <div class="field-row">
          <div class="field"><label>Phone</label><input id="cf-phone"></div>
          <div class="field"><label>Email</label><input id="cf-email" type="email"></div>
        </div>
        <div class="field"><label>Address</label><textarea id="cf-address" rows="2"></textarea></div>
        <div class="field-row">
          <div class="field"><label>Type</label><select id="cf-type"><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select></div>
          <div class="field"><label>Credit Limit</label><input id="cf-limit" type="number" min="0" step="0.01" value="0"></div>
        </div>
      </form>`;
    const footerHTML = `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="cf-save">${isEdit ? "Save Changes" : "Add Customer"}</button>`;
    const modalEl = UI.openModal({ title: isEdit ? "Edit Customer" : "New Customer", bodyHTML, footerHTML });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);

    (async () => {
      if (isEdit) {
        const c = await DB.Customers.get(customerId);
        modalEl.querySelector("#cf-name").value = c.name;
        modalEl.querySelector("#cf-phone").value = c.phone || "";
        modalEl.querySelector("#cf-email").value = c.email || "";
        modalEl.querySelector("#cf-address").value = c.address || "";
        modalEl.querySelector("#cf-type").value = c.type;
        modalEl.querySelector("#cf-limit").value = c.creditLimit;
      }
    })();

    modalEl.querySelector("#cf-save").addEventListener("click", async () => {
      const data = {
        name: modalEl.querySelector("#cf-name").value.trim(),
        phone: modalEl.querySelector("#cf-phone").value.trim(),
        email: modalEl.querySelector("#cf-email").value.trim(),
        address: modalEl.querySelector("#cf-address").value.trim(),
        type: modalEl.querySelector("#cf-type").value,
        creditLimit: Number(modalEl.querySelector("#cf-limit").value) || 0,
      };
      if (!data.name) { UI.toast("error", "Name is required"); return; }
      try {
        if (isEdit) await DB.Customers.update(customerId, data); else await DB.Customers.create(data);
        UI.toast("success", isEdit ? "Customer updated" : "Customer added");
        UI.closeModal();
        renderTable();
      } catch (err) { UI.toast("error", "Could not save", err.message); }
    });
  }

  Router.register("customers", { title: "Customers", permission: "customers", render });
})(window);
