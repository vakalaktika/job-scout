import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { buildAdminRecommendationStats } from "./worker.mjs";

const title = (value) => ({
  type: "title",
  title: [{ plain_text: value }],
});

const richText = (value) => ({
  type: "rich_text",
  rich_text: value ? [{ plain_text: value }] : [],
});

const email = (value) => ({ type: "email", email: value });
const select = (value) => ({ type: "select", select: value ? { name: value } : null });
const date = (value) => ({ type: "date", date: value ? { start: value } : null });

const candidatePage = ({ id, name, address, status = "Active", frequency = "Daily" }) => ({
  id,
  properties: {
    Name: title(name),
    Email: email(address),
    Status: select(status),
    Frequency: select(frequency),
  },
});

const jobPage = ({ id, address, decision = "", application = "", sentAt }) => ({
  id,
  properties: {
    "Job Title": title(`Role ${id}`),
    "Candidate email": email(address),
    "Dashboard decision": select(decision),
    "Application status": select(application),
    "Date sent": date(sentAt),
  },
});

test("recommendation stats summarize every user without mutating source records", () => {
  const candidates = [
    { id: "cand-a", name: "Alex Morgan", email: "Alex@example.com", status: "Active", frequency: "Daily" },
    { id: "cand-b", name: "Jordan Lee", email: "jordan@example.com", status: "Paused", frequency: "Weekly" },
    { id: "cand-c", name: "No Matches", email: "none@example.com", status: "Active", frequency: "Daily" },
  ];
  const jobs = [
    { id: "job-1", candidate_email: "alex@example.com", decision: "", application_status: "", sent_at: "2026-08-28T10:00:00.000Z" },
    { id: "job-2", candidate_email: "ALEX@example.com", decision: "Interested", application_status: "Applied", sent_at: "2026-08-27T10:00:00.000Z" },
    { id: "job-3", candidate_email: "jordan@example.com", decision: "Not interested", application_status: "", sent_at: "2026-08-20T10:00:00.000Z" },
  ];
  const source = structuredClone({ candidates, jobs });

  const result = buildAdminRecommendationStats(candidates, jobs, "2026-08-28T12:00:00.000Z");

  assert.deepEqual(result.summary, {
    users: 3,
    recommendations: 3,
    awaiting_review: 1,
    applications: 1,
  });
  assert.deepEqual(result.users.map(({ name, recommendations, awaiting_review, saved, passed, applications }) => ({
    name,
    recommendations,
    awaiting_review,
    saved,
    passed,
    applications,
  })), [
    { name: "Alex Morgan", recommendations: 2, awaiting_review: 1, saved: 1, passed: 0, applications: 1 },
    { name: "Jordan Lee", recommendations: 1, awaiting_review: 0, saved: 0, passed: 1, applications: 0 },
    { name: "No Matches", recommendations: 0, awaiting_review: 0, saved: 0, passed: 0, applications: 0 },
  ]);
  assert.equal(result.generated_at, "2026-08-28T12:00:00.000Z");
  assert.deepEqual({ candidates, jobs }, source);
});

test("admin stats rejects a valid session that is not linked to the admin access code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/pages/cand-regular")) {
      return Response.json(candidatePage({
        id: "cand-regular",
        name: "Regular Member",
        address: "regular@example.com",
      }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      return Response.json({
        results: [{
          id: "code-admin",
          properties: {
            Code: title("SCOUT-TEST-ADMIN"),
            "Linked candidate": { relation: [{ id: "cand-admin" }] },
          },
        }],
        has_more: false,
      });
    }
    throw new Error(`Unexpected Notion request: ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = {
      SESSION_SECRET: "test-secret",
      NOTION_TOKEN: "test-notion",
      ADMIN_ACCESS_CODE: "SCOUT-TEST-ADMIN",
    };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-regular",
      email: "regular@example.com",
    });
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_stats", session_token: token }),
    }), env);

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "admin_forbidden" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin stats returns aggregate recommendation data for the linked admin account", async () => {
  const originalFetch = globalThis.fetch;
  const candidates = [
    candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }),
    candidatePage({ id: "cand-member", name: "Member User", address: "member@example.com", status: "Paused" }),
  ];
  const jobs = [
    jobPage({ id: "job-1", address: "admin@example.com", sentAt: "2026-08-28T10:00:00.000Z" }),
    jobPage({ id: "job-2", address: "member@example.com", decision: "Interested", application: "Applied", sentAt: "2026-08-27T10:00:00.000Z" }),
  ];

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/pages/cand-admin")) return Response.json(candidates[0]);
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      return Response.json({
        results: [{
          id: "code-admin",
          properties: {
            Code: title("SCOUT-TEST-ADMIN"),
            "Linked candidate": { relation: [{ id: "cand-admin" }] },
          },
        }],
        has_more: false,
      });
    }
    if (path.includes("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query")) {
      return Response.json({ results: candidates, has_more: false });
    }
    if (path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: jobs, has_more: false });
    }
    throw new Error(`Unexpected Notion request: ${init.method || "GET"} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = {
      SESSION_SECRET: "test-secret",
      NOTION_TOKEN: "test-notion",
      ADMIN_ACCESS_CODE: "SCOUT-TEST-ADMIN",
    };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-admin",
      email: "admin@example.com",
    });
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_stats", session_token: token }),
    }), env);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.stats.summary.users, 2);
    assert.equal(body.stats.summary.recommendations, 2);
    assert.equal(body.stats.summary.applications, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the shipped dashboard has a protected Admin tab and an avatar account menu", async () => {
  const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("./assets/index-uR5-NbPW.css", import.meta.url), "utf8");

  assert.match(bundle, /action:"admin_stats",session_token:n/);
  assert.match(bundle, /is_admin\?\[\{label:"Admin"/);
  assert.match(bundle, /aria-label:"Open account menu"/);
  assert.match(bundle, /aria-haspopup:"menu"/);
  assert.match(bundle, /role:"menu"/);
  assert.match(bundle, /role:"menuitem"[^}]+children:\[.*Settings/);
  assert.match(bundle, /role:"menuitem"[^}]+Log out/);
  assert.doesNotMatch(bundle, /\{label:"Settings",icon:LL\}/);
  assert.match(stylesheet, /\.account-menu\{/);
  assert.match(stylesheet, /\.admin-stat-grid\{/);
  assert.match(stylesheet, /@media\(prefers-reduced-motion:reduce\)/);
});
