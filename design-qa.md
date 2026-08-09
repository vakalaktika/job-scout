# Design QA

- Source visual truth: `.context/attachments/o3vI7Y/image.png`
- Implementation URL: `http://127.0.0.1:4173/?preview=edit`
- Implementation screenshot: unavailable
- Source pixels: 1958 × 342
- Intended focused comparison viewport: 1958 × 342, device scale factor 1
- Responsive viewport requiring follow-up: 390 × 844, device scale factor 1
- State: dashboard preference editing, Location & pay tab selected

## Full-view comparison evidence

Blocked. The source mock was opened and inspected at its original dimensions. The local implementation was built and its JavaScript parsed successfully, but Conductor exposed no connected in-app browser, so no browser-rendered screenshot could be captured for a same-viewport comparison.

## Focused region comparison evidence

Blocked for the same reason. The intended focused regions are the work-arrangement checkbox cards and their 390 px mobile stack. Static source review confirms that these regions reuse the mock's typography, warm neutral surfaces, green selected states, border radii, and spacing tokens, but static code is not visual evidence.

## Findings

- [P1] Browser-rendered visual comparison is unavailable.
  - Location: Location & pay intake panel.
  - Evidence: source image is available; implementation screenshot is not.
  - Impact: layout, wrapping, and responsive density cannot be signed off visually.
  - Fix: open the local preview in a connected in-app browser and capture the desktop and mobile states.

- [P2] Interaction behavior is verified by code and automated tests, not by a browser session.
  - Location: work-arrangement checkbox group.
  - Evidence: automated tests cover de-duplication, the five-city cap, serialization, native keyboard activation semantics, reduced-motion contract, and saved-value compatibility.
  - Impact: focus order and live visual feedback still need one real-browser pass.
  - Fix: add Austin, remove Oakland, toggle Hybrid and Remote only with the keyboard, and confirm focus and announcements remain usable.

## Required fidelity surfaces

- Fonts and typography: source uses the existing Gelasio/Work Sans pairing; implementation reuses those shipped tokens. Browser comparison blocked.
- Spacing and layout rhythm: implementation follows the existing field grid, 9–10 px controls, and responsive one-column breakpoint. Browser comparison blocked.
- Colors and visual tokens: implementation reuses `--canvas`, `--surface`, `--line`, `--green-pale`, and `--green-deep`. Browser comparison blocked.
- Image quality and assets: no new image assets are required for these form controls.
- Copy and content: the On-site, Hybrid, and Remote only choices now explain that every acceptable setup may be selected and the first suitable arrangement can surface.

## Primary interactions tested

- Pure preference behavior: add, de-duplicate, cap at five, remove, serialize, parse, and legacy single-city migration.
- Work arrangement: independent multi-select toggles, at-least-one enforcement, legacy single-value fallback, backend allowlist, and compatibility Remote OK flag.
- Accessibility contract: checkbox group semantics, native button keyboard activation, 24 px+ targets, visible focus treatment, and reduced-motion handling.
- Browser console errors checked: blocked because no browser session was available.

## Comparison history

- Initial pass: blocked before implementation capture because the in-app browser was unavailable.
- Implementation fixes made from static review: replaced the single radio value with independently toggleable checkbox states, added at-least-one enforcement, multi-value persistence and hydration, legacy migration, and multi-value review summary support.
- Post-fix visual evidence: unavailable.

## Implementation checklist

- Capture desktop at 1680 × 1260 with Location & pay selected.
- Capture mobile at 390 × 844.
- Exercise selecting multiple arrangements and attempting to clear the final checkbox with keyboard controls.
- Check console output and compare both captures against the source in one visual input.

final result: blocked
