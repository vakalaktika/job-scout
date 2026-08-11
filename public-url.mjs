// public-url.mjs
// One guard, used by everything that fetches a URL we did not write ourselves or
// puts one in front of a member. Job postings send us off to employer boards,
// aggregators, and redirect chains, so "is this address safe to follow" is a
// question the posting fetcher, the apply-link resolver, and the board lookup all
// have to ask with the same answer.

/**
 * True only for a public http(s) URL: no other scheme, no credentials in the
 * authority, no loopback, private, link-local, or otherwise non-routable destination.
 */
export function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".local") || host === "::1") return false;
    if (/^(0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return false;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    // URL normalizes dotted IPv4-mapped literals such as ::ffff:127.0.0.1 to
    // ::ffff:7f00:1. Reject the whole IPv4-compatible prefix rather than trying to
    // recover and re-check every textual IPv4 spelling. Unique-local, link-local,
    // and multicast IPv6 destinations are likewise never public application pages.
    if (host.startsWith("::") || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host) || /^ff/i.test(host)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
