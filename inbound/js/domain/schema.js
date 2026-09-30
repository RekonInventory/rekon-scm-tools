// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Pemetaan kolom berbasis header, deteksi jenis berkas, orientasi SO/PO.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C as APP } from "../core/util.js";

export const schema = (function (C) {
  "use strict";

  function norm(h) {
    return String(h === null || h === undefined ? "" : h)
      .toLowerCase().replace(/\s+/g, " ").replace(/[._]/g, " ").trim();
  }

  /* Alias diurut berdasarkan PRIORITAS.
     Penting: pada SCM ada "QTY" (jumlah pcs) dan "QTY KMS" (jumlah karton).
     Yang dipakai untuk rekonsiliasi adalah QTY KMS, jadi harus di depan. */
  var SCM_SPEC = {
    NOPEN:   { req: true,  alias: ["nopen", "peb", "peb no", "no peb", "nopen/peb", "peb number", "nomor peb"] },
    SO:      { req: true,  alias: ["so number", "so no", "so", "sales order"] },
    PO:      { req: true,  alias: ["po number", "po no", "po", "purchase order"] },
    QTY:     { req: true,  alias: ["qty kms", "qty package", "total carton", "qty carton", "qty"] },
    CBM:     { req: true,  alias: ["qty cbm", "volume cbm", "cbm actual", "cbm act", "cbm"] },
    SHIPPER: { req: false, alias: ["shipper", "supplier", "nama shipper", "shipper name", "shipper code", "shipper name/vendor", "vendor", "supplier name"] },
    DATE:    { req: true,  alias: ["grn date", "tgl grn", "tanggal grn", "nopen date", "date"] },
    BRAND:   { req: true,  alias: ["product category", "kategori produk", "brand", "category"] },
    // Perbandingan tambahan (informasional, tidak memengaruhi status abnormal):
    // QTY IOR/DRR dibandingkan terhadap kolom "QTY PACKAGE" SCM secara terpisah
    // dari kolom QTY (QTY KMS) yang tetap dipakai untuk penentuan abnormal.
    QTY_PACKAGE: { req: false, alias: ["qty package"] }
  };

  var DRR_SPEC = {
    NOPEN:   { req: true,  alias: ["nopen", "peb", "peb no", "no peb", "peb number"] },
    SO:      { req: true,  alias: ["so no", "so number", "so", "so2"] },
    PO:      { req: true,  alias: ["po no- po line", "po no - po line", "po no", "po number", "po"] },
    QTY:     { req: true,  alias: ["total carton", "total ctn", "qty carton", "qty"] },
    CBM:     { req: true,  alias: ["cbm actual", "cbm act", "cbm"] },
    SHIPPER: { req: false, alias: ["shipper", "supplier", "nama shipper", "shipper name", "vendor", "supplier name"] },
    DATE:    { req: true,  alias: ["gate in date", "tgl peb", "peb date", "unloading date"] },
    UNLOAD:  { req: false, alias: ["start unloading date"] }   // dikunci: hanya kolom ini
  };

  // Berkas IOR kerap menukar label SO/PO terhadap SCM (berlaku untuk sheet
  // Inbound/BAP maupun BuatCekInbound). Orientasi diverifikasi ulang dari data
  // saat rekonsiliasi (lihat resolveOrientation), bukan dari nama kolom.
  var IOR_SPEC = {
    NOPEN:   { req: true,  alias: ["peb no", "peb", "nopen", "no peb"] },
    SO:      { req: true,  alias: ["so"] },
    PO:      { req: true,  alias: ["po"] },
    QTY:     { req: true,  alias: ["qty", "total carton"] },
    CBM:     { req: true,  alias: ["cbm act", "cbm actual", "cbm"] },
    SHIPPER: { req: false, alias: ["shipper", "shipper name", "supplier", "supplier name", "vendor"] },
    DATE:    { req: false, alias: ["unloading date", "tgl", "date"] },
    // Fallback PER BARIS (bukan pengganti kolom): dipakai hanya kalau nilai
    // UNLOADING DATE baris itu kosong/tidak terbaca (lihat extract()). Kolom
    // UNLOADING DATE tetap sumber utama untuk semua baris lainnya.
    DATE_FALLBACK: { req: false, alias: ["truck entry date"] },
    // Tanggal unloading APA ADANYA (dikunci, tanpa fallback) -- dipakai untuk
    // kolom tampilan "Tgl Unloading (IOR)", terpisah dari DATE/DATE_FALLBACK
    // yang dipakai untuk penentuan periode. Sama seperti pola di DRR_SPEC.
    UNLOAD:  { req: false, alias: ["unloading date"] }
  };

  // Riwayat IOR (sheet Inbound / BAP) untuk penelusuran lintas periode.
  var IOR_HIST_SPEC = {
    NOPEN:   { req: true,  alias: ["peb no", "peb", "nopen", "no peb"] },
    DATE:    { req: false, alias: ["unloading date", "truck entry date", "peb date"] },
    DATE_FALLBACK: { req: false, alias: ["truck entry date"] },
    UNLOAD:  { req: false, alias: ["unloading date"] },          // dikunci
    SHIPPER: { req: false, alias: ["shipper", "supplier", "nama shipper", "shipper name", "vendor", "supplier name"] }
  };

  function mapRow(headerRow, spec) {
    var heads = (headerRow || []).map(norm);
    var out = {};
    Object.keys(spec).forEach(function (field) {
      var idx = -1, alias = spec[field].alias, i;
      for (i = 0; i < alias.length && idx === -1; i++) idx = heads.indexOf(alias[i]);
      if (idx === -1) {
        for (i = 0; i < alias.length && idx === -1; i++) {
          idx = heads.findIndex(function (h) { return h && h.indexOf(alias[i]) === 0; });
        }
      }
      // Fallback khusus SHIPPER: beberapa file IOR/DRR memakai header seperti
      // "SHIPPER NAME", "SUPPLIER NAME", "VENDOR", dll. Jika alias exact/prefix
      // tidak ketemu, cari header yang mengandung kata shipper/supplier/vendor.
      if (idx === -1 && field === "SHIPPER") {
        idx = heads.findIndex(function (h) {
          return h && (h.indexOf("shipper") !== -1 || h.indexOf("supplier") !== -1 || h.indexOf("vendor") !== -1);
        });
      }
      out[field] = idx;
    });
    return out;
  }

  function score(headerRow, spec) {
    var m = mapRow(headerRow, spec), hit = 0, total = 0;
    Object.keys(spec).forEach(function (f) {
      if (spec[f].req) { total++; if (m[f] !== -1) hit++; }
    });
    return total ? hit / total : 0;
  }

  // Cari baris header dalam ~12 baris pertama (menangani sheet berjudul ganda).
  function findHeader(rows, spec) {
    var best = { row: -1, score: 0, map: null };
    var limit = Math.min(rows.length, 12);
    for (var i = 0; i < limit; i++) {
      var sc = score(rows[i], spec);
      if (sc > best.score) best = { row: i, score: sc, map: mapRow(rows[i], spec) };
      if (sc === 1) break;
    }
    return best;
  }

  function missingRequired(map, spec) {
    return Object.keys(spec).filter(function (f) { return spec[f].req && map[f] === -1; });
  }

  /* ---------- deteksi jenis berkas + keyakinan ---------- */
  var KIND = { SCM: "scm", IOR: "ior", NIKE: "nike" };

  function detect(wb) {
    var names = wb.SheetNames.map(function (s) { return s.toLowerCase().trim(); });
    var byName = null, conf = 0, sheet = null;

    // Sumber IOR sekarang sheet "Inbound" (+ "BAP") — catatan inbound penuh,
    // NOPEN ada di kolom PEB NO. Sheet "BuatCekInbound" adalah snapshot manual
    // per periode yang harus dibuat ulang tiap bulan, jadi hanya dipakai
    // sebagai cadangan untuk berkas lama yang belum punya sheet Inbound.
    if (names.indexOf("inbound") !== -1) { byName = KIND.IOR; conf = 0.9; sheet = "inbound"; }
    else if (names.indexOf("bap") !== -1) { byName = KIND.IOR; conf = 0.9; sheet = "bap"; }
    else if (names.indexOf("buatcekinbound") !== -1) { byName = KIND.IOR; conf = 0.9; sheet = "buatcekinbound"; }
    else if (names.indexOf("drr master") !== -1) { byName = KIND.NIKE; conf = 0.9; sheet = "drr master"; }
    else if (names.indexOf("nike") !== -1) { byName = KIND.NIKE; conf = 0.85; sheet = "nike"; }
    else if (names.indexOf("scm") !== -1) { byName = KIND.SCM; conf = 0.9; sheet = "scm"; }

    // Verifikasi isi: nama sheet saja tidak cukup.
    if (byName) {
      var real = wb.SheetNames[names.indexOf(sheet)];
      var spec = byName === KIND.SCM ? SCM_SPEC : (byName === KIND.IOR ? IOR_SPEC : DRR_SPEC);
      var rows = peek(wb, real, 14);
      var h = findHeader(rows, spec);
      conf = h.score >= 1 ? 0.98 : (h.score >= 0.7 ? 0.75 : 0.35);
      return { kind: byName, sheet: real, confidence: conf, headerScore: h.score };
    }

    // Tidak dikenali dari nama: coba tebak dari isi tiap sheet.
    var guess = { kind: null, sheet: null, confidence: 0, headerScore: 0 };
    wb.SheetNames.forEach(function (sn) {
      var rows = peek(wb, sn, 14);
      [[KIND.SCM, SCM_SPEC], [KIND.NIKE, DRR_SPEC], [KIND.IOR, IOR_SPEC]].forEach(function (pair) {
        var h = findHeader(rows, pair[1]);
        if (h.score > guess.headerScore) {
          guess = { kind: pair[0], sheet: sn, confidence: h.score >= 1 ? 0.6 : 0.3, headerScore: h.score };
        }
      });
    });
    return guess;
  }

  function peek(wb, sheetName, n) {
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];
    var all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true });
    return all.slice(0, n);
  }

  /* ---------- orientasi SO/PO ----------
     Sebagian berkas menukar label SO dan PO. Alih-alih mengandalkan
     asumsi, orientasi ditentukan dari data: bandingkan pasangan SO/PO
     terhadap SCM pada kedua kemungkinan, pilih yang paling banyak cocok. */
  function resolveOrientation(scmRows, cmpRows) {
    var scmPairs = new Set(), scmNopen = new Set();
    scmRows.forEach(function (r) { scmPairs.add(r.SO + "||" + r.PO); scmNopen.add(r.NOPEN); });

    var asIs = 0, swapped = 0, considered = 0;
    for (var i = 0; i < cmpRows.length; i++) {
      var r = cmpRows[i];
      if (!scmNopen.has(r.NOPEN)) continue;
      considered++;
      if (scmPairs.has(r.SO + "||" + r.PO)) asIs++;
      if (scmPairs.has(r.PO + "||" + r.SO)) swapped++;
      if (considered > 4000) break;
    }
    return {
      swap: swapped > asIs,
      asIs: asIs, swapped: swapped, considered: considered
    };
  }

  return {
    norm: norm, mapRow: mapRow, findHeader: findHeader, missingRequired: missingRequired,
    detect: detect, peek: peek, resolveOrientation: resolveOrientation,
    KIND: KIND, SCM_SPEC: SCM_SPEC, DRR_SPEC: DRR_SPEC, IOR_SPEC: IOR_SPEC, IOR_HIST_SPEC: IOR_HIST_SPEC
  };
})(APP);

export default schema;
