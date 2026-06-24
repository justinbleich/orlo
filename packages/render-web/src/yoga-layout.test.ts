import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInstance,
  createNode,
  expandComponents,
  type ComponentRegistry,
} from "@rn-canvas/document";
import { computeLayout, createLayoutSnapshot } from "./yoga-layout";

test("hidden nodes do not participate in Yoga layout", async () => {
  const root = createNode("View", {
    style: { width: 200 },
    children: [
      createNode("View", { design: { hidden: true }, style: { height: 80 } }),
      createNode("View", { id: "visible", style: { height: 20 } }),
    ],
  });

  const { layout } = await computeLayout(root);
  assert.equal(layout.children.length, 1);
  assert.equal(layout.children[0].node.id, "visible");
  assert.equal(layout.height, 20);
});

test("FlatList lays out one template instance per sample row", async () => {
  const root = createNode("FlatList", {
    id: "list",
    props: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], horizontal: true },
    style: { width: 120 },
    children: [createNode("View", { id: "row", style: { width: 20, height: 10 } })],
  });

  const { layout } = await computeLayout(root);
  assert.equal(layout.children.length, 3);
  assert.deepEqual(
    layout.children.map((box) => box.node.id),
    ["row", "row", "row"],
  );
  assert.equal(new Set(layout.children.map((box) => box.instanceKey)).size, 3);
  assert.deepEqual(
    layout.children.map((box) => box.left),
    [0, 20, 40],
  );
  assert.equal(createLayoutSnapshot(layout).get("row")?.length, 3);
});

test("component instances expand and lay out as their definition (Phase 2C)", async () => {
  const template = createNode("View", {
    id: "card",
    style: { width: 100, height: 40, flexDirection: "row" },
    children: [createNode("Text", { id: "lbl", props: { text: "Hi" }, style: { width: 100, height: 40 } })],
  });
  const registry: ComponentRegistry = {
    card1: {
      id: "card1",
      name: "Card",
      template,
      props: [{ name: "label", valueType: "string", default: "Hi", targets: [{ kind: "prop", nodeId: "lbl", path: "text" }] }],
    },
  };
  const screen = createNode("View", {
    id: "screen",
    style: { width: 300, flexDirection: "row" },
    children: [
      { ...createInstance("card1", { id: "i1" }), overrides: { label: "A" } },
      { ...createInstance("card1", { id: "i2" }), overrides: { label: "B" } },
    ],
  });

  const { layout } = await computeLayout(expandComponents(screen, registry));
  const snap = createLayoutSnapshot(layout);

  // Each placement expands to its definition, namespaced and laid out side by side.
  assert.equal(snap.get("i1::card")?.[0].width, 100);
  assert.equal(snap.get("i1::card")?.[0].left, 0);
  assert.equal(snap.get("i2::card")?.[0].left, 100);
  // The per-instance override flows into the expanded primitive text.
  assert.equal((snap.get("i1::lbl")?.[0].node as { props: { text: string } }).props.text, "A");
  assert.equal((snap.get("i2::lbl")?.[0].node as { props: { text: string } }).props.text, "B");
});
