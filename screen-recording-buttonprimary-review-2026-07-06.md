# Screen Recording Review — ButtonPrimary Component Edit

Source: `/Users/justinbleich/Desktop/Screen Recording 2026-07-06 at 8.09.54 PM.mov`

## What I Could Inspect

The recording is a 25.8s QuickTime file. Local `ffprobe`/video Python tooling was unavailable, AVFoundation could read duration but refused frame extraction, and `avconvert` rejected the file despite listing compatible presets. QuickLook successfully produced a representative thumbnail.

## Observed Behavior

The thumbnail shows Studio in component focus mode:

- Workspace: `Component · ButtonPrimary`
- Canvas tab active
- Selected layer: `Pressable`
- Visual: blue rounded button body
- Missing: no text label inside the button
- Inspector confirms a `Pressable` with width `295`, height `56`, blue fill, and no visible child content

## Diagnosis

This matches the QA blocker where existing component definitions created before the Pressable default fix remain empty shells. The prior fix made *new* primitive Pressables and *future* promoted Pressables better, but did not repair an already-created `ButtonPrimary` component whose template is an empty `Pressable`.

## Fix Implemented

The component model now has one shared template seeding helper:

- Empty `Pressable` templates receive centered editable `Text` with `Button`.
- Empty View templates with component names containing `Card` receive a simple title/subtitle seed.

The helper is applied in two places:

- `promoteToComponent`, for future component creation.
- `beginComponentEdit`, for existing empty components when they are opened in Component Edit.

This means opening the existing `ButtonPrimary` from the recording should repair the template into an editable labeled button while preserving Cancel rollback semantics.

