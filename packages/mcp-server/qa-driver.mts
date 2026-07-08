/**
 * QA driver: exercises the real rn-canvas MCP server over stdio, exactly as an
 * external agent would. Temporary tooling for the MCP build QA session.
 *
 *   tsx qa-driver.mts list
 *   tsx qa-driver.mts call <tool> '<json-args>'
 *   tsx qa-driver.mts batch <file.json>   # [{"tool": ..., "args": {...}}, ...]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "node:fs/promises";

const [, , mode, a1, a2] = process.argv;

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["--filter", "@rn-canvas/mcp-server", "exec", "tsx", "src/server.ts"],
  cwd: "/Users/justinbleich/react-canvas",
  env: {
    ...process.env,
    RN_CANVAS_STUDIO_URL: "http://127.0.0.1:5180",
  },
});

const client = new Client({ name: "qa-driver", version: "0.0.1" });
await client.connect(transport);

function printResult(label: string, result: unknown) {
  const r = result as { content?: { type: string; text?: string; data?: string }[]; isError?: boolean };
  const text = (r.content ?? [])
    .map((c) => (c.type === "text" ? c.text : `[${c.type}${c.type === "image" ? ` ${String(c.data).length}b64` : ""}]`))
    .join("\n");
  console.log(`=== ${label}${r.isError ? " [ERROR]" : ""} ===`);
  console.log(text.length > 4000 ? text.slice(0, 4000) + `\n…(${text.length} chars)` : text);
}

try {
  if (mode === "list") {
    const tools = await client.listTools();
    console.log(JSON.stringify(tools.tools.map((t) => ({ name: t.name, description: t.description })), null, 2));
  } else if (mode === "call") {
    const result = await client.callTool({ name: a1, arguments: a2 ? JSON.parse(a2) : {} });
    printResult(a1, result);
  } else if (mode === "batch") {
    const steps = JSON.parse(await readFile(a1, "utf8")) as { tool: string; args?: object; label?: string }[];
    for (const step of steps) {
      try {
        const result = await client.callTool({ name: step.tool, arguments: step.args ?? {} });
        printResult(step.label ?? step.tool, result);
      } catch (error) {
        console.log(`=== ${step.label ?? step.tool} [THREW] ===`);
        console.log(error instanceof Error ? error.message : String(error));
      }
    }
  } else {
    console.error("usage: list | call <tool> <json> | batch <file>");
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
