// LOG TEKNIS (bukan audit). Disimpan di memori (ring buffer) + console, bisa
// disalin user dari menu "Diagnostik" untuk dikirim ke tim IT. Audit bisnis yang
// immutable ada di server (inbound_case_events / inbound_activity_events).
const MAX = 500;
const buffer = [];

function push(level, event, data) {
  const entry = { at: new Date().toISOString(), level, event, data: sanitize(data) };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const fn = level === "error" ? console.error : (level === "warn" ? console.warn : console.info);
  try { fn.call(console, "[inbound]", event, entry.data === undefined ? "" : entry.data); } catch (e) { /* console tidak ada */ }
  return entry;
}

// Jangan pernah mencatat kredensial/token.
function sanitize(data) {
  if (data === undefined || data === null) return data;
  try {
    return JSON.parse(JSON.stringify(data, (k, v) => (/pass|token|secret|authorization|apikey/i.test(k) ? "[disembunyikan]" : v)));
  } catch (e) {
    return String(data);
  }
}

export const log = {
  info: (event, data) => push("info", event, data),
  warn: (event, data) => push("warn", event, data),
  error: (event, data) => push("error", event, data),
  entries: () => buffer.slice(),
  text: () => buffer.map((e) => e.at + " " + e.level.toUpperCase() + " " + e.event + (e.data !== undefined ? " " + JSON.stringify(e.data) : "")).join("\n")
};
