import { useState } from "react";
import { C } from "../theme";
import { sb } from "../db";
import { CloverLogo, BtnPrimary } from "../ui";

function OnboardingScreen({ user, token, onComplete }) {
  const [role, setRole] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const firstName = user?.user_metadata?.full_name?.split(" ")[0] || "there";
  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await sb.upsertProfile(token, { user_id: user.id, email: user.email, name: user.user_metadata?.full_name || user.email, avatar_url: user.user_metadata?.avatar_url || null, role, created_at: new Date().toISOString() });
      onComplete();
    } catch { setError("Something went wrong. Try again."); setSaving(false); }
  };
  return (
    <div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "44px 40px", maxWidth: 420, width: "100%", border: `1px solid ${C.gray200}`, boxShadow: "0 8px 40px rgba(28,43,222,0.12)" }}>
        <div style={{ marginBottom: 32 }}><CloverLogo height={26}/></div>
        <h1 style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: 22, color: C.gray800, marginBottom: 8 }}>Hey {firstName} 👋</h1>
        <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray400, lineHeight: 1.6, marginBottom: 32 }}>You're all set. Each Monday, send your weekly update by DMing the <span style={{ color: C.blue, fontWeight: 600 }}>Clover Pulse</span> bot on Slack — a voice note or a message, whatever's easiest.</p>
        <div style={{ marginBottom: 32 }}>
          <label style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600, color: C.gray600, letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Your role (optional)</label>
          <input type="text" value={role} onChange={e=>setRole(e.target.value)} placeholder="e.g. Co-founder · Ops" style={{ width: "100%", background: "#fff", border: `1.5px solid ${C.gray200}`, borderRadius: 8, padding: "10px 14px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 14, color: C.gray800, outline: "none" }}/>
        </div>
        <BtnPrimary onClick={handleSave} loading={saving} style={{ width: "100%" }}>Let's go →</BtnPrimary>
        {error && <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.error, marginTop: 12, textAlign: "center" }}>{error}</p>}
      </div>
    </div>
  );
}

export { OnboardingScreen };
