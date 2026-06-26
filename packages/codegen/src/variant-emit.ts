/**
 * Variant codegen helpers (Phase 2D-3b). A component-set's per-combination style
 * overrides are emitted as extra `StyleSheet` entries selected at runtime by the
 * variant props; visibility differences become a render guard. We prefer the
 * idiomatic per-axis selection (`styles[`root_size_${size}`]`) when a node's
 * overrides factor cleanly per axis (the common case), and fall back to a
 * combination-keyed entry (`styles[`root_v_${size}_${state}`]`) only when a node
 * has genuine cross-axis overrides. Pure + deterministic; emit-core wires it in
 * where each node's base style key is generated.
 */
import * as t from "@babel/types";
import type { RNStyle } from "@rn-canvas/styles";
import type { NodeId, VariantAxis, VariantCombination } from "@rn-canvas/document";

/** One extra StyleSheet entry (`<baseKey>_<suffix>`) plus the runtime selectors
 *  to append to a node's `style` array. */
export interface NodeVariantStylePlan {
  entries: Array<{ suffix: string; style: RNStyle }>;
  /** Each becomes `styles[`<baseKey>_<literal>_${axis…}`]`. */
  selectors: Array<{ literal: string; axisNames: string[] }>;
}

const EMPTY_PLAN: NodeVariantStylePlan = { entries: [], selectors: [] };

function shallowEqual(a: RNStyle, b: RNStyle): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** Every cell of the axis cartesian product (one value per axis). */
function cells(axes: VariantAxis[]): Record<string, string>[] {
  return axes.reduce<Record<string, string>[]>(
    (acc, axis) => acc.flatMap((cell) => axis.values.map((v) => ({ ...cell, [axis.name]: v }))),
    [{}],
  );
}

function comboFor(
  combinations: VariantCombination[],
  cell: Record<string, string>,
  axes: VariantAxis[],
): VariantCombination | undefined {
  return combinations.find(
    (combo) =>
      Object.keys(combo.values).length === axes.length &&
      axes.every((axis) => combo.values[axis.name] === cell[axis.name]),
  );
}

function nodeStyleAt(
  combinations: VariantCombination[],
  cell: Record<string, string>,
  axes: VariantAxis[],
  nodeId: NodeId,
): RNStyle {
  const override = comboFor(combinations, cell, axes)?.overrides.find((o) => o.nodeId === nodeId);
  return (override?.style ?? {}) as RNStyle;
}

/**
 * Plan a node's variant style emission. Returns the StyleSheet entries to register
 * (named by `<baseKey>_<suffix>`) and the array selectors to append, choosing the
 * per-axis form when the node's overrides factor and the combination-keyed form
 * otherwise.
 */
export function planNodeVariantStyle(
  nodeId: NodeId,
  axes: VariantAxis[],
  combinations: VariantCombination[],
): NodeVariantStylePlan {
  if (axes.length === 0) return EMPTY_PLAN;
  const all = cells(axes);
  const styleAt = (cell: Record<string, string>) => nodeStyleAt(combinations, cell, axes, nodeId);
  if (!all.some((cell) => Object.keys(styleAt(cell)).length > 0)) return EMPTY_PLAN;

  // Per-axis contribution: the patch in the cell where this axis takes `value` and
  // every other axis sits at its default (first value).
  const defaults = Object.fromEntries(axes.map((a) => [a.name, a.values[0]]));
  const perAxis: Record<string, Record<string, RNStyle>> = {};
  for (const axis of axes) {
    perAxis[axis.name] = {};
    for (const value of axis.values) {
      perAxis[axis.name][value] = styleAt({ ...defaults, [axis.name]: value });
    }
  }
  const composed = (cell: Record<string, string>): RNStyle => {
    let style: RNStyle = {};
    for (const axis of axes) style = { ...style, ...perAxis[axis.name][cell[axis.name]] };
    return style;
  };
  const factors = all.every((cell) => shallowEqual(composed(cell), styleAt(cell)));

  if (factors) {
    const entries: NodeVariantStylePlan["entries"] = [];
    const selectors: NodeVariantStylePlan["selectors"] = [];
    for (const axis of axes) {
      let contributes = false;
      for (const value of axis.values) {
        if (value === axis.values[0]) continue; // default cell is the base
        const patch = perAxis[axis.name][value];
        if (Object.keys(patch).length > 0) {
          entries.push({ suffix: `${axis.name}_${value}`, style: patch });
          contributes = true;
        }
      }
      if (contributes) selectors.push({ literal: axis.name, axisNames: [axis.name] });
    }
    return { entries, selectors };
  }

  // Cross-axis: one entry per overriding cell, selected by the full tuple.
  const entries: NodeVariantStylePlan["entries"] = [];
  for (const cell of all) {
    const style = styleAt(cell);
    if (Object.keys(style).length === 0) continue;
    entries.push({ suffix: `v_${axes.map((a) => cell[a.name]).join("_")}`, style });
  }
  return { entries, selectors: [{ literal: "v", axisNames: axes.map((a) => a.name) }] };
}

/** `styles[`<baseKey>_<literal>_${axis…}`]` member expression for one selector. */
export function variantSelectorExpr(
  baseKey: string,
  selector: NodeVariantStylePlan["selectors"][number],
): t.MemberExpression {
  const quasis: t.TemplateElement[] = [
    t.templateElement({ raw: `${baseKey}_${selector.literal}_`, cooked: `${baseKey}_${selector.literal}_` }),
  ];
  selector.axisNames.forEach((_, i) => {
    const last = i === selector.axisNames.length - 1;
    quasis.push(t.templateElement({ raw: last ? "" : "_", cooked: last ? "" : "_" }, last));
  });
  const template = t.templateLiteral(quasis, selector.axisNames.map((name) => t.identifier(name)));
  return t.memberExpression(t.identifier("styles"), template, true);
}

/** The full cells in which a node is hidden (for a render guard). */
export function nodeHiddenCells(
  nodeId: NodeId,
  axes: VariantAxis[],
  combinations: VariantCombination[],
): Record<string, string>[] {
  if (axes.length === 0) return [];
  return cells(axes).filter((cell) => {
    const override = comboFor(combinations, cell, axes)?.overrides.find((o) => o.nodeId === nodeId);
    return override?.hidden === true;
  });
}

/** `!( (size === "sm" && state === "disabled") || … )` for the hidden cells, or
 *  null when the node is never variant-hidden. */
export function hiddenGuardExpr(
  hiddenCells: Record<string, string>[],
  axes: VariantAxis[],
): t.Expression | null {
  if (hiddenCells.length === 0) return null;
  const cellExpr = (cell: Record<string, string>): t.Expression => {
    const terms: t.Expression[] = axes.map((axis) =>
      t.binaryExpression("===", t.identifier(axis.name), t.stringLiteral(cell[axis.name])),
    );
    return terms.reduce((acc, term) => t.logicalExpression("&&", acc, term));
  };
  const disjunction = hiddenCells.map(cellExpr).reduce((acc, term) => t.logicalExpression("||", acc, term));
  return t.unaryExpression("!", disjunction);
}
