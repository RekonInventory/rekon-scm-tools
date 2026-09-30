/* Konfigurasi koneksi Supabase untuk workspace Inbound (script klasik, dimuat
   sebelum glt-app-shell.js dan modul aplikasi).

   - Kunci "anon" memang publik dan aman di client selama RLS aktif di server.
     JANGAN PERNAH menaruh service-role key di file frontend mana pun.
   - storageKey default dipakai supaya sesi login dibagikan dengan tool lain
     (outbound/inventory/versi lama) di domain yang sama.
   - `window.supa` diekspos karena glt-app-shell.js membaca binding global `supa`. */
(function () {
  "use strict";
  var SUPABASE_URL = "https://xyvldxygnkwztsmhrwci.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5dmxkeHlnbmt3enRzbWhyd2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3MDk3MDgsImV4cCI6MjEwNTI4NTcwOH0.-xXLPyICbdjFAWhBxRDDrnBUBfUT6woSAzDuEReJjuA";

  window.GLT_INBOUND_CONFIG = {
    supabaseUrl: SUPABASE_URL,
    workspaceId: "default",
    sessionTool: "rekonsiliasi_inbound",
    snapshotBucket: "inbound-snapshots",
    usernameDomain: "@rekon.local",
    appVersion: "3.0.0",
    appBuild: "2026-09-30"
  };

  var lib = window.supabase;
  window.supa = (lib && typeof lib.createClient === "function")
    ? lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: { params: { eventsPerSecond: 20 } } })
    : null;
})();
