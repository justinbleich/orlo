# BUILD.md — RN Canvas

> Executable build plan for Cursor. Pair this with `PRD.md` (requirements + rationale).
> When in doubt about *why*, read the PRD. This file is *how* and *in what order*.

> **Scope:** this plan covers **v1**, which is primitive-centric (`PRD.md` §3, §12).
> `phase2.md` (components, tokens, variants) and `phase3.md` (interaction, data, device, theming,
> icons) are **post-v1 roadmap** and are not built here — start them only after v1's success
> criteria (`PRD.md` §10) are met.

## How to use this file (agent instructions)

- Work **phase by phase, top to bottom.** Do not start a phase until the previous phase's
  "Done when" checklist passes.
- **Phase 0 is a de-risk spike and gates the whole project.** If its fidelity result is
  unacceptable, stop and surface it — do not proceed to build product surface on a broken premise.
- Treat the **document model as the single source of truth.** The canvas library and the renderer
  derive from it; they never hold canonical state. Violating this is a defect.
- Treat **rnw render as preview.** Never label the in-canvas render pixel-accurate.
  Optional native preview is user-owned and must not gate canvas or code workflows.
- Keep diffs small and reviewable; commit per task, not per phase.

## Non-negotiable invariants

1. Styles are the **RN subset only.** Validate at the model boundary; reject web-only CSS
   (`grid`, cascade, pseudo-selectors, unit strings like `"10px"`, web `boxShadow`).
2. Layout goes through **Yoga (WASM)**, never browser flow. No relying on the DOM to lay things out.
3. Codegen output is **idiomatic RN**: function components, `StyleSheet.create`, correct imports.
4. Agent screenshots identify their source (`canvas` or optional `native`); never conflate them.
5. Native preview platforms are explicit and optional. Never silently substitute one platform.

---

## Tech stack

- **Monorepo:** pnpm workspaces + Turborepo.
- **Studio app:** Vite + React + TypeScript. Tailwind for the *tool's own chrome only*
  (never for canvas content — canvas content is RN styles).
- **Canvas engine:** `tldraw` SDK with a custom `RNFrame` shape. tldraw provides pan/zoom,
  selection, culling, undo/redo, persistence; we render RN trees inside custom shapes.
  tldraw owns *spatial* data (frame position/size/z). The document package owns the *RN tree*.
- **Renderer:** `react-native-web` + `yoga-layout` (WASM build) in `packages/render-web`.
- **Codegen:** `@babel/generator` (+ a typed AST builder) for emit; `@babel/parser` +
  `@babel/traverse` for the later round-trip parse.
- **Optional preview:** a thin local adapter (prefer `serve-sim` for iOS) may expose a
  user-owned native preview. The Phase 0 harness/bridge spike remains parked, not core runtime.
- **MCP server:** `@modelcontextprotocol/sdk` (Node) in `packages/mcp-server`.
- **State:** Zustand for the document store. Yjs reserved for later multiplayer.

## Repo layout

```
/apps
  /studio          # Vite React IDE app: hosts the canvas + inspector + code workflow
  /harness         # Phase 0 Expo fixture; optional local-preview input
/packages
  /document        # RN-primitive node schema, types, tree operations, validation
  /styles          # RN style-subset definitions + validators + (style -> Yoga) mapping
  /render-web      # react-native-web + Yoga(WASM) renderer for one frame
  /codegen         # document <-> RN JSX/StyleSheet (emit first; parse later)
  /sim-bridge      # parked Phase 0 spike / future local-preview adapters
  /mcp-server      # MCP tools exposing the canvas to coding agents
/PRD.md
/BUILD.md
```

---

## Phase 0 — De-risk spike (GATES EVERYTHING)

**Goal:** prove the premise — that an RN tree can render acceptably on a transformable canvas
via rnw+Yoga, and that we can measure its gap against a real device.

Tasks:
- [ ] Scaffold the monorepo (pnpm + Turborepo) with `apps/studio`, `apps/harness`,
      `packages/render-web`, `packages/sim-bridge`.
- [ ] Hardcode one RN node tree in a fixture (a `View` with `flexDirection: row`, two children:
      a `Text` and an `Image`).
- [ ] `packages/render-web`: render that fixture with `react-native-web`, with **Yoga (WASM)**
      computing the box layout (do not let the browser do flow layout).
- [ ] `apps/studio`: place the rendered frame inside a CSS-`transform` container; implement
      pan (drag) and zoom (wheel/pinch). Verify it stays crisp and 60fps. (You may drop in
      `tldraw` here already, or a bare transform container — bare is fine for the spike.)
- [ ] `apps/harness` + `packages/sim-bridge`: render the *same* fixture in the Expo app, boot an
      iOS simulator, and capture a screenshot programmatically
      (`xcrun simctl io booted screenshot`).
- [ ] Show canvas render and simulator screenshot side by side; compute a simple visual diff
      (e.g. pixel diff or SSIM) and print the score.

**Done when:** the side-by-side renders the same tree, pan/zoom is smooth, and you can state a
concrete, acceptable fidelity number. If unacceptable, STOP and report.

## Phase 1 — Document model + canvas shell

**Goal:** real editable document + freeform canvas, no fidelity work yet.

- [ ] `packages/document`: define the node schema for the v1 primitive set
      (`View`, `Text`, `Image`, `Pressable`, `ScrollView`, `TextInput`, `FlatList`),
      typed props per primitive, and an RN-subset `style` object.
- [ ] Tree operations: add/remove/reorder children, edit props, edit style, with validation.
- [ ] Zustand document store; document is source of truth.
- [ ] `packages/styles`: encode the RN style subset + a validator that rejects web-only CSS.
- [ ] `apps/studio`: integrate `tldraw`; define a custom `RNFrame` shape. tldraw holds frame
      spatial data; shape props reference a document subtree by id.
- [ ] Frame create/move/resize/delete + multi-select via tldraw.
- [ ] Inspector panel: edit selected node's props and styles (RN-subset controls only).

**Done when:** you can create multiple frames, build/edit a node tree per frame through the
inspector, and the store remains the single source of truth.

## Phase 2 — Live render + layout fidelity

- [ ] `packages/render-web`: full renderer for all v1 primitives via `react-native-web`.
- [ ] Integrate Yoga (WASM) for layout across the whole tree; map RN styles → Yoga inputs in
      `packages/styles`.
- [ ] Text/font handling: load the fonts the harness uses; document known metric-divergence.
- [ ] Canvas: viewport culling + level-of-detail (cheap proxy for off-focus/zoomed-out frames);
      keep only a few frames "live."

**Done when:** multi-frame canvas renders real RN trees with Yoga-driven layout, smoothly, and
off-focus frames are cheap.

## Phase 3 — Code generation (emit)

- [ ] `packages/codegen`: document subtree → typed AST → RN JSX via `@babel/generator`.
- [ ] Emit `StyleSheet.create`, function components, correct `react-native` imports.
- [ ] "Pages" → React Navigation screen stubs (not web routes).
- [ ] **Sidecar emit:** alongside each generated file, write a committed `*.rncanvas.json`
      holding the canonical node tree + design-time metadata (§7.1 `design`). Generated code stays
      clean; the sidecar is the in-repo persistence and is what the studio loads. The code is
      never reverse-engineered into the document.
- [ ] Invariant: design metadata is emitted **only** into the sidecar, never into the code.
- [ ] Snapshot tests: fixtures → expected RN source + sidecar; assert the code compiles.

> Component extraction is post-v1 (`phase2.md` 2C) and is not built in this phase.

**Done when:** any frame exports idiomatic RN that compiles and visually matches the canvas
within the known gap, and writes a sidecar that reloads into an identical document.

## Phase 4 — Canvas/code workflow hardening

- [ ] Tool rail creates all seven RN primitives as document nodes inside the focused frame;
      they never become tldraw shapes.
- [ ] Screens panel lists document roots and supports create/select/delete without duplicating state.
- [ ] Layers panel exposes the focused document tree and selection/reorder operations through
      the document store.
- [ ] Code workflow clearly supports sidecar open → canvas edit → Sync Code → sidecar reopen.
- [ ] Optional local **Open Preview** action is feature-detected and non-blocking. Prefer a thin
      `serve-sim` adapter for iOS after a dedicated spike; external preview is acceptable.

**Done when:** a user can build and organize a multi-frame primitive document primarily from the
canvas shell, sync/reopen code without state drift, and use the product without native tooling.

## Phase 4.5 — Conformance + direct manipulation (GATES MCP)

**Goal:** prove the document/codegen contract and make the canvas the primary editing surface
before exposing it to agents. This is v1 primitive authoring, not post-v1 components or behavior.

- [ ] Close the model boundary: reject unknown props; validate every field for all seven
      primitives; make accepted RNStyle dimensions agree exactly with Yoga and generated RN.
- [ ] Align primitive semantics across the canvas renderer, native harness, and codegen.
- [ ] Property tests generate bounded arbitrary valid trees across all primitives, props, and
      RNStyle keys; generated RN parses and typechecks, sidecars round-trip identically, and
      design metadata remains sidecar-only. A deterministic corpus guarantees every branch/key.
- [ ] Codegen remains explicit serialization (Generate/Sync), never an automatic render input.
- [ ] Instrument render/layout work. Edits never repaint another frame; unchanged node layers
      with unchanged geometry do not repaint. Keep frame-level Yoga unless measurement shows
      active-frame edits exceed the 16 ms interaction budget.
- [ ] Direct RN-node selection uses Yoga geometry inside the selected RNFrame. Hidden/locked
      nodes are not selectable; RN nodes never become tldraw shapes.
- [ ] Resize writes validated width/height. Drag updates left/top for absolute nodes and reorders
      flex-managed siblings. One gesture is one document undo entry.
- [ ] Pin the default canvas/harness font and FontMetricsTable. Keep native preview optional and
      separate from codegen correctness.

**Done when:** generated RN is mechanically trustworthy over the full supported vocabulary, and a
user can select, resize, and move/reorder RN nodes directly on the canvas while the document store
remains canonical and interaction stays within the frame budget.

## Phase 5 — MCP / agent loop

- [ ] `packages/mcp-server`: implement tools — `get_tree`, `create_frame`, `delete_frame`,
      `update_node`, `set_style`, `get_canvas_screenshot`, `get_code` (from codegen).
- [ ] Wire the server so an agent (Cursor/Claude Code) can connect and operate the live document.
- [ ] End-to-end test: agent creates a frame, sets styles, requests a screenshot, pulls code;
      changes appear on the canvas and survive a reload.

**Done when:** an external agent can build and inspect a frame entirely through MCP, and the
canvas reflects every change.

## Phase 6 — Round-trip + polish

- [ ] `packages/codegen`: parse **external** RN source (`@babel/parser`/`traverse`) back into
      document nodes — i.e. importing code that has no sidecar — reconstructing `StyleSheet`
      references into node `style` objects. Hardest parse step; start with the subset emit
      produces, then widen. (Normal load uses the Phase 3 sidecar and needs none of this.)
- [ ] Undo/redo polish (lean on tldraw where possible). Persistence already lands in Phase 3
      via the sidecar.
- [ ] Optional: Yjs multiplayer.

**Done when:** external RN code with no sidecar imports back to an equivalent document tree.

---

## Definition of done (v1)

A user or agent builds and organizes a multi-frame screen on the canvas, syncs it to idiomatic RN
code plus its canonical sidecar, and reopens it without state drift — **with zero manual porting and
without requiring native tooling.** See PRD §10.
