import assert from "node:assert/strict";
import test from "node:test";

import worker, { issueToken } from "./worker.mjs";

const CODES_DB = "111ed911-f8ea-4e69-b6a5-c8c6f7479058";
const CAND_DB = "87f58043-765a-4b49-ae7e-6903e48b6996";
const SENT_DB = "236b97b7-af8b-4c3d-8d67-f57fdc6386c6";

const title = (value) => ({ type: "title", title: [{ plain_text: value }] });
const richText = (value) => ({ type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] });
const email = (value) => ({ type: "email", email: value });
const select = (value) => ({ type: "select", select: value ? { name: value } : null });
const date = (value) => ({ type: "date", date: value ? { start: value } : null });
const checkbox = (value) => ({ type: "checkbox", checkbox: Boolean(value) });
const url = (value) => ({ type: "url", url: value || null });

const candidatePage = ({ id, name, address, databaseId = CAND_DB, extra = {} }) => ({
  id,
  archived: false,
  parent: { type: "database_id", database_id: databaseId },
  properties: {
    Name: title(name),
    Email: email(address),
    Status: select("Active"),
    Frequency: select("Daily"),
    "Target roles": richText("Product Designer"),
    Regions: richText("Remote"),
    "Min salary": richText("$140k"),
    Seniority: select("Senior+"),
    "Remote OK": select("Yes"),
    "Steer away": richText("crypto"),
    "Steer mode": select("Hide"),
    "Match context": richText("Pay — too low"),
    Notes: richText("Keywords: systems\nMaximum salary: $220k+\nResume file: alex.pdf"),
    ...extra,
  },
});

const codePage = ({ id, candidateId, admin }) => ({
  id,
  properties: {
    Code: title("SCOUT-CODE"),
    Status: select("Active"),
    Admin: checkbox(admin),
    "Linked candidate": { relation: [{ id: candidateId }] },
  },
});

const jobPage = ({ id, address, decision = "", feedback = "", link = "" }) => ({
  id,
  properties: {
    "Job Title": title(`Role ${id}`),
    Company: richText("Acme"),
    Location: richText("Remote"),
    Salary: richText("$180k"),
    URL: url(link),
    "Candidate email": email(address),
    "Dashboard decision": select(decision),
    "Dashboard feedback": richText(feedback),
    "Date sent": date("2026-10-01T10:00:00.000Z"),
  },
});

// A Notion stub with an admin, two members, three postings, and a résumé page,
// plus a scriptable OpenAI endpoint. Every test records what was requested.
function installStub({ openai = "ok", resumeFails = false, candidateLookup = "ok" } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = { openaiBodies: [], sentQueries: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const href = String(input);
    const path = new URL(href).pathname;
    const body = JSON.parse(init.body || "{}");
    if (href.startsWith("https://api.openai.com/")) {
      calls.openaiBodies.push(body);
      if (openai === "throw") throw new Error("socket hang up");
      if (openai === "fail") return new Response("upstream down", { status: 500 });
      return Response.json({
        output_text: JSON.stringify({ narrative: "Alex is after senior product design roles, remote first, and passes on anything underpaid." }),
      });
    }
    if (path.endsWith("/pages/cand-admin")) {
      return Response.json(candidatePage({ id: "cand-admin", name: "Admin User", address: "admin@example.com" }));
    }
    if (path.endsWith("/pages/cand-a")) {
      if (candidateLookup === "rate-limited") return Response.json({ object: "error", status: 429, message: "rate_limited" }, { status: 429 });
      return Response.json(candidatePage({ id: "cand-a", name: "Alex Morgan", address: "alex@example.com", extra: {
        "Match context": richText("Pay — too low, call me at 415-555-0100"),
      } }));
    }
    if (path.endsWith("/pages/cand-b")) {
      return Response.json(candidatePage({ id: "cand-b", name: "Jordan Lee", address: "jordan@example.com" }));
    }
    if (path.endsWith("/pages/cand-foreign")) {
      return Response.json(candidatePage({ id: "cand-foreign", name: "Other", address: "o@example.com", databaseId: "not-the-candidates-db" }));
    }
    if (path.endsWith("/pages/cand-missing")) {
      return Response.json({ object: "error", status: 404, message: "Could not find page" }, { status: 404 });
    }
    if (path.includes(`/databases/${CODES_DB}/query`)) {
      const target = body.filter?.relation?.contains;
      return Response.json({
        results: target === "cand-admin" ? [codePage({ id: "code-admin", candidateId: "cand-admin", admin: true })]
          : target === "cand-b" ? [codePage({ id: "code-b", candidateId: "cand-b", admin: false })]
          : [],
        has_more: false,
      });
    }
    if (path.includes(`/databases/${SENT_DB}/query`)) {
      calls.sentQueries += 1;
      return Response.json({
        results: [
          jobPage({ id: "j1", address: "alex@example.com", decision: "Interested", link: "https://acme.example/jobs/1" }),
          jobPage({ id: "j2", address: "ALEX@example.com", decision: "Not interested", feedback: "Pay — too low" }),
          jobPage({ id: "j3", address: "jordan@example.com" }),
        ],
        has_more: false,
      });
    }
    if (path.includes("/blocks/cand-a/children")) {
      if (resumeFails) return new Response("boom", { status: 500 });
      return Response.json({
        results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Alex Morgan — alex@example.com — 415-555-0100 — product designer." }] } }],
        has_more: false,
      });
    }
    if (path.includes("/blocks/")) return Response.json({ results: [], has_more: false });
    throw new Error(`Unexpected request: ${href}`);
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "test-notion", OPENAI_API_KEY: "sk-test" };

const post = async (payload, overrides = {}) =>
  worker.fetch(
    new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { ...env, ...overrides },
  );

const sessionFor = (memberId, address) =>
  issueToken(env, { purpose: "session", member_id: memberId, email: address }, 3600);

test("admin_export refuses a non-admin session", async () => {
  const stub = installStub();
  try {
    const token = await sessionFor("cand-b", "jordan@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown" });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "admin_forbidden" });
    assert.equal(stub.calls.openaiBodies.length, 0);
  } finally {
    stub.restore();
  }
});

test("admin_export validates format and member ids before touching member data", async () => {
  const stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const base = { action: "admin_export", session_token: token };

    let response = await post({ ...base, member_ids: ["cand-a"], format: "pdf" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "unknown_format");

    response = await post({ ...base, member_ids: [], format: "html" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "members_required");

    response = await post({ ...base, member_ids: "cand-a", format: "html" });
    assert.equal((await response.json()).error, "members_required");

    response = await post({ ...base, member_ids: Array.from({ length: 26 }, (_, i) => `cand-${i}`), format: "html" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "too_many_members", limit: 25 });

    response = await post({ ...base, member_ids: ["cand-a", "cand-missing"], format: "html" });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "member_not_found", member_id: "cand-missing" });

    response = await post({ ...base, member_ids: ["cand-foreign"], format: "html" });
    assert.equal(response.status, 404);
    assert.equal(stub.calls.sentQueries, 0);
    assert.equal(stub.calls.openaiBodies.length, 0);
  } finally {
    stub.restore();
  }
});

test("admin_export renders a member's preferences, decisions, résumé, and narrative", async () => {
  const stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "html" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.format, "html");
    assert.equal(body.mime, "text/html;charset=utf-8");
    assert.match(body.filename, /^job-scout-profile-alex-morgan-\d{4}-\d{2}-\d{2}\.html$/);
    assert.deepEqual(body.members, [{ id: "cand-a", name: "Alex Morgan", narrative: "ready" }]);
    assert.match(body.content, /^<!doctype html>/);
    assert.match(body.content, /Alex Morgan/);
    assert.match(body.content, /Product Designer/);
    assert.match(body.content, /\$220k\+/);
    assert.match(body.content, /Pay \(1\)/);
    assert.match(body.content, /href="https:\/\/acme\.example\/jobs\/1"/);
    assert.match(body.content, /415-555-0100/); // the export itself keeps the résumé verbatim
    assert.match(body.content, /remote first, and passes on anything underpaid/);

    assert.equal(stub.calls.openaiBodies.length, 1);
    const prompt = stub.calls.openaiBodies[0].input[1].content;
    assert.doesNotMatch(prompt, /alex@example\.com/);
    assert.doesNotMatch(prompt, /415-555-0100/);
    assert.match(prompt, /\[email redacted\]/);
    assert.match(prompt, /\[phone redacted\]/);
    assert.match(prompt, /too low, call me at \[phone redacted\]/);
  } finally {
    stub.restore();
  }
});

test("admin_export degrades to stats-only when the narrative fails", async () => {
  for (const mode of ["fail", "throw"]) {
    const stub = installStub({ openai: mode });
    try {
      const token = await sessionFor("cand-admin", "admin@example.com");
      const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown" });
      assert.equal(response.status, 200, mode);
      const body = await response.json();
      assert.equal(body.mime, "text/markdown;charset=utf-8");
      assert.match(body.filename, /\.md$/);
      assert.match(body.content, mode === "fail" ? /AI summary unavailable\. \(`openai_error`\)/ : /AI summary unavailable\. \(`narrative_failed`\)/);
      assert.doesNotMatch(body.content, /upstream down|socket hang up/);
      assert.deepEqual(body.members, [{ id: "cand-a", name: "Alex Morgan", narrative: "unavailable" }]);
    } finally {
      stub.restore();
    }
  }
});

test("admin_export skips OpenAI without a key or when narrative is false", async () => {
  let stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown" }, { OPENAI_API_KEY: "" });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /AI summary unavailable\. \(`openai_api_key_missing`\)/);
    assert.equal(stub.calls.openaiBodies.length, 0);
  } finally {
    stub.restore();
  }
  stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown", narrative: false });
    const body = await response.json();
    assert.match(body.content, /## AI summary\n\n_[^\n]*_\n\nAI summary unavailable\.\n/);
    assert.equal(stub.calls.openaiBodies.length, 0);
  } finally {
    stub.restore();
  }
});

test("admin_export reports a Notion failure as a lookup error, not a missing member", async () => {
  const stub = installStub({ candidateLookup: "rate-limited" });
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown" });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, error: "member_lookup_failed" });
  } finally {
    stub.restore();
  }
});

test("admin_export drops ids that could steer the Notion path", async () => {
  const stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["../users/me", "cand a", ""], format: "markdown" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "members_required");
  } finally {
    stub.restore();
  }
});

test("admin_export survives a résumé that cannot be read", async () => {
  const stub = installStub({ resumeFails: true });
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({ action: "admin_export", session_token: token, member_ids: ["cand-a"], format: "markdown" });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /No résumé text on file\./);
  } finally {
    stub.restore();
  }
});

test("admin_export scans sent postings once for several members and de-duplicates ids", async () => {
  const stub = installStub();
  try {
    const token = await sessionFor("cand-admin", "admin@example.com");
    const response = await post({
      action: "admin_export",
      session_token: token,
      member_ids: ["cand-a", "cand-b", "cand-a", "CAND-B"],
      format: "markdown",
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(stub.calls.sentQueries, 1);
    assert.match(body.filename, /^job-scout-profiles-2-members-/);
    assert.deepEqual(body.members.map((member) => member.name), ["Alex Morgan", "Jordan Lee"]);
    assert.match(body.content, /^# Job Scout member profiles/);
    assert.match(body.content, /# Jordan Lee/);
    assert.equal(stub.calls.openaiBodies.length, 2);
  } finally {
    stub.restore();
  }
});
