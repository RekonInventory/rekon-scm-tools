// Composition root workspace Inbound: merakit service + view, alur login, event sesi.
// Arah dependensi: ui -> application -> domain / infrastructure (tidak sebaliknya).
import { h, $, announce } from "./core/dom.js";
import { log } from "./core/logger.js";
import { AppError, ConflictError, handleError, setErrorNotifier, toAppError } from "./core/errors.js";
import { createStore } from "./application/store.js";
import { createCaseService } from "./application/case-service.js";
import { createSessionService } from "./application/session-service.js";
import { createImportService } from "./application/import-service.js";
import { createReconcileService } from "./application/reconcile-service.js";
import { createExportService } from "./application/export-service.js";
import { createBackupService } from "./application/backup-service.js";
import { createEngineClient } from "./application/engine-client.js";
import { downloadBlob, downloadText } from "./application/download.js";
import { AuthRepository, displayNameFromUser } from "./infrastructure/auth-repository.js";
import { RunRepository, ActivityRepository } from "./infrastructure/run-repository.js";
import { CONFIG, isReady } from "./infrastructure/supabase.js";
import { prefetchXLSX } from "./infrastructure/xlsx-loader.js";
import { createFindingLogic, ABN_PATTERNS } from "./domain/findings.js";
import { atLeast, displayCaseId } from "./domain/case-view.js";
import { toast } from "./ui/components/toast.js";
import { confirmDialog, typedConfirmDialog, passwordDialog } from "./ui/components/dialog.js";
import { conflictDialog, restorePreviewDialog, runsDialog, activityDialog, diagnosticsDialog, shortcutsDialog, sessionFoundDialog } from "./ui/dialogs.js";
import { mountHeader } from "./ui/views/header.js";
import { mountSessionBar } from "./ui/views/session-bar.js";
import { mountImportWorkspace } from "./ui/views/import-workspace.js";
import { mountSummary } from "./ui/views/summary.js";
import { mountFindings } from "./ui/views/findings.js";
import { createDetailDrawer } from "./ui/views/detail-drawer.js";

const DEFAULT_VIEW = () => ({ brand: "ADIDAS", mode: "nopen", filter: "issues", q: "", page: 0, colFilters: {},
  abnormalStatus: { "OPEN": true, "IN PROGRESS": true, "CLOSED": false }, caseType: "", month: "", sort: null });

const store = createStore({
  user: null, role: "operator", result: null, view: DEFAULT_VIEW(), importItems: [], gate: { ok: false, reason: "Berkas SCM belum dimuat." },
  session: { row: null }, sync: { state: "idle", at: null }, caseRev: 0, selection: null,
  busy: { running: false, exporting: false }, __renderOpts: null
});

setErrorNotifier((e, opts) => toast(e.userMessage, "error", { action: opts.retry ? { label: "Coba lagi", onClick: opts.retry } : null }));
window.__inboundLog = log;   // bantu dukungan teknis: __inboundLog.text() di console

const app = { store, actions: {} };
const me = () => { const u = store.get().user; return { user_id: u ? u.id : null, name: displayNameFromUser(u) }; };

/* ---------------- sinkron status (dibaca juga oleh shell lewat #syncStatus) ---------------- */
function setSync(state) {
  store.set({ sync: { state, at: state === "synced" ? Date.now() : store.get().sync.at } });
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = state === "syncing" ? "menyinkronkan…" : state === "error" ? "gagal sinkron" : state === "synced" ? "tersinkron · " + new Date().toLocaleTimeString("id-ID") : "";
}
const bumpCases = () => store.set({ caseRev: store.get().caseRev + 1 });

/* ---------------- services ---------------- */
const cases = createCaseService({ onChange: (evt) => { bumpCases(); if (evt.type === "remote") setSync("synced"); } });
app.cases = cases;
const engine = createEngineClient((p) => imports.progress(p));
const imports = createImportService({
  engine,
  onChange: (evt) => {
    const patch = { importItems: imports.items() };
    if (evt.type === "gate") patch.gate = evt.gate;
    store.set(patch);
  }
});
let staleTimer = null;
const session = createSessionService({ identity: me, onEvent: onSessionEvent });
const reconciler = createReconcileService({ engine, cases, session, imports, whoAmI: () => me().name });
const exporter = createExportService({ cases });
const backup = createBackupService({ cases, whoAmI: () => me().name, periodKey: () => (store.get().result || {}).periodKey || null });

app.session = session;   // untuk dialog diagnostik & harness uji
app.logic = createFindingLogic({ result: () => store.get().result, view: () => store.get().view, cases: cases.store });

function publishSession() {
  const row = session.current();
  store.set({ session: { row, role: session.role(), followMode: session.followMode(), presence: session.presence(), connection: session.connection(), stale: row ? session.isStale(row) : false } });
}

/* ---------------- tampilan / filter ---------------- */
function setView(patch, opts) {
  const view = Object.assign({}, store.get().view, patch);
  store.set({ view, __renderOpts: opts || null });
  session.broadcastView(view);
}
const A = app.actions;
A.setView = setView;
A.setBrand = (b) => setView({ brand: b, page: 0, filter: "issues", mode: "nopen", colFilters: {} });
A.setMode = (m) => setView({ mode: m, page: 0, colFilters: {} });
A.setFilter = (f) => setView({ filter: f, page: 0 });
A.toggleAbnormalStatus = (st) => { const cur = Object.assign({}, store.get().view.abnormalStatus); cur[st] = !cur[st]; setView({ abnormalStatus: cur, page: 0 }); };
A.setColFilter = (key, val) => { const cf = Object.assign({}, store.get().view.colFilters); if (val) cf[key] = val; else delete cf[key]; setView({ colFilters: cf, page: 0 }); };
A.clearColFilters = () => setView({ colFilters: {}, page: 0 });
A.resetFilters = () => { setView({ q: "", filter: "issues", page: 0, colFilters: {}, caseType: "", month: "", sort: null }); announce("Filter direset"); };
A.setSort = (key) => {
  const cur = store.get().view.sort;
  const next = !cur || cur.key !== key ? { key, dir: "asc" } : (cur.dir === "asc" ? { key, dir: "desc" } : null);
  setView({ sort: next, page: 0 });
};
A.applyKpi = (k) => {
  const patch = { filter: k.filter, mode: "nopen", page: 0 };
  if (k.pattern && ABN_PATTERNS[k.pattern]) patch.abnormalStatus = Object.assign({}, ABN_PATTERNS[k.pattern]);
  setView(patch);
  const t = document.getElementById("ibFindingsTitle");
  if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); }
  announce("Tabel temuan difilter");
};

/* ---------------- detail NOPEN ---------------- */
const drawer = createDetailDrawer(app);
A.openNopen = (brand, nopen, returnEl, opts) => {
  store.set({ selection: { brand, nopen } });
  drawer.open(brand, nopen, opts && opts.keepDrawer ? undefined : (returnEl || document.activeElement));
  session.broadcastCaseOpened(brand, nopen);
};

A.saveCase = async (input) => {
  setSync("syncing");
  try {
    const res = await cases.save(input);
    setSync("synced");
    if (res.status === "saved") toast("Case " + displayCaseId(res.id) + " tersimpan.", "success");
    else if (res.status === "empty") toast("Case kosong tidak disimpan — isi remark, status, PIC, tindakan, atau penyesuaian.", "info");
    return res;
  } catch (e) {
    setSync("synced");
    if (e instanceof ConflictError) {
      const canOverwrite = atLeast(store.get().role, "supervisor");
      const choice = await conflictDialog(e, input, canOverwrite);
      if (choice === "overwrite") {
        try {
          const res = await cases.save(Object.assign({}, input, { force: true }));
          toast("Case ditimpa dengan versi Anda (tercatat di audit sebagai penimpaan).", "warning");
          return res;
        } catch (e2) { handleError(e2, "menimpa case"); return { status: "error" }; }
      }
      await cases.reloadOne(input.caseId || "").catch(() => {});
      drawer.resetEditor(input.caseId);
      toast("Versi terbaru dimuat. Periksa lalu ulangi perubahan Anda bila masih perlu.", "info");
      return { status: "reload" };
    }
    handleError(e, "menyimpan case", { retry: () => A.saveCase(input) });
    return { status: "error" };
  }
};

A.confirmDeleteCase = async (c) => {
  const ok = await confirmDialog("Hapus case " + displayCaseId(c.id) + " untuk NOPEN " + c.nopen + "?\n\nCase disembunyikan dari tampilan aktif; riwayat audit tetap tersimpan di server dan hanya supervisor/admin yang dapat memulihkannya.",
    { title: "Hapus case", danger: true, okLabel: "Hapus case" });
  if (!ok) return false;
  try {
    await cases.remove(c.id, "Dihapus dari detail NOPEN");
    toast("Case " + displayCaseId(c.id) + " dihapus.", "success");
    return true;
  } catch (e) {
    if (e instanceof ConflictError) { toast(e.userMessage, "warning"); return false; }
    handleError(e, "menghapus case", { retry: () => A.confirmDeleteCase(c) });
    return false;
  }
};

/* ---------------- impor & rekonsiliasi ---------------- */
A.addFiles = (files) => {
  if (!files || !files.length) return;
  if (session.role() === "FOLLOWER") { toast("Berhenti mengikuti sesi terlebih dahulu untuk mengunggah berkas sendiri.", "info"); return; }
  const names = Array.from(files).map((f) => f.name);
  imports.add(files).then(() => {
    const items = imports.items().filter((i) => names.indexOf(i.name) !== -1);
    ActivityRepository.record("import", { files: items.map((i) => ({ name: i.name, kind: i.kind || null, status: i.display, rows: i.summary ? i.summary.rowCount : 0 })) });
    const bad = items.filter((i) => i.state === "invalid");
    if (bad.length) toast(bad.length + " berkas tidak valid: " + bad.map((i) => i.name).join(", ") + ". Buka hasil validasinya untuk detail.", "warning");
    const pend = items.filter((i) => i.state === "needs-classification");
    if (pend.length) toast("Jenis " + pend.map((i) => i.name).join(", ") + " belum bisa dipastikan — pilih jenisnya secara manual.", "info");
  }).catch((e) => handleError(e, "memproses berkas"));
};
A.classifyFile = (id, kind) => imports.classify(id, kind);
A.removeFile = async (id) => {
  await imports.remove(id);
  if (store.get().result && session.role() !== "FOLLOWER") { store.set({ result: null }); drawer.close(); }  // perilaku lama: hasil disembunyikan
};
A.resetFiles = async () => {
  const ok = await confirmDialog("Kosongkan semua berkas yang dimuat? Hasil rekonsiliasi di layar juga akan dibersihkan (case di server tidak terpengaruh).", { okLabel: "Kosongkan" });
  if (!ok) return;
  await imports.reset();
  if (session.role() !== "FOLLOWER") { store.set({ result: null }); drawer.close(); }
};

A.runReconcile = async () => {
  if (store.get().busy.running) return;
  store.set({ busy: Object.assign({}, store.get().busy, { running: true }) });
  announce("Menjalankan rekonsiliasi");
  try {
    const out = await reconciler.run();
    const r = out.result;
    store.set({ result: r, view: Object.assign(DEFAULT_VIEW(), { brand: r.adidas ? "ADIDAS" : "NIKE", sort: store.get().view.sort }), selection: null });
    bumpCases();
    toast("Rekonsiliasi selesai: " + r.overall.status + " — " + r.overall.reason, r.overall.status === "CLEAR" ? "success" : "info");
    out.warnings.forEach((w) => toast(w, "warning"));
    if (out.reevaluation.total) toast(out.reevaluation.total + " case penyesuaian qty dievaluasi ulang otomatis.", "info");
    const t = document.getElementById("ibSummaryRegion");
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
    announce("Rekonsiliasi selesai. Status " + r.overall.status);
  } catch (e) {
    handleError(e, "menjalankan rekonsiliasi", { retry: A.runReconcile });
  } finally {
    store.set({ busy: Object.assign({}, store.get().busy, { running: false }) });
    publishSession();
  }
};

/* ---------------- export / backup ---------------- */
async function withExporting(fn, what) {
  store.set({ busy: Object.assign({}, store.get().busy, { exporting: true }) });
  try { await fn(); toast("File " + what + " sedang diunduh.", "success"); }
  catch (e) { handleError(e, "membuat file " + what); }
  finally { store.set({ busy: Object.assign({}, store.get().busy, { exporting: false }) }); }
}
A.exportFull = () => withExporting(() => exporter.full(store.get().result, imports.items()), "export lengkap");
A.exportFiltered = () => withExporting(() => {
  const v = store.get().view;
  const rows = app.visibleRows();
  const payload = v.mode === "detail" ? { main: [], detail: rows } : { main: rows, detail: [] };
  return exporter.filtered(store.get().result, payload, v, app.logic.currentFilterLabel());
}, "export hasil filter");
A.backupCases = () => {
  try { const n = backup.exportBackup(); toast("Cadangan " + n + " case diunduh.", "success"); }
  catch (e) { handleError(e, "membuat cadangan"); }
};
A.restoreCases = () => {
  const input = h("input", { type: "file", accept: ".json,application/json", class: "gs-sr-only" });
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    try {
      const pv = await backup.preview(f);
      if (!pv.ok) { toast(pv.error, "error"); return; }
      const chosen = await restorePreviewDialog(pv);
      if (!chosen || !chosen.size) return;
      const sum = await backup.apply(pv, chosen);
      const bits = [sum.applied + " dipulihkan"];
      if (sum.conflicts.length) bits.push(sum.conflicts.length + " konflik versi (dilewati)");
      if (sum.rejected.length) bits.push(sum.rejected.length + " ditolak");
      if (sum.errors.length) bits.push(sum.errors.length + " gagal");
      toast("Pemulihan selesai: " + bits.join(", ") + ".", sum.errors.length || sum.rejected.length ? "warning" : "success",
        { detail: sum.errors.length ? toAppError(sum.errors[0].error, "memulihkan case").userMessage : null });
    } catch (e) { handleError(e, "memulihkan case"); }
  });
  document.body.appendChild(input);
  input.click();
};
A.deleteAllCases = async () => {
  const n = Object.keys(cases.store.all()).length;
  if (!n) { toast("Tidak ada case aktif untuk dihapus.", "info"); return; }
  const ok = await typedConfirmDialog("Ini akan menghapus SEMUA " + n + " case aktif (Adidas + Nike) untuk SEMUA pengguna di workspace ini. Cadangan otomatis diunduh lebih dulu. " +
    "Penghapusan bersifat soft delete dan tercatat di audit server.", "HAPUS SEMUA", { title: "Hapus semua case", okLabel: "Hapus semua case" });
  if (!ok) return;
  try {
    backup.exportBackup();
    const deleted = await cases.deleteAll("HAPUS SEMUA", "Hapus semua case dari workspace Inbound");
    ActivityRepository.record("cases_delete_all", { count: deleted });
    toast(deleted + " case dihapus. Cadangan tersimpan di file unduhan.", "success");
  } catch (e) { handleError(e, "menghapus semua case"); cases.load().catch(() => {}); }
};

/* ---------------- sesi kolaborasi ---------------- */
function applyFollowedResult(decoded) {
  cases.setContext({ periodKey: decoded.periodKey || null });
  store.set({ result: decoded, view: Object.assign(DEFAULT_VIEW(), { brand: decoded.adidas ? "ADIDAS" : "NIKE" }), selection: null });
}
async function followLatest(minVersion) {
  try {
    const fresh = await session.pullLatest();
    applyFollowedResult(await session.loadSnapshot(fresh, minVersion));
    announce("Data sesi diperbarui oleh owner");
  } catch (e) { handleError(e, "memuat data sesi"); }
}
function onSessionEvent(evt) {
  publishSession();
  if (evt.type === "closed") toast("Sesi ini telah ditutup oleh " + (evt.by || "pemiliknya") + ".", "warning");
  if (evt.type !== "broadcast") return;
  const p = evt.payload || {};
  const role = session.role();
  if (p.type === "DATA_UPDATED" && role === "FOLLOWER") followLatest(p.version);
  else if (p.type === "SESSION_CLOSED" && role === "FOLLOWER") { toast("Sesi ini telah ditutup oleh pemiliknya.", "warning", { timeout: 10000 }); session.leave(); }
  else if (p.type === "VIEW_CHANGED" && role === "FOLLOWER" && session.followMode() === "view" && p.view) {
    store.set({ view: Object.assign({}, store.get().view, p.view) });
  } else if (p.type === "CASE_OPENED" && role === "FOLLOWER" && session.followMode() === "view" && p.nopen) {
    A.openNopen(p.brand, p.nopen);
  } else if (p.type === "SESSION_UPDATED") {
    session.pullLatest().catch(() => {});
    if (p.takeover && role === "OWNER" && session.current() && session.current().owner_id !== me().user_id) toast("Sesi diambil alih oleh " + (p.from || "pengguna lain") + ".", "warning");
  }
}
A.setFollowMode = async (m) => {
  session.setFollowMode(m);
  if (m === "view") {
    try { const fresh = await session.pullLatest(); if (fresh && fresh.view_state) store.set({ view: Object.assign({}, store.get().view, fresh.view_state) }); }
    catch (e) { handleError(e, "menyamakan tampilan owner"); }
  }
};
A.leaveSession = () => { session.leave(); ActivityRepository.record("session_leave", null); toast("Anda berhenti mengikuti sesi. Hasil terakhir tetap tampil; upload berkas sudah aktif lagi.", "info"); };
A.closeSession = async () => {
  const ok = await confirmDialog("Tutup sesi ini? Follower tidak lagi melihat sesi ini sebagai aktif (snapshot tetap tersimpan).", { okLabel: "Tutup sesi" });
  if (!ok) return;
  try { await session.close(); ActivityRepository.record("session_close", null); toast("Sesi ditutup.", "success"); }
  catch (e) { handleError(e, "menutup sesi"); }
};
A.takeoverSession = async () => {
  const ok = await confirmDialog("Ambil alih sesi ini sebagai owner? Anda akan bisa mengunggah ulang berkas & menjalankan rekonsiliasi.", { okLabel: "Ambil alih" });
  if (!ok) return;
  try { await session.takeover(); ActivityRepository.record("session_takeover", { session: session.current() && session.current().id }); toast("Anda sekarang owner sesi ini.", "success"); }
  catch (e) { handleError(e, "mengambil alih sesi"); }
};
A.downloadSource = async (kind) => {
  try { const f = await session.downloadSource(kind); downloadBlob(f.blob, f.name); }
  catch (e) { handleError(e, "mengunduh berkas sumber"); }
};

/* ---------------- dialog info ---------------- */
A.showRuns = async () => { try { runsDialog(await RunRepository.recent(15)); } catch (e) { runsDialog([], toAppError(e).userMessage); } };
A.showActivity = async () => { try { activityDialog(await ActivityRepository.recent(60)); } catch (e) { activityDialog([], toAppError(e).userMessage); } };
A.showShortcuts = () => shortcutsDialog();
A.showDiagnostics = () => {
  const s = store.get(), row = session.current();
  diagnosticsDialog({
    "Aplikasi": "Inbound " + CONFIG.appVersion + " (" + CONFIG.appBuild + ")", "Mesin": engine.mode(), "Role": s.role,
    "Pengguna": me().name || "-", "Workspace": CONFIG.workspaceId, "Sesi": row ? row.id + " v" + row.version + " (" + session.role() + ")" : "-",
    "Realtime": session.connection(), "Case dimuat": Object.keys(cases.store.all()).length, "Browser": navigator.userAgent
  }, log.text());
};

/* ---------------- auth ---------------- */
let lastUserId = null;
async function onAuth(sessionObj) {
  const user = sessionObj && sessionObj.user ? sessionObj.user : null;
  const changed = (user && user.id) !== lastUserId;
  lastUserId = user ? user.id : null;
  document.body.classList.toggle("authed", !!user);
  store.set({ user });
  if (!user) {
    cases.unsubscribe(); session.leave(); clearInterval(staleTimer);
    return;
  }
  if (!changed) return;
  cases.store.setUser(displayNameFromUser(user));       // nama asli login (bukan field bebas)
  const acct = document.getElementById("acctEmail");
  if (acct) acct.textContent = displayNameFromUser(user);
  AuthRepository.myRole().then((r) => {
    store.set({ role: r.role });
    if (!r.migrated) toast("Server belum diperbarui ke versi terbaru (migrasi database Inbound). Beberapa fitur (audit, run, penguncian versi) belum aktif — hubungi admin.", "warning", { timeout: 0 });
  });
  setSync("syncing");
  try { await cases.load(); setSync("synced"); }
  catch (e) { setSync("error"); handleError(e, "memuat case dari server", { retry: () => cases.load().then(() => setSync("synced")) }); }
  cases.subscribe((st) => { if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") log.warn("cases:realtime", { st }); });
  prefetchXLSX();
  engine.init().catch(() => {});
  try {
    const found = await session.checkActive();
    if ((found.action === "reclaimed" || found.action === "rejoined") && !store.get().result) {
      try { applyFollowedResult(await session.loadSnapshot(found.session)); }
      catch (e) { if (!(e instanceof AppError && e.code === "SNAPSHOT_EMPTY")) handleError(e, "memuat hasil sesi"); }
    } else if (found.action === "found") {
      const s = found.session, src = s.source_names || {};
      const choice = await sessionFoundDialog(s, ["scm", "ior", "nike"].map((k) => src[k]).filter(Boolean).join(", "));
      if (choice === "join") {
        session.join(s);
        ActivityRepository.record("session_join", { session: s.id });
        try { applyFollowedResult(await session.loadSnapshot(s)); } catch (e) { handleError(e, "memuat hasil sesi"); }
      }
    }
  } catch (e) { handleError(e, "memeriksa sesi aktif", { silent: true }); }
  publishSession();
  clearInterval(staleTimer);
  staleTimer = setInterval(publishSession, 30000);
}

function wireAuthUi() {
  const form = $("#authForm"), err = $("#authErr"), btn = $("#authSubmit");
  if (!isReady()) {
    err.textContent = "Koneksi server tidak tersedia (pustaka Supabase gagal dimuat). Periksa jaringan lalu muat ulang halaman.";
    btn.disabled = true;
    return false;
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = ""; btn.disabled = true; btn.setAttribute("aria-busy", "true");
    const res = await AuthRepository.signIn($("#authEmail").value.trim(), $("#authPass").value).catch((x) => ({ error: x }));
    btn.disabled = false; btn.removeAttribute("aria-busy");
    if (res.error) {
      err.textContent = /fetch|network/i.test(String(res.error.message || "")) ? "Tidak dapat terhubung ke server. Periksa jaringan." :
        "Nama pengguna atau kata sandi salah, atau akun belum dibuat. Hubungi admin untuk reset kata sandi.";
      $("#authPass").focus();
    } else { $("#authPass").value = ""; }
  });
  // Tombol tersembunyi ini dipanggil oleh menu pengguna di app shell (glt-app-shell.js).
  $("#btnSignOut").addEventListener("click", async () => {
    if (drawer.isEditingDirty() && !(await confirmDialog("Ada perubahan case yang belum disimpan. Tetap keluar?", { danger: true, okLabel: "Keluar" }))) return;
    if (!(await confirmDialog("Keluar dari akun ini?", { okLabel: "Keluar" }))) return;
    await AuthRepository.signOut();
  });
  $("#btnChangePassword").addEventListener("click", async () => {
    const pw = await passwordDialog();
    if (!pw) return;
    try { await AuthRepository.changePassword(pw); toast("Password berhasil diganti. Gunakan password baru saat login berikutnya.", "success"); }
    catch (e) { handleError(e, "mengganti password"); }
  });
  return true;
}

/* ---------------- start ---------------- */
function start() {
  mountHeader($("#ibHeader"), app);
  mountSessionBar($("#ibSession"), app);
  mountImportWorkspace($("#ibImport"), app);
  mountSummary($("#ibSummary"), app);
  mountFindings($("#ibFindings"), app);
  window.addEventListener("beforeunload", (e) => {
    if (drawer.isEditingDirty() || imports.busy() || store.get().busy.running) { e.preventDefault(); e.returnValue = ""; }
  });
  if (!wireAuthUi()) return;
  AuthRepository.onChange((_evt, s) => { onAuth(s).catch((e) => handleError(e, "memuat sesi login")); });
  AuthRepository.getSession().then((s) => onAuth(s)).catch((e) => handleError(e, "memuat sesi login"));
  log.info("app:start", { version: CONFIG.appVersion });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

export { app, downloadText };
