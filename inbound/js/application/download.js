// Unduhan berkas dari browser (satu tempat).
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function downloadText(text, filename, mime) {
  downloadBlob(new Blob(["﻿" + text], { type: mime || "text/plain" }), filename);
}
