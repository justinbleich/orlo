# build-status.md

> Status snapshot checked against `_plan/PRD.md`, `_plan/BUILD.md`,
> `_plan/RENDER-CODEGEN-MODEL.md`, `_plan/phase2.md`, and `_plan/phase3.md`.
> Updated 2026-06-23.

## Current position

BUILD Phases 0-6 and the interactive v1 release checkpoint are complete. External emitted-subset RN source imports into the live Studio
without a sidecar, and canvas/document undo controls are coordinated. Phase 2A core creation and direct-manipulation work is active;
Phase 2C/2D component systems and the `phase3.md` interaction, device, data, and theming roadmap remain parked.

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

## Post-v1 Phase 2A status

- Phase 2A direct-manipulation work is active: draw-to-create, inline Text editing, multi-select,
  grouping, layer drag/reparent, frame resize, and the rebuilt Inspector are present.
- The first interaction audit restored root-frame inspection, normalized nested selections so
  actions never operate on an ancestor and descendant together, and added modifier/range selection
  to Layers. Duplicate/delete/group now share the same hierarchy-safe boundary.
- Inspector typing and numeric scrubbing use document interactions, so one focused edit or scrub is
  one undo entry. Live regression verified `48 → 400 → Undo → 48`.
- Tailwind preflight is disabled. A scoped chrome reset preserves the Studio controls without
  applying image/layout rules to react-native-web artboards; rendered images now have no CSS
  `max-width` constraint outside RNStyle/Yoga.
- The shell has a tokenized 960px minimum workspace and scrolls at narrower host widths. New compact
  chrome values are tokenized. Six Studio tests cover selection and subtree action regressions.
- The freeform-versus-Yoga-flow creation model remains deliberately unresolved pending product
  discussion; no document or codegen semantics changed in this pass.
- The interaction-parity follow-up exposes all frame resize edges, makes arrow-key and panel
  reordering follow the selected child's visual flex axis, combines Screens and Layers into one
  collapsible navigator, and reveals the active Yoga flow while a relative child is dragged.

## V1 release checkpoint

- The live Studio built and organized two RNFrame documents, inserted and reordered an RN Text
  node through document actions, and serialized both frames to idiomatic RN plus adjacent sidecars.
- Both generated modules parsed through the external-source boundary and both sidecars validated.
  Reopening the edited sidecar restored its tree and visible content without drift.
- Opening/importing a document now clears tldraw history alongside document history, preventing
  frame operations from a previous document session leaking into the newly opened document.
- The opt-in MCP live acceptance test was not rerun at this checkpoint because local execution
  approval was unavailable. Its Phase 5 pass remains the latest agent-loop evidence.

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

V1 is at release-candidate quality against the BUILD definition of done. Hold the external parser
at the proven emitted subset unless a specific real-world fixture justifies widening it. The next
decision is product sequencing among the post-v1 roadmap slices; Yjs remains optional and parked.
