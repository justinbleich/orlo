import assert from "node:assert/strict";
import { test } from "node:test";
import { createNode } from "@rn-canvas/document";
import {
  addFlowRoute,
  flowAvailableScreens,
  flowRouteScreens,
  inferredFlowScreens,
  moveFlowRouteToIndex,
  removeFlowRoute,
  reorderFlowRoute,
} from "./flow-model";

const screens = [
  createNode("View", { id: "welcome", design: { name: "Welcome" } }),
  createNode("View", { id: "login", design: { name: "Login" } }),
  createNode("View", { id: "home", design: { name: "Home" } }),
];

test("flows infer routes until explicit route ids are present", () => {
  assert.deepEqual(inferredFlowScreens(screens, "auth").map((root) => root.id), [
    "welcome",
    "login",
  ]);
  assert.deepEqual(flowRouteScreens(screens, "auth", ["home", "missing"]).map((root) => root.id), [
    "home",
  ]);
  assert.deepEqual(flowRouteScreens(screens, "new-flow", []).map((root) => root.id), []);
});

test("flow membership helpers preserve explicit order", () => {
  assert.deepEqual(addFlowRoute(screens, "main", ["home"], "login"), ["home", "login"]);
  assert.deepEqual(addFlowRoute(screens, "main", ["home"], "home"), ["home"]);
  assert.deepEqual(removeFlowRoute(screens, "main", ["home", "login"], "home"), ["login"]);
  assert.deepEqual(reorderFlowRoute(screens, "main", ["welcome", "home", "login"], "home", -1), [
    "home",
    "welcome",
    "login",
  ]);
  assert.deepEqual(moveFlowRouteToIndex(screens, "main", ["welcome", "home", "login"], "login", 0), [
    "login",
    "welcome",
    "home",
  ]);
});

test("available screens exclude explicit routes or inferred fallback routes", () => {
  assert.deepEqual(flowAvailableScreens(screens, "auth").map((root) => root.id), ["home"]);
  assert.deepEqual(flowAvailableScreens(screens, "auth", ["home"]).map((root) => root.id), [
    "welcome",
    "login",
  ]);
});
