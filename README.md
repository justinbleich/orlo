# RN Canvas

Native-first React Native design canvas.

## Quick start

```bash
pnpm install
pnpm dev          # starts apps/studio on http://localhost:5173
```

### Current workflow

The Studio is the primary authoring surface. Its infinite canvas renders the canonical
document directly through react-native-web + Yoga; **Sync Code** writes derived React Native
source and the committed `*.rncanvas.json` sidecar.

```bash
pnpm --filter @rn-canvas/studio dev
```

The native harness is an optional, user-owned preview input and requires local native tooling:

```bash
pnpm --filter @rn-canvas/harness ios
```

The old automated screenshot capture and pixel-diff spike remains parked in
`packages/sim-bridge` and `packages/render-web`; it is not part of the v1 workflow.

### MCP agent connection

Keep the Studio open in a browser, then configure an MCP client to launch the stdio server from
this repository:

```json
{
  "mcpServers": {
    "rn-canvas": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/absolute/path/to/react-canvas",
        "--filter",
        "@rn-canvas/mcp-server",
        "start"
      ],
      "env": {
        "RN_CANVAS_STUDIO_URL": "http://127.0.0.1:5173"
      }
    }
  }
}
```

The server exposes `get_tree`, `create_frame`, `delete_frame`, `update_node`, `set_style`,
`get_code`, and `get_canvas_screenshot`. Mutations execute in the live browser against the
validated document store; the MCP process does not own a parallel document.

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/studio` | Vite IDE shell — infinite canvas, inspector, code workflow |
| `apps/harness` | Expo app — optional native preview fixture |
| `packages/document` | Canonical RN primitive document and store |
| `packages/styles` | RN style contract, validation, Yoga mapping, text metrics |
| `packages/render-web` | rnw renderer with Yoga WASM layout |
| `packages/codegen` | Explicit RN source + sidecar serialization |
| `packages/mcp-server` | Stdio MCP tools bridged to the live Studio document |
| `packages/sim-bridge` | Parked Phase 0 simulator screenshot spike |
| `_plan/` | BUILD.md and phase plans |

See `_plan/BUILD.md` for the full build plan.
