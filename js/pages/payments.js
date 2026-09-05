/* =====================================================================
   pages/payments.js — payment ledger + shared "record payment" modal
   (also invoked from Sales history and Customer statements).
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  let filters = { from: "", to: "", customerId: "" };

  async function render(root) {
    const customers = await DB.Customers.list();
    root.innerHTML = `
      <div class="filter-bar card card-pad">
        <div class="field"><label>From</label><input type="date" id="pm-from" value="${filters.from}"></div>
        <div class="field"><label>To</label><input type="date" id="pm-to" value="${filters.to}"></div>
        <div class="field"><label>Customer</label><select id="pm-customer"><option value="">All Customers</option>${customers.map((c) => `<option value="${c.id}">${U.escapeHtml(c.name)}</option>`).join("")}</select></div>
        <button class="btn btn-secondary" id="pm-apply">Apply</button>
        <button class="btn btn-ghost" id="pm-clear">Clear</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" id="pm-add">+ Record Payment</button>
      </div>
      <div class="card">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Customer</th><th>Reference</th><th>Method</th><th>Type</th><th class="text-right">Amount</th><th></th></tr></thead>
          <tbody id="pm-tbody"></tbody>
        </table></div>
      </div>
    `;
    document.getElementById("pm-customer").value = filters.customerId;
    document.getElementById("pm-apply").addEventListener("click", () => {
      filters = { from: document.getElementById("pm-from").value, to: document.getElementById("pm-to").value, customerId: document.getElementById("pm-customer").value };
      loadRows();
    });
    document.getElementById("pm-clear").addEventListener("click", () => { filters = { from: "", to: "", customerId: "" }; render(root); });
    document.getElementById("pm-add").addEventListener("click", () => openPaymentModal({ onDone: loadRows }));
    await loadRows();
  }

  async function loadRows() {
    const [payments, customers, sales] = await Promise.all([DB.Payments.list(filters), DB.Customers.list(), DB.Sales.list({})]);
    const custMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
    const saleMap = Object.fromEntries(sales.map((s) => [s.id, s.invoiceNo]));
    const isAdmin = Auth.isAdmin();
    const tbody = document.getElementById("pm-tbody");
    tbody.innerHTML = payments.length ? payments.map((p) => `
      <tr>
        <td>${U.formatDateTime(p.date)}</td>
        <td>${U.escapeHtml(custMap[p.customerId] || "—")}</td>
        <td class="mono">${p.saleId ? (saleMap[p.saleId] || "—") : "General credit"}</td>
        <td>${UI.badge(p.method, "info")}</td>
        <td>${UI.badge(p.type === "sale" ? "Sale Payment" : p.type === "refund" ? "Refund" : "Credit Payment", "neutral")}</td>
        <td class="text-right mono">${U.formatMoney(p.amount)}</td>
        <td>${isAdmin ? `<div class="row-actions"><button class="icon-btn" data-del="${p.id}" title="Delete">🗑️</button></div>` : ""}</td>
      </tr>`).join("") : UI.emptyRow(7, "No payments recorded yet");

    tbody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      UI.confirmDialog({ title: "Delete payment record?", message: "This will increase the customer's outstanding balance.", confirmText: "Delete", danger: true, onConfirm: async () => { await DB.Payments.remove(b.dataset.del); UI.toast("success", "Payment deleted"); loadRows(); } });
    }));
  }

  /**
   * Shared modal used from Sales History, Customer Statements, and this page.
   * options: { customerId, saleId, suggestedAmount, onDone }
   */
  async function openPaymentModal(options = {}) {
    const customers = await DB.Customers.list();
    const lockCustomer = !!options.customerId;
    const bodyHTML = `
      <form id="payment-form">
        <div class="field"><label>Customer *</label>
          <select id="pf-customer" ${lockCustomer ? "disabled" : ""}>
            <option value="">— Select customer —</option>
            ${customers.map((c) => `<option value="${c.id}" ${c.id === options.customerId ? "selected" : ""}>${U.escapeHtml(c.name)} (Balance: ${U.formatMoney(DB.Customers.balance(c.id))})</option>`).join("")}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Amount *</label><input id="pf-amount" type="number" min="0.01" step="0.01" value="${options.suggestedAmount ? Number(options.suggestedAmount).toFixed(2) : ""}"></div>
          <div class="field"><label>Method</label><select id="pf-method"><option value="cash">Cash</option><option value="bkash">bKash</option><option value="card">Card</option><option value="bank">Bank Transfer</option></select></div>
        </div>
        <div class="field"><label>Note</label><input id="pf-note" placeholder="Optional note"></div>
      </form>`;
    const footerHTML = `<button class="btn btn-ghost" data-close-modal>Cancel</button><button class="btn btn-primary" id="pf-save">Save Payment</button>`;
    const modalEl = UI.openModal({ title: "Record Payment", bodyHTML, footerHTML });
    modalEl.querySelector("[data-close-modal]").addEventListener("click", UI.closeModal);
    modalEl.querySelector("#pf-save").addEventListener("click", async () => {
      const customerId = modalEl.querySelector("#pf-customer").value || options.customerId;
      const amount = Number(modalEl.querySelector("#pf-amount").value);
      if (!customerId) { UI.toast("error", "Select a customer"); return; }
      if (!amount || amount <= 0) { UI.toast("error", "Enter a valid amount"); return; }
      try {
        await DB.Payments.create({
          customerId, saleId: options.saleId || null, amount,
          method: modalEl.querySelector("#pf-method").value,
          type: options.saleId ? "sale" : "customer-credit",
          note: modalEl.querySelector("#pf-note").value.trim(),
          userId: Auth.currentUser().id,
        });
        UI.toast("success", "Payment recorded");
        UI.closeModal();
        options.onDone && options.onDone();
      } catch (err) { UI.toast("error", "Could not save payment", err.message); }
    });
  }

  Router.register("payments", { title: "Payments", permission: "payments", render });
  global.Pages = global.Pages || {};
  global.Pages.Payments = { openPaymentModal };
})(window);
