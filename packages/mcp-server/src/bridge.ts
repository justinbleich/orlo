export interface StudioCommand<TPayload = unknown> {
  type: string;
  payload: TPayload;
}

export interface StudioCommandResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface StudioCommandBridge {
  command<T>(command: StudioCommand): Promise<T>;
  status?(): Promise<unknown>;
}

export class StudioBridge implements StudioCommandBridge {
  constructor(
    private readonly baseUrl = process.env.RN_CANVAS_STUDIO_URL ??
      "http://127.0.0.1:5173",
    private readonly timeoutMs = 35_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async command<T>(command: StudioCommand): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/mcp/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Studio bridge unavailable at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const result = (await response.json()) as StudioCommandResult<T>;
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Studio bridge failed with HTTP ${response.status}`);
    }
    return result.value as T;
  }

  async status(): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/mcp/status`, {
        method: "GET",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Studio bridge unavailable at ${this.baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? `Studio status failed with HTTP ${response.status}`);
    }
    return result;
  }
}
