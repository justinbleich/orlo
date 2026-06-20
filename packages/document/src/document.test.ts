import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNode,
  findNode,
  getParent,
  insertChild,
  removeNode,
  moveNode,
  reorderChild,
  updateProps,
  updateStyle,
  updateDesign,
  validateTree,
  childrenOf,
} from "./index";
import { sampleDocument } from "./sample";

test("createNode applies defaults and a fresh id", () => {
  const a = createNode("Text");
  const b = createNode("Text");
  assert.notEqual(a.id, b.id);
  assert.equal(a.type, "Text");
  assert.equal((a.props as { text: string }).text, "Text");
});

test("createNode rejects an invalid style", () => {
  assert.throws(() => createNode("View", { style: { width: "10px" } as never }), /Invalid RNStyle/);
});

test("createNode rejects children on a leaf type", () => {
  assert.throws(
    () => createNode("Text", { children: [createNode("View")] }),
    /cannot have children/,
  );
});

test("insertChild is immutable and adds at index", () => {
  const root = createNode("View");
  const child = createNode("Text", { id: "c1" });
  const next = insertChild(root, root.id, child);
  assert.notEqual(next, root);
  assert.equal(childrenOf(root).length, 0); // original untouched
  assert.equal(childrenOf(next).length, 1);
  assert.equal(childrenOf(next)[0].id, "c1");
});

test("FlatList holds a single item template", () => {
  const list = createNode("FlatList", { id: "list" });
  const withItem = insertChild(list, "list", createNode("View"));
  assert.throws(
    () => insertChild(withItem, "list", createNode("View")),
    /single item template/,
  );
});

test("insertChild rejects a leaf parent", () => {
  const text = createNode("Text", { id: "t" });
  assert.throws(() => insertChild(text, "t", createNode("View")), /cannot have children/);
});

test("findNode and getParent traverse the tree", () => {
  assert.equal(findNode(sampleDocument, "sample-text")?.type, "Text");
  assert.equal(getParent(sampleDocument, "sample-text")?.id, "sample-root");
  assert.equal(findNode(sampleDocument, "nope"), undefined);
});

test("removeNode removes a descendant, refuses the root", () => {
  const next = removeNode(sampleDocument, "sample-image");
  assert.equal(childrenOf(next).length, 1);
  assert.throws(() => removeNode(sampleDocument, "sample-root"), /Cannot remove the root/);
});

test("moveNode refuses moving into own descendant", () => {
  const root = createNode("View", { id: "r" });
  const a = createNode("View", { id: "a" });
  const b = createNode("View", { id: "b" });
  let t = insertChild(root, "r", a);
  t = insertChild(t, "a", b);
  assert.throws(() => moveNode(t, "a", "b", 0), /into its own descendant/);
});

test("moveNode reparents", () => {
  const root = createNode("View", { id: "r" });
  const a = createNode("View", { id: "a" });
  const b = createNode("Text", { id: "b" });
  let t = insertChild(root, "r", a);
  t = insertChild(t, "r", b);
  t = moveNode(t, "b", "a", 0);
  assert.equal(getParent(t, "b")?.id, "a");
});

test("reorderChild swaps order", () => {
  const root = createNode("View", { id: "r" });
  let t = insertChild(root, "r", createNode("Text", { id: "x" }));
  t = insertChild(t, "r", createNode("Text", { id: "y" }));
  t = reorderChild(t, "r", 0, 1);
  assert.deepEqual(childrenOf(t).map((c) => c.id), ["y", "x"]);
});

test("updateProps validates and is immutable", () => {
  const t = updateProps(sampleDocument, "sample-text", { text: "Updated" });
  assert.equal((findNode(t, "sample-text")!.props as { text: string }).text, "Updated");
  assert.equal((findNode(sampleDocument, "sample-text")!.props as { text: string }).text, "Hello RN Canvas");
  assert.throws(() => updateProps(t, "sample-text", { text: 5 as never }), /Invalid props/);
});

test("updateStyle validates at the boundary", () => {
  const t = updateStyle(sampleDocument, "sample-root", { padding: 24 });
  assert.equal(findNode(t, "sample-root")!.style.padding, 24);
  assert.throws(() => updateStyle(t, "sample-root", { padding: "24px" as never }), /Invalid RNStyle/);
});

test("updateDesign sets metadata (locked/hidden)", () => {
  const t = updateDesign(sampleDocument, "sample-image", { locked: true, name: "logo" });
  assert.equal(findNode(t, "sample-image")!.design?.locked, true);
  assert.equal(findNode(t, "sample-image")!.design?.name, "logo");
});

test("sampleDocument is a valid tree", () => {
  assert.deepEqual(validateTree(sampleDocument), []);
});
