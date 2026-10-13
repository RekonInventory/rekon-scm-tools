/* GLT Rekon Suite — bantuan bersama untuk bulk upload catatan/case (Outbound, Inbound,
   Inventory). Hanya urusan berkas & tampilan: membaca Excel template, menampilkan
   pratinjau sebelum diterapkan, dan menyusun laporan hasil. Aturan pencocokan dan
   penyimpanan tetap milik tiap tool.

   Dipakai sebagai skrip biasa:  <script src="glt-bulk-upload.js"></script>
   API: window.GLTBulk.{bacaTemplate, cariKolom, nilai, pratinjau, tulisWorkbook, unduhXlsx}
   SheetJS (XLSX) diberikan oleh pemanggil supaya tool yang memuatnya secara lazy
   (Inbound) tidak perlu memuatnya dua kali. */
(function(){
  "use strict";
  const esc = s => String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm = s => String(s === null || s === undefined ? "" : s).trim().toUpperCase().replace(/\s+/g, " ");

  function bacaBuffer(file){
    if(file && typeof file.arrayBuffer === "function") return file.arrayBuffer().then(b => new Uint8Array(b));
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(new Uint8Array(e.target.result));
      r.onerror = () => rej(new Error("Gagal membaca " + (file && file.name)));
      r.readAsArrayBuffer(file);
    });
  }

  /**
   * Baca template bulk. Sheet dipilih: yang bernama salah satu `opts.sheet` (tanpa beda
   * huruf besar/kecil), kalau tidak ada sheet pertama. Baris header = baris pertama (dari
   * 10 baris teratas) yang memuat SEMUA `opts.wajib`.
   * @returns {Promise<{sheet, header:string[], baris:Array<{_baris:number, ...}>}>}
   */
  async function bacaTemplate(file, XLSX, opts){
    opts = opts || {};
    const buf = await bacaBuffer(file);
    // cellDates dimatikan: tanggal dibaca sebagai serial supaya tidak bergeser zona waktu
    const wb = XLSX.read(buf, {type:"array", cellDates:false});
    const ingin = (opts.sheet || []).map(norm);
    const sn = wb.SheetNames.find(n => ingin.indexOf(norm(n)) >= 0) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, raw:true, defval:null, blankrows:false});
    const wajib = (opts.wajib || []).map(norm);
    let hi = -1;
    for(let i = 0; i < Math.min(10, rows.length); i++){
      const h = (rows[i] || []).map(norm);
      if(wajib.every(w => h.indexOf(w) >= 0)){ hi = i; break; }
    }
    if(hi < 0){
      const e = new Error("Kolom wajib tidak ditemukan di sheet \"" + sn + "\": " + (opts.wajib || []).join(", ") +
        ". Pakai template yang diunduh dari tool ini.");
      e.code = "TEMPLATE"; throw e;
    }
    const header = (rows[hi] || []).map(x => x === null || x === undefined ? "" : String(x).trim());
    const baris = [];
    for(let i = hi + 1; i < rows.length; i++){
      const r = rows[i]; if(!r) continue;
      if(!r.some(v => v !== null && v !== undefined && String(v).trim() !== "")) continue;
      const o = {_baris: i + 1};
      header.forEach((h, j) => { if(h) o[h] = r[j] === undefined ? null : r[j]; });
      baris.push(o);
    }
    return {sheet:sn, header, baris};
  }

  /** Nama kolom sebenarnya di header untuk salah satu alias (tanpa beda huruf besar/kecil). */
  function cariKolom(header, alias){
    const al = [].concat(alias).map(norm);
    return header.find(h => al.indexOf(norm(h)) >= 0) || null;
  }
  /** Nilai sel sebagai teks bersih ("" kalau kosong). */
  function nilai(row, kol){
    if(!kol) return "";
    const v = row[kol];
    return v === null || v === undefined ? "" : String(v).trim();
  }

  /**
   * Pratinjau sebelum diterapkan.
   * @param {{judul, ringkasan:Array<{label,nilai,kelas?}>, kolom:Array<{label,key}>, baris:Array<object>,
   *          catatan?:string, okLabel?:string, okDisabled?:boolean, maks?:number}} o
   * @returns {Promise<boolean>}
   */
  function pratinjau(o){
    return new Promise(resolve => {
      const maks = o.maks || 300;
      const overlay = document.createElement("div");
      overlay.className = "glt-confirm-overlay glt-bulk-overlay";
      overlay.innerHTML =
        '<div class="glt-confirm-box glt-bulk-box" role="dialog" aria-modal="true" aria-label="' + esc(o.judul) + '">' +
          '<h3 class="glt-bulk-title">' + esc(o.judul) + '</h3>' +
          '<div class="glt-bulk-sum">' + (o.ringkasan || []).map(s =>
            '<span class="glt-bulk-chip ' + esc(s.kelas || "") + '"><b>' + esc(s.nilai) + '</b> ' + esc(s.label) + '</span>').join("") + '</div>' +
          (o.catatan ? '<p class="glt-bulk-note">' + esc(o.catatan) + '</p>' : "") +
          '<div class="glt-bulk-tbl"><table><thead><tr>' + o.kolom.map(k => '<th>' + esc(k.label) + '</th>').join("") +
          '</tr></thead><tbody>' + o.baris.slice(0, maks).map(b =>
            '<tr class="' + esc(b._kelas || "") + '">' + o.kolom.map(k => '<td>' + esc(b[k.key]) + '</td>').join("") + '</tr>').join("") +
          '</tbody></table>' +
          (o.baris.length > maks ? '<div class="glt-bulk-more">… ' + (o.baris.length - maks) + ' baris lagi tidak ditampilkan (tetap diproses / ada di laporan).</div>' : "") +
          (!o.baris.length ? '<div class="glt-bulk-more">Tidak ada baris.</div>' : "") +
          '</div>' +
          '<div class="glt-confirm-actions"><button type="button" data-v="0">Batal</button>' +
          '<button type="button" class="primary" data-v="1"' + (o.okDisabled ? " disabled" : "") + '>' + esc(o.okLabel || "Terapkan") + '</button></div>' +
        '</div>';
      function close(v){ overlay.remove(); document.removeEventListener("keydown", onKey); resolve(v); }
      function onKey(e){ if(e.key === "Escape") close(false); }
      overlay.addEventListener("click", e => {
        if(e.target === overlay) return close(false);
        const b = e.target.closest && e.target.closest("button[data-v]");
        if(b && !b.disabled) close(b.dataset.v === "1");
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(overlay);
      const ok = overlay.querySelector('button[data-v="1"]');
      if(ok && !ok.disabled) setTimeout(() => ok.focus(), 30);
    });
  }

  /** Workbook dari beberapa sheet [{nama, baris:Array<Array>, lebar?:number[]}] */
  function tulisWorkbook(XLSX, sheets){
    const wb = XLSX.utils.book_new();
    sheets.forEach(s => {
      const ws = XLSX.utils.aoa_to_sheet(s.baris);
      if(s.lebar) ws["!cols"] = s.lebar.map(w => ({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws, String(s.nama).slice(0, 31));
    });
    return wb;
  }
  function unduhXlsx(XLSX, wb, nama){ XLSX.writeFile(wb, String(nama).replace(/[\\/:*?"<>|]+/g, "-")); }

  // gaya kotak pratinjau (sekali saja)
  if(!document.getElementById("glt-bulk-style")){
    const st = document.createElement("style");
    st.id = "glt-bulk-style";
    st.textContent =
      ".glt-bulk-box{max-width:min(1100px,calc(100vw - 32px));width:100%;max-height:calc(100vh - 48px);display:flex;flex-direction:column;gap:10px}" +
      ".glt-bulk-title{margin:0;font-size:16px}" +
      ".glt-bulk-sum{display:flex;flex-wrap:wrap;gap:8px}" +
      ".glt-bulk-chip{border:1px solid var(--border,#E2E8F0);border-radius:999px;padding:3px 10px;font-size:12px;background:var(--surface-muted,#F8FAFC)}" +
      ".glt-bulk-chip.ok{border-color:var(--success-border,#BBF7D0);background:var(--success-bg,#F0FDF4)}" +
      ".glt-bulk-chip.warn{border-color:var(--warning-border,#FDE68A);background:var(--warning-bg,#FFFBEB)}" +
      ".glt-bulk-chip.bad{border-color:var(--danger-border,#FECACA);background:var(--danger-bg,#FEF2F2)}" +
      ".glt-bulk-note{margin:0;font-size:12.5px;color:var(--text-secondary,#475569)}" +
      ".glt-bulk-tbl{overflow:auto;border:1px solid var(--border,#E2E8F0);border-radius:8px;min-height:80px}" +
      ".glt-bulk-tbl table{border-collapse:collapse;width:100%;font-size:12px}" +
      ".glt-bulk-tbl th{position:sticky;top:0;background:var(--surface-muted,#F8FAFC);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border,#E2E8F0);white-space:nowrap}" +
      ".glt-bulk-tbl td{padding:5px 8px;border-bottom:1px solid var(--border-soft,#F1F5F9);vertical-align:top;max-width:340px;overflow-wrap:anywhere}" +
      ".glt-bulk-tbl tr.bad td{background:var(--danger-bg,#FEF2F2)}" +
      ".glt-bulk-tbl tr.warn td{background:var(--warning-bg,#FFFBEB)}" +
      ".glt-bulk-tbl tr.skip td{color:var(--text-muted,#94A3B8)}" +
      ".glt-bulk-more{padding:8px;font-size:12px;color:var(--text-muted,#64748B)}";
    document.head.appendChild(st);
  }

  window.GLTBulk = {bacaTemplate, cariKolom, nilai, pratinjau, tulisWorkbook, unduhXlsx, esc, norm};
})();
