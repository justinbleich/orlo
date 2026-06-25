/**
 * Design tokens (Phase 2D) — pure model layer.
 *
 * A token is a named design value (color first). A node binds a style key to a
 * token via `design.tokens` (styleKey → tokenId); the *resolved* value stays in
 * `node.style[styleKey]`, so the renderer, Yoga, and existing codegen are
 * untouched. `reapplyTokens` re-resolves those literals after a token value
 * changes — the "propagates to every bound node" guarantee. Like components, the
 * registry + bindings + reconcile mirror each other.
 */
import { validateStyle } from "@rn-canvas/styles";
import type { Node, TokenRegistry } from "./types";
import { childrenOf, isContainer } from "./types";
import type { NodeError } from "./validate";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Re-resolve every token-bound style literal in a tree against the registry, and
 * drop any binding whose token no longer exists (keeping the last literal). So a
 * token value change re-resolves bound nodes, and a token removal cleanly unbinds.
 * Identity-preserving: unchanged subtrees keep their references.
 */
export function reapplyTokens(node: Node, registry: TokenRegistry): Node {
  let next = node;

  if (node.design?.tokens) {
    const style = { ...node.style } as Record<string, unknown>;
    const tokens: Record<string, string> = {};
    let styleChanged = false;
    let tokensChanged = false;
    for (const [key, tokenId] of Object.entries(node.design.tokens)) {
      const token = registry[tokenId];
      if (token) {
        tokens[key] = tokenId;
        if (style[key] !== token.value) {
          style[key] = token.value;
          styleChanged = true;
        }
      } else {
        tokensChanged = true; // token removed → drop the dangling binding
      }
    }
    if (styleChanged || tokensChanged) {
      const design = { ...node.design };
      if (tokensChanged) {
        if (Object.keys(tokens).length > 0) design.tokens = tokens;
        else delete design.tokens;
      }
      next = { ...node, style: styleChanged ? (style as Node["style"]) : node.style, design } as Node;
    }
  }

  if (isContainer(next)) {
    let changed = false;
    const children = next.children.map((child) => {
      const reapplied = reapplyTokens(child, registry);
      if (reapplied !== child) changed = true;
      return reapplied;
    });
    if (changed) next = { ...next, children } as Node;
  } else if (next.type === "ComponentInstance" && next.slots) {
    let slotsChanged = false;
    const slots = Object.fromEntries(
      Object.entries(next.slots).map(([name, kids]) => {
        let kidChanged = false;
        const reapplied = kids.map((kid) => {
          const r = reapplyTokens(kid, registry);
          if (r !== kid) kidChanged = true;
          return r;
        });
        if (kidChanged) slotsChanged = true;
        return [name, kidChanged ? reapplied : kids];
      }),
    );
    if (slotsChanged) next = { ...next, slots } as Node;
  }

  return next;
}

/** Validate the token registry: identifier/unique names, color category + value. */
export function validateTokenRegistry(registry: TokenRegistry): NodeError[] {
  const errors: NodeError[] = [];
  const seen = new Set<string>();
  for (const [id, token] of Object.entries(registry)) {
    if (token.id !== id) {
      errors.push({ nodeId: id, key: "id", reason: "registry key must equal token id" });
    }
    if (!IDENTIFIER.test(token.name)) {
      errors.push({ nodeId: id, key: "name", reason: "token name must be a JS identifier" });
    }
    if (seen.has(token.name)) {
      errors.push({ nodeId: id, key: "name", reason: "duplicate token name" });
    }
    seen.add(token.name);
    if (token.category !== "color") {
      errors.push({ nodeId: id, key: "category", reason: "expected 'color'" });
    } else if (!validateStyle({ color: token.value }).ok) {
      errors.push({ nodeId: id, key: "value", reason: "expected a color string" });
    }
  }
  return errors;
}
