/**
 * Pure, immutable tree operations. Each returns a new tree (sharing untouched
 * subtrees), so the store can keep history for undo/redo. Writes are fail-closed:
 * invalid props/styles throw at this boundary (PRD §7.4, BUILD invariant 1).
 */
import { assertStyle, type RNStyle } from "@rn-canvas/styles";
import type {
  AnyProps,
  DesignMeta,
  Node,
  NodeId,
  PropsByType,
  RNPrimitive,
} from "./types";
import { canHaveChildren, childrenOf, isContainer } from "./types";
import { DEFAULT_PROPS, DEFAULT_STYLE } from "./defaults";
import { validateProps } from "./validate";

function newId(): NodeId {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export interface CreateNodeInit<T extends RNPrimitive> {
  id?: NodeId;
  props?: Partial<PropsByType[T]>;
  style?: RNStyle;
  design?: DesignMeta;
  children?: Node[];
}

/** Create a fresh node with defaults, a new id, and validated overrides. */
export function createNode<T extends RNPrimitive>(
  type: T,
  init: CreateNodeInit<T> = {},
): Node {
  const props = { ...DEFAULT_PROPS[type], ...(init.props ?? {}) } as AnyProps;
  const propErrors = validateProps(type, props);
  if (propErrors.length > 0) {
    throw new Error(
      `Invalid props for ${type} — ${propErrors.map((e) => `${e.key}: ${e.reason}`).join("; ")}`,
    );
  }
  const style = assertStyle({ ...DEFAULT_STYLE[type], ...(init.style ?? {}) });

  const base = { id: init.id ?? newId(), props, style, design: init.design };
  if (canHaveChildren(type)) {
    return { ...base, type, children: init.children ?? [] } as Node;
  }
  if (init.children && init.children.length > 0) {
    throw new Error(`${type} cannot have children`);
  }
  return { ...base, type } as Node;
}

export function findNode(tree: Node, id: NodeId): Node | undefined {
  if (tree.id === id) return tree;
  for (const child of childrenOf(tree)) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Find the root (frame) tree whose subtree contains `id`. */
export function findRootContaining(roots: Node[], id: NodeId): Node | undefined {
  for (const root of roots) {
    if (findNode(root, id)) return root;
  }
  return undefined;
}

export function getParent(tree: Node, id: NodeId): Node | undefined {
  for (const child of childrenOf(tree)) {
    if (child.id === id) return tree;
    const found = getParent(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Replace the node with `id` by `updater(node)`, cloning only the ancestor path. */
function updateNodeById(tree: Node, id: NodeId, updater: (n: Node) => Node): Node {
  if (tree.id === id) return updater(tree);
  if (!isContainer(tree)) return tree;

  let changed = false;
  const next = tree.children.map((child) => {
    const updated = updateNodeById(child, id, updater);
    if (updated !== child) changed = true;
    return updated;
  });
  if (!changed) return tree;
  return { ...tree, children: next } as Node;
}

function assertCanHold(parent: Node, addingCount: number): asserts parent is Node {
  if (!isContainer(parent)) {
    throw new Error(`${parent.type} cannot have children`);
  }
  if (parent.type === "FlatList" && parent.children.length + addingCount > 1) {
    throw new Error("FlatList holds a single item template");
  }
}

export function insertChild(
  tree: Node,
  parentId: NodeId,
  child: Node,
  index?: number,
): Node {
  let inserted = false;
  const result = updateNodeById(tree, parentId, (parent) => {
    assertCanHold(parent, 1);
    const kids = [...(parent as { children: Node[] }).children];
    const at = index ?? kids.length;
    kids.splice(Math.max(0, Math.min(at, kids.length)), 0, child);
    inserted = true;
    return { ...parent, children: kids } as Node;
  });
  if (!inserted) throw new Error(`Parent not found: ${parentId}`);
  return result;
}

export function removeNode(tree: Node, id: NodeId): Node {
  if (tree.id === id) throw new Error("Cannot remove the root node");
  let removed = false;
  const recurse = (node: Node): Node => {
    if (!isContainer(node)) return node;
    if (node.children.some((c) => c.id === id)) {
      removed = true;
      return { ...node, children: node.children.filter((c) => c.id !== id) } as Node;
    }
    let changed = false;
    const next = node.children.map((c) => {
      const u = recurse(c);
      if (u !== c) changed = true;
      return u;
    });
    return changed ? ({ ...node, children: next } as Node) : node;
  };
  const result = recurse(tree);
  if (!removed) throw new Error(`Node not found: ${id}`);
  return result;
}

export function moveNode(
  tree: Node,
  id: NodeId,
  newParentId: NodeId,
  index: number,
): Node {
  if (id === newParentId) throw new Error("Cannot move a node into itself");
  const node = findNode(tree, id);
  if (!node) throw new Error(`Node not found: ${id}`);
  if (findNode(node, newParentId)) {
    throw new Error("Cannot move a node into its own descendant");
  }
  const without = removeNode(tree, id);
  return insertChild(without, newParentId, node, index);
}

export function reorderChild(
  tree: Node,
  parentId: NodeId,
  from: number,
  to: number,
): Node {
  return updateNodeById(tree, parentId, (parent) => {
    if (!isContainer(parent)) throw new Error(`${parent.type} has no children`);
    const kids = [...parent.children];
    if (from < 0 || from >= kids.length) throw new Error(`Bad index: ${from}`);
    const [moved] = kids.splice(from, 1);
    kids.splice(Math.max(0, Math.min(to, kids.length)), 0, moved);
    return { ...parent, children: kids } as Node;
  });
}

export function updateProps(
  tree: Node,
  id: NodeId,
  partial: Partial<AnyProps>,
): Node {
  let found = false;
  const result = updateNodeById(tree, id, (node) => {
    const props = { ...(node.props as object), ...partial } as AnyProps;
    const errors = validateProps(node.type, props);
    if (errors.length > 0) {
      throw new Error(
        `Invalid props for ${node.type} — ${errors.map((e) => `${e.key}: ${e.reason}`).join("; ")}`,
      );
    }
    found = true;
    return { ...node, props } as Node;
  });
  if (!found) throw new Error(`Node not found: ${id}`);
  return result;
}

export function updateStyle(
  tree: Node,
  id: NodeId,
  partial: Partial<RNStyle>,
): Node {
  let found = false;
  const result = updateNodeById(tree, id, (node) => {
    const style = assertStyle({ ...node.style, ...partial });
    found = true;
    return { ...node, style } as Node;
  });
  if (!found) throw new Error(`Node not found: ${id}`);
  return result;
}

export function updateDesign(
  tree: Node,
  id: NodeId,
  partial: Partial<DesignMeta>,
): Node {
  let found = false;
  const result = updateNodeById(tree, id, (node) => {
    found = true;
    return { ...node, design: { ...node.design, ...partial } } as Node;
  });
  if (!found) throw new Error(`Node not found: ${id}`);
  return result;
}
