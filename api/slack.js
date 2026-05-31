// ─────────────────────────────────────────────────────────────────────
// Vercel serverless function — /api/slack
// ─────────────────────────────────────────────────────────────────────

export const config = { api: { bodyParser: false }, maxDuration: 60 };

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

// Raw body reader
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Signature verification
async function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) { console.log("SIG: missing headers"); return false; }
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) { console.log("SIG: timestamp too old"); return false; }
  const sigBase = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(SLACK_SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBase));
  const hex = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  const expected = `v0=${hex}`;
  const match = expected === signature;
  if (!match) console.log("SIG: mismatch. expected:", expected.substring(0, 20), "got:", signature.substring(0, 20));
  return match;
}

// Supabase
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  console.log("SB:", options.method || "GET", path.substring(0, 80));
  const r = await fetch(url, {
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
  console.log("SB response status:", r.status, "data:", JSON.stringify(data)?.substring(0, 150));
  return data;
}

// Slack
async function slackPost(method, body) {
  console.log("SLACK:", method, JSON.stringify(body)?.substring(0, 100));
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) console.log("SLACK error:", method, data.error);
  return data;
}

async function postToChannel(channelId, text) {
  return slackPost("chat.postMessage", { channel: channelId, text });
}

async function getSlackUserEmail(slackUserId) {
  console.log("Getting email for Slack user:", slackUserId);
  const r = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await r.json();
  console.log("Slack users.info ok:", data.ok, "email:", data.user?.profile?.email, "is_bot:", data.user?.is_bot);
  return data.user?.is_bot ? null : (data.user?.profile?.email || null);
}

async function downloadSlackFile(url) {
  console.log("Downloading file:", url.substring(0, 80));
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` } });
  if (!r.ok) throw new Error(`Failed to download file: ${r.status}`);
  const buffer = await r.arrayBuffer();
  console.log("Downloaded file, size:", buffer.byteLength);
  return Buffer.from(buffer);
}

async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  console.log("Transcribing audio, size:", audioBuffer.length, "mime:", mimeType);
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
  console.log("Parsing with Claude, transcript length:", transcript.length);
  const system = `You are an assistant that extracts weekly work updates from voice note transcripts.
Return ONLY valid JSON with this exact structure, no preamble, no markdown:
{
  "note": "A single punchy sentence summarising the person's week in their own voice. Max 15 words.",
  "tasks": [{ "id": "t1", "text": "Task description", "done": false, "carried_over": false }],
  "completed_last": ["Thing completed last week"],
  "blockers": ["Blocker description"]
}
Rules: tasks = this week. completed_last = last week. blockers = anything blocking them. Keep task text under 10 words. No carried_over: true.`;

  const userPrompt = existingEntry
    ? `Existing entry:\n${JSON.stringify(existingEntry)}\n\nNew update — merge and update:\n\n${transcript}`
    : `Transcript:\n\n${transcript}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1000, system, messages: [{ role: "user", content: userPrompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude error: ${JSON.stringify(data)}`);
  const text = data.content?.[0]?.text || "{}";
  console.log("Claude raw response:", text.substring(0, 200));
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  console.log("Parsed:", parsed.tasks?.length, "tasks,", parsed.blockers?.length, "blockers");
  return parsed;
}

async function savePulseEntry(userId, weekOf, parsed) {
  console.log("Saving pulse entry for user:", userId, "week:", weekOf);
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
  if (!blockers.length) return;
  console.log("Notifying admins of blockers:", blockers);
  const adminEmails = ["scott@rideclover.com", "antonio@rideclover.com"];
  const blockerText = blockers.map(b => `• ${b}`).join("\n");
  for (const email of adminEmails) {
    if (email === profile.email) continue;
    const admins = await sbFetch(`profiles?email=eq.${encodeURIComponent(email)}&select=slack_user_id`);
    const admin = Array.isArray(admins) ? admins[0] : null;
    if (admin?.slack_user_id) {
      const open = await slackPost("conversations.open", { users: admin.slack_user_id });
      if (open.ok) await slackPost("chat.postMessage", { channel: open.channel.id, text: `⚠️ *${profile.name}* has a blocker:\n${blockerText}\n\nhttps://clover-pulse.vercel.app` });
    }
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  console.log("=== SLACK REQUEST ===");
  const rawBody = await getRawBody(req);
  console.log("Raw body length:", rawBody.length, "preview:", rawBody.substring(0, 100));

  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) return res.status(401).send("Invalid signature");

  const body = JSON.parse(rawBody);
  console.log("Body type:", body.type, "event_id:", body.event_id);

  if (body.type === "url_verification") {
    console.log("URL verification challenge");
    return res.status(200).json({ challenge: body.challenge });
  }

  if (body.type !== "event_callback") return res.status(200).send("ok");

  if (isDuplicate(body.event_id)) {
    console.log("DUPLICATE, skipping:", body.event_id);
    return res.status(200).send("ok");
  }

  const event = body.event;
  console.log("Event:", event.type, "| subtype:", event.subtype, "| channel_type:", event.channel_type, "| bot_id:", event.bot_id, "| user:", event.user);

  if (event.bot_id)                          { console.log("SKIP: bot_id"); return res.status(200).send("ok"); }
  if (event.type === "file_shared")          { console.log("SKIP: file_shared"); return res.status(200).send("ok"); }
  if (event.type !== "message")              { console.log("SKIP: not message"); return res.status(200).send("ok"); }
  if (event.subtype === "bot_message")       { console.log("SKIP: bot_message"); return res.status(200).send("ok"); }
  if (event.subtype === "message_changed")   { console.log("SKIP: message_changed"); return res.status(200).send("ok"); }
  if (!event.user)                           { console.log("SKIP: no user"); return res.status(200).send("ok"); }
  if (event.channel_type !== "im")           { console.log("SKIP: not im"); return res.status(200).send("ok"); }

  console.log("✓ All filters passed. Processing message from:", event.user);

  try {
    const slackUserId = event.user;

    // Profile lookup
    let profile = await sbFetch(`profiles?slack_user_id=eq.${slackUserId}&select=*`);
    profile = Array.isArray(profile) ? profile[0] : null;
    console.log("Profile by slack_user_id:", profile?.name || "not found");

    if (!profile) {
      const email = await getSlackUserEmail(slackUserId);
      if (email) {
        const normalized = email.toLowerCase().replace("@clovertronix.com", "@rideclover.com");
        console.log("Looking up by normalized email:", normalized);
        const byEmail = await sbFetch(`profiles?email=eq.${encodeURIComponent(normalized)}&select=*`);
        profile = Array.isArray(byEmail) ? byEmail[0] : null;
        console.log("Profile by email:", profile?.name || "not found");
        if (profile) {
          await sbFetch(`profiles?user_id=eq.${profile.user_id}`, { method: "PATCH", body: JSON.stringify({ slack_user_id: slackUserId }) });
          console.log("Linked slack_user_id to profile");
        }
      }
    }

    if (!profile) {
      console.log("No profile found — sending signup message");
      await postToChannel(event.channel, "👋 I don't recognise your account yet. Sign in at https://clover-pulse.vercel.app with your @rideclover.com Google account to get set up.");
      return res.status(200).send("ok");
    }

    console.log("Profile found:", profile.name, profile.email, "user_id:", profile.user_id);
    const firstName = profile.name?.split(" ")[0] || "there";
    let transcript = null;

    // Voice note
    if (event.files?.length) {
      const file = event.files[0];
      console.log("File:", file.name, file.mimetype, file.filetype);
      const isAudio = file.mimetype?.startsWith("audio/") || file.filetype === "mp4";
      if (isAudio && file.url_private) {
        await postToChannel(event.channel, `Got your voice note ${firstName}, transcribing now... 🎙️`);
        const audioBuffer = await downloadSlackFile(file.url_private);
        transcript = await transcribeAudio(audioBuffer, file.mimetype || "audio/mp4");
      }
    }

    // Text
    if (!transcript && event.text?.trim().length > 10) {
      transcript = event.text.trim();
      console.log("Using text:", transcript.substring(0, 100));
    }

    if (!transcript) {
      console.log("No transcript, sending instructions");
      await postToChannel(event.channel, "Send me a voice note or text message with your weekly update. 🎙️");
      return res.status(200).send("ok");
    }

    const weekOf = currentWeekOf();
    console.log("Week of:", weekOf);

    const existingRaw = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${weekOf}&select=*`);
    const existingEntry = Array.isArray(existingRaw) ? existingRaw[0] : null;
    console.log("Existing entry:", existingEntry ? "found" : "none");

    const parsed = await parseWithClaude(transcript, existingEntry);
    const saved = await savePulseEntry(profile.user_id, weekOf, parsed);
    console.log("Save result:", JSON.stringify(saved)?.substring(0, 200));

    if (parsed.blockers?.length) await notifyAdminsOfBlockers(profile, parsed.blockers);

    const taskCount = parsed.tasks?.length || 0;
    const blockerCount = parsed.blockers?.length || 0;
    const blockerNote = blockerCount > 0 ? `\n⚠️ I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""} to the team.` : "";

    const confirmMsg = `✅ Got it ${firstName}. *${taskCount} task${taskCount !== 1 ? "s" : ""}* logged for the week.${blockerNote}\n\nView the dashboard: https://clover-pulse.vercel.app`;
    console.log("Sending confirmation:", confirmMsg.substring(0, 100));
    await postToChannel(event.channel, confirmMsg);
    console.log("=== DONE ===");

  } catch (err) {
    console.error("=== ERROR ===", err.message, err.stack?.substring(0, 300));
    try { await postToChannel(event.channel, "Something went wrong. Try again in a moment."); } catch {}
  }

  return res.status(200).send("ok");
}

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}
