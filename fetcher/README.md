# job-scout-fetcher

Replaces WebSearch in the Job Scout routine with direct, dated sources. Python 3.8+, standard library only.

## Run

```
python3 scout.py --roles "senior qa,qa engineer,sdet" --loc "US,EU,Remote" --remote \
    --max-age 4 --exclude-file /tmp/sent.txt > /tmp/shortlist.json
```

| Flag | Meaning |
|---|---|
| `--roles` | Comma-separated phrases. A title matches when every word of a phrase is in it. |
| `--loc` | Comma-separated. `US`, `EU`, `Europe`, `Remote` and plain place names are understood. |
| `--remote` | Candidate wants remote only: on-site/hybrid postings are dropped. |
| `--max-age` | Days. Default 4 (blank freshness). `0` = no cutoff (freshness "15+"). |
| `--exclude-file` | One already-sent URL per line (see `sent_urls.py`). |
| `--include-undated` | Keep postings with no date (BestJobs). Flagged `date_trusted: false`. |
| `--sources` | Subset of `remotive,arbeitnow,remoteok,himalayas,justjoin,landing,ejobs,bestjobs,ats`. |
| `--no-verify` | Skip the URL check. |
| `--check-watchlist` | Report dead/empty slugs in `watchlist.json`, then exit. |

Output: JSON array, newest first. Fields: `title, company, url, location, remote, region, posted, source,
note, date_trusted, verified, verify_note`. Per-source counts and drop reasons go to stderr.
A full run takes about 12 s over about 11,000 postings.

## Reading the output

- `verified: true`: URL loaded and showed no "closed/expired" text. `false` postings are already removed.
- `verified: null`: could not be checked (403 bot block, timeout). Confirm once with WebFetch before dropping.
- `date_trusted: false`: Himalayas `pubDate` is a refresh date, BestJobs has no date. Never use these to
  prove freshness; confirm the date on the page or skip.
- `note`: eligibility caveats (for example JustJoin.it "remote" usually means remote within Poland).

## Files

- `sent_urls.py`: saved Notion Sent Postings query result -> `--exclude-file`.
- `watchlist.json`: Greenhouse/Lever/Ashby board slugs. Add employers the candidates target.
- `ROUTINE_PROMPT_PATCH.md`: replacement text for steps B-D of the routine prompt.

## Known gaps

Indeed (403) and LinkedIn guest search (404) are unreachable from the sandbox. No city-level US board is
covered; keep WebSearch as fallback for on-site US roles. Executive roles are thin on all sources.
Landing.jobs only lists about 57 live jobs; its `offset` paging works, it is just a small board.
