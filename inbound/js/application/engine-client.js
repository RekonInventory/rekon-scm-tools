// Klien mesin: memakai Web Worker bila tersedia, jatuh ke thread utama bila tidak
// (mis. dibuka via file://). Kedua jalur memanggil engine-core.js yang sama.
import { ensureXLSX, xlsxUrl } from "../infrastructure/xlsx-loader.js";
import { createEngineCore } from "./engine-core.js";
import { log } from "../core/logger.js";

export function createEngineClient(onProgress) {
  let worker = null, inline = null, ready = null, seq = 0;
  const waiting = new Map();

  function startWorker() {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(new URL("../workers/engine-worker.js", import.meta.url), { type: "module" }); }
      catch (e) { reject(e); return; }
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.progress) { onProgress && onProgress(m.progress); return; }
        const p = waiting.get(m.reqId);
        if (!p) return;
        waiting.delete(m.reqId);
        if (m.ok) p.resolve(m.data); else p.reject(new Error(m.data && m.data.message));
      };
      w.onerror = (e) => {
        log.error("engine-worker:error", { message: e.message });
        waiting.forEach((p) => p.reject(new Error("Worker berhenti: " + (e.message || "kesalahan tak dikenal"))));
        waiting.clear();
      };
      worker = w;
      call("init", { xlsxUrl: xlsxUrl() }).then(resolve, reject);
    });
  }

  function call(op, payload, transfer) {
    const reqId = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(reqId, { resolve, reject });
      worker.postMessage({ op, reqId, payload }, transfer || []);
    });
  }

  async function init() {
    if (ready) return ready;
    ready = startWorker().then(() => { log.info("engine:worker-ready"); return "worker"; }).catch(async (e) => {
      log.warn("engine:worker-unavailable", { message: e && e.message });
      if (worker) { try { worker.terminate(); } catch (x) { /* abaikan */ } worker = null; }
      await ensureXLSX();
      inline = createEngineCore(onProgress);
      return "inline";
    });
    return ready;
  }

  async function run(op, payload, transfer) {
    await init();
    if (worker) return call(op, payload, transfer);
    // jalur thread utama
    if (op === "ingest") return inline.ingest(payload);
    if (op === "classify") return inline.classify(payload.id, payload.kind);
    if (op === "discard") return inline.discard(payload.id);
    if (op === "remove") return inline.remove(payload.kind);
    if (op === "reset") return inline.reset();
    if (op === "gate") return inline.gate();
    if (op === "reconcile") return inline.reconcile(payload);
    throw new Error("Operasi tidak dikenal: " + op);
  }

  return {
    init,
    mode: () => (worker ? "worker" : (inline ? "inline" : "pending")),
    ingest: (id, name, size, bytes) => run("ingest", { id, name, size, bytes }, [bytes]),
    classify: (id, kind) => run("classify", { id, kind }),
    discard: (id) => run("discard", { id }),
    remove: (kind) => run("remove", { kind }),
    reset: () => run("reset", {}),
    gate: () => run("gate", {}),
    reconcile: (opts) => run("reconcile", opts || {})
  };
}
