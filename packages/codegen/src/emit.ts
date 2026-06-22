/**
 * Emit: document subtree → idiomatic React Native source.
 *
 * Builds a typed Babel AST and prints it with @babel/generator (BUILD Phase 3):
 * a default-exported function component, `StyleSheet.create`, and a single
 * `react-native` import with exactly the components used.
 *
 * Invariant: this emitter NEVER writes design-time metadata (PRD §7.5). It reads
 * `design.hidden` only to decide which nodes render (matching the canvas), but the
 * flag itself — and name/locked/annotations — never appear in the output. The full
 * tree + design metadata live in the sidecar (see sidecar.ts).
 */
import * as t from "@babel/types";
import _generate from "@babel/generator";
import { childrenOf, type Node, type RNPrimitive } from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";

// @babel/generator's default export is interop-wrapped under ESM.
const generate = (
  (_generate as unknown as { default?: typeof _generate }).default ?? _generate
) as typeof _generate;

export interface EmitOptions {
  /** Component name; an export-time identifier, NOT read from design metadata. */
  screenName?: string;
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

function toComponentName(name: string): string {
  const pascal = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return IDENT_RE.test(pascal) ? pascal : "Screen";
}

function keyNode(key: string): t.Identifier | t.StringLiteral {
  return IDENT_RE.test(key) ? t.identifier(key) : t.stringLiteral(key);
}

function valueToExpr(v: unknown): t.Expression {
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

function styleObjectExpr(style: RNStyle): t.ObjectExpression {
  return t.objectExpression(
    Object.entries(style).map(([k, v]) =>
      t.objectProperty(keyNode(k), valueToExpr(v)),
    ),
  );
}

function exprAttr(name: string, expr: t.Expression): t.JSXAttribute {
  return t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(expr));
}
function strAttr(name: string, value: string): t.JSXAttribute {
  return exprAttr(name, t.stringLiteral(value));
}
function boolAttr(name: string): t.JSXAttribute {
  // Bare attribute renders as `name` (=== true) — idiomatic JSX.
  return t.jsxAttribute(t.jsxIdentifier(name), null);
}

function textChildren(text: string): t.JSXElement["children"] {
  if (text === "") return [];
  // Plain text is most idiomatic; fall back to an expression for JSX-unsafe chars.
  if (/[{}<>]/.test(text)) return [t.jsxExpressionContainer(t.stringLiteral(text))];
  return [t.jsxText(text)];
}

export function emitScreen(root: Node, opts: EmitOptions = {}): string {
  const screenName = toComponentName(opts.screenName ?? "Screen");
  const used = new Set<RNPrimitive>();
  const styleEntries: Array<[string, RNStyle]> = [];
  const counters: Record<string, number> = {};

  const visibleChildren = (node: Node): Node[] =>
    childrenOf(node).filter((c) => !c.design?.hidden);

  function styleKeyFor(node: Node): string {
    const base = node.type.charAt(0).toLowerCase() + node.type.slice(1);
    counters[base] = (counters[base] ?? 0) + 1;
    return counters[base] === 1 ? base : `${base}${counters[base]}`;
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
            ? t.objectExpression([
                t.objectProperty(t.identifier("uri"), t.stringLiteral(src.uri)),
              ])
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
              node.props.horizontal
                ? "showsHorizontalScrollIndicator"
                : "showsVerticalScrollIndicator",
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
            t.arrowFunctionExpression([], template ? buildJSX(template) : t.nullLiteral()),
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

  function jsxChildren(node: Node): t.JSXElement["children"] {
    if (node.type === "Text") return textChildren(node.props.text);
    if (node.type === "FlatList") return []; // template lives in renderItem
    return visibleChildren(node).map((c) => buildJSX(c));
  }

  function buildJSX(node: Node): t.JSXElement {
    used.add(node.type);
    const attrs: t.JSXAttribute[] = [];
    if (Object.keys(node.style).length > 0) {
      const key = styleKeyFor(node);
      styleEntries.push([key, node.style]);
      attrs.push(
        exprAttr("style", t.memberExpression(t.identifier("styles"), t.identifier(key))),
      );
    }
    attrs.push(...propAttrs(node));

    const children = jsxChildren(node);
    const selfClosing = children.length === 0;
    return t.jsxElement(
      t.jsxOpeningElement(t.jsxIdentifier(node.type), attrs, selfClosing),
      selfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(node.type)),
      children,
      selfClosing,
    );
  }

  // Build the tree first so `used` + `styleEntries` are populated.
  const tree: t.Expression = root.design?.hidden ? t.nullLiteral() : buildJSX(root);

  const importNames = [...new Set<string>([...used, "StyleSheet"])].sort();
  const importDecl = t.importDeclaration(
    importNames.map((n) => t.importSpecifier(t.identifier(n), t.identifier(n))),
    t.stringLiteral("react-native"),
  );

  const component = t.exportDefaultDeclaration(
    t.functionDeclaration(
      t.identifier(screenName),
      [],
      t.blockStatement([t.returnStatement(tree)]),
    ),
  );

  const stylesConst = t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("styles"),
      t.callExpression(
        t.memberExpression(t.identifier("StyleSheet"), t.identifier("create")),
        [
          t.objectExpression(
            styleEntries.map(([key, style]) =>
              t.objectProperty(t.identifier(key), styleObjectExpr(style)),
            ),
          ),
        ],
      ),
    ),
  ]);

  const file = t.file(t.program([importDecl, component, stylesConst], [], "module"));
  return generate(file).code;
}
