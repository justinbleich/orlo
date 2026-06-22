import {
  createNode,
  findNode,
  useDocumentStore,
  type AnyProps,
  type DesignMeta,
} from "@rn-canvas/document";
import type { RNStyle } from "@rn-canvas/styles";
import type { BrowserCommandHandler } from "./mcp-bridge";

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

/** Execute MCP commands only through the canonical, validated document store. */
export const handleMcpCommand: BrowserCommandHandler = async (command) => {
  const payload = payloadOf(command.payload);

  switch (command.type) {
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

    default:
      throw new Error(`Unsupported Studio command: ${command.type}`);
  }
};
