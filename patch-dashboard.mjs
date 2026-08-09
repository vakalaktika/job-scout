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

// `from` may be a list of anchors when a patch supersedes an earlier one. The
// shipped artifact is itself post-patch, so a fix that replaces a previous fix
// has to match either the original bundle text or the text the previous fix
// produced. The first anchor found wins, so list the most specific one first.
const patch = (name, from, to, target = "js") =>
  patches.push({ name, from: Array.isArray(from) ? from : [from], to, target });

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
// The first version of this helper fell back to a country's first listed state and
// that state's first listed city, which is the same "invent a plausible location"
// move that kept sending people to San Francisco. Anything the gazetteer does not
// recognise now resolves to empty, and the intake requires the member to choose.
const previousRegionHelper =
  "function __jsRegion(m,cur){" +
  'const c=m&&m.region_country||"",s=m&&m.region_state||"",y=m&&m.region_city||"";' +
  "if(!c||!g1[c])return{country:cur.country,state:cur.state,city:cur.city};" +
  "const st=g1[c][s]?s:Object.keys(g1[c])[0],ct=g1[c][st].indexOf(y)>=0?y:g1[c][st][0];" +
  "return{country:c,state:st,city:ct}}";

const regionHelper =
  "function __jsRegion(m,cur){" +
  'const c=m&&m.region_country||"",s=m&&m.region_state||"",y=m&&m.region_city||"";' +
  "if(!c||!g1[c])return{country:cur.country,state:cur.state,city:cur.city};" +
  'const st=g1[c][s]?s:"",ct=st&&g1[c][st].indexOf(y)>=0?y:"";' +
  "return{country:c,state:st,city:ct}}";

patch(
  "inject region resolver",
  [`resumeName:""};${previousRegionHelper}function xP(){`, 'resumeName:""};function xP(){'],
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

// Shared card helpers, injected beside the date helpers they build on so they
// stay inside the same const list rather than leaking a global.
const cardHelpers =
  // Freshness bands, matching the email's pill contract exactly.
  '__jsBand=l=>{const e=xA(l);return e===null?"":e<=2?"fresh":e<=7?"recent":"old"},' +
  '__jsPosted=l=>{const e=xA(l);if(e===null)return"";if(e===0)return"Posted today";' +
  'if(e===1)return"Posted yesterday";if(e<=7)return`Posted ${e} days ago`;' +
  'const t=new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(l)?l+"T00:00:00":l);' +
  'return`Posted ${t.toLocaleDateString(void 0,{month:"short",day:"numeric"})} (${e} days ago)`},' +
  // Key requirements arrive as prose because the model is told to write prose.
  // Split on explicit separators first and only fall back to sentences, so a
  // single-sentence brief stays one bullet instead of being chopped mid-clause.
  '__jsReqs=l=>{const e=String(l||"").split(/\\s*(?:\\r?\\n|;|\\u2022)+\\s*/).map(t=>t.trim()).filter(Boolean);' +
  "if(e.length>1)return e;" +
  'const t=String(l||"").split(/\\.\\s+/).map(n=>n.trim()).filter(Boolean);' +
  'return t.length>1?t.map(n=>/[.!?]$/.test(n)?n:n+"."):e},' +
  // Applied and Not interested are views rather than a partition — a posting can
  // be saved and applied to at once — and the two that describe a state a member
  // may never reach stay hidden until they reach it.
  '__jsFilters=(l,e,t,n,a)=>[{id:"New",label:"New",items:l},{id:"Saved",label:"Saved",items:e},' +
  '{id:"Applied",label:"Applied",items:n||[]},{id:"Passed",label:"Not interested",items:a||[]},' +
  '{id:"All",label:"All",items:t}]' +
  '.filter(s=>s.items.length||s.id==="New"||s.id==="Saved"||s.id==="All"),' +
  // Mirrors APPLICATION_STATUSES in worker.mjs, which rejects anything else.
  '__jsAppStatuses=["Applied","Interviewing","Offer","Rejected","No response"],' +
  '__jsAgo=l=>{const e=xA(l);return e===null?"":e===0?"today":e===1?"yesterday":`${e} days ago`},' +
  // Two weeks of silence is where "waiting" stops describing it, so say so rather
  // than leaving the member to work it out from a date.
  '__jsAppNote=l=>{const e=String(l&&l.application_status||"");if(!e)return"";' +
  "const t=__jsAgo(l&&l.applied_at);" +
  'if(e!=="Applied")return t?`${e} · applied ${t}`:e;' +
  'return t?(xA(l.applied_at)>=14?`Applied ${t} · still no reply`:`Applied ${t}`):"Applied"},' +
  '__jsPassNote=l=>l&&l.decision==="Not interested"&&l.feedback?`You passed on this: ${l.feedback}`:"",' +
  '__jsContextLines=l=>String(l||"").split("\\n").map(e=>e.trim()).filter(Boolean),' +
  // An empty list is ambiguous without this: members could not tell "nothing
  // matched this run" from "the scout has never run". The ordering half of the
  // line is dropped when there is nothing to order.
  '__jsRunLabel=(l,e)=>{const t=Date.parse(String(l&&l.last_run_at||"")),' +
  'n=e?"Freshest first · last run ":"Last run ";' +
  'if(!Number.isFinite(t))return e?"Freshest first":"Your first run is still to come";' +
  'const a=new Date(t),s=a.toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit"});' +
  "return a.toDateString()===new Date().toDateString()?`${n}today, ${s}`:" +
  '`${n}${a.toLocaleDateString(void 0,{month:"short",day:"numeric"})}, ${s}`},' +
  '__jsScoutView=l=>{const e=String(l&&l.status||"unavailable");' +
  'if(e==="available")return{eyebrow:"Your first run",title:"See what your scout can find now.",' +
  'copy:"Run one search now instead of waiting for the regular schedule. You can only use this once.",canStart:!0};' +
  'if(e==="queued"||e==="running")return{eyebrow:"Searching now",title:"Your scout is searching",' +
  'copy:"We’re checking your preferences against fresh postings. You can leave this page; results will also arrive by email.",canStart:!1};' +
  'if(e==="complete")return{eyebrow:"Search complete",title:"Your first scout finished.",' +
  'copy:"There weren’t any strong matches this time. Your regular scout schedule is active and will keep looking.",canStart:!1};' +
  'if(e==="failed"||e==="needs_review")return{eyebrow:"Search update",title:"Your first scout needs another try.",' +
  'copy:"We couldn’t finish the one-time search. Your regular scout schedule is still active.",canStart:!1};' +
  'return{eyebrow:"Your first run",title:"Your preferences are saved.",' +
  'copy:"Your scout will run on its regular schedule. Matching jobs will arrive by email and appear here.",canStart:!1}}';

// The bundle already carried the helpers above before __jsScoutView was added.
// Keep that exact prior form as a migration anchor so replacing the helper list
// never appends a second declaration beside the first.
const previousCardHelpers = cardHelpers.slice(0, cardHelpers.indexOf(",__jsScoutView="));

// The three-filter form the shipped bundle already carries. Kept verbatim so this
// patch supersedes its own previous revision instead of appending a second copy
// of the whole list beside it.
const shippedCardHelpers =
  '__jsBand=l=>{const e=xA(l);return e===null?"":e<=2?"fresh":e<=7?"recent":"old"},' +
  '__jsPosted=l=>{const e=xA(l);if(e===null)return"";if(e===0)return"Posted today";' +
  'if(e===1)return"Posted yesterday";if(e<=7)return`Posted ${e} days ago`;' +
  'const t=new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(l)?l+"T00:00:00":l);' +
  'return`Posted ${t.toLocaleDateString(void 0,{month:"short",day:"numeric"})} (${e} days ago)`},' +
  '__jsReqs=l=>{const e=String(l||"").split(/\\s*(?:\\r?\\n|;|\\u2022)+\\s*/).map(t=>t.trim()).filter(Boolean);' +
  "if(e.length>1)return e;" +
  'const t=String(l||"").split(/\\.\\s+/).map(n=>n.trim()).filter(Boolean);' +
  'return t.length>1?t.map(n=>/[.!?]$/.test(n)?n:n+"."):e},' +
  '__jsFilters=(l,e,t)=>[{id:"New",label:"New",items:l},{id:"Saved",label:"Saved",items:e},{id:"All",label:"All",items:t}],' +
  '__jsRunLabel=(l,e)=>{const t=Date.parse(String(l&&l.last_run_at||"")),' +
  'n=e?"Freshest first · last run ":"Last run ";' +
  'if(!Number.isFinite(t))return e?"Freshest first":"Your first run is still to come";' +
  'const a=new Date(t),s=a.toLocaleTimeString(void 0,{hour:"numeric",minute:"2-digit"});' +
  "return a.toDateString()===new Date().toDateString()?`${n}today, ${s}`:" +
  '`${n}${a.toLocaleDateString(void 0,{month:"short",day:"numeric"})}, ${s}`}';

const postedHelper =
  'P3=l=>{const e=xA(l);return e===null?"":e===0?"Posted today":e===1?"Posted yesterday":`Posted ${e} days ago`}';

patch(
  "inject the freshness, requirement, run-label, and tracking helpers",
  [
    `${postedHelper},${cardHelpers},${previousCardHelpers}`,
    `${postedHelper},${previousCardHelpers}`,
    `${postedHelper},${shippedCardHelpers}`,
    postedHelper,
  ],
  `${postedHelper},/*first-scout-helpers*/${cardHelpers}`,
);

patch(
  "start the authenticated one-time scout",
  '},P=({items:ue,saved:z=!1})=>Y.jsx(Ut.div,{layout:!0,className:"history-list job-review-list"',
  '},__jsStartScout=async()=>{if(__jsScoutBusy)return;__jsSetScoutBusy(!0);try{' +
    'const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"run_scout_once",session_token:n})}),__jsD=await __jsR.json();' +
    'if(__jsD&&__jsD.first_scout)__jsSetScout(__jsD.first_scout);' +
    'if(!__jsR.ok||!__jsD.ok)throw new Error(__jsD.error||"first_scout_failed");' +
    'K(__jsD.already_requested?"Your first scout is already in progress.":"Your first scout is searching now.")' +
    '}catch(__jsE){console.error(__jsE),K("We couldn’t start that search. Your regular schedule is still active.")}' +
    'finally{__jsSetScoutBusy(!1)}},' +
    'P=({items:ue,saved:z=!1})=>Y.jsx(Ut.div,{layout:!0,className:"history-list job-review-list"',
);

const firstScoutPollOriginal =
  'te=[{label:"For you",icon:BL},{label:"Saved",icon:a3,count:j.length},{label:"Settings",icon:LL}];return Y.jsxs("div"';
const firstScoutPollBase =
  'te=[{label:"For you",icon:BL},{label:"Saved",icon:a3,count:j.length},{label:"Settings",icon:LL}];' +
    'W.useEffect(()=>{if(!["queued","running"].includes(String(__jsScout&&__jsScout.status||"")))return;' +
    'let __jsStopped=!1,__jsPolling=!1;const __jsPoll=async()=>{if(__jsStopped||__jsPolling||document.hidden)return;' +
    '__jsPolling=!0;try{const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"scout_status",session_token:n})}),__jsD=await __jsR.json();' +
    'if(!__jsR.ok||!__jsD.ok)throw new Error(__jsD.error||"scout_status_failed");' +
    'const __jsNext=__jsD.first_scout||{status:"needs_review"};if(!__jsStopped)__jsSetScout(__jsNext);' +
    'if(__jsNext.status==="complete"&&!__jsStopped){const __jsS=await fetch(I3,{method:"POST",' +
    'headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"session",session_token:n})}),' +
    '__jsB=await __jsS.json();if(__jsS.ok&&__jsB.ok&&!__jsStopped){T(Array.isArray(__jsB.jobs)?__jsB.jobs:[]);' +
    '__jsSetScout(__jsB.first_scout||__jsNext)}}}catch(__jsE){console.error(__jsE)}finally{__jsPolling=!1}};' +
    '__jsPoll();const __jsTimer=window.setInterval(__jsPoll,5000);return()=>{__jsStopped=!0;window.clearInterval(__jsTimer)}' +
    '},[n,__jsScout&&__jsScout.status]);return Y.jsxs("div"';
const firstScoutPollGuarded = firstScoutPollBase.replace(
  'W.useEffect(()=>{if(!["queued","running"]',
  'W.useEffect(()=>{if(!n||!["queued","running"]',
);
const firstScoutPollFinal = firstScoutPollGuarded
  .replace(
    'const __jsNext=__jsD.first_scout||{status:"needs_review"};if(!__jsStopped)__jsSetScout(__jsNext);' +
      'if(__jsNext.status==="complete"&&!__jsStopped){const',
    'const __jsNext=__jsD.first_scout||{status:"needs_review"};' +
      'if(__jsNext.status==="complete"&&!__jsStopped){const',
  )
  .replace(
    '__jsSetScout(__jsB.first_scout||__jsNext)}}}catch(__jsE)',
    '__jsSetScout(__jsB.first_scout||__jsNext)}else if(!__jsStopped)__jsSetScout(__jsNext)}' +
      'else if(!__jsStopped)__jsSetScout(__jsNext)}catch(__jsE)',
  );

patch(
  "poll first-scout status and refresh matches once complete",
  [firstScoutPollOriginal, firstScoutPollBase, firstScoutPollGuarded],
  firstScoutPollFinal,
);

// ---------------------------------------------------------------------------
// One badge row under every title: freshness, workplace, and link status.
//
// Four things converge here, so this replacement is the single owner of the
// freshness JSX rather than a chain of patches that would each invalidate the
// last.
//
//  1. Beta users repeatedly followed links to postings that were no longer live.
//     The worker records a link status, so state it — including the "Link live"
//     case, because a card that only speaks up on failure gives a member no way
//     to tell a checked-and-open posting from one nothing has looked at.
//  2. The three freshness thresholds disagreed: the worker keeps postings inside
//     the candidate's window (default 7 days) and the email fades its pill grey
//     at 8+, but the card only aged a posting past 15 — so a saved 10-day-old
//     role read as older in the inbox yet still looked fresh here. The card now
//     uses the email's exact three bands: green 0-2, amber 3-7, grey 8+.
//  3. Past a week "Posted 23 days ago" stops meaning anything, so name the day.
//  4. "Is this fully remote?" was the most common beta question. Workplace type
//     is structured now, so it becomes a badge here instead of free text buried
//     in the Location string. An unknown workplace shows nothing, not a guess.
// ---------------------------------------------------------------------------
patch(
  "render freshness bands, workplace, and link status as one badge row",
  [
    // What the previous revision of this patch produced.
    'Y.jsxs("div",{className:"job-timing",children:[P3($.posted_at)?Y.jsx("span",{className:`posted-pill ${xA($.posted_at)>7?"aging":""}`,children:P3($.posted_at)}):null,$.link_status==="gone"?Y.jsx("span",{className:"posted-pill aging",children:"Posting may be closed"}):null]})',
    // The original, unpatched bundle text.
    'Y.jsx("div",{className:"job-timing",children:P3($.posted_at)?Y.jsx("span",{className:`posted-pill ${xA($.posted_at)>15?"aging":""}`,children:P3($.posted_at)}):null})',
  ],
  'Y.jsxs("div",{className:"job-timing",children:[' +
    '__jsPosted($.posted_at)?Y.jsx("span",{className:`posted-pill ${__jsBand($.posted_at)}`,children:__jsPosted($.posted_at)}):null,' +
    '$.workplace_type&&$.workplace_type!=="Unclear"?Y.jsx("span",{className:"workplace-badge",children:$.workplace_type}):null,' +
    '$.link_status==="gone"?Y.jsx("span",{className:"status-badge gone",children:"No longer accepting"}):' +
    '$.link_status==="live"?Y.jsx("span",{className:"status-badge live",children:"Link live"}):null]})',
);

// ---------------------------------------------------------------------------
// Put the pay on the card.
//
// The email has carried salary on every card since launch and the dashboard
// never did, so members were opening postings just to find out what the alert
// had already told them. Workplace type lives in the badge row above, which
// leaves the metadata line free for it.
// ---------------------------------------------------------------------------
patch(
  "show location and salary on the job card",
  [
    // What the previous revision of this patch produced — the workplace span it
    // added is dropped here because the badge row above now owns it.
    '$.location?Y.jsxs("span",{className:"job-location",children:[Y.jsx(PL,{size:13,weight:"fill"}),$.location]}):null,$.workplace_type&&$.workplace_type!=="Unclear"?Y.jsx("span",{className:"job-source",children:$.workplace_type}):null,',
    // The original, unpatched bundle text.
    '$.location?Y.jsxs("span",{className:"job-location",children:[Y.jsx(PL,{size:13,weight:"fill"}),$.location]}):null,',
  ],
  '$.location?Y.jsxs("span",{className:"job-location",children:[Y.jsx(PL,{size:13,weight:"fill"}),$.location]}):null,' +
    '$.salary?Y.jsx("span",{className:"job-salary",children:$.salary}):null,',
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

// ---------------------------------------------------------------------------
// The magic link had no other end.
//
// The Worker mints a token, emails it, and exposes `magic_consume` to exchange
// it for a session — all of it tested. Nothing in the front end ever read the
// token back: the mount effect looked only at `?preview=` and localStorage, so a
// member who followed their sign-in link landed on the invite-code gate, which
// is the one screen the link exists to let them skip.
//
// Consume it before the stored session is considered, and strip it from the
// address bar first: it is a bearer credential, and leaving it in the URL puts
// it into history, the referrer, and anything the member pastes. A link that
// fails — expired, already used, or nonce-rotated — falls through to the normal
// flow rather than dead-ending, because the invite code still works.
// ---------------------------------------------------------------------------
patch(
  "exchange a magic-link token for a session on load",
  "return W.useEffect(()=>{let _=!1;return(async()=>{let A=null;",
  "return W.useEffect(()=>{let _=!1;return(async()=>{" +
    'const __jsT=new URLSearchParams(window.location.search).get("login");' +
    "if(__jsT){const __jsU=new URL(window.location.href);" +
    '__jsU.searchParams.delete("login");window.history.replaceState({},"",__jsU);' +
    'try{const __jsR=await fetch(l6,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"magic_consume",magic_token:__jsT})}),__jsD=await __jsR.json();' +
    'if(!__jsR.ok||!__jsD.ok)throw new Error(__jsD.error||"invalid_link");' +
    '_||(w("",__jsD),v(!1));return}catch(__jsE){console.error(__jsE)}}' +
    "let A=null;",
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

// ---------------------------------------------------------------------------
// Bring the dashboard up to the reviewed end-to-end experience.
//
// The mockup in experience-mockup.html is the agreed design for the whole
// journey. Intake, the invite gate, the email, and magic-link sign-in already
// match it; the dashboard is where it diverged. Everything below closes one of
// those gaps, and each one traces back to something beta members actually said.
// ---------------------------------------------------------------------------

patch(
  "mark a closed posting on the card itself",
  'className:`history-card job-review-card ${A===$.id?"is-expanded":""}`',
  'className:`history-card job-review-card ${A===$.id?"is-expanded":""} ${$.link_status==="gone"?"is-gone":""}`',
);

// ---------------------------------------------------------------------------
// The brief reads like the mockup's brief.
//
// The three headings now match the fields the worker actually generates and the
// language the email uses, and requirements render as the list they describe
// instead of one run-on paragraph nobody finished reading.
// ---------------------------------------------------------------------------
patch(
  "align brief headings with the generated fields and list the requirements",
  'div",{children:[Y.jsx("span",{children:"What the role is"}),Y.jsx("p",{children:$.summary||"A concise summary is not available for this posting yet. Open the original posting for the full role details."})]}),Y.jsxs("div",{children:[Y.jsx("span",{children:"Why it fits you"}),Y.jsx("p",{children:$.match_reason||W3($,l)})]}),$.key_requirements?Y.jsxs("div",{children:[Y.jsx("span",{children:"What matters most"}),Y.jsx("p",{children:$.key_requirements})]}):null',
  'div",{children:[Y.jsx("span",{children:"Job summary"}),Y.jsx("p",{children:$.summary||"A concise summary is not available for this posting yet. Open the original posting for the full role details."})]}),' +
    'Y.jsxs("div",{children:[Y.jsx("span",{children:"Why it matched"}),Y.jsx("p",{children:$.match_reason||W3($,l)})]}),' +
    '$.key_requirements?Y.jsxs("div",{children:[Y.jsx("span",{children:"Key requirements"}),' +
    'Y.jsx("ul",{className:"job-brief-requirements",children:__jsReqs($.key_requirements).map((__r,__i)=>Y.jsx("li",{children:__r},__i))})]}):null',
);

patch(
  "ask the mockup's feedback question",
  'Y.jsx("strong",{children:"What wasn’t a match?"})',
  'Y.jsx("strong",{children:"What’s off about this one?"})',
);

// ---------------------------------------------------------------------------
// Styles for everything above.
//
// The three freshness bands reuse the email template's exact colours so the two
// surfaces cannot drift again. Every pair clears WCAG AA at this 11px weight:
// fresh 4.57:1, recent 6.20:1, old 5.84:1, workplace 7.64:1, live 7.30:1,
// gone 4.75:1. A closed card is muted with a background rather than the mockup's
// opacity, which would have dragged its text back under the AA floor.
// ---------------------------------------------------------------------------
patch(
  "style the freshness bands, badges, filter, and requirement list",
  ".posted-pill.aging{border:1px solid #e3c89d;background:#f8eddb;color:#75501f}",
  ".posted-pill.fresh{border:1px solid #bbf7d0;background:#dcfce7;color:#15803d}" +
    ".posted-pill.recent{border:1px solid #e3c89d;background:#f8eddb;color:#75501f}" +
    ".posted-pill.old{border:1px solid #dfe3e8;background:#f1f5f9;color:#546070}" +
    ".workplace-badge{border:1px solid #cfe0d8;border-radius:999px;background:#e7f0ec;color:#1b5343;padding:4px 8px}" +
    ".status-badge{border-radius:999px;padding:4px 8px;font-size:10px;letter-spacing:.04em;text-transform:uppercase}" +
    ".status-badge.live{background:var(--green-pale);color:var(--green-deep)}" +
    ".status-badge.gone{background:#fbeae7;color:var(--clay)}" +
    ".job-review-card.is-gone{border-color:#ead9d4;background:var(--canvas)}" +
    ".job-review-card.is-gone .history-main h3{color:var(--ink-soft)}" +
    ".job-salary{border-radius:6px;background:#f3f3ef;color:#6d6b65;padding:3px 6px}" +
    ".job-filter-seg{display:flex;flex-wrap:wrap;gap:6px;margin:0 2px 14px}" +
    ".job-filter-seg button{display:inline-flex;align-items:center;gap:6px;min-height:38px;" +
    "border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink-soft);" +
    "padding:8px 14px;font-size:13px;font-weight:600}" +
    '.job-filter-seg button[aria-selected="true"]{border-color:var(--ink);background:var(--ink);color:#fff}' +
    ".job-filter-seg button b{font-weight:700;opacity:.75}" +
    ".job-brief-requirements{margin:6px 0 0;padding-left:17px;color:#474641;font-size:13px;line-height:1.55}" +
    ".job-brief-requirements li{margin-bottom:3px}" +
    ".decision-button.save.is-on{border-color:#cfe0d8;background:var(--green-pale);color:var(--green-deep)}",
  "css",
);

// ---------------------------------------------------------------------------
// Managing a posting past the first yes/no.
//
// Three things were missing once a member had made a decision:
//
//  1. A pass was a dead end. The four reasons could not describe most passes —
//     "already applied" and "wrong industry" have no button — and the reason was
//     saved on the posting where nothing gathered it. "Something else" opens a
//     free-text field, and the Worker now rolls every reason onto the candidate
//     record as the search context a future run can read.
//  2. A dismissed posting vanished. Not interested removed it from the list with
//     no way back, so a mis-tap or a change of mind needed an operator. There is
//     now a "Not interested" filter, the pass control is a toggle that puts a
//     posting back, and the Worker keeps reviewed postings past the freshness
//     window so the list they return to still exists.
//  3. Nothing survived the decision. A saved job and one applied to three weeks
//     ago with no reply looked identical. Each saved or applied posting carries
//     a status row — applied, interviewing, offer, rejected, no response — and
//     says how long it has been quiet.
// ---------------------------------------------------------------------------

patch(
  "add the filter, disclosure, restored, and search-context state",
  [
    'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),' +
      "[__jsOther,__jsSetOther]=W.useState(!1)," +
      "[__jsRestored,__jsSetRestored]=W.useState([])," +
      '[__jsContext,__jsSetContext]=W.useState(e&&e.member&&e.member.match_context||""),' +
      "[d,p]=W.useState(null),",
    'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),[d,p]=W.useState(null),',
    'const[c,h]=W.useState("For you"),[d,p]=W.useState(null),',
  ],
  'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),' +
    "[__jsOther,__jsSetOther]=W.useState(!1)," +
    "[__jsRestored,__jsSetRestored]=W.useState([])," +
    '[__jsContext,__jsSetContext]=W.useState(e&&e.member&&e.member.match_context||""),' +
    '[__jsScout,__jsSetScout]=W.useState(e&&e.first_scout||{status:"unavailable"}),' +
    '[__jsScoutBusy,__jsSetScoutBusy]=W.useState(!1),' +
    "[d,p]=W.useState(null),",
);

// An applied posting leaves the unreviewed queue whether or not a decision was
// recorded, and stays in the active list however old it gets — nobody stops
// caring about an application because the posting turned eight days old.
//
// A posting put back after a pass is held in the list for the rest of the
// session too. Undoing a pass clears the decision, and without this a posting
// the freshness window had already aged past would silently vanish at the exact
// moment the member asked for it back.
patch(
  "derive the applied and dismissed lists",
  'j=w.filter(ue=>ue.decision==="Interested"),O=w.filter(ue=>{if(ue.decision==="Not interested")return!1;' +
    'if(ue.decision==="Interested")return!0;const z=xA(ue.posted_at);' +
    'return z!==null&&z<=Number(l.postedWithin||7)}),X=O.filter(ue=>ue.decision!=="Interested"),',
  'j=w.filter(ue=>ue.decision==="Interested"),O=w.filter(ue=>{if(ue.decision==="Not interested")return!1;' +
    'if(ue.decision==="Interested"||ue.application_status||__jsRestored.includes(ue.id))return!0;' +
    "const z=xA(ue.posted_at);" +
    "return z!==null&&z<=Number(l.postedWithin||7)})," +
    'X=O.filter(ue=>ue.decision!=="Interested"&&!ue.application_status),' +
    "__jsApplied=w.filter(ue=>!!ue.application_status)," +
    '__jsPassed=w.filter(ue=>ue.decision==="Not interested"),',
);

// The decision call carries the free-text note and reads back the search context
// the Worker rebuilt, so Settings reflects a new reason without a reload.
// __jsTrack is the same shape for the application status.
const decisionCall =
  'J=async(ue,z,$="")=>{k(ue.id);try{const de=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"job_decision",session_token:n,job_id:ue.id,decision:z,feedback:$})}),' +
  'he=await de.json();if(!de.ok||!he.ok)throw new Error(he.error||"decision_failed");' +
  "T(Te=>Te.map(re=>re.id===ue.id?{...re,...he.job}:re)),E(null),";

const decisionTail =
  '}catch(de){console.error(de),K("We couldn’t save that choice. Please try again.")}finally{k(null)}}';

patch(
  "send the free-text note and add the application-status call",
  [
    // What the previous revision produced: a toast that names an undone decision.
    decisionCall +
      'K(z==="Interested"?"Saved to your shortlist.":z?"Removed from your job list.":"Back in your job list.")' +
      decisionTail,
    // The original, which had no undo to confirm.
    decisionCall +
      'K(z==="Interested"?"Saved to your shortlist.":"Removed from your job list.")' +
      decisionTail,
  ],
  'J=async(ue,z,$="",__jsN="")=>{k(ue.id);try{const de=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"job_decision",session_token:n,job_id:ue.id,decision:z,feedback:$,note:__jsN})}),' +
    'he=await de.json();if(!de.ok||!he.ok)throw new Error(he.error||"decision_failed");' +
    "T(Te=>Te.map(re=>re.id===ue.id?{...re,...he.job}:re))," +
    'typeof he.match_context=="string"&&__jsSetContext(he.match_context),' +
    "z||__jsSetRestored(__jsL=>__jsL.includes(ue.id)?__jsL:[...__jsL,ue.id])," +
    "E(null),__jsSetOther(!1)," +
    'K(z==="Interested"?"Saved to your shortlist.":z?"Not interested. Find it under Not interested if you change your mind.":"Back in your job list.")}' +
    'catch(de){console.error(de),K("We couldn’t save that choice. Please try again.")}finally{k(null)}},' +
    "__jsTrack=async(__jsJ,__jsS)=>{k(__jsJ.id);try{" +
    'const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"job_application",session_token:n,job_id:__jsJ.id,application_status:__jsS})}),' +
    '__jsB=await __jsR.json();if(!__jsR.ok||!__jsB.ok)throw new Error(__jsB.error||"tracking_failed");' +
    "T(__jsL=>__jsL.map(__jsI=>__jsI.id===__jsJ.id?{...__jsI,...__jsB.job}:__jsI)),E(null)," +
    'K(__jsS?`Tracked as ${__jsS.toLowerCase()}.`:"Tracking cleared.")}' +
    'catch(__jsX){console.error(__jsX),K("We couldn’t update that just yet. Please try again.")}finally{k(null)}}',
);

// "Not interested" becomes a toggle for the same reason "Interested" did: the
// card is the only place a decision can be taken back. A dismissed card says
// "Put back" and shows the reason that was given, so the member can see why they
// passed before deciding whether they still agree.
patch(
  "make the pass reversible and add the application-status row",
  [
    // What the previous revision of the decision row produced.
    'Y.jsx("div",{className:"job-card-actions",children:Y.jsxs("div",{className:"job-decision-actions",children:[' +
      'Y.jsxs(Ut.button,{type:"button","aria-label":`Not interested in ${$.role||$.title}`,' +
      'className:"decision-button pass",disabled:U===$.id,onClick:()=>E(_===$.id?null:$.id),' +
      'whileTap:{scale:.97},transition:La,children:[Y.jsx(q5,{size:16})," Not interested"]}),' +
      'Y.jsxs(Ut.button,{type:"button","aria-pressed":$.decision==="Interested",' +
      '"aria-label":$.decision==="Interested"?`Remove ${$.role||$.title} from your saved jobs`:`Mark ${$.role||$.title} as interested`,' +
      'className:`decision-button save ${$.decision==="Interested"?"is-on":""}`,disabled:U===$.id,' +
      'onClick:()=>J($,$.decision==="Interested"?"":"Interested"),' +
      'whileTap:{scale:.97},transition:La,children:[Y.jsx(o3,{size:16,weight:"fill"})," Interested"]})]})}),',
    // The original Save/Pass row, which hid both controls the moment either was
    // used. Its replacement made Interested reversible; this one does the same
    // for the pass and hangs the tracker off the same decision.
    'Y.jsx("div",{className:"job-card-actions",children:Y.jsx("div",{className:"job-decision-actions",children:!z&&$.decision!=="Interested"?Y.jsxs(Y.Fragment,{children:[Y.jsxs(Ut.button,{type:"button","aria-label":`Not interested in ${$.role||$.title}`,className:"decision-button pass",disabled:U===$.id,onClick:()=>E(_===$.id?null:$.id),whileTap:{scale:.97},transition:La,children:[Y.jsx(q5,{size:16})," Pass"]}),Y.jsxs(Ut.button,{type:"button","aria-label":`Save ${$.role||$.title}`,className:"decision-button save",disabled:U===$.id,onClick:()=>J($,"Interested"),whileTap:{scale:.97},transition:La,children:[Y.jsx(o3,{size:16,weight:"fill"})," Save"]})]}):null})}),',
  ],
  'Y.jsx("div",{className:"job-card-actions",children:Y.jsxs("div",{className:"job-decision-actions",children:[' +
    'Y.jsxs(Ut.button,{type:"button","aria-pressed":$.decision==="Not interested",' +
    '"aria-label":$.decision==="Not interested"?`Put ${$.role||$.title} back in your job list`:`Not interested in ${$.role||$.title}`,' +
    'className:`decision-button pass ${$.decision==="Not interested"?"is-on":""}`,disabled:U===$.id,' +
    'onClick:()=>$.decision==="Not interested"?J($,""):(__jsSetOther(!1),E(_===$.id?null:$.id)),' +
    'whileTap:{scale:.97},transition:La,children:[Y.jsx(q5,{size:16})," ",' +
    '$.decision==="Not interested"?"Put back":"Not interested"]}),' +
    'Y.jsxs(Ut.button,{type:"button","aria-pressed":$.decision==="Interested",' +
    '"aria-label":$.decision==="Interested"?`Remove ${$.role||$.title} from your saved jobs`:`Mark ${$.role||$.title} as interested`,' +
    'className:`decision-button save ${$.decision==="Interested"?"is-on":""}`,disabled:U===$.id,' +
    'onClick:()=>J($,$.decision==="Interested"?"":"Interested"),' +
    'whileTap:{scale:.97},transition:La,children:[Y.jsx(o3,{size:16,weight:"fill"})," Interested"]})]})}),' +
    '$.decision==="Interested"||$.application_status?Y.jsxs("div",{className:"job-track",children:[' +
    'Y.jsx("span",{className:"job-track-label",id:`track-${$.id}`,children:"Where are you with this one?"}),' +
    'Y.jsx("div",{className:"job-track-options",role:"group","aria-labelledby":`track-${$.id}`,' +
    'children:__jsAppStatuses.map(__t=>Y.jsx(Ut.button,{type:"button","aria-pressed":$.application_status===__t,' +
    'className:`track-chip ${$.application_status===__t?"is-on":""}`,disabled:U===$.id,' +
    'onClick:()=>__jsTrack($,$.application_status===__t?"":__t),' +
    "whileTap:{scale:.97},transition:La,children:__t},__t))})," +
    '__jsAppNote($)?Y.jsx("p",{className:"job-track-note",children:__jsAppNote($)}):null]}):' +
    '__jsPassNote($)?Y.jsx("p",{className:"job-track job-track-note",children:__jsPassNote($)}):null,',
);

// "Already applied" is not a complaint about the match, so it records where the
// member actually is instead of filing the posting away as a bad result. Either
// way it leaves the unreviewed queue.
patch(
  "offer already-applied and a free-text pass reason",
  'Y.jsxs("div",{className:"feedback-options",children:[["Role","Company","Location","Pay"].map(he=>' +
    'Y.jsx(Ut.button,{type:"button",disabled:U===$.id,onClick:()=>J($,"Not interested",he),' +
    "whileTap:{scale:.97},transition:La,children:he},he))," +
    'Y.jsx(Ut.button,{type:"button",className:"skip-feedback",disabled:U===$.id,' +
    'onClick:()=>J($,"Not interested"),whileTap:{scale:.97},transition:La,children:"Skip"})]})',
  'Y.jsxs("div",{className:"feedback-options",children:[["Role","Company","Location","Pay"].map(he=>' +
    'Y.jsx(Ut.button,{type:"button",disabled:U===$.id,onClick:()=>J($,"Not interested",he),' +
    "whileTap:{scale:.97},transition:La,children:he},he))," +
    'Y.jsx(Ut.button,{type:"button",disabled:U===$.id,onClick:()=>__jsTrack($,"Applied"),' +
    'whileTap:{scale:.97},transition:La,children:"Already applied"}),' +
    'Y.jsx(Ut.button,{type:"button","aria-expanded":__jsOther,className:__jsOther?"is-on":"",' +
    "disabled:U===$.id,onClick:()=>__jsSetOther(!__jsOther)," +
    'whileTap:{scale:.97},transition:La,children:"Something else"}),' +
    'Y.jsx(Ut.button,{type:"button",className:"skip-feedback",disabled:U===$.id,' +
    'onClick:()=>J($,"Not interested"),whileTap:{scale:.97},transition:La,children:"Skip"})]}),' +
    '__jsOther?Y.jsxs("form",{className:"feedback-other",onSubmit:__jsE=>{__jsE.preventDefault();' +
    'const __jsV=__jsE.currentTarget.querySelector("input").value.trim();' +
    '__jsV&&J($,"Not interested","",__jsV)},children:[' +
    'Y.jsx("label",{className:"sr-only",htmlFor:`pass-note-${$.id}`,children:`Why ${$.role||$.title} is not a match`}),' +
    'Y.jsx("input",{id:`pass-note-${$.id}`,type:"text",maxLength:300,required:!0,' +
    'placeholder:"e.g. too much travel, wrong industry"}),' +
    'Y.jsx(Ut.button,{type:"submit",className:"decision-button save",disabled:U===$.id,' +
    'whileTap:{scale:.97},transition:La,children:"Save reason"})]}):null',
);

// The original copy promised the reason taught the scout, which nothing did. It
// was corrected to say only that the reason is saved with the posting; now that
// it also reaches the candidate record, say that instead of under-claiming.
patch(
  "say where a pass reason actually goes",
  [
    'Y.jsx("span",{children:"Optional. We save your reason with this posting."})',
    'Y.jsx("span",{children:"This helps your scout improve. You can skip it."})',
  ],
  'Y.jsx("span",{children:"Optional. We save it with this posting and add it to your search context."})',
);

// ---------------------------------------------------------------------------
// The filter bar, the last-run line, and a list that survives its own dismissals.
//
// One undifferentiated list mixed saved roles in with unreviewed ones and gave no
// way to see only what was new; the heading also never said when the scout last
// ran, so an empty list read the same as one that had never been filled. Both are
// fixed here, along with the reason the bar must render even when the active list
// is empty: passing on everything would otherwise hide the only route back to
// those postings.
// ---------------------------------------------------------------------------
const headingAndFilters =
  'Y.jsxs("div",{className:"page-heading",children:[Y.jsxs("div",{children:[' +
  'Y.jsx("p",{className:"eyebrow",children:"Your job list"}),' +
  'Y.jsx("h1",{children:O.length?`Here’s what we found, ${q}.`:`Your scout is getting started, ${q}.`}),' +
  'Y.jsx("p",{className:"muted",children:__jsRunLabel(e,O.length)})]}),' +
  'O.length||H?Y.jsxs("div",{className:"heading-meta",children:[Y.jsx(m2,{size:16,weight:"fill"}),' +
  'Y.jsxs("span",{children:[X.length," ready to review",H?` · ${H} hidden`:""]})]}):null]}),';

patch(
  "render the heading, the last-run line, and every filter",
  [
    // What the previous revision produced: heading plus a New/Saved/All bar that
    // disappeared with the active list.
    headingAndFilters +
      "O.length?Y.jsxs(Y.Fragment,{children:[" +
      'Y.jsx("div",{className:"job-filter-seg",role:"tablist","aria-label":"Filter your matches",' +
      'children:__jsFilters(X,j,O).map(__f=>Y.jsxs(Ut.button,{type:"button",role:"tab",' +
      '"aria-selected":__jsFilter===__f.id,onClick:()=>__jsSetFilter(__f.id),' +
      'whileTap:{scale:.97},transition:La,children:[__f.label," ",Y.jsx("b",{children:__f.items.length})]},__f.id))}),' +
      '(()=>{const __s=__jsFilters(X,j,O).find(__f=>__f.id===__jsFilter)||{id:"All",items:O};' +
      "return __s.items.length?Y.jsx(P,{items:__s.items}):" +
      'Y.jsx("p",{className:"decision-note",children:__s.id==="Saved"?' +
      '"Nothing saved yet. Mark a match interested and it will wait for you here.":' +
      '"You have reviewed everything from this run. Switch to All to look again."})})()]}):',
    // The original: one heading with no run line, and one undifferentiated list.
    'Y.jsxs("div",{className:"page-heading",children:[Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:"Your job list"}),Y.jsx("h1",{children:O.length?`Here’s what we found, ${q}.`:`Your scout is getting started, ${q}.`})]}),O.length||H?Y.jsxs("div",{className:"heading-meta",children:[Y.jsx(m2,{size:16,weight:"fill"}),Y.jsxs("span",{children:[X.length," ready to review",H?` · ${H} hidden`:""]})]}):null]}),O.length?Y.jsx(P,{items:O}):',
  ],
  headingAndFilters +
    "O.length||__jsPassed.length?Y.jsxs(Y.Fragment,{children:[" +
    'Y.jsx("div",{className:"job-filter-seg",role:"tablist","aria-label":"Filter your matches",' +
    'children:__jsFilters(X,j,O,__jsApplied,__jsPassed).map(__f=>Y.jsxs(Ut.button,{type:"button",role:"tab",' +
    '"aria-selected":__jsFilter===__f.id,onClick:()=>__jsSetFilter(__f.id),' +
    'whileTap:{scale:.97},transition:La,children:[__f.label," ",Y.jsx("b",{children:__f.items.length})]},__f.id))}),' +
    '(()=>{const __s=__jsFilters(X,j,O,__jsApplied,__jsPassed).find(__f=>__f.id===__jsFilter)||{id:"All",items:O};' +
    "return __s.items.length?Y.jsx(P,{items:__s.items}):" +
    'Y.jsx("p",{className:"decision-note",children:__s.id==="Saved"?' +
    '"Nothing saved yet. Mark a match interested and it will wait for you here.":' +
    '__s.id==="Applied"?"Nothing tracked yet. Mark a saved job applied and it will show up here.":' +
    '__s.id==="Passed"?"You haven’t passed on anything yet.":' +
    '"You have reviewed everything from this run. Switch to All to look again."})})()]}):',
);

patch(
  "show the first-scout CTA and live empty states",
  'Y.jsxs("section",{className:"empty-saved first-run-empty",children:[' +
    'Y.jsx("div",{className:"empty-icon",children:Y.jsx(m2,{size:28,weight:"fill"})}),' +
    'Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:"Your first run"}),' +
    'Y.jsx("h2",{children:"Your preferences are saved."}),' +
    'Y.jsx("p",{children:"The first scouting run hasn’t finished yet. When it does, matching jobs will arrive by email and appear here. You don’t need to keep this page open."}),' +
    'Y.jsxs(Ut.button,{type:"button",onClick:s,whileTap:{scale:.97},transition:La,children:[' +
    'Y.jsx(c3,{size:17})," Review preferences"]})]})]})',
  '(()=>{const __jsV=__jsScoutView(__jsScout);return Y.jsxs(Ut.section,{' +
    'className:"empty-saved first-run-empty first-scout-status",role:"status","aria-live":"polite",layout:!0,' +
    'initial:a?!1:{opacity:0,y:4},animate:{opacity:1,y:0},transition:oh,children:[' +
    'Y.jsx("div",{className:"empty-icon",children:Y.jsx(m2,{size:28,weight:"fill"})}),' +
    'Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:__jsV.eyebrow}),' +
    'Y.jsx("h2",{children:__jsV.title}),Y.jsx("p",{children:__jsV.copy}),' +
    'Y.jsxs("div",{className:"first-scout-actions",children:[' +
    '__jsV.canStart?Y.jsxs(Ut.button,{type:"button",className:"first-scout-cta",onClick:__jsStartScout,' +
    'disabled:__jsScoutBusy,whileTap:a?void 0:{scale:.97},transition:La,children:[' +
    '__jsScoutBusy?"Starting your scout…":"Find my first matches",Y.jsx(ax,{size:16})]}):null,' +
    'Y.jsxs(Ut.button,{type:"button",className:"first-scout-review",onClick:s,' +
    'whileTap:a?void 0:{scale:.97},transition:La,children:[Y.jsx(c3,{size:17})," Review preferences"]})]})]})]})})()',
);

// What the member has told us, in their own words, beside the preferences it
// belongs with. A reason that goes nowhere visible is a reason members stop
// giving, and this is the same field the next run reads.
patch(
  "show the search context beside the saved preferences",
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Pay"}),Y.jsxs("strong",{children:[dw(l.salaryMin),"–",dw(l.salaryMax),"+"]})]})]})',
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Pay"}),Y.jsxs("strong",{children:[dw(l.salaryMin),"–",dw(l.salaryMax),"+"]})]}),' +
    '__jsContextLines(__jsContext).length?Y.jsxs("div",{className:"context-summary",children:[' +
    'Y.jsx("span",{children:"What you’ve told us"}),' +
    'Y.jsx("ul",{className:"match-context-list",children:__jsContextLines(__jsContext).slice(0,6)' +
    '.map((__c,__i)=>Y.jsx("li",{children:__c},__i))})]}):null]})',
);

// ---------------------------------------------------------------------------
// Styles for the tracker, the free-text field, and the context list.
//
// The status row sits in the grid column the feedback panel uses, so it reads as
// another full-width row of the card instead of being squeezed into the narrow
// action column. Every new pair clears WCAG AA: the dismissed pass button is
// clay on clay-pale at 4.79:1, a selected chip is white on --ink at 16.44:1, and
// the context list is #474641 on --canvas at 9.13:1.
// ---------------------------------------------------------------------------
patch(
  "style the application tracker, free-text reason, and context list",
  ".decision-button.save.is-on{border-color:#cfe0d8;background:var(--green-pale);color:var(--green-deep)}",
  ".decision-button.save.is-on{border-color:#cfe0d8;background:var(--green-pale);color:var(--green-deep)}" +
    ".decision-button.pass.is-on{border-color:#e0cfc8;background:var(--clay-pale);color:var(--clay)}" +
    ".feedback-panel{flex-wrap:wrap}" +
    ".feedback-options button.is-on{border-color:var(--ink);background:var(--ink);color:#fff}" +
    // width, not just flex-basis: the narrow panel is a column with
    // align-items:flex-start, which would otherwise shrink the field to its text.
    ".feedback-other{display:flex;width:100%;flex-basis:100%;flex-wrap:wrap;align-items:center;gap:8px}" +
    ".feedback-other input{flex:1 1 220px;min-height:40px;border:1px solid var(--line);" +
    "border-radius:8px;background:var(--surface);color:var(--ink);padding:9px 11px;font-size:13px}" +
    ".job-track{grid-column:2 / -1;display:flex;flex-direction:column;gap:7px;margin-top:12px;" +
    "border-top:1px solid var(--line);padding-top:12px}" +
    ".job-track-label{color:var(--ink-faint);font-size:11px;font-weight:600;" +
    "letter-spacing:.045em;text-transform:uppercase}" +
    ".job-track-options{display:flex;flex-wrap:wrap;gap:6px}" +
    ".track-chip{min-height:36px;border:1px solid var(--line);border-radius:999px;" +
    "background:var(--surface);color:var(--ink-soft);padding:7px 12px;font-size:12.5px;font-weight:600}" +
    ".track-chip.is-on{border-color:var(--ink);background:var(--ink);color:#fff}" +
    ".job-track-note{color:var(--ink-soft);font-size:12.5px;line-height:1.45}" +
    ".context-summary{grid-column:1/-1;border-right:0}" +
    ".match-context-list{margin:4px 0 0;padding-left:17px;color:#474641;font-size:12.5px;line-height:1.5}" +
    ".match-context-list li{margin-bottom:3px}",
  "css",
);

// The narrow layout collapses the card to two columns, so the tracker spans the
// full width there just as the footer and the feedback panel already do.
patch(
  "span the tracker across the narrow card",
  ".job-card-footer{grid-column:1 / -1}",
  ".job-track{grid-column:1 / -1}.job-card-footer{grid-column:1 / -1}",
  "css",
);

patch(
  "style the one-time first-scout surfaces",
  ".ready-card{width:min(100%,760px);border:1px solid var(--line);",
  ".first-scout-status{border-color:#bfd8c8;background:linear-gradient(145deg,#f7fbf8,#eef7f1);overflow:hidden}" +
    ".first-scout-status>div:last-child{display:flex;flex-direction:column;align-items:flex-start;gap:10px}" +
    ".first-scout-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
    ".first-scout-cta{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--green-deep);" +
    "border-radius:9px;background:var(--green-deep);color:#fff;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}" +
    ".first-scout-cta:disabled{cursor:wait;opacity:.68}" +
    ".first-scout-review{display:inline-flex;align-items:center;gap:6px}" +
    ".ready-skip{align-self:center;border:0;background:transparent;color:var(--ink-soft);padding:7px 10px;font:inherit;font-size:13px;cursor:pointer}" +
    ".ready-skip:hover{text-decoration:underline}" +
    "@media(prefers-reduced-motion:reduce){.first-scout-status,.first-scout-cta{animation:none!important;transition:none!important;transform:none!important}}" +
    ".ready-card{width:min(100%,760px);border:1px solid var(--line);",
  "css",
);

for (const { name, from, to, target } of patches) {
  if (sources[target].includes(to)) {
    skipped.push(name);
    continue;
  }
  const anchor = from.find((value) => sources[target].includes(value));
  if (!anchor) {
    throw new Error(`Could not apply dashboard patch "${name}" to the current ${target} bundle.`);
  }
  sources[target] = sources[target].replace(anchor, to);
  applied.push(name);
}

for (const [target, path] of Object.entries(targetPaths)) {
  await writeFile(path, sources[target]);
}

for (const name of applied) console.log(`applied  ${name}`);
for (const name of skipped) console.log(`skipped  ${name} (already present)`);
