// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Model case + audit (id <brand>|<nopen>|<seq>, status, diff->audit).
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

// Dibungkus factory: `C.storage` yang disuntikkan HANYA cache lokal, bukan sumber kebenaran
// (sumber kebenaran = Supabase, lihat application/case-service.js).
export function createCaseStore(C) {
return (function (C) {
  "use strict";

  var KEY = "rekonsiliasi_inbound_cases_v2";
  var LEGACY_KEY = "rekonsiliasi_inbound_catatan_v1";   // versi lama (teks + status)
  var USER_KEY = "rekonsiliasi_inbound_user";

  var STATUS = ["OPEN", "IN PROGRESS", "CLOSED"];
  var STATUS_KIND = { "OPEN": "flag", "IN PROGRESS": "warn", "CLOSED": "muted" };

  // Kategori terstruktur untuk case/finding (case_type). Dipetakan 1:1 dari
  // konstanta klasifikasi mesin rekonsiliasi (CLASS) supaya konsisten dan
  // supaya setiap finding bisa dihitung/difilter terpisah walau NOPEN-nya sama.
  var CASE_TYPE = ["ONLY_IN_SCM", "ONLY_IN_IOR", "ONLY_IN_DRR", "QTY_DIFFERENCE", "CBM_DIFFERENCE",
    "SO_MISMATCH", "PO_MISMATCH", "SO_PO_MISMATCH", "HISTORICAL_MATCH", "INVALID_DATA", "OTHER"];
  var CASE_TYPE_LABEL = {
    ONLY_IN_SCM: "Hanya di SCM", ONLY_IN_IOR: "Hanya di IOR", ONLY_IN_DRR: "Hanya di DRR",
    QTY_DIFFERENCE: "Selisih Qty", CBM_DIFFERENCE: "Selisih CBM",
    SO_MISMATCH: "SO Beda", PO_MISMATCH: "PO Beda", SO_PO_MISMATCH: "SO/PO Beda",
    HISTORICAL_MATCH: "Historical Match", INVALID_DATA: "Data Tidak Valid", OTHER: "Lainnya"
  };
  // Peta dari CLASS mesin rekonsiliasi -> case_type (untuk saran otomatis saat bikin case baru).
  var CLASS_TO_CASE_TYPE = {
    ONLY_IN_SCM: "ONLY_IN_SCM", ONLY_IN_IOR: "ONLY_IN_IOR", ONLY_IN_DRR: "ONLY_IN_DRR",
    QTY_MISMATCH: "QTY_DIFFERENCE", CBM_MISMATCH: "CBM_DIFFERENCE",
    SO_MISMATCH: "SO_MISMATCH", PO_MISMATCH: "PO_MISMATCH", SO_PO_MISMATCH: "SO_PO_MISMATCH",
    HISTORICAL_MATCH: "HISTORICAL_MATCH", INVALID_DATA: "INVALID_DATA"
  };

  var store = Object.create(null);
  var user = "";
  var lastError = null;

  // Key case sekarang "<brand>|<nopen>|<seq2digit>" supaya 1 NOPEN bisa punya
  // banyak case. Case lama (key lama "<brand>|<nopen>" tanpa seq) TETAP terbaca
  // apa adanya -- dianggap seq "01" secara implisit, tidak pernah dimigrasi
  // paksa supaya id lama (dipakai di riwayat/export) tidak berubah.
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  function makeKey(brand, nopen, seq) { return brand + "|" + nopen + "|" + pad2(seq); }
  function nopenPrefix(brand, nopen) { return brand + "|" + nopen + "|"; }
  function parseKey(key) {
    var parts = String(key).split("|");
    return { brand: parts[0] || "", nopen: parts[1] || "", seq: parts[2] || "01" };
  }
  // Seq tertinggi yang sudah dipakai untuk NOPEN ini di penyimpanan lokal saat ini
  // (termasuk key lama tanpa seq, dihitung sebagai seq 1). Dipakai sbg tebakan awal
  // saat bikin case baru -- collision (jarang, hanya kalau 2 user bikin case baru
  // di NOPEN yg sama nyaris bersamaan) ditangani lewat retry di pushCaseToSupabase.
  function maxSeqInStore(brand, nopen) {
    var pre = nopenPrefix(brand, nopen), exact = brand + "|" + nopen, max = 0;
    Object.keys(store).forEach(function (k) {
      if (k === exact) { max = Math.max(max, 1); return; }
      if (k.indexOf(pre) === 0) {
        var s = parseInt(parseKey(k).seq, 10);
        if (isFinite(s)) max = Math.max(max, s);
      }
    });
    return max;
  }
  function nextCaseId(brand, nopen) { return makeKey(brand, nopen, maxSeqInStore(brand, nopen) + 1); }
  function bumpCaseId(caseId) {
    var p = parseKey(caseId);
    return makeKey(p.brand, p.nopen, (parseInt(p.seq, 10) || 1) + 1);
  }

  function currentUser() { return user || "Pengguna"; }
  function setUser(v) {
    user = C.S(v).slice(0, 60);
    C.storage.set(USER_KEY, user);
  }

  function load() {
    store = Object.create(null);
    user = C.storage.get(USER_KEY) || "";
    var raw = C.storage.get(KEY);
    if (raw) {
      merge(parseSafe(raw), false);
      return;
    }
    // migrasi dari format catatan lama supaya catatan pengguna tidak hilang
    var legacy = C.storage.get(LEGACY_KEY);
    if (legacy) {
      var old = parseSafe(legacy);
      Object.keys(old).forEach(function (k) {
        if (!C.isSafeKey(k)) return;
        var v = old[k];
        if (!v || typeof v.t !== "string") return;
        var parts = k.split("|");
        var st = v.s === "selesai" ? "CLOSED" : (v.s === "proses" ? "IN PROGRESS" : "OPEN");
        store[k] = {
          id: k, brand: parts[0] || "", nopen: parts[1] || "",
          caseType: "OTHER", issueType: "", severity: "", pic: "", status: st,
          remark: v.t, createdAt: v.u || new Date().toISOString(),
          updatedAt: v.u || new Date().toISOString(),
          audit: [{ at: v.u || new Date().toISOString(), by: "migrasi", what: "Dipindahkan dari catatan versi lama" }]
        };
      });
      persist();
    }
  }

  function parseSafe(raw) {
    var data;
    try { data = JSON.parse(raw); } catch (e) { return Object.create(null); }
    if (!data || typeof data !== "object") return Object.create(null);
    var src = data.cases || data.catatan || data;
    if (!src || typeof src !== "object") return Object.create(null);
    var out = Object.create(null);
    Object.keys(src).forEach(function (k) {
      if (!C.isSafeKey(k)) return;                 // tolak __proto__ dsb.
      var v = src[k];
      if (v && typeof v === "object") out[k] = v;
    });
    return out;
  }

  function sanitize(rec, key) {
    var parts = parseKey(key);
    var now = new Date().toISOString();
    var st = STATUS.indexOf(rec.status) !== -1 ? rec.status : "OPEN";
    var audit = Array.isArray(rec.audit) ? rec.audit.slice(0, 200).map(function (a) {
      return {
        at: C.S(a && a.at) || now,
        by: C.S(a && a.by).slice(0, 60),
        what: C.S(a && a.what).slice(0, 300)
      };
    }) : [];
    var numOr0 = function(v){ var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : 0; };
    var numOrNull = function(v){ if (v===null||v===undefined||v==="") return null; var n = typeof v === "number" ? v : parseFloat(v); return isFinite(n) ? n : null; };
    var ct = CASE_TYPE.indexOf(rec.caseType) !== -1 ? rec.caseType : "OTHER";
    return {
      id: key,
      brand: C.S(rec.brand) || parts.brand || "",
      nopen: C.S(rec.nopen) || parts.nopen || "",
      caseType: ct,
      issueType: C.S(rec.issueType).slice(0, 40),
      severity: C.S(rec.severity).slice(0, 20),
      pic: C.S(rec.pic).slice(0, 60),
      status: st,
      remark: C.S(rec.remark).slice(0, 2000),
      actionTaken: C.S(rec.actionTaken).slice(0, 300),
      qtyAdj: numOr0(rec.qtyAdj),
      cbmAdj: numOr0(rec.cbmAdj),
      qtyAdjNote: C.S(rec.qtyAdjNote).slice(0, 300),
      cbmAdjNote: C.S(rec.cbmAdjNote).slice(0, 300),
      qtyExpected: numOrNull(rec.qtyExpected),
      qtyActual: numOrNull(rec.qtyActual),
      qtyDifference: numOrNull(rec.qtyDifference),
      createdAt: C.S(rec.createdAt) || now,
      updatedAt: C.S(rec.updatedAt) || now,
      closedAt: rec.closedAt ? C.S(rec.closedAt) : null,
      closedBy: C.S(rec.closedBy).slice(0, 60),
      audit: audit
    };
  }

  function persist() {
    var res = C.storage.set(KEY, JSON.stringify({ app: "Rekonsiliasi Inbound", versi: 2, cases: store }));
    lastError = res.ok ? null : res.reason;
    return res;
  }

  function get(caseId) { return store[caseId] || null; }
  // Semua case untuk 1 NOPEN (biasanya 1, bisa lebih), diurutkan dari yang paling lama dibuat.
  function getAllForNopen(brand, nopen) {
    var pre = nopenPrefix(brand, nopen), exact = brand + "|" + nopen, out = [];
    Object.keys(store).forEach(function (k) {
      if (k === exact || k.indexOf(pre) === 0) out.push(store[k]);
    });
    out.sort(function (a, b) { return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1; });
    return out;
  }
  // Case "wakil" utk tampilan ringkas lama (1 chip/kolom) -- dipakai di tempat yang
  // secara sengaja masih menampilkan 1 case saja (kolom filter, pencarian, dsb).
  // Prioritas: case yang belum Closed (paling baru diperbarui), lalu case Closed
  // paling baru kalau semuanya sudah Closed.
  function primaryCase(brand, nopen) {
    var all = getAllForNopen(brand, nopen);
    if (!all.length) return null;
    var open = all.filter(function (c) { return c.status !== "CLOSED"; });
    var pool = open.length ? open : all;
    return pool.slice().sort(function (a, b) { return (b.updatedAt || "") < (a.updatedAt || "") ? -1 : 1; })[0];
  }
  function all() { return store; }
  function countFor(brand) {
    var pre = brand + "|", n = 0;
    Object.keys(store).forEach(function (k) { if (k.indexOf(pre) === 0) n++; });
    return n;
  }
  function openCountFor(brand) {
    var pre = brand + "|", n = 0;
    Object.keys(store).forEach(function (k) {
      if (k.indexOf(pre) === 0 && store[k].status !== "CLOSED") n++;
    });
    return n;
  }

  // caseId WAJIB sudah ditentukan oleh pemanggil (lihat nextCaseId/createCase di
  // lapisan sinkronisasi) -- save() sendiri tidak pernah menghasilkan id baru,
  // supaya id final selalu tetap walau pushCaseToSupabase() perlu retry id lain.
  function save(caseId, brand, nopen, fields, context) {
    var key = caseId;
    var now = new Date().toISOString();
    var prev = store[key];
    var rec = prev ? JSON.parse(JSON.stringify(prev)) : {
      id: key, brand: brand, nopen: nopen,
      caseType: (context && context.caseType) || "OTHER",
      issueType: (context && context.issueType) || "",
      severity: (context && context.severity) || "",
      pic: "", status: "OPEN", remark: "", actionTaken: "",
      qtyAdj: 0, cbmAdj: 0, qtyAdjNote: "", cbmAdjNote: "",
      qtyExpected: null, qtyActual: null, qtyDifference: null,
      createdAt: now, updatedAt: now, closedAt: null, closedBy: "", audit: []
    };

    var changes = [];
    if (fields.remark !== undefined && C.S(fields.remark) !== rec.remark) {
      changes.push(prev ? "Remark diperbarui" : "Remark dibuat");
      rec.remark = C.S(fields.remark).slice(0, 2000);
    }
    if (fields.status !== undefined && STATUS.indexOf(fields.status) !== -1 && fields.status !== rec.status) {
      changes.push("Status " + rec.status + " → " + fields.status);
      rec.status = fields.status;
      if (fields.status === "CLOSED") { rec.closedAt = now; rec.closedBy = currentUser(); }
      else { rec.closedAt = null; rec.closedBy = ""; }
    }
    if (fields.pic !== undefined && C.S(fields.pic) !== rec.pic) {
      changes.push(rec.pic ? ("PIC " + (rec.pic || "-") + " → " + (C.S(fields.pic) || "-")) : ("PIC ditetapkan: " + C.S(fields.pic)));
      rec.pic = C.S(fields.pic).slice(0, 60);
    }
    if (fields.actionTaken !== undefined && C.S(fields.actionTaken) !== rec.actionTaken) {
      changes.push("Action Required diatur: " + C.S(fields.actionTaken || "(kosong)"));
      rec.actionTaken = C.S(fields.actionTaken).slice(0, 300);
    }
    if (fields.qtyAdj !== undefined) {
      var qa = typeof fields.qtyAdj === "number" ? fields.qtyAdj : (parseFloat(fields.qtyAdj) || 0);
      if (qa !== (rec.qtyAdj || 0)) {
        changes.push("Penyesuaian QTY " + (rec.qtyAdj || 0) + " → " + qa);
        rec.qtyAdj = qa;
      }
    }
    if (fields.cbmAdj !== undefined) {
      var ca = typeof fields.cbmAdj === "number" ? fields.cbmAdj : (parseFloat(fields.cbmAdj) || 0);
      if (ca !== (rec.cbmAdj || 0)) {
        changes.push("Penyesuaian CBM " + (rec.cbmAdj || 0) + " → " + ca);
        rec.cbmAdj = ca;
      }
    }
    if (fields.qtyAdjNote !== undefined && C.S(fields.qtyAdjNote) !== rec.qtyAdjNote) {
      rec.qtyAdjNote = C.S(fields.qtyAdjNote).slice(0, 300);
    }
    if (fields.cbmAdjNote !== undefined && C.S(fields.cbmAdjNote) !== rec.cbmAdjNote) {
      rec.cbmAdjNote = C.S(fields.cbmAdjNote).slice(0, 300);
    }
    if (fields.qtyExpected !== undefined) rec.qtyExpected = (fields.qtyExpected===null||fields.qtyExpected==="") ? null : (parseFloat(fields.qtyExpected));
    if (fields.qtyActual !== undefined) rec.qtyActual = (fields.qtyActual===null||fields.qtyActual==="") ? null : (parseFloat(fields.qtyActual));
    if (fields.qtyDifference !== undefined) rec.qtyDifference = (fields.qtyDifference===null||fields.qtyDifference==="") ? null : (parseFloat(fields.qtyDifference));
    if (context) {
      if (context.caseType) rec.caseType = context.caseType;
      if (context.issueType) rec.issueType = context.issueType;
      if (context.severity) rec.severity = context.severity;
    }

    // Tidak ada isi sama sekali -> jangan buat case baru (bukan case existing yg
    // sengaja mau dikosongkan). Case existing yg dikosongkan tetap tersimpan (user
    // pakai tombol Hapus Case eksplisit kalau memang mau menghapus).
    if (!prev && !rec.remark && rec.status === "OPEN" && !rec.pic && !rec.actionTaken && !rec.qtyAdj && !rec.cbmAdj) {
      return { removed: true };
    }

    if (!changes.length && prev) return { unchanged: true, rec: rec };
    rec.updatedAt = now;
    changes.forEach(function (ch) { rec.audit.push({ at: now, by: currentUser(), what: ch }); });
    if (rec.audit.length > 200) rec.audit = rec.audit.slice(-200);
    store[key] = sanitize(rec, key);
    var res = persist();
    return { rec: store[key], persisted: res.ok, reason: res.reason, isNew: !prev };
  }

  // Tambah 1 entri audit tanpa mengubah field lain -- dipakai evaluasi ulang Qty
  // otomatis (by="sistem") supaya penjelasannya tercatat persis seperti yang
  // diminta (bukan cuma pesan generik "Status X -> Y" dari save()).
  function appendAudit(caseId, by, what) {
    var rec = store[caseId];
    if (!rec) return false;
    rec.audit.push({ at: new Date().toISOString(), by: C.S(by).slice(0, 60), what: C.S(what).slice(0, 300) });
    if (rec.audit.length > 200) rec.audit = rec.audit.slice(-200);
    rec.updatedAt = new Date().toISOString();
    store[caseId] = sanitize(rec, caseId);
    persist();
    return true;
  }

  function remove(caseId) {
    if (store[caseId]) { delete store[caseId]; persist(); return true; }
    return false;
  }
  // Ganti key sebuah case yg sudah ada di store lokal (dipakai saat pushCaseToSupabase
  // harus retry dgn id lain karena id awal ternyata sudah dipakai case lain di server).
  function rekey(oldKey, newKey) {
    if (!store[oldKey] || store[newKey]) return null;
    var rec = store[oldKey];
    delete store[oldKey];
    rec.id = newKey;
    store[newKey] = sanitize(rec, newKey);
    persist();
    return store[newKey];
  }

  function exportJSON() {
    return JSON.stringify({
      app: "Rekonsiliasi Inbound", versi: 2,
      dibuat: new Date().toISOString(), oleh: currentUser(), cases: store
    }, null, 2);
  }

  // Gabungkan berkas cadangan. Yang lebih baru menang; tidak menggandakan.
  function merge(incoming, doPersist) {
    var added = 0, updated = 0, skipped = 0;
    Object.keys(incoming).forEach(function (k) {
      if (!C.isSafeKey(k)) { skipped++; return; }
      var v = incoming[k];
      if (!v || typeof v !== "object") { skipped++; return; }
      var rec = sanitize(v, k);
      if (!rec.nopen) { skipped++; return; }
      var cur = store[k];
      if (!cur) { store[k] = rec; added++; }
      else if ((rec.updatedAt || "") > (cur.updatedAt || "")) { store[k] = rec; updated++; }
    });
    if (doPersist !== false) persist();
    return { added: added, updated: updated, skipped: skipped };
  }

  function importJSON(text) {
    var parsed = parseSafe(text);
    var n = Object.keys(parsed).length;
    if (!n) return { error: "Tidak ada catatan yang bisa dibaca dari berkas ini." };
    return merge(parsed, true);
  }

  function storageProblem() { return lastError; }

  // Ambil salinan seluruh case saat ini, lalu kosongkan store aktif.
  // Dipakai saat periode berganti supaya catatan periode lama tidak
  // tercampur / terbaca di periode yang sedang berjalan.
  function snapshotAndClear() {
    var snapshot = JSON.parse(JSON.stringify(store));
    store = Object.create(null);
    persist();
    return snapshot;
  }

  return {
    STATUS: STATUS, STATUS_KIND: STATUS_KIND,
    CASE_TYPE: CASE_TYPE, CASE_TYPE_LABEL: CASE_TYPE_LABEL, CLASS_TO_CASE_TYPE: CLASS_TO_CASE_TYPE,
    load: load, get: get, getAllForNopen: getAllForNopen, primaryCase: primaryCase,
    all: all, save: save, remove: remove, rekey: rekey,
    nextCaseId: nextCaseId, bumpCaseId: bumpCaseId, parseKey: parseKey, appendAudit: appendAudit,
    countFor: countFor, openCountFor: openCountFor,
    exportJSON: exportJSON, importJSON: importJSON,
    currentUser: currentUser, setUser: setUser, storageProblem: storageProblem,
    snapshotAndClear: snapshotAndClear
  };
})(C);
}
