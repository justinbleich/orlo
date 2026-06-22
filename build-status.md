# build-status.md

> Status snapshot + recommendation, checked against `_plan/PRD.md`, `_plan/BUILD.md`,
> `_plan/phase2.md`, `_plan/phase3.md`. Companion to `context.md` (which holds the
> living engineering contract). Updated 2026-06-21.

## TL;DR

BUILD Phases 0–4 are implemented. The automated simulator branch proved the operational
cost but ran ahead of the product: native tooling is local to each user and should not
gate RN Canvas. V1 is now centered on the canvas ↔ document ↔ code loop.

**Recommendation:** keep simulator automation and pixel diff parked, manually exercise
the completed Phase 4 shell once local browser automation is re-enabled, then begin the
Phase 5 MCP agent loop. Spike `serve-sim` later as an optional local iOS preview adapter.

---

## Phase status (BUILD.md)

| Phase | Scope | Status |
|---|---|---|
| 0 — de-risk spike | rnw+Yoga render, pan/zoom, sim screenshot, fidelity diff | ✅ done |
| 1 — document model + canvas shell | `packages/document` + `packages/styles`, tldraw `RNFrame`, inspector, **tree editing** | ✅ complete |
| 2 — live render + layout fidelity | all 7 primitives, Yoga across tree, **text/font**, culling + **LOD** | 🟢 verifiable scope done; only font-parity deferred (sim-gated) |
| 3 — codegen (emit) + sidecar | document → idiomatic RN + `*.rncanvas.json` | ✅ complete: emit + sidecar + repo-aware Sync Code, validated sidecar reopen, and multi-root generation as independently registerable native screen modules. Git actions remain explicit/deferred. |
| 4 — canvas/code workflow hardening | primitive rail, Screens/Layers, sidecar workflow, optional preview | 🟢 implemented: all seven primitives insert through the document store; Screens/Layers are document-derived; codegen sidecar identity and metadata isolation pass. Final manual interaction pass remains. |
| 5 — MCP / agent loop | `packages/mcp-server` tools | ⬜ not started |
| 6 — round-trip + polish | parse external RN → document | ⬜ not started |

### Phase 2 detail
- ✅ All 7 primitives render via react-native-web; `design.hidden` honored.
- ✅ **Text measurement wired** — `render-web` `computeLayout` sets Yoga measure funcs
  via `styles` `createCanvasTextMeasurer` (wrap + `numberOfLines`); styles tests cover it.
- ✅ Viewport culling — provided by tldraw.
- ✅ **LOD proxy** — `RNFrameShapeUtil` renders a cheap proxy (no Yoga/rnw) when a frame
  is unselected and small on-screen (`w * zoom < 160px`); full render otherwise. Verified:
  zoom out → proxy, zoom in / select → live (PRD §7.2/§8).
- **Known font gap** (PRD §9 #1 risk) — canvas measures/renders with ambient `system-ui`;
  device uses SF/Roboto. True parity = standardize on one bundled font (Inter is already
  `--font-sans`) in studio + harness + `FontMetricsTable` (PRD §8). **Only validatable
  against a native runtime. It is documented and does not gate v1 authoring/export.

---

## Studio UI: built vs. what the docs require

| Work | Backed by | Verdict |
|---|---|---|
| tldraw lockdown (frame host only) | BUILD invariants | Core — keep |
| Tree editing + selection-single-source + undo | PRD §7.1, BUILD Ph1 "Done when" | Core — keep |
| Design tokens | BUILD ("Tailwind for chrome only") | Cheap — fine |
| Fixed ground-truth pane | Superseded UI plan | Remove from v1; optional preview is on demand |

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
2. Remove the fixed ground-truth pane and simulator actions from v1 chrome.
3. ✅ The rail creates all seven primitives through one validated document-store action.
4. ✅ Screens/Layers are real views derived from document roots and the single selection.
5. ✅ Sidecar serialization/reopen identity and sidecar-only design metadata are covered by
   passing codegen tests; perform one final manual Studio interaction pass before Phase 5.

Rationale: if we can't export RN, the prettiest shell is worthless; if we can, the thesis
is proven. Effort should follow the substrate, not the chrome.

---

## Shell — deferred platform accommodations

The freeze is "don't grow it speculatively," **not** "it's final." The shell must
later expand to meet platform realities, each tied to a phase:

- **Optional local preview** — feature-detected `serve-sim`/external preview entry point;
  it never occupies permanent canvas space or blocks authoring. → post-core Phase 4 spike.
- **Automated boot/install, Android parity, and pixel diff** → post-v1.
- **Device presets + orientation** (iPhone/Pixel/tablet, portrait/landscape) — frame
  sizing UI in chrome. → phase3 §3D (post-v1).
- **Safe-area overlay** on canvas; insets per device. → phase3 §3D (post-v1).
- **Light/dark theming toggle** for artboard content. → phase3 §3E (post-v1).

Capture rule: add each of these when its phase lands, against the existing tokens —
not before.

## Open gates / known issues

- **Manual Phase 4 UI pass remains** — the primitive rail was verified in the running Studio,
  but browser automation was subsequently disabled for the local URL before Screens/Layers
  could be clicked through. The production build and all package tests pass.
- **Native preview is unavailable here** until macOS/Xcode is updated. This no longer blocks v1.
- **tldraw dev warning** — benign dev-only React "useMemo deps changed size" from
  `TldrawUiComponentsProvider` when `components`/`overrides` are supplied. No prod impact.
- **rnw type shim duplicated** across `render-web` + `studio/globals.d.ts` (kept in sync).
- **`@ts-expect-error`** on `RNFrameShapeUtil` — tldraw closed `TLShape` union vs custom shape.

---

## Branch

Current branch: `codex/v1-canvas-code-focus`, based on the completed Phase 3 checkpoint
`f7905f9`. The full simulator experiment remains preserved on
`codex/phase4-simulator-ground-truth` and is intentionally not merged.

Uncommitted Phase 4 work is intentionally split into two logical checkpoints:
`Wire primitive tools to document store`, then `Build document-derived Screens and Layers`.
The first commit attempt was blocked by the local approval service usage limit; no git
workaround was attempted.
