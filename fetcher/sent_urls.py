#!/usr/bin/env python3
"""Turn a saved Notion Sent Postings query result into scout.py's --exclude-file.

  python3 sent_urls.py saved_result.json > /tmp/sent.txt

Reads any JSON (or text) dump and collects the values of the URL columns
("Apply URL", "userDefined:URL", "URL") wherever they appear. Only URLs are
written; candidate emails and other columns are ignored and never printed.
"""
import json
import re
import sys

KEYS = {"apply url", "userdefined:url", "url", "job url"}
URL = re.compile(r"https?://[^\s\"'<>\\)]+")


def walk(o, out):
    if isinstance(o, dict):
        for k, v in o.items():
            if isinstance(v, str) and k.lower() in KEYS:
                out.update(URL.findall(v))
            else:
                walk(v, out)
    elif isinstance(o, list):
        for v in o:
            walk(v, out)
    elif isinstance(o, str) and o[:1] in "[{":
        try:  # tool results are sometimes a JSON string wrapped in JSON
            walk(json.loads(o), out)
        except ValueError:
            pass


def main():
    raw = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    urls = set()
    try:
        walk(json.loads(raw), urls)
    except ValueError:
        # Not JSON: fall back to "Apply URL": "..." style fragments.
        for m in re.finditer(r'(?i)"(?:apply url|userDefined:URL|url)"\s*:\s*"([^"]+)"', raw):
            urls.update(URL.findall(m.group(1)))
    for u in sorted(urls):
        print(u.rstrip(".,;"))


if __name__ == "__main__":
    main()
