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

// A first scout that failed to dispatch and one that has run out of attempts are
// different situations for the member, and the old copy described neither: it
// said another try was needed while the state it was describing rendered no
// control that could make one. Whether a retry exists is a fact the Worker
// reports, so the branch reads it rather than asserting it.
const scoutFailureBranch =
  'if(e==="failed"||e==="needs_review"){const t=!!(l&&l.can_retry);' +
  'return t?{eyebrow:"Search update",title:"Your first scout didn’t start.",' +
  'copy:"Nothing was searched, so your one-time run is still yours to use. Try it again — your regular scout schedule is running either way.",' +
  'canStart:!0,cta:"Try again"}:' +
  '{eyebrow:"Search update",title:"We couldn’t start your first scout.",' +
  'copy:"We tried several times and it still didn’t start, so this one needs us. Your regular scout schedule is active and will keep looking — reply to your invitation email and we’ll pick it up from there.",' +
  'canStart:!1}};';

const briefHelpers =
  '__jsHasBrief=l=>[l&&l.summary,l&&l.match_reason,l&&l.key_requirements]' +
  '.every(e=>String(e||"").trim().length>0),' +
  '__jsBriefTeaser=l=>String(l&&l.summary||"").trim(),';

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
  briefHelpers +
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
  scoutFailureBranch +
  'return{eyebrow:"Your first run",title:"Your preferences are saved.",' +
  'copy:"Your scout will run on its regular schedule. Matching jobs will arrive by email and appear here.",canStart:!1}}';

const preBriefCardHelpers = cardHelpers.replace(briefHelpers, "");

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

// The helper list the bundle carries today, whose first-scout failure branch
// promised a retry with no control behind it. Kept as its own anchor so this
// patch supersedes that revision rather than declaring the helpers twice.
const retrylessCardHelpers = cardHelpers.replace(
  scoutFailureBranch,
  'if(e==="failed"||e==="needs_review")return{eyebrow:"Search update",title:"Your first scout needs another try.",' +
    'copy:"We couldn’t finish the one-time search. Your regular scout schedule is still active.",canStart:!1};',
);

patch(
  "inject the freshness, requirement, run-label, and tracking helpers",
  [
    `${postedHelper},/*first-scout-helpers*/${preBriefCardHelpers}`,
    `${postedHelper},/*first-scout-helpers*/${retrylessCardHelpers}`,
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

const previousBriefLoader =
  '},__jsSetBriefState=(__jsI,__jsS)=>__jsSetBriefStates(__jsL=>({...__jsL,[__jsI]:__jsS})),' +
  '__jsLoadBrief=async __jsJ=>{if(__jsBriefStates[__jsJ.id]==="loading")return;' +
  '__jsSetBriefState(__jsJ.id,"loading");try{' +
  'const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"job_brief",session_token:n,job_id:__jsJ.id})}),' +
  '__jsD=await __jsR.json();' +
  'if(!__jsR.ok||!__jsD.ok||!__jsHasBrief(__jsD.job))throw new Error(__jsD.error||"brief_incomplete");' +
  'T(__jsL=>__jsL.map(__jsI=>__jsI.id===__jsJ.id?{...__jsI,...__jsD.job}:__jsI)),' +
  '__jsSetBriefState(__jsJ.id,"ready")' +
  '}catch(__jsE){console.error(__jsE),__jsSetBriefState(__jsJ.id,"error")}},' +
  '__jsToggleBrief=__jsJ=>{const __jsO=A!==__jsJ.id;S(__jsO?__jsJ.id:null);' +
  'if(__jsO&&!__jsHasBrief(__jsJ))__jsLoadBrief(__jsJ)},' +
  '__jsStartScout=async()=>{';
const briefLoader =
  '},__jsSetBriefState=(__jsI,__jsS)=>__jsSetBriefStates(__jsL=>({...__jsL,[__jsI]:__jsS})),' +
  '__jsLoadBrief=__jsJ=>{const __jsI=__jsJ.id,__jsExisting=__jsBriefRequests.current.get(__jsI);' +
  'if(__jsExisting)return __jsExisting;const __jsRequest=(async()=>{' +
  '__jsSetBriefState(__jsI,"loading");try{' +
  'const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"job_brief",session_token:n,job_id:__jsI})}),' +
  '__jsD=await __jsR.json();' +
  'if(!__jsR.ok||!__jsD.ok||!__jsHasBrief(__jsD.job))throw new Error(__jsD.error||"brief_incomplete");' +
  'T(__jsL=>__jsL.map(__jsJ=>__jsJ.id===__jsI?{...__jsJ,...__jsD.job}:__jsJ)),' +
  '__jsSetBriefState(__jsI,"ready")' +
  '}catch(__jsE){console.error(__jsE),__jsSetBriefState(__jsI,"error")}' +
  'finally{if(__jsBriefRequests.current.get(__jsI)===__jsRequest)' +
  '__jsBriefRequests.current.delete(__jsI)}})();' +
  '__jsBriefRequests.current.set(__jsI,__jsRequest);return __jsRequest},' +
  '__jsToggleBrief=__jsJ=>{const __jsO=A!==__jsJ.id;S(__jsO?__jsJ.id:null);' +
  'if(__jsO&&!__jsHasBrief(__jsJ))__jsLoadBrief(__jsJ)},' +
  '__jsStartScout=async()=>{';

patch(
  "load an incomplete brief when its disclosure opens",
  [previousBriefLoader, '},__jsStartScout=async()=>{'],
  briefLoader,
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
const magicConsume =
  "return W.useEffect(()=>{let _=!1;return(async()=>{" +
  'const __jsT=new URLSearchParams(window.location.search).get("login");' +
  "if(__jsT){const __jsU=new URL(window.location.href);" +
  '__jsU.searchParams.delete("login");window.history.replaceState({},"",__jsU);' +
  'try{const __jsR=await fetch(l6,{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"magic_consume",magic_token:__jsT})}),__jsD=await __jsR.json();' +
  'if(!__jsR.ok||!__jsD.ok)throw new Error(__jsD.error||"invalid_link");' +
  '_||(w("",__jsD),v(!1));return}catch(__jsE){console.error(__jsE)';

// A link that fails still has to land somewhere that explains itself. The
// previous revision swallowed the error and dropped the member on the invite
// gate — the one screen the link exists to let them skip — with nothing on it to
// say the link had expired, had already been used, or had simply hit a bad
// minute. The Worker now names which of those happened; carry that name to the
// screen that can act on it.
patch(
  "exchange a magic-link token for a session on load",
  [`${magicConsume}}}let A=null;`, "return W.useEffect(()=>{let _=!1;return(async()=>{let A=null;"],
  `${magicConsume},_||__jsSetLinkError(String(__jsE&&__jsE.message||"link_failed"))}}let A=null;`,
);

patch(
  "carry a failed sign-in link to the screen that can explain it",
  'e==="invite"?Y.jsx(wP,{shouldReduceMotion:l,onContinue:w}):null',
  'e==="invite"?Y.jsx(wP,{shouldReduceMotion:l,onContinue:w,linkError:__jsLinkError}):null',
);

patch(
  "accept the link error on the invite screen",
  "function wP({shouldReduceMotion:l,onContinue:e}){",
  "function wP({shouldReduceMotion:l,onContinue:e,linkError:__jsLE}){",
);

// Every state is named, every state offers the two ways back in, and none of
// them reveal whether an address has an account: the member already holds a link
// we signed, and "Send another link" goes to the same non-enumerating request
// page the invite form links to.
const linkCopy =
  '{expired_link:["That sign-in link has expired.",' +
  '"Links last 15 minutes for your security. Send yourself a new one and it will work straight away."],' +
  'used_link:["That sign-in link has already been used.",' +
  '"Each link opens your job list once. Send yourself a new one, or use your invite code below."],' +
  'invalid_link:["We couldn’t read that sign-in link.",' +
  '"Some email apps break long links. Send yourself a new one, or use your invite code below."],' +
  'revoked:["That account is no longer active.",' +
  '"Reply to your invitation email and we’ll take a look."]}';

patch(
  "explain a failed sign-in link and offer another one",
  'Y.jsx("div",{className:"invite-icon",children:Y.jsx(IL,{size:24,weight:"fill"})}),',
  'Y.jsx("div",{className:"invite-icon",children:Y.jsx(IL,{size:24,weight:"fill"})}),' +
    "__jsLE?(()=>{const __jsC=" +
    linkCopy +
    '[__jsLE]||["We couldn’t sign you in just then.",' +
    '"Nothing is wrong with your account. Try your link again, send yourself a new one, or use your invite code below."];' +
    'return Y.jsxs("div",{className:"link-error",role:"alert",children:[' +
    'Y.jsx("strong",{children:__jsC[0]}),Y.jsx("span",{children:__jsC[1]}),' +
    'Y.jsx("a",{href:"./login.html",className:"link-error-action",children:"Send another link"})]})})():null,',
);

patch(
  "style the sign-in link explanation",
  ".invite-icon{display:grid;width:48px;height:48px;place-items:center;margin-bottom:23px;",
  ".link-error{display:flex;flex-direction:column;gap:5px;width:100%;margin:0 0 18px;border:1px solid #e0cfc8;" +
    "border-radius:10px;background:var(--clay-pale);color:var(--ink);padding:12px 14px;text-align:left}" +
    ".link-error strong{font-size:14px}" +
    ".link-error span{color:var(--ink-soft);font-size:13px;line-height:1.5}" +
    ".link-error-action{align-self:flex-start;color:var(--green-deep);font-size:13px;font-weight:600}" +
    ".invite-icon{display:grid;width:48px;height:48px;place-items:center;margin-bottom:23px;",
  "css",
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
const currentBriefContent =
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Job summary"}),' +
  'Y.jsx("p",{children:$.summary||"A concise summary is not available for this posting yet. Open the original posting for the full role details."})]}),' +
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Why it matched"}),' +
  'Y.jsx("p",{children:$.match_reason||W3($,l)})]}),' +
  '$.key_requirements?Y.jsxs("div",{children:[Y.jsx("span",{children:"Key requirements"}),' +
  'Y.jsx("ul",{className:"job-brief-requirements",children:__jsReqs($.key_requirements)' +
  '.map((__r,__i)=>Y.jsx("li",{children:__r},__i))})]}):null';

const completeBriefContent =
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Job summary"}),' +
  'Y.jsx("p",{children:$.summary})]}),' +
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Why it matched"}),' +
  'Y.jsx("p",{children:$.match_reason})]}),' +
  'Y.jsxs("div",{children:[Y.jsx("span",{children:"Key requirements"}),' +
  'Y.jsx("ul",{className:"job-brief-requirements",children:__jsReqs($.key_requirements)' +
  '.map((__r,__i)=>Y.jsx("li",{children:__r},__i))})]})';
const alignedBriefFragment = completeBriefContent.slice('Y.jsxs("'.length);
const currentBriefFragment = currentBriefContent.slice('Y.jsxs("'.length);

patch(
  "align brief headings with the generated fields and list the requirements",
  [
    currentBriefFragment,
    'div",{children:[Y.jsx("span",{children:"What the role is"}),Y.jsx("p",{children:$.summary||"A concise summary is not available for this posting yet. Open the original posting for the full role details."})]}),Y.jsxs("div",{children:[Y.jsx("span",{children:"Why it fits you"}),Y.jsx("p",{children:$.match_reason||W3($,l)})]}),$.key_requirements?Y.jsxs("div",{children:[Y.jsx("span",{children:"What matters most"}),Y.jsx("p",{children:$.key_requirements})]}):null',
  ],
  alignedBriefFragment,
);

patch(
  "preview the role summary without repeating its match reason",
  'Y.jsx("p",{className:"job-match-note",children:W3($,l)})',
  'Y.jsx(Bc,{initial:!1,mode:"popLayout",children:' +
    'A!==$.id&&__jsBriefTeaser($)?Y.jsx(Ut.p,{className:"job-match-note",' +
    'initial:a?!1:{opacity:0,y:-2},animate:{opacity:1,y:0},' +
    'exit:a?{opacity:0}:{opacity:0,y:-2},transition:oh,' +
    'children:__jsBriefTeaser($)},`brief-teaser-${$.id}`):null})',
);

patch(
  "request incomplete briefs and render their progress",
  [completeBriefContent, currentBriefContent],
  'Y.jsx(Bc,{initial:!1,mode:"wait",children:__jsHasBrief($)?' +
    'Y.jsxs(Ut.div,{className:"job-brief-content",initial:a?!1:{opacity:0,y:2},' +
    'animate:{opacity:1,y:0},exit:a?{opacity:0}:{opacity:0,y:-2},transition:oh,' +
    `children:[${completeBriefContent}]},"ready"):` +
    '__jsBriefStates[$.id]==="loading"?' +
    'Y.jsx(Ut.div,{className:"job-brief-state",role:"status","aria-live":"polite",' +
    'initial:a?!1:{opacity:0,y:2},animate:{opacity:1,y:0},exit:a?{opacity:0}:{opacity:0,y:-2},' +
    'transition:oh,children:"Preparing your job brief…"},"loading"):' +
    'Y.jsxs(Ut.div,{className:"job-brief-state is-error",role:"alert",' +
    'initial:a?!1:{opacity:0,y:2},animate:{opacity:1,y:0},exit:a?{opacity:0}:{opacity:0,y:-2},' +
    'transition:oh,children:[Y.jsx("p",{children:' +
    '"We couldn’t prepare this brief yet. Open the original posting for the full role details."}),' +
    'Y.jsx(Ut.button,{type:"button",className:"brief-retry-button",onClick:()=>__jsLoadBrief($),' +
    'whileTap:a?void 0:{scale:.97},transition:La,children:"Try again"})]},"error")})',
);

patch(
  "open job briefs through the enrichment-aware handler",
  'onClick:()=>S(A===$.id?null:$.id),whileTap:{scale:.97}',
  'onClick:()=>__jsToggleBrief($),whileTap:{scale:.97}',
);

patch(
  "expose brief loading to assistive technology",
  'layout:!0,className:"job-brief",initial:a?!1:{opacity:0,y:-3}',
  'layout:!0,className:"job-brief","aria-busy":__jsBriefStates[$.id]==="loading",' +
    'initial:a?!1:{opacity:0,y:-3}',
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
const briefStateStyles =
  ".job-brief-content{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr;gap:20px}" +
  ".job-brief-content>div:last-child:nth-child(3){grid-column:1/-1}" +
  ".job-brief-state{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;" +
  "gap:14px;min-height:68px;border-radius:10px;background:var(--green-pale);" +
  "color:var(--green-deep);padding:14px 16px;font-size:13px;font-weight:600}" +
  ".job-brief-state.is-error{border:1px solid #e0cfc8;background:var(--clay-pale);color:#7e4639}" +
  ".job-brief-state p{margin:0;color:inherit}" +
  ".brief-retry-button{flex:0 0 auto;min-height:44px;border:1px solid currentColor;border-radius:8px;" +
  "background:var(--surface);color:inherit;padding:10px 13px;font-size:13px;font-weight:700}" +
  "@media(max-width:780px){.job-brief-content{grid-template-columns:1fr}" +
  ".job-brief-content>div:last-child:nth-child(3){grid-column:auto}" +
  ".job-brief-state{align-items:flex-start;flex-direction:column}}";

const dashboardCardStyles =
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
  briefStateStyles +
  ".decision-button.save.is-on{border-color:#cfe0d8;background:var(--green-pale);color:var(--green-deep)}";
const preBriefDashboardCardStyles = dashboardCardStyles.replace(briefStateStyles, "");

patch(
  "style the freshness bands, badges, filter, and requirement list",
  [
    preBriefDashboardCardStyles,
    ".posted-pill.aging{border:1px solid #e3c89d;background:#f8eddb;color:#75501f}",
  ],
  dashboardCardStyles,
  "css",
);

patch(
  "style brief progress and retry states",
  ".job-brief-requirements li{margin-bottom:3px}",
  ".job-brief-requirements li{margin-bottom:3px}" + briefStateStyles,
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
const briefStateDeclaration =
  '[__jsBriefStates,__jsSetBriefStates]=W.useState({}),' +
  '__jsBriefRequests=W.useRef(new Map()),';
const previousBriefStateDeclaration =
  '[__jsBriefStates,__jsSetBriefStates]=W.useState({}),';
const dashboardState =
  'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),' +
  '[__jsOther,__jsSetOther]=W.useState(!1),' +
  '[__jsRestored,__jsSetRestored]=W.useState([]),' +
  '[__jsContext,__jsSetContext]=W.useState(e&&e.member&&e.member.match_context||""),' +
  '[__jsScout,__jsSetScout]=W.useState(e&&e.first_scout||{status:"unavailable"}),' +
  '[__jsScoutBusy,__jsSetScoutBusy]=W.useState(!1),' +
  briefStateDeclaration +
  '[d,p]=W.useState(null),';
const preBriefDashboardState = dashboardState.replace(briefStateDeclaration, "");
const previousBriefDashboardState = dashboardState.replace(
  briefStateDeclaration,
  previousBriefStateDeclaration,
);

patch(
  "add the filter, disclosure, restored, and search-context state",
  [
    previousBriefDashboardState,
    preBriefDashboardState,
    'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),' +
      "[__jsOther,__jsSetOther]=W.useState(!1)," +
      "[__jsRestored,__jsSetRestored]=W.useState([])," +
      '[__jsContext,__jsSetContext]=W.useState(e&&e.member&&e.member.match_context||""),' +
      "[d,p]=W.useState(null),",
    'const[c,h]=W.useState("For you"),[__jsFilter,__jsSetFilter]=W.useState("New"),[d,p]=W.useState(null),',
    'const[c,h]=W.useState("For you"),[d,p]=W.useState(null),',
  ],
  dashboardState,
);

patch(
  "track brief loading and failure per job",
  [
    '[__jsScoutBusy,__jsSetScoutBusy]=W.useState(!1),' + previousBriefStateDeclaration + '[d,p]=W.useState(null),',
    '[__jsScoutBusy,__jsSetScoutBusy]=W.useState(!1),[d,p]=W.useState(null),',
  ],
  '[__jsScoutBusy,__jsSetScoutBusy]=W.useState(!1),' +
    briefStateDeclaration +
    '[d,p]=W.useState(null),',
);

// ---------------------------------------------------------------------------
// One busy job at a time was one busy job in total.
//
// Every decision and every application-status change shared a single scalar
// "which job is busy" value, and controls disabled only when that scalar matched
// their own card. So saving job A and then job B re-enabled A's buttons the
// moment B finished, and A's late response overwrote whatever the member had
// asked for since. Pending work is now tracked per job, and every mutation takes
// a per-job ticket so a response that arrives after a newer one is discarded
// instead of winning.
// ---------------------------------------------------------------------------
patch(
  "track pending job mutations per job rather than one at a time",
  "[A,S]=W.useState(null),[U,k]=W.useState(null),",
  "[A,S]=W.useState(null),[U,k]=W.useState({}),__jsSeq=W.useRef(new Map())," +
    "__jsBusy=__jsI=>!!U[__jsI]," +
    "__jsHold=__jsI=>k(__jsL=>({...__jsL,[__jsI]:(__jsL[__jsI]||0)+1}))," +
    "__jsRelease=__jsI=>k(__jsL=>{const __jsC=(__jsL[__jsI]||0)-1,__jsM={...__jsL};" +
    "return __jsC>0?(__jsM[__jsI]=__jsC,__jsM):(delete __jsM[__jsI],__jsM)})," +
    "__jsClaim=__jsI=>{const __jsN=(__jsSeq.current.get(__jsI)||0)+1;" +
    "return __jsSeq.current.set(__jsI,__jsN),__jsN}," +
    "__jsLatest=(__jsI,__jsN)=>__jsSeq.current.get(__jsI)===__jsN,",
);

// Delivery settings live on the member record, and the dashboard used to change
// them only in its own state. The canonical profile kept the cadence it was
// hydrated with, so the next preference save posted that stale value back and
// quietly undid the change — or restarted emails somebody had paused. The saved
// response is the member record, so hand it back to the app that owns it.
patch(
  "hand a saved cadence back to the canonical member state",
  'v(z),z||D(ue),K(z?"Job emails are paused."',
  'v(z),z||D(ue),__jsSyncDelivery&&__jsSyncDelivery(de),K(z?"Job emails are paused."',
);

patch(
  "accept the delivery sync callback on the dashboard",
  "function lP({profile:l,memberState:e,inviteCode:t,sessionToken:n,shouldReduceMotion:a,onEdit:s,onLogout:o}){var B;",
  "function lP({profile:l,memberState:e,inviteCode:t,sessionToken:n,shouldReduceMotion:a,onEdit:s,onLogout:o,onDelivery:__jsSyncDelivery}){var B;",
);

patch(
  "pass the delivery sync callback from the app",
  'e==="dashboard"?Y.jsx(lP,{profile:s,memberState:m,inviteCode:c,sessionToken:d,shouldReduceMotion:l,onEdit:()=>D("intake"),onLogout:T}):null',
  'e==="dashboard"?Y.jsx(lP,{profile:s,memberState:m,inviteCode:c,sessionToken:d,shouldReduceMotion:l,' +
    'onEdit:()=>D("intake"),onLogout:T,onDelivery:__jsE=>{__jsE&&__jsE.member&&(g(__jsE),x(__jsE),' +
    'o(__jsP=>({...__jsP,frequency:__jsE.member.frequency==="3x daily"?"Three times a day":' +
    '__jsE.member.frequency||__jsP.frequency,paused:__jsE.member.status==="Paused"})))}}):null',
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

// What the previous revision of this patch produced, kept verbatim as the
// migration anchor for the per-job ticketing below.
const scalarBusyHandlers =
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
  'catch(__jsX){console.error(__jsX),K("We couldn’t update that just yet. Please try again.")}finally{k(null)}}';

patch(
  "send the free-text note and add the application-status call",
  [
    scalarBusyHandlers,
    // What the revision before that produced: a toast that names an undone decision.
    decisionCall +
      'K(z==="Interested"?"Saved to your shortlist.":z?"Removed from your job list.":"Back in your job list.")' +
      decisionTail,
    // The original, which had no undo to confirm.
    decisionCall +
      'K(z==="Interested"?"Saved to your shortlist.":"Removed from your job list.")' +
      decisionTail,
  ],
  'J=async(ue,z,$="",__jsN="")=>{const __jsQ=__jsClaim(ue.id);__jsHold(ue.id);' +
    'try{const de=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"job_decision",session_token:n,job_id:ue.id,decision:z,feedback:$,note:__jsN})}),' +
    'he=await de.json();if(!de.ok||!he.ok)throw new Error(he.error||"decision_failed");' +
    "if(!__jsLatest(ue.id,__jsQ))return;" +
    "T(Te=>Te.map(re=>re.id===ue.id?{...re,...he.job}:re))," +
    'typeof he.match_context=="string"&&__jsSetContext(he.match_context),' +
    "z||__jsSetRestored(__jsL=>__jsL.includes(ue.id)?__jsL:[...__jsL,ue.id])," +
    "E(null),__jsSetOther(!1)," +
    'K(z==="Interested"?"Saved to your shortlist.":z?"Not interested. Find it under Not interested if you change your mind.":"Back in your job list.")}' +
    'catch(de){console.error(de),__jsLatest(ue.id,__jsQ)&&K("We couldn’t save that choice. Please try again.")}' +
    "finally{__jsRelease(ue.id)}}," +
    "__jsTrack=async(__jsJ,__jsS)=>{const __jsQ=__jsClaim(__jsJ.id);__jsHold(__jsJ.id);try{" +
    'const __jsR=await fetch(I3,{method:"POST",headers:{"Content-Type":"application/json"},' +
    'body:JSON.stringify({action:"job_application",session_token:n,job_id:__jsJ.id,application_status:__jsS})}),' +
    '__jsB=await __jsR.json();if(!__jsR.ok||!__jsB.ok)throw new Error(__jsB.error||"tracking_failed");' +
    "if(!__jsLatest(__jsJ.id,__jsQ))return;" +
    "T(__jsL=>__jsL.map(__jsI=>__jsI.id===__jsJ.id?{...__jsI,...__jsB.job}:__jsI)),E(null)," +
    'K(__jsS?`Tracked as ${__jsS.toLowerCase()}.`:"Tracking cleared.")}' +
    'catch(__jsX){console.error(__jsX),__jsLatest(__jsJ.id,__jsQ)&&K("We couldn’t update that just yet. Please try again.")}' +
    "finally{__jsRelease(__jsJ.id)}}",
);

// Every control that greyed itself out against the old scalar now asks whether
// its own job is busy. They have to move together — one left behind would grey
// out a card because a different card was saving — so the two markup patches
// below derive their disabled state from one place.
const perJobBusy = (markup) => markup.replaceAll("disabled:U===$.id", "disabled:__jsBusy($.id)");

const reversiblePassRow =
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
  '__jsPassNote($)?Y.jsx("p",{className:"job-track job-track-note",children:__jsPassNote($)}):null,';

// "Not interested" becomes a toggle for the same reason "Interested" did: the
// card is the only place a decision can be taken back. A dismissed card says
// "Put back" and shows the reason that was given, so the member can see why they
// passed before deciding whether they still agree.
patch(
  "make the pass reversible and add the application-status row",
  [
    reversiblePassRow,
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
  perJobBusy(reversiblePassRow),
);

const passReasonPanel =
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
  'whileTap:{scale:.97},transition:La,children:"Save reason"})]}):null';

// "Already applied" is not a complaint about the match, so it records where the
// member actually is instead of filing the posting away as a bad result. Either
// way it leaves the unreviewed queue.
patch(
  "offer already-applied and a free-text pass reason",
  [
    passReasonPanel,
    'Y.jsxs("div",{className:"feedback-options",children:[["Role","Company","Location","Pay"].map(he=>' +
      'Y.jsx(Ut.button,{type:"button",disabled:U===$.id,onClick:()=>J($,"Not interested",he),' +
      "whileTap:{scale:.97},transition:La,children:he},he))," +
      'Y.jsx(Ut.button,{type:"button",className:"skip-feedback",disabled:U===$.id,' +
      'onClick:()=>J($,"Not interested"),whileTap:{scale:.97},transition:La,children:"Skip"})]})',
  ],
  perJobBusy(passReasonPanel),
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
  [
    // Supersede the earlier version of this fix, whose "Find my first matches"
    // CTA carried an up-right arrow (↗). That icon reads as "opens in a new tab"
    // and makes no sense on what is an action trigger, not a navigation link, so
    // the button now stands on its label alone.
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
    // The revision this one supersedes: the same panel with a fixed CTA label,
    // which read "Find my first matches" on a retry after a failed dispatch.
    '(()=>{const __jsV=__jsScoutView(__jsScout);return Y.jsxs(Ut.section,{' +
      'className:"empty-saved first-run-empty first-scout-status",role:"status","aria-live":"polite",layout:!0,' +
      'initial:a?!1:{opacity:0,y:4},animate:{opacity:1,y:0},transition:oh,children:[' +
      'Y.jsx("div",{className:"empty-icon",children:Y.jsx(m2,{size:28,weight:"fill"})}),' +
      'Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:__jsV.eyebrow}),' +
      'Y.jsx("h2",{children:__jsV.title}),Y.jsx("p",{children:__jsV.copy}),' +
      'Y.jsxs("div",{className:"first-scout-actions",children:[' +
      '__jsV.canStart?Y.jsxs(Ut.button,{type:"button",className:"first-scout-cta",onClick:__jsStartScout,' +
      'disabled:__jsScoutBusy,whileTap:a?void 0:{scale:.97},transition:La,children:[' +
      '__jsScoutBusy?"Starting your scout…":"Find my first matches"]}):null,' +
      'Y.jsxs(Ut.button,{type:"button",className:"first-scout-review",onClick:s,' +
      'whileTap:a?void 0:{scale:.97},transition:La,children:[Y.jsx(c3,{size:17})," Review preferences"]})]})]})]})})()',
    // Original shipped markup.
    'Y.jsxs("section",{className:"empty-saved first-run-empty",children:[' +
      'Y.jsx("div",{className:"empty-icon",children:Y.jsx(m2,{size:28,weight:"fill"})}),' +
      'Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:"Your first run"}),' +
      'Y.jsx("h2",{children:"Your preferences are saved."}),' +
      'Y.jsx("p",{children:"The first scouting run hasn’t finished yet. When it does, matching jobs will arrive by email and appear here. You don’t need to keep this page open."}),' +
      'Y.jsxs(Ut.button,{type:"button",onClick:s,whileTap:{scale:.97},transition:La,children:[' +
      'Y.jsx(c3,{size:17})," Review preferences"]})]})]})',
  ],
  '(()=>{const __jsV=__jsScoutView(__jsScout);return Y.jsxs(Ut.section,{' +
    'className:"empty-saved first-run-empty first-scout-status",role:"status","aria-live":"polite",layout:!0,' +
    'initial:a?!1:{opacity:0,y:4},animate:{opacity:1,y:0},transition:oh,children:[' +
    'Y.jsx("div",{className:"empty-icon",children:Y.jsx(m2,{size:28,weight:"fill"})}),' +
    'Y.jsxs("div",{children:[Y.jsx("p",{className:"eyebrow",children:__jsV.eyebrow}),' +
    'Y.jsx("h2",{children:__jsV.title}),Y.jsx("p",{children:__jsV.copy}),' +
    'Y.jsxs("div",{className:"first-scout-actions",children:[' +
    '__jsV.canStart?Y.jsxs(Ut.button,{type:"button",className:"first-scout-cta",onClick:__jsStartScout,' +
    'disabled:__jsScoutBusy,whileTap:a?void 0:{scale:.97},transition:La,children:[' +
    '__jsScoutBusy?"Starting your scout…":__jsV.cta||"Find my first matches"]}):null,' +
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

// One button hierarchy across the flow. The first-scout CTA used to be the only
// green solid button while every other primary was ink, so the same "Find my
// first matches" action looked like a different control on the dashboard than in
// the ready screen. The CTA is now the same ink primary everywhere; "Review
// preferences" is a real outline secondary instead of a bare inline row; and the
// "I'll wait" skip is a legible underlined tertiary link instead of near-invisible
// grey text.
patch(
  "style the one-time first-scout surfaces",
  [
    // Supersede the earlier green/bare/grey styling of these surfaces.
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
    // Original stylesheet, before any first-scout styling was inserted.
    ".ready-card{width:min(100%,760px);border:1px solid var(--line);",
  ],
  ".first-scout-status{border-color:#bfd8c8;background:linear-gradient(145deg,#f7fbf8,#eef7f1);overflow:hidden}" +
    ".first-scout-status>div:last-child{display:flex;flex-direction:column;align-items:flex-start;gap:10px}" +
    ".first-scout-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}" +
    ".first-scout-cta{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--ink);" +
    "border-radius:9px;background:var(--ink);color:#fff;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}" +
    ".first-scout-cta:disabled{cursor:wait;opacity:.68}" +
    ".first-scout-review{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink-soft);padding:10px 14px;font:inherit;font-weight:600;cursor:pointer}" +
    ".ready-skip{align-self:center;border:0;background:transparent;color:var(--ink-soft);padding:7px 10px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}" +
    ".ready-skip:hover{color:var(--ink)}" +
    "@media(prefers-reduced-motion:reduce){.first-scout-status,.first-scout-cta{animation:none!important;transition:none!important;transform:none!important}}" +
    ".ready-card{width:min(100%,760px);border:1px solid var(--line);",
  "css",
);

// ---------------------------------------------------------------------------
// Names that survive the narrow layout.
//
// Both navigations collapse to icons on a phone by hiding their only label with
// `display:none`, which takes the text out of the accessibility tree along with
// the pixels. A screen-reader user got three unnamed buttons in the dashboard
// header and setup steps announced as "1", "2", "3" — the labels exist, they were
// just deleted for everyone rather than hidden for the eye. Clipping keeps the
// same picture and gives the text back.
//
// WCAG 2.5.3 (Label in Name) and 4.1.2 (Name, Role, Value).
// ---------------------------------------------------------------------------
const visuallyHidden =
  "position:absolute!important;width:1px!important;height:1px!important;" +
  "overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;" +
  "white-space:nowrap!important";

patch(
  "keep the primary navigation named when it collapses to icons",
  ".nav-link{padding:9px 10px;font-size:11px}.nav-link span{display:none}",
  ".nav-link{min-width:44px;min-height:44px;justify-content:center;padding:9px 10px;font-size:11px}" +
    `.nav-link span{${visuallyHidden}}`,
  "css",
);

patch(
  "keep the setup steps named when they collapse to numbers",
  ".journey-bar nav{grid-template-columns:repeat(3,35px);justify-content:center}" +
    ".journey-bar nav button{min-height:34px;padding:7px}" +
    ".journey-bar nav button>span:not(.journey-active){display:none}",
  ".journey-bar nav{grid-template-columns:repeat(3,44px);justify-content:center}" +
    ".journey-bar nav button{min-height:44px;padding:7px}" +
    `.journey-bar nav button>span:not(.journey-active){${visuallyHidden}}`,
  "css",
);

// Which view you are in is state, and state has to be exposed, not just painted.
// The active tab was styled and nothing else, so it read the same as the other two.
patch(
  "expose the current view in the primary navigation",
  'Y.jsxs(Ut.button,{type:"button",className:`nav-link ${c===ue?"active":""}`,onClick:()=>h(ue),',
  'Y.jsxs(Ut.button,{type:"button",className:`nav-link ${c===ue?"active":""}`,' +
    '"aria-current":c===ue?"page":void 0,onClick:()=>h(ue),',
);

// ---------------------------------------------------------------------------
// Touch targets, focus, and control boundaries.
//
// Appended last so these minimums win the cascade over the narrow-layout rules
// that shrank the same controls. Every value here is a floor, not a size: the
// visual density is unchanged wherever a control already cleared it.
// ---------------------------------------------------------------------------
const accessibilityFloor =
  "\n\n/* --- Accessible focus, control boundaries, and touch targets --- */\n" +
  ":root{" +
  // The shared ring was rgba(53,110,89,.28) — about 1.5:1 against every surface
  // it lands on, which is a focus indicator you cannot see. Opaque pine clears
  // 8.4:1 on white, and the light gap under it keeps that true on dark controls.
  "--focus-ring:#245640;" +
  // --line is #deded8: right for a divider at 1.35:1, not for the edge of a
  // control, which WCAG 1.4.11 wants at 3:1. Controls get their own token rather
  // than darkening every hairline in the product.
  "--line-control:#84847a}" +
  // Interactive edges only — and redefined as a variable on the control rather
  // than as a border-color beside it. Control borders are written as
  // `border:1px solid var(--line)` inside more specific rules (.settings-card
  // select, .wizard-form input, and so on); a border-color declaration out here
  // loses to every one of them. Rebinding --line on the element itself is
  // resolved at use time, so each of those rules paints the control token
  // without any of them having to be found and rewritten.
  "input,select,textarea,.track-chip,.job-filter-seg button,.feedback-other input," +
  ".decision-button,.feedback-options button,.add-location-button{--line:var(--line-control)}" +
  "@media(max-width:780px){" +
  ".preference-tabs-shell [role=tab]{min-height:44px}" +
  ".secondary-flow-button{min-height:44px}" +
  ".job-filter-seg button{min-height:44px}" +
  ".job-card-actions .decision-button{min-height:44px}" +
  ".track-chip{min-height:44px}" +
  ".feedback-options button{min-height:44px}" +
  ".job-brief-trigger{min-height:44px;padding:0}" +
  ".job-card-footer .job-link,.job-link{min-height:44px;padding-top:0}" +
  ".preferred-location-list button{min-height:44px}" +
  ".suggestion-chips button,.selected-chips button{min-height:44px}" +
  ".pause-button{min-height:44px}" +
  ".section-heading button{min-height:44px;padding:0 8px}" +
  // A one-word reason ("Pay") was 43px wide — a target that misses by a pixel
  // still misses.
  ".feedback-options button{min-width:44px}" +
  // A range input draws its own track, so the extra height is hit area rather
  // than a thicker control: the slider looks identical and can be grabbed.
  '.range-field input[type="range"],.dual-range-input{min-height:44px}' +
  // The recovery link under the invite form was a 14px-tall line of text — the
  // one control a member reaches for precisely when nothing else is working.
  ".invite-security-note a{display:inline-flex;align-items:center;min-height:44px}" +
  "}" +
  // The narrowest phones shrank the setup steps back to 31px wide. They may be
  // tight, but they cannot be smaller than a fingertip.
  "@media(max-width:420px){.journey-bar nav{grid-template-columns:repeat(3,44px)}" +
  ".journey-bar nav button{padding:5px;min-width:44px}}";

patch(
  "raise control boundaries and mobile touch targets",
  "  .wizard-privacy{margin-top:10px;padding-bottom:4px}\n}\n",
  `  .wizard-privacy{margin-top:10px;padding-bottom:4px}\n}\n${accessibilityFloor}`,
  "css",
);

// The focus rules are replaced where they live rather than overridden from the
// end of the file, so there is one focus treatment in the stylesheet and not a
// weak one shadowed by a strong one.
patch(
  "make the shared focus ring visible",
  "button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{" +
    "outline:3px solid rgba(53,110,89,.28);outline-offset:3px}",
  "button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible," +
    "[role=tab]:focus-visible,[role=radio]:focus-visible,[role=checkbox]:focus-visible{" +
    "outline:3px solid var(--focus-ring);outline-offset:2px;" +
    // A light ring between the control and the outline, so the indicator still
    // contrasts when the control itself is dark.
    "box-shadow:0 0 0 2px var(--surface)}",
  "css",
);

patch(
  "make the slider thumb's focus ring visible in both engines",
  ".dual-range-input:focus-visible::-webkit-slider-thumb{outline:3px solid rgba(38,93,72,.2);outline-offset:3px}" +
    ".dual-range-input:focus-visible::-moz-range-thumb{outline:3px solid rgba(38,93,72,.2);outline-offset:3px}",
  ".dual-range-input:focus-visible::-webkit-slider-thumb{outline:3px solid var(--focus-ring);outline-offset:2px}" +
    ".dual-range-input:focus-visible::-moz-range-thumb{outline:3px solid var(--focus-ring);outline-offset:2px}",
  "css",
);

// A heading moved to programmatically is the one thing on screen that just
// changed. This gave it focus and then told it not to show it, so a keyboard
// user was moved somewhere with no sign of having arrived. The cue is deliberate
// rather than the browser's default box: a short rule in the margin, which reads
// as punctuation next to a heading instead of a control's outline.
patch(
  "keep a visible cue on a programmatically focused heading",
  ".wizard-step-heading h2:focus{outline:none}",
  ".wizard-step-heading h2{border-radius:4px}" +
    ".wizard-step-heading h2:focus{outline:none;box-shadow:-14px 0 0 -11px var(--focus-ring)}" +
    ".wizard-step-heading h2:focus-visible{outline:3px solid var(--focus-ring);outline-offset:4px;box-shadow:none}",
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
