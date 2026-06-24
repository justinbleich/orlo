# phase2.md — Designer Tooling Layer

> **⚠ Post-v1 roadmap.** Per `PRD.md` §3 and §12, v1 is intentionally primitive-centric. The
> components, design tokens, and variants in this document are **post-v1** and are sequenced only
> after v1's success criteria (`PRD.md` §10) are met. This is not part of the v1 build.

> The toolset designers need to author interfaces on the canvas: creation tools, auto-layout,
> styling, and a component/design-system library. Pair with `BUILD.md` (foundation) and
> `PRD.md` (rationale).

**Relationship to BUILD.md:** this is a separate track, numbered on its own. Where `BUILD.md`
Phase 2 means *render/layout fidelity*, this document is *the tools designers use to author UI*.
It **depends on** `BUILD.md` Phases 1–3 already existing: the RN-primitive document model
(`packages/document`), the canvas shell (`apps/studio` + tldraw `RNFrame`), the renderer
(`packages/render-web`), and codegen emit (`packages/codegen`). Do not start here until those pass.

## Core principle

Every tool in this document is a **different authoring affordance over the same RN node tree.**
The rectangle tool, the auto-layout panel, and typing JSX all produce the same underlying nodes.
We are not building Figma on top of RN — we are adding input methods onto one native-first model.

## Invariants (in addition to BUILD.md's)

1. No tool may introduce state that RN can't express. Everything routes through
   `packages/document` + `packages/styles` validation. Web-only CSS is rejected at the boundary.
2. **Auto-layout IS Yoga flexbox** — never a separate simulated layout system.
3. **Mode-aware interaction:** dragging a child *inside an auto-layout container* reorders/reflows
   it; dragging an *absolute* child moves it (sets top/left). The canvas must read each node's
   layout mode before deciding what a drag does. (This matches Figma's own behavior.)
4. Components, instances, variants, and tokens are **additive node types**
   (`ComponentDefinition`, `ComponentInstance`, token-reference style values) — an extension of
   the model, not a rearchitecture.
5. Every new node type / prop / style must round-trip through `packages/codegen` (emit) before
   the task is done. A tool that produces un-exportable nodes is incomplete.
6. **Out of scope (this layer):** vector/pen/boolean ops, gradients, blur. Only shadow + opacity
   effects. Charts and other vector content arrive **later** as opaque component instances backed
   by a web-capable dep (Skia via CanvasKit) — props in, drawing out, not decomposable nodes.

---

## Tool inventory

### Creation tools (canvas toolbar)
| Tool | Produces | RN mapping | Notes |
|---|---|---|---|
| Select / Move | — | — | Default tool. Click, marquee-select, drag. Mode-aware (see invariant 3). |
| Frame | container node | `View` | Optional clip = `overflow: 'hidden'`. The unit of "screen" too. |
| Rectangle / Shape | box node | `View` | fill / radius (per-corner) / border. Circle = full radius. No vector. |
| Text | text node | `Text` | Inline edit on canvas. `numberOfLines`, alignment, typography. |
| Image | image node | `Image` | From upload / url / asset. Track source kind (require vs uri). |
| Instance (2C) | instance node | `<Component … />` | Drop from library; props/overrides via inspector. |

### Layout & structure
| Tool | Edits | RN mapping | Notes |
|---|---|---|---|
| Auto-layout panel | container | flex styles | direction→`flexDirection`, gap→`gap`, padding→`padding`, align→`alignItems`/`justifyContent`, wrap→`flexWrap`. |
| Per-child sizing | child | flex/dims | hug = content size, fill = `flex: 1`, fixed = explicit width/height. |
| Absolute placement | child | `position:'absolute'` + top/left | For non-auto-layout containers. |
| Constraints | child | %/`flex`/`alignSelf` | Pin/center/scale → percentage offsets or flex; some Figma combos approximated. |
| Layers / tree panel | tree | nesting | Reorder, rename, group, reparent (drag-in-tree), z-order. |
| Align & distribute | selection | coords or `justifyContent` | Absolute → set coords; flex → set distribution. |
| Snapping & guides | — | — | Snap to sibling edges/centers; spacing hints; resize handles. |

### Styling (inspector — RN subset only)
| Section | RN style |
|---|---|
| Fill | `backgroundColor` (gradient later, as dep) |
| Border | `borderWidth`, `borderColor`, `borderRadius` (+ per-corner) |
| Typography | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `color`, `textAlign`, `numberOfLines` |
| Spacing | `padding*`, `margin*`, `gap` |
| Size | width/height (fixed / `%` / auto), min/max, `flex`, `alignSelf`, `position` |
| Effects | shadow (`shadowColor/Offset/Opacity/Radius` + Android `elevation`), `opacity` |
| Transform | `transform: [{ rotate }, { scale }, { skewX/Y }]` |

### Component & design-system tools
| Tool | Produces | RN mapping |
|---|---|---|
| Create component | `ComponentDefinition` | named RN function component |
| Props interface | typed props | expose inner text/color/visibility/slot as props |
| Slots | children slot | React `children` |
| Variants | variant axes | typed props (`size`, `state`, `variant`) |
| Variant matrix view | many frames | spatial layout of all combinations on canvas |
| Instance + overrides | `ComponentInstance` | `<Button size="md" />` with prop overrides |
| Tokens / theme | token refs | shared theme module of constants |
| Library panel | — | browse / search / insert components & tokens |

### Productivity (table stakes)
Group/ungroup, duplicate, copy/paste (incl. paste style), lock, hide, rename, zoom-to-fit,
zoom-to-selection, undo/redo (lean on tldraw).

---

## Sub-phases

### Phase 2A — Core creation & direct manipulation
**Goal:** a designer can hand-draw a static interface and export it.
- [x] Toolbar with Select, Frame, Rectangle, Text, Image tools.
- [x] Click/drag to create sized nodes; inline text editing.
- [x] On-canvas move + resize handles; multi-select + marquee; group/ungroup; duplicate; lock/hide.
- [x] Layers/tree panel: hierarchy, rename, reorder, reparent via drag.
- [x] Inspector v1: fill, border, typography, size/dimensions.
- [x] All produced nodes export via `packages/codegen`.

**Done when:** a multi-node screen built entirely with tools exports to compiling RN that matches
the canvas within the known fidelity gap.

### Phase 2B — Auto-layout, alignment & smart canvas
**Goal:** real responsive layout, not just fixed coordinates.
- [x] Auto-layout panel: direction, gap, padding, alignment, distribution, wrap.
- [x] Per-child sizing: hug / fill / fixed.
- [ ] Absolute mode + constraints for non-auto-layout containers.
- [x] **Mode-aware drag** (invariant 3): reflow inside flex, move when absolute.
- [x] Align & distribute actions; snapping, smart guides, spacing hints.
- [x] Codegen emits correct flex `StyleSheet` for all of the above.

**Done when:** toggling a container to auto-layout reflows children live (via Yoga), resizing
the frame behaves like the device, and the exported flex styles match.

### Phase 2C — Components & instances
**Goal:** reusable components that are real RN components.
- [ ] Promote selection → `ComponentDefinition` with a typed props interface.
- [ ] Expose inner values (text/color/visibility) and `children` slots as props.
- [ ] Place `ComponentInstance` nodes; edit overrides in the inspector.
- [ ] Codegen: definitions → function components; instances → JSX usages with props.
- [ ] Editing a definition updates all instances on the canvas.

**Done when:** a component defined once, instanced several times with different overrides, renders
and exports as one component + multiple parameterized usages.

### Phase 2D — Variants, tokens & library
**Goal:** a real design system that is also the shipped code.
- [ ] Variant axes on a component; **variant matrix view** auto-laid-out on the canvas.
- [ ] Design tokens (color / spacing / typography); bind style values to tokens.
- [ ] Codegen: tokens → shared theme module; component styles reference it.
- [ ] Library panel: browse, search, insert components & tokens.

**Done when:** a token change propagates to every bound component on the canvas and in exported
code, and the variant matrix renders the full combination set from typed props.

---

## Definition of done (this layer)

A designer (or agent) can build a complete, responsive, componentized interface using only these
tools — auto-layout, components, variants, tokens — and export RN code where the design-time
component library **is** the code component library, with no manual porting and no vector/effects
gaps beyond the deliberately deferred set.
