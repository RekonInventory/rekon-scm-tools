/* GLT Rekon Suite — Outbound: case per baris rekonsiliasi (seperti Inbound).

   Dimuat outbound.html SESUDAH skrip utamanya dan memakai binding global milik halaman
   itu (supa, supaReady, currentUser, R, RUN, notes, adjust, notesMeta, adjMeta, noteKey,
   dataOf, sisiQty, ...). Aktif hanya bila SQL docs/sql/outbound_2026-10-13_01_cases.sql
   sudah dijalankan (RPC outbound_case_ping ada). Bila belum, halaman tetap memakai
   catatan per run seperti sebelumnya — tidak ada yang berubah.

   Perbedaan dengan catatan lama:
   * Case melekat pada BARIS (record key = rekon|nomor|tanggal), bukan pada run, jadi
     tetap ada di setiap pengecekan berikutnya tanpa perlu disalin.
   * Satu baris boleh punya beberapa case (nomor 01, 02, ...), masing-masing dengan
     status OPEN / IN PROGRESS / CLOSED, PIC, kategori, catatan, dan penyesuaian qty.
   * Simpan memakai cek versi (dua orang mengedit case yang sama -> yang kedua diberi
     tahu, tidak menimpa diam-diam). Jejak audit dicatat server dan tidak bisa diubah.
   * Penyesuaian "data pembanding belum tersedia" dievaluasi ulang otomatis setiap
     pengecekan: begitu datanya masuk, case ditutup dan bila masih ada selisih dibuat
     case lanjutan (case lanjutan TIDAK ikut dievaluasi ulang lagi).
   * notes/adjust/notesMeta/adjMeta milik halaman diisi ULANG dari case, sehingga kartu,
     saringan, eksepsi, dan ekspor yang sudah ada tetap bekerja tanpa diubah. */
(function(){
  "use strict";
  const WS = "default";
  const STATUS_CASE = ["OPEN", "IN PROGRESS", "CLOSED"];
  const LABEL_TIPE = {
    TIDAK_ADA_DI_LAPORAN:"Tidak ada di laporan", TIDAK_ADA_DI_SCM:"Tidak ada di SCM",
    TIDAK_ADA_DI_P3BET:"Tidak ada di P3BET", SELISIH_QTY:"Selisih qty", SELISIH_TANGGAL:"Selisih tanggal",
    SELISIH_QTY_TGL:"Selisih qty & tanggal", PEMBATALAN:"Pembatalan", OUTBOUND_HARI_INI:"Outbound hari ini",
    LAINNYA:"Lainnya"
  };
  const PILL_CASE = {"OPEN":"warn", "IN PROGRESS":"match-adj", "CLOSED":"ok"};
  const dua = n => String(n).padStart(2, "0");

  const st = {
    aktif:false, peran:"operator",
    rows:new Map(),        // id -> baris server (case aktif, belum dihapus)
    byKey:new Map(),       // record_key -> [baris] urut seq
    channel:null, tunda:null,
    laci:null,             // {key, edit:null|{id, version}, berubah:false}
    timeline:new Map()     // record_key -> [event]
  };

  /* ------------------------------------------------------------ util */
  function tipeDariStatus(s){
    switch(s){
      case "TIDAK ADA DI LAPORAN": return "TIDAK_ADA_DI_LAPORAN";
      case "TIDAK ADA DI SCM": return "TIDAK_ADA_DI_SCM";
      case "TIDAK ADA DI P3BET": return "TIDAK_ADA_DI_P3BET";
      case "SELISIH QTY, TGL OK": return "SELISIH_QTY";
      case "QTY OK, SELISIH TGL": return "SELISIH_TANGGAL";
      case "SELISIH QTY & TGL": return "SELISIH_QTY_TGL";
      case "PEMBATALAN": return "PEMBATALAN";
      case OUTBOUND_HARI_INI: return "OUTBOUND_HARI_INI";
      default: return "LAINNYA";
    }
  }
  function namaSaya(){ return currentUser ? displayNameFromUser(currentUser) : operator(); }
  function supervisor(){ return st.peran === "supervisor" || st.peran === "admin"; }
  function pesanGalat(e){ return (e && (e.message || e.error_description || e.details)) || String(e); }
  async function rpc(nama, args){
    const {data, error} = await supa.rpc(nama, args || {});
    if(error) throw error;
    return data;
  }
  function idCase(k, seq){ return k + "|" + dua(seq); }
  function labelCase(c){
    const nomor = c.nopen || c.kontainer || String(c.record_key || "").split("|")[1] || "?";
    return nomor + "-" + dua(c.seq);
  }
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
  function cariBaris(k){
    if(!R) return null;
    const tab = String(k).split("|")[0];
    if(tab !== "A" && tab !== "B") return null;
    const data = R[tab]; if(!data) return null;
    const r = data.rows.find(x => noteKey(tab, x) === k);
    return r ? {tab, r} : null;
  }
  function identitas(tab, r){
    const d = tglRow(r);
    return {
      record_key: noteKey(tab, r), tab,
      nopen: r.nomorDaftar !== null && r.nomorDaftar !== undefined && r.nomorDaftar !== "" ? String(r.nomorDaftar) : null,
      kontainer: r.kontainer ? String(r.kontainer).slice(0, 120) : null,
      row_date: d ? key(d) : null,
      brand: r.brand && r.brand !== "—" ? String(r.brand) : null
    };
  }
  function periodeKey(){ return R ? key(R.periodeLo) + ".." + key(R.periodeHi) : null; }
  const angka = v => (v === null || v === undefined || v === "") ? null : Number(v);

  /* daftar perubahan yang bisa dibaca manusia (untuk audit & pratinjau bulk) */
  function perubahan(lama, baru){
    const out = [];
    const teks = v => (v === null || v === undefined || v === "") ? "(kosong)" : String(v);
    if(!lama){
      out.push("Status " + baru.status);
      if(baru.remark) out.push("Catatan: " + baru.remark);
      if(baru.action_taken) out.push("Tindakan: " + baru.action_taken);
      if(Number(baru.qty_adj)) out.push("Qty penyesuaian " + fmtN(baru.qty_adj) + (baru.adj_side ? " (data belum tersedia)" : ""));
      return out;
    }
    if(lama.status !== baru.status) out.push("Status " + lama.status + " → " + baru.status);
    if((lama.remark || "") !== (baru.remark || "")) out.push("Catatan: " + teks(lama.remark) + " → " + teks(baru.remark));
    if((lama.action_taken || "") !== (baru.action_taken || "")) out.push("Tindakan: " + teks(lama.action_taken) + " → " + teks(baru.action_taken));
    if((lama.kategori || "") !== (baru.kategori || "")) out.push("Kategori: " + teks(lama.kategori) + " → " + teks(baru.kategori));
    if((lama.pic || "") !== (baru.pic || "")) out.push("PIC: " + teks(lama.pic) + " → " + teks(baru.pic));
    if((Number(lama.qty_adj) || 0) !== (Number(baru.qty_adj) || 0)) out.push("Qty penyesuaian " + fmtN(Number(lama.qty_adj) || 0) + " → " + fmtN(Number(baru.qty_adj) || 0));
    if((lama.qty_adj_note || "") !== (baru.qty_adj_note || "")) out.push("Alasan: " + teks(lama.qty_adj_note) + " → " + teks(baru.qty_adj_note));
    if((lama.group_id || "") !== (baru.group_id || "")) out.push("Group ID: " + teks(lama.group_id) + " → " + teks(baru.group_id));
    if(!!lama.adj_side !== !!baru.adj_side) out.push(baru.adj_side ? "Ditandai data pembanding belum tersedia" : "Tanda data belum tersedia dilepas");
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
      const out = await rpc("outbound_case_save", {p_case:row, p_expected_version:expected === undefined ? null : expected,
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
      const {data, error} = await supa.from("outbound_cases").select("*").eq("workspace_id", WS)
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
    st.channel = supa.channel("outbound-cases-" + Math.random().toString(36).slice(2, 8))
      .on("postgres_changes", {event:"*", schema:"public", table:"outbound_cases"}, p => {
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
        else renderRingkasanTanpaForm();
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
      try{ await rpc("outbound_case_ping"); }
      catch(e){ st.aktif = false; tandaiMode(); return false; }
      if(st.proses !== p) return false;              // sudah keluar / ganti pengguna
      st.aktif = true;
      try{ const r = await rpc("app_my_role"); if(r) st.peran = r; }catch(e){ st.peran = "operator"; }
      try{ await muat(); }
      catch(e){ gltToast("Gagal memuat case Outbound dari server: " + pesanGalat(e), "err"); }
      if(st.proses !== p) return false;
      langganan();
      tandaiMode();
      terapkan();
      return true;
    })();
    st.proses = p;
    return p;
  }
  function berhenti(){
    if(st.channel){ try{ supa.removeChannel(st.channel); }catch(e){} st.channel = null; }
    st.aktif = false; st.rows = new Map(); st.byKey = new Map(); st.timeline = new Map();
    st.proses = null; st.userId = null;
    tandaiMode();
  }
  function tandaiMode(){
    const b = document.getElementById("dClearRunNotes");
    if(b) b.hidden = st.aktif;
    const t = document.getElementById("btnBulkTpl"), u = document.getElementById("btnBulkUp");
    [t, u].forEach(x => { if(x) x.title = st.aktif ? x.dataset.judul : "Aktif setelah SQL case Outbound dijalankan"; });
    document.body.classList.toggle("ob-case-mode", st.aktif);
  }

  /* isi ulang notes/adjust/notesMeta/adjMeta milik halaman dari case */
  function terapkan(){
    if(!st.aktif) return;
    const n = {}, a = {}, nm = {}, am = {};
    st.byKey.forEach((list, k) => {
      const tab = k.split("|")[0];
      const berteks = list.filter(c => c.remark && String(c.remark).trim());
      if(berteks.length) n[k] = list.length === 1 ? berteks[0].remark : berteks.map(c => "#" + dua(c.seq) + " " + c.remark).join(" | ");
      const q = list.reduce((s, c) => s + (Number(c.qty_adj) || 0), 0);
      if(q) a[k] = q;
      const terbaru = list.slice().sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)))[0];
      const awal = list.slice().sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
      nm[k] = {id:list.map(labelCase).join(", "), runId:terbaru.run_id || "", recordKey:k, tab, text:n[k] || "",
               kategori:terbaru.kategori || "", status:statusGabungan(list), createdAt:awal.created_at,
               updatedAt:terbaru.updated_at, user:terbaru.user_name || ""};
      if(q){
        const g = list.find(c => c.group_id);
        const kena = list.filter(c => Number(c.qty_adj));
        am[k] = {id:kena.map(labelCase).join(", "), groupId:g ? g.group_id : "", runId:terbaru.run_id || "", recordKey:k, tab,
                 qty:q, reason:kena.filter(c => c.qty_adj_note).map(c => c.qty_adj_note).join("; "),
                 createdAt:awal.created_at, updatedAt:terbaru.updated_at, user:terbaru.user_name || ""};
      }
    });
    notes = n; adjust = a; notesMeta = nm; adjMeta = am;
  }

  /** turunkan ulang catatan dari case lalu gambar ulang kartu, tabel, dan hitungan */
  function segarkan(){
    terapkan();
    if(R) gambarUlangSemua();
    updateNoteCount();
  }

  /** info ringkas untuk kolom "Case" di tabel */
  function info(k){
    const list = st.byKey.get(k);
    if(!list || !list.length) return null;
    const terbuka = list.filter(c => c.status !== "CLOSED").length;
    const s = statusGabungan(list);
    const sub = list.length === 1 ? labelCase(list[0]) + (list[0].pic ? " · " + list[0].pic : "")
      : ["OPEN", "IN PROGRESS", "CLOSED"].map(x => { const n = list.filter(c => c.status === x).length; return n ? n + " " + x.toLowerCase() : ""; }).filter(Boolean).join(" · ");
    return {teks:s + (list.length > 1 ? " · " + list.length + " case" : ""), sub, kelas:PILL_CASE[s] || "", n:list.length, aktif:terbuka};
  }
  function ringkasHitung(){
    let open = 0, prog = 0, closed = 0;
    st.rows.forEach(c => { if(c.status === "OPEN") open++; else if(c.status === "IN PROGRESS") prog++; else closed++; });
    const adj = Object.keys(adjust).length;
    return fmtN(open) + " case open · " + fmtN(prog) + " in progress · " + fmtN(closed) + " closed" +
           (adj ? " · " + fmtN(adj) + " baris penyesuaian" : "");
  }

  /* ------------------------------------------------------------ evaluasi ulang "belum tersedia" */
  async function evaluasiUlang(){
    if(!st.aktif || !R) return null;
    const peta = new Map();
    ["A", "B"].forEach(t => { if(R[t]) R[t].rows.forEach(r => peta.set(noteKey(t, r), {t, r})); });
    const target = [];
    st.rows.forEach(c => {
      // hanya penyesuaian "belum tersedia" yang masih berlaku; case lanjutan (qty_adj 0) tidak ikut
      if(c.status === "CLOSED" || !c.adj_side || !Number(c.qty_adj) || c.qty_expected === null || c.qty_expected === undefined) return;
      const x = peta.get(c.record_key); if(!x) return;
      const q = sisiQty(x.t, x.r);
      const kosong = c.adj_side === "P3BET" ? q.p3betKosong : q.lawanKosong;
      if(kosong) return;      // data pembanding masih belum ada
      target.push({c, actual:c.adj_side === "P3BET" ? q.p3bet : q.lawan});
    });
    let tutup = 0, lanjut = 0, gagal = 0;
    for(const it of target){
      const c = it.c, exp = Number(c.qty_expected) || 0, act = Number(it.actual) || 0;
      const diff = exp - act, sesuai = diff === 0;
      const what = sesuai
        ? "Penyesuaian qty " + fmtN(exp) + " (data pembanding belum tersedia) sudah tersedia pada data terbaru sebesar " + fmtN(act) + ". Case ditutup otomatis."
        : "Penyesuaian qty " + fmtN(exp) + " dihapus karena data pembanding sudah tersedia (" + fmtN(act) + "); masih ada selisih " + fmtN(Math.abs(diff)) + ".";
      const row = Object.assign({}, c, {status:"CLOSED", qty_adj:0, qty_actual:act, qty_difference:diff,
        closed_at:nowIso(), closed_by:"sistem", updated_at:nowIso(),
        audit:(Array.isArray(c.audit) ? c.audit : []).concat([{at:nowIso(), by:"sistem", what}])});
      try{ await simpanSatu(row, c.version, {action:"SYSTEM_REEVALUATE"}); tutup++; }
      catch(e){ gagal++; continue; }   // konflik = orang lain sudah memprosesnya
      if(!sesuai){
        const seq = seqBerikut(c.record_key);
        const baru = {id:idCase(c.record_key, seq), record_key:c.record_key, tab:c.tab, seq, nopen:c.nopen, kontainer:c.kontainer,
          row_date:c.row_date, brand:c.brand, case_type:"SELISIH_QTY", kategori:c.kategori || "Selisih Qty", pic:c.pic, status:"OPEN",
          remark:"Selisih qty " + fmtN(diff) + " ditemukan otomatis setelah data pembanding tersedia (lanjutan case " + labelCase(c) + ").",
          qty_adj:0, adj_side:null, qty_expected:exp, qty_actual:act, qty_difference:diff,
          run_id:RUN ? RUN.runId : null, period_key:periodeKey(), created_at:nowIso(), updated_at:nowIso(),
          audit:[{at:nowIso(), by:"sistem", what:"Case lanjutan dari " + labelCase(c) + ": diharapkan " + fmtN(exp) + ", data terbaru " + fmtN(act) + "."}]};
        try{ await simpanSatu(baru, null, {action:"SYSTEM_REEVALUATE"}); lanjut++; }catch(e){ gagal++; }
      }
    }
    return {total:target.length, tutup, lanjut, gagal};
  }
  /** dipanggil showResults() setiap hasil pengecekan baru tampil */
  function setelahHasil(){
    if(!st.aktif) return;
    terapkan();
    evaluasiUlang().then(h => {
      if(!h || !h.total) return;
      segarkan();
      if(h.tutup || h.lanjut){
        jejak("EVALUASI ULANG CASE", "", "", h.tutup + " case 'belum tersedia' ditutup otomatis, " + h.lanjut + " case selisih lanjutan dibuat", "", "", "");
        persistRun();
      }
      gltToast("Penyesuaian \"data belum tersedia\": " + h.tutup + " case ditutup otomatis karena datanya sudah masuk" +
               (h.lanjut ? ", " + h.lanjut + " case selisih lanjutan dibuat" : "") + (h.gagal ? " (" + h.gagal + " dilewati karena sedang diubah orang lain)" : "") + ".",
               h.gagal ? "warn" : "ok", 9000);
    }).catch(e => gltToast("Evaluasi ulang penyesuaian gagal: " + pesanGalat(e), "err"));
  }

  /* ------------------------------------------------------------ panel detail (seperti Inbound) */
  const SECTIONS = {ringkasan:true, data:true, penjelasan:true, cases:true, timeline:false};
  const FLOW = [["OPEN", "Open", "danger"], ["IN PROGRESS", "In Progress", "warning"], ["CLOSED", "Closed", "success"]];
  const TIPE_URUT = ["TIDAK_ADA_DI_LAPORAN", "TIDAK_ADA_DI_SCM", "TIDAK_ADA_DI_P3BET", "SELISIH_QTY", "SELISIH_TANGGAL", "SELISIH_QTY_TGL",
                     "PEMBATALAN", "OUTBOUND_HARI_INI", "LAINNYA"];
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
  function bukaLaci(k){
    if(!cariBaris(k)) return;
    drKey = k;
    st.laci = {key:k, edit:null, berubah:false, dirty:false};
    renderLaci();
    $("#drawer").classList.add("on"); $("#drawer").setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("on");
    muatTimeline(k);
  }
  function tutupLaci(){ st.laci = null; }
  function renderRingkasanTanpaForm(){ /* form sedang dibuka: biarkan isiannya apa adanya */ }
  function tandaiBerubah(){
    if(!st.laci) return;
    st.laci.berubah = true;
    const el = document.getElementById("obcStale"); if(el) el.hidden = false;
  }
  /* selisih dengan total penyesuaian tertentu (rumus sama dengan selisihAkhir) */
  function selisihDenganAdj(tab, r, adj){
    const q = sisiQty(tab, r);
    return q.p3betKosong && !q.lawanKosong ? (q.p3bet + adj) - q.lawan : q.p3bet - (q.lawan + adj);
  }
  function nav(k, arah){
    if(!R) return null;
    const tab = k.split("|")[0];
    if(tab !== active) return null;
    const baris = filtered().map(x => noteKey(tab, x.r));
    const i = baris.indexOf(k);
    return i < 0 ? null : baris[i + arah] || null;
  }
  function seksi(kunci, judul, isi, hitung){
    const buka = SECTIONS[kunci];
    return '<section class="obd-sec"><h3><button type="button" class="obd-disc" data-obd-sec="' + kunci + '" aria-expanded="' + buka + '">' +
      '<span class="obd-chev">' + (buka ? "▾" : "▸") + "</span>" + esc(judul) + "</button>" +
      (hitung !== undefined ? '<span class="obd-count">' + hitung + "</span>" : "") + "</h3>" +
      '<div class="obd-body"' + (buka ? "" : " hidden") + ">" + isi + "</div></section>";
  }
  function kv(pasangan){
    return '<dl class="obd-kv">' + pasangan.filter(Boolean).map(p => "<div><dt>" + esc(p[0]) + "</dt><dd>" + p[1] + "</dd></div>").join("") + "</dl>";
  }
  function kartuCase(c, aktif){
    const f = FLOW.find(x => x[0] === c.status) || FLOW[0];
    const adj = Number(c.qty_adj) || 0;
    const la = terakhir(c);
    const infoAdj = [];
    if(adj) infoAdj.push("Penyesuaian qty <b>" + esc(fmtN(adj)) + "</b>" + (c.adj_side ? " · data pembanding belum tersedia (ditutup otomatis saat data masuk)" : "") +
      (c.qty_adj_note ? " · " + esc(c.qty_adj_note) : "") + (c.group_id ? " · group <b>" + esc(c.group_id) + "</b>" : ""));
    if(!c.adj_side && c.qty_expected !== null && c.qty_expected !== undefined)
      infoAdj.push("Diharapkan <b>" + esc(fmtN(c.qty_expected)) + "</b> · data terbaru <b>" + esc(fmtN(c.qty_actual)) + "</b> · selisih <b>" + esc(fmtN(c.qty_difference)) + "</b>");
    return '<li class="obd-case' + (aktif ? " is-active" : "") + '">' +
      '<div class="obd-case-top"><b class="mono">' + esc(labelCase(c)) + '</b>' +
        '<span class="obd-badge is-' + f[2] + '">' + esc(f[1]) + "</span>" +
        '<span class="obd-badge">' + esc(LABEL_TIPE[c.case_type] || c.case_type || "") + "</span></div>" +
      (c.remark ? '<p class="obd-remark">' + esc(c.remark) + "</p>" : '<p class="obd-remark obd-muted">(tanpa catatan)</p>') +
      (c.action_taken ? '<p class="obd-action">✓ Tindakan: ' + esc(c.action_taken) + "</p>" : "") +
      infoAdj.map(x => '<p class="obd-info">' + x + "</p>").join("") +
      '<div class="obd-case-meta"><span>PIC ' + esc(c.pic || "-") + "</span><span>umur " + esc(umur(c.created_at)) + "</span>" +
        "<span>diperbarui " + esc(fmtTs(c.updated_at)) + "</span>" + (la ? '<span class="obd-last" title="' + esc(la) + '">terakhir: ' + esc(la) + "</span>" : "") + "</div>" +
      '<div class="obd-case-act"><button type="button" class="btn mini" data-obc-edit="' + esc(c.id) + '"' + (aktif ? " disabled" : "") + ">" +
        (aktif ? "Sedang diedit" : "Buka / ubah") + "</button></div></li>";
  }
  function formEditor(L, tab, r, lama){
    const q = sisiQty(tab, r);
    const bisaBelum = q.lawanKosong || q.p3betKosong;
    const v = lama || {status:"OPEN", remark:"", action_taken:"", qty_adj:0, qty_adj_note:"", group_id:"", adj_side:null,
                       case_type:tipeDariStatus(r.status)};
    const belum = lama ? !!lama.adj_side : bisaBelum;
    const stale = lama && L.edit.version && st.rows.get(lama.id) && st.rows.get(lama.id).version > L.edit.version;
    const tipe = TIPE_URUT.map(t => '<option value="' + t + '"' + (t === (v.case_type || "LAINNYA") ? " selected" : "") + ">" + esc(LABEL_TIPE[t]) + "</option>").join("");
    return '<form class="obd-editor" id="obcForm" onsubmit="return false">' +
      '<div class="obd-alert" id="obcStale"' + (stale || L.berubah ? "" : " hidden") + ' role="alert">⚠ Case ini baru saja diubah oleh ' +
        esc(lama ? (st.rows.get(lama.id) || lama).user_name || "pengguna lain" : "pengguna lain") +
        '. Simpan akan memicu pemeriksaan konflik. <button type="button" class="btn mini" id="obcMuat">Muat ulang</button></div>' +
      '<div class="obd-field"><span class="obd-label">Status workflow</span><div class="obd-flow" role="radiogroup" id="obcFlow">' +
        FLOW.map((f, i) => (i ? '<span class="obd-flow-sep">›</span>' : "") +
          '<button type="button" role="radio" class="obd-flow-step is-' + f[2] + '" data-st="' + f[0] + '" aria-checked="' + (v.status === f[0]) + '" tabindex="' + (v.status === f[0] ? 0 : -1) + '">' + esc(f[1]) + "</button>").join("") +
      "</div></div>" +
      '<div class="obd-grid"><div class="obd-field"><label class="obd-label" for="obcTipe">Jenis case</label><select id="obcTipe" class="obd-input">' + tipe + "</select></div>" +
        '<div class="obd-field"><span class="obd-label">PIC (otomatis)</span><div class="obd-readonly" title="PIC otomatis = orang yang terakhir menyimpan case">☺ ' + esc(namaSaya()) + "</div></div></div>" +
      '<div class="obd-field"><label class="obd-label" for="obcRemark">Temuan / catatan (remark)</label><textarea id="obcRemark" class="obd-input" rows="4" maxlength="2000" placeholder="Apa temuannya, apa yang sudah dicek, hasilnya…">' + esc(v.remark || "") + "</textarea>" +
        '<span class="obd-hint">Fakta temuan & hasil pengecekan. Maks. 2000 karakter.</span></div>' +
      '<div class="obd-field"><label class="obd-label" for="obcAction">Tindakan yang diambil</label><input id="obcAction" class="obd-input" maxlength="300" value="' + esc(v.action_taken || "") + '" placeholder="mis. Konfirmasi ke tim gudang, koreksi di SCM"></div>' +
      '<fieldset class="obd-fieldset"><legend>Penyesuaian QTY</legend>' +
        '<p class="obd-hint">Data asli tidak diubah; penyesuaian hanya memengaruhi selisih akhir. Positif menambah sisi pembanding, negatif mengurangi.</p>' +
        '<div class="obd-grid"><div class="obd-field"><label class="obd-label" for="obcQty">Penyesuaian QTY</label><input id="obcQty" class="obd-input" inputmode="decimal" value="' + esc(Number(v.qty_adj) ? v.qty_adj : 0) + '"></div>' +
          '<div class="obd-field"><label class="obd-label" for="obcReason">Keterangan QTY</label><input id="obcReason" class="obd-input" maxlength="300" value="' + esc(v.qty_adj_note || "") + '" placeholder="alasan penyesuaian QTY"></div></div>' +
        (bisaBelum || belum ? '<label class="obd-check"><input type="checkbox" id="obcBelum"' + (belum ? " checked" : "") + "> Data pembanding belum tersedia — penyesuaian ditutup otomatis saat datanya masuk (kalau masih selisih, dibuat case lanjutan)</label>" : "") +
        '<div class="obd-field"><label class="obd-label" for="obcGroup">Adjustment Group ID <span class="obd-muted">(isi sama pada dua baris yang sebenarnya satu koreksi fisik)</span></label>' +
          '<input id="obcGroup" class="obd-input mono" placeholder="' + esc(grupBaris(tab, r) || "otomatis") + '" value="' + esc(v.group_id || "") + '"></div>' +
        '<div class="obd-preview" id="obcPreview" aria-live="polite"></div></fieldset>' +
      '<div class="obd-actions"><button type="button" class="btn primary" id="obcSimpan">' + (lama ? "Simpan perubahan" : "Buat case") + "</button>" +
        '<button type="button" class="btn" id="obcBatal">Batal</button><span class="obd-spacer"></span>' +
        (lama ? '<button type="button" class="btn danger" id="obcHapus">Hapus case</button>' : "") + "</div>" +
      '<p class="obd-meta">' + (lama ? "Case " + esc(labelCase(lama)) + " · dibuat " + esc(fmtTs(lama.created_at)) + (lama.created_by_name ? " oleh " + esc(lama.created_by_name) : "") +
        " · diperbarui " + esc(fmtTs(lama.updated_at)) + " · versi " + esc(lama.version) : "Case baru — belum tersimpan.") + "</p></form>";
  }
  function pratinjauSelisih(tab, r, lama){
    const el = document.getElementById("obcPreview"); if(!el) return;
    const input = document.getElementById("obcQty");
    const baru = Number(String(input.value).replace(",", ".")) || 0;
    const lain = (nilaiAdjust(tab, r) || 0) - (lama ? Number(lama.qty_adj) || 0 : 0);
    const q = sisiQty(tab, r);
    const awal = q.p3bet - q.lawan;
    const sebelum = selisihDenganAdj(tab, r, lain + (lama ? Number(lama.qty_adj) || 0 : 0));
    const sesudah = selisihDenganAdj(tab, r, lain + baru);
    el.innerHTML = "Selisih mentah: <b>" + esc(fmtN(awal)) + "</b> → selisih akhir dengan penyesuaian ini: <b class=\"" +
      (sesudah === 0 ? "obd-ok" : "obd-bad") + "\">" + esc(fmtN(sesudah)) + "</b>" +
      (baru !== (lama ? Number(lama.qty_adj) || 0 : 0) ? " <span class=\"obd-muted\">(sebelum diubah: " + esc(fmtN(sebelum)) + ")</span>" : "");
  }
  function renderLaci(){
    const L = st.laci; if(!L) return;
    const b = cariBaris(L.key);
    if(!b){ tutupLaci(); return; }
    const {tab, r} = b;
    const q = sisiQty(tab, r);
    const list = st.byKey.get(L.key) || [];
    const lama = L.edit && L.edit.id ? st.rows.get(L.edit.id) : null;
    if(L.edit && L.edit.id && !lama) L.edit = null;
    const lbl = tab === "A" ? "laporan" : "SCM";
    const namaLawan = tab === "A" ? "Laporan " + (r.sumber && r.sumber !== "—" ? r.sumber : "Adidas/Nike") : "Outbound SCM";
    let qa = 0; list.forEach(c => { if(c.status !== "CLOSED") qa += Number(c.qty_adj) || 0; });
    const kelas = KELAS_STATUS(statusEfektif(tab, r));
    const baris = filtered().map(x => noteKey(tab, x.r));
    const idx = tab === active ? baris.indexOf(L.key) : -1;
    $("#drKey").textContent = "Rekon " + (tab === "A" ? "1" : "2") + " · " + (tab === "A" ? "P3BET ↔ Laporan" : "P3BET ↔ SCM") + " · " + list.length + " case";
    $("#drTitle").textContent = "Nopen " + (r.nomorDaftar || r.kontainer || "(tanpa nomor)");
    const navHtml = '<span class="obd-nav"><button type="button" class="btn mini" data-obd-nav="-1"' + (idx <= 0 ? " disabled" : "") + ' title="Baris sebelumnya">▲</button> ' +
      '<button type="button" class="btn mini" data-obd-nav="1"' + (idx < 0 || idx >= baris.length - 1 ? " disabled" : "") + ' title="Baris berikutnya">▼</button></span>';
    const adjNote = qa ? '<div class="obd-adj">setelah penyesuaian: ' + esc(fmtN(selisihAkhir(tab, r))) + "</div>" : "";
    $("#drBody").innerHTML = '<div class="obd-detail">' +
      '<div class="obd-status"><span class="obd-badge is-' + (kelas === "match" ? "success" : kelas === "bad" ? "danger" : kelas === "today" ? "info" : kelas === "batal" ? "" : "warning") + '">' + esc(statusEfektif(tab, r)) + "</span>" + navHtml + "</div>" +
      seksi("ringkasan", "Ringkasan", kv([
        ["Nomor daftar", esc(r.nomorDaftar || "—")], ["Tgl daftar", esc(fmtD(r.tglDaftar || tglRow(r)) || "—")],
        ["Container", esc(r.kontainer || "—")], ["CLP", esc(r.clp || "—") + (r.clpSumber ? ' <span class="obd-muted">(' + esc(r.clpSumber) + ")</span>" : "")],
        ["Kategori", esc(r.brand || "—")], tab === "B" ? ["No job SCM", esc(r.job || "—")] : ["Tgl stuffing laporan", esc(fmtD(r.tglLap) || "—")],
        ["Status awal", esc(r.status)], ["Case", list.length ? list.length + " case (" + list.filter(c => c.status !== "CLOSED").length + " aktif)" : "Belum ada"]])) +
      seksi("data", "Perbandingan data",
        '<table class="obd-compare"><thead><tr><th></th><th>P3BET</th><th>' + esc(namaLawan) + '</th><th class="num">Selisih</th></tr></thead><tbody>' +
        '<tr><th>QTY</th><td class="num">' + (q.p3betKosong ? "—" : esc(fmtN(q.p3bet))) + '</td><td class="num">' + (q.lawanKosong ? "—" : esc(fmtN(q.lawan))) + "</td>" +
          '<td class="num"><span class="' + (q.p3bet - q.lawan === 0 ? "obd-ok" : "obd-bad") + '">' + esc(fmtN(q.p3bet - q.lawan)) + "</span>" + adjNote + "</td></tr>" +
        (tab === "A" ? '<tr><th>Tgl</th><td>' + esc(fmtD(r.tglDaftar) || "—") + "</td><td>" + esc(fmtD(r.tglLap) || "—") + '</td><td class="num">' + (r.selisihHari === null || r.selisihHari === undefined ? "—" : esc(r.selisihHari + " hari")) + "</td></tr>" :
          '<tr><th>Tgl</th><td>' + esc(fmtD(r.tglDaftar) || "—") + "</td><td>" + esc(fmtD(r.tglScm) || "—") + '</td><td class="num">—</td></tr>') +
        "</tbody></table>" + (r.shipper ? kv([["Shipper laporan", esc(r.shipper)]]) : "") + (r.exportir ? kv([["Exportir SCM", esc(r.exportir)]]) : "")) +
      seksi("penjelasan", "Penjelasan & tindakan", '<p class="obd-explain">' + esc(r.keterangan || "—") + "</p>" +
        (r.status === OUTBOUND_HARI_INI ? '<div class="obd-alert is-info">⏱ Outbound hari ini: sumber lain biasanya baru diperbarui besok, jadi baris ini tidak dihitung sebagai selisih.</div>' : "")) +
      seksi("cases", "Case & tindak lanjut",
        (list.length ? '<ul class="obd-case-list">' + list.map(c => kartuCase(c, lama && lama.id === c.id)).join("") + "</ul>" : '<p class="obd-muted">Belum ada case untuk baris ini.</p>') +
        (L.edit ? '<div class="obd-editor-wrap"><h4>' + (lama ? "Ubah case " + esc(labelCase(lama)) : "Case baru") + "</h4>" + formEditor(L, tab, r, lama) + "</div>"
                : '<button type="button" class="btn ' + (list.length ? "" : "primary") + '" id="obcTambah">+ Tambah case</button>'), list.length) +
      seksi("timeline", "Riwayat aktivitas (audit)", '<div id="obcTimeline">' + timelineHtml(L.key) + "</div>") +
      "</div>";
    pasangHandler(L, tab, r, lama);
  }
  function pasangHandler(L, tab, r, lama){
    const el = $("#drBody");
    el.querySelectorAll("[data-obd-sec]").forEach(x => x.addEventListener("click", () => {
      SECTIONS[x.dataset.obdSec] = !SECTIONS[x.dataset.obdSec]; renderLaci();
      if(x.dataset.obdSec === "timeline" && SECTIONS.timeline) muatTimeline(L.key);
    }));
    el.querySelectorAll("[data-obd-nav]").forEach(x => x.addEventListener("click", () => {
      const k = nav(L.key, Number(x.dataset.obdNav));
      if(k){ const dirty = L.dirty; if(dirty) gltToast("Perubahan yang belum disimpan dibuang.", "warn", 3000); bukaLaci(k); }
    }));
    el.querySelectorAll("[data-obc-edit]").forEach(x => x.addEventListener("click", () => {
      const c = st.rows.get(x.dataset.obcEdit); if(!c) return;
      st.laci.edit = {id:c.id, version:c.version}; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
      const f = document.getElementById("obcRemark"); if(f) f.focus();
    }));
    const tambah = document.getElementById("obcTambah");
    if(tambah) tambah.addEventListener("click", () => {
      st.laci.edit = {id:null, version:null}; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
      const f = document.getElementById("obcRemark"); if(f) f.focus();
    });
    const form = document.getElementById("obcForm");
    if(!form) return;
    const tandai = () => { st.laci.dirty = true; };
    form.addEventListener("input", tandai); form.addEventListener("change", tandai);
    const flow = document.getElementById("obcFlow");
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
    const qty = document.getElementById("obcQty");
    qty.addEventListener("input", () => pratinjauSelisih(tab, r, lama));
    pratinjauSelisih(tab, r, lama);
    document.getElementById("obcSimpan").addEventListener("click", simpanLaci);
    document.getElementById("obcBatal").addEventListener("click", () => { st.laci.edit = null; st.laci.berubah = false; st.laci.dirty = false; renderLaci(); });
    const muat = document.getElementById("obcMuat");
    if(muat) muat.addEventListener("click", () => {
      const cur = lama && st.rows.get(lama.id);
      st.laci.edit = cur ? {id:cur.id, version:cur.version} : null; st.laci.berubah = false; st.laci.dirty = false; renderLaci();
    });
    const hp = document.getElementById("obcHapus");
    if(hp && lama) hp.addEventListener("click", () => hapus(lama.id));
  }
  function bacaForm(){
    const v = id => { const el = document.getElementById(id); return el ? String(el.value).trim() : ""; };
    const qRaw = v("obcQty").replace(",", ".");
    const belum = document.getElementById("obcBelum");
    const flow = document.getElementById("obcFlow");
    return {status:(flow && flow.dataset.val) || "OPEN", tipe:v("obcTipe"), remark:v("obcRemark"), action:v("obcAction"),
            qty:qRaw === "" ? 0 : (Number(qRaw) || 0), qtyValid:qRaw === "" || !isNaN(Number(qRaw)),
            reason:v("obcReason"), group:v("obcGroup"), belum:!!(belum && belum.checked)};
  }
  /* susun baris case dari isian (form panel atau bulk upload) */
  function susunRow(k, tab, r, lama, f){
    const base = lama ? Object.assign({}, lama)
      : Object.assign(r ? identitas(tab, r) : {record_key:k, tab}, {seq:seqBerikut(k), case_type:tipeDariStatus(r ? r.status : ""),
                                                                    audit:[], created_at:nowIso()});
    base.id = idCase(base.record_key, base.seq);
    // PIC otomatis = orang yang menyimpan (sama dengan Inbound), bukan isian bebas; kategori lama dipertahankan
    const row = Object.assign(base, {status:f.status, pic:namaSaya(), remark:f.remark || null,
      case_type:f.tipe && LABEL_TIPE[f.tipe] ? f.tipe : base.case_type,
      action_taken:f.action || null, qty_adj:f.qty, qty_adj_note:f.reason || null, group_id:f.group || null,
      run_id:RUN ? RUN.runId : (base.run_id || null), period_key:periodeKey() || base.period_key || null, updated_at:nowIso()});
    if(f.kategori !== undefined) row.kategori = f.kategori || null;
    if(f.belum && f.qty){
      let sisi = "LAWAN";
      if(r){ const q = sisiQty(tab, r); sisi = q.lawanKosong ? "LAWAN" : (q.p3betKosong ? "P3BET" : (lama && lama.adj_side) || "LAWAN"); }
      else if(lama && lama.adj_side) sisi = lama.adj_side;
      row.adj_side = sisi; row.qty_expected = f.qty; row.qty_actual = null; row.qty_difference = null;
    }else if(lama && lama.adj_side){
      row.adj_side = null; row.qty_expected = null;
    }
    tandaiTutup(row, lama ? lama.status : null);
    return row;
  }
  async function simpanLaci(){
    const L = st.laci; if(!L) return;
    if(!L.edit){
      L.edit = {id:null, version:null}; L.berubah = false; renderLaci();
      const f = document.getElementById("obcRemark"); if(f) f.focus();
      return;
    }
    const b = cariBaris(L.key); if(!b) return;
    const f = bacaForm();
    if(!f.qtyValid){ gltToast("Qty penyesuaian harus berupa angka.", "warn"); return; }
    const lama = L.edit.id ? st.rows.get(L.edit.id) : null;
    if(L.edit.id && !lama){ gltToast("Case ini sudah tidak ada (mungkin dihapus orang lain).", "warn"); L.edit = null; renderLaci(); return; }
    if(!lama && !f.remark && !f.action && !f.qty && f.status === "OPEN"){
      gltToast("Case kosong tidak disimpan — isi catatan, status, tindakan, atau penyesuaian.", "warn"); return;
    }
    const row = susunRow(L.key, b.tab, b.r, lama, f);
    const ubah = perubahan(lama, row);
    if(lama && row.case_type !== lama.case_type) ubah.push("Jenis " + (LABEL_TIPE[lama.case_type] || lama.case_type) + " → " + (LABEL_TIPE[row.case_type] || row.case_type));
    // PIC berganti otomatis ke penyimpan; itu saja tidak dihitung sebagai perubahan
    if(lama && !ubah.some(x => x.indexOf("PIC:") !== 0)){ gltToast("Tidak ada perubahan.", "warn"); L.edit = null; L.dirty = false; renderLaci(); return; }
    row.audit = (lama && Array.isArray(lama.audit) ? lama.audit : []).concat([{at:nowIso(), by:namaSaya(),
      what:(lama ? "" : "Case dibuat: ") + ubah.join("; ")}]);
    await kirim(row, lama ? L.edit.version : null, b.tab, L.key, lama, ubah, {});
  }
  async function kirim(row, expected, tab, k, lama, ubah, opts){
    const s = document.getElementById("obcSimpan") || $("#drSave"); s.disabled = true;
    try{
      const hasil = await simpanSatu(row, expected, opts);
      jejak(lama ? "CASE DIUBAH" : "CASE DIBUAT", tab, k, "Case " + labelCase(hasil), lama ? lama.status : "", hasil.status, ubah.join("; "));
      persistRun();
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
          s.disabled = false;
          return kirim(row, e.current ? e.current.version : expected, tab, k, lama, ubah, {force:true});
        }
      }else{
        gltToast("Gagal menyimpan case: " + pesanGalat(e), "err", 10000);
      }
    }finally{ s.disabled = false; }
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
      const out = await rpc("outbound_case_soft_delete", {p_id:id, p_expected_version:c.version, p_reason:alasan || null});
      if(out.status === "ok" || out.status === "deleted" || out.status === "not_found"){
        st.rows.delete(id); indeks();
        jejak("CASE DIHAPUS", c.tab, c.record_key, "Case " + labelCase(c), c.status, "(dihapus)", alasan || "");
        persistRun();
      }else{
        if(out.current){ pasang(out.current); indeks(); }
        gltToast(pesanKonflik(out.current) + " Periksa lalu coba hapus lagi.", "warn", 9000);
      }
    }catch(e){ gltToast("Gagal menghapus case: " + pesanGalat(e), "err"); }
    if(st.laci){ if(st.laci.edit && st.laci.edit.id === id) st.laci.edit = null; st.timeline.delete(c.record_key); }
    segarkan(); renderLaci(); if(st.laci) muatTimeline(st.laci.key);
  }

  /* timeline audit server untuk satu baris */
  const LABEL_AKSI = {CREATE:"Dibuat", UPDATE:"Diubah", STATUS_CHANGE:"Status diubah", CLOSE:"Ditutup", REOPEN:"Dibuka lagi",
    SOFT_DELETE:"Dihapus", RESTORE:"Dipulihkan", FORCE_OVERWRITE:"Ditimpa (supervisor)", SYSTEM_REEVALUATE:"Evaluasi ulang otomatis",
    BULK_UPLOAD:"Bulk upload", MIGRATE_LEGACY:"Migrasi dari catatan lama"};
  async function muatTimeline(k){
    if(st.timeline.has(k)){ const el = document.getElementById("obcTimeline"); if(el) el.innerHTML = timelineHtml(k); return; }
    try{
      const {data, error} = await supa.from("outbound_case_events").select("*").eq("workspace_id", WS).eq("record_key", k)
        .order("created_at", {ascending:true}).limit(300);
      if(error) throw error;
      st.timeline.set(k, data || []);
    }catch(e){ st.timeline.set(k, {galat:pesanGalat(e)}); }
    if(st.laci && st.laci.key === k){ const el = document.getElementById("obcTimeline"); if(el) el.innerHTML = timelineHtml(k); }
  }
  function timelineHtml(k){
    const ev = st.timeline.get(k);
    if(!ev) return '<div style="color:var(--text-muted);padding:8px 0">Memuat…</div>';
    if(ev.galat) return '<div style="color:var(--danger)">Gagal memuat riwayat: ' + esc(ev.galat) + "</div>";
    if(!ev.length) return '<div style="color:var(--text-muted);padding:8px 0">Belum ada riwayat.</div>';
    return ev.slice().reverse().map(e => {
      const isi = Array.isArray(e.audit_entries) && e.audit_entries.length
        ? e.audit_entries.map(a => a.what).filter(Boolean).join(" · ")
        : (e.changed_fields || []).join(", ");
      const nomor = String(e.case_id || "").split("|").pop();
      return "<div><time>" + esc(fmtTs(e.created_at)) + " · " + esc(e.actor_name || "sistem") + "</time><em>" +
        esc(LABEL_AKSI[e.action] || e.action) + " — case " + esc(nomor) + (isi ? "<br>" + esc(isi) : "") + "</em></div>";
    }).join("");
  }

  /* ------------------------------------------------------------ ekspor */
  function barisCase(c, adaDiHasil){
    const p = String(c.record_key).split("|");
    return [labelCase(c), c.id, "Rekon " + (c.tab === "A" ? "1" : "2"), c.nopen || p[1] || "", c.kontainer || "",
      c.row_date ? fmtD(toDate(c.row_date)) : "", LABEL_TIPE[c.case_type] || c.case_type || "", c.status, c.pic || "", c.kategori || "",
      c.remark || "", c.action_taken || "", Number(c.qty_adj) || "", c.qty_adj_note || "", c.group_id || "",
      c.adj_side ? "Ya (" + c.adj_side + ")" : "", angka(c.qty_expected) === null ? "" : Number(c.qty_expected),
      angka(c.qty_actual) === null ? "" : Number(c.qty_actual), angka(c.qty_difference) === null ? "" : Number(c.qty_difference),
      fmtTs(c.created_at), c.created_by_name || "", fmtTs(c.updated_at), c.user_name || "", c.version,
      c.status === "CLOSED" ? fmtTs(c.closed_at) : "", c.closed_by || "", adaDiHasil ? "Ya" : "Tidak"];
  }
  const KOLOM_CASE = ["Case","Case ID","Rekon","Nomor Daftar","Container","Tanggal","Tipe","Status","PIC","Kategori","Catatan","Tindakan",
    "Qty Penyesuaian","Alasan","Group ID","Data Belum Tersedia","Qty Diharapkan","Qty Data Terbaru","Selisih","Dibuat","Dibuat Oleh",
    "Diubah","Diubah Oleh","Versi","Ditutup","Ditutup Oleh","Ada di Hasil Ini"];
  function sheetCases(keys){
    const ada = new Set();
    if(R) ["A", "B"].forEach(t => { if(R[t]) R[t].rows.forEach(r => ada.add(noteKey(t, r))); });
    const L = [KOLOM_CASE];
    const pilih = keys ? new Set(keys) : null;
    Array.from(st.rows.values()).filter(c => !pilih || pilih.has(c.record_key))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .forEach(c => L.push(barisCase(c, ada.has(c.record_key))));
    return wsDari(L, [14, 26, 9, 14, 16, 11, 20, 12, 14, 18, 44, 30, 10, 24, 14, 14, 10, 10, 9, 16, 14, 16, 14, 6, 16, 14, 10]);
  }
  async function sheetRiwayat(keys){
    const L = [["Waktu","Case","Rekon","Nomor Daftar","Aksi","Field Berubah","Isi Audit","Oleh","Versi Case"]];
    const daftar = Array.from(new Set(keys || [])).filter(Boolean);
    const ev = [];
    for(let i = 0; i < daftar.length; i += 150){
      const {data, error} = await supa.from("outbound_case_events").select("*").eq("workspace_id", WS)
        .in("record_key", daftar.slice(i, i + 150)).order("created_at", {ascending:true}).limit(5000);
      if(error) throw error;
      ev.push.apply(ev, data || []);
    }
    ev.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || (a.id - b.id));
    ev.forEach(e => {
      const p = String(e.record_key || "").split("|");
      L.push([fmtTs(e.created_at), (e.nopen || p[1] || "") + "-" + String(e.case_id || "").split("|").pop(),
        e.tab ? "Rekon " + (e.tab === "A" ? "1" : "2") : "", e.nopen || p[1] || "", LABEL_AKSI[e.action] || e.action,
        (e.changed_fields || []).join(", "),
        Array.isArray(e.audit_entries) ? e.audit_entries.map(a => a.what).filter(Boolean).join(" · ") : "",
        e.actor_name || "", e.case_version || ""]);
    });
    return wsDari(L, [16, 14, 9, 14, 22, 30, 60, 16, 8]);
  }
  function kunciHasil(){
    const s = [];
    if(R) ["A", "B"].forEach(t => { if(R[t]) R[t].rows.forEach(r => { const k = noteKey(t, r); if(st.byKey.has(k)) s.push(k); }); });
    return s;
  }

  /* ------------------------------------------------------------ bulk upload */
  const KOLOM_TPL = ["Record Key","Rekon","Nomor Daftar","Tgl Daftar","Nomor Container","CLP","No Job SCM","Status Rekon",
    "Qty P3BET","Qty Pembanding","Keterangan","Case ID","Status Case","Kategori","PIC","Catatan","Tindakan",
    "Qty Penyesuaian","Alasan Penyesuaian","Data Belum Tersedia (Y/N)"];
  function unduhTemplate(){
    if(!st.aktif){ gltToast("Fitur case Outbound belum aktif: SQL docs/sql/outbound_2026-10-13_01_cases.sql belum dijalankan.", "warn", 9000); return; }
    if(!R){ gltToast("Jalankan pengecekan dulu supaya ada baris untuk template.", "warn"); return; }
    if(active !== "A" && active !== "B"){ gltToast("Pilih tab Rekon 1 atau Rekon 2 dulu (tab Data SO tidak punya case).", "warn"); return; }
    const rows = filtered().map(x => x.r);
    if(!rows.length){ gltToast("Tidak ada baris yang tampil dengan filter saat ini.", "warn"); return; }
    const L = [KOLOM_TPL];
    rows.forEach(r => {
      const k = noteKey(active, r), q = sisiQty(active, r);
      const list = st.byKey.get(k) || [];
      const c = list.filter(x => x.status !== "CLOSED").slice(-1)[0] || null;
      L.push([k, "Rekon " + (active === "A" ? "1" : "2"), r.nomorDaftar || "", fmtD(r.tglDaftar || tglRow(r)), r.kontainer || "", r.clp || "",
        r.job || "", statusEfektif(active, r), q.p3betKosong ? "" : q.p3bet, q.lawanKosong ? "" : q.lawan, r.keterangan || "",
        c ? labelCase(c) : "", c ? c.status : "", c ? (c.kategori || "") : "", c ? (c.pic || "") : "", c ? (c.remark || "") : "",
        c ? (c.action_taken || "") : "", c && Number(c.qty_adj) ? Number(c.qty_adj) : "", c ? (c.qty_adj_note || "") : "",
        c ? (c.adj_side ? "Y" : "N") : ""]);
    });
    const P = [["PETUNJUK BULK UPLOAD CASE OUTBOUND"], [],
      ["1", "Isi kolom Status Case, Kategori, PIC, Catatan, Tindakan, Qty Penyesuaian, Alasan Penyesuaian, dan Data Belum Tersedia di sheet CASE."],
      ["2", "Case ID terisi = case yang sudah ada akan DIUBAH. Case ID kosong = dibuat case BARU (kalau ada isian)."],
      ["3", "Baris tanpa isian dan tanpa Case ID dilewati. Kolom lain (Record Key s.d. Keterangan) hanya informasi, jangan diubah."],
      ["4", "Kalau Record Key kosong, baris dicari lewat Nomor Daftar (+ Tgl Daftar), No Job SCM, atau Nomor Container pada Rekon yang sama."],
      ["5", "Status Case: OPEN, IN PROGRESS, atau CLOSED. Kosong = OPEN untuk case baru / tidak berubah untuk case lama."],
      ["6", "PIC otomatis = nama pengguna yang mengunggah (sama seperti Inbound). Kolom PIC di template hanya informasi."],
      ["7", "Data Belum Tersedia = Y bila qty pembanding memang belum ada; penyesuaian ditutup otomatis saat datanya masuk."],
      ["8", "Sebelum disimpan akan tampil pratinjau. Case yang diubah orang lain sesudah template diunduh tidak ditimpa (dilaporkan sebagai bentrok)."],
      [], ["Diunduh", new Date().toLocaleString("id-ID")], ["Oleh", namaSaya()], ["Run", RUN ? RUN.runId : "-"],
      ["Tabel", TABLES[active].label], ["Jumlah baris", rows.length]];
    const D = [["Status Case"]].concat(STATUS_CASE.map(x => [x])).concat([[], ["Kategori"]]).concat(KATEGORI_CATATAN.map(x => [x]));
    const wb = GLTBulk.tulisWorkbook(XLSX, [
      {nama:"CASE", baris:L, lebar:[24, 9, 12, 11, 16, 12, 16, 22, 10, 12, 40, 12, 13, 18, 14, 40, 30, 12, 24, 12]},
      {nama:"PETUNJUK", baris:P, lebar:[12, 120]},
      {nama:"PILIHAN", baris:D, lebar:[24]}]);
    GLTBulk.unduhXlsx(XLSX, wb, "Template_Case_Outbound_" + (active === "A" ? "Rekon1" : "Rekon2") + "_" + stamp() + ".xlsx");
    jejak("TEMPLATE CASE DIUNDUH", active, "", rows.length + " baris", "", "", "");
    persistRun();
  }
  function normStatus(s){
    const t = String(s || "").trim().toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if(!t) return "";
    if(t === "OPEN" || t === "BUKA" || t === "BARU") return "OPEN";
    if(t === "IN PROGRESS" || t === "INPROGRESS" || t === "PROGRESS" || t === "PROSES" || t === "DIPROSES") return "IN PROGRESS";
    if(t === "CLOSED" || t === "CLOSE" || t === "SELESAI" || t === "TUTUP" || t === "DONE") return "CLOSED";
    return null;
  }
  function normYa(s){ return /^(Y|YA|YES|1|TRUE|BENAR)$/i.test(String(s || "").trim()); }
  function parseQty(s){
    if(s === null || s === undefined || String(s).trim() === "") return {ok:true, v:0};
    if(typeof s === "number") return {ok:isFinite(s), v:s};
    const t = String(s).trim().replace(/\s/g, "");
    let n;
    if(/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""));                         // 7.700 = tujuh ribu tujuh ratus
    else if(/^-?\d{1,3}(\.\d{3})*,\d+$/.test(t)) n = Number(t.replace(/\./g, "").replace(",", "."));  // 1.234,5
    else if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) n = Number(t.replace(/,/g, ""));                // 1,234.5
    else if(/^-?\d+,\d+$/.test(t)) n = Number(t.replace(",", "."));                                  // 7,5
    else n = Number(t);
    return {ok:t !== "" && !isNaN(n) && isFinite(n), v:n};
  }
  function tabDari(teks, rk){
    const t = String(teks || "").toUpperCase();
    if(/(^|\s)(1|A)$|REKON\s*1/.test(t)) return "A";
    if(/(^|\s)(2|B)$|REKON\s*2/.test(t)) return "B";
    const p = String(rk || "").split("|")[0];
    return p === "A" || p === "B" ? p : active;
  }
  function cariBarisBulk(tab, rk, nopen, tgl, job, ctr){
    if(!R || !R[tab]) return {galat:"Rekon " + (tab === "A" ? "1" : "2") + " tidak ada di hasil yang sedang tampil"};
    const rows = R[tab].rows;
    if(rk){
      const r = rows.find(x => noteKey(tab, x) === rk);
      if(r) return {r};
      return {k:rk, tidakAda:true};
    }
    let kand = [];
    if(nopen){
      const n = normNopen(nopen);
      kand = rows.filter(x => normNopen(x.nomorDaftar) === n);
      if(tgl && kand.length > 1){ const d = toDate(tgl); const kd = d ? key(d) : ""; kand = kand.filter(x => key(tglRow(x)) === kd); }
    }else if(job && tab === "B"){
      const j = String(job).trim().toUpperCase();
      kand = rows.filter(x => String(x.job || "").toUpperCase().split(/;\s*/).indexOf(j) >= 0);
    }else if(ctr){
      const c = normCtr(ctr);
      kand = rows.filter(x => normCtr(x.kontainer) === c);
    }else return {galat:"Tidak ada Record Key, Nomor Daftar, No Job SCM, atau Nomor Container"};
    if(kand.length === 1) return {r:kand[0]};
    if(!kand.length) return {galat:"Baris tidak ditemukan di hasil yang sedang tampil"};
    return {galat:"Cocok dengan " + kand.length + " baris; isi Record Key atau Tgl Daftar supaya pasti"};
  }
  async function unggah(file){
    if(!st.aktif){ gltToast("Fitur case Outbound belum aktif: SQL docs/sql/outbound_2026-10-13_01_cases.sql belum dijalankan.", "warn", 9000); return; }
    if(!R){ gltToast("Jalankan pengecekan dulu, lalu unggah template.", "warn"); return; }
    let t;
    try{ t = await GLTBulk.bacaTemplate(file, XLSX, {sheet:["CASE", "TEMPLATE"], wajib:["Catatan"]}); }
    catch(e){ gltToast(pesanGalat(e), "err", 10000); return; }
    const K = n => GLTBulk.cariKolom(t.header, n), V = GLTBulk.nilai;
    const kol = {key:K("Record Key"), rekon:K("Rekon"), nopen:K(["Nomor Daftar", "NOPEN", "No Daftar"]), tgl:K(["Tgl Daftar", "Tanggal"]),
      ctr:K(["Nomor Container", "Container"]), job:K(["No Job SCM", "Job", "Job Number"]), id:K(["Case ID", "Case"]),
      status:K(["Status Case"]), kat:K("Kategori"), pic:K("PIC"), remark:K("Catatan"), action:K("Tindakan"),
      qty:K(["Qty Penyesuaian", "Adjust Qty"]), reason:K(["Alasan Penyesuaian", "Alasan"]), belum:K(["Data Belum Tersedia (Y/N)", "Data Belum Tersedia"])};
    const rencana = [];
    const seqPakai = new Map();      // record_key -> seq berikut (beberapa case baru untuk baris yang sama)
    const idPakai = new Set();
    t.baris.forEach(row => {
      const p = {baris:row._baris, aksi:"", pesan:"", label:"", nomor:V(row, kol.nopen) || V(row, kol.ctr)};
      rencana.push(p);
      const isian = {status:V(row, kol.status), kat:V(row, kol.kat), pic:V(row, kol.pic), remark:V(row, kol.remark),
        action:V(row, kol.action), qty:kol.qty ? row[kol.qty] : null, reason:V(row, kol.reason), belum:V(row, kol.belum)};
      const caseId = V(row, kol.id);
      const qtyDiisi = isian.qty !== null && isian.qty !== undefined && String(isian.qty).trim() !== "";
      const adaIsian = isian.status || isian.kat || isian.remark || isian.action || qtyDiisi || isian.reason;
      const keyRaw = V(row, kol.key);
      const tab = tabDari(V(row, kol.rekon), keyRaw);
      p.rekon = "Rekon " + (tab === "A" ? "1" : "2");
      if(!caseId && !adaIsian){ p.aksi = "LEWAT"; p.pesan = "tanpa isian"; p._kelas = "skip"; return; }
      const st_ = normStatus(isian.status);
      if(st_ === null){ p.aksi = "GALAT"; p.pesan = "Status Case tidak dikenal: " + isian.status; p._kelas = "bad"; return; }
      const q = parseQty(isian.qty);
      if(!q.ok){ p.aksi = "GALAT"; p.pesan = "Qty Penyesuaian bukan angka: " + isian.qty; p._kelas = "bad"; return; }
      const cari = cariBarisBulk(tab, keyRaw, V(row, kol.nopen), row[kol.tgl], V(row, kol.job), V(row, kol.ctr));
      let lama = null, k, r = null;
      if(cari.r){ r = cari.r; k = noteKey(tab, r); }
      else if(cari.tidakAda) k = cari.k;
      else { p.aksi = "GALAT"; p.pesan = cari.galat; p._kelas = "bad"; return; }
      p.nomor = r ? (r.nomorDaftar || r.kontainer || "") : (k.split("|")[1] || "");
      if(caseId){
        lama = Array.from(st.rows.values()).find(c => c.id === caseId || (c.record_key === k && labelCase(c) === caseId)) ||
               (st.byKey.get(k) || []).find(c => labelCase(c) === caseId || dua(c.seq) === caseId.replace(/^.*-/, "")) || null;
        if(!lama){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " tidak ditemukan (mungkin sudah dihapus)"; p._kelas = "bad"; return; }
        if(lama.record_key !== k){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " milik baris lain"; p._kelas = "bad"; return; }
        if(idPakai.has(lama.id)){ p.aksi = "GALAT"; p.pesan = "Case ID " + caseId + " muncul lebih dari sekali di berkas"; p._kelas = "bad"; return; }
        idPakai.add(lama.id);
      }else if(!r){ p.aksi = "GALAT"; p.pesan = "Baris tidak ada di hasil yang sedang tampil; case baru hanya bisa dibuat untuk baris yang tampil"; p._kelas = "bad"; return; }
      const f = {status:st_ || (lama ? lama.status : "OPEN"), kategori:isian.kat || (lama ? lama.kategori || "" : ""),
        remark:kol.remark ? isian.remark : (lama ? lama.remark || "" : ""),
        action:kol.action ? isian.action : (lama ? lama.action_taken || "" : ""), qty:kol.qty ? q.v : (lama ? Number(lama.qty_adj) || 0 : 0),
        reason:kol.reason ? isian.reason : (lama ? lama.qty_adj_note || "" : ""), group:lama ? lama.group_id || "" : "",
        belum:kol.belum && isian.belum ? normYa(isian.belum) : !!(lama && lama.adj_side)};
      if(!lama){
        const s = seqPakai.has(k) ? seqPakai.get(k) : seqBerikut(k);
        seqPakai.set(k, s + 1);
        const tmp = susunRow(k, tab, r, null, f);
        tmp.seq = s; tmp.id = idCase(k, s);
        p.row = tmp; p.expected = null; p.aksi = "BARU"; p.label = labelCase(tmp);
        p.pesan = perubahan(null, tmp).join("; "); p._kelas = "";
      }else{
        const tmp = susunRow(k, tab, r, lama, f);
        const ubah = perubahan(lama, tmp);
        p.label = labelCase(lama);
        if(!ubah.some(x => x.indexOf("PIC:") !== 0)){ p.aksi = "SAMA"; p.pesan = "tidak ada perubahan"; p._kelas = "skip"; return; }
        p.row = tmp; p.expected = lama.version; p.aksi = "UBAH"; p.pesan = ubah.join("; "); p.lama = lama;
      }
      p.row.audit = (p.lama && Array.isArray(p.lama.audit) ? p.lama.audit : []).concat([{at:nowIso(), by:namaSaya(),
        what:"Bulk upload (" + file.name + " baris " + p.baris + "): " + p.pesan}]);
      p.tab = tab; p.k = k;
    });
    const hitung = a => rencana.filter(x => x.aksi === a).length;
    const nBaru = hitung("BARU"), nUbah = hitung("UBAH");
    const setuju = await GLTBulk.pratinjau({
      judul:"Pratinjau bulk upload case — " + file.name,
      ringkasan:[{label:"case baru", nilai:nBaru, kelas:"ok"}, {label:"case diubah", nilai:nUbah, kelas:"ok"},
        {label:"tanpa perubahan", nilai:hitung("SAMA")}, {label:"dilewati (kosong)", nilai:hitung("LEWAT")},
        {label:"galat", nilai:hitung("GALAT"), kelas:hitung("GALAT") ? "bad" : ""}],
      catatan:"Baris galat tidak disimpan. Case yang diubah orang lain sesudah pratinjau ini tidak akan ditimpa.",
      kolom:[{label:"Baris", key:"baris"}, {label:"Rekon", key:"rekon"}, {label:"Nomor", key:"nomor"}, {label:"Case", key:"label"},
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
        hasil = await rpc("outbound_case_save_many", {p_items:potong.map(x => ({case:Object.assign({}, x.row, {workspace_id:WS}),
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
    jejak("BULK UPLOAD CASE", active, "", sukses + " tersimpan, " + bentrok + " bentrok, " + galat + " galat", "", "", file.name);
    persistRun();
    const lapor = await gltChoice("Bulk upload selesai: " + sukses + " case tersimpan" + (bentrok ? ", " + bentrok + " bentrok (diubah orang lain, tidak ditimpa)" : "") +
      (galat ? ", " + galat + " galat" : "") + ".", [{label:"Tutup", value:false}, {label:"Unduh laporan", value:true, primary:true}]);
    if(lapor){
      const L = [["Baris","Rekon","Nomor","Case","Aksi","Hasil","Keterangan"]];
      rencana.forEach(x => L.push([x.baris, x.rekon || "", x.nomor || "", x.hasilPesan && x.hasil === "TERSIMPAN" ? x.hasilPesan : (x.label || ""),
        x.aksi, x.hasil || (x.aksi === "GALAT" ? "GALAT" : "-"), x.hasil && x.hasil !== "TERSIMPAN" ? x.hasilPesan : x.pesan]));
      GLTBulk.unduhXlsx(XLSX, GLTBulk.tulisWorkbook(XLSX, [{nama:"HASIL", baris:L, lebar:[7, 9, 14, 14, 8, 11, 90]}]),
        "Hasil_Bulk_Case_Outbound_" + stamp() + ".xlsx");
    }
  }

  // gaya panel detail case (meniru panel detail Inbound)
  const css = document.createElement("style");
  css.textContent =
    "body.ob-case-mode .drawer{width:min(600px,100%)}" +
    "body.ob-case-mode .drawer-foot{display:none}" +
    "body.ob-case-mode .drawer-body{padding:14px 16px 28px;background:var(--surface-muted,#F8FAFC)}" +
    "body.ob-case-mode th.nodisp,body.ob-case-mode td.nodisp{display:none}" +
    "body.ob-case-mode #tablewrap tbody tr{cursor:pointer}" +
    "td.casecell .oc-sub{display:block;font-family:var(--mono);font-size:10.5px;color:var(--text-muted,#64748B);margin-top:2px;white-space:nowrap}" +
    ".obd-detail{display:flex;flex-direction:column;gap:10px;font-family:var(--sans,inherit)}" +
    ".obd-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
    ".obd-nav{margin-left:auto;display:inline-flex;gap:4px}" +
    ".obd-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;border:1px solid var(--border,#E2E8F0);background:var(--surface,#fff);font-size:11.5px;font-weight:600;color:var(--text-secondary,#475569)}" +
    ".obd-badge.is-danger{background:var(--danger-bg,#FEF2F2);border-color:var(--danger-border,#FECACA);color:#991B1B}" +
    ".obd-badge.is-warning{background:var(--warning-bg,#FFFBEB);border-color:var(--warning-border,#FDE68A);color:#92400E}" +
    ".obd-badge.is-success{background:var(--success-bg,#F0FDF4);border-color:var(--success-border,#BBF7D0);color:#166534}" +
    ".obd-badge.is-info{background:var(--info-bg,#ECFEFF);border-color:var(--info-border,#A5F3FC);color:#155E75}" +
    ".obd-sec{border:1px solid var(--border,#E2E8F0);border-radius:10px;background:var(--surface,#fff)}" +
    ".obd-sec>h3{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;font-size:13px}" +
    ".obd-disc{flex:1;display:inline-flex;align-items:center;gap:6px;background:none;border:0;padding:4px 2px;cursor:pointer;font:inherit;font-weight:600;color:var(--text,#0F172A);text-align:left}" +
    ".obd-disc:hover{color:var(--primary,#2563EB)}" +
    ".obd-count{font-family:var(--mono);font-size:11px;color:var(--text-muted,#64748B)}" +
    ".obd-body{padding:4px 12px 12px;border-top:1px solid var(--border-soft,#F1F5F9)}" +
    ".obd-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 16px;margin:8px 0 0}" +
    ".obd-kv dt{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B)}" +
    ".obd-kv dd{margin:1px 0 0;font-size:13px;word-break:break-word}" +
    ".obd-compare{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}" +
    ".obd-compare th,.obd-compare td{padding:6px 8px;border-bottom:1px solid var(--border-soft,#F1F5F9);text-align:left;vertical-align:top}" +
    ".obd-compare thead th{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B);background:var(--surface-muted,#F8FAFC)}" +
    ".obd-compare tbody th{font-weight:600;color:var(--text-secondary,#475569)}" +
    ".obd-compare .num{text-align:right;font-family:var(--mono)}" +
    ".obd-adj{font-size:10.5px;color:var(--info,#0E7490)}" +
    ".obd-ok{color:var(--success,#15803D)}.obd-bad{color:var(--danger,#B91C1C);font-weight:600}" +
    ".obd-muted{color:var(--text-muted,#64748B)}" +
    ".obd-explain{margin:8px 0 0;font-size:13px;line-height:1.5}" +
    ".obd-alert{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;border:1px solid var(--warning-border,#FDE68A);background:var(--warning-bg,#FFFBEB);color:#92400E;font-size:12.5px;margin:8px 0}" +
    ".obd-alert.is-info{border-color:var(--info-border,#A5F3FC);background:var(--info-bg,#ECFEFF);color:#155E75}" +
    ".obd-case-list{list-style:none;margin:8px 0 10px;padding:0;display:flex;flex-direction:column;gap:8px}" +
    ".obd-case{border:1px solid var(--border,#E2E8F0);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:5px}" +
    ".obd-case.is-active{border-color:var(--primary,#2563EB);box-shadow:0 0 0 3px var(--primary-soft,#DBEAFE)}" +
    ".obd-case-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
    ".obd-remark{margin:0;font-size:13px;white-space:pre-line}" +
    ".obd-action{margin:0;font-size:12px;color:#166534}" +
    ".obd-info{margin:0;font-size:12px;color:var(--text-secondary,#475569)}" +
    ".obd-case-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;color:var(--text-muted,#64748B)}" +
    ".obd-last{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}" +
    ".obd-editor-wrap{border-top:1px dashed var(--border-strong,#CBD5E1);padding-top:10px;margin-top:6px}" +
    ".obd-editor-wrap h4{margin:0 0 8px;font-size:13px}" +
    ".obd-editor{display:flex;flex-direction:column;gap:12px}" +
    ".obd-field{display:flex;flex-direction:column;gap:5px;min-width:0}" +
    ".obd-label{font-size:11.5px;font-weight:600;color:var(--text-secondary,#475569)}" +
    ".obd-hint{font-size:11px;color:var(--text-muted,#64748B)}" +
    ".obd-input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-strong,#CBD5E1);border-radius:8px;font:inherit;font-size:13px;background:var(--surface,#fff)}" +
    "textarea.obd-input{resize:vertical;line-height:1.45}" +
    ".obd-input:focus{outline:2px solid var(--primary,#2563EB);outline-offset:0;border-color:var(--primary,#2563EB)}" +
    ".obd-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}" +
    ".obd-readonly{padding:8px 11px;border:1px solid var(--border,#E2E8F0);border-radius:8px;background:var(--surface-muted,#F8FAFC);font-size:13px}" +
    ".obd-flow{display:flex;align-items:center;gap:4px;flex-wrap:wrap}" +
    ".obd-flow-sep{color:var(--text-muted,#94A3B8)}" +
    ".obd-flow-step{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;border:1px solid var(--border-strong,#CBD5E1);background:var(--surface,#fff);font:inherit;font-size:13px;font-weight:600;color:var(--text-secondary,#475569);cursor:pointer}" +
    ".obd-flow-step[aria-checked=true].is-danger{background:var(--danger-bg,#FEF2F2);border-color:var(--danger,#DC2626);color:#991B1B}" +
    ".obd-flow-step[aria-checked=true].is-warning{background:var(--warning-bg,#FFFBEB);border-color:var(--warning,#D97706);color:#92400E}" +
    ".obd-flow-step[aria-checked=true].is-success{background:var(--success-bg,#F0FDF4);border-color:var(--success,#16A34A);color:#166534}" +
    ".obd-fieldset{border:1px solid var(--border,#E2E8F0);border-radius:8px;padding:10px 12px;margin:0;display:flex;flex-direction:column;gap:8px}" +
    ".obd-fieldset legend{font-size:11.5px;font-weight:600;color:var(--text-secondary,#475569);padding:0 4px}" +
    ".obd-fieldset .obd-hint{margin:0}" +
    ".obd-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px}" +
    ".obd-preview{font-size:13px;background:var(--surface-muted,#F8FAFC);border-radius:6px;padding:6px 10px}" +
    ".obd-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.obd-spacer{flex:1}" +
    ".obd-meta{margin:0;font-size:10.5px;color:var(--text-muted,#64748B);font-family:var(--mono)}" +
    "#obcTimeline .daudit,#obcTimeline{font-size:12px}" +
    "@media(max-width:560px){.obd-grid{grid-template-columns:1fr}}";
  document.head.appendChild(css);
  window.OBCase = {
    aktif:() => st.aktif, mulai, berhenti, terapkan, info, ringkasHitung, setelahHasil, evaluasiUlang,
    bukaLaci, tutupLaci, simpanLaci, sheetCases, sheetRiwayat, kunciHasil, unduhTemplate, unggah,
    semua:() => Array.from(st.rows.values()), labelCase,
    _st:st   // untuk uji lokal
  };

  // pengguna sudah login sebelum berkas ini selesai dimuat
  if(typeof currentUser !== "undefined" && currentUser){
    mulai(currentUser).then(ok => { if(ok){ if(R) gambarUlangSemua(); updateNoteCount(); renderRunList && document.getElementById("runPanel").classList.contains("on") && renderRunList(); } });
  }
})();
