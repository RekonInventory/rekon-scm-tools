// Transport realtime untuk 1 sesi: presence + broadcast + perubahan baris sesi.
// Menjamin: maksimal SATU channel aktif (tidak ada subscription ganda), channel
// lama selalu dilepas, dan koneksi yang putus disambung ulang dengan backoff.
// Nama channel/event/payload SAMA dengan versi lama supaya klien lama & baru
// tetap bisa saling mendengar selama masa transisi.
import { getClient } from "./supabase.js";
import { log } from "../core/logger.js";

export function createRealtimeTransport(handlers) {
  let channel = null;
  let generation = 0;
  let target = null;          // {sessionId, identity:{user_id,name}, role}
  let retryTimer = null, retryCount = 0;
  let status = "idle";

  function setStatus(s) {
    if (status === s) return;
    status = s;
    handlers.onStatus && handlers.onStatus(s);
  }

  function teardown() {
    clearTimeout(retryTimer);
    retryTimer = null;
    if (channel) {
      const c = channel;
      channel = null;
      try { getClient().removeChannel(c); } catch (e) { /* sudah ditutup */ }
    }
  }

  function scheduleRetry(gen) {
    if (!target || gen !== generation) return;
    const wait = Math.min(30000, [2000, 5000, 10000, 20000][retryCount] || 30000);
    retryCount++;
    setStatus("reconnecting");
    log.warn("realtime:retry", { inMs: wait, attempt: retryCount });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (gen === generation) open(); }, wait);
  }

  function open() {
    // naikkan generasi SEBELUM melepas channel lama: callback "CLOSED" dari channel
    // lama lalu diabaikan dan tidak memicu reconnect palsu.
    const gen = ++generation;
    teardown();
    if (!target) return;
    const client = getClient();
    const ch = client.channel("inbound-session-" + target.sessionId, { config: { presence: { key: target.identity.user_id } } });
    channel = ch;
    ch.on("presence", { event: "sync" }, () => { if (gen === generation) handlers.onPresence && handlers.onPresence(ch.presenceState()); });
    ch.on("broadcast", { event: "session" }, (msg) => { if (gen === generation) handlers.onBroadcast && handlers.onBroadcast(msg.payload || {}); });
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "inbound_sessions", filter: "id=eq." + target.sessionId },
      (payload) => { if (gen === generation) handlers.onRow && handlers.onRow(payload.new); });
    setStatus("connecting");
    ch.subscribe(async (s) => {
      if (gen !== generation) return;
      if (s === "SUBSCRIBED") {
        retryCount = 0;
        setStatus("connected");
        try {
          await ch.track({ user_id: target.identity.user_id, name: target.identity.name, role: target.role || "FOLLOWER", at: new Date().toISOString() });
        } catch (e) { log.warn("realtime:track-failed", { message: e && e.message }); }
        handlers.onReconnected && handlers.onReconnected();
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        if (target) scheduleRetry(gen);
      }
    });
  }

  return {
    connect(sessionId, identity, role) {
      target = { sessionId, identity, role };
      retryCount = 0;
      open();
    },
    /** Perbarui role di presence tanpa membuat channel baru. */
    async retrack(role) {
      if (!target) return;
      target.role = role;
      if (channel && status === "connected") {
        try { await channel.track({ user_id: target.identity.user_id, name: target.identity.name, role, at: new Date().toISOString() }); } catch (e) { /* abaikan */ }
      }
    },
    disconnect() {
      target = null;
      generation++;
      teardown();
      setStatus("idle");
    },
    send(type, data, from) {
      if (!channel || status !== "connected") return false;
      channel.send({ type: "broadcast", event: "session", payload: Object.assign({ type, from: from || "" }, data || {}) });
      return true;
    },
    status: () => status
  };
}
