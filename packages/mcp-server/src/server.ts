import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Roots } from "@rn-canvas/document";
import { generateScreen } from "@rn-canvas/codegen";
import { z } from "zod";
import { StudioBridge, type StudioCommandBridge } from "./bridge";

export function createMcpServer(bridge: StudioCommandBridge = new StudioBridge()) {
  const server = new McpServer({ name: "rn-canvas", version: "0.1.0" });

  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  });

  server.registerTool(
    "get_status",
    {
      description:
        "Check Studio/MCP bridge readiness, active repository, queue state, and live document selection when Studio is connected.",
      inputSchema: {},
    },
    async () => {
      const serverStatus = bridge.status ? await bridge.status() : undefined;
      const bridgeActive =
        !!serverStatus &&
        typeof serverStatus === "object" &&
        "browserBridgeActive" in serverStatus &&
        Boolean((serverStatus as { browserBridgeActive?: unknown }).browserBridgeActive);

      if (!bridgeActive) return result(serverStatus ?? { browserBridgeActive: "unknown" });

      try {
        const documentStatus = await bridge.command({ type: "get_status", payload: {} });
        return result({ ...(serverStatus as object), document: documentStatus });
      } catch (error) {
        return result({
          ...(serverStatus as object),
          documentError: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "get_tree",
    {
      description: "Read the canonical RN Canvas document tree from the live Studio.",
      inputSchema: { rootId: z.string().optional() },
    },
    async ({ rootId }) => {
      const roots = await bridge.command<Roots>({ type: "get_tree", payload: {} });
      if (rootId && !roots[rootId]) throw new Error(`Root not found: ${rootId}`);
      const selectedRoots = rootId ? { [rootId]: roots[rootId] } : roots;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(selectedRoots, null, 2) }],
        structuredContent: { roots: selectedRoots },
      };
    },
  );

  server.registerTool(
    "create_frame",
    {
      description: "Create a new RN View frame in the live document.",
      inputSchema: {
        style: z.record(z.unknown()).optional(),
        design: z.record(z.unknown()).optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "create_frame", payload })),
  );

  server.registerTool(
    "delete_frame",
    {
      description: "Delete a document root and its canvas frame.",
      inputSchema: { rootId: z.string().min(1) },
    },
    async (payload) =>
      result(await bridge.command({ type: "delete_frame", payload })),
  );

  server.registerTool(
    "update_node",
    {
      description: "Update validated primitive props and/or design metadata on a node.",
      inputSchema: {
        rootId: z.string().min(1),
        nodeId: z.string().min(1),
        props: z.record(z.unknown()).optional(),
        design: z.record(z.unknown()).optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "update_node", payload })),
  );

  server.registerTool(
    "set_style",
    {
      description: "Apply a validated RNStyle patch to a document node.",
      inputSchema: {
        rootId: z.string().min(1),
        nodeId: z.string().min(1),
        style: z.record(z.unknown()),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "set_style", payload })),
  );

  const nodeSpec: z.ZodType<unknown> = z.lazy(() =>
    z.object({
      type: z.string().min(1),
      props: z.record(z.unknown()).optional(),
      style: z.record(z.unknown()).optional(),
      design: z.record(z.unknown()).optional(),
      children: z.array(nodeSpec).optional(),
    }),
  );

  server.registerTool(
    "insert_node",
    {
      description:
        "Insert a validated primitive subtree under a parent node. The node spec is recursive: { type, props?, style?, design?, children? }. Returns the inserted subtree with its generated node ids.",
      inputSchema: {
        rootId: z.string().min(1),
        parentId: z.string().min(1),
        node: nodeSpec,
        index: z.number().int().min(0).optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "insert_node", payload })),
  );

  server.registerTool(
    "remove_node",
    {
      description: "Remove a node (and its subtree) from a document root.",
      inputSchema: { rootId: z.string().min(1), nodeId: z.string().min(1) },
    },
    async (payload) =>
      result(await bridge.command({ type: "remove_node", payload })),
  );

  server.registerTool(
    "create_screen",
    {
      description:
        "Create a repo-backed screen: a new screen file plus sidecar in the connected repository, loaded onto the canvas. Returns rootId, screenName, and file paths.",
      inputSchema: {},
    },
    async () => result(await bridge.command({ type: "create_screen", payload: {} })),
  );

  server.registerTool(
    "rename_screen",
    {
      description: "Rename a repo-backed screen (updates the generated file and sidecar).",
      inputSchema: { rootId: z.string().min(1), name: z.string().min(1) },
    },
    async (payload) =>
      result(await bridge.command({ type: "rename_screen", payload })),
  );

  server.registerTool(
    "create_component",
    {
      description:
        "Promote an existing node subtree into a reusable component definition; the node becomes the first placed instance. Use display paths like Card/Stat for grouping. Expose instance props by targeting node ids from the promoted subtree.",
      inputSchema: {
        rootId: z.string().min(1),
        nodeId: z.string().min(1),
        name: z.string().min(1),
        props: z
          .array(
            z.object({
              name: z.string().min(1),
              kind: z.enum(["text", "color", "visibility", "slot"]),
              nodeId: z.string().min(1),
              styleKey: z.enum(["color", "backgroundColor"]).optional(),
            }),
          )
          .optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "create_component", payload })),
  );

  server.registerTool(
    "set_instance",
    {
      description:
        "Configure a placed component instance: set exposed prop overrides and/or variant axis values.",
      inputSchema: {
        rootId: z.string().min(1),
        instanceId: z.string().min(1),
        overrides: z.record(z.unknown()).optional(),
        variant: z.record(z.string()).optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "set_instance", payload })),
  );

  server.registerTool(
    "place_instance",
    {
      description: "Place an instance of an existing component under a parent node.",
      inputSchema: {
        rootId: z.string().min(1),
        parentId: z.string().min(1),
        componentId: z.string().min(1),
        index: z.number().int().min(0).optional(),
      },
    },
    async (payload) =>
      result(await bridge.command({ type: "place_instance", payload })),
  );

  server.registerTool(
    "get_code",
    {
      description: "Serialize one live document root to RN source and its sidecar.",
      inputSchema: {
        rootId: z.string().min(1),
        screenName: z.string().regex(/^[A-Z][A-Za-z0-9_$]*$/).optional(),
      },
    },
    async ({ rootId, screenName }) => {
      const roots = await bridge.command<Roots>({ type: "get_tree", payload: {} });
      const root = roots[rootId];
      if (!root) throw new Error(`Root not found: ${rootId}`);
      const generated = generateScreen(root, { screenName: screenName ?? "Screen" });
      return {
        content: [
          { type: "text" as const, text: generated.code },
          { type: "text" as const, text: generated.sidecar },
        ],
        structuredContent: { ...generated, source: "document" },
      };
    },
  );

  server.registerTool(
    "get_canvas_screenshot",
    {
      description: "Capture the live Studio canvas. The image source is always canvas.",
      inputSchema: { rootId: z.string().min(1).optional() },
    },
    async (payload) => {
      const screenshot = await bridge.command<{
        source: "canvas";
        mimeType: "image/png";
        data: string;
        width: number;
        height: number;
        rootId: string;
      }>({ type: "get_canvas_screenshot", payload });
      if (!screenshot.data) {
        throw new Error(
          `Canvas screenshot returned no image data for root ${screenshot.rootId}`,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Canvas screenshot (${screenshot.width}x${screenshot.height})`,
          },
          { type: "image" as const, data: screenshot.data, mimeType: screenshot.mimeType },
        ],
        structuredContent: {
          source: screenshot.source,
          mimeType: screenshot.mimeType,
          width: screenshot.width,
          height: screenshot.height,
          rootId: screenshot.rootId,
        },
      };
    },
  );

  return server;
}

async function main() {
  await createMcpServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
