// /api/slack.js — Clover Pulse Slack event handler

import crypto from "crypto";

// Raw body is required to verify Slack's request signature, so disable parsing.
export const config = {
  api: {
    bodyParser: false,
  },
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// ── Request authenticity ──────────────────────────────────────────────
// bodyParser is disabled (above) so we can hash the exact bytes Slack sent.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// Slack signs each request: v0=HMAC_SHA256(signing_secret, `v0:${ts}:${rawBody}`).
function verifySlackSignature(rawBody, timestamp, signature) {
  if (!SLACK_SIGNING_SECRET || !timestamp || !signature) return false;
  // Replay protection: reject anything older than 5 minutes.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const expected = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody.toString("utf8")}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

async function sendDM(slackUserId, text) {
  const open = await slackPost("conversations.open", { users: slackUserId });
  if (!open.ok) { console.error("Failed to open DM:", open.error); return; }
  return slackPost("chat.postMessage", { channel: open.channel.id, text });
}

// One DM summarising the new task(s) someone was just assigned.
function assignmentMessage(assignerName, tasks) {
  const list = tasks.map(t => {
    const due = t.deadline ? new Date(t.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
    return `• ${t.text}${due ? `  _(due ${due})_` : ""}`;
  }).join("\n");
  const n = tasks.length;
  return `📋 *${assignerName || "Someone"}* assigned you ${n} task${n !== 1 ? "s" : ""} on Clover Pulse:\n${list}\n\nhttps://pulse.clover.tools`;
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

async function transcribeAudio(audioBuffer, mimeType = "audio/webm", fileType = "") {
  // Map Slack file types to Whisper-supported formats
  let ext = "webm";
  if (fileType === "m4a" || mimeType.includes("m4a") || mimeType.includes("mp4") || mimeType.includes("aac")) ext = "m4a";
  else if (fileType === "mp3" || mimeType.includes("mpeg")) ext = "mp3";
  else if (fileType === "wav" || mimeType.includes("wav")) ext = "wav";
  else if (fileType === "ogg" || mimeType.includes("ogg")) ext = "ogg";
  else if (fileType === "webm" || mimeType.includes("webm")) ext = "webm";
  
  // Slack voice notes are often webm — convert mime type accordingly
  const whisperMime = ext === "m4a" ? "audio/mp4" : 
                      ext === "mp3" ? "audio/mpeg" :
                      ext === "wav" ? "audio/wav" :
                      ext === "ogg" ? "audio/ogg" : "audio/webm";

  console.log("Transcribing:", ext, whisperMime, "size:", audioBuffer.length);
  const boundary = "----WhisperBoundary" + Date.now();
  const beforeFile = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${whisperMime}\r\n\r\n`);
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

async function parseWithClaude(transcript, existingEntry, roster = [], speakerName = "") {
  const names = roster.map(p => (p.name || "").split(" ")[0]).filter(Boolean).join(", ");
  // Give Claude a concrete date reference so relative phrases ("by Friday") resolve
  // to real, non-past ISO dates instead of hallucinated ones.
  const today = new Date().toISOString().split("T")[0];
  const weekday = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const monday = currentWeekOf();
  const sunday = endOfWeek(monday);
  const system = `Extract weekly work updates from this transcript. Return ONLY a raw JSON object — no markdown, no backticks, no code blocks. Just the JSON.
Schema: {"note":"one sentence max 15 words","tasks":[{"id":"t1","text":"task","done":false,"carried_over":false,"assignee":null,"deadline":null}],"completed_last":["thing done last week"],"blockers":["blocker"]}
Rules:
- tasks = things to do THIS week. completed_last = done last week. blockers = blocking items. Short task text. Empty arrays if none.
- The speaker is ${speakerName || "the sender"}. Team members: ${names || "none"}.
- assignee: if the speaker assigns a task to a teammate by name (e.g. "assign Antonio to fix the website"), set assignee to that teammate's first name exactly as listed above. For the speaker's own tasks, set assignee to null.
- Today is ${today} (${weekday}). This week runs Monday ${monday} to Sunday ${sunday}.
- deadline: resolve any stated weekday or relative phrase ("by Friday", "next Wednesday", "end of week") to an ISO date "YYYY-MM-DD" that is today (${today}) or later — never earlier than ${monday}. If no due date is stated, use null.`;

  const userPrompt = existingEntry
    ? `Existing:\n${JSON.stringify(existingEntry)}\n\nNew update (merge):\n${transcript}`
    : transcript;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages: [{ role: "user", content: userPrompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude error: ${JSON.stringify(data)}`);
  const text = (data.content?.[0]?.text || "{}").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  console.log("Claude response:", text.substring(0, 200));
  return JSON.parse(text);
}

async function savePulseEntry(userId, weekOf, parsed, existingEntry) {
  console.log("Saving for user:", userId, "week:", weekOf, "tasks:", parsed.tasks?.length, "existing:", !!existingEntry);
  const payload = {
    user_id: userId, week_of: weekOf,
    note: parsed.note, tasks: parsed.tasks,
    completed_last: parsed.completed_last, blockers: parsed.blockers,
    submitted_at: new Date().toISOString(),
  };
  if (existingEntry) {
    return sbFetch(`pulse_entries?user_id=eq.${userId}&week_of=eq.${weekOf}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }
  return sbFetch("pulse_entries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// week_of is the Monday; "end of week" = that Sunday.
function endOfWeek(weekOf) {
  const d = new Date(weekOf + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}

// Append a task to a teammate's weekly entry, creating the entry if needed.
async function addAssignedTask(userId, weekOf, task) {
  const rows = await sbFetch(`pulse_entries?user_id=eq.${userId}&week_of=eq.${weekOf}&select=*`);
  const entry = Array.isArray(rows) ? rows[0] : null;
  if (entry) {
    const existing = entry.tasks || [];
    if (existing.some(t => t.id === task.id)) return;
    return sbFetch(`pulse_entries?user_id=eq.${userId}&week_of=eq.${weekOf}`, {
      method: "PATCH", body: JSON.stringify({ tasks: [...existing, task] }),
    });
  }
  return sbFetch("pulse_entries", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, week_of: weekOf, note: null, tasks: [task], completed_last: [], blockers: [], submitted_at: null }),
  });
}

// Split parsed tasks into the speaker's own vs ones assigned to teammates.
// Matches assignee on first name; unknown/ambiguous names stay with the speaker.
function distributeTasks(tasks, roster, speaker, weekOf) {
  const byFirst = {};
  for (const p of roster) {
    const fn = (p.name || "").split(" ")[0].toLowerCase();
    if (fn) (byFirst[fn] = byFirst[fn] || []).push(p);
  }
  const speakerFirst = (speaker.name || "").split(" ")[0].toLowerCase();
  const ownTasks = [], assigned = [], unmatched = [];
  tasks.forEach((t, i) => {
    const task = { ...t };
    const who = (task.assignee || "").trim().toLowerCase();
    delete task.assignee;
    // Only trust a well-formed date that isn't before this week; otherwise default
    // to end of week so nothing lands pre-flagged as overdue.
    const validDeadline = /^\d{4}-\d{2}-\d{2}$/.test(task.deadline || "") && task.deadline >= weekOf;
    if (!validDeadline) task.deadline = endOfWeek(weekOf);
    const matches = byFirst[who];
    if (!who || who === speakerFirst) {
      ownTasks.push(task);
    } else if (matches && matches.length === 1 && matches[0].user_id !== speaker.user_id) {
      assigned.push({ target: matches[0], task: { ...task, id: `a${Date.now()}_${i}`, done: false, assigned_by: speaker.user_id } });
    } else {
      unmatched.push(t.assignee);
      ownTasks.push(task);
    }
  });
  return { ownTasks, assigned, unmatched };
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
      if (open.ok) await slackPost("chat.postMessage", { channel: open.channel.id, text: `⚠️ *${profile.name}* has a blocker:\n${blockerText}\n\nhttps://pulse.clover.tools` });
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

  let body = null;
  try {
    const rawBody = await readRawBody(req);
    const timestamp = req.headers["x-slack-request-timestamp"];
    const signature = req.headers["x-slack-signature"];
    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      console.error("Slack signature verification failed");
      return res.status(401).send("invalid signature");
    }

    body = JSON.parse(rawBody.toString("utf8") || "{}");
    console.log("SLACK IN:", typeof body, JSON.stringify(body)?.substring(0, 100));
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
      await postToChannel(event.channel, "👋 I don't recognise your account yet. Sign in at https://pulse.clover.tools with your @rideclover.com Google account to get set up.");
      return res.status(200).send("ok");
    }

    console.log("Profile:", profile.name, profile.email, profile.user_id);
    const firstName = profile.name?.split(" ")[0] || "there";
    let transcript = null;

    if (event.files?.length) {
      const file = event.files[0];
      console.log("File:", file.mimetype, file.filetype);
      const isAudio = file.mimetype?.startsWith("audio/") || file.filetype === "mp4" || file.filetype === "m4a" || file.filetype === "webm";
      if (isAudio && file.url_private) {
        await postToChannel(event.channel, `Got your voice note ${firstName}, transcribing now... 🎙️`);
        const buf = await downloadSlackFile(file.url_private);
        transcript = await transcribeAudio(buf, file.mimetype || "audio/webm", file.filetype || "");
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

    const rosterRaw = await sbFetch("profiles?select=user_id,name,slack_user_id");
    const roster = Array.isArray(rosterRaw) ? rosterRaw : [];

    const parsed = await parseWithClaude(transcript, existingEntry, roster, firstName);

    // Pull out tasks the speaker assigned to teammates; keep the rest as their own.
    const { ownTasks, assigned, unmatched } = distributeTasks(parsed.tasks || [], roster, profile, weekOf);
    parsed.tasks = ownTasks;

    const saved = await savePulseEntry(profile.user_id, weekOf, parsed, existingEntry);
    console.log("Saved:", JSON.stringify(saved)?.substring(0, 150));

    const dmByTarget = new Map(); // slack_user_id → { name, tasks: [] }
    for (const { target, task } of assigned) {
      await addAssignedTask(target.user_id, weekOf, task);
      console.log(`Assigned task to ${target.name}`);
      if (target.slack_user_id) {
        if (!dmByTarget.has(target.slack_user_id)) dmByTarget.set(target.slack_user_id, []);
        dmByTarget.get(target.slack_user_id).push(task);
      }
    }
    for (const [slackId, tasksForUser] of dmByTarget) {
      try { await sendDM(slackId, assignmentMessage(profile.name, tasksForUser)); }
      catch (e) { console.error("Assign DM failed:", e.message); }
    }

    if (parsed.blockers?.length) await notifyAdminsOfBlockers(profile, parsed.blockers);

    const taskCount = ownTasks.length;
    const blockerCount = parsed.blockers?.length || 0;
    const blockerNote = blockerCount > 0 ? `\n⚠️ I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""} to the team.` : "";
    const assignNames = [...new Set(assigned.map(a => (a.target.name || "").split(" ")[0]))];
    const assignNote = assigned.length > 0 ? `\n📌 Assigned ${assigned.length} task${assigned.length !== 1 ? "s" : ""} to ${assignNames.join(", ")}.` : "";
    const unmatchedNote = unmatched.length ? `\n🤔 Couldn't find ${[...new Set(unmatched)].join(", ")} on the team — kept ${unmatched.length > 1 ? "those" : "that"} as your task${unmatched.length > 1 ? "s" : ""}.` : "";
    await postToChannel(event.channel, `✅ Got it ${firstName}. *${taskCount} task${taskCount !== 1 ? "s" : ""}* logged for the week.${assignNote}${blockerNote}${unmatchedNote}\n\nView the dashboard: https://pulse.clover.tools`);
    console.log("=== DONE ===");

  } catch (err) {
    console.error("ERROR:", err.message, err.stack?.substring(0, 300));
    try { await postToChannel(body?.event?.channel, "Something went wrong. Try again in a moment."); } catch {}
  }

  return res.status(200).send("ok");
}
