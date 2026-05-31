// ─────────────────────────────────────────────────────────────────────
// Vercel serverless function — /api/slack
// Receives Slack events (DMs with voice notes or text)
// Audio → Whisper → Claude → Supabase → Slack confirmation
// ─────────────────────────────────────────────────────────────────────

// Must disable body parser to read raw body for signature verification
export const config = { api: { bodyParser: false } };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// Read raw body from request stream
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ── Verify Slack request signature ────────────────────────────────────
async function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(sigBase));
  const hex = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, "0")).join("");
  const expected = `v0=${hex}`;
  return expected === signature;
}

// ── Supabase helpers ──────────────────────────────────────────────────
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

async function getProfileBySlackId(slackUserId) {
  const data = await sbFetch(`profiles?slack_user_id=eq.${slackUserId}&select=*`);
  return Array.isArray(data) ? data[0] : null;
}

async function getProfileByEmail(email) {
  // Accept both rideclover.com and clovertronix.com
  const normalized = email.toLowerCase()
    .replace("@clovertronix.com", "@rideclover.com");
  const data = await sbFetch(`profiles?email=eq.${encodeURIComponent(normalized)}&select=*`);
  return Array.isArray(data) ? data[0] : null;
}

async function updateProfileSlackId(userId, slackUserId) {
  await sbFetch(`profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ slack_user_id: slackUserId }),
  });
}

function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

// ── Slack API helpers ─────────────────────────────────────────────────
async function slackPost(method, body) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sendDM(slackUserId, text) {
  const open = await slackPost("conversations.open", { users: slackUserId });
  if (!open.ok) throw new Error(`Failed to open DM: ${open.error}`);
  return slackPost("chat.postMessage", { channel: open.channel.id, text });
}

async function getSlackUserEmail(slackUserId) {
  const r = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await r.json();
  return data.user?.profile?.email || null;
}

// ── Download Slack file ───────────────────────────────────────────────
async function downloadSlackFile(url) {
  const r = await fetch(url, {
    headers: { "Authorization": `Bearer ${SLACK_BOT_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Failed to download file: ${r.status}`);
  const buffer = await r.arrayBuffer();
  return Buffer.from(buffer);
}

// ── Whisper transcription ─────────────────────────────────────────────
async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
  const boundary = "----WhisperBoundary" + Date.now();
  const beforeFile = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`
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

// ── Claude parsing ────────────────────────────────────────────────────
async function parseWithClaude(transcript, existingEntry) {
  const system = `You are an assistant that extracts weekly work updates from voice note transcripts.
Return ONLY valid JSON with this exact structure, no preamble, no markdown:
{
  "note": "A single punchy sentence summarising the person's week in their own voice. Max 15 words.",
  "tasks": [
    { "id": "unique_short_id", "text": "Task description", "done": false, "carried_over": false }
  ],
  "completed_last": ["Thing they completed last week"],
  "blockers": ["Blocker description"]
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
- Never set carried_over: true — that is set by the system separately`;

  const userPrompt = existingEntry
    ? `Existing entry this week:\n${JSON.stringify(existingEntry)}\n\nNew voice note — merge with existing, update done status where mentioned:\n\n${transcript}`
    : `Voice note transcript:\n\n${transcript}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
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

// ── Save pulse entry ──────────────────────────────────────────────────
async function savePulseEntry(userId, weekOf, parsed) {
  return sbFetch("pulse_entries", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      week_of: weekOf,
      note: parsed.note,
      tasks: parsed.tasks,
      completed_last: parsed.completed_last,
      blockers: parsed.blockers,
      submitted_at: new Date().toISOString(),
    }),
  });
}

// ── Notify admins of blockers ─────────────────────────────────────────
async function notifyAdminsOfBlockers(profile, blockers) {
  if (!blockers.length) return;
  const adminEmails = ["scott@rideclover.com", "antonio@rideclover.com"];
  const admins = await Promise.all(
    adminEmails.map(email => sbFetch(`profiles?email=eq.${encodeURIComponent(email)}&select=*`))
  );
  const blockerText = blockers.map(b => `• ${b}`).join("\n");
  for (const adminData of admins) {
    const admin = Array.isArray(adminData) ? adminData[0] : null;
    if (admin?.slack_user_id && admin.slack_user_id !== profile.slack_user_id) {
      await sendDM(admin.slack_user_id,
        `⚠️ *${profile.name}* has a blocker:\n${blockerText}\n\nView the dashboard: https://clover-pulse.vercel.app`
      );
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  // Read raw body for signature verification
  const rawBody = await getRawBody(req);
  
  // Verify Slack signature
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    console.error("Signature verification failed");
    return res.status(401).send("Invalid signature");
  }

  // Parse body manually since we disabled bodyParser
  const body = JSON.parse(rawBody);

  // Slack URL verification challenge
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Handle events
  if (body.type === "event_callback") {
    const event = body.event;
    console.log("Event type:", event.type, "subtype:", event.subtype, "channel_type:", event.channel_type);

    // Skip standalone file_shared events — handled via message.file_share
    if (event.type === "file_shared") {
      return res.status(200).send("ok");
    }

    // Only handle DMs, ignore bot messages
    if (event.type !== "message" || event.subtype === "bot_message" || !event.user) {
      console.log("Skipping — not a user message");
      return res.status(200).send("ok");
    }

    // Skip the separate file_shared event — we handle files via the message event
    if (event.type === "file_shared") {
      return res.status(200).send("ok");
    }

    // Only handle DM channels
    if (event.channel_type !== "im") {
      console.log("Skipping — not a DM, channel_type:", event.channel_type);
      return res.status(200).send("ok");
    }

    res.status(200).send("ok"); // Respond immediately to Slack
    console.log("Processing message from Slack user:", event.user);

    try {
      const slackUserId = event.user;
      console.log("Looking up profile for Slack user:", slackUserId);

      // Look up profile by Slack ID first, then by email
      let profile = await getProfileBySlackId(slackUserId);
      console.log("Profile by Slack ID:", profile ? profile.name : "not found");

      if (!profile) {
        const email = await getSlackUserEmail(slackUserId);
        console.log("Slack user email:", email);
        if (email) {
          profile = await getProfileByEmail(email);
          console.log("Profile by email:", profile ? profile.name : "not found");
          if (profile) await updateProfileSlackId(profile.user_id, slackUserId);
        }
      }

      if (!profile) {
        await sendDM(slackUserId,
          "👋 I don't recognise your account yet. Sign in at https://clover-pulse.vercel.app with your @rideclover.com Google account to get set up."
        );
        return;
      }

      const firstName = profile.name?.split(" ")[0] || "there";
      let transcript = null;

      // Handle voice note / audio file
      if (event.files?.length) {
        const file = event.files[0];
        const isAudio = file.mimetype?.startsWith("audio/") || file.filetype === "mp4";

        if (isAudio && file.url_private) {
          await sendDM(slackUserId, `Got your voice note ${firstName}, transcribing now...`);
          const audioBuffer = await downloadSlackFile(file.url_private);
          transcript = await transcribeAudio(audioBuffer, file.mimetype || "audio/mp4");
        }
      }

      // Handle text message
      if (!transcript && event.text && event.text.trim().length > 10) {
        transcript = event.text.trim();
      }

      if (!transcript) {
        await sendDM(slackUserId, "Send me a voice note or a text message with your weekly update and I'll take care of the rest. 🎙️");
        return;
      }

      // Get existing entry for this week
      const weekOf = currentWeekOf();
      const existing = await sbFetch(`pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${weekOf}&select=*`);
      const existingEntry = Array.isArray(existing) ? existing[0] : null;

      // Parse with Claude
      const parsed = await parseWithClaude(transcript, existingEntry);

      // Save to Supabase
      await savePulseEntry(profile.user_id, weekOf, parsed);

      // Notify admins of any blockers
      if (parsed.blockers?.length) {
        await notifyAdminsOfBlockers(profile, parsed.blockers);
      }

      // Send confirmation
      const taskCount = parsed.tasks?.length || 0;
      const blockerCount = parsed.blockers?.length || 0;
      const blockerNote = blockerCount > 0 ? `\n⚠️ I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""} to the team.` : "";

      await sendDM(slackUserId,
        `✅ Got it ${firstName}. *${taskCount} task${taskCount !== 1 ? "s" : ""}* logged for the week.${blockerNote}\n\nView the dashboard: https://clover-pulse.vercel.app`
      );

    } catch (err) {
      console.error("Slack handler error:", err);
      try {
        await sendDM(body.event?.user, "Something went wrong processing your update. Try again in a moment.");
      } catch {}
    }
  }

  return res.status(200).send("ok");
}
