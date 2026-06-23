import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { sampleDocument } from "@rn-canvas/document/sample";
import type { StudioCommand, StudioCommandBridge } from "./bridge";
import { createMcpServer } from "./server";

class FakeBridge implements StudioCommandBridge {
  commands: StudioCommand[] = [];

  async command<T>(command: StudioCommand): Promise<T> {
    this.commands.push(command);
    switch (command.type) {
      case "get_tree":
        return { [sampleDocument.id]: sampleDocument } as T;
      case "get_canvas_screenshot":
        return {
          source: "canvas",
          mimeType: "image/png",
          data: "cG5n",
          width: 320,
          height: 120,
          rootId: sampleDocument.id,
        } as T;
      default:
        return { accepted: true } as T;
    }
  }
}

async function withClient(run: (client: Client, bridge: FakeBridge) => Promise<void>) {
  const bridge = new FakeBridge();
  const server = createMcpServer(bridge);
  const client = new Client({ name: "rn-canvas-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client, bridge);
  } finally {
    await client.close();
    await server.close();
  }
}

test("registers the complete Phase 5 tool surface", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "create_frame",
        "delete_frame",
        "get_canvas_screenshot",
        "get_code",
        "get_tree",
        "set_style",
        "update_node",
      ],
    );
  });
});

test("mutation tools forward validated arguments to the live Studio", async () => {
  await withClient(async (client, bridge) => {
    await client.callTool({
      name: "set_style",
      arguments: {
        rootId: sampleDocument.id,
        nodeId: "sample-text",
        style: { fontSize: 20 },
      },
    });
    assert.deepEqual(bridge.commands.at(-1), {
      type: "set_style",
      payload: {
        rootId: sampleDocument.id,
        nodeId: "sample-text",
        style: { fontSize: 20 },
      },
    });
  });
});

test("get_code serializes the fetched canonical root", async () => {
  await withClient(async (client) => {
    const response = await client.callTool({
      name: "get_code",
      arguments: { rootId: sampleDocument.id, screenName: "AgentScreen" },
    });
    const content = response.content as Array<{ type: string; text?: string }>;
    const text = content.find((item) => item.type === "text");
    assert.equal(text?.type, "text");
    if (text?.text) {
      assert.match(text.text, /export default function AgentScreen/);
      assert.doesNotMatch(text.text, /design/);
    }
  });
});

test("get_canvas_screenshot labels and returns the canvas image", async () => {
  await withClient(async (client) => {
    const response = await client.callTool({
      name: "get_canvas_screenshot",
      arguments: { rootId: sampleDocument.id },
    });
    const content = response.content as Array<{ type: string }>;
    const structured = response.structuredContent as Record<string, unknown>;
    assert.equal(content.some((item) => item.type === "image"), true);
    assert.equal(structured.source, "canvas");
    assert.equal(structured.rootId, sampleDocument.id);
  });
});
