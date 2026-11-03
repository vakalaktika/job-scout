import assert from "node:assert/strict";
import test from "node:test";

import { buildProfileExport } from "./profile-export.mjs";
import { escapeHtml, renderProfileHtml, renderProfileMarkdown } from "./profile-export-render.mjs";

const HOSTILE = "<script>alert(1)</script>";

const profile = (overrides = {}, jobs = [], resumeText = "Senior designer with | pipes and ```fences```") =>
  buildProfileExport({
    member: {
      id: "cand-1",
      name: "Alex Morgan",
      email: "alex@example.com",
      status: "Active",
      frequency: "Daily",
      target_roles: "Product Designer",
      regions: "Remote",
      min_salary: "$140k",
      seniority: "Senior+",
      remote: "Yes",
      work_modes: ["remote"],
      notes: "Keywords: systems\nMaximum salary: $220k+\nResume file: alex.pdf",
      steer_away_terms: "crypto",
      steer_away_mode: "rank",
      resume_suggestions: [],
      match_context: "Pay — too low",
      ...overrides,
    },
    jobs,
    resumeText,
    generatedAt: "2026-11-03T10:00:00.000Z",
    narrative: overrides.narrative,
  });

const jobs = [
  { title: "Lead Designer", company: "Acme", location: "Remote", salary: "$180k", url: "https://acme.example/jobs/1", decision: "Interested", application_status: "Applied", primary_domain: "Design", workplace_type: "Remote" },
  { title: "Designer", company: "Evil Corp", location: "NYC", salary: "", url: "javascript:alert(1)", decision: "Interested", primary_domain: "", workplace_type: "" },
  { title: "PM", company: "Initech", location: "Austin", decision: "Not interested", feedback: "Pay — too low | really" },
];

test("escapeHtml neutralises markup and quotes", () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
});

test("HTML export escapes every member- and posting-supplied field", () => {
  const hostileJobs = [
    { title: HOSTILE, company: HOSTILE, location: HOSTILE, salary: HOSTILE, url: "https://ok.example/" + HOSTILE, decision: "Interested", primary_domain: HOSTILE, workplace_type: HOSTILE },
    { title: HOSTILE, company: HOSTILE, decision: "Not interested", feedback: `Pay — ${HOSTILE}` },
  ];
  const html = renderProfileHtml(
    [profile({ name: HOSTILE, email: HOSTILE, target_roles: HOSTILE, notes: `Keywords: ${HOSTILE}`, match_context: HOSTILE, narrative: { status: "ready", text: HOSTILE } }, hostileJobs, HOSTILE)],
    { generatedAt: "2026-11-03T10:00:00.000Z" },
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<link|<script src|src="http/);
  assert.match(html, /^<!doctype html>/);
});

test("HTML export links only public http(s) posting URLs", () => {
  const html = renderProfileHtml([profile({}, jobs)]);
  assert.match(html, /<a href="https:\/\/acme\.example\/jobs\/1" rel="noopener noreferrer">Posting<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Pay \(1\)/);
  assert.match(html, /too low \| really/);
});

test("HTML export renders empty states and the narrative fallback", () => {
  const html = renderProfileHtml([profile({ match_context: "", notes: "" }, [], "")]);
  assert.match(html, /No saved jobs yet\./);
  assert.match(html, /No passed jobs yet\./);
  assert.match(html, /No résumé text on file\./);
  assert.match(html, /None recorded\./);
  assert.match(html, /No file recorded/);
  assert.match(html, /AI summary unavailable\./);
  assert.doesNotMatch(html, /narrative_skipped/);
  const withReason = renderProfileHtml([profile({ narrative: { status: "unavailable", reason: "openai_error" } })]);
  assert.match(withReason, /AI summary unavailable\. \(openai_error\)/);
});

test("HTML export separates several members with a table of contents and page breaks", () => {
  const html = renderProfileHtml([profile({ name: "One" }), profile({ name: "Two", id: "cand-2" })], { generatedAt: "2026-11-03T10:00:00.000Z" });
  assert.equal(html.match(/<article class="member"/g).length, 2);
  assert.match(html, /<nav aria-label="Members"><ol><li><a href="#member-1">One<\/a><\/li><li><a href="#member-2">Two<\/a><\/li>/);
  assert.match(html, /article\.member\+article\.member\{break-before:page/);
  assert.match(html, /2 members · generated 2026-11-03 10:00 UTC/);
});

test("Markdown export has one H1 per member, escaped tables, and safe fences", () => {
  const md = renderProfileMarkdown([profile({}, jobs)]);
  assert.match(md, /^# Alex Morgan\n/);
  assert.match(md, /\| Lead Designer \| Acme \| Remote \| \$180k \| Applied \| \[Posting\]\(https:\/\/acme\.example\/jobs\/1\) \|/);
  assert.match(md, /\| PM \| Initech \| Pay \| too low \\\| really \|/);
  assert.doesNotMatch(md, /\[Posting\]\(javascript:/);
  assert.match(md, /- \*\*Target roles:\*\* Product Designer/);
  assert.match(md, /- \*\*Maximum salary:\*\* \$220k\+/);
  assert.match(md, /\*\*File:\*\* alex\.pdf/);
  // The résumé contains a triple-backtick run, so the fence must be four long.
  assert.match(md, /````text\nSenior designer with \| pipes and ```fences```\n````/);
  assert.match(md, /## AI summary\n\n_AI-generated[^\n]*_\n\nAI summary unavailable\.\n/);
  const withReason = renderProfileMarkdown([profile({ narrative: { status: "unavailable", reason: "openai_error" } })]);
  assert.match(withReason, /AI summary unavailable\. \(`openai_error`\)/);
  const hostileReason = renderProfileMarkdown([profile({ narrative: { status: "unavailable", reason: "openai_401:Incorrect API key sk-proj-abc" } })]);
  assert.doesNotMatch(hostileReason, /sk-proj/);
  assert.ok(md.endsWith("\n"));
});

test("Markdown export neutralises links, images, HTML, and breakouts in free text", () => {
  const md = renderProfileMarkdown([
    profile(
      { name: "[Verified](https://evil.example) ![x](http://t.example/b.png) <img src=//t.example/a.png> back\\", match_context: "Pay — see `code` and *bold*" },
      [
        { title: "Trailing backslash\\", company: "Acme", decision: "Interested", url: "http://e.com/x)![t](http://t.example/p.png" },
        { title: "Newline url", company: "Acme", decision: "Interested", url: "http://e.com/x\n\n# INJECTED\n[pay](http://evil.example)" },
      ],
    ),
  ]);
  assert.match(md, /^# \\\[Verified\\\]\(https:\/\/evil\.example\) !\\\[x\\\]\(http:\/\/t\.example\/b\.png\) &lt;img src=\/\/t\.example\/a\.png&gt; back\\\\\n/);
  assert.doesNotMatch(md, /\]\(http:\/\/t\.example\/p\.png\)/);
  assert.doesNotMatch(md, /# INJECTED/);
  assert.match(md, /\| \[Posting\]\(http:\/\/e\.com\/x%29!\[t\]%28http:\/\/t\.example\/p\.png\) \|/);
  assert.match(md, /\| \[Posting\]\(http:\/\/e\.com\/x#%20INJECTED\[pay\]%28http:\/\/evil\.example%29\) \|/);
  assert.match(md, /\| Trailing backslash\\\\ \| Acme \|/);
  assert.match(md, /- Pay — see \\`code\\` and \\\*bold\\\*/);
  assert.match(md, /_AI-generated from member-supplied data; unverified\._/);
});

test("HTML export re-serialises posting links and ships a no-network CSP", () => {
  const html = renderProfileHtml([profile({}, [{ title: "T", company: "C", decision: "Interested", url: "https://acme.example/a b?q=(1)" }])]);
  assert.match(html, /href="https:\/\/acme\.example\/a%20b\?q=%281%29"/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">/);
  assert.match(html, /AI-generated from member-supplied data; unverified\./);
});

test("Markdown export combines several members under a table of contents", () => {
  const md = renderProfileMarkdown([profile({ name: "One" }), profile({ name: "Two" })], { generatedAt: "2026-11-03T10:00:00.000Z" });
  assert.match(md, /^# Job Scout member profiles\n\n2 members · generated 2026-11-03 10:00 UTC\n\n1\. \[One\]\(#member-1\)\n2\. \[Two\]\(#member-2\)/);
  assert.equal(md.match(/^# (One|Two)/gm).length, 2);
  assert.match(md, /<a id="member-2"><\/a>/);
  assert.match(md, /\n---\n/);
});
