const ORIGIN = "https://vakalaktika.github.io";
const CODES_DB = "111ed911-f8ea-4e69-b6a5-c8c6f7479058";
const CAND_DB = "87f58043-765a-4b49-ae7e-6903e48b6996";
const SENT_POSTINGS_DB = "236b97b7-af8b-4c3d-8d67-f57fdc6386c6";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function checksum(value) {
  let hash = 7;
  for (const character of value) {
    hash = (hash * 37 + ACCESS_CODE_ALPHABET.indexOf(character) * 13 + 29) % 923521;
  }
  let result = "";
  for (let index = 0; index < 4; index += 1) {
    result = ACCESS_CODE_ALPHABET[hash % 31] + result;
    hash = Math.floor(hash / 31);
  }
  return result;
}

async function notion(env, path, method, body) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Notion ${path} -> ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

const richText = (value) => ({
  rich_text: [{ type: "text", text: { content: String(value ?? "").slice(0, 1900) } }],
});
const select = (value) => (value ? { select: { name: String(value) } } : undefined);
const join = (value) => (Array.isArray(value) ? value.join(", ") : value ?? "");

export const splitTerms = (value) =>
  String(value ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, terms) =>
      terms.findIndex((candidate) => candidate.toLowerCase() === term.toLowerCase()) === index,
    );

const noteValue = (notes, label) =>
  String(notes ?? "").match(new RegExp(`^${label}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";

function candidateProps(payload) {
  const steerMode = payload.steer_away_mode === "hide" ? "Hide" : "Rank lower";
  const properties = {
    "Target roles": richText(join(payload.target_roles)),
    Regions: richText(join(payload.regions)),
    "Min salary": richText(payload.min_salary),
    Notes: richText(
      [
        payload.role_keywords ? `Keywords: ${join(payload.role_keywords)}` : "",
        payload.max_salary ? `Maximum salary: ${payload.max_salary}` : "",
        payload.max_posting_age ? `Posted within: ${payload.max_posting_age} days` : "",
        payload.resume_name ? `Resume file: ${String(payload.resume_name).slice(0, 180)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "Steer away": richText(join(payload.steer_away_terms)),
    "Steer mode": select(steerMode),
    "Resume suggestions": richText(join(payload.resume_suggestions)),
    Seniority: select(payload.seniority),
    "Remote OK": select(payload.remote),
  };
  if (["3x daily", "Daily", "Weekly"].includes(payload.frequency)) {
    properties.Frequency = select(payload.frequency);
  }
  for (const key of Object.keys(properties)) {
    if (properties[key] === undefined) delete properties[key];
  }
  return properties;
}

const plain = (property) => {
  if (!property) return "";
  if (property.type === "title") return (property.title || []).map((item) => item.plain_text || "").join("");
  if (property.type === "rich_text") {
    return (property.rich_text || []).map((item) => item.plain_text || "").join("");
  }
  if (property.type === "email") return property.email || "";
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "url") return property.url || "";
  if (property.type === "date") return property.date?.start || "";
  return "";
};

function memberState(page) {
  if (!page) return null;
  const properties = page.properties || {};
  const notes = plain(properties.Notes);
  const storedMode = plain(properties["Steer mode"]) || noteValue(notes, "Steer mode");
  const suggestions =
    plain(properties["Resume suggestions"]) || noteValue(notes, "Resume suggestions");
  return {
    id: page.id,
    name: plain(properties.Name),
    email: plain(properties.Email),
    status: plain(properties.Status),
    target_roles: plain(properties["Target roles"]),
    regions: plain(properties.Regions),
    min_salary: plain(properties["Min salary"]),
    seniority: plain(properties.Seniority),
    remote: plain(properties["Remote OK"]),
    frequency: plain(properties.Frequency),
    notes,
    steer_away_terms:
      plain(properties["Steer away"]) || noteValue(notes, "Steer away"),
    steer_away_mode: storedMode.toLowerCase() === "hide" ? "hide" : "rank",
    resume_suggestions: splitTerms(suggestions),
  };
}

function jobState(page) {
  const properties = page.properties || {};
  return {
    id: page.id,
    title: plain(properties["Job Title"]) || plain(properties["Company – Title"]),
    company: plain(properties.Company),
    logo_url: plain(properties["Company Logo"]) || plain(properties.Logo),
    url: plain(properties.URL),
    location: plain(properties.Location),
    source: plain(properties.Source),
    sent_at: plain(properties["Date sent"]),
    posted_at: plain(properties["Date posted"]),
    summary:
      plain(properties["Job summary"]) ||
      plain(properties.Summary) ||
      plain(properties["Role summary"]),
    match_reason: plain(properties["Why it matched"]) || plain(properties["Match reason"]),
    key_requirements:
      plain(properties["Key requirements"]) || plain(properties["What matters most"]),
    primary_domain:
      plain(properties["Primary domain"]) ||
      plain(properties.Domain) ||
      plain(properties["Job family"]),
    decision: plain(properties["Dashboard decision"]),
    feedback: plain(properties["Dashboard feedback"]),
  };
}

const tokens = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9+#]+/g) || [];

const lightStem = (token) => {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

const containsTerm = (text, term) => {
  const haystack = tokens(text).map(lightStem);
  const needle = tokens(term).map(lightStem);
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some((_, start) => needle.every((token, offset) => haystack[start + offset] === token));
};

export function matchesTerm(job, term) {
  // Primary-domain metadata is checked first so canonical domain classification can
  // match even when prose uses a related adjective. Body text still requires whole
  // token sequences, preventing substring matches such as infrastructure/infrastructural.
  if (containsTerm(`${job.title || ""} ${job.primary_domain || ""}`, term)) return true;
  return containsTerm(
    `${job.summary || ""} ${job.key_requirements || ""} ${job.match_reason || ""}`,
    term,
  );
}

export function applySteerAway(jobs, member) {
  const terms = splitTerms(member?.steer_away_terms);
  if (!terms.length) return { jobs, hiddenCount: 0 };
  const classified = jobs.map((job) => ({
    job,
    matches: terms.filter((term) => matchesTerm(job, term)),
  }));
  if (member.steer_away_mode === "hide") {
    const visible = classified.filter(({ matches }) => matches.length === 0);
    return { jobs: visible.map(({ job }) => job), hiddenCount: jobs.length - visible.length };
  }
  const preferred = classified.filter(({ matches }) => matches.length === 0).map(({ job }) => job);
  const lowered = classified
    .filter(({ matches }) => matches.length > 0)
    .map(({ job, matches }) => ({ ...job, steer_away_match: matches }));
  return { jobs: [...preferred, ...lowered], hiddenCount: 0 };
}

async function loadMemberJobs(env, email) {
  if (!email) return [];
  const jobs = [];
  let cursor;
  try {
    do {
      const body = { page_size: 100, sorts: [{ property: "Date sent", direction: "descending" }] };
      if (cursor) body.start_cursor = cursor;
      const result = await notion(env, `databases/${SENT_POSTINGS_DB}/query`, "POST", body);
      for (const page of result.results || []) {
        if (plain(page.properties?.["Candidate email"]).toLowerCase() === email.toLowerCase()) {
          jobs.push(jobState(page));
        }
      }
      cursor = result.has_more ? result.next_cursor : null;
    } while (cursor && jobs.length < 300);
  } catch (error) {
    console.error("Unable to load member jobs", String(error?.message || error));
    return [];
  }
  return jobs;
}

async function ensureCandidatePreferenceProperties(env) {
  await notion(env, `databases/${CAND_DB}`, "PATCH", {
    properties: {
      "Steer away": { rich_text: {} },
      "Steer mode": {
        select: {
          options: [
            { name: "Rank lower", color: "green" },
            { name: "Hide", color: "gray" },
          ],
        },
      },
      "Resume suggestions": { rich_text: {} },
    },
  });
}

async function ensureDecisionProperties(env) {
  await notion(env, `databases/${SENT_POSTINGS_DB}`, "PATCH", {
    properties: {
      "Dashboard decision": {
        select: {
          options: [
            { name: "Interested", color: "green" },
            { name: "Not interested", color: "gray" },
          ],
        },
      },
      "Dashboard feedback": { rich_text: {} },
      "Reviewed at": { date: {} },
    },
  });
}

async function saveJobDecision(env, member, jobId, decision, feedback) {
  if (!["Interested", "Not interested"].includes(decision)) throw new Error("invalid_decision");
  const job = await notion(env, `pages/${jobId}`, "GET");
  if (plain(job.properties?.["Candidate email"]).toLowerCase() !== member.email.toLowerCase()) {
    throw new Error("job_forbidden");
  }
  const properties = {
    "Dashboard decision": { select: { name: decision } },
    "Dashboard feedback": richText(feedback || ""),
    "Reviewed at": { date: { start: new Date().toISOString() } },
  };
  try {
    return await notion(env, `pages/${jobId}`, "PATCH", { properties });
  } catch (error) {
    if (!String(error.message).includes("Dashboard")) throw error;
    await ensureDecisionProperties(env);
    return notion(env, `pages/${jobId}`, "PATCH", { properties });
  }
}

function resumeBlocks(text) {
  const value = String(text ?? "").slice(0, 40000);
  const blocks = [];
  for (let index = 0; index < value.length; index += 1900) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: value.slice(index, index + 1900) } }] },
    });
  }
  return blocks;
}

const bytesToUrl = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const urlToBytes = (value) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const textEncoder = new TextEncoder();

async function signingKey(env) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function issueToken(env, payload, lifetime) {
  const body = bytesToUrl(
    textEncoder.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + lifetime })),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(env), textEncoder.encode(body)),
  );
  return `${body}.${bytesToUrl(signature)}`;
}

async function verifyToken(env, token, purpose) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) throw new Error("invalid_token");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    urlToBytes(signature),
    textEncoder.encode(body),
  );
  if (!valid) throw new Error("invalid_token");
  const payload = JSON.parse(new TextDecoder().decode(urlToBytes(body)));
  if (payload.exp <= Math.floor(Date.now() / 1000) || payload.purpose !== purpose || !payload.member_id) {
    throw new Error("expired_token");
  }
  return payload;
}

async function sessionResponse(env, candidate, extra = {}) {
  const member = memberState(candidate);
  const maxPostingAge = Number(member.notes.match(/Posted within:\s*(\d+)/i)?.[1]) || 7;
  const recentJobs = (await loadMemberJobs(env, member.email)).filter((job) => {
    if (job.decision === "Interested") return true;
    const posted = Date.parse(job.posted_at || "");
    if (!Number.isFinite(posted)) return false;
    return Math.max(0, Math.floor((Date.now() - posted) / 86400000)) <= maxPostingAge;
  });
  const steered = applySteerAway(recentJobs, member);
  const sessionExpiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const sessionToken = await issueToken(
    env,
    { purpose: "session", member_id: candidate.id, email: member.email },
    SESSION_SECONDS,
  );
  return {
    ok: true,
    member,
    jobs: steered.jobs,
    hidden_count: steered.hiddenCount,
    session_token: sessionToken,
    session_expires_at: sessionExpiresAt,
    ...extra,
  };
}

async function authenticatedCandidate(env, sessionToken) {
  let auth;
  try {
    auth = await verifyToken(env, sessionToken, "session");
  } catch {
    return null;
  }
  return notion(env, `pages/${auth.member_id}`, "GET");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "bad json" }, 400);
    }

    try {
      if (payload.action === "magic_request" || payload.action === "magic_consume") {
        return json({ ok: false, error: "feature_unavailable" }, 404);
      }
      if (payload.action === "session") {
        const candidate = await authenticatedCandidate(env, payload.session_token);
        if (!candidate) return json({ ok: false, error: "invalid_session" }, 401);
        return json(await sessionResponse(env, candidate));
      }
      if (payload.action === "job_decision") {
        const candidate = await authenticatedCandidate(env, payload.session_token);
        if (!candidate) return json({ ok: false, error: "invalid_session" }, 401);
        await saveJobDecision(
          env,
          memberState(candidate),
          payload.job_id,
          payload.decision,
          payload.feedback,
        );
        return json({ ok: true, job: jobState(await notion(env, `pages/${payload.job_id}`, "GET")) });
      }

      let sessionAuth = null;
      if (payload.session_token) {
        try {
          sessionAuth = await verifyToken(env, payload.session_token, "session");
        } catch {
          return json({ ok: false, error: "invalid_session" }, 401);
        }
      }

      const match = /^SCOUT-([A-Z2-9]{4})-([A-Z2-9]{4})$/.exec(
        String(payload.access_code || "").toUpperCase().trim(),
      );
      if (!sessionAuth && (!match || checksum(match[1]) !== match[2])) {
        return json({ ok: false, error: "invalid_code" }, 403);
      }
      const code = match ? `SCOUT-${match[1]}-${match[2]}` : "";
      const found = sessionAuth
        ? null
        : await notion(env, `databases/${CODES_DB}/query`, "POST", {
            filter: { property: "Code", title: { equals: code } },
            page_size: 1,
          });
      if (!sessionAuth && !found.results.length) return json({ ok: false, error: "unknown_code" }, 403);

      const row = found?.results?.[0] || null;
      const status = row?.properties.Status?.select?.name;
      if (status === "Revoked") return json({ ok: false, error: "revoked" }, 403);
      const linked = sessionAuth?.member_id || row?.properties["Linked candidate"]?.relation?.[0]?.id;

      if (payload.action === "validate" || payload.action === "state") {
        const candidate = linked ? await notion(env, `pages/${linked}`, "GET") : null;
        if (!candidate) {
          return json({ ok: true, code_status: status || "Unused", needs_setup: true, member: null, jobs: [] });
        }
        return json(
          await sessionResponse(env, candidate, {
            code_status: status || "Active",
            needs_setup: false,
          }),
        );
      }

      await ensureCandidatePreferenceProperties(env);
      if (status === "Unused" || !linked) {
        const candidate = await notion(env, "pages", "POST", {
          parent: { type: "database_id", database_id: CAND_DB },
          properties: {
            Name: {
              title: [{ type: "text", text: { content: String(payload.name || "").slice(0, 200) } }],
            },
            Email: { email: payload.email || null },
            Status: { select: { name: "Active" } },
            ...candidateProps(payload),
          },
          children: resumeBlocks(payload.resume_text),
        });
        await notion(env, `pages/${row.id}`, "PATCH", {
          properties: {
            Status: { select: { name: "Active" } },
            "Linked candidate": { relation: [{ id: candidate.id }] },
            "Used at": { date: { start: new Date().toISOString() } },
          },
        });
        return json(await sessionResponse(env, candidate, { mode: "created" }));
      }

      if (String(payload.frequency || "") === "Paused") {
        await notion(env, `pages/${linked}`, "PATCH", {
          properties: { Status: { select: { name: "Paused" } } },
        });
        return json(
          await sessionResponse(env, await notion(env, `pages/${linked}`, "GET"), { mode: "paused" }),
        );
      }

      await notion(env, `pages/${linked}`, "PATCH", {
        properties: { Status: { select: { name: "Active" } }, ...candidateProps(payload) },
      });
      const candidate = await notion(env, `pages/${linked}`, "GET");
      return json(await sessionResponse(env, candidate, { mode: "updated" }));
    } catch (error) {
      return json(
        { ok: false, error: "server_error", detail: String(error.message).slice(0, 200) },
        500,
      );
    }
  },
};
