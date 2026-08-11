// backup-dispatcher.source.mjs
//
// Source for the bundled job-scout-backup-dispatcher Cloudflare Worker.
//
// This source was recovered from the esbuild bundle running as the
// `job-scout-backup-dispatcher` Cloudflare Worker, the service that composes and sends
// every match email. Keeping source and generated deployment artifact together makes
// dashboard drift visible in review instead of waiting for an inbox to expose it.
//
// It fills exactly the tokens in KNOWN_TOKENS (build-email.mjs). Adding a token to
// email-template.html that does not appear in this file will break production mail.
//
// The recovered snapshot was fetched and redeployed 2026-08-11 with two fixes:
//   - conditional HTML comments are preserved, so Outlook keeps its 600px ghost table
//   - the grey freshness pill is #556174 (5.34:1) instead of #94a3b8 / #64748b
//
// Build the single-file deployment artifact:
//   npm run build:backup-worker
//
// Inspect the currently deployed module:
//   curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
//     https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/job-scout-backup-dispatcher
//
// Redeploy (preserves bindings and secrets — do NOT use the plain /scripts PUT):
//   curl -X PUT ".../workers/scripts/job-scout-backup-dispatcher/content" \
//     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
//     -F 'metadata={"main_module":"worker.js"};type=application/json' \
//     -F 'worker.js=@dispatch/backup-dispatcher.deployed.js;filename=worker.js;type=application/javascript+module'
//
import { resolveApplyLinks } from "../linkedin-apply-url.mjs";

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var CANDIDATES_DB = "87f58043-765a-4b49-ae7e-6903e48b6996";
var SENT_POSTINGS_DB = "236b97b7-af8b-4c3d-8d67-f57fdc6386c6";
var NOTION_VERSION = "2022-06-28";
var EMAIL_TEMPLATE_URL = "https://vakalaktika.github.io/job-scout/email-template.html";
var DEFAULT_FROM_ADDRESS = "Job Scout <alerts@mail.uxed.me>";
var json = /* @__PURE__ */ __name2((body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
}), "json");
var plain = /* @__PURE__ */ __name2((property) => {
  if (!property) return "";
  if (property.type === "title") return (property.title || []).map((item) => item.plain_text || "").join("");
  if (property.type === "rich_text") return (property.rich_text || []).map((item) => item.plain_text || "").join("");
  if (property.type === "email") return property.email || "";
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "url") return property.url || "";
  if (property.type === "date") return property.date?.start || "";
  if (property.type === "number") return property.number == null ? "" : String(property.number);
  return "";
}, "plain");
var richText = /* @__PURE__ */ __name2((value) => ({
  rich_text: [{ type: "text", text: { content: String(value ?? "").slice(0, 1900) } }]
}), "richText");
async function notion(env, path, method = "GET", body) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.NOTION_TOKEN}`,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : void 0
  });
  if (!response.ok) throw new Error(`Notion ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return response.json();
}
__name(notion, "notion");
__name2(notion, "notion");
async function queryAll(env, databaseId, body = {}, limit = 500) {
  const results = [];
  let cursor;
  do {
    const page = await notion(env, `databases/${databaseId}/query`, "POST", {
      page_size: 100,
      ...body,
      ...cursor ? { start_cursor: cursor } : {}
    });
    results.push(...page.results || []);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && results.length < limit);
  return results.slice(0, limit);
}
__name(queryAll, "queryAll");
__name2(queryAll, "queryAll");
function staleHours(frequency) {
  if (frequency === "3x daily") return 12;
  if (frequency === "Weekly") return 192;
  return 36;
}
__name(staleHours, "staleHours");
__name2(staleHours, "staleHours");
function candidateState(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: plain(p.Name),
    email: plain(p.Email).trim().toLowerCase(),
    status: plain(p.Status),
    targetRoles: plain(p["Target roles"]),
    regions: plain(p.Regions),
    minSalary: plain(p["Min salary"]),
    seniority: plain(p.Seniority),
    remote: plain(p["Remote OK"]),
    frequency: plain(p.Frequency) || "Daily",
    notes: plain(p.Notes)
  };
}
__name(candidateState, "candidateState");
__name2(candidateState, "candidateState");
function postingState(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    email: plain(p["Candidate email"]).trim().toLowerCase(),
    url: plain(p.URL).trim(),
    sentAt: plain(p["Date sent"])
  };
}
__name(postingState, "postingState");
__name2(postingState, "postingState");
function isStale(candidate, postings, now = Date.now()) {
  const latest = postings.filter((posting) => posting.email === candidate.email && posting.sentAt).map((posting) => Date.parse(posting.sentAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (!latest) return true;
  return now - latest >= staleHours(candidate.frequency) * 60 * 60 * 1e3;
}
__name(isStale, "isStale");
__name2(isStale, "isStale");
function monthKey(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().slice(0, 7);
}
__name(monthKey, "monthKey");
__name2(monthKey, "monthKey");
async function budgetState(env) {
  const key = `spend:${monthKey()}`;
  const value = Number(await env.BACKUP_STATE.get(key)) || 0;
  return { key, value };
}
__name(budgetState, "budgetState");
__name2(budgetState, "budgetState");
function estimateCost(response, env = {}) {
  const usage = response.usage || {};
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const inputPerMillion = Number(env.INPUT_USD_PER_MILLION || 0.25);
  const outputPerMillion = Number(env.OUTPUT_USD_PER_MILLION || 2);
  const webSearch = Number(env.ESTIMATED_WEB_SEARCH_USD || 0.03);
  return webSearch + input * inputPerMillion / 1e6 + output * outputPerMillion / 1e6;
}
__name(estimateCost, "estimateCost");
__name2(estimateCost, "estimateCost");
function responseText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
}
__name(responseText, "responseText");
__name2(responseText, "responseText");
var JOB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jobs"],
  properties: {
    jobs: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "url", "location", "salary", "source", "posted_at", "job_summary", "match_reason", "key_requirements"],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          url: { type: "string" },
          location: { type: "string" },
          salary: {
            type: "string",
            description: "Compensation exactly as stated in the job posting, or an empty string when the posting does not state it."
          },
          source: { type: "string" },
          posted_at: { type: "string" },
          job_summary: { type: "string" },
          match_reason: { type: "string" },
          key_requirements: { type: "string" }
        }
      }
    }
  }
};
function blockText(block) {
  const content = block?.[block.type];
  return (content?.rich_text || []).map((item) => item.plain_text || "").join("").trim();
}
__name(blockText, "blockText");
__name2(blockText, "blockText");
async function candidateResume(env, pageId) {
  const lines = [];
  let cursor;
  do {
    const page = await notion(env, `blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const block of page.results || []) {
      const text = blockText(block);
      if (text && !/^resume$/i.test(text)) lines.push(text);
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && lines.join("\n").length < 14e3);
  return lines.join("\n").slice(0, 12e3);
}
__name(candidateResume, "candidateResume");
__name2(candidateResume, "candidateResume");
async function scoutJobs(env, candidate, previousUrls, resumeText) {
  const count = Math.min(8, Math.max(1, Number(env.JOBS_PER_CANDIDATE || 5)));
  const maxPostingAge = Number(candidate.notes.match(/Posted within:\s*(\d+)/i)?.[1]) || 7;
  const prompt = `Find up to ${count} currently open job postings for this person.

Name: ${candidate.name}
Target roles: ${candidate.targetRoles}
Seniority: ${candidate.seniority}
Locations: ${candidate.regions}
Remote preference: ${candidate.remote}
Minimum salary: ${candidate.minSalary}
Additional preferences: ${candidate.notes}

Resume text:
${resumeText || "No resume text was available. Do not claim a resume-specific match."}

Requirements:
- Link directly to the original employer or authoritative job posting, not a search page.
- Only include roles that appear open now and match the preferences.
- Only include jobs posted within the last ${maxPostingAge} days. If the posted date cannot be verified, exclude the job.
- Provide the verified posted date as an ISO date.
- Write job_summary as 1-2 plain-language sentences explaining what the person would actually own. Remove employer branding, benefits boilerplate, and filler.
- Write match_reason as 1-2 specific sentences connecting the posting's responsibilities and requirements to the candidate's resume, target roles, and skills. Do not cite generic preferences as the main reason.
- Write key_requirements as a compact sentence containing only the 3-5 most consequential requirements.
- Copy salary exactly as stated in the job posting. If the posting does not state compensation, return an empty string. Never guess, infer, invent, or estimate salary from the title, level, location, or candidate preferences.
- Do not include any of these previously saved URLs: ${previousUrls.slice(0, 80).join(", ") || "none"}.`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5-mini",
      tools: [{ type: "web_search", search_context_size: "low" }],
      input: [
        { role: "system", content: "You are the emergency fallback for a private job scouting service. Be conservative: fewer verified jobs are better than invented or stale jobs." },
        { role: "user", content: prompt }
      ],
      text: { format: { type: "json_schema", name: "job_scout_results", strict: true, schema: JOB_SCHEMA } }
    })
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status} ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const jobs = (JSON.parse(responseText(payload)).jobs || []).filter((job) => {
    const posted = Date.parse(job.posted_at || "");
    if (!Number.isFinite(posted)) return false;
    const age = Math.max(0, Math.floor((Date.now() - posted) / 864e5));
    return age <= maxPostingAge;
  });
  return { jobs, response: payload };
}
__name(scoutJobs, "scoutJobs");
__name2(scoutJobs, "scoutJobs");
function propertyValue(type, value) {
  if (type === "title") return { title: [{ type: "text", text: { content: String(value).slice(0, 1900) } }] };
  if (type === "rich_text") return richText(value);
  if (type === "email") return { email: value || null };
  if (type === "url") return { url: value || null };
  if (type === "date") return value ? { date: { start: value } } : { date: null };
  if (type === "select") return value ? { select: { name: String(value).slice(0, 100) } } : { select: null };
  return null;
}
__name(propertyValue, "propertyValue");
__name2(propertyValue, "propertyValue");
async function sentPostingSchema(env) {
  let database = await notion(env, `databases/${SENT_POSTINGS_DB}`);
  const patch = {};
  for (const name of ["Why it matched", "Job summary", "Key requirements", "Salary"]) {
    if (!database.properties?.[name]) patch[name] = { rich_text: {} };
  }
  if (!database.properties?.Dispatcher) {
    patch.Dispatcher = {
      select: {
        options: [
          { name: "Job Scout dispatcher", color: "blue" },
          { name: "OpenAI backup", color: "purple" }
        ]
      }
    };
  }
  if (Object.keys(patch).length) {
    database = await notion(env, `databases/${SENT_POSTINGS_DB}`, "PATCH", { properties: patch });
  }
  return database.properties || {};
}
__name(sentPostingSchema, "sentPostingSchema");
__name2(sentPostingSchema, "sentPostingSchema");
function addProperty(properties, schema, name, value) {
  if (!schema[name] || value == null || value === "") return;
  const encoded = propertyValue(schema[name].type, value);
  if (encoded) properties[name] = encoded;
}
__name(addProperty, "addProperty");
__name2(addProperty, "addProperty");
async function saveJob(env, schema, candidate, job, now, status, dispatcherLabel = "OpenAI backup") {
  const properties = {};
  addProperty(properties, schema, "Job Title", job.title);
  addProperty(properties, schema, "Company – Title", `${job.company} – ${job.title}`);
  addProperty(properties, schema, "Company", job.company);
  addProperty(properties, schema, "URL", job.url);
  addProperty(properties, schema, "Location", job.location);
  addProperty(properties, schema, "Salary", job.salary);
  addProperty(properties, schema, "Source", job.source || "OpenAI backup");
  addProperty(properties, schema, "Date sent", now.toISOString());
  addProperty(properties, schema, "Date posted", /^\d{4}-\d{2}-\d{2}/.test(job.posted_at) ? job.posted_at.slice(0, 10) : "");
  addProperty(properties, schema, "Candidate email", candidate.email);
  addProperty(properties, schema, "Why it matched", job.match_reason);
  addProperty(properties, schema, "Job summary", job.job_summary);
  addProperty(properties, schema, "Key requirements", job.key_requirements);
  addProperty(properties, schema, "Status", status);
  addProperty(properties, schema, "Dispatcher", dispatcherLabel);
  return notion(env, "pages", "POST", { parent: { database_id: SENT_POSTINGS_DB }, properties });
}
__name(saveJob, "saveJob");
__name2(saveJob, "saveJob");
async function notify(env, message) {
  console.log(message);
  if (!env.ALERT_WEBHOOK_URL) return;
  const response = await fetch(env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message, content: message })
  });
  if (!response.ok) console.error(`Alert webhook failed: ${response.status}`);
}
__name(notify, "notify");
__name2(notify, "notify");
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
__name(escapeHtml, "escapeHtml");
__name2(escapeHtml, "escapeHtml");
function metaLine(job) {
  const parts = [];
  if (job.location) parts.push(escapeHtml(job.location));
  if (job.salary) parts.push(escapeHtml(job.salary));
  if (job.source) parts.push(escapeHtml(job.source));
  return parts.join(" &nbsp;\xB7&nbsp; ");
}
__name(metaLine, "metaLine");
__name2(metaLine, "metaLine");
function freshness(postedAt, now) {
  const posted = Date.parse(postedAt || "");
  if (!Number.isFinite(posted)) {
    return { label: "Posted date not listed", bg: "#f1f5f9", fg: "#556174" };
  }
  const days = Math.max(0, Math.floor((now.getTime() - posted) / 864e5));
  if (days <= 2) {
    const label = days === 0 ? "Posted today" : days === 1 ? "Posted yesterday" : `Posted ${days} days ago`;
    return { label, bg: "#dcfce7", fg: "#15803d" };
  }
  if (days <= 7) {
    return { label: `Posted ${days} days ago`, bg: "#fef3c7", fg: "#b45309" };
  }
  const dateLabel = new Date(posted).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { label: `Posted ${dateLabel} (${days} days ago)`, bg: "#f1f5f9", fg: "#556174" };
}
__name(freshness, "freshness");
__name2(freshness, "freshness");
var WORKPLACE_LABELS = ["Remote", "Hybrid", "On-site"];
// A <tr> that contains no nested <tr> and holds the workplace token, so the whole
// badge row can be dropped when workplace type is Unclear/missing.
var WORKPLACE_ROW_PATTERN = /<tr[^>]*>(?:(?!<\/?tr)[\s\S])*\{\{WORKPLACE_LABEL\}\}(?:(?!<\/?tr)[\s\S])*<\/tr>\s*/g;
function fillCard(cardTemplate, job, now) {
  const fresh = freshness(job.posted_at, now);
  const workplace = WORKPLACE_LABELS.includes(job.workplace_type) ? job.workplace_type : null;
  const base = workplace ? cardTemplate.replaceAll("{{WORKPLACE_LABEL}}", workplace) : cardTemplate.replace(WORKPLACE_ROW_PATTERN, "");
  return base.replaceAll("{{COMPANY}}", escapeHtml(job.company)).replaceAll("{{TITLE}}", escapeHtml(job.title)).replaceAll("{{URL}}", escapeHtml(job.url)).replaceAll("{{META_LINE}}", metaLine(job)).replaceAll("{{MATCH_REASON}}", escapeHtml(job.match_reason)).replaceAll("{{POSTED_LABEL}}", fresh.label).replaceAll("{{POSTED_BG}}", fresh.bg).replaceAll("{{POSTED_FG}}", fresh.fg);
}
__name(fillCard, "fillCard");
__name2(fillCard, "fillCard");
async function loadEmailTemplate(env, fetcher = fetch) {
  const url = env.EMAIL_TEMPLATE_URL || EMAIL_TEMPLATE_URL;
  const response = await fetcher(url, { cf: { cacheTtl: 0, cacheEverything: false } });
  if (!response.ok) throw new Error(`template_fetch_failed_${response.status}`);
  return response.text();
}
__name(loadEmailTemplate, "loadEmailTemplate");
__name2(loadEmailTemplate, "loadEmailTemplate");
function buildEmail({ template, candidate, jobs, now }) {
  // Accept markers whether bare (JOB_CARD_START) or comment-wrapped (<!-- JOB_CARD_START -->).
  // Anchor on <tr>...</tr> so instructional prose that merely names the markers can't match.
  const match = template.match(
    /(?:<!--\s*)?JOB_CARD_START(?:\s*-->)?\s*(<tr[\s\S]*?<\/tr>)\s*(?:<!--\s*)?JOB_CARD_END(?:\s*-->)?/
  );
  if (!match) throw new Error("template_missing_job_card_block");
  const cardTemplate = match[1];
  const cardsHtml = jobs.map((job) => fillCard(cardTemplate, job, now)).join("\n");
  const headline = `${jobs.length} new match${jobs.length === 1 ? "" : "es"} for you`;
  const runDate = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const firstName = String(candidate.name || "").trim().split(/\s+/)[0] || "there";
  const html = template
    .replace(match[0], "")
    .replace(/<!--[\s\S]*?-->/g, (comment) => /^<!--\s*\[if\b/i.test(comment) || /^<!--\s*<!\[endif\]/i.test(comment) ? comment : "")
    .replace("{{JOB_CARDS}}", cardsHtml)
    .replaceAll("{{HEADLINE}}", escapeHtml(headline))
    .replaceAll("{{RUN_DATE}}", escapeHtml(runDate))
    .replaceAll("{{FIRST_NAME}}", escapeHtml(firstName));
  const leaked = html.match(/\{\{\s*[\w.-]+\s*\}\}/);
  if (leaked) throw new Error(`email_token_leak:${leaked[0].replace(/[^\w.-]/g, "")}`);
  return { html, subject: headline };
}
__name(buildEmail, "buildEmail");
__name2(buildEmail, "buildEmail");
function fallbackEmail({ candidate, jobs }) {
  const firstName = String(candidate.name || "").trim().split(/\s+/)[0] || "there";
  const lines = jobs.map((job) => {
    const posted = job.posted_at || "date not listed";
    const metadata = [job.location || "Remote", job.salary, job.source].filter(Boolean).join(" · ");
    return `${job.company} – ${job.title} (${metadata}) — posted ${posted}
${job.match_reason}
${job.url}`;
  });
  const subject = `${jobs.length} new match${jobs.length === 1 ? "" : "es"} for you`;
  const text = `Hi ${firstName},

${lines.join("\n\n")}
`;
  return { text, subject };
}
__name(fallbackEmail, "fallbackEmail");
__name2(fallbackEmail, "fallbackEmail");
async function sendEmail(env, { to, subject, html, text }, fetcher = fetch) {
  if (!env.RESEND_API_KEY) throw new Error("resend_api_key_missing");
  const from = env.RESEND_FROM_ADDRESS || DEFAULT_FROM_ADDRESS;
  const body = { from, to: [to], subject, ...html ? { html } : {}, ...text ? { text } : {} };
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`resend_${response.status}:${detail}`);
  }
  return response.json();
}
__name(sendEmail, "sendEmail");
__name2(sendEmail, "sendEmail");
function authorizedSend(request, env) {
  const expected = String(env.SEND_API_TOKEN || "").trim();
  const supplied = String(request.headers.get("authorization") || "").trim();
  return Boolean(expected) && supplied === `Bearer ${expected}`;
}
__name(authorizedSend, "authorizedSend");
__name2(authorizedSend, "authorizedSend");
function sanitizeJob(raw) {
  const job = {
    title: String(raw?.title || "").slice(0, 300),
    company: String(raw?.company || "").slice(0, 300),
    url: String(raw?.url || "").trim(),
    location: String(raw?.location || "").slice(0, 300),
    salary: String(raw?.salary || "").trim().slice(0, 120),
    source: String(raw?.source || "").slice(0, 100),
    posted_at: String(raw?.posted_at || "").slice(0, 40),
    workplace_type: String(raw?.workplace_type || "").trim().slice(0, 20),
    match_reason: String(raw?.match_reason || "").slice(0, 1900),
    job_summary: String(raw?.job_summary || "").slice(0, 1900),
    key_requirements: String(raw?.key_requirements || "").slice(0, 1900)
  };
  if (!/^https?:\/\//.test(job.url) || !job.title || !job.company) return null;
  return job;
}
__name(sanitizeJob, "sanitizeJob");
__name2(sanitizeJob, "sanitizeJob");
async function handleSendEmail(request, env) {
  if (!env.NOTION_TOKEN || !env.RESEND_API_KEY) {
    return json({ ok: false, error: "worker_misconfigured" }, 500);
  }
  const body = await request.json().catch(() => null);
  const email = String(body?.candidate_email || "").trim().toLowerCase();
  if (!body || !email || !Array.isArray(body.jobs) || !body.jobs.length) {
    return json({ ok: false, error: "invalid_payload: require candidate_email and a non-empty jobs array" }, 400);
  }
  const candidate = { email, name: String(body.candidate_name || "").slice(0, 200) };
  const jobs = body.jobs.slice(0, 20).map(sanitizeJob).filter(Boolean);
  if (!jobs.length) return json({ ok: false, error: "no_valid_jobs: each job needs title, company, and an http(s) url" }, 400);
  let emailTemplate = null;
  let templateError = null;
  try {
    emailTemplate = await loadEmailTemplate(env);
  } catch (error) {
    templateError = String(error.message || error).slice(0, 160);
  }
  const now = /* @__PURE__ */ new Date();
  const emailJobs = await resolveApplyLinks(jobs);
  let emailPayload;
  try {
    emailPayload = emailTemplate ? buildEmail({ template: emailTemplate, candidate, jobs: emailJobs, now }) : fallbackEmail({ candidate, jobs: emailJobs });
  } catch (error) {
    templateError = String(error.message || error).slice(0, 160);
    emailPayload = fallbackEmail({ candidate, jobs: emailJobs });
  }
  try {
    await sendEmail(env, { to: candidate.email, subject: emailPayload.subject, html: emailPayload.html, text: emailPayload.text });
  } catch (error) {
    return json({ ok: false, error: `send_failed: ${String(error.message).slice(0, 200)}` }, 502);
  }
  const schema = await sentPostingSchema(env);
  const logged = [];
  const logFailed = [];
  for (const job of jobs) {
    try {
      await saveJob(env, schema, candidate, job, now, "Emailed", "Job Scout dispatcher");
      logged.push(job.url);
    } catch (error) {
      logFailed.push({ url: job.url, error: String(error.message).slice(0, 200) });
    }
  }
  return json({
    ok: logFailed.length === 0,
    sent: true,
    used_fallback_text: !emailTemplate || Boolean(templateError),
    template_error: templateError,
    logged,
    log_failed: logFailed
  });
}
__name(handleSendEmail, "handleSendEmail");
__name2(handleSendEmail, "handleSendEmail");
async function connectionCheck(env) {
  const [candidates, search, modelResponse] = await Promise.all([
    notion(env, `databases/${CANDIDATES_DB}`),
    notion(env, "search", "POST", {
      query: "Sent Postings",
      filter: { property: "object", value: "database" },
      page_size: 20
    }),
    fetch(`https://api.openai.com/v1/models/${encodeURIComponent(env.OPENAI_MODEL || "gpt-5-mini")}`, {
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` }
    })
  ]);
  if (!modelResponse.ok) throw new Error(`OpenAI connection: ${modelResponse.status} ${(await modelResponse.text()).slice(0, 300)}`);
  const model = await modelResponse.json();
  const postings = (search.results || []).map((database) => ({
    id: database.id,
    title: database.title?.map((item) => item.plain_text || "").join("") || "Untitled"
  }));
  return {
    ok: true,
    notion: {
      candidates: candidates.title?.[0]?.plain_text || "Candidates",
      postings
    },
    openai: { model: model.id },
    resend: { configured: Boolean(env.RESEND_API_KEY), from: env.RESEND_FROM_ADDRESS || DEFAULT_FROM_ADDRESS }
  };
}
__name(connectionCheck, "connectionCheck");
__name2(connectionCheck, "connectionCheck");
async function dispatch(env, { dryRun = false, force = false } = {}) {
  const enabled = String(env.BACKUP_ENABLED).toLowerCase() === "true";
  if (!enabled && !dryRun) return { ok: true, skipped: "disabled" };
  if (!env.NOTION_TOKEN || !env.OPENAI_API_KEY || !env.BACKUP_STATE) throw new Error("Missing NOTION_TOKEN, OPENAI_API_KEY, or BACKUP_STATE");
  if (!dryRun && !env.RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
  const now = /* @__PURE__ */ new Date();
  const budget = await budgetState(env);
  const budgetLimit = Number(env.MONTHLY_BUDGET_USD || 4.5);
  if (budget.value >= budgetLimit) {
    await notify(env, `Job Scout backup paused: its internal ${monthKey()} estimate reached $${budget.value.toFixed(2)} of the $${budgetLimit.toFixed(2)} limit.`);
    return { ok: true, skipped: "budget", estimated_spend: budget.value };
  }
  const [candidatePages, postingPages] = await Promise.all([
    queryAll(env, CANDIDATES_DB, { filter: { property: "Status", select: { equals: "Active" } } }),
    queryAll(env, SENT_POSTINGS_DB, { sorts: [{ property: "Date sent", direction: "descending" }] })
  ]);
  const candidates = candidatePages.map(candidateState).filter((candidate) => candidate.email && !candidate.email.endsWith("@example.com"));
  const postings = postingPages.map(postingState);
  const stale = candidates.filter((candidate) => force || isStale(candidate, postings, now.getTime()));
  const max = Math.max(1, Number(env.MAX_CANDIDATES_PER_RUN || 2));
  const selected = [];
  for (const candidate of stale) {
    const lastAttempt = Number(await env.BACKUP_STATE.get(`attempt:${candidate.id}`)) || 0;
    if (force || now.getTime() - lastAttempt >= staleHours(candidate.frequency) * 60 * 60 * 1e3) selected.push(candidate);
    if (selected.length >= max) break;
  }
  if (dryRun) return { ok: true, dry_run: true, active: candidates.length, stale: stale.length, selected: selected.map((c) => ({ id: c.id, email: c.email, frequency: c.frequency })) };
  if (!selected.length) return { ok: true, active: candidates.length, stale: stale.length, dispatched: 0 };
  const schema = await sentPostingSchema(env);
  let emailTemplate = null;
  let templateError = null;
  try {
    emailTemplate = await loadEmailTemplate(env);
  } catch (error) {
    templateError = String(error.message || error).slice(0, 160);
    console.error("Falling back to plain-text email:", templateError);
  }
  let spent = budget.value;
  let saved = 0;
  let emailed = 0;
  const failures = [];
  for (const candidate of selected) {
    if (spent >= budgetLimit) break;
    await env.BACKUP_STATE.put(`attempt:${candidate.id}`, String(now.getTime()), { expirationTtl: 35 * 24 * 60 * 60 });
    try {
      const previous = postings.filter((p) => p.email === candidate.email).map((p) => p.url).filter(Boolean);
      const resumeText = await candidateResume(env, candidate.id);
      const { jobs, response } = await scoutJobs(env, candidate, previous, resumeText);
      const previousSet = new Set(previous.map((url) => url.replace(/\/$/, "").toLowerCase()));
      const unique = jobs.filter((job) => /^https?:\/\//.test(job.url) && !previousSet.has(job.url.replace(/\/$/, "").toLowerCase()));
      spent += estimateCost(response, env);
      await env.BACKUP_STATE.put(budget.key, String(spent), { expirationTtl: 45 * 24 * 60 * 60 });
      if (!unique.length) continue;
      const emailJobs = await resolveApplyLinks(unique);
      let emailPayload;
      try {
        emailPayload = emailTemplate ? buildEmail({ template: emailTemplate, candidate, jobs: emailJobs, now }) : fallbackEmail({ candidate, jobs: emailJobs });
      } catch (error) {
        console.error("Falling back to plain-text email:", String(error.message || error).slice(0, 160));
        emailPayload = fallbackEmail({ candidate, jobs: emailJobs });
      }
      await sendEmail(env, {
        to: candidate.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text
      });
      emailed += 1;
      for (const job of unique) {
        await saveJob(env, schema, candidate, job, now, "Emailed");
        saved += 1;
      }
    } catch (error) {
      failures.push({ candidate: candidate.id, error: String(error.message).slice(0, 220) });
      console.error(error);
    }
  }
  const templateNote = templateError ? ` (template fetch failed, sent plain text)` : "";
  await notify(env, `Job Scout backup activated for ${selected.length} member${selected.length === 1 ? "" : "s"}; emailed ${emailed}, saved ${saved} job${saved === 1 ? "" : "s"}${templateNote}. Estimated ${monthKey()} backup spend: $${spent.toFixed(2)} / $${budgetLimit.toFixed(2)}.`);
  return { ok: failures.length === 0, candidates: selected.length, emailed, saved, failures, estimated_spend: spent, budget: budgetLimit };
}
__name(dispatch, "dispatch");
__name2(dispatch, "dispatch");
function authorized(request, env) {
  const expected = String(env.ADMIN_TOKEN || "").trim();
  const supplied = String(request.headers.get("authorization") || "").trim();
  return Boolean(expected) && supplied === `Bearer ${expected}`;
}
__name(authorized, "authorized");
__name2(authorized, "authorized");
var worker_default = {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/send-email") {
      if (!authorizedSend(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
      return handleSendEmail(request, env);
    }
    if (!authorized(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
    if (request.method === "GET" && url.pathname === "/status") {
      const budget = await budgetState(env);
      return json({ ok: true, enabled: String(env.BACKUP_ENABLED).toLowerCase() === "true", month: monthKey(), estimated_spend: budget.value, budget: Number(env.MONTHLY_BUDGET_USD || 4.5), resend_configured: Boolean(env.RESEND_API_KEY) });
    }
    if (request.method === "GET" && url.pathname === "/check") {
      return json(await connectionCheck(env));
    }
    if (request.method === "POST" && url.pathname === "/run") {
      const body = await request.json().catch(() => ({}));
      return json(await dispatch(env, { dryRun: body.dry_run !== false, force: body.force === true }));
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};
export {
  JOB_SCHEMA,
  buildEmail,
  worker_default as default,
  estimateCost,
  fallbackEmail,
  isStale,
  saveJob,
  sanitizeJob,
  scoutJobs,
  staleHours
};
//# sourceMappingURL=worker.js.map
