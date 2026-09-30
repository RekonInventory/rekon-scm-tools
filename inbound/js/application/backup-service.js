// Cadangkan & pulihkan case: validate -> preview -> conflict detection -> import.
// Pemulihan ditulis ke SERVER (versi lama hanya ke localStorage) lewat RPC
// inbound_case_import yang mewajibkan role supervisor/admin + cek versi.
import { buildBackup, parseBackup, diffBackup } from "../domain/backup-format.js";
import { CaseRepository, caseToRow } from "../infrastructure/case-repository.js";
import { ActivityRepository } from "../infrastructure/run-repository.js";
import { CONFIG } from "../infrastructure/supabase.js";
import { downloadText } from "./download.js";

export function createBackupService(deps) {
  const cases = deps.cases, whoAmI = deps.whoAmI, periodKey = deps.periodKey;

  return {
    exportBackup() {
      const all = cases.store.all();
      const meta = {};
      Object.keys(all).forEach((id) => { const m = cases.meta(id); if (m) meta[id] = { version: m.version, periodKey: m.periodKey }; });
      const doc = buildBackup({ cases: all, meta, appVersion: CONFIG.appVersion, exportedBy: whoAmI(), workspace: CONFIG.workspaceId, period: periodKey() });
      const d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      downloadText(JSON.stringify(doc, null, 2), "Inbound_Cases_Backup_" + CONFIG.workspaceId + "_" + stamp + ".json", "application/json");
      ActivityRepository.record("backup_export", { count: Object.keys(all).length });
      return Object.keys(all).length;
    },

    async preview(file) {
      const text = await file.text();
      const parsed = parseBackup(text);
      if (!parsed.ok) return parsed;
      const diff = diffBackup(parsed.cases, cases.store.all());
      return Object.assign({}, parsed, { fileName: file.name, diff });
    },

    /** Terapkan item yang dipilih. Mengembalikan ringkasan per status. */
    async apply(preview, selectedIds, onProgress) {
      const summary = { applied: 0, conflicts: [], rejected: [], errors: [] };
      const me = whoAmI();
      const ids = preview.diff.items.filter((i) => selectedIds.has(i.id));
      for (let n = 0; n < ids.length; n++) {
        const it = ids[n];
        onProgress && onProgress(n + 1, ids.length);
        const rec = JSON.parse(JSON.stringify(it.incoming));
        rec.audit = (rec.audit || []).concat([{ at: new Date().toISOString(), by: me, what: "Dipulihkan dari cadangan " + preview.fileName }]).slice(-200);
        const m = cases.meta(it.id);
        try {
          const out = await CaseRepository.importCase(caseToRow(rec), m ? m.version : null);
          if (out.status === "ok") summary.applied++;
          else if (out.status === "conflict") summary.conflicts.push(it.id);
          else summary.rejected.push({ id: it.id, reason: out.status === "id_conflict" ? "sudah ada di server (mungkin sudah dihapus — pulihkan lewat supervisor)" : out.status });
        } catch (e) {
          summary.errors.push({ id: it.id, error: e });
          if (e && (e.code === "42501")) break;   // tidak berizin: hentikan, semua akan ditolak
        }
      }
      ActivityRepository.record("backup_restore", { file: preview.fileName, applied: summary.applied, conflicts: summary.conflicts.length, rejected: summary.rejected.length, errors: summary.errors.length });
      await cases.load();
      return summary;
    }
  };
}
