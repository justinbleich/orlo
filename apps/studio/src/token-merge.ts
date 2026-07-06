import type {
  ComponentRegistry,
  ComponentInstanceNode,
  Node,
  TokenRegistry,
} from "@rn-canvas/document";

function tokenKey(token: TokenRegistry[string]) {
  return `${token.category}:${token.name}`;
}

function newId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `tk_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sameTokenValue(a: TokenRegistry[string], b: TokenRegistry[string]) {
  return a.category === b.category && a.name === b.name && a.value === b.value;
}

function nextTokenName(
  base: string,
  category: TokenRegistry[string]["category"],
  tokens: TokenRegistry,
) {
  const names = new Set(
    Object.values(tokens)
      .filter((token) => token.category === category)
      .map((token) => token.name),
  );
  if (!names.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${index}`;
    if (!names.has(candidate)) return candidate;
  }
}

function remapNodeTokens(node: Node, remap: Map<string, string>): Node {
  let next = node;
  if (node.design?.tokens) {
    let changed = false;
    const tokens: Record<string, string> = {};
    for (const [key, tokenId] of Object.entries(node.design.tokens)) {
      const mapped = remap.get(tokenId) ?? tokenId;
      tokens[key] = mapped;
      if (mapped !== tokenId) changed = true;
    }
    if (changed) next = { ...next, design: { ...next.design, tokens } } as Node;
  }

  if (next.type === "ComponentInstance" && next.tokens) {
    let changed = false;
    const tokens: Record<string, string> = {};
    for (const [key, tokenId] of Object.entries(next.tokens)) {
      const mapped = remap.get(tokenId) ?? tokenId;
      tokens[key] = mapped;
      if (mapped !== tokenId) changed = true;
    }
    if (changed) next = { ...next, tokens } as ComponentInstanceNode;
  }

  if ("children" in next && Array.isArray(next.children)) {
    let changed = false;
    const children = next.children.map((child) => {
      const mapped = remapNodeTokens(child, remap);
      if (mapped !== child) changed = true;
      return mapped;
    });
    if (changed) next = { ...next, children } as Node;
  }

  if (next.type === "ComponentInstance" && next.slots) {
    let changed = false;
    const slots: NonNullable<ComponentInstanceNode["slots"]> = {};
    for (const [name, children] of Object.entries(next.slots)) {
      slots[name] = children.map((child) => {
        const mapped = remapNodeTokens(child, remap);
        if (mapped !== child) changed = true;
        return mapped;
      });
    }
    if (changed) next = { ...next, slots } as ComponentInstanceNode;
  }

  return next;
}

export function mergeLoadedTokens({
  existing,
  incoming,
  root,
  components,
}: {
  existing: TokenRegistry;
  incoming?: TokenRegistry;
  root: Node;
  components?: ComponentRegistry;
}): {
  tokens: TokenRegistry;
  root: Node;
  components?: ComponentRegistry;
} {
  if (!incoming || Object.keys(incoming).length === 0) {
    return { tokens: existing, root, components };
  }

  const nextTokens: TokenRegistry = { ...existing };
  const byCategoryName = new Map(Object.values(existing).map((token) => [tokenKey(token), token]));
  const remap = new Map<string, string>();

  for (const token of Object.values(incoming)) {
    const existingById = nextTokens[token.id];
    if (existingById) {
      if (sameTokenValue(existingById, token)) {
        remap.set(token.id, existingById.id);
        continue;
      }
      const id = newId();
      const name = nextTokenName(token.name, token.category, nextTokens);
      nextTokens[id] = { ...token, id, name };
      byCategoryName.set(tokenKey(nextTokens[id]), nextTokens[id]);
      remap.set(token.id, id);
      continue;
    }

    const existingByName = byCategoryName.get(tokenKey(token));
    if (existingByName) {
      if (sameTokenValue(existingByName, token)) {
        remap.set(token.id, existingByName.id);
        continue;
      }
      const name = nextTokenName(token.name, token.category, nextTokens);
      nextTokens[token.id] = { ...token, name };
      byCategoryName.set(tokenKey(nextTokens[token.id]), nextTokens[token.id]);
      continue;
    }

    nextTokens[token.id] = token;
    byCategoryName.set(tokenKey(token), token);
  }

  if (remap.size === 0) return { tokens: nextTokens, root, components };

  const nextRoot = remapNodeTokens(root, remap);
  const nextComponents = components
    ? Object.fromEntries(
        Object.entries(components).map(([id, definition]) => [
          id,
          { ...definition, template: remapNodeTokens(definition.template, remap) },
        ]),
      )
    : components;

  return {
    tokens: nextTokens,
    root: nextRoot,
    components: nextComponents,
  };
}
