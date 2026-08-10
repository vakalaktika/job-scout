# Font Files (Self-Hosted)

This directory contains WOFF2 font files for direct loading (P1 optimize).

## What Goes Here

Download the following font files from Google Fonts and place them in this directory:

### Gelasio (Serif, 2 weights)
- `gelasio-500.woff2` — Gelasio Regular (weight 500)
- `gelasio-600.woff2` — Gelasio SemiBold (weight 600)

### Work Sans (Sans-serif, 3 weights)
- `work-sans-400.woff2` — Work Sans Regular (weight 400)
- `work-sans-500.woff2` — Work Sans Medium (weight 500)
- `work-sans-600.woff2` — Work Sans SemiBold (weight 600)

## How to Download

### Option 1: Google Fonts Download (Recommended)

1. Visit [Google Fonts: Gelasio](https://fonts.google.com/specimen/Gelasio)
2. Select weights 500 and 600
3. Click the download button
4. Extract the WOFF2 files and place them here

Repeat for [Work Sans](https://fonts.google.com/specimen/Work+Sans) with weights 400, 500, 600.

### Option 2: Using Google Fonts API

Fetch the font files directly from the Google Fonts CDN:

```bash
# Gelasio
curl -o gelasio-500.woff2 "https://fonts.gstatic.com/s/gelasio/v15/[hash]-500.woff2"
curl -o gelasio-600.woff2 "https://fonts.gstatic.com/s/gelasio/v15/[hash]-600.woff2"

# Work Sans
curl -o work-sans-400.woff2 "https://fonts.gstatic.com/s/worksans/v8/[hash]-400.woff2"
curl -o work-sans-500.woff2 "https://fonts.gstatic.com/s/worksans/v8/[hash]-500.woff2"
curl -o work-sans-600.woff2 "https://fonts.gstatic.com/s/worksans/v8/[hash]-600.woff2"
```

(Note: Replace `[hash]` with the actual file hash from the Google Fonts CDN.)

### Option 3: Font Download Tool

```bash
npm install -g google-font-downloader

google-font-downloader \
  --fonts "Gelasio:500,600" \
  --fonts "Work Sans:400,500,600" \
  --output .
```

## Testing

After placing the fonts:

1. Start a local dev server: `python3 -m http.server 8000`
2. Open `http://localhost:8000/index.html`
3. Open DevTools (F12 → Network tab)
4. Verify that font files load from `assets/fonts/` (NOT from Google Fonts CDN)
5. Check that no external requests go to `fonts.googleapis.com`

## License

Both Gelasio and Work Sans are available under the Open Font License (OFL), allowing free use and distribution. See individual font pages on Google Fonts for full license text.

## P1 Optimize Status

- CSS updated: `index-uR5-NbPW.css` now uses `@font-face` declarations
- Fallback fonts configured: Gelasio → Georgia, Work Sans → Arial
- Font display strategy: `font-display:swap` (show system fonts immediately, swap to web fonts when ready)

Once fonts are populated, this change **eliminates the external Google Fonts CDN request**, saving 50–100 ms on first page load.

---

**Action Required:** Download the 5 WOFF2 files listed above and place them in this directory to complete P1 optimize Phase 1.
