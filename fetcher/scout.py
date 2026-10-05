#!/usr/bin/env python3
"""Job Scout fetcher: dated job postings from direct JSON/HTML sources, no web search.

Usage:
  python3 scout.py --roles "senior qa,qa engineer" --loc "US,EU,Remote" --remote \
      --max-age 4 --exclude-file /tmp/sent.txt

Prints a JSON array to stdout (newest first). Progress and per-source stats go to stderr.
Python 3.8+, standard library only.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
HERE = os.path.dirname(os.path.abspath(__file__))
NOW = dt.datetime.now(dt.timezone.utc)

EU = {
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "czechia", "denmark",
    "estonia", "finland", "france", "germany", "greece", "hungary", "ireland", "italy", "latvia",
    "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal", "romania", "slovakia",
    "slovenia", "spain", "sweden", "united kingdom", "uk", "norway", "switzerland", "serbia",
    "ukraine", "europe", "emea", "european union", "eu",
}
US_STATES = (
    "alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho "
    "illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota "
    "mississippi missouri montana nebraska nevada new hampshire jersey mexico york north carolina dakota "
    "ohio oklahoma oregon pennsylvania rhode island south tennessee texas utah vermont virginia washington "
    "wisconsin wyoming"
).split()
WORLDWIDE = ("worldwide", "anywhere", "global", "world wide", "any location", "everywhere")


def get(url, timeout=25, headers=None, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if binary else data.decode("utf-8", "replace")


def get_json(url, **kw):
    return json.loads(get(url, **kw))


def parse_dt(v):
    """-> aware datetime (UTC) or None. Accepts epoch s/ms, ISO strings."""
    if v in (None, "", 0):
        return None
    try:
        if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
            n = float(v)
            if n > 1e11:
                n /= 1000.0
            return dt.datetime.fromtimestamp(n, dt.timezone.utc)
        s = str(v).strip().replace("Z", "+00:00")
        s = re.sub(r"(\.\d{6})\d+", r"\1", s)  # trim >6 fractional digits
        d = dt.datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def stale_page(items, args):
    """True when a newest-first page holds nothing inside the freshness window (stop paging)."""
    c = getattr(args, "cutoff", None)
    if not c or not items:
        return False
    return all((p["posted"] and parse_dt(p["posted"]) < c) for p in items)


def posting(source, title, company, url, location="", remote=False, posted=None, trusted=True,
            region="", note=""):
    return {
        "title": html.unescape(str(title or "")).strip(),
        "company": html.unescape(str(company or "")).strip(),
        "url": url,
        "location": html.unescape(str(location or "")).strip(),
        "remote": bool(remote),
        "region": html.unescape(str(region or "")).strip(),  # remote-region restriction text
        "posted": posted.isoformat() if posted else None,
        "source": source,
        "note": note,
        "date_trusted": bool(trusted and posted),
    }


# --------------------------------------------------------------------------- sources
def src_remotive(_a):
    out = []
    for p in get_json("https://remotive.com/api/remote-jobs")["jobs"]:
        out.append(posting("remotive", p["title"], p["company_name"], p["url"],
                           p.get("candidate_required_location", ""), True,
                           parse_dt(p.get("publication_date")), region=p.get("candidate_required_location", "")))
    return out


def src_arbeitnow(_a):
    out = []
    for page in range(1, 6):
        try:
            d = get_json("https://www.arbeitnow.com/api/job-board-api?page=%d" % page)
        except Exception:
            break
        for p in d.get("data", []):
            out.append(posting("arbeitnow", p["title"], p["company_name"], p["url"], p.get("location", ""),
                               p.get("remote"), parse_dt(p.get("created_at"))))
        if not d.get("links", {}).get("next"):
            break
    return out


def src_remoteok(_a):
    out = []
    for p in get_json("https://remoteok.com/api"):
        if not isinstance(p, dict) or "position" not in p:
            continue
        out.append(posting("remoteok", p["position"], p.get("company"), p.get("url") or p.get("apply_url"),
                           p.get("location", ""), True, parse_dt(p.get("date") or p.get("epoch")),
                           region=p.get("location", "")))
    return out


def src_himalayas(a):
    out = []
    for off in range(0, 400, 20):
        try:
            d = get_json("https://himalayas.app/jobs/api?limit=20&offset=%d" % off)
        except Exception:
            break
        jobs = d.get("jobs", [])
        page = []
        for p in jobs:
            reg = ", ".join(p.get("locationRestrictions") or [])
            page.append(posting("himalayas", p["title"], p.get("companyName"), p.get("applicationLink") or p.get("guid"),
                                reg, True, parse_dt(p.get("pubDate")), trusted=False, region=reg))
        out.extend(page)
        if len(jobs) < 20 or stale_page(page, a):
            break
    return out


def src_justjoin(a):
    """Offers are newest-first and the API caps at 10,000; pull 1,000-row pages in parallel."""
    def page(frm):
        try:
            d = get_json("https://justjoin.it/api/candidate-api/offers?from=%d&itemsCount=1000" % frm, timeout=40)
        except Exception:
            return []
        out = []
        for p in d.get("data", []):
            loc = ", ".join(sorted({l.get("city", "") for l in p.get("locations", []) if l.get("city")}) or [p.get("city", "")])
            out.append(posting("justjoin.it", p["title"], p.get("companyName"),
                               "https://justjoin.it/job-offer/" + p["slug"],
                               loc + ", Poland", p.get("workplaceType") == "remote",
                               parse_dt(p.get("publishedAt")),
                               note="Polish board: remote usually means remote within Poland; confirm work authorization"))
        return out

    with cf.ThreadPoolExecutor(5) as ex:
        return [p for pg in ex.map(page, range(0, 10000, 1000)) for p in pg]


def src_landing(_a):
    out = []
    for off in range(0, 2000, 50):
        try:
            jobs = get_json("https://landing.jobs/api/v1/jobs?limit=50&offset=%d" % off)
        except Exception:
            break
        for p in jobs:
            locs = ", ".join("%s %s" % (l.get("city", ""), l.get("country_code", "")) for l in p.get("locations") or [])
            out.append(posting("landing.jobs", p["title"], (p["url"].split("/at/")[1].split("/")[0] if "/at/" in p["url"] else ""),
                               p["url"], locs, p.get("remote"), parse_dt(p.get("published_at"))))
        if len(jobs) < 50:
            break
    return out


def _roles_list(args):
    return [r.strip() for r in args.roles.split(",") if r.strip()]


def src_ejobs(args):
    out, seen = [], set()
    for role in _roles_list(args):
        slug = re.sub(r"[^a-z0-9]+", "-", role.lower()).strip("-")
        try:
            page = get("https://www.ejobs.ro/locuri-de-munca/" + slug)
        except Exception:
            continue
        for path, title in re.findall(r'href="(/user/locuri-de-munca/[^"]+/\d+)"[^>]*?(?:aria-label|title)="([^"]+)"', page):
            if path in seen:
                continue
            seen.add(path)
            out.append(("https://www.ejobs.ro" + path, title))
        for path in re.findall(r'href="(/user/locuri-de-munca/[^"]+/\d+)"', page):
            if path not in seen:
                seen.add(path)
                out.append(("https://www.ejobs.ro" + path, path.split("/")[-2].replace("-", " ")))

    def detail(item):
        url, guess = item
        try:
            h = get(url)
        except Exception:
            return None
        for s in re.findall(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S):
            try:
                d = json.loads(s)
            except Exception:
                continue
            for n in (d.get("@graph", [d]) if isinstance(d, dict) else d):
                if isinstance(n, dict) and n.get("@type") == "JobPosting":
                    org = n.get("hiringOrganization") or {}
                    locs = n.get("jobLocation") or []
                    locs = locs if isinstance(locs, list) else [locs]
                    loc = ", ".join((l.get("address") or {}).get("addressLocality", "") for l in locs if isinstance(l, dict))
                    return posting("ejobs.ro", n.get("title") or guess, org.get("name", ""), url,
                                   (loc or "Romania") + ", Romania", n.get("jobLocationType") == "TELECOMMUTE",
                                   parse_dt(n.get("datePosted")))
        return None

    with cf.ThreadPoolExecutor(8) as ex:
        return [p for p in ex.map(detail, out) if p]


def src_bestjobs(args):
    out, seen = [], set()
    for role in _roles_list(args):
        try:
            page = get("https://www.bestjobs.eu/en/jobs?keyword=" + urllib.parse.quote(role))
        except Exception:
            continue
        for path, title, company in re.findall(
                r'href="(/en/job/[^"]+)"[^>]*aria-label="([^"]+)".*?text-ink-medium">([^<]*)<', page, re.S):
            if path in seen:
                continue
            seen.add(path)
            out.append(posting("bestjobs.eu", title, company, "https://www.bestjobs.eu" + path, "Romania",
                               False, None, trusted=False))
    return out


def src_ats(_a):
    path = os.path.join(HERE, "watchlist.json")
    try:
        wl = json.load(open(path))
    except Exception:
        return []
    jobs = []

    def gh(slug):
        d = get_json("https://boards-api.greenhouse.io/v1/boards/%s/jobs" % slug)
        return [posting("greenhouse:" + slug, j["title"], j.get("company_name") or slug, j["absolute_url"],
                        (j.get("location") or {}).get("name", ""), "remote" in ((j.get("location") or {}).get("name", "")).lower(),
                        parse_dt(j.get("first_published") or j.get("updated_at")), trusted=bool(j.get("first_published")))
                for j in d.get("jobs", [])]

    def lv(slug):
        d = get_json("https://api.lever.co/v0/postings/%s?mode=json" % slug)
        return [posting("lever:" + slug, j["text"], slug, j["hostedUrl"], (j.get("categories") or {}).get("location", ""),
                        j.get("workplaceType") == "remote", parse_dt(j.get("createdAt"))) for j in d]

    def ab(slug):
        d = get_json("https://api.ashbyhq.com/posting-api/job-board/%s" % slug)
        return [posting("ashby:" + slug, j["title"], slug, j["jobUrl"], j.get("location", ""),
                        bool(j.get("isRemote")) or j.get("workplaceType") == "Remote",
                        parse_dt(j.get("publishedAt"))) for j in d.get("jobs", []) if j.get("isListed", True)]

    tasks = [(gh, s) for s in wl.get("greenhouse", [])] + [(lv, s) for s in wl.get("lever", [])] + \
            [(ab, s) for s in wl.get("ashby", [])]

    def run(t):
        try:
            return t[0](t[1])
        except Exception:
            return []

    with cf.ThreadPoolExecutor(12) as ex:
        for r in ex.map(run, tasks):
            jobs.extend(r)
    return jobs


SOURCES = {
    "remotive": src_remotive, "arbeitnow": src_arbeitnow, "remoteok": src_remoteok, "himalayas": src_himalayas,
    "justjoin": src_justjoin, "landing": src_landing, "ejobs": src_ejobs, "bestjobs": src_bestjobs, "ats": src_ats,
}


# --------------------------------------------------------------------------- filters
def tokens(s):
    return re.findall(r"[a-z0-9+#.]+", s.lower())


def role_match(title, roles):
    tt = set(tokens(title))
    tstr = " ".join(tokens(title))
    for r in roles:
        rt = tokens(r)
        if rt and all(t in tt or t in tstr for t in rt):
            return True
    return False


def loc_terms(loc):
    return [t.strip().lower() for t in re.split(r"[,/;|]", loc or "") if t.strip()]


def geo_hit(t, text):
    if t in ("us", "usa", "united states", "america", "north america"):
        return bool(re.search(r"\b(us|usa|united states|north america|americas)\b", text) or
                    re.search(r"\b(%s)\b" % "|".join(US_STATES), text))
    if t in ("eu", "europe", "emea", "european union"):
        return any(re.search(r"\b%s\b" % re.escape(c), text) for c in EU)
    return bool(re.search(r"\b%s\b" % re.escape(t), text))


def loc_match(p, terms, remote_ok):
    """Remote postings must still fit the candidate's geography when the board states a region."""
    text = (p["location"] + " " + p["region"]).lower()
    geo = [t for t in terms if t != "remote"]
    wants_remote = "remote" in terms or remote_ok
    if p["remote"]:
        if not wants_remote:
            return any(geo_hit(t, text) for t in geo) if geo else False
        wide = (not text.strip()) or any(w in text for w in WORLDWIDE)
        return wide or not geo or any(geo_hit(t, text) for t in geo)
    if not terms:
        return True
    return any(geo_hit(t, text) for t in geo)


def load_excludes(path):
    if not path or not os.path.exists(path):
        return set()
    return {norm_url(l.strip()) for l in open(path) if l.strip()}


def norm_url(u):
    try:
        p = urllib.parse.urlsplit(u.strip())
        return (p.netloc.lower().removeprefix("www.") + p.path.rstrip("/")).lower()
    except Exception:
        return u.strip().lower()


# --------------------------------------------------------------------------- verify
DEAD = (
    "nu are o recrutare activa", "no longer accepting applications", "no longer available", "job is no longer",
    "position has been filled", "this job has expired", "job has expired", "posting has expired",
    "this position is no longer", "no longer open", "has been closed",
    "anunțul a expirat", "anuntul a expirat", "this job is closed", "no longer active",
)


def verify(p):
    try:
        body = get(p["url"], timeout=20, headers={"Accept": "text/html,application/json"})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429):
            return None, "http %d (bot block; confirm once with WebFetch)" % e.code
        return False, "http %d" % e.code
    except Exception as e:
        return None, "unreachable: %s" % type(e).__name__
    # Marker text must come from visible HTML; SPA bundles carry the same phrases inside <script>.
    low = re.sub(r"<(script|style)\b.*?</\1>", " ", body, flags=re.S | re.I).lower()
    for m in DEAD:
        if m in low:
            return False, "dead marker: " + m
    return True, "ok"


def check_watchlist():
    wl = json.load(open(os.path.join(HERE, "watchlist.json")))
    urls = {"greenhouse": "https://boards-api.greenhouse.io/v1/boards/%s/jobs",
            "lever": "https://api.lever.co/v0/postings/%s?mode=json",
            "ashby": "https://api.ashbyhq.com/posting-api/job-board/%s"}

    def n_jobs(item):
        kind, slug = item
        try:
            d = get_json(urls[kind] % slug)
            return kind, slug, len(d if isinstance(d, list) else d.get("jobs", []))
        except Exception:
            return kind, slug, -1

    items = [(k, s) for k in urls for s in wl.get(k, [])]
    with cf.ThreadPoolExecutor(12) as ex:
        res = list(ex.map(n_jobs, items))
    for kind, slug, n in res:
        if n <= 0:
            print("DEAD/EMPTY %s:%s (%d)" % (kind, slug, n))
    print("%d/%d slugs return jobs; %d open roles total" % (
        sum(1 for r in res if r[2] > 0), len(res), sum(r[2] for r in res if r[2] > 0)))


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-watchlist", action="store_true", help="report which watchlist.json slugs return jobs, then exit")
    ap.add_argument("--roles", required=False, default="", help="comma-separated role phrases; every word must appear in the title")
    ap.add_argument("--loc", default="", help="comma-separated locations; EU, US and Remote are understood")
    ap.add_argument("--remote", action="store_true", help="candidate wants remote only: drop on-site/hybrid postings")
    ap.add_argument("--max-age", type=float, default=4, help="days; 0 = no cutoff (candidate freshness '15+')")
    ap.add_argument("--exclude-file", help="file with one already-sent URL per line")
    ap.add_argument("--include-undated", action="store_true", help="keep postings with no date (flagged date_trusted=false)")
    ap.add_argument("--sources", default=",".join(SOURCES), help="comma list: " + ",".join(SOURCES))
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--no-verify", action="store_true")
    ap.add_argument("--stats", action="store_true", help="print per-source counts to stderr")
    args = ap.parse_args()
    if args.check_watchlist:
        return check_watchlist()
    if not args.roles.strip():
        ap.error("--roles is required")

    args.cutoff = NOW - dt.timedelta(days=args.max_age) if args.max_age > 0 else None
    roles, terms, excl = _roles_list(args), loc_terms(args.loc), load_excludes(args.exclude_file)
    names = [s for s in args.sources.split(",") if s in SOURCES]

    allp, stats = [], {}
    with cf.ThreadPoolExecutor(len(names)) as ex:
        futs = {ex.submit(SOURCES[n], args): n for n in names}
        for f in cf.as_completed(futs):
            n = futs[f]
            try:
                r = f.result()
                stats[n] = len(r)
                allp.extend(r)
            except Exception as e:
                stats[n] = "ERR %s" % type(e).__name__
    kept, drop = [], {"role": 0, "age": 0, "loc": 0, "sent": 0, "dupe": 0}
    seen = set()
    cutoff = args.cutoff
    allp.sort(key=lambda p: p["posted"] or "", reverse=True)
    for p in allp:
        if not p["url"] or not role_match(p["title"], roles):
            drop["role"] += 1
            continue
        d = parse_dt(p["posted"])
        if cutoff and ((d and d < cutoff) or (not d and not args.include_undated)):
            drop["age"] += 1
            continue
        if args.remote and not p["remote"]:
            drop["onsite"] = drop.get("onsite", 0) + 1
            continue
        if not loc_match(p, terms, args.remote):
            drop["loc"] += 1
            continue
        key = norm_url(p["url"])
        if key in excl:
            drop["sent"] += 1
            continue
        # Same role listed once per city (or re-posted) collapses to its newest copy.
        dkey = (p["company"].lower(), " ".join(tokens(p["title"])))
        if key in seen or dkey in seen:
            drop["dupe"] += 1
            continue
        seen.update((key, dkey))
        kept.append(p)
    kept = kept[: args.limit]

    for p in kept:
        p["verified"], p["verify_note"] = (None, "skipped") if args.no_verify else (None, "")
    if not args.no_verify:
        with cf.ThreadPoolExecutor(8) as ex:
            for p, (ok, note) in zip(kept, ex.map(verify, kept)):
                p["verified"], p["verify_note"] = ok, note
        kept = [p for p in kept if p["verified"] is not False]

    print("scanned %d postings; dropped %s; sources %s" % (len(allp), drop, stats), file=sys.stderr)
    json.dump(kept, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
