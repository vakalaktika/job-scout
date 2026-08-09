function TP({ profile: l, onChange: e, inviteCode: t, sessionToken: n, onSubmitted: a, shouldReduceMotion: s, isEditing: H = false, onCancel: M }) {
  const [o, c] = W.useState(l.resumeName || "");
  const [h, d] = W.useState("");
  const [p, m] = W.useState(l.resumeName ? "stored" : "idle");
  const [g, b] = W.useState([]);
  const [v, x] = W.useState(false);
  const [D, w] = W.useState("");
  const [T, R] = W.useState(H ? 1 : 0);
  const [L, F] = W.useState("");
  const [B, G] = W.useState([]);
  const I = ["intake", "edit"].includes(new URLSearchParams(window.location.search).get("preview"));

  const N = H
    ? [
        { label: "Profile", title: "Profile and resume", copy: "Update where we contact you or replace the resume your scout uses." },
        { label: "Roles", title: "Roles and focus", copy: "Tune the work you want to see and the signals that make a match feel relevant." },
        { label: "Location & pay", title: "Location and fit", copy: "Adjust where you can work, compensation, seniority, and posting freshness." },
        { label: "Filters", title: "Filters", copy: "Quiet down roles that look relevant on paper but are not right for you." },
        { label: "Delivery", title: "Delivery", copy: "Choose how often your scout should send a fresh shortlist." },
      ]
    : [
        { label: "Basics", title: "Start with you", copy: "Your resume does most of the work here." },
        { label: "Roles", title: "What would feel like a good next move?", copy: "A couple of role titles is plenty. Keep it broad if you are exploring." },
        { label: "Location", title: "Where should the search focus?", copy: "Set practical boundaries for location, pay, and level." },
        { label: "Filters", title: "What should we avoid?", copy: "Optional. Use this to quiet down roles that look relevant on paper but are not for you." },
        { label: "Delivery", title: "How often should we check in?", copy: "Choose a rhythm that keeps the search useful, not noisy." },
      ];
  const C = H ? [1, 2, 3, 4, 0] : [0, 1, 2, 3, 4];
  // Which fields the member has set themselves. A field they touched is theirs, and a
  // later resume upload may suggest a different value but never writes over it.
  const [__jsTouched, __jsSetTouched] = W.useState({});

  // Forward arrow (→) for navigation CTAs. The bundled icon set only ships an
  // up-right arrow (↗), which reads as "opens in a new tab"; this plain
  // right-pointing arrow inherits the button's text color instead.
  const __jsForward = () =>
    Y.jsx("svg", {
      width: 17,
      height: 17,
      viewBox: "0 0 256 256",
      fill: "currentColor",
      "aria-hidden": "true",
      children: Y.jsx("path", {
        d: "M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z",
      }),
    });

  // Location is chosen, never assumed. Picking a country clears the state and city
  // below it rather than jumping to whichever happened to be listed first, so a
  // half-made choice reads as unfinished instead of as a real place.
  const __jsPickLocation = (re) => {
    F("");
    __jsSetTouched((oe) => ({ ...oe, country: true, state: true, city: true }));
    e((oe) => ({ ...oe, ...re }));
  };
  const __jsPlaceholder = (re) => Y.jsx("option", { value: "", disabled: true, children: re }, "__jsPlaceholder");
  const __jsLocationError = "Choose the country, state, and city your search should cover.";
  const __jsLocationMissing = (re) => !re.country || !re.state || !re.city;
  const A = (j, O) => {
    F("");
    __jsSetTouched((X) => (X[j] ? X : { ...X, [j]: true }));
    e((X) => ({ ...X, [j]: O }));
  };
  const S = RP(l.steerAwayTerms);
  const U = (Array.isArray(l.resumeSuggestions) ? l.resumeSuggestions : [])
    .filter(
      (j) =>
        !String(l.roles || "")
          .toLowerCase()
          .includes(j.toLowerCase()) &&
        !S.some((O) => O.toLowerCase() === j.toLowerCase()),
    )
    .slice(0, 4);
  const k = (j) =>
    A(
      "steerAwayTerms",
      [...S, j]
        .filter((O, X, q) => q.findIndex((Q) => Q.toLowerCase() === O.toLowerCase()) === X)
        .join(", "),
    );
  const j = (O) =>
    A(
      "steerAwayTerms",
      S.filter((X) => X.toLowerCase() !== O.toLowerCase()).join(", "),
    );
  const O = g1[l.country] || {};
  const X = O[l.state] || [];
  // Resume suggestions prefill a blank first-time form, but on a saved profile
  // they must not overwrite preferences the member already curated. The parser
  // used to scan the whole resume against the location gazetteer and fall back to
  // a state's first listed city, so a resume that mentioned "California" anywhere
  // rewrote a saved Austin to San Francisco the moment the member replaced
  // their file — on a tab they never opened. When editing, only the steer-away
  // suggestions survive: they render as optional chips instead of writing into
  // a field.
  //
  // The parser no longer invents a city, and now reports how far it trusts each
  // suggestion. Writing one is gated twice over: the parser has to clear its own
  // accept threshold, and the field has to be one the member has not set.
  const __jsConfident = (re) => !!re && re.confidence >= __jsAcceptConfidence;
  const __jsValues = (re) => (re || []).map((ne) => ne.value);
  const __jsBlank = (ne) => !__jsTouched[ne] && !String(l[ne] || "").trim();

  // A location is only written when the parser resolved a real city inside a real
  // state. A state-only suggestion stays pending rather than filling in a city the
  // resume never mentioned.
  const __jsResumeLocation = (ne) => {
    if (!__jsConfident(ne) || !ne.city) return {};
    if (__jsTouched.country || __jsTouched.state || __jsTouched.city) return {};
    if (!(g1[ne.country] || {})[ne.state] || !g1[ne.country][ne.state].includes(ne.city)) return {};
    return { country: ne.country, state: ne.state, city: ne.city };
  };

  // Describe what the upload actually did. Steer-away terms are offered as chips the
  // member clicks, so they are never reported as a field we filled in.
  const __jsFieldLabels = { name: "your name", email: "your email", roles: "roles", roleKeywords: "keywords", country: "location", state: "location", city: "location" };
  const __jsFilledCopy = (ne) => {
    const ae = ne.filter((le) => le !== "resumeSuggestions").map((le) => __jsFieldLabels[le] || le);
    const ie = ae.filter((le, se, ue) => ue.indexOf(le) === se);
    const oe = ne.includes("resumeSuggestions") ? " We also suggested a few filters to steer away from." : "";
    if (!ie.length) return `We found nothing safe to fill in for you.${oe}`;
    return `We filled ${ie.join(", ")}. You can review each choice as you go.${oe}`;
  };

  const __jsResumePrefill = (ne, ie) => {
    const ae = __jsValues(ne.steerAway);
    const le = ae.length ? { resumeSuggestions: ae } : {};
    if (ie) return le;
    return {
      ...le,
      ...(__jsConfident(ne.name) && __jsBlank("name") ? { name: ne.name.value } : {}),
      ...(__jsConfident(ne.email) && __jsBlank("email") ? { email: ne.email.value } : {}),
      ...(ne.roles.length && __jsBlank("roles") ? { roles: __jsValues(ne.roles).join(", ") } : {}),
      ...(ne.keywords.length && __jsBlank("roleKeywords") ? { roleKeywords: __jsValues(ne.keywords).join(", ") } : {}),
      ...__jsResumeLocation(ne.location),
    };
  };

  const q = async (Q) => {
    if (!Q) return;
    w("");
    F("");
    c(Q.name);
    A("resumeName", Q.name);
    m("reading");
    b([]);
    G([]);
    try {
      const Z = await bP(Q);
      d(Z.text);
      const ee = vP(Z.text, Z.warnings);
      G(ee.warnings);
      const ie = __jsResumePrefill(ee.suggestions, H);
      const te = Object.keys(ie);
      if (te.length) e((ne) => ({ ...ne, ...ie }));
      b(te);
      m(te.length ? "complete" : "empty");
    } catch (Z) {
      console.error(Z);
      m("error");
    }
  };
  const Q = (Z) => q(Z.target.files?.[0]);
  const Z = (ee) => {
    ee.preventDefault();
    x(false);
    q(ee.dataTransfer.files?.[0]);
  };
  const ee = () => {
    if (T === 0) {
      if (!l.name.trim()) return "Add your name to continue.";
      if (!l.email.trim() || !/^\S+@\S+\.\S+$/.test(l.email)) return "Enter a valid email address to continue.";
      if (!h && !n && !l.resumeName) return "Add your resume so your scout has enough context to find relevant roles.";
    }
    if (T === 1 && !l.roles.trim()) return "Add at least one role you would be happy to apply for.";
    if (T === 2 && __jsLocationMissing(l)) return __jsLocationError;
    return "";
  };
  const ce = (ne, ae = false) => {
    requestAnimationFrame(() => {
      const le = document.getElementById(`preference-tab-${ne}`);
      if (!le) return;
      if (ae) le.focus();
      le.scrollIntoView({ behavior: s ? "auto" : "smooth", block: "nearest", inline: "center" });
    });
  };
  const te = (ne) => {
    R(ne);
    F("");
    if (H) {
      ce(ne);
    } else {
      requestAnimationFrame(() => document.getElementById("intake-step-heading")?.focus());
      window.scrollTo({ top: 0, behavior: s ? "auto" : "smooth" });
    }
  };
  const fe = (ne, ae) => {
    const le = C.indexOf(ae);
    const ie =
      ne.key === "ArrowRight"
        ? C[(le + 1) % C.length]
        : ne.key === "ArrowLeft"
          ? C[(le - 1 + C.length) % C.length]
          : ne.key === "Home"
            ? C[0]
            : ne.key === "End"
              ? C[C.length - 1]
              : null;
    if (ie === null) return;
    ne.preventDefault();
    R(ie);
    F("");
    ce(ie, true);
  };
  const ne = () => {
    const ae = ee();
    if (ae) {
      F(ae);
      return;
    }
    te(Math.min(T + 1, N.length - 1));
  };
  const ae = async (le) => {
    le.preventDefault();
    if (!H && T < N.length - 1) {
      ne();
      return;
    }
    if (H && (!l.name.trim() || !/^\S+@\S+\.\S+$/.test(l.email))) {
      te(0);
      F("Add a valid name and email before saving your changes.");
      return;
    }
    if (H && !l.roles.trim()) {
      te(1);
      F("Add at least one role you would be happy to apply for.");
      return;
    }
    if (H && __jsLocationMissing(l)) {
      te(2);
      F(__jsLocationError);
      return;
    }
    const ie = ee();
    if (ie) {
      F(ie);
      return;
    }
    if (I) {
      m("complete");
      a({ member: null });
      return;
    }
    w("");
    m("submitting");
    try {
      const re = l.frequency === "Three times a day" ? "3x daily" : l.frequency;
      const oe = await fetch(l6, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_code: t,
          session_token: n,
          name: l.name.trim(),
          email: l.email.trim(),
          resume_name: o || l.resumeName,
          resume_text: h,
          target_roles: l.roles,
          role_keywords: l.roleKeywords,
          regions: `${l.city}, ${l.state}, ${l.country}`,
          remote: l.remote ? "Yes" : "No",
          min_salary: `$${l.salaryMin}k`,
          max_salary: `$${l.salaryMax}k+`,
          seniority: l.seniority,
          frequency: re,
          max_posting_age: l.postedWithin,
          steer_away_terms: l.steerAwayTerms,
          steer_away_mode: l.steerAwayMode,
          resume_suggestions: l.resumeSuggestions,
          submitted_at: new Date().toISOString(),
        }),
      });
      const se = await oe.json();
      if (!oe.ok || !se.ok) throw new Error(se.error || "submit_failed");
      m("complete");
      a(se);
    } catch (re) {
      console.error(re);
      m("complete");
      w("We couldn’t save your setup. Nothing was lost, so please try again.");
    }
  };

  const le = (ie) =>
    Y.jsxs("div", {
      className: "wizard-step-heading",
      children: [
        H
          ? ie
            ? Y.jsx("div", { className: "wizard-kicker-row", children: Y.jsx("span", { className: "optional-badge", children: "Optional" }) })
            : null
          : Y.jsxs("div", {
              className: `wizard-kicker-row ${ie ? "has-optional" : "step-only"}`,
              children: [
                Y.jsxs("span", { className: "step-count-kicker", children: ["Step ", T + 1, " of ", N.length] }),
                ie ? Y.jsx("span", { className: "optional-badge", children: "Optional" }) : null,
              ],
            }),
        Y.jsx("h2", { id: "intake-step-heading", tabIndex: -1, children: N[T].title }),
        Y.jsx("p", { children: N[T].copy }),
      ],
    });

  const ie = () => {
    if (T === 0) {
      return Y.jsxs(Y.Fragment, {
        children: [
          le(false),
          Y.jsxs("div", {
            className: "field-grid two-up",
            children: [
              Y.jsxs("label", {
                children: [
                  Y.jsx("span", { children: "Name" }),
                  Y.jsx("input", {
                    value: l.name,
                    onChange: (re) => A("name", re.target.value),
                    autoComplete: "name",
                    required: true,
                    "aria-invalid": !!L && !l.name.trim(),
                  }),
                ],
              }),
              Y.jsxs("label", {
                children: [
                  Y.jsx("span", { children: "Email" }),
                  Y.jsx("input", {
                    type: "email",
                    value: l.email,
                    onChange: (re) => A("email", re.target.value),
                    autoComplete: "email",
                    required: true,
                    "aria-describedby": "email-help",
                  }),
                  Y.jsx("small", { id: "email-help", className: "field-help", children: "Where we’ll send your newest matches." }),
                ],
              }),
            ],
          }),
          Y.jsxs("label", {
            className: `resume-field ${v ? "is-dragging" : ""} ${o ? "has-resume" : ""}`,
            onDragEnter: (re) => {
              re.preventDefault();
              x(true);
            },
            onDragOver: (re) => {
              re.preventDefault();
              re.dataTransfer.dropEffect = "copy";
              x(true);
            },
            onDragLeave: (re) => {
              if (!re.currentTarget.contains(re.relatedTarget)) x(false);
            },
            onDrop: Z,
            children: [
              Y.jsx("input", { type: "file", accept: ".pdf,.doc,.docx,.txt", onChange: Q }),
              Y.jsx(Ut.span, {
                className: "resume-icon",
                animate: s ? undefined : { scale: v ? 1.06 : 1 },
                transition: Tr,
                children: Y.jsx(VL, { size: 21 }),
              }),
              Y.jsxs("span", {
                className: "resume-copy",
                children: [
                  Y.jsx("strong", { children: v ? "Drop your resume here" : o || "Add your resume" }),
                  Y.jsx("small", {
                    children:
                      p === "reading"
                        ? "Reading your experience…"
                        : o
                          ? "Resume added · Replace it anytime"
                          : "PDF, DOCX, or TXT · We’ll use it to prefill the next steps",
                  }),
                ],
              }),
              Y.jsx("span", { className: "resume-action", children: v ? "Release to add" : o ? "Replace" : "Choose file" }),
            ],
          }),
          Y.jsx(Bc, {
            mode: "wait",
            children:
              p === "complete"
                ? Y.jsxs(Ut.div, {
                    className: "resume-result success",
                    role: "status",
                    initial: s ? false : { opacity: 0, y: 2 },
                    animate: { opacity: 1, y: 0 },
                    exit: { opacity: 0 },
                    transition: Tr,
                    children: [
                      Y.jsx(Jd, { size: 17, weight: "fill" }),
                      Y.jsxs("span", {
                        children: [
                          Y.jsx("strong", { children: "Resume details added" }),
                          Y.jsxs("small", {
                            children: [
                              __jsFilledCopy(g),
                              B.includes("pdf_reading_order_uncertain")
                                ? " This PDF did not mark its own line breaks, so double-check anything that looks out of order."
                                : "",
                            ],
                          }),
                        ],
                      }),
                    ],
                  })
                : p === "empty"
                  ? Y.jsxs(Ut.div, {
                      className: "resume-result empty",
                      role: "status",
                      initial: s ? false : { opacity: 0, y: 2 },
                      animate: { opacity: 1, y: 0 },
                      exit: { opacity: 0 },
                      transition: Tr,
                      children: [Y.jsx(m2, { size: 17 }), Y.jsx("span", { children: "Resume added. We’ll let you set the details yourself." })],
                    })
                  : p === "error"
                    ? Y.jsxs(Ut.div, {
                        className: "resume-result error",
                        role: "alert",
                        initial: s ? false : { opacity: 0, y: 2 },
                        animate: { opacity: 1, y: 0 },
                        exit: { opacity: 0 },
                        transition: Tr,
                        children: [Y.jsx(q5, { size: 17 }), Y.jsx("span", { children: "We couldn’t read that file. Try a PDF, DOCX, or plain-text version." })],
                      })
                    : null,
          }),
        ],
      });
    }
    if (T === 1) {
      return Y.jsxs(Y.Fragment, {
        children: [
          le(false),
          Y.jsxs("label", {
            children: [
              Y.jsx("span", { children: "Target roles" }),
              Y.jsx("input", {
                value: l.roles,
                onChange: (re) => A("roles", re.target.value),
                placeholder: "Senior Product Designer, Design Lead",
                required: true,
                "aria-describedby": "roles-help",
              }),
              Y.jsx("small", { id: "roles-help", className: "field-help", children: "Separate titles with commas. You can change these later." }),
            ],
          }),
          Y.jsxs("label", {
            children: [
              Y.jsx("span", { children: "What matters in a good match?" }),
              Y.jsx("input", {
                value: l.roleKeywords,
                onChange: (re) => A("roleKeywords", re.target.value),
                placeholder: "Design systems, healthcare, B2B SaaS",
                "aria-describedby": "keywords-help",
              }),
              Y.jsx("small", { id: "keywords-help", className: "field-help", children: "Optional skills, industries, or themes that should stand out." }),
            ],
          }),
          Y.jsx("div", {
            className: "wizard-tip",
            children: "Tip: two or three role titles usually gives your scout enough range without making the results noisy.",
          }),
        ],
      });
    }
    if (T === 2) {
      return Y.jsxs(Y.Fragment, {
        children: [
          le(false),
          Y.jsxs("fieldset", {
            className: "wizard-fieldset",
            children: [
              Y.jsx("legend", { children: "Preferred location" }),
              Y.jsxs("div", {
                className: "field-grid three-up",
                children: [
                  Y.jsxs("label", {
                    children: [
                      Y.jsx("span", { children: "Country" }),
                      Y.jsx("select", {
                        value: l.country,
                        required: true,
                        onChange: (re) => __jsPickLocation({ country: re.target.value, state: "", city: "" }),
                        children: [__jsPlaceholder("Select a country"), ...Object.keys(g1).map((re) => Y.jsx("option", { children: re }, re))],
                      }),
                    ],
                  }),
                  Y.jsxs("label", {
                    children: [
                      Y.jsx("span", { children: "State / region" }),
                      Y.jsx("select", {
                        value: l.state,
                        required: true,
                        disabled: !l.country,
                        onChange: (re) => __jsPickLocation({ state: re.target.value, city: "" }),
                        children: [__jsPlaceholder(l.country ? "Select a state or region" : "Choose a country first"), ...Object.keys(O).map((re) => Y.jsx("option", { children: re }, re))],
                      }),
                    ],
                  }),
                  Y.jsxs("label", {
                    children: [
                      Y.jsx("span", { children: "City" }),
                      Y.jsx("select", {
                        value: l.city,
                        required: true,
                        disabled: !l.state,
                        onChange: (re) => __jsPickLocation({ city: re.target.value }),
                        children: [__jsPlaceholder(l.state ? "Select a city" : "Choose a state or region first"), ...X.map((re) => Y.jsx("option", { children: re }, re))],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          Y.jsxs("div", {
            className: "range-field salary-range",
            children: [
              Y.jsxs("div", {
                className: "range-heading",
                children: [
                  Y.jsxs("div", {
                    children: [
                      Y.jsx("span", { className: "field-label", children: "Base salary" }),
                      Y.jsx("small", { className: "field-help", children: "The range that makes a role worth considering." }),
                    ],
                  }),
                  Y.jsxs("output", { "aria-live": "polite", children: [ip(l.salaryMin), " – ", ip(l.salaryMax), "+"] }),
                ],
              }),
              Y.jsxs("div", {
                className: "dual-range",
                style: { "--range-start": ((l.salaryMin - 60) / 240) * 100, "--range-size": (l.salaryMax - l.salaryMin) / 240 },
                children: [
                  Y.jsx("div", { className: "dual-range-track", "aria-hidden": "true", children: Y.jsx("span", {}) }),
                  Y.jsx("label", { className: "sr-only", htmlFor: "salary-min", children: "Minimum salary" }),
                  Y.jsx("input", {
                    id: "salary-min",
                    className: "dual-range-input dual-range-min",
                    type: "range",
                    min: "60",
                    max: "295",
                    step: "5",
                    value: l.salaryMin,
                    "aria-valuetext": ip(l.salaryMin),
                    onChange: (re) => A("salaryMin", Math.min(Number(re.target.value), l.salaryMax - 5)),
                  }),
                  Y.jsx("label", { className: "sr-only", htmlFor: "salary-max", children: "Maximum salary" }),
                  Y.jsx("input", {
                    id: "salary-max",
                    className: "dual-range-input dual-range-max",
                    type: "range",
                    min: "65",
                    max: "300",
                    step: "5",
                    value: l.salaryMax,
                    "aria-valuetext": `${ip(l.salaryMax)} or more`,
                    onChange: (re) => A("salaryMax", Math.max(Number(re.target.value), l.salaryMin + 5)),
                  }),
                ],
              }),
              Y.jsxs("div", { className: "range-scale", children: [Y.jsx("span", { children: "$60k" }), Y.jsx("span", { children: "$180k" }), Y.jsx("span", { children: "$300k+" })] }),
            ],
          }),
          Y.jsxs("div", {
            className: "field-grid two-up wizard-compact-grid",
            children: [
              Y.jsxs("label", {
                children: [
                  Y.jsx("span", { children: "Seniority" }),
                  Y.jsxs("select", {
                    value: l.seniority,
                    onChange: (re) => A("seniority", re.target.value),
                    children: ["Mid-level+", "Senior+", "Staff+", "Any level"].map((re) => Y.jsx("option", { children: re }, re)),
                  }),
                ],
              }),
              Y.jsxs("div", {
                className: "range-field posted-range",
                children: [
                  Y.jsxs("div", {
                    className: "range-heading",
                    children: [
                      Y.jsx("span", { className: "field-label", children: "Posted within" }),
                      Y.jsx("output", { "aria-live": "polite", children: l.postedWithin === 1 ? "24 hours" : `${l.postedWithin} days` }),
                    ],
                  }),
                  Y.jsx("input", { type: "range", min: "1", max: "30", step: "1", value: l.postedWithin, onChange: (re) => A("postedWithin", Number(re.target.value)) }),
                ],
              }),
            ],
          }),
          Y.jsxs("label", {
            className: "form-toggle",
            children: [
              Y.jsxs("span", { children: [Y.jsx("strong", { children: "Prioritize remote roles" }), Y.jsx("small", { children: "Remote jobs will appear before roles that need a move." })] }),
              Y.jsx(Ut.button, {
                type: "button",
                role: "switch",
                "aria-checked": l.remote,
                className: `switch ${l.remote ? "on" : ""}`,
                onClick: () => A("remote", !l.remote),
                whileTap: s ? undefined : { scale: 0.97 },
                transition: Tr,
                children: Y.jsx(Ut.span, { animate: { x: l.remote ? 16 : 0 }, transition: Tr }),
              }),
            ],
          }),
        ],
      });
    }
    if (T === 3) {
      return Y.jsxs(Y.Fragment, {
        children: [
          le(true),
          Y.jsxs("label", {
            children: [
              Y.jsx("span", { children: "Steer away from" }),
              Y.jsx("input", {
                value: l.steerAwayTerms,
                onChange: (re) => A("steerAwayTerms", re.target.value),
                placeholder: "Infrastructure, DevOps, Platform",
                "aria-describedby": "steer-help",
              }),
              Y.jsx("small", { id: "steer-help", className: "field-help", children: "Skills or themes your resume may suggest but you do not want in your next role." }),
            ],
          }),
          U.length
            ? Y.jsxs("div", {
                className: "resume-suggestions",
                children: [
                  Y.jsx("p", { children: "Suggested from your resume" }),
                  Y.jsx("div", {
                    className: "suggestion-chips",
                    children: U.map((re) =>
                      Y.jsxs(Ut.button, { type: "button", onClick: () => k(re), whileTap: s ? undefined : { scale: 0.97 }, transition: Tr, children: [re, Y.jsx("span", { "aria-hidden": "true", children: "+" })] }, re),
                    ),
                  }),
                ],
              })
            : null,
          Y.jsx(Bc, {
            initial: false,
            children: S.length
              ? Y.jsx(Ut.div, {
                  layout: true,
                  className: "selected-chips",
                  children: S.map((re) =>
                    Y.jsxs(Ut.button, { layout: true, type: "button", "aria-label": `Remove ${re}`, onClick: () => j(re), whileTap: s ? undefined : { scale: 0.97 }, transition: Tr, children: [re, Y.jsx("span", { "aria-hidden": "true", children: "×" })] }, re),
                  ),
                })
              : null,
          }),
          Y.jsxs("fieldset", {
            className: "wizard-fieldset strictness-field",
            children: [
              Y.jsx("legend", { children: "When there is a match" }),
              Y.jsx("div", {
                className: "strictness-options",
                children: [
                  { value: "rank", label: "Move it lower", help: "Still visible, after stronger matches." },
                  { value: "hide", label: "Hide it", help: "Keep it out of your job list." },
                ].map((re) =>
                  Y.jsxs(Ut.button, {
                    type: "button",
                    role: "radio",
                    "aria-checked": l.steerAwayMode === re.value,
                    className: l.steerAwayMode === re.value ? "selected" : "",
                    onClick: () => A("steerAwayMode", re.value),
                    whileTap: s ? undefined : { scale: 0.97 },
                    transition: Tr,
                    children: [
                      l.steerAwayMode === re.value ? Y.jsx(Jd, { size: 17, weight: "fill" }) : Y.jsx("span", { className: "radio-dot" }),
                      Y.jsxs("span", { children: [Y.jsx("strong", { children: re.label }), Y.jsx("small", { children: re.help })] }),
                    ],
                  }, re.value),
                ),
              }),
            ],
          }),
          Y.jsx("p", { className: "wizard-skip-note", children: "Nothing to add? Leave this blank and continue." }),
        ],
      });
    }
    return Y.jsxs(Y.Fragment, {
      children: [
        le(false),
        Y.jsx("fieldset", {
          className: "frequency-fieldset",
          children: [
            Y.jsx("legend", { className: "sr-only", children: "Email frequency" }),
            Y.jsx("div", {
              className: "frequency-options",
              children: [
                { value: "Daily", label: "Daily", help: "A steady shortlist each day" },
                { value: "Three times a day", label: "3× a day", help: "Best for an active search" },
                { value: "Weekly", label: "Weekly", help: "A quieter weekly roundup" },
              ].map((re) =>
                Y.jsxs(Ut.button, {
                  type: "button",
                  role: "radio",
                  "aria-checked": l.frequency === re.value,
                  className: l.frequency === re.value ? "selected" : "",
                  onClick: () => A("frequency", re.value),
                  whileTap: s ? undefined : { scale: 0.97 },
                  transition: Tr,
                  children: [
                    l.frequency === re.value ? Y.jsx(Jd, { size: 18, weight: "fill" }) : Y.jsx("span", { className: "radio-dot" }),
                    Y.jsxs("span", { children: [Y.jsx("strong", { children: re.label }), Y.jsx("small", { children: re.help })] }),
                  ],
                }, re.value),
              ),
            }),
          ],
        }),
        Y.jsxs("div", {
          className: "wizard-reassurance",
          children: [
            Y.jsx(Jd, { size: 18, weight: "fill" }),
            Y.jsxs("span", {
              children: [
                Y.jsx("strong", { children: H ? "One save updates everything" : "You’re ready to review" }),
                Y.jsx("small", { children: H ? "Your other preference categories stay unchanged until you save." : "We’ll show every preference together before you open your job list." }),
              ],
            }),
          ],
        }),
      ],
    });
  };

  return Y.jsxs("div", {
    className: "intake-shell wizard-shell",
    children: [
      Y.jsxs("header", { className: "flow-topbar", children: [Y.jsx(vx, {}), Y.jsx("span", { children: H ? "Edit preferences" : "Set up your job list" })] }),
      Y.jsxs("main", {
        className: `intake-main wizard-main ${H ? "editing-main" : ""}`,
        children: [
          Y.jsxs("section", {
            className: "wizard-intro",
            children: [
              Y.jsx("p", { className: "eyebrow", children: H ? "Your job scout" : "Personalize your scout" }),
              Y.jsx("h1", { children: H ? "Edit your preferences" : "A few small choices. Better job matches." }),
              Y.jsx("p", { children: H ? "Jump to any category, make your changes, then save once." : "About 3 minutes. Go back anytime—your answers stay in place." }),
            ],
          }),
          Y.jsxs(Ut.form, {
            className: `intake-form wizard-form ${H ? "editing-form" : ""}`,
            onSubmit: ae,
            noValidate: true,
            initial: s ? false : { opacity: 0, y: 4 },
            animate: { opacity: 1, y: 0, scale: 1 },
            transition: Mu,
            children: [
              H
                ? Y.jsx("div", {
                    className: "preference-tabs-shell",
                    children: Y.jsx("nav", {
                      "aria-label": "Preference categories",
                      children: Y.jsx("div", {
                        role: "tablist",
                        "aria-label": "Edit preference category",
                        children: C.map((re) =>
                          Y.jsxs(Ut.button, {
                            id: `preference-tab-${re}`,
                            type: "button",
                            role: "tab",
                            "aria-selected": T === re,
                            "aria-controls": "preference-tabpanel",
                            onClick: () => te(re),
                            onKeyDown: (oe) => fe(oe, re),
                            whileTap: s ? undefined : { scale: 0.97 },
                            transition: Tr,
                            children: [
                              T === re ? Y.jsx(Ut.span, { layoutId: "preference-tab-active", className: "preference-tab-active", transition: Tr }) : null,
                              Y.jsx("span", { children: N[re].label }),
                            ],
                          }, N[re].label),
                        ),
                      }),
                    }),
                  })
                : Y.jsxs("div", {
                    className: "wizard-progress",
                    children: [
                      Y.jsxs("div", {
                        className: "wizard-progress-meta",
                        children: [Y.jsx("span", { children: N[T].label }), Y.jsxs("span", { children: [T + 1, " of ", N.length] })],
                      }),
                      Y.jsx("div", {
                        className: "wizard-progress-track",
                        "aria-hidden": "true",
                        children: Y.jsx(Ut.span, {
                          animate: { scaleX: (T + 1) / N.length },
                          transition: s ? { duration: 0 } : Mu,
                        }),
                      }),
                      Y.jsx("nav", {
                        "aria-label": "Setup progress",
                        children: Y.jsx("ol", {
                          children: N.map((re, oe) =>
                            Y.jsx("li", {
                              children: Y.jsxs(Ut.button, {
                                type: "button",
                                onClick: () => oe <= T && te(oe),
                                disabled: oe > T,
                                "aria-current": oe === T ? "step" : undefined,
                                "aria-label": `${re.label}, step ${oe + 1} of ${N.length}`,
                                whileTap: s || oe > T ? undefined : { scale: 0.97 },
                                transition: Tr,
                                children: [
                                  oe === T ? Y.jsx(Ut.span, { layoutId: "intake-step-active", className: "wizard-step-active", transition: Mu }) : null,
                                  Y.jsx("b", { children: oe < T ? "✓" : oe + 1 }),
                                  Y.jsx("span", { children: re.label }),
                                ],
                              }),
                            }, re.label),
                          ),
                        }),
                      }),
                    ],
                  }),
              Y.jsx(Bc, {
                mode: "wait",
                initial: false,
                children: Y.jsx(Ut.section, {
                  className: "form-section wizard-panel",
                  id: H ? "preference-tabpanel" : undefined,
                  role: H ? "tabpanel" : undefined,
                  "aria-labelledby": H ? `preference-tab-${T}` : undefined,
                  initial: H || s ? false : { opacity: 0 },
                  animate: { opacity: 1, x: 0 },
                  exit: H || s ? undefined : { opacity: 0 },
                  transition: Tr,
                  children: ie(),
                }, T),
              }),
              Y.jsx(Bc, {
                mode: "wait",
                children: L
                  ? Y.jsx(Ut.p, { id: "step-error", className: "form-error wizard-error", role: "alert", initial: s ? false : { opacity: 0, y: 2 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: Tr, children: L }, L)
                  : D
                    ? Y.jsx(Ut.p, { className: "form-error wizard-error", role: "alert", initial: s ? false : { opacity: 0, y: 2 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 }, transition: Tr, children: D }, D)
                    : null,
              }),
              Y.jsxs("div", {
                className: "wizard-actions",
                children: [
                  H
                    ? Y.jsx(Ut.button, { type: "button", className: "secondary-flow-button", onClick: M, whileTap: s ? undefined : { scale: 0.97 }, transition: Tr, children: "Cancel" })
                    : T > 0
                    ? Y.jsxs(Ut.button, { type: "button", className: "secondary-flow-button", onClick: () => te(T - 1), whileTap: s ? undefined : { scale: 0.97 }, transition: Tr, children: [Y.jsx(RL, { size: 16 }), " Back"] })
                    : Y.jsx("span", { className: "wizard-action-note", children: "Required fields are marked by context and checked as you continue." }),
                  Y.jsx(Ut.button, {
                    type: "submit",
                    className: "primary-flow-button wizard-next",
                    disabled: p === "submitting",
                    whileHover: s ? undefined : { y: -2 },
                    whileTap: s ? undefined : { scale: 0.97 },
                    transition: Tr,
                    children:
                      p === "submitting"
                        ? "Saving…"
                        : H
                          ? Y.jsxs(Y.Fragment, { children: ["Save changes ", Y.jsx(Jd, { size: 17, weight: "fill" })] })
                        : T === N.length - 1
                          ? Y.jsxs(Y.Fragment, { children: ["Save and review ", __jsForward()] })
                          : Y.jsxs(Y.Fragment, { children: [T === 3 && !l.steerAwayTerms.trim() ? "Skip for now" : "Continue", " ", __jsForward()] }),
                  }),
                ],
              }),
              Y.jsx("p", { className: "wizard-privacy", children: H ? "Changes apply to future matches and email shortlists." : "Your resume and preferences are used only for your private Job Scout." }),
            ],
          }),
        ],
      }),
    ],
  });
}
