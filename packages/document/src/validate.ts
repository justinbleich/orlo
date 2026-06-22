/**
 * Node-level validation at the model boundary. Style validation is delegated to
 * `packages/styles` (the single authority); this file owns props + structure.
 */
import { validateStyle } from "@rn-canvas/styles";
import type { DesignMeta, Node, NodeId, RNPrimitive } from "./types";
import { RN_PRIMITIVES, canHaveChildren } from "./types";

export interface PropError {
  key: string;
  reason: string;
}
export interface NodeError {
  nodeId: NodeId;
  key: string;
  reason: string;
}

const RESIZE_MODES = new Set(["cover", "contain", "stretch", "center", "repeat"]);
const KEYBOARD_TYPES = new Set(["default", "numeric", "email-address", "phone-pad"]);
const PRIMITIVE_SET = new Set<string>(RN_PRIMITIVES);
const PROP_KEYS: Record<RNPrimitive, ReadonlySet<string>> = {
  View: new Set(),
  Text: new Set(["text", "numberOfLines"]),
  Image: new Set(["source", "resizeMode"]),
  Pressable: new Set(["disabled"]),
  ScrollView: new Set(["horizontal", "showsScrollIndicator"]),
  TextInput: new Set([
    "placeholder",
    "value",
    "secureTextEntry",
    "editable",
    "keyboardType",
  ]),
  FlatList: new Set(["data", "horizontal"]),
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRNPrimitive(value: unknown): value is RNPrimitive {
  return typeof value === "string" && PRIMITIVE_SET.has(value);
}

function validateOptionalBoolean(
  props: Record<string, unknown>,
  key: string,
  errors: PropError[],
) {
  if (props[key] !== undefined && typeof props[key] !== "boolean") {
    errors.push({ key, reason: "expected a boolean" });
  }
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

/** Validate a primitive's props. Pure; returns per-key errors (no nodeId). */
export function validateProps(type: RNPrimitive, props: unknown): PropError[] {
  if (!isPlainObject(props)) {
    return [{ key: "(props)", reason: "expected a props object" }];
  }
  const errors: PropError[] = [];
  for (const key of Object.keys(props)) {
    if (!PROP_KEYS[type].has(key)) {
      errors.push({ key, reason: `unknown ${type} prop` });
    }
  }

  switch (type) {
    case "Text": {
      if (typeof props.text !== "string") {
        errors.push({ key: "text", reason: "Text requires a string `text`" });
      }
      if (
        props.numberOfLines !== undefined &&
        (!Number.isInteger(props.numberOfLines) || (props.numberOfLines as number) < 0)
      ) {
        errors.push({ key: "numberOfLines", reason: "expected a non-negative integer" });
      }
      break;
    }
    case "Image": {
      const src = props.source;
      const ok =
        isPlainObject(src) &&
        Object.keys(src).length === 1 &&
        ((typeof src.uri === "string") !== (typeof src.require === "string"));
      if (!ok) {
        errors.push({ key: "source", reason: "Image requires { uri } or { require }" });
      }
      if (props.resizeMode !== undefined && !RESIZE_MODES.has(props.resizeMode as string)) {
        errors.push({ key: "resizeMode", reason: `expected one of: ${[...RESIZE_MODES].join(", ")}` });
      }
      break;
    }
    case "Pressable":
      validateOptionalBoolean(props, "disabled", errors);
      break;
    case "ScrollView":
      validateOptionalBoolean(props, "horizontal", errors);
      validateOptionalBoolean(props, "showsScrollIndicator", errors);
      break;
    case "TextInput": {
      if (props.placeholder !== undefined && typeof props.placeholder !== "string") {
        errors.push({ key: "placeholder", reason: "expected a string" });
      }
      if (props.value !== undefined && typeof props.value !== "string") {
        errors.push({ key: "value", reason: "expected a string" });
      }
      validateOptionalBoolean(props, "secureTextEntry", errors);
      validateOptionalBoolean(props, "editable", errors);
      if (
        props.keyboardType !== undefined &&
        !KEYBOARD_TYPES.has(props.keyboardType as string)
      ) {
        errors.push({ key: "keyboardType", reason: `expected one of: ${[...KEYBOARD_TYPES].join(", ")}` });
      }
      break;
    }
    case "FlatList": {
      if (!Array.isArray(props.data)) {
        errors.push({ key: "data", reason: "FlatList requires a `data` array" });
      } else if (!isJsonValue(props.data)) {
        errors.push({ key: "data", reason: "expected JSON-serializable sample data" });
      }
      validateOptionalBoolean(props, "horizontal", errors);
      break;
    }
    default:
      break;
  }
  return errors;
}

/** Validate optional design-only metadata at the same model boundary. */
export function validateDesign(design: unknown): PropError[] {
  if (design === undefined) return [];
  if (!isPlainObject(design)) {
    return [{ key: "design", reason: "expected a design metadata object" }];
  }
  const errors: PropError[] = [];
  const allowed = new Set(["name", "locked", "hidden", "annotations"]);
  for (const key of Object.keys(design)) {
    if (!allowed.has(key)) errors.push({ key: `design.${key}`, reason: "unknown design field" });
  }
  if (design.name !== undefined && typeof design.name !== "string") {
    errors.push({ key: "design.name", reason: "expected a string" });
  }
  for (const key of ["locked", "hidden"] as const) {
    if (design[key] !== undefined && typeof design[key] !== "boolean") {
      errors.push({ key: `design.${key}`, reason: "expected a boolean" });
    }
  }
  if (design.annotations !== undefined) {
    if (!Array.isArray(design.annotations)) {
      errors.push({ key: "design.annotations", reason: "expected an annotation array" });
    } else {
      design.annotations.forEach((annotation, index) => {
        if (
          !isPlainObject(annotation) ||
          Object.keys(annotation).some((key) => key !== "id" && key !== "text") ||
          typeof annotation.id !== "string" ||
          typeof annotation.text !== "string"
        ) {
          errors.push({
            key: `design.annotations.${index}`,
            reason: "expected exactly { id: string, text: string }",
          });
        }
      });
    }
  }
  return errors;
}

/** Validate a single node (props + style + structural rules). */
export function validateNode(node: Node): NodeError[] {
  const errors: NodeError[] = [];
  const candidate = node as unknown as Record<string, unknown>;
  const nodeId = typeof candidate.id === "string" ? candidate.id : "(unknown)";
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    errors.push({ nodeId, key: "id", reason: "expected a non-empty string" });
  }
  if (!isRNPrimitive(candidate.type)) {
    errors.push({ nodeId, key: "type", reason: "expected a supported RN primitive" });
    return errors;
  }

  for (const e of validateProps(candidate.type, candidate.props)) {
    errors.push({ nodeId, key: e.key, reason: e.reason });
  }

  const styleResult = validateStyle(candidate.style);
  if (!styleResult.ok) {
    for (const e of styleResult.errors) {
      errors.push({ nodeId, key: `style.${e.key}`, reason: e.reason });
    }
  }

  for (const e of validateDesign(candidate.design as DesignMeta | undefined)) {
    errors.push({ nodeId, key: e.key, reason: e.reason });
  }

  if (canHaveChildren(candidate.type)) {
    if (!Array.isArray(candidate.children)) {
      errors.push({ nodeId, key: "children", reason: `${candidate.type} requires a children array` });
    } else if (candidate.type === "FlatList" && candidate.children.length > 1) {
      errors.push({ nodeId, key: "children", reason: "FlatList holds a single item template" });
    }
  } else if (candidate.children !== undefined) {
    errors.push({ nodeId, key: "children", reason: `${candidate.type} cannot have children` });
  }

  return errors;
}

/** Validate an entire tree, depth-first. */
export function validateTree(root: Node): NodeError[] {
  const errors: NodeError[] = [];
  const ids = new Set<string>();
  const nodes = new WeakSet<object>();
  const visit = (node: Node) => {
    if (nodes.has(node)) {
      errors.push({ nodeId: node.id ?? "(unknown)", key: "children", reason: "cyclic document tree" });
      return;
    }
    nodes.add(node);
    const nodeErrors = validateNode(node);
    errors.push(...nodeErrors);
    const candidate = node as unknown as Record<string, unknown>;
    if (typeof candidate.id === "string") {
      if (ids.has(candidate.id)) {
        errors.push({ nodeId: candidate.id, key: "id", reason: "duplicate node id" });
      }
      ids.add(candidate.id);
    }
    if (Array.isArray(candidate.children)) {
      for (const child of candidate.children) {
        if (isPlainObject(child)) visit(child as unknown as Node);
        else errors.push({ nodeId: String(candidate.id ?? "(unknown)"), key: "children", reason: "expected node objects" });
      }
    }
  };
  visit(root);
  return errors;
}
