// RECONCILIATION SUMMARY: pilihan brand, KPI yang bisa diklik (mengubah filter
// temuan), breakdown, monitor total QTY/CBM, dan catatan pemrosesan periode.
import { h, replace } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { C } from "../../core/util.js";
import { engine as E } from "../../domain/engine.js";
import { ABN_PATTERNS, abnormalStatusEquals } from "../../domain/findings.js";

export function mountSummary(root, app) {
  const { store, actions } = app;
  let monitorOpen = false;

  function kpi(def, view) {
    const active = def.isActive(view);
    const dead = !def.value && def.value !== "—";
    return h("button", { type: "button", class: ["gs-kpi", "gs-kpi--clickable", "ib-kpi", "ib-kpi--" + (def.tone || "neutral"), active ? "gs-kpi--active" : null],
      "aria-pressed": String(active), disabled: dead && !active ? true : null,
      "aria-label": def.label + ": " + (typeof def.value === "number" ? C.fmtNum(def.value) : def.value) + (def.meta ? ", " + def.meta : "") + ". Tampilkan di tabel temuan.",
      onClick: () => actions.applyKpi(def.apply) },
      h("span", { class: "gs-kpi-label" }, def.icon ? icon(def.icon, 13) : null, def.label),
      h("span", { class: "gs-kpi-value" }, typeof def.value === "number" ? C.fmtNum(def.value) : def.value),
      def.meta ? h("span", { class: "gs-kpi-meta" }, def.meta) : null);
  }

  function totalsCard(title, t) {
    const qtyOk = Math.abs(t.adjQtyDiff) <= C.QTY_TOL, cbmOk = Math.abs(t.adjCbmDiff) <= C.CBM_TOL;
    const line = (label, v, dec, tone) => h("div", { class: "ib-mon-line" }, h("span", null, label), h("span", { class: ["gs-num", tone ? "is-" + tone : null] }, C.fmtNum(v, dec)));
    return h("div", { class: "ib-mon-card" },
      h("h4", null, title),
      h("div", { class: ["ib-mon-banner", qtyOk && cbmOk ? "is-ok" : "is-bad"] }, icon(qtyOk && cbmOk ? "checkCircle" : "warning", 14),
        qtyOk && cbmOk ? "QTY & CBM sesuai" : [!qtyOk ? "QTY selisih " + C.fmtNum(t.adjQtyDiff) : null, !cbmOk ? "CBM selisih " + C.fmtNum(t.adjCbmDiff, 3) : null].filter(Boolean).join(" · ")),
      h("div", { class: "ib-mon-block" }, h("h5", null, "QTY"),
        line("Total SCM", t.totalQtyScm, 0), line("Total pembanding", t.totalQtyCmp, 0),
        line("Selisih awal", t.rawQtyDiff, 0, Math.abs(t.rawQtyDiff) > C.QTY_TOL ? "bad" : "ok"),
        t.totalQtyAdj ? line("Total penyesuaian", t.totalQtyAdj, 0, "adj") : null,
        line("Selisih akhir", t.adjQtyDiff, 0, qtyOk ? "ok" : "bad")),
      h("div", { class: "ib-mon-block" }, h("h5", null, "CBM"),
        line("Total SCM", t.totalCbmScm, 3), line("Total pembanding", t.totalCbmCmp, 3),
        line("Selisih awal", t.rawCbmDiff, 3, Math.abs(t.rawCbmDiff) > C.CBM_TOL ? "bad" : "ok"),
        t.totalCbmAdj ? line("Total penyesuaian", t.totalCbmAdj, 3, "adj") : null,
        line("Selisih akhir", t.adjCbmDiff, 3, cbmOk ? "ok" : "bad")));
  }

  function render() {
    const s = store.get();
    const R = s.result;
    if (!R) {
      replace(root, h("div", { class: "gs-empty ib-empty-hero" },
        h("div", { class: "gs-empty-icon" }, icon("layers", 18)),
        h("p", { class: "gs-empty-title" }, "Belum ada hasil rekonsiliasi"),
        h("p", { class: "gs-empty-desc" }, s.session && s.session.role === "FOLLOWER" ? "Menunggu owner sesi menjalankan rekonsiliasi…" : "Muat berkas di Import workspace lalu jalankan rekonsiliasi. Ringkasan dan tabel temuan akan muncul di sini.")));
      return;
    }
    const view = s.view;
    const logic = app.logic;
    const pack = logic.currentPack();
    const sm = pack ? E.summarize(pack) : null;
    const brand = view.brand;

    const tabs = h("div", { class: "gs-tabs ib-brand-tabs", role: "tablist", "aria-label": "Pilih brand" },
      [["ADIDAS", "Adidas", "SCM ↔ IOR", !!R.adidas], ["NIKE", "Nike", "SCM ↔ DRR", !!R.nike], ["ALL", "Semua", "IOR + DRR", !!(R.adidas && R.nike)]]
        .filter((t) => t[3]).map((t) => h("button", { type: "button", role: "tab", class: "gs-tab", "aria-selected": String(brand === t[0]),
          tabindex: brand === t[0] ? "0" : "-1", "aria-controls": "ibFindingsRegion", onClick: () => actions.setBrand(t[0]),
          onKeydown: (e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const list = Array.from(e.currentTarget.parentNode.children), i = list.indexOf(e.currentTarget);
            const n = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length]; n.focus(); n.click();
          } }, t[1], h("span", { class: "ib-tab-sub" }, t[2]))));

    if (!sm) {
      replace(root, tabs, h("div", { class: "gs-empty" }, h("p", { class: "gs-empty-title" }, "Berkas untuk brand ini belum dimuat.")));
      return;
    }
    const cc = logic.caseFindingCounts(pack, brand === "ALL" ? undefined : brand);
    const tot = logic.computeQtyCbmTotals(pack, brand === "ALL" ? null : brand);
    const abnActive = cc.OPEN + cc["IN PROGRESS"];
    const isPat = (p) => (v) => v.filter === "abnormal" && abnormalStatusEquals(v.abnormalStatus, ABN_PATTERNS[p]);
    const isF = (f) => (v) => v.filter === f;

    const primary = [
      { label: "Total NOPEN", value: sm.total, icon: "layers", tone: "neutral", apply: { filter: "all" }, isActive: isF("all") },
      { label: "Matched", value: sm.clear, icon: "checkCircle", tone: "success", meta: (Math.round(sm.clearRate * 10) / 10) + "% cocok", apply: { filter: "clear" }, isActive: isF("clear") },
      { label: "Abnormal", value: sm.abnormal, icon: "warning", tone: sm.abnormal ? "danger" : "neutral", meta: abnActive + " temuan aktif", apply: { filter: "abnormal", pattern: "ALL" }, isActive: isPat("ALL") },
      { label: "Open", value: cc.OPEN, icon: "flag", tone: cc.OPEN ? "danger" : "neutral", meta: "temuan belum ditangani", apply: { filter: "abnormal", pattern: "OPEN" }, isActive: isPat("OPEN") },
      { label: "In Progress", value: cc["IN PROGRESS"], icon: "clock", tone: cc["IN PROGRESS"] ? "warning" : "neutral", meta: "sedang ditangani", apply: { filter: "abnormal", pattern: "IN PROGRESS" }, isActive: isPat("IN PROGRESS") },
      { label: "Closed", value: cc.CLOSED, icon: "checkCircle", tone: "success", meta: "temuan selesai", apply: { filter: "abnormal", pattern: "CLOSED" }, isActive: isPat("CLOSED") },
      { label: "Selisih QTY", value: sm.qty, icon: "box", tone: sm.qty ? "danger" : "neutral", meta: "selisih akhir " + C.fmtNum(tot.adjQtyDiff) + " ctn", apply: { filter: "qty" }, isActive: isF("qty") },
      { label: "Selisih CBM", value: sm.cbm, icon: "box", tone: sm.cbm ? "warning" : "neutral", meta: "selisih akhir " + C.fmtNum(tot.adjCbmDiff, 3), apply: { filter: "cbm" }, isActive: isF("cbm") }
    ];
    const noteCount = brand === "ALL" ? app.cases.store.countFor("ADIDAS") + app.cases.store.countFor("NIKE") : app.cases.store.countFor(brand);
    const secondary = [
      ["scmonly", "Hanya di SCM", sm.onlyScm], ["cmponly", "Hanya di " + sm.cmpLabel, sm.onlyCmp], ["sopo", "SO/PO beda", sm.sopo],
      ["historical", "Historical match", sm.historical], ["invalid", "Data tidak valid", sm.invalid],
      ["hasnote", "Ada case", noteCount], ["nonote", "Abnormal belum ada case", null], ["open", "Case terbuka", null]
    ];

    const notes = [];
    [["IOR", R.scopeIor], ["DRR", R.scope]].forEach(([label, sc]) => {
      if (!sc || !sc.applied) return;
      notes.push("Berkas " + label + " memuat " + C.fmtNum(sc.before) + " baris (" + C.fmtDate(sc.srcMin) + " – " + C.fmtDate(sc.srcMax) + "). Dibatasi ke periode " +
        C.fmtDate(sc.lo) + " – " + C.fmtDate(sc.hi) + ": " + C.fmtNum(sc.after) + " baris dibandingkan, " + C.fmtNum(sc.before - sc.after) + " di luar periode diabaikan.");
    });
    (R.warnings || []).forEach((w) => notes.push(w));
    const qualityWarn = (R.quality || []).filter((q) => q.severity !== "VALID");
    const monId = "ibMonitorBody";

    replace(root,
      h("div", { class: "ib-summary-top" },
        tabs,
        h("div", { class: ["ib-overall", "is-" + String(R.overall.status).toLowerCase()], role: "status" },
          icon(R.overall.status === "CLEAR" ? "checkCircle" : (R.overall.status === "ABNORMAL" ? "warning" : "info"), 16),
          h("b", null, R.overall.status), h("span", null, R.overall.reason))),
      h("div", { class: "gs-kpi-grid ib-kpi-grid" }, primary.map((d) => kpi(d, view))),
      h("div", { class: "ib-breakdown", role: "group", "aria-label": "Rincian temuan" },
        h("span", { class: "ib-breakdown-label" }, "Rincian:"),
        secondary.map(([f, label, n]) => h("button", { type: "button", class: "gs-chip", "aria-pressed": String(view.filter === f),
          onClick: () => actions.applyKpi({ filter: f }) }, label, n !== null ? h("span", { class: "ib-chip-count" }, C.fmtNum(n)) : null)),
        sm.byMonth && sm.byMonth.length ? h("span", { class: "ib-months" }, icon("clock", 12), sm.byMonth.map((m) => m.label + ": " + C.fmtNum(m.count)).join(" · ")) : null),
      notes.length || qualityWarn.length || sm.qtyPkgChecked ? h("div", { class: "ib-notes", role: "note" },
        h("div", { class: "ib-notes-title" }, icon("info", 14), "Catatan pemrosesan", qualityWarn.length ? h("span", { class: "gs-badge gs-badge--warning" }, icon("warning", 12), qualityWarn.length + " berkas dengan peringatan mutu data") : null),
        h("ul", null,
          notes.map((n) => h("li", null, n)),
          sm.qtyPkgChecked ? h("li", null, "QTY Package (SCM) dibandingkan terhadap QTY " + sm.cmpLabel + " pada " + C.fmtNum(sm.qtyPkgChecked) + " NOPEN: " +
            C.fmtNum(sm.qtyPkgMatch) + " cocok, " + C.fmtNum(sm.qtyPkgDiff) + " berbeda (informasional).") : null)) : null,
      h("section", { class: "ib-monitor" },
        h("button", { type: "button", class: "ib-disclosure ib-monitor-toggle", "aria-expanded": String(monitorOpen), "aria-controls": monId,
          onClick: () => { monitorOpen = !monitorOpen; render(); } },
          icon(monitorOpen ? "chevronDown" : "chevronRight", 14), "Monitor total QTY & CBM",
          h("span", { class: "ib-monitor-hint" }, "angka akhir sudah memperhitungkan penyesuaian manual case aktif")),
        h("div", { class: "ib-monitor-grid", id: monId, hidden: !monitorOpen },
          R.adidas ? totalsCard("SCM ↔ IOR (Adidas)", logic.computeQtyCbmTotals(R.adidas, "ADIDAS")) : null,
          R.nike ? totalsCard("SCM ↔ DRR (Nike)", logic.computeQtyCbmTotals(R.nike, "NIKE")) : null,
          R.adidas && R.nike ? totalsCard("Gabungan", logic.computeQtyCbmTotals(logic.combinedPack(), null)) : null)));
  }

  store.subscribe(["result", "view", "caseRev", "session"], render);
  render();
}
