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
import type { RNStyle } from "@rn-canvas/styles";
import type {
  ComponentDefinition,
  ComponentInstanceNode,
  ComponentProp,
  ComponentRegistry,
  ContainerNode,
  Node,
  NodeId,
  OverrideValue,
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
  const id = prefix + node.id;
  if (node.type === "ComponentInstance") {
    const definition = registry[node.componentId];
    if (!definition) {
      // Unresolved component → empty placeholder so layout never crashes.
      return { id, type: "View", props: {}, style: clone(node.style), children: [] };
    }
    return expand(applyOverrides(definition, node), registry, `${id}::`);
  }
  if (isContainer(node)) {
    return {
      ...node,
      id,
      children: node.children.map((child) => expand(child, registry, prefix)),
    } as Node;
  }
  return { ...node, id } as Node;
}

/** The top-level placed instance that owns an expanded node id (or null). */
export function ownerInstanceId(expandedId: NodeId): NodeId | null {
  const marker = expandedId.indexOf("::");
  return marker === -1 ? null : expandedId.slice(0, marker);
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
  return errors;
}
