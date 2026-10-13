// Awalnya dibangkitkan dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482); sejak 2026-09-30 DIEDIT LANGSUNG (extract-legacy.mjs tidak menimpanya).
// Logika turunan hasil + case: status per finding, dashboard, filter, monitor QTY/CBM, re-evaluasi qty.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C } from "../core/util.js";
import { engine as E } from "./engine.js";

var FILTERS = [
  ["issues","Bermasalah"], ["all","Semua"], ["clear","Clear"], ["abnormal","Abnormal"],
  ["qty","Selisih QTY"], ["cbm","Selisih CBM"], ["sopo","SO/PO Beda"],
  ["scmonly","Hanya di SCM"], ["cmponly","Hanya di IOR/DRR"],
  ["historical","Historical Match"], ["today","GRN / Unloading hari ini"], ["invalid","Data Tidak Valid"],
  ["hasnote","Ada Catatan"], ["nonote","Belum Dicatat"], ["open","Case Terbuka"]
];

var ABN_PATTERNS = {
  ALL: {"OPEN":true, "IN PROGRESS":true, "CLOSED":true},
  ACTIVE: {"OPEN":true, "IN PROGRESS":true, "CLOSED":false},
  OPEN: {"OPEN":true, "IN PROGRESS":false, "CLOSED":false},
  "IN PROGRESS": {"OPEN":false, "IN PROGRESS":true, "CLOSED":false},
  CLOSED: {"OPEN":false, "IN PROGRESS":false, "CLOSED":true}
};

export { FILTERS, ABN_PATTERNS };

/** Label periode data pembanding historis sebuah baris FROM_HISTORY (bulan tgl unloading/tgl data). */
export function historyPeriodLabel(r) {
  var d = r.TGL_UNLOAD || null;
  if (!d) return "periode lain";
  d = d instanceof Date ? d : new Date(d);
  return C.BULAN_PANJANG[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function addHistory(acc, r) {
  var k = historyPeriodLabel(r);
  var g = acc[k] || (acc[k] = { label: k, count: 0, qty: 0, cbm: 0, nopens: [] });
  g.count++; g.qty += r.QTY_CMP || 0; g.cbm += r.CBM_CMP || 0;
  if (g.nopens.length < 20) g.nopens.push((r._brand ? r._brand + ":" : "") + r.NOPEN);
}
/** Ringkas rincian histori: {count, qty, cbm, periods:[{label,count,qty,cbm,nopens}]} atau null. */
export function historySummary(acc) {
  var periods = Object.keys(acc).map(function (k) { var g = acc[k]; g.qty = C.r3(g.qty); g.cbm = C.r3(g.cbm); return g; });
  if (!periods.length) return null;
  return {
    count: periods.reduce(function (s, g) { return s + g.count; }, 0),
    qty: C.r3(periods.reduce(function (s, g) { return s + g.qty; }, 0)),
    cbm: C.r3(periods.reduce(function (s, g) { return s + g.cbm; }, 0)),
    periods: periods
  };
}

export function abnormalStatusEquals(a, b){
  a = a || {}; b = b || {};
  return !!a.OPEN===!!b.OPEN && !!a["IN PROGRESS"]===!!b["IN PROGRESS"] && !!a.CLOSED===!!b.CLOSED;
}

/**
 * Semua fungsi di bawah adalah salinan verbatim dari app-ui-logic. Variabel closure lama
 * (RESULT, view, CASES) disuplai lewat parameter `ctx` = { result, view, cases }.
 */
export function createFindingLogic(ctx) {
  var CASES = ctx.cases;
  // ctx.includeHistoryInTotals (aplikasi baru = true): nilai pembanding dari IOR/DRR periode lain
  // (FROM_HISTORY) IKUT dijumlahkan ke total pembanding monitor, dan rinciannya dikembalikan
  // di `history` supaya dashboard bisa memberi catatan periodenya. Default false = perilaku lama.
  function RESULT_() { return ctx.result(); }
  function view_() { return ctx.view(); }

  function rowFindingStatuses(r, brand){
  var classes = (r.CLASSES||[]).filter(function(cls){ return cls !== E.CLASS.MATCHED; });
  if (!classes.length) return [];
  var cases = CASES.getAllForNopen(brand, r.NOPEN);
  if (!cases.length) return classes.map(function(){ return "OPEN"; });
  // NOPEN dengan cuma 1 case (kasus paling umum, termasuk SEMUA case yang sudah
  // ada sebelum fitur multi-case ini -- case_type-nya bisa saja "OTHER"/tidak
  // persis cocok dengan klasifikasi row saat ini) -- case itu mewakili status
  // SEMUA temuan pada NOPEN ini, apa pun jenisnya, supaya status Closed/In Progress
  // yang sudah diset tetap terbaca dengan benar tanpa syarat pencocokan jenis.
  if (cases.length === 1) {
    var only = cases[0];
    return classes.map(function(){ return only.status; });
  }
  // >1 case pada NOPEN yang sama: cocokkan per case_type supaya tiap finding
  // punya status independen (inilah gunanya multi-case).
  return classes.map(function(cls){
    var ct = CASES.CLASS_TO_CASE_TYPE[cls] || "OTHER";
    var match = cases.filter(function(c){ return c.caseType === ct; });
    if (!match.length) return "OPEN";
    var openOnes = match.filter(function(c){ return c.status !== "CLOSED"; });
    var pick = (openOnes.length ? openOnes : match).sort(function(a,b){ return (b.updatedAt||"")<(a.updatedAt||"")?-1:1; })[0];
    return pick.status;
  });
}
  function caseFindingCounts(pack, brand){
  var out = {"OPEN":0, "IN PROGRESS":0, "CLOSED":0};
  (pack ? pack.main : []).forEach(function(r){
    if (r.ROW_STATUS !== "ABNORMAL") return;
    var rb = r._brand || brand;
    rowFindingStatuses(r, rb).forEach(function(st){ out[st] = (out[st]||0) + 1; });
  });
  return out;
}
  function computeQtyCbmTotals(pack, fixedBrand){
  var totalQtyScm=0, totalQtyCmp=0, totalCbmScm=0, totalCbmCmp=0, totalQtyAdj=0, totalCbmAdj=0;
  var histByPeriod = {};
  (pack ? pack.main : []).forEach(function(r){
    totalQtyScm += r.QTY_SCM || 0;
    // Nilai pembanding dari histori periode lain (FROM_HISTORY) tidak ikut
    // dijumlahkan -- monitor ini menyajikan total PERIODE BERJALAN saja.
    totalQtyCmp += r.FROM_HISTORY && !ctx.includeHistoryInTotals ? 0 : (r.QTY_CMP || 0);
    totalCbmScm += r.CBM_SCM || 0;
    totalCbmCmp += r.FROM_HISTORY && !ctx.includeHistoryInTotals ? 0 : (r.CBM_CMP || 0);
    if (r.FROM_HISTORY && ctx.includeHistoryInTotals) addHistory(histByPeriod, r);
    var rb = r._brand || fixedBrand;
    // Jumlahkan penyesuaian dari SEMUA case NOPEN ini yang masih aktif (bukan Closed) --
    // case yang sudah di-Closed (termasuk yang di-superseded otomatis oleh evaluasi ulang
    // Qty) sudah tidak lagi dianggap sebagai penyesuaian berjalan.
    CASES.getAllForNopen(rb, r.NOPEN).forEach(function(c){
      if (c.status === "CLOSED") return;
      totalQtyAdj += c.qtyAdj||0; totalCbmAdj += c.cbmAdj||0;
    });
  });
  var rawQtyDiff = C.r3(totalQtyScm-totalQtyCmp);
  var rawCbmDiff = C.r3(totalCbmScm-totalCbmCmp);
  return {
    totalQtyScm:totalQtyScm, totalQtyCmp:totalQtyCmp, rawQtyDiff:rawQtyDiff, totalQtyAdj:C.r3(totalQtyAdj), adjQtyDiff:C.r3(rawQtyDiff-totalQtyAdj),
    totalCbmScm:totalCbmScm, totalCbmCmp:totalCbmCmp, rawCbmDiff:rawCbmDiff, totalCbmAdj:C.r3(totalCbmAdj), adjCbmDiff:C.r3(rawCbmDiff-totalCbmAdj)
  , history: ctx.includeHistoryInTotals ? historySummary(histByPeriod) : undefined
  };
}

  function combinedPack(){ var RESULT = RESULT_();
    
  if (!RESULT.adidas) return RESULT.nike;
  if (!RESULT.nike) return RESULT.adidas;
  var main = RESULT.adidas.main.map(function(r){ return Object.assign({}, r, {_brand:"ADIDAS"}); })
    .concat(RESULT.nike.main.map(function(r){ return Object.assign({}, r, {_brand:"NIKE"}); }));
  var detail = (RESULT.adidas.detail||[]).map(function(d){ return Object.assign({}, d, {_brand:"ADIDAS"}); })
    .concat((RESULT.nike.detail||[]).map(function(d){ return Object.assign({}, d, {_brand:"NIKE"}); }));
  return {main:main, detail:detail, cmpLabel:"IOR/DRR", combined:true};

  }
  function currentPack(){ var RESULT = RESULT_(); var view = view_();
    
  if (!RESULT) return null;
  if (view.brand === "ALL") return combinedPack();
  return view.brand==="ADIDAS" ? RESULT.adidas : RESULT.nike;

  }
  function rowBrand(r){ var view = view_(); return r._brand || view.brand; }
  function has(r, cls){ return r.CLASSES.indexOf(cls) !== -1; }
  function baseFilteredRows(){ var view = view_();
    
  var pack = currentPack();
  if (!pack) return [];
  var q = view.q.trim().toLowerCase();
  if (view.mode === "detail"){
    var d = pack.detail || [];
    if (q) d = d.filter(function(r){ return (r.NOPEN+" "+r.SO+" "+r.PO+" "+r.ADA_DI).toLowerCase().indexOf(q) !== -1; });
    return d;
  }
  var rows = pack.main || [];
  switch(view.filter){
    case "issues": rows = rows.filter(E.isIssue); break;
    case "clear": rows = rows.filter(function(r){ return r.ROW_STATUS==="CLEAR"; }); break;
    case "abnormal":
      rows = rows.filter(function(r){
        if (r.ROW_STATUS!=="ABNORMAL") return false;
        var want = view.abnormalStatus || {};
        var anyChecked = want.OPEN || want["IN PROGRESS"] || want.CLOSED;
        if (!anyChecked) return true; // tidak ada sub-filter dicentang = tampilkan semua (perilaku lama)
        return rowFindingStatuses(r, rowBrand(r)).some(function(s){ return !!want[s]; });
      });
      break;
    case "qty": rows = rows.filter(function(r){ return has(r,E.CLASS.QTY_MISMATCH); }); break;
    case "cbm": rows = rows.filter(function(r){ return has(r,E.CLASS.CBM_MISMATCH); }); break;
    case "sopo": rows = rows.filter(function(r){ return has(r,E.CLASS.SO_MISMATCH)||has(r,E.CLASS.PO_MISMATCH)||has(r,E.CLASS.SO_PO_MISMATCH); }); break;
    case "scmonly": rows = rows.filter(function(r){ return has(r,E.CLASS.ONLY_IN_SCM); }); break;
    case "cmponly": rows = rows.filter(function(r){ return has(r,E.CLASS.ONLY_IN_IOR)||has(r,E.CLASS.ONLY_IN_DRR); }); break;
    case "historical": rows = rows.filter(function(r){ return has(r,E.CLASS.HISTORICAL_MATCH); }); break;
    case "today": rows = rows.filter(function(r){ return has(r,E.CLASS.TODAY_ENTRY); }); break;
    case "invalid": rows = rows.filter(function(r){ return has(r,E.CLASS.INVALID_DATA); }); break;
    case "hasnote": rows = rows.filter(function(r){ return CASES.getAllForNopen(rowBrand(r), r.NOPEN).length>0; }); break;
    case "nonote": rows = rows.filter(function(r){ return E.isIssue(r) && CASES.getAllForNopen(rowBrand(r), r.NOPEN).length===0; }); break;
    case "open": rows = rows.filter(function(r){ return CASES.getAllForNopen(rowBrand(r), r.NOPEN).some(function(c){ return c.status!=="CLOSED"; }); }); break;
  }
  if (q) rows = rows.filter(function(r){
    var caseText = CASES.getAllForNopen(rowBrand(r), r.NOPEN).map(function(c){ return c.remark+" "+c.pic; }).join(" ");
    return (r.NOPEN+" "+r.SHIPPER+" "+r.KETERANGAN+" "+r.EXPLANATION+" "+(r.AUTO||"")+" "+caseText).toLowerCase().indexOf(q) !== -1;
  });
  return rows;

  }
  function tableFilterDefs(){ var view = view_();
    
  if (view.mode !== "nopen") return [];
  var lbl = (currentPack()||{}).cmpLabel || "IOR/DRR";
  var defs = [
    {key:"nopen", label:"NOPEN", get:function(r){return r.NOPEN||"";}},
    {key:"tglgrn", label:"TGL GRN (SCM)", get:function(r){return C.fmtDate(r.TGL_SCM)||"";}},
    {key:"tglunload", label:"TGL Unloading ("+lbl+")", get:function(r){return C.fmtDateRange(r.TGL_UNLOAD,r.TGL_UNLOAD_MAX)||"";}},
    {key:"temuan", label:"Temuan", get:function(r){return r.ISSUE||r.ROW_STATUS||"";}},
    {key:"shipper", label:"Shipper", get:function(r){return r.SHIPPER||"";}},
    {key:"soscm", label:"SO (SCM)", get:function(r){return r.SO_SCM_TXT||"";}},
    {key:"socmp", label:"SO ("+lbl+")", get:function(r){return r.SO_CMP_TXT||"";}},
    {key:"poscm", label:"PO (SCM)", get:function(r){return r.PO_SCM_TXT||"";}},
    {key:"pocmp", label:"PO ("+lbl+")", get:function(r){return r.PO_CMP_TXT||"";}},
    {key:"baris", label:"Baris (SCM/"+lbl+")", get:function(r){return (r.LINES_SCM+" / "+r.LINES_CMP);}},
    {key:"qty", label:"QTY (SCM/"+lbl+")", get:function(r){return (C.fmtNumFlag(r.QTY_SCM,r.QTY_SCM_INVALID)+" / "+C.fmtNumFlag(r.QTY_CMP,r.QTY_CMP_INVALID));}},
    {key:"dqty", label:"Δ QTY", get:function(r){return r.QTY_DIFF===null||r.QTY_DIFF===undefined?"":C.fmtNum(r.QTY_DIFF,0);}},
    {key:"cbm", label:"CBM (SCM/"+lbl+")", get:function(r){return (C.fmtNumFlag(r.CBM_SCM,r.CBM_SCM_INVALID,3)+" / "+C.fmtNumFlag(r.CBM_CMP,r.CBM_CMP_INVALID,3));}},
    {key:"dcbm", label:"Δ CBM", get:function(r){return r.CBM_DIFF===null||r.CBM_DIFF===undefined?"":C.fmtNum(r.CBM_DIFF,3);}},
    {key:"ket", label:"Keterangan", get:function(r){return (r.EXPLANATION||"");}},
    {key:"case", label:"Case", get:function(r){var c=CASES.primaryCase(rowBrand(r),r.NOPEN); return c?c.status:"";}}
  ];
  if (view.brand === "ALL") defs.splice(1,0,{key:"brand",label:"Brand",get:function(r){return rowBrand(r)||"";}});
  return defs;

  }
  function applyColumnFilters(rows, ignoreKey){ var view = view_();
    
  var defs=tableFilterDefs();
  defs.forEach(function(d){
    if (d.key===ignoreKey) return;
    var val=view.colFilters[d.key];
    if (val!==undefined && val!=="") rows=rows.filter(function(r){return d.get(r)===val;});
  });
  return rows;

  }
  function filteredRows(){ return applyColumnFilters(baseFilteredRows()); }
  function filterOptionsFor(def){
  var rows=applyColumnFilters(baseFilteredRows(), def.key);
  var vals={}, out=[];
  rows.forEach(function(r){
    var v=String(def.get(r)==null?"":def.get(r));
    if (!vals[v]) { vals[v]=1; out.push(v); }
  });
  out.sort(function(a,b){ return a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}); });
  return out.slice(0,200);
}
  function currentFilterLabel(){ var view = view_();
    
  var f = FILTERS.filter(function(x){ return x[0] === view.filter; })[0];
  return f ? f[1] : (view.filter || "Semua");

  }

  return {
    rowFindingStatuses: rowFindingStatuses, caseFindingCounts: caseFindingCounts,
    computeQtyCbmTotals: computeQtyCbmTotals, combinedPack: combinedPack, currentPack: currentPack,
    rowBrand: rowBrand, has: has, baseFilteredRows: baseFilteredRows,
    tableFilterDefs: tableFilterDefs, applyColumnFilters: applyColumnFilters, filteredRows: filteredRows,
    filterOptionsFor: filterOptionsFor, currentFilterLabel: currentFilterLabel
  };
}

/**
 * Re-evaluasi penyesuaian "belum tersedia" setelah data terbaru diunggah.
 * Tanpa opts = verbatim versi lama (QTY saja; data histori dianggap belum tersedia).
 * opts.cbm = true              -> penyesuaian CBM (cbmExpected) ikut dievaluasi ulang, sama seperti QTY.
 * opts.historyAvailable = true -> baris yang pembandingnya ditemukan di IOR/DRR periode lain
 *                                 (FROM_HISTORY) dianggap "data sudah ada" -> penyesuaian dilepas
 *                                 (monitor kini menjumlahkan data histori; bila tidak dilepas akan dobel).
 * opts.skipFollowUps = true    -> hanya case yang penyesuaiannya masih aktif (qtyAdj != 0 untuk QTY,
 *                                 cbmAdj != 0 untuk CBM) yang dievaluasi ulang. Tanpa opsi ini case
 *                                 lanjutan QTY_DIFFERENCE/CBM_DIFFERENCE (menyimpan qtyExpected/cbmExpected,
 *                                 adj 0) ditutup & dibuat lanjutan baru di SETIAP run (-02, -03, -04, ...).
 * `pushCaseToSupabase(rec, isNew)` = callback persistensi dari application layer.
 */
export function reevaluateQtyAdjustments(out, CASES, pushCaseToSupabase, opts) {
  opts = opts || {};
  function run_(out){
  ["adidas","nike"].forEach(function(key){
    var pack = out[key];
    if (!pack) return;
    var brand = key === "adidas" ? "ADIDAS" : "NIKE";
    var rowsByNopen = {};
    pack.main.forEach(function(r){ rowsByNopen[r.NOPEN] = r; });
    var all = CASES.all();
    Object.keys(all).forEach(function(caseId){
      var c = all[caseId];
      if (c.brand !== brand || c.status === "CLOSED") return;
      var hasQ = !(c.qtyExpected === null || c.qtyExpected === undefined);
      var hasC = !!opts.cbm && !(c.cbmExpected === null || c.cbmExpected === undefined);
      if (opts.skipFollowUps) {
        // hanya penyesuaian yang masih aktif; case lanjutan (qtyAdj/cbmAdj 0) tidak dievaluasi lagi
        if (!Number(c.qtyAdj)) hasQ = false;
        if (!Number(c.cbmAdj)) hasC = false;
      }
      if (!hasQ && !hasC) return;
      var row = rowsByNopen[c.nopen];
      if (!row) return; // NOPEN tidak muncul di run terbaru (mis. beda periode) -- jangan diutak-atik
      // item 14: masih belum tersedia, pertahankan (kecuali ditemukan di histori & opts.historyAvailable)
      if (row.CLASSES.indexOf(E.CLASS.ONLY_IN_SCM) !== -1 && !(opts.historyAvailable && row.FROM_HISTORY)) return;

      var expected = hasQ ? c.qtyExpected : null;
      var actual = row.QTY_CMP || 0;
      var diff = hasQ ? C.r3(expected - actual) : 0;
      var sesuai = !hasQ || Math.abs(diff) <= (C.QTY_TOL||0);
      var expectedC = hasC ? c.cbmExpected : null;
      var actualC = C.r3(row.CBM_CMP || 0);
      var diffC = hasC ? C.r3(expectedC - actualC) : 0;
      var sesuaiC = !hasC || Math.abs(diffC) <= (C.CBM_TOL||0);

      var fields = { status: "CLOSED" };
      if (hasQ) { fields.qtyAdj = 0; fields.qtyActual = actual; }
      if (hasC) { fields.cbmAdj = 0; fields.cbmActual = actualC; }
      CASES.save(caseId, brand, c.nopen, fields, { caseType: c.caseType });
      if (hasQ) CASES.appendAudit(caseId, "sistem", sesuai
        ? ("Penyesuaian Qty sebelumnya sebesar " + expected + " sudah tersedia pada data terbaru sebesar " + actual + ".")
        : ("Penyesuaian Qty sebelumnya sebesar " + expected + " telah dihapus karena data terbaru sudah tersedia. Pada data terbaru ditemukan Qty sebesar " + actual + " sehingga masih terdapat selisih Qty sebesar " + Math.abs(diff) + "."));
      if (hasC) CASES.appendAudit(caseId, "sistem", sesuaiC
        ? ("Penyesuaian CBM sebelumnya sebesar " + expectedC + " sudah tersedia pada data terbaru sebesar " + actualC + ".")
        : ("Penyesuaian CBM sebelumnya sebesar " + expectedC + " telah dihapus karena data terbaru sudah tersedia. Pada data terbaru ditemukan CBM sebesar " + actualC + " sehingga masih terdapat selisih CBM sebesar " + Math.abs(diffC) + "."));
      if (opts.historyAvailable && row.FROM_HISTORY) CASES.appendAudit(caseId, "sistem",
        "Data pembanding NOPEN ini ditemukan di " + pack.cmpLabel + " periode " + historyPeriodLabel(row) + " (bukan periode berjalan).");
      pushCaseToSupabase(CASES.get(caseId), false);

      var seq = CASES.parseKey(caseId).seq;
      if (!sesuai){
        var newId = CASES.nextCaseId(brand, c.nopen);
        CASES.save(newId, brand, c.nopen, {
          status: "OPEN", pic: c.pic,
          remark: "Selisih Qty ditemukan otomatis setelah data terbaru tersedia (lanjutan case " + c.nopen + "-" + seq + ").",
          qtyExpected: expected, qtyActual: actual, qtyDifference: diff
        }, { caseType: "QTY_DIFFERENCE", issueType: row.PRIMARY, severity: row.SEVERITY });
      }
      if (!sesuaiC){
        var newIdC = CASES.nextCaseId(brand, c.nopen);
        CASES.save(newIdC, brand, c.nopen, {
          status: "OPEN", pic: c.pic,
          remark: "Selisih CBM ditemukan otomatis setelah data terbaru tersedia (lanjutan case " + c.nopen + "-" + seq + ").",
          cbmExpected: expectedC, cbmActual: actualC, cbmDifference: diffC
        }, { caseType: "CBM_DIFFERENCE", issueType: row.PRIMARY, severity: row.SEVERITY });
      }
    });
  });
}
  run_(out);
}
