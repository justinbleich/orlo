# Task App Browser QA Rerun - 2026-07-06

## Scope

Browser Use QA pass after `5a44f34 Unblock multi-screen flow QA`.

Goal: try to make the same small task app again from a fresh Studio refresh, with real app structure/features rather than a purely visual polish pass.

Chosen app shape, matching the prior pass:

- Three screens: task start/list, detail/hero, and home/dashboard.
- Simple reusable components: `TaskCard` and `ButtonPrimary`.
- A wired flow with route order and success navigation.

Preview: `pnpm --filter @rn-canvas/studio dev -- --host 127.0.0.1 --port 5173`  
Browser: in-app Browser Use at `http://localhost:5173/`

## Result

Material improvement. The prior P0/P1 blockers are unblocked, and the task app can now be represented as a three-screen routed flow.

- Fresh Studio load did not show `Invalid token registry`.
- Opening `generated/screen-1-2.tsx` hydrated `TaskCard` and `ButtonPrimary`.
- Placing `TaskCard` and `ButtonPrimary` component instances worked and autosynced.
- Adding a new heading text worked partially; the visible task screen retained `Today`.
- `Onboarding Flow` opened with `Routes 3`, matching the left nav and manifest state.
- The Flow Inspector success picker updated `SUCCESS` from `Select success` to `Hero`.
- `New Flow` started with one route, then the header `Add route to flow` button added the two missing routes and disabled when all three screens were present.
- Browser console reported no errors or warnings.

Still not a clean end-to-end app-authoring win because component/content authoring remains shell-like and brittle.

## Scenario Log

### 1. Fresh Studio Refresh

Action:

- Opened Studio fresh at `http://localhost:5173/`.

Result:

- Studio loaded.
- Left nav showed:
  - `Onboarding Flow` with `3`
  - `New Flow` with `1`
  - three screens
  - `Components 0`
- No `Invalid token registry` error appeared.

Finding:

- The token-registry blocker appears fixed.
- Component registry still starts empty until a screen route is opened.

### 2. Open Task Screen

Action:

- Opened `Screen 1 generated/screen-1-2.tsx`.

Result:

- Screen opened cleanly.
- Toolbar primitives were enabled.
- Component list hydrated with `TaskCard` and `ButtonPrimary`.
- No duplicate-token error appeared.

Pass:

- Cross-screen/component hydration is no longer blocked by duplicate token names.

### 3. Place Existing Components

Action:

- Armed `TaskCard` from the component list and placed it on the canvas.
- Re-opened the task screen, armed `ButtonPrimary`, and placed it on the canvas.

Result:

- Both placements produced `ComponentInstance` selections.
- Autosync ran without errors.
- `generated/screen-1-2.rncanvas.json` now contains additional `TaskCard` and `ButtonPrimary` instances.

Findings:

- Placement works.
- After placement, the app header changed to `Component · Untitled` even though the inspector selected a `ComponentInstance` and there was no component-edit chrome such as `Done` or `Cancel`. This is disorienting and makes it look like Studio entered a broken component mode.
- The component instances have no exposed properties, so the inspector says `No exposed properties yet. Use “Edit component” to expose some.`

### 4. Add Task Screen Copy

Action:

- Re-opened the task screen.
- Selected the `Text` tool.
- Clicked the canvas and typed:
  - `Today`
  - `3 priority tasks`
  - `Review pull request`
  - `Ship component QA`

Result:

- Only `Today` persisted visibly/in the sidecar.
- Selection dropped back to `Select a frame to inspect.`
- A separate loose `Text` node with default text remained from earlier authoring.

Finding:

- Single text entry can work, but multiline task content is not reliable from the current canvas interaction path.
- This blocks quickly authoring a real content-rich task screen through normal designer input.

### 5. Verify `Onboarding Flow`

Action:

- Opened `Onboarding Flow`.

Result:

- Flow workspace showed `Routes 3`.
- Flow Inspector showed:
  - `SCREENS 3`
  - `1 Screen 1`
  - `2 Hero`
  - `3 HomeScreen`
  - `ENTRY Screen 1`
- Header `Add route to flow` was disabled because no unadded screens remained.
- The flow canvas showed routed cards and an existing `Wired from Button` edge.

Pass:

- The previous mismatch between left badges, manifest routes, and Flow workspace route count is fixed.

### 6. Wire Success Route

Action:

- Opened the `SUCCESS` picker in Flow Inspector.
- Selected `Hero`.

Result:

- Inspector updated to `SUCCESS Hero`.
- `.rncanvas/flows.json` now includes `successRootId`, `successPath`, and `successPath` metadata for `Onboarding Flow`.
- No console errors or token errors occurred.

Pass:

- Flow Inspector can wire a success target.

Finding:

- The success combobox has no useful accessible name; Browser QA had to identify it as the third `button[role="combobox"]` after confirming positions.
- The visible canvas did not clearly expose a new `Wired from Success` label after setting success, so the inspector is currently the clearest confirmation.

### 7. Add Routes To `New Flow`

Action:

- Opened `New Flow`.
- Used the header `Add route to flow` button twice.

Result:

- Button was enabled when unadded screens remained.
- First click added one route.
- Second click added the remaining route.
- Button disabled when `New Flow` reached `Routes 3`.
- Flow Inspector showed:
  - `1 Hero`
  - `2 Screen 1`
  - `3 HomeScreen`
  - `ENTRY Hero`

Pass:

- The renamed/distinct `Add route to flow` affordance works.
- Add-route state now stays enabled until all available routes are included.

## What Improved Since Prior Task-App QA

- Duplicate token registry errors did not recur while opening screens, placing components, entering Flow workspace, or adding routes.
- Flow workspace and left nav now agree on route counts.
- Header `Add route to flow` is discoverable by accessible name and works in a partially populated flow.
- Inspector route list stays coherent after adding routes.
- Success route wiring works through the inspector.
- Component sidecars from multiple screens hydrate into the component list after opening a screen.

## Remaining Findings

### P1 - Component Instance Placement Mislabels The Workspace As `Component · Untitled`

After placing either `TaskCard` or `ButtonPrimary`, the top header changed to `Component · Untitled`.

Impact:

- A designer appears to be pulled out of screen editing even though they are selecting an instance on the screen.
- It is not obvious whether they are editing a component, an instance, or a broken intermediate state.

Recommendation:

- Keep the workspace header as `Screen` when selecting component instances on a screen.
- If an instance-specific mode is intended, label it explicitly as instance selection rather than component editing.

### P1 - Component Templates Still Produce Shells, Not Real Task UI Components

`TaskCard` and `ButtonPrimary` place successfully, but they remain empty templates:

- `TaskCard` is a styled `View` with no children.
- `ButtonPrimary` is a styled `Pressable` with no label child.
- Neither component exposes props, so instances cannot be configured from the inspector.

Impact:

- The app can have reusable structure, but not yet reusable real task content like title, due date, state, or button label.

Recommendation:

- Add a button preset or promotion path that creates `Pressable + Text`.
- Add a card preset or wrap-selection path that captures child text/content.
- Expose common props during component creation, especially `label`, `title`, and `subtitle`.

### P1 - Multiline Text Authoring Is Not Reliable

Typing multiline task content onto the canvas only persisted `Today`.

Impact:

- Creating realistic task content such as checklist rows, task titles, descriptions, and empty states is slow or brittle.

Recommendation:

- Make text creation/editing retain focus for multiline input, or provide a stable inspector `Content` field with accessible labeling.
- Preserve selection after text creation so the designer can keep editing.

### P2 - Fresh Entry Still Shows `Components 0`

On fresh refresh, components were not visible until opening a screen route.

Impact:

- Designers may think components were lost.

Recommendation:

- Hydrate repo component sidecars on fresh Studio entry, or show a clear "open a screen to load components" state.

### P2 - Flow Inspector Comboboxes Need Better Labels

The success picker was visible as `Select success`, but role-based lookup by accessible name failed. Browser QA had to use positional targeting.

Impact:

- Accessibility and automation are both weaker than they should be.

Recommendation:

- Give flow inspector comboboxes stable accessible names such as `Entry screen`, `Success screen`, and `Add screen to flow`.

## Artifacts Touched

Observed dirty/generated artifacts after this pass:

- `.rncanvas/flows.json`
- `.rncanvas/canvas.json`
- `generated/screen-1-2.rncanvas.json`
- `generated/screen-1-2.tsx`
- existing generated screen/component files from prior QA remain dirty or untracked

Important manifest observations:

- `Onboarding Flow` now has three routes and `SUCCESS Hero`.
- `New Flow` now has three routes after using `Add route to flow` twice.

## Completion Against Goal

- Three screens: yes.
- Simple components: yes structurally, but still shell-like.
- Real features: partially. The app now has task-app route structure, a task heading, reusable card/button instances, and success flow wiring. It still lacks reliable task copy/content and configurable component props.
- Wired flow: yes at the flow/manifest level, with route counts and success target confirmed in Studio.

## Suggested Next Plan

1. Fix the `Component · Untitled` header/state after placing component instances.
2. Add practical component authoring presets or wrap-selection creation for button/card patterns.
3. Add exposed props for common component fields during component creation.
4. Make text editing reliable for multiline content and preserve selection.
5. Hydrate component sidecars on fresh entry or explain the empty component state.
6. Add accessible names to Flow Inspector comboboxes and inspector fields.
