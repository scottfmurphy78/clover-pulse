// ─────────────────────────────────────────────────────────────────────
// Vercel cron function — /api/cron
// Runs on schedule:
//   Sunday 19:00 CET  — reminder to submit before Monday standup
//   Monday 08:30 CET  — second reminder for non-submitters
//   Monday 09:15 CET  — weekly digest posted to #pulse channel
//   Monday 07:00 CET  — carryover incomplete tasks from last week
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_PULSE_CHANNEL = process.env.SLACK_PULSE_CHANNEL; // e.g. C0XXXXXXX
const CRON_SECRET = process.env.CRON_SECRET;

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
  return r.json();
}

async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sendDM(slackUserId, text) {
  const open = await slackPost("conversations.open", { users: slackUserId });
  if (!open.ok) return;
  return slackPost("chat.postMessage", { channel: open.channel.id, text });
}

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d); mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

function lastWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
  const mon = new Date(d); mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

// ── Carryover incomplete tasks from last week ─────────────────────────
async function runCarryover() {
  const profiles = await sbFetch("profiles?select=*");
  if (!Array.isArray(profiles)) return;

  const lastWeek = lastWeekOf();
  const thisWeek = currentWeekOf();

  for (const profile of profiles) {
    try {
      // Get last week's entry
      const lastEntries = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${lastWeek}&select=*`);
      const lastEntry = Array.isArray(lastEntries) ? lastEntries[0] : null;
      if (!lastEntry) continue;

      // Find incomplete tasks
      const incomplete = (lastEntry.tasks || []).filter(t => !t.done);
      if (!incomplete.length) continue;

      // Check if this week's entry already exists
      const thisEntries = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${thisWeek}&select=*`);
      const thisEntry = Array.isArray(thisEntries) ? thisEntries[0] : null;

      // Mark carried-over tasks
      const carriedTasks = incomplete.map(t => ({
        ...t,
        id: `co_${t.id}`,
        done: false,
        carried_over: true,
      }));

      if (thisEntry) {
        // Merge — add carried tasks that aren't already present
        const existingTexts = (thisEntry.tasks || []).map(t => t.text.toLowerCase());
        const newCarried = carriedTasks.filter(t => !existingTexts.includes(t.text.toLowerCase()));
        if (!newCarried.length) continue;
        const merged = [...newCarried, ...(thisEntry.tasks || [])];
        await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${thisWeek}`, {
          method: "PATCH",
          body: JSON.stringify({ tasks: merged }),
        });
      } else {
        // Create new entry with carried tasks only
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
      }
    } catch (err) {
      console.error(`Carryover error for ${profile.user_id}:`, err);
    }
  }
  console.log("Carryover complete");
}

// ── Sunday evening reminder ───────────────────────────────────────────
async function runSundayReminder() {
  const profiles = await sbFetch("profiles?select=*&not=slack_user_id.is.null");
  if (!Array.isArray(profiles)) return;

  for (const profile of profiles) {
    if (!profile.slack_user_id) continue;
    try {
      await sendDM(profile.slack_user_id,
        `👋 Hey ${profile.name?.split(" ")[0] || "there"} — standup is tomorrow at 9:30am. Send me a voice note or message whenever you're ready with your update for the week. 🎙️\n\nThe earlier the better so the team can review the dashboard before the meeting.`
      );
    } catch (err) {
      console.error(`Sunday reminder error for ${profile.user_id}:`, err);
    }
  }
  console.log("Sunday reminders sent");
}

// ── Monday morning reminder for non-submitters ────────────────────────
async function runMondayReminder() {
  const profiles = await sbFetch("profiles?select=*");
  if (!Array.isArray(profiles)) return;

  const weekOf = currentWeekOf();
  const entries = await sbFetch(`pulse_entries?week_of=eq.${weekOf}&select=user_id,submitted_at`);
  const submittedIds = new Set(
    (Array.isArray(entries) ? entries : [])
      .filter(e => e.submitted_at)
      .map(e => e.user_id)
  );

  for (const profile of profiles) {
    if (!profile.slack_user_id) continue;
    if (submittedIds.has(profile.user_id)) continue;
    try {
      await sendDM(profile.slack_user_id,
        `⏰ Standup is in an hour! Send me your voice note now so the team is ready. 🎙️\n\nJust talk naturally — what you're working on this week, what you finished last week, and any blockers.`
      );
    } catch (err) {
      console.error(`Monday reminder error for ${profile.user_id}:`, err);
    }
  }
  console.log("Monday reminders sent");
}

// ── Monday digest ─────────────────────────────────────────────────────
async function runMondayDigest() {
  if (!SLACK_PULSE_CHANNEL) { console.log("No SLACK_PULSE_CHANNEL set, skipping digest"); return; }

  const weekOf = currentWeekOf();
  const profiles = await sbFetch("profiles?select=*");
  const entries = await sbFetch(`pulse_entries?week_of=eq.${weekOf}&select=*`);

  if (!Array.isArray(profiles) || !Array.isArray(entries)) return;

  const profileMap = Object.fromEntries(profiles.map(p => [p.user_id, p]));
  const submittedEntries = entries.filter(e => e.submitted_at);

  if (!submittedEntries.length) {
    await slackPost("chat.postMessage", {
      channel: SLACK_PULSE_CHANNEL,
      text: `📋 *Week of ${formatDate(weekOf)}* — no updates submitted yet. Standup in 15 minutes!`,
    });
    return;
  }

  // Build digest with Claude
  const teamSummary = submittedEntries.map(e => {
    const p = profileMap[e.user_id];
    return `${p?.name || "Unknown"} (${p?.role || ""}):
Note: ${e.note || "None"}
Tasks: ${(e.tasks || []).map(t => t.text).join(", ")}
Blockers: ${(e.blockers || []).join(", ") || "None"}`;
  }).join("\n\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `Write a concise team standup digest for Clover (a Valencia-based e-bike subscription startup) based on these weekly updates. Max 120 words. Bold the key themes. Flag any blockers. End with one sentence about what a great week looks like for the team.\n\n${teamSummary}`,
      }],
    }),
  });
  const data = await r.json();
  const digest = data.content?.[0]?.text || "Team updates are in — check the dashboard.";

  const notSubmitted = profiles.filter(p => !submittedEntries.find(e => e.user_id === p.user_id));
  const missingNote = notSubmitted.length
    ? `\n\n_Still waiting on: ${notSubmitted.map(p => p.name?.split(" ")[0]).join(", ")}_`
    : "";

  await slackPost("chat.postMessage", {
    channel: SLACK_PULSE_CHANNEL,
    text: `📋 *Week of ${formatDate(weekOf)} — Team Pulse*\n\n${digest}${missingNote}\n\n👉 Full dashboard: https://clover-pulse.vercel.app`,
  });

  console.log("Monday digest posted");
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Verify cron secret to prevent unauthorized triggers
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (secret !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const job = req.query.job;

  try {
    switch (job) {
      case "carryover":      await runCarryover(); break;
      case "sunday-reminder": await runSundayReminder(); break;
      case "monday-reminder": await runMondayReminder(); break;
      case "monday-digest":  await runMondayDigest(); break;
      default: return res.status(400).json({ error: "Unknown job" });
    }
    res.status(200).json({ ok: true, job });
  } catch (err) {
    console.error("Cron error:", err);
    res.status(500).json({ error: err.message });
  }
}
