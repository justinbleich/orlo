/**
 * Shared Babel-AST emitter used by both screen and component codegen.
 *
 * `createEmitter` walks a node tree into JSX, with two extensions over the v1
 * screen emitter: it resolves `ComponentInstance` nodes into `<Name …/>` usages
 * (Phase 2C), and — when given `bindings` — substitutes a component definition's
 * exposed props at the bound sites (text/style/visibility/slot). Module assembly
 * (imports + declarations + `StyleSheet`) lives in the callers, which know whether
 * they're a screen or a component module.
 */
import * as t from "@babel/types";
import {
  childrenOf,
  isContainer,
  type ComponentRegistry,
  type Node,
  type NodeId,
  type RNPrimitive,
} from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";

export const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function toComponentName(name: string): string {
  const pascal = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return IDENT_RE.test(pascal) ? pascal : "Screen";
}

export function keyNode(key: string): t.Identifier | t.StringLiteral {
  return IDENT_RE.test(key) ? t.identifier(key) : t.stringLiteral(key);
}

export function valueToExpr(v: unknown): t.Expression {
  if (typeof v === "number") {
    return v < 0
      ? t.unaryExpression("-", t.numericLiteral(Math.abs(v)))
      : t.numericLiteral(v);
  }
  if (typeof v === "string") return t.stringLiteral(v);
  if (typeof v === "boolean") return t.booleanLiteral(v);
  if (v === null || v === undefined) return t.nullLiteral();
  if (Array.isArray(v)) return t.arrayExpression(v.map(valueToExpr));
  if (typeof v === "object") {
    return t.objectExpression(
      Object.entries(v as Record<string, unknown>).map(([k, val]) =>
        t.objectProperty(keyNode(k), valueToExpr(val)),
      ),
    );
  }
  return t.identifier("undefined");
}

export function styleObjectExpr(style: RNStyle): t.ObjectExpression {
  return t.objectExpression(
    Object.entries(style).map(([k, v]) =>
      t.objectProperty(keyNode(k), valueToExpr(v)),
    ),
  );
}

export function exprAttr(name: string, expr: t.Expression): t.JSXAttribute {
  return t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(expr));
}
function strAttr(name: string, value: string): t.JSXAttribute {
  return exprAttr(name, t.stringLiteral(value));
}
function boolAttr(name: string): t.JSXAttribute {
  return t.jsxAttribute(t.jsxIdentifier(name), null);
}

function textChildren(text: string): t.JSXElement["children"] {
  if (text === "") return [];
  if (/[{}<>]/.test(text)) return [t.jsxExpressionContainer(t.stringLiteral(text))];
  return [t.jsxText(text)];
}

/** Prop substitutions for one template node, derived from a definition's props. */
export interface NodeBindings {
  /** prop-path (e.g. "text") → prop name */
  props: Map<string, string>;
  /** style key (e.g. "color") → prop name */
  styles: Map<string, string>;
  /** prop name controlling this node's render */
  visibility?: string;
  /** prop name supplying this node's children */
  slot?: string;
}

export interface EmitterOptions {
  /** Resolve ComponentInstance → its definition (for the usage's tag + props). */
  components?: ComponentRegistry;
  /** Component-template prop substitutions, keyed by template node id. */
  bindings?: Map<NodeId, NodeBindings>;
}

export interface Emitter {
  /** Build a node into a JSX expression (element, or a `prop && <…/>` guard). */
  build(node: Node): t.Expression;
  used: Set<RNPrimitive>;
  /** Component names referenced as usages (imported from their own modules). */
  componentImports: Set<string>;
  styleEntries: Array<[string, RNStyle]>;
}

export function createEmitter(options: EmitterOptions = {}): Emitter {
  const { components, bindings } = options;
  const used = new Set<RNPrimitive>();
  const componentImports = new Set<string>();
  const styleEntries: Array<[string, RNStyle]> = [];
  const counters: Record<string, number> = {};

  const visibleChildren = (node: Node): Node[] =>
    childrenOf(node).filter((c) => !c.design?.hidden);

  function styleKeyFor(node: Node): string {
    const base = node.type.charAt(0).toLowerCase() + node.type.slice(1);
    counters[base] = (counters[base] ?? 0) + 1;
    return counters[base] === 1 ? base : `${base}${counters[base]}`;
  }

  /** `style={…}` attribute, merging a static StyleSheet ref with prop-bound keys. */
  function styleAttr(node: Node, bind: NodeBindings | undefined): t.JSXAttribute | null {
    const hasStatic = Object.keys(node.style).length > 0;
    const dynamic = bind && bind.styles.size > 0;
    if (!hasStatic && !dynamic) return null;
    let staticRef: t.Expression | null = null;
    if (hasStatic) {
      const key = styleKeyFor(node);
      styleEntries.push([key, node.style]);
      staticRef = t.memberExpression(t.identifier("styles"), t.identifier(key));
    }
    if (!dynamic) return exprAttr("style", staticRef!);
    const dynObj = t.objectExpression(
      [...bind!.styles].map(([key, prop]) =>
        t.objectProperty(keyNode(key), t.identifier(prop)),
      ),
    );
    return exprAttr("style", staticRef ? t.arrayExpression([staticRef, dynObj]) : dynObj);
  }

  function propAttrs(node: Node): t.JSXAttribute[] {
    const attrs: t.JSXAttribute[] = [];
    switch (node.type) {
      case "Text":
        if (node.props.numberOfLines !== undefined) {
          attrs.push(exprAttr("numberOfLines", t.numericLiteral(node.props.numberOfLines)));
        }
        break;
      case "Image": {
        const src = node.props.source;
        const sourceExpr: t.Expression =
          "uri" in src
            ? t.objectExpression([t.objectProperty(t.identifier("uri"), t.stringLiteral(src.uri))])
            : t.callExpression(t.identifier("require"), [t.stringLiteral(src.require)]);
        attrs.push(exprAttr("source", sourceExpr));
        if (node.props.resizeMode) attrs.push(strAttr("resizeMode", node.props.resizeMode));
        break;
      }
      case "Pressable":
        if (node.props.disabled) attrs.push(boolAttr("disabled"));
        break;
      case "ScrollView":
        if (node.props.horizontal) attrs.push(boolAttr("horizontal"));
        if (node.props.showsScrollIndicator === false) {
          attrs.push(
            exprAttr(
              node.props.horizontal ? "showsHorizontalScrollIndicator" : "showsVerticalScrollIndicator",
              t.booleanLiteral(false),
            ),
          );
        }
        break;
      case "TextInput": {
        const p = node.props;
        if (p.placeholder !== undefined) attrs.push(strAttr("placeholder", p.placeholder));
        if (p.value !== undefined) attrs.push(strAttr("value", p.value));
        if (p.secureTextEntry) attrs.push(boolAttr("secureTextEntry"));
        if (p.editable === false) attrs.push(exprAttr("editable", t.booleanLiteral(false)));
        if (p.keyboardType) attrs.push(strAttr("keyboardType", p.keyboardType));
        break;
      }
      case "FlatList": {
        attrs.push(exprAttr("data", valueToExpr(node.props.data)));
        attrs.push(
          exprAttr(
            "keyExtractor",
            t.arrowFunctionExpression(
              [t.identifier("_item"), t.identifier("index")],
              t.callExpression(t.identifier("String"), [t.identifier("index")]),
            ),
          ),
        );
        const template = visibleChildren(node)[0];
        attrs.push(
          exprAttr(
            "renderItem",
            t.arrowFunctionExpression([], template ? (build(template) as t.Expression) : t.nullLiteral()),
          ),
        );
        if (node.props.horizontal) attrs.push(boolAttr("horizontal"));
        break;
      }
      default:
        break;
    }
    return attrs;
  }

  /** A child expression, ready to drop into a parent's JSX children list. */
  function childExpr(node: Node): t.JSXElement | t.JSXExpressionContainer {
    const expr = build(node);
    return t.isJSXElement(expr) ? expr : t.jsxExpressionContainer(expr);
  }

  function jsxChildren(node: Node, bind: NodeBindings | undefined): t.JSXElement["children"] {
    if (node.type === "Text") {
      const bound = bind?.props.get("text");
      return bound ? [t.jsxExpressionContainer(t.identifier(bound))] : textChildren(node.props.text);
    }
    if (node.type === "FlatList") return [];
    if (isContainer(node) && bind?.slot) {
      return [t.jsxExpressionContainer(t.identifier(bind.slot))];
    }
    return visibleChildren(node).map((c) => childExpr(c));
  }

  /** A ComponentInstance → `<Name prop={…} slot={…} />` usage. */
  function buildInstance(node: Node & { type: "ComponentInstance" }): t.Expression {
    const definition = components?.[node.componentId];
    const name = definition ? definition.name : "View";
    if (definition) componentImports.add(name);
    else used.add("View");
    const attrs: t.JSXAttribute[] = [];
    for (const prop of definition?.props ?? []) {
      if (prop.valueType === "node") {
        const kids = node.slots?.[prop.name];
        if (!kids || kids.length === 0) continue;
        const built = kids.map((k) => childExpr(k));
        const value: t.Expression =
          built.length === 1 && t.isJSXElement(built[0])
            ? built[0]
            : t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), built);
        attrs.push(exprAttr(prop.name, value));
        continue;
      }
      if (node.overrides[prop.name] !== undefined) {
        attrs.push(exprAttr(prop.name, valueToExpr(node.overrides[prop.name])));
      }
    }
    return t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier(name), attrs, true), null, [], true);
  }

  function build(node: Node): t.Expression {
    if (node.type === "ComponentInstance") return buildInstance(node);
    used.add(node.type);
    const bind = bindings?.get(node.id);
    const attrs: t.JSXAttribute[] = [];
    const sAttr = styleAttr(node, bind);
    if (sAttr) attrs.push(sAttr);
    attrs.push(...propAttrs(node));

    const children = jsxChildren(node, bind);
    const selfClosing = children.length === 0;
    const element = t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier(node.type), attrs, selfClosing),
      selfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(node.type)),
      children,
      selfClosing,
    );
    if (bind?.visibility) {
      return t.logicalExpression("&&", t.identifier(bind.visibility), element);
    }
    return element;
  }

  return { build, used, componentImports, styleEntries };
}

/** Assemble a `react-native` import plus component-module imports for a file. */
export function moduleImports(
  used: Set<RNPrimitive>,
  componentImports: Set<string>,
  componentPrefix: string,
  extra: t.Statement[] = [],
): t.Statement[] {
  const rnNames = [...new Set<string>([...used, "StyleSheet"])].sort();
  const rnImport = t.importDeclaration(
    rnNames.map((n) => t.importSpecifier(t.identifier(n), t.identifier(n))),
    t.stringLiteral("react-native"),
  );
  const componentDecls = [...componentImports]
    .sort()
    .map((name) =>
      t.importDeclaration(
        [t.importSpecifier(t.identifier(name), t.identifier(name))],
        t.stringLiteral(`${componentPrefix}${name}`),
      ),
    );
  return [rnImport, ...componentDecls, ...extra];
}

/** `const styles = StyleSheet.create({ … })` (emitted even when empty, so the
 *  `StyleSheet` import is always used and output stays uniform). */
export function stylesDeclaration(
  styleEntries: Array<[string, RNStyle]>,
): t.VariableDeclaration {
  return t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("styles"),
      t.callExpression(t.memberExpression(t.identifier("StyleSheet"), t.identifier("create")), [
        t.objectExpression(
          styleEntries.map(([key, style]) =>
            t.objectProperty(t.identifier(key), styleObjectExpr(style)),
          ),
        ),
      ]),
    ),
  ]);
}
