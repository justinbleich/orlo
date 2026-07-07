import assert from "node:assert/strict";
import { test } from "node:test";
import { childrenOf, createNode, type Node } from "@rn-canvas/document";
import type { LayoutHitBox } from "./canvas-interaction";
import {
  CREATION_MODEL,
  buildDrawnNode,
  flexCreateInsertIndex,
  containerAt,
  drawSize,
  flexBlockInParent,
  flexInsertIndex,
  hitTestLayout,
  rectOf,
} from "./canvas-interaction";

function layoutTree(
  root: Node,
  boxes: Record<string, Omit<LayoutHitBox, "node" | "children" | "instanceKey">>,
): LayoutHitBox {
  function walk(node: Node): LayoutHitBox {
    const geometry = boxes[node.id] ?? { left: 0, top: 0, width: 0, height: 0 };
    return {
      node,
      instanceKey: node.id,
      ...geometry,
      children: childrenOf(node).map(walk),
    };
  }
  return walk(root);
}

test("creation model is flex-flow", () => {
  assert.equal(CREATION_MODEL, "flex-flow");
});

test("drawSize uses defaults for small drags", () => {
  assert.deepEqual(drawSize({ x0: 0, y0: 0, x1: 4, y1: 4 }), { width: 100, height: 40 });
  assert.deepEqual(drawSize({ x0: 0, y0: 0, x1: 80, y1: 60 }), { width: 80, height: 60 });
});

test("buildDrawnNode creates FlatList with one item template", () => {
  const list = buildDrawnNode("FlatList", 200, 300);
  assert.equal(list.type, "FlatList");
  assert.equal(list.children?.length, 1);
  assert.equal(list.children?.[0]?.type, "View");
});

test("buildDrawnNode creates Pressable as a neutral tappable shell", () => {
  const button = buildDrawnNode("Pressable", 120, 32);
  assert.equal(button.type, "Pressable");
  assert.equal(button.style.height, 40);
  assert.equal(button.style.borderWidth, 1);
  assert.equal(button.style.backgroundColor, "#FFFFFF");
  assert.equal(button.style.alignItems, "center");
  assert.equal(button.children?.length, 1);
  assert.equal(button.children?.[0]?.type, "Text");
  assert.equal(button.children?.[0]?.props.text, "Pressable");
});

test("flexInsertIndex picks midpoint slot", () => {
  const siblings = [
    { id: "a", box: { left: 0, top: 0, width: 40, height: 20 } },
    { id: "b", box: { left: 0, top: 30, width: 40, height: 20 } },
  ];
  assert.equal(flexInsertIndex(siblings, { x: 10, y: 5 }, false), 0);
  assert.equal(flexInsertIndex(siblings, { x: 10, y: 35 }, false), 1);
  assert.equal(flexInsertIndex(siblings, { x: 10, y: 55 }, false), 2);
});

test("flexInsertIndex skips block members when computing target", () => {
  const siblings = [
    { id: "a", box: { left: 0, top: 0, width: 40, height: 20 } },
    { id: "b", box: { left: 0, top: 30, width: 40, height: 20 } },
    { id: "c", box: { left: 0, top: 60, width: 40, height: 20 } },
  ];
  assert.equal(flexInsertIndex(siblings, { x: 10, y: 35 }, false, new Set(["b", "c"])), 1);
});

test("flexCreateInsertIndex appends into the selected container", () => {
  const siblings = [
    { id: "a", box: { left: 0, top: 0, width: 40, height: 20 } },
    { id: "b", box: { left: 0, top: 30, width: 40, height: 20 } },
  ];
  assert.equal(flexCreateInsertIndex(siblings, { x: 10, y: 5 }, false, "root", ["root"]), 2);
  assert.equal(flexCreateInsertIndex(siblings, { x: 10, y: 5 }, false, "root", []), 0);
});

test("flexBlockInParent returns ordered flex siblings only", () => {
  const root = createNode("View", {
    id: "root",
    children: [
      createNode("View", { id: "a" }),
      createNode("View", { id: "b", style: { position: "absolute" } }),
      createNode("View", { id: "c" }),
    ],
  });
  assert.deepEqual(flexBlockInParent(root, "root", ["a", "b", "c"]), ["a", "c"]);
});

test("hitTestLayout prefers deepest visible node", () => {
  const root = createNode("View", {
    id: "root",
    children: [createNode("Text", { id: "child", props: { text: "Hi" } })],
  });
  const layout = layoutTree(root, {
    root: { left: 0, top: 0, width: 100, height: 100 },
    child: { left: 10, top: 10, width: 20, height: 10 },
  });
  const hit = hitTestLayout(layout, { x: 15, y: 15 });
  assert.equal(hit?.node.id, "child");
});

test("containerAt targets parent container for leaf hits", () => {
  const root = createNode("View", {
    id: "root",
    children: [
      createNode("View", {
        id: "card",
        children: [createNode("Text", { id: "label", props: { text: "Hi" } })],
      }),
    ],
  });
  const layout = layoutTree(root, {
    root: { left: 0, top: 0, width: 200, height: 200 },
    card: { left: 20, top: 20, width: 80, height: 80 },
    label: { left: 30, top: 30, width: 40, height: 16 },
  });
  const target = containerAt(root, layout, { x: 35, y: 35 });
  assert.equal(target.node.id, "card");
});

test("rectOf normalizes corners", () => {
  assert.deepEqual(rectOf({ x: 10, y: 20 }, { x: 0, y: 0 }), {
    x0: 0,
    y0: 0,
    x1: 10,
    y1: 20,
  });
});
