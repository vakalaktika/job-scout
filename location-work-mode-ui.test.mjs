import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bundle = await readFile(new URL("./assets/index-BdD4MZod.js", import.meta.url), "utf8");
const source = await readFile(new URL("./intake-flow.source.js", import.meta.url), "utf8");
const css = await readFile(new URL("./assets/index-uR5-NbPW.css", import.meta.url), "utf8");
const index = await readFile(new URL("./index.html", import.meta.url), "utf8");

test("the shipped intake exposes multiple preferred cities", () => {
  assert.match(bundle, /Preferred cities/);
  assert.match(bundle, /Add city/);
  assert.match(bundle, /mode: "popLayout"/);
  assert.match(bundle, /aria-label": `Remove \$\{re\.city\}, \$\{re\.state\}`/);
  assert.match(css, /\.preferred-location-list/);
});

test("work arrangement is an explicit multi-select checkbox group", () => {
  for (const label of ["On-site", "Hybrid", "Remote only"]) assert.match(bundle, new RegExp(label));
  assert.match(source, /role: "group"/);
  assert.match(source, /role: "checkbox"/);
  assert.match(source, /aria-checked": __jsWorkModes\.includes\(re\.id\)/);
  assert.match(source, /Choose every setup you would consider/);
  assert.doesNotMatch(source, /role: "radiogroup"/);
  assert.doesNotMatch(bundle, /Prioritize remote roles/);
});

test("the intake submits every city and keeps the compatibility remote flag", () => {
  assert.match(source, /regions: serializePreferredLocations\(normalizePreferredLocations\(l\)\)/);
  assert.match(source, /work_modes: __jsWorkModes/);
  assert.match(source, /remote: __jsWorkModes\.includes\("remote"\) \? "Yes" : "No"/);
  assert.match(bundle, /preferredLocations:parsePreferredLocations\(E\.member\.regions\)/);
  assert.match(bundle, /workModes:normalizeWorkModes\(\{workModes:E\.member\.work_modes,workMode:E\.member\.work_mode/);
});

test("new interaction motion stays transform and opacity based", () => {
  assert.doesNotMatch(source, /animate:\s*\{[^}]*\b(?:width|height|top|margin)\b/);
  for (const match of source.matchAll(/whileTap:\s*s[^?]*\?[^:]*:\s*\{\s*scale:\s*([\d.]+)/g)) {
    assert.ok(Number(match[1]) >= 0.95, `press scale ${match[1]} is too small`);
  }
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

// The bundle filename is fixed while its contents are patched in place, so the
// query string is the only thing telling a browser it has an old copy. It has to
// move with every release, and both assets have to move together.
test("the page cache key changes with the new intake bundle", () => {
  assert.match(index, /index-BdD4MZod\.js\?v=p1-fonts/);
  assert.match(index, /index-uR5-NbPW\.css\?v=p1-fonts/);
});

// The magic link is single-use, so two consumers race to spend it and the loser
// reports a link that has already been used. The app owns the exchange.
test("only the app consumes a sign-in link", () => {
  assert.doesNotMatch(index, /magic_consume/);
  assert.match(bundle, /action:"magic_consume"/);
});
