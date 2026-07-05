import { test } from "node:test";
import assert from "node:assert/strict";
import { bindLoadedRepoScreen } from "./repo-project-model";

const screen = (rootId: string, path: string) => ({ rootId, path });
const sidecarScreen = (rootId: string, path: string, sidecarPath: string) => ({
  rootId,
  path,
  sidecarPath,
});

test("merge keeps bindings for other roots and adds the new one", () => {
  const current = { "a.tsx": screen("root-a", "a.tsx") };
  const next = bindLoadedRepoScreen(current, "b.tsx", screen("root-b", "b.tsx"), "merge");
  assert.deepEqual(Object.keys(next).sort(), ["a.tsx", "b.tsx"]);
});

test("merge evicts a prior binding of the same root under another path", () => {
  // Two sidecar files with the same embedded root id (copied fixtures):
  // opening the second replaces the canvas root, so the first path's binding
  // must go — one root, one path.
  const current = { "examples/Screen.tsx": screen("root-x", "examples/Screen.tsx") };
  const next = bindLoadedRepoScreen(
    current,
    "test-repos/Screen.tsx",
    screen("root-x", "test-repos/Screen.tsx"),
    "merge",
  );
  assert.deepEqual(Object.keys(next), ["test-repos/Screen.tsx"]);
  assert.equal(next["test-repos/Screen.tsx"].rootId, "root-x");
});

test("re-opening the same path under the same root is idempotent", () => {
  const current = { "a.tsx": screen("root-a", "a.tsx") };
  const next = bindLoadedRepoScreen(current, "a.tsx", screen("root-a", "a.tsx"), "merge");
  assert.deepEqual(Object.keys(next), ["a.tsx"]);
});

test("merge evicts a prior binding matched by sidecar path", () => {
  const current = {
    "app/index.rncanvas.json": sidecarScreen(
      "root-old",
      "app/index.rncanvas.json",
      "app/index.rncanvas.json",
    ),
  };
  const next = bindLoadedRepoScreen(
    current,
    "app/index.tsx",
    sidecarScreen("root-new", "app/index.tsx", "app/index.rncanvas.json"),
    "merge",
  );
  assert.deepEqual(Object.keys(next), ["app/index.tsx"]);
  assert.equal(next["app/index.tsx"].rootId, "root-new");
});

test("replace drops every prior binding", () => {
  const current = {
    "a.tsx": screen("root-a", "a.tsx"),
    "b.tsx": screen("root-b", "b.tsx"),
  };
  const next = bindLoadedRepoScreen(current, "c.tsx", screen("root-c", "c.tsx"), "replace");
  assert.deepEqual(Object.keys(next), ["c.tsx"]);
});
