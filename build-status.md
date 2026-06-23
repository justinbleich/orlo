# build-status.md

> Status snapshot checked against `_plan/PRD.md`, `_plan/BUILD.md`,
> `_plan/RENDER-CODEGEN-MODEL.md`, `_plan/phase2.md`, and `_plan/phase3.md`.
> Updated 2026-06-22.

## Current position

BUILD Phases 0-5 are complete. The MCP agent loop passes against the live Studio, so Phase 6
(external RN import + polish) is next. Post-v1 component systems, interactions,
device tooling, themes, and icons remain parked in `phase2.md` / `phase3.md`.

| Phase | Status | Evidence |
|---|---|---|
| 0 - de-risk spike | complete, parked | rnw + Yoga premise and simulator/diff spike established; active diff commands removed |
| 1 - document + shell | complete | canonical validated tree/store, RNFrame-only tldraw, inspector |
| 2 - live render | complete | seven primitives, Yoga, LOD, Inter font parity and pinned metrics |
| 3 - codegen | complete | explicit RN + sidecar serialization, reopen/sync workflow |
| 4 - canvas/code hardening | complete | primitive rail, Screens/Layers, direct document workflows |
| 4.5 - conformance | complete | closed validation, property/typecheck evidence, render instrumentation, direct manipulation |
| 5 - MCP | complete | live stdio tools, validated browser bridge, code/screenshot inspection, passing e2e |
| 6 - external RN import + polish | not started | next BUILD phase |

## Phase 4.5 evidence

- The document tree remains canonical. Foreground rendering is document-direct through rnw
  and Yoga; codegen runs only on explicit Generate/Sync.
- Validation fails closed across all seven primitive prop contracts, design metadata, tree
  structure, and the supported RNStyle/Yoga dimensions.
- Codegen's deterministic corpus covers every primitive and style key. One hundred bounded
  arbitrary valid trees parse, typecheck as React Native, round-trip through sidecars, and
  keep design metadata out of generated source.
- Layout snapshots are indexed by node ID and render work is instrumented. Unchanged node
  layers with unchanged geometry are memoized.
- Canvas hit-testing uses Yoga geometry. Resize and move/reorder writes go through validated
  document-store actions; each gesture is one undo transaction. Locked and hidden nodes are
  excluded from interaction.
- Studio and native harness load the same pinned Inter package. The styles package owns the
  extracted OpenType ascent/descent/line-gap table used by the Yoga TextMeasurer.
- Browser verification covered selection, resize, one-step gesture undo, flex reorder, and
  exact Studio font loading. Package tests and the full production build pass.

## Phase 5 evidence

- `packages/mcp-server` uses the pinned stable v1 TypeScript SDK over stdio and exposes all
  seven BUILD tools.
- The server is intentionally stateless. A leased request/response bridge routes commands to
  one live Studio tab, where reads and mutations execute against the canonical Zustand store.
- Agent mutations pass through the existing document/style validators. Multi-field updates are
  one undo transaction and roll back completely on validation failure.
- `get_code` fetches the live root and invokes the existing codegen serializer; it returns both
  RN source and the canonical sidecar. It does not enter the render path.
- `get_canvas_screenshot` captures the focused live RNFrame DOM, labels the source `canvas`, and
  does not invoke native preview or the parked pixel-diff path.
- Protocol tests cover tool registration/forwarding/code/screenshot. The opt-in live test creates
  and edits a frame, reads it, reloads the generated sidecar, captures it, and cleans it up.

## Deliberately parked

- `packages/sim-bridge` and the render-web image-diff utility remain as Phase 0 evidence, but
  root/Studio capture and diff entry points are removed. Optional native preview remains a
  separate user-owned fidelity check, not a codegen validator or Phase 5 gate.
- The optional Phase 4 `Open Preview` adapter is not implemented. It does not block authoring,
  code sync, or MCP and should be reconsidered only after a focused `serve-sim` spike.
- Git-integrated export, components/tokens/variants, behaviors/data, device presets, themes,
  and icon systems remain out of v1.

## Known residuals

- Native font rasterization can still differ from browser canvas measurement even with the
  same font and vertical metrics. Optional device preview verifies that residual; codegen
  correctness does not.
- The Studio production bundle reports a large-chunk warning from its current dependency set.
  This is not on the render hot path and should be measured before adding code splitting.
- The tldraw custom-shape type bridge and duplicated react-native-web shims remain contained
  implementation debt; neither changes the document or render architecture.

## Recommendation

Proceed to Phase 6's external-RN import in a separate branch/checkpoint. Start with the exact
AST subset emitted by codegen, prove import-to-document equivalence, then widen deliberately.
Keep post-v1 UI and document vocabulary parked during that parser work.
