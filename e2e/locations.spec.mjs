import { expect, test } from "@playwright/test";
import { openDashboard, openEditor, resetWorker, workerState } from "./support.mjs";

test.beforeEach(async ({ request }) => resetWorker(request));

const addLocation = async (page, country, state = "", city = "") => {
  await page.getByRole("combobox", { name: /^Country/ }).selectOption(country);
  if (state) await page.getByRole("combobox", { name: /State \/ region/ }).selectOption(state);
  if (city) await page.getByRole("combobox", { name: /^City/ }).selectOption(city);
  await page.getByRole("button", { name: "Add location", exact: true }).click();
};

for (const preview of ["intake", "edit"]) {
  test(`${preview} supports Romanian cities, whole countries, regions, and Remote`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/index.html?preview=${preview}`);
    if (preview === "intake") {
      await page.getByRole("button", { name: /^Continue/ }).click();
      await page.getByRole("button", { name: /^Continue/ }).click();
    } else {
      await page.getByRole("tab", { name: "Location & pay" }).click();
    }
    await page.getByRole("button", { name: /^Remove Oakland/ }).click();
    await addLocation(page, "Romania", "Bucharest", "Bucharest");
    await addLocation(page, "Romania", "Cluj", "Cluj-Napoca");
    await addLocation(page, "Romania");
    await addLocation(page, "European Union");
    await addLocation(page, "Remote");
    const locations = page.locator(".preferred-location-list li");
    await expect(locations).toHaveCount(5);
    for (const label of ["Bucharest", "Cluj-Napoca", "Romania", "European Union", "Remote"]) {
      await expect(locations.locator("strong").filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }
    await expect(page.getByRole("checkbox", { name: /On-site/ })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Hybrid/ })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Remote only/ })).toBeChecked();
    await expect(page.getByRole("button", { name: "Location limit reached" })).toBeDisabled();
    await page.screenshot({ path: `.context/locations-${preview}-mobile.png`, fullPage: true });
    await page.getByRole("button", { name: "Remove Remote", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /On-site/ })).toBeEnabled();
    await page.getByRole("checkbox", { name: /On-site/ }).click();
    await expect(page.getByRole("checkbox", { name: /On-site/ })).toBeChecked();
    await addLocation(page, "Romania", "Cluj");
    await expect(locations.locator("strong").filter({ hasText: /^Cluj$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("country-wide and Remote preferences survive saving and a fresh session", async ({ page, request }) => {
  await openDashboard(page);
  await openEditor(page);
  await page.getByRole("tab", { name: "Location & pay" }).click();
  await page.getByRole("button", { name: /^Remove Oakland/ }).click();
  await addLocation(page, "Romania");
  await addLocation(page, "European Union");
  await addLocation(page, "Remote");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);
  const save = (await workerState(request)).requests.filter(({ action }) => action === "preferences").at(-1);
  expect(save.payload.regions).toBe("Romania; European Union; Remote");
  expect(save.payload.work_modes).toEqual(["remote"]);
  expect(save.payload.remote).toBe("Yes");
  await page.reload();
  await openEditor(page);
  await page.getByRole("tab", { name: "Location & pay" }).click();
  await expect(page.locator(".preferred-location-list li")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Remove Romania", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /On-site/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Hybrid/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Remote only/ })).toBeChecked();
});
