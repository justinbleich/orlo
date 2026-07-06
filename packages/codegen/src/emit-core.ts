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
  type TokenRegistry,
  type VariantAxis,
  type VariantCombination,
} from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";
import {
  hiddenGuardExpr,
  nodeHiddenCells,
  planNodeVariantStyle,
  variantSelectorExpr,
} from "./variant-emit";

/** Where a token-bound style key resolves in the theme module. */
export interface ThemeRef {
  category: string;
  name: string;
}

/** A style entry for `StyleSheet.create`: key, value, and which style keys are
 *  token-bound (styleKey → `theme.<category>.<name>`). */
export type StyleEntry = [string, RNStyle, Record<string, ThemeRef>?];

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

/** `theme.<category>.<name>` member expression. Falls back to bracket access
 *  for token names that aren't plain identifiers (dotted names like
 *  `primary.500` emit as `theme.color["primary.500"]`). */
function themeMember(ref: ThemeRef): t.MemberExpression {
  const base = t.memberExpression(t.identifier("theme"), t.identifier(ref.category));
  return IDENT_RE.test(ref.name)
    ? t.memberExpression(base, t.identifier(ref.name))
    : t.memberExpression(base, t.stringLiteral(ref.name), true);
}

export function styleObjectExpr(
  style: RNStyle,
  themeBindings?: Record<string, ThemeRef>,
): t.ObjectExpression {
  return t.objectExpression(
    Object.entries(style).map(([k, v]) =>
      t.objectProperty(
        keyNode(k),
        themeBindings?.[k] ? themeMember(themeBindings[k]) : valueToExpr(v),
      ),
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
  /** Design tokens; bound style keys emit `theme.color.<name>` (Phase 2D). */
  tokens?: TokenRegistry;
  /** Variant axes of the component being emitted; their props switch styling
   *  (Phase 2D-3). Only set when emitting a component module with variants. */
  variants?: VariantAxis[];
  /** Per-combination overrides for the variant axes above. */
  combinations?: VariantCombination[];
  /** Node id -> route href. Pressable nodes emit an expo-router onPress handler. */
  navTargets?: Record<NodeId, string>;
}

export interface Emitter {
  /** Build a node into a JSX expression (element, or a `prop && <…/>` guard). */
  build(node: Node): t.Expression;
  used: Set<RNPrimitive>;
  /** Component names referenced as usages (imported from their own modules). */
  componentImports: Set<string>;
  styleEntries: StyleEntry[];
}

/** Whether any style entry references a design token (→ needs the theme import). */
export function usesTheme(styleEntries: StyleEntry[]): boolean {
  return styleEntries.some((entry) => entry[2] && Object.keys(entry[2]).length > 0);
}

export function createEmitter(options: EmitterOptions = {}): Emitter {
  const { components, bindings, tokens, variants, combinations, navTargets } = options;
  const hasVariants = !!variants && variants.length > 0;
  const used = new Set<RNPrimitive>();
  const componentImports = new Set<string>();
  const styleEntries: StyleEntry[] = [];
  const counters: Record<string, number> = {};

  const visibleChildren = (node: Node): Node[] =>
    childrenOf(node).filter((c) => !c.design?.hidden);

  function styleKeyFor(node: Node): string {
    const base = node.type.charAt(0).toLowerCase() + node.type.slice(1);
    counters[base] = (counters[base] ?? 0) + 1;
    return counters[base] === 1 ? base : `${base}${counters[base]}`;
  }

  /** Style keys on this node bound to a token → its `theme.<category>.<name>` ref. */
  function themeBindingsFor(node: Node): Record<string, ThemeRef> {
    const bound = node.design?.tokens;
    if (!bound || !tokens) return {};
    const result: Record<string, ThemeRef> = {};
    for (const [styleKey, tokenId] of Object.entries(bound)) {
      const token = tokens[tokenId];
      if (token && styleKey in node.style) {
        result[styleKey] = { category: token.category, name: token.name };
      }
    }
    return result;
  }

  /** `style={…}` attribute, merging a static StyleSheet ref with prop-bound keys
   *  and (for component-sets) per-combination variant selectors. */
  function styleAttr(node: Node, bind: NodeBindings | undefined): t.JSXAttribute | null {
    const plan = hasVariants
      ? planNodeVariantStyle(node.id, variants!, combinations ?? [])
      : { entries: [], selectors: [] };
    const hasStatic = Object.keys(node.style).length > 0;
    const dynamic = bind && bind.styles.size > 0;
    const hasVariant = plan.selectors.length > 0;
    if (!hasStatic && !dynamic && !hasVariant) return null;

    const parts: t.Expression[] = [];
    // A base style key is needed when the node has its own static style OR variant
    // entries (which are named `<baseKey>_<suffix>`).
    const baseKey = hasStatic || hasVariant ? styleKeyFor(node) : null;
    if (hasStatic) {
      styleEntries.push([baseKey!, node.style, themeBindingsFor(node)]);
      parts.push(t.memberExpression(t.identifier("styles"), t.identifier(baseKey!)));
    }
    for (const entry of plan.entries) {
      styleEntries.push([`${baseKey}_${entry.suffix}`, entry.style]);
    }
    for (const selector of plan.selectors) parts.push(variantSelectorExpr(baseKey!, selector));
    if (dynamic) {
      parts.push(
        t.objectExpression(
          [...bind!.styles].map(([key, prop]) => t.objectProperty(keyNode(key), t.identifier(prop))),
        ),
      );
    }
    return exprAttr("style", parts.length === 1 ? parts[0] : t.arrayExpression(parts));
  }

  function navPressAttr(href: string): t.JSXAttribute {
    return exprAttr(
      "onPress",
      t.arrowFunctionExpression(
        [],
        t.callExpression(t.memberExpression(t.identifier("router"), t.identifier("push")), [
          t.stringLiteral(href),
        ]),
      ),
    );
  }

  function propAttrs(node: Node): t.JSXAttribute[] {
    const attrs: t.JSXAttribute[] = [];
    switch (node.type) {
      case "Text":
        if (node.props.numberOfLines !== undefined) {
          attrs.push(exprAttr("numberOfLines", t.numericLiteral(node.props.numberOfLines)));
        }
        if (navTargets?.[node.id]) attrs.push(navPressAttr(navTargets[node.id]));
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
        if (navTargets?.[node.id]) attrs.push(navPressAttr(navTargets[node.id]));
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
    const name = definition ? toComponentName(definition.name) : "View";
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
        const linkedTokenId = node.tokens?.[prop.name];
        const linkedToken = linkedTokenId ? tokens?.[linkedTokenId] : undefined;
        if (linkedToken) {
          attrs.push(
            exprAttr(prop.name, themeMember({ category: linkedToken.category, name: linkedToken.name })),
          );
        } else {
          attrs.push(exprAttr(prop.name, valueToExpr(node.overrides[prop.name])));
        }
      }
    }
    // Variant selection → axis attrs, omitting any value equal to the axis default.
    for (const axis of definition?.variants ?? []) {
      const value = node.variant?.[axis.name];
      if (value !== undefined && value !== axis.values[0] && axis.values.includes(value)) {
        attrs.push(t.jsxAttribute(t.jsxIdentifier(axis.name), t.stringLiteral(value)));
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
    let result: t.Expression = element;
    const navTarget = navTargets?.[node.id];
    if (navTarget && node.type !== "Pressable" && node.type !== "Text") {
      used.add("Pressable");
      result = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier("Pressable"), [navPressAttr(navTarget)], false),
        t.jsxClosingElement(t.jsxIdentifier("Pressable")),
        [t.jsxExpressionContainer(result)],
        false,
      );
    }
    // Per-combination visibility: hide the node in the cells the variant declares.
    if (hasVariants) {
      const guard = hiddenGuardExpr(nodeHiddenCells(node.id, variants!, combinations ?? []), variants!);
      if (guard) result = t.logicalExpression("&&", guard, result);
    }
    if (bind?.visibility) {
      result = t.logicalExpression("&&", t.identifier(bind.visibility), result);
    }
    return result;
  }

  return { build, used, componentImports, styleEntries };
}

/** Assemble a `react-native` import, component-module imports, and (when used) the
 *  shared `theme` import for a file. `themePrefix` is relative to this module
 *  (`./` for screens, `../` for component modules under `components/`). */
export function moduleImports(
  used: Set<RNPrimitive>,
  componentImports: Set<string>,
  componentPrefix: string,
  extra: t.Statement[] = [],
  theme?: { used: boolean; prefix: string },
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
  const themeDecls = theme?.used
    ? [
        t.importDeclaration(
          [t.importSpecifier(t.identifier("theme"), t.identifier("theme"))],
          t.stringLiteral(`${theme.prefix}theme`),
        ),
      ]
    : [];
  return [rnImport, ...componentDecls, ...themeDecls, ...extra];
}

/** `const styles = StyleSheet.create({ … })` (emitted even when empty, so the
 *  `StyleSheet` import is always used and output stays uniform). */
export function stylesDeclaration(styleEntries: StyleEntry[]): t.VariableDeclaration {
  return t.variableDeclaration("const", [
    t.variableDeclarator(
      t.identifier("styles"),
      t.callExpression(t.memberExpression(t.identifier("StyleSheet"), t.identifier("create")), [
        t.objectExpression(
          styleEntries.map(([key, style, themeBindings]) =>
            t.objectProperty(t.identifier(key), styleObjectExpr(style, themeBindings)),
          ),
        ),
      ]),
    ),
  ]);
}
