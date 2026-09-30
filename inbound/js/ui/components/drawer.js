// Drawer kanan untuk detail NOPEN. Tabel tetap terlihat di belakang (overlay
// tipis), fokus dikunci di dalam drawer, Escape menutup, fokus kembali ke baris
// asal. Konten bisa diganti tanpa menutup (navigasi NOPEN sebelumnya/berikutnya).
import { h, trapFocus, nextId, replace } from "../../core/dom.js";
import { icon } from "../../core/icons.js";

export function createDrawer(opts) {
  opts = opts || {};
  const titleId = nextId("drw-t"), subId = nextId("drw-s");
  const title = h("h2", { class: "gs-drawer-title", id: titleId });
  const sub = h("p", { class: "gs-drawer-sub", id: subId });
  const headExtra = h("div", { class: "ib-drawer-head-extra" });
  const body = h("div", { class: "gs-drawer-body ib-drawer-body" });
  const foot = h("div", { class: "gs-drawer-foot ib-drawer-foot", hidden: true });
  const panel = h("aside", { class: "gs-drawer ib-drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": subId, tabindex: "-1" },
    h("div", { class: "gs-drawer-head" },
      h("div", { class: "ib-drawer-titles" }, title, sub),
      headExtra,
      h("button", { type: "button", class: "gs-drawer-close", "aria-label": "Tutup detail (Esc)", onClick: () => api.close() }, icon("x", 18))),
    body, foot);
  const overlay = h("div", { class: "gs-drawer-overlay ib-drawer-overlay", onMousedown: () => api.close() });
  let release = null, open = false, returnTo = null;

  const api = {
    isOpen: () => open,
    body, foot, headExtra,
    setHeader(t, s) { title.textContent = t || ""; sub.textContent = s || ""; },
    setContent(node) { replace(body, node); body.scrollTop = 0; },
    setFooter(nodes) { replace(foot, nodes || []); foot.hidden = !nodes || (Array.isArray(nodes) && !nodes.length); },
    open(returnFocus) {
      returnTo = returnFocus || document.activeElement;
      if (!open) {
        document.body.append(overlay, panel);
        document.body.classList.add("ib-drawer-open");
        release = trapFocus(panel, { onEscape: () => api.close(), initialFocus: panel });
        open = true;
      }
    },
    close() {
      if (!open) return;
      open = false;
      overlay.remove(); panel.remove();
      document.body.classList.remove("ib-drawer-open");
      if (release) release(returnTo);
      if (opts.onClose) opts.onClose();
    }
  };
  return api;
}
