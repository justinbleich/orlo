import { test } from "node:test";
import assert from "node:assert/strict";
import { createInstance, createNode, type TokenRegistry } from "@rn-canvas/document";
import { mergeLoadedTokens } from "./token-merge";

test("mergeLoadedTokens reuses identical category/name/value tokens and remaps bindings", () => {
  const existing: TokenRegistry = {
    a: { id: "a", name: "brand", category: "color", value: "#2563eb" },
  };
  const incoming: TokenRegistry = {
    b: { id: "b", name: "brand", category: "color", value: "#2563eb" },
  };
  const root = createNode("View", {
    id: "root",
    design: { tokens: { backgroundColor: "b" } },
    style: { backgroundColor: "#2563eb" },
  });

  const merged = mergeLoadedTokens({ existing, incoming, root });

  assert.deepEqual(Object.keys(merged.tokens), ["a"]);
  assert.deepEqual(merged.root.design?.tokens, { backgroundColor: "a" });
});

test("mergeLoadedTokens renames same category/name tokens with different values", () => {
  const existing: TokenRegistry = {
    a: { id: "a", name: "brand", category: "color", value: "#2563eb" },
  };
  const incoming: TokenRegistry = {
    b: { id: "b", name: "brand", category: "color", value: "#0f172a" },
  };
  const root = createNode("View", {
    id: "root",
    design: { tokens: { backgroundColor: "b" } },
    style: { backgroundColor: "#0f172a" },
  });

  const merged = mergeLoadedTokens({ existing, incoming, root });

  assert.equal(merged.tokens.b.name, "brand2");
  assert.deepEqual(merged.root.design?.tokens, { backgroundColor: "b" });
});

test("mergeLoadedTokens remaps component template and instance override token links", () => {
  const existing: TokenRegistry = {
    a: { id: "a", name: "brand", category: "color", value: "#2563eb" },
  };
  const incoming: TokenRegistry = {
    b: { id: "b", name: "brand", category: "color", value: "#2563eb" },
  };
  const root = createNode("View", {
    id: "root",
    children: [
      {
        ...createInstance("card", { id: "inst" }),
        tokens: { tint: "b" },
        overrides: { tint: "#2563eb" },
      },
    ],
  });
  const components = {
    card: {
      id: "card",
      name: "Card",
      template: createNode("View", {
        id: "template",
        design: { tokens: { backgroundColor: "b" } },
        style: { backgroundColor: "#2563eb" },
      }),
      props: [],
    },
  };

  const merged = mergeLoadedTokens({ existing, incoming, root, components });
  const instance = "children" in merged.root ? merged.root.children[0] : undefined;

  assert.equal(instance?.type, "ComponentInstance");
  assert.deepEqual(instance?.tokens, { tint: "a" });
  assert.deepEqual(merged.components?.card.template.design?.tokens, { backgroundColor: "a" });
});
