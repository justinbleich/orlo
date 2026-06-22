import assert from "node:assert/strict";
import { test } from "node:test";
import { StudioBridge } from "./bridge";

test("StudioBridge forwards commands and returns browser values", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ ok: true, value: { root: "live" } }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  const value = await new StudioBridge("http://studio.test", 1_000, fetchImpl).command<{
    root: string;
  }>({ type: "get_tree", payload: {} });

  assert.deepEqual(value, { root: "live" });
  assert.equal(request?.input, "http://studio.test/api/mcp/command");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.body, JSON.stringify({ type: "get_tree", payload: {} }));
});

test("StudioBridge surfaces command validation errors", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: "Invalid style" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    new StudioBridge("http://studio.test", 1_000, fetchImpl).command({
      type: "set_style",
      payload: {},
    }),
    /Invalid style/,
  );
});
