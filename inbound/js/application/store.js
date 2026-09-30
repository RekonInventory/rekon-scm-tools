// State aplikasi terpusat. Perubahan dikumpulkan lalu diberitahukan sekali per
// microtask ke pelanggan yang memang tertarik pada kunci yang berubah — supaya UI
// tidak merender ulang bagian yang tidak terpengaruh.
export function createStore(initial) {
  let state = Object.assign({}, initial);
  const subs = new Set();
  let changed = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const keys = changed;
    changed = new Set();
    subs.forEach((s) => {
      if (!s.keys || s.keys.some((k) => keys.has(k))) {
        try { s.fn(state, keys); } catch (e) { console.error("[inbound] subscriber gagal", e); }
      }
    });
  }

  return {
    get: () => state,
    /** Patch dangkal. Kirim objek baru untuk kunci bersarang supaya perubahan terdeteksi. */
    set(patch) {
      let any = false;
      for (const k of Object.keys(patch)) {
        if (state[k] !== patch[k]) { changed.add(k); any = true; }
      }
      if (!any) return;
      state = Object.assign({}, state, patch);
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    /** Paksa notifikasi kunci tertentu (mis. setelah isi case store berubah di tempat). */
    touch(...keys) {
      keys.forEach((k) => changed.add(k));
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    subscribe(keys, fn) {
      const s = { keys: keys ? [].concat(keys) : null, fn };
      subs.add(s);
      return () => subs.delete(s);
    }
  };
}
