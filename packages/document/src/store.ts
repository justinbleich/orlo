/**
 * Zustand document store — the in-memory editing truth for the currently opened
 * Canvas projection. tldraw owns frame *spatial* data and references roots by id;
 * this store owns the projected RN trees, components, and tokens while the
 * object is being edited. Durable truth lives in source files on the active Git
 * branch/worktree, with sidecars acting as optional projection metadata.
 */
import { create } from "zustand";
import type { RNStyle } from "@rn-canvas/styles";
import type {
  AnyProps,
  ComponentDefinition,
  ComponentRegistry,
  DesignMeta,
  DesignToken,
  Node,
  NodeId,
  OverrideValue,
  TokenCategory,
  TokenRegistry,
} from "./types";
import { isContainer } from "./types";
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
  pruneDefinitionProps,
  pruneVariants,
  upsertVariantOverride,
  reconcileOverrides,
  validateComponentRegistry,
  validateInstance,
} from "./components";
import { reapplyTokens, tokenCategoryForStyleKey, validateTokenRegistry } from "./tokens";

export type Roots = Record<NodeId, Node>;

/** A history entry snapshots the trees, the component registry, and the selection,
 *  so undo/redo restores a coherent document (no dangling selection or definition). */
export interface Snapshot {
  roots: Roots;
  components: ComponentRegistry;
  /** Design tokens, keyed by id (Phase 2D). */
  tokens: TokenRegistry;
  /** The component whose template is open for editing (hosted as a transient root). */
  editingComponentId: NodeId | null;
  /** Definition captured at edit-start, so Cancel can discard the session. */
  editingOriginalDefinition: ComponentDefinition | null;
  selection: NodeId[];
}

export interface DocumentState {
  roots: Roots;
  /** Reusable component definitions, keyed by id (Phase 2C). Not per-frame. */
  components: ComponentRegistry;
  /** Design tokens, keyed by id (Phase 2D). Global, like components. */
  tokens: TokenRegistry;
  /** Component whose template is open in focus mode (its template is a transient root). */
  editingComponentId: NodeId | null;
  /** Definition captured when focus mode opened, for Cancel. */
  editingOriginalDefinition: ComponentDefinition | null;
  selection: NodeId[];
  past: Snapshot[];
  future: Snapshot[];
  interaction: Snapshot | null;

  setSelection(ids: NodeId[]): void;
  beginInteraction(): void;
  commitInteraction(): void;
  cancelInteraction(): void;

  /** Replace the open projection atomically. Opening a new object starts a fresh
   *  undo history rather than mixing edit sessions. */
  loadRoots(
    roots: Roots,
    selection?: NodeId[],
    components?: ComponentRegistry,
    tokens?: TokenRegistry,
  ): void;

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
  /** Open a component's template for editing (hosted as a transient root). */
  beginComponentEdit(componentId: NodeId): void;
  /** Close focus mode; `commit` writes the edited template back to the definition. */
  endComponentEdit(commit?: boolean): void;

  // --- Variants (Phase 2D-3) ---
  addVariantAxis(componentId: NodeId, name: string, values?: string[]): void;
  removeVariantAxis(componentId: NodeId, name: string): void;
  addVariantValue(componentId: NodeId, axisName: string, value: string): void;
  removeVariantValue(componentId: NodeId, axisName: string, value: string): void;
  /** Set/clear a node's per-combination style/visibility override. A style value of
   *  `undefined` clears that key; `hidden: null` clears the visibility flag. */
  setVariantOverride(
    componentId: NodeId,
    combination: Record<string, string>,
    nodeId: NodeId,
    patch: { style?: Record<string, unknown>; hidden?: boolean | null },
  ): void;
  /** Choose an instance's value for one axis. */
  setInstanceVariant(rootId: NodeId, instanceId: NodeId, axisName: string, value: string): void;

  // --- Design tokens (Phase 2D) ---
  addToken(token: DesignToken): void;
  updateToken(tokenId: NodeId, partial: Partial<DesignToken>): void;
  removeToken(tokenId: NodeId): void;
  /** Link a node's style key to a token: records the link + resolves the literal. */
  linkStyleToken(rootId: NodeId, nodeId: NodeId, styleKey: string, tokenId: NodeId): void;
  /** Drop a style key's token link, keeping the last resolved literal. */
  unlinkStyleToken(rootId: NodeId, nodeId: NodeId, styleKey: string): void;
  /** Create a new token from the node's current literal value AND link the style key
   *  to it, in one atomic step. Returns the new token id. */
  promoteStyleToToken(rootId: NodeId, nodeId: NodeId, styleKey: string, name: string): NodeId;
  /** Move `tokenId` so its registry insertion order comes immediately before
   *  `beforeId`, or to the end when `beforeId` is null. Only reorders within the
   *  same category — cross-category drags throw. */
  reorderToken(tokenId: NodeId, beforeId: NodeId | null): void;
  /** Link an instance's scalar override to a token. */
  linkInstanceToken(rootId: NodeId, instanceId: NodeId, propName: string, tokenId: NodeId): void;
  /** Drop an instance override's token link, keeping the last resolved value. */
  unlinkInstanceToken(rootId: NodeId, instanceId: NodeId, propName: string): void;
  /** Create a token from the instance's current override value AND link the
   *  override to it. Returns the new token id. */
  promoteInstanceOverrideToToken(
    rootId: NodeId,
    instanceId: NodeId,
    propName: string,
    category: TokenCategory,
    name: string,
  ): NodeId;
  /** Every link to `tokenId` — style links AND instance-override links. `kind`
   *  distinguishes the two; `styleKey` holds the style key or override prop name. */
  getTokenUsage(tokenId: NodeId): {
    rootId: NodeId;
    nodeId: NodeId;
    styleKey: string;
    kind: "style" | "override";
  }[];

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
    tokens: state.tokens,
    editingComponentId: state.editingComponentId,
    editingOriginalDefinition: state.editingOriginalDefinition,
    selection: state.selection,
  });

  /** Commit new roots/registry/tokens, snapshotting the prior document for undo. */
  const commit = (next: {
    roots?: Roots;
    components?: ComponentRegistry;
    tokens?: TokenRegistry;
  }) => {
    set((state) => ({
      past: state.interaction
        ? state.past
        : [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
      future: [],
      roots: next.roots ?? state.roots,
      components: next.components ?? state.components,
      tokens: next.tokens ?? state.tokens,
    }));
  };

  /**
   * Commit a token-registry change, re-resolving every token-bound style literal
   * across roots and component templates (and dropping bindings to removed tokens).
   * Validates the registry before committing.
   */
  const commitTokens = (tokens: TokenRegistry) => {
    const errors = validateTokenRegistry(tokens);
    if (errors.length > 0) {
      const first = errors[0];
      throw new Error(`Invalid token: ${first.key} ${first.reason}`);
    }
    const { roots, components } = get();
    const reconciledRoots: Roots = {};
    for (const [id, root] of Object.entries(roots)) {
      reconciledRoots[id] = reapplyTokens(root, tokens);
    }
    const reconciledComponents: ComponentRegistry = {};
    for (const [id, def] of Object.entries(components)) {
      reconciledComponents[id] = { ...def, template: reapplyTokens(def.template, tokens) };
    }
    commit({ roots: reconciledRoots, components: reconciledComponents, tokens });
  };

  /**
   * Commit a registry change, keeping the whole document consistent: prune each
   * definition's dangling prop targets, then reconcile every instance (in roots
   * and in component templates) so orphaned overrides are dropped. Validates the
   * pruned registry before committing.
   */
  const commitRegistry = (components: ComponentRegistry, roots: Roots) => {
    const pruned: ComponentRegistry = {};
    for (const [id, def] of Object.entries(components)) {
      pruned[id] = pruneVariants(pruneDefinitionProps(def));
    }
    const errors = validateComponentRegistry(pruned);
    if (errors.length > 0) {
      const first = errors[0];
      throw new Error(`Invalid component: ${first.key} ${first.reason}`);
    }
    const reconciledComponents: ComponentRegistry = {};
    for (const [id, def] of Object.entries(pruned)) {
      reconciledComponents[id] = { ...def, template: reconcileOverrides(def.template, pruned) };
    }
    const reconciledRoots: Roots = {};
    for (const [id, root] of Object.entries(roots)) {
      reconciledRoots[id] = reconcileOverrides(root, pruned);
    }
    commit({ roots: reconciledRoots, components: reconciledComponents });
  };

  /** Run a pure op against one root and commit if it changed. While a component is
   *  open in focus mode, its transient root mirrors live into the definition's
   *  template, so instances re-expand immediately and prop edits validate. */
  const mutateRoot = (rootId: NodeId, fn: (tree: Node) => Node) => {
    const { roots, components, editingComponentId } = get();
    const tree = roots[rootId];
    if (!tree) throw new Error(`Root not found: ${rootId}`);
    const next = fn(tree);
    if (next === tree) return;
    if (rootId === editingComponentId && components[rootId]) {
      commit({
        roots: { ...roots, [rootId]: next },
        components: { ...components, [rootId]: { ...components[rootId], template: next } },
      });
    } else {
      commit({ roots: { ...roots, [rootId]: next } });
    }
  };

  return {
    roots: {},
    components: {},
    tokens: {},
    editingComponentId: null,
    editingOriginalDefinition: null,
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
        state.components !== state.interaction.components ||
        state.tokens !== state.interaction.tokens;
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
        tokens: state.interaction.tokens,
        editingComponentId: state.interaction.editingComponentId,
        editingOriginalDefinition: state.interaction.editingOriginalDefinition,
        selection: state.interaction.selection,
        interaction: null,
      });
    },

    loadRoots: (roots, selection, components, tokens) => {
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
      const tokenRegistry = tokens ?? {};
      const tokenErrors = validateTokenRegistry(tokenRegistry);
      if (tokenErrors.length > 0) {
        const first = tokenErrors[0];
        throw new Error(`Invalid token registry: ${first.key} ${first.reason}`);
      }
      const nextSelection = selection ?? Object.keys(roots).slice(0, 1);
      set({
        roots,
        components: registry,
        tokens: tokenRegistry,
        editingComponentId: null,
        editingOriginalDefinition: null,
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
      commit({ roots: { ...get().roots, [root.id]: root } });
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
      const { components, roots } = get();
      const current = components[componentId];
      if (!current) throw new Error(`Component not found: ${componentId}`);
      const updated: ComponentDefinition = { ...current, ...partial, id: componentId };
      commitRegistry({ ...components, [componentId]: updated }, roots);
    },

    removeComponent: (componentId) => {
      const next = { ...get().components };
      delete next[componentId];
      commitRegistry(next, get().roots);
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

    beginComponentEdit: (componentId) => {
      const { components, roots, editingComponentId } = get();
      if (editingComponentId) return; // one component edited at a time
      const definition = components[componentId];
      if (!definition) throw new Error(`Component not found: ${componentId}`);
      // Host the template as a transient root keyed by the component id, and point
      // the definition's template at that same tree so the two stay in lockstep —
      // edits mirror through mutateRoot, instances re-expand live, and prop edits
      // validate against the live template.
      const template = JSON.parse(JSON.stringify(definition.template)) as Node;
      const editingRoot = { ...template, id: componentId } as Node;
      commit({
        roots: { ...roots, [componentId]: editingRoot },
        components: { ...components, [componentId]: { ...definition, template: editingRoot } },
      });
      set({
        editingComponentId: componentId,
        editingOriginalDefinition: definition,
        selection: [componentId],
      });
    },

    endComponentEdit: (commitEdit = true) => {
      const { editingComponentId, roots, components, editingOriginalDefinition } = get();
      if (!editingComponentId) return;
      const id = editingComponentId;
      const nextRoots = { ...roots };
      delete nextRoots[id];
      // The template was mirrored live; Cancel restores the captured definition.
      const nextComponents =
        commitEdit || !editingOriginalDefinition
          ? components
          : { ...components, [id]: editingOriginalDefinition };
      // Reconcile so any structural edit's dropped props clear orphaned overrides.
      commitRegistry(nextComponents, nextRoots);
      const fallback =
        Object.values(nextRoots).find((root) => !!findNode(root, id))?.id ??
        Object.keys(nextRoots)[0];
      set({
        editingComponentId: null,
        editingOriginalDefinition: null,
        selection: fallback ? [fallback] : [],
      });
    },

    // --- Variants (Phase 2D-3) ---
    addVariantAxis: (componentId, name, values = []) => {
      const { components, roots } = get();
      const def = components[componentId];
      if (!def) throw new Error(`Component not found: ${componentId}`);
      // Seeded values (from a preset) make this a ready axis in one step; an
      // empty list is a draft — its first added value becomes the base/default.
      const variants = [...(def.variants ?? []), { name, values }];
      commitRegistry({ ...components, [componentId]: { ...def, variants } }, roots);
    },
    removeVariantAxis: (componentId, name) => {
      const { components, roots } = get();
      const def = components[componentId];
      if (!def) throw new Error(`Component not found: ${componentId}`);
      const variants = (def.variants ?? []).filter((axis) => axis.name !== name);
      // pruneVariants (in commitRegistry) drops combinations that referenced the axis.
      commitRegistry({ ...components, [componentId]: { ...def, variants } }, roots);
    },
    addVariantValue: (componentId, axisName, value) => {
      const { components, roots } = get();
      const def = components[componentId];
      if (!def) throw new Error(`Component not found: ${componentId}`);
      const variants = (def.variants ?? []).map((axis) =>
        axis.name === axisName ? { ...axis, values: [...axis.values, value] } : axis,
      );
      commitRegistry({ ...components, [componentId]: { ...def, variants } }, roots);
    },
    removeVariantValue: (componentId, axisName, value) => {
      const { components, roots } = get();
      const def = components[componentId];
      if (!def) throw new Error(`Component not found: ${componentId}`);
      const variants = (def.variants ?? []).map((axis) =>
        axis.name === axisName ? { ...axis, values: axis.values.filter((v) => v !== value) } : axis,
      );
      commitRegistry({ ...components, [componentId]: { ...def, variants } }, roots);
    },
    setVariantOverride: (componentId, combination, nodeId, patch) => {
      const { components, roots } = get();
      const def = components[componentId];
      if (!def) throw new Error(`Component not found: ${componentId}`);
      const next = upsertVariantOverride(def, combination, nodeId, patch);
      commitRegistry({ ...components, [componentId]: next }, roots);
    },
    setInstanceVariant: (rootId, instanceId, axisName, value) =>
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, instanceId);
        if (!node || node.type !== "ComponentInstance") {
          throw new Error(`Instance not found: ${instanceId}`);
        }
        const nextInstance = { ...node, variant: { ...node.variant, [axisName]: value } };
        const errors = validateInstance(nextInstance, get().components);
        if (errors.length > 0) throw new Error(`Invalid variant: ${errors[0].reason}`);
        return replaceNode(tree, instanceId, nextInstance);
      }),

    addToken: (token) => {
      commitTokens({ ...get().tokens, [token.id]: token });
    },
    updateToken: (tokenId, partial) => {
      const { tokens } = get();
      const current = tokens[tokenId];
      if (!current) throw new Error(`Token not found: ${tokenId}`);
      commitTokens({ ...tokens, [tokenId]: { ...current, ...partial, id: tokenId } });
    },
    removeToken: (tokenId) => {
      const next = { ...get().tokens };
      delete next[tokenId];
      // commitTokens reapplies, dropping every binding to the removed token.
      commitTokens(next);
    },
    linkStyleToken: (rootId, nodeId, styleKey, tokenId) => {
      const token = get().tokens[tokenId];
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        const withValue = opUpdateStyle(tree, nodeId, { [styleKey]: token.value });
        const linked = findNode(withValue, nodeId);
        const tokens = { ...(linked?.design?.tokens ?? {}), [styleKey]: tokenId };
        return opUpdateDesign(withValue, nodeId, { tokens });
      });
    },
    unlinkStyleToken: (rootId, nodeId, styleKey) => {
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, nodeId);
        const current = node?.design?.tokens;
        if (!current || !(styleKey in current)) return tree;
        const tokens = { ...current };
        delete tokens[styleKey];
        return opUpdateDesign(tree, nodeId, {
          tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
        });
      });
    },
    promoteStyleToToken: (rootId, nodeId, styleKey, name) => {
      const tree = get().roots[rootId];
      if (!tree) throw new Error(`Root not found: ${rootId}`);
      const node = findNode(tree, nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const literal = (node.style as Record<string, unknown>)[styleKey];
      const category = tokenCategoryForStyleKey(styleKey);
      if (!category) throw new Error(`Style key ${styleKey} is not tokenizable`);
      if (literal === undefined || literal === null) {
        throw new Error(`No literal value at ${styleKey} to promote`);
      }
      const id = crypto.randomUUID();
      const token: DesignToken = {
        id,
        name,
        category,
        value: literal as DesignToken["value"],
      };
      // Compose addToken + linkStyleToken atomically so undo restores both at once.
      const nextTokens = { ...get().tokens, [id]: token };
      const tokenErrors = validateTokenRegistry(nextTokens);
      if (tokenErrors.length > 0) {
        const first = tokenErrors[0];
        throw new Error(`Invalid token: ${first.key} ${first.reason}`);
      }
      const withValue = opUpdateStyle(tree, nodeId, { [styleKey]: literal as never });
      const linked = findNode(withValue, nodeId);
      const tokens = { ...(linked?.design?.tokens ?? {}), [styleKey]: id };
      const nextRoot = opUpdateDesign(withValue, nodeId, { tokens });
      const { roots, components, editingComponentId } = get();
      const reconciledRoots: Roots = {};
      for (const [rid, root] of Object.entries(roots)) {
        const seed = rid === rootId ? nextRoot : root;
        reconciledRoots[rid] = reapplyTokens(seed, nextTokens);
      }
      const reconciledComponents: ComponentRegistry = {};
      for (const [cid, def] of Object.entries(components)) {
        const template =
          cid === editingComponentId && reconciledRoots[cid] ? reconciledRoots[cid] : def.template;
        reconciledComponents[cid] = { ...def, template: reapplyTokens(template, nextTokens) };
      }
      commit({ roots: reconciledRoots, components: reconciledComponents, tokens: nextTokens });
      return id;
    },
    reorderToken: (tokenId, beforeId) => {
      const { tokens } = get();
      const token = tokens[tokenId];
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      if (beforeId !== null) {
        const target = tokens[beforeId];
        if (!target) throw new Error(`Token not found: ${beforeId}`);
        if (target.category !== token.category) {
          throw new Error("Cannot reorder across categories");
        }
        if (beforeId === tokenId) return;
      }
      // Rebuild the registry object so iteration order matches the new layout. We
      // only reshuffle within the same category — other categories keep their order.
      const ids = Object.keys(tokens);
      const withoutMoved = ids.filter((id) => id !== tokenId);
      let insertAt: number;
      if (beforeId === null) {
        // Move to the end of this category (= just after the last token of the same
        // category). Other categories' tokens stay where they were.
        const lastSameCat = withoutMoved
          .map((id, i) => (tokens[id].category === token.category ? i : -1))
          .reduce((max, i) => Math.max(max, i), -1);
        insertAt = lastSameCat + 1;
      } else {
        insertAt = withoutMoved.indexOf(beforeId);
      }
      const orderedIds = [
        ...withoutMoved.slice(0, insertAt),
        tokenId,
        ...withoutMoved.slice(insertAt),
      ];
      const next: TokenRegistry = {};
      for (const id of orderedIds) next[id] = tokens[id];
      // No reapply needed — values are unchanged. Commit directly so undo captures it.
      commit({ tokens: next });
    },
    linkInstanceToken: (rootId, instanceId, propName, tokenId) => {
      const token = get().tokens[tokenId];
      if (!token) throw new Error(`Token not found: ${tokenId}`);
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, instanceId);
        if (!node || node.type !== "ComponentInstance") {
          throw new Error(`Instance not found: ${instanceId}`);
        }
        const nextInstance = {
          ...node,
          overrides: { ...node.overrides, [propName]: token.value as OverrideValue },
          tokens: { ...(node.tokens ?? {}), [propName]: tokenId },
        };
        return replaceNode(tree, instanceId, nextInstance);
      });
    },
    unlinkInstanceToken: (rootId, instanceId, propName) => {
      mutateRoot(rootId, (tree) => {
        const node = findNode(tree, instanceId);
        if (!node || node.type !== "ComponentInstance") return tree;
        const current = node.tokens;
        if (!current || !(propName in current)) return tree;
        const tokens = { ...current };
        delete tokens[propName];
        const nextInstance = { ...node } as typeof node;
        if (Object.keys(tokens).length > 0) nextInstance.tokens = tokens;
        else delete nextInstance.tokens;
        return replaceNode(tree, instanceId, nextInstance);
      });
    },
    promoteInstanceOverrideToToken: (rootId, instanceId, propName, category, name) => {
      const tree = get().roots[rootId];
      if (!tree) throw new Error(`Root not found: ${rootId}`);
      const node = findNode(tree, instanceId);
      if (!node || node.type !== "ComponentInstance") {
        throw new Error(`Instance not found: ${instanceId}`);
      }
      const literal = node.overrides[propName];
      if (literal === undefined || literal === null) {
        throw new Error(`No override value at ${propName} to promote`);
      }
      const id = crypto.randomUUID();
      const token: DesignToken = { id, name, category, value: literal as DesignToken["value"] };
      const nextTokens = { ...get().tokens, [id]: token };
      const tokenErrors = validateTokenRegistry(nextTokens);
      if (tokenErrors.length > 0) {
        const first = tokenErrors[0];
        throw new Error(`Invalid token: ${first.key} ${first.reason}`);
      }
      const nextInstance = {
        ...node,
        overrides: { ...node.overrides, [propName]: literal },
        tokens: { ...(node.tokens ?? {}), [propName]: id },
      };
      const nextRoot = replaceNode(tree, instanceId, nextInstance);
      const { roots, components, editingComponentId } = get();
      const reconciledRoots: Roots = {};
      for (const [rid, root] of Object.entries(roots)) {
        const seed = rid === rootId ? nextRoot : root;
        reconciledRoots[rid] = reapplyTokens(seed, nextTokens);
      }
      const reconciledComponents: ComponentRegistry = {};
      for (const [cid, def] of Object.entries(components)) {
        const template =
          cid === editingComponentId && reconciledRoots[cid] ? reconciledRoots[cid] : def.template;
        reconciledComponents[cid] = { ...def, template: reapplyTokens(template, nextTokens) };
      }
      commit({ roots: reconciledRoots, components: reconciledComponents, tokens: nextTokens });
      return id;
    },
    getTokenUsage: (tokenId) => {
      const out: { rootId: NodeId; nodeId: NodeId; styleKey: string; kind: "style" | "override" }[] = [];
      const { roots } = get();
      const walk = (rootId: NodeId, node: Node) => {
        const styleBindings = node.design?.tokens;
        if (styleBindings) {
          for (const [key, id] of Object.entries(styleBindings)) {
            if (id === tokenId) out.push({ rootId, nodeId: node.id, styleKey: key, kind: "style" });
          }
        }
        if (node.type === "ComponentInstance") {
          const overrideBindings = node.tokens;
          if (overrideBindings) {
            for (const [key, id] of Object.entries(overrideBindings)) {
              if (id === tokenId) {
                out.push({ rootId, nodeId: node.id, styleKey: key, kind: "override" });
              }
            }
          }
          if (node.slots) {
            for (const kids of Object.values(node.slots)) {
              for (const kid of kids) walk(rootId, kid);
            }
          }
        } else if (isContainer(node)) {
          for (const child of node.children) walk(rootId, child);
        }
      };
      for (const [rootId, root] of Object.entries(roots)) walk(rootId, root);
      return out;
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
          components: previous.components,
          tokens: previous.tokens,
          editingComponentId: previous.editingComponentId,
          editingOriginalDefinition: previous.editingOriginalDefinition,
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
          tokens: next.tokens,
          editingComponentId: next.editingComponentId,
          editingOriginalDefinition: next.editingOriginalDefinition,
          selection: next.selection,
          past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
          interaction: null,
        };
      }),
  };
});
