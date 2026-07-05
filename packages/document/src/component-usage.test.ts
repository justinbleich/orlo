import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInstance,
  createNode,
  useDocumentStore,
  type ComponentDefinition,
  type ComponentInstanceNode,
} from "./index";

function definition(id: string, name: string): ComponentDefinition {
  return {
    id,
    name,
    template: createNode("View", { id: `${id}-template` }),
    props: [],
  };
}

test("getComponentUsage finds screen placements and slot children", () => {
  const card = definition("c1", "Card");
  const wrapper = definition("c2", "Wrapper");
  const wrapperInstance: ComponentInstanceNode = {
    ...createInstance("c2", { id: "wrapper-use" }),
    slots: { content: [createInstance("c1", { id: "slot-card" })] },
  };
  const root = createNode("View", {
    id: "screen",
    children: [createInstance("c1", { id: "screen-card" }), wrapperInstance],
  });

  const store = useDocumentStore.getState();
  store.loadRoots({ screen: root }, [], { c1: card, c2: wrapper }, {});

  assert.deepEqual(useDocumentStore.getState().getComponentUsage("c1"), [
    { rootId: "screen", nodeId: "screen-card" },
    { rootId: "screen", nodeId: "slot-card" },
  ]);
});

test("getComponentUsage includes other component templates", () => {
  const card = definition("c1", "Card");
  const wrapper: ComponentDefinition = {
    ...definition("c2", "Wrapper"),
    template: createNode("View", {
      id: "wrapper-template",
      children: [createInstance("c1", { id: "template-card" })],
    }),
  };

  const store = useDocumentStore.getState();
  store.loadRoots({}, [], { c1: card, c2: wrapper }, {});

  assert.deepEqual(useDocumentStore.getState().getComponentUsage("c1"), [
    { rootId: "c2", nodeId: "template-card" },
  ]);
});

test("getComponentUsage skips the transient component edit root", () => {
  const card: ComponentDefinition = {
    ...definition("c1", "Card"),
    template: createNode("View", {
      id: "card-template",
      children: [createInstance("c2", { id: "inner-wrapper" })],
    }),
  };
  const wrapper = definition("c2", "Wrapper");
  const root = createNode("View", {
    id: "screen",
    children: [createInstance("c2", { id: "screen-wrapper" })],
  });

  const store = useDocumentStore.getState();
  store.loadRoots({ screen: root }, [], { c1: card, c2: wrapper }, {});
  store.beginComponentEdit("c1");

  assert.deepEqual(useDocumentStore.getState().getComponentUsage("c2"), [
    { rootId: "screen", nodeId: "screen-wrapper" },
    { rootId: "c1", nodeId: "inner-wrapper" },
  ]);
});
