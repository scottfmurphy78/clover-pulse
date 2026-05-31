// ─────────────────────────────────────────────────────────────────────
// Vercel serverless function — /api/whatsapp
// Receives incoming WhatsApp messages from Twilio
// Voice notes → Whisper transcription → Claude parsing → Supabase
// ─────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

// Supabase service-role client (server-side, full access)
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

// Find profile by WhatsApp number
async function getProfileByWhatsApp(phone) {
  // Normalize: strip spaces and dashes
  const normalized = phone.replace(/[\s\-]/g, "");
  const data = await sbFetch(`profiles?whatsapp=eq.${encodeURIComponent(normalized)}&select=*`);
  return Array.isArray(data) ? data[0] : null;
}

// Get Monday's date for the current week
function currentWeekOf() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  return mon.toISOString().split("T")[0];
}

// Download audio from Twilio media URL
async function downloadAudio(mediaUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const r = await fetch(mediaUrl, {
    headers: { "Authorization": `Basic ${credentials}` },
  });
  if (!r.ok) throw new Error(`Failed to download audio: ${r.status}`);
  const buffer = await r.arrayBuffer();
  return Buffer.from(buffer);
}

// Transcribe audio with OpenAI Whisper
async function transcribeAudio(audioBuffer) {
  const { FormData, Blob } = await import("node:buffer").catch(() => ({}));

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");
  form.append("language", "en");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Whisper error: ${JSON.stringify(data)}`);
  return data.text;
}

// Parse transcript with Claude
async function parseWithClaude(transcript, existingEntry) {
  const system = `You are an assistant that extracts weekly work updates from voice note transcripts.
Return ONLY valid JSON with this exact structure, no preamble, no markdown:
{
  "note": "A single punchy sentence summarising the person's week in their own voice. Max 15 words.",
  "tasks": [
    { "id": "unique_short_id", "text": "Task description", "done": false }
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
- If no completed last week mentioned, return empty array`;

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
      model: "claude-sonnet-4-20250514",
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

// Save to Supabase pulse_entries
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

// Twilio TwiML response
function twimlResponse(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message}</Message>
</Response>`;
}

// ── Main handler ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    // Parse Twilio's form-encoded body
    const body = req.body || {};
    const from = body.From || ""; // e.g. "whatsapp:+34600000000"
    const mediaUrl = body.MediaUrl0 || null;
    const mediaContentType = body.MediaContentType0 || "";
    const textBody = body.Body || "";

    // Clean phone number
    const phone = from.replace("whatsapp:", "");

    // Look up user by WhatsApp number
    const profile = await getProfileByWhatsApp(phone);
    if (!profile) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse(
        "Hi! I don't recognise this number. Sign in at clover-pulse.vercel.app and add your WhatsApp number to your profile."
      ));
    }

    // Must be a voice note (audio)
    const isAudio = mediaContentType.startsWith("audio/");
    const isText = !mediaUrl && textBody.length > 0;

    if (!isAudio && !isText) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse(
        "Send me a voice note or text message with your weekly update and I'll take care of the rest."
      ));
    }

    let transcript = textBody;

    // If voice note, download and transcribe
    if (isAudio && mediaUrl) {
      const audioBuffer = await downloadAudio(mediaUrl);
      transcript = await transcribeAudio(audioBuffer);
    }

    if (!transcript || transcript.trim().length < 10) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twimlResponse("I couldn't make out your message. Try again!"));
    }

    // Check for existing entry this week
    const weekOf = currentWeekOf();
    const existing = await sbFetch(
      `pulse_entries?user_id=eq.${profile.user_id}&week_of=eq.${weekOf}&select=*`
    );
    const existingEntry = Array.isArray(existing) ? existing[0] : null;

    // Parse with Claude
    const parsed = await parseWithClaude(transcript, existingEntry);

    // Save to Supabase
    await savePulseEntry(profile.user_id, weekOf, parsed);

    const firstName = profile.name?.split(" ")[0] || "there";
    const taskCount = parsed.tasks?.length || 0;
    const blockerCount = parsed.blockers?.length || 0;
    const blockerNote = blockerCount > 0 ? ` I've flagged ${blockerCount} blocker${blockerCount > 1 ? "s" : ""}.` : "";

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlResponse(
      `Got it ${firstName}. ${taskCount} task${taskCount !== 1 ? "s" : ""} logged for the week.${blockerNote} Dashboard updated at clover-pulse.vercel.app`
    ));

  } catch (err) {
    console.error("WhatsApp handler error:", err);
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twimlResponse("Something went wrong on our end. Try again in a moment."));
  }
}
