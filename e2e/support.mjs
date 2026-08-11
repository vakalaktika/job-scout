// Shared setup for the browser tests: put the fake Worker into a known state and
// open the app already signed in, so each test starts from the member journey it
// is actually about.
import { expect } from "@playwright/test";

export const SESSION_KEY = "job-scout-session-v1";

export const resetWorker = async (request, patch = {}) => {
  const response = await request.post("/__test/reset", { data: patch });
  expect(response.ok()).toBeTruthy();
};

export const workerState = async (request) => (await request.get("/__test/state")).json();

// Seed a session before the bundle boots, so the app resolves straight to the
// dashboard rather than through the invite gate.
export const signIn = async (page) => {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      SESSION_KEY,
      JSON.stringify({
        token: "session-token-e2e",
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      }),
    ],
  );
};

export const openDashboard = async (page) => {
  await signIn(page);
  await page.goto("/index.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/step=dashboard/);
};

export const openEditor = async (page) => {
  await page.getByRole("button", { name: /^Settings$/ }).click();
  await page.getByRole("button", { name: /Edit preferences|Review preferences/ }).first().click();
  await expect(page.getByRole("heading", { name: "Edit your preferences" })).toBeVisible();
};

export const rolesField = (page) => page.getByRole("textbox", { name: "Target roles" });
