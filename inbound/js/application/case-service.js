// Application service untuk case: satu jalur eksplisit
//   validasi -> hitung perubahan & audit (logika verbatim APP.cases.save)
//   -> persist ke server dengan optimistic concurrency -> terapkan versi server
//   -> beri tahu UI.
// Menggantikan pola monkey patch versi lama (APP.cases.save dibungkus dari luar).
// Sumber kebenaran = Supabase. localStorage hanya cache supaya daftar case bisa
// tampil sebelum data server selesai dimuat.
import { C } from "../core/util.js";
import { createCaseStore } from "../domain/case-store.js";
import { CaseRepository, CaseEventRepository, caseToRow, rowToCase, rowMeta } from "../infrastructure/case-repository.js";
import { ConflictError, AppError, toAppError } from "../core/errors.js";
import { log } from "../core/logger.js";

const CACHE_PREFIX = "glt.inbound.v3:";
function cacheStorage() {
  let ok = true;
  try { const k = CACHE_PREFIX + "probe"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k); } catch (e) { ok = false; }
  return {
    available: () => ok,
    get: (k) => { if (!ok) return null; try { return window.localStorage.getItem(CACHE_PREFIX + k); } catch (e) { return null; } },
    set: (k, v) => {
      if (!ok) return { ok: false, reason: "storage-unavailable" };
      try { window.localStorage.setItem(CACHE_PREFIX + k, v); return { ok: true }; }
      catch (e) { return { ok: false, reason: (e && e.name === "QuotaExceededError") ? "quota" : "error" }; }
    },
    remove: (k) => { try { window.localStorage.removeItem(CACHE_PREFIX + k); } catch (e) { /* abaikan */ } }
  };
}

const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

export function createCaseService(deps) {
  const onChange = deps.onChange || function () {};
  const store = createCaseStore(Object.assign({}, C, { storage: cacheStorage() }));
  store.load();                       // isi awal dari cache lokal (bukan sumber kebenaran)
  const meta = new Map();             // id -> {version, periodKey, runId, createdByName, lastUpdatedByName}
  let context = { periodKey: null, runId: null };
  let loaded = false;
  let unsubscribe = null;

  // Tulis record ke store lewat importJSON (API publik store verbatim, memakai sanitize()
  // yang sama). Record lama dihapus dulu supaya aturan "yang lebih baru menang" tidak
  // menolak versi server yang kebetulan ber-updatedAt lebih lama dari cache lokal.
  function importAll(obj) {
    if (Object.keys(obj).length) store.importJSON(JSON.stringify({ cases: obj }));
  }
  function put(rec, m) {
    delete store.all()[rec.id];
    const obj = {}; obj[rec.id] = rec;
    importAll(obj);
    if (m) meta.set(rec.id, m);
  }
  function drop(id) {
    if (store.get(id)) store.remove(id);
    meta.delete(id);
  }
  function applyRow(row) {
    if (!row) return;
    if (row.deleted_at) { drop(row.id); return; }
    put(rowToCase(row), rowMeta(row));
  }

  function conflictMessage(cur) {
    const who = (cur && cur.user_name) || "pengguna lain";
    const when = cur && cur.updated_at ? C.fmtStamp(cur.updated_at) : "";
    return "Case ini sudah diubah oleh " + who + (when ? " (" + when + ")" : "") + " sejak Anda membukanya.";
  }

  /** Simpan ke server; untuk case baru, ulangi dengan id berikutnya bila id sudah terpakai. */
  async function persist(caseId, isNew, opts) {
    opts = opts || {};
    let rec = store.get(caseId);
    if (isNew) {
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const out = await CaseRepository.save(caseToRow(rec, { period_key: context.periodKey, run_id: context.runId }), null, opts.action || null, false);
          if (out.status === "ok") { applyRow(out.row); return out.row; }
          if (out.status !== "id_conflict") throw new AppError("Case baru gagal dibuat (" + out.status + ").", { code: "SAVE_FAILED", retryable: true });
          const nextId = store.bumpCaseId(caseId);
          const moved = store.rekey(caseId, nextId);
          if (!moved) break;
          log.info("case:id-bump", { from: caseId, to: nextId });
          caseId = nextId; rec = moved;
        }
        throw new AppError("Gagal membuat case baru setelah beberapa kali percobaan (nomor case bentrok).", { code: "ID_EXHAUSTED", retryable: true });
      } catch (e) {
        drop(caseId);            // case baru yang gagal tersimpan tidak boleh tertinggal di cache
        throw e;
      }
    }
    const m = meta.get(caseId);
    // Versi pembanding = versi saat user MULAI mengedit (dikirim editor), bukan versi cache
    // terbaru — cache bisa sudah diperbarui realtime oleh perubahan orang lain, dan memakai
    // versi itu justru akan menimpa perubahan mereka tanpa terdeteksi.
    const expected = opts.expectedVersion !== undefined && opts.expectedVersion !== null ? opts.expectedVersion : (m ? m.version : 1);
    const out = await CaseRepository.save(caseToRow(rec), expected, opts.action || null, !!opts.force);
    if (out.status === "ok") { applyRow(out.row); return out.row; }
    if (out.status === "conflict") throw new ConflictError(conflictMessage(out.current), out.current);
    if (out.status === "deleted") {
      throw new AppError("Case ini sudah dihapus oleh " + ((out.current && out.current.deleted_by_name) || "pengguna lain") + ". Perubahan tidak disimpan.", { code: "DELETED" });
    }
    throw new AppError("Case tidak ditemukan di server.", { code: "NOT_FOUND" });
  }

  return {
    store,
    meta: (id) => meta.get(id) || null,
    isLoaded: () => loaded,
    setContext(ctx) { context = Object.assign({}, context, ctx); },

    async load() {
      const rows = await CaseRepository.fetchActive();
      store.snapshotAndClear();
      meta.clear();
      const obj = {};
      rows.forEach((r) => { obj[r.id] = rowToCase(r); meta.set(r.id, rowMeta(r)); });
      importAll(obj);
      loaded = true;
      onChange({ type: "reload", count: rows.length });
      return rows.length;
    },

    subscribe(onStatus) {
      if (unsubscribe) return;
      unsubscribe = CaseRepository.subscribe((payload) => {
        const row = payload.new && payload.new.id ? payload.new : null;
        if (payload.eventType === "DELETE") { drop(payload.old && payload.old.id); onChange({ type: "remote", id: payload.old && payload.old.id }); return; }
        if (!row) return;
        const m = meta.get(row.id);
        if (m && (row.version || 0) < m.version) return;   // event lama yang datang terlambat
        applyRow(row);
        onChange({ type: "remote", id: row.id, row });
      }, onStatus);
    },
    unsubscribe() { if (unsubscribe) { unsubscribe(); unsubscribe = null; } },

    /**
     * Simpan dari form (setara saveCase() lama).
     * @param {{caseId?, brand, nopen, fields, context, expectedVersion?, force?}} input
     *   expectedVersion = versi case saat editor dibuka (optimistic concurrency).
     * @returns {{status:'saved'|'unchanged'|'empty', id?}}
     */
    async save(input) {
      const isNew = !input.caseId;
      const caseId = input.caseId || store.nextCaseId(input.brand, input.nopen);
      const m0 = meta.get(caseId);
      if (!isNew && !input.force && input.expectedVersion && m0 && m0.version !== input.expectedVersion) {
        // sudah ketahuan basi dari realtime -> tidak perlu memanggil server
        const cur = await CaseRepository.fetchOne(caseId).catch(() => null);
        if (cur) applyRow(cur);
        onChange({ type: "conflict", id: caseId });
        throw new ConflictError(conflictMessage(cur), cur);
      }
      const prev = clone(store.get(caseId)), prevMeta = meta.get(caseId) || null;
      const res = store.save(caseId, input.brand, input.nopen, input.fields, input.context);
      if (res && res.removed) return { status: "empty" };
      if (res && res.unchanged) return { status: "unchanged", id: caseId };
      try {
        const row = await persist(caseId, isNew, { force: input.force, expectedVersion: input.expectedVersion });
        onChange({ type: "saved", id: row.id });
        return { status: "saved", id: row.id, row };
      } catch (e) {
        // kembalikan cache ke kondisi sebelum disimpan — server tetap sumber kebenaran
        if (prev) put(prev, prevMeta); else drop(caseId);
        if (e instanceof ConflictError && e.current) {
          if (e.current.deleted_at) drop(e.current.id); else applyRow(e.current);
          onChange({ type: "conflict", id: caseId });
        }
        throw e instanceof AppError ? e : toAppError(e, "menyimpan case");
      }
    },

    /** Persist perubahan hasil re-evaluasi qty otomatis (daftar niat berurutan). */
    async persistIntents(intents) {
      const order = [], isNew = new Map();
      intents.forEach((i) => { if (!isNew.has(i.id)) order.push(i.id); isNew.set(i.id, (isNew.get(i.id) || false) || i.isNew); });
      const failed = [];
      for (const id of order) {
        if (!store.get(id)) continue;
        try { await persist(id, isNew.get(id), { action: "SYSTEM_REEVALUATE" }); }
        catch (e) {
          failed.push({ id, message: e.userMessage || e.message });
          log.warn("case:reevaluate-persist-failed", { id, code: e.code });
          try { const fresh = await CaseRepository.fetchOne(id); if (fresh) applyRow(fresh); else drop(id); } catch (x) { /* biarkan */ }
        }
      }
      if (order.length) onChange({ type: "reevaluated", count: order.length, failed: failed.length });
      return { total: order.length, failed };
    },

    async remove(caseId, reason) {
      const m = meta.get(caseId);
      const out = await CaseRepository.softDelete(caseId, m ? m.version : 1, reason);
      if (out.status === "ok" || out.status === "deleted" || out.status === "not_found") {
        drop(caseId);
        onChange({ type: "deleted", id: caseId });
        return out.status;
      }
      if (out.current) applyRow(out.current);
      onChange({ type: "conflict", id: caseId });
      throw new ConflictError(conflictMessage(out.current) + " Muat ulang lalu coba hapus lagi.", out.current);
    },

    async restore(caseId) {
      const out = await CaseRepository.restore(caseId);
      if (out.status === "ok") { applyRow(out.row); onChange({ type: "restored", id: caseId }); }
      return out.status;
    },

    async deleteAll(confirmText, reason) {
      const n = await CaseRepository.softDeleteAll(confirmText, reason);
      store.snapshotAndClear();
      meta.clear();
      onChange({ type: "reload", count: 0 });
      return n;
    },

    /** Reload 1 case dari server (dipakai pilihan "Muat versi terbaru" saat konflik). */
    async reloadOne(caseId) {
      const row = await CaseRepository.fetchOne(caseId);
      if (row) applyRow(row); else drop(caseId);
      onChange({ type: "reload-one", id: caseId });
      return row;
    },

    fetchHistoryRows: () => CaseRepository.fetchAllIncludingDeleted(),
    fetchTimeline: (brand, nopen) => CaseEventRepository.fetchForNopen(brand, nopen)
  };
}
