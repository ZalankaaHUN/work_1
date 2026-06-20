// /api/review-submission.js
//
// Vercel serverless function. Called by the "Start a project" form instead of
// posting straight to FormSubmit. It:
//   1. Validates the submission server-side.
//   2. Asks gpt-4o-mini to summarise it, flag missing/unclear info, suggest a
//      plan/budget/subscription fit, and draft a reply.
//   3. Forwards the original submission + that AI review to hello@webstrakt.com
//      via FormSubmit (the same destination the form already used — no new
//      email provider or signup needed).
//
// Requires one environment variable, set in the Vercel project settings:
//   OPENAI_API_KEY = sk-...
//
// If the AI call fails for any reason (no key, rate limit, bad response), the
// function still forwards the raw enquiry so no lead is ever lost — it just
// notes that the AI review wasn't available for that one.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const FORM_ENDPOINT = "https://formsubmit.co/ajax/hello@webstrakt.com";

async function getAiReview(fields) {
  if (!process.env.OPENAI_API_KEY) throw new Error("missing_key");

  const prompt = [
    "You are reviewing a new project enquiry submitted to a small web design studio called Webstrakt.",
    "Based only on the fields given below, return a JSON object with exactly these keys:",
    '- "summary": a 2-3 sentence summary of what the client wants.',
    '- "missing": an array of short strings naming any important info that is missing or unclear (use an empty array if nothing notable is missing).',
    '- "recommendation": 1-2 sentences suggesting which plan, budget tier or subscription option seems like the best fit, given what they shared.',
    '- "draftReply": a short, warm, professional draft reply (4-6 sentences) the studio could send back to the client, written in first person plural ("we"). Do not invent prices or promises beyond what was provided.',
    "Respond with ONLY the JSON object — no markdown fences, no extra commentary.",
    "",
    "Submission fields:",
    JSON.stringify(fields, null, 2),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let r;
  try {
    r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) throw new Error("openai_http_" + r.status);
  const data = await r.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("openai_empty");

  const parsed = JSON.parse(text);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    missing: Array.isArray(parsed.missing) ? parsed.missing.filter((m) => typeof m === "string") : [],
    recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : "",
    draftReply: typeof parsed.draftReply === "string" ? parsed.draftReply : "",
  };
}

function clean(v) {
  return (v == null ? "" : String(v)).trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const body = req.body || {};
  const fields = {
    name: clean(body.name),
    email: clean(body.email),
    company: clean(body.company),
    type: clean(body.type),
    budget: clean(body.budget),
    subservice: clean(body.subservice),
    subtype: clean(body.subtype),
    timeline: clean(body.timeline),
    message: clean(body.message),
  };

  if (!fields.name || !fields.email || !fields.message) {
    res.status(400).json({ ok: false, error: "missing_fields" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    res.status(400).json({ ok: false, error: "bad_email" });
    return;
  }

  let review = null;
  let reviewError = null;
  try {
    review = await getAiReview(fields);
  } catch (e) {
    reviewError = e && e.message ? e.message : "unknown";
  }

  const emailFields = {
    _subject: "New project enquiry — " + fields.name + (review ? " (AI-reviewed)" : ""),
    _replyto: fields.email,
    _captcha: "false",
    _template: "table",
    Name: fields.name,
    Email: fields.email,
    Company: fields.company || "—",
    Project_type: fields.type || "—",
    Budget: fields.budget || "—",
    Subscription_service: fields.subservice || "—",
    Subscription_type: fields.subtype || "—",
    Timeline: fields.timeline || "—",
    Message: fields.message,
  };

  if (review) {
    emailFields.AI_Summary = review.summary || "—";
    emailFields.AI_Missing_Info = review.missing.length ? review.missing.join("; ") : "Nothing notable flagged";
    emailFields.AI_Recommendation = review.recommendation || "—";
    emailFields.AI_Draft_Reply = review.draftReply || "—";
  } else {
    emailFields.AI_Review = "Unavailable for this submission (" + (reviewError || "unknown error") + ") — please review manually.";
  }

  try {
    const r = await fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(emailFields),
    });
    if (!r.ok) throw new Error("forward_http_" + r.status);
  } catch (e) {
    res.status(502).json({ ok: false, error: "forward_failed" });
    return;
  }

  res.status(200).json({ ok: true, reviewed: !!review });
};
