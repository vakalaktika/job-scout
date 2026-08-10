import { readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL("./assets/index-BdD4MZod.js", import.meta.url);
const sourcePath = new URL("./intake-flow.source.js", import.meta.url);
const locationPreferencesPath = new URL("./location-preferences.mjs", import.meta.url);
const parserPath = new URL("./resume-parser.source.js", import.meta.url);
const readyPath = new URL("./ready-flow.source.js", import.meta.url);
let bundle = await readFile(bundlePath, "utf8");
const intake = await readFile(sourcePath, "utf8");
const locationPreferences = (await readFile(locationPreferencesPath, "utf8")).replace(/^export\s+/gm, "");
const parser = await readFile(parserPath, "utf8");
const ready = await readFile(readyPath, "utf8");

const standardAppStart = 'function xP(){const l=uL(),[e,t]=W.useState("invite"),[n,a]=W.useState(!1),[s,o]=W.useState(V3),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!0),';
const previousPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview")==="intake",P0=P?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P?"intake":"invite"),[n,a]=W.useState(P),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P),';
const previewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P1=P==="intake"||P==="edit",P2=P==="edit",P0=P1?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P1?"intake":"invite"),[n,a]=W.useState(P1),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P1),';
const firstScoutPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P2=P==="edit",P3=P==="ready",P4=P==="scout",P1=P==="intake"||P2,PA=P1||P3||P4,P0=PA?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",roleKeywords:"Product strategy, design systems",country:"United States",state:"California",city:"Oakland",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P3?"ready":P4?"dashboard":P1?"intake":"invite"),[n,a]=W.useState(PA),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(P3?{first_scout:{status:"available"}}:P4?{ok:!0,member:{status:"Active",match_context:""},jobs:[],hidden_count:0,last_run_at:"",first_scout:{status:"queued"}}:null),[b,v]=W.useState(!PA),';
const localFirstScoutPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P2=P==="edit",P3=P==="ready",P4=P==="scout",P1=P==="intake"||P2,PA=P1||P3||P4,P0=PA?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",roleKeywords:"Product strategy, design systems",country:"United States",state:"California",city:"Oakland",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P3?"ready":P4?"dashboard":P1?"intake":"invite"),[n,a]=W.useState(PA),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState((P3||P4)&&(window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1")?"preview-session":""),[m,g]=W.useState(P3?{first_scout:{status:"available"}}:P4?{ok:!0,member:{status:"Active",match_context:""},jobs:[],hidden_count:0,last_run_at:"",first_scout:{status:"queued"}}:null),[b,v]=W.useState(!PA),';

// The address bar is now a real route rather than a decoration. `?step=` is
// parsed once, here, so initialisation, Back/Forward, and in-app navigation all
// read the same list of supported routes instead of three different ideas of
// what the URL means — which is how the app came to render intake while the URL
// said dashboard.
//
// Two more pieces of app-level state arrive with it: `__jsDraft` holds preference
// edits away from the profile the dashboard renders, so Cancel has something to
// discard; `__jsLinkError` carries a failed magic link to the invite screen
// instead of dropping the member on a gate that never explains why.
const routedAppStart =
  'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),' +
  'P2=P==="edit",P3=P==="ready",P4=P==="scout",P1=P==="intake"||P2,PA=P1||P3||P4,' +
  '__jsSteps=["invite","intake","ready","dashboard"],' +
  '__jsReadStep=()=>{const _=new URLSearchParams(window.location.search).get("step");' +
  'return __jsSteps.includes(_)?_:""},' +
  'P0=PA?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",' +
  'roleKeywords:"Product strategy, design systems",country:"United States",state:"California",city:"Oakland",' +
  'resumeName:"alex-morgan-resume.pdf"}:V3,' +
  '[e,t]=W.useState(P3?"ready":P4?"dashboard":P1?"intake":__jsReadStep()||"invite"),' +
  '[n,a]=W.useState(PA),[s,o]=W.useState(P0),' +
  '[__jsDraft,__jsSetDraft]=W.useState(null),[__jsLinkError,__jsSetLinkError]=W.useState(""),' +
  '[c,h]=W.useState(""),[d,p]=W.useState((P3||P4)&&(window.location.hostname==="localhost"||' +
  'window.location.hostname==="127.0.0.1")?"preview-session":""),' +
  '[m,g]=W.useState(P3?{first_scout:{status:"available"}}:P4?{ok:!0,member:{status:"Active",match_context:""},' +
  'jobs:[],hidden_count:0,last_run_at:"",first_scout:{status:"queued"}}:null),[b,v]=W.useState(!PA),';

const appStartAnchors = [
  standardAppStart,
  previousPreviewAppStart,
  previewAppStart,
  firstScoutPreviewAppStart,
  localFirstScoutPreviewAppStart,
];
const appStartAnchor = appStartAnchors.find((anchor) => bundle.includes(anchor));
if (appStartAnchor) {
  bundle = bundle.replace(appStartAnchor, routedAppStart);
} else if (!bundle.includes(routedAppStart)) {
  throw new Error("Could not add the local intake preview entry point to the current bundle.");
}

// ---------------------------------------------------------------------------
// One navigator for every route change.
//
// Clicking through the app pushed `?step=`, but nothing read it back: start-up
// looked only at `?preview=` and no `popstate` handler existed, so pressing Back
// rewrote the URL and left the previous screen on display. Every route change now
// goes through `__jsShow`, which is also where the draft is dropped when the
// member leaves the editor and where focus moves to the heading of the view they
// just landed on.
// ---------------------------------------------------------------------------
const originalNavigate =
  'D=_=>{if(!n&&_!=="invite")return;const E=new URL(window.location.href);' +
  'E.searchParams.delete("preview"),E.searchParams.set("step",_),window.history.pushState({},"",E),' +
  't(_),window.scrollTo({top:0,behavior:l?"auto":"smooth"})}';
const routedNavigate =
  '__jsFocusStep=()=>{requestAnimationFrame(()=>{' +
  'const _=document.querySelector(".journey-screen h1,.member-screen h1");' +
  '_&&(_.setAttribute("tabindex","-1"),_.focus({preventScroll:!0}))})},' +
  '__jsShow=_=>{_!=="intake"&&__jsSetDraft(null),t(_),' +
  'window.scrollTo({top:0,behavior:l?"auto":"smooth"}),__jsFocusStep()},' +
  '__jsGuardStep=()=>{const _=new URL(window.location.href);' +
  '_.searchParams.get("step")&&(_.searchParams.delete("step"),window.history.replaceState({},"",_)),' +
  't("invite")},' +
  'D=_=>{if(!n&&_!=="invite")return;const E=new URL(window.location.href);' +
  'E.searchParams.delete("preview"),E.searchParams.set("step",_),window.history.pushState({},"",E),__jsShow(_)}';
if (bundle.includes(originalNavigate)) {
  bundle = bundle.replace(originalNavigate, routedNavigate);
} else if (!bundle.includes(routedNavigate)) {
  throw new Error("Could not centralise route navigation in the current bundle.");
}

// A route nobody is signed in for is not a route. Boot resolves the stored
// session first; if there is none, the URL is put back to the invite gate rather
// than leaving `?step=dashboard` pointing at a screen the member cannot see.
const unguardedBoot =
  'const S=A==null?void 0:A.token;if(!S){_||v(!1);return}try{const U=await fetch(l6,' +
  '{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"session",session_token:S})}),k=await U.json();' +
  'if(!U.ok||!k.ok)throw new Error(k.error||"session_failed");_||w("",k)}' +
  'catch(U){console.error(U),localStorage.removeItem(Gf)}finally{_||v(!1)}';
const guardedBoot =
  'const S=A==null?void 0:A.token;if(!S){_||PA||__jsGuardStep(),_||v(!1);return}try{const U=await fetch(l6,' +
  '{method:"POST",headers:{"Content-Type":"application/json"},' +
  'body:JSON.stringify({action:"session",session_token:S})}),k=await U.json();' +
  'if(!U.ok||!k.ok)throw new Error(k.error||"session_failed");_||w("",k)}' +
  'catch(U){console.error(U),localStorage.removeItem(Gf),_||PA||__jsGuardStep()}finally{_||v(!1)}';
if (bundle.includes(unguardedBoot)) {
  bundle = bundle.replace(unguardedBoot, guardedBoot);
} else if (!bundle.includes(guardedBoot)) {
  throw new Error("Could not guard the initial route against an unauthenticated session.");
}

// Back and Forward move the app, not just the address bar.
const bootEffectTail = 'finally{_||v(!1)}})(),()=>{_=!0}},[]),b?Y.jsxs("div",{className:"session-loading"';
const popstateEffect =
  'finally{_||v(!1)}})(),()=>{_=!0}},[]),' +
  'W.useEffect(()=>{const _=()=>{const E=__jsReadStep();' +
  'if(!n){E&&E!=="invite"?__jsGuardStep():t("invite"),__jsFocusStep();return}' +
  '__jsShow(E||"dashboard")};window.addEventListener("popstate",_);' +
  'return()=>window.removeEventListener("popstate",_)},[n]),' +
  'b?Y.jsxs("div",{className:"session-loading"';
if (bundle.includes(bootEffectTail)) {
  bundle = bundle.replace(bootEffectTail, popstateEffect);
} else if (!bundle.includes(popstateEffect)) {
  throw new Error("Could not synchronise the app with browser history.");
}

// The editor works on a draft, not on the profile the dashboard is rendering.
// Editing wrote straight into the shared profile, so Cancel navigated away from
// changes that were already live: setting a role to something and pressing Cancel
// showed that role on the dashboard a moment later. The draft is committed only
// when the save comes back ok, and dropped on any other way out — which is what
// makes Cancel mean cancel and a failed save keep the member's work on screen
// without leaking it.
const standardIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D("ready")},shouldReduceMotion:l}):null';
const editingIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D(P2||!!(m!=null&&m.member)?"dashboard":"ready")},shouldReduceMotion:l,isEditing:P2||!!(m!=null&&m.member),onCancel:()=>D("dashboard")}):null';
const draftedIntakeCall =
  'e==="intake"?Y.jsx(TP,{profile:__jsDraft||s,' +
  'onChange:__jsU=>__jsSetDraft(__jsP=>typeof __jsU=="function"?__jsU(__jsP||s):__jsU),' +
  'inviteCode:c,sessionToken:d,' +
  'onSubmitted:_=>{g(_),x(_),__jsDraft&&o(__jsDraft),' +
  'D(P2||!!(m!=null&&m.member)?"dashboard":"ready")},' +
  'shouldReduceMotion:l,isEditing:P2||!!(m!=null&&m.member),onCancel:()=>D("dashboard")}):null';
const intakeCallAnchor = [standardIntakeCall, editingIntakeCall].find((anchor) => bundle.includes(anchor));
if (intakeCallAnchor) {
  bundle = bundle.replace(intakeCallAnchor, draftedIntakeCall);
} else if (!bundle.includes(draftedIntakeCall)) {
  throw new Error("Could not connect dashboard editing state to the intake component.");
}

const standardReadyCall = 'e==="ready"?Y.jsx(AP,{profile:s,onBack:()=>D("intake"),onContinue:()=>D("dashboard"),shouldReduceMotion:l}):null';
const firstScoutReadyCall = 'e==="ready"?Y.jsx(AP,{profile:s,onBack:()=>D("intake"),onContinue:()=>D("dashboard"),onQueued:_=>{g(E=>({...E,first_scout:_.first_scout})),D("dashboard")},memberState:m,sessionToken:d,shouldReduceMotion:l}):null';
if (bundle.includes(standardReadyCall)) {
  bundle = bundle.replace(standardReadyCall, firstScoutReadyCall);
} else if (!bundle.includes(firstScoutReadyCall)) {
  throw new Error("Could not connect the one-time scout CTA to the app session.");
}

const standardJourneyBar = 'children:[e!=="dashboard"?Y.jsx(DP,{step:e,unlocked:n,onNavigate:D}):null,';
const editingJourneyBar = 'children:[e!=="dashboard"&&!(e==="intake"&&(P2||!!(m!=null&&m.member)))?Y.jsx(DP,{step:e,unlocked:n,onNavigate:D}):null,';
if (bundle.includes(standardJourneyBar)) {
  bundle = bundle.replace(standardJourneyBar, editingJourneyBar);
} else if (!bundle.includes(editingJourneyBar)) {
  throw new Error("Could not remove onboarding progress from dashboard editing.");
}

const standardShellClass = 'className:e==="dashboard"?"member-shell":"journey-shell"';
const statefulShellClass = 'className:e==="dashboard"?"member-shell":`journey-shell journey-${e}`';
if (bundle.includes(standardShellClass)) {
  bundle = bundle.replace(standardShellClass, statefulShellClass);
} else if (!bundle.includes(statefulShellClass)) {
  throw new Error("Could not add journey state classes for responsive layouts.");
}

// Keep the active production bundle on one restrained motion language. These
// replacements cover the dashboard, authentication, onboarding, and feedback
// surfaces that live outside the maintainable intake component below.
const motionReplacements = [
  ['{type:"spring",stiffness:400,damping:28}', '{type:"spring",stiffness:420,damping:32}'],
  ['{type:"spring",stiffness:180,damping:24}', '{type:"spring",stiffness:320,damping:34}'],
  ['{type:"spring",stiffness:300,damping:15}', '{type:"spring",stiffness:360,damping:24}'],
  ['{opacity:0,y:8}', '{opacity:0,y:4}'],
  ['{opacity:0,y:10}', '{opacity:0,y:4}'],
  ['{opacity:0,y:-6}', '{opacity:0,y:-3}'],
  ['{opacity:0,y:-8}', '{opacity:0,y:-3}'],
  ['{opacity:0,y:18,scale:.98}', '{opacity:0,y:6,scale:.995}'],
  ['{opacity:0,y:14,scale:.99}', '{opacity:0,y:5}'],
  ['{opacity:0,scale:.96}', '{opacity:0,scale:.985}'],
  ['{opacity:0,y:16,scale:.985}', '{opacity:0,y:6}'],
  ['{opacity:0,x:-18,scale:.98}', '{opacity:0,x:-8,scale:.995}'],
];
for (const [from, to] of motionReplacements) {
  bundle = bundle.replaceAll(from, to);
}

// Replace the resume parser by boundary, from the start of `bP` up to but not
// including `vx`, the first function that follows `vP`. Two start markers are
// accepted so the script is idempotent: the original minified parser, and the
// already-injected source, whose opening comment line is the marker. Anything else
// throws rather than guessing where the parser ends.
const originalParserStart = "async function bP(";
const injectedParserStart = "// Resume parsing, kept as readable source";
const parserEndMarker = "function vx(";
const parserStart = [injectedParserStart, originalParserStart].map((marker) => bundle.indexOf(marker)).find((at) => at >= 0);
const parserEnd = parserStart === undefined ? -1 : bundle.indexOf(parserEndMarker, parserStart);

if (parserStart === undefined || parserEnd < 0) {
  throw new Error("Could not find the resume parser boundaries in the current bundle.");
}

bundle = `${bundle.slice(0, parserStart)}${parser.trim()}\n${bundle.slice(parserEnd)}`;

// A location the member never chose is not a location. The bundle shipped San
// Francisco, California as the starting profile, so anyone who never opened the
// location step still submitted a real city, and their search ran against a place
// they had never named. Location now starts empty and the intake requires a
// deliberate choice before it will accept the step.
const defaultLocation = 'resumeSuggestions:[],country:"United States",state:"California",city:"San Francisco",salaryMin:140';
const unsetLocation = 'resumeSuggestions:[],country:"",state:"",city:"",salaryMin:140';
if (bundle.includes(defaultLocation)) {
  bundle = bundle.replace(defaultLocation, unsetLocation);
} else if (!bundle.includes(unsetLocation)) {
  throw new Error("Could not clear the default location in the current bundle.");
}

const legacyHydration = 'postedWithin:U.postedWithin||k.postedWithin,remote:E.member.remote?E.member.remote==="Yes":k.remote,...__jsRegion(E.member,k),resumeName:';
const previousMultiLocationHydration = 'postedWithin:U.postedWithin||k.postedWithin,preferredLocations:parsePreferredLocations(E.member.regions),workMode:workModeFromProfile({workMode:(String(E.member.notes||"").match(/^Work mode:\\s*(.+)$/im)||[])[1],remote:E.member.remote?E.member.remote==="Yes":k.remote}),remote:E.member.remote?E.member.remote==="Yes":k.remote,...__jsRegion(E.member,k),resumeName:';
const singleWorkModeHydration = 'postedWithin:U.postedWithin||k.postedWithin,preferredLocations:parsePreferredLocations(E.member.regions),workMode:workModeFromProfile({workMode:E.member.work_mode,remote:E.member.remote?E.member.remote==="Yes":k.remote}),remote:E.member.remote?E.member.remote==="Yes":k.remote,...__jsRegion(E.member,k),resumeName:';
const multiLocationHydration = 'postedWithin:U.postedWithin||k.postedWithin,preferredLocations:parsePreferredLocations(E.member.regions),workModes:normalizeWorkModes({workModes:E.member.work_modes,workMode:E.member.work_mode,remote:E.member.remote?E.member.remote==="Yes":k.remote}),remote:E.member.remote?E.member.remote==="Yes":k.remote,...__jsRegion(E.member,k),resumeName:';
// Paused is carried as its own field rather than being guessed from a frequency
// that stays set while delivery is off. Without it the editor showed a cadence a
// paused member was not actually on, and saving anything sent that cadence back.
const pausedHydration = `paused:E.member.status==="Paused",${multiLocationHydration}`;
// The final form contains its own last anchor, so it has to be tested first or
// each run prepends another copy of the paused field.
if (!bundle.includes(pausedHydration)) {
  const hydrationAnchor = [
    legacyHydration,
    previousMultiLocationHydration,
    singleWorkModeHydration,
    multiLocationHydration,
  ].find((anchor) => bundle.includes(anchor));
  if (!hydrationAnchor) {
    throw new Error("Could not hydrate saved preferred locations and work arrangement.");
  }
  bundle = bundle.replace(hydrationAnchor, pausedHydration);
}

// The old parser's steer-away helper. The rewritten parser derives those terms
// itself, so this is now unreachable; drop it rather than ship dead code.
const orphanedSteerAwayHelper =
  'EP=(l,e)=>{const t=String(e||"").toLowerCase();return SP.filter(n=>String(l||"").toLowerCase().includes(n.toLowerCase())&&!t.includes(n.toLowerCase())).slice(0,4)},';
if (bundle.includes(orphanedSteerAwayHelper)) {
  bundle = bundle.replace(orphanedSteerAwayHelper, "");
} else if (/\bEP\b/.test(bundle)) {
  throw new Error("The orphaned steer-away helper is present in an unexpected shape.");
}

const injectedLocationStart = "// Preferred location helpers are shared";
const intakeStart = [bundle.indexOf(injectedLocationStart), bundle.indexOf("function TP(")].find((at) => at >= 0);
const end = bundle.indexOf("function AP(", intakeStart);

if (intakeStart === undefined || end < 0) {
  throw new Error("Could not find the intake component boundaries in the current bundle.");
}

const intakeBlock = `${locationPreferences.trim()}\n${intake.trim()}`;
bundle = `${bundle.slice(0, intakeStart)}${intakeBlock}${bundle.slice(end)}`;

const readyStart = bundle.indexOf("function AP(");
const readyEnd = bundle.indexOf("dk.createRoot(", readyStart);
if (readyStart < 0 || readyEnd < 0) {
  throw new Error("Could not find the ready component boundaries in the current bundle.");
}

const nextBundle = `${bundle.slice(0, readyStart)}${ready.trim()}${bundle.slice(readyEnd)}`;
await writeFile(bundlePath, nextBundle);

console.log(`Replaced resume parser (${parserEnd - parserStart} bytes → ${parser.trim().length} bytes).`);
console.log(`Replaced intake component (${end - intakeStart} bytes → ${intakeBlock.length} bytes).`);
console.log(`Replaced ready component (${readyEnd - readyStart} bytes → ${ready.length} bytes).`);
