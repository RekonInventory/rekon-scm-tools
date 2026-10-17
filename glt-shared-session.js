/* GLT Rekon Suite — Sesi bersama (Collaborative Shared Session) untuk Outbound & Inventory,
   meniru perilaku Rekonsiliasi Inbound (inbound/js/application/session-service.js):

   * Setiap kali seseorang menjalankan pengecekan, hasilnya dipublikasikan sebagai SESI BERSAMA
     (orang itu menjadi owner). Hanya ada satu sesi aktif per tool.
   * Pengguna lain yang login ditawari "Ikuti sesi": hasil owner langsung tampil tanpa
     mengunggah berkas, dan ikut diperbarui setiap kali owner menjalankan pengecekan lagi.
   * Mode ikut: "Ikuti data" (hasil saja, saringan/tab sendiri) atau "Ikuti tampilan owner"
     (tab, pencarian, saringan, urutan, dan laci rincian mengikuti owner).
   * Peserta terlihat (presence), status koneksi, owner tidak aktif > 2 menit -> follower bisa
     ambil alih, owner bisa menutup sesi.
   * Follower tidak bisa mengunggah/menjalankan pengecekan sampai berhenti mengikuti (catatan /
     case tetap bisa diisi — case disimpan per baris di server).

   Server: memakai tabel, aturan, dan RPC yang SAMA dengan Inbound (sudah ada di production):
   inbound_sessions (kolom tool_name membedakan tool; unique index satu sesi ACTIVE per
   workspace+tool), trigger inbound_sessions_before_update (owner/takeover/close),
   RPC inbound_session_takeover / inbound_session_close, bucket storage inbound-snapshots
   (snapshot > 3 MB). Tidak ada SQL baru. Berkas sumber TIDAK diunggah (bisa puluhan MB);
   follower hanya menerima hasil.

   Dipakai sebagai skrip biasa:  <script src="glt-shared-session.js"></script>
   API: window.GLTSession.buat(cfg) -> {mulai(user), berhenti(), publikasi(), peran(), mengikuti(), ...}
   cfg: {tool, label, mount, supa(), identitas(), ambil(), terapkan(data, row), tampilan?:{ambil(), terapkan(v)},
         kunci(follower:boolean), toast(msg, type, ms), pilihan(msg, buttons), konfirmasi(msg, opts)} */
(function(){
  "use strict";
  const WS = "default", TABLE = "inbound_sessions", BUCKET = "inbound-snapshots";
  const STALE_MS = 2 * 60 * 1000, HEARTBEAT_MS = 45 * 1000, INLINE_LIMIT = 3 * 1024 * 1024, VIEW_POLL_MS = 900;
  const esc = s => String(s === null || s === undefined ? "" : s)
    .replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtWaktu = iso => { if(!iso) return "-"; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString("id-ID", {dateStyle:"medium", timeStyle:"short"}); };
  /* nama berkas sumber unik (satu berkas bisa dipakai untuk dua peran, mis. SCM + Inbound) */
  const namaSumber = row => Array.from(new Set(Object.values((row && row.source_names) || {}).filter(Boolean).join(", ").split(", ").filter(Boolean)));
  const pesanGalat = e => (e && (e.message || e.error_description || e.details)) || String(e);

  /* ---------------------------------------------------------------- codec snapshot
     JSON biasa kehilangan Date/Map/Set; hasil Outbound & Inventory memakainya. */
  function enc(v, jejak){
    if(v === null || v === undefined) return null;
    const t = typeof v;
    if(t === "number") return isFinite(v) ? v : {__gltN:String(v)};
    if(t === "string" || t === "boolean") return v;
    if(t === "function" || t === "symbol" || t === "bigint") return null;
    if(v instanceof Date) return {__gltD:isNaN(v) ? null : v.getTime()};
    if(jejak.has(v)) throw new Error("Data hasil melingkar; tidak bisa dibagikan.");
    jejak.add(v);
    let out;
    if(Array.isArray(v)) out = v.map(x => enc(x, jejak));
    else if(v instanceof Map) out = {__gltM:Array.from(v.entries()).map(([k, x]) => [enc(k, jejak), enc(x, jejak)])};
    else if(v instanceof Set) out = {__gltS:Array.from(v).map(x => enc(x, jejak))};
    else { out = {}; Object.keys(v).forEach(k => { const x = v[k]; if(x !== undefined && typeof x !== "function") out[k] = enc(x, jejak); }); }
    jejak.delete(v);
    return out;
  }
  function dec(v){
    if(v === null || typeof v !== "object") return v;
    if(Array.isArray(v)) return v.map(dec);
    if("__gltD" in v) return v.__gltD === null ? new Date(NaN) : new Date(v.__gltD);
    if("__gltN" in v) return Number(v.__gltN);
    if("__gltM" in v) return new Map(v.__gltM.map(([k, x]) => [dec(k), dec(x)]));
    if("__gltS" in v) return new Set(v.__gltS.map(dec));
    const out = {}; Object.keys(v).forEach(k => { out[k] = dec(v[k]); });
    return out;
  }
  const kodekan = data => enc(data, new Set());

  /* ---------------------------------------------------------------- gaya bar sesi (sekali) */
  if(!document.getElementById("glt-sesi-style")){
    const st = document.createElement("style");
    st.id = "glt-sesi-style";
    st.textContent =
      ".glt-sesi{border:1px solid var(--info-border,#A5F3FC);background:var(--info-bg,#ECFEFF);border-radius:10px;padding:10px 14px;margin:0 0 16px;font-size:12.5px;display:flex;flex-direction:column;gap:8px}" +
      ".glt-sesi.is-stale{border-color:var(--warning-border,#FDE68A);background:var(--warning-bg,#FFFBEB)}" +
      ".glt-sesi-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".glt-sesi-dot{width:9px;height:9px;border-radius:50%;background:#16A34A;box-shadow:0 0 0 3px rgba(22,163,74,.18)}" +
      ".glt-sesi.is-stale .glt-sesi-dot{background:#D97706;box-shadow:0 0 0 3px rgba(217,119,6,.18)}" +
      ".glt-sesi-tag{font-weight:700;letter-spacing:.06em;font-size:11px;color:#155E75}" +
      ".glt-sesi-per{font-weight:600}" +
      ".glt-sesi-conn{font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--border,#E2E8F0);background:var(--surface,#fff);color:var(--text-muted,#64748B)}" +
      ".glt-sesi-conn.ok{color:#166534;border-color:var(--success-border,#BBF7D0)}" +
      ".glt-sesi-act{margin-left:auto;display:flex;gap:6px;align-items:center;flex-wrap:wrap}" +
      ".glt-sesi-act select,.glt-sesi-act button{font:inherit;font-size:12px;padding:5px 10px;border-radius:7px;border:1px solid var(--border-strong,#CBD5E1);background:var(--surface,#fff);cursor:pointer}" +
      ".glt-sesi-act button.primary{background:var(--primary,#2563EB);border-color:var(--primary,#2563EB);color:#fff}" +
      ".glt-sesi-kv{display:flex;gap:18px;flex-wrap:wrap;margin:0}" +
      ".glt-sesi-kv div{display:flex;gap:6px;align-items:baseline;min-width:0}" +
      ".glt-sesi-kv dt{font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted,#64748B)}" +
      ".glt-sesi-kv dd{margin:0;word-break:break-word}" +
      ".glt-sesi-org{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--surface,#fff);border:1px solid var(--border,#E2E8F0);margin:0 4px 2px 0}" +
      ".glt-sesi-org.owner{border-color:#0891B2;font-weight:600}" +
      ".glt-sesi-warn{color:#92400E}";
    document.head.appendChild(st);
  }

  /* ---------------------------------------------------------------- satu sesi per halaman */
  function buat(cfg){
    const supa = () => cfg.supa();
    const toast = (m, t, ms) => cfg.toast ? cfg.toast(m, t, ms) : console.log(m);
    const LAST_KEY = "glt_sesi_terakhir_" + cfg.tool;
    let current = null, role = null, followMode = "data", presence = {}, conn = "idle";
    let channel = null, generation = 0, target = null, retryTimer = null, retryCount = 0;
    let heartbeat = null, viewTimer = null, pollTimer = null, staleTimer = null, lastView = null, pendingView = null;
    let menerapkan = false;   // sedang menerapkan tampilan owner (jangan dianggap perubahan sendiri)
    const BATAS_INLINE = cfg.batasInline || INLINE_LIMIT;   // snapshot lebih besar -> Storage

    const ingat = id => { try{ if(id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); }catch(e){} };
    const diingat = () => { try{ return localStorage.getItem(LAST_KEY); }catch(e){ return null; } };
    const me = () => cfg.identitas();
    const basi = row => { const s = row || current; return !!s && (Date.now() - new Date(s.last_activity_at).getTime()) > STALE_MS; };
    async function q(p){ const {data, error} = await p; if(error) throw error; return data; }

    /* ---------- penyimpanan (tabel inbound_sessions + bucket snapshot) ---------- */
    const Repo = {
      aktif: () => q(supa().from(TABLE).select("*").eq("workspace_id", WS).eq("tool_name", cfg.tool).eq("status", "ACTIVE")
        .order("last_activity_at", {ascending:false}).limit(1).maybeSingle()),
      ambil: id => q(supa().from(TABLE).select("*").eq("id", id).maybeSingle()),
      tutupLain: () => q(supa().from(TABLE).update({status:"CLOSED", updated_at:new Date().toISOString()})
        .eq("workspace_id", WS).eq("tool_name", cfg.tool).eq("status", "ACTIVE")),
      sisip: row => q(supa().from(TABLE).insert(row).select().single()),
      ubah: (id, patch) => q(supa().from(TABLE).update(patch).eq("id", id).select().single()),
      sentuh: (id, patch) => q(supa().from(TABLE).update(patch).eq("id", id)),
      ambilAlih: (id, versi, audit) => q(supa().rpc("inbound_session_takeover", {p_id:id, p_expected_version:versi, p_audit:audit || null})),
      tutup: id => q(supa().rpc("inbound_session_close", {p_id:id}))
    };
    const Snap = {
      jalur: id => WS + "/" + id + ".json",
      unggah: (path, json) => q(supa().storage.from(BUCKET).upload(path, new Blob([json], {type:"application/json"}), {upsert:true, contentType:"application/json"})),
      unduh: async path => { const b = await q(supa().storage.from(BUCKET).download(path)); return b.text(); }
    };

    /* ---------- transport realtime: presence + broadcast + perubahan baris sesi ---------- */
    function setConn(s){ if(conn !== s){ conn = s; render(); } }
    function lepasChannel(){
      clearTimeout(retryTimer); retryTimer = null;
      if(channel){ const c = channel; channel = null; try{ supa().removeChannel(c); }catch(e){} }
    }
    function bukaChannel(){
      const gen = ++generation;
      lepasChannel();
      if(!target) return;
      const ch = supa().channel("rekon-session-" + target.id, {config:{presence:{key:target.who.user_id}}});
      channel = ch;
      ch.on("presence", {event:"sync"}, () => { if(gen === generation){ presence = ch.presenceState() || {}; render(); } });
      ch.on("broadcast", {event:"session"}, msg => { if(gen === generation) onBroadcast(msg.payload || {}); });
      ch.on("postgres_changes", {event:"UPDATE", schema:"public", table:TABLE, filter:"id=eq." + target.id},
        p => { if(gen === generation) onRow(p.new); });
      setConn("connecting");
      ch.subscribe(async s => {
        if(gen !== generation) return;
        if(s === "SUBSCRIBED"){
          retryCount = 0; setConn("connected");
          try{ await ch.track({user_id:target.who.user_id, name:target.who.name, role:target.role, at:new Date().toISOString()}); }catch(e){}
          // mungkin ada DATA_UPDATED yang terlewat selama terputus
          if(current){
            try{
              const fresh = await Repo.ambil(current.id);
              if(fresh){ const terlewat = fresh.version !== current.version; current = fresh; render();
                if(terlewat && role === "FOLLOWER") ikutiTerbaru(fresh.version); }
            }catch(e){}
          }
        }else if(s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED"){
          if(!target) return;
          const wait = [2000, 5000, 10000, 20000][retryCount] || 30000; retryCount++;
          setConn("reconnecting");
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { if(gen === generation) bukaChannel(); }, wait);
        }
      });
    }
    function kirim(type, data){
      if(!channel || conn !== "connected") return false;
      channel.send({type:"broadcast", event:"session", payload:Object.assign({type, from:me().name || ""}, data || {})});
      return true;
    }
    async function retrack(r){
      if(!target) return;
      target.role = r;
      if(channel && conn === "connected"){ try{ await channel.track({user_id:target.who.user_id, name:target.who.name, role:r, at:new Date().toISOString()}); }catch(e){} }
    }

    /* ---------- siklus sesi ---------- */
    function pasang(row, r){
      generation++; lepasChannel();
      current = row; role = r; followMode = "data"; presence = {}; lastView = null;
      ingat(row.id);
      target = {id:row.id, who:me(), role:r};
      bukaChannel();
      mulaiTimer();
      cfg.kunci && cfg.kunci(r === "FOLLOWER");
      render();
    }
    function lepas(){
      target = null; generation++; lepasChannel(); setConn("idle");
      clearInterval(heartbeat); clearInterval(pollTimer); clearTimeout(viewTimer);
      heartbeat = pollTimer = null;
      current = null; role = null; presence = {};
      ingat(null);
      cfg.kunci && cfg.kunci(false);
      render();
    }
    function mulaiTimer(){
      clearInterval(heartbeat); clearInterval(pollTimer);
      heartbeat = setInterval(() => {
        if(current && role === "OWNER") Repo.sentuh(current.id, {last_activity_at:new Date().toISOString()}).catch(() => {});
      }, HEARTBEAT_MS);
      // owner: siarkan tampilan bila berubah (tab, saringan, urutan, laci) — tanpa perlu mengait tiap tombol
      pollTimer = cfg.tampilan ? setInterval(() => {
        if(!current || role !== "OWNER" || menerapkan) return;
        let v; try{ v = JSON.stringify(cfg.tampilan.ambil()); }catch(e){ return; }
        if(v === lastView) return;
        lastView = v; pendingView = JSON.parse(v);
        clearTimeout(viewTimer);
        viewTimer = setTimeout(() => {
          kirim("VIEW_CHANGED", {view:pendingView});
          if(current){ current.view_state = pendingView; Repo.sentuh(current.id, {view_state:pendingView}).catch(() => {}); }
        }, 150);
      }, VIEW_POLL_MS) : null;
    }

    async function muatSnapshot(row, minVersion){
      let s = row || current;
      for(let i = 0; minVersion && s && s.version < minVersion && i < 3; i++){
        await new Promise(r => setTimeout(r, 700));     // baris belum menyusul (lag replikasi)
        s = (await Repo.ambil(s.id)) || s;
      }
      let encoded;
      if(s.result_data) encoded = s.result_data;
      else if(s.snapshot_path || s.result_path){
        const text = await Snap.unduh(s.snapshot_path || s.result_path);
        try{ encoded = JSON.parse(text); }catch(e){ throw new Error("Snapshot sesi rusak. Minta owner menjalankan pengecekan ulang."); }
      }else throw Object.assign(new Error("Sesi ini belum punya hasil (owner belum menjalankan pengecekan)."), {kosong:true});
      if(row === current || !row) current = s;
      return dec(encoded);
    }
    async function terapkanSnapshot(row, minVersion){
      const data = await muatSnapshot(row, minVersion);
      menerapkan = true;
      try{ await cfg.terapkan(data, current); }
      finally{ menerapkan = false; }
      if(role === "FOLLOWER" && followMode === "view" && current && current.view_state) terapkanTampilan(current.view_state);
    }
    async function ikutiTerbaru(minVersion){
      try{
        const fresh = await Repo.ambil(current.id);
        if(fresh) current = fresh;
        await terapkanSnapshot(current, minVersion);
        toast("Hasil sesi diperbarui oleh " + (current.owner_name || "owner") + ".", "ok", 4000);
      }catch(e){ toast("Gagal memuat data sesi: " + pesanGalat(e), "err", 9000); }
      render();
    }
    function terapkanTampilan(v){
      if(!cfg.tampilan || !v) return;
      menerapkan = true;
      try{ cfg.tampilan.terapkan(v); }catch(e){ console.warn("tampilan sesi:", e); }
      finally{ menerapkan = false; }
    }

    function onRow(row){
      if(!row || !current || row.id !== current.id) return;
      const pemilikLama = current.owner_id;
      current = row;
      if(row.status === "CLOSED"){
        const oleh = row.closed_by || "pengguna lain";
        if(role === "FOLLOWER") toast("Sesi ini telah ditutup oleh " + oleh + ". Hasil terakhir tetap tampil.", "warn", 10000);
        else toast("Sesi bersama Anda ditutup oleh " + oleh + " (biasanya karena ia memulai sesi baru). Hasil Anda tetap tampil.", "warn", 10000);
        lepas(); return;
      }
      if(role === "OWNER" && pemilikLama === me().user_id && row.owner_id !== me().user_id){
        toast("Sesi diambil alih oleh " + (row.owner_name || "pengguna lain") + ". Anda sekarang mengikuti sesi.", "warn", 10000);
        role = "FOLLOWER"; retrack("FOLLOWER"); cfg.kunci && cfg.kunci(true);
      }
      render();
    }
    function onBroadcast(p){
      if(p.type === "DATA_UPDATED" && role === "FOLLOWER") ikutiTerbaru(p.version);
      else if(p.type === "SESSION_CLOSED" && role === "FOLLOWER"){ toast("Sesi ini telah ditutup oleh pemiliknya. Hasil terakhir tetap tampil.", "warn", 10000); lepas(); }
      else if(p.type === "VIEW_CHANGED" && role === "FOLLOWER" && followMode === "view" && p.view) terapkanTampilan(p.view);
      else if(p.type === "SESSION_UPDATED") Repo.ambil(current.id).then(r => { if(r) onRow(r); }).catch(() => {});
    }

    /* ---------- aksi pengguna ---------- */
    async function ikuti(row){
      pasang(row, "FOLLOWER");
      try{ await terapkanSnapshot(row); }
      catch(e){ if(!e.kosong) toast("Gagal memuat hasil sesi: " + pesanGalat(e), "err", 9000); }
    }
    async function berhentiMengikuti(){
      lepas();
      toast("Anda berhenti mengikuti sesi. Hasil terakhir tetap tampil; unggah berkas & jalankan pengecekan sudah aktif lagi.", "", 7000);
    }
    async function tutup(){
      if(!current) return;
      if(cfg.konfirmasi && !(await cfg.konfirmasi("Tutup sesi bersama ini? Follower tidak lagi melihat sesi ini sebagai aktif (hasil di layar mereka tetap tampil).", {okLabel:"Tutup sesi"}))) return;
      try{ await Repo.tutup(current.id); kirim("SESSION_CLOSED", {sessionId:current.id}); lepas(); toast("Sesi ditutup.", "ok"); }
      catch(e){ toast("Gagal menutup sesi: " + pesanGalat(e), "err"); }
    }
    async function ambilAlih(){
      if(!current) return;
      if(cfg.konfirmasi && !(await cfg.konfirmasi("Ambil alih sesi ini sebagai owner? Sesudahnya Anda bisa mengunggah berkas & menjalankan pengecekan; hasilnya dibagikan ke peserta lain.", {okLabel:"Ambil alih"}))) return;
      const who = me();
      const audit = (current.audit || []).concat([{at:new Date().toISOString(), from:current.owner_name || "", to:who.name,
        what:"Ambil alih sesi (owner tidak aktif > " + Math.round(STALE_MS / 60000) + " menit)"}]).slice(-200);
      try{
        const out = await Repo.ambilAlih(current.id, current.version, audit);
        if(!out || out.status !== "ok"){
          if(out && out.current) current = out.current;
          render();
          toast("Sesi sudah diambil alih atau diperbarui orang lain. Tampilan sesi dimuat ulang.", "warn", 9000);
          return;
        }
        current = out.row; role = "OWNER"; followMode = "data";
        await retrack("OWNER");
        cfg.kunci && cfg.kunci(false);
        kirim("SESSION_UPDATED", {sessionId:current.id, takeover:true});
        render();
        toast("Anda sekarang owner sesi ini. Unggah berkas & jalankan pengecekan untuk memperbarui hasil bersama.", "ok", 8000);
      }catch(e){ toast("Gagal mengambil alih sesi: " + pesanGalat(e), "err", 9000); }
    }
    async function aturMode(m){
      followMode = m === "view" ? "view" : "data";
      if(followMode === "view" && current){
        try{ const fresh = await Repo.ambil(current.id); if(fresh){ current = fresh; terapkanTampilan(fresh.view_state); } }catch(e){}
      }
      render();
    }

    /** Owner menjalankan pengecekan -> hasilnya jadi snapshot sesi (sesi baru bila belum owner). */
    async function publikasi(){
      if(role === "FOLLOWER") return null;
      let isi;
      try{ isi = cfg.ambil(); }catch(e){ toast("Hasil tidak bisa dibagikan ke sesi bersama: " + pesanGalat(e), "warn", 9000); return null; }
      if(!isi || !isi.data) return null;
      const who = me(), now = new Date().toISOString();
      try{
        const encoded = kodekan(isi.data);
        const json = JSON.stringify(encoded);
        const row = {workspace_id:WS, tool_name:cfg.tool, status:"ACTIVE", owner_id:who.user_id, owner_name:who.name,
          period_key:isi.periodKey || null, source_names:isi.sourceNames || null, last_activity_at:now, updated_at:now};
        const milikSaya = current && role === "OWNER" && current.owner_id === who.user_id && current.status === "ACTIVE";
        let saved;
        if(milikSaya){
          if(json.length <= BATAS_INLINE){ row.result_data = encoded; row.snapshot_path = null; row.result_path = null; }
          else { const p = Snap.jalur(current.id); await Snap.unggah(p, json); row.result_data = null; row.snapshot_path = p; row.result_path = p; }
          saved = await Repo.ubah(current.id, row);
          current = saved;
        }else{
          await Repo.tutupLain();               // hanya satu sesi ACTIVE per tool (server mengizinkan non-owner menutup)
          row.audit = [{at:now, what:"Sesi dibuat", by:who.name}];
          const kecil = json.length <= BATAS_INLINE;
          try{ saved = await Repo.sisip(Object.assign({}, row, {result_data:kecil ? encoded : null})); }
          catch(e){ await Repo.tutupLain(); saved = await Repo.sisip(Object.assign({}, row, {result_data:kecil ? encoded : null})); }  // balapan dengan orang lain
          if(!kecil){ const p = Snap.jalur(saved.id); await Snap.unggah(p, json); saved = await Repo.ubah(saved.id, {snapshot_path:p, result_path:p}); }
          pasang(saved, "OWNER");
        }
        // channel baru mungkin belum tersambung: kirim begitu siap supaya follower tidak tertinggal
        const umumkan = (n) => { if(!kirim("DATA_UPDATED", {sessionId:current.id, version:current.version}) && n < 20) setTimeout(() => umumkan(n + 1), 300); };
        umumkan(0);
        render();
        return current;
      }catch(e){
        toast("Hasil tidak terbagi ke sesi bersama: " + pesanGalat(e), "warn", 9000);
        return null;
      }
    }

    /** Dipanggil setelah login: sesi sendiri -> lanjut sebagai owner; pernah diikuti -> ikuti lagi; lainnya -> tawarkan. */
    /* login bisa terdeteksi berkali-kali (dua jalur pemanggil, penyegaran token): cek sesi aktif
       hanya SEKALI per pengguna, supaya tawaran "Ikuti sesi" tidak muncul berulang */
    let userDicek = null;
    function mulai(user){
      if(!user){ berhenti(); return Promise.resolve(); }
      if(userDicek === user.id) return Promise.resolve();
      userDicek = user.id;
      return cekSesiAktif(user);
    }
    async function cekSesiAktif(user){
      lepas();
      clearInterval(staleTimer); staleTimer = setInterval(render, 30000);
      let s;
      try{ s = await Repo.aktif(); }catch(e){ console.warn("sesi bersama:", e); return; }
      if(!s) return;
      if(s.owner_id === user.id){
        pasang(s, "OWNER");
        if(!(cfg.adaHasil && cfg.adaHasil())){ try{ await terapkanSnapshot(s); }catch(e){ if(!e.kosong) toast("Gagal memuat hasil sesi: " + pesanGalat(e), "err"); } }
        return;
      }
      if(diingat() === s.id){ await ikuti(s); return; }
      const src = namaSumber(s).join(", ");
      const pesan = cfg.label + " sedang dikerjakan oleh " + (s.owner_name || "-") + ".\n\n" +
        (s.period_key ? "Periode / acuan: " + s.period_key + "\n" : "") +
        (src ? "Berkas sumber: " + src + "\n" : "") +
        "Dimulai: " + fmtWaktu(s.started_at) + "\nAktivitas owner terakhir: " + fmtWaktu(s.last_activity_at) +
        (basi(s) ? " (tidak aktif > 2 menit)" : "") +
        "\n\nIkuti sesi untuk melihat hasilnya tanpa mengunggah berkas, atau kerja sendiri.";
      const pilih = cfg.pilihan ? await cfg.pilihan(pesan, [{label:"Kerja sendiri", value:"sendiri"}, {label:"Ikuti sesi", value:"ikut", primary:true}]) : "sendiri";
      if(pilih === "ikut") await ikuti(s);
    }
    function berhenti(){ clearInterval(staleTimer); staleTimer = null; userDicek = null; lepas(); }

    /* ---------- bar sesi ---------- */
    function render(){
      const root = typeof cfg.mount === "string" ? document.querySelector(cfg.mount) : cfg.mount;
      if(!root) return;
      if(!current){ root.innerHTML = ""; root.hidden = true; return; }
      root.hidden = false;
      const row = current, owner = role === "OWNER", stale = basi(row);
      const orang = [];
      Object.keys(presence || {}).forEach(k => { const a = presence[k] || []; if(a.length) orang.push(a[a.length - 1]); });
      if(!orang.length) orang.push({name:row.owner_name, role:"OWNER"});
      const connLabel = {connected:"Tersambung", connecting:"Menghubungkan…", reconnecting:"Menyambung ulang…", idle:"Terputus"}[conn] || conn;
      const src = namaSumber(row);
      root.innerHTML = '<div class="glt-sesi' + (stale ? " is-stale" : "") + '" role="region" aria-label="Sesi bersama">' +
        '<div class="glt-sesi-top"><span class="glt-sesi-dot" aria-hidden="true"></span><span class="glt-sesi-tag">SESI BERSAMA</span>' +
          '<span class="glt-sesi-per">' + esc(cfg.label) + (row.period_key ? " · " + esc(row.period_key) : "") + "</span>" +
          '<span class="glt-sesi-conn' + (conn === "connected" ? " ok" : "") + '">' + esc(connLabel) + "</span>" +
          '<span class="glt-sesi-act">' +
            (!owner ? '<label>Mode ikut <select data-sesi="mode"><option value="data"' + (followMode !== "view" ? " selected" : "") + '>Ikuti data</option>' +
              '<option value="view"' + (followMode === "view" ? " selected" : "") + ">Ikuti tampilan owner</option></select></label>" : "") +
            (!owner && stale ? '<button type="button" class="primary" data-sesi="ambil">Ambil alih sesi</button>' : "") +
            (!owner ? '<button type="button" data-sesi="keluar">Berhenti mengikuti</button>' : "") +
            (owner ? '<button type="button" data-sesi="tutup">Tutup sesi</button>' : "") +
          "</span></div>" +
        '<dl class="glt-sesi-kv"><div><dt>Owner</dt><dd>' + esc(row.owner_name || "-") + (owner ? " (Anda)" : "") + "</dd></div>" +
          "<div><dt>Peserta</dt><dd>" + orang.map(p => '<span class="glt-sesi-org' + (p.name === row.owner_name ? " owner" : "") + '">' + esc(p.name || "?") + "</span>").join("") + "</dd></div>" +
          (src.length ? "<div><dt>Berkas sumber</dt><dd>" + esc(src.join(", ")) + "</dd></div>" : "") +
          "<div><dt>Diperbarui</dt><dd>" + esc(fmtWaktu(row.updated_at || row.last_activity_at)) + "</dd></div></dl>" +
        (stale && !owner ? '<div class="glt-sesi-warn">⚠ Owner tidak aktif lebih dari 2 menit. Anda dapat mengambil alih sesi untuk mengunggah ulang & menjalankan pengecekan.</div>' : "") +
        (!owner ? '<div class="glt-sesi-warn" style="color:inherit">Anda mengikuti sesi ini: unggah berkas & jalankan pengecekan dinonaktifkan sampai Anda berhenti mengikuti. Catatan / case tetap bisa diisi.</div>' : "") +
        "</div>";
      const sel = root.querySelector('[data-sesi="mode"]'); if(sel) sel.onchange = () => aturMode(sel.value);
      const b = n => root.querySelector('[data-sesi="' + n + '"]');
      if(b("ambil")) b("ambil").onclick = ambilAlih;
      if(b("keluar")) b("keluar").onclick = berhentiMengikuti;
      if(b("tutup")) b("tutup").onclick = tutup;
    }

    return {
      mulai, berhenti, publikasi, ikuti, ambilAlih, tutup, aturMode, berhentiMengikuti,
      peran:() => role, mengikuti:() => role === "FOLLOWER", sesi:() => current, mode:() => followMode,
      sedangMenerapkan:() => menerapkan, render
    };
  }

  window.GLTSession = {buat, _codec:{enc:kodekan, dec}};
})();
