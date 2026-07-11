import assert from "node:assert/strict";
import test from "node:test";
import {
  createInstance,
  createNode,
  useDocumentStore,
  type ComponentDefinition,
} from "@rn-canvas/document";
import {
  reconcileIncomingComponents,
  resetDocumentForRepoSwitch,
  useWorkspaceStore,
  workspaceFlags,
} from "./workspace-store";
import type { RepoPanelContext } from "./repo-project-model";

function buttonDefinition(): ComponentDefinition {
  return {
    id: "button",
    name: "ButtonPrimary",
    template: createNode("Pressable", {
      id: "button-root",
      style: { width: 120, height: 44, backgroundColor: "#2563eb" },
      children: [createNode("Text", { id: "label", props: { text: "Go" } })],
    }),
    props: [],
  };
}

function repoContext(): RepoPanelContext {
  return {
    repoPath: "/tmp/test-repo",
    repoName: "test-repo",
    packageManager: "pnpm",
    frameworks: [],
    screens: [],
    sidecars: [{ path: "generated/Screen.rncanvas.json" }],
    assets: [],
    entrypoints: [],
  };
}

test("repo switching clears prior roots, components, tokens, and frame positions", () => {
  const screen = createNode("View", { id: "screen" });
  useDocumentStore.getState().loadRoots(
    { screen },
    ["screen"],
    { button: buttonDefinition() },
    { brand: { id: "brand", name: "brand", category: "color", value: "#2563eb" } },
  );
  useDocumentStore.getState().setFramePosition("screen", 80, 120);

  resetDocumentForRepoSwitch();

  const state = useDocumentStore.getState();
  assert.deepEqual(state.roots, {});
  assert.deepEqual(state.components, {});
  assert.deepEqual(state.tokens, {});
  assert.deepEqual(state.framePositions, {});
  assert.deepEqual(state.selection, []);
  workspaceFlags.skipCodeSync = false;
  workspaceFlags.skipTokenWrite = false;
  workspaceFlags.skipCanvasWrite = false;
});

test("sidecar hydration reconciles names that collide after codegen sanitization", () => {
  const dotted: ComponentDefinition = {
    ...buttonDefinition(),
    id: "dotted",
    name: "Button.Primary",
  };
  const flat: ComponentDefinition = {
    ...buttonDefinition(),
    id: "flat",
    name: "ButtonPrimary",
  };
  const root = createNode("View", {
    id: "screen",
    children: [createInstance("flat", { id: "instance" })],
  });

  const reconciled = reconcileIncomingComponents({ dotted }, { flat }, root);

  assert.equal(reconciled.remapped, 1);
  assert.deepEqual(reconciled.components, {});
  assert.equal(reconciled.root.type, "View");
  if (reconciled.root.type !== "View") return;
  assert.equal(reconciled.root.children[0].type, "ComponentInstance");
  if (reconciled.root.children[0].type !== "ComponentInstance") return;
  assert.equal(reconciled.root.children[0].componentId, "dotted");
});

test("Done persists a hydrated component before closing focus mode", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, body });
    if (url === "/api/repo/context") {
      return { ok: true, status: 200, json: async () => ({ context: repoContext() }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ wrote: true }) } as Response;
  }) as typeof fetch;

  try {
    useDocumentStore.getState().loadRoots({}, [], { button: buttonDefinition() }, {});
    useDocumentStore.getState().beginComponentEdit("button");
    useDocumentStore.getState().updateStyle("button", "button", { width: 222 });
    useWorkspaceStore.setState({ repoContext: repoContext() });
    workspaceFlags.managedDocument = true;

    assert.equal(await useWorkspaceStore.getState().saveComponentEdit(), true);
    assert.equal(useDocumentStore.getState().editingComponentId, null);
    assert.equal(useDocumentStore.getState().components.button.template.style.width, 222);
    const save = requests.find((request) => request.url === "/api/components/save");
    assert.ok(save);
    assert.deepEqual(save.body?.sidecarPaths, ["generated/Screen.rncanvas.json"]);
    assert.equal(
      (save.body?.definition as ComponentDefinition).template.style.width,
      222,
    );
  } finally {
    globalThis.fetch = originalFetch;
    workspaceFlags.managedDocument = false;
    workspaceFlags.skipCanvasWrite = false;
    useWorkspaceStore.setState({ repoContext: null });
    useDocumentStore.getState().loadRoots({}, []);
  }
});
