import { useState, useEffect } from "react";
import { C } from "../theme";
import { currentWeekOf, formatWeekLabel, useIsMobile, blockerResolved } from "../helpers";
import { sb } from "../db";
import { CloverLogo, Spinner, Avatar } from "../ui";
import { MemberCard } from "../components/MemberCard";
import { StatTile, WaTile, CompletionTile } from "../components/tiles";

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
          {isAdmin && (<button onClick={() => { setOpen(false); onAdmin(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.blue, textAlign: "left", fontWeight: 500 }}>⚙ Admin</button>)}
          <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.error, textAlign: "left" }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

function WeekNav({ currentWeek, allWeeks, onChange }) {
  const idx = allWeeks.indexOf(currentWeek);
  const canBack = idx < allWeeks.length - 1;
  const canForward = idx > 0;
  const isCurrentWeek = idx === 0;
  const navBtn = (onClick, disabled, label, icon) => (
    <button onClick={onClick} disabled={disabled} style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: disabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)", fontSize: 18, fontWeight: 300 }} aria-label={label}>{icon}</button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {navBtn(() => onChange(allWeeks[idx + 1]), !canBack, "Previous week", "‹")}
      <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", minWidth: 110, textAlign: "center" }}>{isCurrentWeek ? "This week" : formatWeekLabel(currentWeek)}</span>
      {navBtn(() => onChange(allWeeks[idx - 1]), !canForward, "Next week", "›")}
    </div>
  );
}

function DashboardScreen({ user, profile, token, onSignOut, onAdmin, isAdmin }) {
  const mobile = useIsMobile();
  const [profiles, setProfiles] = useState([]);
  const [entries, setEntries] = useState([]);
  const [lastEntries, setLastEntries] = useState([]);
  const [allWeeks, setAllWeeks] = useState([currentWeekOf()]);
  const [selectedWeek, setSelectedWeek] = useState(currentWeekOf());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const thisWeek = currentWeekOf();
  const isHistoryView = selectedWeek !== thisWeek;
  // Compute in UTC so the Monday key matches how week_of is stored (browser-local
  // would shift a day for UTC+ timezones and break the "Last week" lookup).
  const prevWeek = (() => { const d = new Date(selectedWeek + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().split("T")[0]; })();

  const loadData = async () => {
    const [profs, ents, lastEnts, weeks] = await Promise.all([sb.getAllProfiles(token), sb.getPulseEntries(token, selectedWeek), sb.getPulseEntries(token, prevWeek), sb.getAllWeeks(token)]);
    if (Array.isArray(profs)) setProfiles(profs);
    if (Array.isArray(ents)) setEntries(ents);
    if (Array.isArray(lastEnts)) setLastEntries(lastEnts);
    if (Array.isArray(weeks)) { const withCurrent = weeks.includes(thisWeek) ? weeks : [thisWeek, ...weeks]; setAllWeeks(withCurrent); }
  };

  useEffect(() => { (async () => { await loadData(); setLoading(false); })(); }, [token, selectedWeek]);
  useEffect(() => {
    if (isHistoryView) return;
    const onFocus = () => loadData();
    const onVisibility = () => { if (document.visibilityState === "visible") loadData(); };
    window.addEventListener("focus", onFocus); document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
  }, [token, selectedWeek]);

  const handleRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };
  const handleWeekChange = (week) => { setSelectedWeek(week); setEntries([]); setLastEntries([]); };
  const getEntry = (uid) => entries.find(e => e.user_id === uid) || null;
  const getLastEntry = (uid) => lastEntries.find(e => e.user_id === uid) || null;
  const submitted = profiles.filter(p => getEntry(p.user_id)?.submitted_at).length;
  const blocked = profiles.filter(p => { const e = getEntry(p.user_id); return (e?.blockers || []).some(b => !blockerResolved(b)); }).length;
  const allTasks = entries.flatMap(e => e.tasks||[]);
  const doneTasks = allTasks.filter(t => t.done).length;
  const sortedProfiles = [...profiles.filter(p => p.user_id === user?.id), ...profiles.filter(p => p.user_id !== user?.id)];
  const getSpan = (p) => { const e = getEntry(p.user_id); if (p.user_id === user?.id) return "hero"; if ((e?.blockers||[]).filter(b => !blockerResolved(b)).length > 0) return "wide"; if ((e?.tasks||[]).length >= 4) return "tall"; return "small"; };
  const otherProfiles = sortedProfiles.slice(1);
  const colMid = Math.ceil(otherProfiles.length / 2);

  if (loading) return (<div style={{ minHeight: "100vh", background: C.gray50, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}><CloverLogo height={30}/><Spinner color={C.blue} size={22}/></div></div>);

  return (
    <div style={{ minHeight: "100vh", background: C.gray50 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 100, background: C.darkest, height: 64, display: "flex", alignItems: "center", padding: mobile ? "0 16px" : "0 32px", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(2,10,64,0.3)" }}>
        <a href="https://clover.tools" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <CloverLogo height={mobile?28:36} white/>
          <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 300, fontSize: mobile?13:15, color: "rgba(255,255,255,0.5)", marginLeft: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pulse</span>
        </a>
        {!mobile && allWeeks.length > 1 && <WeekNav currentWeek={selectedWeek} allWeeks={allWeeks} onChange={handleWeekChange}/>}
        <div style={{ display: "flex", alignItems: "center", gap: mobile?10:16 }}>
          {!mobile && <a href="https://clover.tools" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1.5px solid rgba(255,255,255,0.18)", borderRadius: 8, color: "rgba(255,255,255,0.6)", fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: "0.03em", padding: "6px 14px", textDecoration: "none" }}>← All tools</a>}
          <div style={{ display: "flex", alignItems: "center", gap: 5, background: submitted===profiles.length&&profiles.length>0 ? "rgba(28,43,222,0.35)" : "rgba(222,28,119,0.35)", borderRadius: 100, padding: "4px 11px" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: submitted===profiles.length&&profiles.length>0 ? "#a0aaff" : "#ff8fc0" }}/>
            <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, color: "#fff" }}>{submitted}/{profiles.length}</span>
          </div>
          {!isHistoryView && (<button onClick={handleRefresh} style={{ background: "none", border: "none", cursor: "pointer", width: 34, height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)" }}>{refreshing ? <Spinner color="rgba(255,255,255,0.6)" size={16}/> : (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 112.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M13.5 4v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>)}</button>)}
          <ProfileMenu user={user} profile={profile} onSignOut={onSignOut} isAdmin={isAdmin} onAdmin={onAdmin}/>
        </div>
      </header>
      <main style={{ maxWidth: 1600, margin: "0 auto", padding: mobile?"16px 14px 60px":"32px 28px 80px" }}>
        {mobile && allWeeks.length > 1 && (<div style={{ display: "flex", justifyContent: "center", marginBottom: 14, background: C.darkest, borderRadius: 12, padding: "8px 16px" }}><WeekNav currentWeek={selectedWeek} allWeeks={allWeeks} onChange={handleWeekChange}/></div>)}
        {isHistoryView && (<div style={{ background: C.lavender, borderRadius: 12, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.blue, fontWeight: 500 }}>📅 Viewing {formatWeekLabel(selectedWeek)} — read only</span><button onClick={() => handleWeekChange(thisWeek)} style={{ background: C.blue, border: "none", borderRadius: 8, padding: "5px 12px", color: "#fff", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600 }}>Back to this week</button></div>)}
        {profiles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px" }}><div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}><CloverLogo height={36}/></div><div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 16, color: C.gray400, marginTop: 8 }}>No team members yet.</div></div>
        ) : mobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={C.blue}/><StatTile label="Blockers" value={blocked} accent={blocked>0?C.pink:C.gray800} sub={blocked>0?"Needs attention":"All clear"}/></div>
            {sortedProfiles.map((p,i) => <MemberCard key={p.user_id} member={p} entry={getEntry(p.user_id)} lastEntry={getLastEntry(p.user_id)} isCurrentUser={!isHistoryView && p.user_id===user?.id} isAdmin={!isHistoryView && isAdmin} token={token} weekOf={selectedWeek} onEntryUpdated={handleRefresh} allProfiles={isHistoryView ? null : profiles} currentUserId={isHistoryView ? null : user?.id} mobile span={getSpan(p)}/>)}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{!isHistoryView && <WaTile/>}<StatTile label="Done" value={`${doneTasks}/${allTasks.length}`} accent={C.blue}/><CompletionTile profiles={profiles} entries={entries}/></div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <MemberCard member={sortedProfiles[0]} entry={getEntry(sortedProfiles[0].user_id)} lastEntry={getLastEntry(sortedProfiles[0].user_id)} isCurrentUser={!isHistoryView && sortedProfiles[0].user_id===user?.id} isAdmin={!isHistoryView && isAdmin} token={token} weekOf={selectedWeek} onEntryUpdated={handleRefresh} allProfiles={isHistoryView ? null : profiles} currentUserId={isHistoryView ? null : user?.id} mobile={false} span={getSpan(sortedProfiles[0])}/>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                {otherProfiles.slice(0, colMid).map((p) => <MemberCard key={p.user_id} member={p} entry={getEntry(p.user_id)} lastEntry={getLastEntry(p.user_id)} isCurrentUser={!isHistoryView && p.user_id===user?.id} isAdmin={!isHistoryView && isAdmin} token={token} weekOf={selectedWeek} onEntryUpdated={handleRefresh} allProfiles={isHistoryView ? null : profiles} currentUserId={isHistoryView ? null : user?.id} mobile={false} span={getSpan(p)}/>)}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                {otherProfiles.slice(colMid).map((p) => <MemberCard key={p.user_id} member={p} entry={getEntry(p.user_id)} lastEntry={getLastEntry(p.user_id)} isCurrentUser={!isHistoryView && p.user_id===user?.id} isAdmin={!isHistoryView && isAdmin} token={token} weekOf={selectedWeek} onEntryUpdated={handleRefresh} allProfiles={isHistoryView ? null : profiles} currentUserId={isHistoryView ? null : user?.id} mobile={false} span={getSpan(p)}/>)}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, alignItems: "start" }}>
              <StatTile label="Submitted" value={`${submitted}/${profiles.length}`} accent={C.blue} sub={submitted<profiles.length?`${profiles.length-submitted} missing`:"All in"}/>
              <StatTile label="Blockers" value={blocked} accent={blocked>0?C.pink:C.gray800} sub={blocked>0?"Needs attention":"All clear"}/>
              <StatTile label="Tasks" value={allTasks.length} sub={`${doneTasks} done`} accent={C.blue}/>
              <CompletionTile profiles={profiles} entries={entries}/>
              {!isHistoryView && <WaTile/>}
            </div>
          </>
        )}
        <div style={{ textAlign: "center", marginTop: 44, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, color: C.gray200 }}>Clover Pulse · Internal · rideclover.com</div>
      </main>
    </div>
  );
}

export { DashboardScreen };
