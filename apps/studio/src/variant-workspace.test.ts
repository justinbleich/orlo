import assert from "node:assert/strict";
import { test } from "node:test";
import { createNode, type ComponentDefinition } from "@rn-canvas/document";
import {
  comboHasOverrides,
  resolveStyleEditTarget,
  variantFrameLayout,
  variantPreviewCombinations,
  variantPreviewKey,
  variantPreviewLabel,
  variantPreviewRoot,
} from "./variant-workspace";

function cardDefinition(): ComponentDefinition {
  return {
    id: "c1",
    name: "Card",
    template: createNode("View", {
      id: "tpl",
      children: [createNode("Text", { id: "label", props: { text: "Title" } })],
    }),
    props: [],
    variants: [
      { name: "size", values: ["sm", "lg"] },
      { name: "tone", values: ["neutral", "brand"] },
    ],
    combinations: [
      {
        values: { size: "lg", tone: "brand" },
        overrides: [{ nodeId: "tpl", style: { backgroundColor: "#123456" } }],
      },
    ],
  };
}

test("variantPreviewCombinations enumerates axes in stable cartesian order", () => {
  assert.deepEqual(variantPreviewCombinations(cardDefinition()), [
    { size: "sm", tone: "neutral" },
    { size: "sm", tone: "brand" },
    { size: "lg", tone: "neutral" },
    { size: "lg", tone: "brand" },
  ]);
});

test("variant preview labels, keys, and roots resolve the requested combination", () => {
  const definition = cardDefinition();
  const values = { size: "lg", tone: "brand" };
  assert.equal(variantPreviewKey(definition, values), "size:lg|tone:brand");
  assert.equal(variantPreviewLabel(definition, { size: "sm", tone: "neutral" }), "Base");
  assert.equal(variantPreviewLabel(definition, values), "lg / brand");
  assert.equal(variantPreviewRoot(definition, values).style.backgroundColor, "#123456");
});

test("variantFrameLayout is deterministic and does not mutate the base box", () => {
  const base = { x: 10, y: 20, w: 100, h: 80 };
  const combos = [{ a: "1" }, { a: "2" }, { a: "3" }];
  assert.deepEqual(variantFrameLayout(base, combos), [
    { x: 158, y: 20, w: 100, h: 80 },
    { x: 306, y: 20, w: 100, h: 80 },
    { x: 158, y: 180, w: 100, h: 80 },
  ]);
  assert.deepEqual(base, { x: 10, y: 20, w: 100, h: 80 });
});

test("comboHasOverrides finds sparse override cells", () => {
  const definition = cardDefinition();
  assert.equal(comboHasOverrides(definition, { size: "lg", tone: "brand" }), true);
  assert.equal(comboHasOverrides(definition, { size: "sm", tone: "brand" }), false);
});

test("resolveStyleEditTarget routes only single non-default primitive edits to variants", () => {
  const definition = cardDefinition();
  assert.deepEqual(
    resolveStyleEditTarget({
      editingComponentId: "c1",
      definition,
      activeVariant: { size: "lg", tone: "brand" },
      nodeId: "tpl",
      nodeType: "View",
      multi: false,
    }),
    { kind: "variant", values: { size: "lg", tone: "brand" } },
  );
  assert.deepEqual(
    resolveStyleEditTarget({
      editingComponentId: "c1",
      definition,
      activeVariant: { size: "sm", tone: "neutral" },
      nodeId: "tpl",
      nodeType: "View",
      multi: false,
    }),
    { kind: "base" },
  );
  assert.deepEqual(
    resolveStyleEditTarget({
      editingComponentId: "c1",
      definition,
      activeVariant: { size: "lg", tone: "brand" },
      nodeId: "inst",
      nodeType: "ComponentInstance",
      multi: false,
    }),
    { kind: "base" },
  );
  assert.deepEqual(
    resolveStyleEditTarget({
      editingComponentId: "c1",
      definition,
      activeVariant: { size: "lg", tone: "brand" },
      nodeId: "tpl",
      nodeType: "View",
      multi: true,
    }),
    { kind: "base" },
  );
});
