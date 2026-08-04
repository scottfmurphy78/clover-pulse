import { useState, useEffect } from "react";
import { C } from "../theme";
import { sb } from "../db";
import { CloverLogo, Spinner, Avatar, BtnDestructive, BtnGhost } from "../ui";

function AdminScreen({ token, onBack }) {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => { const p = await sb.getAllProfiles(token); setProfiles(Array.isArray(p) ? p : []); setLoading(false); })();
  }, [token]);

  const handleDelete = async (userId) => {
    setDeleting(true);
    await sb.deleteProfile(token, userId);
    setProfiles(p => p.filter(x => x.user_id !== userId));
    setConfirmDelete(null); setDeleting(false);
  };

  const sortedProfiles = [...profiles].sort((a,b) => (a.name||"").localeCompare(b.name||""));

  return (
    <div style={{ minHeight: "100vh", background: C.gray50 }}>
      <header style={{ background: C.darkest, height: 64, display: "flex", alignItems: "center", padding: "0 32px", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <a href="https://clover.tools" style={{ textDecoration: "none" }}><CloverLogo height={26} white/></a>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: 6 }}>← Back to dashboard</button>
      </header>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 28px" }}>
        <h1 style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 22, color: C.gray800, marginBottom: 8 }}>Team members</h1>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, marginBottom: 32 }}>Manage who has access to Clover Pulse.</p>
        <div style={{ background: "#fff", border: `1px solid ${C.gray200}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 2.5fr 1.5fr 80px", background: C.blue, padding: "0 20px" }}>
            {["Name","Email","Role",""].map((h,i) => (<div key={i} style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, color: "#fff", textTransform: "uppercase", letterSpacing: "0.5px", padding: "14px 0" }}>{h}</div>))}
          </div>
          {loading ? (<div style={{ padding: 40, display: "flex", justifyContent: "center" }}><Spinner/></div>) : sortedProfiles.length === 0 ? (<div style={{ padding: 40, textAlign: "center", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400 }}>No team members yet.</div>) : sortedProfiles.map((p, i) => (
            <div key={p.user_id} style={{ display: "grid", gridTemplateColumns: "2fr 2.5fr 1.5fr 80px", padding: "0 20px", background: i % 2 === 0 ? "#fff" : C.gray50, borderTop: `0.5px solid ${C.gray100}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0" }}><Avatar name={p.name} size={32} gradient/><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray800, fontWeight: 500 }}>{p.name}</span></div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray600 }}>{p.email}</div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray400 }}>{p.role || "—"}</div>
              <div style={{ display: "flex", alignItems: "center", padding: "14px 0" }}><BtnDestructive onClick={() => setConfirmDelete(p)} style={{ padding: "4px 10px", fontSize: 11 }}>Remove</BtnDestructive></div>
            </div>
          ))}
        </div>
        <div style={{ background: "#fff", border: `1px solid ${C.gray200}`, borderRadius: 12, padding: 28, marginTop: 24, boxShadow: "0 1px 4px rgba(28,43,222,0.08)" }}>
          <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 15, fontWeight: 700, color: C.gray800, marginBottom: 8 }}>Invite team members</div>
          <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray400, lineHeight: 1.6, marginBottom: 16 }}>Share this link with anyone who has an @rideclover.com Google account.</p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ flex: 1, background: C.gray50, border: `1.5px solid ${C.gray200}`, borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 13, color: C.gray600 }}>https://pulse.clover.tools</div>
            <BtnGhost onClick={() => navigator.clipboard?.writeText("https://pulse.clover.tools")}>Copy link</BtnGhost>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,10,64,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "32px 36px", maxWidth: 400, width: "100%", boxShadow: "0 16px 48px rgba(28,43,222,0.22)" }}>
            <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 17, color: C.gray800, marginBottom: 10 }}>Remove {confirmDelete.name}?</div>
            <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, lineHeight: 1.6, marginBottom: 28 }}>This will remove their profile from Pulse.</p>
            <div style={{ display: "flex", gap: 12 }}><BtnDestructive onClick={() => handleDelete(confirmDelete.user_id)} loading={deleting}>Yes, remove</BtnDestructive><BtnGhost onClick={() => setConfirmDelete(null)}>Cancel</BtnGhost></div>
          </div>
        </div>
      )}
    </div>
  );
}

export { AdminScreen };
