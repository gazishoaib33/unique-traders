/* =====================================================================
   pages/memo.js — printable sales memo / receipt.

   Route: #memo?id=<saleId>[&new=1]
   - Screen: the memo as a document, with Print / Back / New Sale actions.
   - Print: only the memo is printed (see "PRINT" in styles.css). Two
     paper layouts: A4 (default) and an 80 mm receipt for thermal printers.
   All data comes from DB.Sales.memoData(); nothing is invented — company
   address/phone/tagline appear only if they are filled in under Settings.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;
  const PAPER_KEY = "uti::memoPaper";

  function getPaper() {
    try { return localStorage.getItem(PAPER_KEY) === "receipt" ? "receipt" : "a4"; } catch (e) { return "a4"; }
  }
  function setPaper(p) {
    try { localStorage.setItem(PAPER_KEY, p); } catch (e) { /* ignore */ }
  }

  const PAYMENT_LABELS = { cash: "Cash", bkash: "bKash", card: "Card", bank: "Bank Transfer" };
  const STATUS_LABELS = { paid: "Paid", partial: "Partially paid", due: "Due", cancelled: "Cancelled" };

  /** The memo document itself (same markup for screen and print). */
  function memoHTML(m, paper) {
    const e = U.escapeHtml;
    const t = m.totals;
    const contact = [m.company.address, m.company.phone, m.company.email].filter(Boolean);
    const showDiscount = t.discountTotal > 0;
    return `
      <article class="memo ${paper === "receipt" ? "memo-receipt" : ""}" id="memo-print" aria-label="Sales memo ${e(m.sale.invoiceNo)}">
        ${m.sale.cancelled ? `<div class="memo-stamp" aria-hidden="true">CANCELLED</div>` : ""}
        <header class="memo-header">
          <div class="memo-company">
            <h2>${e(m.company.name.toUpperCase())}</h2>
            ${m.company.tagline ? `<div class="memo-tagline">${e(m.company.tagline)}</div>` : ""}
            ${contact.length ? `<div class="memo-contact">${contact.map(e).join("<br>")}</div>` : ""}
          </div>
          <div class="memo-title">
            <div class="memo-label">Cash Memo</div>
            <div class="memo-no">${e(m.sale.invoiceNo)}</div>
            <div class="memo-date">${U.formatDateTime(m.sale.date)}</div>
          </div>
        </header>

        <section class="memo-parties">
          <div>
            <h4>Bill to</h4>
            <div class="mp-name">${e(m.customer.name)}</div>
            ${m.customer.phone ? `<div class="mp-line">${e(m.customer.phone)}</div>` : ""}
            ${m.customer.address ? `<div class="mp-line">${e(m.customer.address)}</div>` : ""}
          </div>
          <div class="memo-meta-grid">
            <span>Payment</span><span>${e(PAYMENT_LABELS[m.sale.paymentMethod] || m.sale.paymentMethod)}</span>
            <span>Status</span><span><span class="memo-status ${m.status}">${e(STATUS_LABELS[m.status] || m.status)}</span></span>
            ${m.staffName ? `<span>Served by</span><span>${e(m.staffName)}</span>` : ""}
          </div>
        </section>

        <table class="memo-items">
          <thead>
            <tr>
              <th class="sl">SL</th>
              <th>Product</th>
              <th class="hide-phone">Size</th>
              <th class="hide-phone hide-receipt">Type / Side</th>
              <th class="num">Qty</th>
              <th class="num hide-receipt">Unit Price</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${m.items.map((it) => `
              <tr>
                <td class="sl">${it.sl}</td>
                <td>
                  <div>${e(it.productName)}</div>
                  <div class="item-sub">${e(it.sku)}${it.discount > 0 ? ` · discount ${U.formatMoney(it.discount)}` : ""}</div>
                </td>
                <td class="hide-phone">${e(it.size || "—")}</td>
                <td class="hide-phone hide-receipt">${e(it.typeSide || "—")}</td>
                <td class="num">${U.formatNumber(it.qty)}</td>
                <td class="num hide-receipt">${U.formatMoney(it.unitPrice)}</td>
                <td class="num">${U.formatMoney(it.lineTotal)}</td>
              </tr>`).join("")}
          </tbody>
        </table>

        <section class="memo-bottom">
          <div class="memo-words">
            ${m.sale.note ? `<div><strong>Note:</strong> ${e(m.sale.note)}</div>` : ""}
            <div>${U.formatNumber(m.items.reduce((a, it) => a + it.qty, 0))} item(s) in ${m.items.length} line(s)</div>
          </div>
          <table class="memo-totals">
            <tr><td>Subtotal</td><td>${U.formatMoney(t.subtotal)}</td></tr>
            ${showDiscount ? `<tr><td>Discount</td><td>− ${U.formatMoney(t.discountTotal)}</td></tr>` : ""}
            ${t.tax > 0 ? `<tr><td>Tax (${t.taxRatePercent}%)</td><td>${U.formatMoney(t.tax)}</td></tr>` : ""}
            <tr class="grand"><td>Grand Total</td><td>${U.formatMoney(t.grandTotal)}</td></tr>
            <tr><td>Paid</td><td>${U.formatMoney(t.paid)}</td></tr>
            ${t.due > 0 ? `<tr class="due"><td>Due</td><td>${U.formatMoney(t.due)}</td></tr>` : ""}
          </table>
        </section>

        <section class="memo-sign">
          <div>Customer's signature</div>
          <div>Authorised signature</div>
        </section>

        <footer class="memo-footer">
          <strong>Thank you for your business.</strong>
          ${e(m.company.name)}
        </footer>
      </article>`;
  }

  /**
   * Put the page into "print this memo" mode: only #memo-print is visible
   * (see "PRINT" in styles.css) and the page size matches the paper.
   * A4 uses a standard A4 page; the receipt uses one continuous 80 mm-wide
   * page sized to the memo's height (thermal roll paper). The rule is a
   * temporary <style> removed after printing (CSS named pages don't apply
   * to the absolutely-positioned memo).
   */
  function beginPrint(paper) {
    const memo = document.getElementById("memo-print");
    if (!memo) return false;
    memo.classList.toggle("memo-receipt", paper === "receipt");
    document.body.classList.add("printing-memo");
    let style = document.getElementById("memo-page-size");
    if (!style) {
      style = document.createElement("style");
      style.id = "memo-page-size";
      document.head.appendChild(style);
    }
    if (paper === "receipt") {
      // Roll paper is continuous: one page exactly as tall as the receipt.
      // (CSS `size` needs two lengths, so measure the memo at print width.)
      memo.style.width = "74mm";
      const heightMm = Math.ceil(memo.scrollHeight * 25.4 / 96) + 8;
      memo.style.width = "";
      style.textContent = `@page { size: 80mm ${heightMm}mm; margin: 3mm; }`;
    } else {
      style.textContent = "@page { size: A4; margin: 12mm; }";
    }
    return true;
  }

  function endPrint() {
    document.body.classList.remove("printing-memo");
    const style = document.getElementById("memo-page-size");
    if (style) style.remove();
    const memo = document.getElementById("memo-print");
    if (memo) memo.classList.toggle("memo-receipt", getPaper() === "receipt");
  }

  /** Print only the memo, in the chosen paper layout. */
  function printMemo(paper) {
    if (!beginPrint(paper)) return;
    const cleanup = () => { endPrint(); window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Some browsers fire afterprint late or not at all; clean up regardless.
    setTimeout(cleanup, 1000);
  }

  async function render(root, params) {
    const saleId = params && params.get("id");
    const m = saleId ? DB.Sales.memoData(saleId) : null;
    if (!m) {
      root.innerHTML = `
        <div class="card empty-state">
          <span class="empty-icon">${Icons.svg("receipt", 36)}</span>
          <h4>Memo not found</h4>
          <p>This sale doesn't exist in this browser's data.</p>
          <div style="margin-top:16px"><a class="btn btn-secondary" href="#sales-history">${Icons.svg("back", 16)} Sales History</a></div>
        </div>`;
      return;
    }
    UI.setPageTitle(`Memo ${m.sale.invoiceNo}`);
    let paper = getPaper();
    const justSold = params.get("new") === "1";

    root.innerHTML = `
      ${justSold ? `
        <div class="sale-done" role="status">
          ${Icons.svg("check", 26)}
          <div><strong>Sale completed — ${U.escapeHtml(m.sale.invoiceNo)}</strong><span>${U.formatMoney(m.totals.grandTotal)} · stock has been updated.</span></div>
        </div>` : ""}
      <div class="memo-toolbar">
        <a class="btn btn-ghost" href="#sales-history" id="memo-back">${Icons.svg("back", 16)} Back</a>
        <div class="spacer"></div>
        <div class="segmented" role="group" aria-label="Paper size">
          <button type="button" data-paper="a4" class="${paper === "a4" ? "active" : ""}">A4</button>
          <button type="button" data-paper="receipt" class="${paper === "receipt" ? "active" : ""}">Receipt 80mm</button>
        </div>
        <button class="btn btn-secondary" id="memo-new">${Icons.svg("plus", 16)} New Sale</button>
        <button class="btn btn-primary" id="memo-print-btn">${Icons.svg("printer", 16)} Print Memo</button>
      </div>
      <div class="memo-stage">${memoHTML(m, paper)}</div>
      <p class="muted" style="text-align:center;font-size:12px;margin-top:14px">
        Tip: to save as PDF, choose “Save as PDF” as the printer in the print dialog.
        ${!m.company.address && !m.company.phone ? `Shop address and phone can be added in <a href="#settings">Settings</a>.` : ""}
      </p>
    `;

    // "Back" returns to wherever the user came from when possible.
    root.querySelector("#memo-back").addEventListener("click", (ev) => {
      if (history.length > 1 && !justSold) { ev.preventDefault(); history.back(); }
    });
    root.querySelector("#memo-new").addEventListener("click", () => Router.go("sales"));
    root.querySelector("#memo-print-btn").addEventListener("click", () => printMemo(paper));
    root.querySelectorAll("[data-paper]").forEach((b) => b.addEventListener("click", () => {
      paper = b.dataset.paper;
      setPaper(paper);
      root.querySelectorAll("[data-paper]").forEach((x) => x.classList.toggle("active", x === b));
      document.getElementById("memo-print").classList.toggle("memo-receipt", paper === "receipt");
    }));

    // Opened from a "Print" action (e.g. Sales History): go straight to the print dialog.
    if (params.get("print") === "1") {
      history.replaceState(null, "", `#memo?id=${encodeURIComponent(saleId)}`);
      setTimeout(() => printMemo(paper), 250);
    }
  }

  Router.register("memo", { title: "Memo", permission: "sales", render });
  global.Pages = global.Pages || {};
  global.Pages.Memo = { open: (saleId, opts = {}) => Router.go(`memo?id=${encodeURIComponent(saleId)}${opts.justSold ? "&new=1" : ""}`), memoHTML, beginPrint, endPrint };
})(window);
