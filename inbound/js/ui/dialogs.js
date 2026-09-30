// Dialog-dialog aplikasi yang lebih besar (konflik, pratinjau restore, riwayat run,
// log aktivitas, diagnostik, pintasan). Semua dibangun dengan komponen dialog aksesibel.
import { h, button, nextId } from "../core/dom.js";
import { icon } from "../core/icons.js";
import { C } from "../core/util.js";
import { openDialog, choiceDialog } from "./components/dialog.js";
import { STATUS_META, periodLabel, displayCaseId } from "../domain/case-view.js";

const FIELD_ROWS = [
  ["Status", (f, c) => f.fields.status, (r) => r.status],
  ["Jenis case", (f) => f.context.caseType, (r) => r.case_type],
  ["Remark", (f) => f.fields.remark, (r) => r.remark],
  ["Tindakan", (f) => f.fields.actionTaken, (r) => r.action_taken],
  ["Penyesuaian QTY", (f) => f.fields.qtyAdj, (r) => r.qty_adj],
  ["Ket. QTY", (f) => f.fields.qtyAdjNote, (r) => r.qty_adj_note],
  ["Penyesuaian CBM", (f) => f.fields.cbmAdj, (r) => r.cbm_adj],
  ["Ket. CBM", (f) => f.fields.cbmAdjNote, (r) => r.cbm_adj_note],
  ["PIC", (f) => f.fields.pic, (r) => r.pic]
];

/** Konflik simpan: Muat versi terbaru | Bandingkan | Timpa (hanya supervisor/admin). */
export async function conflictDialog(err, input, canOverwrite) {
  const cur = err.current || {};
  for (;;) {
    const choice = await choiceDialog("Perubahan bertabrakan",
      h("div", { class: "gs-stack" },
        h("p", { class: "ib-dialog-text" }, err.userMessage),
        h("p", { class: "gs-hint" }, canOverwrite ? "Pilih cara melanjutkan." : "Muat versi terbaru lalu ulangi perubahan Anda. Hanya supervisor/admin yang dapat menimpa perubahan orang lain.")),
      [
        { label: "Bandingkan perubahan", value: "compare" },
        canOverwrite ? { label: "Timpa dengan versi saya", value: "overwrite", variant: "danger" } : null,
        { label: "Muat versi terbaru", value: "reload", variant: "primary", autofocus: true }
      ].filter(Boolean), { tone: "warning" });
    if (choice !== "compare") return choice || "reload";
    await openDialog({
      title: "Bandingkan perubahan", size: "lg", dismissValue: null,
      body: h("table", { class: "ib-compare ib-compare--diff" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Kolom"), h("th", { scope: "col" }, "Versi Anda (belum tersimpan)"), h("th", { scope: "col" }, "Versi server — " + (cur.user_name || "pengguna lain")))),
        h("tbody", null, FIELD_ROWS.map(([label, mine, theirs]) => {
          const a = mine(input), b = theirs(cur);
          const same = String(a === undefined || a === null ? "" : a) === String(b === undefined || b === null ? "" : b);
          return h("tr", { class: same ? null : "is-changed" }, h("th", { scope: "row" }, label), h("td", null, String(a === undefined || a === null ? "" : a) || "–"),
            h("td", null, String(b === undefined || b === null ? "" : b) || "–", same ? null : h("span", { class: "gs-sr-only" }, " (berbeda)")));
        }))),
      actions: [{ label: "Kembali", value: null, variant: "primary", autofocus: true }]
    });
  }
}

/** Pratinjau restore: pilih case mana yang dipulihkan. Resolve Set id terpilih atau null. */
export async function restorePreviewDialog(preview) {
  const sel = new Set(preview.diff.items.filter((i) => i.defaultApply).map((i) => i.id));
  const KIND = { "new": ["Baru", "success"], "identical": ["Sama", null], "incoming-newer": ["Cadangan lebih baru", "warning"], "incoming-older": ["Cadangan lebih lama", "danger"] };
  const count = h("b", null, String(sel.size));
  const rows = preview.diff.items.map((it) => {
    const id = nextId("rs");
    const cb = h("input", { type: "checkbox", id, checked: sel.has(it.id), disabled: it.kind === "identical",
      onChange: (e) => { if (e.target.checked) sel.add(it.id); else sel.delete(it.id); count.textContent = String(sel.size); } });
    const k = KIND[it.kind];
    return h("tr", null,
      h("td", null, cb),
      h("td", null, h("label", { for: id, class: "gs-mono" }, displayCaseId(it.id)), h("div", { class: "gs-hint" }, it.incoming.brand)),
      h("td", null, h("span", { class: "gs-badge" + (k[1] ? " gs-badge--" + k[1] : "") }, k[0])),
      h("td", null, (STATUS_META[it.incoming.status] || {}).label || it.incoming.status),
      h("td", null, it.current ? ((STATUS_META[it.current.status] || {}).label || it.current.status) : "—"),
      h("td", { class: "ib-clip", title: it.incoming.remark || "" }, it.incoming.remark || ""));
  });
  const c = preview.diff.counts;
  const ok = await openDialog({
    title: "Pratinjau pemulihan case", size: "lg", dismissValue: false,
    body: h("div", { class: "gs-stack" },
      h("p", { class: "ib-dialog-text" }, "Berkas ", h("b", null, preview.fileName), " — format ", preview.format, ", ", preview.count + " case",
        preview.header.exportedBy ? " · dicadangkan oleh " + preview.header.exportedBy : "", preview.header.exportedAt ? " · " + C.fmtStamp(preview.header.exportedAt) : "",
        preview.header.period ? " · periode " + periodLabel(preview.header.period) : ""),
      h("div", { class: "ib-restore-counts" },
        ["new", "incoming-newer", "incoming-older", "identical"].map((k) => h("span", { class: "gs-badge" + (KIND[k][1] ? " gs-badge--" + KIND[k][1] : "") }, KIND[k][0] + ": " + (c[k] || 0)))),
      preview.skipped ? h("div", { class: "ib-inline-alert is-warning" }, icon("warning"), preview.skipped + " entri tidak valid dilewati.") : null,
      h("p", { class: "gs-hint" }, "Case yang dicentang akan ditulis ke server dengan pemeriksaan versi. Cadangan yang lebih lama dari data server tidak dicentang secara bawaan."),
      h("div", { class: "gs-table-wrap ib-restore-table" }, h("table", { class: "gs-table gs-table--compact" },
        h("thead", null, h("tr", null, ["", "Case", "Perbandingan", "Status cadangan", "Status server", "Remark"].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", null, rows))),
      h("p", null, "Dipilih: ", count, " case")),
    actions: [{ label: "Batal", value: false }, { label: "Pulihkan yang dipilih", value: true, variant: "primary", autofocus: true }]
  });
  return ok ? sel : null;
}

export function runsDialog(runs, error) {
  return openDialog({
    title: "Riwayat run rekonsiliasi", size: "lg", dismissValue: null,
    body: error ? h("div", { class: "gs-error-state" }, h("p", { class: "gs-error-title" }, "Riwayat run belum tersedia"), h("p", { class: "gs-error-desc" }, error)) :
      !runs.length ? h("div", { class: "gs-empty" }, h("p", { class: "gs-empty-title" }, "Belum ada run tercatat.")) :
      h("div", { class: "gs-table-wrap" }, h("table", { class: "gs-table gs-table--compact" },
        h("thead", null, h("tr", null, ["Waktu", "Oleh", "Periode", "Status", "Adidas", "Nike", "Berkas"].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", null, runs.map((r) => {
          const s = r.summary || {}, a = s.adidas, n = s.nike;
          return h("tr", null, h("td", { class: "gs-mono" }, C.fmtStamp(r.created_at)), h("td", null, r.created_by_name || "-"), h("td", null, periodLabel(r.period_key) || "-"),
            h("td", null, s.overall ? s.overall.status : r.status),
            h("td", { class: "gs-num" }, a ? a.total + " / " + a.abnormal + " abn" : "—"), h("td", { class: "gs-num" }, n ? n.total + " / " + n.abnormal + " abn" : "—"),
            h("td", null, (r.inbound_run_files || []).map((f) => f.file_type.toUpperCase() + ": " + f.file_name).join(" · ")));
        })))),
    actions: [{ label: "Tutup", value: null, variant: "primary", autofocus: true }]
  });
}

export function activityDialog(items, error) {
  const LABEL = { reconcile: "Rekonsiliasi dijalankan", export_full: "Export lengkap", export_filtered: "Export hasil filter", backup_export: "Cadangan case diunduh",
    backup_restore: "Case dipulihkan dari cadangan", session_create: "Sesi dibuat", session_join: "Mengikuti sesi", session_takeover: "Ambil alih sesi",
    session_close: "Sesi ditutup", import: "Berkas diimpor", cases_delete_all: "Semua case dihapus", error: "Error" };
  return openDialog({
    title: "Log aktivitas tim", size: "lg", dismissValue: null,
    body: error ? h("div", { class: "gs-error-state" }, h("p", { class: "gs-error-title" }, "Log aktivitas belum tersedia"), h("p", { class: "gs-error-desc" }, error)) :
      !items.length ? h("div", { class: "gs-empty" }, h("p", { class: "gs-empty-title" }, "Belum ada aktivitas tercatat.")) :
      h("ol", { class: "ib-timeline" }, items.map((a) => h("li", null, h("span", { class: "ib-tl-dot", "aria-hidden": "true" }),
        h("div", null, h("div", { class: "ib-tl-head" }, h("b", null, LABEL[a.event] || a.event)),
          h("div", { class: "ib-tl-meta" }, (a.actor_name || "-") + " · " + C.fmtStamp(a.created_at)),
          a.detail ? h("div", { class: "gs-hint gs-mono" }, Object.keys(a.detail).map((k) => k + ": " + (typeof a.detail[k] === "object" ? JSON.stringify(a.detail[k]) : a.detail[k])).join(" · ")) : null)))),
    actions: [{ label: "Tutup", value: null, variant: "primary", autofocus: true }]
  });
}

export function diagnosticsDialog(info, logText) {
  const ta = h("textarea", { class: "gs-textarea gs-mono ib-log", readonly: true, rows: "12", "aria-label": "Log teknis" }, logText || "(kosong)");
  return openDialog({
    title: "Diagnostik", size: "lg", dismissValue: null,
    body: h("div", { class: "gs-stack" },
      h("dl", { class: "ib-kv" }, Object.keys(info).map((k) => h("div", null, h("dt", null, k), h("dd", { class: "gs-mono" }, String(info[k]))))),
      h("p", { class: "gs-hint" }, "Log teknis ini hanya ada di browser Anda (tanpa password/token). Salin dan kirim ke tim IT bila diminta."),
      ta),
    actions: [
      { label: "Salin log", value: "copy" },
      { label: "Tutup", value: null, variant: "primary", autofocus: true }
    ],
    onMount: ({ buttons }) => {
      buttons[0].onclick = (e) => {
        e.stopImmediatePropagation();
        const text = "INFO\n" + Object.keys(info).map((k) => k + ": " + info[k]).join("\n") + "\n\nLOG\n" + (logText || "");
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { buttons[0].textContent = "Tersalin"; }, () => { ta.select(); });
      };
    }
  });
}

export function shortcutsDialog() {
  const rows = [["/", "Fokus ke pencarian"], ["↑ / ↓", "Pindah baris tabel"], ["Home / End", "Baris pertama / terakhir di halaman"],
    ["PageUp / PageDown", "Halaman sebelumnya / berikutnya"], ["Enter / Spasi", "Buka detail NOPEN"], ["Esc", "Tutup detail / dialog"],
    ["Tab / Shift+Tab", "Berpindah kontrol (fokus terkunci di dalam dialog & detail)"]];
  return openDialog({
    title: "Pintasan keyboard", dismissValue: null,
    body: h("table", { class: "ib-compare" }, h("tbody", null, rows.map(([k, d]) => h("tr", null, h("th", { scope: "row" }, h("kbd", null, k)), h("td", null, d))))),
    actions: [{ label: "Tutup", value: null, variant: "primary", autofocus: true }]
  });
}

export function sessionFoundDialog(s, sourcesText) {
  return openDialog({
    title: "Sesi aktif ditemukan", dismissValue: "dismiss", tone: "info",
    body: h("div", { class: "gs-stack" },
      h("p", { class: "ib-dialog-text" }, "Rekonsiliasi Inbound sedang dikerjakan oleh ", h("b", null, s.owner_name || "-"), "."),
      h("dl", { class: "ib-kv" },
        h("div", null, h("dt", null, "Periode"), h("dd", null, periodLabel(s.period_key) || "-")),
        h("div", null, h("dt", null, "Berkas sumber"), h("dd", null, sourcesText || "-")),
        h("div", null, h("dt", null, "Dimulai"), h("dd", null, C.fmtStamp(s.started_at))),
        h("div", null, h("dt", null, "Aktivitas owner"), h("dd", null, C.fmtStamp(s.last_activity_at))))),
    actions: [{ label: "Kerja sendiri", value: "dismiss" }, { label: "Ikuti sesi", value: "join", variant: "primary", autofocus: true }]
  });
}

export { button };
