import {
  canHaveChildren,
  childrenOf,
  createInstance,
  createNode,
  findNode,
  getParent,
  isContainer,
  useDocumentStore,
  type Node,
  type NodeId,
} from "@rn-canvas/document";
import { normalizeNodeSelection } from "./selection";

const DEVICE_FRAME = { width: 390, height: 844 } as const;
const DEVICE_SAFE_AREA = { top: 64, bottom: 48, side: 16 } as const;

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
  if (node.type === "ComponentInstance") {
    // Fresh instance id; copy overrides and re-id any slot subtrees.
    const slots = node.slots
      ? Object.fromEntries(
          Object.entries(node.slots).map(([name, kids]) => [name, kids.map(cloneSubtree)]),
        )
      : undefined;
    return {
      ...createInstance(node.componentId, { style: node.style }),
      overrides: { ...node.overrides },
      ...(slots ? { slots } : {}),
    };
  }
  return createNode(node.type, {
    props: node.props as never,
    style: node.style,
    design: node.design,
    children: canHaveChildren(node.type)
      ? childrenOf(node).map(cloneSubtree)
      : undefined,
  });
}

/** A blank full-bleed mobile screen: device-sized, top-aligned column, white. */
export function createScreenFrame(children: Node[] = [], name?: string): Node {
  return createNode("View", {
    style: {
      width: DEVICE_FRAME.width,
      height: DEVICE_FRAME.height,
      backgroundColor: "#ffffff",
      flexDirection: "column",
      padding: DEVICE_SAFE_AREA.side,
      paddingTop: DEVICE_SAFE_AREA.top,
      paddingBottom: DEVICE_SAFE_AREA.bottom,
      gap: 12,
    },
    design: name ? { name } : undefined,
    children,
  });
}

export function nextScreenName(roots: Iterable<Node>, additionalNames: Iterable<string> = []) {
  const taken = new Set([
    ...Array.from(roots, (root) => root.design?.name).filter((name): name is string => !!name),
    ...additionalNames,
  ]);
  let index = 1;
  while (taken.has(`Screen ${index}`)) index += 1;
  return `Screen ${index}`;
}

/** Duplicate each node as the next sibling of its original; selects the copies. */
export function duplicateNodes(rootId: NodeId, ids: NodeId[]): NodeId[] {
  return asInteraction(() => {
    const created: NodeId[] = [];
    const initialRoot = useDocumentStore.getState().roots[rootId];
    if (!initialRoot) return created;
    for (const id of normalizeNodeSelection(initialRoot, ids, { excludeRoot: true })) {
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
  const normalized = normalizeNodeSelection(root, ids, { excludeRoot: true });
  const nodes = normalized
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
    const initialRoot = useDocumentStore.getState().roots[rootId];
    if (!initialRoot) return;
    for (const id of normalizeNodeSelection(initialRoot, ids, { excludeRoot: true })) {
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

/** Move one relative child by one place in its parent's canonical child order. */
export function reorderNode(rootId: NodeId, id: NodeId, offset: -1 | 1): boolean {
  const store = useDocumentStore.getState();
  const root = store.roots[rootId];
  const node = root && findNode(root, id);
  if (!root || !node || id === rootId || node.design?.locked) return false;
  if (node.style.position === "absolute") return false;
  const parent = getParent(root, id);
  if (!parent) return false;
  const siblings = childrenOf(parent);
  const from = siblings.findIndex((sibling) => sibling.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= siblings.length) return false;
  store.reorderChild(rootId, parent.id, from, to);
  return true;
}

/** Reorder a contiguous flex block to `dropIndex` among remaining siblings. */
export function reorderFlexBlock(
  rootId: NodeId,
  parentId: NodeId,
  blockIds: NodeId[],
  dropIndex: number,
): void {
  if (blockIds.length === 0) return;
  const apply = () => {
    const store = useDocumentStore.getState();
    const root = store.roots[rootId];
    const parent = root && findNode(root, parentId);
    if (!root || !parent) return;

    const siblings = childrenOf(parent);
    const blockSet = new Set(blockIds);
    const block = siblings.filter((sibling) => blockSet.has(sibling.id));
    if (block.length !== blockIds.length) return;

    const remaining = siblings.filter((sibling) => !blockSet.has(sibling.id));
    const clamped = Math.max(0, Math.min(dropIndex, remaining.length));
    const targetOrder = [
      ...remaining.slice(0, clamped),
      ...block,
      ...remaining.slice(clamped),
    ];

    let current = siblings;
    for (let index = 0; index < targetOrder.length; index += 1) {
      const wantId = targetOrder[index].id;
      const from = current.findIndex((sibling) => sibling.id === wantId);
      if (from !== index) {
        useDocumentStore.getState().reorderChild(rootId, parentId, from, index);
        const freshRoot = useDocumentStore.getState().roots[rootId];
        const nextParent = freshRoot && findNode(freshRoot, parentId);
        current = nextParent ? childrenOf(nextParent) : current;
      }
    }
  };

  const store = useDocumentStore.getState();
  if (store.interaction) apply();
  else asInteraction(apply);
}
