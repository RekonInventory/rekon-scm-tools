// HEADER: judul modul + konteks (periode, sesi, sinkron, role) + aksi global.
import { h, replace, button } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { menuButton } from "../components/menu.js";
import { periodLabel, ROLE_LABEL, atLeast } from "../../domain/case-view.js";
import { C } from "../../core/util.js";

export function mountHeader(root, app) {
  const { store, actions } = app;

  function meta(label, value, iconName, state) {
    return h("div", { class: "ib-meta", dataset: { state: state || null } },
      h("span", { class: "ib-meta-label" }, iconName ? icon(iconName, 13) : null, label),
      h("span", { class: "ib-meta-value" }, value));
  }

  function render() {
    const s = store.get();
    const r = s.result;
    const sess = s.session || {};
    const role = s.role || "operator";
    const sync = s.sync || { state: "idle", at: null };
    const syncText = sync.state === "syncing" ? "Menyinkronkan…" : sync.state === "error" ? "Gagal sinkron" :
      sync.state === "synced" && sync.at ? "Tersinkron " + new Date(sync.at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "—";
    const sessText = !sess.row ? "Tidak ada sesi" : (sess.role === "OWNER" ? "Owner" : "Mengikuti " + (sess.row.owner_name || "")) +
      (sess.connection && sess.connection !== "connected" ? " · " + (sess.connection === "reconnecting" ? "menyambung ulang…" : "menghubungkan…") : "");

    const exportBtn = button("Export Excel", { variant: "primary", size: "sm", icon: "download", attrs: { disabled: !r || s.busy.exporting, "aria-busy": s.busy.exporting ? "true" : null }, onClick: actions.exportFull });
    if (s.busy.exporting) exportBtn.classList.add("gs-btn--loading");

    const more = menuButton({
      label: "Aksi lainnya", icon: "more", iconOnly: false, variant: null,
      items: () => [
        { label: "Cadangkan case (JSON)", icon: "archive", onSelect: actions.backupCases },
        { label: "Pulihkan case dari cadangan…", icon: "restore", onSelect: actions.restoreCases,
          disabled: !atLeast(role, "supervisor"), hint: "Khusus supervisor/admin" },
        "sep",
        { label: "Riwayat run rekonsiliasi", icon: "history", onSelect: actions.showRuns },
        { label: "Log aktivitas tim", icon: "activity", onSelect: actions.showActivity },
        { label: "Pintasan keyboard", icon: "keyboard", onSelect: actions.showShortcuts },
        { label: "Diagnostik (log teknis)", icon: "database", onSelect: actions.showDiagnostics },
        "sep",
        { label: "Buka versi lama (fallback)", icon: "link", onSelect: () => { window.location.href = "../Rekonsiliasi_Inbound.html"; } },
        "sep",
        { label: "Hapus semua case…", icon: "trash", danger: true, onSelect: actions.deleteAllCases,
          disabled: !atLeast(role, "supervisor"), hint: "Khusus supervisor/admin" }
      ]
    });

    replace(root,
      h("div", { class: "ib-header-main" },
        h("div", { class: "ib-header-titles" },
          h("nav", { class: "gs-crumbs", "aria-label": "Breadcrumb" }, h("span", null, "Operasional"), h("span", { "aria-hidden": "true" }, "/"), h("span", null, "Inbound")),
          h("h1", { class: "gs-page-title", id: "ibPageTitle" }, "Inbound Reconciliation"),
          h("p", { class: "gs-page-desc" }, "SCM ↔ IOR (Adidas) · SCM ↔ DRR (Nike) — per NOPEN, dua arah, dengan penelusuran histori.")),
        h("div", { class: "gs-page-actions" }, exportBtn, more)),
      h("div", { class: "ib-header-meta", role: "group", "aria-label": "Konteks kerja" },
        meta("Periode", r && r.periodKey ? periodLabel(r.periodKey) : "Belum ada rekonsiliasi", "clock"),
        meta("Sesi", sessText, "broadcast", sess.row ? (sess.connection === "connected" ? "ok" : "warn") : null),
        meta("Case", syncText, "database", sync.state === "error" ? "err" : (sync.state === "synced" ? "ok" : null)),
        meta("Role", ROLE_LABEL[role] || role, "shield"),
        r ? meta("Dibuat", C.fmtStamp(new Date(r.generated).toISOString()), "user") : null));
  }

  store.subscribe(["result", "session", "role", "sync", "busy"], render);
  render();
}
