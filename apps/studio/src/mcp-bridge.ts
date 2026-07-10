export interface BrowserCommand<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
}

type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type BrowserCommandHandler = (command: BrowserCommand) => Promise<unknown>;

/** Poll commands from the local Vite host and execute them against the live Studio. */
export function startMcpBridge(handler: BrowserCommandHandler): () => void {
  const controller = new AbortController();
  const clientId = crypto.randomUUID();
  // Newest page boot wins the bridge: a freshly loaded Studio page takes over
  // from a stale/hidden tab, which would otherwise keep the bridge parked
  // forever and silently execute MCP commands against a document nobody sees.
  const bootTs = Date.now();

  const loop = async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(
          `/api/mcp/next?clientId=${encodeURIComponent(clientId)}&bootTs=${bootTs}`,
          { signal: controller.signal },
        );
        // 204 = the server's long-poll window elapsed with no command (or this
        // tab isn't the active bridge client, in which case the server already
        // delayed the response) — reconnect immediately.
        if (response.status === 204) continue;
        if (!response.ok) throw new Error(`Command poll failed: HTTP ${response.status}`);
        const command = (await response.json()) as BrowserCommand;
        let result: CommandResult;
        try {
          result = { ok: true, value: await handler(command) };
        } catch (error) {
          result = {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        await fetch("/api/mcp/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: command.id, ...result }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("MCP bridge poll failed", error);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  void loop();
  return () => controller.abort();
}
