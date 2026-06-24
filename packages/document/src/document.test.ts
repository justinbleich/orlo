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
  useDocumentStore,
  validateDesign,
  validateProps,
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

test("prop validation is fail-closed for every primitive", () => {
  for (const type of [
    "View",
    "Text",
    "Image",
    "Pressable",
    "ScrollView",
    "TextInput",
    "FlatList",
  ] as const) {
    assert.match(validateProps(type, { unexpected: true })[0]?.reason ?? "", /unknown/);
  }
});

test("prop validation checks every optional primitive field", () => {
  assert.ok(validateProps("Text", { text: "x", numberOfLines: -1 }).length > 0);
  assert.ok(
    validateProps("Image", { source: { uri: "a", require: "b" } }).length > 0,
  );
  assert.ok(validateProps("Pressable", { disabled: "yes" }).length > 0);
  assert.ok(validateProps("ScrollView", { horizontal: 1 }).length > 0);
  assert.ok(validateProps("ScrollView", { showsScrollIndicator: "yes" }).length > 0);
  assert.ok(validateProps("TextInput", { placeholder: 1 }).length > 0);
  assert.ok(validateProps("TextInput", { value: false }).length > 0);
  assert.ok(validateProps("TextInput", { secureTextEntry: "yes" }).length > 0);
  assert.ok(validateProps("TextInput", { editable: "yes" }).length > 0);
  assert.ok(validateProps("FlatList", { data: [], horizontal: "yes" }).length > 0);
});

test("FlatList data must be JSON-serializable", () => {
  assert.deepEqual(validateProps("FlatList", { data: [{ id: "1" }] }), []);
  assert.ok(validateProps("FlatList", { data: [undefined] }).length > 0);
  assert.ok(validateProps("FlatList", { data: [Number.NaN] }).length > 0);
});

test("design metadata validation is fail-closed", () => {
  assert.deepEqual(
    validateDesign({
      name: "Card",
      locked: false,
      hidden: true,
      annotations: [{ id: "a", text: "note" }],
    }),
    [],
  );
  assert.ok(validateDesign({ locked: "yes" }).length > 0);
  assert.ok(validateDesign({ annotations: [{ id: "a", text: 2 }] }).length > 0);
  assert.ok(validateDesign({ custom: true }).length > 0);
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
  assert.equal((findNode(t, "sample-text") as { props: { text: string } }).props.text, "Updated");
  assert.equal((findNode(sampleDocument, "sample-text") as { props: { text: string } }).props.text, "Hello RN Canvas");
  assert.throws(() => updateProps(t, "sample-text", { text: 5 as never }), /Invalid props/);
});

test("updateStyle validates at the boundary", () => {
  const t = updateStyle(sampleDocument, "sample-root", { padding: 24 });
  assert.equal(findNode(t, "sample-root")!.style.padding, 24);
  assert.throws(() => updateStyle(t, "sample-root", { padding: "24px" as never }), /Invalid RNStyle/);
});

test("undefined updates remove optional fields for JSON-stable sidecars", () => {
  const input = createNode("Text", {
    props: { text: "body", numberOfLines: 2 },
    style: { fontSize: 16 },
    design: { name: "Label" },
  });
  let next = updateProps(input, input.id, { numberOfLines: undefined });
  next = updateStyle(next, input.id, { fontSize: undefined });
  next = updateDesign(next, input.id, { name: undefined });
  assert.equal("numberOfLines" in (next as { props: object }).props, false);
  assert.equal("fontSize" in next.style, false);
  assert.equal("design" in next, false);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});

test("updateDesign sets metadata (locked/hidden)", () => {
  const t = updateDesign(sampleDocument, "sample-image", { locked: true, name: "logo" });
  assert.equal(findNode(t, "sample-image")!.design?.locked, true);
  assert.equal(findNode(t, "sample-image")!.design?.name, "logo");
});

test("sampleDocument is a valid tree", () => {
  assert.deepEqual(validateTree(sampleDocument), []);
});

test("tree validation rejects duplicate ids and malformed children", () => {
  const duplicate = {
    ...createNode("View", { id: "same" }),
    children: [createNode("Text", { id: "same" })],
  };
  assert.ok(
    validateTree(duplicate as never).some((error) => error.reason === "duplicate node id"),
  );

  const malformed = { ...createNode("View"), children: [null] } as never;
  assert.ok(validateTree(malformed).some((error) => error.key === "children"));
});

test("loadRoots atomically opens a document with fresh history", () => {
  const store = useDocumentStore.getState();
  store.loadRoots({ [sampleDocument.id]: sampleDocument }, [sampleDocument.id]);
  store.updateStyle(sampleDocument.id, sampleDocument.id, { padding: 24 });
  assert.equal(useDocumentStore.getState().past.length, 1);

  const next = createNode("View", { id: "opened-root" });
  useDocumentStore.getState().loadRoots({ [next.id]: next });
  const opened = useDocumentStore.getState();
  assert.deepEqual(Object.keys(opened.roots), [next.id]);
  assert.deepEqual(opened.selection, [next.id]);
  assert.equal(opened.past.length, 0);
  assert.equal(opened.future.length, 0);
});

test("loadRoots validates the sidecar tree boundary", () => {
  const invalid = {
    ...sampleDocument,
    style: { width: "320px" },
  } as never;
  assert.throws(
    () => useDocumentStore.getState().loadRoots({ "sample-root": invalid }),
    /Invalid document root/,
  );
});

test("an interaction commits many writes as one undo entry", () => {
  const root = createNode("View", { id: "gesture-root" });
  const store = useDocumentStore.getState();
  store.loadRoots({ [root.id]: root }, [root.id]);
  store.beginInteraction();
  store.updateStyle(root.id, root.id, { width: 100 });
  store.updateStyle(root.id, root.id, { width: 120 });
  store.updateStyle(root.id, root.id, { width: 140 });
  assert.equal(useDocumentStore.getState().past.length, 0);
  store.commitInteraction();
  assert.equal(useDocumentStore.getState().past.length, 1);
  store.undo();
  assert.equal(useDocumentStore.getState().roots[root.id].style.width, undefined);
});

test("undo restores a removed root with its complete subtree", () => {
  const store = useDocumentStore.getState();
  store.loadRoots({ [sampleDocument.id]: sampleDocument }, [sampleDocument.id]);

  store.removeRoot(sampleDocument.id);
  assert.deepEqual(useDocumentStore.getState().roots, {});
  store.undo();

  assert.deepEqual(useDocumentStore.getState().roots[sampleDocument.id], sampleDocument);
  assert.deepEqual(useDocumentStore.getState().selection, [sampleDocument.id]);
});

test("undo removes an inserted child and restores the prior selection", () => {
  const store = useDocumentStore.getState();
  store.loadRoots({ [sampleDocument.id]: sampleDocument }, ["sample-text"]);
  const child = createNode("Text", { props: { text: "Temporary" } });

  store.insertChild(sampleDocument.id, sampleDocument.id, child);
  store.setSelection([child.id]);
  assert.ok(findNode(useDocumentStore.getState().roots[sampleDocument.id], child.id));
  store.undo();

  assert.equal(findNode(useDocumentStore.getState().roots[sampleDocument.id], child.id), undefined);
  assert.deepEqual(useDocumentStore.getState().selection, ["sample-text"]);
});

test("cancelling an interaction restores roots and selection", () => {
  const root = createNode("View", { id: "cancel-root" });
  const store = useDocumentStore.getState();
  store.loadRoots({ [root.id]: root }, [root.id]);
  store.beginInteraction();
  store.updateStyle(root.id, root.id, { height: 200 });
  store.setSelection([]);
  store.cancelInteraction();
  const state = useDocumentStore.getState();
  assert.equal(state.roots[root.id].style.height, undefined);
  assert.deepEqual(state.selection, [root.id]);
  assert.equal(state.past.length, 0);
});
