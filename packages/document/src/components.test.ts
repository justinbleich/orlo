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
  pruneVariants,
  resolveVariant,
  upsertVariantOverride,
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

test("promoteToComponent moves screen placement from template root to instance", () => {
  const node = createNode("Pressable", {
    id: "button",
    style: {
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 40,
      height: 64,
      padding: 8,
      backgroundColor: "#2563eb",
      borderRadius: 999,
    },
    children: [createNode("Text", { props: { text: "Next" } })],
  });
  const { definition, instance: placed } = promoteToComponent(node, "ButtonPrimary");

  assert.deepEqual(definition.template.style, {
    height: 64,
    padding: 8,
    backgroundColor: "#2563eb",
    borderRadius: 999,
  });
  assert.deepEqual(placed.style, {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 40,
  });
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

test("expandComponents carries instance visibility to the expanded root", () => {
  const registry = { comp1: cardDef() };
  const screen = createNode("View", {
    id: "screen",
    children: [
      {
        id: "inst",
        type: "ComponentInstance",
        componentId: "comp1",
        overrides: {},
        style: {},
        design: { hidden: true },
      },
    ],
  });
  const expanded = expandComponents(screen, registry);
  assert.equal(expanded.type, "View");
  if (expanded.type !== "View") throw new Error("expected expanded screen root");
  assert.equal(expanded.children[0]?.design?.hidden, true);
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

test("validateComponentRegistry accepts dotted PascalCase display paths", () => {
  const def = cardDef();
  def.name = "Button.Primary";
  assert.deepEqual(validateComponentRegistry({ comp1: def }), []);
});

test("validateComponentRegistry rejects display paths with colliding emitted names", () => {
  const primary = cardDef();
  primary.id = "primary";
  primary.name = "Button.Primary";
  const flat = cardDef();
  flat.id = "flat";
  flat.name = "ButtonPrimary";
  assert.ok(
    validateComponentRegistry({ primary, flat }).some(
      (e) => e.reason === "component name collides after codegen sanitization",
    ),
  );
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

// --- Variants (Phase 2D-3) ---------------------------------------------------

/** A Button with a size axis (sm/lg) and a state axis (default/disabled), with
 *  per-combination style + visibility overrides (sm/default is the base cell). */
function buttonDef(): ComponentDefinition {
  const template = createNode("Pressable", {
    id: "root",
    style: { backgroundColor: "#2222ff", padding: 8 },
    children: [
      createNode("Text", { id: "label", props: { text: "Go" }, style: { color: "#ffffff", fontSize: 14 } }),
      createNode("View", { id: "icon", style: { width: 8, height: 8 } }),
    ],
  });
  return {
    id: "btn",
    name: "Button",
    template,
    props: [],
    variants: [
      { name: "size", values: ["sm", "lg"] },
      { name: "state", values: ["default", "disabled"] },
    ],
    combinations: [
      { values: { size: "lg", state: "default" }, overrides: [
        { nodeId: "root", style: { padding: 16 } },
        { nodeId: "label", style: { fontSize: 18 } },
      ] },
      { values: { size: "sm", state: "disabled" }, overrides: [
        { nodeId: "root", style: { opacity: 0.5 } },
        { nodeId: "icon", hidden: true },
      ] },
      // cross-axis cell: depends on BOTH size=lg and state=disabled
      { values: { size: "lg", state: "disabled" }, overrides: [
        { nodeId: "root", style: { padding: 16, opacity: 0.5 } },
      ] },
    ],
  };
}

const btnInstance = (variant?: Record<string, string>): ComponentInstanceNode => ({
  ...createInstance("btn", { id: "b1" }),
  ...(variant ? { variant } : {}),
});

test("resolveVariant defaults each axis to its first value", () => {
  const def = buttonDef();
  assert.deepEqual(resolveVariant(def, undefined), { size: "sm", state: "default" });
  assert.deepEqual(resolveVariant(def, { size: "lg" }), { size: "lg", state: "default" });
  // unknown axis/value ignored → falls back to default
  assert.deepEqual(resolveVariant(def, { size: "xl", weight: "bold" }), { size: "sm", state: "default" });
});

test("applyOverrides merges the active combination over the base", () => {
  const def = buttonDef();
  // base cell (sm/default) has no combination → untouched
  const base = applyOverrides(def, btnInstance());
  assert.equal((findNode(base, "root") as Node).style.padding, 8);

  // lg/default → root padding 16, label fontSize 18
  const lg = applyOverrides(def, btnInstance({ size: "lg" }));
  assert.equal((findNode(lg, "root") as Node).style.padding, 16);
  assert.equal((findNode(lg, "label") as Node).style.fontSize, 18);

  // sm/disabled → opacity + hidden icon
  const dis = applyOverrides(def, btnInstance({ state: "disabled" }));
  assert.equal((findNode(dis, "root") as Node).style.opacity, 0.5);
  assert.equal((findNode(dis, "icon") as Node).design?.hidden, true);
});

test("applyOverrides picks the exact cross-axis cell, not a per-axis blend", () => {
  const def = buttonDef();
  const both = applyOverrides(def, btnInstance({ size: "lg", state: "disabled" }));
  const root = findNode(both, "root") as Node;
  assert.equal(root.style.padding, 16);
  assert.equal(root.style.opacity, 0.5);
});

test("expandComponents applies the instance variant through namespaced expansion", () => {
  const registry = { btn: buttonDef() };
  const placed = btnInstance({ size: "lg" });
  const expanded = expandComponents(placed, registry);
  assert.equal(expanded.id, "b1::root");
  assert.equal(expanded.style.padding, 16);
});

test("validateComponentRegistry accepts a well-formed component-set", () => {
  assert.deepEqual(validateComponentRegistry({ btn: buttonDef() }), []);
});

test("validateComponentRegistry rejects malformed variants/combinations", () => {
  const reason = (def: ComponentDefinition) =>
    validateComponentRegistry({ btn: def }).map((e) => e.reason).join(" | ");

  const dupValue = buttonDef();
  dupValue.variants![0].values = ["sm", "sm"];
  assert.match(reason(dupValue), /duplicate value/);

  const badName = buttonDef();
  badName.variants![0].name = "1size";
  assert.match(reason(badName), /JS identifier/);

  const missingAxis = buttonDef();
  missingAxis.combinations = [{ values: { size: "lg" }, overrides: [{ nodeId: "root", style: { padding: 1 } }] }];
  assert.match(reason(missingAxis), /every axis exactly once/);

  const badValue = buttonDef();
  badValue.combinations = [{ values: { size: "lg", state: "nope" }, overrides: [{ nodeId: "root", style: { padding: 1 } }] }];
  assert.match(reason(badValue), /invalid value/);

  const badTarget = buttonDef();
  badTarget.combinations = [{ values: { size: "lg", state: "default" }, overrides: [{ nodeId: "ghost", style: { padding: 1 } }] }];
  assert.match(reason(badTarget), /not in template/);

  const badStyle = buttonDef();
  badStyle.combinations = [{ values: { size: "lg", state: "default" }, overrides: [{ nodeId: "root", style: { padding: "10px" as never } }] }];
  assert.match(reason(badStyle), /invalid variant style/);

  const axisCollidesProp = buttonDef();
  axisCollidesProp.props = [{ name: "size", valueType: "string", targets: [{ kind: "prop", nodeId: "label", path: "text" }] }];
  assert.match(reason(axisCollidesProp), /collides/);
});

test("promoteToComponent seeds empty pressables with editable button text", () => {
  const node = createNode("Pressable", {
    id: "button",
    style: { width: 120, height: 44, backgroundColor: "#2563EB" },
  });
  const { definition } = promoteToComponent(node, "ButtonPrimary");
  assert.equal(definition.template.type, "Pressable");
  assert.equal(definition.template.children?.length, 1);
  assert.equal(definition.template.children?.[0]?.type, "Text");
  assert.equal(definition.template.children?.[0]?.props.text, "Button");
});

test("promoteToComponent seeds empty card views with useful text content", () => {
  const node = createNode("View", {
    id: "card",
    style: { width: 240, height: 120, backgroundColor: "#F8FAFC" },
  });
  const { definition } = promoteToComponent(node, "TaskCard");
  assert.equal(definition.template.type, "View");
  assert.equal(definition.template.children?.length, 2);
  assert.equal(definition.template.children?.[0]?.props.text, "Task title");
  assert.equal(definition.template.children?.[1]?.props.text, "Due today");
});

test("pruneVariants drops combinations orphaned by an axis/value edit", () => {
  // remove the "lg" value → both lg/* combinations become invalid
  const def = buttonDef();
  def.variants![0].values = ["sm"];
  const pruned = pruneVariants(def);
  assert.equal(pruned.combinations!.length, 1); // only sm/disabled survives
  assert.deepEqual(pruned.combinations![0].values, { size: "sm", state: "disabled" });

  // removing an axis entirely drops every combination
  const noAxes = buttonDef();
  noAxes.variants = [];
  assert.deepEqual(pruneVariants(noAxes).combinations, []);

  // an override targeting a removed node is trimmed; an emptied combo is dropped
  const trimmed = buttonDef();
  trimmed.template = createNode("Pressable", { id: "root", style: { padding: 8 }, children: [] });
  const t = pruneVariants(trimmed);
  assert.ok(t.combinations!.every((c) => c.overrides.every((o) => o.nodeId === "root")));
});

test("reconcileInstance clamps variant selections to valid axes/values", () => {
  const def = buttonDef();
  const dirty: ComponentInstanceNode = { ...btnInstance({ size: "lg", weight: "bold" }), variant: { size: "lg", weight: "bold", state: "gone" } };
  const clean = reconcileInstance(dirty, def);
  assert.deepEqual(clean.variant, { size: "lg" }); // weight axis + bad state dropped
});

test("validateInstance flags unknown variant axes/values", () => {
  const registry = { btn: buttonDef() };
  const bad: ComponentInstanceNode = { ...btnInstance(), variant: { size: "xl" } };
  assert.match(validateInstance(bad, registry).map((e) => e.reason).join(" "), /not a value of axis/);
});

test("upsertVariantOverride sets, merges, and clears, staying sparse", () => {
  let def = buttonDef();
  def = { ...def, combinations: [] };
  // set a style override on a fresh cell
  def = upsertVariantOverride(def, { size: "lg", state: "default" }, "root", { style: { padding: 16 } });
  assert.equal(def.combinations!.length, 1);
  assert.deepEqual(def.combinations![0].overrides[0], { nodeId: "root", style: { padding: 16 } });
  // merge another key into the same cell+node
  def = upsertVariantOverride(def, { size: "lg", state: "default" }, "root", { style: { opacity: 0.8 } });
  assert.deepEqual(def.combinations![0].overrides[0].style, { padding: 16, opacity: 0.8 });
  // clearing the last key (and no hidden) removes the override → empty combo dropped
  def = upsertVariantOverride(def, { size: "lg", state: "default" }, "root", { style: { padding: undefined, opacity: undefined } });
  assert.deepEqual(def.combinations, []);
});

test("variant authoring actions flow through the store and reconcile", () => {
  const store = useDocumentStore.getState();
  const root = createNode("View", { id: "frame", children: [
    createNode("View", { id: "card", style: { backgroundColor: "#fff" } }),
  ] });
  store.loadRoots({ frame: root }, ["card"]);
  store.promoteToComponent("frame", "card", "Card");
  const cid = Object.keys(useDocumentStore.getState().components)[0];
  const tmplRoot = useDocumentStore.getState().components[cid].template.id;

  store.addVariantAxis(cid, "tone");
  // A fresh axis is a draft (no values); the first value added becomes the base.
  assert.deepEqual(useDocumentStore.getState().components[cid].variants, [
    { name: "tone", values: [] },
  ]);
  store.addVariantValue(cid, "tone", "outline"); // base/default
  store.addVariantValue(cid, "tone", "solid");
  // override the solid (non-default) cell's fill
  store.setVariantOverride(cid, { tone: "solid" }, tmplRoot, { style: { backgroundColor: "#ff0000" } });
  let def = useDocumentStore.getState().components[cid];
  assert.deepEqual(def.variants, [{ name: "tone", values: ["outline", "solid"] }]);
  assert.equal(def.combinations!.length, 1);

  // place an instance and select the solid variant → it expands red
  store.placeInstance("frame", "frame", cid);
  const instId = childrenOf(useDocumentStore.getState().roots.frame).find((c) => c.id !== "card")!.id;
  store.setInstanceVariant("frame", instId, "tone", "solid");
  const inst = findNode(useDocumentStore.getState().roots.frame, instId) as ComponentInstanceNode;
  assert.deepEqual(inst.variant, { tone: "solid" });
  const expanded = expandComponents(inst, useDocumentStore.getState().components);
  assert.equal(expanded.style.backgroundColor, "#ff0000");

  // removing the value prunes the combination and clamps the instance selection
  store.removeVariantValue(cid, "tone", "solid");
  def = useDocumentStore.getState().components[cid];
  assert.deepEqual(def.combinations, []);
  const clamped = findNode(useDocumentStore.getState().roots.frame, instId) as ComponentInstanceNode;
  assert.equal(clamped.variant?.tone, undefined);
});

test("collectUsedComponentIds is transitive and memoized per tree+registry", async () => {
  const { collectUsedComponentIds } = await import("./index");
  const inner = cardDef();
  const outer: ComponentDefinition = {
    id: "comp2",
    name: "Outer",
    template: createNode("View", {
      id: "r2",
      children: [createInstance("comp1", { id: "inner" })],
    }),
    props: [],
  };
  const unused = cardDef();
  const registry = { comp1: inner, comp2: outer, comp3: { ...unused, id: "comp3" } };
  const screen = createNode("View", {
    id: "s",
    children: [createInstance("comp2", { id: "o1" })],
  });

  const ids = collectUsedComponentIds(screen, registry);
  // Placed comp2 pulls comp1 through its template; comp3 is never referenced.
  assert.deepEqual([...ids], ["comp1", "comp2"]);
  // Same refs → memoized result object.
  assert.equal(collectUsedComponentIds(screen, registry), ids);
  // New registry ref → recomputed (fresh array), same content.
  const again = collectUsedComponentIds(screen, { ...registry });
  assert.notEqual(again, ids);
  assert.deepEqual([...again], ["comp1", "comp2"]);
  // A tree with no instances uses nothing.
  const empty = createNode("View", { id: "plain" });
  assert.deepEqual([...collectUsedComponentIds(empty, registry)], []);
});
