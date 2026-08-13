import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  JOB_SCHEMA,
  buildEmail,
  default as backupWorker,
  fallbackEmail,
  saveJob,
  sanitizeJob,
  scoutJobs,
} from "./dispatch/backup-dispatcher.deployed.js";

const TEMPLATE = readFileSync(
  fileURLToPath(new URL("./email-template.html", import.meta.url)),
  "utf8",
);
const TODAY = new Date().toISOString().slice(0, 10);
const NOW = new Date(`${TODAY}T12:00:00Z`);
const LINKEDIN_JOB_URL = "https://www.linkedin.com/jobs/view/4123456789";
const LINKEDIN_GUEST_URL =
  "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4123456789";
const NORTHWIND_ASHBY_URL = "https://api.ashbyhq.com/posting-api/job-board/northwind";

const candidate = {
  id: "candidate-1",
  name: "Alex Morgan",
  email: "alex@example.com",
  targetRoles: "Staff Product Designer",
  regions: "Remote (US)",
  minSalary: "$170k",
  seniority: "Staff",
  remote: "Yes",
  notes: "Posted within: 7 days",
};

const job = (salary) => ({
  title: "Staff Product Designer",
  company: "Northwind",
  url: "https://jobs.example.com/staff-product-designer",
  location: "Remote (US)",
  salary,
  source: "Company site",
  posted_at: TODAY,
  workplace_type: "Remote",
  job_summary: "Lead product design for a platform used by operations teams.",
  match_reason: "The role matches Alex's product design and systems experience.",
  key_requirements: "Product strategy, systems design, and cross-functional leadership.",
});

const schema = {
  "Job Title": { type: "title" },
  Company: { type: "rich_text" },
  URL: { type: "url" },
  Location: { type: "rich_text" },
  Salary: { type: "rich_text" },
  Source: { type: "rich_text" },
  "Date sent": { type: "date" },
  "Date posted": { type: "date" },
  "Candidate email": { type: "email" },
  "Why it matched": { type: "rich_text" },
  "Job summary": { type: "rich_text" },
  "Key requirements": { type: "rich_text" },
  Status: { type: "select" },
  Dispatcher: { type: "select" },
};

async function captureSearchResult(salary) {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({
      output_text: JSON.stringify({ jobs: [job(salary)] }),
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  };
  try {
    const result = await scoutJobs({}, candidate, [], "Product designer resume text");
    return { ...result, requestBody };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureNotionWrite(value) {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ id: "saved-job" });
  };
  try {
    await saveJob({}, schema, candidate, value, NOW, "Emailed");
    return requestBody;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function deliverThroughWorker(
  value,
  { templateAvailable = true, initialSchema = {}, resolveFetch } = {},
) {
  const originalFetch = globalThis.fetch;
  const captured = { email: null, notion: null, schemaPatch: null };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/email-template.html")) {
      return templateAvailable
        ? new Response(TEMPLATE, { status: 200 })
        : new Response("template unavailable", { status: 503 });
    }
    if (target === "https://api.resend.com/emails") {
      captured.email = JSON.parse(init.body);
      return Response.json({ id: "email-1" });
    }
    if (target.endsWith("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6")) {
      if (init.method === "PATCH") {
        captured.schemaPatch = JSON.parse(init.body);
        return Response.json({ properties: schema });
      }
      return Response.json({ properties: initialSchema });
    }
    if (target === "https://api.notion.com/v1/pages") {
      captured.notion = JSON.parse(init.body);
      return Response.json({ id: "saved-job" });
    }
    const resolverResponse = await resolveFetch?.(target, init);
    if (resolverResponse) return resolverResponse;
    throw new Error(`unexpected fetch: ${init.method || "GET"} ${target}`);
  };

  try {
    const response = await backupWorker.fetch(
      new Request("https://backup.example/send-email", {
        method: "POST",
        headers: {
          Authorization: "Bearer send-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          candidate_email: candidate.email,
          candidate_name: candidate.name,
          jobs: [value],
        }),
      }),
      {
        NOTION_TOKEN: "notion-token",
        RESEND_API_KEY: "resend-token",
        SEND_API_TOKEN: "send-token",
      },
    );
    return { response, ...captured };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function deliverThroughScheduledWorker(value, resolveFetch) {
  const originalFetch = globalThis.fetch;
  const captured = { email: null, notion: null };
  const scheduledCandidate = { ...candidate, email: "alex@member.test" };
  const candidatePage = {
    id: scheduledCandidate.id,
    properties: {
      Name: { type: "title", title: [{ plain_text: scheduledCandidate.name }] },
      Email: { type: "email", email: scheduledCandidate.email },
      Status: { type: "select", select: { name: "Active" } },
      "Target roles": { type: "rich_text", rich_text: [{ plain_text: scheduledCandidate.targetRoles }] },
      Regions: { type: "rich_text", rich_text: [{ plain_text: scheduledCandidate.regions }] },
      "Min salary": { type: "rich_text", rich_text: [{ plain_text: scheduledCandidate.minSalary }] },
      Seniority: { type: "select", select: { name: scheduledCandidate.seniority } },
      "Remote OK": { type: "select", select: { name: scheduledCandidate.remote } },
      Frequency: { type: "select", select: { name: "Daily" } },
      Notes: { type: "rich_text", rich_text: [{ plain_text: scheduledCandidate.notes }] },
    },
  };

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query")) {
      return Response.json({ results: [candidatePage], has_more: false });
    }
    if (target.endsWith("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    if (target.endsWith("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6")) {
      return Response.json({ properties: schema });
    }
    if (target.includes(`/blocks/${scheduledCandidate.id}/children`)) {
      return Response.json({ results: [], has_more: false });
    }
    if (target === "https://api.openai.com/v1/responses") {
      return Response.json({
        output_text: JSON.stringify({ jobs: [value] }),
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    if (target.endsWith("/email-template.html")) return new Response(TEMPLATE, { status: 200 });
    if (target === "https://api.resend.com/emails") {
      captured.email = JSON.parse(init.body);
      return Response.json({ id: "email-1" });
    }
    if (target === "https://api.notion.com/v1/pages") {
      captured.notion = JSON.parse(init.body);
      return Response.json({ id: "saved-job" });
    }
    const resolverResponse = await resolveFetch(target, init);
    if (resolverResponse) return resolverResponse;
    throw new Error(`unexpected fetch: ${init.method || "GET"} ${target}`);
  };

  const state = new Map();
  try {
    const response = await backupWorker.fetch(
      new Request("https://backup.example/run", {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dry_run: false, force: true }),
      }),
      {
        ADMIN_TOKEN: "admin-token",
        BACKUP_ENABLED: "true",
        NOTION_TOKEN: "notion-token",
        OPENAI_API_KEY: "openai-token",
        RESEND_API_KEY: "resend-token",
        BACKUP_STATE: {
          get: async (key) => state.get(key) || null,
          put: async (key, value) => state.set(key, value),
        },
      },
    );
    return { response, ...captured };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const linkedInJob = () => ({
  ...job(undefined),
  url: LINKEDIN_JOB_URL,
  source: "LinkedIn",
});

const htmlResponse = (body, url) => ({
  ok: true,
  status: 200,
  url,
  text: async () => body,
});

const notFoundResponse = () => ({
  ok: false,
  status: 404,
  url: "",
  text: async () => "",
});

const offsiteFragment = (href = "") => `
  <a class="topcard__org-name-link" href="https://www.linkedin.com/company/northwind">Northwind</a>
  <h2 class="topcard__title">Staff Product Designer</h2>
  <a href="${href}" data-tracking-control-name="public_jobs_apply-link-offsite">Apply</a>`;

const easyApplyFragment = `
  <button data-tracking-control-name="public_jobs_apply-link-onsite">Easy Apply</button>`;

test("salary stated in the posting survives search, email, fallback text, and Notion", async () => {
  const salary = "$175k–$205k";
  const { jobs, requestBody } = await captureSearchResult(salary);
  const salarySchema = JOB_SCHEMA.properties.jobs.items.properties.salary;
  const searchPrompt = requestBody.input.map(({ content }) => content).join("\n");

  assert.equal(salarySchema.type, "string");
  assert.ok(JOB_SCHEMA.properties.jobs.items.required.includes("salary"));
  assert.match(searchPrompt, /copy salary.*posting/i);
  assert.match(searchPrompt, /never (?:guess|infer|invent|estimate).*salary/i);
  assert.equal(jobs[0].salary, salary);

  const sanitized = sanitizeJob(jobs[0]);
  assert.equal(sanitized.salary, salary);

  const email = buildEmail({ template: TEMPLATE, candidate, jobs: [sanitized], now: NOW });
  assert.match(email.html, /Remote \(US\).*\$175k–\$205k.*Company site/s);

  const fallback = fallbackEmail({ candidate, jobs: [sanitized] });
  assert.match(fallback.text, /Remote \(US\).*\$175k–\$205k.*Company site/);

  const notionWrite = await captureNotionWrite(sanitized);
  assert.equal(
    notionWrite.properties.Salary.rich_text[0].text.content,
    salary,
  );
});

test("salary missing from the posting stays empty and the email makes no universal promise", async () => {
  const { jobs } = await captureSearchResult("");
  const sanitized = sanitizeJob(jobs[0]);

  assert.equal(sanitized.salary, "");

  const email = buildEmail({ template: TEMPLATE, candidate, jobs: [sanitized], now: NOW });
  assert.match(email.html, /salary when listed/i);
  assert.doesNotMatch(email.html, /salary and posting date are on every card/i);
  assert.doesNotMatch(email.html, /\$undefined|\$null/);
  assert.equal(email.html.split("&nbsp;·&nbsp;").length - 1, 1);

  const fallback = fallbackEmail({ candidate, jobs: [sanitized] });
  assert.doesNotMatch(fallback.text, /\$undefined|\$null/);

  const notionWrite = await captureNotionWrite(sanitized);
  assert.equal("Salary" in notionWrite.properties, false);
});

test("the backup Worker's send endpoint keeps salary through its real delivery boundary", async () => {
  const salary = "$190k–$225k";
  const delivery = await deliverThroughWorker(job(salary));

  assert.equal(delivery.response.status, 200);
  assert.equal((await delivery.response.json()).sent, true);
  assert.deepEqual(delivery.schemaPatch.properties.Salary, { rich_text: {} });
  assert.match(delivery.email.html, /Remote \(US\).*\$190k–\$225k.*Company site/s);
  assert.equal(
    delivery.notion.properties.Salary.rich_text[0].text.content,
    salary,
  );
});

test("the backup Worker's plain-text delivery omits salary when the posting does not list it", async () => {
  const delivery = await deliverThroughWorker(job(undefined), {
    templateAvailable: false,
    initialSchema: schema,
  });
  const result = await delivery.response.json();

  assert.equal(result.sent, true);
  assert.equal(result.used_fallback_text, true);
  assert.equal(delivery.email.html, undefined);
  assert.match(delivery.email.text, /Remote \(US\) · Company site/);
  assert.doesNotMatch(delivery.email.text, /\$undefined|\$null/);
  assert.equal("Salary" in delivery.notion.properties, false);
});

test("the backup Worker emails a confirmed external employer link but saves the original LinkedIn URL", async () => {
  const employerUrl = "https://jobs.northwind.example/staff-product-designer/apply";
  const delivery = await deliverThroughWorker(linkedInJob(), {
    resolveFetch: async (url) => {
      if (url === LINKEDIN_GUEST_URL) {
        return htmlResponse(offsiteFragment(employerUrl), LINKEDIN_GUEST_URL);
      }
      if (url === employerUrl) return htmlResponse("", employerUrl);
      return null;
    },
  });

  assert.ok(delivery.email.html.includes(employerUrl));
  assert.ok(!delivery.email.html.includes(LINKEDIN_JOB_URL));
  assert.equal(delivery.notion.properties.URL.url, LINKEDIN_JOB_URL);
});

test("the backup Worker keeps LinkedIn in the email for Easy Apply", async () => {
  const delivery = await deliverThroughWorker(linkedInJob(), {
    resolveFetch: async (url) =>
      url === LINKEDIN_GUEST_URL
        ? htmlResponse(easyApplyFragment, LINKEDIN_GUEST_URL)
        : null,
  });

  assert.ok(delivery.email.html.includes(LINKEDIN_JOB_URL));
  assert.equal(delivery.notion.properties.URL.url, LINKEDIN_JOB_URL);
});

test("the backup Worker does not send a match whose external application cannot be resolved", async () => {
  const delivery = await deliverThroughWorker(linkedInJob(), {
    resolveFetch: async (url) =>
      url === LINKEDIN_GUEST_URL
        ? htmlResponse(offsiteFragment(), LINKEDIN_GUEST_URL)
        : notFoundResponse(),
  });
  const result = await delivery.response.json();

  assert.equal(result.sent, false);
  assert.equal(result.skipped, "no_direct_application_links");
  assert.equal(delivery.email, null);
  assert.equal(delivery.notion, null);
});

test("the backup Worker refuses an unsafe external application link", async () => {
  const employerUrl = "https://apply.northwind.example/redirect/771";
  const privateTarget = "http://127.0.0.1:8787/apply";
  const seen = [];
  const delivery = await deliverThroughWorker(linkedInJob(), {
    resolveFetch: async (url) => {
      seen.push(url);
      if (url === LINKEDIN_GUEST_URL) {
        return htmlResponse(offsiteFragment(employerUrl), LINKEDIN_GUEST_URL);
      }
      if (url === employerUrl) {
        return {
          ok: false,
          status: 302,
          url: employerUrl,
          headers: new Headers({ location: privateTarget }),
          text: async () => "",
        };
      }
      throw new Error(`unsafe request: ${url}`);
    },
  });

  assert.ok(delivery.email.html.includes(LINKEDIN_JOB_URL));
  assert.doesNotMatch(delivery.email.html, /127\.0\.0\.1/);
  assert.ok(!seen.includes(privateTarget));
  assert.equal(delivery.notion.properties.URL.url, LINKEDIN_JOB_URL);
});

test("the backup Worker keeps LinkedIn when the employer board match is ambiguous", async () => {
  const delivery = await deliverThroughWorker(linkedInJob(), {
    resolveFetch: async (url) => {
      if (url === LINKEDIN_GUEST_URL) {
        return htmlResponse(offsiteFragment(), LINKEDIN_GUEST_URL);
      }
      if (url === NORTHWIND_ASHBY_URL) {
        return htmlResponse(
          JSON.stringify({
            jobs: [
              {
                title: "Staff Product Designer",
                applyUrl: "https://jobs.ashbyhq.com/northwind/nyc/application",
              },
              {
                title: "Staff Product Designer",
                applyUrl: "https://jobs.ashbyhq.com/northwind/sfo/application",
              },
            ],
          }),
          NORTHWIND_ASHBY_URL,
        );
      }
      return notFoundResponse();
    },
  });

  assert.ok(delivery.email.html.includes(LINKEDIN_JOB_URL));
  assert.doesNotMatch(delivery.email.html, /jobs\.ashbyhq\.com/);
  assert.equal(delivery.notion.properties.URL.url, LINKEDIN_JOB_URL);
});

test("the scheduled backup dispatch resolves the email copy but de-duplicates on LinkedIn", async () => {
  const employerUrl = "https://jobs.northwind.example/staff-product-designer/apply";
  const delivery = await deliverThroughScheduledWorker(linkedInJob(), async (url) => {
    if (url === LINKEDIN_GUEST_URL) {
      return htmlResponse(offsiteFragment(employerUrl), LINKEDIN_GUEST_URL);
    }
    if (url === employerUrl) return htmlResponse("", employerUrl);
    return null;
  });
  const result = await delivery.response.json();

  assert.equal(result.emailed, 1);
  assert.ok(delivery.email.html.includes(employerUrl));
  assert.ok(!delivery.email.html.includes(LINKEDIN_JOB_URL));
  assert.equal(delivery.notion.properties.URL.url, LINKEDIN_JOB_URL);
});

test("the backup Worker keeps its authenticated status route intact", async () => {
  const response = await backupWorker.fetch(
    new Request("https://backup.example/status", {
      headers: { Authorization: "Bearer admin-token" },
    }),
    {
      ADMIN_TOKEN: "admin-token",
      BACKUP_STATE: { get: async () => "1.25" },
      BACKUP_ENABLED: "true",
      RESEND_API_KEY: "resend-token",
      MONTHLY_BUDGET_USD: "4.5",
    },
  );

  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.estimated_spend, 1.25);
  assert.equal(result.resend_configured, true);
});
