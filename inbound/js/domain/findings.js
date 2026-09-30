// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Logika turunan hasil + case: status per finding, dashboard, filter, monitor QTY/CBM, re-evaluasi qty.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C } from "../core/util.js";
import { engine as E } from "./engine.js";

var FILTERS = [
  ["issues","Bermasalah"], ["all","Semua"], ["clear","Clear"], ["abnormal","Abnormal"],
  ["qty","Selisih QTY"], ["cbm","Selisih CBM"], ["sopo","SO/PO Beda"],
  ["scmonly","Hanya di SCM"], ["cmponly","Hanya di IOR/DRR"],
  ["historical","Historical Match"], ["invalid","Data Tidak Valid"],
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
  (pack ? pack.main : []).forEach(function(r){
    totalQtyScm += r.QTY_SCM || 0;
    // Nilai pembanding dari histori periode lain (FROM_HISTORY) tidak ikut
    // dijumlahkan -- monitor ini menyajikan total PERIODE BERJALAN saja.
    totalQtyCmp += r.FROM_HISTORY ? 0 : (r.QTY_CMP || 0);
    totalCbmScm += r.CBM_SCM || 0;
    totalCbmCmp += r.FROM_HISTORY ? 0 : (r.CBM_CMP || 0);
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
 * Re-evaluasi penyesuaian qty "belum tersedia" (verbatim reevaluateQtyAdjustments).
 * `pushCaseToSupabase(rec, isNew)` = callback persistensi dari application layer.
 */
export function reevaluateQtyAdjustments(out, CASES, pushCaseToSupabase) {
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
      if (c.qtyExpected === null || c.qtyExpected === undefined) return;
      var row = rowsByNopen[c.nopen];
      if (!row) return; // NOPEN tidak muncul di run terbaru (mis. beda periode) -- jangan diutak-atik
      if (row.CLASSES.indexOf(E.CLASS.ONLY_IN_SCM) !== -1) return; // item 14: masih belum tersedia, pertahankan

      var expected = c.qtyExpected;
      var actual = row.QTY_CMP || 0;
      var diff = C.r3(expected - actual);
      var sesuai = Math.abs(diff) <= (C.QTY_TOL||0);

      CASES.save(caseId, brand, c.nopen, { status: "CLOSED", qtyAdj: 0, qtyActual: actual }, { caseType: c.caseType });
      CASES.appendAudit(caseId, "sistem", sesuai
        ? ("Penyesuaian Qty sebelumnya sebesar " + expected + " sudah tersedia pada data terbaru sebesar " + actual + ".")
        : ("Penyesuaian Qty sebelumnya sebesar " + expected + " telah dihapus karena data terbaru sudah tersedia. Pada data terbaru ditemukan Qty sebesar " + actual + " sehingga masih terdapat selisih Qty sebesar " + Math.abs(diff) + "."));
      pushCaseToSupabase(CASES.get(caseId), false);

      if (!sesuai){
        var newId = CASES.nextCaseId(brand, c.nopen);
        CASES.save(newId, brand, c.nopen, {
          status: "OPEN", pic: c.pic,
          remark: "Selisih Qty ditemukan otomatis setelah data terbaru tersedia (lanjutan case " + c.nopen + "-" + CASES.parseKey(caseId).seq + ").",
          qtyExpected: expected, qtyActual: actual, qtyDifference: diff
        }, { caseType: "QTY_DIFFERENCE", issueType: row.PRIMARY, severity: row.SEVERITY });
      }
    });
  });
}
  run_(out);
}
