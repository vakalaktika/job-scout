import { readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL("./assets/index-BdD4MZod.js", import.meta.url);
const sourcePath = new URL("./intake-flow.source.js", import.meta.url);
let bundle = await readFile(bundlePath, "utf8");
const intake = await readFile(sourcePath, "utf8");

const standardAppStart = 'function xP(){const l=uL(),[e,t]=W.useState("invite"),[n,a]=W.useState(!1),[s,o]=W.useState(V3),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!0),';
const previousPreviewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview")==="intake",P0=P?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P?"intake":"invite"),[n,a]=W.useState(P),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P),';
const previewAppStart = 'function xP(){const l=uL(),P=new URLSearchParams(window.location.search).get("preview"),P1=P==="intake"||P==="edit",P2=P==="edit",P0=P1?{...V3,name:"Alex Morgan",email:"alex@example.com",roles:"Senior Product Designer, Design Lead",resumeName:"alex-morgan-resume.pdf"}:V3,[e,t]=W.useState(P1?"intake":"invite"),[n,a]=W.useState(P1),[s,o]=W.useState(P0),[c,h]=W.useState(""),[d,p]=W.useState(""),[m,g]=W.useState(null),[b,v]=W.useState(!P1),';

if (bundle.includes(standardAppStart)) {
  bundle = bundle.replace(standardAppStart, previewAppStart);
} else if (bundle.includes(previousPreviewAppStart)) {
  bundle = bundle.replace(previousPreviewAppStart, previewAppStart);
} else if (!bundle.includes(previewAppStart)) {
  throw new Error("Could not add the local intake preview entry point to the current bundle.");
}

const standardIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D("ready")},shouldReduceMotion:l}):null';
const editingIntakeCall = 'e==="intake"?Y.jsx(TP,{profile:s,onChange:o,inviteCode:c,sessionToken:d,onSubmitted:_=>{g(_),x(_),D(P2||!!(m!=null&&m.member)?"dashboard":"ready")},shouldReduceMotion:l,isEditing:P2||!!(m!=null&&m.member),onCancel:()=>D("dashboard")}):null';
if (bundle.includes(standardIntakeCall)) {
  bundle = bundle.replace(standardIntakeCall, editingIntakeCall);
} else if (!bundle.includes(editingIntakeCall)) {
  throw new Error("Could not connect dashboard editing state to the intake component.");
}

const standardJourneyBar = 'children:[e!=="dashboard"?Y.jsx(DP,{step:e,unlocked:n,onNavigate:D}):null,';
const editingJourneyBar = 'children:[e!=="dashboard"&&!(e==="intake"&&(P2||!!(m!=null&&m.member)))?Y.jsx(DP,{step:e,unlocked:n,onNavigate:D}):null,';
if (bundle.includes(standardJourneyBar)) {
  bundle = bundle.replace(standardJourneyBar, editingJourneyBar);
} else if (!bundle.includes(editingJourneyBar)) {
  throw new Error("Could not remove onboarding progress from dashboard editing.");
}

const start = bundle.indexOf("function TP(");
const end = bundle.indexOf("function AP(", start);

if (start < 0 || end < 0) {
  throw new Error("Could not find the intake component boundaries in the current bundle.");
}

const nextBundle = `${bundle.slice(0, start)}${intake.trim()}${bundle.slice(end)}`;
await writeFile(bundlePath, nextBundle);

console.log(`Replaced intake component (${end - start} bytes → ${intake.length} bytes).`);
