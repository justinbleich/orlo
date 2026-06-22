import { test } from "node:test";
import assert from "node:assert/strict";
import { createNode } from "@rn-canvas/document";
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
