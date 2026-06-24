import assert from "node:assert/strict";
import { test } from "node:test";
import { createNode } from "@rn-canvas/document";
import { normalizeNodeSelection, selectionRange, shareParent } from "./selection";

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
