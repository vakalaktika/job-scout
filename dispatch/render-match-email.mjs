// dispatch/render-match-email.mjs
// Reference call site for the deterministic match-alert email builder.
//
// Where the real dispatcher lives (as of 2026-08-07): the scheduled routine
// (trig_01LZtNUf7LVFzw3C2Fyy9QEw) no longer builds HTML at all — it POSTs job JSON to
// the `job-scout-backup-dispatcher` Cloudflare Worker's /send-email endpoint, which
// fetches the published template and fills it. That worker is deployed from the
// Cloudflare dashboard (not from any repo); fetch/redeploy its source via the Workers
// Scripts API. It now applies the same deterministic fill as buildEmail() below —
// including the {{WORKPLACE_LABEL}} badge fill/strip and a leak guard that falls back
// to plain text if any {{token}} would survive.
//
// This module remains the reference implementation: any future dispatcher should map
// its sent-posting records through toPosting() and fill the template with buildEmail()
// instead of having an LLM hand-fill email-template.html — the step that originally
// leaked {{WORKPLACE_LABEL}} into sent mail.
//
// Node + Deno/Supabase Edge both resolve `node:` specifiers, so this reads the shipped
// template relative to itself. buildEmail() / toPosting() stay pure; only this call
// site touches the filesystem.
//
//   import { renderMatchEmail } from "./dispatch/render-match-email.mjs";
//   const html = renderMatchEmail(email, records);
//   if (html === null) return; // zero postings -> do not send

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEmail, toPosting } from "../build-email.mjs";

const TEMPLATE_URL = new URL("../email-template.html", import.meta.url);

/**
 * Render the full match-alert email from candidate context + sent-posting records.
 *
 * @param {{headline:string, runDate:string, firstName:string}} email
 * @param {import("../build-email.mjs").PipelineRecord[]} records  Pipeline/Notion records.
 * @param {{ now?: Date, templateHtml?: string, keepPosting?: (p:any)=>boolean }} [opts]
 *        templateHtml: inject the template instead of reading it from disk (tests).
 *        now: reference time for freshness (defaults to current time).
 *        keepPosting: link-liveness predicate forwarded to buildEmail.
 * @returns {string|null} Filled HTML, or null when there is nothing to send.
 */
export function renderMatchEmail(email, records, opts = {}) {
  const templateHtml = opts.templateHtml ?? readFileSync(fileURLToPath(TEMPLATE_URL), "utf8");
  const postings = records.map((record) => toPosting(record, opts));
  return buildEmail(templateHtml, email, postings, opts);
}
