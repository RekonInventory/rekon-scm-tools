// Pipeline impor dengan status per berkas yang eksplisit:
//   queued -> reading -> detected -> validating -> valid | warning | invalid -> ready
// (atau "needs-classification" bila jenis berkas harus dipilih manual).
// Parsing berat dikerjakan engine (Web Worker); service ini hanya mengatur state.
import { preflight, displayStatus } from "../domain/validation.js";
import { KIND_LABEL } from "../domain/detection.js";
import { log } from "../core/logger.js";

let seq = 0;
const nextId = () => "f" + (++seq) + "-" + Date.now().toString(36);

async function sha256Hex(buf) {
  try {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return null; }
}

function readBytes(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    fr.onerror = () => reject(new Error('Berkas "' + file.name + '" gagal dibaca.'));
    fr.onload = () => resolve(fr.result);
    fr.readAsArrayBuffer(file);
  });
}

export function createImportService(deps) {
  const engine = deps.engine, emit = deps.onChange || function () {};
  let items = [];           // semua kartu berkas (urutan tampil)
  let gate = { ok: false, status: "INCOMPLETE", reason: "Berkas SCM belum dimuat." };
  let queue = Promise.resolve();

  const find = (id) => items.find((i) => i.id === id);
  function patch(id, p) {
    const it = find(id);
    if (!it) return;
    Object.assign(it, p);
    emit({ type: "item", id });
  }
  async function refreshGate() {
    try { gate = await engine.gate(); } catch (e) { log.warn("import:gate-failed", { message: e.message }); }
    emit({ type: "gate", gate });
  }

  function applyOutcome(id, out) {
    const it = find(id);
    if (!it) return;
    if (out.outcome === "assigned") {
      // berkas lama di slot yang sama digantikan (perilaku lama: files[kind] ditimpa)
      items = items.filter((x) => x.id === id || !(x.kind === out.kind && x.summary));
      const status = displayStatus(out.summary.severity, out.issues);
      patch(id, {
        kind: out.kind, det: out.det, summary: out.summary, issues: (it.preIssues || []).concat(out.issues || []),
        state: out.summary.severity === "INVALID" ? "invalid" : "ready", display: status, stage: null, progress: 1
      });
    } else if (out.outcome === "needs-classification") {
      patch(id, { state: "needs-classification", det: out.det, sheetNames: out.sheetNames, issues: (it.preIssues || []).concat(out.issues || []), display: "PERLU KLASIFIKASI", stage: null });
    } else {
      patch(id, { state: "invalid", display: "INVALID", issues: (it.preIssues || []).concat(out.issues || []), stage: null });
    }
  }

  async function process(it) {
    const pre = preflight(it.name, it.size);
    it.preIssues = pre.filter((x) => x.severity !== "error");
    if (pre.some((x) => x.severity === "error")) { patch(it.id, { state: "invalid", display: "INVALID", issues: pre }); return; }
    try {
      patch(it.id, { state: "reading", stage: "Membaca berkas…", progress: 0 });
      const buf = await readBytes(it.file, (p) => patch(it.id, { progress: p }));
      const hash = await sha256Hex(buf);
      patch(it.id, { sha256: hash, stage: "Mengurai workbook…", progress: 1 });
      const out = await engine.ingest(it.id, it.name, it.size, buf);
      applyOutcome(it.id, out);
      log.info("import:file", { name: it.name, outcome: out.outcome, kind: out.kind || null });
    } catch (e) {
      log.error("import:file-failed", { name: it.name, message: e.message });
      patch(it.id, { state: "invalid", display: "INVALID", stage: null,
        issues: [{ status: "INVALID", severity: "error", code: "READ_FAILED", message: e.message || "Berkas gagal diproses.", field: "file", row: null, sheet: null }] });
    }
  }

  return {
    items: () => items.slice(),
    gate: () => gate,
    slot: (kind) => items.find((i) => i.kind === kind && i.state === "ready") || null,
    busy: () => items.some((i) => ["queued", "reading", "detected", "validating"].indexOf(i.state) !== -1),

    /** Tambah berkas (diproses berurutan supaya memori tidak melonjak). */
    add(fileList) {
      const list = Array.from(fileList || []);
      list.forEach((file) => {
        const it = { id: nextId(), file, name: file.name, size: file.size, state: "queued", display: "ANTRE", stage: "Menunggu giliran…", progress: 0, issues: [] };
        items.push(it);
        queue = queue.then(() => process(it));
      });
      emit({ type: "items" });
      queue = queue.then(refreshGate);
      return queue;
    },

    async classify(id, kind) {
      const it = find(id);
      if (!it || it.state !== "needs-classification") return;
      patch(id, { state: "validating", stage: "Menerapkan jenis " + KIND_LABEL[kind] + "…" });
      try { applyOutcome(id, await engine.classify(id, kind)); }
      catch (e) { patch(id, { state: "invalid", display: "INVALID", stage: null, issues: [{ status: "INVALID", severity: "error", code: "CLASSIFY_FAILED", message: e.message }] }); }
      await refreshGate();
    },

    async remove(id) {
      const it = find(id);
      if (!it) return;
      items = items.filter((x) => x.id !== id);
      emit({ type: "items" });
      // berkas yang sudah menempati slot (valid ATAU invalid) dilepas dari mesin
      if (it.kind && it.summary && !items.some((x) => x.kind === it.kind && x.summary)) await engine.remove(it.kind);
      else if (it.state === "needs-classification") await engine.discard(id);
      await refreshGate();
    },

    /** Progres dari mesin (worker) -> status kartu berkas. */
    progress(p) {
      if (!p || !p.id) return;
      const state = p.stage === "reading" ? "reading" : (p.stage === "detected" ? "detected" : "validating");
      patch(p.id, { state, stage: p.detail || null });
    },

    async reset() {
      items = [];
      await engine.reset();
      emit({ type: "items" });
      await refreshGate();
    },

    /** Berkas asli per slot (untuk diunggah ke sesi) + metadata untuk registry run. */
    sources() {
      const out = { files: {}, meta: [] };
      ["scm", "ior", "nike"].forEach((k) => {
        const it = items.find((i) => i.kind === k && i.state === "ready");
        if (!it) return;
        out.files[k] = it.file;
        const s = it.summary || {}, rep = s.report || {};
        out.meta.push({
          file_type: k, file_name: it.name, file_size: it.size, source_hash: it.sha256 || null, sheet_name: s.sheet || null,
          detection_confidence: s.detect ? s.detect.confidence : null, row_count: rep.totalRows || 0, valid_row_count: rep.validRows || 0,
          validation_status: s.severity || null,
          validation_summary: { counts: rep.counts || {}, issues: (it.issues || []).map((i) => ({ code: i.code, severity: i.severity, count: i.count })) }
        });
      });
      return out;
    }
  };
}
