// Helper presentasi case/temuan (murni, tanpa DOM). Tidak mengubah aturan bisnis.
import { C } from "../core/util.js";

export const STATUS_FLOW = ["OPEN", "IN PROGRESS", "CLOSED"];
export const STATUS_META = {
  "OPEN": { tone: "danger", icon: "flag", label: "Open" },
  "IN PROGRESS": { tone: "warning", icon: "clock", label: "In Progress" },
  "CLOSED": { tone: "success", icon: "checkCircle", label: "Closed" }
};
export const ROW_STATUS_META = {
  CLEAR: { tone: "success", icon: "checkCircle", label: "Clear" },
  ABNORMAL: { tone: "danger", icon: "warning", label: "Abnormal" },
  HISTORICAL: { tone: "info", icon: "history", label: "Historical" },
  INFO: { tone: "info", icon: "info", label: "Info" }
};
export const SEVERITY_META = {
  HIGH: { tone: "danger", label: "Tinggi" }, MEDIUM: { tone: "warning", label: "Sedang" },
  LOW: { tone: "info", label: "Rendah" }, NONE: { tone: null, label: "-" }, "-": { tone: null, label: "-" }
};
export const ROLE_LABEL = { operator: "Operator", supervisor: "Supervisor", admin: "Admin", service: "Service" };
export const ROLE_RANK = { operator: 1, supervisor: 2, admin: 3, service: 3 };

export function atLeast(role, min) { return (ROLE_RANK[role] || 0) >= (ROLE_RANK[min] || 0); }

export function displayCaseId(caseId) {
  const p = String(caseId).split("|");
  return (p[1] || "") + "-" + (p[2] || "01");
}

/** "3 hari", "5 jam", "baru saja" */
export function ageLabel(iso, now) {
  if (!iso) return "-";
  const ms = (now || Date.now()) - new Date(iso).getTime();
  if (!isFinite(ms)) return "-";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return m + " menit";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " jam";
  const d = Math.floor(h / 24);
  return d + " hari";
}

export function lastAction(rec) {
  const a = rec && Array.isArray(rec.audit) && rec.audit.length ? rec.audit[rec.audit.length - 1] : null;
  return a ? { what: a.what, by: a.by, at: a.at } : null;
}

export function periodLabel(periodKey) {
  const m = /^(\d{4})-(\d\d)-(\d\d)_(\d{4})-(\d\d)-(\d\d)$/.exec(periodKey || "");
  if (!m) return periodKey || "";
  const a = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), b = new Date(Date.UTC(+m[4], +m[5] - 1, +m[6]));
  return C.fmtDateRange(a, b);
}

/** Nada badge untuk label temuan baris (ISSUE). */
export function rowTone(r) {
  if (r.ROW_STATUS === "CLEAR") return ROW_STATUS_META.CLEAR;
  if (r.ROW_STATUS === "HISTORICAL") return ROW_STATUS_META.HISTORICAL;
  if (r.ROW_STATUS === "ABNORMAL") return ROW_STATUS_META.ABNORMAL;
  return ROW_STATUS_META.INFO;
}

/** Ringkas perubahan event audit server jadi kalimat pendek. */
const FIELD_LABEL = {
  status: "Status", remark: "Remark", pic: "PIC", case_type: "Jenis case", action_taken: "Tindakan", qty_adj: "Penyesuaian QTY",
  cbm_adj: "Penyesuaian CBM", qty_adj_note: "Ket. penyesuaian QTY", cbm_adj_note: "Ket. penyesuaian CBM", qty_expected: "Qty diharapkan",
  qty_actual: "Qty aktual", qty_difference: "Selisih qty", closed_at: "Ditutup", closed_by: "Ditutup oleh", deleted_at: "Dihapus",
  delete_reason: "Alasan hapus", severity: "Severity", issue_type: "Jenis temuan", period_key: "Periode", run_id: "Run"
};
export const ACTION_LABEL = {
  CREATE: "Case dibuat", UPDATE: "Case diperbarui", STATUS_CHANGE: "Status diubah", CLOSE: "Case ditutup", REOPEN: "Case dibuka lagi",
  SOFT_DELETE: "Case dihapus", RESTORE: "Case dipulihkan", BULK_SOFT_DELETE: "Dihapus massal", SYSTEM_REEVALUATE: "Evaluasi ulang otomatis",
  IMPORT_RESTORE: "Dipulihkan dari cadangan", FORCE_OVERWRITE: "Ditimpa (supervisor)"
};
export function describeEvent(ev) {
  const parts = [];
  (ev.changed_fields || []).forEach((f) => {
    if (f === "updated_at" || f === "closed_at" || f === "closed_by") return;
    const o = ev.old_values ? ev.old_values[f] : undefined, n = ev.new_values ? ev.new_values[f] : undefined;
    const fmt = (v) => (v === null || v === undefined || v === "" ? "–" : (typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : String(v)));
    parts.push((FIELD_LABEL[f] || f) + ": " + fmt(o) + " → " + fmt(n));
  });
  return parts;
}
