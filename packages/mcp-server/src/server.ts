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
