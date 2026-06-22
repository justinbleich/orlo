/**
 * The RN style subset — the single vocabulary every consumer (canvas renderer,
 * codegen, harness) shares. Anything not expressible here is rejected at the
 * model boundary (see validate.ts). No CSS cascade, grid, pseudo-selectors, or
 * unit strings.
 */

export type Color = string; // hex / rgb[a]() / hsl[a]() / named; gradients are post-v1
export type Dimension = number | `${number}%`; // unitless number = dp
export type AutoDimension = Dimension | "auto";

export type FontWeight =
  | "normal"
  | "bold"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900";

export type TransformOp =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: `${number}deg` }
  | { skewX: `${number}deg` }
  | { skewY: `${number}deg` };

export interface RNStyle {
  // Flexbox (layout)
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  justifyContent?:
    | "flex-start"
    | "flex-end"
    | "center"
    | "space-between"
    | "space-around"
    | "space-evenly";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline";
  flexWrap?: "wrap" | "nowrap" | "wrap-reverse";
  flex?: number;
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: AutoDimension;
  gap?: number;
  rowGap?: number;
  columnGap?: number;

  // Dimensions (layout)
  width?: AutoDimension;
  height?: AutoDimension;
  minWidth?: Dimension;
  maxWidth?: Dimension;
  minHeight?: Dimension;
  maxHeight?: Dimension;
  aspectRatio?: number;

  // Position (layout)
  position?: "relative" | "absolute";
  top?: Dimension;
  right?: Dimension;
  bottom?: Dimension;
  left?: Dimension;
  zIndex?: number;

  // Spacing (layout) — long-hand only
  padding?: Dimension;
  paddingHorizontal?: Dimension;
  paddingVertical?: Dimension;
  paddingTop?: Dimension;
  paddingRight?: Dimension;
  paddingBottom?: Dimension;
  paddingLeft?: Dimension;
  margin?: AutoDimension;
  marginHorizontal?: AutoDimension;
  marginVertical?: AutoDimension;
  marginTop?: AutoDimension;
  marginRight?: AutoDimension;
  marginBottom?: AutoDimension;
  marginLeft?: AutoDimension;

  // Border (border widths affect the layout box; the rest is visual)
  borderWidth?: number;
  borderTopWidth?: number;
  borderRightWidth?: number;
  borderBottomWidth?: number;
  borderLeftWidth?: number;
  borderColor?: Color;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;

  // Background (visual)
  backgroundColor?: Color;

  // Typography (visual; Text intrinsic size handled by the measurer)
  color?: Color;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  fontStyle?: "normal" | "italic";
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: "auto" | "left" | "right" | "center" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecorationLine?: "none" | "underline" | "line-through" | "underline line-through";

  // Effects (visual)
  opacity?: number;
  shadowColor?: Color;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number; // Android
  overflow?: "visible" | "hidden" | "scroll";

  // Transform (visual)
  transform?: TransformOp[];
}

export type StyleKey = keyof RNStyle;
