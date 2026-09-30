// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Penyusun workbook Excel (README, Summary, Cek Adidas/Nike, Case, Detail SOPO, Data Quality, Riwayat).
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

export function createWorkbookExporter(C, E, CASES) {
return (function (C, E, CASES) {
  "use strict";

  function sc(v) { return C.safeCell(v); }
  // Duplikat lokal dari displayCaseId() di app-ui-logic (module ini punya closure
  // sendiri, tidak bisa memakai fungsi yang didefinisikan di script terpisah).
  function displayCaseId(caseId) {
    var p = CASES.parseKey(caseId);
    return p.nopen + "-" + p.seq;
  }

  /* ---------------- SHEET 1: README ---------------- */
  function aoaReadme(state) {
    var rows = [
      ["REKONSILIASI INBOUND — PETUNJUK MEMBACA REPORT"], [],
      ["Aplikasi", C.META.name], ["Versi", C.META.version], ["Build", C.META.build],
      ["Dibuat", C.fmtStamp(state.generated.toISOString())],
      ["Oleh", sc(CASES.currentUser())], [],
      ["TUJUAN"],
      ["Report ini digunakan untuk merekonsiliasi data inbound SCM terhadap IOR (Adidas)"],
      ["dan DRR (Nike) berdasarkan NOPEN, sehingga selisih dan kejanggalan dapat"],
      ["ditemukan dan ditindaklanjuti sebelum menjadi masalah operasional."], [],
      ["LOGIKA DASAR"],
      ["1. Data dikelompokkan berdasarkan NOPEN (satu NOPEN bisa terdiri dari beberapa baris)."],
      ["2. QTY dijumlahkan per NOPEN, lalu dibandingkan - harus sama persis."],
      ["3. CBM dijumlahkan per NOPEN, lalu dibandingkan dengan toleransi " + C.CBM_TOL + "."],
      ["4. Setelah total QTY & CBM cocok, pasangan SO/PO tetap diperiksa satu per satu."],
      ["5. Pemeriksaan dilakukan DUA ARAH: SCM ke IOR/DRR, dan IOR/DRR ke SCM."],
      ["6. NOPEN yang tidak ditemukan pada periode berjalan ditelusuri ke seluruh histori data."], [],
      ["CARA MEMBACA STATUS"],
      ["CLEAR", "Tidak ditemukan discrepancy. Tidak ada tindakan diperlukan."],
      ["ABNORMAL", "Ditemukan ketidaksesuaian (QTY/CBM/SO/PO/data tidak valid, atau NOPEN baru ada di satu sisi). Perlu tindakan."],
      ["HISTORICAL", "NOPEN ditemukan pada periode sebelumnya, bukan periode yang sedang diperiksa."],
      ["INCOMPLETE", "Salah satu sumber data wajib belum tersedia - hasil belum bisa dinyatakan final."], [],
      ["CARA MENANGANI ABNORMAL"],
      ["Issue", "Artinya", "Yang harus dicek", "Tab yang dibuka"],
      ["QTY MISMATCH", "Jumlah carton berbeda antara SCM dan IOR/DRR", "Bandingkan angka QTY kedua sisi", "Cek Adidas / Cek Nike"],
      ["CBM MISMATCH", "Volume berbeda melebihi toleransi " + C.CBM_TOL, "Bandingkan angka CBM kedua sisi", "Cek Adidas / Cek Nike"],
      ["SO/PO MISMATCH", "Pasangan nomor SO/PO tidak sama", "Cocokkan nomor SO & PO", "Detail SOPO"],
      ["ONLY IN SCM", "NOPEN baru tercatat di SCM", "Cek status GRN / periode di IOR-DRR", "Cek Adidas / Cek Nike"],
      ["ONLY IN IOR/DRR", "NOPEN baru tercatat di lapangan", "Cek apakah sudah terbit di SCM", "Cek Adidas / Cek Nike"],
      ["HISTORICAL MATCH", "NOPEN ketemu di periode lain", "Pastikan bukan salah periode", "Cek Adidas / Cek Nike"],
      ["INVALID DATA", "Ada baris sumber dengan QTY/CBM tidak valid", "Perbaiki data di sumber, bukan diabaikan", "Data Quality"], [],
      ["CARA MEMBACA KOLOM SO / PO (TAB CEK ADIDAS / CEK NIKE)"],
      ["Kolom 'SO SCM' & 'PO SCM' berisi nomor dari SCM, kolom 'SO IOR/DRR' & 'PO IOR/DRR' dari IOR/DRR."],
      ["Nomor yang diberi tanda bintang (*) di akhir berarti nomor tersebut HANYA ada di kolom itu"],
      ["(tidak ditemukan padanannya di sisi lain) -- itulah SO/PO yang berbeda dan perlu dicek."],
      ["Nomor tanpa tanda bintang berarti sama dan ditemukan di kedua sumber."],
      ["Selama masih ada minimal satu nomor SO/PO yang sama di kedua sisi dan total QTY & CBM cocok,"],
      ["NOPEN tidak dianggap abnormal -- hanya dicatat sebagai rincian tambahan."], [],
      ["URUTAN MEMBACA REPORT YANG DISARANKAN"],
      ["1. Buka tab Summary - pahami kondisi keseluruhan dalam kurang dari 10 detik."],
      ["2. Untuk detail lengkap per NOPEN, buka tab Cek Adidas / Cek Nike."],
      ["3. Untuk rincian pasangan SO/PO yang berbeda, buka tab Detail SOPO."],
      ["4. Untuk memeriksa kualitas data sumber, buka tab Data Quality."], [],
      ["SUMBER DATA (FILE TRACEABILITY)"],
      ["SCM", sc(state.sources.scm || "-")],
      ["Adidas / IOR", sc(state.sources.ior || "-")],
      ["Nike / DRR", sc(state.sources.nike || "-")],
      ["Periode rekonsiliasi", state.scope && state.scope.applied
        ? (C.fmtDate(state.scope.lo) + " - " + C.fmtDate(state.scope.hi)) : "Mengikuti tanggal pada berkas SCM"]
    ];
    return rows;
  }

  /* ---------------- SHEET 2: SUMMARY ---------------- */
  function aoaSummary(state) {
    var sa = state.adidas ? E.summarize(state.adidas) : null;
    var sn = state.nike ? E.summarize(state.nike) : null;
    var pct = function (v) { return (Math.round((v || 0) * 10) / 10) + "%"; };
    var v = function (s, k) { return s ? s[k] : "-"; };

    var rows = [
      ["REKONSILIASI INBOUND"],
      [C.fmtDate(C.toDate(state.generated))], [],
      ["Status keseluruhan", state.overall.status],
      ["Catatan", sc(state.overall.reason)], [],
      ["Generated", C.fmtStamp(state.generated.toISOString())],
      ["Application version", C.META.name + " " + C.META.version],
      ["SCM source", sc(state.sources.scm || "-")],
      ["Adidas/IOR source", sc(state.sources.ior || "-")],
      ["Nike/DRR source", sc(state.sources.nike || "-")], []
    ];

    if (sa) rows = rows.concat([
      ["ADIDAS"],
      ["NOPEN CHECKED", sa.total],
      ["CLEAR", sa.clear],
      ["ABNORMAL", sa.abnormal],
      ["HISTORICAL", sa.historicalOnly],
      ["CLEAR RATE", pct(sa.clearRate)],
      ["ABNORMAL RATE", pct(sa.abnormalRate)], []
    ]);
    if (sn) rows = rows.concat([
      ["NIKE"],
      ["NOPEN CHECKED", sn.total],
      ["CLEAR", sn.clear],
      ["ABNORMAL", sn.abnormal],
      ["HISTORICAL", sn.historicalOnly],
      ["CLEAR RATE", pct(sn.clearRate)],
      ["ABNORMAL RATE", pct(sn.abnormalRate)], []
    ]);

    rows = rows.concat([
      ["ABNORMAL BREAKDOWN", "ADIDAS", "NIKE"],
      ["SO/PO MISMATCH", v(sa, "sopo"), v(sn, "sopo")],
      ["QTY MISMATCH", v(sa, "qty"), v(sn, "qty")],
      ["CBM MISMATCH", v(sa, "cbm"), v(sn, "cbm")],
      ["ONLY IN SCM", v(sa, "onlyScm"), v(sn, "onlyScm")],
      ["ONLY IN IOR/DRR", v(sa, "onlyCmp"), v(sn, "onlyCmp")],
      ["HISTORICAL MATCH", v(sa, "historical"), v(sn, "historical")],
      ["INVALID DATA", v(sa, "invalid"), v(sn, "invalid")],
      ["DUPLICATE", v(sa, "duplicate"), v(sn, "duplicate")],
      ["MISSING DATA", v(sa, "missing"), v(sn, "missing")], []
    ]);

    rows.push(["NOPEN dengan case tindak lanjut", CASES.countFor("ADIDAS"), CASES.countFor("NIKE")]);
    rows.push(["Case masih terbuka", CASES.openCountFor("ADIDAS"), CASES.openCountFor("NIKE")]);

    [["IOR", state.scopeIor], ["DRR", state.scope]].forEach(function (pair) {
      var label = pair[0], sc = pair[1];
      if (!sc || !sc.applied) return;
      rows.push([]);
      rows.push(["Periode dibandingkan (dari SCM)", C.fmtDate(sc.lo) + " - " + C.fmtDate(sc.hi)]);
      rows.push(["Berkas " + label + " mencakup", C.fmtDate(sc.srcMin) + " - " + C.fmtDate(sc.srcMax)]);
      rows.push(["Baris " + label + " dipakai", sc.after]);
      rows.push(["Baris " + label + " di luar periode", sc.before - sc.after]);
    });
    (state.warnings || []).forEach(function (w) { rows.push(["Catatan pemrosesan", sc(w)]); });
    return rows;
  }

  /* ---------------- SHEET 4/5: CEK ADIDAS / CEK NIKE (detail lengkap) ---------------- */
  function mainHead(cmpLabel) {
    return ["NOPEN", "TGL GRN (SCM)", "TGL UNLOADING (" + cmpLabel + ")",
      "SHIPPER SCM", "SHIPPER " + cmpLabel,
      "SO SCM", "SO " + cmpLabel, "PO SCM", "PO " + cmpLabel, "CEK SO/PO",
      "QTY SCM", "QTY " + cmpLabel, "Selisih QTY", "CEK QTY",
      "CBM SCM", "CBM " + cmpLabel, "Selisih CBM", "CEK CBM",
      "STATUS", "ISSUE", "EXPLANATION",
      "JUMLAH CASE", "RINGKASAN STATUS CASE"];
  }
  var MAIN_COLS = [10, 14, 20, 26, 26, 20, 20, 20, 20, 11, 10, 10, 11, 10, 11, 11, 11, 10, 11, 22, 50, 12, 50];

  // 1 NOPEN bisa punya beberapa case (lihat sheet "Case per Finding" untuk rincian
  // 1 baris/case) -- sheet ini tetap 1 baris/NOPEN (grain rekonsiliasi mentah),
  // jadi kolom case di sini cuma ringkasan jumlah & sebaran status.
  function mainRow(r, brand) {
    var cs = CASES.getAllForNopen(brand, r.NOPEN);
    var counts = {};
    cs.forEach(function(c){ counts[c.status] = (counts[c.status]||0)+1; });
    var summary = CASES.STATUS.map(function(s){ return counts[s] ? (counts[s]+" "+s) : null; }).filter(Boolean).join(", ");
    return [
      sc(r.NOPEN),
      r.TGL_SCM ? C.fmtDate(r.TGL_SCM) : "",
      r.TGL_UNLOAD ? C.fmtDateRange(r.TGL_UNLOAD, r.TGL_UNLOAD_MAX) : "",
      sc(r.SHIPPER_SCM), sc(r.SHIPPER_CMP),
      sc(r.SO_SCM_MARKED), sc(r.SO_CMP_MARKED), sc(r.PO_SCM_MARKED), sc(r.PO_CMP_MARKED), r.CEK_SOPO,
      r.QTY_SCM, r.QTY_CMP, r.QTY_DIFF, r.CEK_QTY,
      r.CBM_SCM, r.CBM_CMP, r.CBM_DIFF, r.CEK_CBM,
      r.ROW_STATUS, r.ISSUE, sc(r.EXPLANATION),
      cs.length, sc(summary)
    ];
  }
  function aoaMain(pack, brand) {
    return [mainHead(pack.cmpLabel)].concat(pack.main.map(function (r) { return mainRow(r, brand); }));
  }
  function aoaIssuesOnly(pack, brand) {
    return [mainHead(pack.cmpLabel)].concat(pack.main.filter(E.isIssue).map(function (r) { return mainRow(r, brand); }));
  }

  /* ---------------- SHEET 6: DETAIL SOPO (upgraded) ---------------- */
  var DETAIL_HEAD = ["NOPEN", "Brand", "Issue", "Source", "SCM SO", "SCM PO",
    "IOR/DRR SO", "IOR/DRR PO", "Status", "Explanation"];
  var DETAIL_COLS = [12, 9, 16, 16, 20, 20, 20, 20, 11, 46];

  function aoaDetail(pack, brand) {
    return [DETAIL_HEAD].concat(pack.detail.map(function (d) {
      return [sc(d.NOPEN), brand, d.ISSUE, d.SOURCE,
        sc(d.SCM_SO), sc(d.SCM_PO), sc(d.CMP_SO), sc(d.CMP_PO),
        d.ROW_STATUS, sc(d.EXPLANATION)];
    }));
  }

  /* ---------------- SHEET 7: DATA QUALITY ---------------- */
  function aoaQuality(state) {
    var rows = [["DATA QUALITY"], [],
      ["BERKAS", "SHEET", "STATUS", "BARIS TERBACA", "BARIS VALID",
       "NOPEN KOSONG", "QTY TIDAK VALID", "CBM TIDAK VALID", "TANGGAL TIDAK VALID",
       "SO KOSONG", "PO KOSONG", "DUPLIKAT NOPEN+SO+PO", "CATATAN"]];
    (state.quality || []).forEach(function (q) {
      rows.push([
        sc(q.file), sc(q.report.sheet), q.severity,
        q.report.totalRows, q.report.validRows,
        q.report.counts.blankNopen, q.report.counts.badQty, q.report.counts.badCbm,
        q.report.counts.badDate, q.report.counts.blankSo, q.report.counts.blankPo,
        q.report.counts.dupNopenSoPo, sc(q.note || "")
      ]);
    });
    return rows;
  }

  /* ---------------- SHEET BARU: CASE PER FINDING (1 baris/case, bukan 1 baris/NOPEN) ----------------
     Memenuhi kebutuhan "1 NOPEN dengan beberapa finding harus menghasilkan beberapa
     baris case saat export" -- sheet "Cek Adidas/Cek Nike" di atas tetap 1 baris/NOPEN
     (grain rekonsiliasi mentah), sheet inilah yang jadi rincian per-case-nya. */
  var CASE_SHEET_HEAD = ["NOPEN", "Case ID", "Case Type", "Status", "Severity", "PIC",
    "Qty Expected", "Qty Actual", "Selisih Qty", "Remark", "Dibuat", "Diperbarui", "Closed At", "Closed By"];
  var CASE_SHEET_COLS = [12, 14, 16, 12, 10, 20, 12, 12, 12, 50, 18, 18, 18, 20];
  function aoaCaseSheet(brand) {
    var rows = [CASE_SHEET_HEAD];
    var all = CASES.all();
    Object.keys(all).map(function(k){ return all[k]; })
      .filter(function(c){ return c.brand === brand; })
      .sort(function(a, b) { return String(a.nopen) < String(b.nopen) ? -1 : String(a.nopen) > String(b.nopen) ? 1 : (a.id<b.id?-1:1); })
      .forEach(function (c) {
        rows.push([
          sc(c.nopen), displayCaseId(c.id), CASES.CASE_TYPE_LABEL[c.caseType]||c.caseType, c.status, sc(c.severity), sc(c.pic),
          c.qtyExpected===null||c.qtyExpected===undefined?"":c.qtyExpected,
          c.qtyActual===null||c.qtyActual===undefined?"":c.qtyActual,
          c.qtyDifference===null||c.qtyDifference===undefined?"":c.qtyDifference,
          sc(c.remark), C.fmtStamp(c.createdAt), C.fmtStamp(c.updatedAt),
          c.closedAt?C.fmtStamp(c.closedAt):"", sc(c.closedBy||"")
        ]);
      });
    return rows;
  }

  /* ---------------- SHEET: RIWAYAT NOPEN (timeline lengkap per perubahan, termasuk yang sudah Closed/dihapus) ----------------
     Beda dari "Case per Finding" (yang cuma berisi case AKTIF lokal, 1 baris/case
     kondisi TERKINI): sheet ini 1 baris PER PERUBAHAN (timeline, dari kolom audit
     yang sudah ada di tiap case sejak awal), sumbernya dari server tanpa filter
     deleted_at, jadi benar-benar historis -- dipakai user menelusuri kronologi
     lengkap tiap case: kapan dibuat, kapan status berubah, siapa yang mengubah,
     dan remark-nya. `nopenScope` (opsional, Set "<brand>|<nopen>") dipakai export
     hasil filter supaya sheet ini ikut ter-scope ke NOPEN yang sedang difilter. */
  var HIST_NOTES_HEAD = ["NOPEN", "Brand", "Case ID", "Temuan", "PIC", "Status Terakhir", "Remark", "Waktu Perubahan", "Oleh", "Perubahan", "Dihapus?"];
  var HIST_NOTES_COLS = [12, 9, 14, 20, 20, 14, 50, 18, 22, 60, 10];
  function aoaHistoricalNotes(caseRows, nopenScope) {
    var rows = [HIST_NOTES_HEAD];
    (caseRows || [])
      .filter(function (c) { return !nopenScope || nopenScope.has(c.brand + "|" + c.nopen); })
      .slice().sort(function (a, b) {
        return String(a.nopen) < String(b.nopen) ? -1 : String(a.nopen) > String(b.nopen) ? 1 : (a.id < b.id ? -1 : 1);
      }).forEach(function (c) {
        var base = [sc(c.nopen), c.brand, displayCaseId(c.id), sc(CASES.CASE_TYPE_LABEL[c.case_type] || c.case_type || ""), sc(c.pic), c.status, sc(c.remark || "")];
        var audit = Array.isArray(c.audit) ? c.audit : [];
        var deleted = c.deleted_at ? "Ya" : "Tidak";
        if (!audit.length) {
          rows.push(base.concat(["", "", "(tidak ada riwayat audit)", deleted]));
          return;
        }
        audit.forEach(function (a) {
          rows.push(base.concat([C.fmtStamp(a.at), sc(a.by), sc(a.what), deleted]));
        });
      });
    return rows;
  }

  /* ---------------- SHEET: RIWAYAT CASE (histori lengkap, termasuk yang sudah dihapus) ----------------
     Satu baris per perubahan (bukan per NOPEN), diambil dari kolom audit yang sudah
     ada di setiap case sejak awal -- "by" di situ selalu nama asli (teks), jadi
     riwayat tetap terbaca walau akun pembuatnya sudah dihapus dari Supabase Auth. */
  var CASE_HISTORY_HEAD = ["NOPEN", "Case ID", "Case Type", "Brand", "Dihapus?", "Status Saat Ini", "PIC Saat Ini", "Waktu Perubahan", "Oleh", "Perubahan"];
  var CASE_HISTORY_COLS = [12, 14, 16, 9, 10, 16, 22, 18, 22, 60];
  function aoaCaseHistory(caseRows) {
    var rows = [CASE_HISTORY_HEAD];
    (caseRows || []).slice().sort(function(a, b) {
      return String(a.nopen) < String(b.nopen) ? -1 : String(a.nopen) > String(b.nopen) ? 1 : 0;
    }).forEach(function (c) {
      var audit = Array.isArray(c.audit) ? c.audit : [];
      var deleted = c.deleted_at ? "Ya" : "";
      var caseTypeLbl = CASES.CASE_TYPE_LABEL[c.case_type] || c.case_type || "";
      var caseIdDisp = displayCaseId(c.id);
      if (!audit.length) {
        rows.push([sc(c.nopen), caseIdDisp, caseTypeLbl, c.brand, deleted, c.status, sc(c.pic), "", "", "(tidak ada riwayat audit)"]);
        return;
      }
      audit.forEach(function (a) {
        rows.push([sc(c.nopen), caseIdDisp, caseTypeLbl, c.brand, deleted, c.status, sc(c.pic), C.fmtStamp(a.at), sc(a.by), sc(a.what)]);
      });
    });
    return rows;
  }

  /* ---------------- perakitan workbook ---------------- */
  function sheetFrom(aoa, widths) {
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    if (widths) ws["!cols"] = widths.map(function (w) { return { wch: w }; });
    return ws;
  }

  function applyAutofilter(ws, headerRowIdx) {
    var range = XLSX.utils.decode_range(ws["!ref"]);
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRowIdx, c: range.s.c }, e: { r: headerRowIdx, c: range.e.c } }) };
  }

  /* ---------------- RESUME (ringkasan) + tabel + hyperlink lompat-ke-baris ----------------
     Dipakai bersama oleh sheet Cek Adidas / Cek Nike / Hasil Filter, supaya setiap sheet
     data punya ringkasan total QTY/CBM/Package di atas, plus daftar NOPEN yang QTY-nya
     berbeda -- NOPEN tersebut bisa diklik (hyperlink internal) untuk lompat ke barisnya
     langsung di tabel detail di bawahnya.
  */
  function buildSheetWithResume(rows, brand, cmpLabel, title, infoLines) {
    var head = mainHead(cmpLabel);
    var nopenRowIdx = new Map(); // NOPEN -> index ke-berapa (0-based) di antara rows
    rows.forEach(function (r, idx) { if (!nopenRowIdx.has(r.NOPEN)) nopenRowIdx.set(r.NOPEN, idx); });

    var totalQtyScm = 0, totalQtyCmp = 0, totalCbmScm = 0, totalCbmCmp = 0, totalPkg = 0, hasPkg = false;
    var qtyMismatches = [];
    rows.forEach(function (r) {
      // Pembanding dari histori periode lain (FROM_HISTORY) tidak ikut total periode.
      totalQtyScm += r.QTY_SCM || 0; totalQtyCmp += r.FROM_HISTORY ? 0 : (r.QTY_CMP || 0);
      totalCbmScm += r.CBM_SCM || 0; totalCbmCmp += r.FROM_HISTORY ? 0 : (r.CBM_CMP || 0);
      if (r.QTY_PACKAGE_SCM !== null && r.QTY_PACKAGE_SCM !== undefined) { totalPkg += r.QTY_PACKAGE_SCM; hasPkg = true; }
      if (r.CLASSES.indexOf(E.CLASS.QTY_MISMATCH) !== -1) qtyMismatches.push(r);
    });

    var resume = [[title]];
    (infoLines || []).forEach(function (l) { resume.push(l); });
    resume.push([]);
    resume.push(["RINGKASAN", "", "", "", "", ""]);
    resume.push(["Total QTY SCM", C.r3(totalQtyScm), "Total QTY " + cmpLabel, C.r3(totalQtyCmp), "Selisih QTY", C.r3(totalQtyScm - totalQtyCmp)]);
    resume.push(["Total CBM SCM", C.r3(totalCbmScm), "Total CBM " + cmpLabel, C.r3(totalCbmCmp), "Selisih CBM", C.r3(totalCbmScm - totalCbmCmp)]);
    resume.push(hasPkg ? ["Total Package (SCM)", C.r3(totalPkg)] : ["Total Package (SCM)", "-"]);
    resume.push(["Jumlah NOPEN", rows.length]);
    resume.push([]);

    var hyperlinkTargets = []; // {resumeRowIdx, nopen}
    if (qtyMismatches.length) {
      resume.push(["NOPEN DENGAN SELISIH QTY — klik NOPEN untuk lompat ke baris detailnya"]);
      resume.push(["NOPEN", "QTY SCM", "QTY " + cmpLabel, "SELISIH QTY"]);
      qtyMismatches.forEach(function (r) {
        hyperlinkTargets.push({ resumeRowIdx: resume.length, nopen: r.NOPEN });
        resume.push([sc(r.NOPEN), r.QTY_SCM, r.QTY_CMP, r.QTY_DIFF]);
      });
      resume.push([]);
    }

    var headerRowIdx = resume.length;
    var dataRows = rows.map(function (r) { return mainRow(r, r._brand || brand); });
    var aoa = resume.concat([head]).concat(dataRows);

    return { aoa: aoa, headerRowIdx: headerRowIdx, nopenRowIdx: nopenRowIdx, hyperlinkTargets: hyperlinkTargets, rowCount: dataRows.length };
  }

  function applyResumeHyperlinks(ws, built) {
    built.hyperlinkTargets.forEach(function (h) {
      var dataIdx = built.nopenRowIdx.get(h.nopen);
      if (dataIdx === undefined) return;
      var targetRow0 = built.headerRowIdx + 1 + dataIdx; // +1 melewati baris header tabel
      var srcCell = XLSX.utils.encode_cell({ r: h.resumeRowIdx, c: 0 });
      // Kolom NOPEN pada tabel utama ada di index 0.
      var targetCell = XLSX.utils.encode_cell({ r: targetRow0, c: 0 });
      if (ws[srcCell]) ws[srcCell].l = { Target: "#" + targetCell, Tooltip: "Lompat ke NOPEN " + h.nopen };
    });
  }

  function sheetFromResume(built, widths) {
    var ws = sheetFrom(built.aoa, widths);
    if (built.rowCount > 0) {
      var lastDataRow0 = built.headerRowIdx + built.rowCount; // 0-based, inclusive
      var lastCol0 = widths.length - 1;
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: built.headerRowIdx, c: 0 }, e: { r: lastDataRow0, c: lastCol0 } }) };
    }
    applyResumeHyperlinks(ws, built);
    return ws;
  }

  function buildWorkbook(state) {
    var wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, sheetFrom(aoaReadme(state), [26, 60, 30, 30]), "README");
    XLSX.utils.book_append_sheet(wb, sheetFrom(aoaSummary(state), [30, 22, 22]), "Summary");

    if (state._filteredExport) {
      var fe = state._filteredExport;
      var filterRows = [["FILTER AKTIF", fe.filterLabel || "Semua"], ["SEARCH", fe.searchText || ""], ["BRAND", fe.brand || "ALL"], ["MODE", fe.mode || "nopen"], []];
      if (fe.mode === "detail") {
        filterRows.push(DETAIL_HEAD);
        (state._filteredDetail || []).forEach(function(d){
          filterRows.push([sc(d.NOPEN), fe.brand, d.ISSUE, d.SOURCE, sc(d.SCM_SO), sc(d.SCM_PO), sc(d.CMP_SO), sc(d.CMP_PO), d.ROW_STATUS, sc(d.EXPLANATION), ""]);
        });
        XLSX.utils.book_append_sheet(wb, sheetFrom(filterRows, [18,10,18,18,22,22,22,22,12,44,40]), "Hasil Filter");
      } else {
        var frows = [];
        if (state.adidas) frows = frows.concat((state.adidas.main || []).map(function(r){ return Object.assign({}, r, {_brand:"ADIDAS"}); }));
        if (state.nike) frows = frows.concat((state.nike.main || []).map(function(r){ return Object.assign({}, r, {_brand:"NIKE"}); }));
        var cmpLabel = fe.brand === "ADIDAS" ? "IOR" : (fe.brand === "NIKE" ? "DRR" : "IOR/DRR");
        filterRows = filterRows.concat([mainHead(cmpLabel)]);
        frows.forEach(function(r){ filterRows.push(mainRow(r, r._brand)); });
        var wsFilter = sheetFrom(filterRows, MAIN_COLS);
        if (filterRows.length > 5) applyAutofilter(wsFilter, 4);
        XLSX.utils.book_append_sheet(wb, wsFilter, "Hasil Filter");
      }
    }

    if (state.adidas) {
      var builtA = buildSheetWithResume(state.adidas.main, "ADIDAS", state.adidas.cmpLabel, "REKONSILIASI ADIDAS (SCM ↔ IOR)");
      var wsA = sheetFromResume(builtA, MAIN_COLS);
      XLSX.utils.book_append_sheet(wb, wsA, "Cek Adidas");
    }
    if (state.nike) {
      var builtN = buildSheetWithResume(state.nike.main, "NIKE", state.nike.cmpLabel, "REKONSILIASI NIKE (SCM ↔ DRR)");
      var wsN = sheetFromResume(builtN, MAIN_COLS);
      XLSX.utils.book_append_sheet(wb, wsN, "Cek Nike");
    }

    var caseSheetRows = [CASE_SHEET_HEAD];
    if (state.adidas) caseSheetRows = caseSheetRows.concat(aoaCaseSheet("ADIDAS").slice(1));
    if (state.nike) caseSheetRows = caseSheetRows.concat(aoaCaseSheet("NIKE").slice(1));
    var wsCase = sheetFrom(caseSheetRows, CASE_SHEET_COLS);
    if (caseSheetRows.length > 1) applyAutofilter(wsCase, 0);
    XLSX.utils.book_append_sheet(wb, wsCase, "Case per Finding");

    var det = [DETAIL_HEAD];
    if (state.adidas) det = det.concat(aoaDetail(state.adidas, "ADIDAS").slice(1));
    if (state.nike) det = det.concat(aoaDetail(state.nike, "NIKE").slice(1));
    var wsDet = sheetFrom(det, DETAIL_COLS);
    if (det.length > 1) applyAutofilter(wsDet, 0);
    XLSX.utils.book_append_sheet(wb, wsDet, "Detail SOPO");

    XLSX.utils.book_append_sheet(wb, sheetFrom(aoaQuality(state),
      [30, 18, 12, 14, 12, 14, 16, 16, 18, 12, 12, 20, 40]), "Data Quality");

    if (state._caseHistory) {
      var wsNotes = sheetFrom(aoaHistoricalNotes(state._caseHistory), HIST_NOTES_COLS);
      XLSX.utils.book_append_sheet(wb, wsNotes, "Riwayat NOPEN");
      var wsHist = sheetFrom(aoaCaseHistory(state._caseHistory), CASE_HISTORY_COLS);
      XLSX.utils.book_append_sheet(wb, wsHist, "Riwayat Case");
    }

    return wb;
  }

  function stamp(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function downloadXLSX(state) {
    var wb = buildWorkbook(state);
    XLSX.writeFile(wb, "Rekonsiliasi_Inbound_" + stamp(state.generated) + ".xlsx");
  }

  function downloadFilteredXLSX(state, filteredRowsPack, brand, mode, filterLabel, searchText) {
    var wb = XLSX.utils.book_new();
    var exportedAt = C.fmtStamp(new Date().toISOString());

    /*
     * Export hasil filter dibuat langsung sebagai tabel data.
     * Metadata filter dipindahkan ke sheet terpisah agar sheet "Hasil Filter"
     * dimulai dari header tabel pada baris pertama, sehingga Excel langsung
     * memberikan dropdown filter pada setiap kolom.
     */
    var infoAoa = [
      ["INFORMASI FILTER"],
      ["Filter aktif", filterLabel || "Semua"],
      ["Search", searchText || ""],
      ["Brand", brand || "ALL"],
      ["Mode", mode || "nopen"],
      ["Diekspor", exportedAt]
    ];
    XLSX.utils.book_append_sheet(wb, sheetFrom(infoAoa, [22, 70]), "Info Filter");

    // Riwayat NOPEN (catatan/case historis) di-scope ke NOPEN yang lolos filter
    // aktif ini saja -- supaya export filter tetap fokus, bukan seluruh histori.
    if (state._caseHistory) {
      var scopeSet = new Set();
      (filteredRowsPack.main || []).forEach(function (r) { scopeSet.add((r._brand || brand) + "|" + r.NOPEN); });
      (filteredRowsPack.detail || []).forEach(function (d) { scopeSet.add((d._brand || brand) + "|" + d.NOPEN); });
      var wsNotesF = sheetFrom(aoaHistoricalNotes(state._caseHistory, scopeSet), HIST_NOTES_COLS);
      XLSX.utils.book_append_sheet(wb, wsNotesF, "Riwayat NOPEN");
    }

    if (mode === "detail") {
      var detailRows = filteredRowsPack.detail || [];
      var aoaD = [DETAIL_HEAD];
      detailRows.forEach(function (d) {
        aoaD.push([
          sc(d.NOPEN), d._brand || brand, d.ISSUE, d.SOURCE,
          sc(d.SCM_SO), sc(d.SCM_PO), sc(d.CMP_SO), sc(d.CMP_PO),
          d.ROW_STATUS, sc(d.EXPLANATION)
        ]);
      });

      var wsD = sheetFrom(aoaD, DETAIL_COLS);
      if (aoaD.length > 1) {
        wsD["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: aoaD.length - 1, c: DETAIL_COLS.length - 1 }
          })
        };
      }
      XLSX.utils.book_append_sheet(wb, wsD, "Hasil Filter");
    } else {
      var cmpLabel = brand === "ADIDAS" ? "IOR" : (brand === "NIKE" ? "DRR" : "IOR/DRR");
      var rows = filteredRowsPack.main || [];

      /* Hasil Filter = header + hanya baris yang lolos filter aktif. */
      var aoaMain = [mainHead(cmpLabel)];
      rows.forEach(function (r) {
        aoaMain.push(mainRow(r, r._brand || brand));
      });

      var wsMain = sheetFrom(aoaMain, MAIN_COLS);
      if (aoaMain.length > 1) {
        wsMain["!autofilter"] = {
          ref: XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: aoaMain.length - 1, c: MAIN_COLS.length - 1 }
          })
        };
      }
      XLSX.utils.book_append_sheet(wb, wsMain, "Hasil Filter");
    }

    XLSX.writeFile(wb, "Rekonsiliasi_Inbound_" + stamp(state.generated) + "_FILTER.xlsx");
  }

  function csvOf(aoa) { return XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(aoa)); }

  function downloadBlob(text, filename, mime) {
    var blob = new Blob(["\ufeff" + text], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
  }

  return {
    buildWorkbook: buildWorkbook, downloadXLSX: downloadXLSX, downloadFilteredXLSX: downloadFilteredXLSX,
    aoaMain: aoaIssuesOnly, aoaMainAll: aoaMain, aoaDetail: aoaDetail,
    csvOf: csvOf, downloadBlob: downloadBlob, stamp: stamp
  };
})(C, E, CASES);
}
