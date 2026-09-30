// Unit-of-work untuk re-evaluasi penyesuaian qty setelah setiap rekonsiliasi.
//
// Versi lama mengandalkan monkey patch (APP.cases.save dibungkus supaya setiap simpan
// ikut terkirim ke server). Di sini pola itu diganti komposisi eksplisit: store asli
// TIDAK diubah; yang diberikan ke logika bisnis (verbatim) adalah pembungkus yang
// mencatat setiap perubahan sebagai "niat persistensi" berurutan. Pemanggil
// (case-service) lalu mempersist daftar itu lewat repository.
import { reevaluateQtyAdjustments } from "../domain/findings.js";

/**
 * @returns {Array<{id:string, isNew:boolean}>} urutan perubahan case yang harus dipersist.
 */
export function planQtyReevaluation(result, store) {
  const intents = [];
  const tracked = Object.create(store);
  tracked.save = function (caseId, brand, nopen, fields, context) {
    const res = store.save(caseId, brand, nopen, fields, context);
    if (res && res.rec && !res.removed) intents.push({ id: res.rec.id, isNew: !!res.isNew });
    return res;
  };
  reevaluateQtyAdjustments(result, tracked, function (rec, isNew) {
    if (rec) intents.push({ id: rec.id, isNew: !!isNew });
  });
  return intents;
}
