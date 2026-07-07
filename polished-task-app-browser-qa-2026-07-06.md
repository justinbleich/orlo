# Polished Task App Browser QA - 2026-07-06

## Scope

Browser Use QA pass after:

- `218215d Clean up task app QA blockers`
- `be989d0 Document task app QA rerun`
- `5a44f34 Unblock multi-screen flow QA`

Goal: continue the task-app QA by trying to turn the existing three-screen task/planner app into a fuller, polished-but-not-overbuilt app. This pass specifically targeted:

- fresh Studio entry with hydrated components
- richer screen copy
- text inside buttons
- a real rich component/card pattern
- component edit and component instance placement
- flow state remaining intact while authoring

Preview: `pnpm --filter @rn-canvas/studio dev -- --host 127.0.0.1 --port 5173`  
Browser: in-app Browser Use at `http://localhost:5173/`

## Result

Partial success. The app can now get closer to a real polished planner surface, and the recent cleanup work held up, but the authoring path is still too brittle for a designer to confidently create a polished app end to end.

What worked:

- Fresh Studio entry hydrated all four components immediately:
  - `TextComponent`
  - `PressableComponent`
  - `TaskCard`
  - `ButtonPrimary`
- No duplicate-token registry error appeared.
- Opening `generated/screen-1-2.tsx` worked.
- Screen context stayed stable while selecting component instances and editing content.
- A new styled card shell was drawn and persisted.
- A Text node drawn inside that card shell persisted as a child of the View in the sidecar.
- Inspector-based styling worked for fill/radius/border-like fields.
- Component edit for `ButtonPrimary` opened correctly and showed `Component · ButtonPrimary`, `Cancel`, `Done`, and variant/design controls.

What blocked a truly polished app:

- Canvas text creation is unreliable; typing after creating text often left the default `Text`.
- Inspector text replacement worked but produced duplicated content in one case: `2 tasks dueText2 tasks due`.
- Existing `ButtonPrimary` remains a shell component with no child text or exposed label prop.
- In Component Edit, there is no obvious toolbar for adding a Text child into the Pressable template.
- Keyboard shortcut `T` armed Text in Component Edit, but click/drag did not create a usable label in the button template.
- Multi-select/wrap/promotion could not be completed during this pass. Browser Use stopped on the modifier-click multi-select attempt.

## Scenario Log

### 1. Fresh Studio Entry

Action:

- Opened Studio fresh at `http://localhost:5173/`.

Result:

- Studio loaded in `Screen` workspace.
- Components were visible immediately without opening a screen first:
  - `TextComponent`
  - `PressableComponent`
  - `TaskCard`
  - `ButtonPrimary`
- Flows showed:
  - `Onboarding Flow 3`
  - `New Flow 3`
- No `Invalid token registry` error appeared.

Pass:

- The fresh-entry component hydration fix is working.

### 2. Open Planner Screen

Action:

- Opened `Screen 1 generated/screen-1-2.tsx`.

Result:

- Screen opened cleanly.
- Existing content showed a sparse task/planner layout:
  - heading-ish `Today`
  - empty card shells
  - blue button shells
  - component list still available

Pass:

- Cross-screen load remained stable.

### 3. Add Polished Screen Copy

Action:

- Used the toolbar Text tool to add:
  - `Focus Planner`
  - `Today's priorities`
  - `Review launch checklist`
  - `Create task`

Result:

- Only `Focus Planner` persisted correctly from the direct canvas typing flow.
- Later text attempts either stayed as the default `Text` or appended into the selected text, producing visible `Focus PlannerText` during the session.

Finding:

- Direct canvas text creation/typing is not reliable enough for polished screen copy.
- The workflow needs either stable inline text editing or a clearly labeled inspector `Content` field that reliably updates only the selected text node.

### 4. Use Inspector Content Fallback

Action:

- Selected text and used the inspector Content input (`placeholder="Text..."`) to replace content.

Result:

- The selected text field could be updated through the inspector.
- The Content input still has no accessible label.
- In one card-label case, the persisted text became `2 tasks dueText2 tasks due`.

Persisted sidecar evidence:

```json
{
  "id": "a740265c-761e-4811-9f6b-60bf5e33e732",
  "props": {
    "text": "2 tasks dueText2 tasks due"
  },
  "type": "Text"
}
```

Finding:

- Inspector editing is closer to deterministic than canvas typing, but text replacement can still duplicate/merge stale content.
- Text inspector fields need accessible labels and stronger replace semantics.

### 5. Button With Text Attempt

Action:

- Selected the `ButtonPrimary` instance.
- Used inspector `Edit component` to enter `Component · ButtonPrimary`.
- Tried to add a Text child/label inside the component template:
  - looked for creation toolbar in Component workspace
  - tried keyboard shortcut `T`
  - clicked/dragged inside the component canvas
  - typed `Start focus session`

Result:

- Component Edit opened successfully.
- The creation toolbar was not visible in Component workspace.
- `T` showed status `Text - drag to draw`, but dragging did not create a usable Text child.
- The inspector ended up in an empty-selection state:
  - `Select a template layer, then + to expose a property.`
  - `Select a layer to edit its properties.`
- No `Start focus session` text persisted.

Persisted component definition:

```json
{
  "name": "ButtonPrimary",
  "template": {
    "type": "Pressable",
    "children": [],
    "design": {
      "name": "Button.Primary"
    }
  },
  "props": []
}
```

Finding:

- `ButtonPrimary` can be placed and styled, but it still is not a real button component from a design-system authoring standpoint because it has no label child and no `label` prop.

### 6. Rich Card Attempt

Action:

- Drew a new `View` card shell on the planner screen.
- Styled it through inspector fields:
  - fill `#F8FAFC`
  - border width-like field `1`
  - radius-like field `18`
- Drew a Text layer inside/over the card and attempted to set it to `2 tasks due`.

Result:

- The styled card persisted.
- The Text node persisted as a child of the new `View`, which is a meaningful improvement over earlier shell-only card authoring.
- The text value duplicated into `2 tasks dueText2 tasks due`.

Persisted sidecar evidence:

```json
{
  "id": "6b083665-2e16-480d-a902-34fd85cd651b",
  "type": "View",
  "style": {
    "width": 166,
    "height": 90,
    "backgroundColor": "#F8FAFC",
    "opacity": 1,
    "borderRadius": 18
  },
  "children": [
    {
      "type": "Text",
      "props": {
        "text": "2 tasks dueText2 tasks due"
      }
    }
  ]
}
```

Pass:

- Creating a View with a Text child is possible.
- This is the closest path so far to a real rich component.

Finding:

- The child relationship worked, but the text editing bug prevents the result from feeling polished.
- I could not complete promotion/wrapping into a reusable rich component during this pass.

### 7. Multi-Select / Promote Attempt

Action:

- Attempted to modifier-click for multi-selection of the card/text composition.

Result:

- Browser Use stopped on that modifier-click action due to a browser-control security policy block.
- I stopped browser driving at that point and inspected persisted sidecars locally instead.

Finding:

- This pass could not verify multi-select component promotion.
- Product-side multi-select/wrap-selection affordances remain important, because rich component creation should not depend on brittle modifier-click precision.

## What Improved Since The Previous QA

- Fresh components are hydrated immediately on entry.
- Placing/working with component instances no longer flips the workspace to `Component · Untitled`.
- Flow state remained stable while authoring.
- Component Edit entered the correct named component when opened from an instance.
- A new card with a nested Text child persisted, showing that richer structure is possible.

## Remaining Findings

### P1 - Text Authoring Still Blocks Polished App Creation

Canvas text creation and inspector replacement are still unreliable:

- Direct typing frequently leaves default `Text`.
- Text can append to a prior selection (`Focus PlannerText`).
- Inspector replacement produced duplicated content (`2 tasks dueText2 tasks due`).

Recommendation:

- Fix text creation focus so the new text node receives typed content deterministically.
- Make inspector Content replacement clear stale composition state before applying.
- Add a labeled `Content` field for accessibility and Browser QA.

### P1 - Button Components Need A First-Class Label Path

`ButtonPrimary` is still a Pressable shell:

- no child Text
- no exposed `label` prop
- no visible way in Component Edit to add a label child

Recommendation:

- Add a Button preset: `Pressable` with centered Text child and a default `label` prop.
- Make the Insert/component creation path expose label text automatically.
- Ensure Component Edit has creation controls or a clear "add label" action.

### P1 - Rich Component Promotion Needs A Clear Wrap-Selection Workflow

The best rich structure created in this pass was a styled View with a child Text. Turning that into a reusable component was not completed.

Recommendation:

- Add a visible `Create component from selection` flow for a selected parent and its children.
- Support multi-select/wrap promotion without relying on precise modifier-click behavior.
- Show exactly what will be included in the component before promotion.

### P2 - Inspector Inputs Still Need Stable Labels

Styling the card required positional input targeting:

- fill field
- border width
- radius
- content

Recommendation:

- Add `aria-label` or `data-testid` for every inspector field.
- Use visible labels as accessible names: `Fill`, `Border width`, `Radius`, `Content`, `Width`, `Height`, etc.

### P2 - Component Edit Creation Controls Are Hard To Discover

Component Edit exposed variant/properties/style controls, but no obvious primitive toolbar.

Recommendation:

- Either show the same creation toolbar in Component Edit or add component-template-specific actions like `Add label`, `Add slot`, and `Add child`.

## Artifacts Touched

This Browser QA modified existing generated artifacts and sidecars, including:

- `generated/screen-1-2.rncanvas.json`
- `.rncanvas/canvas.json`
- related generated screen/component outputs from autosync

The notable new persisted model additions in `generated/screen-1-2.rncanvas.json` are:

- `Focus Planner` Text node
- styled `View` card shell
- nested Text child with duplicated content `2 tasks dueText2 tasks due`

## Completion Against Goal

- Full polished app: not yet.
- Real features: partially. The planner screen gained heading/content and a richer card structure, but text quality is broken.
- Text inside buttons: not completed for `ButtonPrimary`; component edit did not provide a usable label-add path.
- Real components: partially. Existing components hydrate and place, but `TaskCard`/`ButtonPrimary` remain shell components. A richer View+Text card exists as screen structure but was not promoted.
- One rich component: not completed as a reusable component, but a rich parent-child card structure did persist on-screen.

## Suggested Next Plan

1. Fix text creation and inspector text replacement duplication.
2. Add labeled inspector fields for text/style editing.
3. Add a first-class button component preset with Text child and `label` prop.
4. Add a visible rich-card/wrap-selection component creation flow.
5. Make Component Edit support adding child layers or common component children.
6. Re-run this polished app QA from fresh Studio after those fixes.
