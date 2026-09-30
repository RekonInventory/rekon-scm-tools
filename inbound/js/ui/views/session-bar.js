// Bar sesi kolaborasi: owner, peserta (presence), status koneksi, mode ikut,
// unduh berkas sumber, ambil alih bila owner tidak aktif, tutup/berhenti.
import { h, replace, button } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { periodLabel } from "../../domain/case-view.js";

export function mountSessionBar(root, app) {
  const { store, actions } = app;

  function render() {
    const sess = store.get().session || {};
    const row = sess.row;
    if (!row) { root.hidden = true; replace(root); return; }
    root.hidden = false;
    const isOwner = sess.role === "OWNER";
    const stale = sess.stale;
    const people = [];
    Object.keys(sess.presence || {}).forEach((k) => {
      const arr = sess.presence[k] || [];
      if (arr.length) people.push(arr[arr.length - 1]);
    });
    if (!people.length) people.push({ name: row.owner_name, role: "OWNER" });
    const conn = sess.connection || "idle";
    const connLabel = { connected: "Tersambung", connecting: "Menghubungkan…", reconnecting: "Menyambung ulang…", idle: "Terputus" }[conn] || conn;
    const src = row.source_names || {}, files = row.source_files || {};

    replace(root,
      h("div", { class: ["ib-session", stale ? "is-stale" : null], role: "region", "aria-label": "Sesi kolaborasi" },
        h("div", { class: "ib-session-id" },
          h("span", { class: "ib-live-dot", "aria-hidden": "true" }),
          h("span", { class: "ib-session-tag" }, "SESI BERSAMA"),
          h("span", { class: "ib-session-period" }, row.period_key ? periodLabel(row.period_key) : "Rekonsiliasi Inbound"),
          h("span", { class: "gs-status", dataset: { state: conn === "connected" ? "connected" : (conn === "idle" ? "offline" : "syncing") } }, connLabel)),
        h("dl", { class: "ib-session-fields" },
          h("div", null, h("dt", null, "Owner"), h("dd", null, row.owner_name || "-", isOwner ? " (Anda)" : "")),
          h("div", null, h("dt", null, "Peserta"), h("dd", { class: "ib-people" },
            people.map((p) => h("span", { class: ["ib-person", p.name === row.owner_name ? "is-owner" : null] }, icon("user", 12), p.name || "?", p.name === row.owner_name ? h("span", { class: "gs-sr-only" }, " (owner)") : null)))),
          h("div", null, h("dt", null, "Berkas sumber"), h("dd", { class: "ib-sources" },
            ["scm", "ior", "nike"].filter((k) => src[k]).map((k) => files[k]
              ? h("button", { type: "button", class: "ib-linkbtn", onClick: () => actions.downloadSource(k), title: "Unduh berkas asli" }, icon("download", 12), src[k])
              : h("span", null, src[k])).concat(!src.scm && !src.ior && !src.nike ? ["—"] : [])))),
        h("div", { class: "ib-session-actions" },
          !isOwner ? h("label", { class: "ib-follow" },
            h("span", { class: "gs-label" }, "Mode ikut"),
            h("select", { class: "gs-select gs-select--sm", "aria-label": "Mode mengikuti sesi", onChange: (e) => actions.setFollowMode(e.target.value) },
              h("option", { value: "data", selected: sess.followMode !== "view" }, "Ikuti data"),
              h("option", { value: "view", selected: sess.followMode === "view" }, "Ikuti tampilan owner"))) : null,
          !isOwner && stale ? button("Ambil alih sesi", { variant: "primary", size: "sm", icon: "refresh", onClick: actions.takeoverSession }) : null,
          !isOwner ? button("Berhenti mengikuti", { size: "sm", onClick: actions.leaveSession }) : null,
          isOwner ? button("Tutup sesi", { size: "sm", onClick: actions.closeSession }) : null)),
      stale && !isOwner ? h("div", { class: "ib-inline-alert is-warning", role: "status" }, icon("warning"),
        "Owner tidak aktif lebih dari 2 menit. Anda dapat mengambil alih sesi untuk mengunggah ulang & menjalankan rekonsiliasi.") : null);
  }

  store.subscribe(["session"], render);
  render();
}
