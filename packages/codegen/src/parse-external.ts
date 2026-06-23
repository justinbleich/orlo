/**
 * External React Native import for the static subset emitted by this package.
 * This parser never executes source. Unsupported or dynamic syntax fails closed.
 */
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import {
  RN_PRIMITIVES,
  validateTree,
  type Node,
  type RNPrimitive,
} from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";

const traverse = (
  (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse
) as typeof _traverse;

export interface ParseExternalOptions {
  idPrefix?: string;
}

export interface ParsedExternalScreen {
  screenName: string;
  root: Node;
}

function fail(message: string): never {
  throw new Error(`Unsupported external RN source: ${message}`);
}

function propertyName(node: t.ObjectProperty): string {
  if (node.computed) fail("computed object keys");
  if (t.isIdentifier(node.key)) return node.key.name;
  if (t.isStringLiteral(node.key)) return node.key.value;
  fail("non-string object key");
}

function staticValue(node: t.Expression | t.JSXEmptyExpression): unknown {
  if (t.isStringLiteral(node) || t.isBooleanLiteral(node) || t.isNumericLiteral(node)) {
    return node.value;
  }
  if (t.isNullLiteral(node)) return null;
  if (t.isIdentifier(node, { name: "undefined" })) return undefined;
  if (t.isUnaryExpression(node, { operator: "-" }) && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? "";
  }
  if (t.isArrayExpression(node)) {
    return node.elements.map((element) => {
      if (!element || t.isSpreadElement(element)) fail("array holes or spreads");
      return staticValue(element);
    });
  }
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || !t.isExpression(property.value)) {
        fail("object methods or spreads");
      }
      value[propertyName(property)] = staticValue(property.value);
    }
    return value;
  }
  fail(`dynamic expression ${node.type}`);
}

function expressionFromAttribute(attribute: t.JSXAttribute): t.Expression | undefined {
  if (attribute.value === null) return undefined;
  if (t.isStringLiteral(attribute.value)) return attribute.value;
  if (
    t.isJSXExpressionContainer(attribute.value) &&
    t.isExpression(attribute.value.expression)
  ) {
    return attribute.value.expression;
  }
  fail(`non-expression attribute ${attribute.name.name}`);
}

function attributeMap(element: t.JSXElement): Map<string, t.JSXAttribute> {
  const attributes = new Map<string, t.JSXAttribute>();
  for (const attribute of element.openingElement.attributes) {
    if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name)) {
      fail("spread or namespaced JSX attributes");
    }
    if (attributes.has(attribute.name.name)) fail(`duplicate prop ${attribute.name.name}`);
    attributes.set(attribute.name.name, attribute);
  }
  return attributes;
}

function takeStatic(
  attributes: Map<string, t.JSXAttribute>,
  name: string,
): unknown {
  const attribute = attributes.get(name);
  if (!attribute) return undefined;
  attributes.delete(name);
  if (attribute.value === null) return true;
  const expression = expressionFromAttribute(attribute);
  return expression ? staticValue(expression) : true;
}

function takeExpression(
  attributes: Map<string, t.JSXAttribute>,
  name: string,
): t.Expression | undefined {
  const attribute = attributes.get(name);
  if (!attribute) return undefined;
  attributes.delete(name);
  return expressionFromAttribute(attribute);
}

function expectNoAttributes(attributes: Map<string, t.JSXAttribute>, type: RNPrimitive) {
  const unknown = [...attributes.keys()];
  if (unknown.length > 0) fail(`unknown ${type} prop ${unknown[0]}`);
}

export function parseExternalScreen(
  source: string,
  options: ParseExternalOptions = {},
): ParsedExternalScreen {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  const componentByLocal = new Map<string, RNPrimitive>();
  let styleSheetLocal: string | undefined;
  let stylesVariable: string | undefined;
  let styles: Record<string, RNStyle> = {};
  let component: t.FunctionDeclaration | undefined;

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.source.value !== "react-native") return;
      for (const specifier of path.node.specifiers) {
        if (!t.isImportSpecifier(specifier)) continue;
        const imported = t.isIdentifier(specifier.imported)
          ? specifier.imported.name
          : specifier.imported.value;
        if ((RN_PRIMITIVES as readonly string[]).includes(imported)) {
          componentByLocal.set(specifier.local.name, imported as RNPrimitive);
        } else if (imported === "StyleSheet") {
          styleSheetLocal = specifier.local.name;
        }
      }
    },
    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id) || !t.isCallExpression(path.node.init)) return;
      const callee = path.node.init.callee;
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.object, { name: styleSheetLocal }) ||
        !t.isIdentifier(callee.property, { name: "create" })
      ) {
        return;
      }
      const argument = path.node.init.arguments[0];
      if (!t.isObjectExpression(argument)) fail("StyleSheet.create requires an object");
      stylesVariable = path.node.id.name;
      const parsedStyles: Record<string, RNStyle> = {};
      for (const property of argument.properties) {
        if (!t.isObjectProperty(property) || !t.isExpression(property.value)) {
          fail("dynamic StyleSheet entry");
        }
        const value = staticValue(property.value);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          fail(`style ${propertyName(property)} must be an object`);
        }
        parsedStyles[propertyName(property)] = value as RNStyle;
      }
      styles = parsedStyles;
    },
    ExportDefaultDeclaration(path) {
      if (!t.isFunctionDeclaration(path.node.declaration)) {
        fail("default export must be a function declaration");
      }
      component = path.node.declaration;
    },
  });

  if (!component) fail("missing default screen function");
  const screenName = component.id?.name ?? "Screen";
  const returns = component.body.body.filter(t.isReturnStatement);
  if (returns.length !== 1 || !t.isJSXElement(returns[0].argument)) {
    fail("screen function must directly return one RN JSX tree");
  }

  let idCounter = 0;
  const idPrefix = options.idPrefix ?? "imported";

  const parseStyle = (expression: t.Expression | undefined): RNStyle => {
    if (!expression) return {};
    if (t.isObjectExpression(expression)) return staticValue(expression) as RNStyle;
    if (
      t.isMemberExpression(expression) &&
      t.isIdentifier(expression.object, { name: stylesVariable })
    ) {
      const key = expression.computed
        ? t.isStringLiteral(expression.property)
          ? expression.property.value
          : undefined
        : t.isIdentifier(expression.property)
          ? expression.property.name
          : undefined;
      if (!key || !styles[key]) fail("unknown StyleSheet reference");
      return styles[key];
    }
    fail("style must be a static object or StyleSheet reference");
  };

  const parseText = (element: t.JSXElement): string => {
    let text = "";
    for (const child of element.children) {
      if (t.isJSXText(child)) {
        text += child.value;
      } else if (t.isJSXExpressionContainer(child)) {
        const value = staticValue(child.expression);
        if (typeof value !== "string") fail("Text children must be static strings");
        text += value;
      } else if (!t.isJSXEmptyExpression(child)) {
        fail("nested elements inside Text");
      }
    }
    return text;
  };

  const parseChildren = (element: t.JSXElement): t.JSXElement[] => {
    const children: t.JSXElement[] = [];
    for (const child of element.children) {
      if (t.isJSXElement(child)) children.push(child);
      else if (t.isJSXText(child) && child.value.trim() === "") continue;
      else if (t.isJSXExpressionContainer(child) && t.isJSXEmptyExpression(child.expression)) {
        continue;
      } else fail("non-element container child");
    }
    return children;
  };

  const buildNode = (element: t.JSXElement): Node => {
    if (!t.isJSXIdentifier(element.openingElement.name)) fail("member JSX components");
    const type = componentByLocal.get(element.openingElement.name.name);
    if (!type) fail(`non-RN component ${element.openingElement.name.name}`);
    const id = `${idPrefix}-${idCounter++}`;
    const attributes = attributeMap(element);
    const style = parseStyle(takeExpression(attributes, "style"));

    switch (type) {
      case "Text": {
        const numberOfLines = takeStatic(attributes, "numberOfLines");
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: {
            text: parseText(element),
            ...(numberOfLines === undefined ? {} : { numberOfLines: numberOfLines as number }),
          },
          style,
        };
      }
      case "Image": {
        const sourceExpression = takeExpression(attributes, "source");
        if (!sourceExpression) fail("Image requires source");
        let source: { uri: string } | { require: string };
        if (
          t.isCallExpression(sourceExpression) &&
          t.isIdentifier(sourceExpression.callee, { name: "require" }) &&
          t.isStringLiteral(sourceExpression.arguments[0])
        ) {
          source = { require: sourceExpression.arguments[0].value };
        } else {
          source = staticValue(sourceExpression) as { uri: string };
        }
        const resizeMode = takeStatic(attributes, "resizeMode");
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: {
            source,
            ...(resizeMode === undefined ? {} : { resizeMode: resizeMode as never }),
          },
          style,
        };
      }
      case "Pressable": {
        const disabled = takeStatic(attributes, "disabled");
        const children = parseChildren(element).map(buildNode);
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: disabled === undefined ? {} : { disabled: disabled as boolean },
          style,
          children,
        };
      }
      case "ScrollView": {
        const horizontal = takeStatic(attributes, "horizontal");
        const horizontalIndicator = takeStatic(
          attributes,
          "showsHorizontalScrollIndicator",
        );
        const verticalIndicator = takeStatic(attributes, "showsVerticalScrollIndicator");
        const indicator = horizontalIndicator ?? verticalIndicator;
        const children = parseChildren(element).map(buildNode);
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: {
            ...(horizontal === undefined ? {} : { horizontal: horizontal as boolean }),
            ...(indicator === undefined
              ? {}
              : { showsScrollIndicator: indicator as boolean }),
          },
          style,
          children,
        };
      }
      case "TextInput": {
        const props = {
          placeholder: takeStatic(attributes, "placeholder"),
          value: takeStatic(attributes, "value"),
          secureTextEntry: takeStatic(attributes, "secureTextEntry"),
          editable: takeStatic(attributes, "editable"),
          keyboardType: takeStatic(attributes, "keyboardType"),
        };
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: Object.fromEntries(
            Object.entries(props).filter(([, value]) => value !== undefined),
          ) as never,
          style,
        };
      }
      case "FlatList": {
        const data = takeStatic(attributes, "data");
        const horizontal = takeStatic(attributes, "horizontal");
        takeExpression(attributes, "keyExtractor");
        const renderItem = takeExpression(attributes, "renderItem");
        if (!t.isArrowFunctionExpression(renderItem)) fail("FlatList requires renderItem arrow");
        const template = t.isJSXElement(renderItem.body) ? buildNode(renderItem.body) : undefined;
        if (!template && !t.isNullLiteral(renderItem.body)) {
          fail("FlatList renderItem must return static RN JSX or null");
        }
        expectNoAttributes(attributes, type);
        return {
          id,
          type,
          props: {
            data: data as unknown[],
            ...(horizontal === undefined ? {} : { horizontal: horizontal as boolean }),
          },
          style,
          children: template ? [template] : [],
        };
      }
      case "View": {
        const children = parseChildren(element).map(buildNode);
        expectNoAttributes(attributes, type);
        return { id, type, props: {}, style, children };
      }
    }
  };

  const root = buildNode(returns[0].argument);
  const errors = validateTree(root);
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`Invalid imported RN tree: ${first.key} ${first.reason}`);
  }
  return { screenName, root };
}
