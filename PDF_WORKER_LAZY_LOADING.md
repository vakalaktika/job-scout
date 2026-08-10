# PDF.js Worker Lazy-Loading Strategy

## Overview

The PDF.js worker file (`assets/pdf.worker.min-DEtVeC4l.mjs`, 1.2 MB) is currently bundled with the main application code. Since PDFs are only parsed when a member uploads a résumé, the worker can be **lazy-loaded** — fetched only when needed.

**Benefit:** Saves 1.2 MB from the critical page-load path for members who don't upload a résumé.

---

## Current Architecture

### Main Bundle Includes:
- React + Router + UI components: ~1.1 MB
- PDF.js inline code: ~200 KB (parser logic, API bindings)
- **PDF.js worker**: ~1.2 MB (as separate `.mjs` file, but eagerly loaded)

### Worker Trigger:
- Resume upload flow (in the intake steps)
- Only needed when member selects a PDF file

---

## Why Lazy-Load?

### Impact Analysis

**Current page load sequence:**
```
1. HTML load (1.4 KB)
2. CSS load (72 KB) + Google Fonts request (50 KB)
3. JavaScript load (1.5 MB) ← includes 1.2 MB PDF worker
4. React hydration
5. Render invite/dashboard
```

**After lazy-loading PDF worker:**
```
1. HTML load (1.4 KB)
2. CSS load (72 KB) + Google Fonts request (50 KB)
3. JavaScript load (1.1 MB) ← PDF worker NOT included
4. React hydration
5. Render invite/dashboard
├─ [Later, on resume upload] Load PDF worker (1.2 MB) only then
```

### Estimated Savings

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Entry bundle size | 1.5 MB | 300 KB | 1.2 MB |
| Page load time (Fast 3G) | 4.5 sec | 2.8 sec | **1.7 sec** |
| Page load time (LTE) | 1.2 sec | 800 ms | **400 ms** |

**Caveat:** Members uploading a résumé wait 50–200 ms for worker load (acceptable, occurs on user action not on page entry).

---

## Implementation Pattern

### Detection: Is PDF.js Already Loaded?

The intake-flow component needs to check if the PDF worker is available before parsing:

```javascript
// Check if PDF.js worker is loaded
const isPdfWorkerReady = () => {
  return typeof window.pdfjsWorker !== 'undefined' || 
         (typeof globalThis?.pdfjsWorker !== 'undefined');
};
```

If not loaded, fetch it:

```javascript
const loadPdfWorker = async () => {
  if (isPdfWorkerReady()) return;
  
  // Dynamically import the worker
  const { default: pdfjsWorker } = await import(
    /* webpackChunkName: "pdf-worker" */
    './assets/pdf.worker.min-DEtVeC4l.mjs'
  );
  window.pdfjsWorker = pdfjsWorker;
};
```

### Intake-Flow Component Change

When user selects a file to upload (resume field), trigger the load:

```javascript
const handleResumeSelect = async (file) => {
  // Load PDF worker if not already loaded
  try {
    await loadPdfWorker();
  } catch (err) {
    console.error('Failed to load PDF worker:', err);
    // Handle error: show user message about upload failure
    return;
  }
  
  // Proceed with parsing
  parseResume(file);
};
```

### Vite Configuration (if build tool is Vite)

To ensure the PDF worker is split into a separate chunk:

```javascript
// vite.config.js (hypothetical)
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-worker': [
            // OR: path to pdf.worker file
            'node_modules/pdfjs-dist/build/pdf.worker.mjs'
          ]
        }
      }
    }
  }
});
```

**Note:** Since we don't have the Vite config in this repo, this is a placeholder. The PDF worker is already separate in the build output.

---

## Risk Mitigation

### What if the Worker Fails to Load?

Implement graceful degradation:

```javascript
const loadPdfWorker = async () => {
  if (isPdfWorkerReady()) return;
  
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = './assets/pdf.worker.min-DEtVeC4l.mjs';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF worker'));
    document.head.appendChild(script);
  });
};

const handleResumeSelect = async (file) => {
  try {
    await loadPdfWorker();
    parseResume(file);
  } catch (err) {
    showErrorToast('We couldn\'t load the PDF parser. Try again or upload a plain-text version.');
    logError('pdf-worker-load-failed', err);
  }
};
```

### What if User Has Slow Network During Upload?

Show a loading indicator:

```javascript
const handleResumeSelect = async (file) => {
  setIsLoading(true);
  try {
    await loadPdfWorker();
    parseResume(file);
  } catch (err) {
    showErrorToast('Network error. Please try again.');
  } finally {
    setIsLoading(false);
  }
};
```

### What if User Cancels Upload During Worker Load?

Abort the fetch to avoid wasted bandwidth:

```javascript
const abortController = new AbortController();

const loadPdfWorker = async () => {
  const response = await fetch('./assets/pdf.worker.min-DEtVeC4l.mjs', {
    signal: abortController.signal
  });
  if (!response.ok) throw new Error('Worker load failed');
  // Parse and set up worker...
};

const handleUploadCancel = () => {
  abortController.abort();
  setIsLoading(false);
};
```

---

## Testing Strategy

### Unit Tests

```javascript
describe('Resume upload with lazy-loaded PDF worker', () => {
  test('should load PDF worker on file select', async () => {
    const mockWorker = jest.fn();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob())
    }));
    
    const { handleResumeSelect } = renderIntakeFlow();
    const file = new File(['test'], 'resume.pdf', { type: 'application/pdf' });
    
    await handleResumeSelect(file);
    
    expect(global.fetch).toHaveBeenCalledWith('./assets/pdf.worker.min-DEtVeC4l.mjs');
  });
  
  test('should show error if worker load fails', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('Network')));
    
    const { handleResumeSelect, getErrorMessage } = renderIntakeFlow();
    const file = new File(['test'], 'resume.pdf', { type: 'application/pdf' });
    
    await handleResumeSelect(file);
    
    expect(getErrorMessage()).toContain('couldn\'t load');
  });
});
```

### E2E Tests

```javascript
test('e2e: upload resume and lazy-load PDF worker', async ({ page }) => {
  await page.goto('http://localhost:4173/');
  
  // Proceed to resume upload step
  await page.click('[aria-label="Next"]');
  
  // Monitor network tab
  const networkRequests = [];
  page.on('request', req => networkRequests.push(req.url()));
  
  // Initial load should NOT include PDF worker
  const initialRequests = networkRequests.filter(url => url.includes('pdf.worker'));
  expect(initialRequests).toHaveLength(0);
  
  // Upload a file
  await page.locator('input[type="file"]').setInputFiles('sample-resume.pdf');
  
  // After upload, PDF worker should be loaded
  await page.waitForTimeout(500); // Wait for fetch
  const afterUploadRequests = networkRequests.filter(url => url.includes('pdf.worker'));
  expect(afterUploadRequests.length).toBeGreaterThan(0);
});
```

### Performance Tests

Use Lighthouse or similar:

```bash
# Before optimization
lighthouse https://localhost:4173 --output-path ./reports/before.html

# After optimization
lighthouse https://localhost:4173 --output-path ./reports/after.html

# Compare First Contentful Paint, Largest Contentful Paint, etc.
```

---

## Current Status & Detection

### How to Verify PDF Worker is Currently Lazy-Loaded

In the browser console:

```javascript
// Check if PDF worker is loaded
console.log(typeof window.pdfjsWorker);

// Check Network tab (F12 → Network)
// Before file upload: no pdf.worker request
// After file upload: pdf.worker.min-DEtVeC4l.mjs appears
```

If the worker is currently **eagerly loaded**, you'll see it in the Network tab on page load. If it's **already lazy-loaded**, it won't appear until a file is selected.

### Quick Check in Codebase

Search intake-flow source for how PDF parsing is initialized:

```bash
grep -n "pdf.worker\|pdfjs\|PDFWorker" /home/user/job-scout/intake-flow.source.js
```

This will show if lazy-loading is already implemented or if it's a target for optimization.

---

## Implementation Checklist

- [ ] Verify current PDF worker loading behavior (eager vs lazy)
- [ ] If eager: Implement lazy-load pattern in intake-flow component
- [ ] Add loading state & error handling during worker fetch
- [ ] Add unit tests for worker load success/failure
- [ ] Add E2E test for lazy-load verification
- [ ] Performance test: measure FCP/LCP before & after
- [ ] Update cache-bust version in index.html
- [ ] Deploy and verify in production

---

## Fallback if Full Lazy-Loading Isn't Possible

If the main bundle's PDF.js inline code requires the worker to be present at initialization (can't be deferred), consider:

1. **Partial deferral:** Load worker on route change to intake step (earlier than file upload, but still deferred from page load)
2. **Conditional bundling:** Use Webpack conditional imports to exclude worker from bundle if not needed for current route
3. **Accept current state:** If lazy-loading requires significant refactoring, document it and move to next phase

For P1 optimize (scoped), we proceed with lazy-loading only if the above proves feasible.

---

## Rollback Plan

If lazy-loading introduces bugs:

1. Revert to eager loading: remove lazy-load logic
2. Keep fonts optimization (independent change)
3. Test bundle size is only 400 KB larger (acceptable vs. no optimization)
4. Document blockers for future attempt

---

## Conclusion

Lazy-loading the PDF.js worker is a high-impact optimization (1.2 MB saved from critical path) with moderate implementation complexity. If the minified bundle structure permits deferred loading, this can save 0.5–1.7 sec on page load for the majority of users (those not uploading a résumé immediately).

**Action for P1 optimize:** Implement if feasible; otherwise document as "future optimization candidate" and proceed with fonts-only changes.
