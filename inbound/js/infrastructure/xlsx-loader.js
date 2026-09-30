// SheetJS dimuat MALAS (lazy) dari satu file bersama ../vendor/xlsx.full.min.js,
// bukan lagi di-inline 437 KB di setiap halaman. Versi & isinya identik dengan
// yang dulu tertanam di Rekonsiliasi_Inbound.html (hasil ekstraksi verbatim).
let pending = null;

export function xlsxUrl() {
  return new URL("../../../vendor/xlsx.full.min.js", import.meta.url).href;
}

export function ensureXLSX() {
  if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = xlsxUrl();
    s.async = true;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("SheetJS termuat tetapi objek XLSX tidak ditemukan.")));
    s.onerror = () => { pending = null; reject(new Error("Gagal memuat pustaka pembaca Excel (vendor/xlsx.full.min.js).")); };
    document.head.appendChild(s);
  });
  return pending;
}

/** Muat di waktu senggang supaya berkas pertama tidak menunggu unduhan pustaka. */
export function prefetchXLSX() {
  const run = () => { ensureXLSX().catch(() => { /* dicoba lagi saat dibutuhkan */ }); };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
