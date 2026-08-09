import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The intake component ships inside the bundle, re-injected verbatim from
// intake-flow.source.js by patch-intake-flow.mjs. Lift the prefill rules out of
// the shipped bundle rather than the source file, so the test fails loudly if
// the injection stopped carrying them into the artifact members actually load.
const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");

// The rules are a contiguous block of helpers ending at the upload handler. They
// close over the profile, the set of fields the member has touched, the location
// gazetteer, and the parser's accept threshold, so lift the whole block and hand
// those in rather than trying to isolate one arrow function.
const rulesStart = bundle.indexOf("const __jsConfident =");
const rulesEnd = bundle.indexOf("const q = async (Q)", rulesStart);
if (rulesStart < 0 || rulesEnd < 0) {
  throw new Error("Could not find the resume prefill rules in the current bundle.");
}
const rules = bundle.slice(rulesStart, rulesEnd);

// Read the gazetteer out of the same bundle, so the location rules are checked
// against the places members can actually select.
const liftObject = (name) => {
  const start = bundle.indexOf(`${name}={`);
  if (start < 0) throw new Error(`Could not find ${name} in the current bundle.`);
  const from = start + name.length + 1;
  let depth = 0;
  let quote = "";
  for (let at = from; at < bundle.length; at += 1) {
    const character = bundle[at];
    if (quote) {
      if (character === "\\") at += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return new Function(`return ${bundle.slice(from, at + 1)};`)();
    }
  }
  throw new Error(`Could not read the end of ${name} in the current bundle.`);
};

const g1 = liftObject("g1");

const prefillWith = (profile, touched) =>
  new Function("l", "__jsTouched", "g1", "__jsAcceptConfidence", `${rules}; return __jsResumePrefill;`)(profile, touched, g1, 0.8);

const blankProfile = {
  name: "",
  email: "",
  roles: "",
  roleKeywords: "",
  steerAwayTerms: "",
  country: "United States",
  state: "California",
  city: "San Francisco",
};

// What the current parser produces for a resume that opens with a name and gives
// an explicit city and state.
const suggestions = {
  name: { value: "Alex Morgan", confidence: 0.9, evidence: { line: 0, reason: "header_block" } },
  email: { value: "alex@example.com", confidence: 0.95, evidence: { line: 1, reason: "email_address" } },
  roles: [{ value: "Senior Product Designer", confidence: 0.8 }],
  keywords: [{ value: "Design systems", confidence: 0.8 }],
  steerAway: [
    { value: "Infrastructure", confidence: 0.6 },
    { value: "DevOps", confidence: 0.6 },
  ],
  location: { country: "United States", state: "Texas", city: "Austin", confidence: 0.95 },
};

test("first-time intake fills the blank fields and offers the steer-away terms", () => {
  assert.deepEqual(prefillWith(blankProfile, {})(suggestions, false), {
    resumeSuggestions: ["Infrastructure", "DevOps"],
    name: "Alex Morgan",
    email: "alex@example.com",
    roles: "Senior Product Designer",
    roleKeywords: "Design systems",
    country: "United States",
    state: "Texas",
    city: "Austin",
  });
});

test("a name the member typed is never replaced by one from a resume", () => {
  const merged = prefillWith({ ...blankProfile, name: "Sam Rivera" }, { name: true })(suggestions, false);
  assert.equal("name" in merged, false);
});

test("a name already on the profile is never replaced, even untouched this session", () => {
  const merged = prefillWith({ ...blankProfile, name: "Sam Rivera" }, {})(suggestions, false);
  assert.equal("name" in merged, false);
});

test("a low-confidence name is offered rather than written", () => {
  const buried = { ...suggestions, name: { value: "Alex Morgan", confidence: 0.6, evidence: { line: 5, reason: "early_line" } } };
  assert.equal("name" in prefillWith(blankProfile, {})(buried, false), false);
});

test("a state with no city never writes a location", () => {
  const stateOnly = { ...suggestions, location: { country: "United States", state: "California", city: "", confidence: 0.5 } };
  const merged = prefillWith(blankProfile, {})(stateOnly, false);
  assert.deepEqual(
    { country: "country" in merged, state: "state" in merged, city: "city" in merged },
    { country: false, state: false, city: false },
  );
});

test("a location the member set is never overwritten by a resume", () => {
  const merged = prefillWith({ ...blankProfile, state: "Texas", city: "Austin" }, { city: true })(
    { ...suggestions, location: { country: "United States", state: "California", city: "Los Angeles", confidence: 0.95 } },
    false,
  );
  assert.equal("city" in merged, false);
});

test("a city that does not belong to its state is never written", () => {
  const impossible = { ...suggestions, location: { country: "United States", state: "Texas", city: "Los Angeles", confidence: 0.95 } };
  assert.equal("city" in prefillWith(blankProfile, {})(impossible, false), false);
});

test("editing a saved profile never overwrites location, identity, or roles", () => {
  assert.deepEqual(prefillWith(blankProfile, {})(suggestions, true), {
    resumeSuggestions: ["Infrastructure", "DevOps"],
  });
});

test("replacing a resume while editing leaves a saved Austin profile in Austin", () => {
  const saved = { name: "Sam", email: "sam@example.com", country: "United States", state: "Texas", city: "Austin" };
  const californian = { ...suggestions, location: { country: "United States", state: "California", city: "San Francisco", confidence: 0.95 } };
  const merged = { ...saved, ...prefillWith(saved, {})(californian, true) };
  assert.equal(merged.city, "Austin");
  assert.equal(merged.state, "Texas");
  assert.equal(merged.email, "sam@example.com");
});

test("editing with no steer-away suggestions merges nothing", () => {
  assert.deepEqual(prefillWith(blankProfile, {})({ ...suggestions, steerAway: [] }, true), {});
});

// The starting profile used to ship San Francisco, California, so a member who
// never opened the location step still submitted a real city and had their search
// run against a place they never named.
test("the shipped profile starts with no location at all", () => {
  assert.ok(
    bundle.includes('country:"",state:"",city:"",salaryMin:140'),
    "the starting profile should leave country, state, and city unset",
  );
  assert.ok(
    !bundle.includes('city:"San Francisco",salaryMin'),
    "San Francisco is still the shipped starting city",
  );
});

const locationMissingStart = bundle.indexOf("const __jsLocationMissing =");
if (locationMissingStart < 0) {
  throw new Error("Could not find the location requirement in the current bundle.");
}
const __jsLocationMissing = new Function(
  `${bundle.slice(locationMissingStart, bundle.indexOf("const __jsWriteLocations", locationMissingStart))} return __jsLocationMissing;`,
)();

test("a location is only complete once country, state, and city are all chosen", () => {
  assert.equal(__jsLocationMissing({ country: "United States", state: "Texas", city: "Austin" }), false);
  assert.equal(
    __jsLocationMissing({
      country: "",
      state: "",
      city: "",
      preferredLocations: [{ country: "United States", state: "California", city: "Oakland" }],
    }),
    false,
  );
});

test("a half-made location choice is refused", () => {
  for (const partial of [
    { country: "", state: "", city: "" },
    { country: "United States", state: "", city: "" },
    { country: "United States", state: "Texas", city: "" },
  ]) {
    assert.equal(__jsLocationMissing(partial), true, `${JSON.stringify(partial)} should not pass as a location`);
  }
});
