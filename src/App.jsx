import { useState, useEffect } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Design tokens (Clover Admin Design System v1.0) ───────────────────
const C = {
  blue:      "#1C2BDE",
  pink:      "#DE1C77",
  lightblue: "#1A62CB",
  midblue:   "#151EA7",
  darkblue:  "#011077",
  darkest:   "#020A40",
  midpink:   "#BD0060",
  gradient:  "linear-gradient(135deg,#1C2BDE 0%,#DE1C77 100%)",
  lavender:  "#E8EAFF",
  gray50:    "#F8F9FF",
  gray100:   "#EDEFFE",
  gray200:   "#D5D9F9",
  gray400:   "#8A92D4",
  gray600:   "#4A5299",
  gray800:   "#1E2563",
  success:   "#00C48C",
  warning:   "#FFB547",
  error:     "#FF4D6D",
};

// ── Supabase client ───────────────────────────────────────────────────
const sb = {
  h: (token) => ({
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token || SUPABASE_ANON_KEY}`,
  }),
  async signInWithGoogle() {
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(window.location.origin)}`;
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: this.h(token) });
  },
  async getSession() {
    const hash = window.location.hash;
    if (hash.includes("access_token")) {
      const p = new URLSearchParams(hash.slice(1));
      const token = p.get("access_token");
      if (token) {
        const exp = Date.now() + parseInt(p.get("expires_in") || "3600") * 1000;
        localStorage.setItem("sb_token", token);
        localStorage.setItem("sb_refresh", p.get("refresh_token") || "");
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
    return r.ok ? r.json() : null;
  },
  clearSession() { ["sb_token","sb_refresh","sb_expires"].forEach(k => localStorage.removeItem(k)); },
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

// ── Helpers ───────────────────────────────────────────────────────────
function currentWeekOf() {
  const d = new Date(); const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d); mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}
function formatWeekLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => { const fn = () => setM(window.innerWidth < 768); window.addEventListener("resize", fn); return () => window.removeEventListener("resize", fn); }, []);
  return m;
}
function getInitials(name) { return (name||"?").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase(); }

// ── ADMIN EMAILS — add co-founders here ──────────────────────────────
const ADMIN_EMAILS = ["scott@rideclover.com","antonio@rideclover.com"];

// ── Design atoms ──────────────────────────────────────────────────────

// Real Clover logo — PNG, white-filtered on dark backgrounds
function CloverLogo({ height = 28, white = false }) {
  return (
    <img
      src={white ? "/clover-logo-white.png" : "/clover-logo.png"}
      alt="Clover"
      style={{ height, width: "auto", display: "block" }}
    />
  );
}

function Spinner({ color = C.blue, size = 18 }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", border: `2px solid ${color}30`, borderTop: `2px solid ${color}`, animation: "spin 0.7s linear infinite", flexShrink: 0 }}/>;
}

// A1 Primary button
function BtnPrimary({ children, onClick, loading, disabled, style={} }) {
  return (
    <button onClick={disabled||loading ? undefined : onClick} style={{
      background: C.blue, color: "#fff", border: "none",
      borderRadius: 8, padding: "10px 22px",
      fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 14,
      cursor: disabled||loading ? "not-allowed" : "pointer",
      opacity: disabled||loading ? 0.4 : 1,
      display: "inline-flex", alignItems: "center", gap: 8,
      transition: "opacity 0.15s", minWidth: 80, justifyContent: "center",
      ...style,
    }}>
      {loading ? <Spinner color="#fff" size={16}/> : children}
    </button>
  );
}

// A9 Destructive button
function BtnDestructive({ children, onClick, loading, style={} }) {
  return (
    <button onClick={onClick} style={{
      background: "#FFF0F3", border: "1.5px solid #FFB3C0",
      color: C.error, borderRadius: 8, padding: "7px 16px",
      fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 13,
      cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
      ...style,
    }}>
      {loading ? <Spinner color={C.error} size={14}/> : children}
    </button>
  );
}

// Ghost button
function BtnGhost({ children, onClick, style={} }) {
  return (
    <button onClick={onClick} style={{
      background: "transparent", border: `2px solid ${C.blue}`,
      color: C.blue, borderRadius: 8, padding: "7px 16px",
      fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 13,
      cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
      ...style,
    }}>
      {children}
    </button>
  );
}

// Design-system checkbox (18×18, blue when checked)
function DSCheckbox({ checked, onChange, onLight = true }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange(!checked); }} style={{
      width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer",
      border: checked ? "none" : `2px solid ${C.gray400}`,
      background: checked ? C.blue : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.15s",
      boxShadow: "none",
    }}>
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

// Status badge
function Badge({ status }) {
  const map = {
    "on-track": { bg: "#D1FAF0", color: "#00875A", label: "On track" },
    "blocked":  { bg: "#FFE0E6", color: "#C00030", label: "Blocked" },
    "missing":  { bg: C.gray100, color: C.gray400, label: "No update" },
  };
  const s = map[status] || map["missing"];
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 100, padding: "4px 10px",
      fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 11,
      textTransform: "uppercase", letterSpacing: "0.5px",
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }}/>
      {s.label}
    </span>
  );
}

// Avatar initials circle
function Avatar({ name, size = 32, gradient = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: gradient ? C.gradient : C.lavender,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700,
      fontSize: size > 36 ? 14 : 12,
      color: gradient ? "#fff" : C.blue,
    }}>
      {getInitials(name)}
    </div>
  );
}

// Progress bar
function ProgressBar({ tasks }) {
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? (done / tasks.length) * 100 : 0;
  return (
    <div style={{ height: 3, background: `${C.blue}18`, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: 3, borderRadius: 2, background: C.blue, width: `${pct}%`, transition: "width 0.4s cubic-bezier(.4,0,.2,1)" }}/>
    </div>
  );
}

// ── Task row with inline edit ─────────────────────────────────────────
function TaskRow({ task, onToggle, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.text);

  const save = () => {
    if (val.trim() && val !== task.text) onEdit(task.id, val.trim());
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", opacity: task.done ? 0.38 : 1, transition: "opacity 0.18s", group: true }}>
      <DSCheckbox checked={task.done} onChange={() => onToggle(task.id)}/>
      {editing ? (
        <input
          autoFocus value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          style={{
            flex: 1, border: `1.5px solid ${C.blue}`, borderRadius: 6,
            padding: "3px 8px", fontFamily: "'Poppins',Arial,sans-serif",
            fontSize: 13.5, color: C.gray800, outline: "none",
            boxShadow: `0 0 0 3px rgba(28,43,222,0.10)`,
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            flex: 1, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5,
            color: C.gray800, lineHeight: 1.45, cursor: "text",
            textDecoration: task.done ? "line-through" : "none",
          }}
        >
          {task.text}
        </span>
      )}
      <button onClick={() => onDelete(task.id)} style={{
        background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
        color: C.gray400, fontSize: 14, lineHeight: 1, opacity: 0.5,
        display: "flex", alignItems: "center",
      }}>×</button>
    </div>
  );
}

// ── Last week section — prominent, merges completed_last + done tasks ──
function LastWeek({ completedLast = [], doneTasks = [], onLight = true }) {
  const [open, setOpen] = useState(false);
  const allItems = [
    ...doneTasks.map(t => ({ text: t.text, source: "task" })),
    ...completedLast.map(t => ({ text: t, source: "note" })),
  ];
  if (!allItems.length) return null;
  const accent = onLight ? C.blue : "rgba(255,255,255,0.6)";
  const textColor = onLight ? C.gray600 : "rgba(255,255,255,0.5)";
  const borderColor = onLight ? C.gray200 : "rgba(255,255,255,0.12)";
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${borderColor}` }}>
      <button onClick={() => setOpen(!open)} style={{
        background: onLight ? C.lavender : "rgba(255,255,255,0.1)",
        border: `1px solid ${onLight ? C.gray200 : "rgba(255,255,255,0.15)"}`,
        borderRadius: 8, cursor: "pointer",
        padding: "7px 12px", width: "100%",
        fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600,
        color: onLight ? C.blue : "rgba(255,255,255,0.6)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        letterSpacing: "0.04em",
      }}>
        <span>✓ Last week · {allItems.length} completed</span>
        <span style={{ display: "inline-block", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", fontSize: 14 }}>⌄</span>
      </button>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {allItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "3px 0" }}>
              <span style={{ color: accent, fontSize: 11, marginTop: 2, flexShrink: 0 }}>✓</span>
              <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: textColor, lineHeight: 1.45 }}>{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Hero task row — inline edit on dark blue background ───────────────
function HeroTaskRow({ task, onToggle, onEdit, onDelete, isCurrentUser }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.text);

  const save = () => {
    if (val.trim() && val !== task.text) onEdit(task.id, val.trim());
    setEditing(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", opacity: task.done ? 0.35 : 1, transition: "opacity 0.18s" }}>
      <div onClick={() => onToggle(task.id)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer", border: task.done ? "none" : "2px solid rgba(255,255,255,0.4)", background: task.done ? "rgba(255,255,255,0.9)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
        {task.done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      {editing && isCurrentUser ? (
        <input
          autoFocus value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 6, padding: "3px 8px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: "#fff", outline: "none" }}
        />
      ) : (
        <span
          onClick={() => isCurrentUser && setEditing(true)}
          style={{ flex: 1, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: "#fff", lineHeight: 1.45, cursor: isCurrentUser ? "text" : "default", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.5 : 1 }}
        >
          {task.text}
        </span>
      )}
      {isCurrentUser && (
        <button onClick={() => onDelete(task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(255,255,255,0.3)", fontSize: 14, lineHeight: 1 }}>×</button>
      )}
    </div>
  );
}

// ── Member card ───────────────────────────────────────────────────────
function MemberCard({ member, entry, lastEntry, isCurrentUser, isAdmin, token, weekOf, onEntryUpdated, mobile, span }) {
  const rawTasks = entry?.tasks || [];
  const [tasks, setTasks] = useState(rawTasks);
  const [blockers, setBlockers] = useState(entry?.blockers || []);
  const [saving, setSaving] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState("");
  useEffect(() => { setTasks(entry?.tasks || []); setBlockers(entry?.blockers || []); }, [entry]);

  const note = entry?.note || null;
  const completedLast = entry?.completed_last || [];
  const lastDoneTasks = (lastEntry?.tasks || []).filter(t => t.done);
  const submitted = !!entry;
  const isBlocked = blockers.length > 0;
  const isHero = span === "hero";
  const done = tasks.filter(t => t.done).length;
  const canEdit = isCurrentUser || isAdmin;

  const saveTasks = async (updated) => {
    if (!isCurrentUser || !entry) return;
    setSaving(true);
    await sb.upsertPulseEntry(token, { ...entry, tasks: updated });
    setSaving(false);
    onEntryUpdated();
  };

  const handleToggle = (id) => {
    const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t);
    setTasks(updated);
    saveTasks(updated);
  };

  const handleEdit = (id, text) => {
    const updated = tasks.map(t => t.id === id ? { ...t, text } : t);
    setTasks(updated);
    saveTasks(updated);
  };

  const handleDelete = (id) => {
    const updated = tasks.filter(t => t.id !== id);
    setTasks(updated);
    saveTasks(updated);
  };

  const resolveBlocker = async (index) => {
    const updated = blockers.filter((_, i) => i !== index);
    setBlockers(updated);
    setSaving(true);
    await sb.upsertPulseEntry(token, { ...entry, blockers: updated });
    setSaving(false);
    onEntryUpdated();
  };

  const handleAddTask = () => {
    if (!newTask.trim()) return;
    const updated = [...tasks, { id: `m${Date.now()}`, text: newTask.trim(), done: false }];
    setTasks(updated);
    saveTasks(updated);
    setNewTask(""); setAddingTask(false);
  };

  // Hero tile — blue filled
  if (isHero) {
    return (
      <div style={{
        background: C.blue, borderRadius: 16,
        padding: mobile ? "22px 20px" : "28px 30px",
        gridColumn: mobile ? "span 1" : "span 2",
        gridRow: mobile ? "span 1" : "span 2",
        position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        minHeight: mobile ? "auto" : 360,
        boxShadow: "0 4px 16px rgba(28,43,222,0.22)",
      }}>
        {/* Decorative clover */}
        <div style={{ position: "absolute", right: -60, top: -60, opacity: 0.06 }}>
          <svg width={mobile?180:260} height={mobile?180:260} viewBox="0 0 60 60" fill="none">
            <circle cx="30" cy="9" r="10" fill="#fff"/>
            <circle cx="30" cy="51" r="10" fill="#fff"/>
            <circle cx="9" cy="30" r="10" fill="#fff"/>
            <circle cx="51" cy="30" r="10" fill="#fff"/>
            <circle cx="30" cy="30" r="6" fill="#fff"/>
          </svg>
        </div>

        {isCurrentUser && <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(255,255,255,0.18)", borderRadius: 100, padding: "2px 10px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" }}>You</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Avatar name={member.name} size={42} gradient={false}/>
          <div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: mobile?26:32, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>{member.name?.split(" ")[0]}</div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{member.role || member.email}</div>
          </div>
        </div>

        {!submitted ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>No update yet this week</div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.25)" }}>DM the Clover Pulse bot on Slack</div>
          </div>
        ) : (
          <>
            {note && <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: "rgba(255,255,255,0.82)", fontStyle: "italic", lineHeight: 1.55, marginBottom: 18, fontWeight: 300 }}>"{note}"</p>}
            {blockers.length > 0 && blockers.map((b, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "rgba(222,28,119,0.25)", borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "#ffb3d0", lineHeight: 1.45 }}>
                <span style={{ flexShrink: 0 }}>⚠</span>
                <span style={{ flex: 1 }}>{b}</span>
                {canEdit && <button onClick={(e) => { e.stopPropagation(); resolveBlocker(i); }} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "4px 10px", color: "#fff", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>✓ Resolve</button>}
              </div>
            ))}
            {tasks.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em", textTransform: "uppercase" }}>This week</span>
                  <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, color: "rgba(255,255,255,0.38)", fontWeight: 600 }}>{done}/{tasks.length}</span>
                </div>
                <div style={{ height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2 }}>
                  <div style={{ height: 3, borderRadius: 2, background: "#fff", width: `${tasks.length?(done/tasks.length)*100:0}%`, transition: "width 0.4s" }}/>
                </div>
              </div>
            )}
            <div style={{ flex: 1 }}>
              {tasks.map(t => (
                <HeroTaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} isCurrentUser={isCurrentUser}/>
              ))}
              {isCurrentUser && (
                addingTask ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <input autoFocus value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if(e.key==="Enter") handleAddTask(); if(e.key==="Escape") setAddingTask(false); }} placeholder="Add a task..." style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "5px 10px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "#fff", outline: "none" }}/>
                    <button onClick={handleAddTask} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6, padding: "5px 10px", color: "#fff", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 12 }}>Add</button>
                  </div>
                ) : (
                  <button onClick={() => setAddingTask(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>+ add task</button>
                )
              )}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "0.5px solid rgba(255,255,255,0.12)" }}>
              <LastWeek completedLast={completedLast} doneTasks={lastDoneTasks} onLight={false}/>
            </div>
          </>
        )}
      </div>
    );
  }

  // Standard tile
  return (
    <div style={{
      background: "#fff", borderRadius: 16,
      padding: mobile ? "20px 18px" : "24px 22px",
      gridColumn: span === "wide" && !mobile ? "span 2" : "span 1",
      gridRow: span === "tall" && !mobile ? "span 2" : "span 1",
      border: isBlocked ? `1.5px solid ${C.pink}30` : `1px solid ${C.gray200}`,
      boxShadow: isBlocked ? `0 0 0 1px ${C.pink}18, 0 4px 16px rgba(28,43,222,0.08)` : "0 1px 4px rgba(28,43,222,0.08)",
      display: "flex", flexDirection: "column",
      position: "relative", overflow: "hidden",
    }}>
      {isBlocked && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: C.pink }}/>}
      {isCurrentUser && <div style={{ position: "absolute", top: 14, right: 14, background: C.lavender, borderRadius: 100, padding: "2px 9px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.blue, letterSpacing: "0.05em", textTransform: "uppercase" }}>You</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Avatar name={member.name} size={38}/>
        <div>
          <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: submitted?22:18, color: submitted?C.gray800:C.gray200, letterSpacing: "-0.02em", lineHeight: 1 }}>{member.name?.split(" ")[0]}</div>
          <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, marginTop: 2 }}>{member.role || member.email}</div>
        </div>
        <div style={{ marginLeft: "auto" }}><Badge status={submitted ? (isBlocked?"blocked":"on-track") : "missing"}/></div>
      </div>

      {!submitted ? (
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          <div style={{ background: C.gray50, borderRadius: 10, padding: "8px 12px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, lineHeight: 1.4, width: "100%" }}>
            No update yet — DM <span style={{ color: C.blue, fontWeight: 600 }}>Clover Pulse</span> on Slack
          </div>
        </div>
      ) : (
        <>
          <ProgressBar tasks={tasks}/>
          {note && <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray600, fontStyle: "italic", lineHeight: 1.55, margin: "12px 0" }}>"{note}"</p>}

          {isBlocked && blockers.map((b,i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FFF0F3", border: `1px solid #FFB3C0`, borderRadius: 10, padding: "9px 12px", marginBottom: 12, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12.5, color: C.error, lineHeight: 1.45 }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span style={{ flex: 1 }}>{b}</span>
              {canEdit && <button onClick={(e) => { e.stopPropagation(); resolveBlocker(i); }} style={{ background: "#fff", border: `1.5px solid ${C.error}`, borderRadius: 6, padding: "4px 10px", color: C.error, cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>✓ Resolve</button>}
            </div>
          ))}

          {tasks.length > 0 && (
            <>
              <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6, marginTop: 4 }}>
                This week · {done}/{tasks.length}
              </div>
              <div style={{ flex: 1 }}>
                {isCurrentUser
                  ? tasks.map(t => <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete}/>)
                  : tasks.map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", opacity: t.done ? 0.35 : 1 }}>
                      <DSCheckbox checked={t.done} onChange={() => {}}/>
                      <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: C.gray800, textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                    </div>
                  ))
                }
                {isCurrentUser && (
                  addingTask ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <input autoFocus value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if(e.key==="Enter") handleAddTask(); if(e.key==="Escape") setAddingTask(false); }} placeholder="Add a task..." style={{ flex: 1, border: `1.5px solid ${C.blue}`, borderRadius: 6, padding: "5px 10px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray800, outline: "none", boxShadow: `0 0 0 3px rgba(28,43,222,0.10)` }}/>
                      <BtnPrimary onClick={handleAddTask} style={{ padding: "5px 12px", fontSize: 12 }}>Add</BtnPrimary>
                    </div>
                  ) : (
                    <button onClick={() => setAddingTask(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "5px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, display: "flex", alignItems: "center", gap: 3, marginTop: 4 }}>+ add task</button>
                  )
                )}
              </div>
            </>
          )}
          <LastWeek completedLast={completedLast} doneTasks={lastDoneTasks}/>
        </>
      )}
    </div>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────
function StatTile({ label, value, accent, sub }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: `1px solid ${C.gray200}`, boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 30, color: accent||C.gray800, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ── WhatsApp tile ─────────────────────────────────────────────────────
function WaTile() {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: `1px solid ${C.gray200}`, boxShadow: "0 1px 4px rgba(28,43,222,0.08)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "#4A154B", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
      </div>
      <div>
        <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 13, color: C.gray800 }}>Send your Monday update</div>
        <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray400, marginTop: 3 }}>DM <span style={{ color: C.blue, fontWeight: 600 }}>Clover Pulse</span> on Slack · before 9:30am</div>
      </div>
    </div>
  );
}

// ── Profile menu ──────────────────────────────────────────────────────
function ProfileMenu({ user, profile, onSignOut, isAdmin, onAdmin }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <Avatar name={profile?.name || user?.email || ""} size={34} gradient/>
      </div>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 42, background: "#fff", borderRadius: 12, border: `1px solid ${C.gray200}`, boxShadow: "0 8px 32px rgba(28,43,222,0.14)", padding: "8px 0", minWidth: 220, zIndex: 200 }}>
          <div style={{ padding: "10px 16px 10px", borderBottom: `0.5px solid ${C.gray100}` }}>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, fontWeight: 600, color: C.gray800 }}>{profile?.name || user?.email}</div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray400, marginTop: 1 }}>{user?.email}</div>
            {profile?.whatsapp && <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: "#25D366", marginTop: 3 }}>WhatsApp: {profile.whatsapp}</div>}
          </div>
          {isAdmin && (
            <button onClick={() => { setOpen(false); onAdmin(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.blue, textAlign: "left", fontWeight: 500 }}>
              ⚙ Admin
            </button>
          )}
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.error, textAlign: "left" }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ── LOGIN SCREEN ──────────────────────────────────────────────────────
function LoginScreen() {
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "48px 44px", maxWidth: 380, width: "100%", border: `1px solid ${C.gray200}`, boxShadow: "0 8px 40px rgba(28,43,222,0.12)", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 36 }}>
          <CloverLogo height={32}/>
        </div>
        <h1 style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 22, color: C.gray800, letterSpacing: "-0.02em", marginBottom: 8 }}>{(() => { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; })()}</h1>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, marginBottom: 36, lineHeight: 1.55 }}>
          Sign in with your <strong style={{ color: C.gray800 }}>@rideclover.com</strong> Google account to see your team's week.
        </p>
        <button onClick={() => { setLoading(true); sb.signInWithGoogle(); }} disabled={loading} style={{ width: "100%", padding: "13px 20px", background: "#fff", border: `1px solid ${C.gray200}`, borderRadius: 10, cursor: loading?"not-allowed":"pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, fontWeight: 600, color: C.gray800, boxShadow: "0 1px 4px rgba(28,43,222,0.08)", opacity: loading?0.6:1 }}>
          {loading ? <Spinner color="#4285F4" size={18}/> : <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>}
          Continue with Google
        </button>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray200, marginTop: 24, lineHeight: 1.5 }}>Only @rideclover.com accounts can sign in.</p>
      </div>
    </div>
  );
}

// ── ONBOARDING SCREEN ─────────────────────────────────────────────────
function OnboardingScreen({ user, token, onComplete }) {
  const [phone, setPhone] = useState(""); const [role, setRole] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const handleSave = async () => {
    if (!phone.match(/^\+?[\d\s\-]{7,15}$/)) { setError("Enter a valid WhatsApp number with country code e.g. +34 600 000 000"); return; }
    setSaving(true);
    try {
      await sb.upsertProfile(token, { user_id: user.id, email: user.email, name: user.user_metadata?.full_name || user.email, avatar_url: user.user_metadata?.avatar_url || null, whatsapp: phone.replace(/\s/g,""), role, created_at: new Date().toISOString() });
      onComplete();
    } catch { setError("Something went wrong. Try again."); setSaving(false); }
  };
  return (
    <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "44px 40px", maxWidth: 420, width: "100%", border: `1px solid ${C.gray200}`, boxShadow: "0 8px 40px rgba(28,43,222,0.12)" }}>
        <div style={{ marginBottom: 32 }}><CloverLogo height={26}/></div>
        <h1 style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 22, color: C.gray800, marginBottom: 8 }}>Hey {firstName} 👋</h1>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, lineHeight: 1.6, marginBottom: 32 }}>One quick step. Add your WhatsApp number so we know it's you when your voice note comes in on Monday morning.</p>
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600, color: C.gray600, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>WhatsApp number</label>
          <input type="tel" value={phone} onChange={e=>{setPhone(e.target.value.replace(/[^\d+\s\-]/g,"")); setError("");}} placeholder="+34 600 000 000" style={{ width: "100%", background: "#fff", border: `1.5px solid ${error?C.error:C.gray200}`, borderRadius: 8, padding: "10px 14px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray800, outline: "none", boxShadow: error?`0 0 0 3px rgba(255,77,109,0.10)`:"none" }}/>
          {error && <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.error, marginTop: 5 }}>{error}</p>}
        </div>
        <div style={{ marginBottom: 32 }}>
          <label style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600, color: C.gray600, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Your role (optional)</label>
          <input type="text" value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Co-founder · Ops" style={{ width: "100%", background: "#fff", border: `1.5px solid ${C.gray200}`, borderRadius: 8, padding: "10px 14px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray800, outline: "none" }}/>
        </div>
        <BtnPrimary onClick={handleSave} loading={saving} disabled={!phone} style={{ width: "100%" }}>Let's go →</BtnPrimary>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray200, marginTop: 20, textAlign: "center", lineHeight: 1.5 }}>Your number is only used to match voice notes to your account.</p>
      </div>
    </div>
  );
}

// ── ADMIN SCREEN ──────────────────────────────────────────────────────
function AdminScreen({ token, onBack }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await sb.getAllProfiles(token);
      setProfiles(Array.isArray(p) ? p : []);
      setLoading(false);
    })();
  }, [token]);

  const handleDelete = async (userId) => {
    setDeleting(true);
    await sb.deleteProfile(token, userId);
    setProfiles(p => p.filter(x => x.user_id !== userId));
    setConfirmDelete(null);
    setDeleting(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.gray50 }}>
      {/* Header */}
      <header style={{ background: C.darkest, height: 64, display: "flex", alignItems: "center", padding: "0 32px", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <CloverLogo height={26} white/>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
          ← Back to dashboard
        </button>
      </header>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px" }}>
        <h1 style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 22, color: C.gray800, marginBottom: 8 }}>Team members</h1>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, marginBottom: 32 }}>Manage who has access to Clover Pulse.</p>

        {/* Table */}
        <div style={{ background: "#fff", border: `1px solid ${C.gray200}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.5fr 1fr 80px", background: C.blue, padding: "0 20px" }}>
            {["Name","Email","WhatsApp","Role",""].map((h,i) => (
              <div key={i} style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", padding: "14px 0" }}>{h}</div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner/></div>
          ) : profiles.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400 }}>No team members yet.</div>
          ) : profiles.map((p, i) => (
            <div key={p.user_id} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1.5fr 1fr 80px", padding: "0 20px", background: i % 2 === 0 ? "#fff" : C.gray50, borderTop: `0.5px solid ${C.gray100}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0" }}>
                <Avatar name={p.name} size={32} gradient/>
                <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray800, fontWeight: 500 }}>{p.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray600 }}>{p.email}</div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: p.whatsapp ? "#25D366" : C.gray200 }}>{p.whatsapp || "—"}</div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray400 }}>{p.role || "—"}</div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}>
                <BtnDestructive onClick={() => setConfirmDelete(p)} style={{ padding: "4px 10px", fontSize: 11 }}>Remove</BtnDestructive>
              </div>
            </div>
          ))}
        </div>

        {/* Invite section */}
        <div style={{ background: "#fff", border: `1px solid ${C.gray200}`, borderRadius: 12, padding: 28, marginTop: 24, boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
          <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 15, fontWeight: 700, color: C.gray800, marginBottom: 8 }}>Invite team members</div>
          <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray400, lineHeight: 1.6, marginBottom: 16 }}>
            Share this link with anyone who has an @rideclover.com Google account. They'll be prompted to add their WhatsApp number on first login.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, background: C.gray50, border: `1.5px solid ${C.gray200}`, borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 13, color: C.gray600 }}>
              https://clover-pulse.vercel.app
            </div>
            <BtnGhost onClick={() => navigator.clipboard?.writeText("https://clover-pulse.vercel.app")}>Copy link</BtnGhost>
          </div>
        </div>
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,10,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "32px 36px", maxWidth: 400, width: "100%", boxShadow: "0 16px 48px rgba(28,43,222,0.22)" }}>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 17, color: C.gray800, marginBottom: 10 }}>Remove {confirmDelete.name}?</div>
            <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, lineHeight: 1.6, marginBottom: 28 }}>
              This will remove their profile and WhatsApp link from Pulse. They'll need to go through onboarding again if they sign back in.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <BtnDestructive onClick={() => handleDelete(confirmDelete.user_id)} loading={deleting}>Yes, remove</BtnDestructive>
              <BtnGhost onClick={() => setConfirmDelete(null)}>Cancel</BtnGhost>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── DASHBOARD SCREEN ──────────────────────────────────────────────────
function DashboardScreen({ user, profile, token, onSignOut, onAdmin, isAdmin }) {
  const mobile = useIsMobile();
  const [profiles, setProfiles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [lastEntries, setLastEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const weekOf = currentWeekOf();
  const lastWeekOf = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
    const mon = new Date(d); mon.setDate(diff);
    return mon.toISOString().split("T")[0];
  })();

  const loadData = async () => {
    const [profs, ents, lastEnts] = await Promise.all([
      sb.getAllProfiles(token),
      sb.getPulseEntries(token, weekOf),
      sb.getPulseEntries(token, lastWeekOf),
    ]);
    if (Array.isArray(profs)) setProfiles(profs);
    if (Array.isArray(ents)) setEntries(ents);
    if (Array.isArray(lastEnts)) setLastEntries(lastEnts);
  };

  useEffect(() => { (async () => { await loadData(); setLoading(false); })(); }, [token]);

  useEffect(() => {
    const onFocus = () => loadData();
    const onVisibility = () => { if (document.visibilityState === "visible") loadData(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
  }, [token]);

  const handleRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const getEntry = (uid) => entries.find(e => e.user_id === uid) || null;
  const getLastEntry = (uid) => lastEntries.find(e => e.user_id === uid) || null;
  const submitted = profiles.filter(p => getEntry(p.user_id)).length;
  const blocked = profiles.filter(p => (getEntry(p.user_id)?.blockers||[]).length > 0).length;
  const allTasks = entries.flatMap(e => e.tasks||[]);
  const doneTasks = allTasks.filter(t => t.done).length;

  const getSpan = (p, i) => {
    const e = getEntry(p.user_id);
    if (i === 0) return "hero";
    if ((e?.blockers||[]).length > 0) return "wide";
    if ((e?.tasks||[]).length >= 4) return "tall";
    return "small";
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <CloverLogo height={30}/><Spinner color={C.blue} size={22}/>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.gray50 }}>
      {/* Top header bar — Darkest Blue, 64px */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: C.darkest,
        height: 64,
        display: "flex", alignItems: "center",
        padding: mobile ? "0 16px" : "0 32px",
        justifyContent: "space-between",
        boxShadow: "0 2px 8px rgba(2,10,64,0.3)",
      }}>
        <CloverLogo height={mobile?28:36} white/>
        <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 300, fontSize: mobile?13:15, color: "rgba(255,255,255,0.5)", marginLeft: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pulse</span>

        <div style={{ display: "flex", alignItems: "center", gap: mobile?10:16 }}>
          {!mobile && (
            <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
              {formatWeekLabel(weekOf)}
            </span>
          )}

          {/* Submission badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: submitted===profiles.length&&profiles.length>0 ? "rgba(28,43,222,0.35)" : "rgba(222,28,119,0.35)",
            borderRadius: 100, padding: "4px 11px",
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: submitted===profiles.length&&profiles.length>0 ? "#a0aaff" : "#ff8fc0" }}/>
            <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, color: "#fff" }}>{submitted}/{profiles.length}</span>
          </div>

          {/* Refresh */}
          <button onClick={handleRefresh} style={{ background: "none", border: "none", cursor: "pointer", width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)" }}>
            {refreshing ? <Spinner color="rgba(255,255,255,0.6)" size={16}/> : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 8A5.5 5.5 0 112.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M13.5 4v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          <ProfileMenu user={user} profile={profile} onSignOut={onSignOut} isAdmin={isAdmin} onAdmin={onAdmin}/>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: mobile?"16px 14px 60px":"32px 28px 80px" }}>
        {profiles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><CloverLogo height={36}/></div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 16, color: C.gray400, marginTop: 8 }}>No team members yet.</div>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray200, marginTop: 6 }}>Share clover-pulse.vercel.app with your team.</div>
          </div>
        ) : mobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={C.blue}/>
              <StatTile label="Blockers" value={blocked} accent={blocked>0?C.pink:C.gray800} sub={blocked>0?"Needs attention":"All clear"}/>
            </div>
            {profiles.map((p,i) => {
              const span = getSpan(p,i);
              return <MemberCard key={p.user_id} member={p} entry={getEntry(p.user_id)} lastEntry={getLastEntry(p.user_id)} isCurrentUser={p.user_id===user?.id} isAdmin={isAdmin} token={token} weekOf={weekOf} onEntryUpdated={handleRefresh} mobile span={span}/>;
            })}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <WaTile/>
              <StatTile label="Done" value={`${doneTasks}/${allTasks.length}`} accent={C.blue}/>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gridAutoRows: "minmax(170px,auto)", gap: 14 }}>
            {profiles.map((p,i) => {
              const span = getSpan(p,i);
              return <MemberCard key={p.user_id} member={p} entry={getEntry(p.user_id)} lastEntry={getLastEntry(p.user_id)} isCurrentUser={p.user_id===user?.id} isAdmin={isAdmin} token={token} weekOf={weekOf} onEntryUpdated={handleRefresh} mobile={false} span={span}/>;
            })}
            <StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={C.blue} sub={submitted<profiles.length?`${profiles.length-submitted} missing`:"All in"}/>
            <StatTile label="Blockers" value={blocked} accent={blocked>0?C.pink:C.gray800} sub={blocked>0?"Needs attention":"All clear"}/>
            <StatTile label="Tasks" value={allTasks.length} sub={`${doneTasks} done so far`} accent={C.blue}/>
            <WaTile/>
          </div>
        )}
        <div style={{ textAlign: "center", marginTop: 44, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray200 }}>
          Clover Pulse · Internal · rideclover.com
        </div>
      </main>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────
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

  const isAdmin = ADMIN_EMAILS.includes(user?.email);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {screen === "loading" && (
        <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20 }}>
          <CloverLogo height={32}/><Spinner color={C.blue} size={24}/>
        </div>
      )}
      {screen === "login" && <LoginScreen/>}
      {screen === "onboarding" && user && (
        <OnboardingScreen user={user} token={token} onComplete={async () => {
          const p = await sb.getProfile(token, user.id);
          setProfile(p); setScreen("dashboard");
        }}/>
      )}
      {screen === "dashboard" && user && (
        <DashboardScreen user={user} profile={profile} token={token}
          onSignOut={handleSignOut}
          isAdmin={isAdmin}
          onAdmin={() => setScreen("admin")}
        />
      )}
      {screen === "admin" && user && isAdmin && (
        <AdminScreen token={token} onBack={() => setScreen("dashboard")}/>
      )}
    </>
  );
}
