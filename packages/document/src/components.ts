/**
 * Components & instances (Phase 2C) — the pure model layer.
 *
 * A `ComponentDefinition` is a reusable template subtree plus a typed prop
 * interface; a `ComponentInstanceNode` places it with per-instance overrides.
 * Instances are symbolic in the document; `expandComponents` resolves them into a
 * primitive tree for the renderer/canvas (codegen keeps them as JSX usages). This
 * file owns the contract every later slice builds on, so it stays free of React,
 * the store, and codegen.
 */
import { validateStyle, type RNStyle } from "@rn-canvas/styles";
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  ComponentProp,
  ComponentRegistry,
  ContainerNode,
  Node,
  NodeId,
  OverrideValue,
  VariantCombination,
} from "./types";
import { childrenOf, isContainer } from "./types";
import { validateTree, type NodeError } from "./validate";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9_$]*$/;
const VALUE_TYPES = new Set(["string", "number", "boolean", "color", "enum", "node"]);

function newId(): NodeId {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Structural deep clone — nodes are JSON by construction (sidecar relies on it). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Index every node in a tree by id, including slot children. */
function indexById(tree: Node, index = new Map<NodeId, Node>()): Map<NodeId, Node> {
  index.set(tree.id, tree);
  for (const child of childrenOf(tree)) indexById(child, index);
  if (tree.type === "ComponentInstance" && tree.slots) {
    for (const children of Object.values(tree.slots)) {
      for (const child of children) indexById(child, index);
    }
  }
  return index;
}

function collectIds(tree: Node, ids = new Set<NodeId>()): Set<NodeId> {
  ids.add(tree.id);
  for (const child of childrenOf(tree)) collectIds(child, ids);
  return ids;
}

// --- Authoring ---------------------------------------------------------------

/**
 * Turn a node into a reusable component: the template is a clone of `node`, with
 * no props exposed yet (exposure is a later authoring step). The returned instance
 * replaces `node` in its tree.
 */
export function promoteToComponent(
  node: Node,
  name: string,
): { definition: ComponentDefinition; instance: ComponentInstanceNode } {
  const definition: ComponentDefinition = {
    id: newId(),
    name,
    template: clone(node),
    props: [],
  };
  return { definition, instance: createInstance(definition.id) };
}

/** The four authoring presets over the general prop model (Phase 2C). */
export type PresetKind = "text" | "color" | "visibility" | "slot";

/** Build a `ComponentProp` for a preset bound to one template node. */
export function presetProp(
  name: string,
  kind: PresetKind,
  nodeId: NodeId,
  styleKey: "color" | "backgroundColor" = "color",
): ComponentProp {
  switch (kind) {
    case "text":
      return { name, valueType: "string", targets: [{ kind: "prop", nodeId, path: "text" }] };
    case "color":
      return { name, valueType: "color", targets: [{ kind: "style", nodeId, styleKey }] };
    case "visibility":
      return { name, valueType: "boolean", default: true, targets: [{ kind: "visibility", nodeId }] };
    case "slot":
      return { name, valueType: "node", targets: [{ kind: "slot", nodeId }] };
  }
}

/** A fresh instance of a component, with no overrides. */
export function createInstance(
  componentId: string,
  init: { id?: NodeId; style?: RNStyle } = {},
): ComponentInstanceNode {
  return {
    id: init.id ?? newId(),
    type: "ComponentInstance",
    componentId,
    overrides: {},
    style: init.style ?? {},
  };
}

// --- Variants -----------------------------------------------------------------

/**
 * The fully-resolved variant selection for an instance: each axis at its chosen
 * value, defaulting to the axis's first value. `{}` when the definition has no axes.
 */
export function resolveVariant(
  definition: ComponentDefinition,
  selection: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const axis of definition.variants ?? []) {
    if (axis.values.length === 0) continue;
    const chosen = selection?.[axis.name];
    result[axis.name] =
      chosen !== undefined && axis.values.includes(chosen) ? chosen : axis.values[0];
  }
  return result;
}

/** Find the stored combination matching a fully-resolved selection (exact on every
 *  axis). Combinations are sparse, so an un-overridden cell returns undefined. */
function matchCombination(
  combinations: VariantCombination[] | undefined,
  resolved: Record<string, string>,
): VariantCombination | undefined {
  const axes = Object.keys(resolved);
  return combinations?.find(
    (combo) =>
      Object.keys(combo.values).length === axes.length &&
      axes.every((axis) => combo.values[axis] === resolved[axis]),
  );
}

// --- Override resolution ------------------------------------------------------

function scalarMatches(prop: ComponentProp, value: OverrideValue): boolean {
  switch (prop.valueType) {
    case "string":
    case "color":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && !!prop.enumValues?.includes(value);
    case "node":
      return false; // node values live in slots, never overrides
  }
}

function applyScalar(host: Node, prop: ComponentProp, value: OverrideValue): void {
  for (const target of prop.targets) {
    if (target.kind === "prop") {
      if ("props" in host) {
        (host.props as Record<string, unknown>)[target.path] = value;
      }
    } else if (target.kind === "style") {
      (host.style as Record<string, unknown>)[target.styleKey] = value;
    } else if (target.kind === "visibility") {
      host.design = { ...host.design, hidden: !value };
    }
    // `slot` targets ignore scalar values.
  }
}

/**
 * Resolve a definition's template against an instance's overrides/slots, producing
 * a primitive subtree. Pure: clones the template, never mutates the inputs.
 */
export function applyOverrides(
  definition: ComponentDefinition,
  instance: ComponentInstanceNode,
): Node {
  const tree = clone(definition.template);
  const index = indexById(tree);

  // Variant pass: merge the active combination's per-node style/visibility patches
  // over the base template *before* scalar/slot props, so an explicit instance
  // override still wins over a variant default.
  if (definition.variants?.length) {
    const resolved = resolveVariant(definition, instance.variant);
    const combo = matchCombination(definition.combinations, resolved);
    for (const override of combo?.overrides ?? []) {
      const host = index.get(override.nodeId);
      if (!host) continue;
      if (override.style) host.style = { ...host.style, ...override.style };
      if (override.hidden !== undefined) {
        host.design = { ...host.design, hidden: override.hidden };
      }
    }
  }

  for (const prop of definition.props) {
    if (prop.valueType === "node") {
      const children = instance.slots?.[prop.name];
      if (!children) continue;
      for (const target of prop.targets) {
        if (target.kind !== "slot") continue;
        const host = index.get(target.nodeId);
        if (host && isContainer(host)) (host as ContainerNode).children = clone(children);
      }
      continue;
    }
    const value = instance.overrides[prop.name] ?? prop.default;
    if (value === undefined) continue;
    for (const target of prop.targets) {
      const host = index.get(target.nodeId);
      if (host) applyScalar(host, { ...prop, targets: [target] }, value);
    }
  }
  return tree;
}

// --- Expansion ---------------------------------------------------------------

/**
 * Replace every `ComponentInstance` in a tree with its resolved template. Inner
 * ids are namespaced `${instanceId}::${innerId}` so multiple placements of one
 * definition never collide and the layout snapshot stays uniquely keyed. Nested
 * instances expand recursively.
 */
export function expandComponents(node: Node, registry: ComponentRegistry): Node {
  return expand(node, registry, "");
}

function expand(node: Node, registry: ComponentRegistry, prefix: string): Node {
  if (node.type === "ComponentInstance") {
    const id = prefix + node.id;
    const definition = registry[node.componentId];
    if (!definition) {
      // Unresolved component → empty placeholder so layout never crashes.
      return { id, type: "View", props: {}, style: clone(node.style), children: [] };
    }
    return expand(applyOverrides(definition, node), registry, `${id}::`);
  }
  if (isContainer(node)) {
    // Identity-preserving: only clone the ancestor path of an actual expansion, so
    // an instance-free tree (the common case) returns the same node references and
    // the renderer keeps its per-box memoization.
    let changed = prefix !== "";
    const children = node.children.map((child) => {
      const expanded = expand(child, registry, prefix);
      if (expanded !== child) changed = true;
      return expanded;
    });
    if (!changed) return node;
    return { ...node, id: prefix + node.id, children } as Node;
  }
  return prefix ? ({ ...node, id: prefix + node.id } as Node) : node;
}

/** The top-level placed instance that owns an expanded node id (or null). */
export function ownerInstanceId(expandedId: NodeId): NodeId | null {
  const marker = expandedId.indexOf("::");
  return marker === -1 ? null : expandedId.slice(0, marker);
}

// --- Reconciliation (definition edits) --------------------------------------

/** Drop prop targets whose node no longer exists in the template, and any prop
 *  left with zero targets — keeps the definition consistent after a structural edit. */
export function pruneDefinitionProps(definition: ComponentDefinition): ComponentDefinition {
  const ids = collectIds(definition.template);
  let changed = false;
  const props = definition.props.flatMap((prop) => {
    const targets = prop.targets.filter((target) => ids.has(target.nodeId));
    if (targets.length === 0) {
      changed = true;
      return [];
    }
    if (targets.length !== prop.targets.length) {
      changed = true;
      return [{ ...prop, targets }];
    }
    return [prop];
  });
  return changed ? { ...definition, props } : definition;
}


/**
 * Drop variant combinations orphaned by an axis/value edit: a combination that no
 * longer specifies exactly the current axes with valid values, or whose overrides
 * all target removed nodes. Override targets are trimmed to existing template nodes.
 */
export function pruneVariants(definition: ComponentDefinition): ComponentDefinition {
  const axes = definition.variants ?? [];
  const combinations = definition.combinations ?? [];
  if (combinations.length === 0) return definition;
  if (axes.length === 0) return { ...definition, combinations: [] };

  const ids = collectIds(definition.template);
  let changed = false;
  const next = combinations.flatMap((combo) => {
    const keys = Object.keys(combo.values);
    const valid =
      keys.length === axes.length &&
      axes.every((axis) => axis.values.includes(combo.values[axis.name]));
    if (!valid) {
      changed = true;
      return [];
    }
    const overrides = combo.overrides.filter((override) => ids.has(override.nodeId));
    if (overrides.length === 0) {
      changed = true;
      return [];
    }
    if (overrides.length !== combo.overrides.length) {
      changed = true;
      return [{ ...combo, overrides }];
    }
    return [combo];
  });
  return changed ? { ...definition, combinations: next } : definition;
}

/** Drop an instance's overrides/slots whose prop no longer exists on the definition,
 *  and clamp `variant` selections to the definition's current axes/values. */
export function reconcileInstance(
  instance: ComponentInstanceNode,
  definition: ComponentDefinition,
): ComponentInstanceNode {
  const names = new Set(definition.props.map((prop) => prop.name));
  const overrideEntries = Object.entries(instance.overrides).filter(([name]) => names.has(name));
  const slotEntries = instance.slots
    ? Object.entries(instance.slots).filter(([name]) => names.has(name))
    : [];
  // Clamp variant selections to the definition's current axes/values.
  const axisByName = new Map((definition.variants ?? []).map((axis) => [axis.name, axis]));
  const variantEntries = instance.variant
    ? Object.entries(instance.variant).filter(([name, value]) => axisByName.get(name)?.values.includes(value))
    : [];
  const overridesChanged = overrideEntries.length !== Object.keys(instance.overrides).length;
  const slotsChanged = instance.slots
    ? slotEntries.length !== Object.keys(instance.slots).length
    : false;
  const variantChanged = instance.variant
    ? variantEntries.length !== Object.keys(instance.variant).length
    : false;
  if (!overridesChanged && !slotsChanged && !variantChanged) return instance;
  const next: ComponentInstanceNode = { ...instance, overrides: Object.fromEntries(overrideEntries) };
  if (instance.slots) {
    if (slotEntries.length > 0) next.slots = Object.fromEntries(slotEntries);
    else delete next.slots;
  }
  if (instance.variant) {
    if (variantEntries.length > 0) next.variant = Object.fromEntries(variantEntries);
    else delete next.variant;
  }
  return next;
}

/**
 * Reconcile every instance in a tree against the current registry, dropping
 * overrides/slots orphaned by a definition edit (e.g. a removed/renamed prop).
 * Identity-preserving: unchanged subtrees keep their references.
 */
export function reconcileOverrides(node: Node, registry: ComponentRegistry): Node {
  if (node.type === "ComponentInstance") {
    const definition = registry[node.componentId];
    let next = definition ? reconcileInstance(node, definition) : node;
    if (next.slots) {
      let slotsChanged = false;
      const slots = Object.fromEntries(
        Object.entries(next.slots).map(([name, kids]) => {
          let childChanged = false;
          const reconciled = kids.map((kid) => {
            const r = reconcileOverrides(kid, registry);
            if (r !== kid) childChanged = true;
            return r;
          });
          if (childChanged) slotsChanged = true;
          return [name, childChanged ? reconciled : kids];
        }),
      );
      if (slotsChanged) next = { ...next, slots };
    }
    return next;
  }
  if (isContainer(node)) {
    let changed = false;
    const children = node.children.map((child) => {
      const reconciled = reconcileOverrides(child, registry);
      if (reconciled !== child) changed = true;
      return reconciled;
    });
    return changed ? ({ ...node, children } as Node) : node;
  }
  return node;
}

// --- Validation --------------------------------------------------------------

function defaultMatches(prop: ComponentProp): boolean {
  if (prop.default === undefined) return true;
  if (prop.valueType === "node") return false; // node props take no scalar default
  return scalarMatches(prop, prop.default);
}

/** Validate the whole registry: definition names, templates, and prop bindings. */
export function validateComponentRegistry(registry: ComponentRegistry): NodeError[] {
  const errors: NodeError[] = [];
  for (const [id, definition] of Object.entries(registry)) {
    if (definition.id !== id) {
      errors.push({ nodeId: id, key: "id", reason: "registry key must equal definition id" });
    }
    if (!PASCAL_CASE.test(definition.name)) {
      errors.push({ nodeId: id, key: "name", reason: "expected a PascalCase component name" });
    }
    for (const e of validateTree(definition.template)) {
      errors.push({ nodeId: id, key: `template.${e.key}`, reason: e.reason });
    }
    const templateIds = collectIds(definition.template);
    const seen = new Set<string>();
    for (const prop of definition.props) {
      const key = `props.${prop.name}`;
      if (!IDENTIFIER.test(prop.name)) {
        errors.push({ nodeId: id, key, reason: "prop name must be a JS identifier" });
      }
      if (seen.has(prop.name)) {
        errors.push({ nodeId: id, key, reason: "duplicate prop name" });
      }
      seen.add(prop.name);
      if (!VALUE_TYPES.has(prop.valueType)) {
        errors.push({ nodeId: id, key: `${key}.valueType`, reason: "unknown value type" });
      }
      const hasEnumValues = Array.isArray(prop.enumValues) && prop.enumValues.length > 0;
      if ((prop.valueType === "enum") !== hasEnumValues) {
        errors.push({ nodeId: id, key: `${key}.enumValues`, reason: "enum requires enumValues; others omit them" });
      }
      if (!Array.isArray(prop.targets) || prop.targets.length === 0) {
        errors.push({ nodeId: id, key: `${key}.targets`, reason: "at least one target required" });
      } else {
        for (const target of prop.targets) {
          if (!templateIds.has(target.nodeId)) {
            errors.push({ nodeId: id, key: `${key}.targets`, reason: `target not in template: ${target.nodeId}` });
          }
        }
      }
      if (!defaultMatches(prop)) {
        errors.push({ nodeId: id, key: `${key}.default`, reason: `default must be a ${prop.valueType}` });
      }
    }

    // Variant axes — each emitted as a typed enum prop, so the same name rules
    // apply and an axis must not collide with an exposed prop.
    const axes = definition.variants ?? [];
    const axisNames = new Set<string>();
    for (const axis of axes) {
      const akey = `variants.${axis.name}`;
      if (!IDENTIFIER.test(axis.name)) {
        errors.push({ nodeId: id, key: akey, reason: "axis name must be a JS identifier" });
      }
      if (axisNames.has(axis.name) || seen.has(axis.name)) {
        errors.push({ nodeId: id, key: akey, reason: "axis name collides with another axis or prop" });
      }
      axisNames.add(axis.name);
      if (!Array.isArray(axis.values) || axis.values.length === 0) {
        errors.push({ nodeId: id, key: `${akey}.values`, reason: "axis needs at least one value" });
      } else {
        const valueSet = new Set<string>();
        for (const value of axis.values) {
          if (typeof value !== "string" || value.length === 0) {
            errors.push({ nodeId: id, key: `${akey}.values`, reason: "value must be a non-empty string" });
          } else if (valueSet.has(value)) {
            errors.push({ nodeId: id, key: `${akey}.values`, reason: `duplicate value: ${value}` });
          }
          if (typeof value === "string") valueSet.add(value);
        }
      }
    }

    // Combinations — each must specify every axis once with a valid value, be
    // unique, and only patch existing template nodes with valid styles.
    const comboSeen = new Set<string>();
    for (const combo of definition.combinations ?? []) {
      const ckey = "combinations";
      const keys = Object.keys(combo.values);
      if (keys.length !== axes.length || !keys.every((k) => axisNames.has(k))) {
        errors.push({ nodeId: id, key: ckey, reason: "combination must specify every axis exactly once" });
      }
      for (const axis of axes) {
        const value = combo.values[axis.name];
        if (value !== undefined && !axis.values.includes(value)) {
          errors.push({ nodeId: id, key: ckey, reason: `invalid value '${value}' for axis ${axis.name}` });
        }
      }
      const signature = JSON.stringify(axes.map((axis) => combo.values[axis.name]));
      if (comboSeen.has(signature)) {
        errors.push({ nodeId: id, key: ckey, reason: "duplicate combination" });
      }
      comboSeen.add(signature);
      for (const override of combo.overrides ?? []) {
        if (!templateIds.has(override.nodeId)) {
          errors.push({ nodeId: id, key: ckey, reason: `override target not in template: ${override.nodeId}` });
        }
        if (override.style && !validateStyle(override.style).ok) {
          errors.push({ nodeId: id, key: ckey, reason: "invalid variant style override" });
        }
      }
    }
  }
  return errors;
}

/** Validate one instance against the registry it references (names + value types). */
export function validateInstance(
  instance: ComponentInstanceNode,
  registry: ComponentRegistry,
): NodeError[] {
  const errors: NodeError[] = [];
  const definition = registry[instance.componentId];
  if (!definition) {
    errors.push({ nodeId: instance.id, key: "componentId", reason: `unknown component: ${instance.componentId}` });
    return errors;
  }
  const byName = new Map(definition.props.map((prop) => [prop.name, prop]));
  for (const [name, value] of Object.entries(instance.overrides ?? {})) {
    const prop = byName.get(name);
    if (!prop) {
      errors.push({ nodeId: instance.id, key: `overrides.${name}`, reason: "no matching prop" });
    } else if (prop.valueType === "node") {
      errors.push({ nodeId: instance.id, key: `overrides.${name}`, reason: "node-prop value belongs in slots" });
    } else if (!scalarMatches(prop, value)) {
      errors.push({ nodeId: instance.id, key: `overrides.${name}`, reason: `expected a ${prop.valueType}` });
    }
  }
  for (const name of Object.keys(instance.slots ?? {})) {
    const prop = byName.get(name);
    if (!prop || prop.valueType !== "node") {
      errors.push({ nodeId: instance.id, key: `slots.${name}`, reason: "no matching slot prop" });
    }
  }
  const axisByName = new Map((definition.variants ?? []).map((axis) => [axis.name, axis]));
  for (const [name, value] of Object.entries(instance.variant ?? {})) {
    const axis = axisByName.get(name);
    if (!axis) {
      errors.push({ nodeId: instance.id, key: `variant.${name}`, reason: "no matching variant axis" });
    } else if (!axis.values.includes(value)) {
      errors.push({ nodeId: instance.id, key: `variant.${name}`, reason: `not a value of axis ${name}` });
    }
  }
  return errors;
}
