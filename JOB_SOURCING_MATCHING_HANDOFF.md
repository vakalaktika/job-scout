# Job Scout sourcing and matching handoff

Last verified: 2026-08-08

## Executive summary

Job Scout is a two-part system:

1. An external scheduled dispatcher searches job sources, decides which postings are plausible matches, de-duplicates them, writes them to Notion, and sends the alert email.
2. This repository captures the candidate's résumé and explicit preferences, serves the selected jobs, applies deterministic freshness and steer-away rules, records review decisions, and creates grounded job briefs from the original posting plus the candidate's résumé.

That separation explains much of the product's consistency. The dispatcher works from stable candidate inputs, and the dashboard adds deterministic freshness and steer-away controls at read time. When a brief is missing, the Worker's explanation repair is grounded in source text instead of generating a match story from a title alone.

The most important implementation boundary is that the dispatcher's source connectors, prompts, query construction, scoring, thresholds, and schedule are **not in this repository**. They belong to scheduled agent `trig_01LZtNUf7LVFzw3C2Fyy9QEw`. This repository therefore proves the candidate contract, persistence model, read-time filtering, enrichment, and delivery contract, but it does not prove the dispatcher's internal ranking algorithm.

## End-to-end flow

```text
Candidate intake
  -> browser extracts résumé text and suggests editable preferences
  -> Worker stores candidate profile + résumé in Notion
  -> external dispatcher reads active profiles
  -> dispatcher searches fresh job sources
  -> dispatcher matches and de-duplicates candidates/postings
  -> dispatcher writes accepted matches to Sent postings in Notion
  -> dispatcher sends a freshest-first email
  -> dashboard loads that candidate's postings
  -> Worker enforces posting age
  -> Worker fills missing briefs from posting + résumé
  -> Worker applies steer-away hide/rank behavior
  -> candidate saves/passes and optionally records a reason
```

## 1. Candidate signal capture

The browser reads PDF, DOC/DOCX, and TXT résumés locally. It extracts text and uses simple, deterministic heuristics to suggest a name, email, up to three recognized role titles, up to six recognized skills/themes, location, and up to four steer-away suggestions. Those suggestions are editable; the candidate is not locked into the résumé parser's guesses.

The final matching contract sent to the Worker contains:

- résumé text and filename;
- target roles;
- role keywords, skills, industries, or themes;
- up to five preferred cities, each with state/region and country;
- one or more acceptable work arrangements (`onsite`, `hybrid`, `remote`);
- minimum and maximum salary;
- seniority;
- maximum posting age;
- steer-away terms and either `rank lower` or `hide` behavior;
- alert frequency; and
- résumé-derived steer-away suggestions.

Readable payload construction lives in `intake-flow.source.js` inside the submit handler. The production résumé extraction and suggestion logic is in the shipped bundle referenced by `index.html`.

The Worker maps these fields into the Candidates Notion database in `candidateProps()` in `worker.mjs`. Core fields are first-class Notion properties. Preferred cities are stored in `Regions` as semicolon-separated `City, State, Country` entries. Work arrangements are stored as `Work modes` in `Notes`; `Remote OK` remains populated for compatibility with the existing dispatcher. Keywords, maximum salary, posting-age window, and résumé filename also live in `Notes`. On initial creation, parsed résumé text is written into the candidate page body in 1,900-character blocks.

## 2. Sourcing and initial matching

The external dispatcher owns the actual discovery loop. The documented contract says it:

1. reads each active candidate's profile and résumé from Notion;
2. searches fresh postings from job sources such as LinkedIn and direct ATS boards including Lever and Greenhouse;
3. evaluates postings against the candidate's target roles, experience, every preferred city, every selected work arrangement, salary, seniority, freshness window, and negative preferences; selected cities and work arrangements are inclusive alternatives, so the first suitable role across any selected combination may be accepted;
4. rejects postings already present for that candidate in Sent postings;
5. writes accepted matches back to Sent postings; and
6. sends an email only when there are new matches.

Each accepted posting can carry title, company, URL, location, source, date posted, date sent, raw posting text, a primary domain/job family, and the three brief fields.

### Apply-link resolution for LinkedIn matches

A LinkedIn posting's `URL` is a landing page, not an application. Most LinkedIn postings hand the candidate to the employer's own board the moment they press Apply, so a delivered LinkedIn link costs a sign-in wall and a second click.

Reading the button is not enough on its own. As of August 2026 LinkedIn's public guest fragment still states *whether* a posting applies offsite — the Apply button carries an offsite icon, an Easy Apply one carries an onsite tracking name — but the destination sits behind a signed redirect that cannot be constructed without a session. This was verified against 24 live postings: none exposed the URL, and the `/jobs/view/externalApply/<id>` endpoint answers 400 without LinkedIn's `urlHash`.

`linkedin-apply-url.mjs` therefore establishes the route, and `ats-boards.mjs` finds the destination when LinkedIn will not name it, by looking the role up on the employer's own Ashby, Greenhouse, or Lever board using company and exact title. The result is one of three answers — `external` (a destination established beyond doubt), `linkedin` (Easy Apply, so the post *is* the application), or `unknown` (bot wall, timeout, or an offsite role that could not be pinned down). Only `external` changes the link the candidate receives; the other two deliberately keep the LinkedIn post.

The board match is strict: exactly one posting on one board carrying exactly that title. The same title in two cities is ambiguous and resolves to nothing, because the wrong location's posting is worse than the click this removes. Measured over 12 live LinkedIn postings, 7 resolved to a working employer apply page and 5 fell back.

Two independent call sites resolve, and they are not interchangeable:

- **Email.** `dispatch/render-match-email.mjs` resolves at send time, before `toPosting()`/`buildEmail()`. This is the reference implementation. The **deployed** `job-scout-backup-dispatcher` Worker must adopt the same step for sent mail to carry apply links; until it does, only the dashboard benefits.
- **Dashboard.** The Worker resolves once per posting during `sessionResponse()` and stores the result on the Sent posting as `Apply URL`, `Apply method`, and `Apply checked at`. A settled answer is never re-resolved; an `unknown` retries after 24 hours. Resolving one posting costs a guest read plus up to nine board lookups, so the sweep defaults to two postings per session (`APPLY_LINK_LIMIT`, range 0–8) and a backlog clears over a few visits instead of exhausting the Worker's subrequest budget.

Three constraints hold on both paths:

1. The `URL` column is never overwritten. It is the dispatcher's de-duplication key, and rewriting it would re-send the same role. The dashboard exposes the resolved link as `url` and the original post as `posting_url`.
2. Every resolved link passes the same public-URL guard the posting fetcher uses, so a redirect into loopback, link-local, or RFC 1918 space — or a non-`http(s)` scheme — cannot reach a candidate.
3. A redirect chain that lands on a site root is discarded in favour of the link already held, because a careers homepage is not a posting.

The resolver identifies itself honestly in its `User-Agent` and reads only LinkedIn's public guest fragment. When LinkedIn refuses that read the outcome is `unknown`, and the candidate gets the LinkedIn post — the pre-existing behaviour.

### Candidate-scoped first run

New candidates are created with `First scout status = Available`. After onboarding they
may consume that entitlement once. The authenticated Worker resolves the candidate from
the signed session, and a candidate-keyed Cloudflare Durable Object records the claim
before it fires the dispatcher routine. The trigger text contains only `candidate_id`, an
opaque `request_id`, mode `single_candidate`, and constraints forbidding a global
fallback. No name, email, résumé, or preference content crosses that trigger boundary.

The external dispatcher must validate the exact candidate and request against Notion,
set `Running`, and then use its normal sourcing and per-candidate de-duplication path for
that person only. It must set `Completed` plus `First scout completed at` even when no
postings match; a zero-match run sends no email. The full operational prompt and deploy
order are in `FIRST_SCOUT_SETUP.md`.

What is not recoverable from this repository:

- the complete source list and whether each source is queried through search, an API, or page retrieval;
- the search-query expansion strategy;
- any LLM prompt used for initial matching;
- whether the dispatcher uses a numeric score, rubric, embeddings, or a pure judgment step;
- score weights, cutoffs, and shortlist-size limits;
- the exact de-duplication key and URL canonicalization rules;
- how stored alert frequency maps to cron runs; and
- whether dashboard decisions are consumed during future dispatcher runs.

There is no crawler, vector database, embedding pipeline, or weighted ranker in this codebase. Those should not be claimed as part of Job Scout without inspecting the external dispatcher.

## 3. Persistence and de-duplication contract

Notion is the shared system of record:

| Database | Purpose |
|---|---|
| Access codes | Invite status and the candidate linked to an invite |
| Candidates | Identity, active/paused status, résumé, matching preferences, and cadence |
| Sent postings | One posting shown to one candidate, plus source, dates, brief, and review state |

The dispatcher uses Sent postings as the history against which it de-duplicates. The Worker does not perform write-time de-duplication itself; it reads the records already created by the dispatcher.

`loadMemberJobs()` queries Sent postings newest `Date sent` first, selects records whose `Candidate email` matches the signed-in member, and stops pagination after it has collected at least 300 matching records. Because Notion pages arrive in batches, this is a pagination threshold rather than an exact hard cap.

## 4. Read-time quality controls

`sessionResponse()` in `worker.mjs` is the dashboard's main quality gate.

### Freshness

The candidate's maximum posting age defaults to seven days. Jobs with a valid `Date posted` outside that window are removed. Jobs without a usable posting date are also omitted. A posting already marked `Interested` is retained regardless of age so saved work does not disappear.

### Steer-away behavior

Candidates can name terms that are undesirable even when the overall role appears relevant. The Worker evaluates those terms against:

1. job title and canonical primary domain/job family; then
2. summary, key requirements, and match reason.

Matching is whole-token with light stemming. This deliberately avoids substring mistakes such as treating `infrastructural` as an exact match for `infrastructure` or `backendless` as `backend`.

- In `hide` mode, matching postings are removed and the exact hidden count is returned.
- In `rank lower` mode, preferred jobs stay first and matching jobs move to the end. Order is preserved within each group.

This is deterministic filtering, not semantic or LLM ranking.

### Ordering

The email contract requires postings freshest first. The dashboard's backend query is ordered by `Date sent` descending; after that, steer-away rank mode performs a stable two-bucket partition. There is no in-repo numerical relevance sort.

## 5. Grounded brief enrichment

OpenAI is used by this repository only to repair missing explanations for already accepted jobs; it does not source jobs or decide whether they enter the shortlist here.

A complete brief has three fields:

- `Job summary` — what the role actually owns;
- `Why it matched` — how demonstrated résumé experience maps to the posting; and
- `Key requirements` — the most important requirements and constraints in the posting.

For a missing brief, the Worker searches for source text in this order:

1. description properties already stored on the Sent posting;
2. text blocks in the Sent posting's Notion page; and
3. the public posting URL — the resolved `Apply URL` when one exists, otherwise the original. The employer's board serves the whole posting where LinkedIn answers a datacentre fetch with a sign-in wall, so resolution runs before enrichment. The liveness sweep reads the same page for the same reason.

When it fetches a posting, it prefers Schema.org `JobPosting` JSON-LD over general page text. The fallback strips scripts, styles, navigation, and other noise, requires multiple job-like signals, and rejects common login, verification, and anti-bot pages.

The model request is deliberately narrow:

- default model: `gpt-5.4-nano`;
- inputs: basic job metadata, candidate name, target roles, seniority, redacted résumé, and posting text;
- instruction: use only supplied facts and never invent compensation, duties, requirements, or candidate experience;
- response: strict JSON schema for the three brief fields;
- storage: disabled with `store: false`; and
- output: normalized and length-validated before persistence.

Missing or failed briefs do not remove a job or fail the dashboard. Failed and unavailable attempts are cached for 24 hours, then become eligible for retry. A session enriches up to four missing briefs by default, with a configured range of one to six.

This grounding likely contributes to the product feeling precise: when the Worker repairs a missing brief, the visible explanation compares up to 24,000 characters of parsed résumé context with source posting text rather than paraphrasing only the title or trusting a search snippet. Existing complete briefs are preserved, so their provenance depends on the external dispatcher and cannot be verified here.

## 6. Candidate review data

The dashboard lets the candidate mark a posting `Interested` or `Not interested`. A pass can record one of four reasons — Role, Company, Location, Pay — or free text the candidate types under "Something else". A separate "Already applied" option records where the candidate actually is instead of filing the posting away as a bad match. Beyond the decision, each posting carries an `Application status` (`Applied`, `Interviewing`, `Offer`, `Rejected`, `No response`) and an `Applied at` date. The Worker ownership-checks the posting for both writes, then persists to Notion.

What that feedback demonstrably does today:

- `Not interested` removes the posting from the active dashboard list, but keeps it reachable under a "Not interested" filter, with a `Put back` control that clears the decision;
- `Interested` keeps the posting in the saved list even after it ages out;
- any reviewed or tracked posting now survives the freshness window (`keepForSession()`), so a change of mind and an application in progress both still exist a week later;
- a pass reason is appended to the candidate's `Match context` — newest first, de-duplicated, capped at 12 lines — and shown back to the candidate in Settings; and
- all of it remains in the shared Notion record, where operations or the external dispatcher can read it.

What is still **not demonstrated in this repository** is an automated learning loop that converts those decisions into new weights, prompts, exclusions, or future search queries. `Match context` gives the dispatcher one first-class field to read instead of a reason scattered across postings, but nothing in this repository consumes it.

## Why the results feel accurate and consistent

The strongest evidence-backed explanation is the combination of:

1. **A rich profile instead of a title-only search.** The system receives parsed résumé text plus explicit roles, themes, multiple acceptable cities and work arrangements, pay, seniority, and freshness limits.
2. **Candidate-correctable extraction.** Résumé suggestions accelerate setup, but candidates review and edit the actual search contract.
3. **Hard negative controls.** Steer-away terms remove predictable false positives or consistently demote them.
4. **Freshness as a gate.** Old or undated results do not linger in the dashboard, while saved jobs are protected.
5. **Candidate-specific history.** Sent postings provide persistent per-candidate de-duplication rather than relying on a stateless search result page.
6. **Source-grounded repair.** When a brief is missing, the Worker generates it from posting text and résumé context under a strict schema and anti-invention instruction; existing complete briefs are left unchanged.
7. **Stable state.** Notion gives the dispatcher, Worker, dashboard, and email one shared record of the candidate, match, and review state.
8. **Graceful failure behavior.** Unreadable postings or model failures do not corrupt or discard otherwise valid matches.

The consistency should be described as a layered quality system—retrieval plus explicit constraints plus deterministic post-filtering plus grounded repair for missing briefs—not as proof of a proprietary score or self-training model.

## Beta feedback findings (2026-08-05)

Five beta submissions plus two direct notes were reviewed. Sentiment was strong, but three defects in this repository were confirmed and fixed; the full backlog lives in `.context/todos.md`.

1. **Candidate locations were being silently overwritten.** The dashboard's session hydration restored every profile field except country, state, and city, so `member.regions` was never read back by any client. Both write paths then serialised the dashboard's own defaults — `San Francisco, California, United States` — to Notion. Changing delivery frequency alone was enough to trigger it, because that handler posted a full profile snapshot. Two respondents reported the symptom by name; a third's "not based where I am" complaint is most likely the same bug, since the dispatcher had been searching the wrong city. Fixed in `parseRegions()`/`memberState()`, in `candidateProps()` (which now writes only fields present in the payload), and in `patch-dashboard.mjs`.

2. **Expired postings were undetectable.** `postingTextForJob()` read the HTTP status and discarded it, collapsing a 404 into the same empty string as an unparseable page. Because expired ATS postings usually redirect to a page that returns 200 and still carries the full JSON-LD description, a dead role could even produce a healthy-looking brief. Postings whose text the dispatcher had already stored were never fetched at all. `postingTextForJob()` now returns `{ text, liveness }`, `checkPostingLiveness()` always fetches, `detectPostingGone()` checks Schema.org `validThrough` and explicit closure notices, and `sessionResponse()` runs a bounded daily re-check. Closed postings are demoted and badged rather than removed, because a false positive that hides a live role is the worse failure.

3. **Remote status had nowhere to live.** No structured workplace field existed on the posting record, in the brief schema, or in the email template — it was free text inside `Location`. `workplace_type` is now part of the brief schema and persists to a `Workplace type` select on Sent postings.

## Experience alignment (2026-08-06)

`experience-mockup.html` is the reviewed end-to-end design. Intake, the invite gate, the email, and magic-link sign-in already matched it; the dashboard did not. Five gaps were closed.

1. **The card and the inbox disagreed about freshness.** The email fades its pill through three bands and the card had one boundary, so the same posting read as fresher in one surface than the other. The card now uses the email's exact bands — green 0–2 days, amber 3–7, grey 8+ — and names the day once a posting is past a week, because "Posted 23 days ago" stops meaning anything.
2. **Pay was in the email and nowhere else.** `Sent postings` had no salary column the Worker read, so members opened postings to find out what the alert had already told them. `jobState()` now reads `Salary` (or `Salary range` / `Compensation` / `Pay range`), `salary_range` joins the strict brief schema so enrichment can recover it from the posting text, and an unstated salary leaves whatever the dispatcher stored alone.
3. **Link status only spoke up on failure.** A card that says nothing when a posting is open gives no way to tell "checked and live" from "nothing has looked at this". Both states are badged now, and a closed posting is muted and demoted rather than dropped.
4. **A decision could not be taken back.** `Save`/`Pass` hid both controls the moment either was used, so a mis-tap needed an operator to edit Notion. `saveJobDecision()` accepts an empty decision to clear the review, and the card's `Interested` control is a toggle. This closes the "way to undo a decision" open item; free-text feedback is still outstanding.
5. **One undifferentiated list.** Saved roles sat mixed in with unreviewed ones. A New / Saved / All filter splits them without moving anything off the page, and the heading now states when the scout last ran (`last_run_at` on the session response), so an empty list no longer reads the same as one that has never been filled.

The pass-reason copy was also corrected. It promised the feedback taught the scout, which known gap 3 records as untrue; it now says only that the reason is saved with the posting.

Dashboard behaviour is covered by `dashboard-helpers.test.mjs`, which lifts the injected helpers out of the built bundle rather than trusting the patch strings. `patch()` in `patch-dashboard.mjs` now accepts a list of anchors, because the shipped artifact is itself post-patch and a fix that supersedes an earlier fix has to match either state to stay idempotent.

## Sign-in by magic link was never wired up (2026-08-07)

The link in the sign-in email 404'd, and two independent defects were behind it. Both predate the experience work and neither was introduced by it.

1. **The link pointed outside the site.** `magicLinkUrl()` built `${ORIGIN}/?login=…`, but `ORIGIN` is the CORS origin and an origin cannot carry a path. Pages serves this repository as a project site at `https://vakalaktika.github.io/job-scout/`, so the link resolved to the user-site root, where no Pages site exists. Every other reference in the repository — the README, the email template, even the brief enricher's `User-Agent` — already used the `/job-scout/` base; the sign-in link was the one place that did not. `APP_URL` now holds the site base and `ORIGIN` is used only by the CORS header.

2. **Nothing consumed the token.** The Worker mints the token, emails it, and exposes `magic_consume`, all covered by tests, but the front end never read it back: the mount effect looked only at `?preview=` and `localStorage`. A member who followed a corrected link would still have landed on the invite-code gate — the one screen the link exists to let them skip. The dashboard now exchanges `?login=` for a session on load, strips the token from the address bar before the request so it does not reach history or the referrer, and falls through to the invite gate when the link has expired, been used, or had its nonce rotated.

The lesson worth carrying into the handoff: `magicLinkUrl()` and `renderMagicEmail()` both had passing tests, and the tests asserted the wrong URL. Neither end of the flow was exercised against the deployed site.

## The location reset had a second author (2026-08-07)

Beta reports of locations reverting to San Francisco continued after the 2026-08-05 fix, and the deployed artifacts were not the reason: the Pages bundle carries `__jsRegion` and the live Worker answers `magic_consume` and `job_application`, both newer than that fix. The remaining writer was the résumé parser. `vP()` scans the entire résumé text against the location gazetteer, stops at the first state whose name or listed city appears anywhere in the text, and — when only the state name matches — falls back to that state's *first listed city*, which for California is literally San Francisco. The upload handler then merged every suggestion into profile state unconditionally, including in edit mode, where location lives on a tab the member never opened. So a member in Austin who replaced their résumé — one that mentioned a California employer, client, or university anywhere — had their saved location silently rewritten, and the edit flow's full-snapshot submit persisted it. California enumerates before Texas, so this happened even when the résumé also said Austin.

`__jsResumePrefill()` in `intake-flow.source.js` now gates the merge: first-time intake keeps the full prefill (the member still reviews every step), but editing a saved profile takes only the steer-away suggestions, which render as optional chips rather than writing into a field. `intake-prefill.test.mjs` lifts the gate out of the shipped bundle, in the same style as `dashboard-helpers.test.mjs`, so the test fails if the injection stops carrying the fix.

## Known gaps and operational risks

1. **The initial matching brain is outside version control here.** The behavior producing the shortlist cannot be reproduced, regression-tested, or fully handed off from this repository alone.
2. **No measurable ranking contract is present.** There are no checked-in weights, thresholds, evaluation set, precision/recall metrics, or acceptance tests for the external dispatcher.
3. **Feedback consumption is unverified. — Partly addressed.** The four pass reasons are no longer write-only telemetry scattered across postings: free text is captured, and every reason is rolled onto the candidate's `Match context` field, newest first and capped at 12 entries, then shown back to the candidate in Settings. What the copy claims is exactly what happens ("we save it with this posting and add it to your search context"). **Consuming that field is still the dispatcher's job and is not implemented anywhere in this repository** — no local code reads `Match context` to change future sourcing. That remains the open ask.
4. **Unknown posting dates disappear from the dashboard.** This protects freshness but can hide a legitimately new posting whose source omitted a date, and it disagrees with the email, which renders an explicit "Posting date not listed" label for the same posting.
5. **Notion filtering is partly in memory.** `loadMemberJobs()` pages through the shared Sent postings database and filters candidate email in Worker code, stopping pagination after at least 300 candidate matches; growth may affect latency and completeness.
6. **A revoked invite code still grants access. — Fixed.** `authenticatedCandidate()` now rejects any session whose candidate `Status` is `Revoked`, and the `magic_request`, `magic_consume`, and code paths enforce the same check, so a revoked member loses access on their next request rather than at token expiry. This is what allowed `SESSION_SECONDS` to be raised to 30 days safely.
7. **Three freshness thresholds disagree. — Fixed.** The exported `postingAgeDays()` measures age in whole UTC days and no longer swallows an explicit `Posted within: 0`. The dashboard's "aging" pill was moved from 15 days to the same 8+ (`>7`) boundary the email uses, and the bundle now parses a bare `YYYY-MM-DD` at local midnight so the day count matches the reader's calendar. The email's own band colours are filled by the external dispatcher and remain a handoff ask (see `.context/todos.md`).
8. **A saved job can still disappear. — Fixed.** `applySteerAway()` now treats a posting the candidate marked `Interested` as never matching a steer term, so hide mode can no longer remove a saved job and rank mode keeps it in the preferred group. A regression test covers both modes.
9. **The dashboard has no source.** It exists only as a 1.4 MB minified bundle with no `package.json` and no build, so every dashboard change is an exact-string patch in `patch-dashboard.mjs`. Worker-side fixes should be preferred wherever the same outcome is reachable.

## Managing a posting past the first decision (2026-08-06)

The review model stopped at one yes/no per posting. Three gaps followed from that, all closed here.

1. **A pass was a dead end.** Role / Company / Location / Pay could not describe most passes — "already applied" and "wrong industry" have no button — and the chosen reason sat on the posting where nothing gathered it. "Something else" now opens a free-text field; `job_decision` accepts a `note` alongside the reason; and `recordMatchContext()` appends the result to the candidate's `Match context`. "Already applied" writes an application status rather than a rejection, because applying is not a complaint about the match.

2. **A dismissed posting vanished.** `Not interested` removed it from the list with no way back short of an operator editing Notion, and `sessionResponse()` dropped it entirely once it aged past the freshness window. `keepForSession()` now keeps any posting the member has reviewed or tracked, a "Not interested" filter lists them, and the pass control is a toggle that reads `Put back`. A posting restored after aging out is held in the list for the rest of the session, so the undo cannot make it disappear at the moment it was asked for. `applySteerAway()` was the second way a dismissed posting could disappear — hide mode would drop it before the dashboard ever saw it — so its exemption now covers any posting the candidate has acted on, not just saved ones. That also keeps `hidden_count` meaning postings the candidate never saw.

3. **Nothing survived the decision.** A saved job and one applied to three weeks ago with no reply were the same record. `Application status` and `Applied at` are new properties on Sent postings, written by a new `job_application` action; the card carries a status row, and `__jsAppNote()` names two weeks of silence rather than leaving the member to work it out from a date.

The free-text field is an uncontrolled `<form>`, not a controlled input. The card list is a component defined inside the dashboard component, so it is re-created on every parent render; a controlled input would have remounted and lost focus after each keystroke. `required` gives non-empty validation and Enter-to-submit without any parent state.

> The previous revision's gap 4 — résumé replacement on profile edit — is fixed. The update path now writes `Name` and replaces the candidate page-body résumé via `replaceResumeBlocks()`, so enrichment stops matching against a superseded résumé.

## Recommended completion of the handoff

To make the system fully reproducible, export or document the external dispatcher beside this file with:

- scheduler and cadence mapping;
- complete source inventory and access method;
- candidate-to-query transformation;
- initial matching prompt or rubric;
- acceptance/rejection thresholds and maximum results per run;
- URL normalization and candidate-specific de-duplication key;
- Notion read/write property map;
- email rendering and send provider;
- feedback-consumption rules, including how `Match context` should shape the next run; and
- a small anonymized gold set of candidates/postings with expected accept/reject outcomes.

## Source map

- `README.md`: architecture, dispatcher ownership, documented sourcing contract, data model, and deployment.
- `intake-flow.source.js`: readable intake fields and candidate payload construction.
- `assets/index-BdD4MZod.js`: shipped résumé parsing, dashboard decisions, and rendering behavior.
- `worker.mjs`: candidate persistence, Notion mapping, freshness, steer-away filtering, link-liveness checks, brief enrichment, auth, and decision writes.
- `patch-dashboard.mjs`: every dashboard-side fix, as guarded exact-string replacements against the minified bundle.
- `.context/todos.md`: the beta feedback backlog and the outstanding asks for the external dispatcher.
- `worker.test.mjs`: deterministic matching and enrichment quality tests.
- `email-template.html`: freshest-first delivery and per-card data contract.
- `BRIEF_ENRICHMENT.md`: enrichment behavior, safeguards, configuration, and failure handling.
- `wrangler.jsonc`: brief model and concurrency configuration.
