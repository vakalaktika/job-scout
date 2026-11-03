// profile-export.mjs
// Turns one member record plus their sent postings and résumé text into the plain
// data a recruiter-facing export is rendered from. Pure: no Notion, no fetch, no
// mutation of the inputs. The Worker loads the data and the renderers in
// profile-export-render.mjs turn the result into Markdown or HTML.

export const EXPORT_FORMATS = ["markdown", "html"];
export const EXPORT_MEMBER_LIMIT = 25;
export const PASS_REASONS = ["Role", "Company", "Location", "Pay", "Already applied", "Something else"];
export const TOP_COUNT_LIMIT = 5;

const NARRATIVE_SKIPPED = Object.freeze({ status: "unavailable", reason: "narrative_skipped", text: "" });

const text = (value) => String(value ?? "").trim();

// Same shape as the Worker's noteValue: Notes is one `Label: value` line per entry.
const noteValue = (notes, label) =>
  text(notes).match(new RegExp(`^${label}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";

// Dashboard feedback is stored as `Reason — note`. A note without a known reason
// label is kept whole so nothing the member wrote is dropped.
export function parsePassFeedback(feedback) {
  const value = text(feedback);
  if (!value) return { reason: "No reason given", note: "" };
  const [head, ...rest] = value.split(" — ");
  const label = PASS_REASONS.find((reason) => reason.toLowerCase() === head.trim().toLowerCase());
  if (label) return { reason: label, note: rest.join(" — ").trim() };
  return { reason: "Unspecified", note: value };
}

// Case-insensitive tally. The first spelling seen is the label; ties break by label.
export function topCounts(values, limit = TOP_COUNT_LIMIT) {
  const tally = new Map();
  for (const raw of values || []) {
    const value = text(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    const existing = tally.get(key);
    tally.set(key, existing ? { ...existing, count: existing.count + 1 } : { label: value, count: 1 });
  }
  return [...tally.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

const uniqueStrings = (values) =>
  (values || []).map(text).filter((value, index, all) => value && all.indexOf(value) === index);

const describeGroup = (jobs) => ({
  companies: topCounts(jobs.map((job) => job.company)),
  domains: topCounts(jobs.map((job) => job.primary_domain)),
  locations: topCounts(jobs.map((job) => job.location)),
  workplace_types: topCounts(jobs.map((job) => job.workplace_type), 10),
  salaries: uniqueStrings(jobs.map((job) => job.salary)),
});

// Saved means "Interested" and passed means "Not interested"; the count rules match
// buildAdminRecommendationStats so the export never disagrees with the admin table.
export function summarizeDecisions(jobs) {
  const all = jobs || [];
  const saved = all.filter((job) => job?.decision === "Interested");
  const passed = all.filter((job) => job?.decision === "Not interested");
  const passedFeedback = passed.map((job) => parsePassFeedback(job.feedback));
  return {
    counts: {
      total: all.length,
      saved: saved.length,
      passed: passed.length,
      awaiting_review: all.filter((job) => !job?.decision && !job?.application_status).length,
      applied: all.filter((job) => !!job?.application_status).length,
    },
    saved: {
      ...describeGroup(saved),
      jobs: saved.map((job) => ({
        title: text(job.title),
        company: text(job.company),
        location: text(job.location),
        salary: text(job.salary),
        url: text(job.url),
        application_status: text(job.application_status),
      })),
    },
    passed: {
      ...describeGroup(passed),
      reasons: topCounts(passedFeedback.map(({ reason }) => reason), PASS_REASONS.length + 2),
      jobs: passed.map((job, index) => ({
        title: text(job.title),
        company: text(job.company),
        reason: passedFeedback[index].reason,
        note: passedFeedback[index].note,
      })),
    },
  };
}

const normalizeNarrative = (narrative) => {
  if (!narrative || typeof narrative !== "object") return NARRATIVE_SKIPPED;
  return {
    status: narrative.status === "ready" ? "ready" : "unavailable",
    reason: text(narrative.reason),
    text: text(narrative.text),
  };
};

export function buildProfileExport({ member, jobs, resumeText, narrative, generatedAt }) {
  const notes = text(member?.notes);
  const workModes = Array.isArray(member?.work_modes) ? member.work_modes.map(text).filter(Boolean) : [];
  return {
    id: text(member?.id),
    generated_at: text(generatedAt) || new Date().toISOString(),
    name: text(member?.name),
    email: text(member?.email),
    status: text(member?.status),
    frequency: text(member?.frequency),
    preferences: {
      target_roles: text(member?.target_roles),
      keywords: noteValue(notes, "Keywords"),
      seniority: text(member?.seniority),
      regions: text(member?.regions),
      region_city: text(member?.region_city),
      region_state: text(member?.region_state),
      region_country: text(member?.region_country),
      remote: text(member?.remote),
      work_modes: workModes.length ? workModes : [text(member?.work_mode)].filter(Boolean),
      min_salary: text(member?.min_salary),
      max_salary: noteValue(notes, "Maximum salary"),
      posted_within: noteValue(notes, "Posted within"),
      max_travel: noteValue(notes, "Max travel"),
      steer_away_terms: text(member?.steer_away_terms),
      steer_away_mode: member?.steer_away_mode === "hide" ? "hide" : "rank",
      resume_suggestions: Array.isArray(member?.resume_suggestions)
        ? member.resume_suggestions.map(text).filter(Boolean)
        : [],
    },
    match_context: text(member?.match_context).split("\n").map(text).filter(Boolean),
    notes_raw: notes,
    resume_filename: noteValue(notes, "Resume file"),
    resume_text: text(resumeText),
    decisions: summarizeDecisions(jobs),
    narrative: normalizeNarrative(narrative),
  };
}

const slug = (value) =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "member";

export function profileExportFilename(exports, format, generatedAt) {
  const extension = format === "html" ? "html" : "md";
  const day = text(generatedAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (exports.length === 1) return `job-scout-profile-${slug(exports[0].name)}-${day}.${extension}`;
  return `job-scout-profiles-${exports.length}-members-${day}.${extension}`;
}

// Bounded promise pool that keeps results in input order. Rejections propagate;
// callers that want per-item fallbacks catch inside `fn`.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}
