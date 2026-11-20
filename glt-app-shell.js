/* ==========================================================================
   GLT Rekon Suite — Application Shell
   Menyuntikkan topbar + sidebar navigasi ke setiap halaman tool.

   PRINSIP (penting untuk perubahan berikutnya):
   - Shell TIDAK mengubah struktur DOM halaman. Elemen shell dipasang sebagai
     position:fixed, lalu <body> hanya diberi padding. Tidak ada node halaman
     yang dipindah/dibungkus, kecuali #syncStatus yang dipindahkan ke topbar
     (memindahkan node mempertahankan event listener & referensi elemennya).
   - Shell TIDAK menduplikasi logic apa pun. Tombol "Ganti Password" dan
     "Keluar" di menu pengguna hanya meneruskan klik ke tombol asli halaman
     (#btnChangePassword / #btnSignOut). Kalau tombolnya tidak ada di halaman
     itu, barulah shell memakai supabase client langsung.
   - Menyembunyikan menu Administrasi hanyalah kenyamanan UI. Otorisasi
     sebenarnya tetap dijaga Edge Function + RLS di sisi server.
   ========================================================================== */
(function () {
  "use strict";

  // Semua href relatif terhadap folder tempat file shell ini berada, supaya shell
  // juga benar dipakai halaman di subfolder (mis. inbound/index.html memuat
  // ../glt-app-shell.js). Halaman di root tidak terpengaruh.
  var SELF = document.currentScript && document.currentScript.src;
  var BASE = SELF ? SELF.replace(/[^/]*$/, "") : "";

  var NAV = [
    { id: "dashboard", href: "index.html",                label: "Dashboard", icon: "grid" },
    { id: "outbound",  href: "outbound.html",             label: "Outbound",  icon: "upload" },
    // Workspace Inbound baru. Versi lama (Rekonsiliasi_Inbound.html) tetap bisa dibuka
    // langsung selama masa transisi dan tetap ditandai aktif di menu ini.
    { id: "inbound",   href: "inbound/index.html",        label: "Inbound",   icon: "download", alias: ["rekonsiliasi_inbound.html", "inbound/"] },
    { id: "inventory", href: "inventory.html",            label: "Inventory", icon: "box" }
  ];
  var ADMIN_NAV = [
    { id: "admin", href: "admin.html", label: "Pengguna", icon: "users" }
  ];

  var ICONS = {
    grid:     '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    upload:   '<path d="M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"/>',
    box:      '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    users:    '<path d="M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1"/><circle cx="9" cy="7" r="3"/><path d="M22 19v-1a4 4 0 00-3-3.87M16 4.13A4 4 0 0119 8"/>'
  };

  var USERNAME_EMAIL_DOMAIN = "@rekon.local";

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  // Path halaman ini relatif terhadap BASE, mis. "outbound.html" atau "inbound/index.html".
  function currentFile() {
    var here = String(location.href).split(/[?#]/)[0];
    var rel;
    if (BASE && here.indexOf(BASE) === 0) rel = here.slice(BASE.length);
    else rel = here.substring(here.lastIndexOf("/") + 1);
    if (!rel || rel.charAt(rel.length - 1) === "/") rel += "index.html";
    return decodeURIComponent(rel).toLowerCase();
  }

  // id modul untuk path relatif (mis. "outbound.html"); null bila bukan halaman modul.
  function navIdForFile(file) {
    var all = NAV.concat(ADMIN_NAV);
    for (var i = 0; i < all.length; i++) {
      var names = [all[i].href.toLowerCase()].concat(all[i].alias || []);
      for (var j = 0; j < names.length; j++) {
        if (names[j] === file || (names[j].slice(-1) === "/" && file.indexOf(names[j]) === 0)) return all[i].id;
      }
    }
    return null;
  }

  function activeNavId() {
    return navIdForFile(currentFile()) || "dashboard";
  }

  // id modul tujuan sebuah link (href absolut); null bila link bukan ke halaman modul suite ini.
  function navIdForHref(href) {
    var url = String(href || "").split(/[?#]/)[0];
    if (!BASE || url.indexOf(BASE) !== 0) return null;
    var rel = url.slice(BASE.length);
    if (!rel || rel.charAt(rel.length - 1) === "/") rel += "index.html";
    try { rel = decodeURIComponent(rel); } catch (e) { /* biarkan */ }
    return navIdForFile(rel.toLowerCase());
  }

  function supaClient() {
    try {
      return (typeof supa !== "undefined" && supa) ? supa : null;
    } catch (e) {
      return null;
    }
  }

  function displayNameFrom(user) {
    if (!user) return "";
    if (user.user_metadata && user.user_metadata.display_name) return String(user.user_metadata.display_name);
    var email = user.email || "";
    if (email.slice(-USERNAME_EMAIL_DOMAIN.length) === USERNAME_EMAIL_DOMAIN) {
      return email.slice(0, email.length - USERNAME_EMAIL_DOMAIN.length);
    }
    return email;
  }

  function navItemHTML(item, activeId) {
    return '<a class="shell-nav-item" href="' + BASE + item.href + '" data-nav="' + item.id + '" title="' + item.label + '"' +
           (item.id === activeId ? ' aria-current="page"' : "") + '>' +
           '<span class="shell-nav-ico">' + svg(item.icon) + "</span>" +
           '<span class="shell-nav-text">' + item.label + "</span></a>";
  }

  function build() {
    var activeId = activeNavId();
    var active = NAV.concat(ADMIN_NAV).filter(function (n) { return n.id === activeId; })[0];

    var topbar = document.createElement("header");
    topbar.className = "shell-topbar";
    topbar.innerHTML =
      '<button class="shell-burger" id="gsBurger" type="button" aria-label="Buka menu navigasi" aria-expanded="false" aria-controls="gsSidebar">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>' +
      "</button>" +
      '<a class="shell-brand" href="' + BASE + 'index.html"><span class="shell-brand-mark"></span><b>GLT</b> <span>Rekon Suite</span></a>' +
      '<span class="shell-crumb"><b>' + (active ? active.label : "Dashboard") + "</b></span>" +
      '<div class="shell-topbar-right">' +
        '<span class="shell-sync" id="gsSyncSlot"></span>' +
        '<div class="shell-user">' +
          '<button class="shell-user-btn" id="gsUserBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="gsUserMenu">' +
            '<span class="shell-avatar" id="gsAvatar">·</span>' +
            '<span class="shell-user-name" id="gsUserName">Memuat…</span>' +
            '<span class="shell-caret" aria-hidden="true">▾</span>' +
          "</button>" +
          '<div class="shell-menu" id="gsUserMenu" role="menu" hidden>' +
            '<div class="shell-menu-head">' +
              '<div class="shell-menu-name" id="gsMenuName">—</div>' +
              '<div class="shell-menu-meta" id="gsMenuMeta"></div>' +
            "</div>" +
            '<button class="shell-menu-item" role="menuitem" type="button" data-act="password">Ganti Password</button>' +
            '<button class="shell-menu-item shell-menu-item--danger" role="menuitem" type="button" data-act="logout">Keluar</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    var sidebar = document.createElement("aside");
    sidebar.className = "shell-sidebar";
    sidebar.id = "gsSidebar";
    sidebar.setAttribute("aria-label", "Navigasi utama");
    sidebar.innerHTML =
      '<nav class="shell-nav">' +
        '<div class="shell-nav-label">Operasional</div>' +
        NAV.map(function (n) { return navItemHTML(n, activeId); }).join("") +
        '<div class="shell-admin-group" id="gsAdminGroup" hidden>' +
          '<div class="shell-divider"></div>' +
          '<div class="shell-nav-label">Administrasi</div>' +
          ADMIN_NAV.map(function (n) { return navItemHTML(n, activeId); }).join("") +
        "</div>" +
      "</nav>" +
      '<div class="shell-foot">' +
        '<button class="shell-collapse" id="gsCollapse" type="button" aria-label="Ciutkan sidebar">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' +
          '<span class="shell-collapse-text">Ciutkan</span>' +
        "</button>" +
        '<span class="shell-ver">v2.0</span>' +
      "</div>";

    var scrim = document.createElement("div");
    scrim.className = "shell-scrim";
    scrim.id = "gsScrim";
    scrim.hidden = true;

    document.body.appendChild(topbar);
    document.body.appendChild(sidebar);
    document.body.appendChild(scrim);

    return { topbar: topbar, sidebar: sidebar, scrim: scrim };
  }

  // Halaman menulis stempel waktu absolut ("tersinkron · 16.47.28") ke
  // #syncStatus setiap kali sinkron terjadi, lalu diam sampai sinkron
  // berikutnya — dari situ terlihat seperti "berhenti". Shell memindahkan
  // node itu ke topbar tapi menyembunyikannya, lalu menampilkan versi
  // relatifnya sendiri ("Tersinkron 2 menit lalu") yang di-refresh berkala,
  // supaya terlihat hidup. Data & logic sinkron sungguhan tidak disentuh —
  // ini murni membaca ulang teks yang sudah ditulis halaman.
  function adoptSyncStatus() {
    var sync = document.getElementById("syncStatus");
    var slot = document.getElementById("gsSyncSlot");
    if (!sync || !slot) return;

    slot.appendChild(sync);
    sync.style.display = "none";

    var live = document.createElement("span");
    live.className = "gs-status";
    live.id = "gsSyncLive";
    slot.appendChild(live);

    var lastSyncAt = null;
    var state = "idle";

    function parseState(text) {
      if (!text) return null;
      if (/menyinkronkan/i.test(text)) return "syncing";
      if (/gagal/i.test(text)) return "error";
      if (/tersinkron/i.test(text)) return "synced";
      return null;
    }

    function clockLabel(when) {
      var d = new Date(when);
      var hh = String(d.getHours()).padStart(2, "0");
      var mm = String(d.getMinutes()).padStart(2, "0");
      return "Sync jam " + hh + ":" + mm;
    }

    function render() {
      if (state === "syncing") {
        live.setAttribute("data-state", "syncing");
        live.textContent = "Menyinkronkan…";
      } else if (state === "error") {
        live.setAttribute("data-state", "error");
        live.textContent = "Gagal sinkron";
      } else if (state === "synced" && lastSyncAt) {
        live.setAttribute("data-state", "synced");
        live.textContent = clockLabel(lastSyncAt);
      } else {
        live.removeAttribute("data-state");
        live.textContent = "";
      }
    }

    function pull() {
      var next = parseState(sync.textContent);
      if (!next) return;
      state = next;
      if (state === "synced") lastSyncAt = Date.now();
      render();
    }

    new MutationObserver(pull).observe(sync, { childList: true, characterData: true, subtree: true });
    pull();
    setInterval(render, 30000);
  }

  function setupAuthGate() {
    var gate = document.getElementById("authgate");
    if (!gate) return;
    function sync() {
      document.body.classList.toggle("glt-shell--gated", !document.body.classList.contains("authed"));
    }
    sync();
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function setupCollapse() {
    var btn = document.getElementById("gsCollapse");
    if (!btn) return;
    var KEY = "glt-shell-collapsed";
    var label = btn.querySelector(".shell-collapse-text");
    function apply(collapsed) {
      document.body.classList.toggle("glt-shell--collapsed", collapsed);
      btn.setAttribute("aria-label", collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar");
      btn.style.transform = collapsed ? "rotate(180deg)" : "";
      if (label) label.textContent = collapsed ? "" : "Ciutkan";
    }
    var saved = false;
    try { saved = localStorage.getItem(KEY) === "1"; } catch (e) { saved = false; }
    apply(saved);
    btn.addEventListener("click", function () {
      var next = !document.body.classList.contains("glt-shell--collapsed");
      apply(next);
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch (e) { /* mode privat */ }
    });
  }

  function setupDrawer() {
    var burger = document.getElementById("gsBurger");
    var scrim = document.getElementById("gsScrim");
    var sidebar = document.getElementById("gsSidebar");
    if (!burger || !scrim || !sidebar) return;

    function setOpen(open) {
      document.body.classList.toggle("glt-shell--drawer", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      scrim.hidden = !open;
      if (open) {
        var first = sidebar.querySelector(".shell-nav-item");
        if (first) first.focus();
      } else {
        burger.focus();
      }
    }
    burger.addEventListener("click", function () {
      setOpen(!document.body.classList.contains("glt-shell--drawer"));
    });
    scrim.addEventListener("click", function () { setOpen(false); });
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest(".shell-nav-item")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("glt-shell--drawer")) setOpen(false);
    });
  }

  function setupUserMenu() {
    var btn = document.getElementById("gsUserBtn");
    var menu = document.getElementById("gsUserMenu");
    if (!btn || !menu) return;

    function setOpen(open) {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        var first = menu.querySelector(".shell-menu-item");
        if (first) first.focus();
      }
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(menu.hidden);
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !menu.hidden) { setOpen(false); btn.focus(); }
    });

    var passBtn = document.getElementById("btnChangePassword");
    var outBtn = document.getElementById("btnSignOut");
    var passItem = menu.querySelector('[data-act="password"]');
    var outItem = menu.querySelector('[data-act="logout"]');

    // Halaman tanpa tombol ganti password (mis. admin & dashboard) tidak
    // menampilkan menu itu — shell tidak membuat alur password sendiri.
    if (!passBtn && passItem) passItem.hidden = true;

    if (passItem) passItem.addEventListener("click", function () {
      setOpen(false);
      if (passBtn) passBtn.click();
    });

    if (outItem) outItem.addEventListener("click", function () {
      setOpen(false);
      if (outBtn) { outBtn.click(); return; }
      var client = supaClient();
      if (!client) return;
      client.auth.signOut().then(function () { location.reload(); });
    });
  }

  var authedUser = null; // dipakai setupIdleLogout() untuk tahu kapan perlu memantau idle
  // Diisi setupIdleLogout(); dipanggil SEKALI oleh fillIdentity() begitu status sesi
  // awal diketahui (lihat komentar di setupIdleLogout).
  var onInitialSession = null;

  function fillIdentity() {
    var client = supaClient();
    var nameEl = document.getElementById("gsUserName");
    var avatarEl = document.getElementById("gsAvatar");
    var menuName = document.getElementById("gsMenuName");
    var menuMeta = document.getElementById("gsMenuMeta");
    var adminGroup = document.getElementById("gsAdminGroup");

    function render(user) {
      authedUser = user;
      // Panggilan render pertama = status sesi saat halaman baru dimuat. Hanya di
      // sini pengecekan "sudah idle sebelum halaman ini dimuat" dijalankan; login
      // baru sesudahnya (user mengetik password) tidak boleh kena.
      if (onInitialSession) {
        var fn = onInitialSession;
        onInitialSession = null;
        fn(user);
      }
      var name = displayNameFrom(user);
      if (!user) {
        if (nameEl) nameEl.textContent = "Belum masuk";
        if (avatarEl) avatarEl.textContent = "·";
        if (menuName) menuName.textContent = "Belum masuk";
        if (menuMeta) menuMeta.textContent = "";
        if (adminGroup) adminGroup.hidden = true;
        return;
      }
      if (nameEl) nameEl.textContent = name;
      if (avatarEl) avatarEl.textContent = (name || "?").charAt(0);
      if (menuName) menuName.textContent = name;
      if (menuMeta) menuMeta.textContent = user.email || "";
      // Hanya menentukan tampil/tidaknya menu. app_metadata.role diisi server (tidak bisa
      // diubah user); user_metadata.is_admin dipertahankan sebagai cadangan tampilan
      // selama migrasi role belum dijalankan. Otorisasi nyata: Edge Function + RLS.
      var isAdmin = !!((user.app_metadata && (user.app_metadata.role === "admin" || user.app_metadata.role === "supervisor")) ||
                       (user.user_metadata && user.user_metadata.is_admin === true));
      if (adminGroup) adminGroup.hidden = !isAdmin;
    }

    if (!client) { render(null); return; }
    client.auth.getSession().then(function (res) {
      render(res && res.data && res.data.session ? res.data.session.user : null);
    }).catch(function () { render(null); });
    client.auth.onAuthStateChange(function (_evt, session) {
      render(session ? session.user : null);
    });
  }

  // Notifikasi ringan milik shell sendiri (dipakai untuk auto-logout), dibuat
  // dari class .glt-toast-wrap/.glt-toast yang sudah ada di
  // glt-design-system.css — bukan duplikat gltToast() milik tiap halaman,
  // karena index.html/admin.html tidak selalu punya fungsi itu.
  function shellToast(message) {
    var wrap = document.getElementById("gsToastWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "gsToastWrap";
      wrap.className = "glt-toast-wrap";
      document.body.appendChild(wrap);
    }
    var el = document.createElement("div");
    el.className = "glt-toast warn";
    var msg = document.createElement("div");
    msg.className = "glt-toast-msg";
    msg.textContent = message;
    el.appendChild(msg);
    wrap.appendChild(el);
  }

  // Auto-logout setelah tidak ada aktivitas selama IDLE_LIMIT_MS. Aktivitas
  // dicatat lintas tab lewat localStorage supaya tab lain yang masih dipakai
  // aktif tidak ikut ter-logout gara-gara satu tab dibiarkan diam.
  var IDLE_LIMIT_MS = 60 * 60 * 1000; // 1 jam
  var IDLE_CHECK_MS = 30 * 1000;
  var IDLE_STORAGE_KEY = "glt-last-activity";
  var IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];

  function setupIdleLogout() {
    var lastMark = 0;               // throttle penulisan localStorage, bukan sumber kebenaran waktunya
    var memoryFallback = Date.now(); // dipakai kalau localStorage tidak bisa diakses (mode privat)
    var storageOk = true;

    function markActivity(e) {
      // Guard e.isTrusted: hanya event yang benar-benar dipicu pengguna yang
      // dihitung. Tanpa ini, animasi/auto-scroll yang dipicu skrip aplikasi
      // (mis. sesi bersama, log yang auto-scroll) bisa menimpa jejak waktu
      // idle terus-menerus dan timeout tidak akan pernah tercapai.
      if (e && !e.isTrusted) return;
      var now = Date.now();
      // Sebelum mencatat "aktif sekarang", periksa dulu jejak LAMA. Kalau sudah lewat
      // 1 jam, gerakan pertama ini justru tanda pengguna baru kembali -> keluar.
      // Menutup celah laptop tidur/bangun (tab tetap terlihat, jadi visibilitychange
      // & focus tidak terpicu) dan timer yang dibekukan browser: dulu gerakan mouse
      // pertama sesudah bangun menimpa jejak idle sebelum sempat diperiksa.
      if (e && authedUser && !loggedOut && now - readLastActivity() >= IDLE_LIMIT_MS) { logoutIdle(); return; }
      memoryFallback = now;
      if (now - lastMark < 5000) return;
      lastMark = now;
      try { localStorage.setItem(IDLE_STORAGE_KEY, String(now)); } catch (e2) { storageOk = false; }
    }
    function readStored() {
      if (!storageOk) return null;
      try {
        var v = parseInt(localStorage.getItem(IDLE_STORAGE_KEY), 10);
        return isNaN(v) ? null : v;
      } catch (e) { storageOk = false; return null; }
    }
    function readLastActivity() {
      var v = readStored();
      return v === null ? memoryFallback : v;
    }

    // PENTING: jejak aktivitas terakhir dibaca SEBELUM listener dipasang dan TIDAK
    // ditimpa "sekarang" saat halaman dimuat. Browser yang menghibernasi/membuang
    // tab lama (mis. Vivaldi, Chrome Memory Saver) memuat ulang halaman begitu
    // pengguna kembali; kalau setiap pemuatan langsung mencatat "aktif sekarang",
    // waktu idle 1 jam selalu terhapus sebelum sempat dicek. Nilai ini disimpan
    // (bootLast) dan dinilai sekali begitu status sesi awal diketahui.
    var bootLast = readStored();
    if (bootLast === null) { markActivity(); bootLast = Date.now(); } // kunjungan pertama

    IDLE_EVENTS.forEach(function (evt) {
      document.addEventListener(evt, markActivity, { passive: true });
    });

    var loggedOut = false;
    function logoutIdle() {
      if (loggedOut) return;
      loggedOut = true;
      // Di dalam bingkai ruang kerja: yang keluar & memuat ulang adalah halaman induk.
      if (EMBED) {
        try { if (window.top.__gltShell && window.top.__gltShell.logoutIdle) { window.top.__gltShell.logoutIdle(); return; } }
        catch (e) { /* lanjut keluar sendiri */ }
      }
      var client = supaClient();
      if (!client) return;
      function done() {
        shellToast("Sesi berakhir karena tidak ada aktivitas selama 1 jam. Silakan masuk kembali.");
        setTimeout(function () { location.reload(); }, 1200);
      }
      // Jalur gagal (mis. offline) tetap menuju layar login; sesi lokal dibersihkan supabase-js.
      client.auth.signOut().then(done, done);
    }
    function checkIdle() {
      if (!authedUser || loggedOut) return;
      if (Date.now() - readLastActivity() >= IDLE_LIMIT_MS) logoutIdle();
    }

    // Dipanggil sekali oleh fillIdentity() dengan status sesi saat halaman dimuat.
    // Kalau sudah login DAN terakhir aktif >= 1 jam lalu (sebelum halaman ini
    // dimuat), langsung keluar -- tanpa peduli gerakan mouse setelahnya.
    onInitialSession = function (user) {
      if (user && Date.now() - bootLast >= IDLE_LIMIT_MS) logoutIdle();
    };

    // Browser membekukan timer (setInterval) pada tab yang lama disembunyikan
    // (background/minimize/tab lain aktif). Begitu tab dibuka lagi, gerakan
    // mouse pengguna langsung memicu markActivity() dan menimpa jejak waktu
    // SEBELUM interval berikutnya sempat mengecek -- akibatnya timeout terasa
    // "tidak pernah jalan" walau sudah didiamkan berjam-jam. Makanya pengecekan
    // juga dipaksa jalan persis saat tab terlihat/fokus lagi, memakai jejak
    // waktu yang MASIH LAMA (belum ketiban markActivity dari kembalinya user).
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") checkIdle();
    });
    window.addEventListener("pageshow", checkIdle);
    window.addEventListener("focus", checkIdle);

    setInterval(checkIdle, IDLE_CHECK_MS);
    if (!EMBED) { window.__gltShell = window.__gltShell || {}; window.__gltShell.logoutIdle = logoutIdle; }
  }

  // ---------------------------------------------------------------------------
  // RUANG KERJA SATU TAB: beberapa rekon sekaligus tanpa membuka tab browser baru.
  // Halaman yang pertama dibuka = "induk" (punya topbar & sidebar). Klik menu ke
  // modul LAIN tidak meninggalkan halaman induk: modul itu dimuat di dalam bingkai
  // (iframe) yang menutupi area konten, dan bingkai yang sudah pernah dibuka TETAP
  // HIDUP di belakang layar saat pindah menu — hasil rekon di tiap modul tidak hilang
  // dan tidak dimuat ulang. Klik menu modul induk -> kembali ke halaman induk.
  // Halaman di dalam bingkai berjalan dalam "mode tertanam" (?glt-embed=1): tanpa
  // topbar/sidebar sendiri. Login dipakai bersama (sesi Supabase di localStorage).
  // Ctrl/Shift/klik tengah tetap membuka tab baru seperti biasa.
  // ---------------------------------------------------------------------------
  var EMBED = (function () {
    try { return /[?&]glt-embed=1\b/.test(location.search) && window.top !== window.self; }
    catch (e) { return false; }
  })();

  function shellCss() {
    if (document.getElementById("gsWorkspaceCss")) return;
    var st = document.createElement("style");
    st.id = "gsWorkspaceCss";
    st.textContent =
      "#gsWorkspace{position:fixed;top:var(--shell-topbar-h,48px);left:var(--shell-sidebar-w,232px);right:0;bottom:0;z-index:999;display:none;background:var(--background,#F8FAFC)}" +
      "body.glt-shell--collapsed #gsWorkspace{left:var(--shell-sidebar-w-collapsed,60px)}" +
      "@media (max-width:1024px){#gsWorkspace{left:0}}" +
      "body.glt-ws-on #gsWorkspace{display:block}" +
      "body.glt-ws-on{overflow:hidden}" +
      "body.glt-shell--gated #gsWorkspace{display:none}" +
      "#gsWorkspace iframe{width:100%;height:100%;border:0;display:none;background:var(--background,#F8FAFC)}" +
      "#gsWorkspace iframe.on{display:block}" +
      "body.glt-shell.glt-embed{padding:0 !important}";
    document.head.appendChild(st);
  }

  // Link (href absolut) yang mengarah ke modul suite ini dan boleh ditangani ruang kerja.
  function modulDariKlik(e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return null;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || (a.getAttribute("target") && a.getAttribute("target") !== "_self") || a.hasAttribute("download")) return null;
    var raw = a.getAttribute("href") || "";
    if (!raw || raw.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(raw)) return null;
    var id = navIdForHref(a.href);
    return id ? { id: id, href: a.href } : null;
  }

  function setupWorkspace() {
    var here = activeNavId();
    var frames = {};           // id modul -> iframe
    var current = here;
    var baseTitle = document.title;
    var titles = {};
    shellCss();
    var box = document.createElement("div");
    box.id = "gsWorkspace";
    document.body.appendChild(box);

    function tandaiMenu(id) {
      var items = document.querySelectorAll(".shell-nav-item");
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute("data-nav") === id) items[i].setAttribute("aria-current", "page");
        else items[i].removeAttribute("aria-current");
      }
      var item = NAV.concat(ADMIN_NAV).filter(function (n) { return n.id === id; })[0];
      var crumb = document.querySelector(".shell-crumb b");
      if (crumb && item) crumb.textContent = item.label;
    }

    function tampilkan(id, href) {
      if (id === here) {
        document.body.classList.remove("glt-ws-on");
        Object.keys(frames).forEach(function (k) { frames[k].classList.remove("on"); });
        document.title = baseTitle;
      } else {
        var f = frames[id];
        if (!f) {
          f = document.createElement("iframe");
          f.title = id;
          var url = String(href).split("#")[0];
          f.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "glt-embed=1";
          f.addEventListener("load", function () {
            try { titles[id] = f.contentDocument.title; if (current === id) document.title = titles[id]; } catch (e) { /* abaikan */ }
          });
          frames[id] = f;
          box.appendChild(f);
        }
        Object.keys(frames).forEach(function (k) { frames[k].classList.toggle("on", k === id); });
        document.body.classList.add("glt-ws-on");
        if (titles[id]) document.title = titles[id];
      }
      current = id;
      tandaiMenu(id);
    }

    // Keluar/akun berganti: buang semua bingkai supaya data akun lama tidak tertinggal.
    function bersihkan() {
      Object.keys(frames).forEach(function (k) { try { frames[k].remove(); } catch (e) { /* abaikan */ } });
      frames = {};
      if (current !== here) tampilkan(here);
    }
    new MutationObserver(function () {
      if (document.body.classList.contains("glt-shell--gated") && Object.keys(frames).length) bersihkan();
    }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

    // Path halaman, dinormalkan: ".../inbound/" dan ".../inbound/index.html" dianggap sama.
    function jalur(u) {
      return String(u || "").split(/[?#]/)[0].replace(/index\.html$/i, "");
    }
    document.addEventListener("click", function (e) {
      var m = modulDariKlik(e);
      if (!m) return;
      // Modul yang sama TAPI halaman lain (mis. Inbound versi lama -> Inbound baru):
      // navigasi biasa, jangan dicegat.
      if (m.id === here && jalur(m.href) !== jalur(location.href)) return;
      e.preventDefault();
      tampilkan(m.id, m.href);
    }, true);

    // dipakai halaman tertanam (link modul di dalam bingkai) & logout idle dari bingkai
    window.__gltShell = window.__gltShell || {};
    window.__gltShell.buka = function (id, href) { tampilkan(id, href); };
  }

  // Mode tertanam: link ke modul lain di dalam bingkai diteruskan ke halaman induk.
  function setupEmbedLinks() {
    document.addEventListener("click", function (e) {
      var m = modulDariKlik(e);
      if (!m) return;
      var top = null;
      try { top = window.top.__gltShell; } catch (err) { top = null; }
      if (!top || !top.buka) return;
      e.preventDefault();
      top.buka(m.id, m.href);
    }, true);
  }

  function init() {
    if (document.querySelector(".shell-topbar")) return;

    var legacyNav = document.querySelector(".glt-nav");
    if (legacyNav && legacyNav.parentNode) legacyNav.parentNode.removeChild(legacyNav);

    if (EMBED) {
      // Di dalam bingkai ruang kerja: tanpa topbar/sidebar; aktivitas tetap dicatat
      // supaya auto-logout 1 jam memperhitungkan kerja di modul mana pun.
      shellCss();
      document.body.classList.add("glt-shell", "glt-embed");
      setupEmbedLinks();
      setupIdleLogout();
      fillIdentity();
      return;
    }

    build();
    adoptSyncStatus();
    document.body.classList.add("glt-shell");
    setupAuthGate();
    setupCollapse();
    setupDrawer();
    setupWorkspace();
    setupUserMenu();
    setupIdleLogout(); // harus sebelum fillIdentity(): memasang hook sesi awal yang dipanggil fillIdentity()
    fillIdentity();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
