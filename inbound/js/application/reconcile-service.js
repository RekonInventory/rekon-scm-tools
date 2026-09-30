// Orkestrasi 1 kali rekonsiliasi (setara run() lama, urutan dipertahankan):
//   1. hitung RESULT (engine verbatim, di worker)
//   2. re-evaluasi penyesuaian qty (verbatim) -> persist ke server
//   3. catat run + metadata berkas (registry)            [baru]
//   4. simpan snapshot sesi bersama (owner)
//   5. log aktivitas                                      [baru]
// Kegagalan langkah 3–5 TIDAK membatalkan hasil yang sudah tampil (sama seperti versi lama
// untuk sesi bersama); user diberi tahu lewat peringatan.
import { engine as E } from "../domain/engine.js";
import { planQtyReevaluation } from "./qty-reevaluation.js";
import { RunRepository, ActivityRepository } from "../infrastructure/run-repository.js";
import { CONFIG } from "../infrastructure/supabase.js";
import { toAppError } from "../core/errors.js";
import { log } from "../core/logger.js";

function periodBounds(periodKey) {
  const m = /^(\d{4}-\d\d-\d\d)_(\d{4}-\d\d-\d\d)$/.exec(periodKey || "");
  return m ? { start: m[1], end: m[2] } : { start: null, end: null };
}
function slimSummary(pack) {
  if (!pack) return null;
  const s = E.summarize(pack);
  return { total: s.total, clear: s.clear, abnormal: s.abnormal, historical: s.historicalOnly, qty: s.qty, cbm: s.cbm, sopo: s.sopo,
    onlyScm: s.onlyScm, onlyCmp: s.onlyCmp, invalid: s.invalid, missing: s.missing };
}

export function createReconcileService(deps) {
  const { engine, cases, session, imports, whoAmI } = deps;

  return {
    /** @returns {{result, warnings:string[], run, reevaluation}} */
    async run() {
      const t0 = performance.now();
      // "Hari ini" = tanggal kalender lokal pengguna, dinyatakan sebagai UTC 00:00 (sama dengan tanggal di data).
      const n = new Date();
      const result = await engine.reconcile({ today: Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) });
      const warnings = [];
      log.info("reconcile:computed", { ms: Math.round(performance.now() - t0), adidas: result.adidas ? result.adidas.main.length : 0, nike: result.nike ? result.nike.main.length : 0 });

      // (2) re-evaluasi qty — logika verbatim; store diubah dulu, lalu dipersist berurutan
      cases.setContext({ periodKey: result.periodKey || null, runId: null });
      const intents = planQtyReevaluation(result, cases.store);
      let reevaluation = { total: 0, failed: [] };
      if (intents.length) {
        reevaluation = await cases.persistIntents(intents);
        if (reevaluation.failed.length) warnings.push(reevaluation.failed.length + " case hasil evaluasi ulang qty gagal disimpan ke server (" + reevaluation.failed.map((f) => f.id).join(", ") + ").");
      }

      // (3) registry run
      const src = imports.sources();
      let run = null;
      try {
        const pb = periodBounds(result.periodKey);
        run = await RunRepository.create({
          period_key: result.periodKey || null, period_start: pb.start, period_end: pb.end, status: "COMPLETED",
          source_meta: { sources: result.sources, scopeIor: result.scopeIor ? { applied: result.scopeIor.applied, before: result.scopeIor.before, after: result.scopeIor.after } : null,
            scopeDrr: result.scope ? { applied: result.scope.applied, before: result.scope.before, after: result.scope.after } : null, warnings: result.warnings || [] },
          summary: { overall: result.overall, adidas: slimSummary(result.adidas), nike: slimSummary(result.nike) },
          engine_version: "legacy-verbatim-28ae4b4a", app_version: CONFIG.appVersion,
          created_by_name: whoAmI()
        }, src.meta);
        cases.setContext({ runId: run.id });
      } catch (e) {
        const ae = toAppError(e, "mencatat run rekonsiliasi");
        warnings.push(ae.userMessage);
        log.warn("reconcile:run-registry-failed", ae.technical);
      }

      // (4) snapshot sesi bersama
      try {
        const saved = await session.saveSnapshot(result, { periodKey: result.periodKey, sourceNames: result.sources, sourceFiles: src.files, runId: run ? run.id : null });
        if (saved.warning) warnings.push(saved.warning);
      } catch (e) {
        const ae = toAppError(e, "menyimpan sesi bersama");
        warnings.push(ae.userMessage + " Kolega lain tidak akan melihat hasil ini sampai Anda menjalankan ulang.");
        log.warn("reconcile:session-failed", ae.technical);
      }

      // (5) log aktivitas
      ActivityRepository.record("reconcile", { run_id: run ? run.id : null, period: result.periodKey, overall: result.overall && result.overall.status,
        adidas: result.adidas ? result.adidas.main.length : 0, nike: result.nike ? result.nike.main.length : 0, reevaluated: reevaluation.total });
      return { result, warnings, run, reevaluation };
    }
  };
}
