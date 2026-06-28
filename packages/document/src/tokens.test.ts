import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInstance,
  createNode,
  findNode,
  reapplyTokens,
  tokenCategoryForStyleKey,
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

test("linkStyleToken records the binding and resolves the literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");

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
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");

  store.updateToken("t1", { value: "#00ff00" });
  const next = useDocumentStore.getState();
  assert.equal(bgOf(findNode(next.roots.frame, "box")), "#00ff00", "root node re-resolves");
  assert.equal(bgOf(next.components.c1.template), "#00ff00", "component template re-resolves");
});

test("removeToken drops bindings but keeps the last resolved literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");

  store.removeToken("t1");
  const box = findNode(useDocumentStore.getState().roots.frame, "box")!;
  assert.equal(bgOf(box), "#ff0000", "literal is preserved");
  assert.equal(box.design?.tokens, undefined, "dangling binding is dropped");
});

test("unlinkStyleToken drops the binding and keeps the literal", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");
  store.unlinkStyleToken("frame", "box", "backgroundColor");

  const box = findNode(useDocumentStore.getState().roots.frame, "box")!;
  assert.equal(bgOf(box), "#ff0000");
  assert.equal(box.design?.tokens, undefined);
});

test("undo restores a token value change and its propagation", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, { t1: brand() });
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");
  store.updateToken("t1", { value: "#0000ff" });
  store.undo();
  const reverted = useDocumentStore.getState();
  assert.equal(reverted.tokens.t1.value, "#ff0000");
  assert.equal(bgOf(findNode(reverted.roots.frame, "box")), "#ff0000");
});

test("validateTokenRegistry accepts dotted names (color.primary.500)", () => {
  assert.deepEqual(
    validateTokenRegistry({ t1: { ...brand(), name: "color.primary.500" } }),
    [],
  );
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), name: "color..primary" } }).some(
      (e) => e.key === "name",
    ),
    "double-dot is rejected",
  );
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), name: ".primary" } }).some((e) => e.key === "name"),
    "leading dot is rejected",
  );
});

test("validateTokenRegistry checks names, category, and color values", () => {
  assert.deepEqual(validateTokenRegistry({ t1: brand() }), []);
  assert.deepEqual(
    validateTokenRegistry({
      t1: { ...brand(), value: "rgba(59, 130, 246, 0.64)" },
    }),
    [],
    "alpha-capable RN color strings are valid color tokens",
  );
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), name: "1bad" } }).some((e) => e.key === "name"),
  );
  assert.ok(
    validateTokenRegistry({
      a: brand(),
      b: { ...brand(), id: "b" },
    }).some((e) => e.reason === "duplicate token name in category"),
  );
  assert.ok(
    validateTokenRegistry({ t1: { ...brand(), value: 42 as unknown as string } }).some(
      (e) => e.key === "value",
    ),
  );
});

test("spacing/fontSize tokens are number-valued and bind by style-key category", () => {
  const spacing = { s4: { id: "s4", name: "space4", category: "spacing" as const, value: 4 } };
  assert.deepEqual(validateTokenRegistry(spacing), []);
  assert.ok(
    validateTokenRegistry({ s4: { ...spacing.s4, value: "4px" as unknown as number } }).some(
      (e) => e.key === "value",
    ),
  );
  assert.equal(tokenCategoryForStyleKey("padding"), "spacing");
  assert.equal(tokenCategoryForStyleKey("fontSize"), "fontSize");
  assert.equal(tokenCategoryForStyleKey("backgroundColor"), "color");
  assert.equal(tokenCategoryForStyleKey("flexDirection"), null);

  // Binding a spacing token writes its numeric value to the style key.
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, spacing);
  store.linkStyleToken("frame", "box", "padding", "s4");
  assert.equal(findNode(useDocumentStore.getState().roots.frame, "box")!.style.padding, 4);
});

test("reapplyTokens preserves identity when nothing is bound", () => {
  const tree = createNode("View", { children: [createNode("View")] });
  assert.equal(reapplyTokens(tree, { t1: brand() }), tree);
});

test("promoteStyleToToken creates the token AND links the style key in one step", () => {
  const root = createNode("View", {
    id: "frame",
    children: [createNode("View", { id: "box", style: { backgroundColor: "#abcdef" } })],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, {});
  const id = store.promoteStyleToToken("frame", "box", "backgroundColor", "accent");
  const next = useDocumentStore.getState();
  assert.equal(next.tokens[id]?.value, "#abcdef");
  assert.equal(next.tokens[id]?.name, "accent");
  const box = findNode(next.roots.frame, "box")!;
  assert.equal(box.design?.tokens?.backgroundColor, id);
  assert.equal(bgOf(box), "#abcdef");
});

test("promoteStyleToToken rejects non-tokenizable style keys", () => {
  const root = createNode("View", { id: "frame", children: [createNode("View", { id: "box" })] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["box"], {}, {});
  assert.throws(() => store.promoteStyleToToken("frame", "box", "flexDirection", "x"));
});

test("getTokenUsage returns every (root, node, styleKey) currently linked", () => {
  const root = createNode("View", {
    id: "frame",
    children: [
      createNode("View", { id: "a" }),
      createNode("View", { id: "b" }),
    ],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, [], {}, { t1: brand() });
  store.linkStyleToken("frame", "a", "backgroundColor", "t1");
  store.linkStyleToken("frame", "b", "backgroundColor", "t1");
  store.linkStyleToken("frame", "b", "borderColor", "t1");
  const uses = useDocumentStore.getState().getTokenUsage("t1");
  assert.equal(uses.length, 3);
  assert.ok(uses.some((u) => u.nodeId === "a" && u.styleKey === "backgroundColor"));
  assert.ok(uses.some((u) => u.nodeId === "b" && u.styleKey === "borderColor"));
});

test("reorderToken moves within a category, preserving insertion order in Object.keys", () => {
  const reg = {
    a: { id: "a", name: "alpha", category: "color" as const, value: "#111111" },
    b: { id: "b", name: "beta", category: "color" as const, value: "#222222" },
    c: { id: "c", name: "gamma", category: "color" as const, value: "#333333" },
  };
  const store = useDocumentStore.getState();
  store.loadRoots({}, [], {}, reg);
  store.reorderToken("c", "a"); // c before a
  assert.deepEqual(Object.keys(useDocumentStore.getState().tokens), ["c", "a", "b"]);
  store.reorderToken("c", null); // c to end
  assert.deepEqual(Object.keys(useDocumentStore.getState().tokens), ["a", "b", "c"]);
});

test("reorderToken rejects cross-category drags", () => {
  const reg = {
    c1: { id: "c1", name: "alpha", category: "color" as const, value: "#111111" },
    s1: { id: "s1", name: "small", category: "spacing" as const, value: 4 },
  };
  const store = useDocumentStore.getState();
  store.loadRoots({}, [], {}, reg);
  assert.throws(() => store.reorderToken("c1", "s1"));
});

test("linkInstanceToken resolves the override + a value change propagates", () => {
  const def: ComponentDefinition = {
    id: "c1",
    name: "Btn",
    template: createNode("View", { id: "tpl" }),
    props: [
      {
        name: "tint",
        valueType: "color",
        targets: [{ kind: "style", nodeId: "tpl", styleKey: "backgroundColor" }],
      },
    ],
  };
  const instance = createInstance("c1", { id: "i1" });
  const root = createNode("View", { id: "frame", children: [instance] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["i1"], { c1: def }, { t1: brand() });

  store.linkInstanceToken("frame", "i1", "tint", "t1");
  let inst = findNode(useDocumentStore.getState().roots.frame, "i1") as Extract<
    Node,
    { type: "ComponentInstance" }
  >;
  assert.equal(inst.overrides.tint, "#ff0000");
  assert.equal(inst.tokens?.tint, "t1");

  store.updateToken("t1", { value: "#00ff00" });
  inst = findNode(useDocumentStore.getState().roots.frame, "i1") as Extract<
    Node,
    { type: "ComponentInstance" }
  >;
  assert.equal(inst.overrides.tint, "#00ff00", "override re-resolves");

  store.removeToken("t1");
  inst = findNode(useDocumentStore.getState().roots.frame, "i1") as Extract<
    Node,
    { type: "ComponentInstance" }
  >;
  assert.equal(inst.overrides.tint, "#00ff00", "literal preserved");
  assert.equal(inst.tokens, undefined, "dangling link dropped");
});

test("promoteInstanceOverrideToToken creates + links the override atomically", () => {
  const def: ComponentDefinition = {
    id: "c1",
    name: "Btn",
    template: createNode("View", { id: "tpl" }),
    props: [
      {
        name: "tint",
        valueType: "color",
        default: "#abcdef",
        targets: [{ kind: "style", nodeId: "tpl", styleKey: "backgroundColor" }],
      },
    ],
  };
  const instance = createInstance("c1", { id: "i1" });
  instance.overrides.tint = "#123456";
  const root = createNode("View", { id: "frame", children: [instance] });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, ["i1"], { c1: def }, {});

  const id = store.promoteInstanceOverrideToToken("frame", "i1", "tint", "color", "brand");
  const next = useDocumentStore.getState();
  assert.equal(next.tokens[id]?.value, "#123456");
  const inst = findNode(next.roots.frame, "i1") as Extract<Node, { type: "ComponentInstance" }>;
  assert.equal(inst.tokens?.tint, id);
});

test("getTokenUsage reports both style links and instance-override links", () => {
  const def: ComponentDefinition = {
    id: "c1",
    name: "Btn",
    template: createNode("View", { id: "tpl" }),
    props: [
      {
        name: "tint",
        valueType: "color",
        targets: [{ kind: "style", nodeId: "tpl", styleKey: "backgroundColor" }],
      },
    ],
  };
  const instance = createInstance("c1", { id: "i1" });
  const root = createNode("View", {
    id: "frame",
    children: [createNode("View", { id: "box" }), instance],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: root }, [], { c1: def }, { t1: brand() });
  store.linkStyleToken("frame", "box", "backgroundColor", "t1");
  store.linkInstanceToken("frame", "i1", "tint", "t1");

  const uses = useDocumentStore.getState().getTokenUsage("t1");
  assert.ok(uses.some((u) => u.kind === "style" && u.nodeId === "box"));
  assert.ok(uses.some((u) => u.kind === "override" && u.nodeId === "i1" && u.styleKey === "tint"));
});

test("store.addRoot actually adds the root (regression: commit shape)", () => {
  const store = useDocumentStore.getState();
  store.loadRoots({}, []);
  store.addRoot(createNode("View", { id: "added" }));
  assert.ok(useDocumentStore.getState().roots.added, "addRoot adds to roots");
});
