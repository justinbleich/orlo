# Task App Browser QA - 2026-07-06

## Scope

Browser Use QA pass after commits:

- `4be6119 Improve component editing authoring flow`
- `db2c156 Keep codegen internals out of Studio bundle`

Goal: enter Studio from a fresh browser refresh, create a small three-screen task app with simple components, and end with a wired flow.

Chosen app concept: a simple task app with Dashboard/List, Task Detail, and Add Task screens, plus a card component and primary button component.

## Result

Partial success with blockers.

- Created a third screen route: `generated/screen-1-2.tsx` / `generated/screen-1-2.rncanvas.json`.
- Authored visible content on the third screen:
  - Header text: `Today`
  - Styled task-card shell
  - Styled primary-button shell
  - A loose label text node
- Created two components from the canvas:
  - `TaskCard`
  - `ButtonPrimary`
- Added the new screen to `Onboarding Flow`; `.rncanvas/flows.json` now contains three routes in that flow.
- Could not complete a clean designer-authored, fully wired three-screen task app because cross-screen navigation and flow editing became unreliable after an `Invalid token registry: name duplicate token name in category` error.

## Browser Steps

1. Opened Studio at `http://localhost:5173/`.
2. Confirmed Studio booted and rendered chrome after the bundle fix.
3. Clicked `Add screen route`.
4. Studio created and autosynced `generated/screen-1-2.tsx`.
5. Drew a `Text` primitive on the new screen.
6. Edited the text content to `Today`.
7. Drew a `View` card shell.
8. Edited card name/style from the inspector:
   - name: `Task card`
   - fill: `#F8FAFC`
   - border width: `1`
   - radius: `16`
   - border color: `#E2E8F0`
9. Created a component from the card shell.
10. Opened Insert menu and drew a `Pressable`.
11. Edited Pressable name/style:
    - name: `Button.Primary`
    - height: `56`
    - fill: `#2563EB`
    - radius: `16`
12. Drew a `Text` label near/over the Pressable.
13. Created a component from the Pressable.
14. Opened `Onboarding Flow`.
15. Used `Add screen to flow` to add the new screen to the flow.
16. Attempted to add/wire remaining screens via Flow workspace controls.

## What Worked

- Fresh Studio booted and rendered after the codegen-in-client import fix.
- Adding a screen route from the left panel worked.
- Autosync created the new screen source and sidecar files.
- Primitive tools were enabled once a screen was focused.
- Drawing `Text`, `View`, and `Pressable` primitives worked.
- Text content editing worked from the inspector.
- Number replacement behaved correctly in this pass: replacing values like height/radius did not append stale digits.
- Creating a component from a selected `View` worked.
- Creating a component from a selected `Pressable` worked.
- The new dotted-name-safe path worked at codegen level: `Button.Primary` authored on the layer produced a component named/filed as `ButtonPrimary`.
- Flow workspace opened and could add the new screen to `Onboarding Flow`.

## Findings

### P0/P1 - Duplicate Token Registry Error Blocks Cross-Screen Work

After creating components/screen content, attempts to open another screen produced:

`Invalid token registry: name duplicate token name in category`

Observed impact:

- Clicking another screen row did not switch the working screen.
- Coordinate-clicking the same row did not switch either.
- The error persisted into Flow workspace.
- The flow inspector remained usable only partially.

Likely source:

- `generated/screen-1-2.rncanvas.json` contains copied token names such as `color1`, `canvas`, `space1`, `full.radius`, `text1`, and `text2`.
- Existing generated sidecars/components appear to contain overlapping token names from prior QA passes.
- Opening or syncing across multiple roots may merge token registries by id without reconciling duplicate category/name pairs.

Recommendation:

- Add a token-registry reconciliation path when opening/syncing multiple repo screens and component sidecars.
- Treat same category/name/value as the same token or mint stable non-colliding names during import.
- Make the user-facing error actionable: identify duplicate category/name and source file(s).

### P1 - Flow Workspace Badge and Route State Are Inconsistent

Before adding the screen to the flow:

- Left panel showed `Onboarding Flow` with badge `2`.
- Screen rows showed flow badges.
- Flow workspace showed `Routes 0` and `No screens in this flow yet`.

After adding Screen 1:

- Left panel showed `Onboarding Flow` with badge `3`.
- `.rncanvas/flows.json` contained three routes.
- Flow workspace canvas still visibly presented only one route card in the session.
- Inspector add-screen combobox became disabled after adding the first route.
- The separate flow-header `+` was ambiguous by accessible name and did not visibly add a route when clicked by coordinate.

Recommendation:

- Make Flow workspace read the same route list represented by left-nav badges and `.rncanvas/flows.json`.
- Keep the add-screen control enabled while unadded screens remain.
- Give the header add button a distinct accessible name, for example `Add route to flow`.

### P1 - Component Authoring Creates Shells When Designers Expect Groups

Creating `TaskCard` from the card shell worked, but the text was a sibling because I selected only the `View`.

Creating text after selecting a `Pressable` also produced a sibling text node rather than an obvious child/label inside the Pressable.

Observed output:

- `TaskCard` template is a styled empty `View`.
- `ButtonPrimary` template is a styled empty `Pressable`.
- Loose `Text` nodes remain on the screen.

Recommendation:

- Add a clear “wrap selection as component” or multi-select create-component path.
- When a container is selected and a primitive is inserted inside its bounds, provide explicit feedback about whether it will become a child or sibling.
- For Pressable, offer a button preset that creates `Pressable + Text` as a nested structure.

### P1 - Dotted Component Display Path Is Flattened During Promotion

I named the Pressable layer `Button.Primary`, then promoted it.

Result:

- Instance row: `ButtonPrimary · instance`
- Component list: `ButtonPrimary`
- Generated component path: `generated/components/ButtonPrimary.tsx`
- Template design name retains `Button.Primary`.

This is codegen-safe, but it does not preserve the designer-facing display path in the component list.

Recommendation:

- Store a separate `displayName` or `pathName` for components.
- Display `Button.Primary` in Studio while emitting `ButtonPrimary.tsx` / `ButtonPrimary`.

### P2 - Inspector Inputs Remain Difficult To Target And Scan

The inspector has many numeric/text inputs with no useful `aria-label` in DOM snapshots. Browser QA had to rely on positional input indexes for fill, border, radius, etc.

Recommendation:

- Ensure every inspector input has a stable label/aria-label matching visible labels like `Fill`, `Radius`, `Border width`, `Content`, `Size`.
- This improves accessibility and makes future Browser Use QA far less brittle.

### P2 - Insert Menu Is Good, But Toolbar State Can Be Fragile

The Insert menu worked well once opened visually and selected from a fresh snapshot. Earlier, a stale menu locator timed out and Studio appeared to lose component context until the screen was reselected.

Recommendation:

- Keep menu items mounted/locatable only while visible, or expose more stable test ids.
- After menu dismissal/timeouts, preserve the active screen context visually.

## Generated Artifacts From This QA

New/untracked artifacts observed:

- `generated/screen-1-2.tsx`
- `generated/screen-1-2.rncanvas.json`
- `generated/components/TaskCard.tsx`

Existing dirty/untracked artifacts from prior QA remain present:

- `generated/components/ButtonPrimary.tsx`
- `generated/components/PressableComponent.tsx`
- existing generated screen/component files modified by autosync

## Completion Against Goal

- Three screens: yes, Studio shows three screen routes.
- Simple components: partially yes, created `TaskCard` and `ButtonPrimary`, but both are shells due child/group authoring ambiguity.
- Wired flow: partially yes, `.rncanvas/flows.json` contains three routes in `Onboarding Flow`, but the Flow workspace UI showed inconsistent route state and wiring could not be completed/verified cleanly.

## Suggested Next Plan

1. Fix token-registry duplicate reconciliation across multi-screen/component sync.
2. Fix Flow workspace route source-of-truth mismatch.
3. Improve add-route controls and accessible names in Flow workspace.
4. Add component authoring presets/wrap-selection support for common UI structures.
5. Preserve component display paths separately from emitted identifiers.
6. Add aria labels/test ids for inspector fields and toolbar/menu actions.
