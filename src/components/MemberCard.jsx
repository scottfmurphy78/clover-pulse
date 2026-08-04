import { useState, useEffect } from "react";
import { C } from "../theme";
import { endOfWeek, blockerText, blockerResolved } from "../helpers";
import { sb } from "../db";
import { Avatar, Badge, ProgressBar, BtnPrimary } from "../ui";
import { TaskRow, ReadOnlyTaskRow, HeroTaskRow, LastWeek } from "./tasks";

function MemberCard({ member, entry, lastEntry, isCurrentUser, isAdmin, token, weekOf, onEntryUpdated, mobile, span, allProfiles, currentUserId }) {
  const rawTasks = entry?.tasks || [];
  const [tasks, setTasks] = useState(rawTasks);
  const [blockers, setBlockers] = useState(entry?.blockers || []);
  const [saving, setSaving] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState(member.user_id);
  useEffect(() => { setTasks(entry?.tasks || []); setBlockers(entry?.blockers || []); }, [entry]);
  useEffect(() => { setNewTaskAssignee(member.user_id); }, [member.user_id]);
  const profiles = allProfiles && allProfiles.length ? allProfiles : null;

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

  const handleToggle = (id) => { const updated = tasks.map(t => t.id === id ? { ...t, done: !t.done } : t); setTasks(updated); saveTasks(updated); };
  const handleEdit = (id, text) => { const updated = tasks.map(t => t.id === id ? { ...t, text } : t); setTasks(updated); saveTasks(updated); };
  const handleDelete = (id) => { const updated = tasks.filter(t => t.id !== id); setTasks(updated); saveTasks(updated); };
  const handleDeadline = (id, deadline) => { const updated = tasks.map(t => t.id === id ? { ...t, deadline } : t); setTasks(updated); saveTasks(updated); };

  // Adjust the due date of a task on this member's card (used by the assigner, via the service-key endpoint).
  const handleAssignedDeadline = async (taskId, deadline) => {
    setTasks(tasks.map(t => t.id === taskId ? { ...t, deadline } : t)); // optimistic
    setSaving(true);
    try {
      const r = await fetch("/api/assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "set-deadline", userId: member.user_id, weekOf, taskId, deadline }),
      });
      if (!r.ok) console.error("Deadline update failed:", await r.text());
    } catch (err) { console.error("Deadline update error:", err); }
    setSaving(false);
    onEntryUpdated();
  };

  // Reassign an existing task to another member (allowed for anyone — service-key endpoint moves it).
  const handleAssign = async (taskId, toUserId) => {
    if (toUserId === member.user_id) return;
    setTasks(tasks.filter(t => t.id !== taskId)); // optimistic: it leaves this card
    setSaving(true);
    try {
      const r = await fetch("/api/assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, taskId, fromUserId: member.user_id, toUserId, weekOf }),
      });
      if (!r.ok) console.error("Assign failed:", await r.text());
    } catch (err) { console.error("Assign error:", err); }
    setSaving(false);
    onEntryUpdated();
  };

  const resolveBlocker = async (index) => {
    const updated = blockers.map((b, i) => ({ text: blockerText(b), resolved: i === index ? true : blockerResolved(b) }));
    setBlockers(updated); // optimistic
    setSaving(true);
    try {
      if (isCurrentUser) {
        await sb.upsertPulseEntry(token, { ...entry, blockers: updated });
      } else {
        // Admin resolving another member's blocker — route through the service-key
        // endpoint so it isn't silently dropped by row-level security.
        const r = await fetch("/api/assign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, action: "resolve-blocker", userId: member.user_id, weekOf, blockerIndex: index }),
        });
        if (!r.ok) console.error("Resolve failed:", await r.text());
      }
    } catch (err) { console.error("Resolve error:", err); }
    setSaving(false);
    onEntryUpdated();
  };

  const handleAddTask = async () => {
    if (!newTask.trim()) return;
    const text = newTask.trim();
    const deadline = endOfWeek(weekOf);
    const id = `m${Date.now()}`;
    setNewTask(""); setAddingTask(false);
    if (newTaskAssignee && newTaskAssignee !== member.user_id) {
      // Create directly on a teammate's card via the service-key endpoint.
      setSaving(true);
      try {
        const r = await fetch("/api/assign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, toUserId: newTaskAssignee, weekOf, newTask: { id, text, done: false, deadline } }),
        });
        if (!r.ok) console.error("Assign failed:", await r.text());
      } catch (err) { console.error("Assign error:", err); }
      setSaving(false);
      setNewTaskAssignee(member.user_id);
      onEntryUpdated();
    } else {
      const updated = [...tasks, { id, text, done: false, deadline }];
      setTasks(updated); saveTasks(updated);
    }
  };

  if (isHero) {
    return (
      <div style={{ background: C.blue, borderRadius: 16, padding: mobile ? "22px 20px" : "28px 30px", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", flex: mobile ? undefined : 1, minHeight: mobile ? "auto" : 360, boxShadow: "0 4px 16px rgba(28,43,222,0.22)" }}>
        <div style={{ position: "absolute", right: -60, top: -60, opacity: 0.06 }}>
          <svg width={mobile?180:260} height={mobile?180:260} viewBox="0 0 60 60" fill="none"><circle cx="30" cy="9" r="10" fill="#fff"/><circle cx="30" cy="51" r="10" fill="#fff"/><circle cx="9" cy="30" r="10" fill="#fff"/><circle cx="51" cy="30" r="10" fill="#fff"/><circle cx="30" cy="30" r="6" fill="#fff"/></svg>
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
            {blockers.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Blockers</div>
                {blockers.map((b, i) => { const text = blockerText(b); const resolved = blockerResolved(b); return (<div key={i} style={{ display: "flex", gap: 8, alignItems: "center", background: resolved ? "rgba(255,255,255,0.05)" : "rgba(222,28,119,0.25)", borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: resolved ? "rgba(255,255,255,0.3)" : "#ffb3d0", lineHeight: 1.45, transition: "all 0.2s" }}><span style={{ flexShrink: 0 }}>{resolved ? "✓" : "⚠"}</span><span style={{ flex: 1, textDecoration: resolved ? "line-through" : "none" }}>{text}</span>{canEdit && !resolved && <button onClick={(e) => { e.stopPropagation(); resolveBlocker(i); }} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "6px 12px", color: "#fff", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, position: "relative", zIndex: 10, minWidth: 80, textAlign: "center" }}>✓ Resolve</button>}{resolved && <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, whiteSpace: "nowrap" }}>Resolved</span>}</div>); })}
              </div>
            )}
            {tasks.length > 0 && (<div style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: "0.1em", textTransform: "uppercase" }}>This week</span><span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, color: "rgba(255,255,255,0.38)", fontWeight: 600 }}>{done}/{tasks.length}</span></div><div style={{ height: 3, background: "rgba(255,255,255,0.18)", borderRadius: 2 }}><div style={{ height: 3, borderRadius: 2, background: "#fff", width: `${tasks.length?(done/tasks.length)*100:0}%`, transition: "width 0.4s" }}/></div></div>)}
            <div style={{ flex: 1 }}>
              {tasks.map(t => (<HeroTaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDeadline={handleDeadline} isCurrentUser={isCurrentUser} weekOf={weekOf} profiles={profiles} ownerId={member.user_id} onAssign={handleAssign}/>))}
              {isCurrentUser && (addingTask ? (<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}><input autoFocus value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if(e.key==="Enter") handleAddTask(); if(e.key==="Escape") setAddingTask(false); }} placeholder="Add a task..." style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "5px 10px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: "#fff", outline: "none" }}/>{profiles && profiles.length > 1 && (<select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} title="Assign to…" style={{ background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)", borderRadius: 6, padding: "5px 8px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "#fff", outline: "none" }}>{profiles.map(p => <option key={p.user_id} value={p.user_id} style={{ color: "#000" }}>{p.user_id === member.user_id ? "Me" : (p.name?.split(" ")[0] || "?")}</option>)}</select>)}<button onClick={handleAddTask} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6, padding: "5px 10px", color: "#fff", cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 600, fontSize: 12 }}>Add</button></div>) : (<button onClick={() => setAddingTask(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>+ add task</button>))}
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "0.5px solid rgba(255,255,255,0.12)" }}>
              <LastWeek completedLast={completedLast} doneTasks={lastDoneTasks} onLight={false}/>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: mobile ? "20px 18px" : "24px 22px", border: isBlocked ? `1.5px solid ${C.pink}30` : `1px solid ${C.gray200}`, boxShadow: isBlocked ? `0 0 0 1px ${C.pink}18, 0 4px 16px rgba(28,43,222,0.08)` : "0 1px 4px rgba(28,43,222,0.08)", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      {isBlocked && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: C.pink }}/>}
      {isCurrentUser && <div style={{ position: "absolute", top: 14, right: 14, background: C.lavender, borderRadius: 100, padding: "2px 9px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.blue, letterSpacing: "0.05em", textTransform: "uppercase" }}>You</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Avatar name={member.name} size={38}/>
        <div><div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontWeight: 700, fontSize: submitted?22:18, color: submitted?C.gray800:C.gray200, letterSpacing: "-0.02em", lineHeight: 1 }}>{member.name?.split(" ")[0]}</div><div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, marginTop: 2 }}>{member.role || member.email}</div></div>
        <div style={{ marginLeft: "auto" }}><Badge status={submitted ? (isBlocked?"blocked":"on-track") : "missing"}/></div>
      </div>
      {!submitted ? (
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}><div style={{ background: C.gray50, borderRadius: 10, padding: "8px 12px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, lineHeight: 1.4, width: "100%" }}>No update yet — DM <span style={{ color: C.blue, fontWeight: 600 }}>Clover Pulse</span> on Slack</div></div>
      ) : (
        <>
          <ProgressBar tasks={tasks}/>
          {note && <p style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray600, fontStyle: "italic", lineHeight: 1.55, margin: "12px 0" }}>"{note}"</p>}
          {isBlocked && (<div style={{ marginBottom: 12 }}><div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: `${C.pink}80`, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6 }}>Blockers</div>{blockers.map((b,i) => { const text = blockerText(b); const resolved = blockerResolved(b); return (<div key={i} style={{ display: "flex", gap: 8, alignItems: "center", background: resolved ? C.gray50 : "#FFF0F3", border: `1px solid ${resolved ? C.gray200 : "#FFB3C0"}`, borderRadius: 10, padding: "9px 12px", marginBottom: 6, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12.5, color: resolved ? C.gray400 : C.error, lineHeight: 1.45, transition: "all 0.2s" }}><span style={{ flexShrink: 0 }}>{resolved ? "✓" : "⚠"}</span><span style={{ flex: 1, textDecoration: resolved ? "line-through" : "none" }}>{text}</span>{canEdit && !resolved && <button onClick={(e) => { e.stopPropagation(); resolveBlocker(i); }} style={{ background: "#fff", border: `1.5px solid ${C.error}`, borderRadius: 6, padding: "6px 12px", color: C.error, cursor: "pointer", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, position: "relative", zIndex: 10, minWidth: 80, textAlign: "center" }}>✓ Resolve</button>}{resolved && <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, color: C.gray400, fontWeight: 600, whiteSpace: "nowrap" }}>Resolved</span>}</div>); })}</div>)}
          {tasks.length > 0 && (<><div style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 700, color: C.gray400, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 6, marginTop: 4 }}>This week · {done}/{tasks.length}</div><div style={{ flex: 1 }}>{isCurrentUser ? tasks.map(t => <TaskRow key={t.id} task={t} onToggle={handleToggle} onEdit={handleEdit} onDelete={handleDelete} onDeadline={handleDeadline} weekOf={weekOf} profiles={profiles} ownerId={member.user_id} onAssign={handleAssign}/>) : tasks.map(t => <ReadOnlyTaskRow key={t.id} task={t} weekOf={weekOf} profiles={profiles} ownerId={member.user_id} onAssign={handleAssign} currentUserId={currentUserId} onDeadline={handleAssignedDeadline}/>)}{isCurrentUser && (addingTask ? (<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}><input autoFocus value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => { if(e.key==="Enter") handleAddTask(); if(e.key==="Escape") setAddingTask(false); }} placeholder="Add a task..." style={{ flex: 1, minWidth: 120, border: `1.5px solid ${C.blue}`, borderRadius: 6, padding: "5px 10px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13, color: C.gray800, outline: "none", boxShadow: `0 0 0 3px rgba(28,43,222,0.10)` }}/>{profiles && profiles.length > 1 && (<select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} title="Assign to…" style={{ background: C.gray50, border: `1.5px solid ${C.gray200}`, borderRadius: 6, padding: "5px 8px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray600, outline: "none" }}>{profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.user_id === member.user_id ? "Me" : (p.name?.split(" ")[0] || "?")}</option>)}</select>)}<BtnPrimary onClick={handleAddTask} style={{ padding: "5px 12px", fontSize: 12 }}>Add</BtnPrimary></div>) : (<button onClick={() => setAddingTask(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: "5px 0", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, color: C.gray400, display: "flex", alignItems: "center", gap: 3, marginTop: 4 }}>+ add task</button>))}</div></>)}
          <LastWeek completedLast={completedLast} doneTasks={lastDoneTasks}/>
        </>
      )}
    </div>
  );
}

export { MemberCard };
