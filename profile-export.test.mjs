import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileExport,
  mapWithConcurrency,
  parsePassFeedback,
  profileExportFilename,
  summarizeDecisions,
  topCounts,
} from "./profile-export.mjs";

const job = (overrides) => ({
  id: "job",
  title: "Role",
  company: "Acme",
  location: "Remote",
  salary: "",
  url: "",
  primary_domain: "",
  workplace_type: "",
  decision: "",
  feedback: "",
  application_status: "",
  ...overrides,
});

test("parsePassFeedback splits the dashboard's reason and note", () => {
  assert.deepEqual(parsePassFeedback("Pay — too low for the level"), { reason: "Pay", note: "too low for the level" });
  assert.deepEqual(parsePassFeedback("already applied"), { reason: "Already applied", note: "" });
  assert.deepEqual(parsePassFeedback("free text with no label"), { reason: "Unspecified", note: "free text with no label" });
  assert.deepEqual(parsePassFeedback(""), { reason: "No reason given", note: "" });
});

test("topCounts tallies case-insensitively and orders by count then label", () => {
  assert.deepEqual(topCounts(["Acme", "acme", "Beta", "", null, "Alpha", "beta"]), [
    { label: "Acme", count: 2 },
    { label: "Beta", count: 2 },
    { label: "Alpha", count: 1 },
  ]);
  assert.deepEqual(topCounts(["a", "b", "c"], 2).length, 2);
});

test("summarizeDecisions separates saved from passed without mutating the input", () => {
  const jobs = [
    job({ id: "1", decision: "Interested", company: "Acme", primary_domain: "Design", workplace_type: "Remote", salary: "$150k–$180k", url: "https://acme.example/job/1", application_status: "Applied" }),
    job({ id: "2", decision: "Interested", company: "acme", primary_domain: "Design", workplace_type: "Hybrid", salary: "$150k–$180k" }),
    job({ id: "3", decision: "Interested", company: "Globex", primary_domain: "Product", location: "Austin, TX" }),
    job({ id: "4", decision: "Not interested", company: "Initech", feedback: "Pay — too low", workplace_type: "On-site" }),
    job({ id: "5", decision: "Not interested", company: "Initech", feedback: "Location — needs relocation" }),
    job({ id: "6", application_status: "Interviewing" }),
    job({ id: "7" }),
  ];
  const source = structuredClone(jobs);

  const result = summarizeDecisions(jobs);

  assert.deepEqual(result.counts, { total: 7, saved: 3, passed: 2, awaiting_review: 1, applied: 2 });
  assert.deepEqual(result.saved.companies, [{ label: "Acme", count: 2 }, { label: "Globex", count: 1 }]);
  assert.deepEqual(result.saved.domains, [{ label: "Design", count: 2 }, { label: "Product", count: 1 }]);
  assert.deepEqual(result.saved.workplace_types, [{ label: "Hybrid", count: 1 }, { label: "Remote", count: 1 }]);
  assert.deepEqual(result.saved.salaries, ["$150k–$180k"]);
  assert.deepEqual(result.saved.jobs[0], {
    title: "Role", company: "Acme", location: "Remote", salary: "$150k–$180k", url: "https://acme.example/job/1", application_status: "Applied",
  });
  assert.deepEqual(result.passed.reasons, [{ label: "Location", count: 1 }, { label: "Pay", count: 1 }]);
  assert.deepEqual(result.passed.jobs, [
    { title: "Role", company: "Initech", reason: "Pay", note: "too low" },
    { title: "Role", company: "Initech", reason: "Location", note: "needs relocation" },
  ]);
  assert.deepEqual(jobs, source);
});

test("summarizeDecisions handles no jobs at all", () => {
  const result = summarizeDecisions([]);
  assert.deepEqual(result.counts, { total: 0, saved: 0, passed: 0, awaiting_review: 0, applied: 0 });
  assert.deepEqual(result.saved.jobs, []);
  assert.deepEqual(result.passed.reasons, []);
});

test("buildProfileExport lifts Notes entries and match context into the profile", () => {
  const member = {
    id: "cand-1",
    name: "Alex Morgan",
    email: "alex@example.com",
    status: "Active",
    frequency: "Daily",
    target_roles: "Product Designer, Design Lead",
    regions: "Oakland, California, United States",
    region_city: "Oakland",
    region_state: "California",
    region_country: "United States",
    min_salary: "$140k",
    seniority: "Senior+",
    remote: "Yes",
    work_modes: ["remote", "hybrid"],
    notes: ["Keywords: design systems", "Maximum salary: $220k+", "Posted within: 7 days", "Max travel: 10%", "Resume file: alex.pdf"].join("\n"),
    steer_away_terms: "crypto, gambling",
    steer_away_mode: "hide",
    resume_suggestions: ["agency"],
    match_context: "Pay — too low\nLocation — no relocation",
  };

  const profile = buildProfileExport({ member, jobs: [], resumeText: " Résumé body ", generatedAt: "2026-11-03T10:00:00.000Z" });

  assert.equal(profile.id, "cand-1");
  assert.equal(profile.generated_at, "2026-11-03T10:00:00.000Z");
  assert.deepEqual(profile.preferences, {
    target_roles: "Product Designer, Design Lead",
    keywords: "design systems",
    seniority: "Senior+",
    regions: "Oakland, California, United States",
    region_city: "Oakland",
    region_state: "California",
    region_country: "United States",
    remote: "Yes",
    work_modes: ["remote", "hybrid"],
    min_salary: "$140k",
    max_salary: "$220k+",
    posted_within: "7 days",
    max_travel: "10%",
    steer_away_terms: "crypto, gambling",
    steer_away_mode: "hide",
    resume_suggestions: ["agency"],
  });
  assert.deepEqual(profile.match_context, ["Pay — too low", "Location — no relocation"]);
  assert.equal(profile.resume_filename, "alex.pdf");
  assert.equal(profile.resume_text, "Résumé body");
  assert.deepEqual(profile.narrative, { status: "unavailable", reason: "narrative_skipped", text: "" });
});

test("buildProfileExport tolerates a sparse member record", () => {
  const profile = buildProfileExport({ member: { id: "x", work_mode: "onsite" }, jobs: undefined, resumeText: undefined });
  assert.equal(profile.name, "");
  assert.deepEqual(profile.preferences.work_modes, ["onsite"]);
  assert.equal(profile.preferences.steer_away_mode, "rank");
  assert.deepEqual(profile.match_context, []);
  assert.equal(profile.decisions.counts.total, 0);
  assert.match(profile.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("profileExportFilename names single and combined exports", () => {
  const one = [{ name: "Ed (you)" }];
  assert.equal(profileExportFilename(one, "markdown", "2026-11-03T10:00:00.000Z"), "job-scout-profile-ed-you-2026-11-03.md");
  assert.equal(profileExportFilename(one, "html", "2026-11-03T10:00:00.000Z"), "job-scout-profile-ed-you-2026-11-03.html");
  assert.equal(profileExportFilename([{ name: "" }], "html", "2026-11-03"), "job-scout-profile-member-2026-11-03.html");
  assert.equal(profileExportFilename([{ name: "A" }, { name: "B" }], "markdown", "2026-11-03"), "job-scout-profiles-2-members-2026-11-03.md");
});

test("mapWithConcurrency preserves order and never exceeds the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const result = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, value));
    inFlight -= 1;
    return value * 10;
  });
  assert.deepEqual(result, [50, 10, 30, 20, 40]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
});
