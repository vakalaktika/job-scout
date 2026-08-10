// The app wrote `?step=` on every navigation and read it back nowhere: start-up
// looked only at `?preview=`, and no popstate handler existed. Pressing Back
// changed the address bar and left the previous screen on display, which is the
// kind of divergence only a browser can catch.
import { expect, test } from "@playwright/test";
import { openDashboard, openEditor, resetWorker, signIn } from "./support.mjs";

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("Back returns to the dashboard instead of leaving the editor on screen", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);
  await expect(page).toHaveURL(/step=intake/);

  await page.goBack();

  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByRole("heading", { name: /Here’s what we found/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit your preferences" })).toHaveCount(0);
});

test("Forward returns to the editor the member came from", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);
  await page.goBack();
  await expect(page).toHaveURL(/step=dashboard/);

  await page.goForward();

  await expect(page).toHaveURL(/step=intake/);
  await expect(page.getByRole("heading", { name: "Edit your preferences" })).toBeVisible();
});

// Leaving the editor by any route is leaving the editor, so the draft goes with
// it — Back must not be a way to keep uncommitted edits alive on the dashboard.
test("navigating Back out of the editor discards the draft", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);
  await page.getByRole("textbox", { name: /^Target roles/ }).fill("Never Saved Role");

  await page.goBack();
  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByText("Never Saved Role")).toHaveCount(0);

  await page.goForward();
  await expect(page.getByRole("textbox", { name: /^Target roles/ })).toHaveValue(
    "Senior Product Designer, Design Lead",
  );
});

test("a route change moves focus to the heading of the view it lands on", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);

  await page.goBack();
  await expect(page).toHaveURL(/step=dashboard/);
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.textContent || ""))
    .toContain("Here’s what we found");
});

// A URL is not an authorisation. Deep-linking to a member route with no session
// must land on the invite gate and say so in the address bar too.
test("a signed-out visitor deep-linking to the dashboard lands on the invite gate", async ({ page }) => {
  await page.goto("/index.html?step=dashboard");

  await expect(page.getByRole("heading", { name: /Open your private Job Scout/ })).toBeVisible();
  await expect(page).not.toHaveURL(/step=/);
});

test("a signed-in visitor deep-linking to the dashboard is shown the dashboard", async ({ page }) => {
  await signIn(page);
  await page.goto("/index.html?step=dashboard");

  await expect(page.getByRole("heading", { name: /Here’s what we found/ })).toBeVisible();
  await expect(page).toHaveURL(/step=dashboard/);
});

test("an unsupported step is not treated as a route", async ({ page }) => {
  await signIn(page);
  await page.goto("/index.html?step=not-a-real-step");

  await expect(page.getByRole("heading", { name: /Here’s what we found/ })).toBeVisible();
});
