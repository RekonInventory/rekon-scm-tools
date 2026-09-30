// Autentikasi (Supabase Auth, login berbasis nama pengguna) + role dari server.
import { getClient, CONFIG, unwrap } from "./supabase.js";

export function usernameToEmail(u) {
  const clean = String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "");
  return clean + CONFIG.usernameDomain;
}

export function displayNameFromUser(user) {
  if (!user) return "";
  if (user.user_metadata && user.user_metadata.display_name) return String(user.user_metadata.display_name);
  const email = user.email || "";
  const dom = CONFIG.usernameDomain;
  return email.slice(-dom.length) === dom ? email.slice(0, email.length - dom.length) : email;
}

export const AuthRepository = {
  async getSession() {
    const res = await getClient().auth.getSession();
    return (res && res.data && res.data.session) || null;
  },
  onChange(fn) {
    const sub = getClient().auth.onAuthStateChange((evt, session) => fn(evt, session));
    return () => { try { sub.data.subscription.unsubscribe(); } catch (e) { /* sudah dilepas */ } };
  },
  async signIn(username, password) {
    return getClient().auth.signInWithPassword({ email: usernameToEmail(username), password });
  },
  async signOut() {
    return getClient().auth.signOut();
  },
  async changePassword(newPassword) {
    return unwrap(await getClient().auth.updateUser({ password: newPassword }));
  },
  /** Role efektif dari server (tabel app_user_roles). Sebelum migrasi dijalankan -> 'operator'. */
  async myRole() {
    const res = await getClient().rpc("app_my_role");
    if (res.error) return { role: "operator", migrated: false };
    return { role: res.data || "operator", migrated: true };
  }
};
