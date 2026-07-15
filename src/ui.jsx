import { C } from "./theme";
import { getInitials } from "./helpers";

// ── Design atoms ──────────────────────────────────────────────────────
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

function DSCheckbox({ checked, onChange }) {
  return (
    <div onClick={e => { e.stopPropagation(); onChange(!checked); }} style={{
      width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer",
      border: checked ? "none" : `2px solid ${C.gray400}`,
      background: checked ? C.blue : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: "all 0.15s",
    }}>
      {checked && (
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
          <path d="M1 4l2.5 2.5L9 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

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

function ProgressBar({ tasks }) {
  const done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? (done / tasks.length) * 100 : 0;
  return (
    <div style={{ height: 3, background: `${C.blue}18`, borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: 3, borderRadius: 2, background: C.blue, width: `${pct}%`, transition: "width 0.4s cubic-bezier(.4,0,.2,1)" }}/>
    </div>
  );
}

export { CloverLogo, Spinner, BtnPrimary, BtnDestructive, BtnGhost, DSCheckbox, Badge, Avatar, ProgressBar };
