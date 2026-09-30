// Web Worker (type: module): parsing Excel + rekonsiliasi di luar thread UI supaya
// browser tidak membeku saat membaca IOR ~12 MB. Memakai modul domain yang SAMA
// dengan jalur thread utama (application/engine-core.js).
import { createEngineCore } from "../application/engine-core.js";

let core = null;
let xlsxReady = null;

function loadXLSX(url) {
  if (!xlsxReady) {
    xlsxReady = fetch(url).then((r) => {
      if (!r.ok) throw new Error("Gagal memuat pustaka Excel (" + r.status + ")");
      return r.text();
    }).then((src) => {
      // Worker modul tidak mendukung importScripts; SheetJS (UMD) dievaluasi di global
      // scope worker sehingga `XLSX` tersedia seperti di halaman biasa. Sumbernya adalah
      // file vendor milik aplikasi ini sendiri (same-origin), bukan input pengguna.
      (0, eval)(src + "\n;self.XLSX = XLSX;");
      return self.XLSX;
    });
  }
  return xlsxReady;
}

self.onmessage = async (e) => {
  const { op, reqId, payload } = e.data || {};
  const reply = (ok, data) => self.postMessage({ reqId, ok, data });
  try {
    if (op === "init") {
      await loadXLSX(payload.xlsxUrl);
      core = createEngineCore((p) => self.postMessage({ progress: p }));
      return reply(true, { ready: true });
    }
    if (!core) throw new Error("Worker belum diinisialisasi.");
    if (op === "ingest") return reply(true, await core.ingest(payload));
    if (op === "classify") return reply(true, await core.classify(payload.id, payload.kind));
    if (op === "discard") return reply(true, core.discard(payload.id));
    if (op === "remove") return reply(true, core.remove(payload.kind));
    if (op === "reset") return reply(true, core.reset());
    if (op === "gate") return reply(true, core.gate());
    if (op === "reconcile") return reply(true, core.reconcile());
    throw new Error("Operasi tidak dikenal: " + op);
  } catch (err) {
    reply(false, { message: (err && err.message) || String(err) });
  }
};
