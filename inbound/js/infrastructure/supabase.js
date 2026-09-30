// Akses klien Supabase + konfigurasi. Satu-satunya tempat yang tahu dari mana
// klien berasal; repository lain memanggil getClient().
import { AppError } from "../core/errors.js";

export const CONFIG = Object.assign({
  workspaceId: "default", sessionTool: "rekonsiliasi_inbound", snapshotBucket: "inbound-snapshots",
  usernameDomain: "@rekon.local", appVersion: "3.0.0", appBuild: "dev"
}, (typeof window !== "undefined" && window.GLT_INBOUND_CONFIG) || {});

export function getClient() {
  const c = typeof window !== "undefined" ? window.supa : null;
  if (!c) throw new AppError("Koneksi server belum siap (pustaka Supabase gagal dimuat). Muat ulang halaman.", { code: "NO_CLIENT", retryable: true });
  return c;
}

export function isReady() {
  return !!(typeof window !== "undefined" && window.supa);
}

/** Lempar error Supabase apa adanya (akan dipetakan oleh toAppError di lapisan atas). */
export function unwrap(res) {
  if (res && res.error) throw res.error;
  return res ? res.data : null;
}
