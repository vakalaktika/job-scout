// The match email is a shipped surface with no browser test behind it, which is
// how it came to render 632px wide at every viewport — a 375px phone scrolled
// sideways through every card. These render the real builder's output in a real
// engine and measure it.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildEmail } from "../build-email.mjs";

const template = readFileSync(new URL("../email-template.html", import.meta.url), "utf8");

// Deliberately awkward content: the longest realistic company name, a full
// salary range, and a dated freshness pill are what pushed the layout out.
const posting = (index, overrides = {}) => ({
  title: "Senior Product Designer, Payments Platform Experience",
  company: "Northwind Financial Technologies International",
  location: "Oakland, California, United States",
  source: "LinkedIn",
  url: `https://example.com/job-${index}`,
  workplace_type: "Remote",
  salary: "$150,000 – $190,000 a year",
  matchReason: "Your payments and design-systems work lines up with what this team is building next.",
  postedDaysAgo: index,
  ...overrides,
});

const html = buildEmail(
  template,
  { headline: "5 new matches", runDate: "Mon 10 Aug", firstName: "Alexandra" },
  [
    posting(0),
    posting(5),
    posting(12),
    posting(3, { workplace_type: "Unclear", salary: "" }),
    posting(1, { postedDaysAgo: null }),
  ],
);

const open = async (page) => {
  await page.setContent(html, { waitUntil: "load" });
};

for (const width of [320, 375, 600]) {
  test(`the email fits ${width}px without scrolling sideways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);

    const overflow = await page.evaluate(() => {
      const wide = [];
      for (const element of document.querySelectorAll("*")) {
        const box = element.getBoundingClientRect();
        if (box.right > window.innerWidth + 0.5) {
          wide.push(`${element.tagName} w=${Math.round(box.width)}`);
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, wide };
    });

    expect(overflow.wide).toEqual([]);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(width);
  });
}

test("the email still stops at 600px on a wide screen", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await open(page);

  const shell = await page.evaluate(() =>
    Math.round(document.querySelector("table table").getBoundingClientRect().width),
  );
  expect(shell).toBe(600);
});

test("Outlook keeps its fixed width through a conditional the builder must not strip", () => {
  expect(html).toContain("<!--[if mso]>");
  expect(html).toContain('width="600"');
  // Instructional comments are still removed.
  expect(html).not.toContain("PER-CARD EXEMPLAR");
  expect(html).not.toContain("JOB_CARD_START");
});

test("every piece of small text clears the AA floor against what is behind it", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await open(page);

  const failures = await page.evaluate(() => {
    const parse = (value) => (value.match(/\d+(\.\d+)?/g) || []).map(Number);
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => {
      const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
      return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
    };
    // Walk up for the nearest painted background, the way a reader's eye does.
    const backdrop = (element) => {
      let node = element;
      while (node && node !== document.documentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
        if (a > 0) return [r, g, b];
        node = node.parentElement;
      }
      return [255, 255, 255];
    };

    const bad = [];
    for (const element of document.querySelectorAll("td, div, span, a, h1, h2, p")) {
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();
      if (!text) continue;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      // WCAG "large text": 18.66px bold or 24px regular.
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const contrast = ratio(parse(style.color).slice(0, 3), backdrop(element));
      if (contrast < need) {
        bad.push(`${text.slice(0, 40)} — ${contrast.toFixed(2)}:1 (needs ${need})`);
      }
    }
    return bad;
  });

  expect(failures).toEqual([]);
});

test("the email has a heading structure and one heading per posting", async ({ page }) => {
  await open(page);

  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("5 new matches");
  // One h2 per card, each naming its own role.
  await expect(page.locator("h2")).toHaveCount(5);
  await expect(page.locator("h2").first()).toContainText("Senior Product Designer");
});

test("each posting link says which posting it opens", async ({ page }) => {
  await open(page);

  const names = await page
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.textContent.trim().replace(/\s+/g, " ")));

  // Each card carries two links: the h2 title and the CTA beneath it. Neither
  // may be a bare "View posting" — five identically named links tell a
  // screen-reader user nothing about which one they are about to follow. The
  // name is visible text rather than an aria-label on purpose: an accessible
  // name has to contain the visible label, so overriding "View posting" with a
  // spoken "View <title> at <company>" trades one failure for another.
  const titleLinks = names.filter((name) => name.startsWith("Senior Product Designer"));
  const viewLinks = names.filter((name) => name.startsWith("View posting"));

  expect(titleLinks.length).toBe(5);
  expect(viewLinks.length).toBe(5);
  for (const name of viewLinks) {
    expect(name).toContain("Northwind Financial Technologies International");
  }
});

// {{URL}} is the only token written into an attribute, so it is the only one
// that can break out of one. Title and company are text content.
test("a posting URL cannot break out of the href it is written into", () => {
  const risky = buildEmail(
    template,
    { headline: "1 new match", runDate: "Mon", firstName: "Alex" },
    [
      posting(0, {
        url: 'https://example.com/x" onmouseover="alert(1)',
        title: 'Designer" & <script>alert(2)</script>',
        company: "Acme & Co",
      }),
    ],
  );

  expect(risky).not.toContain('onmouseover="alert(1)"');
  expect(risky).toContain("&quot;"); // the URL's quote, attribute-escaped
  expect(risky).not.toContain("<script>");
  expect(risky).toContain("Acme &amp; Co");
});
