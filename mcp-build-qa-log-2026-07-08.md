# MCP Build QA Log — three-screen app over the MCP bridge

Date: 2026-07-08
Branch: `ux/component-qa-fixes`
Test case: build a prod-shaped three-screen habit app ("Loop" — Today / Stats / Settings) with reusable components in an **external repo** (`test-repos/loop-habits`, git-initialized, Expo 52 / RN 0.76 / Expo Router shape), driving Studio exclusively through the real MCP server over stdio (`packages/mcp-server/qa-driver.mts`, `qa-build-loop.mjs`).

## Outcome

The app was built end-to-end **in 56 MCP calls with zero errors** — after extending the MCP surface, which was the headline finding: the shipped v1 surface could not add a single child node. Final state: 3 file-backed screens (`app/screen-2/3/4.tsx` + sidecars), 4 reusable components (`Row.Habit`, `Card.Stat`, `Row.Setting`, `Button.Primary`) emitted to `app/components/`, per-instance prop overrides everywhere, and one component (`Button.Primary`) shared across two screens. All three screens verified visually on canvas; generated code audit below.

## Finding 1 — the v1 MCP surface cannot build anything (fixed)

The original 8 tools (`get_status`, `get_tree`, `create_frame`, `delete_frame`, `update_node`, `set_style`, `get_code`, `get_canvas_screenshot`) support inspecting and *restyling* an existing document, but there is no way to insert a child node: `create_frame` makes empty root Views, and `update_node` correctly rejects `children`/`text` as props. The June 30 MCP test log passed because it only ever edited an existing sidecar-backed screen. An agent asked to "build an app" hits the wall on call #2.

**Fixed by extending the surface** (commit `6163747`) with commands that map 1:1 onto validated store actions:

| New tool | Store path |
|---|---|
| `insert_node` (recursive subtree spec, returns generated ids) | `createNode` + `insertChild` |
| `remove_node` | `removeNode` |
| `create_screen` (repo-backed file + sidecar) | workspace `createRepoScreen` |
| `rename_screen` | workspace `renameRepoScreen` |
| `create_component` (promote + optional `presetProp` exposure) | `promoteToComponent` + `updateComponent` |
| `place_instance` | `placeInstance` |
| `set_instance` (overrides + variant) | `setInstanceOverride` / `setInstanceVariant` |

Design notes that made the build loop work well: `insert_node` accepting a *recursive* spec means one call per screen section (not per node); returning the inserted subtree with generated ids gives the agent handles for `create_component` prop targets and later restyling.

## Finding 2 — bridge client arbitration was first-poller-wins, forever (fixed)

The browser bridge (`/api/mcp/next` long-poll) let the first Studio page claim the bridge permanently: takeover required a >2s stale `lastSeen` *and* no parked poll, and a parked long-poll keeps `lastSeen` perpetually fresh. In practice a hidden/stale page owned the bridge all session — MCP commands executed against a document nobody was looking at, `get_status` reported component counts from a stale session, and there was no way to see which page was active or force takeover. Worse, the staleness path *did* flip ownership mid-batch: a client stops polling while executing a long command, so after a slow command the next command could land on a different page ("Root not found" for ids created two calls earlier).

**Fixed** (commits `05a2b21`, `d70796d`): bridge clients send a page `bootTs`; the server adopts the most recently booted page, full stop — no staleness takeover. Reloading a Studio page deterministically makes it the bridge. `/api/mcp/status` now exposes the active client.

## Finding 3 — get_canvas_screenshot can hang the bridge (hardened)

`waitForFrameSurface` loops on `requestAnimationFrame` (frozen in hidden tabs) and `html-to-image`'s `toPng` can stall without rejecting (blocked font/resource fetches; in this sandboxed preview browser it stalls even on a bare `<div>`). Either way the command held the bridge until the 35s transport timeout. **Hardened** with a 10s `Promise.race` timeout that returns a diagnosable error. Note: in this test environment screenshots remain unusable (environmental — the same path passed in real Chrome on 2026-06-30); visual verification used the Studio canvas directly.

## Finding 4 — component name syntax is inconsistent across layers (fixed)

`create_component` with the designer-facing slash path (`Row/Habit`, as the create dialog accepts) failed store validation ("expected a PascalCase component name or dotted path") because the slash→dot normalization lived only in the App dialog layer. The MCP handler now applies the same `toComponentDisplayPath` normalization.

## Finding 5 — smaller frictions and observations

- **`rename_screen` changes the component/display name but not the file path** — `app/screen-2.tsx` stays `screen-2` while exporting `Today()`. Consistent with the stable-route model, but an agent (or reviewer) expecting `today.tsx` will be surprised; worth documenting in the tool description.
- **Screen numbering doesn't reuse gaps** (deleted `screen-1` → next screen is `screen-2`), and the first-run bootstrap re-scaffolds `screen-1` on every reload of an empty repo — after one reload mid-build the repo had a stray starter screen again. Bootstrap + MCP-driven building interact awkwardly.
- **Connecting a repo via `POST /api/repo` does not reset the live document** — the in-memory session (screens, components, tokens of repo A) survives into repo B until a page reload. With autosync this is one active-screen edit away from writing repo A content into repo B. Studio's own connect flow may reload; the API path doesn't.
- **MCP-exposed props have no defaults** — `presetProp` doesn't capture the template's current value as the prop default, so generated component prop interfaces are all-required (`name: string`, not `name?: string` with a default). The dialog preset path does better.
- **Autosync throughput was flawless**: 56 rapid mutations across 3 screens produced consistent multi-root syncs; every screen + component file and sidecar landed correctly with no missed writes. `create_screen`'s `ifAbsent` sync plus `dirtyRoots` tracking held up.
- **Validation quality is excellent** and agent-friendly: `boxShadow: not an RN style property — use shadowColor/shadowOffset/shadowOpacity/shadowRadius (+ elevation) instead`, `flexDirection: expected one of: row, column, row-reverse, column-reverse`. Every malformed input tried during wall-mapping produced a precise, corrective message.

## Environment caveats (not product bugs)

- The sandboxed preview browser cannot rasterize via `html-to-image` at all (hangs on a bare div), so `get_canvas_screenshot` could not be exercised to success here.
- A hidden second Studio page existed in the preview harness all session (every console line appears twice); it is what surfaced Finding 2 — a lucky accident, since any user with two tabs would eventually hit the same class of bug.

## Generated code audit

Independent review pass (Opus subagent) over `test-repos/loop-habits`, ordered by severity:

1. **[Blocking — FIXED]** The first instance of every promoted component rendered blank and failed `tsc`: promote leaves the original node as an empty-override instance ("use template defaults"), but MCP-exposed props had no defaults → codegen emitted all-required props and bare `<RowHabit />` tags. Fixed (commit `9b5fa57`): prop exposure now captures the template's current text/style value as the prop default; regenerated components emit optional props with default parameter values (`name = "Meditate"`), and the rebuilt app typechecks conceptually clean.
2. **[High]** Fixed root dimensions (390×844) on every screen — a pixel-perfect design frame, not a responsive app. Codegen should emit `flex: 1` roots inside `SafeAreaView`.
3. **[High]** No `ScrollView` anywhere; Settings/Today overflow is unreachable, worse under text scaling.
4. **[High]** `fontFamily: "Inter"` on ~40 Text nodes with no font loading (`expo-font` absent).
5. **[Medium]** `Pressable` with no `onPress` and no way to expose one; no accessibility props anywhere (roles, labels, font scaling).
6. **[Medium]** Design-relative sizes baked as absolute pixels (progress fill `width: 181` inside a 390-wide design instead of `60%`).
7. **[Low]** Style duplication (seven identical weekday-label styles emitted as `text4`–`text10`); opaque autogenerated style names (`view7`); unused `@expo/vector-icons` dep; `screen-1.tsx` bootstrap cruft.

**Sidecar consistency: clean.** All three sidecars share the same four component definitions with identical ids; every sidecar root round-trips exactly to its `.tsx` (instance counts and nesting match).

Auditor's verdict, post-fix: component reuse is genuinely good (screens import shared components, no inline duplication, stable ids); the remaining gap between this and shippable frontend is codegen policy — responsive roots, scroll containers, interaction/accessibility props, font loading — not correctness.

## Verdict on "building with the MCP"

With the extended surface, the loop is genuinely good: **declare a subtree → get ids back → promote to component with exposed props → place + override instances → autosync writes real files**. 56 calls for a polished three-screen app with a shared component library is efficient, the validation layer teaches the agent RN's rules as it goes, and the sidecar/codegen round-trip means the artifact is a real repo, not a canvas export. The gaps to close for agent workflows, in order: screenshot reliability (an agent's only eyes), prop defaults on exposure, an explicit `save`/`sync` acknowledgment (the agent currently trusts autosync), and tokens/variants — neither is reachable over MCP yet.
