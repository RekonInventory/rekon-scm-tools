// Bulk upload case Inbound:
//   unduh template (baris temuan yang sedang tampil) -> isi di Excel -> unggah ->
//   pratinjau -> disimpan SATU PER SATU lewat case-service (cek versi per case, aturan
//   bisnis case-store tetap sama dengan editor di detail NOPEN).
// Tampilan berkas & pratinjau memakai helper bersama window.GLTBulk (../glt-bulk-upload.js).
import { C } from "../core/util.js";
import { engine as E } from "../domain/engine.js";
import { displayCaseId } from "../domain/case-view.js";
import { ensureXLSX } from "../infrastructure/xlsx-loader.js";
import { ConflictError, AppError } from "../core/errors.js";

const STATUS = ["OPEN", "IN PROGRESS", "CLOSED"];
const KOLOM = ["Brand", "NOPEN", "Temuan", "Status Baris", "Shipper", "Tgl GRN", "Qty SCM", "Qty Pembanding", "Selisih Qty",
  "CBM SCM", "CBM Pembanding", "Selisih CBM", "Keterangan", "Case ID", "Status Case", "Jenis Case", "PIC", "Catatan",
  "Tindakan", "Penyesuaian QTY", "Keterangan QTY", "Penyesuaian CBM", "Keterangan CBM"];

function normStatus(s) {
  const t = String(s || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!t) return "";
  if (t === "OPEN" || t === "BUKA" || t === "BARU") return "OPEN";
  if (t === "IN PROGRESS" || t === "INPROGRESS" || t === "PROGRESS" || t === "PROSES" || t === "DIPROSES") return "IN PROGRESS";
  if (t === "CLOSED" || t === "CLOSE" || t === "SELESAI" || t === "TUTUP" || t === "DONE") return "CLOSED";
  return null;
}
/** Angka dari sel Excel / teks (format Indonesia maupun Inggris). Kosong = 0. */
export function parseAngka(s) {
  if (s === null || s === undefined || String(s).trim() === "") return { ok: true, v: 0, kosong: true };
  if (typeof s === "number") return { ok: isFinite(s), v: s };
  const t = String(s).trim().replace(/\s/g, "");
  let n;
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));
  else if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) n = Number(t.replace(/,/g, ""));
  else if (/^-?\d+,\d+$/.test(t)) n = Number(t.replace(",", "."));
  else n = Number(t);
  return { ok: !isNaN(n) && isFinite(n), v: n };
}
const normNopen = (s) => String(s === null || s === undefined ? "" : s).trim();
const tanpaNol = (s) => normNopen(s).replace(/^0+/, "");

export function createBulkCaseService(deps) {
  const { app, cases } = deps;
  const store = cases.store;
  const bulk = () => {
    if (!window.GLTBulk) throw new AppError("Komponen bulk upload belum termuat. Muat ulang halaman.", { code: "BULK_MISSING" });
    return window.GLTBulk;
  };
  const me = () => store.currentUser();

  function brandLabel(b) { return b === "ADIDAS" ? "Adidas" : "Nike"; }
  function primerAktif(brand, nopen) {
    const cs = store.getAllForNopen(brand, nopen).filter((c) => c.status !== "CLOSED");
    return cs.length ? cs[cs.length - 1] : null;
  }

  /** Template dari baris yang sedang tampil (mode Per NOPEN). */
  async function template(rows, view) {
    if (!rows || !rows.length) throw new AppError("Tidak ada baris temuan yang tampil untuk dijadikan template.", { code: "EMPTY" });
    const XLSX = await ensureXLSX();
    const L = [KOLOM];
    rows.forEach((r) => {
      const brand = app.logic.rowBrand(r), c = primerAktif(brand, r.NOPEN);
      L.push([brandLabel(brand), r.NOPEN, r.ISSUE || r.PRIMARY || "", r.ROW_STATUS || "", r.SHIPPER || "",
        r.TGL_SCM ? C.fmtDate(new Date(r.TGL_SCM)) : "", r.QTY_SCM === null || r.QTY_SCM === undefined ? "" : r.QTY_SCM,
        r.QTY_CMP === null || r.QTY_CMP === undefined ? "" : r.QTY_CMP, r.QTY_DIFF === null || r.QTY_DIFF === undefined ? "" : r.QTY_DIFF,
        r.CBM_SCM === null || r.CBM_SCM === undefined ? "" : r.CBM_SCM, r.CBM_CMP === null || r.CBM_CMP === undefined ? "" : r.CBM_CMP,
        r.CBM_DIFF === null || r.CBM_DIFF === undefined ? "" : r.CBM_DIFF, r.EXPLANATION || "",
        c ? displayCaseId(c.id) : "", c ? c.status : "", c ? (store.CASE_TYPE_LABEL[c.caseType] || c.caseType) : "", c ? c.pic || "" : "",
        c ? c.remark || "" : "", c ? c.actionTaken || "" : "", c && c.qtyAdj ? c.qtyAdj : "", c ? c.qtyAdjNote || "" : "",
        c && c.cbmAdj ? c.cbmAdj : "", c ? c.cbmAdjNote || "" : ""]);
    });
    const P = [["PETUNJUK BULK UPLOAD CASE INBOUND"], [],
      ["1", "Isi kolom Status Case, Jenis Case, Catatan, Tindakan, Penyesuaian QTY/CBM, dan keterangannya di sheet CASE."],
      ["2", "Case ID terisi = case yang sudah ada akan DIUBAH. Case ID kosong = dibuat case BARU (kalau ada isian)."],
      ["3", "Baris tanpa isian dan tanpa Case ID dilewati. Kolom Brand s.d. Keterangan hanya informasi (Brand & NOPEN dipakai mencocokkan)."],
      ["4", "Status Case: OPEN, IN PROGRESS, atau CLOSED. Jenis Case: salah satu di sheet PILIHAN (kosong = otomatis dari temuan)."],
      ["5", "PIC otomatis = nama pengguna yang mengunggah (sama seperti editor case). Kolom PIC hanya informasi."],
      ["6", "Untuk NOPEN yang hanya ada di SCM, penyesuaian QTY/CBM dicatat sebagai 'data belum tersedia' dan dievaluasi ulang otomatis."],
      ["7", "Sebelum disimpan tampil pratinjau. Case yang diubah orang lain sesudah pratinjau tidak ditimpa (dilaporkan sebagai bentrok)."],
      [], ["Diunduh", new Date().toLocaleString("id-ID")], ["Oleh", me()], ["Jumlah baris", rows.length]];
    const D = [["Status Case"]].concat(STATUS.map((s) => [s])).concat([[], ["Jenis Case"]])
      .concat(store.CASE_TYPE.map((t) => [store.CASE_TYPE_LABEL[t] || t]));
    const G = bulk();
    const wb = G.tulisWorkbook(XLSX, [
      { nama: "CASE", baris: L, lebar: [8, 10, 22, 12, 26, 11, 10, 12, 10, 10, 12, 10, 40, 12, 13, 16, 14, 40, 30, 12, 24, 12, 24] },
      { nama: "PETUNJUK", baris: P, lebar: [12, 120] },
      { nama: "PILIHAN", baris: D, lebar: [24] }]);
    const per = view && view.brand ? view.brand : "ALL";
    G.unduhXlsx(XLSX, wb, "Template_Case_Inbound_" + per + "_" + new Date().toISOString().slice(0, 10) + ".xlsx");
    return rows.length;
  }

  /** Baca berkas -> rencana per baris (belum menyimpan apa pun). */
  async function rencanakan(file) {
    const result = app.store.get().result;
    if (!result) throw new AppError("Jalankan rekonsiliasi dulu, lalu unggah template.", { code: "NO_RESULT" });
    const XLSX = await ensureXLSX();
    const G = bulk();
    const t = await G.bacaTemplate(file, XLSX, { sheet: ["CASE", "TEMPLATE"], wajib: ["NOPEN", "Catatan"] });
    const K = (n) => G.cariKolom(t.header, n), V = G.nilai;
    const kol = { brand: K("Brand"), nopen: K("NOPEN"), id: K(["Case ID", "Case"]), status: K("Status Case"), jenis: K(["Jenis Case", "Case Type"]),
      remark: K(["Catatan", "Remark"]), act: K(["Tindakan", "Action"]), qa: K(["Penyesuaian QTY", "Qty Adj"]), qn: K(["Keterangan QTY"]),
      ca: K(["Penyesuaian CBM", "CBM Adj"]), cn: K(["Keterangan CBM"]) };
    // indeks baris hasil rekonsiliasi: brand|nopen (juga tanpa nol depan, kalau Excel mengubah NOPEN jadi angka)
    const idx = new Map();
    [["ADIDAS", result.adidas], ["NIKE", result.nike]].forEach(([b, pack]) => {
      (pack && pack.main ? pack.main : []).forEach((r) => {
        idx.set(b + "|" + r.NOPEN, r);
        const z = b + "|#" + tanpaNol(r.NOPEN);
        idx.set(z, idx.has(z) && idx.get(z) !== r ? null : r);   // null = ambigu
      });
    });
    const viewBrand = app.store.get().view.brand;
    const jenisDari = (s) => {
      const u = String(s || "").trim().toUpperCase();
      if (!u) return "";
      const kode = store.CASE_TYPE.find((x) => x === u.replace(/\s+/g, "_"));
      if (kode) return kode;
      const lab = store.CASE_TYPE.find((x) => String(store.CASE_TYPE_LABEL[x] || "").toUpperCase() === u);
      return lab || null;
    };
    const rencana = [], idPakai = new Set();
    t.baris.forEach((row) => {
      const p = { baris: row._baris, brand: "", nopen: normNopen(row[kol.nopen]), aksi: "", pesan: "", label: "" };
      rencana.push(p);
      const isian = { status: V(row, kol.status), jenis: V(row, kol.jenis), remark: V(row, kol.remark), act: V(row, kol.act),
        qa: kol.qa ? row[kol.qa] : null, qn: V(row, kol.qn), ca: kol.ca ? row[kol.ca] : null, cn: V(row, kol.cn) };
      const caseId = V(row, kol.id);
      const diisi = (v) => v !== null && v !== undefined && String(v).trim() !== "";
      const adaIsian = isian.status || isian.jenis || isian.remark || isian.act || diisi(isian.qa) || isian.qn || diisi(isian.ca) || isian.cn;
      if (!caseId && !adaIsian) { p.aksi = "LEWAT"; p.pesan = "tanpa isian"; p._kelas = "skip"; return; }
      const galat = (m) => { p.aksi = "GALAT"; p.pesan = m; p._kelas = "bad"; };
      const bTeks = V(row, kol.brand).toUpperCase();
      const brand = /ADIDAS/.test(bTeks) ? "ADIDAS" : (/NIKE/.test(bTeks) ? "NIKE" : (viewBrand === "ADIDAS" || viewBrand === "NIKE" ? viewBrand : ""));
      if (!brand) return galat("Brand kosong (isi Adidas atau Nike)");
      p.brand = brand === "ADIDAS" ? "Adidas" : "Nike";
      if (!p.nopen) return galat("NOPEN kosong");
      let r = idx.get(brand + "|" + p.nopen);
      if (!r) { r = idx.get(brand + "|#" + tanpaNol(p.nopen)); if (r === null) return galat("NOPEN " + p.nopen + " cocok dengan lebih dari satu baris"); }
      if (!r) return galat("NOPEN " + p.nopen + " tidak ada di hasil rekonsiliasi " + p.brand + " yang sedang tampil");
      p.nopen = r.NOPEN;
      const st = normStatus(isian.status);
      if (st === null) return galat("Status Case tidak dikenal: " + isian.status);
      const jenis = jenisDari(isian.jenis);
      if (jenis === null) return galat("Jenis Case tidak dikenal: " + isian.jenis);
      const qa = parseAngka(isian.qa), ca = parseAngka(isian.ca);
      if (!qa.ok) return galat("Penyesuaian QTY bukan angka: " + isian.qa);
      if (!ca.ok) return galat("Penyesuaian CBM bukan angka: " + isian.ca);
      let lama = null;
      if (caseId) {
        lama = store.getAllForNopen(brand, r.NOPEN).find((c) => c.id === caseId || displayCaseId(c.id) === caseId ||
          displayCaseId(c.id) === r.NOPEN + "-" + caseId.replace(/^.*-/, "")) || null;
        if (!lama) return galat("Case ID " + caseId + " tidak ditemukan untuk NOPEN ini (mungkin sudah dihapus)");
        if (idPakai.has(lama.id)) return galat("Case ID " + caseId + " muncul lebih dari sekali di berkas");
        idPakai.add(lama.id);
      }
      const fields = {
        status: st || (lama ? lama.status : "OPEN"), pic: me(),
        remark: kol.remark ? isian.remark : (lama ? lama.remark : ""), actionTaken: kol.act ? isian.act : (lama ? lama.actionTaken : ""),
        qtyAdj: kol.qa ? qa.v : (lama ? lama.qtyAdj || 0 : 0), qtyAdjNote: kol.qn ? isian.qn : (lama ? lama.qtyAdjNote : ""),
        cbmAdj: kol.ca ? ca.v : (lama ? lama.cbmAdj || 0 : 0), cbmAdjNote: kol.cn ? isian.cn : (lama ? lama.cbmAdjNote : "")
      };
      if (r.CLASSES && r.CLASSES.indexOf(E.CLASS.ONLY_IN_SCM) !== -1) {
        // sama dengan editor: data pembanding belum ada -> catat nilai yang ditunggu
        fields.qtyExpected = fields.qtyAdj || null;
        fields.cbmExpected = fields.cbmAdj || null;
      }
      const context = { caseType: jenis || (lama ? lama.caseType : (store.CLASS_TO_CASE_TYPE[r.PRIMARY] || "OTHER")), issueType: r.PRIMARY, severity: r.SEVERITY };
      const ubah = [];
      const beda = (a, b) => String(a === null || a === undefined ? "" : a) !== String(b === null || b === undefined ? "" : b);
      if (lama) {
        if (lama.status !== fields.status) ubah.push("Status " + lama.status + " → " + fields.status);
        if (beda(lama.remark, fields.remark)) ubah.push("Catatan: " + (lama.remark || "(kosong)") + " → " + (fields.remark || "(kosong)"));
        if (beda(lama.actionTaken, fields.actionTaken)) ubah.push("Tindakan diubah");
        if ((Number(lama.qtyAdj) || 0) !== (Number(fields.qtyAdj) || 0)) ubah.push("Penyesuaian QTY " + (lama.qtyAdj || 0) + " → " + fields.qtyAdj);
        if ((Number(lama.cbmAdj) || 0) !== (Number(fields.cbmAdj) || 0)) ubah.push("Penyesuaian CBM " + (lama.cbmAdj || 0) + " → " + fields.cbmAdj);
        if (beda(lama.qtyAdjNote, fields.qtyAdjNote) || beda(lama.cbmAdjNote, fields.cbmAdjNote)) ubah.push("Keterangan penyesuaian diubah");
        if (jenis && jenis !== lama.caseType) ubah.push("Jenis " + (store.CASE_TYPE_LABEL[lama.caseType] || lama.caseType) + " → " + (store.CASE_TYPE_LABEL[jenis] || jenis));
        p.label = displayCaseId(lama.id);
        // PIC berganti otomatis ke pengunggah; itu saja tidak dihitung sebagai perubahan
        if (!ubah.length) { p.aksi = "SAMA"; p.pesan = "tidak ada perubahan"; p._kelas = "skip"; return; }
        const m = cases.meta(lama.id);
        p.input = { caseId: lama.id, brand, nopen: r.NOPEN, fields, context, expectedVersion: m ? m.version : null, action: "BULK_UPLOAD" };
        p.aksi = "UBAH";
      } else {
        if (!fields.remark && fields.status === "OPEN" && !fields.actionTaken && !fields.qtyAdj && !fields.cbmAdj)
          return galat("Isian kosong: tulis Catatan, Tindakan, Status, atau Penyesuaian");
        ubah.push("Status " + fields.status);
        if (fields.remark) ubah.push("Catatan: " + fields.remark);
        if (fields.actionTaken) ubah.push("Tindakan: " + fields.actionTaken);
        if (fields.qtyAdj) ubah.push("Penyesuaian QTY " + fields.qtyAdj + (fields.qtyExpected ? " (data belum tersedia)" : ""));
        if (fields.cbmAdj) ubah.push("Penyesuaian CBM " + fields.cbmAdj + (fields.cbmExpected ? " (data belum tersedia)" : ""));
        p.label = "(baru)";
        p.input = { caseId: null, brand, nopen: r.NOPEN, fields, context, action: "BULK_UPLOAD" };
        p.aksi = "BARU";
      }
      p.pesan = ubah.join("; ");
    });
    return { rencana, namaBerkas: file.name };
  }

  /** Simpan rencana satu per satu. onProgress(i, total). */
  async function terapkan(rencana, onProgress) {
    const kerja = rencana.filter((x) => x.aksi === "BARU" || x.aksi === "UBAH");
    let sukses = 0, bentrok = 0, galat = 0;
    for (let i = 0; i < kerja.length; i++) {
      const x = kerja[i];
      try {
        const res = await cases.save(x.input);
        if (res.status === "saved") { x.hasil = "TERSIMPAN"; x.hasilPesan = displayCaseId(res.id); sukses++; }
        else { x.hasil = "TIDAK BERUBAH"; x.hasilPesan = res.status; }
      } catch (e) {
        if (e instanceof ConflictError) { x.hasil = "BENTROK"; x.hasilPesan = e.userMessage || e.message; bentrok++; }
        else { x.hasil = "GALAT"; x.hasilPesan = (e && (e.userMessage || e.message)) || String(e); galat++; }
      }
      if (onProgress) onProgress(i + 1, kerja.length);
    }
    return { total: kerja.length, sukses, bentrok, galat };
  }

  async function laporan(rencana) {
    const XLSX = await ensureXLSX();
    const G = bulk();
    const L = [["Baris", "Brand", "NOPEN", "Case", "Aksi", "Hasil", "Keterangan"]];
    rencana.forEach((x) => L.push([x.baris, x.brand, x.nopen, x.hasil === "TERSIMPAN" ? x.hasilPesan : x.label, x.aksi,
      x.hasil || (x.aksi === "GALAT" ? "GALAT" : "-"), x.hasil && x.hasil !== "TERSIMPAN" ? x.hasilPesan : x.pesan]));
    G.unduhXlsx(XLSX, G.tulisWorkbook(XLSX, [{ nama: "HASIL", baris: L, lebar: [7, 8, 10, 12, 8, 13, 90] }]),
      "Hasil_Bulk_Case_Inbound_" + new Date().toISOString().slice(0, 10) + ".xlsx");
  }

  return { template, rencanakan, terapkan, laporan };
}
