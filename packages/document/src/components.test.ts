import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOverrides,
  createInstance,
  createNode,
  expandComponents,
  findNode,
  ownerInstanceId,
  promoteToComponent,
  useDocumentStore,
  validateComponentRegistry,
  validateInstance,
  validateTree,
  type ComponentDefinition,
  type ComponentInstanceNode,
  type Node,
} from "./index";

/** A Card with a text prop, a multi-bound color, a visibility toggle, and a slot. */
function cardDef(): ComponentDefinition {
  const template = createNode("View", {
    id: "root",
    children: [
      createNode("Text", { id: "title", props: { text: "Title" }, style: { color: "#111111" } }),
      createNode("View", { id: "icon", style: { backgroundColor: "#000000", width: 10, height: 10 } }),
      createNode("View", { id: "slot" }),
    ],
  });
  return {
    id: "comp1",
    name: "Card",
    template,
    props: [
      { name: "title", valueType: "string", default: "Title", targets: [{ kind: "prop", nodeId: "title", path: "text" }] },
      {
        name: "tint",
        valueType: "color",
        targets: [
          { kind: "style", nodeId: "title", styleKey: "color" },
          { kind: "style", nodeId: "icon", styleKey: "backgroundColor" },
        ],
      },
      { name: "showIcon", valueType: "boolean", default: true, targets: [{ kind: "visibility", nodeId: "icon" }] },
      { name: "body", valueType: "node", targets: [{ kind: "slot", nodeId: "slot" }] },
    ],
  };
}

function instance(overrides: Partial<ComponentInstanceNode> = {}): ComponentInstanceNode {
  return { ...createInstance("comp1", { id: "i1" }), ...overrides };
}

test("promoteToComponent clones the subtree and returns a referencing instance", () => {
  const node = createNode("View", { id: "n", children: [createNode("Text", { props: { text: "x" } })] });
  const { definition, instance: placed } = promoteToComponent(node, "Hero");
  assert.equal(definition.name, "Hero");
  assert.deepEqual(definition.props, []);
  assert.deepEqual(definition.template, node); // structural clone
  assert.notEqual(definition.template, node); // not the same reference
  assert.equal(placed.type, "ComponentInstance");
  assert.equal(placed.componentId, definition.id);
  assert.deepEqual(placed.overrides, {});
});

test("applyOverrides resolves text, falling back to the prop default", () => {
  const def = cardDef();
  const withValue = applyOverrides(def, instance({ overrides: { title: "Hello" } }));
  assert.equal((findNode(withValue, "title") as { props: { text: string } }).props.text, "Hello");
  const withDefault = applyOverrides(def, instance());
  assert.equal((findNode(withDefault, "title") as { props: { text: string } }).props.text, "Title");
});

test("applyOverrides drives every target of a multi-bound prop", () => {
  const out = applyOverrides(cardDef(), instance({ overrides: { tint: "#ff0000" } }));
  assert.equal(findNode(out, "title")!.style.color, "#ff0000");
  assert.equal(findNode(out, "icon")!.style.backgroundColor, "#ff0000");
});

test("applyOverrides maps visibility to design.hidden (inverted)", () => {
  const hidden = applyOverrides(cardDef(), instance({ overrides: { showIcon: false } }));
  assert.equal(findNode(hidden, "icon")!.design?.hidden, true);
  const shown = applyOverrides(cardDef(), instance({ overrides: { showIcon: true } }));
  assert.equal(findNode(shown, "icon")!.design?.hidden, false);
});

test("applyOverrides fills a slot's children from instance.slots", () => {
  const child = createNode("Text", { id: "slotted", props: { text: "in slot" } });
  const out = applyOverrides(cardDef(), instance({ slots: { body: [child] } }));
  const slot = findNode(out, "slot")!;
  assert.equal((slot as { children: Node[] }).children.length, 1);
  assert.equal(findNode(out, "slotted")!.id, "slotted");
});

test("expandComponents replaces instances and namespaces inner ids per placement", () => {
  const registry = { comp1: cardDef() };
  const screen = createNode("View", {
    id: "screen",
    children: [
      { ...createInstance("comp1", { id: "i1" }), overrides: { title: "Hello" } },
      { ...createInstance("comp1", { id: "i2" }), overrides: { title: "World" } },
    ],
  });
  const expanded = expandComponents(screen, registry);
  assert.equal((findNode(expanded, "i1::title") as { props: { text: string } }).props.text, "Hello");
  assert.equal((findNode(expanded, "i2::title") as { props: { text: string } }).props.text, "World");
  // Independent placements; no id collisions.
  assert.equal(ownerInstanceId("i1::title"), "i1");
  assert.equal(ownerInstanceId("i2::root"), "i2");
  assert.equal(ownerInstanceId("screen"), null);
});

test("expandComponents recurses through a nested instance", () => {
  const inner = cardDef();
  const outer: ComponentDefinition = {
    id: "comp2",
    name: "Outer",
    template: createNode("View", {
      id: "r2",
      children: [{ ...createInstance("comp1", { id: "inner" }), overrides: { title: "Deep" } }],
    }),
    props: [],
  };
  const registry = { comp1: inner, comp2: outer };
  const screen = createNode("View", { id: "s", children: [createInstance("comp2", { id: "o1" })] });
  const expanded = expandComponents(screen, registry);
  const deep = findNode(expanded, "o1::inner::title") as { props: { text: string } };
  assert.equal(deep.props.text, "Deep");
  assert.equal(ownerInstanceId("o1::inner::title"), "o1"); // top-level placement owns it
});

test("editing a definition changes what every instance expands to (propagation)", () => {
  // An instance with no override picks up the definition's value (here, the prop
  // default — the canonical "unset" value, which is what codegen emits). Editing
  // the definition therefore re-flows to every instance.
  const screen = createNode("View", { id: "s", children: [createInstance("comp1", { id: "i1" })] });
  const before = expandComponents(screen, { comp1: cardDef() });
  assert.equal((findNode(before, "i1::title") as { props: { text: string } }).props.text, "Title");

  const edited = cardDef();
  edited.props = edited.props.map((p) => (p.name === "title" ? { ...p, default: "Renamed" } : p));
  const after = expandComponents(screen, { comp1: edited });
  assert.equal((findNode(after, "i1::title") as { props: { text: string } }).props.text, "Renamed");

  // And a structural definition edit (a new node) shows up too.
  const grown = cardDef();
  (grown.template as { children: Node[] }).children.push(
    createNode("Text", { id: "badge", props: { text: "New" } }),
  );
  const afterGrow = expandComponents(screen, { comp1: grown });
  assert.equal((findNode(afterGrow, "i1::badge") as { props: { text: string } }).props.text, "New");
});

test("validateTree accepts a well-formed instance and rejects malformed ones", () => {
  const ok = createNode("View", { id: "s", children: [createInstance("comp1", { id: "i1" })] });
  assert.deepEqual(validateTree(ok), []);

  const badId = { id: "s2", type: "View", props: {}, style: {}, children: [
    { id: "x", type: "ComponentInstance", componentId: "", overrides: {}, style: {} },
  ] } as unknown as Node;
  assert.ok(validateTree(badId).some((e) => e.key === "componentId"));

  const badOverride = { id: "s3", type: "View", props: {}, style: {}, children: [
    { id: "y", type: "ComponentInstance", componentId: "c", overrides: { a: { nested: true } }, style: {} },
  ] } as unknown as Node;
  assert.ok(validateTree(badOverride).some((e) => e.key === "overrides.a"));
});

test("validateTree folds slot children into id-uniqueness", () => {
  const dup = createNode("Text", { id: "dup", props: { text: "a" } });
  const screen = {
    id: "screen",
    type: "View",
    props: {},
    style: {},
    children: [
      createNode("Text", { id: "dup", props: { text: "b" } }),
      { ...createInstance("comp1", { id: "i1" }), slots: { body: [dup] } },
    ],
  } as unknown as Node;
  assert.ok(validateTree(screen).some((e) => e.reason === "duplicate node id"));
});

test("validateComponentRegistry catches bad prop names, targets, and defaults", () => {
  const base = cardDef();
  const dupName: ComponentDefinition = {
    ...base,
    props: [base.props[0], { ...base.props[0] }], // duplicate "title"
  };
  assert.ok(validateComponentRegistry({ comp1: dupName }).some((e) => e.reason === "duplicate prop name"));

  const badIdent: ComponentDefinition = {
    ...base,
    props: [{ name: "1bad", valueType: "string", targets: [{ kind: "prop", nodeId: "title", path: "text" }] }],
  };
  assert.ok(validateComponentRegistry({ comp1: badIdent }).some((e) => e.reason === "prop name must be a JS identifier"));

  const noTargets: ComponentDefinition = {
    ...base,
    props: [{ name: "x", valueType: "string", targets: [] }],
  };
  assert.ok(validateComponentRegistry({ comp1: noTargets }).some((e) => e.reason === "at least one target required"));

  const missingTarget: ComponentDefinition = {
    ...base,
    props: [{ name: "x", valueType: "string", targets: [{ kind: "prop", nodeId: "ghost", path: "text" }] }],
  };
  assert.ok(validateComponentRegistry({ comp1: missingTarget }).some((e) => e.key.endsWith(".targets")));

  const badDefault: ComponentDefinition = {
    ...base,
    props: [{ name: "x", valueType: "number", default: "nope", targets: [{ kind: "prop", nodeId: "title", path: "text" }] }],
  };
  assert.ok(validateComponentRegistry({ comp1: badDefault }).some((e) => e.key.endsWith(".default")));
});

test("validateInstance checks names and value types against the registry", () => {
  const registry = { comp1: cardDef() };
  assert.ok(validateInstance(createInstance("ghost"), registry).some((e) => e.key === "componentId"));
  assert.ok(
    validateInstance({ ...createInstance("comp1"), overrides: { nope: "x" } }, registry)
      .some((e) => e.key === "overrides.nope"),
  );
  assert.ok(
    validateInstance({ ...createInstance("comp1"), overrides: { showIcon: "yes" } }, registry)
      .some((e) => e.reason === "expected a boolean"),
  );
  assert.deepEqual(validateInstance({ ...createInstance("comp1"), overrides: { title: "ok" } }, registry), []);
});

test("store: promote → place → override, with undo restoring the registry", () => {
  const screen = createNode("View", {
    id: "frame",
    children: [createNode("Text", { id: "label", props: { text: "Hi" } })],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: screen }, ["label"]);

  store.promoteToComponent("frame", "label", "Label");
  const afterPromote = useDocumentStore.getState();
  const componentId = Object.keys(afterPromote.components)[0];
  assert.ok(componentId, "a component was registered");
  const promoted = findNode(afterPromote.roots.frame, "label")!;
  assert.equal(promoted.type, "ComponentInstance");

  store.placeInstance("frame", "frame", componentId);
  const placed = childrenIds(useDocumentStore.getState().roots.frame);
  assert.equal(placed.length, 2, "instance placed as a sibling");

  // Expanding the frame against the registry yields primitive nodes.
  const expanded = expandComponents(useDocumentStore.getState().roots.frame, useDocumentStore.getState().components);
  assert.ok(findNode(expanded, "label::label"), "promoted instance expands to its template");

  store.undo(); // undo place
  store.undo(); // undo promote
  const reverted = useDocumentStore.getState();
  assert.deepEqual(reverted.components, {}, "undo restores the empty registry");
  assert.equal(findNode(reverted.roots.frame, "label")!.type, "Text");
});

function childrenIds(node: Node): string[] {
  return "children" in node ? (node.children as Node[]).map((c) => c.id) : [];
}

import {
  childrenOf,
  presetProp,
  pruneDefinitionProps,
  reconcileInstance,
  reconcileOverrides,
} from "./index";

test("presetProp maps each preset to the general binding model", () => {
  assert.deepEqual(presetProp("title", "text", "t"), {
    name: "title", valueType: "string", targets: [{ kind: "prop", nodeId: "t", path: "text" }],
  });
  assert.deepEqual(presetProp("tint", "color", "t", "backgroundColor"), {
    name: "tint", valueType: "color", targets: [{ kind: "style", nodeId: "t", styleKey: "backgroundColor" }],
  });
  assert.equal(presetProp("show", "visibility", "t").valueType, "boolean");
  assert.equal(presetProp("body", "slot", "t").valueType, "node");
});

test("reconcileInstance drops overrides/slots for props that no longer exist", () => {
  const def = cardDef(); // exposes title, tint, showIcon, body
  const inst = instance({ overrides: { title: "Hi", gone: "x" }, slots: { body: [], ghost: [] } });
  const reconciled = reconcileInstance(inst, def);
  assert.deepEqual(Object.keys(reconciled.overrides), ["title"]);
  assert.deepEqual(Object.keys(reconciled.slots ?? {}), ["body"]);
  // Unchanged instance keeps its reference.
  assert.equal(reconcileInstance(instance({ overrides: { title: "Hi" } }), def).overrides.title, "Hi");
});

test("pruneDefinitionProps drops targets for missing nodes and empty props", () => {
  const base = cardDef();
  const withGhost: ComponentDefinition = {
    ...base,
    props: [
      { name: "a", valueType: "string", targets: [{ kind: "prop", nodeId: "title", path: "text" }, { kind: "prop", nodeId: "ghost", path: "text" }] },
      { name: "b", valueType: "string", targets: [{ kind: "prop", nodeId: "ghost", path: "text" }] },
    ],
  };
  const pruned = pruneDefinitionProps(withGhost);
  assert.equal(pruned.props.length, 1, "prop with only-missing targets removed");
  assert.equal(pruned.props[0].name, "a");
  assert.equal(pruned.props[0].targets.length, 1, "missing target dropped");
});

test("store: begin/end component edit hosts the template and writes it back", () => {
  const screen = createNode("View", {
    id: "frame",
    children: [createNode("View", { id: "card", children: [createNode("Text", { id: "label", props: { text: "Hi" } })] })],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: screen }, ["card"]);
  store.promoteToComponent("frame", "card", "Card");
  const cid = Object.keys(useDocumentStore.getState().components)[0];

  store.beginComponentEdit(cid);
  let s = useDocumentStore.getState();
  assert.ok(s.roots[cid], "template hosted as a transient root");
  assert.equal(s.editingComponentId, cid);
  assert.deepEqual(s.selection, [cid]);

  store.insertChild(cid, cid, createNode("Text", { id: "badge", props: { text: "New" } }));
  store.endComponentEdit(true);
  s = useDocumentStore.getState();
  assert.equal(s.editingComponentId, null);
  assert.equal(s.roots[cid], undefined, "transient root removed on exit");
  assert.ok(findNode(s.components[cid].template, "badge"), "definition gained the node");

  store.undo(); // undo end → back in edit mode
  assert.equal(useDocumentStore.getState().editingComponentId, cid);
});

test("store: definition edits preserve overrides; removing a prop drops them", () => {
  const screen = createNode("View", {
    id: "frame",
    children: [createNode("View", { id: "card", children: [createNode("Text", { id: "label", props: { text: "Hi" } })] })],
  });
  const store = useDocumentStore.getState();
  store.loadRoots({ frame: screen }, ["card"]);
  store.promoteToComponent("frame", "card", "Card");
  const cid = Object.keys(useDocumentStore.getState().components)[0];
  store.updateComponent(cid, { props: [presetProp("title", "text", "label")] });
  store.placeInstance("frame", "frame", cid);
  const instId = childrenOf(useDocumentStore.getState().roots.frame).find((c) => c.id !== "card")!.id;
  store.setInstanceOverride("frame", instId, "title", "Custom");

  // Structural definition edit keeps the override.
  store.beginComponentEdit(cid);
  store.insertChild(cid, cid, createNode("Text", { id: "badge", props: { text: "x" } }));
  store.endComponentEdit(true);
  const overrideOf = (id: string) =>
    (findNode(useDocumentStore.getState().roots.frame, id) as ComponentInstanceNode).overrides.title;
  assert.equal(overrideOf(instId), "Custom");

  // Removing the prop reconciles the override away.
  store.updateComponent(cid, { props: [] });
  assert.equal(overrideOf(instId), undefined);
});
