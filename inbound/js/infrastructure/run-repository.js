// Registry run rekonsiliasi (inbound_runs + inbound_run_files) dan log aktivitas
// operasional immutable (inbound_activity_events).
import { getClient, CONFIG, unwrap } from "./supabase.js";

export const RunRepository = {
  /** Catat 1 run beserta metadata berkasnya (bukan isi berkas). */
  async create(run, files) {
    const client = getClient();
    const row = unwrap(await client.from("inbound_runs").insert(Object.assign({ workspace_id: CONFIG.workspaceId }, run)).select().single());
    if (files && files.length) {
      unwrap(await client.from("inbound_run_files").insert(files.map((f) => Object.assign({ run_id: row.id }, f))));
    }
    return row;
  },
  async recent(limit) {
    return unwrap(await getClient().from("inbound_runs").select("id, period_key, period_start, period_end, status, summary, created_by_name, created_at, inbound_run_files(file_type, file_name, validation_status, row_count)")
      .eq("workspace_id", CONFIG.workspaceId).order("created_at", { ascending: false }).limit(limit || 10));
  }
};

export const ActivityRepository = {
  /** Fire-and-forget: kegagalan mencatat aktivitas tidak boleh mengganggu pekerjaan user. */
  async record(event, detail) {
    try {
      const res = await getClient().from("inbound_activity_events").insert({ workspace_id: CONFIG.workspaceId, event, detail: detail || null });
      return !res.error;
    } catch (e) { return false; }
  },
  async recent(limit) {
    return unwrap(await getClient().from("inbound_activity_events").select("*")
      .eq("workspace_id", CONFIG.workspaceId).order("created_at", { ascending: false }).limit(limit || 50));
  }
};
