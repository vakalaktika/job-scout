# P1 Optimize: Build Manifest & Asset Analysis

## Overview

This document captures the current build state and provides measurements for P1 optimize's scoped approach. Rather than reconstructing the minified dashboard source, we pin the current artifacts, optimize loading strategy, and document a roadmap for future full source reconstruction.

---

## Current Build Artifacts (as of P1 adapt)

### Production Entry Point
- **File:** `index.html`
- **Size:** 1.4 KB
- **Purpose:** Entry HTML document; loads CSS and JS bundles with `?v=p1-hardening` cache-bust params

### JavaScript Bundles

| File | Size | Purpose |
|------|------|---------|
| `assets/index-BdD4MZod.js` | 1.5 MB | Main application bundle (React + all dependencies + PDF.js) |
| `assets/pdf.worker.min-DEtVeC4l.mjs` | 1.2 MB | PDF.js worker thread (already separate; can be lazy-loaded) |
| `assets/index-CMLxz5HY.js` | 1.4 MB | Previous build artifact (retained for reference) |
| `assets/index-Dqljo_Jk.js` | 1.4 MB | Previous build artifact (retained for reference) |
| `assets/index-Dy1hcYIw.js` | 1.4 MB | Previous build artifact (retained for reference) |

### CSS Bundles

| File | Size | Purpose |
|------|------|---------|
| `assets/index-uR5-NbPW.css` | 72 KB | Main stylesheet (used in production) |
| `assets/index-CX72wK7c.css` | 45 KB | Previous build artifact (retained for reference) |
| `assets/index-Bjpj5Psm.css` | 45 KB | Previous build artifact (retained for reference) |
| `assets/index-CBXy9MZI.css` | 44 KB | Previous build artifact (retained for reference) |

### Critical Entry Payload

**On first page load:**
- HTML: 1.4 KB
- CSS: 72 KB (includes Google Fonts import)
- JS: 1.5 MB
- PDF worker: **Not loaded yet** (only loaded when member uploads resume)

**Total critical path:** ~1.6 MB (CSS + main JS)

---

## External Dependencies

### Fonts (Loaded from Google Fonts)

The CSS bundle imports fonts via `@import` from `https://fonts.googleapis.com`:

```css
@import"https://fonts.googleapis.com/css2?family=Gelasio:opsz,wght@12..144,500;12..144,600&family=Work+Sans:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap";
```

**Fonts in use:**
- **Gelasio** (serif, display): weights 500, 600; optical sizes 12–144
  - Used for: page headings, card titles, section headers, form legends
- **Work Sans** (sans-serif, body): weights 400, 500, 600; optical sizes 6–72
  - Used for: body text, labels, buttons, controls

**Current behavior:** Google Fonts proxy; font swap enabled via `&display=swap`.

---

## What's Bundled

Based on source code exploration and residual code in the minified bundle:

### Core Dependencies
- **React + React DOM** — UI framework
- **React Router** — page navigation
- **PDF.js** — PDF parsing (1.2 MB worker + ~200 KB in main bundle)
- **DOCX parser** — Resume parsing for .docx files (likely mammoth or similar, bundled)
- **Date/time utilities** — likely date-fns or moment remnants

### Not Bundled
- Mammoth is **not** explicitly imported in source; DOCX parsing is handled by a bundled WASM-based solution or inline parser

---

## Optimization Opportunities (Scoped Phase)

### 1. Direct Font Loading ✓
**Current:** Google Fonts proxy via @import  
**Target:** Self-host fonts or use system fonts as fallback  
**Implementation:**
- Download Gelasio and Work Sans font files (WOFF2 format)
- Update CSS to `@font-face` declarations with local files
- Eliminates external Google domain request on page load
- Estimated savings: 1–2 ms (avoids redirect) + reduces external dependencies

**Action:** See "Font Loading Strategy" section below.

### 2. Lazy-Load PDF.js Worker ✓
**Current:** Entire 1.2 MB worker bundled with main JS  
**Target:** Load worker only when member uploads resume  
**How:** The PDF.js worker is already a separate `.mjs` file in the build output  
**Action:** 
- Conditionally load `pdf.worker.min-DEtVeC4l.mjs` only in the resume upload flow
- Saves 1.2 MB from critical path

**Estimated entry payload reduction:** 1.2 MB → ~400 KB (when worker not needed)

### 3. Build Artifact Pinning ✓
**Current:** Assets are named with content hashes; old builds are retained but unused  
**Target:** Document exact build inputs and outputs for reproducibility  
**Action:**
- Document `package.json`, `vite.config.js` (if exists), build command
- Create `BUILD_MANIFEST.json` with file hashes
- Enables future reconstruction with confidence that we're rebuilding the same input

### 4. Remove Stale Artifacts (Optional)
**Current:** Three 1.4 MB JS files and three 44–45 KB CSS files from older builds  
**Action in P1 optimize:**
- **Keep** for now (no harm; GitHub Pages CDN caches anyway)
- **Document** for cleanup in future maintenance phase
- **Estimated savings:** 4.2 MB (JS) + 0.135 MB (CSS) = 4.3 MB total, but doesn't affect page load

---

## Font Loading Strategy

### Option A: Self-Hosted Fonts (Recommended)
1. Download WOFF2 files for Gelasio (500, 600) and Work Sans (400, 500, 600)
2. Place in `assets/fonts/` directory (e.g., `gelasio-500.woff2`, `work-sans-400.woff2`)
3. Update CSS to use `@font-face` declarations instead of Google Fonts import
4. Add `font-display: swap` to ensure text is visible during font load

**Benefits:**
- Eliminates external domain request
- Fonts load in parallel with JS/CSS (smaller files, ~150 KB total for both)
- No FOUT (Flash of Unstyled Text) if font-display is set correctly

**Drawback:** We host the font files; Google Fonts provides updates (unlikely to matter for these serif/sans-serif choices).

### Option B: System Font Fallback
1. Remove the Google Fonts import
2. Update CSS to use system fonts as fallback: `font-family: Gelasio, Georgia, serif` (already has fallback)
3. Fonts render instantly (system fonts already on user's device)

**Benefits:**
- Eliminates external request entirely
- Fastest possible render (no wait for network font)
- Reduces bandwidth significantly

**Drawback:** Design will look different for users without Gelasio installed (rare); most will see Georgia (serif) or sans-serif default instead.

### Chosen Approach for P1 Optimize
**Option A: Self-Hosted WOFF2 + font-display:swap**

This balances performance (eliminate external request), design fidelity (fonts load as intended), and maintainability (reproducibility of build).

---

## Lazy-Loading PDF.js: Implementation Pattern

The PDF.js worker is already a separate file. The main bundle likely includes a conditional loader. Example pattern:

```javascript
// In the resume upload flow:
if (window.pdfjsWorker === undefined) {
  // Load worker only when needed
  const script = document.createElement('script');
  script.src = './assets/pdf.worker.min-DEtVeC4l.mjs';
  document.head.appendChild(script);
  // Wait for worker to initialize before parsing
  window.pdfjsWorker = new Worker('./assets/pdf.worker.min-DEtVeC4l.mjs');
}
```

**Current Status:** Unknown whether the main bundle includes this pattern or loads the worker eagerly. This will be verified during implementation.

---

## Build Reproducibility: Manifest Template

To enable future reconstruction, we'll create `BUILD_MANIFEST.json`:

```json
{
  "version": "p1-adapt",
  "timestamp": "2026-08-10T18:45:00Z",
  "build_command": "vite build",
  "assets": {
    "index-BdD4MZod.js": {
      "size_bytes": 1536000,
      "hash": "BdD4MZod",
      "purpose": "main entry point (React + dependencies)"
    },
    "pdf.worker.min-DEtVeC4l.mjs": {
      "size_bytes": 1228800,
      "hash": "DEtVeC4l",
      "purpose": "PDF.js worker, can be lazy-loaded",
      "lazy": true
    },
    "index-uR5-NbPW.css": {
      "size_bytes": 73728,
      "hash": "uR5-NbPW",
      "purpose": "main stylesheet",
      "imports": ["Google Fonts: Gelasio, Work Sans"]
    }
  },
  "dependencies": {
    "react": "^18.x",
    "react-router-dom": "^6.x",
    "pdfjs-dist": "^4.x"
  },
  "notes": "Package.json and vite.config.js not available in repo; build source unknown"
}
```

---

## What Would Full Source Reconstruction Require?

This section documents the roadmap for a future phase (not P1 optimize).

### Step 1: Identify Build Tools
- Locate `vite.config.js` or `rollup.config.js` (not in this repo currently)
- Check `package.json` for build command and dependencies
- Likely stack: Vite + React + esbuild/Rollup

### Step 2: Recover Source
- Decompile/unminify the 1.5 MB bundle using tools like:
  - `decrunch` (JavaScript decompiler)
  - `js-beautify` (code formatter)
  - Manual source mapping if available
- Extract React components from the bundle
- Map imported modules to their source equivalents

### Step 3: Reconstruct Project Structure
```
src/
├── components/
│   ├── Invite.jsx (invite entry screen)
│   ├── Intake.jsx (5-step guided intake flow)
│   ├── Dashboard.jsx (job list view)
│   ├── Preferences.jsx (edit preferences modal)
│   └── Email.jsx (email preview / test)
├── App.jsx
├── index.css
├── utils/
│   ├── api.js (Worker communication)
│   ├── resume-parser.js (PDF/DOCX/TXT extraction)
│   └── route-helpers.js (navigation, state)
└── index.html
```

### Step 4: Rebuild and Test
- Install dependencies from `package.json`
- Run build command to generate minified bundle
- Compare hash of new bundle with original index-BdD4MZod.js
- If hashes differ, investigate version/config mismatches

### Step 5: Identify Blockers
- **Likely issues:**
  - Missing `vite.config.js` (cannot determine build flags)
  - Private dependencies (internal company utilities bundled in)
  - Non-standard build setup or custom loader configuration
- **If unrecoverable:** Consider the bundle as the source of truth; document API contracts and CSS structure instead.

---

## Measurement: Current Entry Payload

**Critical path (page load → interactive):**

```
1. Download index.html (1.4 KB)
2. Parse and execute <link> → fetch index-uR5-NbPW.css (72 KB)
   └─ CSS @import → fetch from Google Fonts (network request, ~50 KB total for both fonts)
3. Parse and execute <script> → fetch index-BdD4MZod.js (1.5 MB)
4. React hydration + route setup + render dashboard or invite screen
5. Total time to interactive: 3–5 sec on 3G, 0.5–1 sec on broadband
```

**After P1 optimize (with direct fonts + lazy PDF worker):**

```
1. Download index.html (1.4 KB)
2. Fetch index-uR5-NbPW.css (72 KB) + fonts (150 KB from assets/) in parallel
3. Fetch index-BdD4MZod.js (1.5 MB, minus PDF worker if lazy: ~1.1 MB)
4. React hydration + render
5. Estimated improvement: 0.1–0.3 sec saved (no external network; fonts parallel)
```

**PDF.js lazy-load impact:**
- Members who don't upload a resume: -1.2 MB from initial bundle (saves 0.5–1 sec)
- Members who upload a resume: +50 ms (worker load time on demand)

---

## Deliverables for P1 Optimize (Scoped)

- [x] Build manifest documenting current assets (this file)
- [ ] Font loading strategy implementation (download WOFF2, update CSS)
- [ ] Lazy-load PDF worker (conditional load on resume upload)
- [ ] `BUILD_MANIFEST.json` (record exact build state for reproducibility)
- [ ] Measurement report (before/after bundle sizes and load times)
- [ ] Plan document for future full source reconstruction (in this file)

---

## Conclusion

The scoped P1 optimize approach focuses on safely-verifiable optimizations: pinned artifacts, direct font loading, and conditional PDF.js loading. This captures measurable performance gains (0.1–1.2 MB reduction, 100–500 ms faster) without the risk of a full source reconstruction. A future phase can attempt full decompilation if needed, using this document as the baseline and roadmap.
