/**
 * Parse-back for the canonical `theme.ts` (Phase 2D-2b). The file is the source
 * of truth for token *values + names*; this reads it into a flat list of tokens.
 * It is the inverse of `emitTheme` and, like `parse-external`, never executes
 * source and fails closed on dynamic/unknown syntax.
 *
 * Identity (stable token ids) is NOT in the file — it lives in the sidecar.
 * `reconcileTokens` rebuilds the registry by matching file `category:name` to the
 * sidecar's id↔name so bindings stay valid across reads. See `openDocument`.
 */
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import type { DesignToken, TokenCategory, TokenRegistry } from "@rn-canvas/document";

const traverse = (
  (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse
) as typeof _traverse;

const CATEGORIES = new Set<TokenCategory>(["color", "spacing", "fontSize"]);

export interface ParsedToken {
  category: TokenCategory;
  name: string;
  value: string | number;
}

function fail(message: string): never {
  throw new Error(`Unsupported theme.ts source: ${message}`);
}

function keyName(node: t.ObjectProperty): string {
  if (node.computed) fail("computed theme key");
  if (t.isIdentifier(node.key)) return node.key.name;
  if (t.isStringLiteral(node.key)) return node.key.value;
  fail("non-string theme key");
}

/** A token value literal: a string, or a (possibly negated) number. */
function literalValue(node: t.Expression): string | number {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return node.value;
  if (t.isUnaryExpression(node, { operator: "-" }) && t.isNumericLiteral(node.argument)) {
    return -node.argument.value;
  }
  fail(`dynamic token value ${node.type}`);
}

/**
 * Read `export const theme = { color: {…}, spacing: {…}, fontSize: {…} } as const`
 * into a flat token list. Missing/empty categories are simply absent. Throws on
 * any syntax outside that idiomatic shape.
 */
export function parseTheme(source: string): ParsedToken[] {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  let themeObject: t.ObjectExpression | undefined;

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const decl = path.node.declaration;
      if (!t.isVariableDeclaration(decl)) return;
      for (const declarator of decl.declarations) {
        if (!t.isIdentifier(declarator.id, { name: "theme" }) || !declarator.init) continue;
        // Unwrap an optional `as const` (TSAsExpression).
        const init = t.isTSAsExpression(declarator.init)
          ? declarator.init.expression
          : declarator.init;
        if (!t.isObjectExpression(init)) fail("theme must be an object literal");
        themeObject = init;
      }
    },
  });

  if (!themeObject) return [];

  const tokens: ParsedToken[] = [];
  for (const categoryProp of themeObject.properties) {
    if (!t.isObjectProperty(categoryProp)) fail("theme spreads or methods");
    const category = keyName(categoryProp);
    if (!CATEGORIES.has(category as TokenCategory)) fail(`unknown category ${category}`);
    if (!t.isObjectExpression(categoryProp.value)) fail(`category ${category} must be an object`);
    for (const tokenProp of categoryProp.value.properties) {
      if (!t.isObjectProperty(tokenProp) || !t.isExpression(tokenProp.value)) {
        fail("token spreads or methods");
      }
      tokens.push({
        category: category as TokenCategory,
        name: keyName(tokenProp),
        value: literalValue(tokenProp.value),
      });
    }
  }
  return tokens;
}

function newId(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `token-${Math.random().toString(36).slice(2)}`;
}

/**
 * Rebuild a TokenRegistry from the file's tokens (`parsed`, canonical for values +
 * names) reconciled against `prior` (the sidecar registry, canonical for id↔name).
 * Matching is by `category:name`: a match reuses the prior id (so bindings survive);
 * an unmatched file token mints a fresh id; a prior token absent from the file is
 * dropped (its dangling bindings are later cleaned by `reapplyTokens`).
 */
export function reconcileTokens(parsed: ParsedToken[], prior: TokenRegistry): TokenRegistry {
  const priorByKey = new Map<string, DesignToken>();
  for (const token of Object.values(prior)) {
    priorByKey.set(`${token.category}:${token.name}`, token);
  }
  const next: TokenRegistry = {};
  for (const p of parsed) {
    const existing = priorByKey.get(`${p.category}:${p.name}`);
    const id = existing?.id ?? newId();
    next[id] = { id, name: p.name, category: p.category, value: p.value } as DesignToken;
  }
  return next;
}
