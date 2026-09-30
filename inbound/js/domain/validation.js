// Validasi TERSTRUKTUR per berkas. Diturunkan dari laporan mutu reader (yang tidak
// diubah) + pemeriksaan tambahan yang murni informatif. Tidak ada satu pun aturan di
// sini yang mengubah hasil parsing, gate, atau rekonsiliasi — gate tetap memakai
// reader.severityOf() seperti versi lama.
//
// Bentuk setiap temuan:
//   { status, severity, code, message, field, row, sheet, count, samples }
//   status   : 'INVALID' | 'WARNING' | 'INFO'   (dampak ke berkas)
//   severity : 'error'   | 'warning' | 'info'   (untuk ikon/warna UI)
//   row      : nomor baris Excel pertama yang terdampak (bila ada)

export const LIMITS = { warnSizeBytes: 40 * 1024 * 1024 };

const SEV_STATUS = { error: "INVALID", warning: "WARNING", info: "INFO" };

function item(severity, code, message, extra) {
  return Object.assign({ status: SEV_STATUS[severity], severity, code, message, field: null, row: null, sheet: null, count: null, samples: null }, extra || {});
}

const FIELD_LABEL = { NOPEN: "NOPEN", SO: "SO", PO: "PO", QTY: "QTY", CBM: "CBM", DATE: "Tanggal", BRAND: "Brand" };

/** Pemeriksaan sebelum berkas dibaca (ekstensi, ukuran). */
export function preflight(name, size) {
  const out = [];
  if (!/\.(xlsx|xlsm|xls)$/i.test(name || "")) {
    out.push(item("error", "FILE_EXTENSION", "\"" + name + "\" bukan berkas Excel (.xlsx/.xlsm/.xls).", { field: "file" }));
  } else if (!size) {
    out.push(item("error", "FILE_EMPTY", "\"" + name + "\" kosong (0 byte).", { field: "file" }));
  } else if (size > LIMITS.warnSizeBytes) {
    out.push(item("warning", "FILE_LARGE", "Berkas besar (" + Math.round(size / 1048576) + " MB) — pembacaan bisa memakan waktu lebih lama.", { field: "file" }));
  }
  return out;
}

export function workbookProblem(code, name) {
  if (code === "corrupt") return item("error", "WORKBOOK_CORRUPT", "\"" + name + "\" bukan berkas Excel yang valid atau rusak.", { field: "file" });
  if (code === "no-sheet") return item("error", "NO_WORKSHEET", "\"" + name + "\" tidak punya worksheet.", { field: "file" });
  return item("error", "WORKBOOK_UNREADABLE", "\"" + name + "\" gagal dibaca.", { field: "file" });
}

export function detectionIssue(det, name) {
  if (!det || !det.kind) return item("warning", "TYPE_UNKNOWN", "Jenis berkas \"" + name + "\" tidak dikenali. Pilih jenisnya secara manual.", { field: "type" });
  return item("warning", "TYPE_UNCERTAIN", "Belum dapat memastikan jenis \"" + name + "\" (keyakinan " + Math.round((det.confidence || 0) * 100) + "%). Pilih jenisnya secara manual.", { field: "type", sheet: det.sheet || null });
}

/**
 * Validasi hasil ekstraksi 1 slot (entry dari pipeline.assignFile).
 * @param {object} entry  {name, sheet, rows, report, fatal, severity, note}
 * @param {string} kind   scm | ior | nike
 */
export function validateEntry(entry, kind) {
  const r = entry.report || {}, c = r.counts || {}, sheet = entry.sheet || r.sheet || null, samples = r.samples || {};
  const out = [];
  const firstRow = (key) => {
    const s = samples[key];
    if (!s || !s.length) return null;
    const n = parseInt(String(s[0]), 10);
    return isFinite(n) ? n : null;
  };

  if (entry.fatal === "header-not-found") {
    out.push(item("error", "HEADER_NOT_FOUND", "Baris header tidak ditemukan pada sheet " + (sheet || "-") + " (dicari di 12 baris pertama).", { sheet, field: "header" }));
    return out;
  }
  if (entry.fatal === "missing-columns") {
    out.push(item("error", "MISSING_COLUMNS", "Kolom wajib tidak ditemukan: " + (r.missing || []).map((f) => FIELD_LABEL[f] || f).join(", ") + ".",
      { sheet, field: (r.missing || []).join(","), row: r.headerRow >= 0 ? r.headerRow + 1 : null }));
    return out;
  }
  if (!r.totalRows) {
    out.push(item("error", "NO_DATA", "Sheet terbaca tetapi tidak berisi data.", { sheet }));
    return out;
  }

  const counted = [
    ["blankNopen", "warning", "EMPTY_NOPEN", "NOPEN", "baris tanpa NOPEN (tidak ikut direkonsiliasi, tetap dicatat di mutu data)"],
    ["badQty", "warning", "INVALID_NUMBER_QTY", "QTY", "baris dengan QTY kosong / bukan angka (ditandai, tidak dianggap nol)"],
    ["badCbm", "warning", "INVALID_NUMBER_CBM", "CBM", "baris dengan CBM kosong / bukan angka (ditandai, tidak dianggap nol)"],
    ["badDate", "warning", "INVALID_DATE", "DATE", "baris dengan tanggal tidak valid"],
    ["blankSo", "warning", "EMPTY_SO", "SO", "baris dengan SO kosong"],
    ["blankPo", "warning", "EMPTY_PO", "PO", "baris dengan PO kosong"],
    ["dupNopenSoPo", "info", "DUPLICATE_ROWS", "NOPEN", "kombinasi NOPEN+SO+PO muncul lebih dari sekali (tetap dijumlahkan, tidak dihitung abnormal)"]
  ];
  counted.forEach(([key, sev, code, field, text]) => {
    if (c[key]) out.push(item(sev, code, c[key].toLocaleString("id-ID") + " " + text + ".", { sheet, field, count: c[key], row: firstRow(key), samples: samples[key] || null }));
  });

  // Format NOPEN mencurigakan: bukan 6 digit angka setelah normalisasi (informasi saja).
  const rows = entry.rows || [];
  let odd = 0; const oddSamples = [];
  for (let i = 0; i < rows.length; i++) {
    if (!/^\d{6}$/.test(rows[i].NOPEN)) { odd++; if (oddSamples.length < 5) oddSamples.push(rows[i]._row + " → " + rows[i].NOPEN); }
  }
  if (odd) out.push(item("warning", "SUSPICIOUS_NOPEN", odd.toLocaleString("id-ID") + " baris dengan format NOPEN tidak lazim (bukan 6 digit angka).", { sheet, field: "NOPEN", count: odd, row: rows.find((x) => !/^\d{6}$/.test(x.NOPEN))._row, samples: oddSamples }));

  if (kind === "scm") {
    const brands = r.brands || {};
    const other = Object.keys(brands).filter((b) => b !== "ADIDAS" && b !== "NIKE");
    if (other.length) {
      const n = other.reduce((s, b) => s + brands[b], 0);
      out.push(item("warning", "BRAND_INCONSISTENT", n.toLocaleString("id-ID") + " baris ber-brand " + other.join(", ") + " — hanya ADIDAS dan NIKE yang direkonsiliasi, baris ini tidak ikut dibandingkan.", { sheet, field: "BRAND", count: n }));
    }
    let noBrand = 0;
    for (let i = 0; i < rows.length; i++) if (!rows[i].BRAND) noBrand++;
    if (noBrand) out.push(item("warning", "BRAND_EMPTY", noBrand.toLocaleString("id-ID") + " baris tanpa Product Category/Brand — tidak ikut dibandingkan.", { sheet, field: "BRAND", count: noBrand }));
  }
  if (kind === "ior" && /\+/.test(sheet || "")) {
    out.push(item("info", "MULTI_SHEET", "Data IOR digabung dari beberapa sheet: " + sheet + ".", { sheet }));
  }
  if (r.dateMin) {
    out.push(item("info", "DATE_RANGE", "Rentang tanggal data: " + fmt(r.dateMin) + " – " + fmt(r.dateMax) + ".", { sheet, field: "DATE" }));
  }
  return out;
}

function fmt(d) {
  const x = d instanceof Date ? d : new Date(d);
  const B = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return x.getUTCDate() + " " + B[x.getUTCMonth()] + " " + x.getUTCFullYear();
}

/** Status tampilan berkas: READY / WARNING / INVALID (berdasarkan severity reader lama). */
export function displayStatus(entrySeverity, issues) {
  if (entrySeverity === "INVALID") return "INVALID";
  if (entrySeverity === "WARNING" || (issues || []).some((i) => i.severity === "warning")) return "WARNING";
  return "READY";
}
