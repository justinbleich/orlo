# RN Canvas

React Native design canvas — Phase 0 de-risk spike.

## Quick start

```bash
pnpm install
pnpm dev          # starts apps/studio on http://localhost:5173
```

### Phase 0 workflow

1. **Studio** — canvas render (react-native-web + Yoga WASM) with pan/zoom
2. **Harness** — ground-truth native render in the iOS simulator

```bash
# Terminal 1: studio
pnpm --filter @rn-canvas/studio dev

# Terminal 2: harness (requires Xcode + iOS simulator)
pnpm --filter @rn-canvas/harness ios
```

3. In Studio, click **Capture simulator** then **Run diff** to compare fidelity.

Or from CLI:

```bash
pnpm capture:sim                    # screenshot → tmp/sim-screenshot.png
pnpm diff path/to/canvas-snapshot.png
```

## Monorepo layout

| Path | Purpose |
|------|---------|
| `apps/studio` | Vite IDE shell — pan/zoom canvas + diff UI |
| `apps/harness` | Expo app — native ground-truth fixture |
| `packages/fixture` | Shared Phase 0 node tree |
| `packages/render-web` | rnw renderer with Yoga WASM layout |
| `packages/sim-bridge` | `xcrun simctl` screenshot wrapper |
| `_plan/` | BUILD.md and phase plans |

See `_plan/BUILD.md` for the full build plan.
