/**
 * Zustand document store — the single source of truth at runtime. tldraw will
 * own frame *spatial* data and reference a root by id; this store owns the RN
 * trees. Undo/redo here is a thin snapshot history (BUILD Phase 6 polishes it;
 * tldraw history coordination happens when RNFrame lands).
 */
import { create } from "zustand";
import type { RNStyle } from "@rn-canvas/styles";
import type {
  AnyProps,
  ComponentDefinition,
  ComponentRegistry,
  DesignMeta,
  Node,
  NodeId,
  OverrideValue,
} from "./types";
import {
  findNode,
  insertChild as opInsertChild,
  moveNode as opMoveNode,
  removeNode as opRemoveNode,
  reorderChild as opReorderChild,
  replaceNode,
  updateDesign as opUpdateDesign,
  updateProps as opUpdateProps,
  updateStyle as opUpdateStyle,
} from "./tree";
import { validateTree } from "./validate";
import {
  createInstance,
  promoteToComponent as promoteOp,
  validateComponentRegistry,
  validateInstance,
} from "./components";

export type Roots = Record<NodeId, Node>;

/** A history entry snapshots the trees, the component registry, and the selection,
 *  so undo/redo restores a coherent document (no dangling selection or definition). */
export interface Snapshot {
  roots: Roots;
  components: ComponentRegistry;
  selection: NodeId[];
}

export interface DocumentState {
  roots: Roots;
  /** Reusable component definitions, keyed by id (Phase 2C). Not per-frame. */
  components: ComponentRegistry;
  selection: NodeId[];
  past: Snapshot[];
  future: Snapshot[];
  interaction: Snapshot | null;

  setSelection(ids: NodeId[]): void;
  beginInteraction(): void;
  commitInteraction(): void;
  cancelInteraction(): void;

  /** Replace the open document atomically. Used by sidecar loading; opening a
   *  document starts a fresh undo history rather than mixing document sessions. */
  loadRoots(roots: Roots, selection?: NodeId[], components?: ComponentRegistry): void;

  addRoot(root: Node): void;
  removeRoot(rootId: NodeId): void;

  // --- Components & instances (Phase 2C) ---
  /** Replace a node with an instance of a new component built from its subtree. */
  promoteToComponent(rootId: NodeId, nodeId: NodeId, name: string): void;
  addComponent(definition: ComponentDefinition): void;
  updateComponent(componentId: NodeId, partial: Partial<ComponentDefinition>): void;
  removeComponent(componentId: NodeId): void;
  placeInstance(rootId: NodeId, parentId: NodeId, componentId: NodeId, index?: number): void;
  setInstanceOverride(rootId: NodeId, instanceId: NodeId, name: string, value: OverrideValue): void;
  setInstanceSlot(rootId: NodeId, instanceId: NodeId, name: string, children: Node[]): void;

  insertChild(rootId: NodeId, parentId: NodeId, child: Node, index?: number): void;
  removeNode(rootId: NodeId, id: NodeId): void;
  moveNode(rootId: NodeId, id: NodeId, newParentId: NodeId, index: number): void;
  reorderChild(rootId: NodeId, parentId: NodeId, from: number, to: number): void;
  updateProps(rootId: NodeId, id: NodeId, partial: Partial<AnyProps>): void;
  updateStyle(rootId: NodeId, id: NodeId, partial: Partial<RNStyle>): void;
  updateDesign(rootId: NodeId, id: NodeId, partial: Partial<DesignMeta>): void;

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
}

const HISTORY_LIMIT = 100;

export const useDocumentStore = create<DocumentState>((set, get) => {
  const snapshotOf = (state: DocumentState): Snapshot => ({
    roots: state.roots,
    components: state.components,
    selection: state.selection,
  });

  /** Commit new roots and/or registry, snapshotting the prior document for undo. */
  const commit = (next: { roots?: Roots; components?: ComponentRegistry }) => {
    set((state) => ({
      past: state.interaction
        ? state.past
        : [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
      future: [],
      roots: next.roots ?? state.roots,
      components: next.components ?? state.components,
    }));
  };

  /** Run a pure op against one root and commit if it changed. */
  const mutateRoot = (rootId: NodeId, fn: (tree: Node) => Node) => {
    const { roots } = get();
    const tree = roots[rootId];
    if (!tree) throw new Error(`Root not found: ${rootId}`);
    const next = fn(tree);
    if (next === tree) return;
    commit({ roots: { ...roots, [rootId]: next } });
  };

  return {
    roots: {},
    components: {},
    selection: [],
    past: [],
    future: [],
    interaction: null,

    setSelection: (ids) => set({ selection: ids }),
    beginInteraction: () => {
      const state = get();
      if (state.interaction) throw new Error("A document interaction is already active");
      set({ interaction: snapshotOf(state) });
    },
    commitInteraction: () => {
      const state = get();
      if (!state.interaction) return;
      const changed =
        state.roots !== state.interaction.roots ||
        state.components !== state.interaction.components;
      set({
        interaction: null,
        past: changed
          ? [...state.past, state.interaction].slice(-HISTORY_LIMIT)
          : state.past,
        future: changed ? [] : state.future,
      });
    },
    cancelInteraction: () => {
      const state = get();
      if (!state.interaction) return;
      set({
        roots: state.interaction.roots,
        components: state.interaction.components,
        selection: state.interaction.selection,
        interaction: null,
      });
    },

    loadRoots: (roots, selection, components) => {
      for (const [rootId, root] of Object.entries(roots)) {
        if (root.id !== rootId) {
          throw new Error(`Root key does not match node id: ${rootId}`);
        }
        const errors = validateTree(root);
        if (errors.length > 0) {
          const first = errors[0];
          throw new Error(
            `Invalid document root ${rootId}: ${first.key} ${first.reason}`,
          );
        }
      }
      const registry = components ?? {};
      const regErrors = validateComponentRegistry(registry);
      if (regErrors.length > 0) {
        const first = regErrors[0];
        throw new Error(`Invalid component registry: ${first.key} ${first.reason}`);
      }
      const nextSelection = selection ?? Object.keys(roots).slice(0, 1);
      set({
        roots,
        components: registry,
        selection: nextSelection,
        past: [],
        future: [],
        interaction: null,
      });
    },

    addRoot: (root) => {
      const errors = validateTree(root);
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Invalid document root ${root.id}: ${first.key} ${first.reason}`);
      }
      commit({ ...get().roots, [root.id]: root });
    },
    removeRoot: (rootId) => {
      const next = { ...get().roots };
      delete next[rootId];
      commit({ roots: next });
    },

    promoteToComponent: (rootId, nodeId, name) => {
      const { roots, components } = get();
      const tree = roots[rootId];
      if (!tree) throw new Error(`Root not found: ${rootId}`);
      const node = findNode(tree, nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const { definition, instance } = promoteOp(node, name);
      // Reuse the node's id for the instance so selection/spatial references hold.
      const placed = { ...instance, id: nodeId };
      const nextComponents = { ...components, [definition.id]: definition };
      const regErrors = validateComponentRegistry(nextComponents);
      if (regErrors.length > 0) {
        const first = regErrors[0];
        throw new Error(`Invalid component: ${first.key} ${first.reason}`);
      }
      commit({
        roots: { ...roots, [rootId]: replaceNode(tree, nodeId, placed) },
        components: nextComponents,
      });
    },

    addComponent: (definition) => {
      const next = { ...get().components, [definition.id]: definition };
      const errors = validateComponentRegistry(next);
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Invalid component: ${first.key} ${first.reason}`);
      }
      commit({ components: next });
    },

    updateComponent: (componentId, partial) => {
      const { components } = get();
      const current = components[componentId];
      if (!current) throw new Error(`Component not found: ${componentId}`);
      const updated: ComponentDefinition = { ...current, ...partial, id: componentId };
      const next = { ...components, [componentId]: updated };
      const errors = validateComponentRegistry(next);
      if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`Invalid component: ${first.key} ${first.reason}`);
      }
      commit({ components: next });
    },

    removeComponent: (componentId) => {
      const next = { ...get().components };
      delete next[componentId];
      commit({ components: next });
    },

    placeInstance: (rootId, parentId, componentId, index) => {
      const { roots, components } = get();
      if (!components[componentId]) throw new Error(`Unknown component: ${componentId}`);
      const tree = roots[rootId];
      if (!tree) throw new Error(`Root not found: ${rootId}`);
      const instance = createInstance(componentId);
      commit({ roots: { ...roots, [rootId]: opInsertChild(tree, parentId, instance, index) } });
    },

    setInstanceOverride: (rootId, instanceId, name, value) =>
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, instanceId);
        if (!node || node.type !== "ComponentInstance") {
          throw new Error(`Instance not found: ${instanceId}`);
        }
        const nextInstance = { ...node, overrides: { ...node.overrides, [name]: value } };
        const errors = validateInstance(nextInstance, get().components);
        if (errors.length > 0) throw new Error(`Invalid override: ${errors[0].reason}`);
        return replaceNode(tree, instanceId, nextInstance);
      }),

    setInstanceSlot: (rootId, instanceId, name, children) =>
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, instanceId);
        if (!node || node.type !== "ComponentInstance") {
          throw new Error(`Instance not found: ${instanceId}`);
        }
        const nextInstance = {
          ...node,
          slots: { ...node.slots, [name]: children },
        };
        const errors = validateInstance(nextInstance, get().components);
        if (errors.length > 0) throw new Error(`Invalid slot: ${errors[0].reason}`);
        return replaceNode(tree, instanceId, nextInstance);
      }),

    insertChild: (rootId, parentId, child, index) =>
      mutateRoot(rootId, (t) => opInsertChild(t, parentId, child, index)),
    removeNode: (rootId, id) => mutateRoot(rootId, (t) => opRemoveNode(t, id)),
    moveNode: (rootId, id, newParentId, index) =>
      mutateRoot(rootId, (t) => opMoveNode(t, id, newParentId, index)),
    reorderChild: (rootId, parentId, from, to) =>
      mutateRoot(rootId, (t) => opReorderChild(t, parentId, from, to)),
    updateProps: (rootId, id, partial) =>
      mutateRoot(rootId, (t) => opUpdateProps(t, id, partial)),
    updateStyle: (rootId, id, partial) =>
      mutateRoot(rootId, (t) => opUpdateStyle(t, id, partial)),
    updateDesign: (rootId, id, partial) =>
      mutateRoot(rootId, (t) => opUpdateDesign(t, id, partial)),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    undo: () =>
      set((state) => {
        if (state.past.length === 0) return state;
        const previous = state.past[state.past.length - 1];
        return {
          roots: previous.roots,
          components: previous.components,
          selection: previous.selection,
          past: state.past.slice(0, -1),
          future: [snapshotOf(state), ...state.future].slice(0, HISTORY_LIMIT),
          interaction: null,
        };
      }),
    redo: () =>
      set((state) => {
        if (state.future.length === 0) return state;
        const next = state.future[0];
        return {
          roots: next.roots,
          components: next.components,
          selection: next.selection,
          past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
          interaction: null,
        };
      }),
  };
});
