import { readFile, writeFile } from "node:fs/promises";

// The dashboard component has no readable source — it exists only as minified code
// in the shipped bundle. Every dashboard-side fix therefore lives here as an exact
// string replacement, in the same style as patch-intake-flow.mjs, so the changes
// stay reviewable and re-appliable instead of being invisible hand-edits.
//
// Each patch is idempotent: if the replacement is already present the patch is a
// no-op, and if neither the original nor the replacement can be found it throws
// rather than silently producing a bundle that is missing a fix.

// Both shipped artifacts are patchable: "js" is the dashboard bundle, "css" the
// stylesheet it loads. Patches target the bundle unless they say otherwise.
const targetPaths = {
  js: new URL("./assets/index-BdD4MZod.js", import.meta.url),
  css: new URL("./assets/index-uR5-NbPW.css", import.meta.url),
};
const sources = {
  js: await readFile(targetPaths.js, "utf8"),
  css: await readFile(targetPaths.css, "utf8"),
};

const patches = [];
const applied = [];
const skipped = [];

const patch = (name, from, to, target = "js") => patches.push({ name, from, to, target });

// ---------------------------------------------------------------------------
// Location no longer resets to San Francisco.
//
// The session hydration merge restored every profile field except country, state,
// and city, so the stored location was never read back. Both write paths then
// serialised the untouched V3 defaults straight back to Notion — which meant that
// simply changing your delivery frequency rewrote your location to San Francisco.
// ---------------------------------------------------------------------------

// Resolve the stored region against the gazetteer g1 so the cascading selects are
// always given a country/state/city triple they can actually render. Anything the
// gazetteer does not know falls back to the value already on screen.
const regionHelper =
  "function __jsRegion(m,cur){" +
  'const c=m&&m.region_country||"",s=m&&m.region_state||"",y=m&&m.region_city||"";' +
  "if(!c||!g1[c])return{country:cur.country,state:cur.state,city:cur.city};" +
  "const st=g1[c][s]?s:Object.keys(g1[c])[0],ct=g1[c][st].indexOf(y)>=0?y:g1[c][st][0];" +
  "return{country:c,state:st,city:ct}}";

patch(
  "inject region resolver",
  'resumeName:""};function xP(){',
  `resumeName:""};${regionHelper}function xP(){`,
);

// Restore the saved location on hydration, and stop an unset "Remote OK" from
// hydrating as true (which the worker then persisted as "Yes").
patch(
  "hydrate saved location and remote preference",
  'remote:E.member.remote!=="No",resumeName:U.resumeName||"Resume on file"',
  'remote:E.member.remote?E.member.remote==="Yes":k.remote,' +
    "...__jsRegion(E.member,k)," +
    'resumeName:U.resumeName||"Resume on file"',
);

// The delivery-frequency handler posted a full profile snapshot built from local
// state. Send only the field being changed, matching what the pause path already
// does, so cadence changes can never clobber stored preferences.
patch(
  "send only frequency when changing cadence",
  'body:JSON.stringify(z?{access_code:t,session_token:n,frequency:"Paused"}:cP(l,t,n,ue))',
  "body:JSON.stringify({access_code:t,session_token:n," +
    'frequency:z?"Paused":ue==="Three times a day"?"3x daily":ue})',
);

// ---------------------------------------------------------------------------
// Warn before the click when a posting looks closed, and agree with the email on
// what counts as an old posting.
//
// Two problems live on the same freshness row. First, beta users repeatedly
// followed links to postings that were no longer live; the worker now records a
// link status, so surface it here next to the freshness pill in the existing muted
// "aging" styling. Second, the three freshness thresholds disagreed: the worker
// keeps postings within the candidate's window (default 7 days) and the email fades
// its pill grey at 8+ days, but the card only aged a posting past 15 — so a saved
// 10-day-old role read as older in the inbox yet still looked fresh here. Move the
// card's boundary to the same 8+ (>7) point, folded into this one replacement so it
// stays a single owner of the freshness JSX.
// ---------------------------------------------------------------------------
patch(
  "flag closed postings and align the aging pill with the freshness window",
  'Y.jsx("div",{className:"job-timing",children:P3($.posted_at)?Y.jsx("span",{className:`posted-pill ${xA($.posted_at)>15?"aging":""}`,children:P3($.posted_at)}):null})',
  'Y.jsxs("div",{className:"job-timing",children:[' +
    "P3($.posted_at)?Y.jsx(\"span\",{className:`posted-pill ${xA($.posted_at)>7?\"aging\":\"\"}`,children:P3($.posted_at)}):null," +
    '$.link_status==="gone"?Y.jsx("span",{className:"posted-pill aging",children:"Posting may be closed"}):null]})',
);

// ---------------------------------------------------------------------------
// Say whether the role is remote.
//
// "Is this fully remote?" was the most common question from beta users. Remote
// status previously existed only as free text inside the Location string, so
// render the structured Workplace type beside it. Postings whose workplace type
// is unknown show nothing rather than a guess.
// ---------------------------------------------------------------------------
patch(
  "show workplace type on the job card",
  '$.location?Y.jsxs("span",{className:"job-location",children:[Y.jsx(PL,{size:13,weight:"fill"}),$.location]}):null,',
  '$.location?Y.jsxs("span",{className:"job-location",children:[Y.jsx(PL,{size:13,weight:"fill"}),$.location]}):null,' +
    '$.workplace_type&&$.workplace_type!=="Unclear"?Y.jsx("span",{className:"job-source",children:$.workplace_type}):null,',
);

// A bare "YYYY-MM-DD" is parsed by new Date() as UTC midnight, while Date.now() is
// the viewer's local clock — so for anyone behind UTC a posting dated today read as
// "1 day ago". Parse the date at local midnight so the day count matches the
// calendar the reader is actually looking at.
patch(
  "parse posting dates at local midnight so the age does not skew a day",
  "xA=l=>{if(!l)return null;const e=new Date(l);",
  'xA=l=>{if(!l)return null;const e=new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(l)?l+"T00:00:00":l);',
);

// ---------------------------------------------------------------------------
// Offer a way back in when the invite code is lost.
//
// The top beta complaint was losing the access code shared over WhatsApp. Add a
// "Lost your code?" link under the invite form pointing at the standalone
// login.html magic-link request page, and correct the security note now that
// sessions last 30 days rather than one week.
// ---------------------------------------------------------------------------
patch(
  "add magic-link recovery link and fix session-length copy",
  'id:"invite-help",children:"You’ll stay signed in on this device for one week. You can log out anytime from Settings."})]})',
  'id:"invite-help",children:"You’ll stay signed in on this device for 30 days. You can log out anytime from Settings."}),' +
    'Y.jsx("p",{className:"invite-security-note",style:{marginTop:"12px"},children:' +
    'Y.jsx("a",{href:"./login.html",style:{color:"var(--green-deep)",fontWeight:600},children:"Lost your code? Email me a sign-in link"})})]})',
);

// The same one-week promise is repeated on the landing hero and on the signed-in
// settings panel. Both are now wrong, so correct them alongside the invite form.
patch(
  "fix session-length copy on the landing hero",
  "We’ll keep this device signed in for one week.",
  "We’ll keep this device signed in for 30 days.",
);

patch(
  "fix session-length copy in settings",
  "You’ll stay signed in for one week. Log out now if this is a shared device.",
  "You’ll stay signed in for 30 days. Log out now if this is a shared device.",
);

// ---------------------------------------------------------------------------
// Make the faintest text tier readable.
//
// --ink-faint was #999891, which is 2.89:1 on white — below the WCAG AA 4.5:1
// floor for normal text. It is not a one-off: eighteen rules use it, all of them
// small text (the invite security note, field help, job timing, decision notes,
// wizard footnotes). Darkening the token fixes every one of them at once.
//
// #73726c is the lightest value that still clears AA on the three surfaces this
// text actually sits on — 4.83:1 on --surface, 4.66:1 on --canvas, 4.50:1 on
// --surface-muted. The trade-off is that "faint" now sits close to --ink-soft
// (5.19:1), so the two tiers read as one; that gap is unavoidable if both must
// pass AA on a near-white background.
// ---------------------------------------------------------------------------
patch("darken --ink-faint to meet WCAG AA", "--ink-faint: #999891", "--ink-faint: #73726c", "css");

for (const { name, from, to, target } of patches) {
  if (sources[target].includes(to)) {
    skipped.push(name);
    continue;
  }
  if (!sources[target].includes(from)) {
    throw new Error(`Could not apply dashboard patch "${name}" to the current ${target} bundle.`);
  }
  sources[target] = sources[target].replace(from, to);
  applied.push(name);
}

for (const [target, path] of Object.entries(targetPaths)) {
  await writeFile(path, sources[target]);
}

for (const name of applied) console.log(`applied  ${name}`);
for (const name of skipped) console.log(`skipped  ${name} (already present)`);
