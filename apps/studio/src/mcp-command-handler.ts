import {
  canHaveChildren,
  createNode,
  findNode,
  findRootContaining,
  presetProp,
  useDocumentStore,
  type AnyProps,
  type DesignMeta,
  type Node,
  type RNPrimitive,
} from "@rn-canvas/document";
import { RN_PRIMITIVES } from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";
import { toPng } from "html-to-image";
import { toComponentDisplayPath } from "./component-name";
import type { BrowserCommandHandler } from "./mcp-bridge";
import { useWorkspaceStore } from "./workspace-store";

type CommandPayload = Record<string, unknown>;

function payloadOf(value: unknown): CommandPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Command payload must be an object");
  }
  return value as CommandPayload;
}

function requiredString(payload: CommandPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function rootAndNode(payload: CommandPayload) {
  const rootId = requiredString(payload, "rootId");
  const nodeId = requiredString(payload, "nodeId");
  const root = useDocumentStore.getState().roots[rootId];
  if (!root) throw new Error(`Root not found: ${rootId}`);
  if (!findNode(root, nodeId)) throw new Error(`Node not found: ${nodeId}`);
  return { rootId, nodeId };
}

function transact<T>(run: () => T): T {
  const store = useDocumentStore.getState();
  store.beginInteraction();
  try {
    const value = run();
    useDocumentStore.getState().commitInteraction();
    return value;
  } catch (error) {
    useDocumentStore.getState().cancelInteraction();
    throw error;
  }
}

async function waitForFrameSurface(rootId: string): Promise<HTMLElement> {
  const find = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-rn-root-id]")).find(
      (element) => element.dataset.rnRootId === rootId,
    );
  const deadline = Date.now() + 1_500;
  let surface = find();
  while (!surface && Date.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    surface = find();
  }
  if (!surface) throw new Error(`Canvas frame is not mounted: ${rootId}`);
  return surface;
}

interface NodeSpec {
  type: string;
  props?: Record<string, unknown>;
  style?: Record<string, unknown>;
  design?: Record<string, unknown>;
  children?: NodeSpec[];
}

/** Build a validated primitive subtree from a declarative spec (recursive). */
function buildNodeFromSpec(spec: NodeSpec): Node {
  if (!spec || typeof spec !== "object") throw new Error("node spec must be an object");
  if (!(RN_PRIMITIVES as readonly string[]).includes(spec.type)) {
    throw new Error(
      `Unknown primitive "${spec.type}" — expected one of: ${RN_PRIMITIVES.join(", ")}`,
    );
  }
  const type = spec.type as RNPrimitive;
  const node = createNode(type, {
    props: spec.props as Partial<AnyProps> | undefined,
    style: spec.style as Partial<RNStyle> | undefined,
    design: spec.design as Partial<DesignMeta> | undefined,
  });
  const childSpecs = spec.children ?? [];
  if (childSpecs.length > 0) {
    if (!canHaveChildren(type)) {
      throw new Error(`${type} cannot have children`);
    }
    (node as Node & { children: Node[] }).children = childSpecs.map(buildNodeFromSpec);
  }
  return node;
}

/** Execute MCP commands only through the canonical, validated document store. */
export const handleMcpCommand: BrowserCommandHandler = async (command) => {
  const payload = payloadOf(command.payload);

  switch (command.type) {
    case "get_status": {
      const store = useDocumentStore.getState();
      const roots = Object.values(store.roots);
      const focusedRoot = findRootContaining(roots, store.selection[0] ?? "");
      return {
        rootCount: roots.length,
        rootIds: roots.map((root) => root.id),
        selection: store.selection,
        focusedRootId: focusedRoot?.id ?? null,
        editingComponentId: store.editingComponentId ?? null,
        tokenCount: Object.keys(store.tokens).length,
        componentCount: Object.keys(store.components).length,
      };
    }

    case "get_tree":
      return useDocumentStore.getState().roots;

    case "create_frame": {
      const root = createNode("View", {
        style: payload.style as Partial<RNStyle> | undefined,
        design: payload.design as Partial<DesignMeta> | undefined,
      });
      const store = useDocumentStore.getState();
      store.addRoot(root);
      store.setSelection([root.id]);
      return root;
    }

    case "delete_frame": {
      const rootId = requiredString(payload, "rootId");
      const store = useDocumentStore.getState();
      if (!store.roots[rootId]) throw new Error(`Root not found: ${rootId}`);
      store.removeRoot(rootId);
      store.setSelection(Object.keys(useDocumentStore.getState().roots).slice(0, 1));
      return { rootId };
    }

    case "update_node": {
      const { rootId, nodeId } = rootAndNode(payload);
      if (payload.props === undefined && payload.design === undefined) {
        throw new Error("update_node requires props and/or design");
      }
      return transact(() => {
        const store = useDocumentStore.getState();
        if (payload.props !== undefined) {
          store.updateProps(rootId, nodeId, payload.props as Partial<AnyProps>);
        }
        if (payload.design !== undefined) {
          useDocumentStore
            .getState()
            .updateDesign(rootId, nodeId, payload.design as Partial<DesignMeta>);
        }
        return useDocumentStore.getState().roots[rootId];
      });
    }

    case "set_style": {
      const { rootId, nodeId } = rootAndNode(payload);
      if (payload.style === undefined) throw new Error("set_style requires style");
      useDocumentStore
        .getState()
        .updateStyle(rootId, nodeId, payload.style as Partial<RNStyle>);
      return useDocumentStore.getState().roots[rootId];
    }

    case "insert_node": {
      const rootId = requiredString(payload, "rootId");
      const parentId = requiredString(payload, "parentId");
      const root = useDocumentStore.getState().roots[rootId];
      if (!root) throw new Error(`Root not found: ${rootId}`);
      const parent = findNode(root, parentId);
      if (!parent) throw new Error(`Parent not found: ${parentId}`);
      if (!canHaveChildren(parent.type)) {
        throw new Error(`${parent.type} cannot have children`);
      }
      const node = buildNodeFromSpec(payload.node as NodeSpec);
      const index = payload.index === undefined ? undefined : Number(payload.index);
      useDocumentStore.getState().insertChild(rootId, parentId, node, index);
      // Return the inserted subtree — its generated ids are the agent's handles
      // for follow-up set_style/update_node calls.
      return node;
    }

    case "remove_node": {
      const { rootId, nodeId } = rootAndNode(payload);
      useDocumentStore.getState().removeNode(rootId, nodeId);
      return { rootId, nodeId };
    }

    case "create_screen": {
      const root = await useWorkspaceStore.getState().createRepoScreen();
      if (!root) throw new Error("Screen creation is busy — retry after the current sync");
      const workspace = useWorkspaceStore.getState();
      const active = workspace.activeRepoScreen;
      return {
        rootId: root.id,
        screenName: active?.screenName ?? workspace.screenName,
        path: active?.path ?? workspace.targetPath,
        sidecarPath: active?.sidecarPath ?? workspace.sidecarPath,
      };
    }

    case "rename_screen": {
      const rootId = requiredString(payload, "rootId");
      const name = requiredString(payload, "name");
      if (!useDocumentStore.getState().roots[rootId]) {
        throw new Error(`Root not found: ${rootId}`);
      }
      useWorkspaceStore.getState().renameRepoScreen(rootId, name);
      const workspace = useWorkspaceStore.getState();
      const screen = Object.values(workspace.loadedRepoScreens).find(
        (entry) => entry.rootId === rootId,
      );
      return { rootId, screenName: screen?.screenName ?? name, path: screen?.path };
    }

    case "create_component": {
      const { rootId, nodeId } = rootAndNode(payload);
      // Accept designer-style slash paths (Row/Habit) like the create dialog does;
      // the store validates the dotted form.
      const name = toComponentDisplayPath(requiredString(payload, "name"));
      useDocumentStore.getState().promoteToComponent(rootId, nodeId, name);
      const state = useDocumentStore.getState();
      const definition = Object.values(state.components).find(
        (component) => component.name === name,
      );
      if (!definition) throw new Error(`Component not created: ${name}`);
      // Optional prop exposure: [{ name, kind: text|color|visibility|slot, nodeId, styleKey? }].
      // Template clones keep the source subtree's node ids, so the ids returned
      // by insert_node remain valid targets here.
      const propSpecs = payload.props as
        | { name: string; kind: "text" | "color" | "visibility" | "slot"; nodeId: string; styleKey?: "color" | "backgroundColor" }[]
        | undefined;
      if (propSpecs && propSpecs.length > 0) {
        const props = propSpecs.map((spec) =>
          presetProp(spec.name, spec.kind, spec.nodeId, spec.styleKey ?? "color"),
        );
        useDocumentStore.getState().updateComponent(definition.id, {
          props: [...definition.props, ...props],
        });
      }
      const updated = useDocumentStore.getState().components[definition.id];
      return {
        componentId: definition.id,
        instanceId: nodeId,
        name: updated.name,
        props: updated.props.map((prop) => ({ name: prop.name, valueType: prop.valueType })),
      };
    }

    case "set_instance": {
      const rootId = requiredString(payload, "rootId");
      const instanceId = requiredString(payload, "instanceId");
      const store = useDocumentStore.getState();
      if (!store.roots[rootId]) throw new Error(`Root not found: ${rootId}`);
      const overrides = payload.overrides as Record<string, unknown> | undefined;
      const variant = payload.variant as Record<string, string> | undefined;
      if (!overrides && !variant) {
        throw new Error("set_instance requires overrides and/or variant");
      }
      return transact(() => {
        for (const [name, value] of Object.entries(overrides ?? {})) {
          useDocumentStore
            .getState()
            .setInstanceOverride(rootId, instanceId, name, value as never);
        }
        for (const [axis, value] of Object.entries(variant ?? {})) {
          useDocumentStore.getState().setInstanceVariant(rootId, instanceId, axis, value);
        }
        const root = useDocumentStore.getState().roots[rootId];
        return findNode(root, instanceId);
      });
    }

    case "place_instance": {
      const rootId = requiredString(payload, "rootId");
      const parentId = requiredString(payload, "parentId");
      const componentId = requiredString(payload, "componentId");
      const state = useDocumentStore.getState();
      if (!state.roots[rootId]) throw new Error(`Root not found: ${rootId}`);
      if (!state.components[componentId]) {
        throw new Error(`Component not found: ${componentId}`);
      }
      const index = payload.index === undefined ? undefined : Number(payload.index);
      state.placeInstance(rootId, parentId, componentId, index);
      const root = useDocumentStore.getState().roots[rootId];
      const parent = findNode(root, parentId);
      const children = parent && canHaveChildren(parent.type)
        ? (parent as Node & { children: Node[] }).children
        : [];
      const placed = index === undefined ? children[children.length - 1] : children[index];
      return { instanceId: placed?.id, componentId };
    }

    case "get_canvas_screenshot": {
      const store = useDocumentStore.getState();
      const requestedRootId =
        payload.rootId === undefined ? undefined : requiredString(payload, "rootId");
      const root = requestedRootId
        ? store.roots[requestedRootId]
        : findRootContaining(Object.values(store.roots), store.selection[0] ?? "");
      if (!root) throw new Error("Select a frame or provide rootId");
      const surface = await waitForFrameSurface(root.id);
      await document.fonts.ready;
      const canvasColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--canvas")
        .trim();
      // toPng can stall without rejecting (blocked font/resource fetches,
      // throttled rasterization). Fail fast with a diagnosable error instead of
      // holding the bridge until the transport timeout.
      const dataUrl = await Promise.race([
        toPng(surface, {
          backgroundColor: canvasColor,
          cacheBust: true,
          pixelRatio: 1,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Canvas screenshot capture timed out for ${root.id}`)),
            10_000,
          ),
        ),
      ]);
      if (!dataUrl.startsWith("data:image/png;base64,")) {
        throw new Error(
          `Canvas screenshot capture returned unexpected data URL for ${root.id}`,
        );
      }
      const data = dataUrl.replace(/^data:image\/png;base64,/, "");
      if (!data) throw new Error(`Canvas screenshot capture returned no data for ${root.id}`);
      return {
        source: "canvas",
        mimeType: "image/png",
        data,
        width: surface.clientWidth,
        height: surface.clientHeight,
        rootId: root.id,
      };
    }

    default:
      throw new Error(`Unsupported Studio command: ${command.type}`);
  }
};
