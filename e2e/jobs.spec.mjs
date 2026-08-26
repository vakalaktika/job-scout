// Decisions and application tracking shared one "which job is busy" value, so a
// second card's response re-enabled the first card's controls and a late reply
// overwrote whatever had been asked for since. These tests click faster than the
// network answers, which is the only way that shows up.
import { expect, test } from "@playwright/test";
import { openDashboard, resetWorker, workerState } from "./support.mjs";

const card = (page, index) =>
  page.getByRole("article").filter({ hasText: `Senior Product Designer ${index}` });

// "New" is a view of what is still unreviewed, so a card leaves it the moment a
// decision lands. These tests follow one card through several decisions, so they
// watch it from "All", where every posting stays visible.
const showAll = async (page) => {
  await page.getByRole("tab", { name: /^All/ }).click();
  await expect(page.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
};

test.beforeEach(async ({ request }) => {
  await resetWorker(request);
});

test("a collapsed job previews its summary and expanded details do not repeat the match reason", async ({ page, request }) => {
  await openDashboard(page);

  const firstCard = card(page, 1);
  await expect(firstCard.getByText("Owns the end-to-end design of the payments experience.")).toBeVisible();
  await expect(firstCard.getByText("Your payments and design-systems work lines up with this team.")).toHaveCount(0);

  await firstCard.getByRole("button", { name: "Job brief" }).click();

  await expect(firstCard.getByText("Job summary")).toBeVisible();
  await expect(firstCard.getByText("Why it matched")).toBeVisible();
  await expect(firstCard.getByText("Your payments and design-systems work lines up with this team.")).toBeVisible();
  await expect(firstCard.locator(".job-match-note")).toHaveCount(0);

  const state = await workerState(request);
  expect(state.requests.filter(({ action }) => action === "job_brief")).toHaveLength(0);
});

test("opening an incomplete brief prepares and replaces it without a reload", async ({ page, request }) => {
  const current = await workerState(request);
  const incomplete = {
    ...current.jobs[0],
    summary: "",
    key_requirements: "",
    brief_status: "Pending",
  };
  await resetWorker(request, {
    jobs: [incomplete, current.jobs[1]],
    delays: { job_brief: 350 },
    briefResults: {
      "job-1": {
        summary: "Runs the production floor, team, safety, and daily output.",
        match_reason: "Your manufacturing supervision background maps directly to this team.",
        key_requirements: "People leadership; safety; lean manufacturing.",
        brief_status: "Ready",
      },
    },
  });
  await openDashboard(page);

  const firstCard = card(page, 1);
  await firstCard.getByRole("button", { name: "Job brief" }).click();
  await expect(firstCard.getByRole("status")).toContainText("Preparing your job brief");
  await expect(firstCard.getByText("Runs the production floor, team, safety, and daily output.")).toBeVisible();
  await expect(firstCard.getByText("Your manufacturing supervision background maps directly to this team.")).toBeVisible();

  const state = await workerState(request);
  expect(state.requests.filter(({ action }) => action === "job_brief")).toHaveLength(1);
});

test("a failed brief request is explained and can be retried", async ({ page, request }) => {
  const current = await workerState(request);
  await resetWorker(request, {
    jobs: [{ ...current.jobs[0], summary: "", key_requirements: "", brief_status: "Pending" }, current.jobs[1]],
    failures: { job_brief: { status: 503, error: "brief_enrichment_unconfigured" } },
  });
  await openDashboard(page);

  const firstCard = card(page, 1);
  await firstCard.getByRole("button", { name: "Job brief" }).click();

  await expect(firstCard.getByRole("alert")).toContainText("We couldn’t prepare this brief yet");
  await expect(firstCard.getByRole("button", { name: "Try again" })).toBeVisible();

  await request.post("/__test/state", {
    data: {
      failures: {},
      briefResults: {
        "job-1": {
          summary: "Runs the production floor, team, safety, and daily output.",
          match_reason: "Your manufacturing supervision background maps directly to this team.",
          key_requirements: "People leadership; safety; lean manufacturing.",
          brief_status: "Ready",
        },
      },
    },
  });
  await firstCard.getByRole("button", { name: "Try again" }).click();
  await expect(firstCard.getByText("Runs the production floor, team, safety, and daily output.")).toBeVisible();

  const state = await workerState(request);
  expect(state.requests.filter(({ action }) => action === "job_brief")).toHaveLength(2);
});

test("rapid brief opens share one enrichment request", async ({ page, request }) => {
  const current = await workerState(request);
  await resetWorker(request, {
    jobs: [{ ...current.jobs[0], summary: "", key_requirements: "", brief_status: "Pending" }, current.jobs[1]],
    delays: { job_brief: 350 },
    briefResults: {
      "job-1": {
        summary: "Runs the production floor, team, safety, and daily output.",
        match_reason: "Your manufacturing supervision background maps directly to this team.",
        key_requirements: "People leadership; safety; lean manufacturing.",
        brief_status: "Ready",
      },
    },
  });
  await openDashboard(page);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes("Job brief"));
    // Open, close, then reopen before enrichment resolves. The third click
    // exercises the per-job request lock rather than merely the disclosure.
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(card(page, 1).getByText("Runs the production floor, team, safety, and daily output.")).toBeVisible();

  const state = await workerState(request);
  expect(state.requests.filter(({ action }) => action === "job_brief")).toHaveLength(1);
});

// The exact shape of the old bug: a slow save on one card and a fast one on
// another. When the fast one landed it cleared the single busy value, handing the
// slow card's controls back while its request was still in the air.
test("a fast save on one job does not re-enable another job that is still saving", async ({ page, request }) => {
  await resetWorker(request, { jobDelays: { "job-1": 2500, "job-2": 150 } });
  await openDashboard(page);
  await showAll(page);

  await card(page, 1).getByRole("button", { name: /as interested$/ }).click();
  await card(page, 2).getByRole("button", { name: /as interested$/ }).click();

  // The fast card finishes and settles into its own state.
  await expect(card(page, 2).getByRole("button", { name: /from your saved jobs$/ })).toBeEnabled({
    timeout: 5000,
  });
  // The slow card is still working, so its controls are still held.
  await expect(card(page, 1).getByRole("button", { name: /as interested$/ })).toBeDisabled();

  await expect(card(page, 1).getByRole("button", { name: /from your saved jobs$/ })).toBeEnabled({
    timeout: 5000,
  });
  const state = await workerState(request);
  expect(state.jobs.filter((job) => job.decision === "Interested")).toHaveLength(2);
});

test("a decision can be taken back and the card says which state it is in", async ({ page, request }) => {
  await openDashboard(page);
  await showAll(page);

  await card(page, 1).getByRole("button", { name: /as interested$/ }).click();
  await expect(page.getByText("Saved to your shortlist.")).toBeVisible();
  const undo = card(page, 1).getByRole("button", { name: /from your saved jobs$/ });
  await expect(undo).toBeVisible();

  await undo.click();
  await expect(card(page, 1).getByRole("button", { name: /as interested$/ })).toBeVisible();
  expect((await workerState(request)).jobs[0].decision).toBe("");
});

test("a pass is reversible and the posting comes back with its reason", async ({ page, request }) => {
  await openDashboard(page);

  await card(page, 1).getByRole("button", { name: /^Not interested in/ }).click();
  await card(page, 1).getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText(/Find it under Not interested/)).toBeVisible();
  await page.getByRole("tab", { name: /^Not interested/ }).click();
  await expect(page.getByText("You passed on this: Pay")).toBeVisible();

  await card(page, 1).getByRole("button", { name: /^Put .* back in your job list$/ }).click();
  await expect(page.getByText("Back in your job list.")).toBeVisible();
  expect((await workerState(request)).jobs[0].decision).toBe("");
});

test("application tracking records the status the member last chose", async ({ page, request }) => {
  await openDashboard(page);
  await showAll(page);

  await card(page, 1).getByRole("button", { name: /as interested$/ }).click();
  await card(page, 1).getByRole("button", { name: "Applied", exact: true }).click();
  await expect(page.getByText("Tracked as applied.")).toBeVisible();

  await card(page, 1).getByRole("button", { name: "Interviewing", exact: true }).click();
  await expect(page.getByText("Tracked as interviewing.")).toBeVisible();

  expect((await workerState(request)).jobs[0].application_status).toBe("Interviewing");
  await expect(page.getByRole("tab", { name: /^Applied/ })).toBeVisible();
});

// The property the ticketing buys: however fast a member changes their mind on
// one posting, the last thing they clicked is the thing that ends up stored and
// the thing that ends up on screen.
test("rapid changes of mind on one posting end in click-order-consistent state", async ({ page, request }) => {
  await resetWorker(request, { delays: { job_decision: 400 } });
  await openDashboard(page);
  await showAll(page);

  const saved = () => card(page, 1).getByRole("button", { name: /from your saved jobs$/ });
  const unsaved = () => card(page, 1).getByRole("button", { name: /as interested$/ });

  await unsaved().click();
  await expect(saved()).toBeEnabled({ timeout: 5000 });
  await saved().click();
  await expect(unsaved()).toBeEnabled({ timeout: 5000 });
  await unsaved().click();
  await expect(saved()).toBeEnabled({ timeout: 5000 });

  const state = await workerState(request);
  expect(state.jobs[0].decision).toBe("Interested");
  expect(state.requests.filter((entry) => entry.action === "job_decision")).toHaveLength(3);
});

// Two postings mutated at once must not be reported against each other: the
// scalar this replaced meant the second job's toast described the first.
test("two jobs mutated at once each end in their own state", async ({ page, request }) => {
  await resetWorker(request, { jobDelays: { "job-1": 800, "job-2": 150 } });
  await openDashboard(page);
  await showAll(page);

  await card(page, 1).getByRole("button", { name: /as interested$/ }).click();
  await card(page, 2).getByRole("button", { name: /^Not interested in/ }).click();
  const reason = card(page, 2).getByRole("button", { name: "Pay", exact: true });
  await expect(reason).toBeEnabled();
  await reason.click();

  await expect(card(page, 1).getByRole("button", { name: /from your saved jobs$/ })).toBeEnabled({
    timeout: 5000,
  });
  await expect(page.getByRole("tab", { name: /^Not interested 1/ })).toBeVisible();

  const state = await workerState(request);
  expect(state.jobs[0].decision).toBe("Interested");
  expect(state.jobs[1].decision).toBe("Not interested");
});
