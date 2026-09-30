// Repository case Inbound. UI & service tidak pernah menyusun query sendiri.
import { getClient, CONFIG, unwrap } from "./supabase.js";

/** Record store (camelCase, bentuk APP.cases lama) -> baris tabel inbound_cases. */
export function caseToRow(rec, extra) {
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  return Object.assign({
    id: rec.id, brand: rec.brand, nopen: rec.nopen, case_type: rec.caseType || "OTHER",
    issue_type: rec.issueType || "", severity: rec.severity || "", pic: rec.pic || "", status: rec.status || "OPEN",
    remark: rec.remark || "", action_taken: rec.actionTaken || "",
    qty_adj: Number(rec.qtyAdj) || 0, cbm_adj: Number(rec.cbmAdj) || 0,
    qty_adj_note: rec.qtyAdjNote || "", cbm_adj_note: rec.cbmAdjNote || "",
    qty_expected: num(rec.qtyExpected), qty_actual: num(rec.qtyActual), qty_difference: num(rec.qtyDifference),
    created_at: rec.createdAt || new Date().toISOString(), updated_at: rec.updatedAt || new Date().toISOString(),
    closed_at: rec.closedAt || null, closed_by: rec.closedBy || "",
    audit: Array.isArray(rec.audit) ? rec.audit : [],
    workspace_id: CONFIG.workspaceId
  }, extra || {});
}

/** Baris tabel -> record store (sama dengan pemetaan pullCasesFromSupabase lama). */
export function rowToCase(r) {
  return {
    id: r.id, brand: r.brand, nopen: r.nopen, caseType: r.case_type, issueType: r.issue_type, severity: r.severity,
    pic: r.pic, status: r.status, remark: r.remark, actionTaken: r.action_taken,
    qtyAdj: r.qty_adj, cbmAdj: r.cbm_adj, qtyAdjNote: r.qty_adj_note, cbmAdjNote: r.cbm_adj_note,
    qtyExpected: r.qty_expected, qtyActual: r.qty_actual, qtyDifference: r.qty_difference,
    createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at, closedBy: r.closed_by,
    audit: Array.isArray(r.audit) ? r.audit : []
  };
}

/** Metadata server yang tidak disimpan di record store lama. */
export function rowMeta(r) {
  return {
    version: r.version || 1, periodKey: r.period_key || null, runId: r.run_id || null,
    createdByName: r.created_by_name || "", lastUpdatedByName: r.user_name || "",
    deletedAt: r.deleted_at || null, deletedByName: r.deleted_by_name || ""
  };
}

const PAGE = 1000;
async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await build().range(from, from + PAGE - 1));
    out.push(...(rows || []));
    if (!rows || rows.length < PAGE) break;
  }
  return out;
}

export const CaseRepository = {
  /** Case aktif (belum dihapus) satu workspace. */
  async fetchActive() {
    return selectAll(() => getClient().from("inbound_cases").select("*")
      .eq("workspace_id", CONFIG.workspaceId).is("deleted_at", null).order("id"));
  },
  /** Semua case termasuk yang sudah dihapus — untuk sheet riwayat di export. */
  async fetchAllIncludingDeleted() {
    return selectAll(() => getClient().from("inbound_cases").select("*")
      .eq("workspace_id", CONFIG.workspaceId).order("id"));
  },
  async fetchOne(id) {
    return unwrap(await getClient().from("inbound_cases").select("*").eq("id", id).maybeSingle());
  },
  /**
   * Simpan dengan optimistic concurrency (RPC inbound_case_save).
   * @returns {{status:'ok'|'conflict'|'deleted'|'id_conflict'|'not_found', row?, current?}}
   */
  async save(row, expectedVersion, action, force) {
    return unwrap(await getClient().rpc("inbound_case_save", {
      p_case: row, p_expected_version: expectedVersion === undefined ? null : expectedVersion,
      p_action: action || null, p_force: !!force
    }));
  },
  async softDelete(id, expectedVersion, reason) {
    return unwrap(await getClient().rpc("inbound_case_soft_delete", { p_id: id, p_expected_version: expectedVersion, p_reason: reason || null }));
  },
  async restore(id) {
    return unwrap(await getClient().rpc("inbound_case_restore", { p_id: id }));
  },
  async softDeleteAll(confirmText, reason) {
    return unwrap(await getClient().rpc("inbound_cases_soft_delete_all", { p_workspace: CONFIG.workspaceId, p_confirm: confirmText, p_reason: reason || null }));
  },
  async importCase(row, expectedVersion) {
    return unwrap(await getClient().rpc("inbound_case_import", { p_case: row, p_expected_version: expectedVersion === undefined ? null : expectedVersion }));
  },
  /** Realtime perubahan case (semua pengguna). Mengembalikan fungsi unsubscribe. */
  subscribe(onChange, onStatus) {
    const client = getClient();
    const channel = client.channel("inbound-cases-" + CONFIG.workspaceId + "-" + Math.random().toString(36).slice(2, 8))
      .on("postgres_changes", { event: "*", schema: "public", table: "inbound_cases" }, (payload) => onChange(payload))
      .subscribe((status) => { if (onStatus) onStatus(status); });
    return () => { try { client.removeChannel(channel); } catch (e) { /* sudah dilepas */ } };
  }
};

export const CaseEventRepository = {
  /** Timeline audit immutable semua case pada 1 NOPEN. */
  async fetchForNopen(brand, nopen) {
    return unwrap(await getClient().from("inbound_case_events").select("*")
      .eq("workspace_id", CONFIG.workspaceId).eq("brand", brand).eq("nopen", nopen)
      .order("created_at", { ascending: true }).limit(500));
  }
};
