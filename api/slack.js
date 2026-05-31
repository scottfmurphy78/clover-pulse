// /api/slack.js — Clover Pulse Slack event handler

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// Deduplication
const processedEvents = new Set();
function isDuplicate(eventId) {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  if (processedEvents.size > 500) processedEvents.delete(processedEvents.values().next().value);
  return false;
}

// Supabase
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

// Slack
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

async function postToChannel(channelId, text) {
  return slackPost("chat.postMessage", { channel: channelId, text });
}

async function getSlackUserEmail(slackUserId) {
  const r = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await r.json();
  if (data.user?.is_bot) return null;
  return data.user?.profile?.email || null;
}

async function downloadSlackFile(url) {
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` } });
  if (!r.ok) throw new Error(`Failed to download file: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
  const boundary = "----WhisperBoundary" + Date.now();
  const beforeFile = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const afterFile = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([beforeFile, audioBuffer, afterFile]);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(body.length) },
    body,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Whisper error: ${JSON.stringify(data)}`);
  console.log("Transcript:", data.text?.substring(0, 150));
  return data.text;
}

async function parseWithClaude(transcript, existingEntry) {
  const system = `Extract weekly work updates from this transcript. Return ONLY a raw JSON object — no markdown, no backticks, no code blocks. Just the JSON.
Schema: {"note":"one sentence max 15 words","tasks":[{"id":"t1","text":"task","done":false,"carried_over":false}],"completed_last":["thing done last week"],"blockers":["blocker"]}
Rules: tasks=this week, completed_last=last week, blockers=blocking items. Short task text. Empty arrays if none.`;

  const userPrompt = existingEntry
    ? `Existing:\n${JSON.stringify(existingEntry)}\n\nNew update (merge):\n${transcript}`
    : transcript;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, system, messages: [{ role: "user", content: userPrompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude error: ${JSON.stringify(data)}`);
  const text = (data.content?.[0]?.text || "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  console.log("Claude response:", text.substring(0, 200));
  return JSON.parse(text);
}

async function savePulseEntry(userId, weekOf, parsed) {
  console.log("Saving for user:", userId, "week:", weekOf, "tasks:", parsed.tasks?.length);
  return sbFetch("pulse_entries", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId, week_of: weekOf,
      note: parsed.note, tasks: parsed.tasks,
      completed_last: parsed.completed_last, blockers: parsed.blockers,
      submitted_at: new Date().toISOString(),
    }),
  });
}

async function notifyAdminsOfBlockers(profile, blockers) {
  const adminEmails = ["scott@rideclover.com", "antonio@rideclover.com"];
  const blockerText = blockers.map(b => `• ${b}`).join("\n");
  for (const email of adminEmails) {
    if (email === profile.email) continue;
    const result = await sbFetch(`profiles?email=eq.${encodeURIComponent(email)}&select=slack_user_id`);
    const admin = Array.isArray(result) ? result[0] : null;
    if (admin?.slack_user_id) {
      const open = await slackPost("conversations.open", { users: admin.slack_user_id });
      if (open.ok) await slackPost("chat.postMessage", { channel: open.channel.id, text: `⚠️ *${profile.name}* has a blocker:\n${blockerText}\n\nhttps://clover-pulse.vercel.app` });
    }
  }
}

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d); mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    console.log("SLACK IN:", typeof req.body, JSON.stringify(req.body)?.substring(0, 100));

    const body = req.body;
    if (!body) { console.error("No body"); return res.status(200).send("ok"); }

    if (body.type === "url_verification") {
      console.log("URL verification");
      return res.status(200).json({ challenge: body.challenge });
    }

    if (body.type !== "event_callback") return res.status(200).send("ok");

    if (isDuplicate(body.event_id)) {
      console.log("Duplicate:", body.event_id);
      return res.status(200).send("ok");
    }

    const event = body.event;
    console.log("Event:", event.type, event.subtype, event.channel_type, "bot_id:", event.bot_id, "user:", event.user);

    if (event.bot_id)                        return res.status(200).send("ok");
    if (event.type === "file_shared")        return res.status(200).send("ok");
    if (event.type !== "message")            return res.status(200).send("ok");
    if (event.subtype === "bot_message")     return res.status(200).send("ok");
    if (event.subtype === "message_changed") return res.status(200).send("ok");
    if (!event.user)                         return res.status(200).send("ok");
    if (event.channel_type !== "im")         return res.status(200).send("ok");

    console.log("Processing from:", event.user, "channel:", event.channel);

    // Profile lookup
    let profileResult = await sbFetch(`profiles?slack_user_id=eq.${event.user}&select=*`);
    let profile = Array.isArray(profileResult) ? profileResult[0] : null;
    console.log("Profile by slack_id:", profile?.name || "not found");

    if (!profile) {
      const email = await getSlackUserEmail(event.user);
      console.log("Slack email:", email);
      if (email) {
        const normalized = email.toLowerCase().replace("@clovertronix.com", "@rideclover.com");
        // Try both email variants
        let byEmail = await sbFetch(`profiles?email=eq.${encodeURIComponent(normalized)}&select=*`);
        if (!Array.isArray(byEmail) || !byEmail[0]) {
          byEmail = await sbFetch(`profiles?email=eq.${encodeURIComponent(email.toLowerCase())}&select=*`);
        }
        profile = Array.isArray(byEmail) ? byEmail[0] : null;
        console.log("Profile by email:", profile?.name || "not found");
        if (profile) {
          await sbFetch(`profiles?user_id=eq.${profile.user_id}`, { method: "PATCH", body: JSON.stringify({ slack_user_id: event.user }) });
        }
      }
    }

    if (!profile) {
      console.log("No profile — sending signup message");
      await postToChannel(event.channel, "👋 I don't recognise your account yet. Sign in at https://clover-pulse.vercel.app with your @rideclover.com Google account to get set up.");
      return res.status(200).send("ok");
    }

    console.log("Profile:", profile.name, profile.email, profile.user_id);
    const firstName = profile.name?.split(" ")[0] || "there";
    let transcript = null;

    if (event.files?.length) {
      const file = event.files[0];
      console.log("File:", file.mimetype, file.filetype);
      const isAudio = file.mimetype?.startsWith("audio/") || file.filetype === "mp4";
      if (isAudio && file.url_private) {
        await postToChannel(event.channel, `Got your voice note ${firstName}, transcribing now... 🎙️`);
        const buf = await downloadSlackFile(file.url_private);
        transcript = await transcribeAudio(buf, file.mimetype || "audio/mp4");
      }
    }

    if (!transcript && event.text?.trim().length > 10) {
      transcript = event.text.trim();
      console.log("Text:", transcript.substring(0, 100));
    }

    if (!transcript) {
      await postToChannel(event.channel, "Send me a voice note or text message with your weekly update. 🎙️");
      return res.status(200).send("ok");
    }

    const weekOf = currentWeekOf();
    const existingRaw = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${weekOf}&select=*`);
    const existingEntry = Array.isArray(existingRaw) ? existingRaw[0] : null;
    console.log("Existing entry:", existingEntry ? "yes" : "no");

    const parsed = await parseWithClaude(transcript, existingEntry);
    const saved = await savePulseEntry(profile.user_id, weekOf, parsed);
    console.log("Saved:", JSON.stringify(saved)?.substring(0, 150));

    if (parsed.blockers?.length) await notifyAdminsOfBlockers(profile, parsed.blockers);

    const taskCount = parsed.tasks?.length || 0;
    const blockerCount = parsed.blockers?.length || 0;
    const blockerNote = blockerCount > 0 ? `\n⚠️ I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""} to the team.` : "";
    await postToChannel(event.channel, `✅ Got it ${firstName}. *${taskCount} task${taskCount !== 1 ? "s" : ""}* logged for the week.${blockerNote}\n\nView the dashboard: https://clover-pulse.vercel.app`);
    console.log("=== DONE ===");

  } catch (err) {
    console.error("ERROR:", err.message, err.stack?.substring(0, 300));
    try { await postToChannel(req.body?.event?.channel, "Something went wrong. Try again in a moment."); } catch {}
  }

  return res.status(200).send("ok");
}
