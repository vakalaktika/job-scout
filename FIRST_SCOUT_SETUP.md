# One-time first scout: production setup

The repository now contains the complete member-facing and Worker implementation. One
external step remains by design: the existing Claude Code dispatcher routine must be
taught how to handle a `single_candidate` trigger, and its private API token must be
stored as a Cloudflare Worker secret.

The configured routine id is `trig_01LZtNUf7LVFzw3C2Fyy9QEw`. Do not put its API token
in this repository, the browser bundle, a Notion property, or routine text.

## 1. Add the candidate-scoped contract to the dispatcher

Keep the routine's existing scheduled, all-candidate behavior. Add the following branch
to its instructions before that behavior:

```text
ON-DEMAND FIRST-SCOUT CONTRACT

The API trigger may include JSON text with:
- task: "job_scout_onboarding_run"
- version: 1
- mode: "single_candidate"
- candidate_id: a Notion Candidates page id
- request_id: an opaque UUID

When and only when this contract is present:
1. Parse the JSON strictly. Do not infer a candidate from a name, email, or any other
   text. Never fall back to the scheduled all-candidate run if parsing, lookup, or
   validation fails.
2. Load exactly candidate_id from the Candidates database. Require Status = "Active",
   First scout status = "Queued" or "Running", and First scout request = request_id.
   If any check fails, stop without searching another candidate.
3. Set First scout status = "Running". Read that candidate's existing profile,
   preferences, Match context, and resume from Notion.
4. Run the normal sourcing, matching, freshness, URL-normalization, candidate-specific
   de-duplication, Sent-postings writes, and email logic for this candidate only. Do not
   loosen match quality to guarantee a result. Send email only if new matches exist.
5. On a handled success, including zero matches, set First scout status = "Completed"
   and First scout completed at = the current time. Clear First scout error.
6. On a handled failure after validation, set First scout status = "Failed" and write a
   short operator-safe summary to First scout error. Do not include tokens, resume text,
   email addresses, or full provider responses.

When the contract is absent, preserve the routine's existing scheduled behavior.
```

The exact request correlation checks matter. They prevent a delayed or malformed trigger
from running a different person, and they let zero-match runs reach a visible terminal
state without inventing a posting.

## 2. Generate and store the routine trigger token

In the routine's API trigger settings, create a per-routine token for the routine above.
Copy it once, then store it directly in Cloudflare:

```sh
npx wrangler secret put FIRST_SCOUT_ROUTINE_TOKEN
```

Paste the token only at Wrangler's hidden prompt. `wrangler.jsonc` already contains the
non-secret routine id and lists this secret as required.

## 3. Deploy in this order

Run the local verification first:

```sh
node patch-intake-flow.mjs
node patch-dashboard.mjs
node --test worker.test.mjs dashboard-helpers.test.mjs resume-parser.test.mjs intake-prefill.test.mjs build-email.test.mjs first-scout-ui.test.mjs
```

Then deploy the Worker. This applies the `v1-first-scout` Durable Object migration and
creates the `FIRST_SCOUT_GATE` binding:

```sh
npx wrangler deploy
```

Finally publish the updated root assets to GitHub Pages through the repository's normal
main-branch deployment. The cache-buster in `index.html` is already set to
`?v=first-scout`.

## 4. Smoke test with a new invite

Use a fresh invite because existing candidates intentionally do not receive the new
entitlement.

1. Complete onboarding and verify the review screen shows **Find my first matches**.
2. Activate it once. Verify the dashboard says **Your scout is searching**.
3. Refresh or open a second tab and verify the CTA does not return and the routine has
   only one new session.
4. In Notion, verify the candidate progresses through `Available → Queued → Running →
   Completed` (or a terminal failure state).
5. Test a valid zero-match search. It must end at `Completed`, show the zero-results
   message, send no email, and keep the regular schedule active.

## What the implementation adds

- `worker.mjs`: `run_scout_once` and `scout_status`, signed-session authorization,
  Notion lifecycle properties, identifier-only routine payload, and `FirstScoutGate`.
- `wrangler.jsonc`: the Durable Object binding/migration, routine id, and required secret.
- `ready-flow.source.js` + `patch-intake-flow.mjs`: the post-onboarding CTA and safe
  scheduled-run fallback.
- `patch-dashboard.mjs`: queued/running/complete/failure states, five-second lightweight
  polling, and one full session refresh after completion.
- `worker.test.mjs` + `first-scout-ui.test.mjs`: entitlement, one-time dispatch,
  candidate scoping, zero-match completion, UI contract, motion, and reduced-motion
  regression coverage.

The browser never sends a candidate id or email for this action. The Worker resolves the
candidate from the signed session, and the external routine receives only that Notion
page id and an opaque request id.
