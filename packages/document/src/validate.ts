/**
 * Node-level validation at the model boundary. Style validation is delegated to
 * `packages/styles` (the single authority); this file owns props + structure.
 */
import { validateStyle } from "@rn-canvas/styles";
import type { Node, NodeId, RNPrimitive } from "./types";
import { canHaveChildren, childrenOf } from "./types";

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a primitive's props. Pure; returns per-key errors (no nodeId). */
export function validateProps(type: RNPrimitive, props: unknown): PropError[] {
  if (!isPlainObject(props)) {
    return [{ key: "(props)", reason: "expected a props object" }];
  }
  const errors: PropError[] = [];

  switch (type) {
    case "Text": {
      if (typeof props.text !== "string") {
        errors.push({ key: "text", reason: "Text requires a string `text`" });
      }
      if (props.numberOfLines !== undefined && typeof props.numberOfLines !== "number") {
        errors.push({ key: "numberOfLines", reason: "expected a number" });
      }
      break;
    }
    case "Image": {
      const src = props.source;
      const ok =
        isPlainObject(src) &&
        ((typeof src.uri === "string") || (typeof src.require === "string"));
      if (!ok) {
        errors.push({ key: "source", reason: "Image requires { uri } or { require }" });
      }
      if (props.resizeMode !== undefined && !RESIZE_MODES.has(props.resizeMode as string)) {
        errors.push({ key: "resizeMode", reason: `expected one of: ${[...RESIZE_MODES].join(", ")}` });
      }
      break;
    }
    case "TextInput": {
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
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

/** Validate a single node (props + style + structural rules). */
export function validateNode(node: Node): NodeError[] {
  const errors: NodeError[] = [];

  for (const e of validateProps(node.type, node.props)) {
    errors.push({ nodeId: node.id, key: e.key, reason: e.reason });
  }

  const styleResult = validateStyle(node.style);
  if (!styleResult.ok) {
    for (const e of styleResult.errors) {
      errors.push({ nodeId: node.id, key: `style.${e.key}`, reason: e.reason });
    }
  }

  if (!canHaveChildren(node.type) && childrenOf(node).length > 0) {
    errors.push({ nodeId: node.id, key: "children", reason: `${node.type} cannot have children` });
  }
  if (node.type === "FlatList" && childrenOf(node).length > 1) {
    errors.push({ nodeId: node.id, key: "children", reason: "FlatList holds a single item template" });
  }

  return errors;
}

/** Validate an entire tree, depth-first. */
export function validateTree(root: Node): NodeError[] {
  const errors = validateNode(root);
  for (const child of childrenOf(root)) {
    errors.push(...validateTree(child));
  }
  return errors;
}
