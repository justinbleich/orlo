import {
  canHaveChildren,
  childrenOf,
  createNode,
  findNode,
  getParent,
  isContainer,
  useDocumentStore,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";

/** Run a batch of store mutations as one undo entry, rolling back on failure. */
function asInteraction<T>(fn: () => T): T {
  const store = useDocumentStore.getState();
  store.beginInteraction();
  try {
    const result = fn();
    useDocumentStore.getState().commitInteraction();
    return result;
  } catch (error) {
    useDocumentStore.getState().cancelInteraction();
    throw error;
  }
}

/** Deep-clone a subtree with fresh ids throughout (createNode mints new ids and
 *  re-validates, so a clone is always a valid, independent node). */
function cloneSubtree(node: Node): Node {
  return createNode(node.type, {
    props: node.props as never,
    style: node.style,
    design: node.design,
    children: canHaveChildren(node.type)
      ? childrenOf(node).map(cloneSubtree)
      : undefined,
  });
}

/** Duplicate each node as the next sibling of its original; selects the copies. */
export function duplicateNodes(rootId: NodeId, ids: NodeId[]): NodeId[] {
  return asInteraction(() => {
    const created: NodeId[] = [];
    for (const id of ids) {
      if (id === rootId) continue;
      const root = useDocumentStore.getState().roots[rootId];
      const node = root && findNode(root, id);
      if (!root || !node) continue;
      const parent = getParent(root, id) ?? root;
      const index = childrenOf(parent).findIndex((c) => c.id === id);
      const clone = cloneSubtree(node);
      useDocumentStore.getState().insertChild(rootId, parent.id, clone, index + 1);
      created.push(clone.id);
    }
    if (created.length) useDocumentStore.getState().setSelection(created);
    return created;
  });
}

/** Wrap sibling nodes in a new View at the first one's position (preserves ids). */
export function groupNodes(rootId: NodeId, ids: NodeId[]): NodeId | null {
  const root = useDocumentStore.getState().roots[rootId];
  if (!root) return null;
  const nodes = ids
    .map((id) => findNode(root, id))
    .filter((n): n is Node => !!n && n.id !== rootId);
  if (nodes.length < 1) return null;
  const parent = getParent(root, nodes[0].id);
  if (!parent) return null;
  if (!nodes.every((n) => getParent(root, n.id)?.id === parent.id)) {
    throw new Error("Grouped layers must share the same parent.");
  }
  const siblings = childrenOf(parent);
  const ordered = siblings.filter((s) => ids.includes(s.id));
  const insertIndex = siblings.findIndex((s) => s.id === ordered[0].id);
  const group = createNode("View");
  return asInteraction(() => {
    useDocumentStore.getState().insertChild(rootId, parent.id, group, insertIndex);
    ordered.forEach((node, i) =>
      useDocumentStore.getState().moveNode(rootId, node.id, group.id, i),
    );
    useDocumentStore.getState().setSelection([group.id]);
    return group.id;
  });
}

/** Replace a container with its children in its parent; selects the children. */
export function ungroupNode(rootId: NodeId, id: NodeId): NodeId[] {
  const root = useDocumentStore.getState().roots[rootId];
  const node = root && findNode(root, id);
  if (!root || !node || !isContainer(node)) return [];
  const parent = getParent(root, id);
  if (!parent) return [];
  const kids = childrenOf(node).map((k) => k.id);
  const at = childrenOf(parent).findIndex((s) => s.id === id);
  return asInteraction(() => {
    kids.forEach((kidId, i) =>
      useDocumentStore.getState().moveNode(rootId, kidId, parent.id, at + i),
    );
    useDocumentStore.getState().removeNode(rootId, id);
    useDocumentStore.getState().setSelection(kids);
    return kids;
  });
}

/** Delete each selected node (skips the root); selects the first parent left. */
export function deleteNodes(rootId: NodeId, ids: NodeId[]): void {
  asInteraction(() => {
    let nextSelection: NodeId[] = [];
    for (const id of ids) {
      if (id === rootId) continue;
      const root = useDocumentStore.getState().roots[rootId];
      if (!root || !findNode(root, id)) continue;
      const parent = getParent(root, id);
      if (parent && nextSelection.length === 0) nextSelection = [parent.id];
      useDocumentStore.getState().removeNode(rootId, id);
    }
    useDocumentStore
      .getState()
      .setSelection(nextSelection.length ? nextSelection : [rootId]);
  });
}

/** Insert a primitive relative to the current document selection. Containers
 * receive it as a child; leaves receive it as their next sibling. */
export function insertPrimitive(
  root: Node,
  selectedId: NodeId | null,
  type: RNPrimitive,
): Node {
  const child = createNode(type);
  const anchor = (selectedId && findNode(root, selectedId)) || root;
  const store = useDocumentStore.getState();

  if (isContainer(anchor)) {
    store.insertChild(root.id, anchor.id, child);
  } else {
    const parent = getParent(root, anchor.id) ?? root;
    const index = childrenOf(parent).findIndex((node) => node.id === anchor.id);
    store.insertChild(root.id, parent.id, child, index + 1);
  }

  store.setSelection([child.id]);
  return child;
}
