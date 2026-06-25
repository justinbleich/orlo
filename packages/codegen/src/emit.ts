/**
 * Emit: a screen document subtree → idiomatic React Native source.
 *
 * Builds a typed Babel AST and prints it with @babel/generator (BUILD Phase 3):
 * a default-exported function component, `StyleSheet.create`, and a single
 * `react-native` import. ComponentInstance nodes emit as JSX usages of their
 * definition (imported from `./components/<Name>`); the shared walk lives in
 * emit-core.ts.
 *
 * Invariant: this emitter NEVER writes design-time metadata (PRD §7.5). It reads
 * `design.hidden` only to decide which nodes render, never the flag itself.
 */
import * as t from "@babel/types";
import _generate from "@babel/generator";
import type { ComponentRegistry, Node } from "@rn-canvas/document";
import {
  createEmitter,
  moduleImports,
  stylesDeclaration,
  toComponentName,
} from "./emit-core";

// @babel/generator's default export is interop-wrapped under ESM.
const generate = (
  (_generate as unknown as { default?: typeof _generate }).default ?? _generate
) as typeof _generate;

export interface EmitOptions {
  /** Component name; an export-time identifier, NOT read from design metadata. */
  screenName?: string;
  /** Definitions used to resolve ComponentInstance usages (Phase 2C). */
  components?: ComponentRegistry;
}

export function emitScreen(root: Node, opts: EmitOptions = {}): string {
  const screenName = toComponentName(opts.screenName ?? "Screen");
  const emitter = createEmitter({ components: opts.components });

  // Build the tree first so `used` + `styleEntries` + `componentImports` populate.
  const tree: t.Expression = root.design?.hidden ? t.nullLiteral() : emitter.build(root);

  const imports = moduleImports(emitter.used, emitter.componentImports, "./components/");
  const component = t.exportDefaultDeclaration(
    t.functionDeclaration(
      t.identifier(screenName),
      [],
      t.blockStatement([t.returnStatement(tree)]),
    ),
  );
  const stylesConst = stylesDeclaration(emitter.styleEntries);

  const file = t.file(t.program([...imports, component, stylesConst], [], "module"));
  return generate(file).code;
}
