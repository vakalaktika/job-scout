import test from "node:test";
import assert from "node:assert/strict";

import {
  isLinkedInJobUrl,
  linkedInJobId,
  parseApplyMethod,
  parseDirectApplyUrl,
  parsePostingIdentity,
  resolveApplyLinks,
  resolveApplyTarget,
  unwrapExternalApplyUrl,
} from "./linkedin-apply-url.mjs";
import { isPublicHttpUrl } from "./public-url.mjs";

const GUEST = (id) => `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
const ASHBY = (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

const htmlResponse = (body, url = "https://example.com/") => ({
  ok: true,
  status: 200,
  url,
  text: async () => body,
});

const notFound = { ok: false, status: 404, url: "", text: async () => "" };

// Today's guest markup: the Apply CTA is a <button>, the destination is not stated,
// and "Apply on company website" is given away by the offsite icon inside it. The
// contextual sign-in modal below it is present on real offsite fragments and is
// deliberately included — its join link is not an apply target.
const offsiteFragment = `
  <a class="topcard__org-name-link" href="https://www.linkedin.com/company/confidotech?trk=x"> Confido </a>
  <h2 class="topcard__title">Product Designer</h2>
  <div class="top-card-layout__cta-container">
    <button class="sign-up-modal__outlet top-card-layout__cta" data-modal="job-details-topcard-apply-modal">
      Apply <icon data-svg-class-name="apply-button__offsite-apply-icon-svg"></icon>
    </button>
    <a href="https://www.linkedin.com/signup/cold-join?source=jobs_registration"
       data-tracking-control-name="public_jobs_apply-link-offsite_contextual-sign-in-modal_join-link"></a>
  </div>`;

// The legacy shape, kept working because reading a stated URL costs nothing.
const legacyOffsiteFragment = (target) => `
  <div class="top-card-layout__cta-container">
    <a class="sign-up-modal__outlet"
       href="${target}"
       data-tracking-control-name="public_jobs_apply-link-offsite">Apply</a>
  </div>`;

const easyApplyFragment = `
  <h2 class="topcard__title">Warehouse Associate</h2>
  <div class="top-card-layout__cta-container">
    <button class="apply-button apply-button--default top-card-layout__cta"
            data-tracking-control-name="public_jobs_apply-link-onsite"> Apply </button>
  </div>`;

const simpleOnsiteFragment = `
  <button class="apply-button" data-tracking-control-name="public_jobs_apply-link-simple_onsite"> Apply </button>`;

const signInWall = `
  <h1>Sign in to LinkedIn</h1>
  <p>Join LinkedIn to see this job. Easy Apply to thousands of roles.</p>`;

// ---------------------------------------------------------------------------
// linkedInJobId
// ---------------------------------------------------------------------------

test("reads the posting id from a slugged LinkedIn job URL", () => {
  assert.equal(
    linkedInJobId("https://www.linkedin.com/jobs/view/staff-designer-at-acme-4123456789"),
    "4123456789",
  );
});

test("reads the posting id when the slug itself contains digits", () => {
  assert.equal(
    linkedInJobId("https://www.linkedin.com/jobs/view/foo-123456-engineer-4123456789/"),
    "4123456789",
  );
});

test("reads the posting id from a bare view path and from currentJobId", () => {
  assert.equal(linkedInJobId("https://linkedin.com/jobs/view/4123456789/"), "4123456789");
  assert.equal(
    linkedInJobId("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4123456789"),
    "4123456789",
  );
});

test("ignores non-LinkedIn hosts, including lookalike domains", () => {
  assert.equal(linkedInJobId("https://job-boards.greenhouse.io/acme/jobs/4123456789"), "");
  assert.equal(linkedInJobId("https://notlinkedin.com/jobs/view/4123456789"), "");
  assert.equal(linkedInJobId("https://linkedin.com.evil.example/jobs/view/4123456789"), "");
});

test("ignores LinkedIn URLs that are not postings", () => {
  assert.equal(linkedInJobId("https://www.linkedin.com/in/someone"), "");
  assert.equal(linkedInJobId("not a url"), "");
  assert.equal(isLinkedInJobUrl(undefined), false);
});

// ---------------------------------------------------------------------------
// unwrapExternalApplyUrl
// ---------------------------------------------------------------------------

test("unwraps LinkedIn's externalApply tracker to the employer URL", () => {
  const wrapped =
    "https://www.linkedin.com/jobs/view/externalApply/4123456789" +
    "?url=https%3A%2F%2Fjob-boards.greenhouse.io%2Facme%2Fjobs%2F771&urlHash=abcd";
  assert.equal(unwrapExternalApplyUrl(wrapped), "https://job-boards.greenhouse.io/acme/jobs/771");
});

test("returns non-LinkedIn and unwrappable URLs untouched", () => {
  assert.equal(
    unwrapExternalApplyUrl("https://jobs.lever.co/acme/abc-123"),
    "https://jobs.lever.co/acme/abc-123",
  );
  assert.equal(
    unwrapExternalApplyUrl("https://www.linkedin.com/jobs/view/4123456789"),
    "https://www.linkedin.com/jobs/view/4123456789",
  );
});

// ---------------------------------------------------------------------------
// parseApplyTarget
// ---------------------------------------------------------------------------

test("reads the apply route off today's button markup", () => {
  assert.equal(parseApplyMethod(offsiteFragment), "offsite");
  assert.equal(parseApplyMethod(easyApplyFragment), "linkedin");
  assert.equal(parseApplyMethod(simpleOnsiteFragment), "linkedin");
});

test("an offsite fragment's sign-in join links never read as Easy Apply", () => {
  // The offsite modal carries onsite-looking tracking names for its own join links,
  // so offsite has to win. Reading this posting as Easy Apply would strand the
  // member on LinkedIn permanently.
  assert.match(offsiteFragment, /apply-link-offsite/);
  assert.equal(parseApplyMethod(offsiteFragment), "offsite");
});

test("a sign-in wall is unknown rather than a guess in either direction", () => {
  assert.equal(parseApplyMethod(signInWall), "unknown");
  assert.equal(parseApplyMethod(""), "unknown");
});

test("a stated destination is still read, from a code block or an offsite anchor", () => {
  const withBlock = `
    <code id="applyUrl" style="display:none"><!--"https:\\u002F\\u002Fboards.greenhouse.io\\u002Facme\\u002Fjobs\\u002F771?gh_src=x"--></code>`;
  assert.equal(
    parseDirectApplyUrl(withBlock),
    "https://boards.greenhouse.io/acme/jobs/771?gh_src=x",
  );
  assert.equal(
    parseDirectApplyUrl(
      legacyOffsiteFragment(
        "https://www.linkedin.com/jobs/view/externalApply/4123456789" +
          "?url=https%3A%2F%2Fjobs.lever.co%2Facme%2Fabc-123&amp;urlHash=abcd",
      ),
    ),
    "https://jobs.lever.co/acme/abc-123",
  );
});

test("a stated destination pointing back at LinkedIn or into private space is refused", () => {
  assert.equal(parseDirectApplyUrl(legacyOffsiteFragment("https://www.linkedin.com/jobs/view/9")), "");
  assert.equal(parseDirectApplyUrl(legacyOffsiteFragment("http://127.0.0.1:8080/apply")), "");
  assert.equal(parseDirectApplyUrl(legacyOffsiteFragment("javascript:alert(1)")), "");
  assert.equal(parseDirectApplyUrl(offsiteFragment), "", "today's markup states nothing");
});

test("reads the company, title, and LinkedIn handle off the top card", () => {
  assert.deepEqual(parsePostingIdentity(offsiteFragment), {
    title: "Product Designer",
    company: "Confido",
    companySlug: "confidotech",
  });
});

// ---------------------------------------------------------------------------
// resolveApplyTarget
// ---------------------------------------------------------------------------

test("finds an offsite posting on the employer's board when LinkedIn hides the link", async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url);
    if (url === GUEST("4123456789")) return htmlResponse(offsiteFragment);
    if (url === ASHBY("confido")) {
      return htmlResponse(
        JSON.stringify({
          jobs: [
            { title: "Senior Software Engineer", applyUrl: "https://jobs.ashbyhq.com/confido/aaa/application" },
            { title: "Product Designer", applyUrl: "https://jobs.ashbyhq.com/confido/bbb/application" },
          ],
        }),
      );
    }
    return notFound;
  };
  const resolved = await resolveApplyTarget("https://www.linkedin.com/jobs/view/4123456789", {
    fetcher,
  });
  assert.deepEqual(resolved, {
    method: "external",
    url: "https://jobs.ashbyhq.com/confido/bbb/application",
  });
  assert.equal(seen[0], GUEST("4123456789"), "LinkedIn is read before any board");
});

test("the dispatcher's own title and company beat the scraped top card", async () => {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    if (url === GUEST("4123456789")) return htmlResponse(offsiteFragment);
    if (url === ASHBY("northwind")) {
      return htmlResponse(
        JSON.stringify({
          jobs: [{ title: "Staff Product Designer", applyUrl: "https://jobs.ashbyhq.com/northwind/ccc/application" }],
        }),
      );
    }
    return notFound;
  };
  const resolved = await resolveApplyTarget("https://www.linkedin.com/jobs/view/4123456789", {
    fetcher,
    title: "Staff Product Designer",
    company: "Northwind",
  });
  assert.equal(resolved.url, "https://jobs.ashbyhq.com/northwind/ccc/application");
  assert.ok(asked.includes(ASHBY("northwind")));
});

test("an offsite posting that cannot be pinned down keeps the LinkedIn link", async () => {
  const posting = "https://www.linkedin.com/jobs/view/4123456789";
  const fetcher = async (url) => (url === GUEST("4123456789") ? htmlResponse(offsiteFragment) : notFound);
  assert.deepEqual(await resolveApplyTarget(posting, { fetcher }), {
    method: "unknown",
    url: posting,
  });
});

test("an ambiguous title on the board is treated as no match at all", async () => {
  const posting = "https://www.linkedin.com/jobs/view/4123456789";
  const fetcher = async (url) => {
    if (url === GUEST("4123456789")) return htmlResponse(offsiteFragment);
    if (url === ASHBY("confido")) {
      return htmlResponse(
        JSON.stringify({
          jobs: [
            { title: "Product Designer", applyUrl: "https://jobs.ashbyhq.com/confido/nyc/application" },
            { title: "Product Designer", applyUrl: "https://jobs.ashbyhq.com/confido/sfo/application" },
          ],
        }),
      );
    }
    return notFound;
  };
  const resolved = await resolveApplyTarget(posting, { fetcher });
  assert.deepEqual(resolved, { method: "unknown", url: posting });
});

test("a stated destination short-circuits the board lookup and follows its redirect", async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url);
    if (url === GUEST("4123456789")) {
      return htmlResponse(legacyOffsiteFragment("https://click.appcast.io/x/9f2"));
    }
    return htmlResponse("<html></html>", "https://acme.wd1.myworkdayjobs.com/careers/job/771");
  };
  const resolved = await resolveApplyTarget("https://www.linkedin.com/jobs/view/4123456789", {
    fetcher,
  });
  assert.equal(resolved.url, "https://acme.wd1.myworkdayjobs.com/careers/job/771");
  assert.ok(!seen.some((url) => url.includes("ashbyhq")), "no board is consulted");
});

test("keeps the stated link when the redirect chain lands on a site root", async () => {
  const fetcher = async (url) =>
    url === GUEST("4123456789")
      ? htmlResponse(legacyOffsiteFragment("https://click.appcast.io/x/9f2"))
      : htmlResponse("<html></html>", "https://acme.example/");
  const resolved = await resolveApplyTarget("https://www.linkedin.com/jobs/view/4123456789", {
    fetcher,
  });
  assert.equal(resolved.url, "https://click.appcast.io/x/9f2");
});

test("refuses a redirect to private space before making the unsafe request", async () => {
  const posting = "https://www.linkedin.com/jobs/view/4123456789";
  const publicHop = "https://click.appcast.io/x/9f2";
  const privateTarget = "http://127.0.0.1:8787/apply";
  const seen = [];
  const fetcher = async (url) => {
    seen.push(url);
    if (url === GUEST("4123456789")) {
      return htmlResponse(legacyOffsiteFragment(publicHop));
    }
    if (url === publicHop) {
      return {
        ok: false,
        status: 302,
        url: publicHop,
        headers: new Headers({ location: privateTarget }),
        text: async () => "",
      };
    }
    throw new Error(`unsafe request: ${url}`);
  };

  assert.deepEqual(await resolveApplyTarget(posting, { fetcher }), {
    method: "unknown",
    url: posting,
  });
  assert.ok(!seen.includes(privateTarget));
});

test("keeps the LinkedIn post when the posting is Easy Apply", async () => {
  const fetcher = async () => htmlResponse(easyApplyFragment);
  const posting = "https://www.linkedin.com/jobs/view/4123456789";
  assert.deepEqual(await resolveApplyTarget(posting, { fetcher }), {
    method: "linkedin",
    url: posting,
  });
});

test("keeps the LinkedIn post when LinkedIn blocks or fails the read", async () => {
  const posting = "https://www.linkedin.com/jobs/view/4123456789";
  const blocked = async () => ({ ok: false, status: 999, url: posting, text: async () => "" });
  assert.deepEqual(await resolveApplyTarget(posting, { fetcher: blocked }), {
    method: "unknown",
    url: posting,
  });
  const thrown = async () => {
    throw new Error("network");
  };
  assert.deepEqual(await resolveApplyTarget(posting, { fetcher: thrown }), {
    method: "unknown",
    url: posting,
  });
});

test("echoes non-LinkedIn postings back without any network call", async () => {
  const fetcher = async () => {
    throw new Error("should not fetch");
  };
  assert.deepEqual(await resolveApplyTarget("https://jobs.lever.co/acme/abc-123", { fetcher }), {
    method: "direct",
    url: "https://jobs.lever.co/acme/abc-123",
  });
});

// ---------------------------------------------------------------------------
// resolveApplyLinks
// ---------------------------------------------------------------------------

test("resolves a batch of records without mutating them, fetching each URL once", async () => {
  let guestReads = 0;
  const fetcher = async (url) => {
    if (url.includes("/jobs-guest/")) {
      guestReads += 1;
      return htmlResponse(legacyOffsiteFragment("https://job-boards.greenhouse.io/acme/jobs/771"));
    }
    return htmlResponse("<html></html>", "https://job-boards.greenhouse.io/acme/jobs/771");
  };
  const linkedInPost = "https://www.linkedin.com/jobs/view/4123456789";
  const records = [
    { title: "Staff Designer", url: linkedInPost, source: "LinkedIn" },
    { title: "Staff Designer", url: linkedInPost, source: "LinkedIn" },
    { title: "Product Designer", url: "https://jobs.ashbyhq.com/acme/abc", source: "Ashby" },
  ];
  const resolved = await resolveApplyLinks(records, { fetcher });

  assert.equal(guestReads, 1);
  assert.equal(resolved[0].url, "https://job-boards.greenhouse.io/acme/jobs/771");
  assert.equal(resolved[0].apply_method, "external");
  assert.equal(resolved[1].url, resolved[0].url);
  assert.deepEqual(resolved[2], records[2]);
  assert.equal(records[0].url, linkedInPost, "input records must not be mutated");
  assert.equal(records[0].title, resolved[0].title);
});

test("a record whose resolution throws keeps the link it arrived with", async () => {
  const linkedInPost = "https://www.linkedin.com/jobs/view/4123456789";
  const fetcher = async () => {
    throw new Error("network");
  };
  const [resolved] = await resolveApplyLinks([{ url: linkedInPost }], { fetcher });
  assert.deepEqual(resolved, { url: linkedInPost, apply_method: "unknown" });
});

// ---------------------------------------------------------------------------
// isPublicHttpUrl
// ---------------------------------------------------------------------------

test("isPublicHttpUrl rejects private space, other schemes, and embedded credentials", () => {
  assert.equal(isPublicHttpUrl("https://boards.greenhouse.io/acme/jobs/771"), true);
  assert.equal(isPublicHttpUrl("http://10.0.0.5/apply"), false);
  assert.equal(isPublicHttpUrl("http://192.168.1.4/apply"), false);
  assert.equal(isPublicHttpUrl("http://172.16.0.1/apply"), false);
  assert.equal(isPublicHttpUrl("http://172.32.0.1/apply"), true);
  assert.equal(isPublicHttpUrl("http://localhost/apply"), false);
  assert.equal(isPublicHttpUrl("file:///etc/passwd"), false);
  assert.equal(isPublicHttpUrl("https://user:pass@example.com/apply"), false);
  assert.equal(isPublicHttpUrl("http://[::]/apply"), false);
  assert.equal(isPublicHttpUrl("http://[::ffff:127.0.0.1]/apply"), false);
  assert.equal(isPublicHttpUrl("http://[::ffff:10.0.0.1]/apply"), false);
});
