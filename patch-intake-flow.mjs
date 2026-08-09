import { readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL("./assets/index-BdD4MZod.js", import.meta.url);
const sourcePath = new URL("./intake-flow.source.js", import.meta.url);
const parserPath = new URL("./resume-parser.source.js", import.meta.url);
const readyPath = new URL("./ready-flow.source.js", import.meta.url);
let bundle = await readFile(bundlePath, "utf8");
const intake = await readFile(sourcePath, "utf8");
const parser = await readFile(parserPath, "utf8");
const ready = await readFile(readyPath, "utf8");

const standardAppStart = 'function xP(){const l=uL(),[e,t]=W.useState("invite"),[n,a]=W.useState(!1),[s,o]=W.useState(V3),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!0),';
const previousPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview")==="intake",P0=P?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P?"intake":"invite"),[n,a]=W.useState(P),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P),';
const previewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P1=P==="intake"||P==="edit",P2=P==="edit",P0=P1?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P1?"intake":"invite"),[n,a]=W.useState(P1),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P1),';
const firstScoutPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P2=P==="edit",P3=P==="ready",P4=P==="scout",P1=P==="intake"||P2,PA=P1||P3||P4,P0=PA?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",roleKeywords:"Product strategy, design systems",country:"United States",state:"California",city:"Oakland",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P3?"ready":P4?"dashboard":P1?"intake":"invite"),[n,a]=W.useState(PA),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(P3?{first_scout:{status:"available"}}:P4?{ok:!0,member:{status:"Active",match_context:""},jobs:[],hidden_count:0,last_run_at:"",first_scout:{status:"queued"}}:null),[b,v]=W.useState(!PA),';

if (bundle.includes(standardAppStart)) {
  bundle = bundle.replace(standardAppStart, firstScoutPreviewAppStart);
} else if (bundle.includes(previousPreviewAppStart)) {
  bundle = bundle.replace(previousPreviewAppStart, firstScoutPreviewAppStart);
} else if (bundle.includes(previewAppStart)) {
  bundle = bundle.replace(previewAppStart, firstScoutPreviewAppStart);
} else if (!bundle.includes(firstScoutPreviewAppStart)) {
  throw new Error("Could not add the local intake preview entry point to the current bundle.");
}

const standardIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D("ready")},shouldReduceMotion:l}):null';
const editingIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D(P2||!!(m!=null&&m.member)?"dashboard":"ready")},shouldReduceMotion:l,isEditing:P2||!!(m!=null&&m.member),onCancel:()=>D("dashboard")}):null';
if (bundle.includes(standardIntakeCall)) {
  bundle = bundle.replace(standardIntakeCall, editingIntakeCall);
} else if (!bundle.includes(editingIntakeCall)) {
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

// The old parser's steer-away helper. The rewritten parser derives those terms
// itself, so this is now unreachable; drop it rather than ship dead code.
const orphanedSteerAwayHelper =
  'EP=(l,e)=>{const t=String(e||"").toLowerCase();return SP.filter(n=>String(l||"").toLowerCase().includes(n.toLowerCase())&&!t.includes(n.toLowerCase())).slice(0,4)},';
if (bundle.includes(orphanedSteerAwayHelper)) {
  bundle = bundle.replace(orphanedSteerAwayHelper, "");
} else if (/\bEP\b/.test(bundle)) {
  throw new Error("The orphaned steer-away helper is present in an unexpected shape.");
}

const start = bundle.indexOf("function TP(");
const end = bundle.indexOf("function AP(", start);

if (start < 0 || end < 0) {
  throw new Error("Could not find the intake component boundaries in the current bundle.");
}

bundle = `${bundle.slice(0, start)}${intake.trim()}${bundle.slice(end)}`;

const readyStart = bundle.indexOf("function AP(");
const readyEnd = bundle.indexOf("dk.createRoot(", readyStart);
if (readyStart < 0 || readyEnd < 0) {
  throw new Error("Could not find the ready component boundaries in the current bundle.");
}

const nextBundle = `${bundle.slice(0, readyStart)}${ready.trim()}${bundle.slice(readyEnd)}`;
await writeFile(bundlePath, nextBundle);

console.log(`Replaced resume parser (${parserEnd - parserStart} bytes → ${parser.trim().length} bytes).`);
console.log(`Replaced intake component (${end - start} bytes → ${intake.length} bytes).`);
console.log(`Replaced ready component (${readyEnd - readyStart} bytes → ${ready.length} bytes).`);
