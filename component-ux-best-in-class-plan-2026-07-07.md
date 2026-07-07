# Component UX Best-in-Class Plan

Date: 2026-07-07

## Research Baseline

### Figma

Figma's component model has a few durable ideas worth borrowing:

- A component has a clear split between the main definition and placed instances. Instances inherit changes from the main component while allowing controlled overrides.
- Variants group related components into a component set, with named property axes like `size`, `state`, or `color`, and unique values per variant combination.
- Figma explicitly recommends organizing variants spatially in rows, columns, or grids when the component has multiple dimensions.
- Component sets can be dragged from Assets and swapped like regular components.
- Component properties make instance editing possible without deep-selecting internals. Text, boolean, instance swap, variant, and slot-like flexibility are all exposed as right-panel controls.
- Exposed nested instances let a user select a top-level instance and edit nested component properties from one place. Hovering a property row highlights the corresponding object on canvas.

Sources:

- Figma components overview: https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma
- Figma variants: https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants
- Figma component properties: https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties

### Paper / Paper-Prototyping Principles

Paper-like UX is useful here less as a literal feature match and more as a design standard:

- The user should be able to point, make, adjust, and test without ceremony.
- The tool should preserve flow and make states physically obvious.
- Early component authoring should feel recoverable, low-risk, and fast, not like operating a hidden data model.
- A rough-but-editable object is better than a polished shell that traps the user.

Source:

- Paper prototyping overview: https://en.wikipedia.org/wiki/Paper_prototyping

### RN Canvas Difference

Studio is not Figma and should not become Figma. The core difference is that every object has to remain valid RN/codegen data. That means the best UX is not freeform drawing first and reconciliation later; it is direct manipulation over a constrained, code-valid model.

So the bar should be:

- Figma-level discoverability and component organization.
- Paper-level directness and reversibility.
- RN-aware constraints surfaced as helpful affordances, not hidden failures.

## Comparison And Decisions

This plan does not assume Figma is better. Figma is optimized for general-purpose visual design and library management. Studio is optimized for RN-valid app construction, codegen, and direct editing of real component definitions. The useful comparison is therefore not "copy Figma", but "which model creates less doubt for a designer while preserving code-valid structure?"

### Keep From Studio

1. **Focused component edit mode.**
   Keep it. A dedicated `Component · Name` workspace is better for Studio than Figma's main-component-on-canvas mental model because Studio components are live RN/codegen definitions. Focus mode makes save/discard, variants, generated code, and usage easier to reason about.

2. **Row click opens component editing.**
   Keep the new behavior. In Studio, the Components panel is closer to a project object browser than Figma's Assets panel. Clicking a component should edit that definition. Placement should be explicit.

3. **Save/discard boundary when switching components.**
   Keep and refine it. Figma can often rely on always-live edits; Studio needs a stronger transaction boundary because generated files, sidecars, variants, and code-safe names can change together.

4. **Variant matrix as a real editing surface.**
   Keep the matrix. It is stronger than Figma's mostly-canvas-positioned component set for Studio because it can understand code axes, override counts, missing combinations, and generated props.

### Borrow From Figma

1. **Instance configuration belongs on the selected instance.**
   Figma is better here. Selecting an instance should expose allowed props/variants without requiring deep selection or entering definition edit.

2. **Component properties are the reusable contract.**
   Figma is better here. Studio's components are not really reusable until label/title/slot/state controls are exposed as instance props.

3. **Variant axes need designer-readable names and values.**
   Figma is better here. Studio should keep its code-safe model, but the UX should lead with axes like `state`, `size`, `tone`, and `icon`, not raw override mechanics.

4. **Nested/exposed controls should be discoverable from the top level.**
   Figma is better here. Studio should expose nested component props and highlight affected canvas layers when hovering property rows.

### Borrow From Paper

1. **Make creation feel physical and recoverable.**
   Paper-like UX is the right benchmark for creating a component: select something, see what will be included, name it, expose the obvious knobs, and continue.

2. **Avoid hidden mode switches.**
   Any mode switch should have a visible label, a reversible action, and one obvious next step.

3. **Prefer rough editable structure over polished dead shells.**
   A button/card preset should create useful editable children and props. A primitive should remain neutral.

### Explicit Choices

- **Keep component edit mode.** Improve it; do not replace it with Figma-style main components living among screens.
- **Keep component rows as edit.** Add separate placement via Insert, place icon, and later drag-to-canvas.
- **Keep variant matrix.** Remove duplicate rail/tab confusion and make the matrix/axis editor the single variants surface.
- **Adopt Figma-like instance props.** This is the most important gap versus mature design tools.
- **Adopt Paper-like create flows.** Create-from-selection and presets should be direct, visible, and reversible.
- **Do not prescribe primitives.** `Pressable` stays neutral; `Button` is a semantic component preset.

## Product Principles

1. **Component rows mean edit.**
   The Components panel is an inventory of reusable definitions. Clicking an item should open that component for editing. Placement should move to a separate, explicit affordance.

2. **Instances are configured, definitions are edited.**
   Selecting an instance on a screen should never make Studio feel like it entered component edit mode. The inspector should say "Instance" and expose allowed props/variants. Opening the definition is a deliberate action.

3. **Every mode switch has a visible contract.**
   If the user leaves an edited component, Studio should ask whether to save or discard. If there are no changes, switch immediately.

4. **Creation starts from intent, not primitive mechanics.**
   Designers think "Button", "Card", "List item", "Input", not "Pressable with Text child and exposed prop". Primitive creation remains available, but component creation needs authored presets and wrapping flows.

5. **Variants are axes plus matrix, not tabs plus rails.**
   The user should define variant dimensions, values, and defaults in one place, then edit each combination. The matrix should be Studio's stronger alternative to Figma's canvas-arranged component set.

6. **Expose props as part of authoring.**
   A reusable component is not "real" until common instance-level knobs are exposed. The tool should suggest label/title/subtitle/icon/disabled/state props based on structure.

7. **Recoverability beats cleverness.**
   Empty, invalid, or partial templates should show a repairable authoring state. No gray renderer `Error` placeholders during normal component editing.

## Recommended Information Architecture

### Left Panel

Sections:

- Flows
- Screens
- Components
- Design System
- Changes

Component row behavior:

- Click row: open component edit.
- Active row: the currently edited component.
- Secondary action: delete, with confirmation.
- Separate placement affordance: a small "Place" drag handle/icon, or an Insert menu entry. Do not overload row click.

Component grouping:

- Support designer-facing paths like `Button/Primary`, `Button/Secondary`, `Card/Task`.
- Store `displayPath` separately from emitted code identifier.
- Render groups as collapsible sections in the Components panel.
- Keep generated filenames code-safe, e.g. `ButtonPrimary.tsx`.

Empty state:

- If no components are hydrated, say what is true: "No components loaded. Open a screen or scan components."
- Long term: hydrate repo component sidecars on Studio entry.

### Component Workspace

The component workspace should remain a focused editor. This is one of Studio's better choices versus Figma because it makes component definition editing deliberate and transactional. The improvement is not to remove focus mode; it is to make the mode simpler, more obvious, and less crowded.

Header:

- Breadcrumb: `Components / Button / Primary`
- Rename field
- Save, Discard, Done
- Dirty indicator

Main canvas:

- Shows the editable template.
- Always has a selectable root.
- Supports the same add-child primitives as screen editing.
- Includes component-specific quick actions: Add label, Add slot, Add icon, Add state.

Variant area:

- One variants surface only.
- Prefer a compact axes/matrix panel that can switch between:
  - Axis editor
  - Matrix preview
  - Active combination editor
- Avoid duplicating a variants rail plus top `Variants` tab.
- Treat the matrix as the primary variant workspace, not a secondary preview.

Right inspector:

- For selected template layers: visual/layout controls.
- For component root: component properties, variants, docs/description, usage.
- For variant combination: clearly label `Editing Base`, `Editing Hover`, etc.

Tabs:

- Keep tabs only if they represent distinct tasks that cannot live in the inspector.
- Recommended: Canvas, Usage, Docs.
- Move Variants into the main component editor surface instead of a top tab plus rail.
- Keep the component focus workspace itself; do not collapse component editing back into normal screen mode.

## Creation UX Plan

### 1. Create From Selection

Add a first-class command:

- Button: `Create component`
- Available when a non-root layer or normalized multi-selection is selected.
- Preview exactly what will be included.
- Ask for:
  - Display path
  - Component type/preset, optional
  - Initial exposed props
- Result:
  - Creates definition
  - Replaces selection with an instance
  - Opens the new component in edit mode

This should replace the current feeling of "I hope the selected thing becomes the right shell."

### 2. Component Presets

Add RN-aware presets that create useful structure without pretending primitives are semantic components:

- Button
  - `Pressable` root
  - `Text` child
  - Exposed props: `label`, `disabled`
  - Variant axis: `state = default / hover / pressed / disabled`
- Card
  - `View` root
  - Optional title/body slots or text props
  - Exposed props: `title`, `subtitle`, `body` slot
- List item
  - `Pressable` or `View`
  - title/subtitle/accessory slots
- Input shell
  - `TextInput` with label/helper/error wrappers

Important: keep `Pressable` itself neutral. The semantic preset is `Button`, not the primitive.

### 3. Expose Prop Suggestions

When creating/editing a component, the inspector should suggest:

- Text child named `Label` -> expose `label`
- Text child named `Title` -> expose `title`
- Fill/background token -> expose or bind token
- Pressable disabled style/state -> expose `disabled`
- Nested component instance -> expose selected nested props

Provide one-click "Expose" actions with editable prop names.

### 4. Instance Configuration

Selecting a component instance on a screen should show:

- Component name/path
- Variant selectors
- Exposed props
- Slots
- Override summary
- Buttons:
  - Edit definition
  - Reset overrides
  - Detach, later if in scope

Hovering a prop row should highlight the affected layer in the instance preview, mirroring Figma's nested-property discoverability.

## Variant UX Plan

### Axis Model

Support axes:

- `state`
- `size`
- `tone`
- `icon`
- custom enum axes

Rules:

- Axis names and values must be clear, code-safe, and designer-readable.
- Every variant combination must be unique.
- Missing combinations are allowed, but must show as intentionally absent.
- Default variant is explicit, not implicit by position alone.

### Editing Variants

Recommended flow:

1. Select component.
2. Open Variants panel within component workspace.
3. Add axis/value.
4. Studio creates new combination previews from the base.
5. Select a combination.
6. Edit only overrides for that combination.
7. Inspector clearly shows what is inherited vs overridden.

Matrix behavior:

- Cards show combination label and override count.
- Active card has one visual state only.
- Cards can be filtered by axis.
- Large sets collapse by dimension.
- A "Compare with Base" mode shows visual differences.

Variant editing safeguards:

- Warn on duplicate combinations.
- Prevent editing variant-only overrides while the root/base is selected unless the active combination is explicit.
- Make clearing an override easy.

## Access And Placement

Current row-click-to-edit is right. Now add placement back intentionally:

Options:

1. **Insert menu placement**
   Components appear in Insert under grouped paths. Select one, then click/drag on a screen.

2. **Place action in row**
   A small placement icon on each component row arms placement. The icon must not look like edit.

3. **Drag row to canvas**
   Best long-term paper-like interaction: drag a component from the list onto the screen.

Recommendation:

- Short term: Insert menu + small Place action.
- Long term: drag from Components panel to canvas.

## Error And Recovery UX

Component edit should never strand a designer.

Add dedicated recovery states:

- Empty Pressable: "Add label" quick action.
- Empty View/card shell: "Add text", "Add slot", "Wrap selected content".
- Invalid root: "Repair as View", "Open referenced component", "Discard invalid template".
- Render failure: show component name, failing layer if known, and recovery actions.

Do not show raw renderer/Yoga error UI in the normal authoring canvas.

## Phased Implementation Plan

### Phase 1 — Mode And Access Cleanup

Goal: make component access feel intentional.

- Keep component row click as edit.
- Add explicit Place action or Insert-only placement.
- Add dirty detection for component edit so switch prompts appear only when needed.
- Keep save/discard/cancel switch dialog.
- Ensure selecting an instance never changes workspace header to component edit.
- Add clear instance inspector header.

Success criteria:

- A designer can open component A, switch to B, save/discard knowingly, and never wonder what mode they are in.

### Phase 2 — Real Component Creation

Goal: stop creating shell components.

- Add Create component from selection preview.
- Add Button and Card presets.
- Auto-suggest common exposed props.
- Open newly created component immediately.
- Add empty-template quick actions.

Success criteria:

- A designer can create a reusable primary button with label prop and states in under one minute.
- A designer can create a reusable task card from a rich screen structure without losing children.

### Phase 3 — Instance Configuration

Goal: make instances useful without editing definitions.

- Instance inspector shows props, variants, slots, and override summary.
- Add reset override.
- Add nested exposed props.
- Hover property rows highlights target layer.

Success criteria:

- A placed button instance can change label/state/tone from the inspector.
- A placed task card can change title/subtitle/body without detaching or entering component edit.

### Phase 4 — Variant Authoring Polish

Goal: make variants first-class and scalable.

- Consolidate variant rail/tab into one component variants surface.
- Add axis/value editor.
- Add matrix filtering and large-set handling.
- Add inherited vs overridden indication.
- Add default variant control.

Success criteria:

- A designer can add `state`, `size`, and `tone` axes, edit combinations, and understand exactly what differs.

### Phase 5 — Library Organization

Goal: make component access best-in-class for real projects.

- Add grouped display paths.
- Add search.
- Add component descriptions/docs.
- Add usage list with jump-to-instance.
- Add drag-to-place.
- Add stale/orphan generated file cleanup around rename/cancel.

Success criteria:

- A designer can find, place, edit, and audit components across a multi-screen app without opening code.

## Highest-Leverage Next Steps

1. Add dirty detection to component edit switching.
2. Add a Place affordance now that component row click edits.
3. Add Create component from selection preview.
4. Add Button preset with label prop and state axis.
5. Consolidate component variant UI so there is one obvious place to manage axes and combinations.
