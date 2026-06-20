/**
 * The one place RN styles become Yoga inputs. The canvas renderer calls this;
 * codegen reads the same RNStyle; the harness hands the same RNStyle to RN's own
 * Yoga. No consumer maps layout independently — that is what keeps canvas,
 * exported code, and device from diverging.
 *
 * Deliberately contains NO text logic — Text intrinsic sizing lives in
 * text-measure.ts (PRD §9, the #1 fidelity risk gets its own home).
 */
import {
  Align,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  PositionType,
  Wrap,
} from "yoga-layout";
import type { Node as YogaNode } from "yoga-layout/load";
import type { Dimension, RNStyle } from "./types";
import { LAYOUT_STYLE_KEYS, VISUAL_STYLE_KEYS } from "./keys";

export { LAYOUT_STYLE_KEYS, VISUAL_STYLE_KEYS };

const FLEX_DIRECTION: Record<string, FlexDirection> = {
  row: FlexDirection.Row,
  column: FlexDirection.Column,
  "row-reverse": FlexDirection.RowReverse,
  "column-reverse": FlexDirection.ColumnReverse,
};

const JUSTIFY: Record<string, Justify> = {
  "flex-start": Justify.FlexStart,
  "flex-end": Justify.FlexEnd,
  center: Justify.Center,
  "space-between": Justify.SpaceBetween,
  "space-around": Justify.SpaceAround,
  "space-evenly": Justify.SpaceEvenly,
};

const ALIGN: Record<string, Align> = {
  auto: Align.Auto,
  "flex-start": Align.FlexStart,
  "flex-end": Align.FlexEnd,
  center: Align.Center,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
};

const WRAP: Record<string, Wrap> = {
  wrap: Wrap.Wrap,
  nowrap: Wrap.NoWrap,
  "wrap-reverse": Wrap.WrapReverse,
};

/** width/height/flexBasis/margin accept number | "auto" | "x%". */
type YogaDim = number | "auto" | `${number}%`;
function dimAuto(v: Dimension): YogaDim {
  return v as YogaDim;
}
/** padding/position/min/max accept number | "%" but NOT "auto" (RN matches). */
function dimNoAuto(v: Dimension): number | `${number}%` | undefined {
  return v === "auto" ? undefined : (v as number | `${number}%`);
}

/**
 * Apply the layout-affecting subset of `style` to a Yoga node (mutates it).
 * Assumes a validated style; unknown/visual keys are ignored.
 */
export function applyLayoutStyle(node: YogaNode, style: RNStyle): void {
  if (style.flexDirection) node.setFlexDirection(FLEX_DIRECTION[style.flexDirection]);
  if (style.justifyContent) node.setJustifyContent(JUSTIFY[style.justifyContent]);
  if (style.alignItems) node.setAlignItems(ALIGN[style.alignItems]);
  if (style.alignSelf) node.setAlignSelf(ALIGN[style.alignSelf]);
  if (style.flexWrap) node.setFlexWrap(WRAP[style.flexWrap]);

  if (style.flex !== undefined) node.setFlex(style.flex);
  if (style.flexGrow !== undefined) node.setFlexGrow(style.flexGrow);
  if (style.flexShrink !== undefined) node.setFlexShrink(style.flexShrink);
  if (style.flexBasis !== undefined) node.setFlexBasis(dimAuto(style.flexBasis));

  if (style.gap !== undefined) node.setGap(Gutter.All, style.gap);
  if (style.rowGap !== undefined) node.setGap(Gutter.Row, style.rowGap);
  if (style.columnGap !== undefined) node.setGap(Gutter.Column, style.columnGap);

  if (style.width !== undefined) node.setWidth(dimAuto(style.width));
  if (style.height !== undefined) node.setHeight(dimAuto(style.height));
  if (style.minWidth !== undefined) node.setMinWidth(dimNoAuto(style.minWidth));
  if (style.maxWidth !== undefined) node.setMaxWidth(dimNoAuto(style.maxWidth));
  if (style.minHeight !== undefined) node.setMinHeight(dimNoAuto(style.minHeight));
  if (style.maxHeight !== undefined) node.setMaxHeight(dimNoAuto(style.maxHeight));
  if (style.aspectRatio !== undefined) node.setAspectRatio(style.aspectRatio);

  if (style.position) {
    node.setPositionType(
      style.position === "absolute" ? PositionType.Absolute : PositionType.Relative,
    );
  }
  if (style.top !== undefined) node.setPosition(Edge.Top, dimNoAuto(style.top));
  if (style.right !== undefined) node.setPosition(Edge.Right, dimNoAuto(style.right));
  if (style.bottom !== undefined) node.setPosition(Edge.Bottom, dimNoAuto(style.bottom));
  if (style.left !== undefined) node.setPosition(Edge.Left, dimNoAuto(style.left));

  // Padding
  if (style.padding !== undefined) node.setPadding(Edge.All, dimNoAuto(style.padding));
  if (style.paddingHorizontal !== undefined)
    node.setPadding(Edge.Horizontal, dimNoAuto(style.paddingHorizontal));
  if (style.paddingVertical !== undefined)
    node.setPadding(Edge.Vertical, dimNoAuto(style.paddingVertical));
  if (style.paddingTop !== undefined) node.setPadding(Edge.Top, dimNoAuto(style.paddingTop));
  if (style.paddingRight !== undefined)
    node.setPadding(Edge.Right, dimNoAuto(style.paddingRight));
  if (style.paddingBottom !== undefined)
    node.setPadding(Edge.Bottom, dimNoAuto(style.paddingBottom));
  if (style.paddingLeft !== undefined)
    node.setPadding(Edge.Left, dimNoAuto(style.paddingLeft));

  // Margin
  if (style.margin !== undefined) node.setMargin(Edge.All, dimAuto(style.margin));
  if (style.marginHorizontal !== undefined)
    node.setMargin(Edge.Horizontal, dimAuto(style.marginHorizontal));
  if (style.marginVertical !== undefined)
    node.setMargin(Edge.Vertical, dimAuto(style.marginVertical));
  if (style.marginTop !== undefined) node.setMargin(Edge.Top, dimAuto(style.marginTop));
  if (style.marginRight !== undefined)
    node.setMargin(Edge.Right, dimAuto(style.marginRight));
  if (style.marginBottom !== undefined)
    node.setMargin(Edge.Bottom, dimAuto(style.marginBottom));
  if (style.marginLeft !== undefined) node.setMargin(Edge.Left, dimAuto(style.marginLeft));

  // Border widths (affect the box model)
  if (style.borderWidth !== undefined) node.setBorder(Edge.All, style.borderWidth);
  if (style.borderTopWidth !== undefined) node.setBorder(Edge.Top, style.borderTopWidth);
  if (style.borderRightWidth !== undefined)
    node.setBorder(Edge.Right, style.borderRightWidth);
  if (style.borderBottomWidth !== undefined)
    node.setBorder(Edge.Bottom, style.borderBottomWidth);
  if (style.borderLeftWidth !== undefined) node.setBorder(Edge.Left, style.borderLeftWidth);
}

/** The subset of `style` the renderer paints (non-layout keys + border widths). */
export function pickVisualStyle(style: RNStyle): Partial<RNStyle> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (VISUAL_STYLE_KEYS.has(key as keyof RNStyle)) out[key] = value;
  }
  return out as Partial<RNStyle>;
}
