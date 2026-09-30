// FINDINGS WORKSPACE: toolbar filter + tabel hasil + paginasi.
// Penyaringan inti memakai fungsi verbatim (baseFilteredRows/applyColumnFilters) supaya
// hasilnya identik dengan versi lama dan "Ikuti Tampilan" tetap kompatibel.
// Tambahan baru (aditif): urutkan kolom, filter jenis case, filter bulan, visibilitas kolom.
import { h, replace, button, nextId, announce } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { C } from "../../core/util.js";
import { FILTERS } from "../../domain/findings.js";
import { STATUS_META, rowTone, displayCaseId } from "../../domain/case-view.js";

export const PAGE_SIZE = 100;   // sama dengan versi lama

const COLS = [
  { key: "nopen", label: "NOPEN", always: true, sort: (r) => r.NOPEN },
  { key: "brand", label: "Brand", onlyAll: true, def: true, sort: (r) => r._brand || "" },
  { key: "temuan", label: "Temuan", def: true, sort: (r) => r.ISSUE || "" },
  { key: "shipper", label: "Shipper", def: true, sort: (r) => r.SHIPPER || "" },
  { key: "tglgrn", label: "Tgl GRN (SCM)", def: false, sort: (r) => (r.TGL_SCM ? +new Date(r.TGL_SCM) : 0) },
  { key: "tglunload", label: "Tgl unloading", def: false, sort: (r) => (r.TGL_UNLOAD ? +new Date(r.TGL_UNLOAD) : 0) },
  { key: "qty", label: "QTY SCM / pembanding", def: true, num: true, sort: (r) => r.QTY_SCM || 0 },
  { key: "dqty", label: "Δ QTY", def: true, num: true, sort: (r) => (r.QTY_DIFF === null || r.QTY_DIFF === undefined ? -Infinity : Math.abs(r.QTY_DIFF)) },
  { key: "cbm", label: "CBM SCM / pembanding", def: true, num: true, sort: (r) => r.CBM_SCM || 0 },
  { key: "dcbm", label: "Δ CBM", def: true, num: true, sort: (r) => (r.CBM_DIFF === null || r.CBM_DIFF === undefined ? -Infinity : Math.abs(r.CBM_DIFF)) },
  { key: "sopo", label: "SO / PO", def: false },
  { key: "baris", label: "Baris SCM / pembanding", def: false, num: true, sort: (r) => r.LINES_SCM || 0 },
  { key: "ket", label: "Keterangan", def: false },
  { key: "case", label: "Case", def: true, sort: (r) => r.__caseSort || "" }
];
const COL_PREF_KEY = "glt.inbound.v3:columns";

function loadCols() {
  try { const v = JSON.parse(localStorage.getItem(COL_PREF_KEY) || "null"); if (v && typeof v === "object") return v; } catch (e) { /* abaikan */ }
  const out = {}; COLS.forEach((c) => { out[c.key] = c.always || !!c.def; }); return out;
}
function saveCols(v) { try { localStorage.setItem(COL_PREF_KEY, JSON.stringify(v)); } catch (e) { /* abaikan */ } }

function monthKey(r) {
  const d = r.TGL_SCM || r.TGL_UNLOAD;
  if (!d) return "";
  const x = new Date(d);
  return x.getUTCFullYear() + "-" + String(x.getUTCMonth() + 1).padStart(2, "0");
}

export function mountFindings(root, app) {
  const { store, actions } = app;
  let colVis = loadCols();
  let colMenuOpen = false, advOpen = false;
  let searchTimer = null;
  let focusRowIndex = 0;
  const searchId = nextId("q"), tableId = "ibFindingsTable";

  /** Baris final yang tampil (dipakai juga untuk export hasil filter & navigasi drawer). */
  function visibleRows() {
    const s = store.get(), v = s.view, logic = app.logic;
    if (!s.result || !logic.currentPack()) return [];
    let rows = logic.filteredRows();
    if (v.mode === "nopen") {
      if (v.caseType) rows = rows.filter((r) => app.cases.store.getAllForNopen(logic.rowBrand(r), r.NOPEN).some((c) => c.caseType === v.caseType));
      if (v.month) rows = rows.filter((r) => monthKey(r) === v.month);
      if (v.sort && v.sort.key) {
        const col = COLS.find((c) => c.key === v.sort.key);
        if (col && col.sort) {
          if (col.key === "case") rows.forEach((r) => { const cs = app.cases.store.getAllForNopen(logic.rowBrand(r), r.NOPEN); r.__caseSort = cs.length ? cs.map((c) => c.status).sort().join(",") : ""; });
          const dir = v.sort.dir === "desc" ? -1 : 1;
          rows = rows.slice().sort((a, b) => {
            const x = col.sort(a), y = col.sort(b);
            if (x < y) return -1 * dir; if (x > y) return 1 * dir;
            return a.NOPEN < b.NOPEN ? -1 : (a.NOPEN > b.NOPEN ? 1 : 0);
          });
        }
      }
    }
    return rows;
  }
  app.visibleRows = visibleRows;

  function caseCell(r, rb) {
    const cs = app.cases.store.getAllForNopen(rb, r.NOPEN);
    if (!cs.length) return h("span", { class: "ib-muted" }, r.ROW_STATUS === "ABNORMAL" ? "Belum ada case" : "—");
    if (cs.length === 1) {
      const c = cs[0], m = STATUS_META[c.status] || STATUS_META.OPEN;
      return h("div", { class: "ib-case-cell" },
        h("span", { class: "gs-badge gs-badge--" + m.tone }, icon(m.icon, 11), m.label),
        h("span", { class: "ib-case-sub" }, displayCaseId(c.id) + (c.pic ? " · " + c.pic : "")));
    }
    const counts = {}; cs.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return h("div", { class: "ib-case-cell" },
      h("span", { class: "gs-badge gs-badge--primary" }, icon("layers", 11), cs.length + " case"),
      h("span", { class: "ib-case-sub" }, ["OPEN", "IN PROGRESS", "CLOSED"].filter((st) => counts[st]).map((st) => counts[st] + " " + STATUS_META[st].label).join(" · ")));
  }

  function delta(diffRaw, adj, tol) {
    if (diffRaw === null || diffRaw === undefined) return h("span", { class: "ib-muted" }, "—");
    const dec = tol >= 0.1 ? 3 : 0, bad = Math.abs(diffRaw) > tol;
    if (!adj) return h("span", { class: bad ? "is-bad" : "is-ok" }, C.fmtNum(diffRaw, dec));
    const after = C.r3(diffRaw - adj), badAfter = Math.abs(after) > tol;
    return h("span", { title: "Selisih awal " + C.fmtNum(diffRaw, dec) + ", setelah penyesuaian " + C.fmtNum(after, dec) },
      h("s", { class: "ib-muted" }, C.fmtNum(diffRaw, dec)), " → ", h("span", { class: badAfter ? "is-bad" : "is-ok" }, C.fmtNum(after, dec)),
      h("span", { class: "gs-sr-only" }, " (disesuaikan)"));
  }

  function cells(r, rb, brandCol) {
    const cs = app.cases.store.getAllForNopen(rb, r.NOPEN);
    let qa = 0, ca = 0;
    cs.forEach((c) => { if (c.status !== "CLOSED") { qa += c.qtyAdj || 0; ca += c.cbmAdj || 0; } });
    const tone = rowTone(r);
    const out = {
      nopen: h("td", { class: "gs-mono ib-nopen" }, r.NOPEN),
      brand: h("td", null, rb === "ADIDAS" ? "Adidas" : "Nike"),
      temuan: h("td", { class: "ib-temuan" }, h("span", { class: "gs-badge gs-badge--" + tone.tone }, icon(tone.icon, 11), r.ROW_STATUS === "CLEAR" ? "Clear" : (r.ROW_STATUS === "HISTORICAL" ? "Historical" : r.ISSUE))),
      shipper: h("td", { class: "ib-clip", title: r.SHIPPER || "" }, r.SHIPPER || "—"),
      tglgrn: h("td", { class: "gs-mono" }, C.fmtDate(r.TGL_SCM ? new Date(r.TGL_SCM) : null)),
      tglunload: h("td", { class: "gs-mono" }, r.TGL_UNLOAD ? C.fmtDateRange(new Date(r.TGL_UNLOAD), r.TGL_UNLOAD_MAX ? new Date(r.TGL_UNLOAD_MAX) : null) : "—"),
      qty: h("td", { class: "gs-num" }, C.fmtNumFlag(r.QTY_SCM, r.QTY_SCM_INVALID), h("span", { class: "ib-sep" }, " / "), C.fmtNumFlag(r.QTY_CMP, r.QTY_CMP_INVALID)),
      dqty: h("td", { class: "gs-num" }, delta(r.QTY_DIFF, qa, C.QTY_TOL)),
      cbm: h("td", { class: "gs-num" }, C.fmtNumFlag(r.CBM_SCM, r.CBM_SCM_INVALID, 3), h("span", { class: "ib-sep" }, " / "), C.fmtNumFlag(r.CBM_CMP, r.CBM_CMP_INVALID, 3)),
      dcbm: h("td", { class: "gs-num" }, delta(r.CBM_DIFF, ca, C.CBM_TOL)),
      sopo: h("td", { class: "gs-mono ib-sopo" },
        h("div", { class: r.SO_DIFF ? "is-bad" : null }, "SO ", r.SO_SCM_TXT || "—", " | ", r.SO_CMP_TXT || "—"),
        h("div", { class: r.PO_DIFF ? "is-bad" : null }, "PO ", r.PO_SCM_TXT || "—", " | ", r.PO_CMP_TXT || "—")),
      baris: h("td", { class: "gs-num" }, r.LINES_SCM + " / " + r.LINES_CMP),
      ket: h("td", { class: "ib-ket" }, h("div", { class: "ib-clamp", title: r.EXPLANATION }, r.EXPLANATION)),
      case: h("td", null, caseCell(r, rb))
    };
    return COLS.filter((c) => colVisible(c, brandCol)).map((c) => out[c.key]);
  }

  function colVisible(c, brandCol) {
    if (c.onlyAll && !brandCol) return false;
    return c.always || !!colVis[c.key];
  }

  function header(brandCol, v) {
    return h("tr", null, COLS.filter((c) => colVisible(c, brandCol)).map((c) => {
      const sorted = v.sort && v.sort.key === c.key ? v.sort.dir : null;
      return h("th", { scope: "col", class: c.num ? "gs-num" : null, "aria-sort": sorted ? (sorted === "asc" ? "ascending" : "descending") : (c.sort ? "none" : null) },
        c.sort ? h("button", { type: "button", class: "ib-sort", onClick: () => actions.setSort(c.key) }, c.label,
          icon(sorted === "asc" ? "sortAsc" : sorted === "desc" ? "sortDesc" : "sort", 12),
          h("span", { class: "gs-sr-only" }, sorted ? (sorted === "asc" ? ", urut naik" : ", urut turun") : ", klik untuk mengurutkan")) : c.label);
    }));
  }

  function advancedPanel(v) {
    const logic = app.logic, defs = logic.tableFilterDefs();
    const active = Object.keys(v.colFilters || {}).filter((k) => v.colFilters[k] !== undefined && v.colFilters[k] !== "");
    return h("div", { class: "ib-adv", id: "ibAdvFilters", hidden: !advOpen },
      h("div", { class: "ib-adv-grid" }, defs.map((d) => {
        const id = nextId("cf");
        const opts = advOpen ? logic.filterOptionsFor(d) : [];
        const cur = v.colFilters[d.key] || "";
        return h("div", { class: "gs-field" },
          h("label", { class: "gs-label", for: id }, d.label),
          h("select", { class: "gs-select gs-select--sm", id, onChange: (e) => actions.setColFilter(d.key, e.target.value) },
            h("option", { value: "" }, "Semua"),
            opts.filter((o) => o !== "").map((o) => h("option", { value: o, selected: o === cur }, o.length > 40 ? o.slice(0, 40) + "…" : o)),
            cur && opts.indexOf(cur) === -1 ? h("option", { value: cur, selected: true }, cur) : null));
      })),
      active.length ? h("div", { class: "ib-adv-foot" }, button("Hapus semua filter kolom", { size: "sm", variant: "ghost", onClick: () => actions.clearColFilters() })) : null);
  }

  function toolbar(v, total) {
    const logic = app.logic;
    const pack = logic.currentPack();
    const cmpLabel = pack ? pack.cmpLabel : "IOR/DRR";
    const activeCol = Object.keys(v.colFilters || {}).filter((k) => v.colFilters[k] !== "" && v.colFilters[k] !== undefined);
    const defs = activeCol.length ? logic.tableFilterDefs() : [];
    const months = new Set(); (pack ? pack.main : []).forEach((r) => { const m = monthKey(r); if (m) months.add(m); });
    const filterSel = h("select", { class: "gs-select gs-select--sm", id: nextId("f"), "aria-label": "Status temuan", onChange: (e) => actions.setFilter(e.target.value), disabled: v.mode !== "nopen" },
      FILTERS.map((f) => h("option", { value: f[0], selected: v.filter === f[0] }, f[0] === "cmponly" ? "Hanya di " + cmpLabel : f[1])));
    const caseTypeSel = h("select", { class: "gs-select gs-select--sm", "aria-label": "Jenis case", onChange: (e) => actions.setView({ caseType: e.target.value, page: 0 }), disabled: v.mode !== "nopen" },
      h("option", { value: "" }, "Semua jenis case"),
      app.cases.store.CASE_TYPE.map((t) => h("option", { value: t, selected: v.caseType === t }, app.cases.store.CASE_TYPE_LABEL[t] || t)));
    const monthSel = h("select", { class: "gs-select gs-select--sm", "aria-label": "Periode (bulan)", onChange: (e) => actions.setView({ month: e.target.value, page: 0 }), disabled: v.mode !== "nopen" },
      h("option", { value: "" }, "Semua bulan"),
      Array.from(months).sort().map((m) => { const p = m.split("-"); return h("option", { value: m, selected: v.month === m }, C.BULAN_PANJANG[+p[1] - 1] + " " + p[0]); }));
    const search = h("input", { type: "search", class: "gs-input gs-input--sm ib-search", id: searchId, value: v.q || "", placeholder: "Cari NOPEN, shipper, keterangan, PIC…  ( / )",
      "aria-label": "Cari temuan", autocomplete: "off",
      onInput: (e) => { clearTimeout(searchTimer); const val = e.target.value; searchTimer = setTimeout(() => actions.setView({ q: val, page: 0 }), 200); } });

    const colMenuId = "ibColMenu";
    return h("div", { class: "ib-toolbar" },
      h("div", { class: "ib-toolbar-row" },
        h("div", { class: "ib-seg", role: "radiogroup", "aria-label": "Mode tampilan" },
          [["nopen", "Per NOPEN"], ["detail", "Detail SO/PO"]].map(([m, l]) => h("button", { type: "button", role: "radio", "aria-checked": String(v.mode === m), class: "ib-seg-btn",
            onClick: () => actions.setMode(m) }, l))),
        h("div", { class: "gs-input-group ib-search-wrap" }, h("span", { class: "ib-search-icon", "aria-hidden": "true" }, icon("search", 14)), search),
        filterSel, caseTypeSel, monthSel,
        h("div", { class: "gs-spacer" }),
        v.mode === "nopen" ? h("button", { type: "button", class: "gs-btn gs-btn--sm", "aria-expanded": String(advOpen), "aria-controls": "ibAdvFilters",
          onClick: () => { advOpen = !advOpen; render(); } }, icon("filter", 14), "Filter lanjutan", activeCol.length ? h("span", { class: "ib-chip-count" }, String(activeCol.length)) : null) : null,
        v.mode === "nopen" ? h("div", { class: "ib-menu-wrap" },
          h("button", { type: "button", class: "gs-btn gs-btn--sm", "aria-expanded": String(colMenuOpen), "aria-controls": colMenuId, onClick: () => { colMenuOpen = !colMenuOpen; render(); } }, icon("columns", 14), "Kolom"),
          h("div", { class: "ib-menu ib-colmenu", id: colMenuId, hidden: !colMenuOpen, role: "group", "aria-label": "Tampilkan kolom" },
            COLS.filter((c) => !c.always && !(c.onlyAll && v.brand !== "ALL")).map((c) => {
              const id = nextId("col");
              return h("label", { class: "ib-check", for: id }, h("input", { type: "checkbox", id, checked: !!colVis[c.key],
                onChange: (e) => { colVis = Object.assign({}, colVis, { [c.key]: e.target.checked }); saveCols(colVis); render(); } }), c.label);
            }))) : null,
        button("Export hasil filter", { size: "sm", icon: "download", attrs: { disabled: !total || store.get().busy.exporting }, onClick: actions.exportFiltered }),
        button("Reset filter", { size: "sm", variant: "ghost", icon: "refresh", onClick: actions.resetFilters })),
      v.mode === "nopen" && v.filter === "abnormal" ? h("div", { class: "ib-toolbar-row ib-substatus", role: "group", "aria-label": "Status case temuan abnormal" },
        h("span", { class: "gs-label" }, "Status temuan:"),
        ["OPEN", "IN PROGRESS", "CLOSED"].map((st) => h("button", { type: "button", class: "gs-chip", "aria-pressed": String(!!(v.abnormalStatus || {})[st]),
          onClick: () => actions.toggleAbnormalStatus(st) }, icon(STATUS_META[st].icon, 12), STATUS_META[st].label))) : null,
      activeCol.length ? h("div", { class: "ib-toolbar-row ib-active-filters", "aria-label": "Filter kolom aktif" },
        activeCol.map((k) => { const d = defs.find((x) => x.key === k); return h("button", { type: "button", class: "gs-chip", "aria-pressed": "true",
          "aria-label": "Hapus filter " + (d ? d.label : k) + ": " + v.colFilters[k], onClick: () => actions.setColFilter(k, "") },
          (d ? d.label : k) + ": " + v.colFilters[k], h("span", { class: "gs-chip-x", "aria-hidden": "true" }, "×")); })) : null,
      v.mode === "nopen" ? advancedPanel(v) : null);
  }

  function pager(page, pages, total) {
    if (pages <= 1) return h("div", { class: "gs-pager" }, h("span", { class: "gs-pager-info" }, C.fmtNum(total) + " baris"));
    const go = (p) => actions.setView({ page: Math.max(0, Math.min(pages - 1, p)) }, { focusTable: true });
    return h("nav", { class: "gs-pager", "aria-label": "Halaman tabel" },
      h("span", { class: "gs-pager-info", "aria-live": "polite" }, "Baris " + C.fmtNum(page * PAGE_SIZE + 1) + "–" + C.fmtNum(Math.min(total, (page + 1) * PAGE_SIZE)) + " dari " + C.fmtNum(total) + " · halaman " + (page + 1) + "/" + pages),
      button("Halaman pertama", { iconOnly: true, icon: "chevronLeft", size: "sm", attrs: { disabled: page === 0 }, onClick: () => go(0) }),
      button("Sebelumnya", { size: "sm", attrs: { disabled: page === 0 }, onClick: () => go(page - 1) }),
      button("Berikutnya", { size: "sm", attrs: { disabled: page >= pages - 1 }, onClick: () => go(page + 1) }),
      button("Halaman terakhir", { iconOnly: true, icon: "chevronRight", size: "sm", attrs: { disabled: page >= pages - 1 }, onClick: () => go(pages - 1) }));
  }

  function render(opts) {
    const s = store.get();
    if (!s.result) { root.hidden = true; replace(root); return; }
    root.hidden = false;
    const v = s.view, logic = app.logic, pack = logic.currentPack();
    const keepFocusSearch = document.activeElement && document.activeElement.id === searchId;
    const rows = pack ? visibleRows() : [];
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const page = Math.min(v.page || 0, pages - 1);
    const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const brandCol = v.brand === "ALL";
    const sel = s.selection;

    let table;
    if (!pack) {
      table = h("div", { class: "gs-empty" }, h("p", { class: "gs-empty-title" }, "Berkas untuk brand ini belum dimuat."));
    } else if (!rows.length) {
      table = h("div", { class: "gs-empty" },
        h("div", { class: "gs-empty-icon" }, icon("search", 16)),
        h("p", { class: "gs-empty-title" }, v.mode === "detail" ? "Tidak ada selisih rincian SO/PO" : "Tidak ada baris pada saringan ini"),
        h("p", { class: "gs-empty-desc" }, "Ubah kata kunci, status, atau filter kolom — atau reset semua filter."),
        h("div", { class: "gs-empty-actions" }, button("Reset filter", { size: "sm", onClick: actions.resetFilters })));
    } else if (v.mode === "detail") {
      table = h("div", { class: "gs-table-wrap ib-table-wrap" },
        h("table", { class: "gs-table gs-table--compact", id: tableId, "aria-labelledby": "ibFindingsTitle" },
          h("caption", { class: "gs-sr-only" }, "Detail pasangan SO/PO yang berbeda, " + rows.length + " baris"),
          h("thead", null, h("tr", null, (brandCol ? ["Brand"] : []).concat(["NOPEN", "Ada di", "SO", "PO", "Status NOPEN", "Temuan"]).map((l) => h("th", { scope: "col" }, l)))),
          h("tbody", null, slice.map((d) => h("tr", { tabindex: "-1", dataset: { nopen: d.NOPEN, brand: d._brand || v.brand } },
            brandCol ? h("td", null, d._brand === "ADIDAS" ? "Adidas" : "Nike") : null,
            h("td", { class: "gs-mono" }, d.NOPEN), h("td", null, h("span", { class: "gs-badge gs-badge--info" }, d.ADA_DI)),
            h("td", { class: "gs-mono" }, d.SO), h("td", { class: "gs-mono" }, d.PO), h("td", null, d.STATUS_NOPEN),
            h("td", null, h("span", { class: "gs-badge gs-badge--" + (d.ROW_STATUS === "INFO" ? "info" : "danger") }, d.ISSUE)))))));
    } else {
      table = h("div", { class: "gs-table-wrap ib-table-wrap" },
        h("table", { class: "gs-table ib-grid", id: tableId, role: "grid", "aria-readonly": "true", "aria-labelledby": "ibFindingsTitle", "aria-rowcount": String(rows.length + 1),
          "aria-describedby": "ibGridHelp" },
          h("thead", null, header(brandCol, v)),
          h("tbody", null, slice.map((r, i) => {
            const rb = logic.rowBrand(r);
            const statuses = r.ROW_STATUS === "ABNORMAL" ? logic.rowFindingStatuses(r, rb) : [];
            const allClosed = statuses.length > 0 && statuses.every((x) => x === "CLOSED");
            const selected = sel && sel.nopen === r.NOPEN && sel.brand === rb;
            return h("tr", { class: [r.ROW_STATUS === "ABNORMAL" && !allClosed ? "is-issue" : null, r.ROW_STATUS === "HISTORICAL" ? "is-historical" : null],
              tabindex: i === Math.min(focusRowIndex, slice.length - 1) ? "0" : "-1", "aria-selected": selected ? "true" : "false",
              "aria-rowindex": String(page * PAGE_SIZE + i + 2), dataset: { nopen: r.NOPEN, brand: rb, idx: String(i) } }, cells(r, rb, brandCol));
          }))),
        h("p", { class: "gs-sr-only", id: "ibGridHelp" }, "Gunakan panah atas/bawah untuk berpindah baris, Enter untuk membuka detail."));
    }

    replace(root,
      h("div", { class: "gs-card-head ib-findings-head" },
        h("div", null,
          h("h2", { class: "gs-card-title", id: "ibFindingsTitle" }, "Findings workspace"),
          h("p", { class: "gs-card-sub", "aria-live": "polite" }, C.fmtNum(rows.length) + " " + (v.mode === "detail" ? "pasangan SO/PO" : "NOPEN") + " · filter: " + logic.currentFilterLabel()))),
      h("div", { class: "gs-card-body ib-findings-body" },
        toolbar(v, rows.length),
        table,
        pack && rows.length ? pager(page, pages, rows.length) : null));

    if (keepFocusSearch) { const el = document.getElementById(searchId); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (e) { /* type=search */ } } }
    if (opts && opts.focusTable) focusRow(0);
  }

  function focusRow(i) {
    const tb = root.querySelector("#" + tableId + " tbody");
    if (!tb || !tb.rows.length) return;
    const idx = Math.max(0, Math.min(tb.rows.length - 1, i));
    Array.from(tb.rows).forEach((tr, j) => tr.setAttribute("tabindex", j === idx ? "0" : "-1"));
    focusRowIndex = idx;
    tb.rows[idx].focus();
  }

  // interaksi tabel (delegasi — satu listener untuk semua baris)
  root.addEventListener("click", (e) => {
    const tr = e.target.closest && e.target.closest("tbody tr[data-nopen]");
    if (!tr || e.target.closest("button, a, input, select")) return;
    focusRowIndex = +tr.dataset.idx || 0;
    actions.openNopen(tr.dataset.brand, tr.dataset.nopen, tr);
  });
  root.addEventListener("keydown", (e) => {
    const tr = e.target.closest && e.target.closest("tbody tr[data-nopen]");
    if (!tr) return;
    const i = +tr.dataset.idx || 0;
    if (e.key === "ArrowDown") { e.preventDefault(); focusRow(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusRow(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusRow(0); }
    else if (e.key === "End") { e.preventDefault(); focusRow(1e9); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); focusRowIndex = i; actions.openNopen(tr.dataset.brand, tr.dataset.nopen, tr); }
    else if (e.key === "PageDown") { e.preventDefault(); const v = store.get().view; actions.setView({ page: (v.page || 0) + 1 }, { focusTable: true }); }
    else if (e.key === "PageUp") { e.preventDefault(); const v = store.get().view; actions.setView({ page: Math.max(0, (v.page || 0) - 1) }, { focusTable: true }); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "") && !document.body.classList.contains("ib-drawer-open")) {
      const el = document.getElementById(searchId);
      if (el) { e.preventDefault(); el.focus(); announce("Kolom pencarian"); }
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (colMenuOpen && !e.target.closest(".ib-menu-wrap")) { colMenuOpen = false; render(); }
  });

  app.focusRowByNopen = function (brand, nopen) {
    const tb = root.querySelector("#" + tableId + " tbody");
    if (!tb) return null;
    const tr = Array.from(tb.rows).find((x) => x.dataset.nopen === nopen && x.dataset.brand === brand);
    return tr || null;
  };

  store.subscribe(["result", "view", "caseRev", "selection", "busy"], (st, keys) => render(keys.has("view") ? store.get().__renderOpts : null));
  render();
}
