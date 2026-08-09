import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The parser ships inside the bundle, injected verbatim from resume-parser.source.js
// by patch-intake-flow.mjs. The pure logic is exercised against the source file, and
// the shipped artifact is checked separately at the bottom of this file so a broken
// injection fails loudly rather than silently leaving the old parser in place.
const bundlePath = new URL("./assets/index-BdD4MZod.js", import.meta.url);
const bundle = await readFile(bundlePath, "utf8");
const source = await readFile(new URL("./resume-parser.source.js", import.meta.url), "utf8");

// Lift a bracketed literal out of the minified bundle by matching its delimiters, so
// the tests run against the same vocabularies and gazetteer members actually get.
const lift = (name, open, close) => {
  const start = bundle.indexOf(`${name}=${open}`);
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
    else if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return new Function(`return ${bundle.slice(from, at + 1)};`)();
    }
  }
  throw new Error(`Could not read the end of ${name} in the current bundle.`);
};

const g1 = lift("g1", "{", "}");
const gP = lift("gP", "[", "]");
const mP = lift("mP", "[", "]");
const SP = lift("SP", "[", "]");

// Evaluate the parser source with the bundle globals it expects. The PDF and DOCX
// readers are only reached through bP, which the pure tests below do not call.
const parser = new Function(
  "g1",
  "gP",
  "mP",
  "SP",
  "QI",
  "D9",
  `${source}
  return { bP, vP, __jsPdfLines, __jsAcceptConfidence, __jsParserVersion };`,
)(g1, gP, mP, SP, undefined, undefined);

const { vP, __jsPdfLines, __jsAcceptConfidence } = parser;

const resume = (...lines) => lines.join("\n");

test("an employer on the first line is never read as the member's name", () => {
  const { suggestions } = vP(
    resume(
      "Microsoft",
      "Senior Product Designer",
      "sam@example.com",
      "Experience",
      "Led design systems work across B2B SaaS teams.",
    ),
  );
  assert.equal(suggestions.name, null);
});

test("a two-word name in the header block is offered with enough confidence to prefill", () => {
  const { suggestions } = vP(resume("Alex Morgan", "alex@example.com", "Senior Product Designer", "Experience"));
  assert.equal(suggestions.name.value, "Alex Morgan");
  assert.ok(suggestions.name.confidence >= __jsAcceptConfidence, "a header-block name should clear the prefill threshold");
});

test("a name found past the header block stays below the prefill threshold", () => {
  const { suggestions } = vP(
    resume(
      "Experience",
      "Built and shipped design systems.",
      "Ran weekly research sessions.",
      "Reviewed accessibility across the product.",
      "Alex Morgan",
    ),
  );
  assert.equal(suggestions.name.value, "Alex Morgan");
  assert.ok(suggestions.name.confidence < __jsAcceptConfidence, "a name buried in body copy must be confirmed, not applied");
});

test("a job title above the name is not mistaken for the name", () => {
  const { suggestions } = vP(resume("Senior Product Designer", "Alex Morgan", "alex@example.com"));
  assert.equal(suggestions.name.value, "Alex Morgan");
});

test("a single word is never a name", () => {
  assert.equal(vP(resume("Stripe", "Experience", "Payments work.")).suggestions.name, null);
});

test("a section heading is never a name", () => {
  assert.equal(vP(resume("Professional Summary", "Ten years of product design.")).suggestions.name, null);
});

test("the first email address in the document is suggested", () => {
  const { suggestions } = vP(resume("Alex Morgan", "alex@example.com · 555-0100"));
  assert.equal(suggestions.email.value, "alex@example.com");
});

test("a resume that mentions California but no Californian city suggests the state and no city", () => {
  const { suggestions } = vP(
    resume("Sam Rivera", "sam@example.com", "Experience", "Remote role for a California company.", "Product Designer"),
  );
  assert.equal(suggestions.location.state, "California");
  assert.equal(suggestions.location.city, "");
  assert.ok(suggestions.location.confidence < __jsAcceptConfidence, "a state with no city must be confirmed, not applied");
});

test("Austin, Texas resolves to both the city and the state", () => {
  const { suggestions } = vP(resume("Sam Rivera", "Austin, Texas", "sam@example.com"));
  assert.deepEqual(
    { country: suggestions.location.country, state: suggestions.location.state, city: suggestions.location.city },
    { country: "United States", state: "Texas", city: "Austin" },
  );
  assert.ok(suggestions.location.confidence >= __jsAcceptConfidence, "an explicit city and state pair should be trusted");
});

test("a City, ST abbreviation resolves the same way as the spelled-out state", () => {
  const { suggestions } = vP(resume("Sam Rivera", "Austin, TX 78701", "sam@example.com"));
  assert.equal(suggestions.location.city, "Austin");
  assert.equal(suggestions.location.state, "Texas");
});

test("a city and state pair wins over the words that happen to precede the city", () => {
  const { suggestions } = vP(resume("Sam Rivera", "Based in Kansas City, Missouri", "sam@example.com"));
  assert.equal(suggestions.location.city, "Kansas City");
  assert.equal(suggestions.location.state, "Missouri");
});

test("a document with no place at all suggests no location", () => {
  assert.equal(vP(resume("Sam Rivera", "sam@example.com", "Ten years of product design.")).suggestions.location, null);
});

test("roles and keywords come back as individually editable tokens", () => {
  const { suggestions } = vP(
    resume("Alex Morgan", "alex@example.com", "Senior Product Designer", "Design systems and accessibility for B2B SaaS."),
  );
  assert.ok(suggestions.roles.some((role) => role.value === "Senior Product Designer"));
  assert.ok(suggestions.keywords.some((keyword) => keyword.value === "Design systems"));
  for (const item of [...suggestions.roles, ...suggestions.keywords]) {
    assert.equal(typeof item.value, "string");
    assert.equal(typeof item.confidence, "number");
  }
});

test("steer-away suggestions come from the resume without repeating a suggested role", () => {
  const { suggestions } = vP(resume("Alex Morgan", "Software Engineer", "Infrastructure and DevOps for a platform team."));
  const values = suggestions.steerAway.map((item) => item.value);
  assert.ok(values.includes("Infrastructure"));
  assert.ok(values.includes("DevOps"));
});

test("parse output carries a version and the warnings it was handed", () => {
  const parsed = vP("Alex Morgan", ["pdf_reading_order_uncertain"]);
  assert.equal(parsed.parserVersion, "2");
  assert.deepEqual(parsed.warnings, ["pdf_reading_order_uncertain"]);
});

test("an empty document parses to no suggestions rather than throwing", () => {
  const { suggestions } = vP("");
  assert.deepEqual(
    { name: suggestions.name, email: suggestions.email, location: suggestions.location },
    { name: null, email: null, location: null },
  );
});

test("PDF text items marked with an end of line stay on separate lines", () => {
  const read = __jsPdfLines([
    { str: "Alex", transform: [1, 0, 0, 1, 0, 700] },
    { str: "Morgan", hasEOL: true, transform: [1, 0, 0, 1, 40, 700] },
    { str: "Microsoft", hasEOL: true, transform: [1, 0, 0, 1, 0, 686] },
  ]);
  assert.deepEqual(read.lines, ["Alex Morgan", "Microsoft"]);
  assert.equal(read.uncertain, false);
});

test("PDF text items without an end of line are split on their vertical position", () => {
  const read = __jsPdfLines([
    { str: "Alex", transform: [1, 0, 0, 1, 0, 700] },
    { str: "Morgan", transform: [1, 0, 0, 1, 40, 700] },
    { str: "Microsoft", transform: [1, 0, 0, 1, 0, 686] },
  ]);
  assert.deepEqual(read.lines, ["Alex Morgan", "Microsoft"]);
  assert.equal(read.uncertain, true, "a guessed reading order has to be reported as a warning");
});

test("the shipped bundle carries the current parser, not the flattening one", () => {
  assert.ok(!bundle.includes('items.map(d=>d.str).join(" ")'), "the space-only PDF join is still in the shipped bundle");
  assert.ok(!bundle.includes("city:b||g[0]"), "the state-to-first-city fallback is still in the shipped bundle");
  assert.ok(bundle.includes("__jsResolveLocation"), "the injected parser is missing from the shipped bundle");
  assert.ok(bundle.includes('__jsParserVersion = "2"'), "the shipped bundle is not on parser version 2");
});
