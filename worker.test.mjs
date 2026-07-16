import assert from "node:assert/strict";
import test from "node:test";
import { applySteerAway, matchesTerm, splitTerms } from "./worker.mjs";

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
