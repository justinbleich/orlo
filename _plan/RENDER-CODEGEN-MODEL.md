# RENDER-CODEGEN-MODEL.md

How the canvas renders and how code is generated, and why. Elaborates PRD §6 (source of
truth), §7.3 (layout), §7.5 (codegen). Read alongside `PRD.md` and `BUILD.md`.

The short version: **render the document directly for liveness; treat code as a separate,
provably-correct serialization; verify fidelity with the preview.** Three separate concerns,
deliberately not collapsed.

---

## 1. Render model — document-direct, in the hot path

The canvas renders the **document model** directly via react-native-web + Yoga. Preserve immutable
node identity so React can avoid repainting unaffected node layers. Yoga may relayout an affected
ancestor/sibling region because child geometry participates in flex layout; optimize beyond the
frame boundary only when instrumentation shows the interaction budget is being missed. Codegen is
**not** in the render hot path.

This is how Figma and Paper achieve liveness: Figma renders its own scene graph directly (custom
engine on the GPU); Paper renders real HTML/CSS elements directly. In both, the render source and
the live document model are the same thing — there is no "generate an artifact, then render the
artifact" step in the interactive loop. We do the same: the live document tree is the render
source.

**Invariant:** never put codegen or a transpile/bundle step in the per-edit render path. The
foreground render is always document-direct.

## 2. Codegen model — a separate serialization

Codegen is a deterministic 1:1 serialization of the document tree to real RN code + the committed
`*.rncanvas.json` sidecar (PRD §7.5). It runs on save/export, not in the render loop — the same
way Figma generates code separately from its scene-graph render. Code is a derived output, never
the render source and never the source of truth (the document/sidecar is).

## 3. Liveness

Liveness comes entirely from §1: rendering the live document model and limiting repaint/layout
work to the smallest correct affected region. No codegen, no transpile, no background
reconciliation in the path. Measure active-frame edits against a 16 ms interaction budget before
adding a persistent incremental Yoga tree; whole-frame Yoga is acceptable while it meets that
budget. This is the Figma/Paper-class "instant" feel, and it is available because the render source
is the live model.

## 4. Codegen is correct-by-construction

Because the input is a **closed, validated space** (the 7 v1 primitives, typed props per
primitive, the RNStyle subset, fail-closed validation at every write) and codegen is a
**mechanical serialization** (not an AI translation of an unbounded design), codegen is designed as
a total function over a closed vocabulary. Values and tree sizes are not literally finite, so its
output guarantee must be established by fail-closed validation, exhaustive branch/key coverage,
bounded property generation, and generated-RN typechecking.

This is the inverse of the Figma→RN translation tools: their input is arbitrary and fuzzy and they
translate with a model, so their output can fail in open-ended ways. Ours is constrained to a
closed, mechanically testable contract instead.

**This is a property to establish, not a free lunch.** Codegen must handle every node type, every
prop, and every style key. The closed vocabulary is exactly what makes strong evidence practical:
a deterministic corpus covers every supported branch/key, while property tests compose bounded
arbitrary valid document trees and assert that output typechecks and sidecars round-trip.

**Consequence:** no background render-from-code validator is needed. The serializer is trusted only
after the model boundary, exhaustive contract corpus, property tests, and generated-RN typecheck
pass. There is then no second runtime render path to reconcile.

## 5. Two guarantees — do not conflate

These are different axes, proven by different means:

- **Codegen correctness** — the generated code is valid and faithful to the document. Established
  by §4 (closed vocabulary + mechanical serialization + exhaustive contract/property tests).
- **Canvas↔device fidelity** — the rnw render matches the native render. **Not** guaranteed by
  correct codegen. Perfectly correct RN still rasterizes slightly differently in rnw vs native.
  Verified by the serve-sim **preview**, not proven.

"The code is provably correct" must never be read as "the canvas is provably accurate." Different
claims.

## 6. Drift model

- **Translation drift: eliminated.** The canvas runs real RN (same primitives, props, styles the
  device runs), so structure and style intent cannot diverge. This is the native-first win and is
  why our drift floor is below the translation tools'.
- **Renderer drift: remains,** and concentrates in **text/font measurement** (rnw vs native text
  engines), with smaller residuals in effects (shadow/elevation) and the inherent iOS-vs-Android
  split (one canvas render, two device renders). "Same code → light drift" holds automatically for
  structure/style; for text it is *earned* by the font-parity work (Yoga TextMeasurer + tuned
  FontMetricsTable), not free.
- **Verification:** the flow is canvas-dependent authoring with the serve-sim preview for
  verification of the residual renderer drift. (The old screenshot-diff Phase 4 is deprecated;
  fidelity is verified by previewing, optionally backed by a minimal CI fidelity check.)

## 7. Forward constraint (post-v1)

The correct-by-construction guarantee is cleanest in v1's purely-declarative scope. As phase3
behavior lands (onPress, navigation), keep those equally constrained — a **closed set** of actions
(navigate-to-screen, open-overlay), never arbitrary code. The moment behavior becomes open-ended,
the buggy-output space returns. Keeping interactions declarative is how the guarantee survives.

---

## Implementation invariants (summary)

1. Foreground render is document-direct; codegen/transpile never in the per-edit path.
2. Codegen is a separate, deterministic serialization (on explicit Generate/Sync), established
   over the supported vocabulary by validation, exhaustive contract coverage, property tests, and
   generated-RN typechecking.
3. The document tree is the single source of truth; render, codegen, and preview all derive from it.
4. Codegen correctness ≠ canvas↔device fidelity. Tests prove the first; the preview verifies the
   second.
5. Keep interactions a closed action set (post-v1) to preserve correctness-by-construction.
