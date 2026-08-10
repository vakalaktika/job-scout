// build-email.test.mjs
// node:test suite for the deterministic match-alert email builder.
// Pure/offline: reads the shipped template from disk, no network or credentials.
//
//   node --test build-email.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildEmail, toPosting } from "./build-email.mjs";
import { renderMatchEmail } from "./dispatch/render-match-email.mjs";

const TEMPLATE = readFileSync(fileURLToPath(new URL("./email-template.html", import.meta.url)), "utf8");

// The workplace badge <span> is uniquely identifiable by its pill background.
const WORKPLACE_BADGE = "background-color:#e7f0ec";
const badgeCount = (html) => html.split(WORKPLACE_BADGE).length - 1;
const sepCount = (html) => html.split("&nbsp;·&nbsp;").length - 1;

const EMAIL = { headline: "4 new matches for you", runDate: "Sunday, July 12, 2026", firstName: "Ed" };

/** A complete, valid posting; override individual fields per test. */
const posting = (over = {}) => ({
  title: "Staff Product Designer",
  url: "https://ex.com/1",
  company: "Northwind",
  location: "Remote (US)",
  salary: "$180k–$210k",
  source: "LinkedIn",
  workplace_type: "Remote",
  matchReason: "Matches your product design and systems focus.",
  postedDaysAgo: 0,
  ...over,
});

/** Render a single-card email so assertions target exactly one posting. */
const oneCard = (over) => buildEmail(TEMPLATE, EMAIL, [posting(over)]);

// ---------------------------------------------------------------------------
// Token guard
// ---------------------------------------------------------------------------

test("assertNoTokensLeft: a surviving {{token}} makes buildEmail throw", () => {
  assert.throws(
    () => buildEmail(TEMPLATE + "\n{{ROGUE_TOKEN}}", EMAIL, [posting()]),
    /unfilled placeholder/,
  );
});

test("a clean render leaves no {{...}} tokens and consumes the card markers", () => {
  const html = oneCard();
  assert.doesNotMatch(html, /\{\{\s*[\w.-]+\s*\}\}/);
  assert.ok(!html.includes("{{JOB_CARDS}}"));
  assert.ok(!html.includes("JOB_CARD_START") && !html.includes("JOB_CARD_END"));
});

// ---------------------------------------------------------------------------
// Empty postings
// ---------------------------------------------------------------------------

test("returns null on empty postings (caller must not send)", () => {
  assert.equal(buildEmail(TEMPLATE, EMAIL, []), null);
});

test("returns null when keepPosting drops every posting", () => {
  assert.equal(buildEmail(TEMPLATE, EMAIL, [posting()], { keepPosting: () => false }), null);
});

// ---------------------------------------------------------------------------
// Pipeline record -> Posting mapping (match_reason -> matchReason)
// ---------------------------------------------------------------------------

test("toPosting renames match_reason to matchReason and drops the old key", () => {
  const p = toPosting({
    title: "Senior UX Designer", company: "Contoso", location: "Austin, TX",
    source: "Greenhouse", url: "https://ex.com/2", workplace_type: "Hybrid",
    salary: "$150k–$175k", match_reason: "Hybrid role with research scope.",
  });
  assert.equal(p.matchReason, "Hybrid role with research scope.");
  assert.ok(!("match_reason" in p));
  // Direct carry-overs stay put.
  assert.equal(p.title, "Senior UX Designer");
  assert.equal(p.workplace_type, "Hybrid");
  assert.equal(p.salary, "$150k–$175k");
});

test("the mapped matchReason renders as the reason line in the email", () => {
  const p = toPosting({
    title: "Design Lead", company: "Fabrikam", location: "San Diego, CA",
    source: "Lever", url: "https://ex.com/3", workplace_type: "On-site",
    salary: "", match_reason: "Leadership track you flagged interest in.",
  });
  const html = buildEmail(TEMPLATE, EMAIL, [p]);
  assert.ok(html.includes("Leadership track you flagged interest in."));
});

test('toPosting reads the Notion "Date posted" label and computes whole days', () => {
  const now = new Date("2026-07-12T09:00:00Z");
  const p = toPosting({ match_reason: "x", "Date posted": "2026-07-05" }, { now });
  assert.equal(p.postedDaysAgo, 7);
  assert.ok(p.postedDate instanceof Date);
});

test("toPosting reads the live dispatcher's posted_at ISO field for the pill", () => {
  const now = new Date("2026-07-12T09:00:00Z");
  const p = toPosting({ match_reason: "x", posted_at: "2026-07-10T00:00:00Z" }, { now });
  assert.equal(p.postedDaysAgo, 2);
  assert.ok(p.postedDate instanceof Date);
});

test("toPosting prefers date_posted over posted_at when both are present", () => {
  const now = new Date("2026-07-12T09:00:00Z");
  const p = toPosting(
    { match_reason: "x", date_posted: "2026-07-05", posted_at: "2026-07-11T00:00:00Z" },
    { now },
  );
  assert.equal(p.postedDaysAgo, 7);
});

// ---------------------------------------------------------------------------
// Freshness buckets: 0 / 2 (green) · 3 / 7 (amber) · 8 (gray) · unknown (neutral)
// ---------------------------------------------------------------------------

const GREEN = "#15803d";
const AMBER = "#b45309";
// The two grey states share one foreground because the tints that told them
// apart were 2.34:1 and 4.34:1 on their own background — both under the AA floor
// for 12px text. The label is what distinguishes them now.
const GRAY_OLD = "#556174";
const NEUTRAL = "#556174";

test("0 days -> green pill, 'Posted today'", () => {
  const html = oneCard({ postedDaysAgo: 0 });
  assert.ok(html.includes(GREEN));
  assert.ok(html.includes("Posted today"));
});

test("2 days -> green pill", () => {
  const html = oneCard({ postedDaysAgo: 2 });
  assert.ok(html.includes(GREEN));
  assert.ok(html.includes("Posted 2 days ago"));
});

test("3 days -> amber pill (lower boundary)", () => {
  const html = oneCard({ postedDaysAgo: 3 });
  assert.ok(html.includes(AMBER));
  assert.ok(html.includes("Posted 3 days ago"));
});

test("7 days -> amber pill (upper boundary)", () => {
  const html = oneCard({ postedDaysAgo: 7 });
  assert.ok(html.includes(AMBER));
  assert.ok(html.includes("Posted 7 days ago"));
});

test("8 days -> gray pill (older)", () => {
  const html = oneCard({ postedDaysAgo: 8, postedDate: "2026-06-30" });
  assert.ok(html.includes(GRAY_OLD));
  assert.ok(html.includes("8 days ago"));
});

test("unknown age -> neutral pill, 'Posting date not listed'", () => {
  const html = oneCard({ postedDaysAgo: undefined, postedDate: undefined });
  assert.ok(html.includes(NEUTRAL));
  assert.ok(html.includes("Posting date not listed"));
});

// ---------------------------------------------------------------------------
// Meta line: location · salary · source (salary omitted when empty)
// ---------------------------------------------------------------------------

test("salary present -> two separators (location · salary · source)", () => {
  assert.equal(sepCount(oneCard({ salary: "$180k–$210k" })), 2);
});

test("salary empty -> segment omitted, one separator (location · source)", () => {
  const html = oneCard({ salary: "" });
  assert.equal(sepCount(html), 1);
  assert.ok(!html.includes("$undefined") && !html.includes("$null"));
});

// ---------------------------------------------------------------------------
// Workplace type: only the 4 WORKPLACE_TYPES; Unclear/invalid drops the row
// ---------------------------------------------------------------------------

for (const value of ["Remote", "Hybrid", "On-site"]) {
  test(`workplace_type "${value}" -> badge rendered`, () => {
    const html = oneCard({ workplace_type: value });
    assert.equal(badgeCount(html), 1);
    assert.ok(html.includes(value));
  });
}

test('workplace_type "Unclear" -> badge row dropped, word never printed', () => {
  const html = oneCard({ workplace_type: "Unclear" });
  assert.equal(badgeCount(html), 0);
  assert.ok(!html.includes("Unclear"));
});

for (const value of ["Flexible", "", null, undefined]) {
  test(`invalid workplace_type ${JSON.stringify(value)} -> badge row dropped`, () => {
    assert.equal(badgeCount(oneCard({ workplace_type: value })), 0);
  });
}

// ---------------------------------------------------------------------------
// Reference call site: renderMatchEmail wires mapping + template + buildEmail
// ---------------------------------------------------------------------------

// Non-LinkedIn records never reach the network, so any fetch here is a bug.
const neverFetches = async () => {
  throw new Error("unexpected fetch");
};

test("renderMatchEmail maps records and returns filled HTML", async () => {
  const html = await renderMatchEmail(EMAIL, [
    { title: "Product Designer", company: "AdventureWorks", location: "Seattle, WA",
      source: "Company site", url: "https://ex.com/4", workplace_type: "Remote",
      salary: "$160k", match_reason: "Strong overlap with your fintech background.",
      date_posted: "2026-07-12" },
  ], { now: new Date("2026-07-12T09:00:00Z"), fetcher: neverFetches });
  assert.ok(html.includes("Strong overlap with your fintech background."));
  assert.ok(html.includes("https://ex.com/4"));
  assert.doesNotMatch(html, /\{\{\s*[\w.-]+\s*\}\}/);
});

test("renderMatchEmail returns null when there are no records", async () => {
  assert.equal(await renderMatchEmail(EMAIL, [], { fetcher: neverFetches }), null);
});

// The card has to carry the link the member actually applies on. Landing them on
// LinkedIn to press a second Apply button is the click this resolution removes.
test("renderMatchEmail points a LinkedIn card at the employer's board", async () => {
  const guest = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4123456789";
  const fetcher = async (url) => ({
    ok: true,
    status: 200,
    url: url === guest ? url : "https://job-boards.greenhouse.io/acme/jobs/771",
    text: async () =>
      url === guest
        ? '<a href="https://job-boards.greenhouse.io/acme/jobs/771" data-tracking-control-name="public_jobs_apply-link-offsite">Apply</a>'
        : "<html></html>",
  });
  const html = await renderMatchEmail(EMAIL, [
    { title: "Staff Product Designer", company: "Acme", location: "Remote (US)",
      source: "LinkedIn", url: "https://www.linkedin.com/jobs/view/4123456789",
      workplace_type: "Remote", match_reason: "Matches your design systems work.",
      date_posted: "2026-07-12" },
  ], { now: new Date("2026-07-12T09:00:00Z"), fetcher });

  assert.ok(html.includes("https://job-boards.greenhouse.io/acme/jobs/771"));
  assert.ok(!html.includes("linkedin.com/jobs/view/4123456789"));
});

test("renderMatchEmail keeps the LinkedIn post for an Easy Apply role", async () => {
  const fetcher = async (url) => ({
    ok: true,
    status: 200,
    url,
    text: async () =>
      '<a href="https://www.linkedin.com/job-apply/4123456789" data-tracking-control-name="public_jobs_apply-link-onsite">Easy Apply</a>',
  });
  const html = await renderMatchEmail(EMAIL, [
    { title: "Staff Product Designer", company: "Acme", location: "Remote (US)",
      source: "LinkedIn", url: "https://www.linkedin.com/jobs/view/4123456789",
      workplace_type: "Remote", match_reason: "Matches your design systems work.",
      date_posted: "2026-07-12" },
  ], { now: new Date("2026-07-12T09:00:00Z"), fetcher });

  assert.ok(html.includes("https://www.linkedin.com/jobs/view/4123456789"));
});
