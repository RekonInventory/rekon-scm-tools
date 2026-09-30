// Penanganan error terpusat: setiap error diubah menjadi AppError yang punya
// (1) pesan yang bisa dipahami user, (2) konteks teknis untuk log, (3) info
// apakah bisa dicoba ulang. Pesan mentah Supabase tidak ditampilkan ke user
// kecuali memang informatif (mis. pesan aturan bisnis dari trigger server).
import { log } from "./logger.js";

export class AppError extends Error {
  constructor(userMessage, opts) {
    super(userMessage);
    opts = opts || {};
    this.name = "AppError";
    this.userMessage = userMessage;
    this.code = opts.code || "UNKNOWN";
    this.retryable = !!opts.retryable;
    this.technical = opts.technical || null;
    this.details = opts.details || null;
  }
}

export class ConflictError extends AppError {
  constructor(userMessage, current, opts) {
    super(userMessage, Object.assign({ code: "CONFLICT" }, opts));
    this.name = "ConflictError";
    this.current = current;   // data terbaru di server
  }
}

function isNetwork(err) {
  const m = String((err && (err.message || err)) || "");
  return /Failed to fetch|NetworkError|network|fetch failed|Load failed|ERR_INTERNET|timeout/i.test(m);
}

/**
 * Ubah error apa pun (Supabase/PostgREST/JS) menjadi AppError.
 * @param {string} action  kalimat aksi untuk pesan, mis. "menyimpan case"
 */
export function toAppError(err, action) {
  if (err instanceof AppError) return err;
  const technical = {
    message: err && err.message, code: err && err.code, details: err && err.details, hint: err && err.hint,
    status: err && err.status, name: err && err.name
  };
  const what = action ? "Gagal " + action + ". " : "";
  if (isNetwork(err)) {
    return new AppError(what + "Koneksi ke server terputus. Periksa jaringan lalu coba lagi.", { code: "NETWORK", retryable: true, technical });
  }
  const code = err && err.code;
  if (code === "42501" || (err && err.status === 403)) {
    // Pesan dari trigger/RPC server sudah ditulis untuk user (Bahasa Indonesia) — tampilkan.
    const msg = err.message && !/permission denied|row-level security/i.test(err.message) ? err.message
      : "Anda tidak memiliki izin untuk tindakan ini.";
    return new AppError(what + msg, { code: "FORBIDDEN", technical });
  }
  if (code === "PGRST301" || (err && err.status === 401) || /JWT|expired/i.test((err && err.message) || "")) {
    return new AppError(what + "Sesi login sudah berakhir. Silakan masuk kembali.", { code: "AUTH", technical });
  }
  if (code === "42883" || code === "PGRST202" || /could not find the function/i.test((err && err.message) || "")) {
    return new AppError(what + "Server belum diperbarui (migrasi database Inbound belum dijalankan). Hubungi admin.", { code: "SCHEMA", technical });
  }
  if (code === "23505") {
    return new AppError(what + "Data yang sama sudah ada di server.", { code: "DUPLICATE", retryable: true, technical });
  }
  if (code === "22023") {
    return new AppError(what + ((err && err.message) || "Data tidak valid."), { code: "INVALID", technical });
  }
  return new AppError(what + "Terjadi kesalahan yang tidak terduga.", { code: "UNKNOWN", retryable: true, technical });
}

let notifier = null;
/** Dipasang oleh UI: fungsi (appError, {retry}) untuk menampilkan error ke user. */
export function setErrorNotifier(fn) { notifier = fn; }

/** Catat + tampilkan error. Mengembalikan AppError supaya pemanggil bisa lanjut memutuskan. */
export function handleError(err, action, opts) {
  const e = toAppError(err, action);
  log.error("error:" + (action || "umum"), { code: e.code, user: e.userMessage, technical: e.technical || (err && err.stack) });
  if (notifier && !(opts && opts.silent)) notifier(e, opts || {});
  return e;
}
