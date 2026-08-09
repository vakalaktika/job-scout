import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  buildFirstScoutRunText,
  FirstScoutGate,
  firstScoutPublicState,
} from "./worker.mjs";
import {
  APPLICATION_STATUSES,
  appendMatchContext,
  applySteerAway,
  buildBriefRequest,
  candidateProps,
  checkPostingLiveness,
  demoteClosedPostings,
  detectPostingGone,
  enrichJobBrief,
  extractJobPostingText,
  hasCompleteBrief,
  issueToken,
  keepForSession,
  lastDispatchAt,
  MATCH_CONTEXT_ENTRIES,
  matchContextEntry,
  magicLinkUrl,
  matchesTerm,
  parseBriefResponse,
  parseNotes,
  parseRegions,
  postingAgeDays,
  postingTextForJob,
  renderMagicEmail,
  shouldCheckLink,
  shouldEnrichBrief,
  splitTerms,
  verifyToken,
  WORKPLACE_TYPES,
} from "./worker.mjs";

test("first-scout state is available only to an entitled active member with no jobs", () => {
  assert.deepEqual(firstScoutPublicState({
    status: "Active",
    first_scout_status: "Available",
    first_scout_request_id: "internal-request",
    first_scout_session_id: "internal-session",
    first_scout_error: "internal-error",
  }, [], null), {
    status: "available",
    requested_at: "",
    completed_at: "",
  });
  assert.equal(firstScoutPublicState({ status: "Active" }, [], null).status, "unavailable");
  assert.equal(firstScoutPublicState({ status: "Paused" }, [], null).status, "unavailable");
  assert.equal(firstScoutPublicState({ status: "Revoked" }, [], null).status, "unavailable");
  assert.equal(firstScoutPublicState({ status: "Active" }, [{ id: "job-1" }], null).status, "complete");
});

test("candidate completion wins over a stale queued gate even when no jobs matched", () => {
  const state = firstScoutPublicState(
    {
      status: "Active",
      first_scout_status: "Complete",
      first_scout_requested_at: "2026-08-08T10:00:00.000Z",
      first_scout_completed_at: "2026-08-08T10:04:00.000Z",
    },
    [],
    { status: "queued", requested_at: "2026-08-08T10:00:00.000Z" },
  );

  assert.deepEqual(state, {
    status: "complete",
    requested_at: "2026-08-08T10:00:00.000Z",
    completed_at: "2026-08-08T10:04:00.000Z",
  });
});

test("a queued Notion state remains visible while the routine is in progress", () => {
  assert.deepEqual(
    firstScoutPublicState({
      status: "Active",
      first_scout_status: "Queued",
      first_scout_requested_at: "2026-08-08T10:00:00.000Z",
    }),
    {
      status: "queued",
      requested_at: "2026-08-08T10:00:00.000Z",
      completed_at: "",
    },
  );
});

test("a terminal candidate failure wins over a stale queued gate", () => {
  assert.equal(
    firstScoutPublicState(
      { status: "Active", first_scout_status: "Failed" },
      [],
      { status: "queued" },
    ).status,
    "failed",
  );
});

test("a terminal gate failure wins when Notion is still queued", () => {
  assert.equal(
    firstScoutPublicState(
      { status: "Active", first_scout_status: "Queued" },
      [],
      { status: "needs_review" },
    ).status,
    "needs_review",
  );
});

test("the routine payload is candidate-scoped, contains no email, and forbids a global fallback", () => {
  const payload = JSON.parse(buildFirstScoutRunText("candidate-123", "request-456"));

  assert.equal(payload.task, "job_scout_onboarding_run");
  assert.equal(payload.mode, "single_candidate");
  assert.equal(payload.candidate_id, "candidate-123");
  assert.equal(payload.request_id, "request-456");
  assert.equal(payload.constraints.process_only_candidate_id, "candidate-123");
  assert.equal(payload.constraints.never_fallback_to_all_candidates, true);
  assert.equal(JSON.stringify(payload).includes("email"), false);
});

const createGateState = () => {
  const values = new Map();
  return {
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
    },
    blockConcurrencyWhile: async (callback) => callback(),
  };
};

test("the durable gate fires the external routine once and reuses the queued result", async () => {
  const originalFetch = globalThis.fetch;
  let routineCalls = 0;
  globalThis.fetch = async (url, init) => {
    routineCalls += 1;
    assert.match(String(url), /trig_test\/fire$/);
    assert.equal(init.headers.Authorization, "Bearer routine-secret");
    assert.equal(
      init.headers["anthropic-beta"],
      "experimental-cc-routine-2026-04-01",
    );
    return new Response(
      JSON.stringify({
        type: "routine_fire",
        claude_code_session_id: "session-1",
        claude_code_session_url: "https://claude.ai/code/session-1",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const gate = new FirstScoutGate(createGateState(), {
      FIRST_SCOUT_ROUTINE_ID: "trig_test",
      FIRST_SCOUT_ROUTINE_TOKEN: "routine-secret",
    });
    const request = () =>
      new Request("https://first-scout.internal/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: "candidate-123" }),
      });

    const first = await (await gate.fetch(request())).json();
    const second = await (await gate.fetch(request())).json();

    assert.equal(first.status, "queued");
    assert.equal(first.session_id, "session-1");
    assert.equal(second.status, "queued");
    assert.equal(second.already_requested, true);
    assert.equal(second.request_id, first.request_id);
    assert.equal(routineCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the durable gate returns a safe configuration error without consuming the entitlement", async () => {
  const gate = new FirstScoutGate(createGateState(), {});
  const response = await gate.fetch(new Request("https://first-scout.internal/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: "candidate-123" }),
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "first_scout_unconfigured" });
  assert.equal(await (await gate.fetch(new Request("https://first-scout.internal/status"))).json(), null);
});

test("run_scout_once rejects a request without a valid signed session", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_scout_once" }),
    }),
    { SESSION_SECRET: "test-secret" },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_session" });
});
test("an unstated workplace type is recorded as unclear rather than guessed", () => {
  const brief = {
    summary: "Owns the payments platform and its reliability targets across teams.",
    match_reason: "Your resume shows five years running payment services at similar scale.",
    key_requirements: "Go, distributed systems, and on-call ownership.",
  };
  const parsed = (workplace_type) =>
    parseBriefResponse({ output_text: JSON.stringify({ ...brief, workplace_type }) });

  assert.equal(parsed("Remote").workplace_type, "Remote");
  assert.equal(parsed("On-site").workplace_type, "On-site");
  assert.equal(parsed("Fully Remote!").workplace_type, "Unclear");
  assert.equal(parsed(undefined).workplace_type, "Unclear");
});

const plainText = (property) => property.rich_text.map((item) => item.text.content).join("");

test("a stored region splits back into the parts the location selects need", () => {
  assert.deepEqual(parseRegions("Tijuana, Baja California, Mexico"), {
    city: "Tijuana",
    state: "Baja California",
    country: "Mexico",
  });
  assert.deepEqual(parseRegions("Atlanta, Georgia"), {
    city: "Atlanta",
    state: "Georgia",
    country: "",
  });
  assert.deepEqual(parseRegions(""), { city: "", state: "", country: "" });
  assert.deepEqual(parseRegions(undefined), { city: "", state: "", country: "" });
});

test("notes parse into labelled entries and tolerate values containing colons", () => {
  const entries = parseNotes("Keywords: react, node: js\nPosted within: 7 days\nnot a label");
  assert.equal(entries.get("Keywords"), "react, node: js");
  assert.equal(entries.get("Posted within"), "7 days");
  assert.equal(entries.size, 2);
});

test("a partial preference payload leaves stored preferences untouched", () => {
  const existing = {
    notes: "Keywords: react\nMaximum salary: $220k+\nPosted within: 7 days\nResume file: cv.pdf",
  };
  // What the dashboard sends when only the delivery cadence changed.
  const properties = candidateProps({ frequency: "Daily" }, existing);

  assert.equal(properties.Regions, undefined, "location must not be rewritten");
  assert.equal(properties["Steer mode"], undefined, "steer mode must not be reset");
  assert.equal(properties["Target roles"], undefined);
  assert.equal(properties["Steer away"], undefined);
  assert.equal(properties.Notes, undefined, "notes must not be rebuilt from an empty payload");
  assert.deepEqual(properties.Frequency, { select: { name: "Daily" } });
});

test("a full preference payload still writes every field", () => {
  const properties = candidateProps(
    {
      target_roles: "Staff Engineer",
      regions: "Atlanta, Georgia, United States",
      min_salary: "$180k",
      steer_away_terms: "sales",
      steer_away_mode: "hide",
      seniority: "Staff+",
      remote: "Yes",
      role_keywords: "platform",
      max_posting_age: 14,
    },
    { notes: "Keywords: react\nResume file: cv.pdf" },
  );

  assert.equal(plainText(properties.Regions), "Atlanta, Georgia, United States");
  assert.deepEqual(properties["Steer mode"], { select: { name: "Hide" } });
  assert.deepEqual(properties["Remote OK"], { select: { name: "Yes" } });
  const notes = plainText(properties.Notes);
  assert.match(notes, /Keywords: platform/, "an edited note entry is overwritten");
  assert.match(notes, /Resume file: cv\.pdf/, "an untouched note entry survives");
  assert.match(notes, /Posted within: 14 days/);
});

test("an explicitly emptied preference is cleared rather than ignored", () => {
  const properties = candidateProps({ steer_away_terms: "" }, { notes: "" });
  assert.equal(plainText(properties["Steer away"]), "");
});

test("splitTerms trims and de-duplicates terms case-insensitively", () => {
  assert.deepEqual(splitTerms(" Infrastructure, DevOps, infrastructure, "), [
    "Infrastructure",
    "DevOps",
  ]);
});

test("whole-term matching supports light stemming but not substrings", () => {
  assert.equal(matchesTerm({ summary: "Build secure platforms" }, "platform"), true);
  assert.equal(matchesTerm({ summary: "Infrastructural design systems" }, "infrastructure"), false);
  assert.equal(matchesTerm({ summary: "Backendless product tooling" }, "backend"), false);
});

test("a canonical primary domain can match when prose uses a related adjective", () => {
  assert.equal(
    matchesTerm(
      { primary_domain: "Infrastructure", summary: "Infrastructural design systems" },
      "infrastructure",
    ),
    true,
  );
});

test("rank mode preserves order inside preferred and lowered groups", () => {
  const jobs = [
    { id: "a", title: "Platform Engineer" },
    { id: "b", title: "Product Designer" },
    { id: "c", title: "DevOps Lead" },
  ];
  const result = applySteerAway(jobs, {
    steer_away_terms: "Platform, DevOps",
    steer_away_mode: "rank",
  });
  assert.deepEqual(result.jobs.map((job) => job.id), ["b", "a", "c"]);
  assert.deepEqual(result.jobs[1].steer_away_match, ["Platform"]);
  assert.equal(result.hiddenCount, 0);
});

test("hide mode removes matches and reports the exact hidden count", () => {
  const jobs = [
    { id: "a", title: "Platform Engineer" },
    { id: "b", title: "Product Designer" },
    { id: "c", primary_domain: "Infrastructure" },
  ];
  const result = applySteerAway(jobs, {
    steer_away_terms: "Platform, Infrastructure",
    steer_away_mode: "hide",
  });
  assert.deepEqual(result.jobs.map((job) => job.id), ["b"]);
  assert.equal(result.hiddenCount, 2);
});

test("hide mode never removes a job the candidate has saved", () => {
  const jobs = [
    { id: "a", title: "Platform Engineer", decision: "Interested" },
    { id: "b", title: "Product Designer" },
    { id: "c", title: "Platform Architect" },
  ];
  const result = applySteerAway(jobs, {
    steer_away_terms: "Platform",
    steer_away_mode: "hide",
  });
  assert.deepEqual(result.jobs.map((job) => job.id), ["a", "b"]);
  assert.equal(result.hiddenCount, 1);
});

test("rank mode keeps a saved job in the preferred group even if it matches", () => {
  const jobs = [
    { id: "a", title: "Platform Engineer", decision: "Interested" },
    { id: "b", title: "Product Designer" },
    { id: "c", title: "Platform Architect" },
  ];
  const result = applySteerAway(jobs, {
    steer_away_terms: "Platform",
    steer_away_mode: "rank",
  });
  assert.deepEqual(result.jobs.map((job) => job.id), ["a", "b", "c"]);
  assert.equal(result.jobs[0].steer_away_match, undefined);
});

test("posting age counts whole days and never skews across a mid-day now", () => {
  // A bare date is UTC midnight; the age must be the same whatever time of the UTC
  // day "now" falls on, so a posting dated today is never reported as a day old.
  const posted = "2026-08-06";
  const dayStart = Date.parse("2026-08-06T00:00:00Z");
  assert.equal(postingAgeDays(posted, dayStart), 0);
  assert.equal(postingAgeDays(posted, dayStart + 23 * 3600000), 0);
  assert.equal(postingAgeDays(posted, dayStart + 7 * 86400000 + 3600000), 7);
});

test("posting age is null for a missing or unparseable date", () => {
  assert.equal(postingAgeDays(""), null);
  assert.equal(postingAgeDays(undefined), null);
  assert.equal(postingAgeDays("not a date"), null);
});

test("a future-dated posting reports zero rather than a negative age", () => {
  const now = Date.parse("2026-08-06T12:00:00Z");
  assert.equal(postingAgeDays("2026-08-20", now), 0);
});

const postingDescription = `
  <p>Build and own internal web applications and data pipelines for scientific instruments.</p>
  <p>Responsibilities include designing TypeScript and Python services, shipping accessible user
  interfaces, and monitoring production data workflows used by research teams.</p>
  <p>Qualifications include five years of backend engineering experience, strong AWS and Linux
  knowledge, and experience supporting non-engineer users through the full software lifecycle.</p>
`;

const postingHtml = `
  <html><head><script type="application/ld+json">
    ${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Scientific Software Engineer",
      hiringOrganization: { name: "Arcadia Science" },
      description: postingDescription,
    })}
  </script></head><body>Navigation and cookie controls</body></html>
`;

test("brief completeness requires all three enriched fields", () => {
  assert.equal(
    hasCompleteBrief({ summary: "Role", match_reason: "Match", key_requirements: "Requirements" }),
    true,
  );
  assert.equal(hasCompleteBrief({ summary: "Role", match_reason: "Match" }), false);
});

test("failed enrichment is retried after the cooldown", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  assert.equal(
    shouldEnrichBrief(
      { brief_status: "Failed", brief_updated_at: "2026-07-15T11:30:00Z" },
      now,
    ),
    false,
  );
  assert.equal(
    shouldEnrichBrief(
      { brief_status: "Failed", brief_updated_at: "2026-07-14T10:00:00Z" },
      now,
    ),
    true,
  );
});

test("JSON-LD job descriptions are extracted before noisy page text", () => {
  const text = extractJobPostingText(postingHtml);
  assert.match(text, /Scientific Software Engineer/);
  assert.match(text, /TypeScript and Python services/);
  assert.doesNotMatch(text, /cookie controls/);
});

test("login and anti-bot pages are not mistaken for job descriptions", () => {
  const text = extractJobPostingText(`
    <html><body><h1>Sign in to LinkedIn</h1><p>Join LinkedIn to see this job.</p>
    <p>Security verification. Enable JavaScript to continue.</p></body></html>
  `);
  assert.equal(text, "");
});

test("private posting URLs are rejected before fetch", async () => {
  let fetchCalls = 0;
  const posting = await postingTextForJob(
    { url: "http://127.0.0.1/internal-job" },
    async () => {
      fetchCalls += 1;
      return new Response(postingHtml, { headers: { "content-type": "text/html" } });
    },
  );
  assert.deepEqual(posting, { text: "", liveness: "unknown" });
  assert.equal(fetchCalls, 0);
});

const htmlPage = (body) => new Response(body, { headers: { "content-type": "text/html" } });

test("a removed posting is reported gone rather than merely unreadable", async () => {
  for (const status of [404, 410]) {
    const posting = await postingTextForJob(
      { url: "https://boards.greenhouse.io/acme/jobs/1" },
      async () => new Response("", { status }),
    );
    assert.deepEqual(posting, { text: "", liveness: "gone" }, `status ${status}`);
  }
});

test("a closure notice marks a posting gone even when the page returns 200", async () => {
  // The common expiry pattern: the posting redirects to a page that still renders
  // fine and still carries the original description.
  const closed = `<html><body><h1>Staff Engineer</h1>
    <p>This job is no longer accepting applications.</p>
    ${postingHtml}</body></html>`;
  const posting = await postingTextForJob(
    { url: "https://jobs.lever.co/acme/1" },
    async () => htmlPage(closed),
  );
  assert.equal(posting.liveness, "gone");
  assert.equal(posting.text, "", "a closed posting must not produce brief source text");
});

test("an elapsed JSON-LD validThrough marks a posting gone", () => {
  const expired = `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Staff Engineer",
    validThrough: "2020-01-01",
  })}</script>`;
  assert.equal(detectPostingGone(expired), true);

  const open = `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Staff Engineer",
    validThrough: "2999-01-01",
  })}</script>`;
  assert.equal(detectPostingGone(open), false);
});

test("an unreadable page stays unknown so live roles are never dropped", async () => {
  const botWall = "<html><body>Sign in to LinkedIn to view this job</body></html>";
  const posting = await postingTextForJob(
    { url: "https://www.linkedin.com/jobs/view/1" },
    async () => htmlPage(botWall),
  );
  assert.equal(posting.liveness, "unknown");

  const timedOut = await postingTextForJob(
    { url: "https://jobs.lever.co/acme/1" },
    async () => {
      throw new Error("network");
    },
  );
  assert.equal(timedOut.liveness, "unknown");
});

test("liveness is checked even when the posting text is already stored", async () => {
  const stored = { _posting_text: "x".repeat(1200), url: "https://jobs.lever.co/acme/1" };
  let fetchCalls = 0;

  const posting = await postingTextForJob(stored, async () => {
    fetchCalls += 1;
    return htmlPage(postingHtml);
  });
  assert.equal(fetchCalls, 0, "stored text short-circuits the text fetch");
  assert.equal(posting.liveness, "unknown");

  const liveness = await checkPostingLiveness(stored, async () => {
    fetchCalls += 1;
    return new Response("", { status: 404 });
  });
  assert.equal(fetchCalls, 1, "the liveness check always fetches");
  assert.equal(liveness, "gone");
});

test("links are re-checked once a day and skipped for rejected jobs", () => {
  const now = Date.parse("2026-08-05T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldCheckLink({ link_checked_at: "" }, now), true);
  assert.equal(shouldCheckLink({ link_checked_at: "not a date" }, now), true);
  assert.equal(
    shouldCheckLink({ link_checked_at: new Date(now - day - 1000).toISOString() }, now),
    true,
  );
  assert.equal(
    shouldCheckLink({ link_checked_at: new Date(now - 1000).toISOString() }, now),
    false,
  );
  assert.equal(shouldCheckLink({ decision: "Not interested", link_checked_at: "" }, now), false);
  assert.equal(shouldCheckLink({ decision: "Interested", link_checked_at: "" }, now), true);
});

test("closed postings sort last without being removed", () => {
  const jobs = [
    { id: "a", link_status: "gone" },
    { id: "b", link_status: "live" },
    { id: "c", link_status: "" },
    { id: "d", link_status: "gone" },
  ];
  assert.deepEqual(
    demoteClosedPostings(jobs).map((job) => job.id),
    ["b", "c", "a", "d"],
  );
});

test("the structured request redacts contact details and disables storage", () => {
  const request = buildBriefRequest({
    job: { title: "Engineer", company: "Acme", location: "Remote", source: "Lever" },
    member: { name: "German", target_roles: "Software Engineer", seniority: "Senior" },
    resumeText: "German built reliable services. german@example.com +1 (415) 555-1212 ".repeat(3),
    postingText: "Responsibilities and requirements. ".repeat(20),
  });
  assert.equal(request.store, false);
  assert.equal(request.model, "gpt-5.4-nano");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, [
    "summary",
    "match_reason",
    "key_requirements",
    "workplace_type",
    "salary_range",
  ]);
  assert.deepEqual(request.text.format.schema.properties.workplace_type.enum, WORKPLACE_TYPES);
  const userPayload = request.input[1].content;
  assert.doesNotMatch(userPayload, /german@example\.com/);
  assert.doesNotMatch(userPayload, /415/);
  assert.match(userPayload, /\[email redacted\]/);
});

test("structured response parsing reads the Responses API output envelope", () => {
  const result = parseBriefResponse({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              summary: "Own the backend services and scientific data pipelines used by research teams.",
              match_reason: "German's backend and internal-tools work maps directly to this ownership scope.",
              key_requirements: "Strong Python, TypeScript, AWS, Linux, and data-pipeline experience are required.",
            }),
          },
        ],
      },
    ],
  });
  assert.match(result.summary, /scientific data pipelines/);
  assert.match(result.match_reason, /German/);
});

test("missing briefs are generated once and persisted as ready", async () => {
  const writes = [];
  const job = {
    id: "job-1",
    title: "Scientific Software Engineer",
    company: "Arcadia Science",
    url: "https://jobs.lever.co/arcadia/job-1",
  };
  const member = { name: "German", target_roles: "Software Engineer", seniority: "Senior" };
  const result = await enrichJobBrief({
    job,
    member,
    resumeText: "German built backend services, internal tools, and AWS data pipelines. ".repeat(3),
    env: {},
    fetcher: async () => new Response(postingHtml, { headers: { "content-type": "text/html" } }),
    generate: async (_env, context) => {
      assert.match(context.postingText, /TypeScript and Python services/);
      return {
        summary: "Build and own internal web applications and scientific data pipelines for researchers.",
        match_reason: "German's backend services and internal-tools experience maps directly to this role.",
        key_requirements: "Python, TypeScript, AWS, Linux, and production data-pipeline experience matter most.",
      };
    },
    persist: async (_env, jobId, state) => writes.push({ jobId, state }),
  });
  assert.equal(result.brief_status, "Ready");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].jobId, "job-1");
  assert.equal(writes[0].state.status, "Ready");
  assert.match(result.match_reason, /German/);
});

test("unreadable posting pages are cached as unavailable without calling the model", async () => {
  const writes = [];
  let generateCalls = 0;
  const result = await enrichJobBrief({
    job: {
      id: "job-2",
      title: "Senior DevOps Engineer",
      company: "Point One Navigation",
      url: "https://www.linkedin.com/jobs/view/123",
    },
    member: { name: "German", target_roles: "Software Engineer", seniority: "Senior" },
    resumeText: "Backend engineering, AWS, Linux, and production operations experience. ".repeat(3),
    env: {},
    fetcher: async () =>
      new Response("<h1>Sign in to LinkedIn</h1><p>Security verification. Enable JavaScript.</p>", {
        headers: { "content-type": "text/html" },
      }),
    generate: async () => {
      generateCalls += 1;
      return {};
    },
    persist: async (_env, jobId, state) => writes.push({ jobId, state }),
  });
  assert.equal(generateCalls, 0);
  assert.equal(result.brief_status, "Unavailable");
  assert.equal(result.brief_error, "posting_text_unavailable");
  assert.equal(writes[0].state.status, "Unavailable");
});

test("model failures are cached without dropping the job from the session", async () => {
  const writes = [];
  const job = {
    id: "job-3",
    title: "Scientific Software Engineer",
    company: "Arcadia Science",
    _posting_text: extractJobPostingText(postingHtml),
  };
  const result = await enrichJobBrief({
    job,
    member: { name: "German", target_roles: "Software Engineer", seniority: "Senior" },
    resumeText: "Backend engineering, AWS, Linux, and production operations experience. ".repeat(3),
    env: {},
    generate: async () => {
      throw new Error("openai_429:rate limited");
    },
    persist: async (_env, jobId, state) => writes.push({ jobId, state }),
  });
  assert.equal(result.id, "job-3");
  assert.equal(result.brief_status, "Failed");
  assert.match(result.brief_error, /openai_429/);
  assert.equal(writes[0].state.status, "Failed");
});

const tokenEnv = { SESSION_SECRET: "test-signing-secret" };

test("a freshly issued token verifies and returns its payload", async () => {
  const token = await issueToken(
    tokenEnv,
    { purpose: "session", member_id: "cand-1", email: "a@b.co" },
    3600,
  );
  const payload = await verifyToken(tokenEnv, token, "session");
  assert.equal(payload.member_id, "cand-1");
  assert.equal(payload.email, "a@b.co");
});

test("a token minted for one purpose is rejected when used for another", async () => {
  const magic = await issueToken(tokenEnv, { purpose: "magic", member_id: "cand-1", nonce: "n1" }, 3600);
  await assert.rejects(() => verifyToken(tokenEnv, magic, "session"), /expired_token/);
});

test("an expired token is rejected", async () => {
  const token = await issueToken(tokenEnv, { purpose: "session", member_id: "cand-1" }, -10);
  await assert.rejects(() => verifyToken(tokenEnv, token, "session"), /expired_token/);
});

test("a token without a member id is rejected even if the signature is valid", async () => {
  const token = await issueToken(tokenEnv, { purpose: "session" }, 3600);
  await assert.rejects(() => verifyToken(tokenEnv, token, "session"), /expired_token/);
});

test("a tampered token body fails signature verification", async () => {
  const token = await issueToken(tokenEnv, { purpose: "session", member_id: "cand-1" }, 3600);
  const [, signature] = token.split(".");
  const forged = `${Buffer.from(JSON.stringify({ purpose: "session", member_id: "cand-2", exp: 9999999999 })).toString("base64url")}.${signature}`;
  await assert.rejects(() => verifyToken(tokenEnv, forged, "session"), /invalid_token/);
});

test("a token verified with the wrong secret is rejected", async () => {
  const token = await issueToken(tokenEnv, { purpose: "session", member_id: "cand-1" }, 3600);
  await assert.rejects(
    () => verifyToken({ SESSION_SECRET: "a-different-secret" }, token, "session"),
    /invalid_token/,
  );
});

test("the magic link carries the token on the dashboard origin", () => {
  const url = magicLinkUrl("body.signature");
  // Pages serves this repository as a project site, so a link built from the bare
  // CORS origin lands on the user-site root, which is not a Pages site at all.
  assert.equal(url, "https://vakalaktika.github.io/job-scout/?login=body.signature");
});

test("the magic email embeds the link and states the single-use expiry", () => {
  const html = renderMagicEmail("https://vakalaktika.github.io/job-scout/?login=tok123");
  assert.ok(html.includes("https://vakalaktika.github.io/job-scout/?login=tok123"));
  assert.match(html, /once/i);
  assert.match(html, /15 minutes/);
});

test("the last dispatch is the newest send across every posting, filtered or not", () => {
  assert.equal(
    lastDispatchAt([
      { sent_at: "2026-07-10T08:00:00.000Z" },
      { sent_at: "2026-07-12T09:04:00.000Z" },
      { sent_at: "2026-07-11T20:00:00.000Z" },
    ]),
    "2026-07-12T09:04:00.000Z",
  );
});

test("an unknown last dispatch is empty rather than the epoch", () => {
  assert.equal(lastDispatchAt([]), "");
  assert.equal(lastDispatchAt([{ sent_at: "" }, { sent_at: "not a date" }, {}]), "");
});

test("a stated salary is captured and an unstated one stays empty", () => {
  const brief = {
    summary: "Owns the payments platform and its reliability targets across teams.",
    match_reason: "Your resume shows five years running payment services at similar scale.",
    key_requirements: "Go, distributed systems, and on-call ownership.",
    workplace_type: "Remote",
  };
  const parsed = (salary_range) =>
    parseBriefResponse({ output_text: JSON.stringify({ ...brief, salary_range }) });

  assert.equal(parsed("$170k–$200k").salary, "$170k–$200k");
  assert.equal(parsed("").salary, "");
  assert.equal(parsed(undefined).salary, "");
});

test("a posting that states no pay keeps the salary the dispatcher already stored", async () => {
  const writes = [];
  const result = await enrichJobBrief({
    job: {
      id: "job-9",
      title: "Staff Engineer",
      company: "Arcadia Science",
      url: "https://jobs.lever.co/arcadia/job-9",
      salary: "$185k–$215k",
    },
    member: { name: "German", target_roles: "Software Engineer", seniority: "Senior" },
    resumeText: "German built backend services, internal tools, and AWS data pipelines. ".repeat(3),
    env: {},
    fetcher: async () => new Response(postingHtml, { headers: { "content-type": "text/html" } }),
    generate: async () => ({
      summary: "Build and own internal web applications and scientific data pipelines for researchers.",
      match_reason: "German's backend services and internal-tools experience maps directly to this role.",
      key_requirements: "Python, TypeScript, AWS, Linux, and production data-pipeline experience matter most.",
      salary: "",
    }),
    persist: async (_env, jobId, state) => writes.push({ jobId, state }),
  });

  assert.equal(result.salary, "$185k–$215k");
  assert.equal(writes[0].state.salary, undefined);
});

const day = (offset) => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
};

test("a reviewed posting outlives the freshness window so a change of mind has somewhere to go", () => {
  assert.equal(keepForSession({ posted_at: day(30), decision: "Not interested" }, 7), true);
  assert.equal(keepForSession({ posted_at: day(30), decision: "Interested" }, 7), true);
  assert.equal(keepForSession({ posted_at: day(30), application_status: "Interviewing" }, 7), true);
});

test("an unreviewed posting still ages out of the session", () => {
  assert.equal(keepForSession({ posted_at: day(3) }, 7), true);
  assert.equal(keepForSession({ posted_at: day(8) }, 7), false);
  assert.equal(keepForSession({ posted_at: "", decision: "" }, 7), false);
});

test("a pass reason becomes one dated line naming the posting it came from", () => {
  const entry = matchContextEntry(
    { title: "Staff Product Designer", company: "Cobalt" },
    "Pay",
    "well below my range",
    new Date("2026-08-06T20:44:00.000Z"),
  );

  assert.equal(
    entry,
    "2026-08-06 · Not interested · Pay — well below my range · Staff Product Designer at Cobalt",
  );
});

test("a skipped pass records nothing rather than an empty entry", () => {
  const job = { title: "Staff Product Designer", company: "Cobalt" };
  assert.equal(matchContextEntry(job, "", ""), "");
  assert.equal(matchContextEntry(job, "  ", "   "), "");
  assert.equal(appendMatchContext("existing line", ""), "existing line");
});

test("a free-text note stands alone when no reason label was chosen", () => {
  assert.match(
    matchContextEntry({ title: "Design Lead", company: "Northwind" }, "", "too much travel"),
    /· Not interested · too much travel · Design Lead at Northwind$/,
  );
});

test("match context keeps the newest reason first and drops the oldest past the cap", () => {
  const context = Array.from({ length: MATCH_CONTEXT_ENTRIES + 3 }).reduce(
    (stored, _value, index) => appendMatchContext(stored, `entry ${index}`),
    "",
  );
  const lines = context.split("\n");

  assert.equal(lines.length, MATCH_CONTEXT_ENTRIES);
  assert.equal(lines[0], `entry ${MATCH_CONTEXT_ENTRIES + 2}`);
  assert.equal(lines.includes("entry 0"), false);
});

test("repeating a reason moves it to the top instead of storing it twice", () => {
  const context = appendMatchContext(appendMatchContext("a\nb\nc", "b"), "b");

  assert.deepEqual(context.split("\n"), ["b", "a", "c"]);
});

test("application statuses run in the order an application actually progresses", () => {
  assert.deepEqual(APPLICATION_STATUSES, [
    "Applied",
    "Interviewing",
    "Offer",
    "Rejected",
    "No response",
  ]);
});

test("hide mode never removes a posting the candidate already dealt with", () => {
  const jobs = [
    { id: "a", title: "Platform Engineer", decision: "Not interested" },
    { id: "b", title: "Platform Architect", application_status: "Interviewing" },
    { id: "c", title: "Platform Lead" },
    { id: "d", title: "Product Designer" },
  ];
  const result = applySteerAway(jobs, { steer_away_terms: "Platform", steer_away_mode: "hide" });

  // A dismissed posting has to survive, or the Not interested list it lives in
  // could not offer it back.
  assert.deepEqual(result.jobs.map((job) => job.id), ["a", "b", "d"]);
  assert.equal(result.hiddenCount, 1, "only the unreviewed match counts as hidden");
});
