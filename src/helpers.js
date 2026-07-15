import { useState, useEffect } from "react";

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
// ── Deadline helpers ──────────────────────────────────────────────────
// Weeks run Mon–Sun; week_of is the Monday, so "end of week" = that Sunday.
function endOfWeek(weekOf) {
  const d = new Date(weekOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}
function taskDeadline(task, weekOf) { return task.deadline || endOfWeek(weekOf); }
function formatDeadline(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function todayISO() { return new Date().toISOString().split("T")[0]; }
function isOverdue(iso, done) { return !done && iso < todayISO(); }
function useIsMobile() {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  useEffect(() => { const fn = () => setM(window.innerWidth < 768); window.addEventListener("resize", fn); return () => window.removeEventListener("resize", fn); }, []);
  return m;
}
function getInitials(name) { return (name||"?").split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase(); }

// ── ADMIN EMAILS ──────────────────────────────────────────────────────
const ADMIN_EMAILS = ["scott@rideclover.com","antonio@rideclover.com"];

function carryCount(task) {
  if (!task.carried_over) return 0;
  const matches = (task.id || "").match(/^(co_)+/);
  if (!matches) return 1;
  return matches[0].length / 3;
}

function carryStyle(task) {
  const count = carryCount(task);
  if (count === 0) return null;
  if (count === 1) return { bg: "rgba(255,181,71,0.10)", border: "#FFB547", label: "↩ last week", labelColor: "#B76E00" };
  return { bg: "rgba(255,77,109,0.08)", border: "#FF4D6D", label: `↩ ${count}+ weeks`, labelColor: "#C00030" };
}

// Blockers may be a plain string (legacy) or { text, resolved }. Normalize on read.
function blockerText(b) { return b && typeof b === "object" ? b.text : b; }
function blockerResolved(b) { return b && typeof b === "object" ? !!b.resolved : false; }

export { currentWeekOf, formatWeekLabel, endOfWeek, taskDeadline, formatDeadline, todayISO, isOverdue, useIsMobile, getInitials, ADMIN_EMAILS, carryCount, carryStyle, blockerText, blockerResolved };
