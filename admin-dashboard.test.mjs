import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import worker, { buildAdminRecommendationStats } from "./worker.mjs";

const execFileAsync = promisify(execFile);

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
const checkbox = (value) => ({ type: "checkbox", checkbox: Boolean(value) });

const candidatePage = ({
  id,
  name,
  address,
  status = "Active",
  frequency = "Daily",
  archived = false,
  databaseId = "87f58043-765a-4b49-ae7e-6903e48b6996",
}) => ({
  id,
  archived,
  parent: { type: "database_id", database_id: databaseId },
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

test("admin stats rejects a valid session whose linked code has Admin unticked", async () => {
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
          id: "code-regular",
          properties: {
            Code: title("SCOUT-TEST-USER"),
            Admin: checkbox(false),
            "Linked candidate": { relation: [{ id: "cand-regular" }] },
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
    };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-regular",
      email: "regular@example.com",
    }, 3600);
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

test("a revoked code with Admin ticked cannot expose or request admin data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({
        id: "cand-admin",
        name: "Former Admin",
        address: "former-admin@example.com",
      }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      return Response.json({
        results: [{
          id: "code-admin",
          properties: {
            Code: title("SCOUT-TEST-ADMIN"),
            Admin: checkbox(true),
            Status: select("Revoked"),
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
    };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-admin",
      email: "former-admin@example.com",
    }, 3600);
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

test("a candidate with no Admin-ticked code receives an explicit false admin flag", async () => {
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
      return Response.json({ results: [], has_more: false });
    }
    if (path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    throw new Error(`Unexpected Notion request: ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-regular",
      email: "regular@example.com",
    }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "session", session_token: token }),
    }), env);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.member.is_admin, false);
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
            Admin: checkbox(true),
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
    };
    const token = await issueToken(env, {
      purpose: "session",
      member_id: "cand-admin",
      email: "admin@example.com",
    }, 3600);
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
  assert.match(bundle, /__jsIsAdmin\?\[\{label:"Admin"/);
  assert.match(bundle, /"aria-label":"Open account menu"/);
  assert.match(bundle, /"aria-haspopup":"menu"/);
  assert.match(bundle, /role:"menu"/);
  assert.match(bundle, /role:"menuitem".{0,500}"Settings"/);
  assert.match(bundle, /role:"menuitem".{0,500}"Log out"/);
  assert.doesNotMatch(bundle, /\{label:"Settings",icon:LL\}/);
  assert.match(stylesheet, /\.account-menu\{/);
  assert.match(stylesheet, /\.admin-stat-grid\{/);
  assert.match(stylesheet, /@media\(prefers-reduced-motion:reduce\)/);
  assert.equal(
    stylesheet.match(/Account menu and admin recommendation dashboard/g)?.length,
    1,
  );
});

test("the shipped dashboard exposes the admin member-management controls", async () => {
  const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("./assets/index-uR5-NbPW.css", import.meta.url), "utf8");

  assert.match(bundle, /action:"admin_manage",op:__jsOp,member_id:__jsId,session_token:n/);
  assert.match(bundle, /className:"admin-row-menu"/);
  assert.match(bundle, /"Pause delivery"/);
  assert.match(bundle, /"Resume delivery"/);
  assert.match(bundle, /"Make admin"/);
  assert.match(bundle, /"Remove admin"/);
  assert.match(bundle, /"Revoke access"/);
  assert.match(bundle, /"Delete member"/);
  assert.match(bundle, /'aria-modal':!0|"aria-modal":!0/);
  assert.match(bundle, /children:"Manage"/);
  assert.match(bundle, /__jsRowKey=/);
  assert.match(bundle, /__jsClosePending=/);
  assert.match(bundle, /__jsTrapPending=/);
  assert.match(bundle, /Y\.jsx\(Bc,\{mode:"wait",initial:!1,children:__jsRowMenu/);
  assert.match(bundle, /transition:\{type:"spring",stiffness:400,damping:28\}/);
  assert.match(stylesheet, /\.admin-row-pop\{/);
  assert.match(stylesheet, /\.admin-modal-confirm\{/);
  assert.match(stylesheet, /\.admin-row-trigger\{[^}]*width:44px;height:44px/);
});

const codePage = ({ id, code, candidateId, status = "Active", admin = false }) => ({
  id,
  properties: {
    Code: title(code),
    Status: select(status),
    Admin: checkbox(admin),
    "Linked candidate": { relation: candidateId ? [{ id: candidateId }] : [] },
  },
});

// Route Notion CODES-database queries by whether they filter on a linked candidate:
// the admin check and the per-member lookup filter, while loadAdminRecommendationStats
// reads the whole table.
const isFilteredCodeQuery = (init) => {
  try {
    return Boolean(JSON.parse(init?.body || "{}").filter);
  } catch {
    return false;
  }
};

test("admin manage refuses destructive actions on the admin's own account", async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    if (method === "PATCH" || method === "POST" && path.startsWith("/v1/pages")) {
      writes.push({ path, method });
    }
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      return Response.json({
        results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: "cand-admin", admin: true })],
        has_more: false,
      });
    }
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_manage", op: "delete", member_id: "cand-admin", session_token: token }),
    }), env);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error: "admin_self_forbidden" });
    assert.deepEqual(writes.filter((w) => w.method === "PATCH"), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin manage delete archives the member and revokes their access code", async () => {
  const originalFetch = globalThis.fetch;
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    if (method === "PATCH") patches.push({ path, body: JSON.parse(init.body || "{}") });
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (method === "GET" && path.endsWith("/pages/cand-target")) {
      return Response.json(candidatePage({ id: "cand-target", name: "Target User", address: "target@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      if (isFilteredCodeQuery(init)) {
        const linked = JSON.parse(init.body).filter.relation.contains;
        if (linked === "cand-admin") {
          return Response.json({ results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: "cand-admin", admin: true })], has_more: false });
        }
        return Response.json({ results: [codePage({ id: "code-target", code: "SCOUT-TEST-GONE", candidateId: "cand-target" })], has_more: false });
      }
      return Response.json({ results: [], has_more: false });
    }
    if (path.includes("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query")) {
      return Response.json({ results: [], has_more: false });
    }
    if (path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    if (method === "PATCH" && path.startsWith("/v1/pages/")) {
      return Response.json({ id: path.split("/").pop() });
    }
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_manage", op: "delete", member_id: "cand-target", session_token: token }),
    }), env);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.stats);
    const revokeMember = patches.find(
      (p) => p.path.endsWith("/pages/cand-target") && p.body.properties?.Status,
    );
    assert.ok(revokeMember, "member should be revoked before it is archived");
    assert.equal(revokeMember.body.properties.Status.select.name, "Revoked");
    const archive = patches.find(
      (p) => p.path.endsWith("/pages/cand-target") && p.body.archived,
    );
    assert.ok(archive, "member page should be patched");
    assert.equal(archive.body.archived, true);
    const revoke = patches.find((p) => p.path.endsWith("/pages/code-target"));
    assert.ok(revoke, "linked code should be patched");
    assert.equal(revoke.body.properties.Status.select.name, "Revoked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin manage refuses to mutate a page outside the candidates database", async () => {
  const originalFetch = globalThis.fetch;
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    if (method === "PATCH") patches.push({ path, body: JSON.parse(init.body || "{}") });
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      return Response.json({
        results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: "cand-admin", admin: true })],
        has_more: false,
      });
    }
    if (method === "GET" && path.endsWith("/pages/not-a-candidate")) {
      return Response.json(candidatePage({
        id: "not-a-candidate",
        name: "Unrelated page",
        address: "other@example.com",
        databaseId: "111ed911-f8ea-4e69-b6a5-c8c6f7479058",
      }));
    }
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_manage", op: "delete", member_id: "not-a-candidate", session_token: token }),
    }), env);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "member_not_found" });
    assert.deepEqual(patches, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin manage grants admin on a non-revoked linked code", async () => {
  const originalFetch = globalThis.fetch;
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const body = JSON.parse(init.body || "{}");
    if (method === "PATCH") patches.push({ path, body });
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (method === "GET" && path.endsWith("/pages/cand-target")) {
      return Response.json(candidatePage({ id: "cand-target", name: "Target User", address: "target@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      if (isFilteredCodeQuery(init)) {
        const linked = body.filter.relation.contains;
        if (linked === "cand-admin") {
          return Response.json({ results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: "cand-admin", admin: true })], has_more: false });
        }
        return Response.json({
          results: [
            codePage({ id: "code-revoked", code: "SCOUT-OLD-CODE", candidateId: "cand-target", status: "Revoked" }),
            codePage({ id: "code-active", code: "SCOUT-LIVE-CODE", candidateId: "cand-target" }),
          ],
          has_more: false,
        });
      }
      return Response.json({ results: [], has_more: false });
    }
    if (path.includes("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query") ||
        path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    if (method === "PATCH") return Response.json({ id: path.split("/").pop() });
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_manage", op: "set_admin", member_id: "cand-target", session_token: token }),
    }), env);

    assert.equal(response.status, 200);
    const adminWrites = patches.filter(
      (entry) => entry.path.startsWith("/v1/pages/") && entry.body.properties?.Admin,
    );
    assert.equal(adminWrites.length, 1);
    assert.match(adminWrites[0].path, /pages\/code-active$/);
    assert.equal(adminWrites[0].body.properties.Admin.checkbox, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("archived candidates cannot reuse an existing session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/pages/cand-archived")) {
      return Response.json(candidatePage({
        id: "cand-archived",
        name: "Archived Member",
        address: "archived@example.com",
        archived: true,
      }));
    }
    throw new Error(`Unexpected Notion request: ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-archived", email: "archived@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "session", session_token: token }),
    }), env);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_session" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recommendation stats carry the access code and admin flag per member", () => {
  const candidates = [
    { id: "cand-a", name: "Alex Morgan", email: "alex@example.com", status: "Active", frequency: "Daily" },
    { id: "cand-b", name: "Jordan Lee", email: "jordan@example.com", status: "Active", frequency: "Weekly" },
  ];
  const codesByCandidate = new Map([
    ["cand-a", { code: "SCOUT-AAAA-BBBB", code_id: "code-a", is_admin: true }],
  ]);

  const result = buildAdminRecommendationStats(candidates, [], "2026-08-28T12:00:00.000Z", codesByCandidate);
  const alex = result.users.find((u) => u.id === "cand-a");
  const jordan = result.users.find((u) => u.id === "cand-b");

  assert.equal(alex.access_code, "SCOUT-AAAA-BBBB");
  assert.equal(alex.is_admin, true);
  assert.equal(jordan.access_code, "");
  assert.equal(jordan.is_admin, false);
});

test("dashboard patch remains idempotent when applied to the shipped assets", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "job-scout-dashboard-patch-"));
  const tempAssets = join(tempDirectory, "assets");

  try {
    await mkdir(tempAssets);
    await Promise.all([
      copyFile(new URL("./patch-dashboard.mjs", import.meta.url), join(tempDirectory, "patch-dashboard.mjs")),
      copyFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), join(tempAssets, "index-BdD4MZod.js")),
      copyFile(new URL("./assets/index-uR5-NbPW.css", import.meta.url), join(tempAssets, "index-uR5-NbPW.css")),
    ]);

    await execFileAsync(process.execPath, ["patch-dashboard.mjs"], { cwd: tempDirectory });
    await execFileAsync(process.execPath, ["patch-dashboard.mjs"], { cwd: tempDirectory });
    await execFileAsync(process.execPath, ["--check", "assets/index-BdD4MZod.js"], { cwd: tempDirectory });

    const bundle = await readFile(join(tempAssets, "index-BdD4MZod.js"), "utf8");
    assert.equal(bundle.match(/__jsManageMsg=__jsC=>/g)?.length, 1);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("admin authorization follows linked access-code pagination", async () => {
  const originalFetch = globalThis.fetch;
  let filteredCodePages = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const body = JSON.parse(init.body || "{}");
    if (method === "GET" && path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      if (!body.filter) return Response.json({ results: [], has_more: false });
      filteredCodePages += 1;
      if (!body.start_cursor) {
        return Response.json({ results: [], has_more: true, next_cursor: "codes-page-2" });
      }
      assert.equal(body.start_cursor, "codes-page-2");
      return Response.json({
        results: [codePage({ id: "code-admin", code: "SCOUT-PAGED-ADMIN", candidateId: "cand-admin", admin: true })],
        has_more: false,
      });
    }
    if (path.includes("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query") ||
        path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_stats", session_token: token }),
    }), env);

    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(filteredCodePages, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin manage cannot pause or resume a revoked member", async () => {
  const originalFetch = globalThis.fetch;
  const patches = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const body = JSON.parse(init.body || "{}");
    if (method === "PATCH") patches.push({ path, body });
    if (method === "GET" && path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (method === "GET" && path.endsWith("/pages/cand-revoked")) {
      return Response.json(candidatePage({
        id: "cand-revoked",
        name: "Revoked User",
        address: "revoked@example.com",
        status: "Revoked",
      }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      if (body.filter?.relation?.contains === "cand-admin") {
        return Response.json({
          results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: "cand-admin", admin: true })],
          has_more: false,
        });
      }
      return Response.json({ results: [], has_more: false });
    }
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: "cand-admin", email: "admin@example.com" }, 3600);

    for (const op of ["pause", "resume"]) {
      const response = await worker.fetch(new Request("https://worker.example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_manage", op, member_id: "cand-revoked", session_token: token }),
      }), env);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { ok: false, error: "member_revoked" });
    }
    assert.deepEqual(patches, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin self-protection normalizes Notion page IDs", async () => {
  const originalFetch = globalThis.fetch;
  const adminId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const compactAdminId = adminId.replaceAll("-", "");
  const writes = [];
  let compactTargetReads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method || "GET";
    const body = JSON.parse(init.body || "{}");
    if (method === "PATCH") writes.push({ path, body });
    if (method === "GET" && path.endsWith(`/pages/${adminId}`)) {
      return Response.json(candidatePage({ id: adminId, name: "Admin User", address: "admin@example.com" }));
    }
    if (method === "GET" && path.endsWith(`/pages/${compactAdminId}`)) {
      compactTargetReads += 1;
      return Response.json(candidatePage({ id: adminId, name: "Admin User", address: "admin@example.com" }));
    }
    if (path.includes("/databases/111ed911-f8ea-4e69-b6a5-c8c6f7479058/query")) {
      if (body.filter) {
        return Response.json({
          results: [codePage({ id: "code-admin", code: "SCOUT-TEST-ADMIN", candidateId: adminId, admin: true })],
          has_more: false,
        });
      }
      return Response.json({ results: [], has_more: false });
    }
    if (path.includes("/databases/87f58043-765a-4b49-ae7e-6903e48b6996/query") ||
        path.includes("/databases/236b97b7-af8b-4c3d-8d67-f57fdc6386c6/query")) {
      return Response.json({ results: [], has_more: false });
    }
    if (method === "PATCH") return Response.json({ id: path.split("/").pop() });
    throw new Error(`Unexpected Notion request: ${method} ${url}`);
  };

  try {
    const { issueToken } = await import("./worker.mjs");
    const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion" };
    const token = await issueToken(env, { purpose: "session", member_id: adminId, email: "admin@example.com" }, 3600);
    const response = await worker.fetch(new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_manage", op: "delete", member_id: compactAdminId, session_token: token }),
    }), env);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, error: "admin_self_forbidden" });
    assert.equal(compactTargetReads, 0);
    assert.deepEqual(writes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
