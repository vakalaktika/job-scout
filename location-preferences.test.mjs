import assert from "node:assert/strict";
import test from "node:test";

import {
  addPreferredLocation,
  normalizePreferredLocations,
  parsePreferredLocations,
  removePreferredLocation,
  serializePreferredLocations,
  normalizeWorkModes,
  toggleWorkMode,
} from "./location-preferences.mjs";

const oakland = { city: "Oakland", state: "California", country: "United States" };
const austin = { city: "Austin", state: "Texas", country: "United States" };

test("a legacy single city becomes the first preferred location", () => {
  assert.deepEqual(normalizePreferredLocations(oakland), [oakland]);
});

test("preferred locations are trimmed and de-duplicated", () => {
  assert.deepEqual(
    normalizePreferredLocations({
      preferredLocations: [oakland, { ...oakland }, { city: " Austin ", state: " Texas ", country: " United States " }],
    }),
    [oakland, austin],
  );
});

test("adding a city preserves order, rejects duplicates, and caps the list", () => {
  assert.deepEqual(addPreferredLocation([oakland], austin), [oakland, austin]);
  assert.deepEqual(addPreferredLocation([oakland], { ...oakland }), [oakland]);

  const five = [
    oakland,
    austin,
    { city: "Seattle", state: "Washington", country: "United States" },
    { city: "Chicago", state: "Illinois", country: "United States" },
    { city: "Boston", state: "Massachusetts", country: "United States" },
  ];
  assert.deepEqual(addPreferredLocation(five, { city: "Denver", state: "Colorado", country: "United States" }), five);
});

test("removing one city leaves every other preference untouched", () => {
  assert.deepEqual(removePreferredLocation([oakland, austin], oakland), [austin]);
});

test("multiple cities serialize for storage and parse back in order", () => {
  const stored = "Oakland, California, United States; Austin, Texas, United States";
  assert.equal(serializePreferredLocations([oakland, austin]), stored);
  assert.deepEqual(parsePreferredLocations(stored), [oakland, austin]);
});

test("work arrangements use explicit multi-select values and migrate old preferences", () => {
  assert.deepEqual(normalizeWorkModes({ workModes: ["onsite", "hybrid"] }), ["onsite", "hybrid"]);
  assert.deepEqual(normalizeWorkModes({ workMode: "onsite", remote: true }), ["onsite"]);
  assert.deepEqual(normalizeWorkModes({ remote: true }), ["remote"]);
  assert.deepEqual(normalizeWorkModes({ remote: false }), ["hybrid"]);
});

test("work arrangements toggle independently but never leave the search with none", () => {
  assert.deepEqual(toggleWorkMode(["onsite"], "hybrid"), ["onsite", "hybrid"]);
  assert.deepEqual(toggleWorkMode(["onsite", "hybrid"], "onsite"), ["hybrid"]);
  assert.deepEqual(toggleWorkMode(["hybrid"], "hybrid"), ["hybrid"]);
});
