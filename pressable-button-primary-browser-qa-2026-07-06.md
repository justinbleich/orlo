# Pressable Button Primary Browser QA - 2026-07-06

Branch: `ux/component-editing`  
Commit under test: `fa6f9b8 Document component editing browser QA`  
Preview: `pnpm --filter @rn-canvas/studio dev -- --host 127.0.0.1 --port 5173`  
Browser: in-app Browser Use, `http://localhost:5173/`  
Time: 2026-07-06 08:49 PDT

Related prior log: `component-editing-browser-qa-2026-07-06.md`

## Goal

Start from a fresh Studio refresh, navigate to `PressableComponent`, and try to turn it into a real primary button component with all existing states:

- Desired name: `Button.Primary`
- Existing states: Base, Hover, Pressed, Disabled
- Intended styling direction:
  - Base: primary blue fill
  - Hover: darker blue fill
  - Pressed: deepest blue fill
  - Disabled: muted gray fill
  - Preserve button-like pill geometry and label

This was a designer-workflow test. The failed exploratory component edit was canceled rather than intentionally saved.

## Baseline

- Studio opened fresh at `http://localhost:5173/`.
- Initial refresh again showed `Components 0` until opening a screen route.
- Opening `generated/Screen.tsx` hydrated `TextComponent` and `PressableComponent`.
- Browser console showed no warnings or errors.
- Pre-existing working tree was already dirty with generated/canvas artifacts.

## Scenario Log

### 1. Fresh Studio Refresh

Action:
- Opened/reloaded Studio at `http://localhost:5173/`.

Result:
- App loaded successfully.
- Left nav showed screens, flows, design system, and changes.
- Component list initially showed no components.

Finding:
- Component registry is not hydrated until a screen route is opened. This matches the prior QA pass and remains a fresh-entry UX issue.

### 2. Open Screen

Action:
- Clicked `Screen generated/Screen.tsx` from the left nav.

Result:
- Screen loaded.
- Component list hydrated with `TextComponent` and `PressableComponent`.

Pass:
- Opening a screen recovers component registry state.

### 3. Enter `PressableComponent`

Action:
- Clicked the second `Edit component` icon in the component list.

Result:
- Header changed to `Component · PressableComponent`.
- Component workspace opened with:
  - Left variant rail: Base, Hover, Pressed, Disabled.
  - Center tabs: Canvas, Variants, Usage (1), Docs.
  - Right Design panel with Variant matrix, Properties, and visual controls.

Pass:
- Component edit entry works from a fresh refresh once the screen has been opened.
- The existing variant states are discoverable.

### 4. Rename To `Button.Primary`

Action:
- Filled the component name field with `Button.Primary`.

Result:
- Rename was rejected.
- Studio showed: `Invalid component: name expected a PascalCase component name`.
- Component name reverted to `PressableComponent`.

Finding:
- The current component model does not support dot/group naming such as `Button.Primary`.

Follow-up implication:
- If we want Figma-style component naming/grouping (`Button.Primary`, `Button.Secondary`, etc.), the model, validation, codegen, and component list display need a naming strategy. The current PascalCase-only validation forces `ButtonPrimary`.

### 5. Rename To Allowed Fallback `ButtonPrimary`

Action:
- Filled the component name field with `ButtonPrimary`.

Result:
- Rename succeeded.
- Component list updated to `ButtonPrimary`.
- Header updated to `Component · ButtonPrimary`.

Pass:
- PascalCase rename works.

### 6. Style Base Fill

Action:
- With Base selected, changed the Pressable Fill field from `#3a3a45` to `#2563EB`.

Result:
- Fill field accepted `#2563EB`.
- Component list remained `ButtonPrimary`.
- Autosync produced/generated state.

Visual issue:
- In the Studio canvas, the visible pill body did not become blue. Only a small top-left curved/corner shape changed color.

### 7. Style Hover, Pressed, Disabled

Action:
- Used the left variant rail to select states while the Design panel stayed scrolled to Appearance.
- Set:
  - Hover fill: `#1D4ED8`
  - Pressed fill: `#1E40AF`
  - Disabled fill: `#CBD5E1`

Result:
- Fields accepted values.
- Right matrix updated to show overrides for Hover, Pressed, Disabled.
- Center left variant rail reflected selected states.

Visual issue:
- The visual result still did not look like a primary button. The cards and canvas showed mostly white pill surfaces with only the small top-left curved/corner element taking the state color.

Important codegen observation:
- Autosync generated an untracked `generated/components/ButtonPrimary.tsx` while the edit was active.
- That generated file actually looked close to the intended code:
  - `ButtonPrimaryProps`
  - `state?: "Default" | "Hover" | "Pressed" | "Disabled"`
  - Base `backgroundColor: "#2563EB"`
  - Hover `backgroundColor: "#1D4ED8"`
  - Pressed `backgroundColor: "#1E40AF"`
  - Disabled `backgroundColor: "#CBD5E1"`

Interpretation:
- The model/codegen path captured the intended root Pressable background colors better than the Studio canvas preview communicated.
- The design preview and/or template hit-testing/rendering made the result look broken even though codegen suggested a real button style was being produced.

### 8. Selection Recovery Attempt

Action:
- Clicked inside the visible white pill body to select/styling the apparent button surface.
- Clicked the small colored corner/child shape.

Result:
- Selection cleared.
- Right panel changed to empty states:
  - `Select a template layer, then + to expose a property.`
  - `Select a layer to edit its properties.`
- Clicking the colored shape did not recover visual controls.
- Because Component Edit collapses layer contents, there was no obvious left-panel layer tree escape hatch to reselect the Pressable root.

Finding:
- Selection recovery in Component Edit is fragile. If a designer clears selection, they can lose the ability to continue styling, especially with layer contents hidden.

### 9. Variants Tab Verification

Action:
- Opened the center `Variants` tab.

Result:
- All four state cards existed.
- They still did not visually read as primary button states:
  - Mostly white card/button surfaces.
  - Small colored corner element showing the state color.

Finding:
- The state overview confirms the preview/rendered editing experience does not match the intended button styling.

### 10. Cancel Failed Transformation

Action:
- Clicked `Cancel`.

Result:
- Returned to Screen workspace.
- Component name reverted to `PressableComponent`.
- Screen references still point to `PressableComponent`.
- `generated/components/PressableComponent.tsx` reverted to original naming/style.

Artifact issue:
- Even though Cancel reverted the Studio component edit, autosync left an untracked `generated/components/ButtonPrimary.tsx` file on disk.
- `generated/Screen.tsx` and sidecars still reference `PressableComponent`, not `ButtonPrimary`.

## Findings

### P0/P1 - Canvas preview does not reflect generated Pressable button styling

Changing Pressable root fill values produced expected generated code in `ButtonPrimary.tsx`, but the Studio canvas/Variants previews showed only a small top-left curved element changing color.

Impact:
- A designer cannot trust the canvas while editing button states.
- The workflow feels broken even when generated code may be correct.
- This blocks using Component Edit to create button components confidently.

Likely areas to inspect:
- Pressable rendering in `@rn-canvas/render-web`.
- Component template structure for this generated Pressable.
- Layout/overlay hit-testing around Pressable children.
- Whether a child layer or clipped overlay is visually covering the root Pressable background in Studio.

### P1 - Dot/group component naming is unsupported

`Button.Primary` was rejected because component names must be PascalCase.

Impact:
- Cannot express design-system component groups the way designers expect.
- Blocks naming conventions like `Button.Primary`, `Button.Secondary`, `Input.Default`.

Possible paths:
- Keep code identifiers PascalCase but add separate display name/path metadata.
- Accept dotted display names and generate safe PascalCase exports.
- Show grouped component list sections from display paths.

### P1 - Cancel leaves generated autosync artifacts

Cancel reverted the in-memory component edit, but `generated/components/ButtonPrimary.tsx` remained untracked on disk.

Impact:
- Failed/canceled experiments can leave stale generated files.
- Users may commit artifacts that are not referenced by screens.

Plan:
- Track files created during component edit autosync and clean them on Cancel.
- Or delay writing renamed component files until Done.
- Add orphan generated component cleanup as part of sync.

### P1 - Selection recovery is fragile with collapsed layers

Clicking inside the visible button body cleared selection; clicking the colored visible child did not recover controls. With layer contents hidden, the designer had no obvious way to reselect the root Pressable.

Impact:
- A designer can get stranded mid-edit.

Plan:
- Keep an editing component Contents accordion available in component mode.
- Add a persistent selected-layer breadcrumb/dropdown in the right panel.
- Ensure clicking the visible root surface selects the Pressable root.
- Consider a "Select root" action near the component header or Variant panel.

### P2 - State styling workflow is technically possible but too indirect

Using the left variant rail while the right panel remains scrolled to Appearance worked for entering fill values into Base/Hover/Pressed/Disabled.

Impact:
- This is promising, but only if preview rendering and selection are reliable.

Plan:
- Preserve this workflow: variant rail + right design controls is a good pattern.
- Add explicit state target affordance near sticky right-panel header if the panel is scrolled below the matrix.

### P2 - Fresh Studio requires opening a screen before components exist

Same as prior pass: fresh load showed no components until a screen route was opened.

Impact:
- Component editing is not reachable from a fresh state until the user knows to open a screen.

Plan:
- Hydrate known repo components independently of the active screen.
- Or auto-open/focus the last active screen on refresh.

## What Worked

- Browser opened Studio cleanly.
- Opening `generated/Screen.tsx` hydrated components.
- Pressable component editing opened cleanly.
- The state rail and matrix recognized Base/Hover/Pressed/Disabled.
- PascalCase rename to `ButtonPrimary` worked.
- Fill controls accepted color edits for Base/Hover/Pressed/Disabled.
- Variant overrides were created for Hover, Pressed, Disabled.
- Generated `ButtonPrimary.tsx` looked structurally like a real primary button component.
- Cancel returned to screen mode and reverted the in-app component name.
- No browser console warnings/errors appeared.

## Proposed Combined Phased Plan

This plan combines this pass with `component-editing-browser-qa-2026-07-06.md`.

### Phase 1 - Trust And Safety Of Editing

Goal: make common component editing trustworthy before adding more design-system affordances.

Tasks:
- Fix Pressable/component preview rendering mismatch so canvas and generated code agree.
- Fix NumberField replacement behavior (`18` -> `24`, not `1824`).
- Fix Cancel/autosync cleanup for renamed/generated component files.
- Restore reliable selection recovery in Component Edit:
  - root click selection,
  - selectable component Contents,
  - or persistent selected-layer control.

Acceptance:
- A designer can edit a Pressable root fill and see the whole button change.
- Cancel leaves no orphan generated files.
- A cleared selection can be recovered without leaving Component Edit.
- Numeric values replace predictably.

### Phase 2 - Component Workspace Usability

Goal: make component edit feel like a focused design tool.

Tasks:
- Decide left-nav collapse semantics:
  - collapse only screen contents, or
  - compact/hide broader project nav while component editing.
- Improve matrix active/focus styling so only one state reads as selected.
- Reduce right-rail density when `Edit variants` and prop `Advanced` are open.
- Make Usage tab visually readable and actionable.
- Investigate/remove the `Back to content` canvas overlay after exiting component edit.

Acceptance:
- Variant target is unmistakable.
- Usage tab clearly shows where component instances live.
- Advanced controls do not bury common design controls.

### Phase 3 - Design-System Naming And Button Authoring

Goal: support designer-facing component organization and common component authoring flows.

Tasks:
- Add display-path names such as `Button.Primary` while retaining safe code export names.
- Render grouped component list sections from display paths.
- Add first-class button authoring affordances:
  - label/text prop,
  - disabled state mapping,
  - variant/state presets,
  - optional icon/slot prop.
- Improve token row layout/accessibility (`space1 · 8`, not `space18`).

Acceptance:
- A designer can create/edit `Button.Primary` as a display name.
- Codegen emits safe exports while preserving design-system grouping.
- A button can expose label/state/slot props without diving into model mechanics.

