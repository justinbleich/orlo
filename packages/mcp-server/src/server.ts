import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Roots } from "@rn-canvas/document";
import { z } from "zod";
import { StudioBridge } from "./bridge";

export function createMcpServer(bridge = new StudioBridge()) {
  const server = new McpServer({ name: "rn-canvas", version: "0.1.0" });

  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  });

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
