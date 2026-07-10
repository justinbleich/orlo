# Component UX Designer QA Log

Date: 2026-07-07
Method: Designer-role acceptance test against `component-ux-best-in-class-plan-2026-07-07.md`. No code edits. Test case: extending the onboarding screen (`generated/Screen.tsx`) into a simple task app — created a `Card/Task` card ("Buy groceries") and an `AddTask` button via the real UI flows.
Branch: `ux/component-editing`, Studio dev server on :5180.

Automation notes: chrome/dialog/inspector flows driven via browser automation; tldraw canvas drags are not reachable with synthetic pointer events, so canvas draw/place interactions are flagged **needs manual pass** rather than pass/fail. Document state verified against the live store where UI evidence was ambiguous.

Artifacts intentionally left in place (they are the test case): `CardTask` + `AddTask` components, their instances on HomeScreen, `generated/components/CardTask.tsx`, `generated/components/AddTask.tsx`.

---

## Verdict at a glance

| Plan phase | Status |
|---|---|
| P1 Mode & access | **Mostly shipped, works** — one display-desync bug |
| P2 Real creation | **Shipped, strong** — presets deliver; canvas-create untested |
| P3 Instance config | **Shipped, strongest area** — hover-highlight missing |
| P4 Variant authoring | **Shipped w/ one serious bug** (axis add wipes overrides) |
| P5 Library organization | **Largely not started** (grouping/search/cleanup missing) |

Zero console errors or warnings across the whole session.

---

> **Fix status (2026-07-08):** all seven bugs fixed on `ux/component-qa-fixes`
> (7 commits, `ce5391e`…`212f4e9`), each verified in the running app.
> B1 → `migrateCombinationsForAxis` replicates combinations across a new axis.
> B2/B6 → diff-based `componentEditIsDirty()` against a post-seed baseline; NumberField remounts on external value changes while idle.
> B3 → delete confirm dialog with placed-instance count.
> B4 → editor ref nulled on Tldraw teardown + deferred onMount focus (StrictMode-safe).
> B5 → all arming paths announce in the status bar with an Esc hint (Esc-to-disarm already existed; the original finding overstated the gap — keyboard shortcuts and the panel Place action already announced).
> B7 → slash display paths map to stored dot names; the panel already grouped dot names (the "missing grouping" was this one input bug).

## Bugs (ordered by severity)

### B1 — Adding a variant axis silently deletes all existing variant overrides
**Phase 4 · High.** AddTask (Button preset) had hover/pressed/disabled overrides (1 each). Adding a `size` axis via "+ Add a variant property → Size" expanded the matrix to 12 combinations — all showing "No overrides"; store confirmed `combinations: []`. No warning, no migration; the 12 clean-looking cards give no hint work was lost. Undo fully recovers (axis removed, 3 combos restored), which mitigates but does not excuse the silent wipe. Expected: migrate existing overrides into the cross-product (e.g. `hover` override applies to all `hover/*`), or at minimum warn.

### B2 — Discard-and-switch leaves stale draft UI on reopen
**Phase 1 · Medium.** Edited ButtonPrimary width 295→320, clicked TaskCard, chose **Discard and switch** (status correctly said "Discarded ButtonPrimary; editing TaskCard"; definition reverted to 295 — verified in store). Reopening ButtonPrimary showed width **320** in the inspector plus an "edited just now" dirty chip on a freshly opened, untouched component. Data layer is safe — pressing Done saved 295, not 320 — but the designer-visible contract of "discard" is broken: it looks like the discard didn't take.

### B3 — Delete component has no confirmation
**Phase 5 · Medium.** Clicking the row's Delete action removed ButtonQuaternary instantly — no dialog. Plan requires "delete, with confirmation." Undo restores it (component deletion is in the single undo history ✓), but a designer aiming for the adjacent Place icon can lose a component without noticing.

### B4 — Camera/viewport lost after exiting component edit (repeatable)
**Phase 1 · Medium.** Both times after Done/exit from component edit, the screen canvas came back at an empty region of the dot grid; the phone frame was off-viewport with only tldraw's small "Back to content" pill as recovery. Combined with B5 this is a bad sequence: click Place → see a blank canvas.

### B5 — Armed modes give zero feedback (Insert element, Place component)
**Phases 1/5 · Medium.** Insert → Pressable and row **Place component** both arm a placement/draw mode with no visible contract: no status-bar hint, no cursor/toolbar state a designer can read, no obvious way to cancel. Plan principle: "Every mode switch has a visible contract." (Whether click-to-place then works could not be verified via automation — needs manual pass.)

### B6 — Dirty chip appears to be time-based, not diff-based
**Phase 1 · Low.** After add-axis → undo (doc identical to last save), the header still showed "edited just now/1m ago". Same false-positive appeared in B2. If the chip drives the switch-prompt logic, designers will get save/discard dialogs with nothing to save; at minimum the chip lies.

### B7 — Display path is silently flattened
**Phase 5 · Medium (feature gap presenting as a bug).** The create dialog accepts `Card/Task` and correctly derives `Emits as CardTask`, but the stored component has only `name: "CardTask"` — no `displayPath` in the store or the sidecar JSON. Sidebar shows a flat `CardTask` row; no grouping. The input silently discards the grouping intent. (Note: commit `1f8d034` is titled "Preserve component display paths" — whatever it preserved, it isn't surviving this flow.)

---

## Plan items verified working (keep)

- **Dirty detection + switch dialog** — "Switch to TaskCard? Save or discard edits…" with Cancel / Discard and switch / Save and switch; both paths verified against the store (save persisted, discard reverted). No-change switches are instant, no prompt. ✓
- **Instance selection never enters edit mode** — inspector shows `INSTANCE · <name>` header, `n variants · n props · n overrides` summary, Reset overrides, Edit definition; workspace header stays "Screen". ✓
- **Create component from selection** — preview of included layers, display-path field, code-safe "Emits as", "screen keeps an instance" contract, opens definition after creation, children preserved. ✓
- **Preset detection** — View+Texts selection auto-offered **Card** preset (exposed `title`/`subtitle`/`background`, bound to the right layers); Pressable+Text offered **Button** preset ("Adds label and disabled props plus default, hover, pressed, and disabled states"), and delivered exactly that: 4 variant frames, matrix with override counts, `label`/`disabled` props. The under-a-minute button criterion is met. ✓
- **Generated code quality** — `CardTask.tsx`/`AddTask.tsx` are clean idiomatic RN: typed props interfaces, defaults from template values, prop-wired style arrays, extracted StyleSheet. ✓
- **Instance configuration** — label prop edit reflected on canvas immediately; `state` variant segmented control works; override count updates live; Reset overrides restores base (verified in store). ✓
- **Variant surfaces consolidated** — variants column + matrix + inline axis editor live in one workspace; no duplicate tab/rail. Editing contract is explicit ("EDITING state: hover" + OVERRIDE chip). Explicit default value chip on the axis (`default · base`). Common-axis menu (Size/State/Theme/On-off/Custom) is designer-readable. ✓
- **Usage tab with jump-to-instance** — "1 total across 1 screen"; clicking the row exits to the screen with the instance selected. ✓
- **Undo depth** — single undo model demonstrably covers component-definition changes, axis add (B1 recovery), and component deletion (B3 recovery). ✓

---

## Gaps vs plan (not bugs — not built yet)

| Gap | Phase |
|---|---|
| Component library grouping by display path (blocked by B7) | P5 |
| Library search | P5 |
| Component descriptions / Docs (tab says "coming soon") | P5 |
| Prop-row hover → highlight target layer (not observed on instance inspector) | P3 |
| Inherited-vs-overridden indication per field while editing a combination (overridden Fill looks identical to inherited fields; no per-field clear-override) | P4 |
| Matrix filtering / large-set collapse / "Compare with Base" (12 combos render as a flat grid) | P4 |
| Stale/orphan generated file cleanup — `ViewComponent.tsx` exists on disk with no library entry; delete flow doesn't touch generated files | P5 |
| Empty-shell recovery quick actions on canvas (empty TaskCard shows no "Add text / Add slot" affordances; inspector-only "Add label") | P2 |
| Drag-to-place from Components panel | P5 (long-term) |

---

## Polish notes

- "1 states" → "1 state" (variants column header).
- Axis value casing inconsistent: `state` values lowercase, `size` values Capitalized.
- Canvas selection badge for an instance shows the template root's layer name ("Pressable", "Add task") rather than the component name.
- Default-name collision suffix (`TaskCard2`) reproduces the naming pollution already visible in the library (`ButtonPrimary2`). Grouped paths (B7) are the real fix.
- Instance summary counts a variant switch inside "overrides" (`2 overrides` after label + state change) while also showing a separate `1 variant` badge — pick one accounting.
- Reset overrides also resets the instance's variant selection; arguably variant choice is configuration, not an override (Figma keeps them separate).
- Library is polluted with dev-era components (`TextComponent`, `PressableComponent`, `ButtonPrimary2`, `ButtonSecondary`, `ButtonQuaternary`, empty `TaskCard`, `ButtonPrimary`) — several with Usage (0). A designer's first impression of the panel is junk-drawer. Worth a cleanup pass before demos.

## Needs a manual pass (automation couldn't reach)

1. Canvas draw-to-create (View/Text tools) and click/drag-to-place after arming Insert or Place — synthetic pointer events don't reach tldraw.
2. Whether prop-row hover highlighting exists at all (synthetic hover unreliable).
3. Whether the false-dirty state (B6) triggers spurious save/discard dialogs in real use.
