#!/usr/bin/env python3
"""Job Scout fetcher: dated job postings from direct JSON/HTML sources, no web search.

Usage:
  python3 scout.py --roles '\b(senior qa|qa engineer|sdet)\b' --loc 'united states|europe|worldwide|anywhere' \
      --remote --max-age 4 --exclude-file /tmp/sent.txt

Prints {"jobs": [...], "sources": {...}} to stdout (jobs newest first). Progress and per-source stats go to stderr.
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


def fmt_range(lo, hi, cur, per=""):
    if not (lo or hi):
        return ""
    a, b = (int(lo) if lo else None), (int(hi) if hi else None)
    rng = "%s-%s" % (a, b) if a and b and a != b else str(a or b)
    return ("%s %s %s" % (rng, cur or "", ("/ " + per) if per else "")).replace("  ", " ").strip()


def jj_salary(p):
    for e in p.get("employmentTypes") or []:
        if e.get("from") or e.get("to"):
            return fmt_range(e.get("from"), e.get("to"), (e.get("currency") or "").upper(), e.get("unit") or "")
    return ""


def stale_page(items, args):
    """True when a newest-first page holds nothing inside the freshness window (stop paging)."""
    c = getattr(args, "cutoff", None)
    if not c or not items:
        return False
    return all((p["posted"] and parse_dt(p["posted"]) < c) for p in items)


def posting(source, title, company, url, location="", remote=False, posted=None, trusted=True,
            region="", note="", salary=""):
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
        "salary": salary,
        "date_trusted": bool(trusted and posted),
    }


# --------------------------------------------------------------------------- sources
def src_remotive(_a):
    out = []
    for p in get_json("https://remotive.com/api/remote-jobs")["jobs"]:
        out.append(posting("remotive", p["title"], p["company_name"], p["url"],
                           p.get("candidate_required_location", ""), True,
                           parse_dt(p.get("publication_date")), region=p.get("candidate_required_location", ""),
                           salary=p.get("salary") or ""))
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
                                reg, True, parse_dt(p.get("pubDate")), trusted=False, region=reg,
                                salary=fmt_range(p.get("minSalary"), p.get("maxSalary"), p.get("currency"), p.get("salaryPeriod"))))
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
                               salary=jj_salary(p), note="Polish board: remote usually means remote within Poland; confirm work authorization"))
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
                               p["url"], locs, p.get("remote"), parse_dt(p.get("published_at")),
                           salary=fmt_range(p.get("gross_salary_low"), p.get("gross_salary_high"), p.get("currency_code"), "year")))
        if len(jobs) < 50:
            break
    return out


def _roles_list(args):
    """Search words for the HTML boards (eJobs, BestJobs): --keywords only; none = skip those boards."""
    return [r.strip() for r in (args.keywords or "").split(",") if r.strip()]


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


def src_ats(a):
    path = getattr(a, "watchlist", None) or os.path.join(HERE, "watchlist.json")
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
def role_match(title, rx):
    return bool(rx.search(title))


def loc_match(p, rx):
    """--loc is a regex over location text. A remote posting with no stated region fits anywhere."""
    text = (p["location"] + " " + p["region"]).strip()
    if not rx:
        return True
    if p["remote"] and not text:
        return True
    return bool(rx.search(text))


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
            return False, "http %d" % e.code  # bot block, not proof of closure; routine confirms with WebFetch
        return False, "http %d" % e.code
    except Exception as e:
        return False, "unreachable: %s" % type(e).__name__
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
    ap.add_argument("--check-watchlist", action="store_true", help="report dead/empty watchlist slugs, then exit")
    ap.add_argument("--roles", default="", help="case-insensitive regex matched against the title")
    ap.add_argument("--exclude-title", default="", help="regex; titles matching it are dropped")
    ap.add_argument("--loc", default="", help="case-insensitive regex matched against location/region text")
    ap.add_argument("--remote", action="store_true", help="remote-only: drop on-site/hybrid postings")
    ap.add_argument("--max-age", type=float, default=4, help="days; 0 = no cutoff (routine uses 60 for '15+')")
    ap.add_argument("--keywords", default="", help="comma list of search words for eJobs/BestJobs (Romania scopes)")
    ap.add_argument("--exclude-file", help="file with one already-sent URL per line")
    ap.add_argument("--watchlist", help="path to watchlist.json (default: next to this script)")
    ap.add_argument("--include-undated", action="store_true", default=True,
                    help="keep postings with no date (flagged date_trusted=false, age_days=null)")
    ap.add_argument("--sources", default=",".join(SOURCES), help="comma list: " + ",".join(SOURCES))
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args()
    if args.check_watchlist:
        return check_watchlist()
    if not args.roles.strip():
        ap.error("--roles is required")
    try:
        rx_roles = re.compile(args.roles, re.I)
        rx_ex = re.compile(args.exclude_title, re.I) if args.exclude_title.strip() else None
        rx_loc = re.compile(args.loc, re.I) if args.loc.strip() else None
    except re.error as e:
        ap.error("bad regex: %s" % e)
    args.cutoff = NOW - dt.timedelta(days=args.max_age) if args.max_age > 0 else None
    excl = load_excludes(args.exclude_file)
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
                stats[n] = "ERROR %s" % type(e).__name__
    kept, drop = [], {}
    seen = set()
    cutoff = args.cutoff

    def dropped(why):
        drop[why] = drop.get(why, 0) + 1

    allp.sort(key=lambda p: p["posted"] or "", reverse=True)
    for p in allp:
        if not p["url"] or not role_match(p["title"], rx_roles) or (rx_ex and rx_ex.search(p["title"])):
            dropped("role")
            continue
        d = parse_dt(p["posted"])
        if cutoff and d and d < cutoff:
            dropped("age")
            continue
        if args.remote and not p["remote"]:
            dropped("onsite")
            continue
        if not loc_match(p, rx_loc):
            dropped("loc")
            continue
        key = norm_url(p["url"])
        if key in excl:
            dropped("sent")
            continue
        # Same role listed once per city (or re-posted) collapses to its newest copy.
        dkey = (p["company"].lower(), re.sub(r"\W+", " ", p["title"].lower()).strip())
        if key in seen or dkey in seen:
            dropped("dupe")
            continue
        seen.update((key, dkey))
        p["age_days"] = round((NOW - d).total_seconds() / 86400, 1) if d else None
        kept.append(p)
    kept = kept[: args.limit]

    for p in kept:
        p["verified"], p["verify_note"] = (None, "skipped") if args.no_verify else (None, "")
    if not args.no_verify:
        with cf.ThreadPoolExecutor(8) as ex:
            for p, (ok, note) in zip(kept, ex.map(verify, kept)):
                p["verified"], p["verify_note"] = ok, note
        # Clearly dead pages are removed here; a 403 stays so the routine can confirm it by WebFetch.
        kept = [p for p in kept if p["verified"] or p["verify_note"].startswith("http 403")]

    print("scanned %d postings; dropped %s; sources %s" % (len(allp), drop, stats), file=sys.stderr)
    json.dump({"jobs": kept, "sources": stats}, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
