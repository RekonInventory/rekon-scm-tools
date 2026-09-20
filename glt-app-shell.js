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

  var NAV = [
    { id: "dashboard", href: "index.html",                label: "Dashboard", icon: "grid" },
    { id: "outbound",  href: "outbound.html",             label: "Outbound",  icon: "upload" },
    { id: "inbound",   href: "Rekonsiliasi_Inbound.html", label: "Inbound",   icon: "download" },
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

  function currentFile() {
    var path = location.pathname || "";
    var file = path.substring(path.lastIndexOf("/") + 1);
    return (file || "index.html").toLowerCase();
  }

  function activeNavId() {
    var file = currentFile();
    var all = NAV.concat(ADMIN_NAV);
    for (var i = 0; i < all.length; i++) {
      if (all[i].href.toLowerCase() === file) return all[i].id;
    }
    return "dashboard";
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
    return '<a class="shell-nav-item" href="' + item.href + '" data-nav="' + item.id + '" title="' + item.label + '"' +
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
      '<a class="shell-brand" href="index.html"><span class="shell-brand-mark"></span><b>GLT</b> <span>Rekon Suite</span></a>' +
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

    function relativeLabel(ms) {
      var secs = Math.max(0, Math.round(ms / 1000));
      if (secs < 10) return "Tersinkron barusan";
      if (secs < 60) return "Tersinkron " + secs + " detik lalu";
      var mins = Math.round(secs / 60);
      if (mins < 60) return "Tersinkron " + mins + " menit lalu";
      var hrs = Math.round(mins / 60);
      return "Tersinkron " + hrs + " jam lalu";
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
        live.textContent = relativeLabel(Date.now() - lastSyncAt);
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

  function fillIdentity() {
    var client = supaClient();
    var nameEl = document.getElementById("gsUserName");
    var avatarEl = document.getElementById("gsAvatar");
    var menuName = document.getElementById("gsMenuName");
    var menuMeta = document.getElementById("gsMenuMeta");
    var adminGroup = document.getElementById("gsAdminGroup");

    function render(user) {
      authedUser = user;
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
      var isAdmin = !!(user.user_metadata && user.user_metadata.is_admin === true);
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
  var IDLE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 jam
  var IDLE_CHECK_MS = 30 * 1000;
  var IDLE_STORAGE_KEY = "glt-last-activity";
  var IDLE_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"];

  function setupIdleLogout() {
    var lastMark = 0; // throttle penulisan localStorage, bukan sumber kebenaran waktunya

    function markActivity() {
      var now = Date.now();
      if (now - lastMark < 5000) return;
      lastMark = now;
      try { localStorage.setItem(IDLE_STORAGE_KEY, String(now)); } catch (e) { /* mode privat */ }
    }
    function readLastActivity() {
      try {
        var v = parseInt(localStorage.getItem(IDLE_STORAGE_KEY), 10);
        return isNaN(v) ? Date.now() : v;
      } catch (e) { return Date.now(); }
    }

    markActivity();
    IDLE_EVENTS.forEach(function (evt) {
      document.addEventListener(evt, markActivity, { passive: true });
    });

    var loggedOut = false;
    setInterval(function () {
      if (!authedUser || loggedOut) return;
      var idleFor = Date.now() - readLastActivity();
      if (idleFor < IDLE_LIMIT_MS) return;
      loggedOut = true;
      var client = supaClient();
      if (!client) return;
      client.auth.signOut().then(function () {
        shellToast("Sesi berakhir karena tidak ada aktivitas selama 2 jam. Silakan masuk kembali.");
        setTimeout(function () { location.reload(); }, 1200);
      });
    }, IDLE_CHECK_MS);
  }

  function init() {
    if (document.querySelector(".shell-topbar")) return;

    var legacyNav = document.querySelector(".glt-nav");
    if (legacyNav && legacyNav.parentNode) legacyNav.parentNode.removeChild(legacyNav);

    build();
    adoptSyncStatus();
    document.body.classList.add("glt-shell");
    setupAuthGate();
    setupCollapse();
    setupDrawer();
    setupUserMenu();
    fillIdentity();
    setupIdleLogout();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
