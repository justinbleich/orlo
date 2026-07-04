/** Pure drop-resolution model for the layer tree (DOM-free, unit-tested). */
import {
  childrenOf,
  findNode,
  getParent,
  isContainer,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { normalizeNodeSelection } from "./selection";

export type DropZone = "before" | "into" | "after";

/**
 * Resolve a drop onto `targetId` at `zone` to a concrete insertion point.
 * - "before"/"after" insert next to the target under its parent.
 * - "into" appends to a container target; for a leaf it behaves like "after".
 * The returned index is where the *first* dragged node lands after all dragged
 * nodes are removed (same-parent moves shift earlier siblings out first — the
 * caller inserts sequentially at index, index+1, …).
 * Returns null for invalid drops (own subtree, root, unknown ids).
 */
export function resolveDrop(
  root: Node,
  targetId: NodeId,
  zone: DropZone,
  draggedIds: readonly NodeId[],
): { parentId: NodeId; index: number } | null {
  if (draggedIds.length === 0 || draggedIds.includes(targetId)) return null;
  const target = findNode(root, targetId);
  if (!target) return null;
  for (const id of draggedIds) {
    const dragged = findNode(root, id);
    if (!dragged) return null;
    if (findNode(dragged, targetId)) return null; // can't drop into own subtree
  }

  if (zone === "into" && isContainer(target)) {
    const kept = target.children.filter((child) => !draggedIds.includes(child.id));
    return { parentId: target.id, index: kept.length };
  }

  // before/after (and "into" a leaf → after): position among the target's siblings.
  if (targetId === root.id) return null;
  const parent = getParent(root, targetId);
  if (!parent) return null;
  const siblings = childrenOf(parent);
  const targetIndex = siblings.findIndex((sibling) => sibling.id === targetId);
  const keptBeforeTarget = siblings.filter(
    (sibling, index) => !draggedIds.includes(sibling.id) && index < targetIndex,
  ).length;
  return {
    parentId: parent.id,
    index: zone === "before" ? keptBeforeTarget : keptBeforeTarget + 1,
  };
}

/** The top-level dragged block for a row: the normalized selection when the row
 *  is part of it, otherwise just the row itself. */
export function draggedBlock(
  root: Node,
  nodeId: NodeId,
  selectedIds: readonly NodeId[],
): NodeId[] {
  if (selectedIds.includes(nodeId)) {
    const block = normalizeNodeSelection(root, [...selectedIds], { excludeRoot: true });
    if (block.includes(nodeId)) return block;
  }
  return [nodeId];
}
