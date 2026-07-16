import assert from "node:assert/strict";
import test from "node:test";
import {
  applySteerAway,
  buildBriefRequest,
  enrichJobBrief,
  extractJobPostingText,
  hasCompleteBrief,
  matchesTerm,
  parseBriefResponse,
  postingTextForJob,
  shouldEnrichBrief,
  splitTerms,
} from "./worker.mjs";

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
  const text = await postingTextForJob(
    { url: "http://127.0.0.1/internal-job" },
    async () => {
      fetchCalls += 1;
      return new Response(postingHtml, { headers: { "content-type": "text/html" } });
    },
  );
  assert.equal(text, "");
  assert.equal(fetchCalls, 0);
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
  ]);
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
