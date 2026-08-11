// The typography was broken for a long time without anything noticing: the
// Google Fonts URL both pages carried asked for an `opsz` axis that neither
// Gelasio nor Work Sans publishes, so the stylesheet answered 400 and every
// screen quietly rendered in Arial. Nothing failed, because nothing looked.
// These tests look — a face that does not arrive, or arrives from somewhere
// other than this origin, is a failure here.
import { test, expect } from "@playwright/test";
import { signIn } from "./support.mjs";

const EXTERNAL_FONT_HOST = /fonts\.(googleapis|gstatic)\.com/;

// Measuring text width against a deliberately wrong fallback is the only check
// that survives the interesting failures: a 404 face, a family name that never
// matches, and a weight the file does not cover all leave the fallback metrics
// in place, and all three read as "no difference" here.
const rendersIn = async (page, family) =>
  page.evaluate(async (stack) => {
    await document.fonts.ready;
    const measure = (fontFamily) => {
      const probe = document.createElement("span");
      probe.textContent = "Handgloves 0123";
      probe.style.cssText =
        `position:absolute;visibility:hidden;white-space:pre;font-size:64px;font-family:${fontFamily}`;
      document.body.append(probe);
      const { width } = probe.getBoundingClientRect();
      probe.remove();
      return width;
    };
    return measure(`'${stack}', monospace`) !== measure("monospace");
  }, family);

// Collect font traffic for a page load: anything that is a font file, plus any
// request at all to a font CDN, so a stylesheet that 404s is caught too.
const loadWatchingFonts = async (page, path) => {
  const responses = [];
  const failures = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.endsWith(".woff2") || EXTERNAL_FONT_HOST.test(url)) {
      responses.push({ url, status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.endsWith(".woff2") || EXTERNAL_FONT_HOST.test(url)) failures.push(url);
  });

  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
  return { responses, failures };
};

test("the dashboard gets Work Sans from this origin rather than a font CDN", async ({ page }) => {
  await signIn(page);
  const { responses, failures } = await loadWatchingFonts(page, "/index.html");

  expect(failures).toEqual([]);
  expect(responses.filter(({ url }) => EXTERNAL_FONT_HOST.test(url))).toEqual([]);
  expect(responses.length).toBeGreaterThan(0);
  for (const { url, status } of responses) expect(status, url).toBe(200);

  expect(await rendersIn(page, "Work Sans")).toBe(true);
});

test("the sign-in page gets Schibsted Grotesk from this origin rather than a font CDN", async ({ page }) => {
  const { responses, failures } = await loadWatchingFonts(page, "/login.html");

  expect(failures).toEqual([]);
  expect(responses.filter(({ url }) => EXTERNAL_FONT_HOST.test(url))).toEqual([]);
  expect(responses.length).toBeGreaterThan(0);
  for (const { url, status } of responses) expect(status, url).toBe(200);

  expect(await rendersIn(page, "Schibsted Grotesk")).toBe(true);
  // This page has no data role, so it must not be paying for the mono either.
  expect(responses.some(({ url }) => url.includes("ibm-plex-mono"))).toBe(false);
});

// The reverse of the check below, and the one that actually caught something: a
// family a page *asks for* but never *declares*. rendersIn cannot see it, because
// a developer with the font installed locally gets a match on the family name with
// nothing fetched — so the dashboard shipped every heading in the Georgia fallback
// while the suite stayed green. Compare the two lists instead.
//
// Read from computed style on real elements rather than from rule text: the stacks
// now come through a custom property (--font-ui), and a rule's own font-family
// value is the literal "var(--font-ui)", which tells you nothing about the family.
// Computed style resolves it, and it also reflects what the page actually renders
// rather than what it merely declares somewhere.
for (const path of ["/index.html", "/login.html"]) {
  test(`every family ${path} asks for is also declared there`, async ({ page }) => {
    await signIn(page);
    await page.goto(path);

    const { used, declared } = await page.evaluate(() => {
      const generic = new Set([
        "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
        "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji",
        "math", "fangsong",
      ]);
      // Rendered content only. <html> and everything in <head> keep the UA's
      // default family (Chromium reports "Times"), which is nobody's request and
      // would otherwise be reported as an undeclared face on every page.
      const skip = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META", "TITLE"]);
      const used = new Set();
      for (const el of [document.body, ...document.body.querySelectorAll("*")]) {
        if (skip.has(el.tagName)) continue;
        // The first entry is the request; the rest are fallbacks, which are
        // allowed to name families this origin does not serve.
        const first = getComputedStyle(el).fontFamily.split(",")[0].replace(/['"]/g, "").trim();
        if (first && !generic.has(first.toLowerCase())) used.add(first);
      }

      const declared = new Set();
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = [...sheet.cssRules];
        } catch {
          continue; // cross-origin sheet; nothing local to check
        }
        for (const rule of rules) {
          if (rule instanceof CSSFontFaceRule) {
            declared.add(rule.style.getPropertyValue("font-family").replace(/['"]/g, "").trim());
          }
        }
      }
      return { used: [...used], declared: [...declared] };
    });

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((family) => !declared.includes(family))).toEqual([]);
  });
}

test("every declared font file is actually present", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/index.html");

  // Read the URLs out of the loaded stylesheets rather than a hardcoded list,
  // so renaming or adding a face cannot drift past this test. A relative src
  // resolves against the stylesheet that declares it, not the document, so the
  // page resolves it against sheet.href while it still knows both.
  const declared = await page.evaluate(() =>
    [...document.styleSheets].flatMap((sheet) => {
      let rules;
      try {
        rules = [...sheet.cssRules];
      } catch {
        return []; // cross-origin sheet; nothing local to check
      }
      return rules
        .filter((rule) => rule instanceof CSSFontFaceRule)
        .map((rule) => rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)/)?.[1])
        .filter(Boolean)
        .map((src) => new URL(src, sheet.href ?? document.baseURI).pathname);
    }),
  );

  expect(declared.length).toBeGreaterThan(0);
  for (const path of declared) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
  }
});
