// Request-level coverage for the Worker routes a member's recovery depends on.
//
// The existing suite tests the Worker's pure helpers well and its HTTP surface
// barely at all, which is how a magic link that consumed its own nonce before the
// session existed shipped: every helper involved was correct on its own. These
// tests drive `worker.fetch` end to end against a stubbed Notion so the ordering
// between those helpers is what is actually asserted.
import assert from "node:assert/strict";
import test from "node:test";
import worker, { issueToken } from "./worker.mjs";

const SENT_POSTINGS_DB = "236b97b7-af8b-4c3d-8d67-f57fdc6386c6";
const CANDIDATE_ID = "cand-1";
const env = { SESSION_SECRET: "test-secret", NOTION_TOKEN: "notion-test-token" };

const richText = (value) => ({
  type: "rich_text",
  rich_text: value ? [{ type: "text", plain_text: String(value) }] : [],
});

const candidatePage = (overrides = {}) => ({
  id: CANDIDATE_ID,
  properties: {
    Name: { type: "title", title: [{ plain_text: "Alex Morgan" }] },
    Email: { type: "email", email: "alex@example.com" },
    Status: { type: "select", select: { name: "Active" } },
    "Magic nonce": richText("nonce-1"),
    Notes: richText(""),
    ...overrides,
  },
});

// A Notion stub that records every write, so a test can assert not just the
// response a member sees but what the account was left in when they saw it.
const stubNotion = ({ candidate = candidatePage(), onQuery, onPatch } = {}) => {
  const state = { page: candidate, patches: [], queries: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.notion.com/v1/", "");
    // Schema-ensuring writes are idempotent bookkeeping; acknowledge and move on.
    if (path.startsWith("databases/") && !path.endsWith("/query")) return Response.json({ id: path });
    if (path === `databases/${SENT_POSTINGS_DB}/query`) {
      state.queries += 1;
      if (onQuery) return onQuery(state);
      return Response.json({ results: [], has_more: false });
    }
    if (path === `pages/${CANDIDATE_ID}` && (init.method || "GET") === "GET") {
      return Response.json(state.page);
    }
    if (path === `pages/${CANDIDATE_ID}` && init.method === "PATCH") {
      const body = JSON.parse(init.body);
      state.patches.push(body.properties);
      if (onPatch) {
        const forced = onPatch(body.properties, state);
        if (forced) return forced;
      }
      // Mirror the write back so a later GET sees what a real Notion would.
      state.page = {
        ...state.page,
        properties: { ...state.page.properties, ...body.properties },
      };
      return Response.json(state.page);
    }
    throw new Error(`unexpected notion call: ${init.method || "GET"} ${path}`);
  };
  state.restore = () => {
    globalThis.fetch = original;
  };
  return state;
};

const post = (body, overrides = {}) =>
  worker.fetch(
    new Request("https://worker.example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ...env, ...overrides },
  );

const magicToken = (payload = {}, lifetime = 900) =>
  issueToken(env, { purpose: "magic", member_id: CANDIDATE_ID, email: "alex@example.com", nonce: "nonce-1", ...payload }, lifetime);

const storedNonce = (state) =>
  (state.page.properties["Magic nonce"].rich_text || []).map((item) => item.plain_text).join("");

test("a valid magic link mints a session and consumes its own nonce exactly once", async () => {
  const notion = stubNotion();
  try {
    const first = await post({ action: "magic_consume", magic_token: await magicToken() });
    const body = await first.json();

    assert.equal(first.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, "magic");
    assert.ok(body.session_token);
    assert.equal(body.member.email, "alex@example.com");
    assert.equal(storedNonce(notion), "");
  } finally {
    notion.restore();
  }
});

test("a link whose nonce has already been spent says so instead of failing generically", async () => {
  const notion = stubNotion({ candidate: candidatePage({ "Magic nonce": richText("") }) });
  try {
    const response = await post({ action: "magic_consume", magic_token: await magicToken() });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "used_link" });
  } finally {
    notion.restore();
  }
});

test("an expired link is reported as expired so the page can offer another one", async () => {
  const notion = stubNotion();
  try {
    const response = await post({ action: "magic_consume", magic_token: await magicToken({}, -10) });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "expired_link" });
    // Nothing was consumed, because nothing was ever verified.
    assert.equal(notion.patches.length, 0);
  } finally {
    notion.restore();
  }
});

test("a token that was never a sign-in link is refused as invalid, not as expired", async () => {
  const notion = stubNotion();
  try {
    const session = await issueToken(env, { purpose: "session", member_id: CANDIDATE_ID }, 900);
    const response = await post({ action: "magic_consume", magic_token: session });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_link" });
  } finally {
    notion.restore();
  }
});

test("a revoked member cannot sign in through a link that is otherwise valid", async () => {
  const notion = stubNotion({
    candidate: candidatePage({ Status: { type: "select", select: { name: "Revoked" } } }),
  });
  try {
    const response = await post({ action: "magic_consume", magic_token: await magicToken() });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "revoked" });
    assert.equal(storedNonce(notion), "nonce-1");
  } finally {
    notion.restore();
  }
});

// The failure this ordering exists to prevent: a link that dies on our error
// rather than on its own use. Whatever goes wrong while consuming it, the member
// must still be able to click the same link again.
test("a link survives a transient failure and still works on the next attempt", async () => {
  let failNextWrite = true;
  const notion = stubNotion({
    onPatch: (properties) => {
      if (failNextWrite && properties["Magic nonce"]) {
        failNextWrite = false;
        return new Response("notion is having a moment", { status: 500 });
      }
      return null;
    },
  });

  try {
    const failed = await post({ action: "magic_consume", magic_token: await magicToken() });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { ok: false, error: "server_error" });
    // The nonce is untouched, so the link is still the member's way back in.
    assert.equal(storedNonce(notion), "nonce-1");

    const retried = await post({ action: "magic_consume", magic_token: await magicToken() });
    const body = await retried.json();
    assert.equal(retried.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.session_token);
    assert.equal(storedNonce(notion), "");
  } finally {
    notion.restore();
  }
});

test("requesting a link answers the same way whether or not the address has an account", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    const path = String(url).replace("https://api.notion.com/v1/", "");
    if (path.endsWith("/query")) return Response.json({ results: [], has_more: false });
    throw new Error(`unexpected notion call: ${init.method || "GET"} ${path}`);
  };
  try {
    const response = await post({ action: "magic_request", email: "nobody@example.com" });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    // No mail provider was contacted, so nothing about the address leaked.
    assert.ok(calls.every((url) => url.startsWith("https://api.notion.com/")));
  } finally {
    globalThis.fetch = original;
  }
});

// --------------------------------------------------------------------------
// The one-time first scout, from the caller's side.
// --------------------------------------------------------------------------

const gateEnv = (handler) => ({
  FIRST_SCOUT_GATE: {
    idFromName: (name) => name,
    get: () => ({ fetch: handler }),
  },
});

const sessionToken = () =>
  issueToken(env, { purpose: "session", member_id: CANDIDATE_ID, email: "alex@example.com" }, 900);

test("a first scout that has already run is reported rather than started twice", async () => {
  const notion = stubNotion({
    candidate: candidatePage({
      "First scout status": { type: "select", select: { name: "Queued" } },
    }),
  });
  let started = 0;
  try {
    const response = await post(
      { action: "run_scout_once", session_token: await sessionToken() },
      gateEnv(async () => {
        started += 1;
        return Response.json({ status: "queued", requested_at: "", completed_at: "", attempts: 1 });
      }),
    );
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.already_requested, true);
    assert.equal(body.first_scout.status, "queued");
    assert.equal(body.first_scout.can_retry, false);
    // The gate is read for status but never asked to start anything.
    assert.equal(started, 1);
  } finally {
    notion.restore();
  }
});

test("a failed first scout is retried through the gate instead of being refused", async () => {
  const notion = stubNotion({
    candidate: candidatePage({
      "First scout status": { type: "select", select: { name: "Failed" } },
    }),
  });
  const requests = [];
  try {
    const response = await post(
      { action: "run_scout_once", session_token: await sessionToken() },
      gateEnv(async (url, init) => {
        if (!init) return Response.json({ status: "failed", attempts: 1 });
        requests.push(JSON.parse(init.body));
        return Response.json({ status: "queued", requested_at: "", completed_at: "", attempts: 2 });
      }),
    );
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.first_scout.status, "queued");
    assert.deepEqual(requests, [{ candidate_id: CANDIDATE_ID, retry: true }]);
  } finally {
    notion.restore();
  }
});

test("a first scout with no attempts left stops offering a retry the UI cannot make", async () => {
  const notion = stubNotion({
    candidate: candidatePage({
      "First scout status": { type: "select", select: { name: "Failed" } },
    }),
  });
  try {
    const response = await post(
      { action: "scout_status", session_token: await sessionToken() },
      gateEnv(async () => Response.json({ status: "failed", attempts: 3 })),
    );
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.first_scout.status, "failed");
    assert.equal(body.first_scout.can_retry, false);
  } finally {
    notion.restore();
  }
});

// --------------------------------------------------------------------------
// The rest of the authenticated surface, at the level a client sees it.
// --------------------------------------------------------------------------

test("the API answers only POST and only valid JSON", async () => {
  const wrongMethod = await worker.fetch(new Request("https://worker.example"), env);
  assert.equal(wrongMethod.status, 405);

  const preflight = await worker.fetch(
    new Request("https://worker.example", { method: "OPTIONS" }),
    env,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://vakalaktika.github.io");

  const garbage = await worker.fetch(
    new Request("https://worker.example", { method: "POST", body: "{" }),
    env,
  );
  assert.equal(garbage.status, 400);
});

test("every member route refuses an unsigned session", async () => {
  for (const action of ["session", "scout_status", "job_decision", "job_application", "job_brief"]) {
    const response = await post({ action, session_token: "not-a-token" });
    assert.equal(response.status, 401, action);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_session" });
  }
});

test("an invite code that fails its own checksum never reaches Notion", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Notion must not be called for a malformed code");
  };
  try {
    const response = await post({ action: "validate", access_code: "SCOUT-AAAA-BBBB" });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_code" });
  } finally {
    globalThis.fetch = original;
  }
});

test("a decision is stored and the job comes back in the shape the card renders", async () => {
  const jobPage = {
    id: "job-1",
    properties: {
      Role: { type: "title", title: [{ plain_text: "Senior Product Designer" }] },
      "Candidate email": { type: "email", email: "alex@example.com" },
      Decision: { type: "select", select: { name: "Interested" } },
    },
  };
  const original = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.notion.com/v1/", "");
    if (path === `pages/${CANDIDATE_ID}`) return Response.json(candidatePage());
    if (path === "pages/job-1") {
      if (init.method === "PATCH") writes.push(JSON.parse(init.body).properties);
      return Response.json(jobPage);
    }
    if (path.startsWith("databases/")) return Response.json({ results: [], has_more: false });
    throw new Error(`unexpected notion call: ${init.method || "GET"} ${path}`);
  };
  try {
    const response = await post({
      action: "job_decision",
      session_token: await sessionToken(),
      job_id: "job-1",
      decision: "Interested",
    });
    const body = await response.json();

    assert.equal(body.ok, true);
    assert.equal(body.job.id, "job-1");
    // Internal-only fields never cross the wire.
    assert.equal(body.job._posting_text, undefined);
    assert.ok(writes.length);
  } finally {
    globalThis.fetch = original;
  }
});

test("a brief cannot be read for a posting that belongs to someone else", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace("https://api.notion.com/v1/", "");
    if (path === `pages/${CANDIDATE_ID}`) return Response.json(candidatePage());
    if (path === "pages/job-9") {
      return Response.json({
        id: "job-9",
        properties: { "Candidate email": { type: "email", email: "someone-else@example.com" } },
      });
    }
    throw new Error(`unexpected notion call: ${init.method || "GET"} ${path}`);
  };
  try {
    const response = await post({
      action: "job_brief",
      session_token: await sessionToken(),
      job_id: "job-9",
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "job_forbidden" });
  } finally {
    globalThis.fetch = original;
  }
});

// --------------------------------------------------------------------------
// Delivery settings against unrelated preference edits.
// --------------------------------------------------------------------------

const patchedStatus = (state) =>
  [...state.patches].reverse().find((properties) => properties.Status)?.Status?.select?.name;

test("editing a preference leaves a paused member paused", async () => {
  const notion = stubNotion({
    candidate: candidatePage({ Status: { type: "select", select: { name: "Paused" } } }),
  });
  try {
    const response = await post({
      session_token: await sessionToken(),
      target_roles: "Staff Product Designer",
    });

    assert.equal((await response.json()).ok, true);
    assert.equal(patchedStatus(notion), "Paused");
  } finally {
    notion.restore();
  }
});

test("choosing a cadence is what resumes a paused member, and it still does", async () => {
  const notion = stubNotion({
    candidate: candidatePage({ Status: { type: "select", select: { name: "Paused" } } }),
  });
  try {
    const response = await post({ session_token: await sessionToken(), frequency: "Weekly" });

    assert.equal((await response.json()).ok, true);
    assert.equal(patchedStatus(notion), "Active");
  } finally {
    notion.restore();
  }
});

test("an active member editing preferences stays active", async () => {
  const notion = stubNotion();
  try {
    const response = await post({ session_token: await sessionToken(), seniority: "Staff+" });

    assert.equal((await response.json()).ok, true);
    assert.equal(patchedStatus(notion), "Active");
  } finally {
    notion.restore();
  }
});
