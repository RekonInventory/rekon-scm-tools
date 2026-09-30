// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Pembacaan sheet menjadi baris ternormalisasi + laporan mutu data.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C as APP } from "../core/util.js";
import { schema } from "./schema.js";

export const reader = (function (C, SCH) {
  "use strict";

  function sheetRows(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
  }

  function isBlankRow(r) {
    if (!r) return true;
    for (var i = 0; i < r.length; i++) {
      if (r[i] !== null && r[i] !== undefined && String(r[i]).trim() !== "") return false;
    }
    return true;
  }

  // Sebuah baris hanya dianggap "baris data" bila salah satu kolom yang benar-benar
  // dipetakan (NOPEN/SO/PO/QTY/CBM) berisi sesuatu. Kolom lain di sheet yang berisi
  // teks konstan (mis. label "IOR" yang terisi sampai baris terakhir walau data
  // sebenarnya sudah habis) tidak boleh membuat baris kosong terhitung sebagai data.
  function isBlankMapped(r, m) {
    var keys = ["NOPEN", "SO", "PO", "QTY", "CBM"];
    for (var i = 0; i < keys.length; i++) {
      var idx = m[keys[i]];
      if (idx === undefined || idx === -1) continue;
      var v = r[idx];
      if (v !== null && v !== undefined && String(v).trim() !== "") return false;
    }
    return true;
  }

  /**
   * Ekstraksi baris dengan validasi.
   * @returns {rows, report}
   *   rows[i] = {NOPEN,SO,PO,QTY,CBM,SHIPPER,TGL,UNLOAD,_valid,_issues,_row}
   */
  async function extract(wb, sheetName, spec, opts, onProgress) {
    opts = opts || {};
    var raw = sheetRows(wb, sheetName);
    var head = SCH.findHeader(raw, spec);
    var report = {
      sheet: sheetName,
      headerRow: head.row,
      headerScore: head.score,
      missing: [],
      totalRows: 0, validRows: 0,
      counts: { blankNopen: 0, badQty: 0, badCbm: 0, blankSo: 0, blankPo: 0, badDate: 0, blankRow: 0, dupNopenSoPo: 0 },
      samples: {},
      dateMin: null, dateMax: null,
      brands: {}
    };

    if (head.row === -1 || !head.map) {
      report.missing = Object.keys(spec).filter(function (f) { return spec[f].req; });
      return { rows: [], report: report, fatal: "header-not-found" };
    }
    var m = head.map;
    report.missing = SCH.missingRequired(m, spec);
    if (report.missing.length) return { rows: [], report: report, fatal: "missing-columns" };

    var body = raw.slice(head.row + 1);
    var rows = [];
    var seen = new Set();
    var sample = function (key, val) {
      if (!report.samples[key]) report.samples[key] = [];
      if (report.samples[key].length < 5) report.samples[key].push(val);
    };

    await C.eachChunk(body, function (r, i) {
      if (isBlankRow(r) || isBlankMapped(r, m)) { report.counts.blankRow++; return; }
      report.totalRows++;

      var issues = [];
      var excelRow = head.row + 2 + i;   // nomor baris seperti terlihat di Excel

      var nopen = C.padNopen(r[m.NOPEN]);
      if (!nopen) { issues.push("NOPEN kosong"); report.counts.blankNopen++; sample("blankNopen", excelRow); }

      var brand = "";
      if (m.BRAND !== undefined && m.BRAND !== -1) {
        brand = C.S(r[m.BRAND]).toUpperCase();
        if (brand) report.brands[brand] = (report.brands[brand] || 0) + 1;
      }

      var so = C.S(r[m.SO]);
      var po = C.S(r[m.PO]);
      if (!so) { issues.push("SO kosong"); report.counts.blankSo++; sample("blankSo", excelRow); }
      if (!po) { issues.push("PO kosong"); report.counts.blankPo++; sample("blankPo", excelRow); }

      var q = C.parseNum(r[m.QTY]);
      if (!q.ok) {
        issues.push(q.empty ? "QTY kosong" : "QTY bukan angka");
        report.counts.badQty++; sample("badQty", excelRow + " → " + C.S(r[m.QTY]));
      }
      var cb = C.parseNum(r[m.CBM]);
      if (!cb.ok) {
        issues.push(cb.empty ? "CBM kosong" : "CBM bukan angka");
        report.counts.badCbm++; sample("badCbm", excelRow + " → " + C.S(r[m.CBM]));
      }

      var tgl = (m.DATE !== undefined && m.DATE !== -1) ? C.toDate(r[m.DATE]) : null;
      // Fallback per baris: kalau UNLOADING DATE baris ini kosong/tidak
      // terbaca (mis. sel cuma berisi jam tanpa tanggal), coba TRUCK ENTRY
      // DATE baris yang sama. Kolom utama tetap dicoba dulu untuk semua baris.
      if (!tgl && m.DATE_FALLBACK !== undefined && m.DATE_FALLBACK !== -1) {
        tgl = C.toDate(r[m.DATE_FALLBACK]);
      }
      if ((m.DATE !== undefined && m.DATE !== -1) && !tgl && spec.DATE && spec.DATE.req) {
        issues.push("Tanggal tidak valid"); report.counts.badDate++; sample("badDate", excelRow);
      }
      if (tgl) {
        if (!report.dateMin || tgl < report.dateMin) report.dateMin = tgl;
        if (!report.dateMax || tgl > report.dateMax) report.dateMax = tgl;
      }

      var unload = (m.UNLOAD !== undefined && m.UNLOAD !== -1) ? C.toDate(r[m.UNLOAD]) : null;

      // QTY PACKAGE: perbandingan tambahan murni informasional (lihat 40_engine.js).
      // Tidak divalidasi ketat dan tidak memengaruhi _valid/_issues baris ini --
      // kolom QTY (QTY KMS) tetap satu-satunya yang menentukan status abnormal.
      var qtyPkg = (m.QTY_PACKAGE !== undefined && m.QTY_PACKAGE !== -1) ? C.parseNum(r[m.QTY_PACKAGE]) : null;

      var key = nopen + "|" + so + "|" + po;
      if (nopen && seen.has(key)) { report.counts.dupNopenSoPo++; sample("dupNopenSoPo", nopen); }
      else if (nopen) seen.add(key);

      var rec = {
        NOPEN: nopen, SO: so, PO: po,
        QTY: q.v, CBM: cb.v,
        QTY_OK: q.ok, CBM_OK: cb.ok,
        QTY_PACKAGE: (qtyPkg && qtyPkg.ok) ? qtyPkg.v : null,
        SHIPPER: (m.SHIPPER !== undefined && m.SHIPPER !== -1) ? C.S(r[m.SHIPPER]) : "",
        BRAND: brand,
        TGL: tgl, UNLOAD: unload,
        _row: excelRow,
        _valid: issues.length === 0,
        _issues: issues,
        _dup: nopen ? (seen.has(key) && report.counts.dupNopenSoPo > 0 && false) : false
      };
      if (rec._valid) report.validRows++;
      // Baris tanpa NOPEN tidak dapat direkonsiliasi -> dikeluarkan dari engine,
      // tetapi tetap tercatat pada laporan mutu.
      if (nopen) rows.push(rec);
    }, onProgress, 3000);

    return { rows: rows, report: report, fatal: null };
  }

  /* ---------- ringkasan mutu per berkas ---------- */
  function severityOf(report, fatal) {
    if (fatal) return "INVALID";
    if (report.missing.length) return "INVALID";
    if (report.totalRows === 0) return "INVALID";
    var c = report.counts;
    var problems = c.blankNopen + c.badQty + c.badCbm + c.badDate;
    if (problems > 0) return "WARNING";
    if (c.blankSo + c.blankPo > 0) return "WARNING";
    return "VALID";
  }

  function describe(fatal, report) {
    if (fatal === "header-not-found") return "Baris header tidak ditemukan pada sheet ini.";
    if (fatal === "missing-columns") return "Kolom wajib tidak ditemukan: " + report.missing.join(", ") + ".";
    if (report.totalRows === 0) return "Sheet terbaca tetapi tidak berisi data.";
    return "";
  }

  return { extract: extract, severityOf: severityOf, describe: describe, sheetRows: sheetRows };
})(APP, schema);

export default reader;
