// Readable post-onboarding review screen injected into the production bundle by
// patch-intake-flow.mjs. The API derives the candidate from the signed session;
// no candidate identifier or profile data is sent by this client action.
function AP({
  profile: l,
  onBack: e,
  onContinue: t,
  onQueued: r,
  memberState: i,
  sessionToken: a,
  shouldReduceMotion: n,
}) {
  const [s, o] = W.useState("idle");
  const [c, h] = W.useState("");
  const d = i?.first_scout?.status === "available";

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

  const p = async () => {
    if (s === "submitting") return;
    o("submitting");
    h("");
    try {
      const m = await fetch(l6, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_scout_once", session_token: a }),
      });
      const g = await m.json();
      if (!m.ok || !g.ok) throw new Error(g.error || "first_scout_failed");
      o("queued");
      r(g);
    } catch (m) {
      console.error(m);
      o("idle");
      h("We couldn’t start the search just yet. Your regular scout schedule is still active, so you can try again or wait for the next run.");
    }
  };

  return Y.jsxs("div", {
    className: "ready-shell",
    children: [
      Y.jsxs("header", {
        className: "flow-topbar",
        children: [Y.jsx(vx, {}), Y.jsx("span", { children: "Review your setup" })],
      }),
      Y.jsx("main", {
        className: "ready-main",
        children: Y.jsxs(Ut.section, {
          className: "ready-card",
          initial: n ? false : { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0, scale: 1 },
          transition: Mu,
          children: [
            Y.jsx("div", { className: "ready-check", children: Y.jsx(NL, { size: 26, weight: "bold" }) }),
            Y.jsx("p", { className: "eyebrow", children: "One last check" }),
            Y.jsxs("h1", { children: ["Ready for your first scout, ", l.name.split(" ")[0], "?"] }),
            Y.jsx("p", { children: "Review what your scout will use, then start a one-time search without waiting for the regular schedule." }),
            Y.jsxs("div", {
              className: "setup-summary",
              children: [
                Y.jsxs("div", { children: [Y.jsx("span", { children: "Roles" }), Y.jsx("strong", { children: l.roles })] }),
                Y.jsxs("div", { children: [Y.jsx("span", { children: "Keywords" }), Y.jsx("strong", { children: l.roleKeywords })] }),
                Y.jsxs("div", {
                  className: "steer-summary",
                  children: [
                    Y.jsx("span", { children: "Steering away from" }),
                    Y.jsxs("strong", { children: [l.steerAwayTerms || "None selected", " · ", l.steerAwayMode === "hide" ? "hidden" : "ranked lower"] }),
                  ],
                }),
                Y.jsxs("div", {
                  children: [
                    Y.jsx("span", { children: "Where" }),
                    Y.jsxs("strong", { children: [l.city, ", ", l.state, ", ", l.country, " · ", l.remote ? "Remote first" : "On-site is okay"] }),
                  ],
                }),
                Y.jsxs("div", {
                  children: [
                    Y.jsx("span", { children: "Pay and level" }),
                    Y.jsxs("strong", { children: [ip(l.salaryMin), "–", ip(l.salaryMax), "+ · ", l.seniority] }),
                  ],
                }),
                Y.jsxs("div", {
                  children: [
                    Y.jsx("span", { children: "Posting age" }),
                    Y.jsx("strong", { children: l.postedWithin === 1 ? "Within 24 hours" : `Within ${l.postedWithin} days` }),
                  ],
                }),
                Y.jsxs("div", { children: [Y.jsx("span", { children: "Email rhythm" }), Y.jsx("strong", { children: l.frequency })] }),
              ],
            }),
            Y.jsxs("div", {
              className: "ready-next",
              children: [
                Y.jsx(Jd, { size: 21, weight: "fill" }),
                Y.jsxs("div", {
                  children: [
                    Y.jsx("strong", { children: d ? "One-time first search" : "Your preferences are saved" }),
                    Y.jsx("span", { children: d ? "Start it now. Results usually arrive in a few minutes, even when there are no strong matches yet." : "Your scout will run on the regular schedule." }),
                  ],
                }),
              ],
            }),
            Y.jsx(Bc, {
              mode: "wait",
              initial: false,
              children: c
                ? Y.jsx(Ut.p, {
                    className: "form-error wizard-error",
                    role: "alert",
                    initial: n ? false : { opacity: 0, y: 2 },
                    animate: { opacity: 1, y: 0 },
                    exit: { opacity: 0 },
                    transition: Tr,
                    children: c,
                  })
                : null,
            }),
            Y.jsxs("div", {
              className: "ready-actions",
              children: [
                Y.jsxs(Ut.button, {
                  type: "button",
                  className: "secondary-flow-button",
                  onClick: e,
                  whileTap: n ? undefined : { scale: 0.97 },
                  transition: Tr,
                  children: [Y.jsx(RL, { size: 16 }), " Edit details"],
                }),
                d
                  ? Y.jsxs(Ut.button, {
                      type: "button",
                      className: "primary-flow-button first-scout-cta",
                      onClick: p,
                      disabled: s === "submitting" || s === "queued",
                      whileHover: n ? undefined : { y: -2 },
                      whileTap: n ? undefined : { scale: 0.97 },
                      transition: Tr,
                      children: [s === "submitting" ? "Starting your scout…" : "Find my first matches"],
                    })
                  : Y.jsxs(Ut.button, {
                      type: "button",
                      className: "primary-flow-button",
                      onClick: t,
                      whileHover: n ? undefined : { y: -2 },
                      whileTap: n ? undefined : { scale: 0.97 },
                      transition: Tr,
                      children: ["Open your job list ", __jsForward()],
                    }),
              ],
            }),
            d
              ? Y.jsx("button", {
                  type: "button",
                  className: "ready-skip",
                  onClick: t,
                  children: "I’ll wait for the scheduled run",
                })
              : null,
          ],
        }),
      }),
    ],
  });
}
