import { useState, useEffect } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BLUE = "#1C2BDE";
const PINK = "#DE1C77";

// ── Supabase client ───────────────────────────────────────────────────
const sb = {
  h: (token) => ({
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : { "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }),
  }),

  async signInWithGoogle() {
    const redirectTo = window.location.origin;
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  },

  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: this.h(token) });
  },

  async getSession() {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const p = new URLSearchParams(hash.slice(1));
      const token = p.get("access_token");
      const refresh = p.get("refresh_token");
      const exp = Date.now() + parseInt(p.get("expires_in") || "3600") * 1000;
      if (token) {
        localStorage.setItem("sb_token", token);
        localStorage.setItem("sb_refresh", refresh || "");
        localStorage.setItem("sb_expires", String(exp));
        window.history.replaceState({}, "", window.location.pathname);
        return token;
      }
    }
    const stored = localStorage.getItem("sb_token");
    const expires = parseInt(localStorage.getItem("sb_expires") || "0");
    if (stored && Date.now() < expires) return stored;
    const refresh = localStorage.getItem("sb_refresh");
    if (refresh) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: this.h(null), body: JSON.stringify({ refresh_token: refresh }),
      });
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem("sb_token", d.access_token);
        localStorage.setItem("sb_refresh", d.refresh_token);
        localStorage.setItem("sb_expires", String(Date.now() + d.expires_in * 1000));
        return d.access_token;
      }
    }
    return null;
  },

  async getUser(token) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: this.h(token) });
    if (!r.ok) return null;
    return r.json();
  },

  clearSession() {
    ["sb_token", "sb_refresh", "sb_expires"].forEach(k => localStorage.removeItem(k));
  },

  async getProfile(token, userId) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=*`, { headers: this.h(token) });
    const d = await r.json();
    return d?.[0] || null;
  },

  async upsertProfile(token, profile) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...this.h(token), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    const d = await r.json();
    return d?.[0] || null;
  },

  async getAllProfiles(token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&order=name.asc`, { headers: this.h(token) });
    return r.json();
  },

  async getPulseEntries(token, weekOf) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/pulse_entries?week_of=eq.${weekOf}&select=*`,
      { headers: this.h(token) }
    );
    return r.json();
  },
};

// ── Helpers ───────────────────────────────────────────────────────────
function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

function formatWeekLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 700 : false);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < 700);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return m;
}

function getInitials(name) {
  return (name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

// ── Design atoms ──────────────────────────────────────────────────────
function CloverMark({ size = 18, color = BLUE }) {
  const r = size * 0.26, o = size * 0.20, c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={c} cy={c-o-r} r={r} fill={color}/>
      <circle cx={c} cy={c+o+r} r={r} fill={color}/>
      <circle cx={c-o-r} cy={c} r={r} fill={color}/>
      <circle cx={c+o+r} cy={c} r={r} fill={color}/>
      <circle cx={c} cy={c} r={size*0.10} fill={color}/>
    </svg>
  );
}

function Spinner({ color = BLUE, size = 20 }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", border: `2px solid ${color}22`, borderTop: `2px solid ${color}`, animation: "spin 0.7s linear infinite" }}/>;
}

function Checkbox({ done, onToggle, onLight = true }) {
  return (
    <div onClick={e => { e.stopPropagation(); onToggle(); }} style={{
      width: 21, height: 21, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
      border: done ? "none" : `1.5px solid ${onLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.35)"}`,
      background: done ? (onLight ? BLUE : "rgba(255,255,255,0.9)") : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.16s",
    }}>
      {done && <svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M1 3.5l2.5 2.5 5.5-5" stroke={onLight ? "#fff" : BLUE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>}
    </div>
  );
}

function ProgressBar({ tasks, light = false }) {
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? (done / tasks.length) * 100 : 0;
  return (
    <div style={{ height: 3, background: light ? "rgba(255,255,255,0.18)" : `${BLUE}18`, borderRadius: 2 }}>
      <div style={{ height: 3, borderRadius: 2, background: light ? "#fff" : BLUE, width: `${pct}%`, transition: "width 0.4s cubic-bezier(.4,0,.2,1)" }}/>
    </div>
  );
}

function TaskList({ tasks, setTasks, onLight = true, readOnly = false }) {
  const toggle = id => {
    if (readOnly) return;
    setTasks(p => p.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };
  return (
    <>
      {tasks.map(t => (
        <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 0", opacity: t.done ? 0.35 : 1, transition: "opacity 0.18s" }}>
          <Checkbox done={t.done} onToggle={() => toggle(t.id)} onLight={onLight}/>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13.5, color: onLight ? "#1C1C1E" : "#fff", lineHeight: 1.45, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
        </div>
      ))}
    </>
  );
}

function LastWeek({ items, onLight = true }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `0.5px solid ${onLight ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.12)"}` }}>
      <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: onLight ? "#AEAEB2" : "rgba(255,255,255,0.38)", display: "flex", alignItems: "center", gap: 4, letterSpacing: "0.09em", textTransform: "uppercase" }}>
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
        Last week · {items.length} done
      </button>
      {open && items.map((t, i) => (
        <div key={i} style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: onLight ? "#AEAEB2" : "rgba(255,255,255,0.4)", padding: "3px 0 3px 14px" }}>✓ {t}</div>
      ))}
    </div>
  );
}

// ── Member card components ────────────────────────────────────────────
function HeroTile({ member, entry, mobile, isCurrentUser }) {
  const tasks = entry?.tasks || [];
  const [localTasks, setLocalTasks] = useState(tasks);
  useEffect(() => setLocalTasks(entry?.tasks || []), [entry]);
  const note = entry?.note || null;
  const completedLast = entry?.completed_last || [];
  const submitted = !!entry;

  return (
    <div style={{ background: BLUE, borderRadius: 22, padding: mobile ? "22px 20px" : "28px 30px", gridColumn: mobile ? "span 1" : "span 2", gridRow: mobile ? "span 1" : "span 2", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: mobile ? 0 : 360 }}>
      <div style={{ position: "absolute", right: -50, top: -50, opacity: 0.06 }}><CloverMark size={mobile ? 180 : 260} color="#fff"/></div>
      {isCurrentUser && <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(255,255,255,0.2)", borderRadius: 20, padding: "2px 9px", fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#fff", letterSpacing: "0.04em" }}>You</div>}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: mobile ? 28 : 38, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1 }}>{member.name?.split(" ")[0]}</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{member.role || member.email}</div>
      </div>
      {!submitted ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>No update yet this week</div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.25)" }}>Voice note to +34 XXX XXX XXX</div>
          </div>
        </div>
      ) : (
        <>
          {note && <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: mobile ? 14 : 15, color: "rgba(255,255,255,0.8)", fontStyle: "italic", lineHeight: 1.5, marginBottom: 18, fontWeight: 300 }}>"{note}"</p>}
          {localTasks.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em", textTransform: "uppercase" }}>This week</span>
                <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.38)", fontWeight: 600 }}>{localTasks.filter(t=>t.done).length}/{localTasks.length}</span>
              </div>
              <ProgressBar tasks={localTasks} light/>
            </div>
          )}
          <div style={{ flex: 1 }}><TaskList tasks={localTasks} setTasks={setLocalTasks} onLight={false}/></div>
          <LastWeek items={completedLast} onLight={false}/>
        </>
      )}
    </div>
  );
}

function StandardTile({ member, entry, mobile, span, isCurrentUser }) {
  const tasks = entry?.tasks || [];
  const [localTasks, setLocalTasks] = useState(tasks);
  useEffect(() => setLocalTasks(entry?.tasks || []), [entry]);
  const note = entry?.note || null;
  const completedLast = entry?.completed_last || [];
  const blockers = entry?.blockers || [];
  const submitted = !!entry;
  const isBlocked = blockers.length > 0;
  const done = localTasks.filter(t=>t.done).length;

  return (
    <div style={{
      background: "#fff", borderRadius: 22,
      padding: mobile ? "20px 18px" : "24px 22px",
      gridColumn: span === "wide" && !mobile ? "span 2" : "span 1",
      gridRow: span === "tall" && !mobile ? "span 2" : "span 1",
      border: isBlocked ? `1.5px solid ${PINK}22` : "0.5px solid rgba(0,0,0,0.09)",
      boxShadow: isBlocked ? `0 0 0 1px ${PINK}12, 0 2px 12px rgba(0,0,0,0.05)` : "0 2px 12px rgba(0,0,0,0.05)",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
    }}>
      {isBlocked && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: PINK }}/>}
      {isCurrentUser && <div style={{ position: "absolute", top: 14, right: 14, background: `${BLUE}12`, borderRadius: 20, padding: "2px 9px", fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: BLUE, letterSpacing: "0.04em" }}>You</div>}

      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: mobile ? 22 : 26, color: submitted ? "#1C1C1E" : "#D1D1D6", letterSpacing: "-0.03em", lineHeight: 1 }}>{member.name?.split(" ")[0]}</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#8E8E93", marginTop: 3, marginBottom: 14 }}>{member.role || member.email}</div>

      {!submitted ? (
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          <div style={{ background: "rgba(0,0,0,0.04)", borderRadius: 10, padding: "8px 11px", fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#AEAEB2", lineHeight: 1.4, width: "100%" }}>
            No update yet — voice note to <span style={{ color: BLUE, fontWeight: 500 }}>+34 XXX XXX XXX</span>
          </div>
        </div>
      ) : (
        <>
          <ProgressBar tasks={localTasks}/>
          {note && <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "#6C6C70", fontStyle: "italic", lineHeight: 1.55, margin: "12px 0" }}>"{note}"</p>}

          {isBlocked && blockers.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: `${PINK}07`, borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: PINK, lineHeight: 1.45 }}>
              <span style={{ flexShrink: 0 }}>⚠</span><span>{b}</span>
            </div>
          ))}

          {localTasks.length > 0 && (
            <>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6, marginTop: 4 }}>
                This week · {done}/{localTasks.length}
              </div>
              <div style={{ flex: 1 }}><TaskList tasks={localTasks} setTasks={setLocalTasks}/></div>
            </>
          )}
          <LastWeek items={completedLast}/>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, accent, sub }) {
  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: "16px 18px", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 30, color: accent || "#1C1C1E", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function WaTile({ whatsappNumber }) {
  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: "16px 18px", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.119.554 4.107 1.523 5.83L.057 23.885a.5.5 0 00.611.611l6.055-1.466A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.372l-.36-.213-3.733.904.919-3.658-.234-.376A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
      </div>
      <div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 13, color: "#1C1C1E" }}>Voice note your update</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#8E8E93", marginTop: 3 }}>
          {whatsappNumber ? <span style={{ color: BLUE, fontWeight: 500 }}>{whatsappNumber}</span> : "Mon · 10 AM"} · AI does the rest
        </div>
      </div>
    </div>
  );
}

function ProfileMenu({ user, profile, onSignOut }) {
  const [open, setOpen] = useState(false);
  const initials = getInitials(profile?.name || user?.email || "");
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{ width: 32, height: 32, borderRadius: "50%", cursor: "pointer", background: `${BLUE}18`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: `1.5px solid ${BLUE}30` }}>
        {user?.user_metadata?.avatar_url
          ? <img src={user.user_metadata.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt=""/>
          : <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 700, color: BLUE }}>{initials}</span>
        }
      </div>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 40, background: "#fff", borderRadius: 14, border: "0.5px solid rgba(0,0,0,0.10)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", padding: "8px 0", minWidth: 220, zIndex: 200 }}>
          <div style={{ padding: "10px 16px 8px", borderBottom: "0.5px solid rgba(0,0,0,0.07)" }}>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{profile?.name || user?.email}</div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#8E8E93", marginTop: 1 }}>{user?.email}</div>
            {profile?.whatsapp && <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#25D366", marginTop: 2 }}>WhatsApp: {profile.whatsapp}</div>}
          </div>
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontSize: 13, color: PINK, textAlign: "left" }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── Login screen ──────────────────────────────────────────────────────
function LoginScreen() {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 28, padding: "48px 44px", maxWidth: 380, width: "100%", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 8px 40px rgba(0,0,0,0.08)", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 36 }}>
          <CloverMark size={28} color={BLUE}/>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 300, fontSize: 22, color: "#C7C7CC" }}>pulse</span>
        </div>
        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.02em", marginBottom: 8 }}>Good morning.</h1>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#8E8E93", marginBottom: 36, lineHeight: 1.5 }}>
          Sign in with your <strong style={{ color: "#3C3C43" }}>@rideclover.com</strong> Google account to see your team's week.
        </p>
        <button onClick={() => { setLoading(true); sb.signInWithGoogle(); }} disabled={loading} style={{ width: "100%", padding: "13px 20px", background: "#fff", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 12, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 600, color: "#3C3C43", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          {loading ? <Spinner color="#4285F4" size={18}/> : (
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
          )}
          Continue with Google
        </button>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC", marginTop: 24, lineHeight: 1.5 }}>Only @rideclover.com accounts can sign in.</p>
      </div>
    </div>
  );
}

// ── Onboarding screen ─────────────────────────────────────────────────
function OnboardingScreen({ user, token, onComplete }) {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "there";

  const handleSave = async () => {
    if (!phone.match(/^\+?[\d\s\-]{7,15}$/)) { setError("Enter a valid WhatsApp number including country code, e.g. +34 600 000 000"); return; }
    setSaving(true);
    try {
      await sb.upsertProfile(token, {
        user_id: user.id, email: user.email,
        name: user.user_metadata?.full_name || user.email,
        avatar_url: user.user_metadata?.avatar_url || null,
        whatsapp: phone.replace(/\s/g, ""), role,
        created_at: new Date().toISOString(),
      });
      onComplete();
    } catch { setError("Something went wrong. Try again."); setSaving(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 28, padding: "44px 40px", maxWidth: 420, width: "100%", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 8px 40px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 36 }}>
          <CloverMark size={20} color={BLUE}/>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 16, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover pulse</span>
        </div>
        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.02em", marginBottom: 8 }}>Hey {firstName} 👋</h1>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#8E8E93", lineHeight: 1.6, marginBottom: 32 }}>One quick step. Add your WhatsApp number so we know it's you when your voice note comes in on Monday morning.</p>

        <div style={{ marginBottom: 18 }}>
          <label style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>WhatsApp number</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#F2F2F7", borderRadius: 12, padding: "12px 16px", border: error ? `1.5px solid ${PINK}` : "1.5px solid transparent" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.119.554 4.107 1.523 5.83L.057 23.885a.5.5 0 00.611.611l6.055-1.466A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.372l-.36-.213-3.733.904.919-3.658-.234-.376A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
            </div>
            <input type="tel" value={phone} onChange={e => { setPhone(e.target.value.replace(/[^\d+\s\-]/g, "")); setError(""); }} placeholder="+34 600 000 000" style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "'Poppins', sans-serif", fontSize: 15, color: "#1C1C1E", fontWeight: 500 }}/>
          </div>
          {error && <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: PINK, marginTop: 6 }}>{error}</p>}
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>Your role (optional)</label>
          <input type="text" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Co-founder · Ops" style={{ width: "100%", background: "#F2F2F7", border: "1.5px solid transparent", borderRadius: 12, padding: "12px 16px", outline: "none", fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#1C1C1E" }}/>
        </div>

        <button onClick={handleSave} disabled={!phone || saving} style={{ width: "100%", padding: "13px 22px", background: !phone ? "#F2F2F7" : BLUE, color: !phone ? "#AEAEB2" : "#fff", border: "none", borderRadius: 12, cursor: !phone ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {saving ? <Spinner color="#fff" size={16}/> : "Let's go →"}
        </button>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC", marginTop: 20, textAlign: "center", lineHeight: 1.5 }}>Your number is only used to match your Monday voice notes to your account.</p>
      </div>
    </div>
  );
}

// ── Dashboard screen ──────────────────────────────────────────────────
function DashboardScreen({ user, profile, token, onSignOut }) {
  const mobile = useIsMobile();
  const [profiles, setProfiles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const weekOf = currentWeekOf();

  useEffect(() => {
    (async () => {
      try {
        const [profs, ents] = await Promise.all([
          sb.getAllProfiles(token),
          sb.getPulseEntries(token, weekOf),
        ]);
        setProfiles(Array.isArray(profs) ? profs : []);
        setEntries(Array.isArray(ents) ? ents : []);
      } finally {
        setLoading(false);
      }
    })();
  }, [token, weekOf]);

  // Refresh every 60 seconds so updates from voice notes appear automatically
  useEffect(() => {
    const interval = setInterval(async () => {
      const ents = await sb.getPulseEntries(token, weekOf);
      if (Array.isArray(ents)) setEntries(ents);
    }, 60000);
    return () => clearInterval(interval);
  }, [token, weekOf]);

  const getEntry = (userId) => entries.find(e => e.user_id === userId) || null;
  const submitted = profiles.filter(p => getEntry(p.user_id)).length;
  const blocked = profiles.filter(p => (getEntry(p.user_id)?.blockers || []).length > 0).length;
  const allTasks = entries.flatMap(e => e.tasks || []);
  const doneTasks = allTasks.filter(t => t.done).length;

  // Assign display spans based on task count / blocker status
  const getSpan = (p, index) => {
    const entry = getEntry(p.user_id);
    if (index === 0) return "hero";
    if (entry?.blockers?.length > 0) return "wide";
    if ((entry?.tasks || []).length >= 4) return "tall";
    return "small";
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <CloverMark size={28} color={BLUE}/>
          <Spinner color={BLUE} size={22}/>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(242,242,247,0.88)", backdropFilter: "saturate(180%) blur(24px)", WebkitBackdropFilter: "saturate(180%) blur(24px)", borderBottom: "0.5px solid rgba(0,0,0,0.10)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: mobile ? "0 16px" : "0 28px", height: mobile ? 48 : 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <CloverMark size={17} color={BLUE}/>
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover</span>
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 300, fontSize: 14, color: "#C7C7CC" }}>pulse</span>
          </div>
          {!mobile && <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "#8E8E93" }}>{formatWeekLabel(weekOf)}</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: submitted === profiles.length && profiles.length > 0 ? `${BLUE}12` : `${PINK}12`, borderRadius: 20, padding: "4px 10px" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: submitted === profiles.length && profiles.length > 0 ? BLUE : PINK }}/>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 500, color: submitted === profiles.length && profiles.length > 0 ? BLUE : PINK }}>{submitted}/{profiles.length}</span>
            </div>
            <ProfileMenu user={user} profile={profile} onSignOut={onSignOut}/>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: mobile ? "16px 14px 60px" : "24px 28px 80px" }}>
        {profiles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <CloverMark size={40} color="#D1D1D6"/>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 16, color: "#8E8E93", marginTop: 16 }}>No team members yet.</div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "#C7C7CC", marginTop: 8 }}>Share the link with your team so they can sign in and set up their profiles.</div>
          </div>
        ) : mobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={BLUE}/>
              <StatTile label="Blockers" value={blocked} accent={blocked > 0 ? PINK : "#1C1C1E"} sub={blocked > 0 ? "Needs attention" : "All clear"}/>
            </div>
            {profiles.map((p, i) => {
              const span = getSpan(p, i);
              const isCurrentUser = p.user_id === user?.id;
              const entry = getEntry(p.user_id);
              return span === "hero"
                ? <HeroTile key={p.user_id} member={p} entry={entry} mobile isCurrentUser={isCurrentUser}/>
                : <StandardTile key={p.user_id} member={p} entry={entry} mobile span={span} isCurrentUser={isCurrentUser}/>;
            })}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <WaTile whatsappNumber={profile?.whatsapp}/>
              <StatTile label="Done" value={`${doneTasks}/${allTasks.length}`} accent={BLUE}/>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridAutoRows: "minmax(170px,auto)", gap: 14 }}>
            {profiles.map((p, i) => {
              const span = getSpan(p, i);
              const isCurrentUser = p.user_id === user?.id;
              const entry = getEntry(p.user_id);
              return span === "hero"
                ? <HeroTile key={p.user_id} member={p} entry={entry} mobile={false} isCurrentUser={isCurrentUser}/>
                : <StandardTile key={p.user_id} member={p} entry={entry} mobile={false} span={span} isCurrentUser={isCurrentUser}/>;
            })}
            <StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={BLUE} sub={submitted < profiles.length ? `${profiles.length - submitted} missing` : "All in"}/>
            <StatTile label="Blockers" value={blocked} accent={blocked > 0 ? PINK : "#1C1C1E"} sub={blocked > 0 ? "Needs attention" : "All clear"}/>
            <StatTile label="Tasks" value={allTasks.length} sub={`${doneTasks} done so far`} accent={BLUE}/>
            <WaTile whatsappNumber={profile?.whatsapp}/>
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: 44, fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#D1D1D6" }}>Clover Pulse · Internal · rideclover.com</div>
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("loading");
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const t = await sb.getSession();
        if (!t) { setScreen("login"); return; }
        const u = await sb.getUser(t);
        if (!u || !u.email?.endsWith("@rideclover.com")) { sb.clearSession(); setScreen("login"); return; }
        const p = await sb.getProfile(t, u.id);
        setToken(t); setUser(u); setProfile(p);
        setScreen(p?.whatsapp ? "dashboard" : "onboarding");
      } catch { setScreen("login"); }
    })();
  }, []);

  const handleSignOut = async () => {
    if (token) await sb.signOut(token);
    sb.clearSession();
    setToken(null); setUser(null); setProfile(null);
    setScreen("login");
  };

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {screen === "loading" && (
        <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <CloverMark size={32} color={BLUE}/>
            <Spinner color={BLUE} size={24}/>
          </div>
        </div>
      )}
      {screen === "login" && <LoginScreen/>}
      {screen === "onboarding" && user && <OnboardingScreen user={user} token={token} onComplete={async () => { const p = await sb.getProfile(token, user.id); setProfile(p); setScreen("dashboard"); }}/>}
      {screen === "dashboard" && user && <DashboardScreen user={user} profile={profile} token={token} onSignOut={handleSignOut}/>}
    </>
  );
}
