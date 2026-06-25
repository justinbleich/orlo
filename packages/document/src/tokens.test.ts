import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInstance,
  createNode,
  findNode,
  reapplyTokens,
  useDocumentStore,
  validateTokenRegistry,
  type ColorToken,
  type ComponentDefinition,
  type Node,
} from "./index";

const brand = (): ColorToken => ({ id: "t1", name: "brandPrimary", category: "color", value: "#ff0000" });

function bgOf(node: Node | undefined): unknown {
  return node?.style.backgroundColor;
}

test("bindStyleToken records the binding and resolves the literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.bindStyleToken("frame", "box", "backgroundColor", "t1");

  const box = findNode(useDocumentStore.getState().roots.frame, "box")!;
  assert.equal(bgOf(box), "#ff0000");
  assert.equal(box.design?.tokens?.backgroundColor, "t1");
});

test("updateToken re-resolves every bound literal across roots and templates", () => {
  // A template node bound to the token, plus a root node bound to it.
  const template = createNode("View", {
    id: "card",
    style: { backgroundColor: "#ff0000" },
    design: { tokens: { backgroundColor: "t1" } },
  });
  const definition: ComponentDefinition = { id: "c1", name: "Card", template, props: [] };
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });

  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], { c1: definition }, { t1: brand() });
  store.bindStyleToken("frame", "box", "backgroundColor", "t1");

  store.updateToken("t1", { value: "#00ff00" });
  const next = useDocumentStore.getState();
  assert.equal(bgOf(findNode(next.roots.frame, "box")), "#00ff00", "root node re-resolves");
  assert.equal(bgOf(next.components.c1.template), "#00ff00", "component template re-resolves");
});

test("removeToken drops bindings but keeps the last resolved literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.bindStyleToken("frame", "box", "backgroundColor", "t1");

  store.removeToken("t1");
  const box = findNode(useDocumentStore.getState().roots.frame, "box")!;
  assert.equal(bgOf(box), "#ff0000", "literal is preserved");
  assert.equal(box.design?.tokens, undefined, "dangling binding is dropped");
});

test("unbindStyleToken drops the binding and keeps the literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.bindStyleToken("frame", "box", "backgroundColor", "t1");
  store.unbindStyleToken("frame", "box", "backgroundColor");

  const box = findNode(useDocumentStore.getState().roots.frame, "box")!;
  assert.equal(bgOf(box), "#ff0000");
  assert.equal(box.design?.tokens, undefined);
});

test("undo restores a token value change and its propagation", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.bindStyleToken("frame", "box", "backgroundColor", "t1");
  store.updateToken("t1", { value: "#0000ff" });
  store.undo();
  const reverted = useDocumentStore.getState();
  assert.equal(reverted.tokens.t1.value, "#ff0000");
  assert.equal(bgOf(findNode(reverted.roots.frame, "box")), "#ff0000");
});

test("validateTokenRegistry checks names, category, and color values", () => {
  assert.deepEqual(validateTokenRegistry({ t1: brand() }), []);
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), name: "1bad" } }).some((e) => e.key === "name"),
  );
  assert.ok(
    validateTokenRegistry({
      a: brand(),
      b: { ...brand(), id: "b" },
    }).some((e) => e.reason === "duplicate token name"),
  );
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), value: 42 as unknown as string } }).some(
      (e) => e.key === "value",
    ),
  );
});

test("reapplyTokens preserves identity when nothing is bound", () => {
  const tree = createNode("View", { children: [createNode("View")] });
  assert.equal(reapplyTokens(tree, { t1: brand() }), tree);
});

test("store.addRoot actually adds the root (regression: commit shape)", () => {
  const store = useDocumentStore.getState();
  store.loadRoots({}, []);
  store.addRoot(createNode("View", { id: "added" }));
  assert.ok(useDocumentStore.getState().roots.added, "addRoot adds to roots");
});
