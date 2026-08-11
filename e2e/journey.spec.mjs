// The whole first-run journey in one pass: invite code, the five setup steps,
// the review screen, and the job list. Nothing below stubs the front end — it
// clicks what a member clicks, against the shipped bundle.
import { expect, test } from "@playwright/test";
import { resetWorker, workerState } from "./support.mjs";

// A code that passes the client-side checksum, so the invite gate posts it.
const INVITE_CODE = "SCOUT-ABCD-5YDM";

test("an invited member sets up, reviews, and lands on their job list", async ({ page, request }) => {
  // A brand-new member: no candidate record yet, so setup is the only way on.
  await resetWorker(request, { member: null, jobs: [] });
  await page.goto("/index.html");

  await expect(page.getByRole("heading", { name: /Open your private Job Scout/ })).toBeVisible();
  await page.getByRole("textbox", { name: /Invite code/ }).fill(INVITE_CODE);
  await page.getByRole("button", { name: /Continue|Check my code|Open/ }).first().click();

  // Step 1 — who you are and the resume the scout reads.
  await expect(page.getByRole("heading", { name: "Start with you" })).toBeVisible();
  await page.getByRole("textbox", { name: /^Name/ }).fill("Robin Fields");
  await page.getByRole("textbox", { name: /^Email/ }).fill("robin@example.com");
  await page.locator('.resume-field input[type="file"]').setInputFiles({
    name: "robin-fields.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Robin Fields\nrobin@example.com\nSenior Product Designer\nDesign systems, payments, B2B SaaS\n".repeat(
        8,
      ),
    ),
  });
  await expect(page.getByRole("button", { name: /^Continue/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Continue/ }).click();

  // Step 2 — roles.
  await expect(page.getByRole("heading", { name: /What would feel like a good next move/ })).toBeVisible();
  await page.getByRole("textbox", { name: /^Target roles/ }).fill("Senior Product Designer");
  await page.getByRole("button", { name: /^Continue/ }).click();

  // Step 3 — where, which needs a deliberate city rather than an assumed one.
  await expect(page.getByRole("heading", { name: /Where should the search focus/ })).toBeVisible();
  await page.getByRole("combobox", { name: /^Country/ }).selectOption("United States");
  await page.getByRole("combobox", { name: /State \/ region/ }).selectOption("California");
  await page.getByRole("combobox", { name: /^City/ }).selectOption("Oakland");
  await page.getByRole("button", { name: "Add city" }).click();
  await expect(page.locator(".preferred-location-list").getByText("Oakland")).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();

  // Step 4 — filters, which are optional and say so.
  await expect(page.getByRole("heading", { name: /What should we avoid/ })).toBeVisible();
  await expect(page.locator(".optional-badge")).toHaveText("Optional");
  await page.getByRole("button", { name: /^Skip for now/ }).click();

  // Step 5 — delivery, then review.
  await expect(page.getByRole("heading", { name: /How often should we check in/ })).toBeVisible();
  await page.getByRole("radio", { name: /Weekly/ }).click();
  await page.getByRole("button", { name: /^Save and review/ }).click();

  await expect(page).toHaveURL(/step=ready/);
  await expect(page.getByRole("heading", { name: /Ready for your first scout, Robin/ })).toBeVisible();
  await expect(page.getByText("Senior Product Designer").first()).toBeVisible();
  await expect(page.getByText("Weekly")).toBeVisible();

  await page.getByRole("button", { name: /Open your job list/ }).click();
  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Robin");

  const state = await workerState(request);
  const setup = state.requests.filter((entry) => entry.action === "preferences").at(-1);
  expect(setup.payload.name).toBe("Robin Fields");
  expect(setup.payload.frequency).toBe("Weekly");
  expect(setup.payload.regions).toContain("Oakland");
  expect(setup.payload.resume_text).toContain("Robin Fields");
});

test("the setup wizard will not continue past a step it cannot accept", async ({ page, request }) => {
  await resetWorker(request, { member: null, jobs: [] });
  await page.goto("/index.html");
  await page.getByRole("textbox", { name: /Invite code/ }).fill(INVITE_CODE);
  await page.getByRole("button", { name: /Continue|Check my code|Open/ }).first().click();

  await expect(page.getByRole("heading", { name: "Start with you" })).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("alert")).toContainText("Add your name to continue.");
  await expect(page.getByRole("heading", { name: "Start with you" })).toBeVisible();
});
