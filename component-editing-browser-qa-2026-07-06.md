# Component Editing Browser QA - 2026-07-06

Branch: `ux/component-editing`  
Commit under test: `3634ddb Simplify component edit variant controls`  
Preview: `pnpm --filter @rn-canvas/studio dev -- --host 127.0.0.1 --port 5173`  
Browser: in-app Browser Use, `http://localhost:5173/`  
Time: 2026-07-06 00:05 PDT

## Scope

Designer-style smoke test of Component Edit from a fresh Studio entry:

- Open Studio.
- Open a screen route.
- Enter component edit from the component list.
- Exercise component canvas, variant matrix, variant preview frames, prop fields, advanced disclosures, usage/docs tabs, Done/Cancel, and a second component.
- Capture UX gaps that should feed the next plan.

Working tree note: repo already had generated/canvas changes before the QA pass. Browser activity autosynced generated files, but no source-code changes were made during the test.

## Baseline

- Studio opened successfully at `http://localhost:5173/`.
- Initial left nav showed two screens and initially `Components 0`.
- Opening `generated/Screen.tsx` hydrated `TextComponent` and `PressableComponent` in the component list.
- Browser console showed no warnings or errors.

## Scenario Log

### 1. Open Screen

Action:
- Clicked `Screen generated/Screen.tsx`.

Result:
- Screen loaded.
- Layer `Contents HomeScreen 4` appeared in screen mode.
- Components list populated with `TextComponent` and `PressableComponent`.
- Design tab was selected in the inspector.

Observation:
- On initial fresh entry, the canvas can look empty until a screen is opened/focused. This is understandable, but a designer may read it as missing content.

### 2. Enter `TextComponent`

Action:
- Clicked the first `Edit component` button.

Result:
- Header changed to `Component · TextComponent`.
- Component workspace appeared with left variant column, component header, `Canvas / Variants / Usage / Docs`, and the right `Design / Code / History` tabs.
- Right panel opened on `Design`.
- Variant panel showed only the matrix, not the previous duplicate chip row.
- Screen layer `Contents` was hidden in component edit mode.

Passes:
- Component edit is discoverable from the component list.
- Unified Design panel is visible immediately.
- Matrix-only switcher matches the latest direction.
- Left `Contents` layer accordion is collapsed/hidden during component edit.

Concern:
- The broader project left nav still remains fully expanded (`Flows`, `Screens`, `Components`, `Design System`, `Changes`). If "left panel collapses in Component Edit" means the whole project nav should compress or hide, that is not implemented. Current behavior only collapses the screen layer contents.

### 3. Switch Variant Through Matrix

Action:
- Clicked `Medium 1 override` in the right matrix.

Result:
- Right panel changed to `Editing size: Medium`.
- Badge changed to `Override`.
- `Hide layer in this variant` appeared.
- Center variant rail selected `Medium`.

Passes:
- Matrix selection updates the active variant.
- Active variant state is visible in both center rail and right inspector.
- Non-base variant exposes the variant-only hide toggle.

UX notes:
- Matrix cards are cramped in the right rail. Four-state components fit, but cards feel dense and text wraps/truncates quickly.
- The active card and keyboard/focus ring can make two cards look selected: after clicking canvas preview, `Medium` was active while `Base` retained a strong orange focus outline. Active state and focus state need clearer visual separation.

### 4. Edit Typography Size In Active Variant

Action:
- With `Medium` active, attempted to replace font size by filling the Size field with `24`.

Result:
- Field became `1824`, appending to the existing `18` instead of replacing it.
- Undo restored the field to `18`.

Finding:
- Number fields can append during programmatic/user-style replacement instead of replacing selected contents. This is a high-priority input ergonomics bug because designers will expect click/fill/typing to replace the current value predictably.

Recommended follow-up:
- Audit `NumberField` editing behavior.
- Ensure focus selects the numeric value or that browser/user fill flows replace rather than append.
- Add a focused test for replacing an existing numeric value.

### 5. Click Variant Preview Frame

Action:
- Switched back to Base via the matrix.
- Clicked the visible Medium preview frame in the canvas.

Result:
- Active variant changed to Medium in one click.
- Right panel showed `Editing size: Medium`.

Pass:
- One-click variant preview activation works.

UX note:
- Because the right rail matrix focus outline stayed on the previously clicked Base card, it briefly looked like Base and Medium were both selected. Use a quieter focus treatment or a clearer active treatment.

### 6. Open `Edit variants`

Action:
- Opened `Edit variants`.

Result:
- Axis editor appeared with `size`, value chips, remove buttons, `Add value...`, and `Add a variant property`.

Pass:
- Axis mechanics are reachable without leaving Design.

UX notes:
- When `Edit variants` is open, it consumes a lot of vertical space above Properties and visual controls.
- Combined with prop `Advanced`, the right panel becomes a long management surface again. It works, but the common design controls get pushed down quickly.

### 7. Open Prop Advanced

Action:
- Opened `Advanced` for `textColor`.

Result:
- Advanced area showed Name, Type, Targets, and Remove property.

Pass:
- Type/target mechanics are behind disclosure as intended.
- Main row stays design-forward until expanded.

UX notes:
- The expanded prop is readable but dense.
- The focus outline on the disclosure is visually heavy and competes with the row content.

### 8. Center Workspace Tabs

Action:
- Opened `Variants`, `Usage (1)`, and `Docs`.

Results:
- `Variants` showed a card grid for Base, Medium, Large.
- `Usage (1)` contained `HomeScreen x1` in the DOM.
- `Docs` showed `Docs coming soon.`

Findings:
- `Variants` works and visually reflects active state.
- `Usage` technically has data, but visually appears almost empty: the usage item renders like a tiny faint sliver in the large content area. It needs a readable list/card treatment.
- `Docs coming soon` is expected for now, but it reads unfinished inside an otherwise polished workspace.

### 9. Done Exit

Action:
- Clicked `Done` from `TextComponent`.

Result:
- Returned to Screen workspace.
- Component list remained available.
- Design tab restored for screen inspector.

Pass:
- Done exits cleanly.

UX note:
- A visible `Back to content` button remained floating over the canvas after returning to the screen. If this is tldraw accessibility chrome, it still reads as unexpected product UI in this app shell.

### 10. Enter `PressableComponent`

Action:
- Clicked the second `Edit component` button.

Result:
- Header changed to `Component · PressableComponent`.
- Variant matrix showed Base, Hover, Pressed, Disabled.
- Properties initially showed empty state.
- Visual controls showed Pressable layout, absolute position, tokens, and appearance controls.

Passes:
- Second component opens correctly.
- Four-state matrix is functional.
- Empty prop state explains how to expose a property from the selected layer.

UX notes:
- The four-card matrix is serviceable but tight in the right rail.
- Token rows in the DOM/accessibility text concatenate labels and values (`space18`, `full.radius999`). Visually, token rows also feel cramped. Add spacing/structure so token name, value, count, and action are distinct.

### 11. Add Property Menu

Action:
- Clicked `Add property` on Pressable.

Result:
- Menu opened with `Color`, `Visibility`, and `Slot`.

Pass:
- Menu choices match the selected Pressable/container capabilities.

### 12. Add Visibility Property, Then Cancel

Action:
- Clicked `Visibility`.
- Confirmed the new `visible Boolean` field appeared.
- Clicked `Cancel`.

Result:
- Field showed as a design-forward boolean control with `On / Off`.
- Cancel returned to screen mode.
- The exploratory property addition was discarded.

Passes:
- Adding an exposed prop works.
- Boolean prop UI reads like a field rather than a type table.
- Cancel discards transient component edits.

## Findings

### P1 - NumberField replacement can append instead of replace

Replacing Medium font size with `24` produced `1824`. Undo restored the prior value.

Impact:
- Designers can accidentally create huge values while editing.
- This undermines trust in the unified Design panel.

Plan:
- Audit `NumberField` event handling and focus/select behavior.
- Prefer select-on-focus or robust replacement behavior for text entry.
- Add regression coverage for replacing `18` with `24`.

### P1 - Usage tab is visually too weak

`Usage (1)` contained `HomeScreen x1`, but the tab visually looked almost empty.

Impact:
- Designers cannot confidently locate where a component is used.

Plan:
- Render usage as readable rows/cards with screen name, path, count, and click target.
- Consider a "go to usage" action.

### P2 - Matrix active vs focus state is ambiguous

After switching by matrix and then clicking a canvas preview, the active variant was correct, but a previous matrix card could keep a strong focus outline.

Impact:
- It can look like two variants are selected.

Plan:
- Make active state primary and focus state subtler.
- Use focus ring outside the card or a lower-contrast outline.

### P2 - Right rail can become management-heavy again

Opening both `Edit variants` and prop `Advanced` pushes design controls down.

Impact:
- The unified panel works, but advanced management can crowd the common styling path.

Plan:
- Consider auto-closing `Edit variants` when another advanced disclosure opens.
- Consider making advanced sections accordions with remembered but exclusive open state.
- Consider moving axis definition to a compact modal/popover if the rail remains too dense.

### P2 - Left panel collapse semantics need a decision

Layer contents are collapsed/hidden in Component Edit, but the full project nav remains expanded.

Impact:
- If the design goal is "variants are primary," the project nav still competes for attention.

Plan:
- Decide whether Component Edit should collapse only screen Contents or compress/hide the broader project nav.
- If broader collapse is desired, add a component-edit left-nav compact mode.

### P2 - `Back to content` appears over canvas after exiting component edit

After Done/Cancel, a `Back to content` control remained visible over the canvas.

Impact:
- Reads as product UI clutter and can confuse designers.

Plan:
- Verify whether this is tldraw focus/accessibility chrome.
- Hide or restyle it if possible within license/accessibility constraints.

### P3 - Token rows concatenate labels/values

Token section exposed strings like `space18` and `full.radius999` in DOM/accessibility text, and rows are visually cramped.

Impact:
- Lower polish and accessibility clarity.

Plan:
- Separate token name, value, usage count, and unlink action with clearer layout and accessible labels.

### P3 - Initial fresh Studio can look empty before opening a screen

Fresh Studio showed an empty grid until a screen route was opened/focused.

Impact:
- A designer may think content failed to load.

Plan:
- Auto-focus the active repo screen more aggressively on fresh load.
- Or show a centered "Open a screen" affordance when no frame is visible.

## What Worked Well

- Entering component edit from the component list works.
- The right panel opens on Design in component edit.
- Matrix-only variant switching matches the requested simplification.
- One-click canvas preview activation works.
- Variant style target updates correctly when switching by matrix or canvas preview.
- Prop rows are now field-like and advanced details are behind disclosure.
- Add property menu is contextual and useful.
- Done and Cancel both return to screen mode cleanly.
- No console warnings or errors appeared during the pass.

## Suggested Next Plan

1. Fix NumberField replacement behavior and add regression coverage.
2. Redesign Usage tab into readable actionable rows/cards.
3. Clarify matrix focus vs active styling.
4. Decide and implement the intended Component Edit left-nav collapse level.
5. Reduce right-rail density when advanced disclosures are open.
6. Investigate/remediate `Back to content` canvas overlay.
7. Polish token rows for visual and accessibility clarity.

