# build-status.md

> Status snapshot checked against `_plan/PRD.md`, `_plan/BUILD.md`,
> `_plan/RENDER-CODEGEN-MODEL.md`, `_plan/phase2.md`, and `_plan/phase3.md`.
> Updated 2026-06-22.

## Current position

BUILD Phases 0-6 are complete. External emitted-subset RN source imports into the live Studio
without a sidecar, and canvas/document undo controls are coordinated. Post-v1 component systems, interactions,
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
| 6 - external RN import + polish | complete | static AST importer, Studio import workflow, coordinated canvas/document undo |

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

## Phase 6 evidence

- `packages/codegen` parses the exact static RN subset emitted by codegen without executing source.
  It reconstructs `StyleSheet.create` references, all seven primitives, typed props, image sources,
  FlatList templates, and the supported RNStyle subset, then validates the resulting document tree.
- Emit → external parse → emit is exact over a fixture spanning the full primitive vocabulary.
  Dynamic expressions, unknown props, unsupported styles, and non-workspace import paths fail closed.
- Studio keeps sidecar opening as the normal document load path and exposes external source import as
  a separate explicit action. Babel remains Node-side and never enters the browser or render hot path.
- Undo/redo controls observe both document history and tldraw's frame-spatial history. Canvas fallback
  skips selection-only tldraw checkpoints so one visible action restores one visible frame operation.
- Browser verification covered valid source import, workspace confinement, and exact frame geometry
  across move → undo → redo. Codegen tests and production package builds pass.

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

V1's BUILD sequence is complete. Hold the external parser at the proven emitted subset unless a
specific real-world import fixture justifies widening it. Next, run the v1 definition-of-done flow
as a release checkpoint; only then choose a post-v1 roadmap slice. Yjs remains optional and parked.
