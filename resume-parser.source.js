// Resume parsing, kept as readable source and injected into the shipped bundle by
// patch-intake-flow.mjs. The minified symbols `bP` and `vP` are preserved verbatim
// because the intake component calls them by those names.
//
// The shipped parser had three defects this file fixes:
//
//   * PDF pages were flattened with `items.map(i => i.str).join(" ")`, so a whole
//     document arrived as one line and every line-oriented heuristic was blind.
//   * The first short title-cased line became the member's name, so a resume that
//     opened with an employer reported that the member was called "Microsoft".
//   * The location scan matched a state anywhere in the text and then invented that
//     state's first listed city, which is how a resume mentioning California moved a
//     member to San Francisco.
//
// Nothing here logs or transmits resume text, contact details, or identity. The
// confidence and evidence values below are UI/session metadata only: they are shown
// to the member so they can accept or reject a suggestion, and are never submitted.

const __jsParserVersion = "2";

// A suggestion at or above this confidence may prefill a blank, untouched field.
// Anything below it is offered to the member and never written on its own.
const __jsAcceptConfidence = 0.8;

// How far into the document a name may still be found. Past this the text is body
// copy, not the header block a resume opens with.
const __jsNameSearchLines = 8;

// Lines that head a resume section are never the member's name.
const __jsSectionHeadings = new Set([
  "about",
  "about me",
  "awards",
  "career history",
  "career summary",
  "certifications",
  "contact",
  "contact details",
  "core competencies",
  "core skills",
  "education",
  "employment",
  "employment history",
  "experience",
  "interests",
  "languages",
  "objective",
  "profile",
  "professional experience",
  "professional profile",
  "professional summary",
  "projects",
  "publications",
  "references",
  "selected projects",
  "skills",
  "summary",
  "technical skills",
  "volunteer",
  "work experience",
]);

// Words that mark a line as an organisation rather than a person.
const __jsOrganizationHint =
  /\b(academy|agency|associates|bank|capital|clinic|co|college|company|consulting|corp|corporation|foundation|gmbh|group|health|holdings|hospital|inc|institute|international|lab|labs|limited|llc|ltd|media|network|partners|plc|school|services|solutions|studio|studios|systems|technologies|technology|university|ventures)\b/i;

// Words that mark a line as a job title. Resumes often print the title directly
// under the name, and "Product Designer" has exactly the shape of a person's name.
const __jsJobTitleHint =
  /\b(analyst|architect|associate|consultant|coordinator|designer|developer|director|engineer|founder|head|intern|lead|manager|officer|president|principal|producer|researcher|scientist|specialist|strategist|vp)\b/i;

// Two to four capitalised words and nothing else. A single word is rejected on
// purpose: employers, section headings, and city names all take that shape, and
// accepting one is exactly how an employer name became a member's name.
const __jsNameShape = /^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){1,3}$/;

const __jsEmailShape = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// Only used to read the state out of a "City, ST" pair. Bare two-letter matching is
// deliberately not supported, because "IN", "OR", and "OK" are ordinary words.
const __jsStateAbbreviations = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

// Flatten the gazetteer once into lookups. A city name can belong to more than one
// state ("Columbia", "Portland"), so it maps to every place that claims it.
const __jsBuildPlaces = () => {
  const cities = new Map();
  const states = new Map();
  for (const [country, byState] of Object.entries(g1)) {
    for (const [state, cityList] of Object.entries(byState)) {
      states.set(state.toLowerCase(), { country, state });
      for (const city of cityList) {
        const key = city.toLowerCase();
        cities.set(key, [...(cities.get(key) || []), { country, state, city }]);
      }
    }
  }
  return { cities, states };
};

const __jsPlaces = __jsBuildPlaces();

const __jsEscapeTerm = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Where a term first appears as a whole word, or -1. `includes` was the shipped
// behaviour, and it matched "Washington" inside "Washingtonian".
const __jsFirstMention = (text, term) => {
  const match = new RegExp(`(?:^|[^\\p{L}])${__jsEscapeTerm(term)}(?:[^\\p{L}]|$)`, "iu").exec(text);
  return match ? match.index : -1;
};

// A "City, State" match may have swept up the words in front of the city, so try
// the trailing one to four words. "Kansas City" needs two, "Austin" needs one.
const __jsTrailingPhrases = (value) => {
  const words = String(value).trim().split(/\s+/);
  const phrases = [];
  for (let take = 1; take <= Math.min(4, words.length); take += 1) phrases.push(words.slice(words.length - take).join(" "));
  return phrases;
};

// The same problem at the other end: a state may be followed by a postcode word or a
// region suffix, so try the leading three words down to one.
const __jsLeadingPhrases = (value) => {
  const words = String(value).trim().split(/\s+/);
  const phrases = [];
  for (let take = Math.min(3, words.length); take >= 1; take -= 1) phrases.push(words.slice(0, take).join(" "));
  return phrases;
};

const __jsResolveState = (raw) => {
  for (const phrase of __jsLeadingPhrases(raw)) {
    const expanded = __jsStateAbbreviations[phrase.toUpperCase()] || phrase;
    const state = __jsPlaces.states.get(expanded.toLowerCase());
    if (state) return state;
  }
  return null;
};

// Resolve a location without ever inventing one. A "City, State" pair is the only
// form precise enough to trust outright; a city named on its own is a weaker
// suggestion; a state on its own suggests the state and leaves the city unset.
const __jsResolveLocation = (text) => {
  for (const [, rawCity, rawState] of text.matchAll(/([A-Za-zÀ-ÿ'’.\- ]{2,40}),\s*([A-Za-zÀ-ÿ'’.\- ]{2,40})/g)) {
    const state = __jsResolveState(rawState);
    if (!state) continue;
    for (const phrase of __jsTrailingPhrases(rawCity)) {
      const claims = __jsPlaces.cities.get(phrase.toLowerCase()) || [];
      const exact = claims.find((place) => place.state === state.state && place.country === state.country);
      if (exact) return { ...exact, confidence: 0.95 };
    }
  }

  // Fall back to the earliest unambiguous city name in the document, so a resume
  // that lists several places suggests the one it leads with.
  let city = null;
  for (const [key, claims] of __jsPlaces.cities) {
    if (claims.length !== 1) continue;
    const at = __jsFirstMention(text, key);
    if (at < 0 || (city && at >= city.at)) continue;
    city = { at, place: claims[0] };
  }
  if (city) return { ...city.place, confidence: 0.75 };

  // A state with no city of its own. The shipped parser filled in the state's first
  // listed city here; leaving the city unset is the whole point of this branch.
  let state = null;
  for (const [key, place] of __jsPlaces.states) {
    const at = __jsFirstMention(text, key);
    if (at < 0 || (state && at >= state.at)) continue;
    state = { at, place };
  }
  if (state) return { country: state.place.country, state: state.place.state, city: "", confidence: 0.5 };

  return null;
};

const __jsFindName = (lines) => {
  for (let index = 0; index < Math.min(lines.length, __jsNameSearchLines); index += 1) {
    const line = lines[index];
    if (line.length > 52) continue;
    if (__jsSectionHeadings.has(line.toLowerCase().replace(/[:•|]/g, "").trim())) continue;
    if (/[0-9@|•·,/\\]/.test(line)) continue;
    if (__jsOrganizationHint.test(line)) continue;
    if (__jsJobTitleHint.test(line)) continue;
    if (!__jsNameShape.test(line)) continue;
    return {
      value: line,
      confidence: index < 3 ? 0.9 : 0.6,
      evidence: { line: index, reason: index < 3 ? "header_block" : "early_line" },
    };
  }
  return null;
};

const __jsFindEmail = (lines) => {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(__jsEmailShape);
    if (match) return { value: match[0], confidence: 0.95, evidence: { line: index, reason: "email_address" } };
  }
  return null;
};

const __jsVocabularyMatches = (text, vocabulary, limit, confidence) => {
  const haystack = text.toLowerCase();
  return vocabulary
    .filter((term) => haystack.includes(term.toLowerCase()))
    .slice(0, limit)
    .map((value) => ({ value, confidence }));
};

// Two text items belong to different lines once their baselines differ by more than
// this many units. Only used when the PDF does not mark its own line ends.
const __jsPdfLineBreak = 2;

// pdf.js reports an explicit end-of-line flag, but only for documents that encode
// one. Where it is missing, fall back to the vertical position of each text item and
// tell the caller that the reading order is a guess.
const __jsPdfLines = (items) => {
  const marked = items.some((item) => item.hasEOL);
  const lines = [];
  let current = [];
  let lastY = null;
  const flush = () => {
    const line = current.join(" ").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
    current = [];
  };
  for (const item of items) {
    const y = Array.isArray(item.transform) ? item.transform[5] : null;
    if (!marked && lastY !== null && y !== null && Math.abs(y - lastY) > __jsPdfLineBreak) flush();
    current.push(item.str);
    if (marked && item.hasEOL) flush();
    if (y !== null) lastY = y;
  }
  flush();
  return { lines, uncertain: !marked };
};

// Returns `{ text, warnings }`. A warning describes how confidently the file could be
// read, never what it contained.
async function bP(l) {
  const e = String(l.name || "").split(".").pop()?.toLowerCase();
  if (e === "txt") return { text: await l.text(), warnings: [] };
  const t = await l.arrayBuffer();
  if (e === "doc" || e === "docx") return { text: (await QI.extractRawText({ arrayBuffer: t })).value, warnings: [] };
  if (e === "pdf") {
    const a = await D9({ data: new Uint8Array(t) }).promise;
    const pages = [];
    const warnings = [];
    for (let o = 1; o <= a.numPages; o += 1) {
      const content = await (await a.getPage(o)).getTextContent();
      const read = __jsPdfLines(content.items);
      if (read.uncertain && !warnings.includes("pdf_reading_order_uncertain")) warnings.push("pdf_reading_order_uncertain");
      pages.push(read.lines.join("\n"));
    }
    return { text: pages.join("\n"), warnings };
  }
  throw new Error("Unsupported resume format");
}

// Returns structured suggestions rather than a profile patch. Deciding what may be
// written and what has to be confirmed is the intake component's job, because only
// it knows which fields the member has already touched.
function vP(l, warnings = []) {
  const flat = String(l || "").replace(/\s+/g, " ").trim();
  const lines = String(l || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const roles = __jsVocabularyMatches(flat, gP, 3, 0.8);
  const chosen = roles
    .map((role) => role.value)
    .join(", ")
    .toLowerCase();
  return {
    suggestions: {
      name: __jsFindName(lines),
      email: __jsFindEmail(lines),
      roles,
      keywords: __jsVocabularyMatches(flat, mP, 6, 0.8),
      steerAway: SP.filter((term) => flat.toLowerCase().includes(term.toLowerCase()) && !chosen.includes(term.toLowerCase()))
        .slice(0, 4)
        .map((value) => ({ value, confidence: 0.6 })),
      location: __jsResolveLocation(flat),
    },
    warnings: [...warnings],
    parserVersion: __jsParserVersion,
  };
}
