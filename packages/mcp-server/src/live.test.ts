import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseSidecar } from "@rn-canvas/codegen";
import { StudioBridge } from "./bridge";
import { createMcpServer } from "./server";

const liveTest = process.env.RN_CANVAS_LIVE_TEST === "1" ? test : test.skip;

function textBlocks(response: unknown): string[] {
  const content = (response as { content?: unknown }).content ?? [];
  return (content as Array<{ type: string; text?: string }>)
    .filter((item) => item.type === "text" && item.text !== undefined)
    .map((item) => item.text!);
}

liveTest("agent edits appear live and reload from the generated sidecar", async () => {
  const server = createMcpServer(new StudioBridge());
  const client = new Client({ name: "rn-canvas-live-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let rootId: string | undefined;
  try {
    const created = await client.callTool({
      name: "create_frame",
      arguments: {
        style: { width: 240, height: 160, backgroundColor: "#ffffff" },
        design: { name: "MCP Live Test" },
      },
    });
    assert.notEqual(created.isError, true, textBlocks(created).join("\n"));
    const createdResult = JSON.parse(textBlocks(created)[0]) as { id?: string };
    rootId = createdResult.id;
    assert.ok(rootId);

    await client.callTool({
      name: "set_style",
      arguments: { rootId, nodeId: rootId, style: { padding: 20 } },
    });
    await client.callTool({
      name: "update_node",
      arguments: { rootId, nodeId: rootId, design: { name: "MCP Persisted" } },
    });

    const tree = await client.callTool({ name: "get_tree", arguments: { rootId } });
    const roots = JSON.parse(textBlocks(tree)[0]) as Record<
      string,
      { style: { padding?: number }; design?: { name?: string } }
    >;
    assert.equal(roots[rootId].style.padding, 20);
    assert.equal(roots[rootId].design?.name, "MCP Persisted");

    const code = await client.callTool({
      name: "get_code",
      arguments: { rootId, screenName: "McpPersisted" },
    });
    const [generatedCode, sidecar] = textBlocks(code);
    const reloaded = parseSidecar(sidecar);
    assert.equal(reloaded.root.id, rootId);
    assert.equal(reloaded.root.style.padding, 20);
    assert.equal(reloaded.root.design?.name, "MCP Persisted");
    assert.doesNotMatch(generatedCode, /MCP Persisted/);

    const screenshot = await client.callTool({
      name: "get_canvas_screenshot",
      arguments: { rootId },
    });
    const screenshotContent = screenshot.content as Array<{ type: string }>;
    assert.equal(screenshotContent.some((item) => item.type === "image"), true);
    assert.match(textBlocks(screenshot)[0], /^Canvas screenshot/);
  } finally {
    if (rootId) {
      await client.callTool({ name: "delete_frame", arguments: { rootId } });
    }
    await client.close();
    await server.close();
  }
});
