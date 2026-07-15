import { C } from "../theme";

function StatTile({ label, value, accent, sub }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "18px 20px", border: `1px solid ${C.gray200}`, boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 30, color: accent||C.gray800, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray400, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

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

function CompletionTile({ profiles, entries }) {
  if (!entries.length) return null;
  const rates = profiles.map(p => {
    const e = entries.find(en => en.user_id === p.user_id);
    if (!e || !e.tasks?.length) return null;
    const done = e.tasks.filter(t => t.done).length;
    const pct = Math.round((done / e.tasks.length) * 100);
    return { name: p.name?.split(" ")[0], pct, done, total: e.tasks.length };
  }).filter(Boolean);
  if (!rates.length) return null;
  const avg = Math.round(rates.reduce((s, r) => s + r.pct, 0) / rates.length);
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: "16px 18px", border: `1px solid ${C.gray200}`, boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 10 }}>Completion rate</div>
      <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 28, color: avg >= 70 ? C.success : avg >= 40 ? C.warning : C.error, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 8 }}>{avg}%</div>
      {rates.map((r, i) => (<div key={i} style={{ marginBottom: 6 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray600 }}>{r.name}</span><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray400 }}>{r.done}/{r.total}</span></div><div style={{ height: 3, background: C.gray100, borderRadius: 2 }}><div style={{ height: 3, borderRadius: 2, background: r.pct >= 70 ? C.success : r.pct >= 40 ? C.warning : C.error, width: `${r.pct}%`, transition: "width 0.4s" }}/></div></div>))}
    </div>
  );
}

export { StatTile, WaTile, CompletionTile };
