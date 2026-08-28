// A scriptable stand-in for the Worker, plus a static server for the shipped
// artifacts, so the browser tests drive the real bundle over the real click
// paths without touching production or any real member's data.
//
// The app already routes its API calls to a same-origin `/api/job-scout` when it
// is served from localhost, which is the seam this uses. Nothing here is a
// second implementation of the product's rules: it returns the shapes
// `sessionResponse`, `job_decision`, `job_application`, and `run_scout_once`
// return, and remembers what it was told, so the assertions are about what the
// front end does with those shapes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.E2E_PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const baseMember = () => ({
  id: "cand-e2e",
  name: "Alex Morgan",
  email: "alex@example.com",
  status: "Active",
  target_roles: "Senior Product Designer, Design Lead",
  regions: "Oakland, California, United States",
  region_city: "Oakland",
  region_state: "California",
  region_country: "United States",
  min_salary: "$140k",
  seniority: "Senior+",
  remote: "Yes",
  work_mode: "remote",
  work_modes: ["remote"],
  frequency: "Daily",
  notes: [
    "Keywords: Product strategy, design systems",
    "Maximum salary: 240",
    "Posted within: 7 days",
    "Resume file: alex-morgan-resume.pdf",
    "Work modes: remote",
  ].join("\n"),
  steer_away_terms: "",
  steer_away_mode: "rank",
  resume_suggestions: [],
  match_context: "",
});

const baseJob = (index) => ({
  id: `job-${index}`,
  title: `Senior Product Designer ${index}`,
  role: `Senior Product Designer ${index}`,
  company: `Northwind ${index}`,
  location: "Oakland, CA",
  salary: "$150k – $190k",
  url: `https://example.com/job-${index}`,
  posting_url: `https://example.com/job-${index}`,
  posted_at: new Date().toISOString().slice(0, 10),
  sent_at: new Date().toISOString(),
  decision: "",
  feedback: "",
  application_status: "",
  applied_at: "",
  summary: "Owns the end-to-end design of the payments experience.",
  match_reason: "Your payments and design-systems work lines up with this team.",
  key_requirements: "Six years of product design; ownership of a design system.",
  workplace_type: "Remote",
  link_status: "live",
});

// Everything a test can steer. `reset` replaces it wholesale so no test can
// inherit another's state.
const initialState = () => ({
  member: baseMember(),
  jobs: [baseJob(1), baseJob(2)],
  adminStats: null,
  firstScout: { status: "unavailable", requested_at: "", completed_at: "", can_retry: false },
  magic: { nonce: "nonce-1", spent: false },
  // Per-action artificial latency, so a test can make one response overtake
  // another and assert what the UI does about it.
  delays: {},
  jobDelays: {},
  // Per-action forced failures: { job_decision: { status: 500, error: "boom" } }.
  failures: {},
  briefResults: {},
  requests: [],
  scoutStatusAfterStart: null,
});

let state = initialState();

const sessionResponse = (extra = {}) => ({
  ok: true,
  member: state.member,
  jobs: state.jobs,
  hidden_count: 0,
  last_run_at: state.jobs.length ? state.jobs[0].sent_at : "",
  first_scout: state.firstScout,
  session_token: "session-token-e2e",
  session_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  ...extra,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
};

const findJob = (id) => state.jobs.find((job) => job.id === id);

const updateJob = (id, changes) => {
  state.jobs = state.jobs.map((job) => (job.id === id ? { ...job, ...changes } : job));
  return findJob(id);
};

async function handleApi(payload) {
  const action = String(payload.action || "preferences");
  state.requests.push({ action, payload });

  // Per-job latency, so a test can make one card's response overtake another's
  // and assert that neither is reported against the other.
  const jobDelay = payload.job_id ? state.jobDelays[payload.job_id] : undefined;
  const delay = Number(jobDelay ?? state.delays[action] ?? 0);
  if (delay) await sleep(delay);

  const failure = state.failures[action];
  if (failure) {
    return [failure.status || 500, { ok: false, error: failure.error || "server_error" }];
  }

  if (action === "validate" || action === "state") {
    if (!state.member) {
      return [200, { ok: true, code_status: "Unused", needs_setup: true, member: null, jobs: [] }];
    }
    return [200, sessionResponse({ code_status: "Active", needs_setup: false })];
  }

  if (action === "magic_consume") {
    if (payload.magic_token === "expired") return [401, { ok: false, error: "expired_link" }];
    if (payload.magic_token === "broken") return [401, { ok: false, error: "invalid_link" }];
    if (payload.magic_token === "wobbly") return [500, { ok: false, error: "server_error" }];
    if (state.magic.spent) return [401, { ok: false, error: "used_link" }];
    state.magic.spent = true;
    return [200, sessionResponse({ mode: "magic" })];
  }

  if (action === "session") return [200, sessionResponse()];

  if (action === "scout_status") {
    return [200, { ok: true, first_scout: state.firstScout }];
  }

  if (action === "admin_stats") {
    if (!state.member?.is_admin) return [403, { ok: false, error: "admin_forbidden" }];
    return [200, { ok: true, stats: state.adminStats }];
  }

  if (action === "run_scout_once") {
    if (!state.firstScout.can_retry && state.firstScout.status !== "available") {
      return [200, { ok: true, first_scout: state.firstScout, already_requested: true }];
    }
    state.firstScout = {
      status: "queued",
      requested_at: new Date().toISOString(),
      completed_at: "",
      can_retry: false,
    };
    if (state.scoutStatusAfterStart) {
      const next = state.scoutStatusAfterStart;
      state.scoutStatusAfterStart = null;
      setTimeout(() => {
        state.firstScout = next;
      }, 50);
    }
    return [200, { ok: true, first_scout: state.firstScout }];
  }

  if (action === "job_decision") {
    const job = updateJob(payload.job_id, {
      decision: payload.decision || "",
      feedback: [payload.feedback, payload.note].filter(Boolean).join(" — "),
    });
    if (!job) return [404, { ok: false, error: "unknown_job" }];
    if (payload.decision === "Not interested" && (payload.feedback || payload.note)) {
      state.member = {
        ...state.member,
        match_context: [
          `${job.role} — ${[payload.feedback, payload.note].filter(Boolean).join(" — ")}`,
          state.member.match_context,
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    return [200, { ok: true, job, match_context: state.member.match_context }];
  }

  if (action === "job_application") {
    const job = updateJob(payload.job_id, {
      application_status: payload.application_status || "",
      applied_at: payload.application_status ? new Date().toISOString().slice(0, 10) : "",
    });
    if (!job) return [404, { ok: false, error: "unknown_job" }];
    return [200, { ok: true, job }];
  }

  if (action === "job_brief") {
    const job = findJob(payload.job_id);
    if (!job) return [404, { ok: false, error: "unknown_job" }];
    const enriched = updateJob(payload.job_id, state.briefResults[payload.job_id] || {});
    return [200, { ok: true, job: enriched }];
  }

  // The bare preference save, which is also how cadence and pause are written.
  const frequency = String(payload.frequency || "");
  if (frequency === "Paused") {
    state.member = { ...state.member, status: "Paused" };
    return [200, sessionResponse({ mode: "paused" })];
  }
  const resumesDelivery = ["3x daily", "Daily", "Weekly"].includes(frequency);
  // A member with no record yet is being created by this very call, which is how
  // first-time setup lands.
  const created = !state.member;
  state.member = {
    ...(state.member || baseMember()),
    status: state.member?.status === "Paused" && !resumesDelivery ? "Paused" : "Active",
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.target_roles ? { target_roles: payload.target_roles } : {}),
    ...(payload.seniority ? { seniority: payload.seniority } : {}),
    ...(resumesDelivery ? { frequency } : {}),
    ...(payload.regions ? { regions: payload.regions } : {}),
  };
  return [200, sessionResponse({ mode: created ? "created" : "updated" })];
}

const serve = async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  if (url.pathname === "/__test/reset" && request.method === "POST") {
    const patch = await readBody(request);
    state = { ...initialState(), ...patch };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/__test/state") {
    if (request.method === "POST") {
      Object.assign(state, await readBody(request));
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(state));
    return;
  }

  if (url.pathname === "/api/job-scout" && request.method === "POST") {
    const [status, body] = await handleApi(await readBody(request));
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ""));
  try {
    const file = await readFile(path);
    response.writeHead(200, {
      "Content-Type": TYPES[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  }
};

createServer((request, response) => {
  serve(request, response).catch((error) => {
    console.error(error);
    response.writeHead(500);
    response.end("server error");
  });
}).listen(PORT, () => {
  console.log(`fake worker + static server on http://127.0.0.1:${PORT}`);
});
