# build-status.md

> Status snapshot + recommendation, checked against `_plan/PRD.md`, `_plan/BUILD.md`,
> `_plan/phase2.md`, `_plan/phase3.md`. Companion to `context.md` (which holds the
> living engineering contract). Updated 2026-06-20.

## TL;DR

The valuable UI (canvas + `RNFrame`, inspector, tree editing) is what PRD/BUILD v1
actually call for. The **region shell** (rail, left-panel tabs, ground-truth pane,
top-bar placeholders) is sourced from `STUDIO-UI.md`'s full multi-phase vision, not
from PRD/BUILD v1 — that's the complexity running ahead of the substrate.

**Recommendation:** freeze the chrome, document the font-parity gap (don't build it
blind — it's simulator-gated), do a small **LOD** commit to finish Phase 2's verifiable
remainder, then put real effort into **BUILD Phase 3 — codegen** (the product thesis;
fully verifiable with no UI and no simulator).

---

## Phase status (BUILD.md)

| Phase | Scope | Status |
|---|---|---|
| 0 — de-risk spike | rnw+Yoga render, pan/zoom, sim screenshot, fidelity diff | ✅ done |
| 1 — document model + canvas shell | `packages/document` + `packages/styles`, tldraw `RNFrame`, inspector, **tree editing** | ✅ complete |
| 2 — live render + layout fidelity | all 7 primitives, Yoga across tree, **text/font**, culling + **LOD** | 🟡 partial (see below) |
| 3 — codegen (emit) + sidecar | document → idiomatic RN + `*.rncanvas.json` | ⬜ not started |
| 4 — simulator ground truth | harness over channel, iOS+Android sim-bridge, per-platform diff | 🟡 iOS bridge + diff exist; harness runtime unverified; Android not done |
| 5 — MCP / agent loop | `packages/mcp-server` tools | ⬜ not started |
| 6 — round-trip + polish | parse external RN → document | ⬜ not started |

### Phase 2 detail
- ✅ All 7 primitives render via react-native-web; `design.hidden` honored.
- ✅ **Text measurement wired** — `render-web` `computeLayout` sets Yoga measure funcs
  via `styles` `createCanvasTextMeasurer` (wrap + `numberOfLines`); styles tests cover it.
- ✅ Viewport culling — provided by tldraw.
- ⬜ **LOD proxy** for off-focus/zoomed-out frames (PRD §7.2/§8). Verifiable here.
- 🔒 **Font parity** (PRD §9 #1 risk) — canvas measures/renders with ambient `system-ui`;
  device uses SF/Roboto. True parity = standardize on one bundled font (Inter is already
  `--font-sans`) in studio + harness + `FontMetricsTable` (PRD §8). **Only validatable
  against a simulator**, which can't be booted in this environment → deferred, documented.

---

## Studio UI: built vs. what the docs require

| Work | Backed by | Verdict |
|---|---|---|
| tldraw lockdown (frame host only) | BUILD invariants | Core — keep |
| Tree editing + selection-single-source + undo | PRD §7.1, BUILD Ph1 "Done when" | Core — keep |
| Design tokens | BUILD ("Tailwind for chrome only") | Cheap — fine |
| Region shell (rail, left panel, ground-truth pane, top-bar placeholders) | **STUDIO-UI.md only** (spans phase2/3/4) | **Ahead of need — freeze** |

Notes:
- After the commit-2 trim the shell is **scope-honest** (no post-v1 features advertised:
  Library/Interact/extra rail tools removed). What remains are placeholders for *later
  BUILD-phase v1* features (Export → Ph3, ground-truth → Ph4, Agent → Ph5).
- The cost isn't the placeholders; it's pre-building chrome before the feature behind it
  exists. `STUDIO-UI.md` itself says the cohesion/polish pass is the Phase 3→4 boundary.

---

## Recommendation (priority order)

1. **Freeze the chrome.** No new regions/placeholders/polish until the feature behind a
   region lands. The shell is a frame to drop panels into, not ongoing work.
2. **Font parity: document, don't build.** Measurement is done; parity is simulator-gated.
   Building font-into-Expo infra blind = unverifiable effort. Record the divergence.
3. **LOD commit** to close Phase 2's verifiable remainder (small; tldraw gives culling).
4. **Pivot to BUILD Phase 3 — codegen.** The design===code thesis, the biggest unbuilt v1
   value, fully verifiable via snapshot/compile tests, needs no UI and no simulator.

Rationale: if we can't export RN, the prettiest shell is worthless; if we can, the thesis
is proven. Effort should follow the substrate, not the chrome.

---

## Open gates / known issues

- **Simulator not bootable here** — harness typechecks + `metro.config.js` package-exports
  set, but never run; blocks font-parity validation and Phase 4 sign-off.
- **tldraw dev warning** — benign dev-only React "useMemo deps changed size" from
  `TldrawUiComponentsProvider` when `components`/`overrides` are supplied. No prod impact.
- **rnw type shim duplicated** across `render-web` + `studio/globals.d.ts` (kept in sync).
- **`@ts-expect-error`** on `RNFrameShapeUtil` — tldraw closed `TLShape` union vs custom shape.

---

## Branch

`phase1-document-styles` now carries Phase 1 + the Phase 2 studio-UI foundation + tree
editing + the v1 trim (never pushed). Recommend landing it (PR) before more accretes, so
Phase 3 starts from a reviewed base.
