// Export Excel — lapisan tipis di atas penyusun workbook verbatim. Isi sheet lama
// tidak diubah; satu sheet tambahan "Validasi Berkas" (terstruktur) ditambahkan di
// akhir bila hasil validasi impor tersedia di browser ini.
import { C } from "../core/util.js";
import { engine as E } from "../domain/engine.js";
import { createWorkbookExporter } from "../domain/workbook-exporter.js";
import { ensureXLSX } from "../infrastructure/xlsx-loader.js";
import { ActivityRepository } from "../infrastructure/run-repository.js";
import { log } from "../core/logger.js";

export function createExportService(deps) {
  const cases = deps.cases;
  let exporter = null;
  async function ready() {
    await ensureXLSX();
    if (!exporter) exporter = createWorkbookExporter(C, E, cases.store, { mergedShipper: true });   // satu kolom SHIPPER
    return exporter;
  }
  async function history() {
    try { return await cases.fetchHistoryRows(); }
    catch (e) { log.warn("export:history-failed", { message: e && e.message }); return null; }  // sama seperti versi lama: tetap export tanpa riwayat
  }
  function validationSheet(importItems) {
    const rows = [["BERKAS", "JENIS", "STATUS", "KODE", "TINGKAT", "PESAN", "KOLOM", "BARIS", "SHEET", "JUMLAH"]];
    (importItems || []).forEach((it) => (it.issues || []).forEach((i) => rows.push([
      C.safeCell(it.name), it.kind || "", i.status, i.code, i.severity, C.safeCell(i.message), i.field || "", i.row || "", C.safeCell(i.sheet || ""), i.count || ""
    ])));
    if (rows.length === 1) return null;
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [30, 10, 10, 22, 9, 70, 10, 8, 18, 9].map((w) => ({ wch: w }));
    return ws;
  }

  return {
    async full(result, importItems) {
      const ex = await ready();
      result._caseHistory = await history();
      const wb = ex.buildWorkbook(result);
      const extra = validationSheet(importItems);
      if (extra) XLSX.utils.book_append_sheet(wb, extra, "Validasi Berkas");
      XLSX.writeFile(wb, "Rekonsiliasi_Inbound_" + ex.stamp(result.generated) + ".xlsx");
      ActivityRepository.record("export_full", { period: result.periodKey || null });
    },
    async filtered(result, payload, view, label) {
      const ex = await ready();
      result._caseHistory = await history();
      ex.downloadFilteredXLSX(result, payload, view.brand, view.mode, label, view.q);
      ActivityRepository.record("export_filtered", { period: result.periodKey || null, brand: view.brand, filter: view.filter, rows: (payload.main || payload.detail || []).length });
    }
  };
}
