// Pembangun DOM yang aman: semua teks dimasukkan sebagai text node, tidak ada
// innerHTML untuk data. Atribut on* ditolak supaya tidak ada jalur injeksi skrip.
import { icon } from "./icons.js";

const BOOL_ATTRS = new Set(["hidden", "disabled", "checked", "selected", "readonly", "required", "open", "multiple"]);

/**
 * h("button", { class: "gs-btn", onClick: fn, "aria-label": "Tutup" }, "teks", childNode, [lebih, banyak])
 * - key diawali "on" + huruf besar -> event listener (bukan atribut).
 * - `dataset: {x: 1}` -> data-x="1"; `style: {…}` -> style properti.
 * - nilai null/undefined/false -> atribut tidak dipasang.
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k.length > 2 && k[0] === "o" && k[1] === "n" && k[2] === k[2].toUpperCase()) {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "class" || k === "className") {
        el.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : v;
      } else if (k === "dataset") {
        for (const d of Object.keys(v)) if (v[d] !== null && v[d] !== undefined) el.dataset[d] = String(v[d]);
      } else if (k === "style" && typeof v === "object") {
        Object.assign(el.style, v);
      } else if (k === "value" && (tag === "input" || tag === "textarea" || tag === "select")) {
        el.value = String(v);
      } else if (/^on/i.test(k)) {
        throw new Error("Atribut event inline tidak diizinkan: " + k);
      } else if (BOOL_ATTRS.has(k)) {
        if (v) el.setAttribute(k, "");
      } else {
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Event delegation: satu listener di root untuk semua elemen yang cocok selector. */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const t = e.target instanceof Element ? e.target.closest(selector) : null;
    if (t && root.contains(t)) handler(e, t);
  });
}

/** Tombol standar design system dengan ikon opsional. */
export function button(label, opts) {
  opts = opts || {};
  const cls = ["gs-btn"].concat(opts.variant ? ["gs-btn--" + opts.variant] : [], opts.size ? ["gs-btn--" + opts.size] : [], opts.class ? [opts.class] : []);
  return h("button", Object.assign({ type: "button", class: cls }, opts.attrs || {}, { onClick: opts.onClick }),
    opts.icon ? icon(opts.icon) : null, opts.iconOnly ? h("span", { class: "gs-sr-only" }, label) : label);
}

/** Badge status yang tidak hanya mengandalkan warna: selalu ada ikon + teks. */
export function badge(text, tone, iconName) {
  return h("span", { class: ["gs-badge", tone ? "gs-badge--" + tone : null] }, iconName ? icon(iconName, 12) : null, text);
}

// ---------- fokus & aksesibilitas ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary';

export function focusables(root) {
  return $$(FOCUSABLE, root).filter((el) => el === document.activeElement || (!el.hidden && el.getClientRects().length > 0));
}

/** Kunci fokus di dalam container (dialog/drawer). Mengembalikan fungsi pelepas. */
export function trapFocus(container, opts) {
  opts = opts || {};
  const previous = document.activeElement;
  function onKey(e) {
    if (e.key === "Escape" && opts.onEscape) { e.stopPropagation(); opts.onEscape(e); return; }
    if (e.key !== "Tab") return;
    const list = focusables(container);
    if (!list.length) { e.preventDefault(); container.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener("keydown", onKey);
  const initial = opts.initialFocus || focusables(container)[0] || container;
  setTimeout(() => { try { initial.focus({ preventScroll: true }); } catch (e) { /* elemen sudah hilang */ } }, 20);
  return function release(restore) {
    container.removeEventListener("keydown", onKey);
    const target = restore || previous;
    if (target && typeof target.focus === "function" && document.contains(target)) {
      try { target.focus({ preventScroll: true }); } catch (e) { /* abaikan */ }
    }
  };
}

let liveRegion = null, liveAssertive = null;
/** Umumkan pesan status ke pembaca layar (aria-live). */
export function announce(message, assertive) {
  if (!liveRegion) {
    liveRegion = h("div", { class: "gs-sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    liveAssertive = h("div", { class: "gs-sr-only", role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
    document.body.append(liveRegion, liveAssertive);
  }
  const target = assertive ? liveAssertive : liveRegion;
  target.textContent = "";
  setTimeout(() => { target.textContent = message; }, 30);
}

let uid = 0;
export function nextId(prefix) { uid++; return (prefix || "ib") + "-" + uid; }
