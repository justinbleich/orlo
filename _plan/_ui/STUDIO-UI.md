# STUDIO-UI.md — region map & design discipline

The layout skeleton and rules for building the studio chrome. Tokens live in
`design-tokens.css` (values) and `studio-theme.ts` (typed accessors). This is the
*frame* every functional panel drops into. Derived from the UI mockups.

> **When to build what:** establish this shell + tokens now (Phase 2). Build each
> region's functional UI as its phase lands (inspector = Phase 1, render surface =
> Phase 2, ground-truth pane = Phase 4). Do the cohesive *polish* pass at the
> Phase 3→4 boundary, once the author → render → export → verify loop works.

---

## Region map

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOP BAR  (--h-topbar 50)                                                   │
│ brand · project crumb · [device preset] · zoom · [light/dark] ·            │
│ agent status · Run on device · export · avatar                             │
├────┬───────────────┬───────────────────────────────┬──────────────────────┤
│RAIL│ LEFT PANEL    │ CANVAS (flex)                 │ RIGHT COLUMN         │
│ 52 │ 246           │                               │ 336                  │
│    │ Screens /     │ infinite pan/zoom, dot grid,  │ ┌──────────────────┐ │
│ ⌖  │ Layers /      │ tldraw RNFrames rendered via  │ │ INSPECTOR (flex) │ │
│ ▭  │ Library tabs  │ react-native-web,             │ │ Design/Interact/ │ │
│ ◻  │               │ selection handles, badges     │ │ Code tabs        │ │
│ T  │ screens list  │                               │ └──────────────────┘ │
│ ▣  │ + layer tree  │                               │ ┌──────────────────┐ │
│ ─  │               │                               │ │ GROUND TRUTH     │ │
│ ◈  │               │                               │ │ (--h 300)        │ │
│ ★  │               │                               │ │ Device | Code    │ │
│ ⤳  │               │                               │ │ live sim mirror  │ │
│    │               │                               │ └──────────────────┘ │
└────┴───────────────┴───────────────────────────────┴──────────────────────┘
```

| Region | Token | Role | Lands in |
|---|---|---|---|
| Top bar | `--h-topbar` 50 | global context + actions (device, zoom, theme, Run, agent, export) | accretes Ph1→Ph4 |
| Tool rail | `--w-rail` 52 | creation tools: select, frame, rect, text, image · component, icon, connect | Ph1 (basic), Ph2 |
| Left panel | `--w-left-panel` 246 | tabs: Screens / Layers / Library; screens list + node tree | Ph1 |
| Canvas | flex | tldraw infinite canvas; RNFrames via react-native-web; selection/badges | Ph1–Ph2 |
| Inspector | flex (right top) | tabs: Design / Interact / Code; node props + styles | Ph1 (Design); Interact/Code later |
| Ground truth | `--h-ground-truth` 300 | Device \| Code toggle; live simulator mirror + diff | **Ph4** (signature region) |

---

## Design discipline (non-negotiable)

**1. Chrome vs. artboard separation.** Theme tokens style the studio chrome only.
RN content on the canvas is styled by the document's `RNStyle` — never reach into
theme tokens for it, and never let artboard colors leak into chrome.

**2. Two-job color.** `--accent` (indigo) means selection / primary / interactive /
agent. `--live` (green) is reserved for live / ground-truth / simulator / Fast
Refresh signals and nothing else. If green appears on a non-live element, that's a
bug. `--amber` is caution/diff, used sparingly.

**3. Spend boldness in one place.** The signature element is the **ground-truth
column** (live device mirror + Code toggle) — it's what no Figma clone has, so let it
carry the visual weight. Everything else stays quiet: flat graphite surfaces, hairline
borders, restrained accent.

**4. Micro-label register.** Panel/section headers use the `.eyebrow` style
(uppercase, 10px, +0.10em tracking, `--ink-faint`). It's the "pro tool" cue; use it
consistently for section headers and nowhere else.

**5. Minimal motion.** The only animated element is the live pulse on the
ground-truth indicator. Everything else is static. `prefers-reduced-motion` disables
it (already handled in the CSS).

---

## Consuming the tokens

- Import `design-tokens.css` once at the app root.
- In components, use `studio-theme.ts` (`color.accent`, `space.md`, …) for inline
  styles, or wire the CSS vars into `tailwind.config` (snippet in `studio-theme.ts`)
  and use utilities (`bg-chrome`, `text-ink`, `border-line`).
- Measured panels (tldraw geometry, fixed-width columns) read `layout.*` numbers.
- Do not introduce new raw hex values in components. If a color is missing, add a
  token here first so the system stays single-source.

---

## Don't

- Don't use `--live` for anything that isn't a live/ground-truth signal.
- Don't style RN canvas content with theme tokens (it's `RNStyle`-driven).
- Don't hardcode hex/px in components — add a token.
- Don't polish the full chrome before the core loop works (Phase 3→4); build each
  region's functional UI against these tokens as its phase lands, then do the
  cohesion pass once.
