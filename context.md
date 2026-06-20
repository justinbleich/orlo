# context.md — working contract & decisions

> Live engineering context for the in-progress work. Source of truth for *requirements*
> remains `_plan/PRD.md` / `_plan/BUILD.md`; this file records the **locked API contract**
> for `packages/document` and `packages/styles` and the decisions behind it, so every
> downstream package builds against a fixed interface.
>
> Updated: 2026-06-20. Phase: **BUILD Phase 1 — document model + canvas shell.**

## Phase 1 execution order (approved)

1. `packages/styles` + `packages/document` (this contract). ← in progress
2. Retarget `render-web` / `harness` / `studio` from `@rn-canvas/fixture` onto the
   document model, on the **existing bare canvas**. Delete `packages/fixture`.
3. **Checkpoint:** confirm the model renders end-to-end (canvas + harness) + diff still runs.
4. Integrate `tldraw` with a custom `RNFrame` shape + inspector (select/move/resize/
   multi-select). `design.locked` / `design.hidden` honored by the interaction layer here.

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
- rnw render is **preview**, simulator is **truth**. Never label the canvas pixel-perfect.

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
