// linkedin-apply-url.mjs
// A LinkedIn job post is a landing page, not an application. Most postings hand the
// member straight to the employer's own board — Greenhouse, Lever, Ashby, Workday —
// the moment they press Apply, so sending the LinkedIn link makes them pay a sign-in
// wall and a second click to reach the page they were always going to end up on.
// This module works out where that Apply button leads.
//
// Reading the button is not enough on its own. LinkedIn's public guest fragment
// still says plainly *whether* a posting applies offsite — the Apply button carries
// an offsite icon, an Easy Apply one carries an onsite tracking name — but the
// destination itself now sits behind a signed redirect that cannot be constructed
// without a session. Older postings expose the URL directly and that path is still
// taken when it works; otherwise the role is looked up on the employer's own board
// by company and title (see ats-boards.mjs).
//
// Three outcomes, and the difference between them is the whole point:
//
//   external  the employer's own link, established beyond doubt -> send that.
//   linkedin  Easy Apply; LinkedIn *is* the application -> send the post.
//   unknown   offsite but unresolvable, a bot wall, or a timeout -> send the post.
//             Guessing a link we could not establish is worse than one extra click.
//
// Everything that parses is pure and separately exported; only resolveApplyTarget()
// and resolveApplyLinks() touch the network, and both are fetcher-injectable.

import { isPublicHttpUrl } from "./public-url.mjs";
import { findAtsApplyUrl } from "./ats-boards.mjs";

const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;
const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 512 * 1024;
const USER_AGENT = "Job Scout apply-link resolver/1.0 (+https://vakalaktika.github.io/job-scout/)";

// The guest fragment is the only LinkedIn surface that describes a posting's apply
// route without a session. The signed-in /jobs/view/ page is a sign-in wall.
const guestPostingUrl = (jobId) =>
  `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;

/**
 * The numeric posting id from any LinkedIn job URL shape the dispatcher records,
 * or "" when the URL is not a LinkedIn posting at all.
 *
 *   /jobs/view/staff-designer-at-acme-4123456789
 *   /jobs/view/4123456789/
 *   /jobs/collections/recommended/?currentJobId=4123456789
 */
export function linkedInJobId(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return "";
  }
  if (!LINKEDIN_HOST.test(url.hostname)) return "";
  const current = url.searchParams.get("currentJobId") || "";
  if (/^\d{6,}$/.test(current)) return current;
  // The slug prefix is matched greedily so a posting whose title happens to contain
  // digits ("foo-123456-engineer-4123456789") still resolves to the trailing id.
  const viewed = url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})(?=$|[/?#])/);
  return viewed ? viewed[1] : "";
}

export const isLinkedInJobUrl = (value) => Boolean(linkedInJobId(value));

/**
 * LinkedIn wraps offsite apply links in its own click tracker
 * (/jobs/view/externalApply/<id>?url=<encoded>). Peel those back to the employer's
 * URL. Non-LinkedIn URLs and unwrappable ones are returned untouched.
 */
export function unwrapExternalApplyUrl(value) {
  let current = String(value ?? "").trim();
  for (let hop = 0; hop < 3; hop += 1) {
    let url;
    try {
      url = new URL(current);
    } catch {
      return current;
    }
    if (!LINKEDIN_HOST.test(url.hostname)) return current;
    const target = url.searchParams.get("url");
    if (!target || target.trim() === current) return current;
    current = target.trim();
  }
  return current;
}

const APPLY_URL_BLOCK = /<code[^>]*\bid=["']?applyUrl["']?[^>]*>([\s\S]*?)<\/code>/i;
const ANCHOR_TAG = /<a\b[^>]*>/gi;
const HREF_ATTRIBUTE = /\bhref=["']([^"']*)["']/i;
const TRACKING_ATTRIBUTE = /\bdata-tracking-control-name=["']([^"']*)["']/i;
const EXTERNAL_APPLY_WRAPPER =
  /https?:\/\/[^"'\s<>]*linkedin\.com\/jobs\/view\/externalApply\/[^"'\s<>]+/i;

// How today's guest fragment gives the route away. "Apply on company website" renders
// an offsite icon inside the button and tracks every CTA around it as offsite; Easy
// Apply renders a plain apply-button tracked as onsite (or simple_onsite).
const OFFSITE_MARKER = /apply-button__offsite|offsite-apply-icon|apply-link-offsite/i;
const ONSITE_MARKER = /apply-link[-_](?:simple_)?onsite|linkedin\.com\/job-apply\/\d/i;

const TOPCARD_TITLE = /topcard__title[^>]*>([\s\S]*?)</i;
const TOPCARD_ORG = /topcard__org-name-link[\s\S]{0,400}?>([\s\S]*?)<\/a>/i;
const COMPANY_SLUG = /linkedin\.com\/company\/([a-z0-9-]+)/i;

/** Entity decoding for href/attribute values only — no markup stripping. */
const decodeAttribute = (value) =>
  String(value ?? "")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");

// The guest fragment carries the raw destination in a hidden <code> block as a JSON
// string, which is why its slashes arrive escaped as /.
function applyUrlFromCodeBlock(html) {
  const block = APPLY_URL_BLOCK.exec(html);
  if (!block) return "";
  const raw = decodeAttribute(block[1])
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return raw.replace(/\\u002[fF]/g, "/").replace(/^"|"$/g, "");
  }
}

function applyAnchors(html) {
  const offsite = [];
  let onsite = false;
  for (const [tag] of String(html).matchAll(ANCHOR_TAG)) {
    const tracking = TRACKING_ATTRIBUTE.exec(tag)?.[1] || "";
    if (!/apply-link/i.test(tracking)) continue;
    if (/offsite/i.test(tracking)) {
      const href = decodeAttribute(HREF_ATTRIBUTE.exec(tag)?.[1] || "").trim();
      if (href) offsite.push(href);
    } else if (/onsite/i.test(tracking)) {
      onsite = true;
    }
  }
  return { offsite, onsite };
}

const isOffLinkedInUrl = (value) => {
  if (!isPublicHttpUrl(value)) return false;
  return !LINKEDIN_HOST.test(new URL(value).hostname);
};

/**
 * Which way a posting applies, read from the guest fragment's Apply button.
 *
 * "offsite" is checked first: an offsite posting's sign-in modal also carries onsite
 * tracking names for its own join links, so the onsite marker alone is not evidence.
 *
 * @param {string} html
 * @returns {"offsite"|"linkedin"|"unknown"}
 */
export function parseApplyMethod(html) {
  const source = String(html || "");
  if (!source) return "unknown";
  if (OFFSITE_MARKER.test(source)) return "offsite";
  if (ONSITE_MARKER.test(source)) return "linkedin";
  return "unknown";
}

/**
 * The employer's URL when the fragment still states it outright — a hidden applyUrl
 * block or an offsite anchor. Current LinkedIn markup rarely does; older postings and
 * cached fragments still can, and reading it costs nothing.
 *
 * @param {string} html
 * @returns {string} "" when the fragment does not name a destination off LinkedIn.
 */
export function parseDirectApplyUrl(html) {
  const source = String(html || "");
  const anchors = applyAnchors(source);
  const wrapper = EXTERNAL_APPLY_WRAPPER.exec(source)?.[0] || "";
  const candidates = [applyUrlFromCodeBlock(source), ...anchors.offsite, decodeAttribute(wrapper)];
  for (const candidate of candidates) {
    const target = unwrapExternalApplyUrl(candidate);
    if (isOffLinkedInUrl(target)) return target;
  }
  return "";
}

/**
 * Company and title as the posting itself states them, used to find the same role on
 * the employer's board. The dispatcher's own record is preferred where it has one;
 * this is the fallback, and the only source of the company's LinkedIn handle.
 *
 * @param {string} html
 * @returns {{ title: string, company: string, companySlug: string }}
 */
export function parsePostingIdentity(html) {
  const source = String(html || "");
  const text = (pattern) => decodeAttribute(pattern.exec(source)?.[1] || "").replace(/\s+/g, " ").trim();
  return {
    title: text(TOPCARD_TITLE),
    company: text(TOPCARD_ORG),
    companySlug: (COMPANY_SLUG.exec(source)?.[1] || "").toLowerCase(),
  };
}

async function readCapped(response) {
  if (!response.body?.getReader) return (await response.text()).slice(0, MAX_HTML_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  while (bytes < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    result += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return result + decoder.decode();
}

async function fetchGuestPosting(jobId, fetcher) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(guestPostingUrl(jobId), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
    });
    if (!response.ok) return "";
    return await readCapped(response);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

// An offsite link is often an aggregator hop (appcast, a vanity careers domain)
// rather than the application itself, so the redirect chain is worth one request.
// A chain that lands on a site root has lost the posting — keep the link we already
// had rather than mailing someone a careers homepage.
async function followToDestination(url, fetcher) {
  if (!isPublicHttpUrl(url)) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": USER_AGENT },
    });
    // Only the settled URL matters here, so the body is dropped rather than read.
    await response.body?.cancel?.().catch(() => {});
    const final = String(response?.url || "");
    if (!isPublicHttpUrl(final)) return url;
    if (new URL(final).pathname === "/" && new URL(url).pathname !== "/") return url;
    return final;
  } catch {
    return url;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Where a posting's Apply button actually leads.
 *
 * An offsite posting is resolved from the fragment when it names a destination, and
 * otherwise by finding the same role on the employer's own board. Failing to resolve
 * an offsite posting is reported as `unknown`, not `external`: it is a gap we should
 * try again for, and the member keeps the LinkedIn post meanwhile.
 *
 * @param {string} postingUrl
 * @param {{ fetcher?: typeof fetch, title?: string, company?: string }} [options]
 *        title/company: the dispatcher's own record for this posting, preferred over
 *        the scraped top card when looking the role up on an employer board.
 * @returns {Promise<{ url: string, method: "external"|"linkedin"|"unknown"|"direct" }>}
 *          `direct` means the URL was never a LinkedIn posting and is echoed back.
 *          Every outcome returns a URL that is safe to send as-is.
 */
export async function resolveApplyTarget(postingUrl, { fetcher = fetch, title, company } = {}) {
  const url = String(postingUrl ?? "");
  const jobId = linkedInJobId(url);
  if (!jobId) return { url, method: "direct" };

  const html = await fetchGuestPosting(jobId, fetcher);
  const method = parseApplyMethod(html);
  if (method !== "offsite") return { url, method };

  const direct = parseDirectApplyUrl(html);
  if (direct) return { url: await followToDestination(direct, fetcher), method: "external" };

  const identity = parsePostingIdentity(html);
  const found = await findAtsApplyUrl(
    {
      title: title || identity.title,
      company: company || identity.company,
      companySlug: identity.companySlug,
    },
    { fetcher },
  );
  return found ? { url: found, method: "external" } : { url, method: "unknown" };
}

/**
 * Resolve a batch of sent-posting records before they are rendered into an email.
 * Records are copied, never mutated, and each distinct URL is resolved once.
 * A record whose resolution fails keeps the link it arrived with.
 *
 * @template {{ url?: string, title?: string, company?: string }} T
 * @param {T[]} records
 * @param {{ fetcher?: typeof fetch }} [options]
 * @returns {Promise<(T & { apply_method?: string })[]>}
 */
export async function resolveApplyLinks(records, { fetcher = fetch } = {}) {
  const inFlight = new Map();
  return Promise.all(
    (records || []).map(async (record) => {
      const url = record?.url;
      if (!isLinkedInJobUrl(url)) return record;
      if (!inFlight.has(url)) {
        inFlight.set(
          url,
          resolveApplyTarget(url, {
            fetcher,
            title: record?.title,
            company: record?.company,
          }).catch(() => ({ url, method: "unknown" })),
        );
      }
      const resolved = await inFlight.get(url);
      return resolved.method === "external"
        ? { ...record, url: resolved.url, apply_method: "external" }
        : { ...record, apply_method: resolved.method };
    }),
  );
}
