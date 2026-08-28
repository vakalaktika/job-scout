// Focus indicators and control boundaries, measured rather than eyeballed.
//
// The shared focus ring was rgba(53,110,89,.28) — roughly 1.5:1 against every
// surface it lands on, which is an indicator you have to already know is there.
// Control edges used --line at 1.3:1. Both are computed here against what is
// actually painted behind them, so the numbers cannot drift back.
import { expect, test } from "@playwright/test";
import { openDashboard, resetWorker } from "./support.mjs";

const CONTRAST = `
  (() => {
    const parse = (value) => (value.match(/[\\d.]+/g) || []).map(Number);
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return {
      parse,
      ratio: (a, b) => {
        const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a];
        return (lum(hi) + 0.05) / (lum(lo) + 0.05);
      },
      backdrop: (element) => {
        let node = element;
        while (node && node !== document.documentElement) {
          const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
          if (a > 0) return [r, g, b];
          node = node.parentElement;
        }
        return [255, 255, 255];
      },
    };
  })()
`;

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("the focus ring is opaque and clears 3:1 against the page behind it", async ({ page }) => {
  await openDashboard(page);
  await page.keyboard.press("Tab");

  const focus = await page.evaluate(`(() => {
    const helpers = ${CONTRAST};
    const el = document.activeElement;
    const style = getComputedStyle(el);
    const colour = helpers.parse(style.outlineColor);
    return {
      tag: el.tagName,
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      alpha: colour.length > 3 ? colour[3] : 1,
      contrast: helpers.ratio(colour.slice(0, 3), helpers.backdrop(el.parentElement)),
    };
  })()`);

  expect(focus.style).not.toBe("none");
  expect(focus.width).toBeGreaterThanOrEqual(2);
  // Opaque: a translucent ring is the shape the old one failed in.
  expect(focus.alpha).toBe(1);
  expect(focus.contrast).toBeGreaterThanOrEqual(3);
});

test("every focusable control on the job list shows a ring when tabbed to", async ({ page }) => {
  await openDashboard(page);

  const seen = new Set();
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        id: `${el.tagName}.${(el.className || "").toString().trim().split(/\s+/)[0] || ""}`,
        outline: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2,
        shadow: style.boxShadow !== "none",
      };
    });
    if (!state) break;
    expect(state.outline || state.shadow, `${state.id} shows no focus indicator`).toBe(true);
    seen.add(state.id);
  }

  expect(seen.size).toBeGreaterThan(4);
});

test("control edges clear 3:1 while dividers stay quiet", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Edit preferences|Review preferences/ }).first().click();
  await page.getByRole("tab", { name: "Location & pay" }).click();

  const weak = await page.evaluate(`(() => {
    const helpers = ${CONTRAST};
    const bad = [];
    for (const el of document.querySelectorAll("input, select, textarea, .track-chip, .job-filter-seg button")) {
      const style = getComputedStyle(el);
      const width = parseFloat(style.borderTopWidth);
      if (!width || style.borderTopStyle === "none") continue;
      const contrast = helpers.ratio(
        helpers.parse(style.borderTopColor).slice(0, 3),
        helpers.backdrop(el.parentElement),
      );
      if (contrast < 3) bad.push(el.tagName + " " + contrast.toFixed(2));
    }
    return bad;
  })()`);

  expect(weak).toEqual([]);
});

// The step heading is moved to programmatically on every step change, so it is
// the one element on screen that must not be focused invisibly.
test("a programmatically focused step heading shows that it was focused", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Edit preferences|Review preferences/ }).first().click();
  await page.getByRole("tab", { name: "Delivery" }).click();

  // Focus and measure in one evaluate. Switching tabs queues a re-render that
  // replaces this heading, and the tab strip then reclaims focus, so splitting
  // these across two round-trips lets the re-render land in between and reads as
  // a heading with no cue. One synchronous callback cannot be interleaved.
  const cue = await page.locator("#intake-step-heading").evaluate((el) => {
    el.focus();
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth), shadow: style.boxShadow };
  });

  const visible = (cue.outline !== "none" && cue.width >= 2) || cue.shadow !== "none";
  expect(visible, "a focused heading with no visible cue").toBe(true);
});
