/**
 * Zustand document store — the single source of truth at runtime. tldraw will
 * own frame *spatial* data and reference a root by id; this store owns the RN
 * trees. Undo/redo here is a thin snapshot history (BUILD Phase 6 polishes it;
 * tldraw history coordination happens when RNFrame lands).
 */
import { create } from "zustand";
import type { RNStyle } from "@rn-canvas/styles";
import type { AnyProps, DesignMeta, Node, NodeId } from "./types";
import {
  insertChild as opInsertChild,
  moveNode as opMoveNode,
  removeNode as opRemoveNode,
  reorderChild as opReorderChild,
  updateDesign as opUpdateDesign,
  updateProps as opUpdateProps,
  updateStyle as opUpdateStyle,
} from "./tree";

export type Roots = Record<NodeId, Node>;

/** A history entry snapshots both the tree and the selection, so undo/redo
 *  restores a coherent selection (no dangling selected-node after an undo). */
export interface Snapshot {
  roots: Roots;
  selection: NodeId[];
}

export interface DocumentState {
  roots: Roots;
  selection: NodeId[];
  past: Snapshot[];
  future: Snapshot[];

  setSelection(ids: NodeId[]): void;

  addRoot(root: Node): void;
  removeRoot(rootId: NodeId): void;

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
  /** Commit a new roots map, snapshotting the previous tree + selection for undo. */
  const commit = (next: Roots) => {
    set((state) => ({
      past: [...state.past, { roots: state.roots, selection: state.selection }].slice(
        -HISTORY_LIMIT,
      ),
      future: [],
      roots: next,
    }));
  };

  /** Run a pure op against one root and commit if it changed. */
  const mutateRoot = (rootId: NodeId, fn: (tree: Node) => Node) => {
    const { roots } = get();
    const tree = roots[rootId];
    if (!tree) throw new Error(`Root not found: ${rootId}`);
    const next = fn(tree);
    if (next === tree) return;
    commit({ ...roots, [rootId]: next });
  };

  return {
    roots: {},
    selection: [],
    past: [],
    future: [],

    setSelection: (ids) => set({ selection: ids }),

    addRoot: (root) => commit({ ...get().roots, [root.id]: root }),
    removeRoot: (rootId) => {
      const next = { ...get().roots };
      delete next[rootId];
      commit(next);
    },

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
          selection: previous.selection,
          past: state.past.slice(0, -1),
          future: [
            { roots: state.roots, selection: state.selection },
            ...state.future,
          ].slice(0, HISTORY_LIMIT),
        };
      }),
    redo: () =>
      set((state) => {
        if (state.future.length === 0) return state;
        const next = state.future[0];
        return {
          roots: next.roots,
          selection: next.selection,
          past: [...state.past, { roots: state.roots, selection: state.selection }].slice(
            -HISTORY_LIMIT,
          ),
          future: state.future.slice(1),
        };
      }),
  };
});
