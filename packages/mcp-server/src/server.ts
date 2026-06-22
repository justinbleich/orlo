import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Roots } from "@rn-canvas/document";
import { z } from "zod";
import { StudioBridge } from "./bridge";

export function createMcpServer(bridge = new StudioBridge()) {
  const server = new McpServer({ name: "rn-canvas", version: "0.1.0" });

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
