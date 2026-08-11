// Preference editing has to be transactional, and delivery settings have to
// survive edits that have nothing to do with them. Both were broken in ways only
// a real click path exposes: the state was correct in every unit, and wrong the
// moment two screens shared it.
import { expect, test } from "@playwright/test";
import { openDashboard, openEditor, resetWorker, rolesField, workerState } from "./support.mjs";

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("Cancel discards preference edits instead of publishing them", async ({ page, request }) => {
  await openDashboard(page);
  await expect(page.getByText("Senior Product Designer, Design Lead").first()).toBeVisible();

  await openEditor(page);
  await rolesField(page).fill("Uncommitted Test Role");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByText("Uncommitted Test Role")).toHaveCount(0);
  await expect(page.getByText("Senior Product Designer, Design Lead").first()).toBeVisible();

  // Nothing was sent, so there is nothing to have been rolled back on the server.
  const state = await workerState(request);
  expect(state.requests.filter((entry) => entry.action === "preferences")).toHaveLength(0);
});

test("re-opening the editor after Cancel shows the saved values, not the discarded ones", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);
  await rolesField(page).fill("Uncommitted Test Role");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/step=dashboard/);

  await openEditor(page);
  await expect(rolesField(page)).toHaveValue("Senior Product Designer, Design Lead");
});

test("Save publishes the edit to the dashboard", async ({ page }) => {
  await openDashboard(page);
  await openEditor(page);
  await rolesField(page).fill("Staff Product Designer");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByText("Staff Product Designer").first()).toBeVisible();
});

// A failed save keeps the member's work in front of them without letting it
// reach the dashboard behind.
test("a failed save keeps the draft on screen and off the dashboard", async ({ page, request }) => {
  await resetWorker(request, { failures: { preferences: { status: 500, error: "server_error" } } });
  await openDashboard(page);
  await openEditor(page);
  await rolesField(page).fill("Draft Under Repair");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("alert")).toContainText(/couldn’t save/i);
  await expect(page).toHaveURL(/step=intake/);
  await expect(rolesField(page)).toHaveValue("Draft Under Repair");

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/step=dashboard/);
  await expect(page.getByText("Draft Under Repair")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Delivery settings against unrelated edits.
// ---------------------------------------------------------------------------

test("a saved cadence is not reverted by a later, unrelated preference edit", async ({ page, request }) => {
  await openDashboard(page);

  await openEditor(page);
  await page.getByRole("tab", { name: "Delivery" }).click();
  await page.getByRole("radio", { name: /Weekly/ }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);
  expect((await workerState(request)).member.frequency).toBe("Weekly");

  await openEditor(page);
  await rolesField(page).fill("Principal Product Designer");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);

  const state = await workerState(request);
  expect(state.member.frequency).toBe("Weekly");
  // The second save carried no cadence at all, so there was nothing stale to send.
  const save = state.requests.filter((entry) => entry.action === "preferences").at(-1);
  expect(save.payload.target_roles).toBe("Principal Product Designer");
  expect(save.payload.frequency).toBeUndefined();
});

test("pausing emails survives an unrelated preference edit", async ({ page, request }) => {
  await openDashboard(page);

  await page.getByRole("button", { name: /Pause emails/i }).click();
  await expect(page.getByText(/Job emails are paused/i).first()).toBeVisible();

  await openEditor(page);
  await rolesField(page).fill("Design Director");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);

  const state = await workerState(request);
  expect(state.member.status).toBe("Paused");
});

test("a paused member is told so in the editor and resumes by choosing a rhythm", async ({ page, request }) => {
  await resetWorker(request, { member: { ...(await workerState(request)).member, status: "Paused" } });
  await openDashboard(page);
  await openEditor(page);
  await page.getByRole("tab", { name: "Delivery" }).click();

  await expect(page.getByText("Job emails are paused.")).toBeVisible();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);

  await page.getByRole("radio", { name: /Weekly/ }).click();
  await expect(page.getByText("Job emails are paused.")).toHaveCount(0);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);

  const state = await workerState(request);
  expect(state.member.status).toBe("Active");
  expect(state.member.frequency).toBe("Weekly");
});
