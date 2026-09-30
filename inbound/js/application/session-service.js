// Collaborative Shared Session — dipecah jadi bagian yang jelas:
//   state sesi (row, role, followMode)      -> di sini
//   transport realtime (presence/broadcast) -> infrastructure/realtime-transport.js
//   persistensi baris sesi & snapshot       -> infrastructure/session-repository.js
//   encode/decode snapshot                  -> domain/snapshot-codec.js (verbatim, kompatibel versi lama)
//   sinkronisasi tampilan                   -> broadcastView() (debounce) di sini
// Aturan otorisasi (siapa boleh takeover/close/ubah) ditegakkan server (trigger + RPC).
import { SessionRepository, SnapshotStore, INLINE_SNAPSHOT_LIMIT } from "../infrastructure/session-repository.js";
import { createRealtimeTransport } from "../infrastructure/realtime-transport.js";
import { snapEncode, snapDecode } from "../domain/snapshot-codec.js";
import { CONFIG } from "../infrastructure/supabase.js";
import { AppError } from "../core/errors.js";
import { log } from "../core/logger.js";

export const SESSION_STALE_MS = 2 * 60 * 1000;   // sama dengan versi lama & aturan server
const HEARTBEAT_MS = 45 * 1000;
const LAST_JOIN_KEY = "rekon_inbound_last_session_id";   // cache saja (bukan sumber kebenaran)

function remember(id) { try { if (id) localStorage.setItem(LAST_JOIN_KEY, id); else localStorage.removeItem(LAST_JOIN_KEY); } catch (e) { /* mode privat */ } }
function remembered() { try { return localStorage.getItem(LAST_JOIN_KEY); } catch (e) { return null; } }

export function createSessionService(deps) {
  const identity = deps.identity;          // () => {user_id, name}
  const emit = deps.onEvent || function () {};
  let current = null, role = null, followMode = "data", presence = {}, heartbeat = null, viewTimer = null, pendingView = null;
  let connection = "idle";

  const transport = createRealtimeTransport({
    onStatus: (s) => { connection = s; emit({ type: "connection", status: s }); },
    onPresence: (state) => { presence = state || {}; emit({ type: "presence", presence }); },
    onRow: (row) => {
      if (!row || !current || row.id !== current.id) return;
      current = row;
      emit({ type: "row", row });
      if (row.status === "CLOSED" && role === "FOLLOWER") { emit({ type: "closed", by: row.closed_by }); leave(); }
    },
    onBroadcast: (p) => emit({ type: "broadcast", payload: p }),
    // Setelah tersambung ulang, ambil baris terbaru — mungkin ada DATA_UPDATED yang terlewat.
    onReconnected: async () => {
      if (!current) return;
      try {
        const fresh = await SessionRepository.fetch(current.id);
        if (!fresh) return;
        const missed = fresh.version !== current.version;
        current = fresh;
        emit({ type: "row", row: fresh });
        if (missed && role === "FOLLOWER") emit({ type: "broadcast", payload: { type: "DATA_UPDATED", sessionId: fresh.id, version: fresh.version, resync: true } });
      } catch (e) { log.warn("session:resync-failed", { message: e && e.message }); }
    }
  });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(async () => {
      if (!current || role !== "OWNER") return;
      try { await SessionRepository.touch(current.id, { last_activity_at: new Date().toISOString() }); }
      catch (e) { log.warn("session:heartbeat-failed", { message: e && e.message }); }
    }, HEARTBEAT_MS);
  }
  function stopHeartbeat() { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } }

  function attach(row, r) {
    transport.disconnect();
    current = row; role = r; followMode = "data"; presence = {};
    remember(row.id);
    transport.connect(row.id, identity(), r);
    startHeartbeat();
    emit({ type: "state" });
  }

  function leave() {
    transport.disconnect();
    stopHeartbeat();
    clearTimeout(viewTimer);
    current = null; role = null; presence = {};
    remember(null);
    emit({ type: "state" });
  }

  function isStale(row) {
    const s = row || current;
    if (!s) return false;
    return (Date.now() - new Date(s.last_activity_at).getTime()) > SESSION_STALE_MS;
  }

  async function uploadSources(sessionId, filesMap) {
    const out = {}, failed = [];
    for (const k of ["scm", "ior", "nike"]) {
      const f = filesMap && filesMap[k];
      if (!f) continue;
      const path = SnapshotStore.sourcePath(sessionId, k, f.name);
      try { await SnapshotStore.uploadFile(path, f); out[k] = { path, name: f.name }; }
      catch (e) { failed.push(k); log.error("session:source-upload-failed", { kind: k, message: e && e.message }); }
    }
    return { uploaded: Object.keys(out).length ? out : null, failed };
  }

  return {
    SESSION_STALE_MS,
    current: () => current,
    role: () => role,
    followMode: () => followMode,
    presence: () => presence,
    connection: () => connection,
    isStale,

    /** Dipanggil setelah login: sesi aktif milik sendiri -> reclaim; pernah diikuti -> join ulang; lainnya -> tawarkan. */
    async checkActive() {
      const s = await SessionRepository.getActive();
      if (!s) return { action: "none" };
      if (s.owner_id === identity().user_id) { attach(s, "OWNER"); return { action: "reclaimed", session: s }; }
      if (remembered() === s.id) { attach(s, "FOLLOWER"); return { action: "rejoined", session: s }; }
      return { action: "found", session: s };
    },

    join(row) { attach(row, "FOLLOWER"); },
    leave,

    /** Simpan hasil rekonsiliasi sebagai snapshot sesi (setara saveSnapshot lama). */
    async saveSnapshot(result, meta) {
      const me = identity();
      const encoded = snapEncode(result);
      const json = JSON.stringify(encoded);
      const now = new Date().toISOString();
      const row = {
        workspace_id: CONFIG.workspaceId, tool_name: CONFIG.sessionTool, status: "ACTIVE",
        owner_id: me.user_id, owner_name: me.name,
        period_key: (meta && meta.periodKey) || null, source_names: (meta && meta.sourceNames) || null,
        run_id: (meta && meta.runId) || null,
        last_activity_at: now, updated_at: now
      };
      const isMine = current && role === "OWNER" && current.owner_id === me.user_id && current.status === "ACTIVE";
      let saved;
      if (isMine) {
        if (json.length <= INLINE_SNAPSHOT_LIMIT) { row.result_data = encoded; row.snapshot_path = null; row.result_path = null; }
        else {
          const path = SnapshotStore.snapshotPath(current.id);
          await SnapshotStore.uploadJson(path, json);
          row.result_data = null; row.snapshot_path = path; row.result_path = path;   // result_path = alias lama, selalu sama
        }
        saved = await SessionRepository.update(current.id, row);
      } else {
        // Hanya boleh 1 sesi ACTIVE: tutup yang lain dulu (diizinkan server untuk non-owner).
        await SessionRepository.closeOthers(null);
        row.audit = [{ at: now, what: "Sesi dibuat", by: me.name }];
        if (json.length <= INLINE_SNAPSHOT_LIMIT) { row.result_data = encoded; row.snapshot_path = null; row.result_path = null; saved = await SessionRepository.insert(row); }
        else {
          saved = await SessionRepository.insert(Object.assign({}, row, { result_data: null }));
          const path = SnapshotStore.snapshotPath(saved.id);
          await SnapshotStore.uploadJson(path, json);
          saved = await SessionRepository.update(saved.id, { snapshot_path: path, result_path: path });
        }
      }
      if (isMine) current = saved;            // sesi yang sama: channel realtime tetap dipakai
      else attach(saved, "OWNER");            // sesi baru: channel lama dilepas, channel baru dibuka
      let warn = null;
      if (meta && meta.sourceFiles) {
        const wanted = Object.keys(meta.sourceFiles).filter((k) => !!meta.sourceFiles[k]);
        const up = await uploadSources(saved.id, meta.sourceFiles);
        if (up.uploaded) {
          try { current = await SessionRepository.update(saved.id, { source_files: up.uploaded }); }
          catch (e) { warn = "Berkas sumber terunggah, tetapi gagal ditautkan ke sesi."; }
        }
        if (up.failed.length || (!up.uploaded && wanted.length)) warn = "Sebagian berkas sumber gagal diunggah (" + (up.failed.join(", ") || wanted.join(", ")) + "); follower tidak bisa mengunduhnya.";
      }
      transport.send("DATA_UPDATED", { sessionId: current.id, version: current.version }, me.name);
      emit({ type: "state" });
      return { session: current, warning: warn };
    },

    /** Muat snapshot dengan pemeriksaan integritas (versi & bentuk data). */
    async loadSnapshot(row, minVersion) {
      let s = row || current;
      if (!s) throw new AppError("Tidak ada sesi.", { code: "NO_SESSION" });
      if (minVersion && s.version < minVersion) {
        // baris yang dibaca lebih lama dari yang diumumkan owner (lag replikasi) — ambil ulang
        for (let i = 0; i < 3 && s.version < minVersion; i++) {
          await new Promise((r) => setTimeout(r, 700));
          s = (await SessionRepository.fetch(s.id)) || s;
        }
      }
      let encoded;
      if (s.result_data) encoded = s.result_data;
      else if (s.snapshot_path || s.result_path) {
        const text = await SnapshotStore.downloadText(s.snapshot_path || s.result_path);
        try { encoded = JSON.parse(text); }
        catch (e) { throw new AppError("Snapshot sesi rusak (JSON tidak valid). Minta owner menjalankan ulang rekonsiliasi.", { code: "SNAPSHOT_CORRUPT" }); }
      } else throw new AppError("Sesi ini belum memiliki hasil (owner belum menjalankan rekonsiliasi).", { code: "SNAPSHOT_EMPTY" });
      const decoded = snapDecode(encoded);
      if (!decoded || typeof decoded !== "object" || (!decoded.adidas && !decoded.nike)) {
        throw new AppError("Snapshot sesi tidak lengkap atau rusak.", { code: "SNAPSHOT_CORRUPT" });
      }
      if (row === current || !row) current = s;
      return decoded;
    },

    async close() {
      if (!current) return;
      const id = current.id, me = identity();
      await SessionRepository.close(id);
      transport.send("SESSION_CLOSED", { sessionId: id }, me.name);
      leave();
    },

    /** Ambil alih dengan optimistic lock — hanya satu dari beberapa follower yang menang. */
    async takeover() {
      if (!current) return null;
      const me = identity();
      const audit = (current.audit || []).concat([{ at: new Date().toISOString(), from: current.owner_name || "", to: me.name,
        what: "Ambil alih sesi (owner tidak aktif > " + Math.round(SESSION_STALE_MS / 60000) + " menit)" }]).slice(-200);
      const out = await SessionRepository.takeover(current.id, current.version, audit);
      if (out.status !== "ok") {
        if (out.current) { current = out.current; emit({ type: "row", row: current }); }
        throw new AppError("Sesi sudah diambil alih atau diperbarui orang lain. Tampilan sesi dimuat ulang.", { code: "TAKEOVER_CONFLICT" });
      }
      current = out.row; role = "OWNER"; followMode = "data";
      await transport.retrack("OWNER");
      startHeartbeat();
      transport.send("SESSION_UPDATED", { sessionId: current.id, takeover: true }, me.name);
      emit({ type: "state" });
      return current;
    },

    setFollowMode(m) { followMode = m === "view" ? "view" : "data"; emit({ type: "state" }); },

    async pullLatest() {
      if (!current) return null;
      const fresh = await SessionRepository.fetch(current.id);
      if (fresh) { current = fresh; emit({ type: "row", row: fresh }); }
      return current;
    },

    /** Owner: siarkan tampilan (debounce) + simpan view_state untuk follower yang baru bergabung. */
    broadcastView(view) {
      if (role !== "OWNER" || !current) return;
      pendingView = JSON.parse(JSON.stringify(view));
      clearTimeout(viewTimer);
      viewTimer = setTimeout(() => {
        const v = pendingView;
        transport.send("VIEW_CHANGED", { view: v }, identity().name);
        if (current) {
          current.view_state = v;
          SessionRepository.touch(current.id, { view_state: v }).catch((e) => log.warn("session:view-state-failed", { message: e && e.message }));
        }
      }, 150);
    },
    broadcastCaseOpened(brand, nopen) {
      if (role !== "OWNER") return;
      transport.send("CASE_OPENED", { brand, nopen }, identity().name);
    },

    async downloadSource(kind) {
      const info = current && current.source_files && current.source_files[kind];
      if (!info) throw new AppError("Berkas sumber tidak tersedia untuk sesi ini.", { code: "NO_SOURCE" });
      const blob = await SnapshotStore.downloadBlob(info.path);
      return { blob, name: info.name || (kind + ".xlsx") };
    }
  };
}
