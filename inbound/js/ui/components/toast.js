// Toast non-blocking: success | info | warning | error. Error bisa punya tombol
// "Coba lagi". Diumumkan ke pembaca layar (role=status / role=alert).
import { h } from "../../core/dom.js";
import { icon } from "../../core/icons.js";

const TYPE = {
  success: { cls: "ok", icon: "checkCircle", role: "status", label: "Berhasil" },
  info: { cls: "info", icon: "info", role: "status", label: "Info" },
  warning: { cls: "warn", icon: "warning", role: "status", label: "Perhatian" },
  error: { cls: "err", icon: "error", role: "alert", label: "Gagal" }
};

function wrap() {
  let w = document.getElementById("ibToastWrap");
  if (!w) {
    w = h("div", { id: "ibToastWrap", class: "glt-toast-wrap ib-toast-wrap", "aria-label": "Notifikasi" });
    document.body.appendChild(w);
  }
  return w;
}

/**
 * @param {string} message
 * @param {'success'|'info'|'warning'|'error'} type
 * @param {{timeout?:number, action?:{label:string, onClick:Function}, detail?:string}} opts
 */
export function toast(message, type, opts) {
  opts = opts || {};
  const t = TYPE[type] || TYPE.info;
  const timeout = opts.timeout !== undefined ? opts.timeout : (type === "error" ? 12000 : (type === "warning" ? 9000 : 5000));
  let timer = null;
  const close = () => { clearTimeout(timer); el.remove(); };
  const el = h("div", { class: "glt-toast ib-toast " + t.cls, role: t.role },
    h("span", { class: "ib-toast-icon" }, icon(t.icon, 18)),
    h("div", { class: "glt-toast-msg" },
      h("span", { class: "gs-sr-only" }, t.label + ": "),
      message,
      opts.detail ? h("div", { class: "ib-toast-detail" }, opts.detail) : null,
      opts.action ? h("div", { class: "ib-toast-actions" },
        h("button", { type: "button", class: "gs-btn gs-btn--sm", onClick: () => { close(); opts.action.onClick(); } }, opts.action.label)) : null),
    h("button", { type: "button", class: "glt-toast-x ib-toast-x", "aria-label": "Tutup notifikasi", onClick: close }, icon("x", 14)));
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => { if (timeout) timer = setTimeout(close, 3000); });
  wrap().appendChild(el);
  if (timeout) timer = setTimeout(close, timeout);
  return { close };
}
