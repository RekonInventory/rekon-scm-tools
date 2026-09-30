// IMPORT WORKSPACE: dropzone + kartu berkas per slot (SCM / IOR / DRR) dengan status
// pipeline yang nyata, validasi terstruktur, klasifikasi manual, dan tombol jalankan.
import { h, replace, button, nextId } from "../../core/dom.js";
import { icon } from "../../core/icons.js";
import { C } from "../../core/util.js";
import { KIND_LABEL } from "../../domain/detection.js";

const SLOT_HINT = {
  scm: "Sheet SCM berisi NOPEN, SO, PO, QTY KMS, QTY CBM, GRN DATE, Product Category.",
  ior: "IOR.xlsx — sheet Inbound + BAP (NOPEN di kolom PEB NO).",
  nike: "DRR Master (Nike)."
};
const STATE_LABEL = {
  queued: "Antre", reading: "Membaca", detected: "Terdeteksi", validating: "Memvalidasi",
  ready: "Siap", invalid: "Tidak valid", "needs-classification": "Perlu klasifikasi"
};
const DISPLAY = {
  READY: { tone: "success", icon: "checkCircle", text: "READY" },
  WARNING: { tone: "warning", icon: "warning", text: "WARNING" },
  INVALID: { tone: "danger", icon: "error", text: "INVALID" },
  "PERLU KLASIFIKASI": { tone: "warning", icon: "info", text: "PILIH JENIS" }
};
const STEPS = ["Upload", "Deteksi", "Validasi", "Siap", "Rekonsiliasi"];

function fmtSize(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

export function mountImportWorkspace(root, app) {
  const { store, actions } = app;
  const inputId = nextId("file");
  const fileInput = h("input", { type: "file", id: inputId, class: "gs-sr-only", multiple: true, accept: ".xlsx,.xls,.xlsm",
    onChange: (e) => { actions.addFiles(e.target.files); e.target.value = ""; } });
  let expandedIssues = new Set();
  let collapsed = false;
  let lastResult = null;

  function statusBadge(it) {
    const busy = ["queued", "reading", "detected", "validating"].indexOf(it.state) !== -1;
    if (busy) return h("span", { class: "gs-badge gs-badge--primary" }, h("span", { class: "gs-spinner ib-spin-sm", "aria-hidden": "true" }), (STATE_LABEL[it.state] || it.state).toUpperCase());
    const d = DISPLAY[it.display] || DISPLAY.INVALID;
    return h("span", { class: "gs-badge gs-badge--" + d.tone }, icon(d.icon, 12), d.text);
  }

  function issuesList(it) {
    const issues = it.issues || [];
    if (!issues.length) return null;
    const id = "iss-" + it.id;
    const open = expandedIssues.has(it.id);
    const counts = issues.reduce((m, i) => { m[i.severity] = (m[i.severity] || 0) + 1; return m; }, {});
    const label = [counts.error ? counts.error + " error" : null, counts.warning ? counts.warning + " peringatan" : null, counts.info ? counts.info + " info" : null].filter(Boolean).join(" · ");
    return h("div", { class: "ib-issues" },
      h("button", { type: "button", class: "ib-disclosure", "aria-expanded": String(open), "aria-controls": id,
        onClick: () => { if (open) expandedIssues.delete(it.id); else expandedIssues.add(it.id); render(); } },
        icon(open ? "chevronDown" : "chevronRight", 14), "Hasil validasi: " + label),
      h("ul", { class: "ib-issue-list", id, hidden: !open },
        issues.map((i) => h("li", { class: "ib-issue is-" + i.severity },
          icon(i.severity === "error" ? "error" : i.severity === "warning" ? "warning" : "info", 14),
          h("div", null,
            h("div", { class: "ib-issue-msg" }, i.message),
            h("div", { class: "ib-issue-meta" }, [i.code, i.field ? "kolom " + i.field : null, i.row ? "baris " + i.row : null, i.sheet ? "sheet " + i.sheet : null].filter(Boolean).join(" · "),
              i.samples && i.samples.length ? " · contoh: " + i.samples.slice(0, 5).join(", ") : ""))))));
  }

  function fileCard(it, disabled) {
    const s = it.summary, rep = s && s.report;
    const busy = ["queued", "reading", "detected", "validating"].indexOf(it.state) !== -1;
    const state = busy ? "loading" : (it.display === "READY" ? "ready" : (it.display === "WARNING" || it.state === "needs-classification" ? "warning" : "error"));
    const metaBits = [
      it.kind ? KIND_LABEL[it.kind] : null, fmtSize(it.size), s ? "sheet " + s.sheet : null,
      rep ? C.fmtNum(rep.totalRows) + " baris (" + C.fmtNum(rep.validRows) + " valid)" : null,
      rep && rep.dateMin ? C.fmtDate(new Date(rep.dateMin)) + " – " + C.fmtDate(new Date(rep.dateMax)) : null,
      s && s.detect && s.detect.confidence !== undefined ? "keyakinan " + Math.round(s.detect.confidence * 100) + "%" : null
    ].filter(Boolean);
    return h("article", { class: "gs-file-card ib-file", dataset: { state }, "aria-label": "Berkas " + it.name },
      h("span", { class: "ib-file-icon" }, icon("sheet", 20)),
      h("div", { class: "ib-file-main" },
        h("div", { class: "ib-file-top" },
          h("div", { class: "gs-file-name", title: it.name }, it.name),
          statusBadge(it)),
        h("div", { class: "gs-file-meta" }, metaBits.join(" · ")),
        busy ? h("div", { class: "ib-file-progress" },
          h("div", { class: "gs-progress", role: "progressbar", "aria-label": "Progres " + it.name, "aria-valuemin": "0", "aria-valuemax": "100",
            "aria-valuenow": it.state === "reading" ? String(Math.round((it.progress || 0) * 100)) : null, "aria-valuetext": it.stage || STATE_LABEL[it.state] },
            h("i", { style: { width: it.state === "reading" ? Math.round((it.progress || 0) * 100) + "%" : "100%" }, class: it.state === "reading" ? null : "is-indeterminate" })),
          h("div", { class: "gs-file-msg" }, it.stage || "")) : null,
        it.state === "needs-classification" ? classifyRow(it, disabled) : null,
        issuesList(it)),
      button("Hapus berkas " + it.name, { iconOnly: true, icon: "x", variant: "ghost", size: "sm", class: "ib-file-remove",
        attrs: { disabled: disabled || busy, title: "Hapus berkas" }, onClick: () => actions.removeFile(it.id) }));
  }

  function classifyRow(it, disabled) {
    const sel = h("select", { class: "gs-select gs-select--sm", "aria-label": "Jenis berkas " + it.name },
      h("option", { value: "" }, "— pilih jenis —"),
      Object.keys(KIND_LABEL).map((k) => h("option", { value: k }, KIND_LABEL[k])));
    return h("div", { class: "ib-classify" },
      sel,
      button("Terapkan", { size: "sm", variant: "primary", attrs: { disabled }, onClick: () => { if (sel.value) actions.classifyFile(it.id, sel.value); else sel.focus(); } }));
  }

  function slot(kind, items, disabled) {
    const it = items.find((x) => x.kind === kind && x.summary);
    return h("section", { class: "ib-slot", "aria-label": "Slot " + KIND_LABEL[kind] },
      h("h3", { class: "ib-slot-title" }, KIND_LABEL[kind], kind === "scm" ? h("span", { class: "ib-req" }, "wajib") : h("span", { class: "ib-opt" }, "pembanding")),
      it ? fileCard(it, disabled) : h("div", { class: "ib-slot-empty" }, icon("file", 18), h("div", null, h("b", null, "Belum ada berkas"), h("p", null, SLOT_HINT[kind]))));
  }

  function stepper(items, gate, running, hasResult) {
    const any = items.length > 0;
    const busy = items.some((i) => ["queued", "reading", "detected", "validating"].indexOf(i.state) !== -1);
    const detected = items.some((i) => i.det || i.kind);
    const validated = items.some((i) => i.summary);
    let active = !any ? 0 : busy ? (detected ? 2 : 1) : gate.ok ? (running ? 4 : 3) : 2;
    if (hasResult && !busy && !running) active = 5;
    return h("ol", { class: "gs-steps ib-steps", "aria-label": "Tahap impor" },
      STEPS.map((label, i) => [
        i ? h("li", { class: "gs-step-sep", "aria-hidden": "true" }) : null,
        h("li", { class: "gs-step", dataset: { state: i < active ? "done" : (i === active ? "active" : "todo") }, "aria-current": i === active ? "step" : null },
          h("span", { class: "gs-step-num" }, i < active ? icon("check", 11) : String(i + 1)), label)
      ]));
  }

  function render() {
    const s = store.get();
    const items = s.importItems || [];
    const gate = s.gate || { ok: false };
    const follower = s.session && s.session.role === "FOLLOWER";
    const running = s.busy.running;
    const anyBusy = items.some((i) => ["queued", "reading", "detected", "validating"].indexOf(i.state) !== -1);
    const extra = items.filter((i) => !i.summary);   // perlu klasifikasi / gagal dibaca
    const hasResult = !!s.result;
    if (s.result !== lastResult) { collapsed = hasResult; lastResult = s.result; }   // hasil baru -> ringkas otomatis
    const collapsible = hasResult && !anyBusy && !running;
    const isCollapsed = collapsible && collapsed;
    const bodyId = "ibImportBody";
    const readyCount = items.filter((i) => i.summary && i.display !== "INVALID").length;
    fileInput.disabled = !!follower;
    const hasWarn = items.some((i) => i.display === "WARNING");

    const runBtn = button(hasResult ? "Jalankan ulang rekonsiliasi" : "Jalankan rekonsiliasi", {
      variant: "primary", icon: "play", attrs: { disabled: follower || !gate.ok || anyBusy || running, "aria-busy": running ? "true" : null, "aria-describedby": "ibGateMsg" },
      onClick: actions.runReconcile });
    if (running) runBtn.classList.add("gs-btn--loading");

    replace(root,
      h("div", { class: "gs-card-head" },
        h("div", null,
          h("h2", { class: "gs-card-title", id: "ibImportTitle" }, "Import workspace"),
          h("p", { class: "gs-card-sub" }, isCollapsed ? (readyCount + " berkas terpakai pada hasil saat ini") : "Upload SCM, IOR (Adidas), dan DRR (Nike) — jenis berkas dideteksi otomatis dari isi sheet.")),
        h("div", { class: "gs-spacer" }),
        collapsible ? h("button", { type: "button", class: "gs-btn gs-btn--sm gs-btn--ghost", "aria-expanded": String(!isCollapsed), "aria-controls": bodyId,
          onClick: () => { collapsed = !collapsed; render(); } }, icon(isCollapsed ? "chevronDown" : "chevronUp", 14), isCollapsed ? "Tampilkan berkas" : "Ringkas") : null,
        items.length && !follower ? button("Kosongkan", { size: "sm", variant: "ghost", icon: "trash", attrs: { disabled: anyBusy || running }, onClick: actions.resetFiles }) : null),
      h("div", { class: "gs-card-body ib-import-body", id: bodyId, hidden: isCollapsed },
        stepper(items, gate, running, hasResult),
        follower ? h("div", { class: "ib-inline-alert is-info", role: "status" }, icon("info"),
          "Anda sedang mengikuti sesi bersama — data disinkron dari owner, tidak perlu upload ulang. Berhenti mengikuti untuk mengunggah berkas sendiri.") : null,
        h("div", { class: ["gs-dropzone", "ib-dropzone", follower ? "is-disabled" : null], dataset: { drop: "1" },
          onClick: (e) => { if (follower || e.target.closest("label") || e.target === fileInput) return; fileInput.click(); } },
          fileInput,
          h("span", { class: "ib-drop-icon" }, icon("upload", 22)),
          h("div", { class: "gs-dropzone-title" }, "Tarik & lepas berkas Excel di sini, atau ",
            h("label", { for: inputId, class: "ib-linkbtn ib-file-trigger", tabindex: follower ? "-1" : "0", role: "button", "aria-disabled": follower ? "true" : null,
              onKeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && !follower) { e.preventDefault(); fileInput.click(); } } }, "pilih berkas")),
          h("div", { class: "gs-dropzone-hint" }, ".xlsx / .xlsm / .xls — boleh beberapa berkas sekaligus. Berkas diproses di browser Anda; isinya tidak disimpan ke database.")),
        h("div", { class: "ib-slots" }, ["scm", "ior", "nike"].map((k) => slot(k, items, follower || running))),
        extra.length ? h("section", { class: "ib-extra", "aria-label": "Berkas yang perlu tindakan" },
          h("h3", { class: "ib-slot-title" }, "Perlu tindakan"),
          extra.map((it) => fileCard(it, follower || running))) : null,
        h("div", { class: "ib-gate" },
          h("div", { class: ["ib-gate-msg", gate.ok ? (hasWarn ? "is-warning" : "is-ok") : "is-blocked"], id: "ibGateMsg", role: "status" },
            icon(gate.ok ? (hasWarn ? "warning" : "checkCircle") : "info", 16),
            gate.ok ? (hasWarn ? "Siap dijalankan. Baris tidak valid akan ditandai, bukan dianggap nol." : "Semua berkas lolos pemeriksaan struktur dan kolom wajib.")
              : (gate.reason || "Muat berkas SCM dan minimal satu pembanding (IOR atau DRR).")),
          runBtn)));
  }

  // drag & drop (delegasi di root; ditolak saat mengikuti sesi)
  root.addEventListener("dragover", (e) => {
    const dz = e.target.closest && e.target.closest("[data-drop]");
    if (!dz || (store.get().session || {}).role === "FOLLOWER") return;
    e.preventDefault(); dz.classList.add("is-over");
  });
  root.addEventListener("dragleave", (e) => { const dz = e.target.closest && e.target.closest("[data-drop]"); if (dz) dz.classList.remove("is-over"); });
  root.addEventListener("drop", (e) => {
    const dz = e.target.closest && e.target.closest("[data-drop]");
    if (!dz) return;
    e.preventDefault(); dz.classList.remove("is-over");
    if ((store.get().session || {}).role === "FOLLOWER") return;
    actions.addFiles(e.dataTransfer.files);
  });

  store.subscribe(["importItems", "gate", "session", "busy", "result"], render);
  render();
}
