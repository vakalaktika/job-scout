# Direct Font Loading Setup Guide

This guide documents how to replace Google Fonts with self-hosted WOFF2 files for P1 optimize.

## Why Direct Font Loading?

- **Eliminates external network request** to Google Fonts CDN
- **Reduces latency** (~50–100 ms saved on first paint)
- **Offline-friendly** — fonts are served from the same origin as the app
- **Reproducibility** — exact font versions pinned to the repository

## Current State

The CSS file (`assets/index-uR5-NbPW.css`) uses Google Fonts via `@import`:

```css
@import"https://fonts.googleapis.com/css2?family=Gelasio:opsz,wght@12..144,500;12..144,600&family=Work+Sans:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";
```

## Target State

Move fonts to `assets/fonts/` and reference via `@font-face`:

```css
@font-face {
  font-family: 'Gelasio';
  src: url('./fonts/gelasio-500.woff2') format('woff2'),
       url('./fonts/gelasio-500.woff') format('woff');
  font-weight: 500;
  font-optical-sizing: auto;
  font-display: swap;
}

@font-face {
  font-family: 'Work Sans';
  src: url('./fonts/work-sans-400.woff2') format('woff2'),
       url('./fonts/work-sans-400.woff') format('woff');
  font-weight: 400;
  font-optical-sizing: auto;
  font-display: swap;
}

/* ... (repeat for weights 500, 600 for Work Sans) ... */
```

## Step-by-Step Implementation

### Step 1: Obtain Font Files

#### Option A: Download from Google Fonts (Recommended)

Google Fonts allows free download of fonts for use. Visit the Google Fonts API directly:

**Gelasio (serif, weights 500 & 600):**
1. Visit: https://fonts.google.com/metadata/fonts/gelasio
2. Look for download links or use Google Fonts API:
   ```
   https://fonts.googleapis.com/css2?family=Gelasio:opsz,wght@12..144,500&display=swap
   ```
3. Open Network DevTools (F12 → Network) and filter `.woff2` files
4. Right-click downloaded font file → Save as

**Work Sans (sans-serif, weights 400, 500, & 600):**
1. Visit: https://fonts.google.com/metadata/fonts/work-sans
2. Download WOFF2 variants for weights 400, 500, 600

#### Option B: Use Font Download Utility

Use a tool to batch-download fonts from Google Fonts:

```bash
# Example with google-font-downloader or similar
npm install -g google-font-downloader

# Download Gelasio and Work Sans
google-font-downloader \
  --fonts "Gelasio:500,600" \
  --fonts "Work Sans:400,500,600" \
  --output assets/fonts/
```

### Step 2: Create Assets/Fonts Directory

```bash
mkdir -p assets/fonts
```

Place downloaded WOFF2 files:
```
assets/fonts/
├── gelasio-500.woff2
├── gelasio-600.woff2
├── work-sans-400.woff2
├── work-sans-500.woff2
└── work-sans-600.woff2
```

(WOFF fallback files are optional but recommended for older browsers.)

### Step 3: Update CSS

Replace the `@import` statement in `assets/index-uR5-NbPW.css`:

**Remove:**
```css
@import"https://fonts.googleapis.com/css2?family=Gelasio:opsz,wght@12..144,500;12..144,600&family=Work+Sans:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";
```

**Add** (at the top of the CSS file, before `:root`):
```css
/* Gelasio — Serif display font */
@font-face {
  font-family: 'Gelasio';
  src: url('./fonts/gelasio-500.woff2') format('woff2');
  font-weight: 500;
  font-optical-sizing: auto;
  font-display: swap;
}

@font-face {
  font-family: 'Gelasio';
  src: url('./fonts/gelasio-600.woff2') format('woff2');
  font-weight: 600;
  font-optical-sizing: auto;
  font-display: swap;
}

/* Work Sans — Sans-serif body font */
@font-face {
  font-family: 'Work Sans';
  src: url('./fonts/work-sans-400.woff2') format('woff2');
  font-weight: 400;
  font-optical-sizing: auto;
  font-display: swap;
}

@font-face {
  font-family: 'Work Sans';
  src: url('./fonts/work-sans-500.woff2') format('woff2');
  font-weight: 500;
  font-optical-sizing: auto;
  font-display: swap;
}

@font-face {
  font-family: 'Work Sans';
  src: url('./fonts/work-sans-600.woff2') format('woff2');
  font-weight: 600;
  font-optical-sizing: auto;
  font-display: swap;
}
```

**Note:** The CSS already includes fallback fonts (`"Gelasio",Georgia,serif` and `Work Sans,Arial,sans-serif`), so if fonts fail to load, the design gracefully degrades.

### Step 4: Verify in Browser

1. Start a local server:
   ```bash
   python3 -m http.server 8000
   ```

2. Open browser DevTools (F12 → Network tab)
3. Load `index.html`
4. Verify that font files are loaded from `assets/fonts/` (not from Google Fonts CDN)
5. Check that no external requests are made to `fonts.googleapis.com`

## Performance Impact

### Before (Google Fonts):
- Initial HTML load: 1.4 KB
- CSS load (with @import): 72 KB
- Google Fonts external request: ~50 KB (plus DNS/TLS overhead)
- **Total time to fonts rendered:** ~300–500 ms (depending on network)

### After (Direct hosting):
- Initial HTML load: 1.4 KB
- CSS load: 72 KB
- Font files loaded in parallel (same origin): ~150 KB total
- **Total time to fonts rendered:** ~100–200 ms (no external domain)

**Estimated savings:** 50–100 ms, ~60 KB bytes transferred

## Optical Sizing Consideration

Google Fonts provides the full range `12..144` for Gelasio and `6..72` for Work Sans. WOFF2 files from Google Fonts include variable font definitions, which means:

- Single `.woff2` file encodes all optical sizes
- CSS declaration `font-optical-sizing: auto` enables browser to select the best size
- Total font files (5 × WOFF2): ~150 KB, covers all weights and sizes

If file size is a concern, you can:
1. Download only specific optical sizes (e.g., just `24`, `32` for display)
2. Use separate fonts for headings vs. body (though this adds complexity)

For now, the full variable fonts are recommended for flexibility.

## Fallback Strategy

If font loading fails (network error, file not found), CSS fallbacks kick in:

```css
font-family: "Gelasio", Georgia, serif;        /* → Falls back to Georgia */
font-family: "Work Sans", Arial, sans-serif;    /* → Falls back to Arial */
```

Users see the design in system fonts (no visual breakage), and the app remains fully functional. The fallback fonts have similar metrics and are web-safe.

## License

- **Gelasio** — Google Fonts (Open Font License, free use)
- **Work Sans** — Google Fonts (Open Font License, free use)

Both fonts can be freely hosted and distributed. No additional license attribution is required for local hosting.

## What Not to Do

❌ Don't use `font-display: block` — causes text to be invisible while fonts load (FOIT)  
❌ Don't remove fallback fonts — some users may have older browsers that don't support WOFF2  
❌ Don't minify the @font-face declarations — keep them readable for maintainability  
✓ Do set `font-display: swap` — allows system fonts to render immediately, swap to web fonts when ready (FOUT)

## Next Steps

1. Download font files (see Step 1)
2. Create `assets/fonts/` and place files
3. Update CSS (see Step 3)
4. Test locally
5. Deploy and verify external requests are gone
6. Update cache-bust version in `index.html` (e.g., `?v=p1-optimize-fonts`)

---

**Owner:** P1 Optimize (Scoped)  
**Status:** Implementation Guide (Action: Execute steps 1–6 above)  
**Timeline:** This document is part of P1 optimize; implementation is the next work item.
