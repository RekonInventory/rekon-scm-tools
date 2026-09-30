// Persistensi sesi kolaborasi (tabel inbound_sessions) + snapshot di Storage.
// Format kolom & path storage SAMA dengan versi lama supaya owner/follower lama
// dan baru bisa saling membuka sesi selama masa transisi.
import { getClient, CONFIG, unwrap } from "./supabase.js";

export const INLINE_SNAPSHOT_LIMIT = 3 * 1024 * 1024; // <= 3MB disimpan inline (jsonb), selebihnya di Storage

export const SessionRepository = {
  async getActive() {
    return unwrap(await getClient().from("inbound_sessions").select("*")
      .eq("workspace_id", CONFIG.workspaceId).eq("tool_name", CONFIG.sessionTool)
      .eq("status", "ACTIVE").order("last_activity_at", { ascending: false }).limit(1).maybeSingle());
  },
  async fetch(id) {
    return unwrap(await getClient().from("inbound_sessions").select("*").eq("id", id).maybeSingle());
  },
  /** Tutup semua sesi ACTIVE lain (server hanya mengizinkan 1 ACTIVE per workspace+tool). */
  async closeOthers(exceptId) {
    let q = getClient().from("inbound_sessions").update({ status: "CLOSED", updated_at: new Date().toISOString() })
      .eq("workspace_id", CONFIG.workspaceId).eq("tool_name", CONFIG.sessionTool).eq("status", "ACTIVE");
    if (exceptId) q = q.neq("id", exceptId);
    return unwrap(await q);
  },
  async insert(row) {
    return unwrap(await getClient().from("inbound_sessions").insert(row).select().single());
  },
  async update(id, patch) {
    return unwrap(await getClient().from("inbound_sessions").update(patch).eq("id", id).select().single());
  },
  /** Update tanpa menunggu baris balik (heartbeat, view_state). */
  async touch(id, patch) {
    return unwrap(await getClient().from("inbound_sessions").update(patch).eq("id", id));
  },
  async takeover(id, expectedVersion, audit) {
    return unwrap(await getClient().rpc("inbound_session_takeover", { p_id: id, p_expected_version: expectedVersion, p_audit: audit || null }));
  },
  async close(id) {
    return unwrap(await getClient().rpc("inbound_session_close", { p_id: id }));
  }
};

export const SnapshotStore = {
  async uploadJson(path, json) {
    const blob = new Blob([json], { type: "application/json" });
    return unwrap(await getClient().storage.from(CONFIG.snapshotBucket).upload(path, blob, { upsert: true, contentType: "application/json" }));
  },
  async downloadText(path) {
    const data = unwrap(await getClient().storage.from(CONFIG.snapshotBucket).download(path));
    return data.text();
  },
  async uploadFile(path, file) {
    return unwrap(await getClient().storage.from(CONFIG.snapshotBucket).upload(path, file, { upsert: true }));
  },
  async downloadBlob(path) {
    return unwrap(await getClient().storage.from(CONFIG.snapshotBucket).download(path));
  },
  snapshotPath(sessionId) { return CONFIG.workspaceId + "/" + sessionId + ".json"; },
  sourcePath(sessionId, kind, name) { return CONFIG.workspaceId + "/" + sessionId + "/sources/" + kind + "-" + name; }
};
