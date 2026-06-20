# RN Canvas (working title)

## Product thesis

Web-native design tools benefit from a unified substrate where design, rendering, layout, and export all target the browser.

React Native has no equivalent unified substrate.

RN Canvas embraces this reality by making the document model itself React Native-native. The canvas is an authoring surface, the simulator is ground truth, and exported code is a direct serialization of the document rather than a translation from another design format.

The result is a workflow where React Native UI can be designed visually without a lossy handoff step.

---

## Document set & scope

This PRD defines **v1**, which is intentionally primitive-centric (see §3 and §12).

* `BUILD.md` — the v1 build plan (Phases 0–6); the authoritative *how* and *when*.
* `phase2.md`, `phase3.md` — **post-v1 roadmap** (components, tokens, variants, theming, interaction, data, device, icons). Not part of v1; sequenced only after the v1 success criteria in §10 are met.

The document tree is canonical (§6). This PRD states requirements, not authoritative types or schedules — those live in `BUILD.md` and in code.

---

## 1. Problem

The current generation of AI-native, infinite-canvas design tools (Paper, MagicPath, Stitch) all share one structural advantage: on the web, HTML/CSS is simultaneously the renderer, the design model, the export format, and the transformable medium.

One substrate does four jobs, so “design === code” comes for free and export needs no conversion step.

That unity does not exist for React Native.

There is no single substrate that is all four things at once:

* RN primitives do not paint directly in a browser canvas without react-native-web.
* A real native runtime (simulator/device) cannot be a smooth, freely-transformable infinite canvas.
* Native rendering behavior differs across platforms.
* Browser rendering cannot be treated as React Native ground truth.

As a result, teams either:

* Design in web tools and manually port to RN.
* Design in Figma and hand off to engineering.
* Build UI directly in code without a visual authoring workflow.

All approaches introduce fidelity loss between design intent and shipped RN UI.

---

## 2. Goals

* Native-first document model.
* Faithful RN export with effectively no translation step.
* Infinite-canvas visual authoring experience.
* Ground-truth simulator/device rendering.
* Agent-operable architecture via MCP.
* Eliminate RN design-to-code handoff loss.

---

## 3. Non-goals (v1)

* Pixel-perfect parity between canvas and device.
* Full bidirectional code ↔ canvas round-tripping.
* Reusable components, design tokens, variants, theming (post-v1; see §12).
* Animation authoring.
* Gesture authoring.
* Advanced navigation prototyping.
* Native-module rendering in canvas.
* Real-time multiplayer.

---

## 4. Target users

### RN Product Engineers

Want to iterate faster than hand-authoring JSX.

### Designers on RN Teams

Need a workflow that preserves fidelity through implementation.

### AI Coding Agents

Operate directly on the document model rather than generating disconnected code.

---

## 5. The Four-Jobs Problem

Because no RN substrate does all four jobs, RN Canvas intentionally splits responsibilities.

| Job                  | Mechanism                          | Consequence                 |
| -------------------- | ---------------------------------- | --------------------------- |
| Rendering surface    | react-native-web                   | Approximate render          |
| Design model         | RN-native node tree                | Authoring constrained to RN |
| Layout               | Yoga (WASM)                        | Layout closely matches RN   |
| Export               | RN JSX + StyleSheet serialization  | Near 1:1 export             |
| Transformable medium | CSS transforms on canvas container | Fast pan/zoom               |
| Ground truth         | Expo simulator/device              | Operational complexity      |

The inversion versus web-native tools:

* Web tools optimize rendering fidelity and translate to RN.
* RN Canvas optimizes export fidelity and validates rendering through the simulator.

The fidelity problem becomes a preview problem, not a code-generation problem.

---

## 6. Source of Truth Hierarchy

```text
Document Node Tree
        │
        ├── Yoga Layout Engine
        │       │
        │       ├── Canvas Renderer (RN Web)
        │       └── Simulator Renderer (Expo)
        │
        └── RN Code Generator
```

Rules:

* The document tree is canonical.
* Yoga is canonical for layout.
* Simulator output is canonical for rendering fidelity.
* Generated code is serialization, not a separate source of truth.
* The document persists as a committed sidecar (e.g. `Screen.rncanvas.json`) written alongside the generated code. The studio loads the document from the sidecar; the code is never reverse-engineered into the document.

---

## 7. Functional Requirements

### 7.1 Document Model

Nodes represent RN primitives with typed props and RN-subset styles.

Nodes may also contain design-time metadata that never appears in generated code.

Example:

```ts
type Node = {
  id: string
  type: RNPrimitive
  props: Record<string, unknown>
  style: RNStyle

  design?: {
    name?: string
    locked?: boolean
    hidden?: boolean
    annotations?: Annotation[]
  }
}
```

**v1 primitive set (`RNPrimitive`):** `View`, `Text`, `Image`, `Pressable`, `ScrollView`, `TextInput`, `FlatList`.

This named set is the v1 scope boundary — "primitive-centric" means exactly these. Keep the list here as scope; the authoritative `RNPrimitive` type lives in `packages/document`, not the PRD. The PRD names the set, code defines it. Adding a primitive is a scope change, not an implementation detail.

Requirements:

* Add/remove/reorder children
* Edit props
* Edit styles
* Undo/redo support

Grouping into reusable components is post-v1 (§12).

The document remains the single source of truth. Design-time metadata is preserved in document persistence and is never emitted to generated code (§7.5).

### 7.2 Canvas

* Infinite pan/zoom
* Frame create/move/resize/delete
* Multi-select
* Live RN rendering via react-native-web
* Viewport culling
* Level-of-detail rendering for distant frames

### 7.3 Layout

* Yoga WASM computes all layout.
* Browser flow is never authoritative.
* Selection geometry derives from Yoga output.

### 7.4 Styling

Supported:

* RN flexbox
* Unitless values
* Shadow/elevation
* RN-supported typography

Rejected:

* CSS cascade
* Grid
* Pseudo-selectors
* Web-only shorthands
* Unsupported CSS properties

Validation occurs at the model boundary.

### 7.5 Code Generation

Export produces:

* Function components
* StyleSheet.create
* Correct imports
* Navigator-ready screen structure
* A committed sidecar document (`*.rncanvas.json`) holding the canonical node tree and design-time metadata, written alongside the generated code

Capabilities (v1):

* Export screen(s)
* Generate idiomatic RN structure

Reusable-component export is post-v1 (§12).

Invariants:

* Generated code is a serialization of the document tree (§6), never a separate source of truth.
* Design-time metadata (§7.1 `design`) is never emitted to generated code; it lives in the committed sidecar document (§6), which is the in-repo persistence of the document tree.
* The document is loaded from the sidecar, never reverse-engineered from the generated code. Round-trip import from arbitrary (sidecar-less) code is post-v1 (§3, Risk #4).

### 7.6 Simulator Ground Truth

Expo-based harness app:

* Mirrors selected frame
* Metro + Fast Refresh
* Screenshot capture
* iOS target
* Android target
* Visual diff against canvas render

### 7.7 Agent / MCP Interface

Minimum MCP operations:

* get_tree
* create_frame
* delete_frame
* update_node
* set_style
* get_screenshot
* get_code

Agent screenshots must originate from device/simulator output, not DOM capture.

Phasing of the MCP server lives in `BUILD.md` (a minimal server may land after the document model exists; the full agent loop is a later phase).

---

## 8. Non-functional Requirements

### Fidelity Transparency

Canvas render is never represented as pixel-perfect.

Simulator validation must always be available.

### Performance

* Maintain 60fps pan/zoom.
* Keep only a limited set of frames live.
* Render inactive frames as lightweight proxies.

### Determinism

* Pin Yoga version.
* Pin font metrics where possible.
* Produce reproducible layout output.

### Platform Honesty

* iOS and Android are separate rendering targets.
* Differences must be surfaced rather than hidden.

---

## 9. Key Risks

### 1. Render Fidelity vs Cost

RN Web is an approximation.

Simulator infrastructure is required to establish trust.

### 2. Text Measurement and Font Fidelity

Text is expected to be the largest source of divergence.

Potential differences:

* Line wrapping
* Font metrics
* Line height
* Dynamic type / OS-level accessibility text scaling
* Font-loading parity between the canvas (RN Web) and the device
* Custom fonts

Even when Yoga geometry matches, rendered text may differ.

### 3. Simulator Screenshot Infrastructure

Reliable simulator management and screenshot capture is operationally complex.

### 4. Code Round-Tripping

StyleSheet indirection complicates reconstruction of a document tree from arbitrary source code.

### 5. Layout Edge Cases

Platform-specific rendering behavior may create geometry or visual discrepancies.

---

## 10. Success Criteria

### Phase 0 — Premise Validation

Demonstrate:

* RN node tree
* Yoga layout
* RN Web rendering
* Infinite pan/zoom
* RN code export

Validate that design → RN code is valuable.

### V1 — Usable Product

A user or agent can:

* Build screens visually
* Mirror them to a simulator
* Compare canvas vs device
* Export production-ready RN code
* Avoid manual design-to-RN porting

---

## 11. Comparison to Existing Tools

|                   | Paper / MagicPath | RN Canvas                     |
| ----------------- | ----------------- | ----------------------------- |
| Canvas nodes      | HTML/CSS          | RN primitives                 |
| Render fidelity   | Browser-perfect   | Approximate + simulator truth |
| Export            | React/Web         | React Native                  |
| RN handoff        | Manual port       | None                          |
| Agent screenshots | DOM               | Device/simulator              |
| Layout engine     | Browser           | Yoga                          |
| Source of truth   | Web document      | RN-native document            |

---

## 12. Future Document Abstractions (Post‑V1)

The v1 model remains primitive-centric.

Future abstractions may include:

### Reusable Components

* Component extraction
* Component libraries
* Shared updates

### Design Tokens

* Color tokens
* Typography tokens
* Spacing tokens

### Variants

* Button states
* Component variants
* Responsive variants

### Theming

* Light mode
* Dark mode
* Brand themes

All future abstractions compile into the same RN-native document tree and export pipeline.

These abstractions are specified as post-v1 roadmap in `phase2.md` (components, tokens, variants) and `phase3.md` (theming, plus the interaction, data, device, and icon layers).

---

## Core Positioning

**Design React Native in React Native.**

RN Canvas is the first visual editor whose source of truth is React Native itself.

Instead of translating design artifacts into RN code after the fact, RN Canvas makes the document model RN-native from the beginning, eliminating the traditional design-to-development handoff.
