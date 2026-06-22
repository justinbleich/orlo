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

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/studio` | Vite IDE shell — infinite canvas, inspector, code workflow |
| `apps/harness` | Expo app — optional native preview fixture |
| `packages/document` | Canonical RN primitive document and store |
| `packages/styles` | RN style contract, validation, Yoga mapping, text metrics |
| `packages/render-web` | rnw renderer with Yoga WASM layout |
| `packages/codegen` | Explicit RN source + sidecar serialization |
| `packages/sim-bridge` | Parked Phase 0 simulator screenshot spike |
| `_plan/` | BUILD.md and phase plans |

See `_plan/BUILD.md` for the full build plan.
