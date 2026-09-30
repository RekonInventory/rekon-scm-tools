// Keputusan deteksi jenis berkas — konstanta & aturan sama persis dengan intake() dan
// handler "Terapkan" (klasifikasi manual) di versi lama.
import { schema as SCH } from "./schema.js";

export const CONFIDENCE_THRESHOLD = 0.85;
export const ACCEPTED_EXT = /\.(xlsx|xlsm|xls)$/i;
export const KIND_LABEL = { scm: "SCM", ior: "Adidas / IOR", nike: "Nike / DRR" };

/** Deteksi otomatis. `accepted=false` berarti user harus memilih jenisnya manual. */
export function autoDetect(wb) {
  const det = SCH.detect(wb);
  const accepted = !!det.kind && (det.confidence || 0) >= CONFIDENCE_THRESHOLD;
  return { det, accepted };
}

/** Klasifikasi manual: pilih sheet dengan skor header terbaik untuk jenis yang dipilih user. */
export function manualDetection(wb, kind) {
  var spec = kind === "scm" ? SCH.SCM_SPEC : (kind === "ior" ? SCH.IOR_SPEC : SCH.DRR_SPEC);
  var best = null, bestScore = -1;
  wb.SheetNames.forEach(function (sn) {
    var h = SCH.findHeader(SCH.peek(wb, sn, 14), spec);
    if (h.score > bestScore) { bestScore = h.score; best = sn; }
  });
  return { kind: kind, sheet: best, confidence: 1 };
}
