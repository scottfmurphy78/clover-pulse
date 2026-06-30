// ─────────────────────────────────────────────────────────────────────
// /api/assign — move a task to another member, or create one on their card
//
// Cross-user writes go through the service key here (same trust model as the
// Slack/WhatsApp bots) so the dashboard never has to write another user's row
// directly and we don't depend on row-level-security policy details.
//
// Body: {
//   token:      <caller's Supabase access token>   (required — identifies the assigner)
//   toUserId:   <user_id to assign to>             (required)
//   weekOf:     <YYYY-MM-DD Monday>                (required)
//   taskId:     <id>          ─┐ reassign an existing task
//   fromUserId: <user_id>     ─┘ (its current owner)
//   newTask:    { id, text, done, deadline }        create-and-assign (no taskId/fromUserId)
// }
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
      ...(options.headers || {}),
    },
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) console.error("SB error:", r.status, JSON.stringify(data).substring(0, 200));
  return data;
}

// Verify the caller's access token and return their { user_id, email }.
async function getCaller(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u?.id || !u?.email) return null;
  return { user_id: u.id, email: u.email };
}

// week_of is the Monday; "end of week" = that Sunday.
function endOfWeek(weekOf) {
  const d = new Date(weekOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}

async function getEntry(userId, weekOf) {
  const rows = await sbFetch(`pulse_entries?user_id=eq.${userId}&week_of=eq.${weekOf}&select=*`);
  return Array.isArray(rows) ? rows[0] : null;
}

// Add a task to a member's weekly entry, creating the entry if needed.
async function addTaskToEntry(userId, weekOf, task) {
  const entry = await getEntry(userId, weekOf);
  if (entry) {
    const existing = entry.tasks || [];
    if (existing.some(t => t.id === task.id)) return entry; // already there — no dupe
    return sbFetch(`pulse_entries?user_id=eq.${userId}&week_of=eq.${weekOf}`, {
      method: "PATCH",
      body: JSON.stringify({ tasks: [...existing, task] }),
    });
  }
  return sbFetch("pulse_entries", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId, week_of: weekOf,
      note: null, tasks: [task], completed_last: [], blockers: [], submitted_at: null,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { token, toUserId, weekOf, taskId, fromUserId, newTask } = body;

    if (!token) return res.status(401).json({ error: "Missing token" });
    if (!toUserId || !weekOf) return res.status(400).json({ error: "Missing toUserId or weekOf" });

    const caller = await getCaller(token);
    if (!caller) return res.status(401).json({ error: "Invalid token" });
    if (!caller.email.endsWith("@rideclover.com")) return res.status(403).json({ error: "Forbidden" });

    // Target must be a real team member.
    const targetRows = await sbFetch(`profiles?user_id=eq.${toUserId}&select=user_id`);
    if (!Array.isArray(targetRows) || !targetRows[0]) return res.status(404).json({ error: "Unknown assignee" });

    // ── Create-and-assign ──────────────────────────────────────────────
    if (newTask && !taskId) {
      const task = {
        id: newTask.id || `a${Date.now()}`,
        text: String(newTask.text || "").trim(),
        done: !!newTask.done,
        deadline: newTask.deadline || endOfWeek(weekOf),
        assigned_by: caller.user_id,
      };
      if (!task.text) return res.status(400).json({ error: "Empty task" });
      await addTaskToEntry(toUserId, weekOf, task);
      return res.status(200).json({ ok: true, action: "created" });
    }

    // ── Reassign an existing task ──────────────────────────────────────
    if (!taskId || !fromUserId) return res.status(400).json({ error: "Missing taskId or fromUserId" });
    if (fromUserId === toUserId) return res.status(200).json({ ok: true, action: "noop" });

    const source = await getEntry(fromUserId, weekOf);
    const task = (source?.tasks || []).find(t => t.id === taskId);
    if (!task) return res.status(200).json({ ok: true, action: "already-moved" }); // nothing to move

    // Remove from source.
    await sbFetch(`pulse_entries?user_id=eq.${fromUserId}&week_of=eq.${weekOf}`, {
      method: "PATCH",
      body: JSON.stringify({ tasks: (source.tasks || []).filter(t => t.id !== taskId) }),
    });

    // Add to target, tagged with who assigned it.
    const moved = {
      ...task,
      deadline: task.deadline || endOfWeek(weekOf),
      assigned_by: caller.user_id,
    };
    await addTaskToEntry(toUserId, weekOf, moved);

    return res.status(200).json({ ok: true, action: "moved" });
  } catch (err) {
    console.error("Assign error:", err.message, err.stack?.substring(0, 300));
    return res.status(500).json({ error: err.message });
  }
}
