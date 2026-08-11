# Vendored fonts

Ten WOFF2 files, ~296 KB on disk but far less on any given page: `unicode-range`
means an ASCII screen fetches only the `latin` subsets, and no page uses all three
families. Nothing here is loaded from a CDN.

## What each surface asks for

| Surface | Families | Why |
|---|---|---|
| `../../login.html` | Schibsted Grotesk | No data role on the page, so it does not pay for the mono. |
| `../../experience-mockup.html` | Schibsted Grotesk, IBM Plex Mono | The mock shows job cards, which carry salary, dates and source. |
| `../index-uR5-NbPW.css` (dashboard) | Work Sans, Gelasio | Not yet migrated — see "Still on the old pairing" below. |

Schibsted Grotesk states things; IBM Plex Mono measures them. Salary, posting date,
source and link status are values a machine reported, so they are set in the mono
with tabular figures, which stops digits shifting width from one card to the next.
Workplace type stays in the UI face: `Remote` is a category, not a measurement.

The email preview inside the mockup deliberately renders in the **system stack**,
because `../../email-template.html` sends `-apple-system, BlinkMacSystemFont, …`
and Georgia. A mail client cannot be relied on to load a webfont, and the mock
should not imply otherwise.

## The files

| File | Bytes | Faces it serves |
|---|---|---|
| `schibsted-grotesk-latin.woff2` | 46,752 | Schibsted Grotesk 400–700 — latin |
| `schibsted-grotesk-latin-ext.woff2` | 20,924 | Schibsted Grotesk 400–700 — latin-ext |
| `ibm-plex-mono-400-latin.woff2` | 14,708 | IBM Plex Mono 400 — latin |
| `ibm-plex-mono-400-latin-ext.woff2` | 13,348 | IBM Plex Mono 400 — latin-ext |
| `ibm-plex-mono-500-latin.woff2` | 14,888 | IBM Plex Mono 500 — latin |
| `ibm-plex-mono-500-latin-ext.woff2` | 13,432 | IBM Plex Mono 500 — latin-ext |
| `work-sans-latin.woff2` | 50,316 | Work Sans 400, 500, 600 — latin |
| `work-sans-latin-ext.woff2` | 35,716 | Work Sans 400, 500, 600 — latin-ext |
| `gelasio-latin.woff2` | 34,832 | Gelasio 500, 600 — latin |
| `gelasio-latin-ext.woff2` | 40,592 | Gelasio 500, 600 — latin-ext |

Schibsted Grotesk, Work Sans and Gelasio are **variable** fonts: Google serves one
file per subset and picks the weight off the `wght` axis. Schibsted Grotesk takes
that literally — one `@font-face` per subset declaring `font-weight: 400 700`, so
two blocks cover every weight. Work Sans and Gelasio are still written one block
per weight, mirroring the CSS Google emits. IBM Plex Mono is not variable, hence a
file per weight.

The `unicode-range` on every block is Google's, unmodified. It is what keeps the
cost honest: a page of ASCII fetches only the latin subset, and latin-ext arrives
only when something on screen needs it — an accented name in a job title, usually.

## Still on the old pairing

The dashboard bundle CSS has not been migrated to Schibsted Grotesk. Raising its
body text to 16px reflows dense job cards, and that reflow was left for review
before touching shipped UI. Until then `../index-uR5-NbPW.css` keeps Work Sans and
Gelasio, and all four of those files must stay.

## Refreshing them

Ask for **weights only**. An `opsz` axis request is what broke this before: neither
Work Sans nor Gelasio publishes one, and the API answers with HTTP 400 and no CSS
rather than ignoring the axis.

```sh
UA='Mozilla/5.0 (X11; Linux x86_64) Chrome/120'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&display=swap'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Gelasio:wght@500;600&display=swap'
curl -A "$UA" 'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600&display=swap'
```

A browser User-Agent matters — Google varies the response format by client, and
only a modern UA yields WOFF2. Take the `latin` and `latin-ext` blocks, save the
files they point at, and copy the `unicode-range` values across unchanged.

Then run `npx playwright test e2e/fonts.spec.mjs`. It fails on a file that 404s, on
a face that is declared but never renders, and on a family a page asks for without
declaring. That last check reads computed style rather than measuring rendered
text, because a measurement cannot tell a fetched font from one the developer
happens to have installed locally — which is exactly how a missing Gelasio
declaration once shipped every dashboard heading in the Georgia fallback.
