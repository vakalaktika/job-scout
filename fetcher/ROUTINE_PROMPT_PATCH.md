# Routine prompt patch: replace steps B-D

Steps A and E-H (candidate loading, dedupe, `/send-email`, logging, summary) stay as they are.
Keep every existing rule about freshness, verification and never loosening matches.

---

**Setup (once, at run start, fresh container).**
```
git clone --depth 1 https://github.com/vakalaktika/job-scout --branch claude/sleepy-fermat-obn7ld /tmp/job-scout
python3 --version
```
If the clone or Python fails, say so in the summary and fall back to WebSearch for this run.

**B. Build the exclusion list (per candidate).**
Query Sent Postings (data source `collection://a56ec755-04ff-4c29-bacc-a882df632706`) with:
`SELECT "Apply URL","userDefined:URL" FROM "collection://a56ec755-04ff-4c29-bacc-a882df632706" WHERE "Candidate email" = ?`
binding the candidate's email. If the harness saves the result to a file, run:
`python3 /tmp/job-scout/fetcher/sent_urls.py <saved_file> > /tmp/sent.txt`
(for a small inline result, write the URLs one per line to `/tmp/sent.txt`). Never write the email to a file or log.

**C. Fetch the shortlist (per candidate, one at a time, in the main session, no subagents).**
```
python3 /tmp/job-scout/fetcher/scout.py --roles "<target roles, comma separated>" --loc "<preferred locations>" \
  [--remote] --max-age <N> --exclude-file /tmp/sent.txt > /tmp/shortlist.json
```
- `<N>` is the candidate's freshness limit in days; blank = 4; "15+" = `--max-age 0` (no hard cutoff).
- Pass `--remote` when the candidate wants remote only.
- Read only `/tmp/shortlist.json`. Do not run WebSearch for sources the script covers.
- Use WebSearch only as fallback for what the script cannot see (city-level US boards, on-site roles),
  and only when the shortlist has no qualifying match.

**D. Judge the shortlist.**
For each posting decide fit against the candidate's resume and preferences. Then:
1. `verified: false` never appears (already removed). `verified: null` needs one WebFetch check; drop it if
   the page is closed or cannot be confirmed.
2. `date_trusted: false` does not prove freshness. Open the page, find the real posted date, and apply the
   freshness limit; if no date can be found, skip it.
3. Read `note` for eligibility caveats (for example Poland-only remote) and respect work authorization.
4. Never invent or loosen a match to avoid zero results. Zero qualifying postings is a valid outcome.
5. Keep at most the number of postings the original prompt allows, best fit first.

Continue with step E (dedupe) using the chosen postings.
