// Awalnya dibangkitkan dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482); sejak 2026-09-30 DIEDIT LANGSUNG (extract-legacy.mjs tidak menimpanya).
// Orkestrasi impor + rekonsiliasi (assign/mergeReports/run) — diambil dari app-ui-logic, DOM dilepas.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C } from "../core/util.js";
import { schema as SCH } from "./schema.js";
import { reader as RD } from "./reader.js";
import { engine as E } from "./engine.js";

var SLOTS = {
  scm:  { label: "SCM",          spec: SCH.SCM_SPEC, hint: "Sheet berisi kolom NOPEN, SO, PO, QTY, CBM, GRN DATE, Brand." },
  ior:  { label: "Adidas / IOR", spec: SCH.IOR_SPEC, hint: "Sheet Inbound + BAP (NOPEN di kolom PEB NO)." },
  nike: { label: "Nike / DRR",   spec: SCH.DRR_SPEC, hint: "Sheet DRR Master / Nike." }
};

export { SLOTS };

function isIorSourceSheet(sheetName){
  var s = String(sheetName || "").toLowerCase().trim();
  return s === "inbound" || s === "bap";
}

function mergeReports(a, b){
  var out = Object.assign({}, a);
  out.totalRows = (a.totalRows || 0) + (b.totalRows || 0);
  out.validRows = (a.validRows || 0) + (b.validRows || 0);
  out.counts = Object.assign({}, a.counts);
  Object.keys(b.counts || {}).forEach(function(k){
    out.counts[k] = (out.counts[k] || 0) + (b.counts[k] || 0);
  });
  out.brands = Object.assign({}, a.brands);
  Object.keys(b.brands || {}).forEach(function(k){
    out.brands[k] = (out.brands[k] || 0) + (b.brands[k] || 0);
  });
  out.samples = Object.assign({}, a.samples);
  Object.keys(b.samples || {}).forEach(function(k){
    if (!out.samples[k]) out.samples[k] = b.samples[k];
  });
  if (b.dateMin && (!out.dateMin || b.dateMin < out.dateMin)) out.dateMin = b.dateMin;
  if (b.dateMax && (!out.dateMax || b.dateMax > out.dateMax)) out.dateMax = b.dateMax;
  return out;
}

function nopenPerMonth(rows){
  var earliest = new Map();
  rows.forEach(function(r){
    if (!r.NOPEN || !r.TGL) return;
    var cur = earliest.get(r.NOPEN);
    if (!cur || r.TGL < cur) earliest.set(r.NOPEN, r.TGL);
  });
  var byMonth = new Map();
  earliest.forEach(function(d){
    var key = d.getUTCFullYear() + "-" + String(d.getUTCMonth()+1).padStart(2,"0");
    byMonth.set(key, (byMonth.get(key)||0)+1);
  });
  return Array.from(byMonth.entries()).sort(function(x,y){ return x[0]<y[0]?-1:1; })
    .map(function(e){ var p = e[0].split("-"); return {label: C.BULAN_PANJANG[+p[1]-1]+" "+p[0], count:e[1]}; });
}

/**
 * Baca + validasi 1 berkas untuk slot `kind` (scm|ior|nike). Identik dengan assign() lama;
 * bedanya hanya: hasil dikembalikan (bukan ditulis ke variabel global `files`) dan pesan
 * progres diteruskan ke callback `onStatus`.
 */
export async function assignFile(kind, name, wb, det, rawFile, onStatus) {
  var files = {};
  var setStatus = onStatus || function () {};
  async function assign(kind, name, wb, det, rawFile){
  setStatus("Memvalidasi " + name + "…");
  await C.yieldUI();
  var slot = SLOTS[kind];
  var sheet = det.sheet || wb.SheetNames[0];
  var res = await RD.extract(wb, sheet, slot.spec, {}, null);
  var sheetLabel = sheet;

  // IOR dibaca dari gabungan sheet Inbound + BAP (NOPEN pada kolom PEB NO).
  if (kind === "ior" && !res.fatal && isIorSourceSheet(sheet)){
    for (var s=0; s<wb.SheetNames.length; s++){
      var other = wb.SheetNames[s];
      if (other === sheet || !isIorSourceSheet(other)) continue;
      setStatus("Membaca sheet " + other + "…");
      await C.yieldUI();
      var add = await RD.extract(wb, other, slot.spec, {}, null);
      if (add.fatal) continue;          // sheet tambahan yang tidak terbaca dilewati
      res.rows = res.rows.concat(add.rows);
      res.report = mergeReports(res.report, add.report);
      sheetLabel += " + " + other;
    }
    res.report.sheet = sheetLabel;
  }

  var entry = {
    name:name, wb:wb, sheet:sheetLabel, detect:det, rawFile:rawFile || null,
    rows:res.rows, report:res.report, fatal:res.fatal,
    severity: RD.severityOf(res.report, res.fatal),
    note: RD.describe(res.fatal, res.report)
  };
  if (kind === "scm" && !res.fatal) entry.monthBreakdown = nopenPerMonth(res.rows);
  // Riwayat IOR tidak lagi diekstrak terpisah: entry.rows (IOR_SPEC) sudah
  // memuat SO/PO/QTY/CBM/tanggal/UNLOAD lengkap dari seluruh sheet Inbound+BAP,
  // dan run() memakainya langsung untuk histori lintas periode.
  files[kind] = entry;
}
  await assign(kind, name, wb, det, rawFile);
  return files[kind];
}

/**
 * Hitung RESULT dari berkas yang sudah di-assign. Segmen tengah fungsi ini adalah badan
 * run() lama apa adanya. Satu-satunya perbedaan perilaku yang disengaja:
 * archiveCasesIfPeriodChanged() (arsip case berbasis localStorage) tidak lagi dipakai —
 * isolasi periode sekarang dicatat di server (inbound_runs + period_key pada case).
 */
/** opts.today (Date UTC 00:00, opsional) mengaktifkan aturan "GRN / Unloading hari ini" (lihat engine.reconcile). */
export function computeResult(files, opts) {
  function computePeriodKey(scmRows){
  var min=null, max=null;
  scmRows.forEach(function(r){
    if (!r.TGL) return;
    if (!min || r.TGL < min) min = r.TGL;
    if (!max || r.TGL > max) max = r.TGL;
  });
  if (!min || !max) return null;
  return min.toISOString().slice(0,10) + "_" + max.toISOString().slice(0,10);
}
  function archiveCasesIfPeriodChanged() { return null; }
  function qualityList(){
  return Object.keys(SLOTS).filter(function(k){ return files[k]; }).map(function(k){
    return {key:k, file:files[k].name, report:files[k].report, severity:files[k].severity, note:files[k].note};
  });
}
  function overallStatus(out){
  if (!out.adidas && !out.nike) return {status:"INCOMPLETE", reason:"Tidak ada pasangan data yang bisa dibandingkan."};
  var anyErrorFile = (out.quality||[]).some(function(q){ return q.severity==="INVALID"; });
  if (anyErrorFile) return {status:"ABNORMAL", reason:"Ada berkas dengan struktur tidak valid — hasil tidak dapat dipercaya sampai diperbaiki."};
  var invalidRows = (out.quality||[]).reduce(function(n,q){ return n+q.report.counts.badQty+q.report.counts.badCbm+q.report.counts.blankNopen; }, 0);
  var sa = out.adidas ? E.summarize(out.adidas) : null;
  var sn = out.nike ? E.summarize(out.nike) : null;
  var abnormal = (sa?sa.abnormal:0)+(sn?sn.abnormal:0);
  var missingPair = (!out.adidas || !out.nike);
  if (abnormal===0 && invalidRows===0 && !missingPair) return {status:"CLEAR", reason:"Seluruh NOPEN cocok dan tidak ada baris data bermasalah."};
  if (invalidRows>0 || abnormal>0) return {status:"ABNORMAL", reason:(abnormal+invalidRows)+" kondisi memerlukan tindakan."};
  return {status:"WARNING", reason:"Semua NOPEN yang diperiksa cocok, tetapi satu sumber pembanding belum dimuat."};
}
    var scmRows = files.scm.rows;
    var scmA = [], scmN = [];
    scmRows.forEach(function(r){
      if (r.BRAND === "ADIDAS") scmA.push(r); else if (r.BRAND === "NIKE") scmN.push(r);
    });

    var periodKey = computePeriodKey(scmRows);
    var archiveInfo = archiveCasesIfPeriodChanged(periodKey);

    var out = {adidas:null, nike:null, generated:new Date(), scope:null, quality:qualityList(), warnings:[], periodKey:periodKey, archiveInfo:archiveInfo};

    if (files.ior){
      var iorAll = files.ior.rows;
      // Sheet Inbound memuat SELURUH riwayat inbound (bukan hanya periode
      // berjalan), jadi dibatasi ke rentang tanggal SCM Adidas dulu — pola
      // yang sama persis dengan DRR/Nike di bawah. Tanpa ini, setiap NOPEN
      // di luar periode akan muncul sebagai temuan "hanya ada di IOR".
      var rangeA = E.dateRange(scmA);
      // Acuan periode dilebarkan jadi 1 BULAN PENUH (tgl 1 s.d. akhir bulan),
      // bukan cuma sampai tanggal terakhir SCM -- supaya baris IOR di ujung
      // bulan yang sama (mis. tgl 29-30, sedangkan SCM baru sampai tgl 28)
      // tetap dibandingkan alih-alih dibuang diam-diam. `rangeA` (tanggal
      // SCM yang sebenarnya) tetap dipakai reconcile() untuk memberi catatan
      // ketika NOPEN comparator jatuh setelah tanggal SCM yang sebenarnya.
      var monthRangeA = E.monthRange(rangeA);
      var scopedIor = E.scopeToPeriod(iorAll, monthRangeA);
      out.scopeIor = Object.assign({scmMin:rangeA.min, scmMax:rangeA.max}, scopedIor);
      if (!scopedIor.applied && /inbound|bap/i.test(files.ior.sheet || "")){
        out.warnings.push("Tanggal pada berkas IOR tidak terbaca, sehingga seluruh " +
          C.fmtNum(iorAll.length) + " baris riwayat ikut dibandingkan — hasil di luar periode SCM bisa muncul sebagai selisih. Periksa kolom UNLOADING DATE pada sheet Inbound/BAP.");
      }
      var iorRows = scopedIor.rows;
      var ori = SCH.resolveOrientation(scmA, iorRows);
      // Riwayat lintas periode memakai SELURUH data IOR (bukan hanya yang lolos
      // scope bulan ini), lengkap dengan SO/PO/QTY/CBM -- supaya NOPEN yang
      // "hanya di SCM" bisa dibandingkan SUNGGUHAN terhadap data historisnya
      // (lihat reconcile()), bukan cuma diberi tahu "ada di bulan lain". Orientasi
      // SO/PO yang sama (ori.swap) diterapkan juga ke data historis ini, karena
      // itu adalah properti seluruh berkas, bukan cuma periode yang lagi dilihat.
      var iorAllOriented = iorAll;
      if (ori.swap){
        iorRows = iorRows.map(function(r){ var c=Object.assign({},r); var t=c.SO; c.SO=c.PO; c.PO=t; return c; });
        iorAllOriented = iorAll.map(function(r){ var c=Object.assign({},r); var t=c.SO; c.SO=c.PO; c.PO=t; return c; });
      }
      out.adidas = E.reconcile(scmA, iorRows, "IOR", E.buildHistory(iorAllOriented), rangeA, opts);
    }
    if (files.nike){
      var drrAll = files.nike.rows;
      var range = E.dateRange(scmN);
      var monthRangeN = E.monthRange(range);
      var scoped = E.scopeToPeriod(drrAll, monthRangeN);
      out.scope = Object.assign({scmMin:range.min, scmMax:range.max}, scoped);
      var ori2 = SCH.resolveOrientation(scmN, scoped.rows);
      var drrRows = scoped.rows;
      // Sama seperti IOR di atas: histori lintas periode memakai seluruh drrAll
      // dengan orientasi SO/PO yang sama, supaya perbandingan penuh terhadap
      // data historis (di reconcile()) tidak salah gara-gara label SO/PO tertukar.
      var drrAllOriented = drrAll;
      if (ori2.swap){
        drrRows = drrRows.map(function(r){ var c=Object.assign({},r); var t=c.SO; c.SO=c.PO; c.PO=t; return c; });
        drrAllOriented = drrAll.map(function(r){ var c=Object.assign({},r); var t=c.SO; c.SO=c.PO; c.PO=t; return c; });
      }
      out.nike = E.reconcile(scmN, drrRows, "DRR", E.buildHistory(drrAllOriented), range, opts);
    }

    out.overall = overallStatus(out);
    out.sources = {scm: files.scm?files.scm.name:"", ior: files.ior?files.ior.name:"", nike: files.nike?files.nike.name:""};
    return out;
}

export function gate(files){
  function qualityList(){
  return Object.keys(SLOTS).filter(function(k){ return files[k]; }).map(function(k){
    return {key:k, file:files[k].name, report:files[k].report, severity:files[k].severity, note:files[k].note};
  });
}

  if (!files.scm) return {ok:false, status:"INCOMPLETE", reason:"Berkas SCM belum dimuat."};
  if (!files.ior && !files.nike) return {ok:false, status:"INCOMPLETE", reason:"Perlu minimal satu berkas pembanding (IOR atau DRR)."};
  var bad = qualityList().filter(function(q){ return q.severity === "INVALID"; });
  if (bad.length) return {ok:false, status:"ABNORMAL", reason: bad.map(function(b){ return b.file+": "+(b.note||"struktur tidak valid"); }).join(" ")};
  return {ok:true, status:"OK", reason:""};
}
