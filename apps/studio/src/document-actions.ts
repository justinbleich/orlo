import {
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
