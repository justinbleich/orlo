/**
 * Pure canvas interaction helpers — creation model, flex insert/reorder indices,
 * and hit testing. Kept separate from LayerOverlay so behavior is testable.
 *
 * Creation model (Phase 2A): **flex-flow** — draw-to-create always inserts a
 * relative (flex) child at a Yoga-derived index. Absolute placement is opt-in
 * via the inspector, never implied by drawing.
 */
import {
  childrenOf,
  createNode,
  findNode,
  getParent,
  isContainer,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";

export const CREATION_MODEL = "flex-flow" as const;

export type Point = { x: number; y: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type LayoutHitBox = {
  node: Node;
  instanceKey: string;
  left: number;
  top: number;
  width: number;
  height: number;
  children: LayoutHitBox[];
};

export function rectOf(a: Point, b: Point): Rect {
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

function contains(box: LayoutHitBox, point: Point): boolean {
  return (
    point.x >= box.left &&
    point.x <= box.left + box.width &&
    point.y >= box.top &&
    point.y <= box.top + box.height
  );
}

/** Deepest visible/unlocked document box at a frame-local point. */
export function hitTestLayout(box: LayoutHitBox, point: Point): LayoutHitBox | undefined {
  if (box.node.design?.hidden || box.node.design?.locked || !contains(box, point)) {
    return undefined;
  }
  for (let index = box.children.length - 1; index >= 0; index -= 1) {
    const hit = hitTestLayout(box.children[index], point);
    if (hit) return hit;
  }
  return box;
}

export function flexFlowHorizontal(flexDirection: string | undefined): boolean {
  return flexDirection?.startsWith("row") ?? false;
}

/** Insert/reorder index among siblings, optionally skipping a moving block. */
export function flexInsertIndex(
  siblings: readonly { id: NodeId; box: Pick<LayoutHitBox, "left" | "top" | "width" | "height"> }[],
  point: Point,
  horizontal: boolean,
  skipIds: ReadonlySet<NodeId> = new Set(),
): number {
  const remaining = siblings.filter((sibling) => !skipIds.has(sibling.id));
  const coordinate = horizontal ? point.x : point.y;
  for (let index = 0; index < remaining.length; index += 1) {
    const box = remaining[index].box;
    const midpoint = horizontal ? box.left + box.width / 2 : box.top + box.height / 2;
    if (coordinate < midpoint) return index;
  }
  return remaining.length;
}

/** Draw-to-create into the actively selected container appends by default. */
export function flexCreateInsertIndex(
  siblings: readonly { id: NodeId; box: Pick<LayoutHitBox, "left" | "top" | "width" | "height"> }[],
  point: Point,
  horizontal: boolean,
  targetId: NodeId,
  selectedIds: readonly NodeId[],
): number {
  if (selectedIds.includes(targetId)) return siblings.length;
  return flexInsertIndex(siblings, point, horizontal);
}

/** Selected flex siblings of `parent`, in document order, excluding absolutes. */
export function flexBlockInParent(
  root: Node,
  parentId: NodeId,
  selectedIds: readonly NodeId[],
): NodeId[] {
  const parent = findNode(root, parentId);
  if (!parent) return [];
  const selected = new Set(selectedIds);
  return childrenOf(parent)
    .filter((child) => selected.has(child.id) && child.style.position !== "absolute")
    .map((child) => child.id);
}

export function drawSize(rect: Rect): { width: number; height: number } {
  const dragged = rect.x1 - rect.x0 >= 6 && rect.y1 - rect.y0 >= 6;
  return {
    width: dragged ? Math.round(rect.x1 - rect.x0) : 100,
    height: dragged ? Math.round(rect.y1 - rect.y0) : 40,
  };
}

/** Build a node for draw-to-create with primitive-appropriate defaults. */
export function buildDrawnNode(type: RNPrimitive, width: number, height: number): Node {
  switch (type) {
    case "Text":
      return createNode("Text", { props: { text: "Text" } });
    case "FlatList":
      return createNode("FlatList", {
        style: { width, height, flex: undefined },
        children: [
          createNode("View", {
            style: { padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
            children: [createNode("Text", { props: { text: "Item" } })],
          }),
        ],
      });
    case "ScrollView":
      return createNode("ScrollView", { style: { width, height, flex: undefined } });
    case "TextInput":
      return createNode("TextInput", { style: { width, height: Math.max(height, 36) } });
    case "Pressable":
      return createNode("Pressable", {
        style: {
          width,
          height: Math.max(height, 40),
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "#CBD5E1",
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        },
        children: [
          createNode("Text", {
            props: { text: "Pressable" },
            style: { color: "#111827", textAlign: "center" },
          }),
        ],
      });
    case "Image":
      return createNode("Image", { style: { width, height } });
    default:
      return createNode(type, { style: { width, height } });
  }
}

/** Nearest container at a point; falls back to the frame root. */
export function containerAt(
  root: Node,
  layout: LayoutHitBox,
  point: Point,
): { node: Node; box: LayoutHitBox } {
  const hit = hitTestLayout(layout, point);
  if (!hit) return { node: root, box: layout };
  if (isContainer(hit.node)) return { node: hit.node, box: hit };
  const parent = getParent(root, hit.node.id);
  if (parent) {
    const parentHit = findBoxInTree(layout, parent.id);
    if (parentHit) return { node: parent, box: parentHit };
  }
  return { node: root, box: layout };
}

function findBoxInTree(box: LayoutHitBox, nodeId: NodeId): LayoutHitBox | undefined {
  if (box.node.id === nodeId) return box;
  for (const child of box.children) {
    const hit = findBoxInTree(child, nodeId);
    if (hit) return hit;
  }
  return undefined;
}
