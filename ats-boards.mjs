// ats-boards.mjs
// LinkedIn no longer publishes where its Apply button goes. A logged-out reader can
// see *that* a posting applies off LinkedIn — the button carries an offsite icon —
// but the destination itself now sits behind a signed redirect we cannot construct.
//
// So we go the other way round: the employer publishes the same role on its own
// applicant tracking system, and the big three hosted boards all expose a public
// JSON index of open roles. Given the company and the exact job title, the real
// apply URL is a lookup rather than a scrape.
//
// The matching rule is deliberately strict. A wrong link is worse than the extra
// click this whole module exists to remove, so a role resolves only when exactly
// one posting on one board carries exactly that title. Anything less returns "" and
// the member keeps the LinkedIn post.

import { isPublicHttpUrl } from "./public-url.mjs";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BOARD_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "Job Scout apply-link resolver/1.0 (+https://vakalaktika.github.io/job-scout/)";

const BOARDS = [
  {
    name: "ashby",
    url: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
    postings: (body) =>
      (body?.jobs || []).map((job) => ({ title: job?.title, url: job?.applyUrl || job?.jobUrl })),
  },
  {
    name: "greenhouse",
    url: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    postings: (body) =>
      (body?.jobs || []).map((job) => ({ title: job?.title, url: job?.absolute_url })),
  },
  {
    name: "lever",
    url: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
    postings: (body) =>
      (Array.isArray(body) ? body : []).map((job) => ({
        title: job?.text,
        url: job?.applyUrl || job?.hostedUrl,
      })),
  },
];

/**
 * Titles are compared on letters and digits alone, so an emoji, an en dash, or a
 * doubled space cannot break a match a person would call identical.
 */
export const normalizeTitle = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Board slugs worth trying for a company, most likely first. The company's LinkedIn
 * handle is included because a display name does not always reach the board slug —
 * "Koah" publishes as `koahlabs`.
 */
export function companySlugCandidates(company, linkedInSlug) {
  const name = String(company ?? "")
    .normalize("NFKD")
    .toLowerCase();
  const candidates = [
    name.replace(/[^a-z0-9]/g, ""),
    name.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    String(linkedInSlug ?? "").toLowerCase(),
  ];
  return [...new Set(candidates)].filter((slug) => /^[a-z0-9][a-z0-9-]{1,59}$/.test(slug));
}

/**
 * The one posting on this board whose title is exactly the one we are looking for.
 *
 * Several matches means the same role listed in several locations, and nothing here
 * can tell which one the member was shown — so it is treated as no match at all.
 */
export function uniqueTitleMatch(postings, title) {
  const wanted = normalizeTitle(title);
  if (!wanted) return "";
  const matches = (postings || []).filter(
    (posting) => normalizeTitle(posting?.title) === wanted && isPublicHttpUrl(posting?.url),
  );
  return matches.length === 1 ? matches[0].url : "";
}

async function readBoard(board, slug, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(board.url(slug), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    // A company that does not use this board answers 404. That is an answer, not an
    // error worth surfacing.
    if (!response.ok) return [];
    const body = (await response.text()).slice(0, MAX_BOARD_BYTES);
    return board.postings(JSON.parse(body));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The employer's own apply URL for a role, or "" when it cannot be established
 * beyond doubt.
 *
 * Slugs are tried in order, the three boards in parallel within each slug, so a
 * company found on its first-guess slug costs three requests and an unresolvable
 * one costs nine.
 *
 * @param {{ title?: string, company?: string, companySlug?: string }} posting
 * @param {{ fetcher?: typeof fetch }} [options]
 * @returns {Promise<string>}
 */
export async function findAtsApplyUrl(posting, { fetcher = fetch } = {}) {
  if (!normalizeTitle(posting?.title)) return "";
  for (const slug of companySlugCandidates(posting?.company, posting?.companySlug)) {
    const boards = await Promise.all(BOARDS.map((board) => readBoard(board, slug, fetcher)));
    for (const postings of boards) {
      const match = uniqueTitleMatch(postings, posting.title);
      if (match) return match;
    }
  }
  return "";
}
