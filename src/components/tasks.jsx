import { useState } from "react";
import { C } from "../theme";
import { taskDeadline, isOverdue, formatDeadline, carryStyle, carryCount } from "../helpers";
import { DSCheckbox } from "../ui";

// ── "↳ from X" attribution when a task was assigned by someone else ───
function assignerLabel(task, ownerId, profiles, onDark = false) {
  if (!task.assigned_by || task.assigned_by === ownerId || !profiles) return null;
  const name = profiles.find(p => p.user_id === task.assigned_by)?.name?.split(" ")[0];
  if (!name) return null;
  return <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 9, fontWeight: 700, color: onDark ? "rgba(255,255,255,0.55)" : C.gray400, whiteSpace: "nowrap", letterSpacing: "0.03em" }}>↳ {name}</span>;
}

// ── Deadline chip — shows due date, owner can click to change ──────────
function DeadlineChip({ iso, overdue, canEdit, onChange, onLight = false }) {
  const [editing, setEditing] = useState(false);
  if (editing && canEdit) {
    return (
      <input type="date" autoFocus defaultValue={iso}
        onClick={e => e.stopPropagation()}
        onChange={e => { if (e.target.value) onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        style={{ border: `1.5px solid ${C.blue}`, borderRadius: 6, padding: "1px 5px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, color: C.gray800, outline: "none", colorScheme: "light" }}/>
    );
  }
  const color = overdue ? (onLight ? C.error : "#ffb3d0") : (onLight ? C.gray400 : "rgba(255,255,255,0.5)");
  return (
    <span onClick={canEdit ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
      title={overdue ? "Overdue" + (canEdit ? " — click to change" : "") : "Due" + (canEdit ? " — click to change" : "")}
      style={{ display: "inline-flex", alignItems: "center", gap: 2, fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 600, color, whiteSpace: "nowrap", cursor: canEdit ? "pointer" : "default", flexShrink: 0, letterSpacing: "0.02em" }}>
      {overdue ? `⚠ ${formatDeadline(iso)}` : `due ${formatDeadline(iso)}`}
    </span>
  );
}

// ── Assignee dropdown — anyone can reassign a task to another member ───
function AssigneeSelect({ profiles, ownerId, onAssign, onLight = false }) {
  return (
    <select value={ownerId}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); if (e.target.value !== ownerId) onAssign(e.target.value); }}
      title="Assign to…"
      style={{ appearance: "none", WebkitAppearance: "none", background: onLight ? "rgba(255,255,255,0.14)" : C.gray50, border: `1px solid ${onLight ? "rgba(255,255,255,0.25)" : C.gray200}`, borderRadius: 6, padding: "2px 6px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 10, fontWeight: 600, color: onLight ? "rgba(255,255,255,0.85)" : C.gray600, cursor: "pointer", outline: "none", maxWidth: 90, flexShrink: 0 }}>
      {profiles.map(p => <option key={p.user_id} value={p.user_id} style={{ color: "#000" }}>{p.name?.split(" ")[0] || "?"}</option>)}
    </select>
  );
}

function TaskRow({ task, onToggle, onEdit, onDelete, onDeadline, weekOf, profiles, ownerId, onAssign }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.text);
  const save = () => { if (val.trim() && val !== task.text) onEdit(task.id, val.trim()); setEditing(false); };
  const cs = carryStyle(task);
  const iso = taskDeadline(task, weekOf);
  const overdue = isOverdue(iso, task.done);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: cs ? "5px 8px 5px 6px" : "5px 0", opacity: task.done ? 0.38 : 1, transition: "opacity 0.18s", background: cs && !task.done ? cs.bg : "transparent", borderRadius: cs ? 8 : 0, borderLeft: cs && !task.done ? `3px solid ${cs.border}` : "none", marginBottom: cs ? 2 : 0 }}>
      <DSCheckbox checked={task.done} onChange={() => onToggle(task.id)}/>
      {editing ? (
        <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} style={{ flex: 1, border: `1.5px solid ${C.blue}`, borderRadius: 6, padding: "3px 8px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: C.gray800, outline: "none", boxShadow: `0 0 0 3px rgba(28,43,222,0.10)` }}/>
      ) : (
        <span onClick={() => setEditing(true)} style={{ flex: 1, minWidth: 0, overflowWrap: "break-word", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: C.gray800, lineHeight: 1.45, cursor: "text", textDecoration: task.done ? "line-through" : "none" }}>{task.text}</span>
      )}
      {assignerLabel(task, ownerId, profiles)}
      {cs && !task.done && <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 9, fontWeight: 700, color: cs.labelColor, whiteSpace: "nowrap", letterSpacing: "0.03em" }}>{cs.label}</span>}
      <DeadlineChip iso={iso} overdue={overdue} canEdit onLight onChange={(d) => onDeadline(task.id, d)}/>
      {profiles && <AssigneeSelect profiles={profiles} ownerId={ownerId} onAssign={(to) => onAssign(task.id, to)}/>}
      <button onClick={() => onDelete(task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: C.gray400, fontSize: 14, lineHeight: 1, opacity: 0.5, display: "flex", alignItems: "center" }}>×</button>
    </div>
  );
}

// ── Read-only row for another member's task — only the reassign dropdown is live ──
function ReadOnlyTaskRow({ task, weekOf, profiles, ownerId, onAssign, currentUserId, onDeadline }) {
  const cs = carryStyle(task);
  const iso = taskDeadline(task, weekOf);
  const overdue = isOverdue(iso, task.done);
  // Whoever assigned this task can still adjust its due date.
  const canEditDeadline = !!onDeadline && !!currentUserId && task.assigned_by === currentUserId;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: cs ? "5px 8px 5px 6px" : "5px 0", opacity: task.done ? 0.35 : 1, background: cs && !task.done ? cs.bg : "transparent", borderRadius: cs ? 8 : 0, borderLeft: cs && !task.done ? `3px solid ${cs.border}` : "none", marginBottom: cs ? 2 : 0 }}>
      <DSCheckbox checked={task.done} onChange={() => {}}/>
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "break-word", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: C.gray800, textDecoration: task.done ? "line-through" : "none" }}>{task.text}</span>
      {assignerLabel(task, ownerId, profiles)}
      {cs && !task.done && <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 9, fontWeight: 700, color: cs.labelColor, whiteSpace: "nowrap", letterSpacing: "0.03em" }}>{cs.label}</span>}
      <DeadlineChip iso={iso} overdue={overdue} canEdit={canEditDeadline} onChange={canEditDeadline ? (d) => onDeadline(task.id, d) : undefined} onLight/>
      {profiles && onAssign && <AssigneeSelect profiles={profiles} ownerId={ownerId} onAssign={(to) => onAssign(task.id, to)}/>}
    </div>
  );
}

function LastWeek({ completedLast = [], doneTasks = [], onLight = true }) {
  const [open, setOpen] = useState(false);
  const allItems = [...doneTasks.map(t => ({ text: t.text, source: "task" })), ...completedLast.map(t => ({ text: t, source: "note" }))];
  if (!allItems.length) return null;
  const accent = onLight ? C.blue : "rgba(255,255,255,0.6)";
  const textColor = onLight ? C.gray600 : "rgba(255,255,255,0.5)";
  const borderColor = onLight ? C.gray200 : "rgba(255,255,255,0.12)";
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: `0.5px solid ${borderColor}` }}>
      <button onClick={() => setOpen(!open)} style={{ background: onLight ? C.lavender : "rgba(255,255,255,0.1)", border: `1px solid ${onLight ? C.gray200 : "rgba(255,255,255,0.15)"}`, borderRadius: 8, cursor: "pointer", padding: "7px 12px", width: "100%", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 12, fontWeight: 600, color: onLight ? C.blue : "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", justifyContent: "space-between", letterSpacing: "0.04em" }}>
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

function HeroTaskRow({ task, onToggle, onEdit, onDelete, onDeadline, isCurrentUser, weekOf, profiles, ownerId, onAssign }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.text);
  const save = () => { if (val.trim() && val !== task.text) onEdit(task.id, val.trim()); setEditing(false); };
  const cs = carryStyle(task);
  const iso = taskDeadline(task, weekOf);
  const overdue = isOverdue(iso, task.done);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: cs ? "5px 8px 5px 6px" : "5px 0", opacity: task.done ? 0.35 : 1, transition: "opacity 0.18s", background: cs && !task.done ? (carryCount(task) === 1 ? "rgba(255,181,71,0.15)" : "rgba(255,77,109,0.15)") : "transparent", borderRadius: cs ? 8 : 0, borderLeft: cs && !task.done ? `3px solid ${cs.border}` : "none", marginBottom: cs ? 2 : 0 }}>
      <div onClick={() => onToggle(task.id)} style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, cursor: "pointer", border: task.done ? "none" : "2px solid rgba(255,255,255,0.4)", background: task.done ? "rgba(255,255,255,0.9)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>
        {task.done && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      {editing && isCurrentUser ? (
        <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} style={{ flex: 1, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.5)", borderRadius: 6, padding: "3px 8px", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: "#fff", outline: "none" }}/>
      ) : (
        <span onClick={() => isCurrentUser && setEditing(true)} style={{ flex: 1, minWidth: 0, overflowWrap: "break-word", fontFamily: "'Poppins',Arial,sans-serif", fontSize: 13.5, color: "#fff", lineHeight: 1.45, cursor: isCurrentUser ? "text" : "default", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.5 : 1 }}>{task.text}</span>
      )}
      {assignerLabel(task, ownerId, profiles, true)}
      {cs && !task.done && <span style={{ fontFamily: "'Poppins',Arial,sans-serif", fontSize: 9, fontWeight: 700, color: cs.labelColor, whiteSpace: "nowrap", letterSpacing: "0.03em" }}>{cs.label}</span>}
      <DeadlineChip iso={iso} overdue={overdue} canEdit={isCurrentUser} onChange={(d) => onDeadline(task.id, d)}/>
      {isCurrentUser && profiles && <AssigneeSelect profiles={profiles} ownerId={ownerId} onAssign={(to) => onAssign(task.id, to)} onLight/>}
      {isCurrentUser && <button onClick={() => onDelete(task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", color: "rgba(255,255,255,0.3)", fontSize: 14, lineHeight: 1 }}>×</button>}
    </div>
  );
}

export { assignerLabel, DeadlineChip, AssigneeSelect, TaskRow, ReadOnlyTaskRow, LastWeek, HeroTaskRow };
