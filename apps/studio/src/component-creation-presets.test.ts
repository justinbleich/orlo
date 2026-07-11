import { test } from "node:test";
import assert from "node:assert/strict";
import { createNode, type ComponentDefinition } from "@rn-canvas/document";
import {
  applyCreationPreset,
  supportedCreationPresets,
} from "./component-creation-presets";

test("button creation preset exposes label, disabled, and state variants", () => {
  const definition: ComponentDefinition = {
    id: "button",
    name: "ButtonPrimary",
    template: createNode("Pressable", {
      id: "root",
      style: { backgroundColor: "#FFFFFF", borderColor: "#CBD5E1", borderWidth: 1 },
      children: [
        createNode("Text", { id: "label", props: { text: "Continue" } }),
      ],
    }),
    props: [],
  };

  const enhanced = applyCreationPreset(definition, "button");

  assert.deepEqual(enhanced.props.map((prop) => prop.name), ["label", "disabled"]);
  assert.deepEqual(enhanced.variants, [
    { name: "state", values: ["default", "hover", "pressed", "disabled"] },
  ]);
  assert.equal(enhanced.combinations?.length, 3);
  assert.equal(enhanced.props[0].default, "Continue");
  assert.deepEqual(enhanced.props[1].targets, [{ kind: "prop", nodeId: "root", path: "disabled" }]);
  assert.equal(enhanced.template.style.borderRadius, 12);
  assert.equal(enhanced.template.style.backgroundColor, "#2563EB");
  assert.equal(enhanced.template.style.borderWidth, 0);
  const label = enhanced.template.type === "Pressable" ? enhanced.template.children[0] : null;
  assert.equal(label?.style.color, "#FFFFFF");
});

test("card creation preset exposes text and background controls", () => {
  const definition: ComponentDefinition = {
    id: "card",
    name: "TaskCard",
    template: createNode("View", {
      id: "root",
      style: { backgroundColor: "#FFFFFF" },
      children: [
        createNode("Text", { id: "title", props: { text: "Today" } }),
        createNode("Text", { id: "subtitle", props: { text: "3 tasks" } }),
      ],
    }),
    props: [],
  };

  const enhanced = applyCreationPreset(definition, "card");

  assert.deepEqual(enhanced.props.map((prop) => prop.name), ["title", "subtitle", "background"]);
  assert.equal(enhanced.props[0].default, "Today");
  assert.equal(enhanced.props[1].default, "3 tasks");
  assert.equal(enhanced.template.style.borderRadius, 12);
  assert.deepEqual(enhanced.props[2].targets, [
    { kind: "style", nodeId: "root", styleKey: "backgroundColor" },
  ]);
});

test("creation presets are gated by selected layer type", () => {
  assert.deepEqual(supportedCreationPresets("Pressable"), ["none", "button"]);
  assert.deepEqual(supportedCreationPresets("View"), ["none", "card"]);
  assert.deepEqual(supportedCreationPresets("Text"), ["none"]);
});
