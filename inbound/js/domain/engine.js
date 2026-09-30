// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Mesin rekonsiliasi: agregasi per NOPEN, QTY/CBM/SO-PO, dua arah, histori, klasifikasi, penjelasan.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

import { C as APP } from "../core/util.js";

export const engine = (function (C) {
  "use strict";

  var CLASS = {
    MATCHED: "MATCHED",
    QTY_MISMATCH: "QTY_MISMATCH",
    CBM_MISMATCH: "CBM_MISMATCH",
    SO_MISMATCH: "SO_MISMATCH",
    PO_MISMATCH: "PO_MISMATCH",
    SO_PO_MISMATCH: "SO_PO_MISMATCH",
    ONLY_IN_SCM: "ONLY_IN_SCM",
    ONLY_IN_IOR: "ONLY_IN_IOR",
    ONLY_IN_DRR: "ONLY_IN_DRR",
    HISTORICAL_MATCH: "HISTORICAL_MATCH",
    INVALID_DATA: "INVALID_DATA",
    DUPLICATE: "DUPLICATE",
    MISSING_DATA: "MISSING_DATA"
  };

  var LABEL = {
    MATCHED: "Cocok", QTY_MISMATCH: "Selisih QTY", CBM_MISMATCH: "Selisih CBM",
    SO_MISMATCH: "SO berbeda", PO_MISMATCH: "PO berbeda", SO_PO_MISMATCH: "SO & PO berbeda",
    ONLY_IN_SCM: "Hanya di SCM", ONLY_IN_IOR: "Hanya di IOR", ONLY_IN_DRR: "Hanya di DRR",
    HISTORICAL_MATCH: "Ketemu di periode lain", INVALID_DATA: "Data tidak valid",
    DUPLICATE: "Baris duplikat", MISSING_DATA: "Data tidak lengkap"
  };

  var SEVERITY = {
    QTY_MISMATCH: "HIGH", ONLY_IN_SCM: "HIGH", ONLY_IN_IOR: "HIGH", ONLY_IN_DRR: "HIGH",
    INVALID_DATA: "HIGH",
    CBM_MISMATCH: "MEDIUM", SO_PO_MISMATCH: "MEDIUM", SO_MISMATCH: "MEDIUM",
    PO_MISMATCH: "MEDIUM", MISSING_DATA: "MEDIUM", DUPLICATE: "MEDIUM",
    HISTORICAL_MATCH: "LOW", MATCHED: "NONE"
  };
  // PRIORITY memakai kosakata yang sama dipakai staf/supervisor (bukan istilah teknis).
  var PRIORITY = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", NONE: "-" };
  // Status per-baris yang ditampilkan ke user (bukan status file/aplikasi keseluruhan).
  var ROW_STATUS = {
    MATCHED: "CLEAR",
    QTY_MISMATCH: "ABNORMAL", CBM_MISMATCH: "ABNORMAL",
    SO_MISMATCH: "ABNORMAL", PO_MISMATCH: "ABNORMAL", SO_PO_MISMATCH: "ABNORMAL",
    INVALID_DATA: "ABNORMAL", DUPLICATE: "ABNORMAL",
    ONLY_IN_SCM: "ABNORMAL", ONLY_IN_IOR: "ABNORMAL", ONLY_IN_DRR: "ABNORMAL", MISSING_DATA: "ABNORMAL",
    HISTORICAL_MATCH: "HISTORICAL"
  };
  var SEV_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

  /* ---------- agregasi per NOPEN ---------- */
  function aggregate(rows) {
    var m = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var g = m.get(r.NOPEN);
      if (!g) {
        g = {
          QTY: 0, CBM: 0, pairs: new Set(), soSet: new Set(), poSet: new Set(),
          lines: 0, SHIPPER: "", shipperSet: new Set(), TGL: null, UNLOAD: null, UNLOAD_MAX: null,
          invalid: 0, invalidQty: 0, invalidCbm: 0, missing: 0, dupes: 0, seen: new Set(), rowsRef: [],
          QTY_PACKAGE: 0, hasQtyPackage: false
        };
        m.set(r.NOPEN, g);
      }
      g.QTY += r.QTY; g.CBM += r.CBM; g.lines++;
      if (r.QTY_PACKAGE !== null && r.QTY_PACKAGE !== undefined) { g.QTY_PACKAGE += r.QTY_PACKAGE; g.hasQtyPackage = true; }
      g.pairs.add(r.SO + "||" + r.PO);
      g.soSet.add(r.SO); g.poSet.add(r.PO);
      if (!g.SHIPPER && r.SHIPPER) g.SHIPPER = r.SHIPPER;
      // Simpan SEMUA nama shipper berbeda yang muncul untuk NOPEN ini (bukan
      // cuma yang pertama ditemukan) -- satu NOPEN kadang dikirim oleh lebih
      // dari satu shipper/vendor pada baris-baris sumber yang berbeda.
      if (r.SHIPPER) g.shipperSet.add(C.S(r.SHIPPER).trim());
      if (r.TGL && (!g.TGL || r.TGL < g.TGL)) g.TGL = r.TGL;
      if (r.UNLOAD && (!g.UNLOAD || r.UNLOAD < g.UNLOAD)) g.UNLOAD = r.UNLOAD;
      if (r.UNLOAD && (!g.UNLOAD_MAX || r.UNLOAD > g.UNLOAD_MAX)) g.UNLOAD_MAX = r.UNLOAD;
      if (r.QTY_OK === false || r.CBM_OK === false) g.invalid++;
      if (r.QTY_OK === false) g.invalidQty++;
      if (r.CBM_OK === false) g.invalidCbm++;
      if (!r.SO || !r.PO) g.missing++;
      var k = r.SO + "||" + r.PO;
      if (g.seen.has(k)) g.dupes++; else g.seen.add(k);
      if (g.rowsRef.length < 50) g.rowsRef.push(r._row);
    }
    return m;
  }

  /* ---------- indeks SO/PO -> NOPEN (untuk cross-reference lintas NOPEN) ---------- */
  function buildSoPoIndex(rows) {
    var so = new Map(), po = new Map();
    rows.forEach(function (r) {
      if (r.SO) { if (!so.has(r.SO)) so.set(r.SO, new Set()); so.get(r.SO).add(r.NOPEN); }
      if (r.PO) { if (!po.has(r.PO)) po.set(r.PO, new Set()); po.get(r.PO).add(r.NOPEN); }
    });
    return { so: so, po: po };
  }
  // Cari NOPEN lain (selain currentNopen) yang memuat salah satu SO/PO di soSet/poSet.
  function findCrossNopen(idx, soSet, poSet, currentNopen) {
    var found = new Set();
    soSet.forEach(function (so) {
      var hit = idx.so.get(so);
      if (hit) hit.forEach(function (nn) { if (nn !== currentNopen) found.add(nn); });
    });
    poSet.forEach(function (po) {
      var hit = idx.po.get(po);
      if (hit) hit.forEach(function (nn) { if (nn !== currentNopen) found.add(nn); });
    });
    return Array.from(found).sort();
  }

  /* ---------- indeks histori (seluruh periode) ---------- */
  // Selain info tanggal/bulan (dipakai untuk catatan "ketemu di periode lain"),
  // sekarang juga mengagregasi QTY/CBM/SO/PO penuh per NOPEN -- persis seperti
  // aggregate() -- supaya NOPEN yang "hanya di SCM" pada periode berjalan bisa
  // dibandingkan SUNGGUHAN terhadap data historisnya (lihat reconcile()),
  // bukan cuma diberi tahu "ada di bulan lain" tanpa tahu apakah datanya cocok.
  // hasFullData=false berarti baris sumbernya tidak punya kolom SO/PO/QTY/CBM
  // (mis. data lama/format ringan) -- reconcile() akan mundur ke perilaku lama.
  function buildHistory(rows) {
    var m = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r.NOPEN) continue;
      var g = m.get(r.NOPEN);
      if (!g) {
        g = {
          min: null, max: null, months: new Map(), unload: null, unloadMax: null, shipper: "",
          QTY: 0, CBM: 0, pairs: new Set(), soSet: new Set(), poSet: new Set(), lines: 0, hasFullData: false
        };
        m.set(r.NOPEN, g);
      }
      var u = r.UNLOAD;
      if (u) {
        if (!g.unload || u < g.unload) g.unload = u;
        if (!g.unloadMax || u > g.unloadMax) g.unloadMax = u;
      }
      if (!g.shipper && r.SHIPPER) g.shipper = C.S(r.SHIPPER).trim();
      var d = r.TGL;
      if (d) {
        if (!g.min || d < g.min) g.min = d;
        if (!g.max || d > g.max) g.max = d;
        var key = d.getUTCFullYear() + "-" + d.getUTCMonth();
        if (!g.months.has(key)) g.months.set(key, d);
      }
      if (r.SO !== undefined && r.PO !== undefined && r.QTY !== undefined && r.QTY !== null) {
        g.hasFullData = true;
        g.QTY += (r.QTY || 0); g.CBM += (r.CBM || 0); g.lines++;
        g.pairs.add(r.SO + "||" + r.PO); g.soSet.add(r.SO); g.poSet.add(r.PO);
      }
    }
    return m;
  }

  /* ---------- pembatasan periode mengikuti rentang tanggal SCM ---------- */
  function dateRange(rows) {
    var min = null, max = null;
    for (var i = 0; i < rows.length; i++) {
      var d = rows[i].TGL;
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    return { min: min, max: max };
  }

  // Perluas rentang tanggal SCM (yang bisa jadi cuma sampai tgl tertentu, mis.
  // 28 Sep karena input SCM belum selesai) menjadi SATU BULAN PENUH kalender
  // (tgl 1 s.d. akhir bulan). Dipakai sebagai acuan periode untuk scopeToPeriod
  // supaya baris IOR/DRR bertanggal akhir bulan yang sama (mis. 29-30 Sep)
  // tetap ikut dibandingkan, bukan dibuang diam-diam hanya karena SCM belum
  // sampai ke tanggal itu.
  function monthRange(range) {
    if (!range.min || !range.max) return range;
    var lo = new Date(Date.UTC(range.min.getUTCFullYear(), range.min.getUTCMonth(), 1));
    var hi = new Date(Date.UTC(range.max.getUTCFullYear(), range.max.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return { min: lo, max: hi };
  }

  function scopeToPeriod(rows, range) {
    if (!range.min || !range.max) return { rows: rows, applied: false };
    var dated = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].TGL) dated++;
    if (dated < rows.length * 0.5) return { rows: rows, applied: false };
    var own = dateRange(rows);
    var kept = rows.filter(function (r) { return !r.TGL || (r.TGL >= range.min && r.TGL <= range.max); });
    return {
      rows: kept, applied: true, lo: range.min, hi: range.max,
      before: rows.length, after: kept.length, srcMin: own.min, srcMax: own.max
    };
  }

  /* ---------- rekonsiliasi ---------- */
  function reconcile(scmRows, cmpRows, cmpLabel, history, scmActualRange) {
    var A = aggregate(scmRows), B = aggregate(cmpRows);
    var cmpIdx = buildSoPoIndex(cmpRows); // untuk cross-check ONLY_IN_SCM: cari SO/PO di sisi comparator
    var scmIdx = buildSoPoIndex(scmRows); // untuk cross-check ONLY_IN_IOR/DRR: cari SO/PO di sisi SCM
    var keys = new Set();
    A.forEach(function (_, k) { keys.add(k); });
    B.forEach(function (_, k) { keys.add(k); });
    var list = Array.from(keys).sort();

    var main = [], detail = [];

    list.forEach(function (n) {
      var a = A.get(n), b = B.get(n);
      var hit = history ? history.get(n) : null;
      // NOPEN yang cuma ada di SCM pada periode berjalan, TAPI histori (periode
      // lain) punya data pembanding LENGKAP (SO/PO/QTY/CBM, bukan cuma info
      // bulan) -- pakai data historis itu SEBAGAI b, supaya logic pembanding
      // QTY/CBM/SO-PO di bawah (persis yang dipakai untuk periode berjalan)
      // ikut berlaku untuk perbandingan lintas periode. Konsekuensinya:
      // histori yang datanya BENAR-BENAR cocok tetap HISTORICAL_MATCH (aman,
      // bukan abnormal); histori yang datanya BEDA langsung jadi temuan
      // abnormal biasa (QTY_MISMATCH dst), tidak lagi disembunyikan di balik
      // label "historical" (lihat pickPrimary()).
      var fromHistory = false;
      if (a && !b && hit && hit.hasFullData) {
        b = {
          QTY: hit.QTY, CBM: hit.CBM, pairs: hit.pairs, soSet: hit.soSet, poSet: hit.poSet,
          lines: hit.lines, SHIPPER: hit.shipper, shipperSet: hit.shipper ? new Set([hit.shipper]) : new Set(),
          TGL: hit.min, UNLOAD: hit.unload, UNLOAD_MAX: hit.unloadMax,
          invalid: 0, invalidQty: 0, invalidCbm: 0, missing: 0, dupes: 0, rowsRef: [],
          QTY_PACKAGE: 0, hasQtyPackage: false
        };
        fromHistory = true;
      }
      var classes = [];
      var qs = a ? C.r3(a.QTY) : null, qc = b ? C.r3(b.QTY) : null;
      var cs = a ? C.r3(a.CBM) : null, cc = b ? C.r3(b.CBM) : null;
      var cekQty = "-", cekCbm = "-", cekSopo = "-", ket = "", autoNote = "", sopoInfo = null;
      var crossNopen = null, crossNote = "";
      var onlyA = [], onlyB = [];
      var status;

      if (a && b) {
        status = "ADA DI KEDUANYA";
        var qtyOk = Math.abs(a.QTY - b.QTY) <= C.QTY_TOL;
        var cbmOk = Math.abs(a.CBM - b.CBM) <= C.CBM_TOL;
        onlyA = Array.from(a.pairs).filter(function (p) { return !b.pairs.has(p); }).sort();
        onlyB = Array.from(b.pairs).filter(function (p) { return !a.pairs.has(p); }).sort();
        var sopoOk = onlyA.length === 0 && onlyB.length === 0;

        // Aturan khusus tambahan rincian SO/PO:
        // Jika seluruh pasangan SO/PO yang ada di SCM sudah tercakup di IOR/DRR,
        // lalu IOR/DRR hanya memiliki pasangan tambahan, dan total QTY + CBM tetap
        // sama, maka JANGAN anggap sebagai mismatch SO/PO. Ini adalah perbedaan
        // rincian/pemecahan pencatatan di sisi pembanding, bukan missing data SCM.
        //
        // `onlyA` = pasangan yang hanya ada di SCM
        // `onlyB` = pasangan yang hanya ada di IOR/DRR
        // Jadi kondisi SCM tercakup sepenuhnya di pembanding adalah onlyA.length === 0.
        var intersect = Array.from(a.pairs).filter(function (p) { return b.pairs.has(p); });
        // Rule utama SO/PO:
        // Jika SEMUA SO yang ada di SCM ditemukan di comparator DAN SEMUA PO
        // yang ada di SCM juga ditemukan di comparator, maka tambahan SO/PO di
        // comparator TIDAK dianggap mismatch selama total QTY dan CBM cocok.
        // Pengecekan dilakukan per SO dan per PO, bukan berdasarkan pasangan
        // SO+PO yang harus identik. Ini menangani kasus ketika comparator memecah
        // satu pasangan SCM menjadi beberapa rincian.
        var scmSosCoveredByCmp = Array.from(a.soSet).every(function (v) { return b.soSet.has(v); });
        var scmPosCoveredByCmp = Array.from(a.poSet).every(function (v) { return b.poSet.has(v); });
        // RULE SO/PO GLOBAL (murni struktural, TIDAK bergantung pada QTY/CBM):
        // Selama seluruh SO SCM tercakup di comparator DAN seluruh PO SCM
        // tercakup di comparator, perbedaan pasangan/rincian SO+PO tidak
        // dianggap mismatch SO/PO -- terlepas dari apakah QTY/CBM cocok atau
        // tidak. QTY/CBM punya class & flag abnormal sendiri (QTY_MISMATCH /
        // CBM_MISMATCH) yang selalu dicek terpisah di bawah, jadi selisih
        // QTY/CBM tetap muncul sebagai temuan -- hanya tidak ikut menyalahkan
        // struktur SO/PO yang sebenarnya sudah tercakup penuh.
        var sopoCoverageOk = sopoOk || (scmSosCoveredByCmp && scmPosCoveredByCmp);
        // "lenient" dipakai HANYA untuk narasi keterangan (apakah rincian
        // tambahan itu murni rincian, atau rincian + ada selisih qty/cbm).
        var lenient = sopoCoverageOk && qtyOk && cbmOk && !sopoOk;

        cekQty = qtyOk ? "OK" : "SELISIH";
        cekCbm = cbmOk ? "OK" : "SELISIH";
        cekSopo = sopoCoverageOk ? "OK" : "BEDA";

        if (!qtyOk) classes.push(CLASS.QTY_MISMATCH);
        if (!cbmOk) classes.push(CLASS.CBM_MISMATCH);
        if (!sopoCoverageOk) {
          var soDiff = !setEq(a.soSet, b.soSet);
          var poDiff = !setEq(a.poSet, b.poSet);
          classes.push(soDiff && poDiff ? CLASS.SO_PO_MISMATCH : (soDiff ? CLASS.SO_MISMATCH : CLASS.PO_MISMATCH));
        }

        if (sopoCoverageOk && qtyOk && cbmOk) ket = "Cocok sepenuhnya";
        else if (lenient) {
          ket = "SO/PO SCM seluruhnya ada di " + cmpLabel + ", dengan tambahan rincian; total QTY & CBM cocok";
          sopoInfo = {
            sama: intersect.map(function (p) { var s = p.split("||"); return { so: s[0], po: s[1] }; }),
            beda: onlyA.map(function (p) { var s = p.split("||"); return { so: s[0], po: s[1], sisi: "SCM" }; })
              .concat(onlyB.map(function (p) { var s = p.split("||"); return { so: s[0], po: s[1], sisi: cmpLabel }; }))
          };
        } else if (!sopoCoverageOk && qtyOk && cbmOk) {
          // Tidak ada satu pun pasangan SO/PO yang sama sama sekali -> genuinely
          // beda, bukan sekadar rincian tambahan. Tampilkan nomor kedua sisi bila
          // masing-masing cuma 1 pasangan (tidak perlu menebak); selain itu arahkan
          // ke tab Detail SO/PO.
          var oneVsOne = a.pairs.size === 1 && b.pairs.size === 1;
          if (oneVsOne) {
            var pa = Array.from(a.pairs)[0].split("||"), pb = Array.from(b.pairs)[0].split("||");
            ket = "SCM: SO " + pa[0] + " / PO " + pa[1] + " — " + cmpLabel + ": SO " + pb[0] + " / PO " + pb[1];
          } else {
            ket = "Rincian SO/PO berbeda, tidak ada satu pun yang sama — lihat tab Detail SO/PO";
          }
        } else {
          var bits = [];
          if (!qtyOk) bits.push("selisih QTY " + C.r3(a.QTY - b.QTY) + " ctn");
          if (!cbmOk) bits.push("selisih CBM " + C.r3(a.CBM - b.CBM));
          if (sopoCoverageOk && !sopoOk) bits.push("SO/PO SCM tercakup di " + cmpLabel + " (rincian tambahan, bukan selisih)");
          else if (!sopoCoverageOk) bits.push("rincian SO/PO berbeda");
          ket = bits.join("; ");
        }

        // Baris ini dibandingkan terhadap data HISTORIS (bukan periode berjalan
        // comparator yang memang tidak ada) -- lihat blok `fromHistory` di atas.
        // classes/ket di atas sudah benar (dihasilkan oleh logic pembanding yang
        // sama persis dengan periode berjalan); di sini tinggal menyesuaikan
        // status/label supaya jelas ini perbandingan lintas periode, dan
        // memutuskan HISTORICAL_MATCH vs abnormal berdasarkan hasilnya.
        if (fromHistory) {
          var bulanH = hit.months.size
            ? Array.from(hit.months.values()).sort(function (x, y) { return x - y; }).map(C.monthLabel)
            : [];
          var periodeTxt = bulanH.length
            ? ("periode " + bulanH.join(", ") + (hit.min ? " (" + C.fmtDate(hit.min) + ")" : ""))
            : "periode lain (bukan periode berjalan)";
          status = "HANYA DI SCM";
          classes.push(CLASS.ONLY_IN_SCM);
          if (sopoCoverageOk && qtyOk && cbmOk) {
            // Data historis cocok sepenuhnya -- aman, cuma beda waktu input.
            // Awalan "NOPEN di X ada di periode " sengaja dipertahankan: explain()
            // memotong awalan ini untuk menyusun kalimat penjelasannya.
            classes.push(CLASS.HISTORICAL_MATCH);
            autoNote = "NOPEN di " + cmpLabel + " ada di " + periodeTxt + " — data QTY/CBM/SO-PO cocok, kemungkinan cuma beda waktu input ke SCM";
          } else {
            // Data historis BERBEDA -- classes QTY_MISMATCH/CBM_MISMATCH/SO_MISMATCH/
            // PO_MISMATCH di atas sudah benar, JANGAN push HISTORICAL_MATCH supaya
            // tidak menutupi temuan abnormal ini (lihat pickPrimary()).
            autoNote = "Data " + cmpLabel + " yang dibandingkan berasal dari " + periodeTxt + ".";
          }
        }
      } else if (a && !b) {
        status = "HANYA DI SCM";
        classes.push(CLASS.ONLY_IN_SCM);
        ket = "NOPEN tercatat di SCM tetapi belum ada di " + cmpLabel;
        onlyA = Array.from(a.pairs).sort();
        if (hit && hit.months.size) {
          classes.push(CLASS.HISTORICAL_MATCH);
          var bulan = Array.from(hit.months.values()).sort(function (x, y) { return x - y; }).map(C.monthLabel);
          autoNote = "NOPEN di " + cmpLabel + " ada di periode " + bulan.join(", ") +
            (hit.min ? " (" + C.fmtDate(hit.min) + ")" : "");
        } else if (history) {
          autoNote = "Tidak ditemukan di " + cmpLabel + " pada seluruh data.";
        }
        // Cross-reference: NOPEN belum ketemu langsung, tapi barangkali nomor
        // SO/PO-nya sudah tercatat di comparator di bawah NOPEN yang berbeda
        // (mis. salah ketik NOPEN, atau memang dicatat ganda).
        var crossFound = findCrossNopen(cmpIdx, a.soSet, a.poSet, n);
        if (crossFound.length) {
          crossNopen = crossFound;
          crossNote = "SO/PO ditemukan di " + cmpLabel + " dengan NOPEN " + crossFound.join(", ");
        }
      } else {
        status = "HANYA DI " + cmpLabel;
        classes.push(cmpLabel === "IOR" ? CLASS.ONLY_IN_IOR : CLASS.ONLY_IN_DRR);
        ket = "NOPEN tercatat di " + cmpLabel + " tetapi belum ada di SCM";
        onlyB = Array.from(b.pairs).sort();
        var crossFoundB = findCrossNopen(scmIdx, b.soSet, b.poSet, n);
        if (crossFoundB.length) {
          crossNopen = crossFoundB;
          crossNote = "SO/PO ditemukan di SCM dengan NOPEN " + crossFoundB.join(", ");
        }
        // Periode acuan kini 1 bulan penuh (lihat monthRange), jadi baris di
        // ujung bulan yang sama (mis. tgl 29-30) ikut dibandingkan meski data
        // SCM sendiri baru sampai tgl tertentu (mis. 28). Kalau NOPEN ini
        // tanggalnya JATUH SETELAH tanggal terakhir SCM yang sebenarnya, beri
        // catatan eksplisit -- supaya jelas ini kemungkinan besar cuma karena
        // SCM belum sempat diinput, bukan NOPEN yang benar-benar hilang.
        if (scmActualRange && scmActualRange.max && b.TGL && b.TGL > scmActualRange.max) {
          autoNote = "NOPEN inbound tgl " + C.fmtDate(b.TGL) + " — data SCM periode ini baru tercatat sampai tgl " +
            C.fmtDate(scmActualRange.max) + ", kemungkinan NOPEN ini belum sempat diinput ke SCM.";
        }
      }

      // kualitas data yang menyumbang ke NOPEN ini
      var invalid = (a ? a.invalid : 0) + (b ? b.invalid : 0);
      var missing = (a ? a.missing : 0) + (b ? b.missing : 0);
      var dupes = (a ? a.dupes : 0) + (b ? b.dupes : 0);
      if (invalid > 0) classes.push(CLASS.INVALID_DATA);
      if (missing > 0) classes.push(CLASS.MISSING_DATA);
      // Baris duplikat (kombinasi SO+PO yang sama muncul >1x pada satu sisi) TIDAK
      // dihitung sebagai abnormal. Pemeriksaan abnormal fokus hanya pada QTY, CBM,
      // SO, PO, dan NOPEN — duplikat sekadar dicatat sebagai informasi (lihat DUPES).

      if (!classes.length) classes.push(CLASS.MATCHED);
      var primary = pickPrimary(classes);

      var soScmArr = a ? Array.from(a.soSet).filter(Boolean).sort() : [];
      var poScmArr = a ? Array.from(a.poSet).filter(Boolean).sort() : [];
      var soCmpArr = b ? Array.from(b.soSet).filter(Boolean).sort() : [];
      var poCmpArr = b ? Array.from(b.poSet).filter(Boolean).sort() : [];
      var soScmSet = new Set(soScmArr), poScmSet = new Set(poScmArr);
      var soCmpSet = new Set(soCmpArr), poCmpSet = new Set(poCmpArr);
      // SO/PO yang hanya ada di salah satu sisi -- dipakai untuk highlight di export/UI.
      // Rule SO/PO untuk SEMUA NOPEN (murni struktural, SAMA seperti di atas --
      // TIDAK bergantung pada QTY/CBM, supaya flag highlight konsisten dengan status):
      // - seluruh SO SCM harus tercakup di IOR/DRR;
      // - seluruh PO SCM harus tercakup di IOR/DRR;
      // - comparator boleh memiliki SO/PO tambahan dan/atau susunan pasangan berbeda.
      var sopoStructOk = a && b &&
        Array.from(soScmSet).every(function(v){ return soCmpSet.has(v); }) &&
        Array.from(poScmSet).every(function(v){ return poCmpSet.has(v); });
      var soDiffFlag = !setEq(soScmSet, soCmpSet) && !sopoStructOk;
      var poDiffFlag = !setEq(poScmSet, poCmpSet) && !sopoStructOk;

      // Excel (build SheetJS gratis) tidak bisa menulis warna sel MAUPUN warna/bold
      // font (sudah diuji langsung, keduanya gagal -- fitur berbayar). Nilai yang
      // BEDA (hanya ada di satu sisi) ditandai tanda bintang "*" di akhir -- per
      // nilai, bukan seluruh sel -- memakai konvensi umum spreadsheet yang lebih
      // halus dibanding simbol/emoji. Untuk tampilan web, highlight warna asli dipakai.
      function markDiff(arr, otherSet) {
        return arr.map(function (v) { return otherSet.has(v) ? v : v + "*"; });
      }
      var soScmMarked = markDiff(soScmArr, soCmpSet).join("; ");
      var poScmMarked = markDiff(poScmArr, poCmpSet).join("; ");
      var soCmpMarked = markDiff(soCmpArr, soScmSet).join("; ");
      var poCmpMarked = markDiff(poCmpArr, poScmSet).join("; ");

      main.push({
        NOPEN: n, STATUS: status, CLASSES: classes, PRIMARY: primary,
        SEVERITY: SEVERITY[primary] || "NONE",
        // Shipper: satu NOPEN kadang punya lebih dari satu nama shipper pada
        // baris-baris sumbernya (mis. dikirim beberapa vendor berbeda), ATAU
        // shipment-nya "terpecah" jadi NOPEN lain yang berbeda di salah satu
        // sisi (SO/PO sama, NOPEN beda -- lihat findCrossNopen). Supaya tidak
        // ada info shipper yang hilang, SHIPPER_SCM/SHIPPER_CMP juga menarik
        // shipper dari NOPEN lain yang ternyata memuat SO/PO yang sama dengan
        // sisi seberangnya (dipisah "; " bila lebih dari satu nama).
        SHIPPER_SCM: (function () {
          var set = new Set(a ? Array.from(a.shipperSet) : []);
          if (b) {
            findCrossNopen(scmIdx, b.soSet, b.poSet, n).forEach(function (nn) {
              var g = A.get(nn);
              if (g) g.shipperSet.forEach(function (s) { set.add(s); });
            });
          }
          return Array.from(set).join("; ");
        })(),
        SHIPPER_CMP: (function () {
          var set = new Set(b ? Array.from(b.shipperSet) : []);
          if (a) {
            findCrossNopen(cmpIdx, a.soSet, a.poSet, n).forEach(function (nn) {
              var g = B.get(nn);
              if (g) g.shipperSet.forEach(function (s) { set.add(s); });
            });
          }
          return Array.from(set).join("; ");
        })(),
        SHIPPER: (function () {
          var scmSet = new Set(a ? Array.from(a.shipperSet) : []);
          if (b) findCrossNopen(scmIdx, b.soSet, b.poSet, n).forEach(function (nn) {
            var g = A.get(nn); if (g) g.shipperSet.forEach(function (s) { scmSet.add(s); });
          });
          if (scmSet.size) return Array.from(scmSet).join("; ");
          var cmpSet = new Set(b ? Array.from(b.shipperSet) : []);
          if (a) findCrossNopen(cmpIdx, a.soSet, a.poSet, n).forEach(function (nn) {
            var g = B.get(nn); if (g) g.shipperSet.forEach(function (s) { cmpSet.add(s); });
          });
          if (cmpSet.size) return Array.from(cmpSet).join("; ");
          var hist = history && history.get(n);
          return (hist && hist.shipper) ? hist.shipper : "";
        })(),
        SO_SCM: soScmArr, PO_SCM: poScmArr, SO_CMP: soCmpArr, PO_CMP: poCmpArr,
        SO_SCM_TXT: soScmArr.join("; "), PO_SCM_TXT: poScmArr.join("; "),
        SO_CMP_TXT: soCmpArr.join("; "), PO_CMP_TXT: poCmpArr.join("; "),
        SO_SCM_MARKED: soScmMarked, PO_SCM_MARKED: poScmMarked,
        SO_CMP_MARKED: soCmpMarked, PO_CMP_MARKED: poCmpMarked,
        SO_SCM_SET: soScmSet, PO_SCM_SET: poScmSet, SO_CMP_SET: soCmpSet, PO_CMP_SET: poCmpSet,
        SO_DIFF: soDiffFlag, PO_DIFF: poDiffFlag,
        TGL_SCM: a ? a.TGL : null,
        TGL_UNLOAD: (b && b.UNLOAD) ? b.UNLOAD : (history && history.get(n) ? history.get(n).unload : null),
        TGL_UNLOAD_MAX: (b && b.UNLOAD) ? b.UNLOAD_MAX : (history && history.get(n) ? history.get(n).unloadMax : null),
        LINES_SCM: a ? a.lines : 0, LINES_CMP: b ? b.lines : 0,
        QTY_SCM: qs, QTY_CMP: qc, QTY_DIFF: (a || b) ? C.r3((a ? qs : 0) - (b ? qc : 0)) : null, CEK_QTY: cekQty,
        QTY_SCM_INVALID: a ? a.invalidQty : 0, QTY_CMP_INVALID: b ? b.invalidQty : 0,
        CBM_SCM: cs, CBM_CMP: cc, CBM_DIFF: (a || b) ? C.r3((a ? cs : 0) - (b ? cc : 0)) : null, CEK_CBM: cekCbm,
        CBM_SCM_INVALID: a ? a.invalidCbm : 0, CBM_CMP_INVALID: b ? b.invalidCbm : 0,
        CEK_SOPO: cekSopo, KETERANGAN: ket, AUTO: autoNote, SOPO_INFO: sopoInfo,
        // true = kolom pembanding (SO/PO/QTY/CBM IOR/DRR) baris ini diisi dari data
        // HISTORIS periode lain, bukan periode berjalan. Total periode (monitor QTY/
        // CBM & ringkasan export) wajib mengecualikan nilai pembanding baris ini.
        FROM_HISTORY: fromHistory,
        CROSS_NOPEN: crossNopen, CROSS_NOTE: crossNote,
        INVALID: invalid, MISSING: missing, DUPES: dupes,
        ROWS_SCM: a ? a.rowsRef : [], ROWS_CMP: b ? b.rowsRef : [],
        // Perbandingan tambahan murni informasional (diminta terpisah dari status
        // abnormal, yang tetap ditentukan oleh QTY/QTY KMS seperti sebelumnya).
        QTY_PACKAGE_SCM: (a && a.hasQtyPackage) ? C.r3(a.QTY_PACKAGE) : null,
        QTY_PACKAGE_MATCH: (a && a.hasQtyPackage && b)
          ? Math.abs(a.QTY_PACKAGE - b.QTY) <= C.QTY_TOL
          : null
      });

      var scmSingle = a && a.lines === 1 ? Array.from(a.pairs)[0].split("||") : null;
      var cmpSingle = b && b.lines === 1 ? Array.from(b.pairs)[0].split("||") : null;
      var rowStatus = a && b ? (lenient ? "INFO" : "ABNORMAL") : "ABNORMAL";
      var issueLabel = a && b ? (lenient ? "SO/PO INFO" : "SO/PO MISMATCH") : (a ? "ONLY IN SCM" : "ONLY IN " + cmpLabel);
      var detailExplain = lenient
        ? "Pasangan SO/PO ini hanya rincian tambahan di " + cmpLabel + " -- total QTY & CBM NOPEN sudah cocok dengan SCM, jadi bukan ketidaksesuaian."
        : "Pasangan SO/PO ini tercatat di SCM tetapi tidak ditemukan padanannya di " + cmpLabel + ".";
      var detailAction = lenient
        ? "Tidak perlu tindakan -- informasi tambahan saja."
        : "Cocokkan pasangan SO/PO ini dengan data " + cmpLabel + " secara manual.";

      onlyA.forEach(function (p) {
        var i = p.indexOf("||");
        detail.push({
          NOPEN: n, BRAND: "", ISSUE: issueLabel, SOURCE: "SCM", ADA_DI: "SCM",
          SO: p.slice(0, i), PO: p.slice(i + 2),
          SCM_SO: p.slice(0, i), SCM_PO: p.slice(i + 2),
          CMP_SO: cmpSingle ? cmpSingle[0] : "", CMP_PO: cmpSingle ? cmpSingle[1] : "",
          STATUS_NOPEN: status, ROW_STATUS: rowStatus,
          EXPLANATION: detailExplain,
          ACTION: detailAction
        });
      });
      onlyB.forEach(function (p) {
        var i = p.indexOf("||");
        detail.push({
          NOPEN: n, BRAND: "", ISSUE: issueLabel, SOURCE: cmpLabel, ADA_DI: cmpLabel,
          SO: p.slice(0, i), PO: p.slice(i + 2),
          SCM_SO: scmSingle ? scmSingle[0] : "", SCM_PO: scmSingle ? scmSingle[1] : "",
          CMP_SO: p.slice(0, i), CMP_PO: p.slice(i + 2),
          STATUS_NOPEN: status, ROW_STATUS: rowStatus,
          EXPLANATION: lenient
            ? detailExplain
            : "Pasangan SO/PO ini tercatat di " + cmpLabel + " tetapi tidak ditemukan padanannya di SCM.",
          ACTION: lenient
            ? detailAction
            : "Cocokkan pasangan SO/PO ini dengan data SCM secara manual."
        });
      });
    });

    return enrich({ main: main, detail: detail, cmpLabel: cmpLabel }, cmpLabel);
  }

  function setEq(x, y) {
    if (x.size !== y.size) return false;
    var eq = true;
    x.forEach(function (v) { if (!y.has(v)) eq = false; });
    return eq;
  }

  function pickPrimary(classes) {
    // NOPEN yang datanya ditemukan di histori IOR/DRR pada periode lain TIDAK
    // dianggap abnormal ataupun "hanya di SCM" -- historical match menjelaskan
    // kenapa belum ketemu di periode berjalan, jadi diprioritaskan sebagai
    // primary di atas ONLY_IN_SCM/ONLY_IN_IOR/ONLY_IN_DRR.
    if (classes.indexOf(CLASS.HISTORICAL_MATCH) !== -1) return CLASS.HISTORICAL_MATCH;

    var best = classes[0], bestRank = -1;
    classes.forEach(function (c) {
      if (c === CLASS.MATCHED) return;
      var r = SEV_RANK[SEVERITY[c]] || 0;
      if (r > bestRank) { bestRank = r; best = c; }
    });
    if (bestRank === -1) {
      // hanya MATCHED
      return classes.indexOf(CLASS.ONLY_IN_SCM) !== -1 ? CLASS.ONLY_IN_SCM
        : (classes.indexOf(CLASS.MATCHED) !== -1 ? CLASS.MATCHED : classes[0]);
    }
    return best;
  }

  function isIssue(r) { return r.PRIMARY !== CLASS.MATCHED; }

  /* ---------- EXPLANATION ENGINE ----------
     Menghasilkan Issue / Explanation / Action Required otomatis per baris,
     sehingga user yang belum memahami logic aplikasi tetap bisa membaca
     "apa masalahnya, kenapa, dan harus ngapain" tanpa bertanya ke developer.
     Aturan ini murni presentasi — tidak mengubah hasil klasifikasi di atas. */
  var ISSUE_LABEL = {
    MATCHED: "CLEAR",
    QTY_MISMATCH: "QTY MISMATCH",
    CBM_MISMATCH: "CBM MISMATCH",
    SO_MISMATCH: "SO MISMATCH",
    PO_MISMATCH: "PO MISMATCH",
    SO_PO_MISMATCH: "SO/PO MISMATCH",
    ONLY_IN_SCM: "ONLY IN SCM",
    ONLY_IN_IOR: "ONLY IN IOR",
    ONLY_IN_DRR: "ONLY IN DRR",
    HISTORICAL_MATCH: "HISTORICAL MATCH",
    INVALID_DATA: "INVALID DATA",
    DUPLICATE: "DUPLICATE ROW",
    MISSING_DATA: "MISSING DATA"
  };

  var ACTION_LABEL = {
    MATCHED: "",
    QTY_MISMATCH: "Cek Aktual BC 33",
    CBM_MISMATCH: "Cek CBM",
    SO_MISMATCH: "Cek SO",
    PO_MISMATCH: "Cek PO",
    SO_PO_MISMATCH: "Cek SO",
    ONLY_IN_SCM: "Periksa status inbound / GRN di {cmp}, atau kemungkinan perbedaan periode.",
    ONLY_IN_IOR: "Periksa apakah NOPEN sudah terbit di SCM/bea cukai.",
    ONLY_IN_DRR: "Periksa apakah NOPEN sudah terbit di SCM/bea cukai.",
    HISTORICAL_MATCH: "Review apakah transaksi memang milik periode sebelumnya, bukan periode berjalan.",
    INVALID_DATA: "Perbaiki data sumber (QTY/CBM/tanggal) sebelum hasil dianggap final.",
    DUPLICATE: "Periksa kemungkinan baris terduplikasi pada sumber data.",
    MISSING_DATA: "Lengkapi SO/PO yang kosong pada sumber data."
  };

  function explain(r, cmpLabel) {
    var lines = [];
    if (has(r, CLASS.QTY_MISMATCH)) {
      lines.push("QTY SCM " + fnum(r.QTY_SCM) + " vs " + cmpLabel + " " + fnum(r.QTY_CMP) +
        ", selisih " + fnum(Math.abs(r.QTY_DIFF)) + " carton.");
    }
    if (has(r, CLASS.CBM_MISMATCH)) {
      lines.push("CBM SCM " + fnum(r.CBM_SCM, 3) + " vs " + cmpLabel + " " + fnum(r.CBM_CMP, 3) +
        ", selisih " + fnum(Math.abs(r.CBM_DIFF), 3) + " (toleransi " + C.CBM_TOL + ").");
    }
    if (has(r, CLASS.SO_PO_MISMATCH) || has(r, CLASS.SO_MISMATCH) || has(r, CLASS.PO_MISMATCH)) {
      var qOk = !has(r, CLASS.QTY_MISMATCH), cOk = !has(r, CLASS.CBM_MISMATCH);
      if (qOk && cOk) lines.push("QTY dan CBM sesuai, tetapi pasangan SO/PO berbeda.");
      else lines.push("Pasangan SO/PO berbeda antara SCM dan " + cmpLabel + ".");
    }
    if (r.SOPO_INFO) {
      lines.push("SO/PO yang sama: " +
        r.SOPO_INFO.sama.map(function (p) { return "SO " + p.so + " / PO " + p.po; }).join(", ") + ". " +
        "SO/PO tambahan (tidak dihitung abnormal): " +
        r.SOPO_INFO.beda.map(function (p) { return "SO " + p.so + " / PO " + p.po + " (" + p.sisi + ")"; }).join(", ") + ".");
    }
    if (has(r, CLASS.ONLY_IN_SCM)) {
      if (has(r, CLASS.HISTORICAL_MATCH)) {
        lines.push("NOPEN tidak ditemukan pada periode aktif, tetapi ditemukan pada histori " + r.AUTO.replace(/^NOPEN di \w+ ada di periode /, "") + ".");
      } else if (r.FROM_HISTORY) {
        lines.push("NOPEN belum ada di " + cmpLabel + " periode berjalan; dibandingkan dengan data " + cmpLabel + " periode lain dan ditemukan selisih.");
      } else {
        lines.push("NOPEN terdapat di SCM tetapi belum ditemukan di " + cmpLabel + ".");
      }
    }
    if (has(r, CLASS.ONLY_IN_IOR) || has(r, CLASS.ONLY_IN_DRR)) {
      lines.push("NOPEN terdapat di " + cmpLabel + " tetapi belum ditemukan di SCM.");
    }
    if (has(r, CLASS.INVALID_DATA)) {
      lines.push(r.INVALID + " baris sumber memiliki QTY/CBM yang tidak valid (bukan angka atau kosong).");
    }
    if (has(r, CLASS.MISSING_DATA)) lines.push(r.MISSING + " baris memiliki SO atau PO kosong.");
    if (!lines.length) lines.push("Tidak ditemukan discrepancy.");
    // Duplikat dicatat sebagai info tambahan saja -- tidak memengaruhi status abnormal.
    if (r.DUPES > 0) lines.push("Catatan: " + r.DUPES + " kombinasi SO+PO terduplikasi pada sumber (sudah termasuk dalam total, tidak dihitung abnormal).");
    return lines.join(" ");
  }

  function actionFor(r, cmpLabel) {
    // Action Required otomatis berdasarkan kondisi (kolom Temuan) yang benar-benar
    // terjadi pada baris ini. Bila lebih dari satu kondisi terjadi bersamaan,
    // semua tindakan yang relevan digabung (tanpa duplikasi frasa).
    var checks = [];
    var needAdmin = false;
    if (has(r, CLASS.QTY_MISMATCH) || has(r, CLASS.CBM_MISMATCH)) {
      checks.push("Cek Aktual BC 33");
      needAdmin = true;
    }
    if (has(r, CLASS.SO_MISMATCH) || has(r, CLASS.PO_MISMATCH) || has(r, CLASS.SO_PO_MISMATCH)) {
      checks.push("Cek Aktual INV + PL");
      needAdmin = true;
    }
    if (has(r, CLASS.ONLY_IN_IOR) || has(r, CLASS.ONLY_IN_DRR)) {
      checks.push("Cek Aktual BC 33");
    }
    if (has(r, CLASS.ONLY_IN_SCM) && !has(r, CLASS.HISTORICAL_MATCH)) {
      needAdmin = true;
    }
    checks = checks.filter(function (v, i) { return checks.indexOf(v) === i; }); // dedupe
    var txt = checks.join(" & ");
    if (needAdmin) txt = txt ? (txt + " & Cek ke Tim Admin") : "Cek ke Tim Admin";
    if (!txt) txt = (ACTION_LABEL[r.PRIMARY] || "").replace("{cmp}", cmpLabel);
    return txt;
  }

  function has(r, cls) { return r.CLASSES.indexOf(cls) !== -1; }
  function fnum(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toLocaleString("id-ID", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }

  function issueLabelFor(r) {
    // Gabungkan SEMUA kondisi abnormal yang benar-benar terjadi pada NOPEN ini,
    // bukan cuma yang paling parah (PRIMARY) -- supaya kolom ISSUE/Temuan di
    // report maupun UI menceritakan keseluruhan masalah saat lebih dari satu
    // kondisi terjadi bersamaan (mis. SO MISMATCH + QTY MISMATCH).
    var parts = [];
    var historical = has(r, CLASS.HISTORICAL_MATCH);
    if (historical) {
      var histLabel = "HISTORICAL MATCH";
      if (r.CROSS_NOTE) histLabel += " — " + r.CROSS_NOTE;
      return histLabel;
    }
    // Baris yang dibandingkan terhadap data IOR/DRR bulan lain (FROM_HISTORY)
    // dan datanya tidak cocok: labelnya "HISTORICAL + ... MISMATCH" -- tetap
    // abnormal/merah, karena HISTORICAL_MATCH sengaja tidak di-push (lihat reconcile()).
    if (has(r, CLASS.ONLY_IN_SCM)) parts.push(r.FROM_HISTORY ? "HISTORICAL" : "ONLY IN SCM");
    if (has(r, CLASS.ONLY_IN_IOR)) parts.push("ONLY IN IOR");
    if (has(r, CLASS.ONLY_IN_DRR)) parts.push("ONLY IN DRR");
    if (has(r, CLASS.QTY_MISMATCH)) parts.push("QTY MISMATCH");
    if (has(r, CLASS.CBM_MISMATCH)) parts.push("CBM MISMATCH");
    if (has(r, CLASS.SO_PO_MISMATCH)) parts.push("SO/PO MISMATCH");
    else {
      if (has(r, CLASS.SO_MISMATCH)) parts.push("SO MISMATCH");
      if (has(r, CLASS.PO_MISMATCH)) parts.push("PO MISMATCH");
    }
    if (has(r, CLASS.INVALID_DATA)) parts.push("INVALID DATA");
    if (has(r, CLASS.MISSING_DATA)) parts.push("MISSING DATA");
    if (has(r, CLASS.DUPLICATE)) parts.push("DUPLICATE");
    if (!parts.length) return ISSUE_LABEL[r.PRIMARY] || r.PRIMARY;
    var label = parts.join(" + ");
    if (r.CROSS_NOTE) label += " — " + r.CROSS_NOTE;
    return label;
  }

  function enrich(pack, cmpLabel) {
    pack.main.forEach(function (r) {
      r.ISSUE = issueLabelFor(r);
      r.ROW_STATUS = ROW_STATUS[r.PRIMARY] || "ABNORMAL";
      r.PRIORITY = PRIORITY[r.SEVERITY] || "-";
      var baseExplanation = explain(r, cmpLabel);
      var extraNotes = [];
      // Untuk HISTORICAL_MATCH, isi AUTO sudah dirangkai ke kalimat utama oleh
      // explain() -- jangan diulang lagi sebagai catatan tambahan.
      if (r.AUTO && !has(r, CLASS.HISTORICAL_MATCH)) extraNotes.push(r.AUTO);
      if (r.CROSS_NOTE) extraNotes.push(r.CROSS_NOTE);
      r.EXPLANATION = baseExplanation + extraNotes.map(function (t) { return "\n- " + t; }).join("");
      r.ACTION = actionFor(r, cmpLabel);
    });
    return pack;
  }

  /* ---------- ringkasan ---------- */
  function summarize(pack) {
    if (!pack) return null;
    var m = pack.main, s = {
      total: m.length, clear: 0, abnormal: 0, historicalOnly: 0,
      qty: 0, cbm: 0, sopo: 0, onlyScm: 0, onlyCmp: 0, historical: 0, invalid: 0, duplicate: 0, missing: 0,
      qtyPkgChecked: 0, qtyPkgMatch: 0, qtyPkgDiff: 0,
      cmpLabel: pack.cmpLabel
    };
    var byMonth = new Map();
    m.forEach(function (r) {
      if (r.ROW_STATUS === "CLEAR") s.clear++;
      else if (r.ROW_STATUS === "HISTORICAL") s.historicalOnly++;
      else s.abnormal++;
      if (r.CLASSES.indexOf(CLASS.QTY_MISMATCH) !== -1) s.qty++;
      if (r.CLASSES.indexOf(CLASS.CBM_MISMATCH) !== -1) s.cbm++;
      if (r.CLASSES.indexOf(CLASS.SO_MISMATCH) !== -1 ||
          r.CLASSES.indexOf(CLASS.PO_MISMATCH) !== -1 ||
          r.CLASSES.indexOf(CLASS.SO_PO_MISMATCH) !== -1) s.sopo++;
      if (r.CLASSES.indexOf(CLASS.ONLY_IN_SCM) !== -1) s.onlyScm++;
      if (r.CLASSES.indexOf(CLASS.ONLY_IN_IOR) !== -1 || r.CLASSES.indexOf(CLASS.ONLY_IN_DRR) !== -1) s.onlyCmp++;
      if (r.CLASSES.indexOf(CLASS.HISTORICAL_MATCH) !== -1) s.historical++;
      if (r.CLASSES.indexOf(CLASS.INVALID_DATA) !== -1) s.invalid++;
      if (r.CLASSES.indexOf(CLASS.DUPLICATE) !== -1) s.duplicate++;
      if (r.CLASSES.indexOf(CLASS.MISSING_DATA) !== -1) s.missing++;
      if (r.QTY_PACKAGE_MATCH !== null) {
        s.qtyPkgChecked++;
        if (r.QTY_PACKAGE_MATCH) s.qtyPkgMatch++; else s.qtyPkgDiff++;
      }
      // Total NOPEN per bulan: pakai TGL GRN (SCM) bila ada, kalau tidak pakai
      // TGL Unloading, supaya setiap NOPEN tetap terhitung di satu bulan.
      var d = r.TGL_SCM || r.TGL_UNLOAD;
      if (d) {
        var key = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
        byMonth.set(key, (byMonth.get(key) || 0) + 1);
      } else {
        byMonth.set("_tanpa_tanggal", (byMonth.get("_tanpa_tanggal") || 0) + 1);
      }
    });
    s.clearRate = s.total ? (s.clear / s.total * 100) : 0;
    s.abnormalRate = s.total ? (s.abnormal / s.total * 100) : 0;
    s.byMonth = Array.from(byMonth.entries())
      .sort(function (x, y) { return x[0] < y[0] ? -1 : 1; })
      .map(function (e) {
        if (e[0] === "_tanpa_tanggal") return { label: "Tanpa tanggal", count: e[1] };
        var parts = e[0].split("-");
        return { label: C.BULAN_PANJANG[+parts[1] - 1] + " " + parts[0], count: e[1] };
      });
    return s;
  }

  return {
    CLASS: CLASS, LABEL: LABEL, SEVERITY: SEVERITY, PRIORITY: PRIORITY, ROW_STATUS: ROW_STATUS,
    ISSUE_LABEL: ISSUE_LABEL,
    aggregate: aggregate, buildHistory: buildHistory, dateRange: dateRange, monthRange: monthRange,
    scopeToPeriod: scopeToPeriod, reconcile: reconcile, summarize: summarize, isIssue: isIssue
  };
})(APP);

export default engine;
