# Polished Task App Browser QA Rerun — 2026-07-06

## Scope

Fresh Browser Use pass against local Studio at `http://127.0.0.1:5180/`, continuing on `ux/component-editing` after the cleanup commits:

- `e143b08 Document polished task app QA`
- `7bec2e3 Clean up polished app QA blockers`

Goal: attempt the same lightweight task-planning app again, scoped narrowly but aiming for a shippable app feel: multiple screens, real task content, button text, simple reusable components, one richer component, and a wired flow.

## Starting State

Studio opened with the previous QA artifacts already hydrated:

- 3 screens:
  - `generated/Screen.tsx`
  - `generated/screen-1-2.tsx`
  - `generated/screen-1.tsx`
- 4 components:
  - `TextComponent`
  - `PressableComponent`
  - `TaskCard`
  - `ButtonPrimary`
- 2 flows:
  - `Onboarding Flow`
  - `New Flow`
- Dirty repository state was visible in Studio: branch ahead by 2 commits with 12 changed files.

This was not a pristine blank-canvas run. It was a fresh Studio/browser entry into the persisted QA app state, then an attempt to keep shaping the same app into something shippable.

## What Improved

### Pressable Creation Now Produces a Real Button

From the first screen, I opened the toolbar Insert menu and selected `Pressable`.

Observed:

- Insert menu exposed primitives and components clearly:
  - `Pressable`
  - `ScrollView`
  - `TextInput`
  - `FlatList`
  - `TextComponent`
  - `PressableComponent`
  - `TaskCard`
  - `ButtonPrimary`
- After creation, the layer tree showed:
  - `Pressable`
  - nested `Text`
- Canvas showed a visible blue button with default text `Button`.
- Inspector showed useful defaults:
  - Fill `#2563EB`
  - Radius `8`
  - Justify `Center`
  - Align `Center`

Codegen confirmed the new primitive was no longer an empty shell:

```tsx
<Pressable style={styles.pressable}>
  <Text style={styles.text}>Start planning</Text>
</Pressable>
```

This is a real improvement over the previous `Pressable`/`ButtonPrimary` shell problem.

### Inspector Editing Worked For Button Styling

After selecting the new Pressable, I used role-targeted inspector fields to normalize it:

- Width: `295`
- Height: `56`
- Fill: `#2563EB`
- Radius: `16`

Observed:

- The canvas updated.
- Autosync ran.
- Codegen reflected the values in `generated/Screen.tsx`.
- `Fill` and `Radius` were uniquely discoverable as textboxes by role/name.

### Nested Text Editing Worked Without Duplication

I selected the nested `Text` child inside the new Pressable and replaced:

- `Button` -> `Start planning`

Observed:

- Content field was uniquely reachable as `Content`.
- Text changed cleanly to `Start planning`.
- No `ButtonStart planning`, `Start planningButton`, or duplicate stale content appeared.
- Codegen reflected the clean text:

```tsx
<Text style={styles.text}>Start planning</Text>
```

This suggests the stale inline-edit cleanup helped for new text edits.

### Component Instance With Variants Still Generates Correctly

`PressableComponent` continued to generate as a usable button-like component with variant state:

```tsx
interface PressableComponentProps {
  state?: "Default" | "Hover" | "Pressed" | "Disabled";
}
```

It includes a real text child:

```tsx
<Text style={styles.text}>Next</Text>
```

This is the healthiest component in the current QA app.

## Shippability Blockers Still Present

### Creation Position Is Still Unpredictable

The new Pressable did create successfully, but it landed above the main copy in the flex flow. Visually, the first screen ended up with:

1. New `Start planning` button near the top
2. Supporting copy underneath
3. Existing `Next` button near the bottom

For a designer, this still feels hard to control. The operation succeeds technically, but insertion position is not predictable enough for shippable layout work.

Impact:

- A designer can create a real button now, but must immediately repair layout order/position.
- The app can become visually jumbled quickly.

### Existing Duplicated Text Remains Hard To Repair

The main task screen still contains the previously persisted duplicate:

```text
2 tasks dueText2 tasks due
```

I attempted to select it from the canvas and through the expanded layer tree.

Observed:

- The text is visible in the canvas and DOM snapshot.
- Clicking near it entered a focused/nested state, but the inspector remained on the screen root.
- The layer rows are visible but not exposed as stable interactive controls; only their utility buttons are obvious to automation.
- I could not reliably select the specific text node to reach its `Content` field.

Impact:

- New text editing appears better, but repairing existing broken text is still too difficult.
- Layer rows need a clearer accessible/selectable target.

### Component Shells Still Block “Real Components”

Two components in the current app remain structural shells:

`ButtonPrimary`:

```tsx
export function ButtonPrimary({}: ButtonPrimaryProps) {
  return <Pressable style={styles.pressable} />;
}
```

`TaskCard`:

```tsx
export function TaskCard({}: TaskCardProps) {
  return <View style={styles.view} />;
}
```

Impact:

- The app can visually place cards/buttons, but these are not shippable reusable components.
- `ButtonPrimary` has no label, prop, or child text.
- `TaskCard` has no title, metadata, status, or progress content.
- The prior primitive Pressable fix does not retrofit existing component definitions.

### Main Screen Is Not Yet Shippable

Current generated `screen-1-2.tsx` includes useful structure, but also obvious placeholder/broken content:

```tsx
<Text style={styles.text}>Focus Planner</Text>
<Text style={styles.text2}>Today</Text>
<TaskCard />
<ButtonPrimary />
<Text style={styles.text3}>Text</Text>
<View style={styles.view2}>
  <Text style={styles.text4}>2 tasks dueText2 tasks due</Text>
</View>
<TaskCard />
<ButtonPrimary />
<TaskCard />
```

Issues:

- Placeholder `Text` remains.
- Duplicated status copy remains.
- `TaskCard` and `ButtonPrimary` instances render empty shells.
- Screen composition exists, but it is not a shippable task app UI yet.

### Code Tab Context Can Feel Mismatched

While working between screens, the Studio status said `Synced generated/Screen.tsx` even when the selected screen was `Screen 1`. The Code tab then showed changed files and a selected full-file preview, but the relationship between active canvas, sync status, and selected code artifact was not always obvious.

Impact:

- It is easy to lose confidence about which screen is being synced or previewed.
- This matters more when several generated screens are dirty at once.

### Focus Mode For Nested Text Is Helpful But Disorienting

Selecting nested `Text` inside a Pressable entered a focused editing state with a `Back to content` button.

Good:

- It enabled clean editing of the child text.

Rough edge:

- It hid the surrounding screen context while styling text.
- It was not obvious that I had entered a different context until the canvas changed.

Impact:

- This is probably the right concept, but needs stronger affordance and a clearer route back to the screen.

## Flow State

The app does have wired flow metadata.

`Onboarding Flow`:

- Entry: `generated/screen-1-2.tsx`
- Success: `generated/screen-1.tsx`
- Routes include all three screens.
- Edges currently connect from `generated/Screen.tsx` to `generated/screen-1.tsx`, including an anchor edge from a nested button instance.

`New Flow`:

- Entry: `generated/screen-1.tsx`
- Success: `generated/Screen.tsx`
- Edges:
  - `Hero` -> `Screen 1`
  - `Screen 1` -> `Screen`

This is wired enough to validate persistence, but not yet a clear polished product flow. The naming and route order still feel like accumulated QA artifacts rather than a deliberate task app journey.

## Current App Assessment

The app is closer than the last pass, but not shippable yet.

Passes:

- Fresh Studio load hydrated screens/components/flows.
- Insert menu is discoverable.
- New primitive Pressable creates a real labeled button.
- Inspector can style that button.
- Nested text Content editing works without new duplication.
- Autosync/codegen reflect the successful edits.
- Flow metadata persists.

Fails / blockers:

- Existing duplicated text is still hard to select and repair.
- Component shells prevent meaningful reusable `ButtonPrimary` and `TaskCard`.
- Creation insertion order/position is unpredictable.
- Layer rows are not first-class selectable controls.
- Code tab/sync status can point attention at a different file than the active canvas context implies.
- Existing flow names/order read like QA state rather than a polished app.

## Recommended Next Fixes

1. Make layer rows fully selectable and accessible.
   - The row itself should be a button or treeitem with a stable name like `Select layer Text`.
   - Selecting a layer from the tree should update inspector immediately.

2. Add an “insert position” affordance for flex creation.
   - When a frame/root is selected, inserted nodes should have an obvious append behavior or visible insertion marker.
   - Avoid surprising top-of-flow insertion for common button/card creation.

3. Add component-definition repair paths.
   - Editing `ButtonPrimary` should make it easy to add/select a nested label.
   - Existing empty Pressable/View component definitions should be recoverable without recreating from scratch.

4. Seed richer component presets.
   - `ButtonPrimary` should include label text by default.
   - `TaskCard` should include at least title, subtitle/status, and a simple affordance row.

5. Improve text repair for existing duplicated content.
   - Canvas text hit-testing should select the text node reliably.
   - Layer tree selection should be the fallback.

6. Clarify Code tab context.
   - Show active screen path prominently.
   - Sync status should name the screen actually being autosynced or clarify when it is showing another changed file.

7. Add a “clean app QA seed” option.
   - Re-running this QA from accumulated dirty state is useful for persistence testing, but a shippable-app pass needs a predictable reset/duplicate workspace path.

