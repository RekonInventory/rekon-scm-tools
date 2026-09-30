// GENERATED oleh inbound/dev/extract-legacy.mjs dari Rekonsiliasi_Inbound.html (sha256 28ae4b4a2cc1f482).
// Encode/decode snapshot RESULT (Set/Map/Date aman di JSON). Format WAJIB kompatibel dengan versi lama.
// Isi IIFE di bawah adalah salinan VERBATIM kode lama. Jangan ubah aturan bisnisnya tanpa
// keputusan bisnis + regression test (inbound/tests/regression).

export function snapEncode(value, seen){
    seen = seen || new WeakSet();
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Date) return {__t:"Date", v:value.toISOString()};
    if (value instanceof Set) return {__t:"Set", v:Array.from(value).map(function(x){ return snapEncode(x, seen); })};
    if (value instanceof Map) return {__t:"Map", v:Array.from(value.entries()).map(function(e){ return [snapEncode(e[0], seen), snapEncode(e[1], seen)]; })};
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) return value.map(function(x){ return snapEncode(x, seen); });
    var out = {};
    Object.keys(value).forEach(function(k){ out[k] = snapEncode(value[k], seen); });
    return out;
  }
export function snapDecode(value){
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(snapDecode);
    if (value.__t === "Date") return new Date(value.v);
    if (value.__t === "Set") return new Set((value.v||[]).map(snapDecode));
    if (value.__t === "Map") return new Map((value.v||[]).map(function(e){ return [snapDecode(e[0]), snapDecode(e[1])]; }));
    var out = {};
    Object.keys(value).forEach(function(k){ out[k] = snapDecode(value[k]); });
    return out;
  }
