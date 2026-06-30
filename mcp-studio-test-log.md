# MCP Studio Test Log

Date: 2026-06-30
Branch: test/mcp-test
Demo repo: test-repos/studio-feature-demo

## Setup Notes

- Product MCP package exists at `packages/mcp-server`.
- MCP tools exposed by the server: `get_status`, `get_tree`, `create_frame`, `delete_frame`, `update_node`, `set_style`, `get_code`, `get_canvas_screenshot`.
- Live mutation/read tools require the Studio browser app to be open, because Studio polls `/api/mcp/next` and posts results to `/api/mcp/result`.
- `get_status` can read direct server readiness first, so agents can see whether the browser bridge is connected before queuing live commands.

## Results

- Done: created a nested demo repo at `test-repos/studio-feature-demo` and initialized it as a Git repo on `main`.
- Done: created a second clean guard repo at `test-repos/studio-autosync-guard-demo` to verify default-canvas autosync behavior.
- Done: started Studio at `http://localhost:5173/`.
- Done: connected Studio to `/Users/justinbleich/react-canvas/test-repos/studio-feature-demo` through `/api/repo/connect`.
- Done: opened Studio in the in-app browser so the browser bridge could poll `/api/mcp/next`.
- Done: exercised the MCP server through an in-memory MCP client backed by the live `StudioBridge`.
- Done: opened `Home` from the demo repo in Studio, then used MCP to read and edit the sidecar-backed `home-root`.
- Done: added and verified MCP `get_status` for bridge/repo/document readiness.
- Done: added and verified an autosync guard so connecting a repo does not write the default sample canvas.
- Done: changed project connect/select to create or switch to a Studio-owned branch before scanning/syncing.

## Test Cases

### Repo Scanner

- Pass: detected `Expo`, `React Native`, and `Expo Router`.
- Pass: detected four RN Canvas-backed screens: `AccountSettings`, `Home`, `OnboardingDetails`, `OnboardingStart`.
- Pass: detected sidecars for all four screens.
- Pass: detected `assets/images/brand-mark.svg` as an image asset.
- Pass: inferred `Account` and `Onboarding` flows from routes.
- Note: custom `.rncanvas/flows.json` entries also rendered in Studio, including `Activation Review` and `Account Maintenance`.

### MCP Tool Surface

- Pass: MCP tool list returned `create_frame`, `delete_frame`, `get_canvas_screenshot`, `get_code`, `get_status`, `get_tree`, `set_style`, `update_node`.
- Pass: `get_status` returned bridge activity, active repo path, Git cleanliness, command queue counts, root IDs, and focused root ID.
- Pass: `create_frame` created a live frame with design metadata.
- Pass: `set_style` updated root style values.
- Pass: `update_node` updated design metadata and text props.
- Pass: `get_tree` returned the live canonical document tree.
- Pass: `get_code` returned source and sidecar text for a live root.
- Pass: targeted `get_canvas_screenshot` returned `text,image` content and structured metadata with `source: "canvas"`.
- Pass: `delete_frame` cleaned up the targeted frame after manual MCP testing.

### Demo Screen Workflow

- Pass: clicking `Home` loaded the sidecar-backed `home-root` onto the canvas.
- Pass: MCP `get_tree` for `home-root` returned design name `Home`, first text `Pulseboard`, and background `#F7F8FB`.
- Pass: MCP edited `home-root` padding/gap and changed `home-subtitle` text.
- Pass: Studio visibly reflected the MCP-edited subtitle.
- Pass: autosync wrote the edited screen back to `app/index.tsx` and `app/index.rncanvas.json`.

### Existing Live Test

- Mixed: `RN_CANVAS_LIVE_TEST=1 pnpm --filter @rn-canvas/mcp-server test -- src/live.test.ts` passed the bridge/unit tests and most live MCP operations.
- Fail/intermittent: the live test failed at `src/live.test.ts:72` because the screenshot response did not include an image item during that run.
- Follow-up signal: the later targeted screenshot MCP call succeeded for a manually created frame, returning `SHOT_TYPES text,image`.

### Fix Verification

- Pass: `pnpm --filter @rn-canvas/mcp-server test` passes with 8 passing tests and the live test skipped by default.
- Pass: `pnpm --filter @rn-canvas/studio build` passes.
- Pass: `pnpm --filter @rn-canvas/studio test` passes.
- Pass: `/api/mcp/status` reports Studio bridge state without requiring an MCP command to be queued.
- Pass: live MCP `get_status` returned `browserBridgeActive: true`, `repoPath: test-repos/studio-autosync-guard-demo`, `git.clean: true`, and focused document root metadata.
- Pass: after connecting/loading `studio-autosync-guard-demo`, waiting past the autosync debounce left the repo clean and did not create `generated/Screen.tsx` or `generated/Screen.rncanvas.json`.
- Pass: connecting `studio-autosync-guard-demo` created/switched to `studio/studio-autosync-guard-demo-2026-06-30`; API returned `designSession.mode: "studio-branch"` and Git confirmed that branch was checked out cleanly.

## Findings

- Working well: The MCP bridge architecture is usable end to end once Studio is open in a browser.
- Working well: Repo connection and scanning are useful immediately; frameworks, screens, sidecars, flows, and assets all appeared.
- Working well: Agent-authored MCP edits are reflected live in Studio and flow back through autosync.
- Working well: `get_code` and `get_canvas_screenshot` give an agent enough feedback to inspect generated code and visual output.
- Not working well: The MCP server is not mounted as a callable chat tool in this session; testing required a local MCP client script rather than direct `mcp__rn_canvas__...` tool calls.
- Improved in this branch: Live MCP commands now fail fast when the Studio browser bridge is not connected, and `get_status` reports bridge activity before queuing a command.
- Fixed in this branch: Explicit project connect/select now opens work on a Studio-owned branch instead of the previously checked-out branch.
- Fixed in this branch: Studio still starts with the default sample canvas after repo connect, but autosync is now disabled until a repo document is opened/imported or the user manually syncs.
- Tradeoff remains: Autosync/codegen can replace hand-authored `app/index.tsx` implementation with generated StyleSheet code and introduce `app/theme.ts` once a repo screen is explicitly opened and edited, but this now happens on the Studio branch by default.
- Improved in this branch: Screenshot capture now validates PNG data before returning from the browser handler and MCP server.
- Still needs follow-up: The existing live screenshot test failed once even though a targeted screenshot call later passed; if this recurs, log the `content` types and structured payload from the failing live response.
