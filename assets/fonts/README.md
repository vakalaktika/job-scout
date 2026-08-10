# Vendored fonts

Four WOFF2 files, ~172 KB total, serving both families the product uses. Both families are
declared in both places — `../index-uR5-NbPW.css` and inline in `../../login.html` — because
both pages set both: Work Sans for body text, Gelasio for headings. See "Fonts are served
from this origin" in the root `README.md` for why they are vendored rather than loaded from
Google.

| File | Bytes | Faces it serves |
|---|---|---|
| `work-sans-latin.woff2` | 50,316 | Work Sans 400, 500, 600 — latin |
| `work-sans-latin-ext.woff2` | 35,716 | Work Sans 400, 500, 600 — latin-ext |
| `gelasio-latin.woff2` | 34,832 | Gelasio 500, 600 — latin |
| `gelasio-latin-ext.woff2` | 40,592 | Gelasio 500, 600 — latin-ext |

Each file is a **variable** font: Google serves one file per subset and selects the weight
off the `wght` axis, which is why three weights share a file. The `@font-face` blocks are
still written one per weight, mirroring the CSS Google itself emits, so weight selection
behaves exactly as it did when the CDN served it.

The `unicode-range` on every block is Google's, unmodified. It is what keeps the cost
honest: a page of ASCII fetches only the latin subset, and latin-ext arrives only when
something on screen actually needs it — an accented name in a job title, usually.

## Refreshing them

Ask for **weights only**. An `opsz` axis request is what broke this before: neither family
publishes one, and the API answers with HTTP 400 and no CSS rather than ignoring the axis.

```sh
curl -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' \
  'https://fonts.googleapis.com/css2?family=Gelasio:wght@500;600&display=swap'
curl -A 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120' \
  'https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600&display=swap'
```

A browser User-Agent matters — Google varies the response format by client, and only a
modern UA yields WOFF2. Take the `latin` and `latin-ext` blocks, save the files they point
at, and copy the `unicode-range` values across unchanged.

Then run `npx playwright test e2e/fonts.spec.mjs`. It fails on a file that 404s, on a face
that is declared but never renders, and on a family a stylesheet sets without declaring —
that last one being invisible on a machine with the font installed locally, since the family
name matches with nothing fetched.
