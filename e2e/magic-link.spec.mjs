// A sign-in link that fails used to be stripped from the URL and reloaded into
// the invite gate with nothing on screen to say why — the one screen the link
// exists to let someone skip. Every failure now names itself and offers a way
// forward, and the token never survives in the address bar.
import { expect, test } from "@playwright/test";
import { resetWorker, SESSION_KEY } from "./support.mjs";

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("a valid link signs the member in and takes the token out of the URL", async ({ page }) => {
  await page.goto("/index.html?login=good-token");

  await expect(page.getByRole("heading", { name: /Here’s what we found/ })).toBeVisible();
  await expect(page).not.toHaveURL(/login=/);
  expect(await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY)).toContain(
    "session-token-e2e",
  );
});

test("an expired link says it expired and offers another one", async ({ page }) => {
  await page.goto("/index.html?login=expired");

  const banner = page.getByRole("alert").filter({ hasText: "expired" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("15 minutes");
  await expect(banner.getByRole("link", { name: "Send another link" })).toHaveAttribute(
    "href",
    "./login.html",
  );
  // The invite code is still a way in, so the gate stays usable behind the banner.
  await expect(page.getByRole("textbox", { name: /Invite code/ })).toBeVisible();
  await expect(page).not.toHaveURL(/login=/);
});

test("a link that has already been used says so rather than failing silently", async ({ page }) => {
  await page.goto("/index.html?login=good-token");
  await expect(page.getByRole("heading", { name: /Here’s what we found/ })).toBeVisible();

  await page.evaluate((key) => window.localStorage.removeItem(key), SESSION_KEY);
  await page.goto("/index.html?login=good-token");

  await expect(page.getByRole("alert").filter({ hasText: "already been used" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send another link" })).toBeVisible();
});

test("a link the client cannot read is reported as unreadable, not as expired", async ({ page }) => {
  await page.goto("/index.html?login=broken");

  await expect(page.getByRole("alert").filter({ hasText: "couldn’t read that sign-in link" })).toBeVisible();
});

test("a transient failure invites another try instead of blaming the account", async ({ page }) => {
  await page.goto("/index.html?login=wobbly");

  const banner = page.getByRole("alert").filter({ hasText: "couldn’t sign you in" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Nothing is wrong with your account/);
});

// A bearer credential in the address bar reaches history, the referrer, and
// anything the member pastes. It is removed before the exchange, not after it.
test("the sign-in token never stays in the address bar", async ({ page }) => {
  const seen = [];
  page.on("framenavigated", (frame) => frame === page.mainFrame() && seen.push(frame.url()));
  await page.goto("/index.html?login=expired");
  await expect(page.getByRole("alert")).toBeVisible();

  expect(page.url()).not.toContain("login=");
  expect(seen.filter((url) => url.includes("login=")).length).toBeLessThanOrEqual(1);
});
