import { expect, test } from "@playwright/test";
import { openDashboard, resetWorker, workerState } from "./support.mjs";

const adminStats = {
  generated_at: "2026-08-28T12:00:00.000Z",
  summary: { users: 3, recommendations: 14, awaiting_review: 5, applications: 2 },
  users: [
    {
      id: "cand-admin",
      name: "Alex Morgan",
      email: "alex@example.com",
      status: "Active",
      frequency: "Daily",
      access_code: "SCOUT-ADMIN-CODE",
      is_admin: true,
      recommendations: 7,
      awaiting_review: 2,
      saved: 3,
      passed: 2,
      applications: 1,
      latest_recommendation_at: "2026-08-28T10:00:00.000Z",
    },
    {
      id: "cand-member",
      name: "Jordan Lee",
      email: "jordan@example.com",
      status: "Paused",
      frequency: "Weekly",
      access_code: "SCOUT-JORDAN-CODE",
      is_admin: false,
      recommendations: 7,
      awaiting_review: 3,
      saved: 2,
      passed: 2,
      applications: 1,
      latest_recommendation_at: "2026-08-27T10:00:00.000Z",
    },
    {
      id: "cand-new",
      name: "Taylor Green",
      email: "taylor@example.com",
      status: "Active",
      frequency: "Daily",
      access_code: "SCOUT-TAYLOR-CODE",
      is_admin: false,
      recommendations: 0,
      awaiting_review: 0,
      saved: 0,
      passed: 0,
      applications: 0,
      latest_recommendation_at: "",
    },
  ],
};

test("a regular member has no Admin tab and uses the avatar for Settings and Log out", async ({ page, request }) => {
  await resetWorker(request);
  await openDashboard(page);

  await expect(page.getByRole("button", { name: /^Admin$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Settings$/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Open account menu" }).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeVisible();

  await menu.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: /Keep your scout useful/ })).toBeVisible();
});

test("the authorized account can inspect per-user recommendation stats", async ({ page, request }) => {
  const current = await workerState(request);
  await resetWorker(request, {
    member: { ...current.member, id: "cand-admin", is_admin: true },
    adminStats,
  });
  await openDashboard(page);

  await page.getByRole("button", { name: /^Admin$/ }).click();
  await expect(page.getByRole("heading", { name: "Recommendation overview" })).toBeVisible();
  await expect(page.getByText("14", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Jordan Lee/ })).toContainText(/7\s*3\s*2\s*2\s*1/);

  const state = await workerState(request);
  expect(state.requests.filter(({ action }) => action === "admin_stats")).toHaveLength(1);
});

test("the account menu closes with Escape and returns focus to its trigger", async ({ page, request }) => {
  await resetWorker(request);
  await openDashboard(page);

  const trigger = page.getByRole("button", { name: "Open account menu" });
  await trigger.click();
  await expect(page.getByRole("menu", { name: "Account" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Account" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the member menu supports keyboard navigation and updates delivery state", async ({ page, request }) => {
  const current = await workerState(request);
  await resetWorker(request, {
    member: { ...current.member, id: "cand-admin", is_admin: true },
    adminStats,
  });
  await openDashboard(page);
  await page.getByRole("button", { name: /^Admin$/ }).click();

  const trigger = page.getByRole("button", { name: "Manage Jordan Lee" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Manage Jordan Lee" });
  await expect(menu.getByRole("menuitem", { name: /Access code/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Copy email" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await menu.getByRole("menuitem", { name: "Resume delivery" }).click();
  await expect(page.getByRole("row", { name: /Jordan Lee/ })).toContainText("Active");
  const state = await workerState(request);
  expect(state.requests).toContainEqual(expect.objectContaining({
    action: "admin_manage",
    payload: expect.objectContaining({ op: "resume", member_id: "cand-member" }),
  }));
});

test("the destructive confirmation traps focus, closes with Escape, and deletes after confirmation", async ({ page, request }) => {
  const current = await workerState(request);
  await resetWorker(request, {
    member: { ...current.member, id: "cand-admin", is_admin: true },
    adminStats,
  });
  await openDashboard(page);
  await page.getByRole("button", { name: /^Admin$/ }).click();

  const trigger = page.getByRole("button", { name: "Manage Jordan Lee" });
  await trigger.click();
  const deleteItem = page.getByRole("menuitem", { name: "Delete member" });
  await deleteItem.click();
  const dialog = page.getByRole("dialog", { name: "Delete member" });
  const confirm = dialog.getByRole("button", { name: "Delete member" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(deleteItem).toBeFocused();

  await page.getByRole("menuitem", { name: "Revoke access" }).click();
  const revokeDialog = page.getByRole("dialog", { name: "Revoke access" });
  await revokeDialog.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("row", { name: /Jordan Lee/ })).toContainText("Revoked");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole("menuitem", { name: "Delete member" }).click();
  await dialog.getByRole("button", { name: "Delete member" }).click();
  await expect(page.getByRole("row", { name: /Jordan Lee/ })).toHaveCount(0);
  const state = await workerState(request);
  expect(state.requests).toContainEqual(expect.objectContaining({
    action: "admin_manage",
    payload: expect.objectContaining({ op: "delete", member_id: "cand-member" }),
  }));
});
