# context.md — working contract & decisions

> Live engineering context for the in-progress work. Source of truth for *requirements*
> remains `_plan/PRD.md` / `_plan/BUILD.md`; this file records the **locked API contract**
> for `packages/document` and `packages/styles` and the decisions behind it, so every
> downstream package builds against a fixed interface.
>
> Updated: 2026-06-20. Phase: **BUILD Phase 1 — document model + canvas shell.**

## Phase 1 execution order (approved)

1. ✅ `packages/styles` + `packages/document` (this contract). — done, tested.
2. ✅ Retarget `render-web` / `harness` / `studio` from `@rn-canvas/fixture` onto the
   document model, on the **existing bare canvas**. `packages/fixture` deleted.
3. ✅ **Checkpoint:** canvas renders the document end-to-end (verified in browser:
   View card + Text + Image, Yoga-driven layout, no console errors). Harness retargeted
   + typechecked; **harness runtime verification is pending a simulator** (not bootable
   in this environment).
4. ✅ Integrate `tldraw` with a custom `RNFrame` shape + inspector. Verified in browser:
   multi-frame canvas, add-frame, node tree + prop/style editing, edit→store→canvas
   re-render (single source of truth), `design.hidden` honored, `design.locked`→shape
   lock wired. tldraw provides move/resize/multi-select/undo natively.

**Phase 1 (BUILD) is complete.**

## Phase 2 — studio UI foundation (tldraw lockdown + tokens + shell)

Foundation only (not feature-complete chrome; cohesion/polish pass at the Phase 3→4
boundary). Three commits:
1. ✅ **tldraw lockdown** — `components` hides default chrome; `overrides.tools` keeps
   only select/hand/zoom (no shape-creating tools); design.locked/hidden are real
   behavior; watermark intact. tldraw is a frame host, never a whiteboard.
2. ✅ **Design tokens** — `design-tokens.css` + `studio-theme.ts` in `apps/studio/src`;
   `STUDIO-UI.md` doc in `_plan/_ui`. Chrome retrofit onto tokens (no raw hex/px); dark
   tldraw canvas (`--canvas`). Discipline: tokens = chrome only; artboard = RNStyle.
3. ✅ **Region skeleton** — top bar · tool rail · left panel (Screens/Layers/Library) ·
   canvas · right column (Inspector Design/Interact/Code + ground-truth pane placeholder).
   Structure + token styling only; features fill in per phase. Verified in browser.

### Post-foundation (UI ↔ v1 functionality alignment)
- ✅ **Tree editing** — Inspector add/delete/reorder (PRD §7.1) via validated store
  actions; reparent-via-drag stays post-v1. Phase 1's "build a tree through the
  inspector" is now actually true.
- ✅ **Selection = single source** — store `selection` is authoritative; focused frame
  derived (`findRootContaining`); canvas↔store synced both ways; orphan shapes pruned.
- ✅ **Undo/redo** — history snapshots tree + selection together; top-bar controls.
- ✅ **Shell trimmed to v1** — rail = Select + Frame; dropped Library (post-v1) and
  Interact (phase 3); kept Export / Code / ground-truth / Run-on-device / Agent as
  honest later-phase placeholders.

### Next: BUILD Phase 2 (render fidelity)
Text measurement first (wire `styles` `TextMeasurer` into `render-web` `computeLayout`
+ font-loading parity), then LOD proxy. tldraw already gives viewport culling.

### Known: tldraw dev warning
Supplying `components`/`overrides` triggers a benign dev-only React warning ("useMemo
deps changed size") from tldraw internals (`TldrawUiComponentsProvider`). No functional
or production-build impact; not suppressible without hacks.

### Open follow-ups carried into slice 4 / later
- **Metro package exports:** `apps/harness/metro.config.js` enables
  `unstable_enablePackageExports` so the `@rn-canvas/document/sample` subpath resolves at
  runtime (RN 0.76 default is off). Verify when a simulator is first booted.
- **rnw type shim is hand-rolled** and duplicated between
  `packages/render-web/src/react-native-web.d.ts` and `apps/studio/src/globals.d.ts`.
  They must stay in sync until replaced by real `@types/react-native` (post-spike).
- **tldraw custom-shape typing:** `RNFrameShapeUtil` has one `@ts-expect-error` —
  tldraw 5.1.1 constrains `ShapeUtil` to the closed builtin `TLShape` union, so a custom
  shape type isn't assignable (runtime is fine). Editor read/writes of the shape use
  isolated casts in `App.tsx`. Revisit if tldraw opens the constraint.
- **Add-frame focus:** creating a frame sets inspector focus to the new root, but the
  store listener re-syncs focus from canvas selection; selecting the frame on canvas is
  the reliable focus path. Minor UX polish for later.
- The Phase 0 in-app/CLI fidelity diff remains historical spike code. Automated native
  capture and pixel diff are post-v1 and must not occupy permanent Studio chrome.

Do **not** touch `packages/codegen`, `sim-bridge` Android, or `packages/mcp-server` until
Phase 1's Done-when passes. Smallest reviewable commits.

## Guardrails (carried from BUILD.md)

- The document tree is the **single source of truth**; render-web, codegen, harness, and
  the canvas library all derive from it and never hold canonical state.
- Layout goes through **Yoga (WASM)**, never browser flow.
- `packages/styles` is the **single authority on style semantics** for all consumers
  (canvas renderer, codegen, harness). None of them maps styles independently.
- **Text measurement is kept distinct** from the style→Yoga property mapping (PRD §9 #1
  fidelity risk — it gets its own module).
- **Determinism (PRD §8):** pin the Yoga version (exact, no `^`); design for pinnable
  font metrics in the measurer.
- rnw render is **preview**. Never label the canvas pixel-perfect; optional native preview
  is a user-owned inspection surface and does not gate authoring or export.

---

## Locked decisions (vs PRD)

| # | Decision | Verdict | Basis |
|---|----------|---------|-------|
| 1 | Text content is `props.text` string (not child nodes); nested `<Text>` is post-v1 | **Keep** | §7.1 typed props, §3/§12 primitive-centric; idiomatic `<Text>{text}</Text>` |
| 2 | FlatList carries inline sample `data` + **one** item-template child (NOT arbitrary children) | **Revised** | §7.1 lists FlatList in v1; must render/compile (BUILD inv. 3). `data` is the minimum honest shape; the *data-authoring layer* (sample-set mgmt, field binding, live sources) is phase3 |
| 3 | `Dimension = number \| "${n}%" \| "auto"`; unit strings rejected | **Keep** | §7.4 unitless values; `%`/`auto` are RN-native, not CSS units |
| 4 | Validation is fail-closed (throws) at tree-op writes; non-throwing `validate*` for UI/MCP | **Keep** | §7.4 + BUILD inv. 1 "validate at the model boundary; reject web-only CSS" |
| 5 | Thin undo/redo history in Phase 1; polish + tldraw coordination later | **Keep** | §7.1 requires undo/redo; BUILD Phase 6 is polish. Caveat: coordinate with tldraw history in slice 4 |
| 6 | Document holds nested `roots` keyed by id; find/parent via traversal | **Keep** | §6 tree is canonical; by-id public API allows an internal index later without contract change |

---

## `packages/styles` — single authority on style semantics

### RN style subset

```ts
export type Color = string;                                  // hex / rgb[a]() / named; no gradients (v1)
export type Dimension = number | `${number}%` | "auto";      // unitless numbers = dp; "px"/"rem"/… rejected
export type FontWeight =
  | "normal" | "bold"
  | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

export type TransformOp =
  | { translateX: number } | { translateY: number }
  | { scale: number } | { scaleX: number } | { scaleY: number }
  | { rotate: `${number}deg` } | { skewX: `${number}deg` } | { skewY: `${number}deg` };

export interface RNStyle {
  // Flexbox (layout)
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  flexWrap?: "wrap" | "nowrap" | "wrap-reverse";
  flex?: number; flexGrow?: number; flexShrink?: number; flexBasis?: Dimension;
  gap?: number; rowGap?: number; columnGap?: number;

  // Dimensions (layout)
  width?: Dimension; height?: Dimension;
  minWidth?: Dimension; maxWidth?: Dimension; minHeight?: Dimension; maxHeight?: Dimension;
  aspectRatio?: number;

  // Position (layout)
  position?: "relative" | "absolute";
  top?: Dimension; right?: Dimension; bottom?: Dimension; left?: Dimension;
  zIndex?: number;

  // Spacing (layout) — long-hand only; no "10px 20px" shorthand
  padding?: Dimension; paddingHorizontal?: Dimension; paddingVertical?: Dimension;
  paddingTop?: Dimension; paddingRight?: Dimension; paddingBottom?: Dimension; paddingLeft?: Dimension;
  margin?: Dimension; marginHorizontal?: Dimension; marginVertical?: Dimension;
  marginTop?: Dimension; marginRight?: Dimension; marginBottom?: Dimension; marginLeft?: Dimension;

  // Border (visual; borderWidth also affects the layout box)
  borderWidth?: number; borderTopWidth?: number; borderRightWidth?: number;
  borderBottomWidth?: number; borderLeftWidth?: number;
  borderColor?: Color;
  borderRadius?: number;
  borderTopLeftRadius?: number; borderTopRightRadius?: number;
  borderBottomLeftRadius?: number; borderBottomRightRadius?: number;

  // Background (visual)
  backgroundColor?: Color;

  // Typography (visual; Text intrinsic size handled by the measurer, not here)
  color?: Color; fontFamily?: string; fontSize?: number; fontWeight?: FontWeight;
  fontStyle?: "normal" | "italic"; lineHeight?: number; letterSpacing?: number;
  textAlign?: "auto" | "left" | "right" | "center" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecorationLine?: "none" | "underline" | "line-through" | "underline line-through";

  // Effects (visual)
  opacity?: number;
  shadowColor?: Color; shadowOffset?: { width: number; height: number };
  shadowOpacity?: number; shadowRadius?: number;
  elevation?: number;                          // Android
  overflow?: "visible" | "hidden" | "scroll";

  // Transform (visual)
  transform?: TransformOp[];
}
```

### Validation boundary

```ts
export interface StyleError { key: string; value: unknown; reason: string }
export type StyleValidation =
  | { ok: true; style: RNStyle }
  | { ok: false; errors: StyleError[] };

// Rejects: unknown keys; unit strings ("10px"/"1rem"/"5vh"); shorthand strings
// ("10px 20px"); web boxShadow strings; grid-*; pseudo-selectors.
export function validateStyle(input: unknown): StyleValidation;
```

### style → Yoga mapping (layout only; distinct from text)

```ts
import type { Node as YogaNode } from "yoga-layout/load";

export const LAYOUT_STYLE_KEYS: ReadonlySet<keyof RNStyle>;
export const VISUAL_STYLE_KEYS: ReadonlySet<keyof RNStyle>;

export function applyLayoutStyle(yogaNode: YogaNode, style: RNStyle): void;  // mutates; no text logic
export function pickVisualStyle(style: RNStyle): Partial<RNStyle>;           // what the renderer paints
```

### Text measurement — its own module (PRD §9 #1 risk)

```ts
export interface TextMeasureInput { text: string; style: RNStyle; numberOfLines?: number; maxWidth?: number }
export interface TextMeasureResult { width: number; height: number }
export interface TextMeasurer { measure(input: TextMeasureInput): TextMeasureResult }

export type FontMetricsTable =
  Record<string /*family*/, { ascent: number; descent: number; lineGap: number }>;
export function createCanvasTextMeasurer(opts?: { fontMetrics?: FontMetricsTable }): TextMeasurer;
```

---

## `packages/document` — canonical RN node tree

### Primitives & Node union

```ts
import type { RNStyle } from "@rn-canvas/styles";

export type RNPrimitive =
  | "View" | "Text" | "Image" | "Pressable" | "ScrollView" | "TextInput" | "FlatList";

export type NodeId = string;

export interface Annotation { id: string; text: string }
export interface DesignMeta {            // never emitted to generated code (PRD §7.1/§7.5)
  name?: string;
  locked?: boolean;                      // honored by tldraw layer (slice 4): no select/move
  hidden?: boolean;                      // honored by tldraw layer (slice 4): not rendered
  annotations?: Annotation[];
}

interface NodeBase { id: NodeId; style: RNStyle; design?: DesignMeta }

export interface ViewProps {}
export interface TextProps { text: string; numberOfLines?: number }
export type ImageSource = { uri: string } | { require: string };
export interface ImageProps { source: ImageSource; resizeMode?: "cover" | "contain" | "stretch" | "center" | "repeat" }
export interface PressableProps { disabled?: boolean }                 // onPress → phase3
export interface ScrollViewProps { horizontal?: boolean; showsScrollIndicator?: boolean }
export interface TextInputProps {
  placeholder?: string; value?: string; secureTextEntry?: boolean;
  editable?: boolean; keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
}
export interface FlatListProps { data: unknown[]; horizontal?: boolean }  // data-authoring tools → phase3

export interface ViewNode       extends NodeBase { type: "View";       props: ViewProps;       children: Node[] }
export interface PressableNode  extends NodeBase { type: "Pressable";  props: PressableProps;  children: Node[] }
export interface ScrollViewNode extends NodeBase { type: "ScrollView"; props: ScrollViewProps; children: Node[] }
export interface FlatListNode   extends NodeBase { type: "FlatList";   props: FlatListProps;   children: [Node] | [] }  // one item template
export interface TextNode       extends NodeBase { type: "Text";       props: TextProps }       // leaf
export interface ImageNode      extends NodeBase { type: "Image";      props: ImageProps }      // leaf
export interface TextInputNode  extends NodeBase { type: "TextInput";  props: TextInputProps }  // leaf

export type Node = ViewNode | PressableNode | ScrollViewNode | FlatListNode | TextNode | ImageNode | TextInputNode;
export type ContainerNode = ViewNode | PressableNode | ScrollViewNode | FlatListNode;

export function canHaveChildren(type: RNPrimitive): boolean;   // View/Pressable/ScrollView/FlatList
export function childrenOf(node: Node): Node[];                // [] for leaves
```

### Tree operations (pure, immutable)

```ts
export function createNode<T extends RNPrimitive>(type: T, init?: Partial<...>): Node;  // fresh id + defaults

export function findNode(tree: Node, id: NodeId): Node | undefined;
export function getParent(tree: Node, id: NodeId): Node | undefined;

export function insertChild(tree: Node, parentId: NodeId, child: Node, index?: number): Node;
export function removeNode(tree: Node, id: NodeId): Node;
export function moveNode(tree: Node, id: NodeId, newParentId: NodeId, index: number): Node;
export function reorderChild(tree: Node, parentId: NodeId, from: number, to: number): Node;

export function updateProps(tree: Node, id: NodeId, partial: Partial<AnyProps>): Node;   // validated
export function updateStyle(tree: Node, id: NodeId, partial: Partial<RNStyle>): Node;     // validated via styles
export function updateDesign(tree: Node, id: NodeId, partial: Partial<DesignMeta>): Node;
```

### Validation boundary (fail-closed at writes)

```ts
export type NodeError = { nodeId: NodeId; key: string; reason: string };
export function validateProps(type: RNPrimitive, props: unknown): NodeError[];
export function validateNode(node: Node): NodeError[];   // props + delegates style to validateStyle
export function validateTree(root: Node): NodeError[];
```

- `insertChild` rejects children on leaf types (and >1 child on FlatList);
  `updateStyle`/`updateProps` validate before writing and **throw** on invalid input.
- UI/MCP call the non-throwing `validate*` first to surface errors cleanly.

### Store (Zustand) — single source of truth

```ts
export interface DocumentState {
  roots: Record<NodeId, Node>;   // one root per frame; tldraw RNFrame stores frameId → rootId
  selection: NodeId[];
}
export const useDocumentStore: UseBoundStore<...>;   // actions wrap the pure ops; thin undo/redo history
```

### Sample fixture (folds in `packages/fixture`)

The Phase-0 tree becomes `sampleDocument: Node` exported from `document`, used by the
render/diff harness and tests. `packages/fixture` is deleted; render-web / harness / studio
retarget to `@rn-canvas/document`.

## Phase 3 Sync Code checkpoint

- `packages/codegen` remains Node-side; Babel is never bundled into the browser.
- Studio `POST /api/codegen/preview` returns generated RN + sidecar for the focused root.
- Studio `POST /api/codegen/sync` writes a user-selected `.tsx` path and the adjacent
  `.rncanvas.json` inside the workspace (default: `generated/Screen.tsx`).
- Product semantics are **Sync Code**, not detached export: repo-aware filesystem
  materialization, deterministic output, Git actions explicit and deferred.
- Path traversal outside the workspace is rejected; design metadata remains sidecar-only.

## Phase 3 completion checkpoint

- Studio opens canonical `*.rncanvas.json` documents through a workspace-confined,
  validated Node endpoint; opening atomically replaces roots and resets undo history.
- `generateScreens` serializes multiple document roots as independent default-exported
  native screen modules. They are ready for React Navigation registration without
  introducing a v1 route graph, route params, transitions, or navigation editor.
- Phase 3 exit loop: sidecar → Studio document → edit → Sync Code + sidecar.

## V1 focus correction after Phase 3

- The simulator-automation experiment is parked intact on
  `codex/phase4-simulator-ground-truth`; do not merge it into v1 by default.
- Phase 4 now hardens the canvas/code workflow: seven-primitive rail insertion,
  document-derived Screens/Layers, and sidecar Sync Code/reopen.
- Native preview is optional, local, and feature-detected. Prefer a small `serve-sim`
  spike for iOS after Xcode is available; boot/install automation, Android parity,
  interaction automation, and pixel diff are post-v1.
- The fixed ground-truth pane is removed from v1 so canvas and inspector retain the space.

## Phase 4 canvas/code checkpoint

- The tool rail exposes Frame plus all seven v1 RN primitives. Frame creates an `RNFrame` root;
  primitives use one shared `insertPrimitive` action and become document children/siblings,
  never tldraw shapes.
- Screens is derived from document roots and supports create/select/delete. Layers is derived
  from the focused root and single document selection, with validated select/reorder/delete.
  Locked nodes cannot be selected, moved, or deleted; the Layers tree provides an explicit
  unlock action. Inspector now edits selected-node properties only.
- Sidecar/code invariants remain covered by the codegen suite: serialization round-trips to an
  identical tree, and design metadata appears only in the sidecar. Full styles/document/codegen
  tests and the monorepo production build pass.
- Manual browser verification confirmed primitive-rail insertion. Local browser automation was
  then disabled before the Screens/Layers click-through, so that final interaction pass remains.
- Commit boundary 1: primitive action + rail wiring. Commit boundary 2: document tree,
  Screens/Layers, and Inspector simplification. Git writes were blocked by approval-service
  quota after implementation; keep these boundaries when committing later.

## Phase 4.5 conformance checkpoint

- The document and style boundaries now fail closed across all seven primitives, typed props,
  design metadata, tree structure, JSON-safe FlatList data, and Yoga-supported dimensions.
- Renderer, native harness, and codegen primitive semantics are aligned. Generated source is an
  explicit serialization only; no codegen/transpile path participates in interactive rendering.
- A deterministic full-contract corpus plus 100 bounded fast-check documents assert Babel parse,
  React Native TypeScript compilation, identical sidecar round-trip, and sidecar-only design data.
- Render/layout work is instrumented. Layout snapshots are indexed by node ID and unchanged node
  layers with unchanged geometry are memoized.
- `RNNodeOverlay` provides Yoga-geometry hit-testing, selection, resize, absolute move, and flex
  reorder. All writes use document-store actions and one gesture produces one undo entry.
- Studio and the Expo harness load `@expo-google-fonts/inter` 0.4.2. The styles package owns
  Inter's pinned normalized hhea metrics (1984 / -494 / 0 at 2048 units/em) for text measurement.
- The Phase 0 simulator/diff implementation remains parked, but its root and Studio commands are
  removed. Optional native preview remains separate from codegen correctness.
- Phase 4.5 passes. Phase 5 MCP is next; `phase2.md` and `phase3.md` remain post-v1.

## Phase 5 MCP checkpoint

- `packages/mcp-server` exposes the BUILD tool set over stdio using
  `@modelcontextprotocol/sdk` 1.29.0: `get_tree`, `create_frame`, `delete_frame`,
  `update_node`, `set_style`, `get_code`, and `get_canvas_screenshot`.
- The MCP process does not own document state. A Vite-hosted command queue leases one live Studio
  browser client and executes every operation against `useDocumentStore`.
- Agent writes use the same validated store APIs as the Inspector and canvas. Combined prop/design
  writes are one undo transaction; failed validation restores the pre-command snapshot.
- `get_code` is an explicit document-to-code/sidecar serialization. `get_canvas_screenshot`
  captures the actual mounted RNFrame DOM and labels it as canvas source.
- Normal protocol tests use the SDK's in-memory transport. The opt-in live test connects through
  the real Studio bridge, creates/edits/reads a frame, round-trips its sidecar, captures it, and
  deletes it. Full package tests and monorepo build pass.
- Phase 5 passes. Phase 6 external RN import + polish is next; post-v1 roadmaps remain parked.

## Phase 6 round-trip + polish checkpoint

- `packages/codegen` now has a fail-closed Babel AST importer for the static RN syntax emitted by
  codegen. It covers all seven primitives, typed props, StyleSheet references, static inline styles,
  Image sources, FlatList templates, and the complete validated RNStyle contract without executing code.
- Emit → parse → emit equality is tested over the full primitive fixture. Dynamic expressions,
  unknown props, and unsupported RN styles are rejected at the import boundary.
- Studio exposes external `.tsx`/`.jsx` import separately from canonical sidecar opening through a
  workspace-confined Node endpoint. Import starts a fresh document session and Babel stays out of the
  foreground render path.
- Visible and keyboard undo/redo now cover both document edits and tldraw-owned frame geometry.
  Selection-only tldraw checkpoints are skipped so frame move undo/redo restores exact geometry.
- Phase 6 and the v1 BUILD sequence pass. Optional Yjs and both post-v1 roadmap files remain parked.

## V1 release checkpoint

- A live two-frame authoring pass exercised frame creation, RN Text insertion/editing, flex reorder,
  per-frame Sync Code, sidecar validation, external-source parsing, and sidecar reopen without drift.
- Document open/import now clears tldraw history as part of the same new-session boundary as
  `loadRoots`, so Undo cannot target frame operations from the previously open document.
- Temporary release-check artifacts were removed after validation. The standard full test/build
  gate passes; the opt-in MCP live test could not be rerun because execution approval was unavailable,
  so the completed Phase 5 live pass remains the current agent-loop evidence.

## Phase 2A interaction audit checkpoint

- Root RNFrames are inspectable again. Canvas and Layers selections are normalized to non-overlapping
  nodes, with modifier/range selection in Layers and hierarchy-safe group/duplicate/delete actions.
- Continuous Inspector controls open one document interaction and commit on blur/pointer release;
  one visible field edit now produces one undo step. Active edits also enable the top-bar Undo action.
- Tailwind theme/utilities remain chrome-only, but global preflight is removed and replaced by resets
  scoped to `.studio-chrome` / `.studio-popup`. RN artboard images are no longer CSS-constrained.
- Narrow hosts use a tokenized 960px workspace minimum. Compact Inspector/menu measurements and
  shadows moved into design tokens. Six Studio tests cover selection and subtree action boundaries.
- Full workspace tests/build and live root-inspector, nested marquee/group, Layers multi-select,
  narrow-width, CSS-isolation, and field-undo regressions pass. Freeform versus Yoga-flow creation is
  the next design decision and was not changed.

## Phase 2A interaction parity checkpoint

- Figma/Paper parity is scoped to selection, hierarchy, direct manipulation, and keyboard fluency;
  the product remains RN-first and does not adopt a vector-editor shape vocabulary.
- RNFrame edge gestures pass through to tldraw geometry, while RN-node interaction remains owned by
  the document overlay. Relative children reorder along their parent's visual flex axis with arrow
  keys or axis-aware sidebar controls; absolute children remain positional.
- Screens and Layers share one collapsible navigator, nested layer branches collapse independently,
  and an active relative-child drag temporarily reveals the owning Yoga flow and child slots.

## Phase 2A completion checkpoint

- The creation-model decision is closed as **flex-flow**. Draw-to-create inserts relative children
  at a Yoga-derived sibling index; absolute placement is an explicit Inspector choice.
- Canvas interaction geometry and insertion/reorder calculations live in testable pure helpers.
  Multi-node flow reordering and creation are one document undo transaction.
- Phase 2A passes with eighteen Studio interaction tests and the full monorepo build. Phase 2B starts
  from sizing/layout semantics, then adds snapping and smart-canvas affordances.

## Phase 2B sizing checkpoint

- Container auto-layout controls were already document-direct and complete for direction, gap,
  padding, alignment, distribution, and wrap.
- `packages/styles` is the authority for physical-axis hug/fill/fixed translation. Main-axis Fill
  uses flex growth; cross-axis Fill uses stretch; Hug removes stale dimensions/flex properties and
  overrides an implicitly stretching cross axis when required.
- The Inspector exposes Width and Height sizing only for relative siblings under one shared parent.
  Every change routes through validated document actions and one undo entry; codegen serializes the
  resulting RNStyle without a second semantic mapping.
- The explicit Studio TypeScript gate also fixed latent type errors in the extracted Phase 2A
  interaction tests. Constraints, alignment actions, snapping, and spacing hints remain open.

## Phase 2B edge-constraints checkpoint

- Absolute constraints are RN edge combinations, not separate metadata: left/top, right/bottom, or
  opposing edges with the explicit axis size removed for stretch.
- Constraint-mode conversion consumes the latest derived Yoga geometry and parent border insets so
  changing pins preserves the visible child rectangle. The layout snapshot lives only in the Studio
  UI store and never enters the canonical document or serialization.
- Manual edge edits share the same canonical rules: adding the opposite pin removes width/height;
  removing one pin restores the current fixed size. Center/scale approximations remain deferred
  until their hit-testing and RN-runtime behavior can be represented without drift.

## Phase 2B arrange + snapping checkpoint

- Absolute align/distribute actions consume Yoga boxes and write edge-preserving RN offsets in one
  document interaction. Flex actions are enabled only when the entire relative sibling flow is
  selected, preventing unselected siblings from moving as collateral.
- Absolute dragging snaps the moving selection's edges and centers to the parent and visible
  siblings. Guide lines are transient Studio chrome; snap results are ordinary RN edge values.
- Relative → Absolute now captures explicit left/top/width/height from Yoga before interaction.
  The tldraw RNFrame shape also rejects host translation whenever selection is inside its document,
  making frame geometry and node geometry unambiguous gesture owners.
- Equal-spacing distance hints remain the outstanding smart-guide affordance.
