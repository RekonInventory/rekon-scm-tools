// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Utilitas inti (escape, safeCell, normalisasi angka/tanggal UTC, storage aman).
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

export const C = (function () {
  "use strict";

  var META = {
    name: "Rekonsiliasi Inbound",
    version: "1.0.0",
    build: "2.0.0-202608311526",
    updated: "31 Aug 2026"
  };

  /* ---------- konstanta bisnis (JANGAN diubah tanpa keputusan bisnis) ---------- */
  var QTY_TOL = 0;     // QTY harus sama persis
  var CBM_TOL = 0.5;   // toleransi CBM

  /* ---------- escaping / keamanan ---------- */
  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Lindungi dari CSV/formula injection saat diekspor ke spreadsheet.
  function safeCell(v) {
    if (typeof v !== "string") return v;
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }

  // Kunci berbahaya untuk objek hasil JSON.parse (prototype pollution).
  var BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  function isSafeKey(k) { return typeof k === "string" && !BAD_KEYS[k]; }

  /* ---------- normalisasi nilai ---------- */
  function S(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
    return String(v).trim();
  }

  // NOPEN/PEB: buang spasi, samakan jadi 6 digit bila numerik murni.
  function padNopen(v) {
    var t = S(v).replace(/\s+/g, "");
    return /^\d+$/.test(t) ? t.padStart(6, "0") : t;
  }

  // Angka: kembalikan {v, ok}. Tidak pernah diam-diam jadi 0.
  function parseNum(v) {
    if (v === null || v === undefined || v === "") return { v: 0, ok: false, empty: true };
    if (typeof v === "number") return isFinite(v) ? { v: v, ok: true } : { v: 0, ok: false };
    var t = String(v).trim().replace(/\s/g, "");
    if (t === "") return { v: 0, ok: false, empty: true };
    // dukung 1.234,56 dan 1,234.56
    if (/,\d{1,3}$/.test(t) && /\./.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
    var n = parseFloat(t);
    return isFinite(n) ? { v: n, ok: true } : { v: 0, ok: false };
  }

  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* ---------- tanggal: selalu UTC, bebas pengaruh zona waktu browser ---------- */
  var BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  var BULAN_PANJANG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  function toDate(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return null;
      return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
    }
    if (typeof v === "number") {
      if (!isFinite(v) || v <= 0 || v > 60000) return null;   // serial Excel wajar
      var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
    var t = String(v).trim();
    if (!t) return null;
    var m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // dd/mm/yyyy
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    var p = new Date(t);
    if (isNaN(p.getTime())) return null;
    return new Date(Date.UTC(p.getFullYear(), p.getMonth(), p.getDate()));
  }

  function fmtDate(d) {
    if (!d) return "—";
    return d.getUTCDate() + " " + BULAN_PENDEK[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  function fmtDateRange(a, b) {
    if (!a) return "—";
    if (b && b.getTime() !== a.getTime()) return fmtDate(a) + " – " + fmtDate(b);
    return fmtDate(a);
  }
  function monthLabel(d) { return BULAN_PANJANG[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function fmtNum(v, dec) {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return v.toLocaleString("id-ID", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  // Tanda peringatan dipakai saat sebagian baris sumber yang dijumlahkan tidak
  // valid (QTY/CBM bukan angka) — totalnya TETAP ditampilkan apa adanya (bukan
  // disembunyikan), tetapi diberi tanda tegas agar tidak dibaca sebagai jumlah
  // yang lengkap/sah. Lihat prinsip "jangan diam-diam jadi nol" pada directive.
  function fmtNumFlag(v, invalidCount, dec) {
    var base = fmtNum(v, dec);
    if (invalidCount > 0) return base + " ⚠" + (invalidCount > 1 ? invalidCount : "");
    return base;
  }
  function fmtStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getDate()) + " " + BULAN_PENDEK[d.getMonth()] + " " + d.getFullYear() +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- pemrosesan bertahap supaya UI tidak membeku ---------- */
  function yieldUI() {
    return new Promise(function (res) { setTimeout(res, 0); });
  }

  // Jalankan fn(item, i) untuk seluruh list dalam potongan, lapor progres.
  async function eachChunk(list, fn, onProgress, chunkSize) {
    var size = chunkSize || 4000;
    for (var i = 0; i < list.length; i++) {
      fn(list[i], i);
      if ((i + 1) % size === 0) {
        if (onProgress) onProgress((i + 1) / list.length);
        await yieldUI();
      }
    }
    if (onProgress) onProgress(1);
  }

  /* ---------- penyimpanan lokal yang aman ---------- */
  var storage = (function () {
    var ok = true;
    try {
      var probe = "__ri_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
    } catch (e) { ok = false; }
    return {
      available: function () { return ok; },
      get: function (k) {
        if (!ok) return null;
        try { return window.localStorage.getItem(k); } catch (e) { ok = false; return null; }
      },
      set: function (k, v) {
        if (!ok) return { ok: false, reason: "storage-unavailable" };
        try { window.localStorage.setItem(k, v); return { ok: true }; }
        catch (e) {
          var quota = e && (e.name === "QuotaExceededError" || e.code === 22);
          return { ok: false, reason: quota ? "quota" : "error" };
        }
      },
      remove: function (k) { if (ok) { try { window.localStorage.removeItem(k); } catch (e) {} } }
    };
  })();

  return {
    META: META, QTY_TOL: QTY_TOL, CBM_TOL: CBM_TOL,
    esc: esc, safeCell: safeCell, isSafeKey: isSafeKey,
    S: S, padNopen: padNopen, parseNum: parseNum, r3: r3,
    toDate: toDate, fmtDate: fmtDate, fmtDateRange: fmtDateRange,
    monthLabel: monthLabel, fmtNum: fmtNum, fmtNumFlag: fmtNumFlag, fmtStamp: fmtStamp,
    BULAN_PENDEK: BULAN_PENDEK, BULAN_PANJANG: BULAN_PANJANG,
    yieldUI: yieldUI, eachChunk: eachChunk, storage: storage
  };
})();

export default C;
