# BUILD.md — RN Canvas

> Executable build plan for Cursor. Pair this with `PRD.md` (requirements + rationale).
> When in doubt about *why*, read the PRD. This file is *how* and *in what order*.

## How to use this file (agent instructions)

- Work **phase by phase, top to bottom.** Do not start a phase until the previous phase's
  "Done when" checklist passes.
- **Phase 0 is a de-risk spike and gates the whole project.** If its fidelity result is
  unacceptable, stop and surface it — do not proceed to build product surface on a broken premise.
- Treat the **document model as the single source of truth.** The canvas library and the renderer
  derive from it; they never hold canonical state. Violating this is a defect.
- Treat **rnw render as preview, simulator as truth.** Never label the in-canvas render
  pixel-accurate anywhere in code, comments, or UI copy.
- Keep diffs small and reviewable; commit per task, not per phase.

## Non-negotiable invariants

1. Styles are the **RN subset only.** Validate at the model boundary; reject web-only CSS
   (`grid`, cascade, pseudo-selectors, unit strings like `"10px"`, web `boxShadow`).
2. Layout goes through **Yoga (WASM)**, never browser flow. No relying on the DOM to lay things out.
3. Codegen output is **idiomatic RN**: function components, `StyleSheet.create`, correct imports.
4. Screenshots returned to agents come from the **simulator**, never from the DOM.
5. iOS and Android are **distinct preview targets.** Never collapse them silently.

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
- **Harness app:** Expo (RN) in `apps/harness`, driven by Metro + Fast Refresh.
- **Sim bridge:** Node service wrapping `xcrun simctl` (iOS) and `adb` (Android) for boot,
  install, and screenshot.
- **MCP server:** `@modelcontextprotocol/sdk` (Node) in `packages/mcp-server`.
- **State:** Zustand for the document store. Yjs reserved for later multiplayer.

## Repo layout

```
/apps
  /studio          # Vite React IDE app: hosts the canvas + inspector + preview pane
  /harness         # Expo RN app that renders a frame spec for ground-truth screenshots
/packages
  /document        # RN-primitive node schema, types, tree operations, validation
  /styles          # RN style-subset definitions + validators + (style -> Yoga) mapping
  /render-web      # react-native-web + Yoga(WASM) renderer for one frame
  /codegen         # document <-> RN JSX/StyleSheet (emit first; parse later)
  /sim-bridge      # simulator/emulator control + screenshot capture (iOS + Android)
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
- [ ] Component extraction: promote a subtree to a named reusable component.
- [ ] "Pages" → React Navigation screen stubs (not web routes).
- [ ] Snapshot tests: fixtures → expected RN source; assert it compiles.

**Done when:** any frame exports idiomatic RN that compiles and visually matches the canvas
within the known gap.

## Phase 4 — Simulator ground truth

- [ ] `apps/harness`: accept a frame spec over a local channel; render via Metro + Fast Refresh.
- [ ] `packages/sim-bridge`: boot/install/screenshot for **iOS (`simctl`)** and
      **Android (`adb`)**; expose a `captureFrame(spec, platform)` API.
- [ ] `apps/studio`: preview pane mirroring the focused frame live on a booted simulator.
- [ ] Visual-diff overlay between canvas render and device screenshot, per platform.

**Done when:** focused frame mirrors on a real simulator and a per-platform diff is one click away.

## Phase 5 — MCP / agent loop

- [ ] `packages/mcp-server`: implement tools — `get_tree`, `create_frame`, `delete_frame`,
      `update_node`, `set_style`, `get_screenshot` (from sim-bridge), `get_code` (from codegen).
- [ ] Wire the server so an agent (Cursor/Claude Code) can connect and operate the live document.
- [ ] End-to-end test: agent creates a frame, sets styles, requests a screenshot, pulls code;
      changes appear on the canvas and survive a reload.

**Done when:** an external agent can build and inspect a frame entirely through MCP, and the
canvas reflects every change.

## Phase 6 — Round-trip + polish

- [ ] `packages/codegen`: parse RN source (`@babel/parser`/`traverse`) back into document nodes,
      reconstructing `StyleSheet` references into the node `style` objects. Expect this to be the
      hardest parse step — start with the subset emit produces, then widen.
- [ ] Persistence; undo/redo polish (lean on tldraw where possible).
- [ ] Optional: Yjs multiplayer.

**Done when:** code emitted by Phase 3 round-trips back to an equivalent document tree.

---

## Definition of done (v1)

A user or agent builds a multi-frame screen on the canvas, mirrors it on a simulator, and exports
RN code that compiles and matches the canvas within the measured fidelity gap — **with zero manual
porting.** See PRD §9.
