// build-email.test.mjs
// Run:  node build-email.test.mjs [path/to/email-template.html]
// Exercises the 4 workplace scenarios + the leaked-token guard against the REAL
// template. Exits non-zero on any failure.

import { readFileSync } from "node:fs";
import { buildEmail } from "./build-email.mjs";

const TEMPLATE_PATH = process.argv[2] ?? "./email-template.html";
const template = readFileSync(TEMPLATE_PATH, "utf8");

// The workplace badge span is uniquely identifiable by its pill background.
const WORKPLACE_BADGE = "background-color:#e7f0ec";
let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "  ok  " : "FAIL  "} ${name}`);
  if (!cond) failures++;
};
const count = (h, s) => h.split(s).length - 1;

const email = { headline: "4 new matches for you", runDate: "Sunday, July 12, 2026", firstName: "Ed" };

const postings = [
  { title: "Staff Product Designer", url: "https://ex.com/1", company: "Northwind",
    location: "Remote (US)", salary: "$180k–$210k", source: "LinkedIn",
    workplace_type: "Remote", matchReason: "Matches your product design + systems focus.", postedDaysAgo: 0 },
  { title: "Senior UX Designer", url: "https://ex.com/2", company: "Contoso",
    location: "Austin, TX", salary: "$150k–$175k", source: "Greenhouse",
    workplace_type: "Hybrid", matchReason: "Hybrid role near your area with research scope.", postedDaysAgo: 4 },
  { title: "Design Lead", url: "https://ex.com/3", company: "Fabrikam",
    location: "San Diego, CA", source: "Lever", // no salary -> omitted from meta line
    workplace_type: "On-site", matchReason: "Leadership track you flagged interest in.", postedDaysAgo: 12,
    postedDate: "2026-06-30" },
  { title: "Product Designer", url: "https://ex.com/4", company: "AdventureWorks",
    location: "Seattle, WA", salary: "$160k", source: "Company site",
    workplace_type: "Unclear", matchReason: "Strong overlap with your fintech background.", postedDaysAgo: 2 },
];

const html = buildEmail(template, email, postings, {});

// --- Workplace scenarios ---------------------------------------------------
check("Remote badge is rendered", html.includes(">Remote<") || html.includes("Remote\n") || />[\s]*Remote[\s]*</.test(html));
check("Hybrid badge is rendered", /Hybrid/.test(html));
check("On-site badge is rendered", /On-site/.test(html));
check("word 'Unclear' never printed", !html.includes("Unclear"));
check("exactly 3 workplace badges (Unclear row removed)", count(html, WORKPLACE_BADGE) === 3);

// --- No token leaks --------------------------------------------------------
check("no {{...}} token survives", !/\{\{\s*[\w.-]+\s*\}\}/.test(html));
check("{{JOB_CARDS}} consumed", !html.includes("{{JOB_CARDS}}"));
check("markers removed", !html.includes("JOB_CARD_START") && !html.includes("JOB_CARD_END"));

// --- Other fills -----------------------------------------------------------
check("all 4 posting URLs present", ["1","2","3","4"].every((n) => html.includes(`https://ex.com/${n}`)));
check("salary omitted for card with no salary", !html.includes("$undefined"));
check("headline + first name filled", html.includes("4 new matches for you") && html.includes("Hi Ed"));
check("8+-day card shows dated label", html.includes("(12 days ago)"));

// --- Guard: zero postings --------------------------------------------------
check("zero postings -> null (do not send)", buildEmail(template, email, [], {}) === null);

// --- Guard: leaked token throws -------------------------------------------
let threw = false;
try { buildEmail(template + "\n{{ROGUE_TOKEN}}", email, [postings[0]], {}); }
catch { threw = true; }
check("leaked token makes buildEmail throw", threw);

// --- keepPosting predicate (link-liveness hook) ----------------------------
const only2 = buildEmail(template, email, postings, { keepPosting: (p) => p.url.endsWith("2") });
check("keepPosting drops non-live postings", count(only2, WORKPLACE_BADGE) === 1 && only2.includes("https://ex.com/2"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
