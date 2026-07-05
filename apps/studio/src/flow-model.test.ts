import assert from "node:assert/strict";
import { test } from "node:test";
import { createNode } from "@rn-canvas/document";
import {
  addFlowRoute,
  addFlowEdge,
  deriveLinearEdges,
  flowAvailableScreens,
  flowGraphLayers,
  flowRouteScreens,
  resolveFlowRouteIdMap,
  flowScreenKey,
  inferredFlowScreens,
  knownRootIdSet,
  moveFlowRouteToIndex,
  pruneFlowEdges,
  removeFlowEdge,
  removeFlowRoute,
  reorderFlowRoute,
  resolveFlowRouteIds,
  routeStillExists,
  updateFlowEdge,
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

test("flow route descriptors recover stale root ids from stable screen metadata", () => {
  const reloaded = [
    createNode("View", { id: "fresh-welcome", design: { name: "Welcome" } }),
    createNode("View", { id: "fresh-login", design: { name: "Login" } }),
  ];
  assert.deepEqual(
    resolveFlowRouteIds(reloaded, [
      { rootId: "stale-welcome", screenKey: flowScreenKey(screens[0], 0), name: "Welcome" },
      { rootId: "stale-login", name: "Login" },
    ]),
    ["fresh-welcome", "fresh-login"],
  );
  assert.deepEqual(
    [...resolveFlowRouteIdMap(reloaded, [
      { rootId: "stale-welcome", screenKey: flowScreenKey(screens[0], 0), name: "Welcome" },
      { rootId: "stale-login", name: "Login" },
    ]).entries()],
    [
      ["fresh-welcome", "fresh-welcome"],
      ["stale-welcome", "fresh-welcome"],
      ["fresh-login", "fresh-login"],
      ["stale-login", "fresh-login"],
    ],
  );
});

test("flow route descriptors recover unnamed screens from display order", () => {
  const before = [createNode("View", { id: "old-root" })];
  const after = [createNode("View", { id: "fresh-root" })];
  assert.deepEqual(
    resolveFlowRouteIds(after, [
      { rootId: before[0].id, screenKey: flowScreenKey(before[0], 0), name: "Screen 1" },
    ]),
    ["fresh-root"],
  );
});

test("flow graph helpers derive and prune route edges", () => {
  assert.deepEqual(deriveLinearEdges(["welcome", "login", "home"]), [
    { from: { rootId: "welcome" }, to: "login", kind: "primary" },
    { from: { rootId: "login" }, to: "home", kind: "primary" },
  ]);
  assert.deepEqual(
    pruneFlowEdges(
      [
        { from: { rootId: "welcome" }, to: "login", kind: "primary" },
        { from: { rootId: "missing" }, to: "home", kind: "primary" },
      ],
      ["welcome", "login"],
    ),
    [{ from: { rootId: "welcome" }, to: "login", kind: "primary" }],
  );
});

test("flow edge mutations are deduped and endpoint-safe", () => {
  const routes = ["welcome", "login", "home"];
  const first = addFlowEdge([], routes, {
    from: { rootId: "welcome", anchorNodeId: "button" },
    to: "login",
    kind: "primary",
  });
  assert.equal(addFlowEdge(first, routes, first[0]).length, 1);
  assert.equal(addFlowEdge(first, routes, { from: { rootId: "home" }, to: "missing", kind: "primary" }).length, 1);
  const updated = updateFlowEdge(first, routes, 0, {
    to: "home",
    kind: "conditional",
    condition: "email verified",
  });
  assert.deepEqual(updated, [
    {
      from: { rootId: "welcome", anchorNodeId: "button" },
      to: "home",
      kind: "conditional",
      condition: "email verified",
    },
  ]);
  assert.deepEqual(removeFlowEdge(updated, routes, { kind: "conditional", to: "home" }), []);
});

test("flowGraphLayers layers reachable branches from the entry", () => {
  assert.deepEqual(
    flowGraphLayers(
      "welcome",
      [
        { from: { rootId: "welcome" }, to: "login", kind: "primary" },
        { from: { rootId: "welcome" }, to: "home", kind: "conditional" },
        { from: { rootId: "login" }, to: "home", kind: "primary" },
      ],
      ["welcome", "login", "home", "settings"],
    ),
    [
      { depth: 0, rootIds: ["welcome", "settings"] },
      { depth: 1, rootIds: ["login", "home"] },
    ],
  );
});

test("routeStillExists keeps everything until the repo scan lands", () => {
  const known = new Set<string>();
  assert.equal(routeStillExists({ path: "app/gone.tsx" }, null, known), true);
  assert.equal(routeStillExists({ rootId: "ghost" }, null, known), true);
});

test("routeStillExists checks path routes against the scan", () => {
  const context = {
    screens: [{ path: "app/index.tsx", sidecarPath: "app/index.rncanvas.json" }],
  };
  const known = new Set<string>();
  assert.equal(routeStillExists({ path: "app/index.tsx" }, context, known), true);
  assert.equal(routeStillExists({ path: "app/index.rncanvas.json" }, context, known), true);
  assert.equal(routeStillExists({ path: "app/deleted.tsx" }, context, known), false);
});

test("routeStillExists prunes pathless routes with unknown roots", () => {
  const context = { screens: [] };
  const known = knownRootIdSet(
    screens,
    [{ rootId: "loaded-root" }],
    { sidecars: [{ rootId: "sidecar-root" }, {}] },
  );
  // Pre-v3 leftovers: alive only while their root is still accounted for.
  assert.equal(routeStillExists({ rootId: "welcome" }, context, known), true);
  assert.equal(routeStillExists({ rootId: "loaded-root" }, context, known), true);
  assert.equal(routeStillExists({ rootId: "sidecar-root" }, context, known), true);
  assert.equal(routeStillExists({ rootId: "ghost-draft" }, context, known), false);
  assert.equal(routeStillExists({}, context, known), false);
});
