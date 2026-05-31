import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────
// SUPABASE CONFIG — swap these after creating your project at supabase.com
// Auth → Providers → Google → enable, add your rideclover.com OAuth client
// SQL: run the schema at the bottom of this file in the Supabase SQL editor
// ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─────────────────────────────────────────────────────────────────────
// Minimal Supabase client (no npm needed — runs in-browser via fetch)
// ─────────────────────────────────────────────────────────────────────
const sb = {
  headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  authHeaders(token) {
    return { ...this.headers, "Authorization": `Bearer ${token}` };
  },

  // ── Auth ──────────────────────────────────────────────────────────
  async signInWithGoogle() {
    const redirectTo = window.location.href;
    const url = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}&hd=rideclover.com`;
    window.location.href = url;
  },

  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST", headers: this.authHeaders(token),
    });
  },

  async getSession() {
    // Check URL hash for token (OAuth redirect) then localStorage
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("access_token");
      const refresh = params.get("refresh_token");
      const expiresAt = Date.now() + parseInt(params.get("expires_in") || "3600") * 1000;
      if (token) {
        localStorage.setItem("sb_token", token);
        localStorage.setItem("sb_refresh", refresh || "");
        localStorage.setItem("sb_expires", String(expiresAt));
        window.history.replaceState({}, "", window.location.pathname);
        return token;
      }
    }
    const stored = localStorage.getItem("sb_token");
    const expires = parseInt(localStorage.getItem("sb_expires") || "0");
    if (stored && Date.now() < expires) return stored;
    // Try refresh
    const refresh = localStorage.getItem("sb_refresh");
    if (refresh) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: this.headers,
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (r.ok) {
        const data = await r.json();
        localStorage.setItem("sb_token", data.access_token);
        localStorage.setItem("sb_refresh", data.refresh_token);
        localStorage.setItem("sb_expires", String(Date.now() + data.expires_in * 1000));
        return data.access_token;
      }
    }
    return null;
  },

  async getUser(token) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: this.authHeaders(token),
    });
    if (!r.ok) return null;
    return r.json();
  },

  clearSession() {
    localStorage.removeItem("sb_token");
    localStorage.removeItem("sb_refresh");
    localStorage.removeItem("sb_expires");
  },

  // ── Database ──────────────────────────────────────────────────────
  async getProfile(token, userId) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}&select=*`,
      { headers: this.authHeaders(token) }
    );
    const data = await r.json();
    return data?.[0] || null;
  },

  async upsertProfile(token, profile) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { ...this.authHeaders(token), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(profile),
    });
    const data = await r.json();
    return data?.[0] || null;
  },

  async getPulseEntries(token, weekOf) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/pulse_entries?week_of=eq.${weekOf}&select=*,profiles(*)`,
      { headers: this.authHeaders(token) }
    );
    return r.json();
  },

  async upsertPulseEntry(token, entry) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/pulse_entries`, {
      method: "POST",
      headers: { ...this.authHeaders(token), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(entry),
    });
    const data = await r.json();
    return data?.[0] || null;
  },
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const BLUE = "#1C2BDE";
const PINK = "#DE1C77";

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().split("T")[0]; // "2026-05-26"
}

function formatWeek(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function useIsMobile() {
  const [mobile, setMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 700 : false
  );
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth < 700);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ─────────────────────────────────────────────────────────────────────
// Design atoms
// ─────────────────────────────────────────────────────────────────────
function CloverMark({ size = 18, color = BLUE }) {
  const r = size * 0.26, o = size * 0.20, c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      <circle cx={c} cy={c-o-r} r={r} fill={color}/>
      <circle cx={c} cy={c+o+r} r={r} fill={color}/>
      <circle cx={c-o-r} cy={c} r={r} fill={color}/>
      <circle cx={c+o+r} cy={c} r={r} fill={color}/>
      <circle cx={c} cy={c} r={size*0.10} fill={color}/>
    </svg>
  );
}

function Spinner({ color = BLUE, size = 20 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      border: `2px solid ${color}22`,
      borderTop: `2px solid ${color}`,
      animation: "spin 0.7s linear infinite",
    }}/>
  );
}

function Btn({ children, onClick, variant = "primary", disabled = false, loading = false, style = {} }) {
  const base = {
    fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 14,
    borderRadius: 12, padding: "11px 22px", cursor: disabled ? "not-allowed" : "pointer",
    border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: 8, transition: "opacity 0.15s, transform 0.1s",
    opacity: disabled ? 0.5 : 1,
    ...style,
  };
  const variants = {
    primary: { background: BLUE, color: "#fff" },
    secondary: { background: "rgba(0,0,0,0.05)", color: "#1C1C1E" },
    danger: { background: `${PINK}12`, color: PINK },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>
      {loading ? <Spinner color={variant === "primary" ? "#fff" : BLUE} size={16}/> : children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 1 — Login
// ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    await sb.signInWithGoogle();
  };

  // Demo login — remove in production
  const handleDemo = () => {
    onLogin({
      id: "demo-user-1",
      email: "scott@rideclover.com",
      user_metadata: { full_name: "Scott Murphy", avatar_url: null },
    }, { whatsapp: "+34600000000", name: "Scott Murphy", role: "Co-founder · Growth" });
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F2F2F7",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 28,
        padding: "48px 44px", maxWidth: 380, width: "100%",
        border: "0.5px solid rgba(0,0,0,0.09)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
        textAlign: "center",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 36 }}>
          <CloverMark size={28} color={BLUE}/>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 300, fontSize: 22, color: "#C7C7CC" }}>pulse</span>
        </div>

        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.02em", marginBottom: 8 }}>
          Good morning.
        </h1>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#8E8E93", marginBottom: 36, lineHeight: 1.5, fontWeight: 400 }}>
          Sign in with your <strong style={{ color: "#3C3C43", fontWeight: 600 }}>@rideclover.com</strong> Google account to see your team's week.
        </p>

        {/* Google button */}
        <button onClick={handleGoogle} disabled={loading} style={{
          width: "100%", padding: "13px 20px",
          background: "#fff", border: "1px solid rgba(0,0,0,0.14)",
          borderRadius: 12, cursor: loading ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 600, color: "#3C3C43",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          transition: "box-shadow 0.15s",
          marginBottom: 12,
        }}>
          {loading ? <Spinner color="#4285F4" size={18}/> : (
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
            </svg>
          )}
          Continue with Google
        </button>

        {/* Demo bypass — remove in production */}
        <button onClick={handleDemo} style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC",
          textDecoration: "underline", marginTop: 8,
        }}>
          Demo mode (no Supabase needed)
        </button>

        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC", marginTop: 24, lineHeight: 1.5 }}>
          Only @rideclover.com accounts can sign in.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 2 — WhatsApp onboarding (first-time users)
// ─────────────────────────────────────────────────────────────────────
function OnboardingScreen({ user, token, onComplete }) {
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const firstName = user.user_metadata?.full_name?.split(" ")[0] || "there";

  const formatPhone = (val) => {
    // Keep + and digits only
    return val.replace(/[^\d+]/g, "");
  };

  const handleSave = async () => {
    if (!phone.match(/^\+?[\d\s\-]{7,15}$/)) {
      setError("Enter a valid WhatsApp number including country code, e.g. +34 600 000 000");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await sb.upsertProfile(token, {
        user_id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        avatar_url: user.user_metadata?.avatar_url || null,
        whatsapp: phone.replace(/\s/g, ""),
        role: role,
        created_at: new Date().toISOString(),
      });
      onComplete({ whatsapp: phone, role });
    } catch (e) {
      setError("Something went wrong. Try again.");
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F2F2F7",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 28, padding: "44px 40px",
        maxWidth: 420, width: "100%",
        border: "0.5px solid rgba(0,0,0,0.09)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 36 }}>
          <CloverMark size={20} color={BLUE}/>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 16, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover pulse</span>
        </div>

        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#1C1C1E", letterSpacing: "-0.02em", marginBottom: 8 }}>
          Hey {firstName} 👋
        </h1>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#8E8E93", lineHeight: 1.6, marginBottom: 32, fontWeight: 400 }}>
          One quick setup step. Add your WhatsApp number so we know it's you when your voice note comes in on Monday morning.
        </p>

        {/* WhatsApp field */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>
            WhatsApp number
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#F2F2F7", borderRadius: 12, padding: "12px 16px", border: error ? `1.5px solid ${PINK}` : "1.5px solid transparent" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.119.554 4.107 1.523 5.83L.057 23.885a.5.5 0 00.611.611l6.055-1.466A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.372l-.36-.213-3.733.904.919-3.658-.234-.376A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
              </svg>
            </div>
            <input
              type="tel"
              value={phone}
              onChange={e => { setPhone(formatPhone(e.target.value)); setError(""); }}
              placeholder="+34 600 000 000"
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                fontFamily: "'Poppins', sans-serif", fontSize: 15, color: "#1C1C1E",
                fontWeight: 500,
              }}
            />
          </div>
          {error && <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: PINK, marginTop: 6 }}>{error}</p>}
        </div>

        {/* Role field */}
        <div style={{ marginBottom: 32 }}>
          <label style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 7 }}>
            Your role (optional)
          </label>
          <input
            type="text"
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="e.g. Co-founder · Ops"
            style={{
              width: "100%", background: "#F2F2F7", border: "1.5px solid transparent",
              borderRadius: 12, padding: "12px 16px", outline: "none",
              fontFamily: "'Poppins', sans-serif", fontSize: 14, color: "#1C1C1E",
            }}
          />
        </div>

        <Btn onClick={handleSave} loading={saving} disabled={!phone} style={{ width: "100%" }}>
          Let's go →
        </Btn>

        <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#C7C7CC", marginTop: 20, textAlign: "center", lineHeight: 1.5 }}>
          Your number is only used to match your Monday voice notes to your account. It's never shared.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SCREEN 3 — Dashboard (the full bento layout from v5)
// ─────────────────────────────────────────────────────────────────────

// Reused atoms
function Checkbox({ done, onToggle, onLight = true }) {
  return (
    <div onClick={e => { e.stopPropagation(); onToggle(); }} style={{
      width: 21, height: 21, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
      border: done ? "none" : `1.5px solid ${onLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.35)"}`,
      background: done ? (onLight ? BLUE : "rgba(255,255,255,0.9)") : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.16s",
    }}>
      {done && (
        <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
          <path d="M1 3.5l2.5 2.5 5.5-5" stroke={onLight ? "#fff" : BLUE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
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

function TaskList({ tasks, setTasks, onLight = true }) {
  const toggle = id => setTasks(p => p.map(t => t.id === id ? {...t, done: !t.done} : t));
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

// Demo team data
const DEMO_TEAM = [
  { id: 1, name: "Scott", role: "Growth", initials: "SM", submitted: true, submittedAt: "9:14", status: "on-track", span: "hero", note: "Five subscribers. That's the week.", tasks: [{id:"s1",text:"Get 5 new bikes subscribed",done:false},{id:"s2",text:"Confirm Ayuntamiento meeting for June",done:false},{id:"s3",text:"Close loop with Lanzadera on PR",done:true},{id:"s4",text:"Record 60-second explainer video",done:false},{id:"s5",text:"Follow up with Paola re: seed round",done:false}], completedLast: ["Closed Techstars Weekend sponsorship","Sent seed round follow-ups to three investors","Signed WeWork Valencia member benefit partnership"], blockers: [] },
  { id: 2, name: "Antonio", role: "Ops", initials: "AB", submitted: true, submittedAt: "8:47", status: "blocked", span: "wide", note: "Need supplier confirmation before the June plan locks in.", tasks: [{id:"a1",text:"Coordinate 100-bike June delivery",done:false},{id:"a2",text:"Finalise Q2 financial summary",done:false},{id:"a3",text:"Set up onboarding flow in Odoo",done:false},{id:"a4",text:"Sort battery swap station in Ayora",done:true}], completedLast: ["Deployed 70 bikes to Ruzafa and Benimaclet","Resolved insurance claim for Subscriber #14"], blockers: ["Supplier delayed June shipment confirmation"] },
  { id: 3, name: "María", role: "Social", initials: "MG", submitted: true, submittedAt: "10:02", status: "on-track", span: "tall", note: "Neighbourhood-specific content is working. Leaning in.", tasks: [{id:"m1",text:"Publish Techstars Weekend hype content",done:false},{id:"m2",text:"Film bike-in-the-wild at Turia park",done:false},{id:"m3",text:"Draft June subscriber newsletter",done:false},{id:"m4",text:"Clear 14 Instagram DMs",done:false}], completedLast: ["Published 4 posts including the Ruzafa reel","Drafted subscriber welcome email series"], blockers: [] },
  { id: 4, name: "Javi", role: "Fleet", initials: "JR", submitted: false, submittedAt: null, status: "missing", span: "small", note: null, tasks: [], completedLast: [], blockers: [] },
];

function HeroTile({ member, mobile }) {
  const [tasks, setTasks] = useState(member.tasks);
  return (
    <div style={{ background: BLUE, borderRadius: 22, padding: mobile ? "22px 20px" : "28px 30px", gridColumn: mobile ? "span 1" : "span 2", gridRow: mobile ? "span 1" : "span 2", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: mobile ? 0 : 380 }}>
      <div style={{ position: "absolute", right: -50, top: -50, opacity: 0.06 }}><CloverMark size={mobile ? 180 : 260} color="#fff"/></div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: mobile ? 28 : 38, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1 }}>{member.name}</div>
          <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{member.role} · {member.submittedAt} AM</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 20, padding: "3px 10px", fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#fff", letterSpacing: "0.04em" }}>On track</div>
      </div>
      <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: mobile ? 14 : 16, color: "rgba(255,255,255,0.8)", fontStyle: "italic", lineHeight: 1.5, marginBottom: 18, fontWeight: 300 }}>"{member.note}"</p>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em", textTransform: "uppercase" }}>This week</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, color: "rgba(255,255,255,0.38)", fontWeight: 600 }}>{tasks.filter(t=>t.done).length}/{tasks.length}</span>
        </div>
        <ProgressBar tasks={tasks} light/>
      </div>
      <div style={{ flex: 1 }}><TaskList tasks={tasks} setTasks={setTasks} onLight={false}/></div>
      <LastWeek items={member.completedLast} onLight={false}/>
    </div>
  );
}

function WideTile({ member, mobile }) {
  const [tasks, setTasks] = useState(member.tasks);
  const done = tasks.filter(t=>t.done).length;
  return (
    <div style={{ background: "#fff", borderRadius: 22, gridColumn: mobile ? "span 1" : "span 2", border: `1.5px solid ${PINK}22`, boxShadow: `0 0 0 1px ${PINK}12, 0 2px 12px rgba(0,0,0,0.05)`, overflow: "hidden", position: "relative" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: PINK }}/>
      <div style={{ padding: mobile ? "20px 18px" : "24px 26px" }}>
        {mobile ? (
          <div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 26, color: "#1C1C1E", letterSpacing: "-0.03em", lineHeight: 1 }}>{member.name}</div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#8E8E93", marginTop: 3 }}>{member.role} · {member.submittedAt} AM</div>
            <div style={{ marginTop: 12, background: `${PINK}0D`, borderRadius: 10, padding: "9px 12px", borderLeft: `3px solid ${PINK}` }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 700, color: PINK, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 3 }}>Blocked</div>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: "#3C3C43", lineHeight: 1.45 }}>{member.blockers[0]}</div>
            </div>
            <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: "#8E8E93", fontStyle: "italic", lineHeight: 1.5, marginTop: 10 }}>"{member.note}"</p>
            <div style={{ height: 1, background: "rgba(0,0,0,0.06)", margin: "14px 0" }}/>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.09em", textTransform: "uppercase" }}>This week</span>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#AEAEB2" }}>{done}/{tasks.length}</span>
            </div>
            <TaskList tasks={tasks} setTasks={setTasks}/>
            <LastWeek items={member.completedLast}/>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24 }}>
            <div style={{ flex: "0 0 220px" }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 28, color: "#1C1C1E", letterSpacing: "-0.03em", lineHeight: 1, marginTop: 4 }}>{member.name}</div>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#8E8E93", marginTop: 3 }}>{member.role} · {member.submittedAt} AM</div>
              <div style={{ marginTop: 14, background: `${PINK}0D`, borderRadius: 12, padding: "10px 13px", borderLeft: `3px solid ${PINK}` }}>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 700, color: PINK, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 4 }}>Blocked</div>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: "#3C3C43", lineHeight: 1.45 }}>{member.blockers[0]}</div>
              </div>
              <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: "#8E8E93", fontStyle: "italic", lineHeight: 1.5, marginTop: 12 }}>"{member.note}"</p>
            </div>
            <div style={{ width: 1, background: "rgba(0,0,0,0.06)", flexShrink: 0 }}/>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.09em", textTransform: "uppercase" }}>This week</span>
                <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#AEAEB2" }}>{done}/{tasks.length} done</span>
              </div>
              <TaskList tasks={tasks} setTasks={setTasks}/>
              <LastWeek items={member.completedLast}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TallTile({ member, mobile }) {
  const [tasks, setTasks] = useState(member.tasks);
  return (
    <div style={{ background: "#fff", borderRadius: 22, padding: mobile ? "20px 18px" : "24px 22px", gridRow: mobile ? "span 1" : "span 2", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 2px 12px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column" }}>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: mobile ? 24 : 28, color: "#1C1C1E", letterSpacing: "-0.03em", lineHeight: 1 }}>{member.name}</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#8E8E93", marginTop: 3, marginBottom: 14 }}>{member.role} · {member.submittedAt} AM</div>
      <ProgressBar tasks={tasks}/>
      <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "#6C6C70", fontStyle: "italic", lineHeight: 1.55, margin: "14px 0" }}>"{member.note}"</p>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 10, fontWeight: 600, color: "#AEAEB2", letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6 }}>This week</div>
      <div style={{ flex: 1 }}><TaskList tasks={tasks} setTasks={setTasks}/></div>
      <LastWeek items={member.completedLast}/>
    </div>
  );
}

function SmallTile({ member }) {
  return (
    <div style={{ background: "#FAFAFA", borderRadius: 22, padding: "20px 18px", border: "0.5px solid rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 140 }}>
      <div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 22, color: "#D1D1D6", letterSpacing: "-0.03em" }}>{member.name}</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#E0E0E0", marginTop: 2 }}>{member.role}</div>
      </div>
      <div style={{ background: "rgba(0,0,0,0.04)", borderRadius: 10, padding: "8px 11px", fontFamily: "'Poppins', sans-serif", fontSize: 12, color: "#AEAEB2", lineHeight: 1.4 }}>
        No update yet — voice note to <span style={{ color: BLUE, fontWeight: 500 }}>+34 XXX XXX XXX</span>
      </div>
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

function WaTile() {
  return (
    <div style={{ background: "#fff", borderRadius: 20, padding: "16px 18px", border: "0.5px solid rgba(0,0,0,0.09)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#25D366", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.119.554 4.107 1.523 5.83L.057 23.885a.5.5 0 00.611.611l6.055-1.466A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.372l-.36-.213-3.733.904.919-3.658-.234-.376A9.818 9.818 0 012.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
      </div>
      <div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 13, color: "#1C1C1E" }}>Voice note your update</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#8E8E93", marginTop: 3 }}>Mon · 10 AM · AI does the rest</div>
      </div>
    </div>
  );
}

// Profile dropdown
function ProfileMenu({ user, profile, onSignOut }) {
  const [open, setOpen] = useState(false);
  const initials = (profile?.name || user.email || "?").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{
        width: 32, height: 32, borderRadius: "50%", cursor: "pointer",
        background: user.user_metadata?.avatar_url ? "transparent" : `${BLUE}18`,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
        border: `1.5px solid ${BLUE}30`,
      }}>
        {user.user_metadata?.avatar_url
          ? <img src={user.user_metadata.avatar_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt=""/>
          : <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 700, color: BLUE }}>{initials}</span>
        }
      </div>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: 40, background: "#fff",
          borderRadius: 14, border: "0.5px solid rgba(0,0,0,0.10)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)", padding: "8px 0", minWidth: 220, zIndex: 200,
        }}>
          <div style={{ padding: "10px 16px 8px", borderBottom: "0.5px solid rgba(0,0,0,0.07)" }}>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, fontWeight: 600, color: "#1C1C1E" }}>{profile?.name || user.email}</div>
            <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#8E8E93", marginTop: 1 }}>{user.email}</div>
            {profile?.whatsapp && (
              <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#25D366", marginTop: 2 }}>
                WhatsApp: {profile.whatsapp}
              </div>
            )}
          </div>
          <button onClick={onSignOut} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "10px 16px", background: "none", border: "none", cursor: "pointer",
            fontFamily: "'Poppins', sans-serif", fontSize: 13, color: PINK, textAlign: "left",
          }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function DashboardScreen({ user, profile, token, onSignOut }) {
  const mobile = useIsMobile();
  const TEAM = DEMO_TEAM;
  const submitted = TEAM.filter(m => m.submitted).length;
  const blocked   = TEAM.filter(m => m.status === "blocked").length;
  const allTasks  = TEAM.flatMap(m => m.tasks);
  const done      = allTasks.filter(t => t.done).length;
  const hero = TEAM.find(m=>m.span==="hero");
  const wide = TEAM.find(m=>m.span==="wide");
  const tall = TEAM.find(m=>m.span==="tall");
  const smalls = TEAM.filter(m=>m.span==="small");

  return (
    <div style={{ minHeight: "100vh", background: "#F2F2F7" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(242,242,247,0.88)", backdropFilter: "saturate(180%) blur(24px)", WebkitBackdropFilter: "saturate(180%) blur(24px)", borderBottom: "0.5px solid rgba(0,0,0,0.10)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: mobile ? "0 16px" : "0 28px", height: mobile ? 48 : 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <CloverMark size={17} color={BLUE}/>
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: "#1C1C1E", letterSpacing: "-0.03em" }}>clover</span>
            <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 300, fontSize: 14, color: "#C7C7CC" }}>pulse</span>
          </div>
          {!mobile && <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 13, color: "#8E8E93" }}>Week of 26 May</span>}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: submitted===TEAM.length ? `${BLUE}12` : `${PINK}12`, borderRadius: 20, padding: "4px 10px" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: submitted===TEAM.length ? BLUE : PINK }}/>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 500, color: submitted===TEAM.length ? BLUE : PINK }}>{submitted}/{TEAM.length}</span>
            </div>
            <ProfileMenu user={user} profile={profile} onSignOut={onSignOut}/>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: mobile ? "16px 14px 60px" : "24px 28px 80px" }}>
        {mobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile label="Submitted" value={`${submitted}/${TEAM.length}`} accent={BLUE}/>
              <StatTile label="Blockers" value={blocked} accent={blocked>0?PINK:"#1C1C1E"} sub={blocked>0?"Needs attention":"All clear"}/>
            </div>
            {hero && <HeroTile member={hero} mobile/>}
            {wide && <WideTile member={wide} mobile/>}
            {tall && <TallTile member={tall} mobile/>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {smalls.map(m=><SmallTile key={m.id} member={m}/>)}
              <WaTile/>
              <StatTile label="Done" value={`${done}/${allTasks.length}`} accent={BLUE}/>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridAutoRows: "minmax(170px,auto)", gap: 14 }}>
            {hero && <HeroTile member={hero} mobile={false}/>}
            {tall && <TallTile member={tall} mobile={false}/>}
            <StatTile label="Submitted" value={`${submitted}/${TEAM.length}`} accent={BLUE} sub={submitted<TEAM.length?`${TEAM.length-submitted} missing`:"All in"}/>
            <StatTile label="Blockers" value={blocked} accent={blocked>0?PINK:"#1C1C1E"} sub={blocked>0?"Needs attention":"All clear"}/>
            {wide && <WideTile member={wide} mobile={false}/>}
            <StatTile label="Tasks" value={allTasks.length} sub={`${done} done so far`} accent={BLUE}/>
            <WaTile/>
            {smalls.map(m=><SmallTile key={m.id} member={m}/>)}
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: 44, fontFamily: "'Poppins', sans-serif", fontSize: 11, color: "#D1D1D6" }}>
          Clover Pulse · Internal · rideclover.com
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROOT — auth state machine
// ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("loading"); // loading | login | onboarding | dashboard
  const [authToken, setAuthToken] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await sb.getSession();
        if (!token) { setScreen("login"); return; }
        const u = await sb.getUser(token);
        if (!u) { sb.clearSession(); setScreen("login"); return; }
        // Domain guard
        if (!u.email?.endsWith("@rideclover.com")) {
          sb.clearSession(); setScreen("login"); return;
        }
        const p = await sb.getProfile(token, u.id);
        setAuthToken(token);
        setUser(u);
        setProfile(p);
        setScreen(p?.whatsapp ? "dashboard" : "onboarding");
      } catch {
        setScreen("login");
      }
    })();
  }, []);

  const handleSignOut = async () => {
    if (authToken) await sb.signOut(authToken);
    sb.clearSession();
    setUser(null); setProfile(null); setAuthToken(null);
    setScreen("login");
  };

  // Demo login bypass
  const handleDemoLogin = (demoUser, demoProfile) => {
    setUser(demoUser);
    setProfile(demoProfile);
    setScreen("dashboard");
  };

  if (screen === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <CloverMark size={32} color={BLUE}/>
          <Spinner color={BLUE} size={24}/>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {screen === "login" && <LoginScreen onLogin={handleDemoLogin}/>}

      {screen === "onboarding" && user && (
        <OnboardingScreen
          user={user} token={authToken}
          onComplete={async (data) => {
            const p = await sb.getProfile(authToken, user.id);
            setProfile(p || { whatsapp: data.whatsapp, role: data.role });
            setScreen("dashboard");
          }}
        />
      )}

      {screen === "dashboard" && user && (
        <DashboardScreen user={user} profile={profile} token={authToken} onSignOut={handleSignOut}/>
      )}
    </>
  );
}

/*
─────────────────────────────────────────────────────────────────────
SUPABASE SETUP GUIDE
─────────────────────────────────────────────────────────────────────

1. Create a project at supabase.com

2. SQL Editor → run this:

create table profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null unique,
  email text not null,
  name text,
  avatar_url text,
  whatsapp text,
  role text,
  created_at timestamptz default now()
);

create table pulse_entries (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  week_of date not null,
  note text,
  tasks jsonb default '[]',
  completed_last jsonb default '[]',
  blockers jsonb default '[]',
  submitted_at timestamptz default now(),
  unique(user_id, week_of)
);

alter table profiles enable row level security;
alter table pulse_entries enable row level security;

create policy "Users can read all profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "Users own their profile" on profiles for all using (auth.uid() = user_id);
create policy "Users can read all entries" on pulse_entries for select using (auth.role() = 'authenticated');
create policy "Users own their entries" on pulse_entries for all using (auth.uid() = user_id);

3. Auth → Providers → Google → enable
   - Client ID + Secret from Google Cloud Console (OAuth 2.0)
   - Authorized domain: rideclover.com
   - In Google Cloud: restrict to hd=rideclover.com

4. Swap SUPABASE_URL and SUPABASE_ANON_KEY at the top of this file

5. Deploy (Vercel, Netlify, or Cloudflare Pages — all free)
─────────────────────────────────────────────────────────────────────
*/
