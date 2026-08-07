import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The dashboard has no readable source, so the helpers patch-dashboard.mjs
// injects cannot be imported. Lift them straight out of the shipped bundle
// instead: extraction fails loudly if a patch stopped applying, and the
// behaviour below is then tested for real rather than by reading the patch
// strings back.
const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
const start = bundle.indexOf("xA=l=>{");
const end = bundle.indexOf(",j3=l=>", start);
if (start < 0 || end < 0) {
  throw new Error("Could not find the dashboard card helpers in the current bundle.");
}

const {
  __jsBand,
  __jsPosted,
  __jsReqs,
  __jsFilters,
  __jsRunLabel,
  __jsAppNote,
  __jsPassNote,
  __jsContextLines,
} = new Function(
  `const ${bundle.slice(start, end)};` +
    "return{__jsBand,__jsPosted,__jsReqs,__jsFilters,__jsRunLabel," +
    "__jsAppNote,__jsPassNote,__jsContextLines}",
)();

// Postings carry a bare "YYYY-MM-DD" that the bundle parses at local midnight,
// so the fixture has to walk the local calendar too. Building it from an ISO
// string would drift a day for every reader west of UTC — the exact bug the
// local-midnight patch exists to prevent.
const daysAgo = (days) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
};

test("freshness bands match the email's contract of green 0-2, amber 3-7, grey 8+", () => {
  assert.equal(__jsBand(daysAgo(0)), "fresh");
  assert.equal(__jsBand(daysAgo(2)), "fresh");
  assert.equal(__jsBand(daysAgo(3)), "recent");
  assert.equal(__jsBand(daysAgo(7)), "recent");
  assert.equal(__jsBand(daysAgo(8)), "old");
  assert.equal(__jsBand(daysAgo(40)), "old");
});

test("an undated posting gets no band rather than a fresh one", () => {
  assert.equal(__jsBand(""), "");
  assert.equal(__jsBand("not a date"), "");
  assert.equal(__jsPosted(""), "");
});

test("a posting past the freshness window is dated instead of counted", () => {
  assert.equal(__jsPosted(daysAgo(0)), "Posted today");
  assert.equal(__jsPosted(daysAgo(1)), "Posted yesterday");
  assert.equal(__jsPosted(daysAgo(5)), "Posted 5 days ago");
  assert.match(__jsPosted(daysAgo(9)), /^Posted \w+ \d+ \(9 days ago\)$/);
});

test("requirements split on their own separators before falling back to sentences", () => {
  assert.deepEqual(__jsReqs("Go; distributed systems; on-call ownership"), [
    "Go",
    "distributed systems",
    "on-call ownership",
  ]);
  assert.deepEqual(__jsReqs("Five years of design.\nOwnership of a design system."), [
    "Five years of design.",
    "Ownership of a design system.",
  ]);
});

test("prose requirements become one bullet per sentence, punctuation intact", () => {
  assert.deepEqual(__jsReqs("5+ years of product design. Ownership of a design system."), [
    "5+ years of product design.",
    "Ownership of a design system.",
  ]);
});

test("a single-sentence requirement stays a single bullet", () => {
  assert.deepEqual(__jsReqs("Python, TypeScript, AWS, and Linux experience matter most."), [
    "Python, TypeScript, AWS, and Linux experience matter most.",
  ]);
  assert.deepEqual(__jsReqs(""), []);
});

test("the filters expose new, saved, and everything without dropping a job", () => {
  const [fresh, saved, all] = __jsFilters([{ id: "a" }], [{ id: "b" }], [{ id: "a" }, { id: "b" }]);
  assert.deepEqual([fresh.id, saved.id, all.id], ["New", "Saved", "All"]);
  assert.deepEqual([fresh.items.length, saved.items.length, all.items.length], [1, 1, 2]);
});

test("applied and dismissed become filters of their own once either exists", () => {
  const withBoth = __jsFilters(
    [{ id: "a" }],
    [{ id: "b" }],
    [{ id: "a" }, { id: "b" }],
    [{ id: "b" }],
    [{ id: "c" }],
  );

  assert.deepEqual(
    withBoth.map((filter) => filter.id),
    ["New", "Saved", "Applied", "Passed", "All"],
  );
  // A dismissed posting is not in the active list, so it can only be reached here.
  assert.deepEqual(withBoth.find((filter) => filter.id === "Passed").items, [{ id: "c" }]);
});

test("a member who has never applied or passed is not shown two empty filters", () => {
  assert.deepEqual(
    __jsFilters([], [], [], [], []).map((filter) => filter.id),
    ["New", "Saved", "All"],
  );
});

test("an application says how long it has been waiting and when that is too long", () => {
  assert.equal(__jsAppNote({ application_status: "Applied", applied_at: daysAgo(0) }), "Applied today");
  assert.equal(
    __jsAppNote({ application_status: "Applied", applied_at: daysAgo(3) }),
    "Applied 3 days ago",
  );
  assert.equal(
    __jsAppNote({ application_status: "Applied", applied_at: daysAgo(21) }),
    "Applied 21 days ago · still no reply",
  );
});

test("a later status names itself and dates the application it belongs to", () => {
  assert.equal(
    __jsAppNote({ application_status: "Rejected", applied_at: daysAgo(30) }),
    "Rejected · applied 30 days ago",
  );
  assert.equal(__jsAppNote({ application_status: "Interviewing", applied_at: "" }), "Interviewing");
});

test("an untracked posting gets no status line rather than an empty one", () => {
  assert.equal(__jsAppNote({}), "");
  assert.equal(__jsAppNote({ application_status: "", applied_at: daysAgo(2) }), "");
});

test("a dismissed posting shows back the reason that was given for it", () => {
  assert.equal(
    __jsPassNote({ decision: "Not interested", feedback: "Pay — below my range" }),
    "You passed on this: Pay — below my range",
  );
  assert.equal(__jsPassNote({ decision: "Not interested", feedback: "" }), "");
  assert.equal(__jsPassNote({ decision: "Interested", feedback: "Pay" }), "");
});

test("the search context splits into lines and ignores the blank ones", () => {
  assert.deepEqual(__jsContextLines("first\n\n  second  \n"), ["first", "second"]);
  assert.deepEqual(__jsContextLines(""), []);
  assert.deepEqual(__jsContextLines(undefined), []);
});

test("the heading says when the scout last ran and drops the ordering when empty", () => {
  const today = new Date();
  today.setHours(9, 4, 0, 0);

  assert.match(
    __jsRunLabel({ last_run_at: today.toISOString() }, 3),
    /^Freshest first · last run today, /,
  );
  assert.match(__jsRunLabel({ last_run_at: today.toISOString() }, 0), /^Last run today, /);
  assert.match(
    __jsRunLabel({ last_run_at: "2026-01-05T09:04:00.000Z" }, 3),
    /^Freshest first · last run \w+ \d+, /,
  );
});

test("a member whose scout has never run is told so rather than shown an empty ordering", () => {
  assert.equal(__jsRunLabel({}, 0), "Your first run is still to come");
  assert.equal(__jsRunLabel({ last_run_at: "" }, 0), "Your first run is still to come");
  assert.equal(__jsRunLabel(null, 3), "Freshest first");
});
