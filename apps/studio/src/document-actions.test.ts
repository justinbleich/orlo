import assert from "node:assert/strict";
import { test } from "node:test";
import {
  childrenOf,
  createNode,
  findNode,
  useDocumentStore,
} from "@rn-canvas/document";
import { deleteNodes, duplicateNodes } from "./document-actions";

function fixture() {
  return createNode("View", {
    id: "root",
    children: [
      createNode("View", {
        id: "group",
        children: [createNode("Text", { id: "nested", props: { text: "Nested" } })],
      }),
      createNode("Text", { id: "sibling", props: { text: "Sibling" } }),
    ],
  });
}

test("duplicating an ancestor and descendant clones the subtree once", () => {
  const root = fixture();
  useDocumentStore.getState().loadRoots({ [root.id]: root }, ["group", "nested"]);

  const created = duplicateNodes(root.id, ["group", "nested"]);
  const next = useDocumentStore.getState().roots[root.id];

  assert.equal(created.length, 1);
  assert.equal(childrenOf(next).length, 3);
  assert.equal(childrenOf(findNode(next, created[0])!).length, 1);
  assert.equal(useDocumentStore.getState().past.length, 1);
});

test("deleting an ancestor and descendant removes one subtree in one undo entry", () => {
  const root = fixture();
  useDocumentStore.getState().loadRoots({ [root.id]: root }, ["group", "nested"]);

  deleteNodes(root.id, ["group", "nested"]);
  const state = useDocumentStore.getState();

  assert.equal(findNode(state.roots[root.id], "group"), undefined);
  assert.equal(findNode(state.roots[root.id], "nested"), undefined);
  assert.equal(state.past.length, 1);
  state.undo();
  assert.ok(findNode(useDocumentStore.getState().roots[root.id], "nested"));
});
