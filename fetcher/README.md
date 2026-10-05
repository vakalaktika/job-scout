# job-scout-fetcher

Replaces WebSearch in the Job Scout routine with direct, dated sources. Python 3.8+, standard library only.

## Run

```
python3 scout.py --roles '\b(senior qa|qa engineer|sdet)\b' --exclude-title 'intern|junior' \
    --loc 'united states|europe|emea|worldwide|anywhere' --remote --max-age 4 \
    --exclude-file /tmp/sent.txt --watchlist watchlist.json --limit 40 > /tmp/shortlist.json
```

| Flag | Meaning |
|---|---|
| `--roles` | Case-insensitive regex matched against the title. Required. |
| `--exclude-title` | Regex; matching titles are dropped. |
| `--loc` | Case-insensitive regex matched against location/region text. A remote posting with no stated region always passes. |
| `--remote` | Remote-only: drop on-site/hybrid postings. |
| `--max-age` | Days. Default 4. `0` = no cutoff. The routine uses 60 for "15+". Undated postings are kept (`age_days: null`). |
| `--keywords` | Comma list of search words for eJobs and BestJobs. Without it those two boards are skipped. |
| `--exclude-file` | One already-sent URL per line (see `sent_urls.py`). |
| `--watchlist` | Path to `watchlist.json` (default: next to the script). |
| `--sources` | Subset of `remotive,arbeitnow,remoteok,himalayas,justjoin,landing,ejobs,bestjobs,ats`. |
| `--limit`, `--no-verify` | Cap the shortlist; skip the URL check. |
| `--check-watchlist` | Report dead/empty slugs in `watchlist.json`, then exit. |

Output: `{"jobs": [...], "sources": {...}}`, jobs newest first. Job fields: `title, company, url, location,
remote, region, posted, age_days, source, salary, note, date_trusted, verified, verify_note`.
`sources` maps each source to its posting count or `ERROR ...`. Drop reasons go to stderr.
A full run takes about 12 s over about 25,000 postings.

## Reading the output

- `verified: true`: URL loaded and showed no "closed/expired" text.
- `verified: false`, `verify_note: "http 403"`: bot block, not proof of closure. Confirm once with WebFetch.
  Other dead pages (404, closure text, unreachable) are removed before output.
- `date_trusted: false`: Himalayas `pubDate` is a refresh date, BestJobs has no date. Confirm the real
  date on the page before relying on it.
- `note`: eligibility caveats (for example JustJoin.it "remote" usually means remote within Poland).

## Files

- `sent_urls.py`: saved Notion Sent Postings query result -> `--exclude-file`.
- `watchlist.json`: Greenhouse/Lever/Ashby board slugs. Add employers the candidates target.

## Known gaps

Indeed (403) and LinkedIn guest search (404) are unreachable from the sandbox. No city-level US board is
covered; keep WebSearch as fallback for on-site US roles. Executive roles are thin on all sources.
Landing.jobs only lists about 57 live jobs; its `offset` paging works, it is just a small board.
