// Replacing a resume commits a filename and extracted text from two different
// async steps. The order those steps finish in is not the order they started in,
// and the form used to trust it: the filename was written before the parse, and
// nothing checked whether the parse that came back was still the one being
// waited for.
import { expect, test } from "@playwright/test";
import { openDashboard, openEditor, resetWorker } from "./support.mjs";

// A plain-text upload avoids pulling a PDF engine into the assertion: the race
// being tested is in the form, not in the parser.
const upload = async (page, name, body, { delayMs = 0 } = {}) => {
  if (delayMs) {
    await page.evaluate(async (ms) => {
      // Slow the next FileReader/text() read so a second upload can overtake it.
      const original = Blob.prototype.text;
      let armed = true;
      Blob.prototype.text = function slowText(...args) {
        if (!armed) return original.apply(this, args);
        armed = false;
        return new Promise((resolve) => {
          setTimeout(() => resolve(original.apply(this, args)), ms);
        });
      };
    }, delayMs);
  }
  await page.locator('.resume-field input[type="file"]').setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  });
};

const openProfileTab = async (page) => {
  await openEditor(page);
  await page.getByRole("tab", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile and resume" })).toBeVisible();
};

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("a resume that cannot be read leaves the last working one in place", async ({ page, request }) => {
  await openDashboard(page);
  await openProfileTab(page);
  await expect(page.getByText("alex-morgan-resume.pdf")).toBeVisible();

  await upload(page, "empty.txt", "   \n  \n ");

  await expect(page.getByRole("alert")).toContainText(/couldn’t read that file/i);
  // The filename never moved, because nothing behind it did.
  await expect(page.getByText("alex-morgan-resume.pdf")).toBeVisible();
  await expect(page.getByText("empty.txt")).toHaveCount(0);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);
  const save = (await (await request.get("/__test/state")).json()).requests
    .filter((entry) => entry.action === "preferences")
    .at(-1);
  expect(save.payload.resume_name).toBe("alex-morgan-resume.pdf");
});

test("a slow first upload cannot overwrite the file that replaced it", async ({ page, request }) => {
  await openDashboard(page);
  await openProfileTab(page);

  const slow = "Alexandra Slow\nslow@example.com\nStaff Data Engineer at Slowly\n".repeat(12);
  const fast = "Bruno Fast\nbruno@example.com\nPrincipal Brand Designer at Quickly\n".repeat(12);

  await upload(page, "slow-resume.txt", slow, { delayMs: 1200 });
  await upload(page, "fast-resume.txt", fast);

  await expect(page.getByText("fast-resume.txt")).toBeVisible();
  // Long enough for the first parse to land if anything still let it through.
  await page.waitForTimeout(2000);
  await expect(page.getByText("fast-resume.txt")).toBeVisible();
  await expect(page.getByText("slow-resume.txt")).toHaveCount(0);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/step=dashboard/);

  const save = (await (await request.get("/__test/state")).json()).requests
    .filter((entry) => entry.action === "preferences")
    .at(-1);
  // The name and the text belong to the same file — the pairing that used to break.
  expect(save.payload.resume_name).toBe("fast-resume.txt");
  expect(save.payload.resume_text).toContain("Bruno Fast");
  expect(save.payload.resume_text).not.toContain("Alexandra Slow");
});

test("saving is blocked while a resume is still being read", async ({ page }) => {
  await openDashboard(page);
  await openProfileTab(page);

  await upload(page, "slow-resume.txt", "Casey Reader\ncasey@example.com\n".repeat(20), {
    delayMs: 1500,
  });

  const save = page.getByRole("button", { name: /Reading your resume/ });
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();

  await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled({ timeout: 10000 });
});
