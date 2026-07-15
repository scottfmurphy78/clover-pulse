const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Supabase DB helper (auth-free — uses token from supabase session) ──
const sb = {
  h: (token) => ({
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
  }),
  async getProfile(token, userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=*`, { headers: this.h(token) });
    const d = await r.json(); return d?.[0] || null;
  },
  async upsertProfile(token, profile) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...this.h(token), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    const d = await r.json(); return d?.[0] || null;
  },
  async getAllProfiles(token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&order=name.asc`, { headers: this.h(token) });
    return r.json();
  },
  async deleteProfile(token, userId) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, { method: "DELETE", headers: this.h(token) });
  },
  async getPulseEntries(token, weekOf) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pulse_entries?week_of=eq.${weekOf}&select=*`, { headers: this.h(token) });
    return r.json();
  },
  async getAllWeeks(token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pulse_entries?select=week_of&order=week_of.desc`, { headers: this.h(token) });
    const data = await r.json();
    if (!Array.isArray(data)) return [];
    const unique = [...new Set(data.map(e => e.week_of))];
    return unique;
  },
  async upsertPulseEntry(token, entry) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/pulse_entries?user_id=eq.${entry.user_id}&week_of=eq.${entry.week_of}`,
      {
        method: "PATCH",
        headers: { ...this.h(token), "Prefer": "return=representation" },
        body: JSON.stringify(entry),
      }
    );
    return r.json();
  },
};

export { sb };
