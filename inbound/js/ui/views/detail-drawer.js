// DETAIL NOPEN (drawer kanan): ringkasan, perbandingan SCM vs IOR/DRR, penjelasan,
// sumber historis, daftar case, editor case (workflow OPEN -> IN PROGRESS -> CLOSED),
// penyesuaian, dan timeline audit immutable dari server.
// Logika simpan identik dengan saveCase() lama (field, PIC otomatis, qtyExpected utk
// ONLY_IN_SCM, context caseType/issueType/severity) — perbedaannya hanya jalur
// persistensi (RPC dengan optimistic concurrency) dan pemisahan Remark vs Tindakan.
import { h, replace, button, nextId, announce } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { C } from "../../core/util.js";
import { engine as E } from "../../domain/engine.js";
import { createDrawer } from "../components/drawer.js";
import { STATUS_FLOW, STATUS_META, SEVERITY_META, rowTone, displayCaseId, ageLabel, lastAction, describeEvent, ACTION_LABEL, periodLabel } from "../../domain/case-view.js";

export function createDetailDrawer(app) {
  const { store, actions } = app;
  const drawer = createDrawer({ onClose: () => {
    const last = current;
    current = null;
    store.set({ selection: null });
    // Baris tabel dirender ulang saat seleksi berubah -> kembalikan fokus ke baris baru yang sama.
    setTimeout(() => {
      const tr = last && app.focusRowByNopen ? app.focusRowByNopen(last.brand, last.nopen) : null;
      if (tr) { tr.setAttribute("tabindex", "0"); tr.focus({ preventScroll: false }); }
    }, 0);
  } });
  let current = null;          // {brand, nopen}
  let editing = null;          // {caseId|null, baseVersion, dirty}
  let timeline = { key: null, events: null, error: null, loading: false };
  const openSections = { ringkasan: true, data: true, penjelasan: true, sopo: false, cases: true, timeline: false };

  function section(key, title, content, extraHead) {
    const id = "sec-" + key, open = openSections[key];
    return h("section", { class: "ib-dsec", "aria-labelledby": id + "-h" },
      h("h3", { class: "ib-dsec-head", id: id + "-h" },
        h("button", { type: "button", class: "ib-disclosure", "aria-expanded": String(open), "aria-controls": id,
          onClick: () => { openSections[key] = !openSections[key]; render(); } }, icon(open ? "chevronDown" : "chevronRight", 14), title),
        extraHead || null),
      h("div", { class: "ib-dsec-body", id, hidden: !open }, content));
  }

  function kv(pairs) {
    return h("dl", { class: "ib-kv" }, pairs.filter(Boolean).map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v))));
  }

  function chips(arr, otherSet) {
    if (!arr || !arr.length) return h("span", { class: "ib-muted" }, "(kosong)");
    return h("div", { class: "ib-chips" }, arr.map((v) => {
      const diff = otherSet && !otherSet.has(v);
      return h("span", { class: ["ib-code", diff ? "is-diff" : null], title: diff ? "Hanya ada di sisi ini" : null }, v, diff ? h("span", { class: "gs-sr-only" }, " (hanya di sisi ini)") : null);
    }));
  }

  function findRow() {
    if (!current) return null;
    const pack = app.logic.currentPack();
    if (!pack) return null;
    const row = pack.main.find((r) => r.NOPEN === current.nopen && app.logic.rowBrand(r) === current.brand);
    return row ? { row, pack } : null;
  }

  async function loadTimeline(force) {
    const key = current.brand + "|" + current.nopen;
    if (!force && timeline.key === key && (timeline.events || timeline.loading)) return;
    timeline = { key, events: null, error: null, loading: true };
    try { timeline.events = await app.cases.fetchTimeline(current.brand, current.nopen); }
    catch (e) { timeline.error = e; }
    timeline.loading = false;
    if (current && current.brand + "|" + current.nopen === key) render();
  }

  // ---------------- editor case ----------------
  function editorFor(row, pack, c) {
    const S = app.cases.store;
    const role = store.get().role;
    const me = S.currentUser();
    const meta = c ? app.cases.meta(c.id) : null;
    const curStatus = c ? c.status : "OPEN";
    const ids = { type: nextId("ct"), remark: nextId("rm"), act: nextId("ac"), qa: nextId("qa"), qn: nextId("qn"), ca: nextId("ca"), cn: nextId("cn"), st: nextId("st") };
    let status = curStatus;
    const statusGroup = h("div", { class: "ib-flow", role: "radiogroup", "aria-labelledby": ids.st },
      STATUS_FLOW.map((st, i) => {
        const m = STATUS_META[st];
        return [i ? h("span", { class: "ib-flow-sep", "aria-hidden": "true" }, icon("chevronRight", 12)) : null,
          h("button", { type: "button", role: "radio", class: "ib-flow-step is-" + m.tone, "aria-checked": String(status === st), tabindex: status === st ? "0" : "-1", dataset: { st },
            onClick: (e) => setStatus(st, e.currentTarget.parentNode),
            onKeydown: (e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const j = (STATUS_FLOW.indexOf(status) + (e.key === "ArrowRight" ? 1 : STATUS_FLOW.length - 1)) % STATUS_FLOW.length;
              setStatus(STATUS_FLOW[j], e.currentTarget.parentNode, true);
            } }, icon(m.icon, 13), m.label)];
      }));
    function setStatus(st, group, focus) {
      status = st;
      Array.from(group.querySelectorAll("[role=radio]")).forEach((b) => { const on = b.dataset.st === st; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      markDirty();
    }
    const typeSel = h("select", { class: "gs-select", id: ids.type, onChange: markDirty },
      S.CASE_TYPE.map((t) => h("option", { value: t, selected: (c ? c.caseType : (S.CLASS_TO_CASE_TYPE[row.PRIMARY] || "OTHER")) === t }, S.CASE_TYPE_LABEL[t] || t)));
    const remark = h("textarea", { class: "gs-textarea", id: ids.remark, maxlength: "2000", rows: "4", placeholder: "Apa temuannya, apa yang sudah dicek, hasilnya…", onInput: markDirty }, c ? c.remark : "");
    const act = h("input", { class: "gs-input", id: ids.act, maxlength: "300", value: c ? c.actionTaken : "", placeholder: "mis. Konfirmasi ke tim gudang, koreksi di SCM", onInput: markDirty });
    const qa = h("input", { class: "gs-input", id: ids.qa, inputmode: "decimal", value: c && c.qtyAdj ? c.qtyAdj : 0, onInput: () => { markDirty(); preview(); } });
    const qn = h("input", { class: "gs-input", id: ids.qn, maxlength: "300", value: c ? c.qtyAdjNote : "", placeholder: "alasan penyesuaian QTY", onInput: markDirty });
    const ca = h("input", { class: "gs-input", id: ids.ca, inputmode: "decimal", value: c && c.cbmAdj ? c.cbmAdj : 0, onInput: () => { markDirty(); preview(); } });
    const cn = h("input", { class: "gs-input", id: ids.cn, maxlength: "300", value: c ? c.cbmAdjNote : "", placeholder: "alasan penyesuaian CBM", onInput: markDirty });
    const prev = h("div", { class: "ib-adj-preview", "aria-live": "polite" });
    function preview() {
      const q = parseFloat(qa.value) || 0, cb = parseFloat(ca.value) || 0;
      const lines = [];
      if (row.QTY_DIFF !== null) { const a = C.r3(row.QTY_DIFF - q); lines.push(h("div", null, "Selisih QTY: ", h("b", null, C.fmtNum(row.QTY_DIFF)), " → ", h("b", { class: Math.abs(a) > C.QTY_TOL ? "is-bad" : "is-ok" }, C.fmtNum(a)))); }
      if (row.CBM_DIFF !== null) { const a = C.r3(row.CBM_DIFF - cb); lines.push(h("div", null, "Selisih CBM: ", h("b", null, C.fmtNum(row.CBM_DIFF, 3)), " → ", h("b", { class: Math.abs(a) > C.CBM_TOL ? "is-bad" : "is-ok" }, C.fmtNum(a, 3)))); }
      replace(prev, lines.length ? lines : "Tidak ada selisih QTY/CBM untuk NOPEN ini.");
    }
    preview();
    function markDirty() { if (editing) editing.dirty = true; }

    const saveBtn = button(c ? "Simpan perubahan" : "Buat case", { variant: "primary", icon: "check" });
    const cancelBtn = button("Batal", { onClick: () => { editing = null; render(); } });
    const delBtn = c ? button("Hapus case", { variant: "danger", icon: "trash", onClick: () => deleteCase(c) }) : null;
    saveBtn.addEventListener("click", async () => {
      const qtyAdjVal = parseFloat(qa.value) || 0;
      const fields = { remark: remark.value, pic: me, status, qtyAdj: qtyAdjVal, cbmAdj: parseFloat(ca.value) || 0, qtyAdjNote: qn.value, cbmAdjNote: cn.value, actionTaken: act.value };
      if (row.CLASSES.indexOf(E.CLASS.ONLY_IN_SCM) !== -1) fields.qtyExpected = qtyAdjVal || null;   // aturan lama (item 10-15)
      const context = { caseType: typeSel.value || "OTHER", issueType: row.PRIMARY, severity: row.SEVERITY };
      saveBtn.disabled = true; saveBtn.classList.add("gs-btn--loading"); saveBtn.setAttribute("aria-busy", "true");
      const res = await actions.saveCase({ caseId: c ? c.id : null, brand: current.brand, nopen: current.nopen, fields, context,
        expectedVersion: c && editing ? editing.baseVersion : null });
      saveBtn.disabled = false; saveBtn.classList.remove("gs-btn--loading"); saveBtn.removeAttribute("aria-busy");
      if (res && (res.status === "saved" || res.status === "unchanged" || res.status === "empty")) {
        editing = null; timeline.key = null; render();
        announce(res.status === "saved" ? "Case tersimpan" : "Tidak ada perubahan");
      } else if (res && res.status === "reload") {
        editing = { caseId: c ? c.id : null, dirty: false }; render();
      }
    });

    const stale = c && editing && editing.baseVersion && meta && meta.version > editing.baseVersion;
    return h("form", { class: "ib-editor", "aria-label": c ? "Ubah case " + displayCaseId(c.id) : "Case baru", onSubmit: (e) => e.preventDefault() },
      stale ? h("div", { class: "ib-inline-alert is-warning", role: "alert" }, icon("warning"),
        "Case ini baru saja diubah oleh " + (meta.lastUpdatedByName || "pengguna lain") + ". Simpan akan memicu pemeriksaan konflik.",
        button("Muat ulang", { size: "sm", onClick: () => { editing = { caseId: c.id, baseVersion: meta.version, dirty: false }; render(); } })) : null,
      h("div", { class: "gs-field" }, h("span", { class: "gs-label", id: ids.st }, "Status workflow"), statusGroup),
      h("div", { class: "ib-form-grid" },
        h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.type }, "Jenis case"), typeSel),
        h("div", { class: "gs-field" }, h("span", { class: "gs-label" }, "PIC (otomatis)"), h("div", { class: "ib-readonly", title: "PIC otomatis = orang yang terakhir menyimpan case" }, icon("user", 13), me))),
      h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.remark }, "Temuan / catatan (remark)"), remark,
        h("span", { class: "gs-hint" }, "Fakta temuan & hasil pengecekan. Maks. 2000 karakter.")),
      h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.act }, "Tindakan yang diambil"), act),
      h("fieldset", { class: "ib-fieldset" },
        h("legend", null, "Penyesuaian QTY & CBM"),
        h("p", { class: "gs-hint" }, "Data asli tidak diubah; penyesuaian hanya memengaruhi selisih akhir (akumulasi). Positif menambah, negatif mengurangi."),
        h("div", { class: "ib-form-grid" },
          h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.qa }, "Penyesuaian QTY"), qa),
          h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.qn }, "Keterangan QTY"), qn),
          h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.ca }, "Penyesuaian CBM"), ca),
          h("div", { class: "gs-field" }, h("label", { class: "gs-label", for: ids.cn }, "Keterangan CBM"), cn)),
        prev),
      h("div", { class: "ib-editor-actions" }, saveBtn, cancelBtn, h("div", { class: "gs-spacer" }), delBtn),
      c ? h("p", { class: "ib-editor-meta" }, "Case " + displayCaseId(c.id) + " · dibuat " + C.fmtStamp(c.createdAt) + (meta && meta.createdByName ? " oleh " + meta.createdByName : "") +
        " · diperbarui " + C.fmtStamp(c.updatedAt) + (meta ? " · versi " + meta.version : "")) : h("p", { class: "ib-editor-meta" }, "Case baru — belum tersimpan."));
  }

  async function deleteCase(c) {
    const ok = await actions.confirmDeleteCase(c);
    if (ok) { editing = null; timeline.key = null; render(); }
  }

  // ---------------- daftar case ----------------
  function caseCard(c, result) {
    const m = STATUS_META[c.status] || STATUS_META.OPEN;
    const meta = app.cases.meta(c.id);
    const la = lastAction(c);
    const otherPeriod = meta && meta.periodKey && result.periodKey && meta.periodKey !== result.periodKey;
    const sev = SEVERITY_META[c.severity] || null;
    const active = editing && editing.caseId === c.id;
    return h("li", { class: ["ib-case", active ? "is-active" : null] },
      h("div", { class: "ib-case-top" },
        h("span", { class: "gs-mono ib-case-id" }, displayCaseId(c.id)),
        h("span", { class: "gs-badge gs-badge--" + m.tone }, icon(m.icon, 11), m.label),
        h("span", { class: "gs-badge" }, app.cases.store.CASE_TYPE_LABEL[c.caseType] || c.caseType),
        sev && sev.tone ? h("span", { class: "gs-badge gs-badge--" + sev.tone }, "Severity " + sev.label) : null,
        otherPeriod ? h("span", { class: "gs-badge gs-badge--info", title: "Case dibuat pada periode " + periodLabel(meta.periodKey) }, icon("history", 11), "Periode lain") : null),
      c.remark ? h("p", { class: "ib-case-remark" }, c.remark) : h("p", { class: "ib-case-remark ib-muted" }, "(tanpa remark)"),
      c.actionTaken ? h("p", { class: "ib-case-action" }, icon("check", 12), "Tindakan: ", c.actionTaken) : null,
      h("div", { class: "ib-case-meta" },
        h("span", null, icon("user", 12), c.pic || "-"),
        h("span", null, icon("clock", 12), "umur " + ageLabel(c.createdAt)),
        h("span", null, "diperbarui " + C.fmtStamp(c.updatedAt)),
        la ? h("span", { class: "ib-case-last", title: la.what }, "terakhir: " + la.what) : null),
      h("div", { class: "ib-case-actions" },
        button(active ? "Sedang diedit" : "Buka / ubah", { size: "sm", icon: "edit", attrs: { disabled: active }, onClick: () => { editing = { caseId: c.id, baseVersion: meta ? meta.version : null, dirty: false }; render(); } })));
  }

  // ---------------- timeline ----------------
  function timelineView(cases) {
    if (timeline.loading) return h("div", null, h("div", { class: "gs-skeleton gs-skeleton--row" }), h("div", { class: "gs-skeleton gs-skeleton--row" }));
    const legacy = [];
    cases.forEach((c) => (c.audit || []).forEach((a) => legacy.push({ at: a.at, by: a.by, what: a.what, caseId: c.id })));
    if (timeline.error || !timeline.events || !timeline.events.length) {
      return h("div", null,
        timeline.error ? h("div", { class: "ib-inline-alert is-warning" }, icon("warning"), "Audit server belum tersedia (", (timeline.error.userMessage || timeline.error.message || "migrasi belum dijalankan"), "). Menampilkan catatan audit pada case.") : null,
        legacy.length ? h("ol", { class: "ib-timeline" }, legacy.sort((a, b) => (a.at < b.at ? 1 : -1)).map((a) =>
          h("li", null, h("span", { class: "ib-tl-dot", "aria-hidden": "true" }), h("div", null,
            h("div", { class: "ib-tl-head" }, h("b", null, a.what)),
            h("div", { class: "ib-tl-meta" }, displayCaseId(a.caseId) + " · " + (a.by || "-") + " · " + C.fmtStamp(a.at)))))) :
          h("p", { class: "ib-muted" }, "Belum ada riwayat perubahan."));
    }
    return h("ol", { class: "ib-timeline" }, timeline.events.slice().reverse().map((ev) => {
      const parts = describeEvent(ev);
      const notes = Array.isArray(ev.audit_entries) ? ev.audit_entries.map((a) => a.what).filter(Boolean) : [];
      return h("li", { class: "is-" + String(ev.action).toLowerCase() },
        h("span", { class: "ib-tl-dot", "aria-hidden": "true" }),
        h("div", null,
          h("div", { class: "ib-tl-head" }, h("b", null, ACTION_LABEL[ev.action] || ev.action), " · ", h("span", { class: "gs-mono" }, displayCaseId(ev.case_id))),
          h("div", { class: "ib-tl-meta" }, (ev.actor_name || "sistem") + " · " + C.fmtStamp(ev.created_at) + " · v" + (ev.case_version || "-")),
          parts.length ? h("ul", { class: "ib-tl-changes" }, parts.map((p) => h("li", null, p))) : null,
          notes.length ? h("ul", { class: "ib-tl-notes" }, notes.map((n) => h("li", null, n))) : null));
    }));
  }

  // ---------------- render ----------------
  function render() {
    if (!current || !drawer.isOpen()) return;
    const found = findRow();
    const result = store.get().result;
    if (!found) {
      drawer.setHeader("NOPEN " + current.nopen, "Tidak ada di hasil yang sedang ditampilkan");
      drawer.setContent(h("div", { class: "gs-empty" }, h("p", { class: "gs-empty-title" }, "NOPEN ini tidak ada pada brand/hasil saat ini.")));
      return;
    }
    const { row, pack } = found;
    const lbl = pack.cmpLabel === "IOR/DRR" ? (current.brand === "ADIDAS" ? "IOR" : "DRR") : pack.cmpLabel;
    const cases = app.cases.store.getAllForNopen(current.brand, current.nopen);
    const tone = rowTone(row);
    const pairs = (pack.detail || []).filter((d) => d.NOPEN === current.nopen && (!d._brand || d._brand === current.brand));
    drawer.setHeader("NOPEN " + current.nopen, (current.brand === "ADIDAS" ? "Adidas · SCM ↔ IOR" : "Nike · SCM ↔ DRR") + " · " + (row.SHIPPER || "tanpa shipper"));

    // navigasi sebelumnya/berikutnya dalam daftar yang sedang tampil (konteks tabel tetap)
    const list = app.visibleRows ? app.visibleRows() : [];
    const idx = list.findIndex((r) => r.NOPEN === current.nopen && app.logic.rowBrand(r) === current.brand);
    replace(drawer.headExtra,
      button("NOPEN sebelumnya", { iconOnly: true, icon: "chevronUp", size: "sm", variant: "ghost", attrs: { disabled: idx <= 0, title: "NOPEN sebelumnya" }, onClick: () => navigate(list[idx - 1]) }),
      button("NOPEN berikutnya", { iconOnly: true, icon: "chevronDown", size: "sm", variant: "ghost", attrs: { disabled: idx < 0 || idx >= list.length - 1, title: "NOPEN berikutnya" }, onClick: () => navigate(list[idx + 1]) }));

    let qa = 0, ca = 0;
    cases.forEach((c) => { if (c.status !== "CLOSED") { qa += c.qtyAdj || 0; ca += c.cbmAdj || 0; } });
    const editCase = editing ? (editing.caseId ? app.cases.store.get(editing.caseId) : null) : null;
    if (editing && editing.caseId && !editCase) editing = null;   // case dihapus orang lain

    const historical = row.FROM_HISTORY || row.CLASSES.indexOf(E.CLASS.HISTORICAL_MATCH) !== -1;
    const content = h("div", { class: "ib-detail" },
      h("div", { class: "ib-detail-status" },
        h("span", { class: "gs-badge gs-badge--" + tone.tone }, icon(tone.icon, 12), tone.label),
        h("span", { class: "ib-detail-issue" }, row.ISSUE),
        row.PRIORITY && row.PRIORITY !== "-" ? h("span", { class: "gs-badge gs-badge--" + ((SEVERITY_META[row.PRIORITY] || {}).tone || "neutral") }, "Prioritas " + (SEVERITY_META[row.PRIORITY] || {}).label) : null),

      section("ringkasan", "Ringkasan", kv([
        ["Brand", current.brand === "ADIDAS" ? "Adidas" : "Nike"],
        ["Status NOPEN", row.STATUS],
        ["Shipper SCM", row.SHIPPER_SCM || "—"],
        ["Shipper " + lbl, row.SHIPPER_CMP || "—"],
        ["Tgl GRN (SCM)", C.fmtDate(row.TGL_SCM ? new Date(row.TGL_SCM) : null)],
        ["Tgl unloading (" + lbl + ")", row.TGL_UNLOAD ? C.fmtDateRange(new Date(row.TGL_UNLOAD), row.TGL_UNLOAD_MAX ? new Date(row.TGL_UNLOAD_MAX) : null) : "—"],
        ["Case", cases.length ? cases.length + " case (" + cases.filter((c) => c.status !== "CLOSED").length + " aktif)" : "Belum ada"]
      ])),

      section("data", "Perbandingan data", h("div", null,
        h("table", { class: "ib-compare" },
          h("caption", { class: "gs-sr-only" }, "Perbandingan SCM dan " + lbl),
          h("thead", null, h("tr", null, h("th", { scope: "col" }, ""), h("th", { scope: "col" }, "SCM"), h("th", { scope: "col" }, lbl), h("th", { scope: "col", class: "gs-num" }, "Selisih"))),
          h("tbody", null,
            h("tr", null, h("th", { scope: "row" }, "QTY (ctn)"), h("td", { class: "gs-num" }, C.fmtNumFlag(row.QTY_SCM, row.QTY_SCM_INVALID)), h("td", { class: "gs-num" }, C.fmtNumFlag(row.QTY_CMP, row.QTY_CMP_INVALID)),
              h("td", { class: "gs-num" }, row.QTY_DIFF === null ? "—" : h("span", { class: Math.abs(row.QTY_DIFF) > C.QTY_TOL ? "is-bad" : "is-ok" }, C.fmtNum(row.QTY_DIFF)), qa ? h("div", { class: "ib-adj" }, "setelah penyesuaian: " + C.fmtNum(C.r3(row.QTY_DIFF - qa))) : null)),
            h("tr", null, h("th", { scope: "row" }, "CBM"), h("td", { class: "gs-num" }, C.fmtNumFlag(row.CBM_SCM, row.CBM_SCM_INVALID, 3)), h("td", { class: "gs-num" }, C.fmtNumFlag(row.CBM_CMP, row.CBM_CMP_INVALID, 3)),
              h("td", { class: "gs-num" }, row.CBM_DIFF === null ? "—" : h("span", { class: Math.abs(row.CBM_DIFF) > C.CBM_TOL ? "is-bad" : "is-ok" }, C.fmtNum(row.CBM_DIFF, 3)), ca ? h("div", { class: "ib-adj" }, "setelah penyesuaian: " + C.fmtNum(C.r3(row.CBM_DIFF - ca), 3)) : null)),
            h("tr", null, h("th", { scope: "row" }, "Baris sumber"), h("td", { class: "gs-num" }, String(row.LINES_SCM)), h("td", { class: "gs-num" }, String(row.LINES_CMP)), h("td", null, "")),
            row.QTY_PACKAGE_SCM !== null ? h("tr", null, h("th", { scope: "row" }, "QTY Package"), h("td", { class: "gs-num" }, C.fmtNum(row.QTY_PACKAGE_SCM)), h("td", { class: "gs-num" }, C.fmtNum(row.QTY_CMP)),
              h("td", null, row.QTY_PACKAGE_MATCH === false ? "berbeda (informasional)" : "cocok")) : null)),
        h("div", { class: "ib-sopo-grid" },
          h("div", null, h("h4", null, "SO — SCM"), chips(row.SO_SCM, new Set(row.SO_CMP))),
          h("div", null, h("h4", null, "SO — " + lbl), chips(row.SO_CMP, new Set(row.SO_SCM))),
          h("div", null, h("h4", null, "PO — SCM"), chips(row.PO_SCM, new Set(row.PO_CMP))),
          h("div", null, h("h4", null, "PO — " + lbl), chips(row.PO_CMP, new Set(row.PO_SCM)))),
        h("p", { class: "gs-hint" }, "Kode bergaris putus-putus merah = nomor hanya ada di satu sisi."),
        kv([["Baris Excel SCM", row.ROWS_SCM && row.ROWS_SCM.length ? row.ROWS_SCM.slice(0, 12).join(", ") + (row.ROWS_SCM.length > 12 ? "…" : "") : "—"],
            ["Baris Excel " + lbl, row.ROWS_CMP && row.ROWS_CMP.length ? row.ROWS_CMP.slice(0, 12).join(", ") + (row.ROWS_CMP.length > 12 ? "…" : "") : "—"]]))),

      section("penjelasan", "Penjelasan & tindakan", h("div", { class: "ib-explain" },
        h("p", { class: "ib-explain-text" }, row.EXPLANATION),
        historical ? h("div", { class: "ib-inline-alert is-info" }, icon("history"), h("div", null, h("b", null, "Sumber historis: "), row.AUTO || "Data pembanding berasal dari periode lain.",
          row.FROM_HISTORY ? h("div", { class: "gs-hint" }, "Nilai pembanding baris ini tidak ikut dijumlahkan ke total periode berjalan.") : null)) : null,
        !historical && row.AUTO ? h("div", { class: "ib-inline-alert is-info" }, icon("info"), row.AUTO) : null,
        row.CROSS_NOTE ? h("div", { class: "ib-inline-alert is-warning" }, icon("link"), row.CROSS_NOTE) : null,
        row.ACTION ? h("div", { class: "ib-action-req" }, h("span", { class: "gs-label" }, "Action required"), h("b", null, row.ACTION)) : null)),

      pairs.length ? section("sopo", "Pasangan SO/PO berbeda (" + pairs.length + ")", h("table", { class: "ib-compare" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Ada di"), h("th", { scope: "col" }, "SO"), h("th", { scope: "col" }, "PO"))),
        h("tbody", null, pairs.slice(0, 50).map((p) => h("tr", null, h("td", null, p.ADA_DI), h("td", { class: "gs-mono" }, p.SO), h("td", { class: "gs-mono" }, p.PO)))))) : null,

      section("cases", "Case & tindak lanjut", h("div", null,
        cases.length ? h("ul", { class: "ib-case-list" }, cases.map((c) => caseCard(c, result))) : h("p", { class: "ib-muted" }, "Belum ada case untuk NOPEN ini."),
        editing ? h("div", { class: "ib-editor-wrap" }, h("h4", { class: "ib-editor-title" }, editCase ? "Ubah case " + displayCaseId(editCase.id) : "Case baru"), editorFor(row, pack, editCase))
          : button("Tambah case", { icon: "plus", variant: cases.length ? null : "primary", size: "sm", onClick: () => { editing = { caseId: null, dirty: false }; render(); } })),
        h("span", { class: "ib-count" }, String(cases.length))),

      section("timeline", "Riwayat aktivitas (audit)", timelineView(cases)));

    drawer.setContent(content);
    if (openSections.timeline) loadTimeline(false);
  }

  function navigate(r) {
    if (!r) return;
    actions.openNopen(app.logic.rowBrand(r), r.NOPEN, null, { keepDrawer: true });
  }

  store.subscribe(["caseRev", "result", "view"], () => {
    if (!current) return;
    if (!editing) render();
    else {
      // jangan menimpa isi form yang sedang diketik; cukup tandai bila case berubah di server
      const c = editing.caseId ? app.cases.store.get(editing.caseId) : null;
      const m = c ? app.cases.meta(c.id) : null;
      if (editing.caseId && (!c || (m && editing.baseVersion && m.version > editing.baseVersion))) render();
    }
  });

  return {
    open(brand, nopen, returnFocus) {
      const changed = !current || current.brand !== brand || current.nopen !== nopen;
      if (changed) {
        if (editing && editing.dirty && current) {
          // navigasi dengan perubahan belum tersimpan: tetap buka, tapi beri tahu
          announce("Perubahan case sebelumnya belum disimpan dan dibuang.", true);
        }
        current = { brand, nopen }; editing = null; timeline = { key: null, events: null, error: null, loading: false };
      }
      drawer.open(returnFocus);
      render();
    },
    close: () => drawer.close(),
    isOpen: () => drawer.isOpen(),
    current: () => current,
    isEditingDirty: () => !!(editing && editing.dirty),
    /** Dipanggil setelah konflik: muat ulang form dengan data server terbaru. */
    resetEditor(caseId) {
      const m = caseId ? app.cases.meta(caseId) : null;
      editing = caseId && app.cases.store.get(caseId) ? { caseId, baseVersion: m ? m.version : null, dirty: false } : null;
      render();
    },
    rerender: render
  };
}
