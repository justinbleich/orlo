/**
 * The canonical RN-primitive node tree — the single source of truth (PRD §6).
 * The renderer, codegen, and harness all derive from this; none holds canonical
 * state of its own.
 */
import type { Color, RNStyle } from "@rn-canvas/styles";

export const RN_PRIMITIVES = [
  "View",
  "Text",
  "Image",
  "Pressable",
  "ScrollView",
  "TextInput",
  "FlatList",
] as const;

export type RNPrimitive = (typeof RN_PRIMITIVES)[number];

export type NodeId = string;

export interface Annotation {
  id: string;
  text: string;
}

/** Design-time metadata. Never emitted to generated code (PRD §7.1/§7.5). */
export interface DesignMeta {
  name?: string;
  locked?: boolean; // honored by the canvas interaction layer: no select/move
  hidden?: boolean; // honored by the canvas interaction layer: not rendered
  annotations?: Annotation[];
  /**
   * Design-token bindings: styleKey → token id (Phase 2D). The resolved value
   * stays in `style[styleKey]` (so render/Yoga/codegen are untouched); codegen
   * READS this to emit a theme reference but, like `hidden`, never emits the map.
   */
  tokens?: Record<string, string>;
}

// --- Design tokens (Phase 2D) ---

/** Token categories. `color` holds a color string; `spacing`/`fontSize` hold dp
 *  numbers. Each maps to a `theme.<category>` group in the emitted theme module. */
export type TokenCategory = "color" | "spacing" | "fontSize";

/** A named design value. `value` is a color string for `color`, else a number. */
export interface DesignToken {
  id: string;
  name: string;
  category: TokenCategory;
  value: Color | number;
}

/** Back-compat alias for a color token (value is a color string). */
export type ColorToken = DesignToken & { category: "color"; value: Color };

export type TokenRegistry = Record<string, DesignToken>;

interface NodeBase {
  id: NodeId;
  style: RNStyle;
  design?: DesignMeta;
}

// --- Per-primitive props (v1; interaction/data props are post-v1) ---

export interface ViewProps {}

export interface TextProps {
  text: string;
  numberOfLines?: number;
}

export type ImageSource = { uri: string } | { require: string };
export interface ImageProps {
  source: ImageSource;
  resizeMode?: "cover" | "contain" | "stretch" | "center" | "repeat";
}

export interface PressableProps {
  disabled?: boolean; // onPress → phase3
}

export interface ScrollViewProps {
  horizontal?: boolean;
  showsScrollIndicator?: boolean;
}

export interface TextInputProps {
  placeholder?: string;
  value?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad";
}

export interface FlatListProps {
  data: unknown[]; // inline sample data; the data-authoring layer is phase3
  horizontal?: boolean;
}

// --- Node union ---

export interface ViewNode extends NodeBase {
  type: "View";
  props: ViewProps;
  children: Node[];
}
export interface PressableNode extends NodeBase {
  type: "Pressable";
  props: PressableProps;
  children: Node[];
}
export interface ScrollViewNode extends NodeBase {
  type: "ScrollView";
  props: ScrollViewProps;
  children: Node[];
}
export interface FlatListNode extends NodeBase {
  type: "FlatList";
  props: FlatListProps;
  children: [Node] | []; // exactly one item template (or none yet)
}
export interface TextNode extends NodeBase {
  type: "Text";
  props: TextProps;
}
export interface ImageNode extends NodeBase {
  type: "Image";
  props: ImageProps;
}
export interface TextInputNode extends NodeBase {
  type: "TextInput";
  props: TextInputProps;
}

// --- Components & instances (Phase 2C) ---

/** A scalar value an instance overrides a defined prop with. Slot (`node`) props
 *  carry their value in `slots`, keyed by prop name, rather than here. */
export type OverrideValue = string | number | boolean;

/**
 * A placed usage of a `ComponentDefinition`. Its body comes from the definition's
 * template; per-instance values live in `overrides` (scalars) and `slots` (children
 * for `node`-typed props). Not an RN primitive — it expands to one at render/codegen.
 */
export interface ComponentInstanceNode extends NodeBase {
  type: "ComponentInstance";
  componentId: string;
  overrides: Record<string, OverrideValue>;
  slots?: Record<string, Node[]>;
}

export type Node =
  | ViewNode
  | PressableNode
  | ScrollViewNode
  | FlatListNode
  | TextNode
  | ImageNode
  | TextInputNode
  | ComponentInstanceNode;

/** The kind of value a component prop carries (drives editors + codegen prop types). */
export type PropValueType = "string" | "number" | "boolean" | "color" | "enum" | "node";

/**
 * A single inner site a prop drives. `path`/`styleKey` are top-level keys in v1
 * (no deep paths). One prop may list several targets (multi-bind).
 */
export type PropTarget =
  | { kind: "prop"; nodeId: NodeId; path: string }
  | { kind: "style"; nodeId: NodeId; styleKey: string }
  | { kind: "visibility"; nodeId: NodeId }
  | { kind: "slot"; nodeId: NodeId };

/** A named, typed prop exposed by a component, bound to one or more inner targets. */
export interface ComponentProp {
  name: string;
  valueType: PropValueType;
  targets: PropTarget[];
  /** Required iff `valueType === "enum"`. */
  enumValues?: string[];
  /** Scalar value types only (never `node`). */
  default?: OverrideValue;
}

/** A reusable component: a template subtree plus its exposed prop interface. */
export interface ComponentDefinition {
  id: string;
  name: string;
  template: Node;
  props: ComponentProp[];
}

export type ComponentRegistry = Record<string, ComponentDefinition>;

export type ContainerNode = ViewNode | PressableNode | ScrollViewNode | FlatListNode;

/** Map from primitive type → its props shape (for typed createNode/updateProps). */
export interface PropsByType {
  View: ViewProps;
  Text: TextProps;
  Image: ImageProps;
  Pressable: PressableProps;
  ScrollView: ScrollViewProps;
  TextInput: TextInputProps;
  FlatList: FlatListProps;
}

export type AnyProps = PropsByType[RNPrimitive];

const CONTAINER_TYPES: ReadonlySet<RNPrimitive> = new Set<RNPrimitive>([
  "View",
  "Pressable",
  "ScrollView",
  "FlatList",
]);

export function canHaveChildren(type: Node["type"]): boolean {
  return CONTAINER_TYPES.has(type as RNPrimitive);
}

export function isContainer(node: Node): node is ContainerNode {
  return canHaveChildren(node.type);
}

export function childrenOf(node: Node): Node[] {
  return isContainer(node) ? node.children : [];
}
