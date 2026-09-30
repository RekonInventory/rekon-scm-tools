// Menu tombol (role=menu) dengan navigasi keyboard: panah atas/bawah, Home/End,
// Escape menutup & mengembalikan fokus ke tombol.
import { h, nextId } from "../../core/dom.js";
import { icon } from "../../core/icons.js";

/**
 * @param {{label:string, icon?:string, iconOnly?:boolean, variant?:string, items:() => Array<{label, icon?, onSelect, danger?, disabled?, hint?}|'sep'>}} opts
 */
export function menuButton(opts) {
  const menuId = nextId("menu");
  const btn = h("button", { type: "button", class: ["gs-btn", opts.variant ? "gs-btn--" + opts.variant : null, "gs-btn--sm"],
    "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId },
    opts.icon ? icon(opts.icon) : null, opts.iconOnly ? h("span", { class: "gs-sr-only" }, opts.label) : opts.label,
    opts.iconOnly ? null : icon("chevronDown", 14));
  const menu = h("div", { class: "ib-menu", id: menuId, role: "menu", hidden: true, "aria-label": opts.label });
  const wrap = h("div", { class: "ib-menu-wrap" }, btn, menu);

  function items() { return Array.from(menu.querySelectorAll('[role="menuitem"]:not([disabled])')); }
  function close(focusBtn) {
    if (menu.hidden) return;
    menu.hidden = true; btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside, true);
    if (focusBtn) btn.focus();
  }
  function outside(e) { if (!wrap.contains(e.target)) close(false); }
  function open() {
    menu.textContent = "";
    opts.items().forEach((it) => {
      if (it === "sep") { menu.appendChild(h("div", { class: "ib-menu-sep", role: "separator" })); return; }
      menu.appendChild(h("button", { type: "button", role: "menuitem", class: ["ib-menu-item", it.danger ? "is-danger" : null], disabled: !!it.disabled, tabindex: "-1",
        title: it.hint || null, onClick: () => { close(true); it.onSelect(); } },
        it.icon ? icon(it.icon) : h("span", { class: "ib-menu-noicon" }), h("span", null, it.label), it.hint && it.disabled ? h("span", { class: "gs-sr-only" }, " (" + it.hint + ")") : null));
    });
    menu.hidden = false; btn.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", outside, true);
    const first = items()[0]; if (first) first.focus();
  }
  btn.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown") { e.preventDefault(); open(); } });
  menu.addEventListener("keydown", (e) => {
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0] && list[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1] && list[list.length - 1].focus(); }
    else if (e.key === "Tab") close(false);
  });
  return wrap;
}
