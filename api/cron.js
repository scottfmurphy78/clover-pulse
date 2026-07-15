// ─────────────────────────────────────────────────────────────────────
// /api/cron — Clover Pulse scheduled jobs
//
// Schedule (all CET = UTC+1, so subtract 1 for UTC):
//   Sunday  18:00 UTC (19:00 CET)  — sunday-reminder
//   Monday  06:00 UTC (07:00 CET)  — carryover
//   Monday  07:30 UTC (08:30 CET)  — monday-reminder
//   Monday  08:15 UTC (09:15 CET)  — monday-digest
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_PULSE_CHANNEL = process.env.SLACK_PULSE_CHANNEL;
const CRON_SECRET = process.env.CRON_SECRET;

// ── Supabase ──────────────────────────────────────────────────────────
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
  const data = await r.json();
  if (!r.ok) console.error("SB error:", r.status, JSON.stringify(data).substring(0, 200));
  return data;
}

// ── Slack ─────────────────────────────────────────────────────────────
async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) console.error("Slack error:", method, data.error);
  return data;
}

async function sendDM(slackUserId, text) {
  const open = await slackPost("conversations.open", { users: slackUserId });
  if (!open.ok) { console.error("Failed to open DM:", open.error); return; }
  return slackPost("chat.postMessage", { channel: open.channel.id, text });
}

// ── Date helpers ──────────────────────────────────────────────────────
function weekOf(offsetWeeks = 0) {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offsetWeeks * 7;
  const mon = new Date(d); mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

// week_of is the Monday; "end of week" = that Sunday.
function endOfWeek(weekOf) {
  const d = new Date(weekOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}

// Blockers may be a plain string (legacy) or { text, resolved }. Normalize on read.
function blockerText(b) { return b && typeof b === "object" ? b.text : b; }
function blockerResolved(b) { return b && typeof b === "object" ? !!b.resolved : false; }

// ── JOB 1: Carryover incomplete tasks from last week ──────────────────
async function runCarryover() {
  console.log("Running carryover...");
  const profiles = await sbFetch("profiles?select=*");
  if (!Array.isArray(profiles)) return;

  const thisWeek = weekOf(0);
  const lastWeek = weekOf(-1);

  for (const profile of profiles) {
    try {
      const lastEntries = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${lastWeek}&select=*`);
      const lastEntry = Array.isArray(lastEntries) ? lastEntries[0] : null;
      if (!lastEntry) continue;

      const incomplete = (lastEntry.tasks || []).filter(t => !t.done);
      if (!incomplete.length) continue;

      const carriedTasks = incomplete.map(t => ({
        ...t,
        id: `co_${t.id}_${Date.now()}`,
        done: false,
        carried_over: true,
        deadline: endOfWeek(thisWeek),
      }));

      const thisEntries = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${thisWeek}&select=*`);
      const thisEntry = Array.isArray(thisEntries) ? thisEntries[0] : null;

      if (thisEntry) {
        const existingTexts = (thisEntry.tasks || []).map(t => t.text.toLowerCase());
        const newCarried = carriedTasks.filter(t => !existingTexts.includes(t.text.toLowerCase()));
        if (!newCarried.length) continue;
        const merged = [...newCarried, ...(thisEntry.tasks || [])];
        await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${thisWeek}`, {
          method: "PATCH",
          body: JSON.stringify({ tasks: merged }),
        });
        console.log(`Carried ${newCarried.length} tasks for ${profile.name}`);
      } else {
        await sbFetch("pulse_entries", {
          method: "POST",
          body: JSON.stringify({
            user_id: profile.user_id,
            week_of: thisWeek,
            note: null,
            tasks: carriedTasks,
            completed_last: [],
            blockers: [],
            submitted_at: null,
          }),
        });
        console.log(`Created entry with ${carriedTasks.length} carried tasks for ${profile.name}`);
      }

      // Notify user via Slack
      if (profile.slack_user_id) {
        await sendDM(profile.slack_user_id,
          `📋 You had *${incomplete.length} incomplete task${incomplete.length > 1 ? "s" : ""}* from last week — I've carried them over to this week:\n${incomplete.map(t => `• ${t.text}`).join("\n")}\n\nSend me your voice note when you're ready with this week's update.`
        );
      }
    } catch (err) {
      console.error(`Carryover error for ${profile.name}:`, err.message);
    }
  }
  console.log("Carryover complete");
}

// ── JOB 2: Sunday evening reminder ───────────────────────────────────
async function runSundayReminder() {
  console.log("Running Sunday reminder...");
  const profiles = await sbFetch("profiles?select=*");
  if (!Array.isArray(profiles)) return;

  for (const profile of profiles) {
    if (!profile.slack_user_id) continue;
    try {
      await sendDM(profile.slack_user_id,
        `👋 Hey ${profile.name?.split(" ")[0] || "there"} — standup is tomorrow at 9:30am.\n\nSend me a voice note whenever you're ready with your update for the week. The earlier the better so the team can review the dashboard before the meeting. 🎙️\n\nView the dashboard: https://pulse.clover.tools`
      );
    } catch (err) {
      console.error(`Sunday reminder error for ${profile.name}:`, err.message);
    }
  }
  console.log("Sunday reminders sent");
}

// ── JOB 3: Monday morning reminder for non-submitters ─────────────────
async function runMondayReminder() {
  console.log("Running Monday reminder...");
  const profiles = await sbFetch("profiles?select=*");
  if (!Array.isArray(profiles)) return;

  const thisWeek = weekOf(0);
  const entries = await sbFetch(`pulse_entries?week_of=eq.${thisWeek}&select=user_id,submitted_at`);
  const submittedIds = new Set(
    (Array.isArray(entries) ? entries : [])
      .filter(e => e.submitted_at)
      .map(e => e.user_id)
  );

  let reminded = 0;
  for (const profile of profiles) {
    if (!profile.slack_user_id) continue;
    if (submittedIds.has(profile.user_id)) continue;
    try {
      await sendDM(profile.slack_user_id,
        `⏰ Standup is in an hour! Send me your voice note now so the team is ready. 🎙️\n\nJust talk naturally:\n• What you're working on this week\n• What you finished last week\n• Any blockers`
      );
      reminded++;
    } catch (err) {
      console.error(`Monday reminder error for ${profile.name}:`, err.message);
    }
  }
  console.log(`Monday reminders sent to ${reminded} people`);
}

// ── JOB 4: Monday digest posted to #pulse ────────────────────────────
async function runMondayDigest() {
  console.log("Running Monday digest...");
  if (!SLACK_PULSE_CHANNEL) { console.log("No SLACK_PULSE_CHANNEL set"); return; }

  const thisWeek = weekOf(0);
  const profiles = await sbFetch("profiles?select=*");
  const entries = await sbFetch(`pulse_entries?week_of=eq.${thisWeek}&select=*`);

  if (!Array.isArray(profiles) || !Array.isArray(entries)) return;

  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));
  const submittedEntries = entries.filter(e => e.submitted_at);
  const notSubmitted = profiles.filter(p => !submittedEntries.find(e => e.user_id === p.user_id));

  if (!submittedEntries.length) {
    await slackPost("chat.postMessage", {
      channel: SLACK_PULSE_CHANNEL,
      text: `📋 *Week of ${formatDate(thisWeek)}* — no updates submitted yet. Standup in 15 minutes!\n\n👉 https://pulse.clover.tools`,
    });
    return;
  }

  // Build summary for Claude
  const teamSummary = submittedEntries.map(e => {
    const p = profileMap[e.user_id];
    const activeTasks = (e.tasks || []).filter(t => !t.done);
    const activeBlockers = (e.blockers || []).filter(b => !blockerResolved(b));
    return `${p?.name || "Unknown"} (${p?.role || ""}):
Note: ${e.note || "None"}
Tasks this week: ${activeTasks.map(t => t.text).join(", ") || "None"}
Blockers: ${activeBlockers.map(blockerText).join(", ") || "None"}`;
  }).join("\n\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Write a concise team standup digest for Clover (a Valencia e-bike subscription startup) based on these weekly updates. Max 100 words. Use bold for key themes. Flag any active blockers. End with one punchy sentence about the week's focus.\n\n${teamSummary}`,
      }],
    }),
  });
  const data = await r.json();
  const digest = data.content?.[0]?.text || "Team updates are in — check the dashboard.";

  const missingNote = notSubmitted.length
    ? `\n\n_Still waiting on: ${notSubmitted.map(p => p.name?.split(" ")[0]).join(", ")}_`
    : "";

  // Build per-person summary blocks
  const blocks = submittedEntries.map(e => {
    const p = profileMap[e.user_id];
    const activeTasks = (e.tasks || []).filter(t => !t.done);
    const activeBlockers = (e.blockers || []).filter(b => !blockerResolved(b));
    const blockerSuffix = activeBlockers.length ? `\n⚠️ ${activeBlockers.map(blockerText).join(", ")}` : "";
    return `*${p?.name?.split(" ")[0] || "?"}* — ${e.note || "No note"}${blockerSuffix}\n${activeTasks.slice(0, 3).map(t => `› ${t.text}`).join("\n")}${activeTasks.length > 3 ? `\n› +${activeTasks.length - 3} more` : ""}`;
  }).join("\n\n");

  await slackPost("chat.postMessage", {
    channel: SLACK_PULSE_CHANNEL,
    text: `📋 *Week of ${formatDate(thisWeek)} — Team Pulse*\n\n${digest}${missingNote}\n\n${blocks}\n\n👉 Full dashboard: https://pulse.clover.tools`,
  });

  console.log("Monday digest posted");
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Vercel auto-injects `Authorization: Bearer <CRON_SECRET>` on scheduled runs.
  // Legacy header/query secret kept as a fallback for manual invocation.
  const authHeader = req.headers["authorization"] || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const secret = bearer || req.headers["x-cron-secret"] || req.query.secret;
  if (!CRON_SECRET || secret !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const job = req.query.job;
  console.log(`Running cron job: ${job}`);

  try {
    switch (job) {
      case "carryover":        await runCarryover(); break;
      case "sunday-reminder":  await runSundayReminder(); break;
      case "monday-reminder":  await runMondayReminder(); break;
      case "monday-digest":    await runMondayDigest(); break;
      default: return res.status(400).json({ error: `Unknown job: ${job}` });
    }
    res.status(200).json({ ok: true, job });
  } catch (err) {
    console.error(`Cron error (${job}):`, err.message, err.stack?.substring(0, 300));
    res.status(500).json({ error: err.message });
  }
}
