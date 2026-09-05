/* =====================================================================
   ui.js — reusable UI primitives: toasts, modals, confirm dialogs,
   small render helpers shared by every page.
   ===================================================================== */
(function (global) {
  "use strict";
  const U = Utils;

  // ---------------- Toasts ----------------
  function toast(type, title, message) {
    const root = document.getElementById("toast-root");
    const el = document.createElement("div");
    el.className = `toast ${type || ""}`;
    el.innerHTML = `<strong>${U.escapeHtml(title)}</strong>${message ? `<div class="muted">${U.escapeHtml(message)}</div>` : ""}`;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(20px)"; el.style.transition = "all .2s"; setTimeout(() => el.remove(), 220); }, 3200);
  }

  // ---------------- Modal ----------------
  let modalStack = [];

  function closeModal() {
    const root = document.getElementById("modal-root");
    root.innerHTML = "";
    modalStack = [];
    document.removeEventListener("keydown", onEscape);
  }

  function onEscape(e) { if (e.key === "Escape") closeModal(); }

  /**
   * openModal({ title, bodyHTML, size, footerHTML, onMount(container), onClose })
   * Returns the modal DOM element so callers can query inputs from it.
   */
  function openModal({ title, bodyHTML, size, footerHTML, onMount }) {
    const root = document.getElementById("modal-root");
    root.innerHTML = "";
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal ${size === "lg" ? "modal-lg" : size === "sm" ? "modal-sm" : ""}">
        <div class="modal-header">
          <h3>${U.escapeHtml(title)}</h3>
          <button class="icon-btn" data-close-modal aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ""}
      </div>`;
    root.appendChild(backdrop);
    backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModal(); });
    backdrop.querySelector("[data-close-modal]").addEventListener("click", closeModal);
    document.addEventListener("keydown", onEscape);
    const modalEl = backdrop.querySelector(".modal");
    if (onMount) onMount(modalEl);
    return modalEl;
  }

  function confirmDialog({ title, message, confirmText, danger, onConfirm }) {
    const modalEl = openModal({
      title: title || "Are you sure?",
      bodyHTML: `<p>${U.escapeHtml(message || "")}</p>`,
      size: "sm",
      footerHTML: `
        <button class="btn btn-ghost" data-cancel>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${U.escapeHtml(confirmText || "Confirm")}</button>`,
    });
    modalEl.querySelector("[data-cancel]").addEventListener("click", closeModal);
    modalEl.querySelector("[data-confirm]").addEventListener("click", () => { closeModal(); onConfirm && onConfirm(); });
  }

  // ---------------- Small render helpers ----------------
  function badge(text, kind) {
    return `<span class="badge badge-${kind || "neutral"}">${U.escapeHtml(text)}</span>`;
  }

  function statusBadge(status) {
    const map = { paid: ["Paid", "success"], partial: ["Partial", "warning"], due: ["Due", "danger"], cancelled: ["Cancelled", "neutral"] };
    const [text, kind] = map[status] || [status, "neutral"];
    return badge(text, kind);
  }

  function emptyRow(colspan, text) {
    return `<tr class="empty-row"><td colspan="${colspan}">${U.escapeHtml(text || "No records found")}</td></tr>`;
  }

  function setPageTitle(title) {
    document.getElementById("page-title").textContent = title;
    document.title = `${title} · Unique Traders`;
  }

  global.UI = { toast, openModal, closeModal, confirmDialog, badge, statusBadge, emptyRow, setPageTitle };
})(window);
