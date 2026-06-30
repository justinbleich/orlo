import assert from "node:assert/strict";
import { test } from "node:test";
import { createNode } from "@rn-canvas/document";
import {
  firstSelectableChild,
  nextLayerSelection,
  normalizeNodeSelection,
  parentLayerSelection,
  selectionRange,
  shareParent,
} from "./selection";

const nested = createNode("View", {
  id: "root",
  children: [
    createNode("View", {
      id: "group",
      children: [createNode("Text", { id: "nested", props: { text: "Nested" } })],
    }),
    createNode("Text", { id: "sibling", props: { text: "Sibling" } }),
  ],
});

test("selection removes descendants of selected ancestors", () => {
  assert.deepEqual(
    normalizeNodeSelection(nested, ["group", "nested", "sibling"]),
    ["group", "sibling"],
  );
});

test("selection removes duplicates, missing ids, and optionally the root", () => {
  assert.deepEqual(
    normalizeNodeSelection(nested, ["missing", "nested", "nested", "root"], {
      excludeRoot: true,
    }),
    ["nested"],
  );
});

test("grouping requires at least two normalized siblings", () => {
  assert.equal(shareParent(nested, ["group", "sibling"]), true);
  assert.equal(shareParent(nested, ["group", "nested"]), false);
  assert.equal(shareParent(nested, ["nested"]), false);
});

test("layer ranges follow tree order without parent-child overlap", () => {
  assert.deepEqual(selectionRange(nested, "nested", "sibling"), ["nested", "sibling"]);
  assert.deepEqual(selectionRange(nested, "group", "sibling"), ["group", "sibling"]);
});

test("keyboard layer traversal follows selectable tree order", () => {
  const root = createNode("View", {
    id: "root",
    children: [
      createNode("View", {
        id: "visible",
        children: [
          createNode("Text", { id: "hidden", props: { text: "Hidden" }, design: { hidden: true } }),
          createNode("Text", { id: "locked", props: { text: "Locked" }, design: { locked: true } }),
          createNode("Text", { id: "child", props: { text: "Child" } }),
        ],
      }),
      createNode("Text", { id: "next", props: { text: "Next" } }),
    ],
  });

  assert.equal(nextLayerSelection(root, undefined, 1, { includeRoot: true }), "root");
  assert.equal(nextLayerSelection(root, "root", 1, { includeRoot: true }), "visible");
  assert.equal(nextLayerSelection(root, "visible", 1, { includeRoot: true }), "child");
  assert.equal(nextLayerSelection(root, "child", 1, { includeRoot: true }), "next");
  assert.equal(nextLayerSelection(root, "root", -1, { includeRoot: true }), "next");
});

test("keyboard drill selection enters children and escapes to parent", () => {
  assert.equal(firstSelectableChild(nested, "root"), "group");
  assert.equal(firstSelectableChild(nested, "sibling"), undefined);
  assert.equal(parentLayerSelection(nested, "nested"), "group");
  assert.equal(parentLayerSelection(nested, "root"), "root");
});
