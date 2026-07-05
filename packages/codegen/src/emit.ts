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
import type { ComponentRegistry, Node, TokenRegistry } from "@rn-canvas/document";
import {
  createEmitter,
  moduleImports,
  stylesDeclaration,
  toComponentName,
  usesTheme,
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
  /** Design tokens; token-bound style keys emit `theme.color.<name>` (Phase 2D). */
  tokens?: TokenRegistry;
  /** Node id -> route href. Pressable nodes emit an expo-router onPress handler. */
  navTargets?: Record<string, string>;
}

export function emitScreen(root: Node, opts: EmitOptions = {}): string {
  const screenName = toComponentName(opts.screenName ?? "Screen");
  const emitter = createEmitter({
    components: opts.components,
    tokens: opts.tokens,
    navTargets: opts.navTargets,
  });

  // Build the tree first so `used` + `styleEntries` + `componentImports` populate.
  const tree: t.Expression = root.design?.hidden ? t.nullLiteral() : emitter.build(root);

  const imports = moduleImports(emitter.used, emitter.componentImports, "./components/", [], {
    used: usesTheme(emitter.styleEntries),
    prefix: "./",
  });
  if (opts.navTargets && Object.keys(opts.navTargets).length > 0) {
    imports.push(
      t.importDeclaration(
        [t.importSpecifier(t.identifier("useRouter"), t.identifier("useRouter"))],
        t.stringLiteral("expo-router"),
      ),
    );
  }
  const statements: t.Statement[] = [];
  if (opts.navTargets && Object.keys(opts.navTargets).length > 0) {
    statements.push(
      t.variableDeclaration("const", [
        t.variableDeclarator(
          t.identifier("router"),
          t.callExpression(t.identifier("useRouter"), []),
        ),
      ]),
    );
  }
  statements.push(t.returnStatement(tree));
  const component = t.exportDefaultDeclaration(
    t.functionDeclaration(
      t.identifier(screenName),
      [],
      t.blockStatement(statements),
    ),
  );
  const stylesConst = stylesDeclaration(emitter.styleEntries);

  const file = t.file(t.program([...imports, component, stylesConst], [], "module"));
  return generate(file).code;
}
