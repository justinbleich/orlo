import { test } from "node:test";
import assert from "node:assert/strict";
import { createNode } from "@rn-canvas/document";
import { draggedBlock, resolveDrop } from "./layer-tree-model";

function fixture() {
  const a = createNode("Text", { id: "a" });
  const b = createNode("Text", { id: "b" });
  const c = createNode("Text", { id: "c" });
  const box = createNode("View", { id: "box", children: [createNode("Text", { id: "inner" })] });
  return createNode("View", { id: "root", children: [a, b, c, box] });
}

test("resolveDrop before/after position among siblings", () => {
  const root = fixture();
  assert.deepEqual(resolveDrop(root, "b", "before", ["c"]), { parentId: "root", index: 1 });
  assert.deepEqual(resolveDrop(root, "b", "after", ["c"]), { parentId: "root", index: 2 });
  // Dragging from earlier in the same parent: removal shifts the target down.
  assert.deepEqual(resolveDrop(root, "c", "after", ["a"]), { parentId: "root", index: 2 });
  assert.deepEqual(resolveDrop(root, "c", "before", ["a"]), { parentId: "root", index: 1 });
});

test("resolveDrop into a container appends; into a leaf lands after it", () => {
  const root = fixture();
  assert.deepEqual(resolveDrop(root, "box", "into", ["a"]), { parentId: "box", index: 1 });
  assert.deepEqual(resolveDrop(root, "a", "into", ["c"]), { parentId: "root", index: 1 });
});

test("resolveDrop rejects invalid drops", () => {
  const root = fixture();
  assert.equal(resolveDrop(root, "a", "before", ["a"]), null); // onto itself
  assert.equal(resolveDrop(root, "inner", "before", ["box"]), null); // own subtree
  assert.equal(resolveDrop(root, "root", "before", ["a"]), null); // beside the root
  assert.equal(resolveDrop(root, "a", "before", []), null);
  assert.equal(resolveDrop(root, "missing", "before", ["a"]), null);
});

test("resolveDrop multi-drag keeps a stable first index", () => {
  const root = fixture();
  // Moving a+b after c: with both removed, c is at index 0 → insert at 1.
  assert.deepEqual(resolveDrop(root, "c", "after", ["a", "b"]), { parentId: "root", index: 1 });
});

test("draggedBlock moves the selection when the row is part of it", () => {
  const root = fixture();
  assert.deepEqual(draggedBlock(root, "a", ["a", "c"]), ["a", "c"]);
  assert.deepEqual(draggedBlock(root, "b", ["a", "c"]), ["b"]);
  // Selection containing an ancestor of the dragged row normalizes it away.
  assert.deepEqual(draggedBlock(root, "box", ["box", "inner"]), ["box"]);
});
