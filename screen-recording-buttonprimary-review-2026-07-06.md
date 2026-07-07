# Screen Recording Review — ButtonPrimary Component Edit

Source: `/Users/justinbleich/Desktop/Screen Recording 2026-07-06 at 8.09.54 PM.mov`

## What I Could Inspect

The recording is a 25.8s QuickTime file. I initially inspected a QuickLook thumbnail, then installed `ffmpeg` and extracted one frame per second plus a contact sheet for the full pass.

## Observed Behavior

The recording shows two component-edit paths:

- `ButtonPrimary` opens in `Component · ButtonPrimary` and selects a `Pressable`.
- The `Pressable` is visible as a blue rounded body but has no label, making it feel broken as a button component.
- The inspector exposes the primitive shell, but there is no obvious nudge toward adding/editing the label from this state.
- `TaskCard` opens in `Component · TaskCard` as an empty rounded card first, then flips into a gray `Error` placeholder.
- While the card is in the error state, the inspector reports `ComponentInstance`, which is the wrong mental model for editing a component template.

## Diagnosis

This matches a broader component-template problem, not just an empty-button problem:

- Empty `Pressable` templates need a visible editable child so designers are not stuck with a blank tappable body.
- `Pressable` itself should not be prescribed as a primary button. Blue fill, white semibold text, and `ButtonPrimary` semantics are component authoring decisions, not primitive defaults.
- Empty card-like `View` templates should not receive opinionated title/subtitle content automatically.
- Component definitions with a `ComponentInstance` as the edit root can render as an error state and put the inspector in instance-editing mode inside component editing.

## Fix Implemented

The component model now uses conservative repair instead:

- Empty `Pressable` templates receive centered editable `Text` with `Pressable`.
- Pressable creation uses a neutral border/fill shell rather than primary-button styling.
- Empty card-like `View` templates are left as designer-authored shells instead of getting auto title/subtitle content.
- Invalid component edit roots that are `ComponentInstance` nodes are repaired to a primitive `View` fallback before hosting the template.

The repair helper is applied in two places:

- `promoteToComponent`, for future component creation.
- `beginComponentEdit`, for existing empty or invalid components when they are opened in Component Edit.

This means opening the existing `ButtonPrimary` from the recording should produce an editable, labeled Pressable without hard-coding primary-button semantics, and opening a malformed `TaskCard` should no longer land on the gray `Error` placeholder.
