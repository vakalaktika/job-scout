// The narrow layout is where names and targets go missing: both navigations
// collapse to icons by hiding their only label, and several controls are shrunk
// by rules that only apply below 780px. Nothing caught either, because nothing
// ran the product at 375px.
//
// These audits walk each screen at phone size and assert two things about every
// interactive element on it — that it has an accessible name, and that it is at
// least 44x44, the product's own touch-target standard.
import { expect, test } from "@playwright/test";
import { openDashboard, resetWorker } from "./support.mjs";

const INTERACTIVE =
  "button, a[href], input:not([type=hidden]), select, textarea, " +
  "[role=tab], [role=radio], [role=checkbox], [role=button]";

// The accessible name as a screen reader would compute it, near enough for an
// audit: an explicit label wins, then a wrapping <label>, then the text content
// including anything only clipped from view.
const audit = (page) =>
  page.evaluate((selector) => {
    const named = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      if (el.id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (explicit?.textContent.trim()) return explicit.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping?.textContent.trim()) return wrapping.textContent.trim();
      if (el.title?.trim()) return el.title.trim();
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    };

    const unnamed = [];
    const small = [];
    for (const el of document.querySelectorAll(selector)) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.disabled) continue;
      const describe = `${el.tagName.toLowerCase()}.${(el.className || "").toString().trim().split(/\s+/)[0] || ""}`;
      const name = named(el);
      if (!name) unnamed.push(describe);
      // Rounded down to whole pixels: a 43.6px control is not a failure of
      // intent, and sub-pixel layout noise should not fail a suite.
      if (Math.round(box.width) < 44 || Math.round(box.height) < 44) {
        small.push(`${Math.round(box.width)}x${Math.round(box.height)} ${describe} "${name.slice(0, 24)}"`);
      }
    }
    return { unnamed, small: [...new Set(small)] };
  }, INTERACTIVE);

const expectAccessible = async (page) => {
  const { unnamed, small } = await audit(page);
  expect(unnamed, "controls with no accessible name").toEqual([]);
  expect(small, "controls under the 44x44 touch-target standard").toEqual([]);
};

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("the job list is fully named and reachable by thumb", async ({ page }) => {
  await openDashboard(page);
  await expectAccessible(page);
});

// The exact regression: the labels are hidden from view, not from the reader.
test("the collapsed primary navigation and account menu keep every destination named", async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByRole("button", { name: /^For you/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Saved/ })).toBeVisible();
  await page.getByRole("button", { name: "Open account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  // The label is present but not painted, which is the whole point.
  const painted = await page.locator(".nav-link span").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { display: style.display, width: Math.round(el.getBoundingClientRect().width) };
  });
  expect(painted.display).not.toBe("none");
  expect(painted.width).toBeLessThanOrEqual(1);
});

test("the navigation says which view you are actually in", async ({ page }) => {
  await openDashboard(page);

  await expect(page.getByRole("button", { name: /^For you/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: /Keep your scout useful/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^For you/ })).not.toHaveAttribute("aria-current", "page");
});

test("an expanded job card keeps every control named and thumb-sized", async ({ page }) => {
  await openDashboard(page);
  // "New" is a view of what is unreviewed, so a saved card leaves it. Watch from
  // "All", where the card stays put through both decisions.
  await page.getByRole("tab", { name: /^All/ }).click();

  const card = page.getByRole("article").first();
  await card.getByRole("button", { name: /as interested$/ }).click();
  await expect(card.getByRole("button", { name: "Applied", exact: true })).toBeVisible();
  await card.getByRole("button", { name: /^Not interested in/ }).click();
  await expect(card.getByRole("button", { name: "Something else" })).toBeVisible();

  await expectAccessible(page);
});

test("the settings view is fully named and reachable by thumb", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: /Keep your scout useful/ })).toBeVisible();

  await expectAccessible(page);
});

test("every preference tab is fully named and reachable by thumb", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Edit preferences|Review preferences/ }).first().click();
  await expect(page.getByRole("heading", { name: "Edit your preferences" })).toBeVisible();

  for (const tab of ["Roles", "Location & pay", "Filters", "Delivery", "Profile"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expectAccessible(page);
  }
});

// A slider announced as "17" is a number with nothing to say what it counts.
test("the posting-freshness slider says what it is and what its value means", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("button", { name: /Edit preferences|Review preferences/ }).first().click();
  await page.getByRole("tab", { name: "Location & pay" }).click();

  const slider = page.getByRole("slider", { name: "Posted within" });
  await expect(slider).toHaveCount(1);
  await expect(slider).toHaveAttribute("aria-valuetext", /Within \d+ days|Within 24 hours/);

  // The salary pair is named too, and each half says what it is.
  await expect(page.getByRole("slider", { name: "Minimum salary" })).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Maximum salary" })).toHaveCount(1);
});

// The narrow invite screen drops the marketing intro and leads with the form, so
// the card's own heading is the one on screen here.
test("the invite gate is fully named and reachable by thumb", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.getByRole("heading", { name: "Enter your invite code" })).toBeVisible();

  await expectAccessible(page);
});

test("the setup steps are named rather than numbered when they collapse", async ({ page, request }) => {
  await resetWorker(request, { member: null, jobs: [] });
  await page.goto("/index.html");
  await page.getByRole("textbox", { name: /Invite code/ }).fill("SCOUT-ABCD-5YDM");
  await page.getByRole("button", { name: /Continue|Check my code|Open/ }).first().click();
  await expect(page.getByRole("heading", { name: "Start with you" })).toBeVisible();

  const steps = page.getByRole("navigation", { name: "Experience steps" }).getByRole("button");
  const names = await steps.evaluateAll((buttons) =>
    buttons.map((button) => (button.textContent || "").replace(/\s+/g, " ").trim()),
  );
  // Every step reads as a step, not as a bare ordinal.
  expect(names.every((name) => /[a-z]/i.test(name))).toBe(true);

  await expectAccessible(page);
});

test("the setup wizard is fully named and reachable by thumb on every step", async ({ page, request }) => {
  await resetWorker(request, { member: null, jobs: [] });
  await page.goto("/index.html");
  await page.getByRole("textbox", { name: /Invite code/ }).fill("SCOUT-ABCD-5YDM");
  await page.getByRole("button", { name: /Continue|Check my code|Open/ }).first().click();

  await expect(page.getByRole("heading", { name: "Start with you" })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("textbox", { name: /^Name/ }).fill("Robin Fields");
  await page.getByRole("textbox", { name: /^Email/ }).fill("robin@example.com");
  await page.locator('.resume-field input[type="file"]').setInputFiles({
    name: "robin.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Robin Fields\nrobin@example.com\nSenior Product Designer\n".repeat(8)),
  });
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { name: /good next move/ })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("textbox", { name: /^Target roles/ }).fill("Senior Product Designer");
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { name: /Where should the search focus/ })).toBeVisible();
  await expectAccessible(page);
});
