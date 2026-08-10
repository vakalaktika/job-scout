import test from "node:test";
import assert from "node:assert/strict";

import {
  companySlugCandidates,
  findAtsApplyUrl,
  normalizeTitle,
  uniqueTitleMatch,
} from "./ats-boards.mjs";

const ASHBY = (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
const GREENHOUSE = (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
const LEVER = (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const notFound = { ok: false, status: 404, text: async () => "" };

// ---------------------------------------------------------------------------
// normalizeTitle
// ---------------------------------------------------------------------------

test("titles match on letters and digits, ignoring decoration a person would too", () => {
  assert.equal(normalizeTitle("🎨 Product Designer"), "product designer");
  assert.equal(normalizeTitle("Product  Designer "), "product designer");
  assert.equal(normalizeTitle("Product–Designer"), "product designer");
  assert.equal(normalizeTitle("Staff Engineer (L5)"), "staff engineer l5");
  assert.equal(normalizeTitle(""), "");
});

// ---------------------------------------------------------------------------
// companySlugCandidates
// ---------------------------------------------------------------------------

test("slug candidates cover the collapsed name, the hyphenated name, and the handle", () => {
  assert.deepEqual(companySlugCandidates("Candid Health", "candid-health"), [
    "candidhealth",
    "candid-health",
  ]);
  assert.deepEqual(companySlugCandidates("Confido", "confidotech"), ["confido", "confidotech"]);
});

test("slug candidates drop anything that could not be a board slug", () => {
  assert.deepEqual(companySlugCandidates("", ""), []);
  assert.deepEqual(companySlugCandidates("!!", ""), []);
  assert.deepEqual(companySlugCandidates("A", ""), [], "a one-character slug is not a board");
});

// ---------------------------------------------------------------------------
// uniqueTitleMatch
// ---------------------------------------------------------------------------

test("a single exact title match wins", () => {
  const postings = [
    { title: "Senior Product Designer", url: "https://jobs.ashbyhq.com/acme/a" },
    { title: "Product Designer", url: "https://jobs.ashbyhq.com/acme/b" },
  ];
  assert.equal(uniqueTitleMatch(postings, "Product Designer"), "https://jobs.ashbyhq.com/acme/b");
});

test("the same title in two locations resolves to nothing rather than a coin flip", () => {
  const postings = [
    { title: "Product Designer", url: "https://jobs.ashbyhq.com/acme/nyc" },
    { title: "Product Designer", url: "https://jobs.ashbyhq.com/acme/sfo" },
  ];
  assert.equal(uniqueTitleMatch(postings, "Product Designer"), "");
});

test("a near-miss title is not a match, and an unsafe URL disqualifies one", () => {
  assert.equal(
    uniqueTitleMatch([{ title: "Product Designer II", url: "https://x.example/a" }], "Product Designer"),
    "",
  );
  assert.equal(
    uniqueTitleMatch([{ title: "Product Designer", url: "http://127.0.0.1/a" }], "Product Designer"),
    "",
  );
  assert.equal(uniqueTitleMatch([], "Product Designer"), "");
  assert.equal(uniqueTitleMatch([{ title: "Anything", url: "https://x.example/a" }], ""), "");
});

// ---------------------------------------------------------------------------
// findAtsApplyUrl
// ---------------------------------------------------------------------------

test("finds the role on Ashby and prefers its apply URL over the listing URL", async () => {
  const fetcher = async (url) =>
    url === ASHBY("confido")
      ? json({
          jobs: [
            {
              title: "Product Designer",
              jobUrl: "https://jobs.ashbyhq.com/confido/bbb",
              applyUrl: "https://jobs.ashbyhq.com/confido/bbb/application",
            },
          ],
        })
      : notFound;
  assert.equal(
    await findAtsApplyUrl({ title: "Product Designer", company: "Confido" }, { fetcher }),
    "https://jobs.ashbyhq.com/confido/bbb/application",
  );
});

test("finds the role on Greenhouse", async () => {
  const fetcher = async (url) =>
    url === GREENHOUSE("northwind")
      ? json({
          jobs: [
            {
              title: "Staff Product Designer",
              absolute_url: "https://job-boards.greenhouse.io/northwind/jobs/771",
            },
          ],
        })
      : notFound;
  assert.equal(
    await findAtsApplyUrl({ title: "Staff Product Designer", company: "Northwind" }, { fetcher }),
    "https://job-boards.greenhouse.io/northwind/jobs/771",
  );
});

test("finds the role on Lever, whose title field is named text", async () => {
  const fetcher = async (url) =>
    url === LEVER("adventureworks")
      ? json([{ text: "Product Designer", hostedUrl: "https://jobs.lever.co/adventureworks/abc" }])
      : notFound;
  assert.equal(
    await findAtsApplyUrl({ title: "Product Designer", company: "AdventureWorks" }, { fetcher }),
    "https://jobs.lever.co/adventureworks/abc",
  );
});

test("falls back to the LinkedIn handle when the display name is not the board slug", async () => {
  const fetcher = async (url) =>
    url === ASHBY("koahlabs")
      ? json({ jobs: [{ title: "Product Designer", applyUrl: "https://jobs.ashbyhq.com/koahlabs/x" }] })
      : notFound;
  assert.equal(
    await findAtsApplyUrl(
      { title: "Product Designer", company: "Koah", companySlug: "koahlabs" },
      { fetcher },
    ),
    "https://jobs.ashbyhq.com/koahlabs/x",
  );
});

test("a company on no known board resolves to nothing", async () => {
  const fetcher = async () => notFound;
  assert.equal(await findAtsApplyUrl({ title: "Product Designer", company: "Fabric" }, { fetcher }), "");
});

test("a board that answers with junk is treated as no board at all", async () => {
  const fetcher = async () => ({ ok: true, status: 200, text: async () => "<html>nope" });
  assert.equal(await findAtsApplyUrl({ title: "Designer", company: "Acme" }, { fetcher }), "");
});

test("a titleless posting never reaches the network", async () => {
  const fetcher = async () => {
    throw new Error("should not fetch");
  };
  assert.equal(await findAtsApplyUrl({ title: "", company: "Acme" }, { fetcher }), "");
});
