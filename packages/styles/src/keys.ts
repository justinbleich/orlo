/**
 * Key categorization shared by validation and the Yoga mapping. Keeping these in
 * one place is what makes `packages/styles` the single authority on style
 * semantics: validation and layout-mapping can never disagree on what a key is.
 */
import type { StyleKey } from "./types";

/** Keys whose value is a Dimension (number dp | "%"). */
export const DIMENSION_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  "padding",
  "paddingHorizontal",
  "paddingVertical",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
]);

/** Dimension keys for which RN/Yoga also accept `auto`. */
export const AUTO_DIMENSION_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "flexBasis",
  "width",
  "height",
  "margin",
  "marginHorizontal",
  "marginVertical",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
]);

/** Keys whose value is a plain finite number. */
export const NUMBER_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "flex",
  "flexGrow",
  "flexShrink",
  "gap",
  "rowGap",
  "columnGap",
  "aspectRatio",
  "zIndex",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "opacity",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

/** Keys whose value is a color string. */
export const COLOR_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "borderColor",
  "backgroundColor",
  "color",
  "shadowColor",
]);

/** Keys with a fixed set of string values. */
export const ENUM_VALUES: Partial<Record<StyleKey, ReadonlySet<string>>> = {
  flexDirection: new Set(["row", "column", "row-reverse", "column-reverse"]),
  justifyContent: new Set([
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ]),
  alignItems: new Set(["flex-start", "flex-end", "center", "stretch", "baseline"]),
  alignSelf: new Set(["auto", "flex-start", "flex-end", "center", "stretch", "baseline"]),
  flexWrap: new Set(["wrap", "nowrap", "wrap-reverse"]),
  position: new Set(["relative", "absolute"]),
  fontWeight: new Set([
    "normal",
    "bold",
    "100",
    "200",
    "300",
    "400",
    "500",
    "600",
    "700",
    "800",
    "900",
  ]),
  fontStyle: new Set(["normal", "italic"]),
  textAlign: new Set(["auto", "left", "right", "center", "justify"]),
  textTransform: new Set(["none", "uppercase", "lowercase", "capitalize"]),
  textDecorationLine: new Set([
    "none",
    "underline",
    "line-through",
    "underline line-through",
  ]),
  overflow: new Set(["visible", "hidden", "scroll"]),
};

/** All recognized style keys. Anything outside this set is rejected. */
export const ALL_STYLE_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  ...DIMENSION_KEYS,
  ...AUTO_DIMENSION_KEYS,
  ...NUMBER_KEYS,
  ...COLOR_KEYS,
  ...(Object.keys(ENUM_VALUES) as StyleKey[]),
  "fontFamily",
  "shadowOffset",
  "transform",
]);

/**
 * Layout-affecting keys, fed to Yoga. Border widths are here (they affect the
 * box model) and ALSO painted, so they intentionally appear in both sets.
 */
export const LAYOUT_STYLE_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "flexDirection",
  "justifyContent",
  "alignItems",
  "alignSelf",
  "flexWrap",
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "gap",
  "rowGap",
  "columnGap",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "padding",
  "paddingHorizontal",
  "paddingVertical",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginHorizontal",
  "marginVertical",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
]);

/** Keys the renderer paints (everything not purely layout, plus border widths). */
export const VISUAL_STYLE_KEYS: ReadonlySet<StyleKey> = new Set<StyleKey>([
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderColor",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "backgroundColor",
  "color",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecorationLine",
  "opacity",
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
  "overflow",
  "transform",
  "zIndex",
]);
