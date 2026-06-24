import { childrenOf, findNode, getParent, type Node, type NodeId } from "@rn-canvas/document";

/** Keep existing nodes in input order and remove descendants of selected ancestors. */
export function normalizeNodeSelection(
  root: Node,
  ids: readonly NodeId[],
  options: { excludeRoot?: boolean } = {},
): NodeId[] {
  const unique = [...new Set(ids)].filter(
    (id) => findNode(root, id) && (!options.excludeRoot || id !== root.id),
  );
  const selected = new Set(unique);

  return unique.filter((id) => {
    let parent = getParent(root, id);
    while (parent) {
      if (selected.has(parent.id)) return false;
      parent = getParent(root, parent.id);
    }
    return true;
  });
}

export function shareParent(root: Node, ids: readonly NodeId[]): boolean {
  const normalized = normalizeNodeSelection(root, ids, { excludeRoot: true });
  if (normalized.length < 2) return false;
  const parentId = getParent(root, normalized[0])?.id;
  return !!parentId && normalized.every((id) => getParent(root, id)?.id === parentId);
}

function flattenedIds(node: Node): NodeId[] {
  return [node.id, ...childrenOf(node).flatMap(flattenedIds)];
}

export function selectionRange(root: Node, anchorId: NodeId, targetId: NodeId): NodeId[] {
  const order = flattenedIds(root);
  const anchor = order.indexOf(anchorId);
  const target = order.indexOf(targetId);
  if (anchor < 0 || target < 0) return [];
  return normalizeNodeSelection(
    root,
    order.slice(Math.min(anchor, target), Math.max(anchor, target) + 1),
  );
}
