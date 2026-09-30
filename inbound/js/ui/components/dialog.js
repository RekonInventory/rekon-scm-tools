// Dialog modal aksesibel (role=dialog, aria-modal, focus trap, Escape, fokus kembali
// ke pemicu). Pengganti alert/confirm/prompt native.
import { h, trapFocus, nextId } from "../../core/dom.js";
import { icon } from "../../core/icons.js";

/**
 * @param {{title:string, body:(Node|string|Array), actions:Array<{label, value, variant?, autofocus?, disabled?}>,
 *          dismissValue?:any, size?:'sm'|'md'|'lg', tone?:'danger'|'warning'|'info', onMount?:Function}} opts
 * @returns {Promise<any>} value dari tombol yang dipilih
 */
export function openDialog(opts) {
  return new Promise((resolve) => {
    const titleId = nextId("dlg-t"), descId = nextId("dlg-d");
    let release = null, done = false;
    const buttons = (opts.actions || []).map((a) => h("button", {
      type: "button", class: ["gs-btn", a.variant ? "gs-btn--" + a.variant : null], dataset: { v: String(a.value) },
      disabled: a.disabled || false, onClick: () => close(a.value)
    }, a.label));
    const toneIcon = opts.tone === "danger" ? "warning" : (opts.tone === "warning" ? "warning" : (opts.tone === "info" ? "info" : null));
    const box = h("div", { class: ["gs-modal", "ib-dialog", opts.size ? "ib-dialog--" + opts.size : null], role: opts.tone === "danger" ? "alertdialog" : "dialog",
      "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": descId, tabindex: "-1" },
      h("div", { class: "gs-modal-head" },
        toneIcon ? h("span", { class: "ib-dialog-icon ib-tone-" + opts.tone }, icon(toneIcon, 20)) : null,
        h("h2", { class: "ib-dialog-title", id: titleId }, opts.title || "Konfirmasi"),
        h("button", { type: "button", class: "gs-drawer-close", "aria-label": "Tutup dialog", onClick: () => close(opts.dismissValue) }, icon("x", 16))),
      h("div", { class: "gs-modal-body", id: descId }, typeof opts.body === "string" ? h("p", { class: "ib-dialog-text" }, opts.body) : opts.body),
      buttons.length ? h("div", { class: "gs-modal-foot" }, buttons) : null);
    const overlay = h("div", { class: "gs-modal-overlay ib-dialog-overlay", onMousedown: (e) => { if (e.target === overlay) close(opts.dismissValue); } }, box);

    function close(v) {
      if (done) return;
      done = true;
      overlay.remove();
      if (release) release(opts.returnFocus);
      resolve(v);
    }
    document.body.appendChild(overlay);
    const auto = (opts.actions || []).findIndex((a) => a.autofocus);
    release = trapFocus(box, { onEscape: () => close(opts.dismissValue), initialFocus: opts.initialFocus || (auto >= 0 ? buttons[auto] : null) });
    if (opts.onMount) opts.onMount({ box, buttons, close });
  });
}

export function confirmDialog(message, opts) {
  opts = opts || {};
  return openDialog({
    title: opts.title || "Konfirmasi", body: message, tone: opts.danger ? "danger" : opts.tone, dismissValue: false,
    actions: [
      { label: opts.cancelLabel || "Batal", value: false, autofocus: !!opts.danger },
      { label: opts.okLabel || "Lanjutkan", value: true, variant: opts.danger ? "danger-solid" : "primary", autofocus: !opts.danger }
    ]
  });
}

/** Pilihan > 2 tombol. choices: [{label, value, variant}] */
export function choiceDialog(title, body, choices, opts) {
  return openDialog(Object.assign({ title, body, actions: choices, dismissValue: null }, opts || {}));
}

/** Minta user mengetik teks persis (untuk tindakan destruktif). */
export function typedConfirmDialog(message, mustType, opts) {
  opts = opts || {};
  const inputId = nextId("dlg-in");
  const input = h("input", { class: "gs-input", id: inputId, autocomplete: "off", spellcheck: "false", placeholder: "Ketik " + mustType });
  const body = h("div", { class: "gs-stack" },
    h("p", { class: "ib-dialog-text" }, message),
    h("label", { class: "gs-label", for: inputId }, "Ketik ", h("b", null, mustType), " untuk melanjutkan"),
    input);
  return openDialog({
    title: opts.title || "Konfirmasi tindakan berisiko", body, tone: "danger", dismissValue: false, initialFocus: input,
    actions: [{ label: "Batal", value: false }, { label: opts.okLabel || "Lanjutkan", value: true, variant: "danger-solid", disabled: true }],
    onMount: ({ buttons, close }) => {
      const ok = buttons[1];
      input.addEventListener("input", () => { ok.disabled = input.value.trim() !== mustType; });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !ok.disabled) { e.preventDefault(); close(true); } });
    }
  });
}

/** Ganti password (2 kolom + validasi). Resolve: password baru atau null. */
export function passwordDialog() {
  const a = h("input", { class: "gs-input", type: "password", id: nextId("pw"), autocomplete: "new-password", minlength: "6" });
  const b = h("input", { class: "gs-input", type: "password", id: nextId("pw"), autocomplete: "new-password" });
  const err = h("div", { class: "gs-error-text", role: "alert" });
  const body = h("div", { class: "gs-stack" },
    h("label", { class: "gs-label", for: a.id }, "Password baru (minimal 6 karakter, sama dengan aturan akun)"), a,
    h("label", { class: "gs-label", for: b.id }, "Ulangi password baru"), b, err);
  let value = null;
  return openDialog({
    title: "Ganti password", body, dismissValue: null, initialFocus: a,
    actions: [{ label: "Batal", value: null }, { label: "Simpan password", value: "ok", variant: "primary" }],
    onMount: ({ buttons, close }) => {
      const ok = buttons[1];
      const check = () => {
        const msg = a.value.length < 6 ? "Password minimal 6 karakter." : (a.value !== b.value ? "Kedua password belum sama." : "");
        err.textContent = (a.value || b.value) ? msg : "";
        a.setAttribute("aria-invalid", msg && a.value.length < 6 ? "true" : "false");
        return !msg;
      };
      ok.onclick = (e) => { e.stopImmediatePropagation(); if (check()) { value = a.value; close("ok"); } };
      [a, b].forEach((x) => x.addEventListener("input", check));
      b.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } });
    }
  }).then((r) => (r === "ok" ? value : null));
}
