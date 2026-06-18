# PRD — RN Canvas (working title)

An infinite-canvas design tool, living in an IDE/harness, that lets designers and AI agents
create and refine **React Native** UI on a freeform canvas and export near-1:1 RN code.

Think Paper / MagicPath, but the canvas nodes *are* React Native primitives and the export
target is React Native — not HTML/CSS.

---

## 1. Problem

The current generation of AI-native, infinite-canvas design tools (Paper, MagicPath, Stitch)
all share one structural advantage: on the web, **HTML/CSS is simultaneously the renderer,
the design model, the export format, and the transformable medium.** One substrate does four
jobs, so "design === code" comes for free and export needs no conversion step.

That unity does not exist for React Native. There is no single substrate that is all four
things at once:

- RN primitives don't paint in a browser canvas without `react-native-web` (a re-implementation).
- A real native runtime (simulator/device) can't be a smooth, freely-transformable infinite canvas.

As a result, a designer who wants RN output today must either design in web tools and **port
the result by hand** (lossy), or work in Figma and hand off to engineering (also lossy). There
is no tool where the thing you manipulate on the canvas is the React Native component you ship.

## 2. Goals

- **Native-first document model.** Canvas nodes are RN primitives (`View`, `Text`, `Image`,
  `Pressable`, `ScrollView`, `TextInput`, `FlatList`), never DOM nodes or rasterized pictures.
- **Faithful export.** Serialize the document tree to idiomatic RN JSX + `StyleSheet` with
  effectively no translation step. This is the core advantage over web tools targeting RN.
- **Live, interactive canvas.** Pan/zoom/select/edit a freeform infinite canvas with real,
  rendered RN components — not static frames.
- **Ground-truth preview.** A real simulator/device shows exactly how a frame renders, and is
  the source of truth where the fast canvas render only approximates.
- **Agent-operable.** Coding agents (Cursor, Claude Code, etc.) can read and write the canvas
  through an MCP server: inspect the node tree, edit nodes/styles, request screenshots, and
  pull generated code.

## 3. Non-goals (v1)

- Pixel-perfect parity between the in-canvas render and the device. The canvas is a **preview**;
  the simulator is truth. We surface the gap rather than pretend it doesn't exist.
- Full bidirectional code↔canvas round-tripping. Generate-from-canvas ships first; parse
  arbitrary RN source back into nodes is a later milestone.
- Animation authoring, gesture authoring, navigation prototyping beyond basic screen stubs.
- Native module / custom-native-view rendering in-canvas (these only appear correctly on device).
- Real-time multiplayer (designed for, but not required for v1).

## 4. Target users

- **RN product engineers** who want to lay out and iterate UI faster than writing JSX by hand.
- **Designers on RN teams** who today design in Figma and watch fidelity die at handoff.
- **AI coding agents** as first-class operators of the canvas, not just consumers of an export.

## 5. The four-jobs problem, and how we split it

Because no RN substrate does all four jobs, we deliberately assign each job to a different
mechanism and accept the seams:

| Job (free on web) | Our mechanism | Consequence |
|---|---|---|
| Rendering surface | `react-native-web` in the IDE webview | Render is an *approximation*; native-only components won't show |
| Design model | RN-primitive node tree (source of truth) | Authoring is constrained to what RN can express |
| Layout | **Yoga compiled to WASM** (the real RN engine) | Layout matches device closely; text/font metrics still differ |
| Export format | Serialize node tree → RN JSX + `StyleSheet` | Near 1:1; this is the *easy* part and the product's edge |
| Transformable medium | CSS transform on the canvas container | Cheap, crisp pan/zoom (web-side only) |
| Ground truth | Simulator/device pane (Metro + Fast Refresh) | Real infra cost; iOS and Android diverge |

The inversion vs. web tools: their **render** is perfect but their RN **export** would be lossy;
ours has an **approximate render** but a **faithful export.** The fidelity gap becomes a preview
problem (solved by the simulator), not a code problem.

## 6. Functional requirements

### 6.1 Document model
- Nodes represent RN primitives with typed props and an RN-subset style object.
- Tree operations: add/remove/reorder children, edit props, edit styles, group into components.
- The document is the single source of truth. The canvas presentation layer and the renderer
  derive from it and never own canonical state.

### 6.2 Canvas
- Infinite pan/zoom, frame create/move/resize/delete, multi-select, undo/redo.
- Each frame hosts a live RN node tree rendered via `react-native-web`.
- Viewport culling and level-of-detail (cheap proxies for off-focus / zoomed-out frames).

### 6.3 Layout
- All layout computed by Yoga (WASM), never by browser flow, so in-canvas geometry matches RN.

### 6.4 Styling
- Style editor exposes **only** the RN style subset: unitless numbers, RN flexbox defaults
  (`flexDirection: column` default), `shadow*`/`elevation`, no cascade, no pseudo-selectors,
  no `grid`, no web-only shorthands.
- Web-only CSS is rejected at the model boundary with a clear validation error.

### 6.5 Code generation
- Export document → idiomatic RN: function components, `StyleSheet.create`, correct imports.
- "Pages" map to **screens** in a navigator (React Navigation), not web routes.
- Component extraction (promote a subtree to a reusable component).

### 6.6 Simulator ground truth
- A harness RN app (Expo) renders any frame spec via Metro + Fast Refresh.
- Focused frame mirrors live on a booted simulator.
- Programmatic screenshot capture for both iOS and Android.
- Visual-diff overlay between canvas render and device screenshot.

### 6.7 Agent / MCP interface
- MCP server exposing, at minimum:
  - `get_tree` — return the document node tree (or a subtree).
  - `create_frame` / `delete_frame`.
  - `update_node` — set props.
  - `set_style` — set RN-subset styles.
  - `get_screenshot` — return a **device** screenshot (from sim-bridge), not a DOM shot.
  - `get_code` — return RN JSX + `StyleSheet` for a node/frame.
- Mirrors Paper's agent-canvas tool shape, adapted so screenshots and code are RN-native.

## 7. Non-functional requirements

- **Fidelity transparency:** never represent the rnw render as pixel-accurate. The diff against
  the simulator must always be obtainable.
- **Performance:** keep at most a small number of frames "live"; everything else is a cheap
  proxy/snapshot. Continuous pan/zoom stays at 60fps via container transform.
- **Determinism:** layout output must be reproducible (pin Yoga version; pin font metrics).
- **Platform honesty:** iOS and Android previews are distinct targets; surface both.

## 8. Key risks (ranked)

1. **Render-fidelity vs. cost.** rnw approximates; truth requires a simulator. If the gap is too
   large or screenshots too slow, the core UX suffers. → De-risk first (see Build Phase 0).
2. **Simulator screenshot infrastructure.** Booting, driving, and capturing iOS + Android
   reliably (and eventually at scale for many agent calls) is real ops work.
3. **Code round-tripping.** RN `StyleSheet` indirection (styles referenced by key, defined
   separately) makes parsing source back into nodes messier than inline-Tailwind round-trips.
4. **Layout edge cases.** Text measurement and font metrics differ between Yoga-in-browser and
   on-device text rendering even when box layout matches.

## 9. Success criteria

- **Phase 0 (premise validated):** a hand-authored RN tree renders on the canvas via rnw+Yoga,
  pans/zooms smoothly, and a side-by-side simulator screenshot shows a measured, acceptable
  fidelity gap.
- **v1 (usable):** a user (or agent) can build a multi-frame screen on the canvas, see it
  mirrored on a simulator, and export RN code that compiles and renders matching the canvas
  within the known fidelity gap — with no manual porting.

## 10. Comparison to existing tools

| | Paper / MagicPath (web) | This tool (RN) |
|---|---|---|
| Canvas nodes | HTML/CSS elements | RN primitives |
| Render fidelity | Perfect (browser) | Approximate (rnw) + truth (simulator) |
| Export | Clean React/Tailwind, no conversion | Clean RN JSX + StyleSheet, no conversion |
| RN handoff | Lossy manual port | None — native by construction |
| Agent screenshots | Free (DOM) | Requires simulator service |
| Layout engine | Browser | Yoga (same as RN) |
