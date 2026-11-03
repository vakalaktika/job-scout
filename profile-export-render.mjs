// profile-export-render.mjs
// Renders the data from profile-export.mjs as Markdown or as a self-contained
// HTML page that prints cleanly to PDF. Every field is member- or posting-supplied
// text, so everything is escaped here and nothing else in the export path has to
// think about it. No external resources: a recruiter can open the file offline.
import { isPublicHttpUrl } from "./public-url.mjs";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const NOT_SET = "Not set";
const AI_DISCLAIMER = "AI-generated from member-supplied data; unverified.";
const STEER_MODE_LABEL = { hide: "Hide", "rank": "Rank lower" };

const orNotSet = (value) => (String(value ?? "").trim() ? String(value).trim() : NOT_SET);
const list = (values) => (values && values.length ? values.join(", ") : NOT_SET);
const countList = (entries) => entries.map(({ label, count }) => `${label} (${count})`);

const formatDate = (iso) => {
  const parsed = new Date(String(iso || ""));
  return Number.isNaN(parsed.getTime()) ? String(iso || "") : parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
};

const location = (preferences) => {
  const parts = [preferences.region_city, preferences.region_state, preferences.region_country].filter(Boolean);
  if (preferences.regions && preferences.regions !== parts.join(", ")) return preferences.regions;
  return parts.join(", ");
};

// Reasons are the Worker's own fixed codes; anything else is dropped rather than
// printed, so no upstream error text can reach the file.
const narrativeReason = (narrative) =>
  /^[a-z_]+$/.test(narrative.reason || "") && narrative.reason !== "narrative_skipped" ? narrative.reason : "";

const narrativeLine = (narrative) => {
  if (narrative.status === "ready" && narrative.text) return narrative.text;
  const reason = narrativeReason(narrative);
  return `AI summary unavailable.${reason ? ` (${reason})` : ""}`;
};

// Rows shared by both renderers so the two formats never drift.
const preferenceRows = (profile) => {
  const p = profile.preferences;
  return [
    ["Target roles", orNotSet(p.target_roles)],
    ["Role keywords", orNotSet(p.keywords)],
    ["Seniority", orNotSet(p.seniority)],
    ["Preferred locations", orNotSet(location(p))],
    ["Open to remote", orNotSet(p.remote)],
    ["Work modes", list(p.work_modes)],
    ["Minimum salary", orNotSet(p.min_salary)],
    ["Maximum salary", orNotSet(p.max_salary)],
    ["Posted within", orNotSet(p.posted_within)],
    ["Max travel", orNotSet(p.max_travel)],
  ];
};

const steeringRows = (profile) => {
  const p = profile.preferences;
  return [
    ["Steer away from", orNotSet(p.steer_away_terms)],
    ["Steer mode", STEER_MODE_LABEL[p.steer_away_mode] || STEER_MODE_LABEL.rank],
    ["Résumé-derived suggestions", list(p.resume_suggestions)],
  ];
};

const contactRows = (profile) => [
  ["Email", orNotSet(profile.email)],
  ["Status", orNotSet(profile.status)],
  ["Delivery frequency", orNotSet(profile.frequency)],
  ["Notion record", orNotSet(profile.id)],
  ["Generated", formatDate(profile.generated_at)],
];

const glanceRows = (group) => [
  ["Top companies", list(countList(group.companies))],
  ["Top domains", list(countList(group.domains))],
  ["Top locations", list(countList(group.locations))],
  ["Workplace mix", list(countList(group.workplace_types))],
  ["Salary ranges seen", list(group.salaries)],
];

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

// Free text goes into tables and list items, so every Markdown metacharacter is
// escaped (backslash first) and angle brackets are entity-encoded: a member's
// name or a scraped company string must not be able to add links, images, or raw
// HTML to a document a recruiter trusts.
const mdCell = (value) =>
  String(value ?? "")
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/[|*_`[\]]/g, (char) => `\\${char}`)
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

// A validated URL is re-serialised by the URL parser so it carries no newlines
// or unencoded characters, and parentheses are encoded so the link cannot close
// itself early in Markdown.
const safeHref = (url) => {
  if (!isPublicHttpUrl(url)) return "";
  return new URL(url).href.replaceAll("(", "%28").replaceAll(")", "%29");
};

// Cells arrive already escaped (mdCell) or already built (mdLink).
const mdTable = (headers, rows) => {
  if (!rows.length) return "";
  return [
    `| ${headers.map(mdCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
};

const mdNarrative = (narrative) => {
  if (narrative.status === "ready" && narrative.text) return mdCell(narrative.text);
  const reason = narrativeReason(narrative);
  return `AI summary unavailable.${reason ? ` (\`${reason}\`)` : ""}`;
};

const mdPairs = (rows) => rows.map(([label, value]) => `- **${mdCell(label)}:** ${mdCell(value)}`).join("\n");

// A fence must be longer than any backtick run inside the text, otherwise a résumé
// containing ``` would end the block early.
const mdFence = (body) => {
  const longest = Math.max(2, ...[...String(body).matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${body}\n${fence}`;
};

const mdLink = (label, url) => {
  const href = safeHref(url);
  return href ? `[${mdCell(label) || "Link"}](${href})` : mdCell(label);
};

function renderMemberMarkdown(profile, index, total) {
  const d = profile.decisions;
  const anchor = total > 1 ? `\n\n<a id="member-${index + 1}"></a>` : "";
  const sections = [
    `# ${mdCell(profile.name) || "Unnamed member"}${anchor}`,
    `## Contact & status\n\n${mdPairs(contactRows(profile))}`,
    `## What they're looking for\n\n${mdPairs(preferenceRows(profile))}`,
    `## Steering\n\n${mdPairs(steeringRows(profile))}`,
    `## Match context (newest first)\n\n${
      profile.match_context.length ? profile.match_context.map((line) => `- ${mdCell(line)}`).join("\n") : "None recorded."
    }`,
    `## Notes\n\n${profile.notes_raw ? mdFence(profile.notes_raw) : "No notes recorded."}`,
    `## Saved vs passed at a glance\n\n${mdPairs([
      ["Recommendations", d.counts.total],
      ["Saved", d.counts.saved],
      ["Passed", d.counts.passed],
      ["Awaiting review", d.counts.awaiting_review],
      ["Applied", d.counts.applied],
    ])}\n\n### Saved\n\n${mdPairs(glanceRows(d.saved))}\n\n### Passed\n\n${mdPairs([
      ...glanceRows(d.passed),
      ["Pass reasons", list(countList(d.passed.reasons))],
    ])}`,
    `### Saved jobs\n\n${
      d.saved.jobs.length
        ? mdTable(
            ["Title", "Company", "Location", "Salary", "Status", "Link"],
            d.saved.jobs.map((job) => [
              mdCell(job.title),
              mdCell(job.company),
              mdCell(job.location),
              mdCell(job.salary),
              mdCell(job.application_status),
              job.url ? mdLink("Posting", job.url) : "",
            ]),
          )
        : "No saved jobs yet."
    }`,
    `### Passed jobs\n\n${
      d.passed.jobs.length
        ? mdTable(
            ["Title", "Company", "Reason", "Note"],
            d.passed.jobs.map((job) => [job.title, job.company, job.reason, job.note].map(mdCell)),
          )
        : "No passed jobs yet."
    }`,
    `## AI summary\n\n_${AI_DISCLAIMER}_\n\n${mdNarrative(profile.narrative)}`,
    `## Résumé\n\n**File:** ${mdCell(profile.resume_filename) || "No file recorded"}\n\n${
      profile.resume_text ? mdFence(profile.resume_text) : "No résumé text on file."
    }`,
  ];
  return sections.join("\n\n");
}

export function renderProfileMarkdown(exports, { generatedAt } = {}) {
  const stamp = formatDate(generatedAt || exports[0]?.generated_at);
  if (exports.length === 1) return `${renderMemberMarkdown(exports[0], 0, 1)}\n`;
  const toc = exports.map((profile, index) => `${index + 1}. [${mdCell(profile.name) || "Unnamed member"}](#member-${index + 1})`);
  const header = `# Job Scout member profiles\n\n${exports.length} members · generated ${stamp}\n\n${toc.join("\n")}`;
  return `${[header, ...exports.map((profile, index) => renderMemberMarkdown(profile, index, exports.length))].join("\n\n---\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const STYLE = [
  ":root{color-scheme:light}",
  "body{margin:0;padding:32px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#211f1c;background:#fff}",
  "main{max-width:880px;margin:0 auto}",
  "h1{margin:0 0 4px;font-size:26px;letter-spacing:-.02em}h2{margin:28px 0 8px;font-size:17px;border-bottom:1px solid #ddd;padding-bottom:4px}h3{margin:18px 0 6px;font-size:14px}",
  "table{border-collapse:collapse;width:100%;margin:6px 0 12px;font-size:13px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f2ee}",
  "dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:6px 0 12px}dt{font-weight:600;color:#54504a}dd{margin:0}",
  "pre{white-space:pre-wrap;word-break:break-word;background:#f7f6f3;border:1px solid #e5e2dc;border-radius:6px;padding:12px;font-size:12px}",
  ".muted{color:#6f6a63}.glance{display:grid;grid-template-columns:1fr 1fr;gap:16px}.counts{display:flex;flex-wrap:wrap;gap:14px;margin:6px 0 12px}.counts span strong{display:block;font-size:20px}",
  "nav ol{margin:8px 0 0;padding-left:20px}article.member+article.member{break-before:page;margin-top:40px}",
  "@page{margin:16mm}@media print{body{padding:0}a{color:inherit;text-decoration:none}}",
].join("");

const htmlPairs = (rows) =>
  `<dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;

const htmlTable = (headers, rows) =>
  `<table><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;

const htmlLink = (label, url) => {
  const href = safeHref(url);
  return href
    ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(url ? label : "");
};

const htmlList = (items, empty) =>
  items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="muted">${escapeHtml(empty)}</p>`;

function renderMemberHtml(profile, index) {
  const d = profile.decisions;
  const counts = [
    ["Recommendations", d.counts.total],
    ["Saved", d.counts.saved],
    ["Passed", d.counts.passed],
    ["Awaiting review", d.counts.awaiting_review],
    ["Applied", d.counts.applied],
  ]
    .map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`)
    .join("");
  return `<article class="member" id="member-${index + 1}">
<h1>${escapeHtml(profile.name) || "Unnamed member"}</h1>
<p class="muted">${escapeHtml(profile.email)}</p>
<h2>Contact &amp; status</h2>${htmlPairs(contactRows(profile))}
<h2>What they're looking for</h2>${htmlPairs(preferenceRows(profile))}
<h2>Steering</h2>${htmlPairs(steeringRows(profile))}
<h2>Match context (newest first)</h2>${htmlList(profile.match_context, "None recorded.")}
<h2>Notes</h2>${profile.notes_raw ? `<pre>${escapeHtml(profile.notes_raw)}</pre>` : '<p class="muted">No notes recorded.</p>'}
<h2>Saved vs passed at a glance</h2><div class="counts">${counts}</div>
<div class="glance"><section><h3>Saved</h3>${htmlPairs(glanceRows(d.saved))}</section><section><h3>Passed</h3>${htmlPairs([
    ...glanceRows(d.passed),
    ["Pass reasons", list(countList(d.passed.reasons))],
  ])}</section></div>
<h3>Saved jobs</h3>${
    d.saved.jobs.length
      ? htmlTable(
          ["Title", "Company", "Location", "Salary", "Status", "Link"],
          d.saved.jobs.map((job) => [
            escapeHtml(job.title),
            escapeHtml(job.company),
            escapeHtml(job.location),
            escapeHtml(job.salary),
            escapeHtml(job.application_status),
            htmlLink("Posting", job.url),
          ]),
        )
      : '<p class="muted">No saved jobs yet.</p>'
  }
<h3>Passed jobs</h3>${
    d.passed.jobs.length
      ? htmlTable(
          ["Title", "Company", "Reason", "Note"],
          d.passed.jobs.map((job) => [escapeHtml(job.title), escapeHtml(job.company), escapeHtml(job.reason), escapeHtml(job.note)]),
        )
      : '<p class="muted">No passed jobs yet.</p>'
  }
<h2>AI summary</h2><p class="muted">${escapeHtml(AI_DISCLAIMER)}</p><p>${escapeHtml(narrativeLine(profile.narrative))}</p>
<h2>Résumé</h2><p><strong>File:</strong> ${escapeHtml(profile.resume_filename) || "No file recorded"}</p>${
    profile.resume_text ? `<pre>${escapeHtml(profile.resume_text)}</pre>` : '<p class="muted">No résumé text on file.</p>'
  }
</article>`;
}

export function renderProfileHtml(exports, { generatedAt } = {}) {
  const stamp = formatDate(generatedAt || exports[0]?.generated_at);
  const title =
    exports.length === 1 ? `${exports[0].name || "Member"} · Job Scout profile` : `Job Scout member profiles (${exports.length})`;
  const header =
    exports.length === 1
      ? ""
      : `<header><h1>Job Scout member profiles</h1><p class="muted">${exports.length} members · generated ${escapeHtml(stamp)}</p><nav aria-label="Members"><ol>${exports
          .map((profile, index) => `<li><a href="#member-${index + 1}">${escapeHtml(profile.name) || "Unnamed member"}</a></li>`)
          .join("")}</ol></nav></header>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>${header}${exports.map(renderMemberHtml).join("\n")}</main>
</body>
</html>
`;
}
