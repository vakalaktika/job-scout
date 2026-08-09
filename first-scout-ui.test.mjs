import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
const stylesheet = await readFile(new URL("./assets/index-uR5-NbPW.css", import.meta.url), "utf8");

test("the onboarding review offers the authenticated one-time first-scout CTA", () => {
  assert.match(bundle, /Find my first matches/);
  assert.match(bundle, /action:"run_scout_once",session_token:/);
  assert.match(bundle, /className:"first-scout-cta"/);
  assert.doesNotMatch(bundle, /run_scout_once[^}]+candidate_(?:id|email)/);
});

test("the dashboard polls session state while a first scout is queued", () => {
  assert.match(bundle, /first_scout/);
  assert.match(bundle, /className:"[^"]*first-scout-status/);
  assert.match(bundle, /action:"scout_status",session_token:/);
  assert.match(bundle, /action:"session",session_token:/);
  assert.match(bundle, /Your scout is searching/);
  assert.doesNotMatch(
    bundle,
    /const __jsNext=[^;]+;if\(!__jsStopped\)__jsSetScout\(__jsNext\);if\(__jsNext\.status==="complete"/,
  );
});

test("first-scout motion is transform/opacity-only and respects reduced motion", () => {
  assert.match(stylesheet, /\.first-scout-status/);
  assert.match(stylesheet, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(stylesheet, /\.first-scout[^}]*\b(?:width|height|top|margin)\s*:/);
  assert.doesNotMatch(bundle, /first-scout[^\n]{0,500}whileTap:\{scale:\.(?:9[0-4]|[0-8]\d)/);
});
