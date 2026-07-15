import { useState } from "react";
import { C } from "../theme";
import { sb } from "../db";
import { CloverLogo, BtnPrimary } from "../ui";

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

export { OnboardingScreen };
