import type { RNStyle } from "./types";

export type PhysicalAxis = "horizontal" | "vertical";
export type SizingMode = "hug" | "fill" | "fixed";

type ParentLayout = Pick<RNStyle, "flexDirection" | "alignItems">;

function mainAxis(parent: ParentLayout): PhysicalAxis {
  return parent.flexDirection?.startsWith("row") ? "horizontal" : "vertical";
}

function dimensionKey(axis: PhysicalAxis): "width" | "height" {
  return axis === "horizontal" ? "width" : "height";
}

function parentStretchesCrossAxis(parent: ParentLayout): boolean {
  return parent.alignItems === undefined || parent.alignItems === "stretch";
}

/** Infer the authoring mode represented by an already-valid RN style. */
export function sizingMode(
  style: RNStyle,
  axis: PhysicalAxis,
  parent: ParentLayout,
): SizingMode {
  const key = dimensionKey(axis);
  if (axis === mainAxis(parent)) {
    if ((style.flex ?? 0) > 0 || (style.flexGrow ?? 0) > 0) return "fill";
  } else {
    const stretches =
      style.alignSelf === "stretch" ||
      ((style.alignSelf === undefined || style.alignSelf === "auto") &&
        parentStretchesCrossAxis(parent));
    if (style[key] === undefined && stretches) return "fill";
  }
  return style[key] === undefined || style[key] === "auto" ? "hug" : "fixed";
}

/** Translate a design-tool sizing mode into the RN/Yoga style vocabulary. */
export function sizingPatch(
  style: RNStyle,
  axis: PhysicalAxis,
  mode: SizingMode,
  parent: ParentLayout,
  fixedValue?: number,
): Partial<RNStyle> {
  const key = dimensionKey(axis);
  const isMain = axis === mainAxis(parent);

  if (isMain) {
    if (mode === "fill") {
      return { [key]: undefined, flex: 1, flexGrow: undefined, flexBasis: undefined };
    }
    return {
      [key]: mode === "fixed" ? fixedValue ?? (axis === "horizontal" ? 100 : 40) : undefined,
      flex: undefined,
      flexGrow: undefined,
      flexBasis: undefined,
    };
  }

  if (mode === "fill") {
    return { [key]: undefined, alignSelf: "stretch" };
  }
  const clearsStretch = style.alignSelf === "stretch" || style.alignSelf === "auto";
  return {
    [key]: mode === "fixed" ? fixedValue ?? (axis === "horizontal" ? 100 : 40) : undefined,
    alignSelf:
      mode === "hug" && parentStretchesCrossAxis(parent)
        ? "flex-start"
        : clearsStretch
          ? undefined
          : style.alignSelf,
  };
}
