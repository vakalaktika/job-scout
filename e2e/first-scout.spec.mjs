// The one-time first scout has five states and the dashboard used to describe
// the failed one as needing "another try" while rendering nothing that could
// make one. Each state is checked here for what it says and for what it offers.
import { expect, test } from "@playwright/test";
import { openDashboard, resetWorker, workerState } from "./support.mjs";

const scout = (status, extra = {}) => ({
  firstScout: { status, requested_at: "", completed_at: "", can_retry: false, ...extra },
  jobs: [],
});

test("an entitled member is offered the one-time run and starting it says so", async ({ page, request }) => {
  await resetWorker(request, scout("available"));
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "See what your scout can find now." })).toBeVisible();
  await page.getByRole("button", { name: "Find my first matches" }).click();

  await expect(page.getByRole("heading", { name: "Your scout is searching" })).toBeVisible();
  expect((await workerState(request)).firstScout.status).toBe("queued");
});

test("a running scout says it is running and offers no second start", async ({ page, request }) => {
  await resetWorker(request, scout("queued"));
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "Your scout is searching" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find my first matches" })).toHaveCount(0);
});

test("a completed scout with nothing to show says so without offering a rerun", async ({ page, request }) => {
  await resetWorker(request, scout("complete"));
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "Your first scout finished." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Find my first matches|Try again/ })).toHaveCount(0);
});

// The state this whole path exists for: a dispatch that never happened, which is
// retryable, and one that has run out of attempts, which is not.
test("a failed scout that can be retried offers the retry and starts it", async ({ page, request }) => {
  await resetWorker(request, {
    ...scout("failed", { can_retry: true }),
    scoutStatusAfterStart: { status: "queued", requested_at: "", completed_at: "", can_retry: false },
  });
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "Your first scout didn’t start." })).toBeVisible();
  await expect(page.getByText(/still yours to use/)).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Your scout is searching" })).toBeVisible();
});

test("a failed scout with no attempts left names the next step instead of promising a retry", async ({
  page,
  request,
}) => {
  await resetWorker(request, scout("failed", { can_retry: false }));
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "We couldn’t start your first scout." })).toBeVisible();
  await expect(page.getByText(/reply to your invitation email/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again|Find my first matches/ })).toHaveCount(0);
  // The route that is still open stays open.
  await expect(page.getByRole("button", { name: /Review preferences/ })).toBeVisible();
});

test("a member with no entitlement is told the regular schedule is what runs", async ({ page, request }) => {
  await resetWorker(request, scout("unavailable"));
  await openDashboard(page);

  await expect(page.getByRole("heading", { name: "Your preferences are saved." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again|Find my first matches/ })).toHaveCount(0);
});
