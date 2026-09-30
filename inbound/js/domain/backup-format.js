// Format cadangan case berversi + parser yang juga menerima format lama.
//
// Format baru (schemaVersion 3):
//   { schemaVersion, appVersion, exportedAt, exportedBy, workspace, period,
//     data: { cases: {<id>: record}, meta: {<id>: {version, periodKey}} },
//     app, versi, cases }   <- 3 kunci terakhir = alias kompatibilitas supaya
//                              "Pulihkan Case" di versi lama tetap bisa membacanya.
// Format lama yang diterima: {app, versi:2, cases} dan {versi:3, tipe:"AUTO_BACKUP_...", cases}.
import { C } from "../core/util.js";
import { createCaseStore } from "./case-store.js";

export const BACKUP_SCHEMA_VERSION = 3;

const BUSINESS_FIELDS = ["caseType", "status", "pic", "remark", "actionTaken", "qtyAdj", "cbmAdj", "qtyAdjNote", "cbmAdjNote",
  "qtyExpected", "qtyActual", "qtyDifference", "closedBy"];

export function buildBackup(opts) {
  const cases = JSON.parse(JSON.stringify(opts.cases || {}));
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: opts.appVersion || "",
    exportedAt: new Date().toISOString(),
    exportedBy: opts.exportedBy || "",
    workspace: opts.workspace || "default",
    period: opts.period || null,
    data: { cases, meta: opts.meta || {} },
    app: "Rekonsiliasi Inbound", versi: 2, cases
  };
}

function memStore() {
  const m = new Map();
  return Object.assign({}, C, { storage: { available: () => true, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return { ok: true }; }, remove: (k) => m.delete(k) } });
}

/**
 * Validasi + sanitasi isi berkas cadangan (tidak menyentuh data mana pun).
 * @returns {{ok:boolean, error?:string, format:string, header:object, cases:object, count:number, skipped:number}}
 */
export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(String(text || "").replace(/^﻿/, "")); } catch (e) { return { ok: false, error: "Berkas bukan JSON yang valid." }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Struktur berkas cadangan tidak dikenali." };
  let format, source, header;
  if (raw.schemaVersion === BACKUP_SCHEMA_VERSION && raw.data && typeof raw.data.cases === "object") {
    format = "v3"; source = raw.data.cases;
    header = { exportedAt: raw.exportedAt, exportedBy: raw.exportedBy, workspace: raw.workspace, period: raw.period, appVersion: raw.appVersion };
  } else if (raw.schemaVersion && raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: "Berkas dibuat oleh versi aplikasi yang lebih baru (schemaVersion " + raw.schemaVersion + ")." };
  } else if (raw.cases && typeof raw.cases === "object") {
    format = raw.tipe ? "legacy-autobackup" : "legacy-v2"; source = raw.cases;
    header = { exportedAt: raw.dibuat || raw.dicadangkan || null, exportedBy: raw.oleh || "", workspace: "default", period: raw.periode || null };
  } else {
    return { ok: false, error: "Berkas tidak berisi data case." };
  }
  // Sanitasi memakai logika case store verbatim (tolak __proto__, potong panjang teks, status valid).
  const tmp = createCaseStore(memStore());
  tmp.load();
  const res = tmp.importJSON(JSON.stringify({ cases: source }));
  if (res.error) return { ok: false, error: res.error };
  const cases = JSON.parse(JSON.stringify(tmp.all()));
  return { ok: true, format, header, cases, count: Object.keys(cases).length, skipped: res.skipped || 0 };
}

function sameBusiness(a, b) {
  return BUSINESS_FIELDS.every((f) => JSON.stringify(a[f] === undefined ? null : a[f]) === JSON.stringify(b[f] === undefined ? null : b[f]));
}

/**
 * Bandingkan isi cadangan dengan data server saat ini.
 * kind: 'new' (belum ada/aktif di server), 'identical', 'incoming-newer', 'incoming-older'
 */
export function diffBackup(incoming, current) {
  const items = [];
  Object.keys(incoming).sort().forEach((id) => {
    const inc = incoming[id], cur = current[id];
    let kind;
    if (!cur) kind = "new";
    else if (sameBusiness(inc, cur)) kind = "identical";
    else kind = (inc.updatedAt || "") > (cur.updatedAt || "") ? "incoming-newer" : "incoming-older";
    items.push({ id, kind, incoming: inc, current: cur || null, defaultApply: kind === "new" || kind === "incoming-newer" });
  });
  const counts = items.reduce((m, i) => { m[i.kind] = (m[i.kind] || 0) + 1; return m; }, {});
  return { items, counts };
}
