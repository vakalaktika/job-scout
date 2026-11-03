import assert from "node:assert/strict";
import test from "node:test";

import { buildProfileExport } from "./profile-export.mjs";
import { NARRATIVE_MAX_RESUME_CHARACTERS, buildNarrativeRequest, parseNarrativeResponse } from "./profile-narrative.mjs";

const profile = buildProfileExport({
  member: { id: "cand-1", name: "Alex", email: "alex@example.com", target_roles: "Designer", notes: "Keywords: systems" },
  jobs: [{ title: "Lead", company: "Acme", url: "https://acme.example/1", decision: "Interested" }],
  resumeText: "full résumé",
  generatedAt: "2026-11-03T10:00:00.000Z",
});

test("buildNarrativeRequest asks for strict JSON prose and omits contact details and URLs", () => {
  const request = buildNarrativeRequest({ profile, resumeText: "r".repeat(NARRATIVE_MAX_RESUME_CHARACTERS + 50), model: "gpt-test" });
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.equal(request.max_output_tokens, 400);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, ["narrative"]);
  const user = JSON.parse(request.input[1].content);
  assert.equal(user.candidate.name, "Alex");
  assert.equal(user.candidate.preferences.target_roles, "Designer");
  assert.equal(user.decisions.counts.saved, 1);
  assert.equal(user.resume.length, NARRATIVE_MAX_RESUME_CHARACTERS);
  assert.doesNotMatch(request.input[1].content, /alex@example\.com/);
  assert.doesNotMatch(request.input[1].content, /acme\.example/);
  assert.equal(user.decisions.saved.jobs, undefined);
  assert.match(request.input[0].content, /untrusted/);
});

test("parseNarrativeResponse reads output_text and the output array", () => {
  const text = JSON.stringify({ narrative: "  Alex wants senior design roles.\nThey avoid crypto and on-site work. " });
  assert.equal(parseNarrativeResponse({ output_text: text }), "Alex wants senior design roles. They avoid crypto and on-site work.");
  assert.equal(
    parseNarrativeResponse({ output: [{ content: [{ type: "output_text", text }] }] }),
    "Alex wants senior design roles. They avoid crypto and on-site work.",
  );
});

test("parseNarrativeResponse rejects refusals, bad JSON, and implausible lengths", () => {
  assert.throws(() => parseNarrativeResponse({ output: [{ content: [{ type: "refusal", refusal: "no" }] }] }), /narrative_refused/);
  assert.throws(() => parseNarrativeResponse({ output_text: "not json" }), /narrative_invalid_json/);
  assert.throws(() => parseNarrativeResponse({ output_text: JSON.stringify({ narrative: "too short" }) }), /narrative_invalid/);
  assert.throws(() => parseNarrativeResponse({ output_text: JSON.stringify({ narrative: "x".repeat(1600) }) }), /narrative_invalid/);
  assert.throws(() => parseNarrativeResponse({}), /narrative_empty/);
});
