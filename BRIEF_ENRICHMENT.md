# Job brief enrichment

## Problem

The dashboard receives jobs from the Notion **Sent postings** database. A detailed card is only
possible when `Job summary`, `Why it matched`, and `Key requirements` are populated. Previously the
dashboard silently substituted generic copy whenever those fields were empty, with no retry path or
signal that enrichment had failed.

## Test-branch solution

The Worker now repairs missing briefs before returning a member session:

1. Keep complete briefs unchanged.
2. Look for source text in existing Notion description properties and in the job page body.
3. If necessary, fetch the original public posting. Schema.org `JobPosting` JSON-LD is preferred over
   page text, so direct ATS pages are extracted with less navigation and cookie noise.
4. Generate a structured brief with the OpenAI Responses API.
5. Persist the three brief fields plus `Brief status`, `Brief error`, and `Brief updated at` to Notion.
6. Cache `Unavailable` and `Failed` outcomes for 24 hours before retrying.

Up to four missing briefs are repaired concurrently on a session request. This bounds latency and API
usage while allowing later requests to fill the remainder. An authenticated `job_brief` action can
force one job through the same path.

Existing dashboard code does not need to change: once the Worker returns the persisted fields, the
current job-card component renders the detailed layout automatically.

## Safety and failure behavior

- Existing briefs are never overwritten.
- A failed enrichment never removes a job or fails the member session.
- Posting URLs must be public HTTP(S) URLs; loopback and common private-network ranges are rejected.
- Fetched bodies are capped at 512 KiB; posting fetches time out after 10 seconds and model calls after
  20 seconds.
- Posting and resume text are explicitly treated as untrusted prompt data.
- Email addresses and phone numbers are redacted from resume context.
- OpenAI response storage is disabled with `store: false`.
- The model response is constrained to a strict JSON schema and validated again before persistence.

## Configuration

The Worker needs one new secret:

```sh
wrangler secret put OPENAI_API_KEY
```

Optional Worker variables:

- `OPENAI_BRIEF_MODEL` defaults to `gpt-5.4-nano`.
- `BRIEF_ENRICH_LIMIT` defaults to `4` and is clamped to `1`–`6`.

The first enrichment request adds the required Notion properties if they do not exist.

## Authenticated single-job request

```json
{
  "action": "job_brief",
  "session_token": "<member session>",
  "job_id": "<Notion page id>"
}
```

The response returns the updated public job object. Raw posting text is never returned to the browser.

## Verification

```sh
node --check worker.mjs
node --test worker.test.mjs
```

The tests use mocked posting pages, model output, and persistence; no Notion or OpenAI credentials are
needed.
