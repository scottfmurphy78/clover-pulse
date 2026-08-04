// ─────────────────────────────────────────────────────────────────────
// Vercel serverless function — /api/whatsapp
// Receives incoming WhatsApp messages from Twilio
// Voice notes → Whisper transcription → Claude parsing → Supabase
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// ── Slack: notify an assignee (even when the update came in over WhatsApp) ──
async function slackPost(method, body) {
  if (!SLACK_BOT_TOKEN) return { ok: false };
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ ok: false }));
  if (!data.ok) console.error("Slack error:", method, data.error);
  return data;
}
async function sendSlackDM(slackUserId, text) {
  const open = await slackPost("conversations.open", { users: slackUserId });
  if (!open.ok) return;
  return slackPost("chat.postMessage", { channel: open.channel.id, text });
}
function assignmentMessage(assignerName, tasks) {
  const list = tasks.map(t => {
    const due = t.deadline ? new Date(t.deadline + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;
    return `• ${t.text}${due ? `  _(due ${due})_` : ""}`;
  }).join("\n");
  const n = tasks.length;
  return `📋 *${assignerName || "Someone"}* assigned you ${n} task${n !== 1 ? "s" : ""} on Clover Pulse:\n${list}\n\nhttps://pulse.clover.tools`;
}

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

async function getProfileByWhatsApp(phone) {
  const normalized = phone.replace(/[\s\-]/g, "");
  const data = await sbFetch(`profiles?whatsapp=eq.${encodeURIComponent(normalized)}&select=*`);
  return Array.isArray(data) ? data[0] : null;
}

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

async function downloadAudio(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const r = await fetch(mediaUrl, { headers: { "Authorization": `Basic ${credentials}` } });
  if (!r.ok) throw new Error(`Failed to download audio: ${r.status}`);
  const buffer = await r.arrayBuffer();
  return Buffer.from(buffer);
}

async function transcribeAudio(audioBuffer) {
  const boundary = "----WhisperBoundary" + Date.now();
  const beforeFile = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`
  );
  const afterFile = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--${boundary}--\r\n`
  );
  const body = Buffer.concat([beforeFile, audioBuffer, afterFile]);
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Whisper error: ${JSON.stringify(data)}`);
  return data.text;
}

async function parseWithClaude(transcript, existingEntry, roster = [], speakerName = "") {
  const names = roster.map(p => (p.name || "").split(" ")[0]).filter(Boolean).join(", ");
  // Concrete date reference so "by Friday" resolves to a real, non-past ISO date.
  const today = new Date().toISOString().split("T")[0];
  const weekday = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const monday = currentWeekOf();
  const sunday = endOfWeek(monday);
  const system = `You are an assistant that extracts weekly work updates from voice note transcripts.
Return ONLY valid JSON with this exact structure, no preamble, no markdown:
{
  "note": "A single punchy sentence summarising the person's week in their own voice. Max 15 words.",
  "tasks": [
    { "id": "unique_short_id", "text": "Task description", "done": false, "assignee": null, "deadline": null }
  ],
  "completed_last": [
    "Thing they completed last week"
  ],
  "blockers": [
    "Blocker description"
  ]
}
Rules:
- Extract tasks they plan to do THIS week into tasks[]
- Extract things they DID last week into completed_last[]
- Extract anything blocking them into blockers[]
- Keep task text concise (under 10 words)
- If they mention something is done, set done: true
- Generate short unique IDs like t1, t2, t3
- If no blockers, return empty array
- If no completed last week mentioned, return empty array
- The speaker is ${speakerName || "the sender"}. Team members: ${names || "none"}.
- assignee: if the speaker assigns a task to a teammate by name (e.g. "assign Antonio to fix the website"), set assignee to that teammate's first name exactly as listed above. For the speaker's own tasks, set assignee to null.
- Today is ${today} (${weekday}). This week runs Monday ${monday} to Sunday ${sunday}.
- deadline: resolve any stated weekday or relative phrase ("by Friday", "next Wednesday", "end of week") to an ISO date "YYYY-MM-DD" that is today (${today}) or later — never earlier than ${monday}. If no due date is stated, use null`;

  const userPrompt = existingEntry
    ? `Here is their existing entry this week:\n${JSON.stringify(existingEntry)}\n\nHere is their new voice note transcript. Merge new information with existing, update done status where mentioned:\n\n${transcript}`
    : `Here is their voice note transcript:\n\n${transcript}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude error: ${JSON.stringify(data)}`);
  const text = data.content?.[0]?.text || "{}";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function savePulseEntry(userId, weekOf, parsed, existingEntry) {
  const payload = {
    user_id: userId,
    week_of: weekOf,
    note: parsed.note,
    tasks: parsed.tasks,
    completed_last: parsed.completed_last,
    blockers: parsed.blockers,
    submitted_at: new Date().toISOString(),
  };
  // PATCH an existing week's entry (e.g. from carryover or an assigned task);
  // only POST a fresh row when there's nothing there yet. Mirrors api/slack.js.
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

function twimlResponse(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    const body = req.body || {};
    const from = body.From || "";
    const mediaUrl = body.MediaUrl0 || null;
    const mediaContentType = body.MediaContentType0 || "";
    const textBody = body.Body || "";
    const phone = from.replace("whatsapp:", "");

    const profile = await getProfileByWhatsApp(phone);
    if (!profile) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse(
        "Hi! I don't recognise this number. Sign in at pulse.clover.tools and add your WhatsApp number to your profile."
      ));
    }

    const isAudio = mediaContentType.startsWith("audio/");
    const isText = !mediaUrl && textBody.length > 10;

    if (!isAudio && !isText) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse(
        "Send me a voice note or text message with your weekly update and I'll take care of the rest."
      ));
    }

    let transcript = textBody;
    if (isAudio && mediaUrl) {
      const audioBuffer = await downloadAudio(mediaUrl);
      transcript = await transcribeAudio(audioBuffer);
    }

    if (!transcript || transcript.trim().length < 10) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse("I couldn't make out your message. Try again!"));
    }

    const firstName = profile.name?.split(" ")[0] || "there";
    const weekOf = currentWeekOf();
    const existing = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${weekOf}&select=*`);
    const existingEntry = Array.isArray(existing) ? existing[0] : null;

    const rosterRaw = await sbFetch("profiles?select=user_id,name,slack_user_id");
    const roster = Array.isArray(rosterRaw) ? rosterRaw : [];

    const parsed = await parseWithClaude(transcript, existingEntry, roster, firstName);

    const { ownTasks, assigned, unmatched } = distributeTasks(parsed.tasks || [], roster, profile, weekOf);
    parsed.tasks = ownTasks;

    await savePulseEntry(profile.user_id, weekOf, parsed, existingEntry);
    const dmByTarget = new Map(); // slack_user_id → tasks[]
    for (const { target, task } of assigned) {
      await addAssignedTask(target.user_id, weekOf, task);
      if (target.slack_user_id) {
        if (!dmByTarget.has(target.slack_user_id)) dmByTarget.set(target.slack_user_id, []);
        dmByTarget.get(target.slack_user_id).push(task);
      }
    }
    for (const [slackId, tasksForUser] of dmByTarget) {
      try { await sendSlackDM(slackId, assignmentMessage(profile.name, tasksForUser)); }
      catch (e) { console.error("Assign DM failed:", e.message); }
    }

    const taskCount = ownTasks.length;
    const blockerCount = parsed.blockers?.length || 0;
    const blockerNote = blockerCount > 0 ? ` I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""}.` : "";
    const assignNames = [...new Set(assigned.map(a => (a.target.name || "").split(" ")[0]))];
    const assignNote = assigned.length > 0 ? ` Assigned ${assigned.length} to ${assignNames.join(", ")}.` : "";
    const unmatchedNote = unmatched.length ? ` Couldn't find ${[...new Set(unmatched)].join(", ")} — kept as yours.` : "";

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlResponse(
      `Got it ${firstName}. ${taskCount} task${taskCount !== 1 ? "s" : ""} logged for the week.${assignNote}${blockerNote}${unmatchedNote} Dashboard updated at pulse.clover.tools`
    ));

  } catch (err) {
    console.error("WhatsApp handler error:", err);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlResponse("Something went wrong on our end. Try again in a moment."));
  }
}
