import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  JOB_SCHEMA,
  buildEmail,
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
