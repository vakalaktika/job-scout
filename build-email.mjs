// build-email.mjs
// Job Scout — match-alert email builder (drop-in fix for the dispatcher routine
// trig_01LZtNUf7LVFzw3C2Fyy9QEw).
//
// Fixes the bug where {{WORKPLACE_LABEL}} leaked into sent emails. This module
// fills the card exemplar in email-template.html per posting, substitutes the
// workplace type when it is Remote / Hybrid / On-site, DELETES the entire
// workplace-badge <tr> when it is Unclear or missing, fills all other tokens,
// and hard-fails if ANY {{...}} token would survive in the sent HTML.
//
// Pure ESM, no dependencies. Works in Node and in Supabase Edge Functions (Deno).
//
//   import { buildEmail } from "./build-email.mjs";
//   const html = buildEmail(templateHtml, { headline, runDate, firstName }, postings);
//   if (html === null) { /* zero postings -> do not send */ }

/** The three printable workplace values, canonicalised. Anything else = delete row. */
const WORKPLACE_CANON = { remote: "Remote", hybrid: "Hybrid", "on-site": "On-site", onsite: "On-site" };

/**
 * @typedef {Object} Posting
 * @property {string}  title           Exact job title.
 * @property {string}  url             Direct link to the posting.
 * @property {string}  company         Company name.
 * @property {string}  location        e.g. "San Diego, CA".
 * @property {string=} salary          e.g. "$170k–$200k". Omitted from meta line if falsy.
 * @property {string}  source          e.g. "LinkedIn".
 * @property {string=} workplace_type  "Remote" | "Hybrid" | "On-site" | "Unclear" | null.
 * @property {string}  matchReason     One sentence on why it fits.
 * @property {number=} postedDaysAgo   Whole days since posting; null/undefined = unknown.
 * @property {(string|Date)=} postedDate  Used for the "Posted Jul 3" style label when 8+ days old.
 */

/**
 * Build the full email HTML from the template and a list of postings.
 * Returns null when there are no postings to send (caller must not send).
 *
 * @param {string} templateHtml       Raw contents of email-template.html.
 * @param {{headline:string, runDate:string, firstName:string}} email
 * @param {Posting[]} postings
 * @param {{ keepPosting?: (p:Posting)=>boolean }} [opts]
 *        keepPosting: optional predicate for pre-checked link liveness. Postings
 *        for which it returns false are dropped (see the template's "check that
 *        every posting URL is still live" note). Liveness checks that require
 *        the network are the caller's job; this builder stays pure.
 * @returns {string|null}
 */
export function buildEmail(templateHtml, email, postings, opts = {}) {
  const keep = opts.keepPosting ?? (() => true);

  // Freshest first, unknown dates last. Stable enough for display order.
  const live = postings
    .filter(keep)
    .slice()
    .sort((a, b) => rank(a.postedDaysAgo) - rank(b.postedDaysAgo));

  // Zero new postings -> do not send at all.
  if (live.length === 0) return null;

  // The dispatcher strips HTML comments BEFORE locating the card markers, so the
  // instructional exemplar comment above the card disappears here too.
  const stripped = stripHtmlComments(templateHtml);

  const exemplar = extractExemplar(stripped);
  const cards = live.map((p) => fillCard(exemplar, p)).join("\n");

  let html = removeExemplarBlock(stripped);          // remove JOB_CARD_START..END
  html = replaceAll(html, "{{JOB_CARDS}}", cards);   // drop cards in their place
  html = replaceAll(html, "{{HEADLINE}}", escapeHtml(email.headline));
  html = replaceAll(html, "{{RUN_DATE}}", escapeHtml(email.runDate));
  html = replaceAll(html, "{{FIRST_NAME}}", escapeHtml(email.firstName));

  assertNoTokensLeft(html); // a surviving {{...}} is a shipped bug — fail loudly.
  return html;
}

// ---------------------------------------------------------------------------
// Per-card fill
// ---------------------------------------------------------------------------

function fillCard(exemplar, p) {
  let card = exemplar;

  // --- THE FIX: workplace badge -------------------------------------------
  const label = canonicalWorkplace(p.workplace_type);
  if (label) {
    card = replaceAll(card, "{{WORKPLACE_LABEL}}", escapeHtml(label));
  } else {
    // "Unclear" or missing -> delete the ENTIRE workplace-badge <tr>.
    // Never print "Unclear", never leave an empty pill, never leak the token.
    card = removeRowContaining(card, "{{WORKPLACE_LABEL}}");
  }
  // ------------------------------------------------------------------------

  const posted = freshness(p.postedDaysAgo, p.postedDate);
  card = replaceAll(card, "{{COMPANY}}", escapeHtml(p.company));
  card = replaceAll(card, "{{TITLE}}", escapeHtml(p.title));
  card = replaceAll(card, "{{URL}}", escapeAttr(p.url));
  card = replaceAll(card, "{{META_LINE}}", buildMetaLine(p));
  card = replaceAll(card, "{{MATCH_REASON}}", escapeHtml(p.matchReason));
  card = replaceAll(card, "{{POSTED_LABEL}}", escapeHtml(posted.label));
  card = replaceAll(card, "{{POSTED_BG}}", posted.bg);
  card = replaceAll(card, "{{POSTED_FG}}", posted.fg);
  return card;
}

/** "City, State  ·  $salary  ·  Source" — salary segment omitted when absent. */
function buildMetaLine(p) {
  const parts = [p.location, p.salary, p.source]
    .filter((s) => s != null && String(s).trim() !== "")
    .map((s) => escapeHtml(String(s)));
  return parts.join(" &nbsp;·&nbsp; ");
}

/** Return canonical "Remote"/"Hybrid"/"On-site", or null for Unclear/missing/other. */
function canonicalWorkplace(v) {
  if (v == null) return null;
  const key = String(v).trim().toLowerCase();
  return WORKPLACE_CANON[key] ?? null; // "unclear" and anything unexpected -> null
}

// ---------------------------------------------------------------------------
// Freshness pill
// ---------------------------------------------------------------------------

function freshness(daysAgo, postedDate) {
  if (daysAgo == null || Number.isNaN(Number(daysAgo))) {
    return { label: "Posting date not listed", bg: "#f1f5f9", fg: "#94a3b8" };
  }
  const d = Math.max(0, Math.floor(Number(daysAgo)));
  const color =
    d <= 2 ? { bg: "#dcfce7", fg: "#15803d" }
    : d <= 7 ? { bg: "#fef3c7", fg: "#b45309" }
    : { bg: "#f1f5f9", fg: "#64748b" };

  let label;
  if (d === 0) label = "Posted today";
  else if (d === 1) label = "Posted yesterday";
  else if (d <= 7) label = `Posted ${d} days ago`;
  else {
    const md = postedDate ? shortDate(postedDate) : null;
    label = md ? `Posted ${md} (${d} days ago)` : `Posted ${d} days ago`;
  }
  return { label, ...color };
}

function shortDate(v) {
  const dt = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getUTCMonth()];
  return `${m} ${dt.getUTCDate()}`;
}

function rank(daysAgo) {
  return daysAgo == null || Number.isNaN(Number(daysAgo)) ? Infinity : Number(daysAgo);
}

// ---------------------------------------------------------------------------
// Template surgery
// ---------------------------------------------------------------------------

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function extractExemplar(html) {
  const start = html.indexOf("JOB_CARD_START");
  const end = html.indexOf("JOB_CARD_END");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("build-email: JOB_CARD_START / JOB_CARD_END markers not found in template.");
  }
  return html.slice(start + "JOB_CARD_START".length, end).trim();
}

function removeExemplarBlock(html) {
  const start = html.indexOf("JOB_CARD_START");
  const end = html.indexOf("JOB_CARD_END");
  const after = end + "JOB_CARD_END".length;
  return html.slice(0, start) + html.slice(after);
}

/**
 * Remove the single <tr>…</tr> that contains `needle`. The workplace-badge row
 * contains no nested <tr>, so nearest-enclosing matching is exact.
 */
function removeRowContaining(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) return html;
  const open = html.lastIndexOf("<tr", at);
  const closeIdx = html.indexOf("</tr>", at);
  if (open === -1 || closeIdx === -1) return html;
  const close = closeIdx + "</tr>".length;
  // Also swallow the blank line left behind so the card stays tidy.
  return (html.slice(0, open) + html.slice(close)).replace(/\n[ \t]*\n[ \t]*\n/g, "\n\n");
}

function assertNoTokensLeft(html) {
  const leaked = [...html.matchAll(/\{\{\s*[\w.-]+\s*\}\}/g)].map((m) => m[0]);
  if (leaked.length) {
    const unique = [...new Set(leaked)];
    throw new Error(`build-email: refusing to send — unfilled placeholder(s) survived: ${unique.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(v) {
  return escapeHtml(v).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function replaceAll(haystack, find, repl) {
  return haystack.split(find).join(repl);
}
