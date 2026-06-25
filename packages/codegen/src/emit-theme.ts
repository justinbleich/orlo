/**
 * Emit a TokenRegistry → the shared `theme.ts` module (Phase 2D). Token-bound
 * style keys in screens/components reference `theme.color.<name>`; this is the
 * single source those references resolve against. Keys are the token *names*
 * (validated unique JS identifiers); values are the literals.
 */
import * as t from "@babel/types";
import _generate from "@babel/generator";
import type { TokenRegistry } from "@rn-canvas/document";
import { keyNode, valueToExpr } from "./emit-core";

const generate = (
  (_generate as unknown as { default?: typeof _generate }).default ?? _generate
) as typeof _generate;

export interface GeneratedTheme {
  fileName: string;
  code: string;
}

/** `export const theme = { color: {…}, spacing: {…}, … } as const;` (only
 *  categories that have tokens are emitted, in a stable order). */
export function emitTheme(registry: TokenRegistry): GeneratedTheme {
  const order = ["color", "spacing", "fontSize"] as const;
  const groups = order.flatMap((category) => {
    const props = Object.values(registry)
      .filter((token) => token.category === category)
      .map((token) => t.objectProperty(keyNode(token.name), valueToExpr(token.value)));
    return props.length > 0
      ? [t.objectProperty(t.identifier(category), t.objectExpression(props))]
      : [];
  });

  const themeObject = t.objectExpression(groups);

  const decl = t.exportNamedDeclaration(
    t.variableDeclaration("const", [
      t.variableDeclarator(
        t.identifier("theme"),
        t.tsAsExpression(themeObject, t.tsTypeReference(t.identifier("const"))),
      ),
    ]),
  );

  const file = t.file(t.program([decl], [], "module"));
  return { fileName: "theme.ts", code: generate(file).code };
}
