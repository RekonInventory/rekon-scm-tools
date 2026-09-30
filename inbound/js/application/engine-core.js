// Inti mesin impor + rekonsiliasi yang bisa jalan di Web Worker MAUPUN thread
// utama (fallback). Hanya memanggil modul domain verbatim — tidak ada aturan
// bisnis baru di sini. Membutuhkan global XLSX (SheetJS) yang sudah dimuat.
import { autoDetect, manualDetection } from "../domain/detection.js";
import { assignFile, computeResult, gate } from "../domain/pipeline.js";
import { validateEntry, workbookProblem, detectionIssue } from "../domain/validation.js";

/**
 * Sheet yang PERLU diurai berdasarkan nama saja — mengikuti persis urutan prioritas nama di
 * schema.detect() + penggabungan sheet Inbound/BAP di assign(). Sheet lain (mis. "Outbound"
 * 33 MB di IOR.xlsx) tidak pernah dibaca oleh aturan lama bila jalur nama berhasil, jadi tidak
 * perlu diurai. Mengembalikan null bila deteksi harus lewat isi semua sheet (urai penuh).
 */
export function sheetsToParse(sheetNames) {
  const low = sheetNames.map((s) => s.toLowerCase().trim());
  const pick = (n) => sheetNames[low.indexOf(n)];
  if (low.indexOf("inbound") !== -1 || low.indexOf("bap") !== -1 || low.indexOf("buatcekinbound") !== -1) {
    const set = sheetNames.filter((s, i) => low[i] === "inbound" || low[i] === "bap");
    if (!set.length) set.push(pick("buatcekinbound"));
    return set;
  }
  for (const n of ["drr master", "nike", "scm"]) if (low.indexOf(n) !== -1) return [pick(n)];
  return null;
}

export function createEngineCore(progress) {
  const files = { scm: null, ior: null, nike: null };
  const pending = new Map();   // id -> { wb, name }
  const notify = progress || function () {};

  function summarize(entry, kind) {
    return {
      kind, name: entry.name, sheet: entry.sheet, detect: entry.detect, report: entry.report,
      severity: entry.severity, note: entry.note, fatal: entry.fatal,
      rowCount: entry.rows ? entry.rows.length : 0, monthBreakdown: entry.monthBreakdown || null
    };
  }

  async function assign(id, kind, name, wb, det) {
    notify({ id, stage: "validating", detail: "Memvalidasi kolom & baris…" });
    const entry = await assignFile(kind, name, wb, det, null, (msg) => notify({ id, stage: "validating", detail: msg }));
    entry.wb = null;          // workbook mentah tidak dibutuhkan lagi — bebaskan memori
    files[kind] = entry;
    return { outcome: "assigned", kind, det, summary: summarize(entry, kind), issues: validateEntry(entry, kind) };
  }

  return {
    async ingest(msg) {
      const { id, name } = msg;
      const bytes = new Uint8Array(msg.bytes);
      let wb, partial = false;
      try {
        const names = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames || [];
        const want = sheetsToParse(names);
        notify({ id, stage: "reading", detail: want ? "Mengurai sheet " + want.join(" + ") + "…" : "Mengurai workbook…" });
        wb = XLSX.read(bytes, want ? { type: "array", cellDates: false, sheets: want } : { type: "array", cellDates: false });
        partial = !!want;
      } catch (e) { return { outcome: "invalid", issues: [workbookProblem("corrupt", name)] }; }
      if (!wb.SheetNames || !wb.SheetNames.length) return { outcome: "invalid", issues: [workbookProblem("no-sheet", name)] };
      let { det, accepted } = autoDetect(wb);
      if (!accepted && partial) {
        // Jenis ragu -> user akan memilih manual; klasifikasi manual menilai SEMUA sheet,
        // jadi urai ulang penuh supaya hasilnya identik dengan versi lama.
        notify({ id, stage: "reading", detail: "Mengurai seluruh workbook…" });
        wb = XLSX.read(bytes, { type: "array", cellDates: false });
        ({ det, accepted } = autoDetect(wb));
      }
      notify({ id, stage: "detected", detail: det.kind ? ("Terdeteksi " + det.kind.toUpperCase() + " (" + Math.round((det.confidence || 0) * 100) + "%)") : "Jenis belum dikenali", det });
      if (!accepted) {
        pending.set(id, { wb, name });
        return { outcome: "needs-classification", det, sheetNames: wb.SheetNames.slice(), issues: [detectionIssue(det, name)] };
      }
      return assign(id, det.kind, name, wb, det);
    },
    async classify(id, kind) {
      const p = pending.get(id);
      if (!p) return { outcome: "invalid", issues: [workbookProblem("unreadable", "berkas")] };
      pending.delete(id);
      return assign(id, kind, p.name, p.wb, manualDetection(p.wb, kind));
    },
    discard(id) { pending.delete(id); return true; },
    remove(kind) { files[kind] = null; return gate(files); },
    reset() { files.scm = files.ior = files.nike = null; pending.clear(); return true; },
    gate() { return gate(files); },
    /** opts.today (ms epoch UTC 00:00, opsional) mengaktifkan aturan "GRN / Unloading hari ini". */
    reconcile(opts) {
      const g = gate(files);
      if (!g.ok) throw new Error(g.reason || "Berkas belum lengkap.");
      return computeResult(files, opts && opts.today ? { today: new Date(opts.today) } : undefined);
    }
  };
}
