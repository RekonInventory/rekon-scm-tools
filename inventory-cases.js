/* GLT Rekon Suite — Inventory: case per PEB (seperti Inbound & Outbound).

   Dimuat inventory.html SESUDAH skrip utamanya dan memakai binding global milik halaman
   itu (supa, supaReady, currentUser, currentRunId, state, fmt, escAttr, displayNameFromUser,
   visibleRows, renderTable, gltToast, gltChoice, XLSX, GLTBulk, ...). Aktif hanya bila SQL
   docs/sql/inventory_2026-10-17_01_cases.sql sudah dijalankan (RPC inventory_case_ping ada).
   Bila belum, halaman tetap memakai catatan per run seperti sebelumnya — tidak ada yang berubah.

   Perbedaan dengan catatan lama:
   * Case melekat pada nomor PEB (bukan pada run), jadi tetap ada di setiap pengecekan
     berikutnya tanpa perlu disalin atau disimpan bersama run.
   * Satu PEB boleh punya beberapa case (nomor 01, 02, ...), masing-masing dengan status
     OPEN / IN PROGRESS / CLOSED, PIC otomatis, jenis, kategori, catatan, dan tindakan.
   * Simpan memakai cek versi (dua orang mengedit case yang sama -> yang kedua diberi tahu,
     tidak menimpa diam-diam). Jejak audit dicatat server dan tidak bisa diubah.
   * Perubahan orang lain muncul langsung (realtime).
   * state.notes milik halaman diisi ULANG dari case, sehingga kolom catatan, saringan,
     urutan, run tersimpan, dan ekspor yang sudah ada tetap bekerja. */
(function(){
  "use strict";
  const WS = "default";
  const STATUS_CASE = ["OPEN", "IN PROGRESS", "CLOSED"];
  const LABEL_TIPE = {
    TIDAK_ADA_DI_SCM:"Tidak ada di SCM", TIDAK_ADA_DI_INVENTORY:"Tidak ada di Inventory", SELISIH_QTY:"Selisih qty",
    OUTBOUND_HARI_INI:"Outbound tanggal ini", INBOUND_HARI_INI:"Inbound tanggal ini", LAINNYA:"Lainnya"
  };
  const TIPE_URUT = ["TIDAK_ADA_DI_SCM", "TIDAK_ADA_DI_INVENTORY", "SELISIH_QTY", "OUTBOUND_HARI_INI", "INBOUND_HARI_INI", "LAINNYA"];
  const KATEGORI_CASE = ["Menunggu Gudang", "Menunggu SCM", "Menunggu Customs", "Selisih Qty", "Salah Input", "Data Belum Lengkap", "Lainnya"];
  const PILL_CASE = {"OPEN":"t-warn", "IN PROGRESS":"t-blue", "CLOSED":"t-ok"};
  const FLOW = [["OPEN", "Open", "danger"], ["IN PROGRESS", "In Progress", "warning"], ["CLOSED", "Closed", "success"]];
  const dua = n => String(n).padStart(2, "0");
  const nowIso = () => new Date().toISOString();
  const angka = v => (v === null || v === undefined || v === "") ? null : Number(v);
  const fmtN = v => (v === null || v === undefined || v === "") ? "" : fmt(v);
  const esc = s => escAttr(s);
  const $ = id => document.getElementById(id);
  function fmtTs(iso){
    if(!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("id-ID", {dateStyle:"medium", timeStyle:"short"});
  }

  const st = {
    aktif:false, peran:"operator", proses:null, userId:null,
    rows:new Map(),        // id -> baris server (case aktif, belum dihapus)
    byKey:new Map(),       // record_key (PEB) -> [baris] urut seq
    channel:null, tunda:null,
    laci:null,             // {key, edit:null|{id, version}, berubah:false, dirty:false}
    timeline:new Map()     // record_key -> [event] | {galat}
  };

  /* ------------------------------------------------------------ util */
  function tipeDariStatus(s){
    switch(s){
      case "NO_SCM": return "TIDAK_ADA_DI_SCM";
      case "NO_INV": return "TIDAK_ADA_DI_INVENTORY";
      case "SELISIH": return "SELISIH_QTY";
      case "OUTBOUND": return "OUTBOUND_HARI_INI";
      case "INBOUND": return "INBOUND_HARI_INI";
      default: return "LAINNYA";
    }
  }
  function namaSaya(){ return typeof currentUser !== "undefined" && currentUser ? displayNameFromUser(currentUser) : "pengguna"; }
  function supervisor(){ return st.peran === "supervisor" || st.peran === "admin"; }
  function pesanGalat(e){ return (e && (e.message || e.error_description || e.details)) || String(e); }
  async function rpc(nama, args){
    const {data, error} = await supa.rpc(nama, args || {});
    if(error) throw error;
    return data;
  }
  function idCase(k, seq){ return k + "|" + dua(seq); }
  function labelCase(c){ return (c.peb || String(c.record_key || "?")) + "-" + dua(c.seq); }
  function statusGabungan(list){
    if(list.some(c => c.status === "OPEN")) return "OPEN";
    if(list.some(c => c.status === "IN PROGRESS")) return "IN PROGRESS";
    return "CLOSED";
  }
  function pasang(row){
    if(!row || !row.id) return;
    if(row.deleted_at) st.rows.delete(row.id); else st.rows.set(row.id, row);
  }
  function indeks(){
    st.byKey = new Map();
    st.rows.forEach(row => {
      if(!st.byKey.has(row.record_key)) st.byKey.set(row.record_key, []);
      st.byKey.get(row.record_key).push(row);
    });
    st.byKey.forEach(l => l.sort((a, b) => a.seq - b.seq));
  }
  function seqBerikut(k){
    return (st.byKey.get(k) || []).reduce((m, c) => Math.max(m, c.seq), 0) + 1;
  }
  function cariBaris(k){ return state.rows.find(r => r.peb === k) || null; }
  function identitas(r){
    return {record_key:r.peb, peb:r.peb, category:r.category || null, aju:r.aju ? String(r.aju).slice(0, 200) : null,
            job:r.job ? String(r.job).slice(0, 200) : null};
  }

  /* daftar perubahan yang bisa dibaca manusia (untuk audit & pratinjau bulk) */
  function perubahan(lama, baru){
    const out = [];
    const teks = v => (v === null || v === undefined || v === "") ? "(kosong)" : String(v);
    if(!lama){
      out.push("Status " + baru.status);
      if(baru.remark) out.push("Catatan: " + baru.remark);
      if(baru.action_taken) out.push("Tindakan: " + baru.action_taken);
      if(baru.kategori) out.push("Kategori: " + baru.kategori);
      return out;
    }
    if(lama.status !== baru.status) out.push("Status " + lama.status + " → " + baru.status);
    if((lama.remark || "") !== (baru.remark || "")) out.push("Catatan: " + teks(lama.remark) + " → " + teks(baru.remark));
    if((lama.action_taken || "") !== (baru.action_taken || "")) out.push("Tindakan: " + teks(lama.action_taken) + " → " + teks(baru.action_taken));
    if((lama.kategori || "") !== (baru.kategori || "")) out.push("Kategori: " + teks(lama.kategori) + " → " + teks(baru.kategori));
    if((lama.pic || "") !== (baru.pic || "")) out.push("PIC: " + teks(lama.pic) + " → " + teks(baru.pic));
    if((lama.case_type || "") !== (baru.case_type || "")) out.push("Jenis " + (LABEL_TIPE[lama.case_type] || lama.case_type) + " → " + (LABEL_TIPE[baru.case_type] || baru.case_type));
    return out;
  }
  function tandaiTutup(row, lamaStatus){
    if(row.status === "CLOSED"){
      if(lamaStatus !== "CLOSED"){ row.closed_at = nowIso(); row.closed_by = namaSaya(); }
    }else{ row.closed_at = null; row.closed_by = null; }
  }

  /* ------------------------------------------------------------ server */
  function pesanKonflik(cur){
    const who = (cur && cur.user_name) || "pengguna lain";
    return "Case ini sudah diubah oleh " + who + (cur && cur.updated_at ? " (" + fmtTs(cur.updated_at) + ")" : "") +
           " sejak Anda membukanya.";
  }
  /* simpan satu case; untuk case baru, nomor case dinaikkan otomatis bila sudah terpakai */
  async function simpanSatu(row, expected, opts){
    opts = opts || {};
    row = Object.assign({}, row, {workspace_id:WS});
    for(let i = 0; i < 6; i++){
      const out = await rpc("inventory_case_save", {p_case:row, p_expected_version:expected === undefined ? null : expected,
                                                      p_action:opts.action || null, p_force:!!opts.force});
      if(out.status === "ok"){ pasang(out.row); indeks(); return out.row; }
      if(out.status === "id_conflict" && (expected === null || expected === undefined)){
        const seq = Math.max(row.seq + 1, seqBerikut(row.record_key));
        row = Object.assign({}, row, {seq, id:idCase(row.record_key, seq)});
        continue;
      }
      if(out.status === "conflict"){
        if(out.current){ pasang(out.current); indeks(); }
        const e = new Error(pesanKonflik(out.current)); e.konflik = true; e.current = out.current; throw e;
      }
      if(out.status === "deleted"){
        if(out.current) st.rows.delete(out.current.id);
        indeks();
        throw new Error("Case ini sudah dihapus oleh " + ((out.current && out.current.deleted_by_name) || "pengguna lain") + ". Perubahan tidak disimpan.");
      }
      throw new Error("Case tidak ditemukan di server.");
    }
    throw new Error("Nomor case bentrok terus-menerus; coba simpan lagi.");
  }
  async function muat(){
    const semua = [];
    for(let from = 0; ; from += 1000){
      const {data, error} = await supa.from("inventory_cases").select("*").eq("workspace_id", WS)
        .is("deleted_at", null).order("id").range(from, from + 999);
      if(error) throw error;
      semua.push.apply(semua, data || []);
      if(!data || data.length < 1000) break;
    }
    st.rows = new Map(); semua.forEach(pasang); indeks();
    return semua.length;
  }
  function langganan(){
    if(st.channel || !supa.channel) return;
    st.channel = supa.channel("inventory-cases-" + Math.random().toString(36).slice(2, 8))
      .on("postgres_changes", {event:"*", schema:"public", table:"inventory_cases"}, p => {
        const row = p.new && p.new.id ? p.new : null;
        if(p.eventType === "DELETE"){ st.rows.delete(p.old && p.old.id); }
        else if(row){
          const cur = st.rows.get(row.id);
          // event lama yang terlambat, atau gema simpanan sendiri (versi sudah sama)
          if(cur && (row.version || 0) <= (cur.version || 0) && !row.deleted_at) return;
          pasang(row);
        }
        indeks();
        jadwalSegarkan(row ? row.record_key : null);
      })
      .subscribe();
  }
  function jadwalSegarkan(k){
    clearTimeout(st.tunda);
    st.tunda = setTimeout(() => {
      segarkan();
      if(st.laci && k && k === st.laci.key){
        st.timeline.delete(k);
        // jangan menimpa isian yang sedang diketik; tandai hanya bila case yang diedit memang berubah di server
        const e = st.laci.edit, cur = e && e.id ? st.rows.get(e.id) : null;
        if(!e) renderLaci();
        else if(e.id && (!cur || cur.version > e.version)) tandaiBerubah();
        muatTimeline(k);
      }
    }, 250);
  }

  /* ------------------------------------------------------------ mode */
  /* Login bisa terdeteksi sebelum ATAU sesudah berkas ini dimuat, jadi mulai() bisa
     dipanggil dua kali untuk pengguna yang sama -> pakai satu proses yang sama. */
  function mulai(user){
    if(!supaReady || !user){ berhenti(); return Promise.resolve(false); }
    if(st.proses && st.userId === user.id) return st.proses;
    berhenti();
    st.userId = user.id;
    const p = (async () => {
      try{ await rpc("inventory_case_ping"); }
      catch(e){ st.aktif = false; tandaiMode(); return false; }
      if(st.proses !== p) return false;              // sudah keluar / ganti pengguna
      st.aktif = true;
      try{ const r = await rpc("app_my_role"); if(r) st.peran = r; }catch(e){ st.peran = "operator"; }
      try{ await muat(); }
      catch(e){ gltToast("Gagal memuat case Inventory dari server: " + pesanGalat(e), "err"); }
      if(st.proses !== p) return false;
      langganan();
      tandaiMode();
      segarkan();
      return true;
    })();
    st.proses = p;
    return p;
  }
  function berhenti(){
    if(st.channel){ try{ supa.removeChannel(st.channel); }catch(e){} st.channel = null; }
    st.aktif = false; st.rows = new Map(); st.byKey = new Map(); st.timeline = new Map();
    st.proses = null; st.userId = null;
    tutupLaci();
    tandaiMode();
  }
  function tandaiMode(){
    document.body.classList.toggle("inv-case-mode", st.aktif);
    const t = $("btnNoteTpl"), u = $("btnNoteUp");
    if(t){
      t.textContent = st.aktif ? "Template case" : "Template catatan";
      t.title = st.aktif ? "Template Excel berisi baris yang sedang tampil, untuk mengisi case per PEB secara massal"
                         : "Template Excel berisi baris yang sedang tampil, untuk mengisi catatan per PEB secara massal";
    }
    if(u){
      u.textContent = st.aktif ? "Upload case" : "Upload catatan";
      u.title = st.aktif ? "Unggah template case yang sudah diisi; tampil pratinjau dulu sebelum disimpan"
                         : "Unggah template catatan yang sudah diisi; tampil pratinjau dulu";
    }
    ringkasan();
  }

  /* isi ulang state.notes milik halaman dari case */
  function terapkan(){
    if(!st.aktif) return;
    const n = new Map();
    st.byKey.forEach((list, k) => {
      const berteks = list.filter(c => c.remark && String(c.remark).trim());
      if(berteks.length) n.set(k, list.length === 1 ? berteks[0].remark : berteks.map(c => "#" + dua(c.seq) + " " + c.remark).join(" | "));
    });
    state.notes = n;
  }
  /** turunkan ulang catatan dari case lalu gambar ulang tabel (jumlah baris yang sudah dimuat tetap) */
  function segarkan(){
    terapkan();
    if(state.rows.length){
      const tampil = state.shown;
      renderTable(true);
      while(state.shown < tampil && !$("btnMore").classList.contains("hide")) renderTable(false);
    }
    ringkasan();
  }
  function ringkasHitung(){
    let open = 0, prog = 0, closed = 0;
    st.rows.forEach(c => { if(c.status === "OPEN") open++; else if(c.status === "IN PROGRESS") prog++; else closed++; });
    return fmtN(open) + " case open · " + fmtN(prog) + " in progress · " + fmtN(closed) + " closed";
  }
  function ringkasan(){
    const el = $("caseSummary");
    if(el) el.textContent = st.aktif ? ringkasHitung() : "";
  }

  /* info ringkas untuk kolom "Case" di tabel */
  function info(k){
    const list = st.byKey.get(k);
    if(!list || !list.length) return null;
    const s = statusGabungan(list);
    const sub = list.length === 1 ? labelCase(list[0]) + (list[0].pic ? " · " + list[0].pic : "")
      : STATUS_CASE.map(x => { const n = list.filter(c => c.status === x).length; return n ? n + " " + x.toLowerCase() : ""; }).filter(Boolean).join(" · ");
    return {teks:s + (list.length > 1 ? " · " + list.length + " case" : ""), sub, kelas:PILL_CASE[s] || "", n:list.length,
            aktif:list.filter(c => c.status !== "CLOSED").length};
  }
  /** untuk saringan kolom & urutan di tabel */
  function lolosFilter(k, mode){
    const list = st.byKey.get(k) || [];
    switch(mode){
      case "none": return !list.length;
      case "any": return list.length > 0;
      case "active": return list.some(c => c.status !== "CLOSED");
      case "OPEN": case "IN PROGRESS": return list.some(c => c.status === mode);
      case "closed": return list.length > 0 && list.every(c => c.status === "CLOSED");
      default: return true;
    }
  }
  function urutan(k){
    const list = st.byKey.get(k);
    return list && list.length ? STATUS_CASE.indexOf(statusGabungan(list)) : null;
  }
  /** teks ringkas untuk kolom ekspor */
  function ringkas(k){
    const i = info(k);
    return i ? i.teks : "";
  }

  /* ------------------------------------------------------------ laci rincian (seperti panel detail Inbound/Outbound) */
  const SECTIONS = {ringkasan:true, data:true, penjelasan:true, cases:true, timeline:false};
  function umur(iso){
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if(!isFinite(m)) return "-";
    if(m < 1) return "baru saja"; if(m < 60) return m + " menit";
    const j = Math.floor(m / 60); if(j < 24) return j + " jam";
    return Math.floor(j / 24) + " hari";
  }
  function terakhir(c){
    const a = Array.isArray(c.audit) ? c.audit : [];
    return a.length ? a[a.length - 1].what : "";
  }
  function pasangLaci(){
    if($("ivDrawer")) return;
    const scrim = document.createElement("div"); scrim.className = "iv-scrim"; scrim.id = "ivScrim";
    const aside = document.createElement("aside"); aside.className = "iv-drawer"; aside.id = "ivDrawer"; aside.setAttribute("aria-hidden", "true");
    aside.innerHTML = '<div class="iv-drawer-head"><span class="iv-drawer-key" id="ivDrKey">—</span><h3 id="ivDrTitle">Rincian PEB</h3>' +
      '<button type="button" class="iv-drawer-x" id="ivDrClose" title="Tutup" aria-label="Tutup rincian">&times;</button></div>' +
      '<div class="iv-drawer-body" id="ivDrBody"></div>';
    document.body.appendChild(scrim); document.body.appendChild(aside);
    scrim.addEventListener("click", tutupLaci);
    $("ivDrClose").addEventListener("click", tutupLaci);
    document.addEventListener("keydown", e => {
      if(e.key === "Escape" && st.laci && !document.querySelector(".glt-confirm-overlay")) tutupLaci();
    });
  }
  function bukaLaci(k){
    if(!st.aktif || !cariBaris(k)) return;
    pasangLaci();
    st.laci = {key:k, edit:null, berubah:false, dirty:false};
    renderLaci();
    $("ivDrawer").classList.add("on"); $("ivDrawer").setAttribute("aria-hidden", "false");
    $("ivScrim").classList.add("on");
    muatTimeline(k);
  }
  function tutupLaci(){
    st.laci = null;
    const d = $("ivDrawer"), s = $("ivScrim");
    if(d){ d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); }
    if(s) s.classList.remove("on");
  }
  function tandaiBerubah(){
    if(!st.laci) return;
    st.laci.berubah = true;
    const el = $("ivcStale"); if(el) el.hidden = false;
  }
  function nav(k, arah){
    const baris = visibleRows().map(x => x.peb);
    const i = baris.indexOf(k);
    return i < 0 ? null : baris[i + arah] || null;
  }
  function seksi(kunci, judul, isi, hitung){
    const buka = SECTIONS[kunci];
    return '<section class="ivd-sec"><h3><button type="button" class="ivd-disc" data-ivd-sec="' + kunci + '" aria-expanded="' + buka + '">' +
      '<span class="ivd-chev">' + (buka ? "▾" : "▸") + "</span>" + esc(judul) + "</button>" +
      (hitung !== undefined ? '<span class="ivd-count">' + hitung + "</span>" : "") + "</h3>" +
      '<div class="ivd-body"' + (buka ? "" : " hidden") + ">" + isi + "</div></section>";
  }
  function kv(pasangan){
    return '<dl class="ivd-kv">' + pasangan.filter(Boolean).map(p => "<div><dt>" + esc(p[0]) + "</dt><dd>" + p[1] + "</dd></div>").join("") + "</dl>";
  }
  function penjelasan(r){
    const ref = state.refDate;
    switch(r.status){
      case "MATCH": return "Qty Inventory dan qty SCM sama (" + fmtN(r.qtyInv) + ").";
      case "SELISIH": return "Qty Inventory " + fmtN(r.qtyInv) + " berbeda dengan qty SCM " + fmtN(r.qtyScm) + " (selisih " + fmtN(r.diff) + "). Periksa apakah ada pengeluaran/penerimaan yang belum tercatat di salah satu sisi.";
      case "NO_SCM": return "PEB ada di Inventory tetapi tidak ditemukan di laporan SCM.";
      case "NO_INV": return "PEB ada di laporan SCM tetapi tidak ditemukan di Inventory.";
      case "OUTBOUND": return "PEB ada di Inventory tanpa pasangan di SCM, tetapi tanggal keluarnya (" + (r.gout || "-") + ") sama dengan tanggal acuan" + (ref ? " " + ref : "") + ". Sumber lain biasanya baru diperbarui besok, jadi tidak dihitung sebagai selisih.";
      case "INBOUND": return "PEB ada di SCM tanpa pasangan di Inventory, tetapi tanggal GRN-nya (" + (r.grn || "-") + ") sama dengan tanggal acuan" + (ref ? " " + ref : "") + ". Sumber lain biasanya baru diperbarui besok, jadi tidak dihitung sebagai selisih.";
      default: return "—";
    }
  }
  function kartuCase(c, aktif){
    const f = FLOW.find(x => x[0] === c.status) || FLOW[0];
    const la = terakhir(c);
    return '<li class="ivd-case' + (aktif ? " is-active" : "") + '">' +
      '<div class="ivd-case-top"><b class="mono">' + esc(labelCase(c)) + '</b>' +
        '<span class="ivd-badge is-' + f[2] + '">' + esc(f[1]) + "</span>" +
        '<span class="ivd-badge">' + esc(LABEL_TIPE[c.case_type] || c.case_type || "") + "</span>" +
        (c.kategori ? '<span class="ivd-badge">' + esc(c.kategori) + "</span>" : "") + "</div>" +
      (c.remark ? '<p class="ivd-remark">' + esc(c.remark) + "</p>" : '<p class="ivd-remark ivd-muted">(tanpa catatan)</p>') +
      (c.action_taken ? '<p class="ivd-action">✓ Tindakan: ' + esc(c.action_taken) + "</p>" : "") +
      '<div class="ivd-case-meta"><span>PIC ' + esc(c.pic || "-") + "</span><span>umur " + esc(umur(c.created_at)) + "</span>" +
        "<span>diperbarui " + esc(fmtTs(c.updated_at)) + "</span>" + (la ? '<span class="ivd-last" title="' + esc(la) + '">terakhir: ' + esc(la) + "</span>" : "") + "</div>" +
      '<div class="ivd-case-act"><button type="button" class="btn btn-ghost btn-sm" data-ivc-edit="' + esc(c.id) + '"' + (aktif ? " disabled" : "") + ">" +
        (aktif ? "Sedang diedit" : "Buka / ubah") + "</button></div></li>";
  }
  function formEditor(L, r, lama){
    const v = lama || {status:"OPEN", remark:"", action_taken:"", kategori:"", case_type:tipeDariStatus(r.status)};
    const stale = lama && L.edit.version && st.rows.get(lama.id) && st.rows.get(lama.id).version > L.edit.version;
    const tipe = TIPE_URUT.map(t => '<option value="' + t + '"' + (t === (v.case_type || "LAINNYA") ? " selected" : "") + ">" + esc(LABEL_TIPE[t]) + "</option>").join("");
    const kats = KATEGORI_CASE.slice();
    if(v.kategori && kats.indexOf(v.kategori) < 0) kats.push(v.kategori);
    const kat = '<option value="">— tanpa kategori —</option>' + kats.map(k => '<option value="' + esc(k) + '"' + (k === (v.kategori || "") ? " selected" : "") + ">" + esc(k) + "</option>").join("");
    return '<form class="ivd-editor" id="ivcForm" onsubmit="return false">' +
      '<div class="ivd-alert" id="ivcStale"' + (stale || L.berubah ? "" : " hidden") + ' role="alert">⚠ Case ini baru saja diubah oleh ' +
        esc(lama ? (st.rows.get(lama.id) || lama).user_name || "pengguna lain" : "pengguna lain") +
        '. Simpan akan memicu pemeriksaan konflik. <button type="button" class="btn btn-ghost btn-sm" id="ivcMuat">Muat ulang</button></div>' +
      '<div class="ivd-field"><span class="ivd-label">Status workflow</span><div class="ivd-flow" role="radiogroup" id="ivcFlow">' +
        FLOW.map((f, i) => (i ? '<span class="ivd-flow-sep">›</span>' : "") +
          '<button type="button" role="radio" class="ivd-flow-step is-' + f[2] + '" data-st="' + f[0] + '" aria-checked="' + (v.status === f[0]) + '" tabindex="' + (v.status === f[0] ? 0 : -1) + '">' + esc(f[1]) + "</button>").join("") +
      "</div></div>" +
      '<div class="ivd-grid"><div class="ivd-field"><label class="ivd-label" for="ivcTipe">Jenis case</label><select id="ivcTipe" class="ivd-input">' + tipe + "</select></div>" +
        '<div class="ivd-field"><label class="ivd-label" for="ivcKat">Kategori</label><select id="ivcKat" class="ivd-input">' + kat + "</select></div></div>" +
      '<div class="ivd-field"><span class="ivd-label">PIC (otomatis)</span><div class="ivd-readonly" title="PIC otomatis = orang yang terakhir menyimpan case">☺ ' + esc(namaSaya()) + "</div></div>" +
      '<div class="ivd-field"><label class="ivd-label" for="ivcRemark">Temuan / catatan (remark)</label><textarea id="ivcRemark" class="ivd-input" rows="4" maxlength="2000" placeholder="Apa temuannya, apa yang sudah dicek, hasilnya…">' + esc(v.remark || "") + "</textarea>" +
        '<span class="ivd-hint">Fakta temuan & hasil pengecekan. Maks. 2000 karakter.</span></div>' +
      '<div class="ivd-field"><label class="ivd-label" for="ivcAction">Tindakan yang diambil</label><input id="ivcAction" class="ivd-input" maxlength="300" value="' + esc(v.action_taken || "") + '" placeholder="mis. Konfirmasi ke tim gudang, koreksi di SCM"></div>' +
      '<div class="ivd-actions"><button type="button" class="btn primary" id="ivcSimpan">' + (lama ? "Simpan perubahan" : "Buat case") + "</button>" +
        '<button type="button" class="btn btn-ghost" id="ivcBatal">Batal</button><span class="ivd-spacer"></span>' +
        (lama ? '<button type="button" class="btn btn-ghost ivd-danger" id="ivcHapus">Hapus case</button>' : "") + "</div>" +
      '<p class="ivd-meta">' + (lama ? "Case " + esc(labelCase(lama)) + " · dibuat " + esc(fmtTs(lama.created_at)) + (lama.created_by_name ? " oleh " + esc(lama.created_by_name) : "") +
        " · diperbarui " + esc(fmtTs(lama.updated_at)) + " · versi " + esc(lama.version) : "Case baru — belum tersimpan.") + "</p></form>";
  }
  function renderLaci(){
    const L = st.laci; if(!L) return;
    const r = cariBaris(L.key);
    if(!r){ tutupLaci(); return; }
    const list = st.byKey.get(L.key) || [];
    const lama = L.edit && L.edit.id ? st.rows.get(L.edit.id) : null;
    if(L.edit && L.edit.id && !lama) L.edit = null;
    const s = STATUS[r.status] || {label:r.status, cls:""};
    const baris = visibleRows().map(x => x.peb);
    const idx = baris.indexOf(L.key);
    $("ivDrKey").textContent = "Rekonsiliasi Inventory ↔ SCM · " + list.length + " case";
    $("ivDrTitle").textContent = "PEB " + r.peb;
    const navHtml = '<span class="ivd-nav"><button type="button" class="btn btn-ghost btn-sm" data-ivd-nav="-1"' + (idx <= 0 ? " disabled" : "") + ' title="Baris sebelumnya">▲</button> ' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ivd-nav="1"' + (idx < 0 || idx >= baris.length - 1 ? " disabled" : "") + ' title="Baris berikutnya">▼</button></span>';
    const ada = v => v ? esc(v) : "—";
    $("ivDrBody").innerHTML = '<div class="ivd-detail">' +
      '<div class="ivd-status"><span class="tag ' + s.cls + '">' + esc(s.label) + "</span>" + navHtml + "</div>" +
      seksi("ringkasan", "Ringkasan", kv([
        ["PEB", '<span class="mono">' + esc(r.peb) + "</span>"], ["Kategori", ada(r.category)], ["No. AJU", ada(r.aju)], ["Job No.", ada(r.job)],
        ["SO Number", ada(r.so)], ["PO Number", ada(r.po)], ["Tgl GRN (SCM)", ada(r.grn)], ["Tgl Keluar (SCM)", ada(r.gout)],
        ["Tgl Datang (Gudang)", ada(r.arr)], ["Sumber file", ada(r.src)],
        ["Case", list.length ? list.length + " case (" + list.filter(c => c.status !== "CLOSED").length + " aktif)" : "Belum ada"]])) +
      seksi("data", "Perbandingan data",
        '<table class="ivd-compare"><thead><tr><th></th><th>Inventory</th><th>SCM</th><th class="num">Selisih</th></tr></thead><tbody>' +
        '<tr><th>Qty</th><td class="num">' + (r.qtyInv == null ? "—" : esc(fmtN(r.qtyInv))) + '</td><td class="num">' + (r.qtyScm == null ? "—" : esc(fmtN(r.qtyScm))) + "</td>" +
          '<td class="num">' + (r.diff == null ? "—" : '<span class="' + (r.diff === 0 ? "ivd-ok" : "ivd-bad") + '">' + esc(fmtN(r.diff)) + "</span>") + "</td></tr>" +
        '<tr><th>Shipper</th><td>' + ada(r.shipInv) + "</td><td>" + ada(r.shipScm) + '</td><td class="num">—</td></tr>' +
        "</tbody></table>") +
      seksi("penjelasan", "Penjelasan", '<p class="ivd-explain">' + esc(penjelasan(r)) + "</p>") +
      seksi("cases", "Case & tindak lanjut",
        (list.length ? '<ul class="ivd-case-list">' + list.map(c => kartuCase(c, lama && lama.id === c.id)).join("") + "</ul>" : '<p class="ivd-muted">Belum ada case untuk PEB ini.</p>') +
        (L.edit ? '<div class="ivd-editor-wrap"><h4>' + (lama ? "Ubah case " + esc(labelCase(lama)) : "Case baru") + "</h4>" + formEditor(L, r, lama) + "</div>"
                : '<button type="button" class="btn ' + (list.length ? "btn-ghost" : "primary") + '" id="ivcTambah">+ Tambah case</button>'), list.length) +
      seksi("timeline", "Riwayat aktivitas (audit)", '<div id="ivcTimeline">' + timelineHtml(L.key) + "</div>") +
      "</div>";
    pasangHandler(L, lama);
  }
  function pasangHandler(L, lama){
    const el = $("ivDrBody");
    el.querySelectorAll("[data-ivd-sec]").forEach(x => x.addEventListener("click", () => {
      SECTIONS[x.dataset.ivdSec] = !SECTIONS[x.dataset.ivdSec]; renderLaci();
      if(x.dataset.ivdSec === "timeline" && SECTIONS.timeline) muatTimeline(L.key);
    }));
    el.querySelectorAll("[data-ivd-nav]").forEach(x => x.addEventListener("click", () => {
      const k = nav(L.key, Number(x.dataset.ivdNav));
      if(k){ if(L.dirty) gltToast("Perubahan yang belum disimpan dibuang.", "warn", 3000); bukaLaci(k); }
    }));
    el.querySelectorAll("[data-ivc-edit]").forEach(x => x.addEventListener("click", () => {
      const c = st.rows.get(x.dataset.ivcEdit); if(!c) return;
      st.laci.edit = {id:c.id, version:c.version}; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
      const f = $("ivcRemark"); if(f) f.focus();
    }));
    const tambah = $("ivcTambah");
    if(tambah) tambah.addEventListener("click", () => {
      st.laci.edit = {id:null, version:null}; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
      const f = $("ivcRemark"); if(f) f.focus();
    });
    const form = $("ivcForm");
    if(!form) return;
    const tandai = () => { st.laci.dirty = true; };
    form.addEventListener("input", tandai); form.addEventListener("change", tandai);
    const flow = $("ivcFlow");
    function setStatus(s, fokus){
      flow.dataset.val = s;
      flow.querySelectorAll("[role=radio]").forEach(b => { const on = b.dataset.st === s; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; if(on && fokus) b.focus(); });
      tandai();
    }
    flow.dataset.val = (lama ? lama.status : "OPEN");
    flow.querySelectorAll("[role=radio]").forEach(b => {
      b.addEventListener("click", () => setStatus(b.dataset.st));
      b.addEventListener("keydown", e => {
        if(e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const urut = FLOW.map(f => f[0]), i = urut.indexOf(flow.dataset.val);
        setStatus(urut[(i + (e.key === "ArrowRight" ? 1 : urut.length - 1)) % urut.length], true);
      });
    });
    $("ivcSimpan").addEventListener("click", simpanLaci);
    $("ivcBatal").addEventListener("click", () => { st.laci.edit = null; st.laci.berubah = false; st.laci.dirty = false; renderLaci(); });
    const muatUlang = $("ivcMuat");
    if(muatUlang) muatUlang.addEventListener("click", () => {
      const cur = lama && st.rows.get(lama.id);
      st.laci.edit = cur ? {id:cur.id, version:cur.version} : null; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
    });
    const hp = $("ivcHapus");
    if(hp && lama) hp.addEventListener("click", () => hapus(lama.id));
  }
  function bacaForm(){
    const v = id => { const x = $(id); return x ? String(x.value).trim() : ""; };
    const flow = $("ivcFlow");
    return {status:(flow && flow.dataset.val) || "OPEN", tipe:v("ivcTipe"), kategori:v("ivcKat"), remark:v("ivcRemark"), action:v("ivcAction")};
  }
  /* susun baris case dari isian (form laci atau bulk upload) */
  function susunRow(k, r, lama, f){
    const base = lama ? Object.assign({}, lama)
      : Object.assign(r ? identitas(r) : {record_key:k, peb:k}, {seq:seqBerikut(k), case_type:tipeDariStatus(r ? r.status : ""),
                                                                 audit:[], created_at:nowIso()});
    base.id = idCase(base.record_key, base.seq);
    // PIC otomatis = orang yang menyimpan (sama dengan Inbound/Outbound), bukan isian bebas
    const row = Object.assign(base, {status:f.status, pic:namaSaya(), remark:f.remark || null,
      case_type:f.tipe && LABEL_TIPE[f.tipe] ? f.tipe : base.case_type, action_taken:f.action || null,
      run_id:(typeof currentRunId !== "undefined" && currentRunId) || base.run_id || null, updated_at:nowIso()});
    if(f.kategori !== undefined) row.kategori = f.kategori || null;
    if(r) Object.assign(row, {row_status:r.status, qty_inventory:angka(r.qtyInv), qty_scm:angka(r.qtyScm), qty_difference:angka(r.diff)});
    tandaiTutup(row, lama ? lama.status : null);
    return row;
  }
  async function simpanLaci(){
    const L = st.laci; if(!L) return;
    const r = cariBaris(L.key); if(!r) return;
    const f = bacaForm();
    const lama = L.edit && L.edit.id ? st.rows.get(L.edit.id) : null;
    if(L.edit && L.edit.id && !lama){ gltToast("Case ini sudah tidak ada (mungkin dihapus orang lain).", "warn"); L.edit = null; renderLaci(); return; }
    if(!lama && !f.remark && !f.action && !f.kategori && f.status === "OPEN"){
      gltToast("Case kosong tidak disimpan — isi catatan, status, tindakan, atau kategori.", "warn"); return;
    }
    const row = susunRow(L.key, r, lama, f);
    const ubah = perubahan(lama, row);
    // PIC berganti otomatis ke penyimpan; itu saja tidak dihitung sebagai perubahan
    if(lama && !ubah.some(x => x.indexOf("PIC:") !== 0)){ gltToast("Tidak ada perubahan.", "warn"); L.edit = null; L.dirty = false; renderLaci(); return; }
    row.audit = (lama && Array.isArray(lama.audit) ? lama.audit : []).concat([{at:nowIso(), by:namaSaya(),
      what:(lama ? "" : "Case dibuat: ") + ubah.join("; ")}]);
    await kirim(row, lama ? L.edit.version : null, L.key, lama, {});
  }
  async function kirim(row, expected, k, lama, opts){
    const s = $("ivcSimpan"); if(s) s.disabled = true;
    try{
      const hasil = await simpanSatu(row, expected, opts);
      if(st.laci){ st.laci.edit = null; st.laci.berubah = false; st.laci.dirty = false; }
      st.timeline.delete(k);
      segarkan(); renderLaci(); muatTimeline(k);
      gltToast("Case " + labelCase(hasil) + " tersimpan.", "ok", 3000);
    }catch(e){
      if(e.konflik){
        segarkan();
        const pilih = await gltChoice(e.message + "\n\nPerubahan Anda belum disimpan.", [
          {label:"Batal", value:"batal"},
          {label:"Muat versi terbaru", value:"muat", primary:true}
        ].concat(supervisor() ? [{label:"Timpa (supervisor)", value:"timpa", danger:true}] : []));
        if(pilih === "muat"){
          const cur = e.current && st.rows.get(e.current.id);
          if(st.laci){ st.laci.edit = cur ? {id:cur.id, version:cur.version} : null; st.laci.berubah = false; }
          st.timeline.delete(k); renderLaci(); muatTimeline(k);
        }else if(pilih === "timpa"){
          if(s) s.disabled = false;
          return kirim(row, e.current ? e.current.version : expected, k, lama, {force:true});
        }
      }else{
        gltToast("Gagal menyimpan case: " + pesanGalat(e), "err", 10000);
      }
    }finally{ const s2 = $("ivcSimpan"); if(s2) s2.disabled = false; }
  }
  function tanyaTeks(pesan, placeholder){
    return new Promise(resolve => {
      const ov = document.createElement("div");
      ov.className = "glt-confirm-overlay";
      ov.innerHTML = '<div class="glt-confirm-box"><p></p><input type="text"><div class="glt-confirm-actions">' +
        '<button type="button" data-v="0">Batal</button><button type="button" class="danger" data-v="1">Hapus</button></div></div>';
      ov.querySelector("p").textContent = pesan;
      const inp = ov.querySelector("input"); inp.placeholder = placeholder || "";
      function close(v){ ov.remove(); document.removeEventListener("keydown", onKey); resolve(v); }
      function onKey(e){ if(e.key === "Escape") close(null); if(e.key === "Enter" && document.activeElement === inp) close(inp.value.trim()); }
      ov.addEventListener("click", e => {
        if(e.target === ov) return close(null);
        const b = e.target.closest && e.target.closest("button[data-v]");
        if(b) close(b.dataset.v === "1" ? inp.value.trim() : null);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(ov);
      setTimeout(() => inp.focus(), 30);
    });
  }
  async function hapus(id){
    const c = st.rows.get(id); if(!c) return;
    const alasan = await tanyaTeks("Hapus case " + labelCase(c) + "? Case yang dihapus tetap tercatat di riwayat audit dan hanya supervisor/admin yang bisa memulihkannya.\n\nAlasan:", "mis. salah input");
    if(alasan === null) return;
    try{
      const out = await rpc("inventory_case_soft_delete", {p_id:id, p_expected_version:c.version, p_reason:alasan || null});
      if(out.status === "ok" || out.status === "deleted" || out.status === "not_found"){
        st.rows.delete(id); indeks();
      }else{
        if(out.current){ pasang(out.current); indeks(); }
        gltToast(pesanKonflik(out.current) + " Periksa lalu coba hapus lagi.", "warn", 9000);
      }
    }catch(e){ gltToast("Gagal menghapus case: " + pesanGalat(e), "err"); }
    if(st.laci){ if(st.laci.edit && st.laci.edit.id === id) st.laci.edit = null; st.timeline.delete(c.record_key); }
    segarkan(); renderLaci(); if(st.laci) muatTimeline(st.laci.key);
  }

  /* timeline audit server untuk satu PEB */
  const LABEL_AKSI = {CREATE:"Dibuat", UPDATE:"Diubah", STATUS_CHANGE:"Status diubah", CLOSE:"Ditutup", REOPEN:"Dibuka lagi",
    SOFT_DELETE:"Dihapus", RESTORE:"Dipulihkan", FORCE_OVERWRITE:"Ditimpa (supervisor)", BULK_UPLOAD:"Bulk upload",
    MIGRATE_LEGACY:"Migrasi dari catatan lama"};
  async function muatTimeline(k){
    if(st.timeline.has(k)){ const el = $("ivcTimeline"); if(el) el.innerHTML = timelineHtml(k); return; }
    try{
      const {data, error} = await supa.from("inventory_case_events").select("*").eq("workspace_id", WS).eq("record_key", k)
        .order("created_at", {ascending:true}).limit(300);
      if(error) throw error;
      st.timeline.set(k, data || []);
    }catch(e){ st.timeline.set(k, {galat:pesanGalat(e)}); }
    if(st.laci && st.laci.key === k){ const el = $("ivcTimeline"); if(el) el.innerHTML = timelineHtml(k); }
  }
  function timelineHtml(k){
    const ev = st.timeline.get(k);
    if(!ev) return '<div class="ivd-muted" style="padding:8px 0">Memuat…</div>';
    if(ev.galat) return '<div class="ivd-bad">Gagal memuat riwayat: ' + esc(ev.galat) + "</div>";
    if(!ev.length) return '<div class="ivd-muted" style="padding:8px 0">Belum ada riwayat.</div>';
    return '<div class="ivd-audit">' + ev.slice().reverse().map(e => {
      const isi = Array.isArray(e.audit_entries) && e.audit_entries.length
        ? e.audit_entries.map(a => a.what).filter(Boolean).join(" · ")
        : (e.changed_fields || []).join(", ");
      const nomor = String(e.case_id || "").split("|").pop();
      return "<div><time>" + esc(fmtTs(e.created_at)) + " · " + esc(e.actor_name || "sistem") + "</time><em>" +
        esc(LABEL_AKSI[e.action] || e.action) + " — case " + esc(nomor) + (isi ? "<br>" + esc(isi) : "") + "</em></div>";
    }).join("") + "</div>";
  }

  /* ------------------------------------------------------------ ekspor */
  function wsDari(L, lebar){
    const ws = XLSX.utils.aoa_to_sheet(L);
    if(lebar) ws["!cols"] = lebar.map(w => ({wch:w}));
    return ws;
  }
  const KOLOM_CASE = ["Case","Case ID","PEB","Kategori Brand","No. AJU","Job No.","Jenis","Status","PIC","Kategori","Catatan","Tindakan",
    "Status Rekon (saat disimpan)","Qty Inventory","Qty SCM","Selisih","Dibuat","Dibuat Oleh","Diubah","Diubah Oleh","Versi",
    "Ditutup","Ditutup Oleh","Ada di Hasil Ini"];
  function barisCase(c, adaDiHasil){
    return [labelCase(c), c.id, c.peb || c.record_key, c.category || "", c.aju || "", c.job || "", LABEL_TIPE[c.case_type] || c.case_type || "",
      c.status, c.pic || "", c.kategori || "", c.remark || "", c.action_taken || "",
      c.row_status && STATUS[c.row_status] ? STATUS[c.row_status].label : (c.row_status || ""),
      angka(c.qty_inventory) === null ? "" : Number(c.qty_inventory), angka(c.qty_scm) === null ? "" : Number(c.qty_scm),
      angka(c.qty_difference) === null ? "" : Number(c.qty_difference),
      fmtTs(c.created_at), c.created_by_name || "", fmtTs(c.updated_at), c.user_name || "", c.version,
      c.status === "CLOSED" ? fmtTs(c.closed_at) : "", c.closed_by || "", adaDiHasil ? "Ya" : "Tidak"];
  }
  function sheetCases(keys){
    const ada = new Set(state.rows.map(r => r.peb));
    const L = [KOLOM_CASE];
    const pilih = keys ? new Set(keys) : null;
    Array.from(st.rows.values()).filter(c => !pilih || pilih.has(c.record_key))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach(c => L.push(barisCase(c, ada.has(c.record_key))));
    return wsDari(L, [16, 18, 14, 10, 18, 16, 22, 12, 14, 18, 44, 30, 22, 10, 10, 9, 16, 14, 16, 14, 6, 16, 14, 10]);
  }
  async function sheetRiwayat(keys){
    const L = [["Waktu","Case","PEB","Aksi","Field Berubah","Isi Audit","Oleh","Versi Case"]];
    const daftar = Array.from(new Set(keys || [])).filter(Boolean);
    const ev = [];
    for(let i = 0; i < daftar.length; i += 150){
      const {data, error} = await supa.from("inventory_case_events").select("*").eq("workspace_id", WS)
        .in("record_key", daftar.slice(i, i + 150)).order("created_at", {ascending:true}).limit(5000);
      if(error) throw error;
      ev.push.apply(ev, data || []);
    }
    ev.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || (a.id - b.id));
    ev.forEach(e => {
      L.push([fmtTs(e.created_at), (e.peb || e.record_key || "") + "-" + String(e.case_id || "").split("|").pop(), e.peb || e.record_key || "",
        LABEL_AKSI[e.action] || e.action, (e.changed_fields || []).join(", "),
        Array.isArray(e.audit_entries) ? e.audit_entries.map(a => a.what).filter(Boolean).join(" · ") : "",
        e.actor_name || "", e.case_version || ""]);
    });
    return wsDari(L, [16, 18, 14, 22, 30, 60, 16, 8]);
  }
  function kunciHasil(){
    return state.rows.filter(r => st.byKey.has(r.peb)).map(r => r.peb);
  }

  /* ------------------------------------------------------------ bulk upload */
  const KOLOM_TPL = ["PEB","Brand","No. AJU","Job No.","Status Rekon","Qty Inventory","Qty SCM","Selisih","Case ID","Status Case",
    "Kategori","PIC","Catatan","Tindakan"];
  function unduhTemplate(){
    if(!st.aktif){ gltToast("Fitur case Inventory belum aktif: SQL docs/sql/inventory_2026-10-17_01_cases.sql belum dijalankan.", "warn", 9000); return; }
    const rows = visibleRows();
    if(!rows.length){ gltToast("Tidak ada baris yang tampil dengan filter saat ini.", "warn"); return; }
    const L = [KOLOM_TPL];
    rows.forEach(r => {
      const list = st.byKey.get(r.peb) || [];
      const c = list.filter(x => x.status !== "CLOSED").slice(-1)[0] || null;
      L.push([r.peb, r.category || "", r.aju || "", r.job || "", STATUS[r.status] ? STATUS[r.status].label : r.status,
        r.qtyInv == null ? "" : r.qtyInv, r.qtyScm == null ? "" : r.qtyScm, r.diff == null ? "" : r.diff,
        c ? labelCase(c) : "", c ? c.status : "", c ? (c.kategori || "") : "", c ? (c.pic || "") : "", c ? (c.remark || "") : "", c ? (c.action_taken || "") : ""]);
    });
    const P = [["PETUNJUK BULK UPLOAD CASE INVENTORY"], [],
      ["1", "Isi kolom Status Case, Kategori, Catatan, dan Tindakan di sheet CASE. Kolom PEB s.d. Selisih hanya informasi, jangan diubah."],
      ["2", "Case ID terisi = case yang sudah ada akan DIUBAH. Case ID kosong = dibuat case BARU (kalau ada isian)."],
      ["3", "Baris tanpa isian dan tanpa Case ID dilewati."],
      ["4", "Baris dicocokkan lewat PEB. Kalau PEB kosong, dipakai Job No. atau No. AJU (harus unik di hasil yang sedang tampil)."],
      ["5", "Status Case: OPEN, IN PROGRESS, atau CLOSED. Kosong = OPEN untuk case baru / tidak berubah untuk case lama."],
      ["6", "PIC otomatis = nama pengguna yang mengunggah (sama seperti Inbound dan Outbound). Kolom PIC di template hanya informasi."],
      ["7", "Catatan berisi tanda - (minus) saja = mengosongkan catatan case yang sudah ada."],
      ["8", "Sebelum disimpan akan tampil pratinjau. Case yang diubah orang lain sesudah template diunduh tidak ditimpa (dilaporkan sebagai bentrok)."],
      [], ["Diunduh", new Date().toLocaleString("id-ID")], ["Oleh", namaSaya()], ["Jumlah baris", rows.length]];
    const D = [["Status Case"]].concat(STATUS_CASE.map(x => [x])).concat([[], ["Kategori"]]).concat(KATEGORI_CASE.map(x => [x]));
    const wb = GLTBulk.tulisWorkbook(XLSX, [
      {nama:"CASE", baris:L, lebar:[16, 10, 18, 16, 22, 12, 12, 10, 14, 13, 18, 14, 44, 30]},
      {nama:"PETUNJUK", baris:P, lebar:[12, 120]},
      {nama:"PILIHAN", baris:D, lebar:[24]}]);
    GLTBulk.unduhXlsx(XLSX, wb, "Template_Case_Inventory_" + stamp() + ".xlsx");
  }
  function normStatus(s){
    const t = String(s || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if(!t) return "";
    if(t === "OPEN" || t === "BUKA" || t === "BARU") return "OPEN";
    if(t === "IN PROGRESS" || t === "INPROGRESS" || t === "PROGRESS" || t === "PROSES" || t === "DIPROSES") return "IN PROGRESS";
    if(t === "CLOSED" || t === "CLOSE" || t === "SELESAI" || t === "TUTUP" || t === "DONE") return "CLOSED";
    return null;
  }
  async function unggah(file){
    if(!st.aktif){ gltToast("Fitur case Inventory belum aktif: SQL docs/sql/inventory_2026-10-17_01_cases.sql belum dijalankan.", "warn", 9000); return; }
    if(!state.rows.length){ gltToast("Jalankan pengecekan dulu, lalu unggah template.", "warn"); return; }
    let t;
    try{ t = await GLTBulk.bacaTemplate(file, XLSX, {sheet:["CASE", "CATATAN", "TEMPLATE"], wajib:["Catatan"]}); }
    catch(e){ gltToast(pesanGalat(e), "err", 10000); return; }
    const K = n => GLTBulk.cariKolom(t.header, n), V = GLTBulk.nilai;
    const kol = {peb:K(["PEB", "PEB / NOPEN", "NOPEN"]), job:K(["Job No.", "Job No", "Job"]), aju:K(["No. AJU", "No AJU", "AJU"]),
      id:K(["Case ID", "Case"]), status:K(["Status Case"]), kat:K("Kategori"), remark:K("Catatan"), action:K("Tindakan")};
    const byPeb = new Map(), byJob = new Map(), byAju = new Map();
    const tambah = (m, k, r) => { if(!k) return; const x = String(k).trim().toUpperCase(); if(!m.has(x)) m.set(x, []); m.get(x).push(r); };
    state.rows.forEach(r => { tambah(byPeb, r.peb, r); tambah(byJob, r.job, r); tambah(byAju, r.aju, r); });
    const rencana = [];
    const seqPakai = new Map();      // peb -> seq berikut (beberapa case baru untuk PEB yang sama)
    const idPakai = new Set();
    t.baris.forEach(row => {
      const p = {baris:row._baris, peb:V(row, kol.peb), aksi:"", pesan:"", label:""};
      rencana.push(p);
      let kat = V(row, kol.kat);
      // template catatan lama memakai kolom "Kategori" untuk brand (Adidas/Nike): bukan kategori case
      if(/^(adidas|nike)$/i.test(kat)) kat = "";
      const isian = {status:V(row, kol.status), kat, remark:V(row, kol.remark), action:V(row, kol.action)};
      const caseId = V(row, kol.id);
      const adaIsian = isian.status || isian.kat || isian.remark || isian.action;
      if(!caseId && !adaIsian){ p.aksi = "LEWAT"; p.pesan = "tanpa isian"; p._kelas = "skip"; return; }
      const st_ = normStatus(isian.status);
      if(st_ === null){ p.aksi = "GALAT"; p.pesan = "Status Case tidak dikenal: " + isian.status; p._kelas = "bad"; return; }
      let kand = p.peb ? (byPeb.get(p.peb.toUpperCase()) || []) : [];
      if(!p.peb){
        const j = V(row, kol.job), a = V(row, kol.aju);
        kand = j ? (byJob.get(j.toUpperCase()) || []) : (a ? (byAju.get(a.toUpperCase()) || []) : []);
      }
      if(kand.length !== 1){
        p.aksi = "GALAT"; p._kelas = "bad";
        p.pesan = kand.length ? "cocok dengan " + kand.length + " baris, isi PEB supaya pasti" : "PEB / Job / AJU tidak ditemukan di hasil";
        return;
      }
      const r = kand[0], k = r.peb; p.peb = k;
      let lama = null;
      if(caseId){
        lama = Array.from(st.rows.values()).find(c => c.id === caseId || (c.record_key === k && (labelCase(c) === caseId || dua(c.seq) === caseId.replace(/^.*-/, "")))) || null;
        if(!lama){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " tidak ditemukan (mungkin sudah dihapus)"; p._kelas = "bad"; return; }
        if(lama.record_key !== k){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " milik PEB lain"; p._kelas = "bad"; return; }
        if(idPakai.has(lama.id)){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " muncul lebih dari sekali di berkas"; p._kelas = "bad"; return; }
        idPakai.add(lama.id);
      }
      const hapusCatatan = isian.remark === "-";
      const f = {status:st_ || (lama ? lama.status : "OPEN"), kategori:isian.kat || (lama ? lama.kategori || "" : ""),
        remark:hapusCatatan ? "" : (kol.remark && isian.remark ? isian.remark : (lama ? lama.remark || "" : "")),
        action:kol.action && isian.action ? isian.action : (lama ? lama.action_taken || "" : "")};
      if(!lama){
        if(hapusCatatan && !isian.action && !isian.kat && !isian.status){ p.aksi = "LEWAT"; p.pesan = "tidak ada yang dibuat"; p._kelas = "skip"; return; }
        const s = seqPakai.has(k) ? seqPakai.get(k) : seqBerikut(k);
        seqPakai.set(k, s + 1);
        const tmp = susunRow(k, r, null, f);
        tmp.seq = s; tmp.id = idCase(k, s);
        p.row = tmp; p.expected = null; p.aksi = "BARU"; p.label = labelCase(tmp);
        p.pesan = perubahan(null, tmp).join("; "); p._kelas = "";
      }else{
        const tmp = susunRow(k, r, lama, f);
        const ubah = perubahan(lama, tmp);
        p.label = labelCase(lama);
        if(!ubah.some(x => x.indexOf("PIC:") !== 0)){ p.aksi = "SAMA"; p.pesan = "tidak ada perubahan"; p._kelas = "skip"; return; }
        p.row = tmp; p.expected = lama.version; p.aksi = "UBAH"; p.pesan = ubah.join("; "); p.lama = lama;
      }
      p.row.audit = (p.lama && Array.isArray(p.lama.audit) ? p.lama.audit : []).concat([{at:nowIso(), by:namaSaya(),
        what:"Bulk upload (" + file.name + " baris " + p.baris + "): " + p.pesan}]);
      p.k = k;
    });
    const hitung = a => rencana.filter(x => x.aksi === a).length;
    const nBaru = hitung("BARU"), nUbah = hitung("UBAH");
    const setuju = await GLTBulk.pratinjau({
      judul:"Pratinjau bulk upload case — " + file.name,
      ringkasan:[{label:"case baru", nilai:nBaru, kelas:"ok"}, {label:"case diubah", nilai:nUbah, kelas:"ok"},
        {label:"tanpa perubahan", nilai:hitung("SAMA")}, {label:"dilewati (kosong)", nilai:hitung("LEWAT")},
        {label:"galat", nilai:hitung("GALAT"), kelas:hitung("GALAT") ? "bad" : ""}],
      catatan:"Baris galat tidak disimpan. Case yang diubah orang lain sesudah pratinjau ini tidak akan ditimpa.",
      kolom:[{label:"Baris", key:"baris"}, {label:"PEB", key:"peb"}, {label:"Case", key:"label"},
        {label:"Aksi", key:"aksi"}, {label:"Perubahan / pesan", key:"pesan"}],
      baris:rencana.filter(x => x.aksi !== "LEWAT").concat(rencana.filter(x => x.aksi === "LEWAT")),
      okLabel:"Simpan " + (nBaru + nUbah) + " case", okDisabled:!(nBaru + nUbah)
    });
    if(!setuju) return;
    const kerja = rencana.filter(x => x.aksi === "BARU" || x.aksi === "UBAH");
    let sukses = 0, bentrok = 0, galat = 0;
    gltToast("Menyimpan " + kerja.length + " case…", "", 4000);
    for(let i = 0; i < kerja.length; i += 100){
      const potong = kerja.slice(i, i + 100);
      let hasil;
      try{
        hasil = await rpc("inventory_case_save_many", {p_items:potong.map(x => ({case:Object.assign({}, x.row, {workspace_id:WS}),
          expected_version:x.expected, action:"BULK_UPLOAD"}))});
      }catch(e){
        potong.forEach(x => { x.hasil = "GALAT"; x.hasilPesan = pesanGalat(e); }); galat += potong.length; continue;
      }
      for(let j = 0; j < potong.length; j++){
        const x = potong[j], h = hasil[j] || {};
        if(h.status === "ok"){ pasang(h.row); x.hasil = "TERSIMPAN"; x.hasilPesan = labelCase(h.row); sukses++; }
        else if(h.status === "id_conflict" && x.aksi === "BARU"){
          // nomor case sudah terpakai (mis. case terhapus) -> simpan sendiri dengan nomor berikutnya
          try{ const row = await simpanSatu(x.row, null, {action:"BULK_UPLOAD"}); x.hasil = "TERSIMPAN"; x.hasilPesan = labelCase(row); sukses++; }
          catch(e){ x.hasil = "GALAT"; x.hasilPesan = pesanGalat(e); galat++; }
        }else if(h.status === "conflict" || h.status === "deleted"){
          if(h.current) pasang(h.current);
          x.hasil = "BENTROK"; x.hasilPesan = h.status === "deleted" ? "case sudah dihapus orang lain" : pesanKonflik(h.current); bentrok++;
        }else{ x.hasil = "GALAT"; x.hasilPesan = h.message || h.status || "tidak diketahui"; galat++; }
      }
    }
    indeks(); segarkan();
    const lapor = await gltChoice("Bulk upload selesai: " + sukses + " case tersimpan" + (bentrok ? ", " + bentrok + " bentrok (diubah orang lain, tidak ditimpa)" : "") +
      (galat ? ", " + galat + " galat" : "") + ".", [{label:"Tutup", value:false}, {label:"Unduh laporan", value:true, primary:true}]);
    if(lapor){
      const L = [["Baris","PEB","Case","Aksi","Hasil","Keterangan"]];
      rencana.forEach(x => L.push([x.baris, x.peb || "", x.hasilPesan && x.hasil === "TERSIMPAN" ? x.hasilPesan : (x.label || ""),
        x.aksi, x.hasil || (x.aksi === "GALAT" ? "GALAT" : "-"), x.hasil && x.hasil !== "TERSIMPAN" ? x.hasilPesan : x.pesan]));
      GLTBulk.unduhXlsx(XLSX, GLTBulk.tulisWorkbook(XLSX, [{nama:"HASIL", baris:L, lebar:[7, 16, 14, 8, 11, 90]}]),
        "Hasil_Bulk_Case_Inventory_" + stamp() + ".xlsx");
    }
  }

  /* ------------------------------------------------------------ gaya */
  const css = document.createElement("style");
  css.textContent =
    "body:not(.inv-case-mode) .col-case{display:none}" +
    "body.inv-case-mode #tbody tr[data-peb]{cursor:pointer}" +
    "td.casecell .tag{white-space:nowrap}" +
    "td.casecell .cc-sub{display:block;font-family:var(--mono,monospace);font-size:10.5px;color:var(--text-muted,#64748B);margin-top:2px;white-space:nowrap}" +
    "td.notecell{max-width:320px;font-size:12px;white-space:pre-line;overflow:hidden;text-overflow:ellipsis}" +
    "#caseSummary{font-size:12px;color:var(--text-muted,#64748B);align-self:center}" +
    /* di atas bilah atas aplikasi (1001), di bawah toast (2000) dan dialog konfirmasi (2100) */
    ".iv-scrim{position:fixed;inset:0;background:rgba(15,23,42,.28);z-index:1500;display:none}.iv-scrim.on{display:block}" +
    ".iv-drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,100%);background:var(--surface-muted,#F8FAFC);z-index:1501;box-shadow:-8px 0 32px rgba(15,23,42,.18);display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease-out}" +
    ".iv-drawer.on{transform:none}" +
    ".iv-drawer-head{position:relative;padding:14px 48px 12px 18px;border-bottom:1px solid var(--border,#E2E8F0);background:var(--surface,#fff)}" +
    ".iv-drawer-key{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B)}" +
    ".iv-drawer-head h3{margin:3px 0 0;font-size:17px;font-family:var(--mono,monospace)}" +
    ".iv-drawer-x{position:absolute;top:10px;right:12px;border:0;background:none;font-size:24px;line-height:1;cursor:pointer;color:var(--text-muted,#64748B);padding:2px 8px;border-radius:6px}" +
    ".iv-drawer-x:hover{background:var(--danger-bg,#FEF2F2);color:#B91C1C}" +
    ".iv-drawer-body{padding:14px 16px 28px;overflow:auto;flex:1}" +
    ".ivd-detail{display:flex;flex-direction:column;gap:10px;font-family:var(--sans,inherit)}" +
    ".ivd-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
    ".ivd-nav{margin-left:auto;display:inline-flex;gap:4px}" +
    ".ivd-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;border:1px solid var(--border,#E2E8F0);background:var(--surface,#fff);font-size:11.5px;font-weight:600;color:var(--text-secondary,#475569)}" +
    ".ivd-badge.is-danger{background:var(--danger-bg,#FEF2F2);border-color:var(--danger-border,#FECACA);color:#991B1B}" +
    ".ivd-badge.is-warning{background:var(--warning-bg,#FFFBEB);border-color:var(--warning-border,#FDE68A);color:#92400E}" +
    ".ivd-badge.is-success{background:var(--success-bg,#F0FDF4);border-color:var(--success-border,#BBF7D0);color:#166534}" +
    ".ivd-sec{border:1px solid var(--border,#E2E8F0);border-radius:10px;background:var(--surface,#fff)}" +
    ".ivd-sec>h3{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;font-size:13px}" +
    ".ivd-disc{flex:1;display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:4px 2px;cursor:pointer;font:inherit;font-weight:600;color:var(--text,#0F172A);text-align:left}" +
    ".ivd-disc:hover{color:var(--primary,#2563EB)}" +
    ".ivd-count{font-family:var(--mono,monospace);font-size:11px;color:var(--text-muted,#64748B)}" +
    ".ivd-body{padding:4px 12px 12px;border-top:1px solid var(--border-soft,#F1F5F9)}" +
    ".ivd-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;margin:8px 0 0}" +
    ".ivd-kv dt{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B)}" +
    ".ivd-kv dd{margin:1px 0 0;font-size:13px;word-break:break-word}" +
    ".ivd-compare{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}" +
    ".ivd-compare th,.ivd-compare td{padding:6px 8px;border-bottom:1px solid var(--border-soft,#F1F5F9);text-align:left;vertical-align:top}" +
    ".ivd-compare thead th{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B);background:var(--surface-muted,#F8FAFC)}" +
    ".ivd-compare tbody th{font-weight:600;color:var(--text-secondary,#475569)}" +
    ".ivd-compare .num{text-align:right;font-family:var(--mono,monospace)}" +
    ".ivd-ok{color:var(--success,#15803D)}.ivd-bad{color:var(--danger,#B91C1C);font-weight:600}" +
    ".ivd-muted{color:var(--text-muted,#64748B)}" +
    ".ivd-explain{margin:8px 0 0;font-size:13px;line-height:1.5}" +
    ".ivd-alert{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;border:1px solid var(--warning-border,#FDE68A);background:var(--warning-bg,#FFFBEB);color:#92400E;font-size:12.5px;margin:8px 0}" +
    ".ivd-alert[hidden]{display:none}" +   /* display:flex di atas akan menimpa atribut hidden */
    ".ivd-case-list{list-style:none;margin:8px 0 10px;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".ivd-case{border:1px solid var(--border,#E2E8F0);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:5px}" +
    ".ivd-case.is-active{border-color:var(--primary,#2563EB);box-shadow:0 0 0 3px var(--primary-soft,#DBEAFE)}" +
    ".ivd-case-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
    ".ivd-remark{margin:0;font-size:13px;white-space:pre-line}" +
    ".ivd-action{margin:0;font-size:12px;color:#166534}" +
    ".ivd-case-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:var(--text-muted,#64748B)}" +
    ".ivd-last{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}" +
    ".ivd-editor-wrap{border-top:1px dashed var(--border-strong,#CBD5E1);padding-top:10px;margin-top:6px}" +
    ".ivd-editor-wrap h4{margin:0 0 8px;font-size:13px}" +
    ".ivd-editor{display:flex;flex-direction:column;gap:12px}" +
    ".ivd-field{display:flex;flex-direction:column;gap:5px;min-width:0}" +
    ".ivd-label{font-size:11.5px;font-weight:600;color:var(--text-secondary,#475569)}" +
    ".ivd-hint{font-size:11px;color:var(--text-muted,#64748B)}" +
    ".ivd-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-strong,#CBD5E1);border-radius:8px;font:inherit;font-size:13px;background:var(--surface,#fff)}" +
    "textarea.ivd-input{resize:vertical;line-height:1.45}" +
    ".ivd-input:focus{outline:2px solid var(--primary,#2563EB);outline-offset:0;border-color:var(--primary,#2563EB)}" +
    ".ivd-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}" +
    ".ivd-readonly{padding:8px 11px;border:1px solid var(--border,#E2E8F0);border-radius:8px;background:var(--surface-muted,#F8FAFC);font-size:13px}" +
    ".ivd-flow{display:flex;align-items:center;gap:4px;flex-wrap:wrap}" +
    ".ivd-flow-sep{color:var(--text-muted,#94A3B8)}" +
    ".ivd-flow-step{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;border:1px solid var(--border-strong,#CBD5E1);background:var(--surface,#fff);font:inherit;font-size:13px;font-weight:600;color:var(--text-secondary,#475569);cursor:pointer}" +
    ".ivd-flow-step[aria-checked=true].is-danger{background:var(--danger-bg,#FEF2F2);border-color:var(--danger,#DC2626);color:#991B1B}" +
    ".ivd-flow-step[aria-checked=true].is-warning{background:var(--warning-bg,#FFFBEB);border-color:var(--warning,#D97706);color:#92400E}" +
    ".ivd-flow-step[aria-checked=true].is-success{background:var(--success-bg,#F0FDF4);border-color:var(--success,#16A34A);color:#166534}" +
    ".ivd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ivd-spacer{flex:1}" +
    ".ivd-danger{color:#B91C1C}" +
    ".ivd-meta{margin:0;font-size:10.5px;color:var(--text-muted,#64748B);font-family:var(--mono,monospace)}" +
    ".ivd-audit{border-top:1px solid var(--border-soft,#F1F5F9);font-size:12px}" +
    ".ivd-audit div{padding:8px 0;border-bottom:1px solid var(--border-soft,#F1F5F9)}" +
    ".ivd-audit time{font-family:var(--mono,monospace);font-size:10.5px;color:var(--text-muted,#64748B);display:block}" +
    ".ivd-audit em{font-style:normal;color:var(--text-secondary,#475569)}" +
    "@media(max-width:560px){.ivd-grid{grid-template-columns:1fr}}";
  document.head.appendChild(css);

  /* klik baris di tabel -> buka laci (hanya mode case) */
  const tb = $("tbody");
  if(tb) tb.addEventListener("click", e => {
    if(!st.aktif || (e.target.closest && e.target.closest("a,button,input,select,textarea"))) return;
    const tr = e.target.closest && e.target.closest("tr[data-peb]");
    if(tr) bukaLaci(tr.dataset.peb);
  });

  window.INVCase = {
    aktif:() => st.aktif, mulai, berhenti, terapkan, segarkan, info, ringkas, ringkasHitung, lolosFilter, urutan,
    bukaLaci, tutupLaci, simpanLaci, sheetCases, sheetRiwayat, kunciHasil, unduhTemplate, unggah,
    semua:() => Array.from(st.rows.values()), labelCase,
    _st:st   // untuk uji lokal
  };

  // pengguna sudah login sebelum berkas ini selesai dimuat
  if(typeof currentUser !== "undefined" && currentUser) mulai(currentUser);
})();
