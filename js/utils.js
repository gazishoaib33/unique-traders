/* =====================================================================
   utils.js — generic helpers used across the app. No dependencies.
   ===================================================================== */
(function (global) {
  "use strict";

  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 9);
    const t = Date.now().toString(36).slice(-5);
    return `${prefix ? prefix + "_" : ""}${t}${rnd}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatDate(iso, opts) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", opts || { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  let _currency = { symbol: "৳", code: "BDT" };
  function setCurrency(symbol, code) {
    _currency = { symbol, code };
  }
  function formatMoney(n) {
    n = Number(n) || 0;
    const neg = n < 0;
    // Matches the companion Flutter app's CurrencyFormatter (0 decimal places for BDT).
    const abs = Math.round(Math.abs(n)).toLocaleString("en-US");
    return `${neg ? "-" : ""}${_currency.symbol}${abs}`;
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toCSV(rows) {
    if (!rows || !rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    rows.forEach((r) => lines.push(headers.map((h) => esc(r[h])).join(",")));
    return lines.join("\n");
  }

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function sum(arr, fn) {
    return arr.reduce((a, x) => a + (fn ? fn(x) : x), 0);
  }

  function groupBy(arr, keyFn) {
    const map = {};
    arr.forEach((x) => {
      const k = keyFn(x);
      (map[k] = map[k] || []).push(x);
    });
    return map;
  }

  function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function inRange(iso, fromISO, toISO) {
    const t = new Date(iso).getTime();
    if (fromISO && t < startOfDay(fromISO).getTime()) return false;
    if (toISO && t > endOfDay(toISO).getTime()) return false;
    return true;
  }

  /** Lower-cases and normalises text for searching. Door sizes are written
   *  many ways ("7 x 3.5", "7×3.5", "7X3.5") — all become "7x3.5". */
  function normalizeSearch(str) {
    return String(str ?? "")
      .toLowerCase()
      .replace(/[×*]/g, "x")
      .replace(/(\d)\s*x\s*(?=\d)/g, "$1x")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** True when every word of `query` appears somewhere in `text`, in any
   *  order — so "cosmic 7x3.5 left" finds "Cosmic Door Bronze — Left Hand". */
  function matchesSearch(text, query) {
    const haystack = normalizeSearch(text);
    const words = normalizeSearch(query).split(" ").filter(Boolean);
    return words.every((w) => haystack.includes(w));
  }

  // ---------------------------------------------------------------
  // Product attributes for display. The catalogue has no separate
  // size/side fields: size lives in the description ("7x3.5 feet") and
  // side in the variant name ("Left Hand (L-HB)") or product name ("L/H").
  // These helpers only READ that text — nothing is stored or changed.
  // ---------------------------------------------------------------
  const SIZE_RE = /(\d+(?:\.\d+)?)\s*(?:'|ft|feet|")?\s*[xX×*]\s*(\d+(?:\.\d+)?)\s*(?:'|")?\s*(feet|ft|inch|in|mm|cm)?/;
  const UNIT = { feet: "ft", ft: "ft", inch: "in", in: "in", mm: "mm", cm: "cm" };

  /** "COSMIC Door . 7x3.5 feet" → "7×3.5 ft"; "Size-various" → "Various"; else "". */
  function parseSize(...texts) {
    for (const t of texts) {
      const m = String(t || "").match(SIZE_RE);
      if (m) return `${m[1]}×${m[2]}${m[3] ? " " + UNIT[m[3].toLowerCase()] : ""}`;
    }
    if (texts.some((t) => /size[-\s]*various/i.test(String(t || "")))) return "Various";
    return "";
  }

  /** "Left Hand (L-HB)" / "… L/H" → "Left"; "Right …" / "R/H" → "Right"; else "". */
  function parseSide(...texts) {
    for (const t of texts) {
      const s = String(t || "");
      if (/\bleft\b|\bL\s*[\/-]\s*H\b|\bLH\b/i.test(s)) return "Left";
      if (/\bright\b|\bR\s*[\/-]\s*H\b|\bRH\b/i.test(s)) return "Right";
    }
    return "";
  }

  /** True for placeholder variant names that carry no information. */
  function isPlainVariant(name) {
    return !name || /^(standard|default)$/i.test(String(name).trim());
  }

  global.Utils = {
    uid, nowISO, todayISO, formatDate, formatDateTime,
    setCurrency, formatMoney, formatNumber, clamp, escapeHtml,
    debounce, downloadTextFile, toCSV, initials, sum, groupBy,
    daysAgoISO, inRange, startOfDay, endOfDay, normalizeSearch, matchesSearch,
    parseSize, parseSide, isPlainVariant,
  };
})(window);
