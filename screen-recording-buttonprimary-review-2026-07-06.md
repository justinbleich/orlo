# Screen Recording Review — Component Edit Panel UX

Source: `/Users/justinbleich/Desktop/Screen Recording 2026-07-06 at 8.09.54 PM.mov`

## What I Could Inspect

The recording is a 25.8s QuickTime file. I initially inspected a QuickLook thumbnail, then installed `ffmpeg` and extracted one frame per second plus a contact sheet for the full pass.

## Observed Behavior

The recording is not just a button review. It shows several component-edit and panel UX problems:

- `ButtonPrimary` opens in `Component · ButtonPrimary`, selects a `Pressable`, and shows a blue rounded body with no label.
- The left Components panel has two nearby meanings: clicking a row arms placement, while clicking the small pencil enters component edit. In the recording, those clicks do not get enough feedback.
- Component edit adds another variants rail and top tabs on top of the already-present left nav and right inspector, so the panel hierarchy feels heavy for a focused edit mode.
- The inspector exposes the primitive shell, but there is no obvious next action for adding/editing the missing label.
- `TaskCard` opens in `Component · TaskCard` as an empty rounded card first, then flips into a gray `Error` placeholder.
- While the card is in the error state, the inspector reports `ComponentInstance`, which is the wrong mental model for editing a component template.
- Several clicks appear to have no durable feedback beyond a subtle selection/hover change. The status strip does not narrate component arm/disarm, entering edit, cancel, or done.

## Diagnosis

This points to three categories:

- **Template resilience:** Empty or malformed component templates should remain editable and should not show renderer error placeholders during ordinary authoring.
- **Feedback:** Component list actions need explicit status feedback because row-click-to-arm and pencil-click-to-edit are easy to confuse.
- **Mode clarity:** Component edit should feel like one clear workspace, not three competing panels. The variants rail, top tabs, left nav, and inspector need a sharper hierarchy.

## Fixes Implemented

Implemented in the follow-up fixes:

- Empty `Pressable` templates receive centered editable `Text` with `Pressable`.
- Pressable creation uses a neutral border/fill shell rather than primary-button styling.
- Empty card-like `View` templates are left as designer-authored shells instead of getting auto title/subtitle content.
- Invalid component edit roots that are `ComponentInstance` nodes are repaired to a primitive `View` fallback before hosting the template.
- Component row arm/disarm now updates the status strip.
- Entering component edit now updates the status strip.
- Component delete failures/successes now update the status strip.
- Component edit `Cancel` and `Done` now update the status strip.

The repair helper is applied in two places:

- `promoteToComponent`, for future component creation.
- `beginComponentEdit`, for existing empty or invalid components when they are opened in Component Edit.

This means opening the existing `ButtonPrimary` from the recording should produce an editable, labeled Pressable without hard-coding primary-button semantics, opening a malformed `TaskCard` should no longer land on the gray `Error` placeholder, and panel clicks should communicate what mode/action just happened.

## Still Needs Design Work

- Revisit the component edit workspace layout so variants, canvas, usage, docs, and the inspector do not compete visually.
- Make the row-click versus edit-click affordance clearer in the Components panel.
- Provide an obvious empty-template path for adding a label/content without prescribing component content.
- Treat renderer failures in component edit as recoverable authoring states with a focused message and recovery action.
