/**
 * Emit a ComponentDefinition → a standalone, typed React Native component module
 * (Phase 2C slice 4). The exposed props become a typed props interface + default
 * params; their bindings substitute prop references at the bound template nodes
 * (text/style/visibility/slot). Nested instances import their sub-component modules
 * from `./<Name>`.
 */
import * as t from "@babel/types";
import _generate from "@babel/generator";
import type {
  ComponentDefinition,
  ComponentProp,
  ComponentRegistry,
  NodeId,
  TokenRegistry,
} from "@rn-canvas/document";
import {
  createEmitter,
  moduleImports,
  stylesDeclaration,
  toComponentName,
  usesTheme,
  valueToExpr,
  type NodeBindings,
} from "./emit-core";

const generate = (
  (_generate as unknown as { default?: typeof _generate }).default ?? _generate
) as typeof _generate;

export interface GeneratedComponent {
  name: string;
  fileName: string;
  code: string;
}

/** Build the per-template-node substitution map from a definition's exposed props. */
function buildBindings(definition: ComponentDefinition): Map<NodeId, NodeBindings> {
  const map = new Map<NodeId, NodeBindings>();
  const at = (id: NodeId): NodeBindings => {
    let bind = map.get(id);
    if (!bind) {
      bind = { props: new Map(), styles: new Map() };
      map.set(id, bind);
    }
    return bind;
  };
  for (const prop of definition.props) {
    for (const target of prop.targets) {
      const bind = at(target.nodeId);
      if (target.kind === "prop") bind.props.set(target.path, prop.name);
      else if (target.kind === "style") bind.styles.set(target.styleKey, prop.name);
      else if (target.kind === "visibility") bind.visibility = prop.name;
      else if (target.kind === "slot") bind.slot = prop.name;
    }
  }
  return map;
}

function propTSType(prop: ComponentProp): t.TSType {
  switch (prop.valueType) {
    case "number":
      return t.tsNumberKeyword();
    case "boolean":
      return t.tsBooleanKeyword();
    case "enum":
      return t.tsUnionType((prop.enumValues ?? []).map((v) => t.tsLiteralType(t.stringLiteral(v))));
    case "node":
      return t.tsTypeReference(t.identifier("ReactNode"));
    case "string":
    case "color":
    default:
      return t.tsStringKeyword();
  }
}

export function emitComponent(
  definition: ComponentDefinition,
  components?: ComponentRegistry,
  tokens?: TokenRegistry,
): GeneratedComponent {
  const name = toComponentName(definition.name);
  const bindings = buildBindings(definition);
  const emitter = createEmitter({ components, bindings, tokens });
  const body = emitter.build(definition.template);

  // Props interface: each exposed prop typed by its valueType; node/defaulted props optional.
  const interfaceMembers = definition.props.map((prop) => {
    const signature = t.tsPropertySignature(
      t.identifier(prop.name),
      t.tsTypeAnnotation(propTSType(prop)),
    );
    signature.optional = prop.default !== undefined || prop.valueType === "node";
    return signature;
  });
  const propsInterface = t.tsInterfaceDeclaration(
    t.identifier(`${name}Props`),
    null,
    null,
    t.tsInterfaceBody(interfaceMembers),
  );

  // Destructured, typed params with defaults from prop.default.
  const param = t.objectPattern(
    definition.props.map((prop) => {
      const value =
        prop.default !== undefined
          ? t.assignmentPattern(t.identifier(prop.name), valueToExpr(prop.default))
          : t.identifier(prop.name);
      return t.objectProperty(t.identifier(prop.name), value, false, true);
    }),
  );
  param.typeAnnotation = t.tsTypeAnnotation(t.tsTypeReference(t.identifier(`${name}Props`)));

  const fn = t.exportNamedDeclaration(
    t.functionDeclaration(t.identifier(name), [param], t.blockStatement([t.returnStatement(body)])),
  );

  // `import type { ReactNode } from "react"` only when a slot/node prop is present.
  const needsReactNode = definition.props.some((p) => p.valueType === "node");
  const extra: t.Statement[] = [];
  if (needsReactNode) {
    const decl = t.importDeclaration(
      [t.importSpecifier(t.identifier("ReactNode"), t.identifier("ReactNode"))],
      t.stringLiteral("react"),
    );
    decl.importKind = "type";
    extra.push(decl);
  }

  // Component modules live under `components/`, so the shared theme is one up.
  const imports = moduleImports(emitter.used, emitter.componentImports, "./", extra, {
    used: usesTheme(emitter.styleEntries),
    prefix: "../",
  });
  const stylesConst = stylesDeclaration(emitter.styleEntries);
  const file = t.file(
    t.program([...imports, propsInterface, fn, stylesConst], [], "module"),
  );
  return { name, fileName: `${name}.tsx`, code: generate(file).code };
}
