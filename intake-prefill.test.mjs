import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The intake component ships inside the bundle, re-injected verbatim from
// intake-flow.source.js by patch-intake-flow.mjs. Lift the prefill gate out of
// the shipped bundle rather than the source file, so the test fails loudly if
// the injection stopped carrying the fix into the artifact members actually
// load.
const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
const start = bundle.indexOf("const __jsResumePrefill =");
if (start < 0) {
  throw new Error("Could not find __jsResumePrefill in the current bundle.");
}
const end = bundle.indexOf(";", start);

const __jsResumePrefill = new Function(`${bundle.slice(start, end)}; return __jsResumePrefill;`)();

// What vP produces for a resume that mentions a Texas member's past employer
// in California: the gazetteer scan matches California first and falls back to
// its first listed city.
const fullSuggestions = {
  name: "Alex Morgan",
  email: "alex@example.com",
  roles: "Senior Product Designer",
  roleKeywords: "design systems, accessibility",
  resumeSuggestions: ["travel", "agency"],
  country: "United States",
  state: "California",
  city: "San Francisco",
};

test("first-time intake keeps the full prefill", () => {
  assert.deepEqual(__jsResumePrefill(fullSuggestions, false), fullSuggestions);
});

test("editing a saved profile never overwrites location, identity, or roles", () => {
  assert.deepEqual(__jsResumePrefill(fullSuggestions, true), {
    resumeSuggestions: ["travel", "agency"],
  });
});

test("replacing a resume while editing leaves a saved Austin profile in Austin", () => {
  const saved = { name: "Sam", email: "sam@example.com", country: "United States", state: "Texas", city: "Austin" };
  const merged = { ...saved, ...__jsResumePrefill(fullSuggestions, true) };
  assert.equal(merged.city, "Austin");
  assert.equal(merged.state, "Texas");
  assert.equal(merged.email, "sam@example.com");
});

test("editing with no steer-away suggestions merges nothing", () => {
  const { resumeSuggestions, ...withoutChips } = fullSuggestions;
  assert.deepEqual(__jsResumePrefill(withoutChips, true), {});
  assert.deepEqual(__jsResumePrefill({ ...withoutChips, resumeSuggestions: [] }, true), {});
});
